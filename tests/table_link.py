# Table link to RSVP guests, by e-mail and by WhatsApp, against local stand-ins (python3 tests/table_link.py).
import sys, os, json, threading, http.server
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
WA=[]; MAIL=[]
class Mock(http.server.BaseHTTPRequestHandler):
    def _out(self,code,obj): self.send_response(code); self.end_headers(); self.wfile.write(json.dumps(obj).encode())
    def do_GET(self): self._out(200,{'results':[{'id':'ch-wa','platformId':'whatsapp','name':'WhatsApp: +44','status':'active'}]})
    def do_POST(self):
        b=json.loads(self.rfile.read(int(self.headers['content-length'])))
        (MAIL if self.path=='/emails' else WA).append(b); self._out(202,{'id':'m%d'%(len(WA)+len(MAIL)),'status':'accepted'})
    def log_message(self,*a): pass
m=http.server.ThreadingHTTPServer(('127.0.0.1',8993),Mock); threading.Thread(target=m.serve_forever,daemon=True).start()
os.environ.update(BIRD_ACCESS_KEY='bk', BIRD_WORKSPACE_ID='ws1', BIRD_API_URL='http://127.0.0.1:8993', RESEND_API_KEY='re', EMAIL_FROM='rsvp@example.com', EMAIL_API_URL='http://127.0.0.1:8993/emails')
from harness import *
srv=start()
try:
    a=C(); anon=C(); a.req('/api/hq/login','POST',{'email':'admin@example.com','password':'test-password-123'})
    st,j,_=a.req('/api/hq/events','POST',{'title':'Table Night','venue':'V','city':'Istanbul','date':'2027-06-16','time':'23:00','visibility':'private'}); ev=j['event']; st,j,_=a.req('/api/hq/events/'+ev['id']+'/publish','POST',{}); tok=j['event']['inviteToken']
    anon.req('/api/public/rsvp','POST',{'t':tok,'name':'Ayşe Yılmaz','email':'ayse@example.com','phone':'0532 111 22 33','consent':True}); anon.req('/api/public/rsvp','POST',{'t':tok,'name':'No Phone','email':'np@example.com','consent':True})
    st,j,_=a.req('/api/hq/rsvps/'+ev['id']); r1=[r for r in j['rsvps'] if r['email']=='ayse@example.com'][0]; r2=[r for r in j['rsvps'] if r['email']=='np@example.com'][0]
    ok('list says the table template is not set yet', j['whatsapp']['connected'] and j['whatsapp']['table'] is False, j['whatsapp'])
    base='/api/hq/rsvps/'+ev['id']+'/'
    st,_,_=anon.req(base+r1['id']+'/send-table','POST',{'channel':'mail'}); ok('anon cannot send a table link', st==401, st)
    st,j,_=a.req(base+r1['id']+'/send-table','POST',{'channel':'mail'}); ok('pending guest: refused', st==400 and not MAIL, (st,j))
    a.req(base+r1['id']+'/decision','POST',{'decision':'approved'}); a.req(base+r2['id']+'/decision','POST',{'decision':'approved'}); nm=len(MAIL); nw=len(WA)
    st,j,_=a.req(base+r1['id']+'/send-table','POST',{'channel':'mail'}); mm=MAIL[-1]
    ok('table link by e-mail: to the guest, with the event’s table page', st==200 and j['rsvp']['tableMail']['status']=='sent' and len(MAIL)==nm+1 and mm['to']==['ayse@example.com'] and ('/tables?e='+ev['id']) in mm['html'] and ('/tables?e='+ev['id']) in mm['text'] and 'Table Night' in mm['subject'], (st,mm))
    ok('the pass e-mail record is untouched', j['rsvp'].get('mail',{}).get('status')=='sent', j['rsvp'].get('mail'))
    st,j,_=a.req(base+r1['id']+'/send-table','POST',{'channel':'wa'}); ok('WhatsApp without a table template: failure recorded, nothing sent', st==502 and 'şablon' in j['error'] and j['rsvp']['tableWa']['status']=='failed' and len(WA)==nw, (st,j))
    st,j,_=a.req('/api/hq/whatsapp/settings','PUT',{'table':{'projectId':'aaaaaaaa-2222-3333-4444-555555555555','version':'bbbbbbbb-7777-8888-9999-000000000000'}}); ok('table template saved; other templates kept', j['settings']['table']['projectId'].startswith('aaaa') and 'pass' in j['settings'] and 'invite' in j['settings'], j)
    st,j,_=a.req('/api/hq/rsvps/'+ev['id']); ok('list now says the table template is set', j['whatsapp']['table'] is True, j['whatsapp'])
    st,j,_=a.req(base+r1['id']+'/send-table','POST',{'channel':'wa'}); b=WA[-1]; prm={x['key']:x['value'] for x in b['template']['parameters']}
    ok('table link by WhatsApp: table template, +90 number, name / event / eventId', st==200 and j['rsvp']['tableWa']['status']=='sent' and b['template']['projectId'].startswith('aaaa') and b['receiver']['contacts'][0]['identifierValue']=='+905321112233' and prm=={'name':'Ayşe','event':'Table Night','eventId':ev['id']}, (st,prm))
    st,j,_=a.req(base+r2['id']+'/send-table','POST',{'channel':'wa'}); ok('WhatsApp to a guest without phone refused', st==400, st)
    st,j,_=a.req(base+r2['id']+'/send-table','POST',{'channel':'mail'}); ok('guest without phone still gets it by e-mail', st==200 and MAIL[-1]['to']==['np@example.com'], st)
    st,h,_=a.req('/hq',raw=True); ok('HQ bundle carries the table-link controls', 'Masa linki gönder' in h and 'ap-table-all' in h and 'tableProject' in h)
finally:
    srv.terminate()
print(sum(R),'/',len(R),'passed'); sys.exit(0 if all(R) else 1)
