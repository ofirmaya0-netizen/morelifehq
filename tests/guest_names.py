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
    # ---------- the host changes how many people a guest brings ----------
    P=lambda em: L+'/'+rs[em]['id']+'/guests'; cur=lambda em: {r['email']:r for r in a.req(L)[1]['rsvps']}[em]
    ok('anon cannot change it', anon.req(P('ada@x.com'),'PUT',{'plus':1})[0]==401)
    ok('must be a number from 0 to 50', a.req(P('ada@x.com'),'PUT',{'plus':-1})[0]==400 and a.req(P('ada@x.com'),'PUT',{'plus':51})[0]==400 and a.req(P('ada@x.com'),'PUT',{'plus':'x'})[0]==400 and cur('ada@x.com')['guests']==3)
    st,j,_=a.req(P('ada@x.com'),'PUT',{'plus':5}); ok('raised past the form’s own limit (3): the host is not bound by it', st==200 and j['rsvp']['guests']==6 and j['was']==3 and cur('ada@x.com')['guests']==6, j)
    ok('lowered to nobody', a.req(P('ada@x.com'),'PUT',{'plus':0})[1]['rsvp']['guests']==1 and a.req(S('ada@x.com'),'POST',{})[0]==400)
    ok('a pending guest can be changed too', a.req(P('derin@x.com'),'PUT',{'plus':4})[1]['rsvp']['guests']==5 and cur('derin@x.com')['status']=='pending')
    used=sum(r['guests'] for r in a.req(L)[1]['rsvps'] if r['status']=='approved'); a.req('/api/hq/events/'+ev['id'],'PUT',{'capacity':used+1})
    st,j,_=a.req(P('ada@x.com'),'PUT',{'plus':1}); ok('within capacity: saved', st==200 and j['rsvp']['guests']==2, j)
    st,j,_=a.req(P('ada@x.com'),'PUT',{'plus':3}); ok('over capacity for an approved guest: refused with the numbers', st==409 and j.get('overCapacity') and cur('ada@x.com')['guests']==2, j)
    ok('…unless the host insists', a.req(P('ada@x.com'),'PUT',{'plus':3,'force':True})[1]['rsvp']['guests']==4)
    ok('a pending guest is not held to capacity until approved', a.req(P('derin@x.com'),'PUT',{'plus':9})[0]==200)
    pt=cur('ada@x.com')['passToken']; ok('the entry pass shows the new party size', anon.req('/api/public/pass?t='+pt)[1]['pass']['guests']==4)
    a.req('/api/hq/events/'+ev['id'],'PUT',{'capacity':0})
    # ---------- telling the guest about the change ----------
    w0=len(WA); st,j,_=a.req(P('ada@x.com'),'PUT',{'plus':2,'notify':True}); ok('no template yet: the change is saved, the guest is not told, HQ is told why', st==200 and j['rsvp']['guests']==3 and j['notified'] is False and 'şablon' in j['notifyError'] and len(WA)==w0, j)
    ok('list shows the wording and that the template is missing', a.req(L)[1]['whatsapp']['guestsChanged'] is False and 'party of 4, including you' in a.req(L)[1]['whatsapp']['guestsChangedText'])
    a.req('/api/hq/whatsapp/settings','PUT',{'guestsChanged':{'projectId':'eeee5555-2222-3333-4444-555555555555','version':'ffff6666-7777-8888-9999-000000000000'}})
    ok('template saved without touching the others', a.req(L)[1]['whatsapp']['guestsChanged'] is True and a.req(L)[1]['whatsapp']['guestNames'] is True)
    st,j,_=a.req(P('ada@x.com'),'PUT',{'plus':4,'notify':True}); prm={x['key']:x['value'] for x in WA[-1]['template']['parameters']}
    ok('told by WhatsApp: its own template, first name / event / whole party', st==200 and j['notified'] is True and j['rsvp']['guestsWa']['status']=='sent' and WA[-1]['template']['projectId'].startswith('eeee') and prm=={'name':'Ada','event':'Santa','total':'5'} and len(WA)==w0+1, (j.get('notified'),prm))
    w1=len(WA); ok('not told without the tick, nor when nothing changed', a.req(P('ada@x.com'),'PUT',{'plus':3})[1]['notified'] is False and a.req(P('ada@x.com'),'PUT',{'plus':3,'notify':True})[1]['notified'] is False and len(WA)==w1)
    st,j,_=a.req(P('derin@x.com'),'PUT',{'plus':1,'notify':True}); ok('a pending guest is not told', j['notified'] is False and 'onaylı' in j['notifyError'] and len(WA)==w1, j)
    st,j,_=a.req(P('cem@x.com'),'PUT',{'plus':2,'notify':True}); ok('no phone: saved, not told', j['rsvp']['guests']==3 and j['notified'] is False and 'telefon' in j['notifyError'], j)
    # ---------- keeping a guest off the public guest list ----------
    for n,e in [('Gül Görünen','gul@x.com'),('Hale Gizlenecek','hale@x.com')]: anon.req('/api/public/rsvp','POST',{'t':tok,'name':n,'email':e,'showName':True,'consent':True})
    anon.req('/api/public/rsvp','POST',{'t':tok,'name':'İpek İstemeyen','email':'ipek@x.com','consent':True})
    rs2={r['email']:r for r in a.req(L)[1]['rsvps']}
    for em in ['gul@x.com','hale@x.com','ipek@x.com']: a.req(L+'/'+rs2[em]['id']+'/decision','POST',{'decision':'approved'})
    GL='/api/public/guests?e='+ev['id']+'&t='+tok; H=lambda em: L+'/'+rs2[em]['id']+'/list-hidden'
    g0=anon.req(GL)[1]; ok('the public list shows the two who asked to be shown', g0['enabled'] and len(g0['guests'])==2, g0)
    ok('anon cannot hide anybody', anon.req(H('hale@x.com'),'PUT',{'hidden':True})[0]==401)
    st,j,_=a.req(H('hale@x.com'),'PUT',{'hidden':True}); g1=anon.req(GL)[1]
    ok('hidden by the host: off the list, still counted among those going', st==200 and j['rsvp']['listHidden'] is True and len(g1['guests'])==1 and g1['going']==g0['going'], g1)
    pt2=cur('gul@x.com')['passToken']; names=[x['n'] for x in anon.req(GL+'&p='+pt2)[1]['guests']]; ok('guests with a pass do not see the hidden name either', names==['Gül Görünen'], names)
    a.req(H('ipek@x.com'),'PUT',{'hidden':False}); ok('“show” never shows a guest who did not ask to be shown', len(anon.req(GL)[1]['guests'])==1)
    a.req(H('hale@x.com'),'PUT',{'hidden':False}); ok('shown again', len(anon.req(GL)[1]['guests'])==2 and cur('hale@x.com')['listHidden'] is False)
    log=[x['action'] for x in a.req('/api/hq/audit')[1].get('entries',a.req('/api/hq/audit')[1].get('items',[]))]
    ok('asking and saving are in the record of actions', any('isimlerini WhatsApp' in x for x in log) and any('isimlerini kaydetti' in x for x in log) and any('Misafir sayısını değiştirdi' in x for x in log) and any('Public listeden gizledi' in x for x in log) and any('yeniden gösterdi' in x for x in log), log[:8])
    st,h,_=a.req('/hq',raw=True); ok('HQ bundle carries the controls and the settings fields', 'Misafir isimlerini sor' in h and 'ap-names-all' in h and 'guestNamesProject' in h and 'gn-in' in h and 'pl-save' in h and 'data-plus' in h and 'pl-tell' in h and 'data-hide' in h and 'Public listeden gizle' in h and 'guestsChangedProject' in h)
finally:
    srv.terminate()
print(sum(R),'/',len(R),'passed'); sys.exit(0 if all(R) else 1)
