# Asking guests who bring people for their names, by WhatsApp, and keeping the answer (python3 tests/guest_names.py).
import sys, os, json, threading, http.server
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
WA=[]; MAIL=[]
class Mock(http.server.BaseHTTPRequestHandler):
    def _out(self,code,obj): self.send_response(code); self.end_headers(); self.wfile.write(json.dumps(obj).encode())
    def do_GET(self): self._out(200,{'results':[{'id':'ch-wa','platformId':'whatsapp','name':'WhatsApp','status':'active'}]})
    def do_POST(self):
        b=json.loads(self.rfile.read(int(self.headers['content-length'])))
        (MAIL if self.path=='/emails' else WA).append(b); self._out(202,{'id':'x1','status':'accepted'})
    def log_message(self,*a): pass
m=http.server.ThreadingHTTPServer(('127.0.0.1',8996),Mock); threading.Thread(target=m.serve_forever,daemon=True).start()
os.environ.update(BIRD_ACCESS_KEY='bk', BIRD_WORKSPACE_ID='ws1', BIRD_API_URL='http://127.0.0.1:8996', RESEND_API_KEY='re', EMAIL_FROM='rsvp@example.com', EMAIL_API_URL='http://127.0.0.1:8996/emails')
from harness import *
srv=start()
try:
    a=C(); anon=C(); a.req('/api/hq/login','POST',{'email':'admin@example.com','password':'test-password-123'})
    ev=a.req('/api/hq/events','POST',{'title':'Santa','venue':'V','city':'Istanbul','date':'2027-12-20','time':'22:00','visibility':'private'})[1]['event']
    a.req('/api/hq/events/'+ev['id'],'PUT',{'invite':{'plusOnes':3}}); tok=a.req('/api/hq/events/'+ev['id']+'/publish','POST',{})[1]['event']['inviteToken']
    for n,e,p,pl in [('Ada Yılmaz','ada@x.com','0532 111 22 33',2),('Bora Tek','bora@x.com','0532 111 22 34',0),('Cem Telefonsuz','cem@x.com','',1),('Derin Bekleyen','derin@x.com','0532 111 22 36',1),('Ece Bir','ece@x.com','0532 111 22 37',1)]:
        anon.req('/api/public/rsvp','POST',{'t':tok,'name':n,'email':e,'phone':p,'plus':pl,'consent':True})
    L='/api/hq/rsvps/'+ev['id']; rs={r['email']:r for r in a.req(L)[1]['rsvps']}; S=lambda em: L+'/'+rs[em]['id']+'/send-guest-names'
    for em in ['ada@x.com','bora@x.com','cem@x.com','ece@x.com']: a.req(L+'/'+rs[em]['id']+'/decision','POST',{'decision':'approved'})
    n0=len(WA)
    st,j,_=a.req(L); ok('list says the template is not set, and shows the wording', j['whatsapp']['guestNames'] is False and 'full name of each guest' in j['whatsapp']['guestNamesText'] and 'with 2 guests' in j['whatsapp']['guestNamesText'], j['whatsapp'])
    ok('anon cannot ask', anon.req(S('ada@x.com'),'POST',{})[0]==401)
    st,j,_=a.req(S('ada@x.com'),'POST',{}); ok('refused until the template is set; nothing sent', st==409 and 'şablon' in j['error'] and len(WA)==n0, (st,j))
    st,j,_=a.req('/api/hq/whatsapp/settings','PUT',{'guestNames':{'projectId':'cccc3333-2222-3333-4444-555555555555','version':'dddd4444-7777-8888-9999-000000000000'}}); ok('template saved; the others kept', j['settings']['guestNames']['projectId'].startswith('cccc') and 'pass' in j['settings'] and 'tableOk' in j['settings'], j)
    ok('list now says it is set', a.req(L)[1]['whatsapp']['guestNames'] is True)
    st,j,_=a.req(S('ada@x.com'),'POST',{}); b=WA[-1]; prm={x['key']:x['value'] for x in b['template']['parameters']}
    ok('asked by WhatsApp: its own template, +90 number, first name / event / how many they bring', st==200 and j['rsvp']['namesWa']['status']=='sent' and b['template']['projectId'].startswith('cccc') and b['receiver']['contacts'][0]['identifierValue']=='+905321112233' and prm=={'name':'Ada','event':'Santa','guests':'2'}, (st,prm))
    a.req(S('ece@x.com'),'POST',{}); ok('one guest: guests = 1', {x['key']:x['value'] for x in WA[-1]['template']['parameters']}['guests']=='1')
    n1=len(WA)
    ok('not asked: nobody with them / no phone / not approved', a.req(S('bora@x.com'),'POST',{})[0]==400 and a.req(S('cem@x.com'),'POST',{})[0]==400 and a.req(S('derin@x.com'),'POST',{})[0]==400 and len(WA)==n1)
    G=L+'/'+rs['ada@x.com']['id']+'/guest-names'
    ok('anon cannot write names', anon.req(G,'PUT',{'names':'x'})[0]==401)
    st,j,_=a.req(G,'PUT',{'names':'  Zeynep Ak, Mert Aydın '}); ok('names kept on the guest', st==200 and j['rsvp']['guestNames']=='Zeynep Ak, Mert Aydın' and {r['email']:r for r in a.req(L)[1]['rsvps']}['ada@x.com']['guestNames']=='Zeynep Ak, Mert Aydın', j)
    c=a.req('/api/hq/rsvps.csv?event='+ev['id'],raw=True)[1]; ok('guest export has the names', 'Misafir isimleri' in c and 'Zeynep Ak, Mert Aydın' in c)
    a.req(G,'PUT',{'names':''}); ok('names can be cleared', {r['email']:r for r in a.req(L)[1]['rsvps']}['ada@x.com']['guestNames']=='')
    log=[x['action'] for x in a.req('/api/hq/audit')[1].get('entries',a.req('/api/hq/audit')[1].get('items',[]))]
    ok('asking and saving are in the record of actions', any('isimlerini WhatsApp' in x for x in log) and any('isimlerini kaydetti' in x for x in log), log[:8])
    st,h,_=a.req('/hq',raw=True); ok('HQ bundle carries the controls and the settings fields', 'Misafir isimlerini sor' in h and 'ap-names-all' in h and 'guestNamesProject' in h and 'gn-in' in h)
finally:
    srv.terminate()
print(sum(R),'/',len(R),'passed'); sys.exit(0 if all(R) else 1)
