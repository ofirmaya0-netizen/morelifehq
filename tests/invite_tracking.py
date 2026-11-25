# Personal invitation links: who was sent one, who opened it, who asked for a place, who passed it on (python3 tests/invite_tracking.py).
import sys, os, json, re, threading, http.server
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
WA=[]; MAIL=[]
class Mock(http.server.BaseHTTPRequestHandler):
    def _out(self,code,obj): self.send_response(code); self.end_headers(); self.wfile.write(json.dumps(obj).encode())
    def do_GET(self): self._out(200,{'results':[{'id':'ch-wa','platformId':'whatsapp','name':'WhatsApp','status':'active'}]})
    def do_POST(self):
        b=json.loads(self.rfile.read(int(self.headers['content-length'])))
        (MAIL if self.path=='/emails' else WA).append(b); self._out(202,{'id':'x1','status':'accepted'})
    def log_message(self,*a): pass
m=http.server.ThreadingHTTPServer(('127.0.0.1',8995),Mock); threading.Thread(target=m.serve_forever,daemon=True).start()
os.environ.update(BIRD_ACCESS_KEY='bk', BIRD_WORKSPACE_ID='ws1', BIRD_API_URL='http://127.0.0.1:8995', RESEND_API_KEY='re', EMAIL_FROM='rsvp@example.com', EMAIL_API_URL='http://127.0.0.1:8995/emails')
from harness import *
srv=start()
try:
    a=C(); anon=C(); a.req('/api/hq/login','POST',{'email':'admin@example.com','password':'test-password-123'})
    for n,e,p in [('Ada Yılmaz','ada@x.com','05321110001'),('Bora Kaya','bora@x.com',''),('Cem Demir','','05321110003'),('Derin Ak','derin@x.com','05321110004')]: a.req('/api/hq/contacts','POST',{'name':n,'email':e,'phone':p,'tags':'ff'})
    aid=a.req('/api/hq/audiences','POST',{'name':'FF','rules':{'tags':['ff']}})[1]['audience']['id']
    eid=a.req('/api/hq/events','POST',{'title':'Santa','venue':'V','city':'Istanbul','date':'2027-12-20','time':'22:00','visibility':'private'})[1]['event']['id']
    a.req('/api/hq/events/'+eid,'PUT',{'invite':{'plusOnes':2}}); tok=a.req('/api/hq/events/'+eid+'/publish','POST',{})[1]['event']['inviteToken']
    a.req('/api/hq/whatsapp/settings','PUT',{'invite':{'projectId':'aaaa1111','version':'bbbb2222'}})
    E='/api/hq/events/'+eid
    ok('anon cannot read the tracking', anon.req(E+'/invite-tracking')[0]==401)
    ok('nothing to track before a send', a.req(E+'/invite-tracking')[1]=={'rows':[],'totals':{'links':0,'opened':0,'applied':0,'forwarders':0,'forwarded':0,'rings':0}})
    st,j,_=a.req(E+'/invite-send','POST',{'audienceId':aid,'channels':{'wa':True,'mail':True}}); ok('sent to the audience', st==200 and j['sent']=={'wa':3,'mail':3}, j)
    key=lambda html: re.search(r'/invite\?t=([A-Za-z0-9_-]+)', html).group(1)
    mk={x['to'][0]:key(x['html']) for x in MAIL}
    wk={x['receiver']['contacts'][0]['identifierValue']:{p['key']:p['value'] for p in x['template']['parameters']}['token'] for x in WA}
    ok('every e-mail carries a different link, none of them the shared one', len(set(mk.values()))==3 and tok not in mk.values(), mk)
    ok('WhatsApp and e-mail of the same person carry the same link; the template is unchanged', wk['+905321110001']==mk['ada@x.com'] and wk['+905321110004']==mk['derin@x.com'] and len(set(wk.values()))==3, wk)
    st,j,_=a.req(E+'/invite-tracking'); rows={r['name']:r for r in j['rows']}
    ok('tracking lists the four people with their own link, nothing opened yet', st==200 and j['totals']=={'links':4,'opened':0,'applied':0,'forwarders':0,'forwarded':0,'rings':0} and rows['Ada Yılmaz']['url']=='/invite?t='+mk['ada@x.com'] and rows['Cem Demir']['sent']=={'wa':True,'mail':False} and rows['Bora Kaya']['sent']=={'wa':False,'mail':True}, j)

    # ---------- opening ----------
    st,h,_=anon.req('/invite?t='+mk['ada@x.com'],raw=True); ok('a personal link opens the invitation page and posts with its own key', st==200 and mk['ada@x.com'] in h and tok not in h, st)
    anon.req('/invite?t='+mk['ada@x.com'],raw=True); anon.req('/invite?t='+mk['ada@x.com'],raw=True,headers={'user-agent':'WhatsApp/2.23 A'}); anon.req('/invite?t='+tok,raw=True)
    rows={r['name']:r for r in a.req(E+'/invite-tracking')[1]['rows']}; ok('opens are counted per person; link-preview robots and the shared link are not', rows['Ada Yılmaz']['opens']==2 and rows['Bora Kaya']['opens']==0, rows['Ada Yılmaz'])

    # ---------- own request, forwarded request ----------
    RS=lambda t,n,e,**k: anon.req('/api/public/rsvp','POST',dict({'t':t,'name':n,'email':e,'consent':True},**k))
    ok('Ada asks for a place through her own link', RS(mk['ada@x.com'],'Ada Yılmaz','ada@x.com')[1]['created'])
    ok('two friends ask through Ada’s link', RS(mk['ada@x.com'],'Zeynep Arkadaş','zeynep@y.com',plus=1)[1]['created'] and RS(mk['ada@x.com'],'Mert Arkadaş','mert@y.com')[1]['created'])
    ok('Cem (no e-mail in the CRM) asks with a new e-mail: matched by phone, still his own', RS(wk['+905321110003'],'C. Demir','cem.new@y.com',phone='0532 111 00 03')[1]['created'])
    ok('Derin asks with another e-mail and no phone: matched by name', RS(mk['derin@x.com'],'derin  ak','derin.other@y.com')[1]['created'])
    ok('somebody asks through the shared link', RS(tok,'Ortak Link','ortak@y.com')[1]['created'])
    rs={r['email']:r for r in a.req('/api/hq/rsvps/'+eid)[1]['rsvps']}; cid={c['name']:c['id'] for c in a.req('/api/hq/contacts')[1]['contacts']}
    ok('own requests are marked personal', all(rs[x].get('personal') is True and rs[x]['via']=='invite' and 'forwardedBy' not in rs[x] for x in ['ada@x.com','cem.new@y.com','derin.other@y.com']) and rs['ada@x.com']['inviteOf']==cid['Ada Yılmaz'], rs['cem.new@y.com'])
    ok('the friends are marked as forwarded by Ada', all(rs[x]['via']=='forward' and rs[x]['forwardedBy']==cid['Ada Yılmaz'] and rs[x]['forwardedByName']=='Ada Yılmaz' for x in ['zeynep@y.com','mert@y.com']), rs['zeynep@y.com'])
    ok('the shared link leaves no mark', rs['ortak@y.com']['via']=='invite' and 'inviteOf' not in rs['ortak@y.com'] and 'personal' not in rs['ortak@y.com'])
    a.req('/api/hq/rsvps/'+eid+'/'+rs['zeynep@y.com']['id']+'/decision','POST',{'decision':'approved'})
    st,j,_=a.req(E+'/invite-tracking'); rows={r['name']:r for r in j['rows']}
    ok('tracking: Ada first, with her own request and the two she passed it on to', j['rows'][0]['name']=='Ada Yılmaz' and rows['Ada Yılmaz']['own']['status']=='pending' and [(f['name'],f['status'],f['guests']) for f in rows['Ada Yılmaz']['forwarded']]==[('Zeynep Arkadaş','approved',2),('Mert Arkadaş','pending',1)], rows['Ada Yılmaz'])
    ok('totals', j['totals']=={'links':4,'opened':1,'applied':3,'forwarders':1,'forwarded':2,'rings':1} and rows['Bora Kaya']['own'] is None and rows['Bora Kaya']['forwarded']==[], j['totals'])
    c=a.req('/api/hq/rsvps.csv?event='+eid,raw=True)[1]; ok('guest export says who passed the link on', 'İletti: Ada Yılmaz' in c and 'Kişisel link' in c)

    # ---------- the next rings ----------
    st,j,_=RS(mk['bora@x.com'],'Bora Kaya','bora@x.com'); ok('a CRM person’s own link stays their link to pass on', j['share']=='/invite?t='+mk['bora@x.com'], j)
    st,j,_=RS(mk['bora@x.com'],'Halka Bir','h1@y.com'); s1=j['share'].split('t=')[1]
    ok('a forwarded guest gets a link of their own', st==200 and s1 not in mk.values() and s1!=tok and anon.req('/invite?t='+s1,raw=True)[0]==200, j)
    st,j,_=RS(s1,'Halka İki','h2@y.com',plus=1); s2=j['share'].split('t=')[1]; RS(s2,'Halka Üç','h3@y.com')
    st,j,_=RS(tok,'Ortak Zincir','oz@y.com'); so=j['share'].split('t=')[1]; RS(so,'Ortaktan Gelen','og@y.com')
    rs={r['email']:r for r in a.req('/api/hq/rsvps/'+eid)[1]['rsvps']}
    ok('each ring points at the request before it', rs['h1@y.com']['forwardedBy']==cid['Bora Kaya'] and rs['h2@y.com']['via']=='forward' and rs['h2@y.com']['referredBy']==rs['h1@y.com']['id'] and rs['h2@y.com']['forwardedByName']=='Halka Bir' and rs['h3@y.com']['referredBy']==rs['h2@y.com']['id'] and rs['og@y.com']['referredBy']==rs['oz@y.com']['id'], rs['h2@y.com'])
    st,j,_=a.req(E+'/invite-tracking'); rows={r['name']:r for r in j['rows']}; b0=rows['Bora Kaya']['forwarded'][0]
    ok('tracking shows the chain under Bora: Bir → İki → Üç', [f['name'] for f in rows['Bora Kaya']['forwarded']]==['Halka Bir'] and [c['name'] for c in b0['children']]==['Halka İki'] and [c['name'] for c in b0['children'][0]['children']]==['Halka Üç'] and b0['children'][0]['guests']==2, b0)
    ok('somebody from the shared link who passed their own link on is listed too', rows['Ortak Zincir'].get('guest') is True and [f['name'] for f in rows['Ortak Zincir']['forwarded']]==['Ortaktan Gelen'] and rows['Ortak Zincir']['url']=='/invite?t='+so)
    ok('totals count every ring', j['totals']['links']==4 and j['totals']['forwarded']==6 and j['totals']['forwarders']==5 and j['totals']['rings']==3 and j['totals']['applied']==4, j['totals'])
    anon.req('/invite?t='+s1,raw=True); ok('openings of a guest’s link are counted on that guest', a.req(E+'/invite-tracking')[1]['rows'] and {r['name']:r for r in a.req(E+'/invite-tracking')[1]['rows']}['Bora Kaya']['forwarded'][0]['opens']>=2)
    a.req('/api/hq/rsvps/'+eid+'/'+rs['h1@y.com']['id']+'/decision','POST',{'decision':'approved'}); ptk=a.req('/api/hq/rsvps/'+eid)[1]['rsvps']; ptk=[r for r in ptk if r['email']=='h1@y.com'][0]['passToken']
    ok('once approved, the entry pass offers the same link (“Bring a friend”)', anon.req('/api/public/pass?t='+ptk)[1]['pass']['friendUrl']=='/invite?t='+s1)

    # ---------- links for invitations sent by hand ----------
    a.req('/api/hq/contacts','POST',{'name':'Elif Yeni','email':'elif@x.com','phone':'05321110006','tags':'ff'})
    st,c,hd=a.req(E+'/invite-links.csv?audience='+aid,raw=True); lines=[l for l in c.splitlines()[1:] if l]
    ok('CSV of personal links: one per person, existing links kept, a new one made for the newcomer', st==200 and len(lines)==5 and mk['ada@x.com'] in c and tok not in c and 'Elif Yeni' in c, c[:300])
    ok('the newcomer is now tracked as “link only”', {r['name']:r for r in a.req(E+'/invite-tracking')[1]['rows']}['Elif Yeni']['sent']=={'wa':False,'mail':False})
    ok('anon cannot download the links', anon.req(E+'/invite-links.csv?audience='+aid,raw=True)[0]==401)

    # ---------- renewing the invite link ends the personal ones ----------
    a.req(E+'/invite-token','POST',{})
    ok('after “Linki yenile” the personal links are dead, like the shared one', anon.req('/invite?t='+mk['bora@x.com'],raw=True)[0]==404 and anon.req('/invite?t='+s1,raw=True)[0]==404 and anon.req('/api/public/pass?t='+ptk)[1]['pass']['friendUrl']=='' and a.req(E+'/invite-tracking')[1]['totals']['links']==0)
    st,h,_=a.req('/hq',raw=True); ok('HQ bundle carries the tracking card and the forwarded mark', 'Davet takibi' in h and 'invite-tracking' in h and 'İleten: ' in h and '↳' in h)
finally:
    srv.terminate()
print(sum(R),'/',len(R),'passed'); sys.exit(0 if all(R) else 1)
