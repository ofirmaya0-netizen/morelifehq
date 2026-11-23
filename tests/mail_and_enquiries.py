# E-mail + site enquiries, against a local stand-in for the mail provider (python3 tests/mail_and_enquiries.py).
import sys, os, json, threading, http.server
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
SENT=[]; FAIL={'on':False}
class Mock(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        b=json.loads(self.rfile.read(int(self.headers['content-length'])))
        if FAIL['on']: self.send_response(422); self.end_headers(); self.wfile.write(b'{"message":"Domain not verified"}'); return
        SENT.append((self.headers['authorization'],b)); self.send_response(200); self.end_headers(); self.wfile.write(b'{"id":"m1"}')
    def log_message(self,*a): pass
m=http.server.ThreadingHTTPServer(('127.0.0.1',8990),Mock); threading.Thread(target=m.serve_forever,daemon=True).start()
os.environ.update(RESEND_API_KEY='re_test', EMAIL_FROM='More Life <rsvp@example.com>', EMAIL_API_URL='http://127.0.0.1:8990/emails')
from harness import *
srv=start()
try:
    a=C(); anon=C(); a.req('/api/hq/login','POST',{'email':'admin@example.com','password':'test-password-123'})
    st,j,_=anon.req('/api/hq/enquiries'); ok('anon cannot read enquiries', st==401, st)
    st,_,_=anon.req('/api/hq/enquiries.csv'); ok('anon cannot export enquiries', st==401, st)
    q={'website':'','kind':'contact','brief':True,'name':'Lara Demir','email':'Lara@Venue.com','company':'Venue X','service':'event-production','city':'Bodrum','budget':'25000-50000','message':'We need a sunset opening.','analyticsPath':'/book'}
    st,j,_=anon.req('/api/public/enquiries','POST',q); ok('site form saved', st==200 and j=={'ok':True}, (st,j))
    st,j,_=anon.req('/api/public/enquiries','POST',{**q,'message':''}); ok('message required', st==400)
    st,j,_=anon.req('/api/public/enquiries','POST',{'kind':'community','name':'Ali','email':'ali@example.com','city':'all','consent':False}); ok('community needs consent', st==400)
    st,j,_=anon.req('/api/public/enquiries','POST',{'kind':'community','name':'Ali','email':'ali@example.com','city':'all','consent':True}); ok('community sign-up saved', st==200)
    st,j,_=anon.req('/api/public/enquiries','POST',{**q,'website':'spam'}); st,j,_=a.req('/api/hq/enquiries'); ok('honeypot dropped; 2 enquiries listed', len(j['enquiries'])==2 and j['email']['connected'], len(j['enquiries']))
    e0=[x for x in j['enquiries'] if x['email']=='lara@venue.com'][0]; ok('enquiry shaped + admin notified by e-mail', e0['kindLabel']=='Proje brief’i' and e0['status']=='new' and e0['notify']['status']=='sent' and any(s[1]['to']==['admin@example.com'] and s[1]['reply_to']=='lara@venue.com' for s in SENT), e0)
    st,j,_=a.req('/api/hq/contacts'); ok('enquiries became CRM contacts with tags', sorted((c['email'],c['tags'][0]) for c in j['contacts'])==[('ali@example.com','community'),('lara@venue.com','site-talebi')], j['contacts'])
    st,j,_=a.req('/api/hq/enquiries/'+e0['id'],'PUT',{'status':'done','note':'Aradım'}); st,j,_=a.req('/api/hq/summary'); ok('status update; summary counts new enquiries', j['newEnquiries']==1, j)
    st,t,_=a.req('/api/hq/enquiries.csv?status=done',raw=True); ok('enquiries CSV with filter', 'Lara Demir' in t and 'Ali' not in t)
    # pass e-mail
    st,j,_=a.req('/api/hq/events','POST',{'title':'Mail Night','venue':'V','city':'Bodrum','date':'2027-06-16','time':'17:00'}); ev=j['event']; a.req('/api/hq/events/'+ev['id']+'/publish','POST',{})
    anon.req('/api/public/rsvp','POST',{'slug':ev['slug'],'name':'Ayşe Yılmaz','email':'ayse@example.com','consent':True}); anon.req('/api/public/rsvp','POST',{'slug':ev['slug'],'name':'Cem Kaya','email':'cem@example.com','consent':True})
    st,j,_=a.req('/api/hq/rsvps/'+ev['id']); r1=[r for r in j['rsvps'] if r['email']=='ayse@example.com'][0]; r2=[r for r in j['rsvps'] if r['email']=='cem@example.com'][0]; n=len(SENT)
    st,j,_=a.req('/api/hq/rsvps/'+ev['id']+'/'+r1['id']+'/decision','POST',{'decision':'approved'}); m1=[s for s in SENT[n:] if s[1]['to']==['ayse@example.com']]
    ok('approval e-mails the pass once, with the pass link', j['rsvp']['mail']['status']=='sent' and len(m1)==1 and ('/pass?t='+j['rsvp']['passToken']) in m1[0][1]['html'] and m1[0][0]=='Bearer re_test' and 'Mail Night' in m1[0][1]['subject'], j['rsvp'].get('mail'))
    a.req('/api/hq/rsvps/'+ev['id']+'/'+r1['id']+'/decision','POST',{'decision':'waitlist'}); a.req('/api/hq/rsvps/'+ev['id']+'/'+r1['id']+'/decision','POST',{'decision':'approved'}); ok('re-approval does not send twice', len([s for s in SENT if s[1]['to']==['ayse@example.com']])==1)
    FAIL['on']=True; st,j,_=a.req('/api/hq/rsvps/'+ev['id']+'/'+r2['id']+'/decision','POST',{'decision':'approved'})
    ok('provider failure recorded as failed, never as sent; approval still stands', j['rsvp']['status']=='approved' and j['rsvp']['mail']['status']=='failed' and 'Domain not verified' in j['rsvp']['mail']['error'], j['rsvp'].get('mail'))
    st,j,_=a.req('/api/hq/rsvps/'+ev['id']+'/'+r2['id']+'/send-pass','POST',{}); ok('resend failure reported', st==502, st)
    FAIL['on']=False; st,j,_=a.req('/api/hq/rsvps/'+ev['id']+'/'+r2['id']+'/send-pass','POST',{}); ok('resend works after provider recovers', st==200 and j['rsvp']['mail']['status']=='sent', (st,j))
    st,j,_=a.req('/api/hq/settings'); ok('settings: e-mail connected, key never shown', j['integrations']['email']['connected'] and 're_test' not in json.dumps(j))
finally:
    srv.terminate()
print(sum(R),'/',len(R),'passed'); sys.exit(0 if all(R) else 1)
