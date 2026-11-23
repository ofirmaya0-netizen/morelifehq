# WhatsApp via Bird, against a local stand-in for Bird's Channels API (python3 tests/whatsapp.py).
import sys, os, json, threading, http.server
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
SENT=[]; FAIL={'on':False}
class Mock(http.server.BaseHTTPRequestHandler):
    def _out(self,code,obj): self.send_response(code); self.end_headers(); self.wfile.write(json.dumps(obj).encode())
    def do_GET(self):
        if self.headers.get('authorization')!='AccessKey bk_test': return self._out(401,{'message':'unauthorized'})
        self._out(200,{'results':[{'id':'ch-sms','platformId':'sms-messagebird','name':'SMS'},{'id':'ch-wa','platformId':'whatsapp','name':'WhatsApp: +44','status':'active'}]})
    def do_POST(self):
        b=json.loads(self.rfile.read(int(self.headers['content-length'])))
        if FAIL['on']: return self._out(422,{'message':'template not approved'})
        SENT.append((self.path,self.headers.get('authorization'),b)); self._out(202,{'id':'msg1','status':'accepted'})
    def log_message(self,*a): pass
m=http.server.ThreadingHTTPServer(('127.0.0.1',8991),Mock); threading.Thread(target=m.serve_forever,daemon=True).start()
os.environ.update(BIRD_ACCESS_KEY='bk_test', BIRD_WORKSPACE_ID='ws1', BIRD_API_URL='http://127.0.0.1:8991')
from harness import *
srv=start()
try:
    a=C(); anon=C(); a.req('/api/hq/login','POST',{'email':'admin@example.com','password':'test-password-123'})
    for p in ['whatsapp']:
        st,_,_=anon.req('/api/hq/'+p); ok('anon cannot read WhatsApp settings', st==401, st)
    st,_,_=anon.req('/api/hq/whatsapp/test','POST',{'to':'+905550001122','projectId':'aa','version':'bb'}); ok('anon cannot send a test', st==401, st)
    st,j,_=a.req('/api/hq/whatsapp'); ok('connected; WhatsApp channel discovered', j['status']['connected'] and [c['id'] for c in j['channels']]==['ch-wa'], j)
    st,j,_=a.req('/api/hq/whatsapp/test','POST',{'to':'0530 170 27 97','projectId':'752df9cc-dc39-4d21-bb6f-e9b14b424425','version':'21df3315-c567-4d07-a14c-95b242c095a5','parameters':{}})
    p,auth,b=SENT[-1]; ok('test send: right endpoint, key header, receiver in +90 form, template ids', st==200 and p=='/workspaces/ws1/channels/ch-wa/messages' and auth=='AccessKey bk_test' and b['receiver']['contacts'][0]['identifierValue']=='+905301702797' and b['template']['projectId'].startswith('752df9cc') and b['template']['version'].startswith('21df3315') and b['template']['locale']=='en', (st,j,b))
    st,j,_=a.req('/api/hq/whatsapp/test','POST',{'to':'12345','projectId':'aa','version':'bb'}); ok('bad number refused before sending', st==502 and len(SENT)==1, (st,j))
    st,j,_=a.req('/api/hq/events','POST',{'title':'WA Night','venue':'V','city':'Bodrum','date':'2027-06-16','time':'17:00','visibility':'private'}); ev=j['event']; st,j,_=a.req('/api/hq/events/'+ev['id']+'/publish','POST',{}); tok=j['event']['inviteToken']
    anon.req('/api/public/rsvp','POST',{'t':tok,'name':'Ayşe Yılmaz','email':'ayse@example.com','phone':'0532 111 22 33','consent':True}); anon.req('/api/public/rsvp','POST',{'t':tok,'name':'No Phone','email':'np@example.com','consent':True})
    st,j,_=a.req('/api/hq/rsvps/'+ev['id']); r1=[r for r in j['rsvps'] if r['email']=='ayse@example.com'][0]; r2=[r for r in j['rsvps'] if r['email']=='np@example.com'][0]; ok('rsvp list reports WhatsApp connected', j['whatsapp']['connected'])
    st,j,_=a.req('/api/hq/rsvps/'+ev['id']+'/'+r1['id']+'/decision','POST',{'decision':'approved'}); ok('approval without a configured template: failure recorded, approval stands', j['rsvp']['status']=='approved' and j['rsvp']['wa']['status']=='failed' and 'şablon' in j['rsvp']['wa']['error'] and len(SENT)==1, j['rsvp'].get('wa'))
    st,j,_=a.req('/api/hq/whatsapp/settings','PUT',{'pass':{'projectId':'11111111-2222-3333-4444-555555555555','version':'66666666-7777-8888-9999-000000000000'}}); ok('template settings saved', j['settings']['pass']['projectId'].startswith('1111'))
    st,j,_=a.req('/api/hq/rsvps/'+ev['id']+'/'+r1['id']+'/send-pass-wa','POST',{}); p,auth,b=SENT[-1]; prm={x['key']:x['value'] for x in b['template']['parameters']}
    ok('pass sent by WhatsApp with name, event, date and pass token', st==200 and j['rsvp']['wa']['status']=='sent' and b['receiver']['contacts'][0]['identifierValue']=='+905321112233' and prm['name']=='Ayşe' and prm['event']=='WA Night' and prm['token']==j['rsvp']['passToken'] and '16 June 2027' in prm['date'], (st,prm))
    n=len(SENT); st,j,_=a.req('/api/hq/rsvps/'+ev['id']+'/'+r2['id']+'/decision','POST',{'decision':'approved'}); ok('guest without phone: approved, no WhatsApp attempt', j['rsvp']['status']=='approved' and 'wa' not in j['rsvp'] and len(SENT)==n, j['rsvp'])
    st,j,_=a.req('/api/hq/rsvps/'+ev['id']+'/'+r2['id']+'/send-pass-wa','POST',{}); ok('manual send without phone refused', st==400, st)
    FAIL['on']=True; st,j,_=a.req('/api/hq/rsvps/'+ev['id']+'/'+r1['id']+'/send-pass-wa','POST',{}); ok('Bird rejection reported and stored as failed', st==502 and 'template not approved' in j['error'] and j['rsvp']['wa']['status']=='failed', (st,j))
    st,j,_=a.req('/api/hq/settings'); ok('settings: WhatsApp connected, key never shown', j['integrations']['whatsapp']['connected'] and 'bk_test' not in json.dumps(j))
finally:
    srv.terminate()
print(sum(R),'/',len(R),'passed'); sys.exit(0 if all(R) else 1)
