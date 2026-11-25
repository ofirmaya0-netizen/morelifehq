# Invitation to a CRM audience by WhatsApp and e-mail, against local stand-ins for Bird and the mail provider
# (python3 tests/audience_invites.py; UI=1 adds the browser part).
import sys, os, json, threading, http.server, asyncio
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
WA=[]; MAIL=[]; FAIL={'wa':False,'mail':False}
class Mock(http.server.BaseHTTPRequestHandler):
    def _out(self,code,obj): self.send_response(code); self.end_headers(); self.wfile.write(json.dumps(obj).encode())
    def do_GET(self): self._out(200,{'results':[{'id':'ch-wa','platformId':'whatsapp','name':'WhatsApp','status':'active'}]})
    def do_POST(self):
        b=json.loads(self.rfile.read(int(self.headers['content-length'])))
        if self.path=='/emails':
            if FAIL['mail']: return self._out(422,{'message':'Domain not verified'})
            MAIL.append(b); return self._out(200,{'id':'m1'})
        if FAIL['wa']: return self._out(422,{'message':'template not approved'})
        WA.append(b); self._out(202,{'id':'w1','status':'accepted'})
    def log_message(self,*a): pass
m=http.server.ThreadingHTTPServer(('127.0.0.1',8992),Mock); threading.Thread(target=m.serve_forever,daemon=True).start()
os.environ.update(BIRD_ACCESS_KEY='bk', BIRD_WORKSPACE_ID='ws1', BIRD_API_URL='http://127.0.0.1:8992', RESEND_API_KEY='re', EMAIL_FROM='rsvp@example.com', EMAIL_API_URL='http://127.0.0.1:8992/emails')
from harness import *
srv=start()
try:
    a=C(); anon=C(); a.req('/api/hq/login','POST',{'email':'admin@example.com','password':'test-password-123'})
    P=[('Ada Yılmaz','ada@x.com','05321110001','friends and family'),('Bora','bora@x.com','','friends and family'),('Cem','','05321110003','friends and family'),('Derin','derin@x.com','05321110004','friends and family, mesaj-istemiyor'),('Ece','ece@x.com','05321110005','friends and family'),('','mail@only.com','12345','friends and family'),('Dış','dis@x.com','05321110009','vip')]
    for n,e,p,t in P: a.req('/api/hq/contacts','POST',{'name':n,'email':e,'phone':p,'tags':t})
    st,j,_=a.req('/api/hq/audiences','POST',{'name':'Friends & Family','rules':{'tags':['friends and family']}}); aid=j['audience']['id']
    st,j,_=a.req('/api/hq/events','POST',{'title':'Santa','venue':'V','city':'Istanbul','date':'2027-12-20','time':'22:00','visibility':'private','waPromo':'Strictly by invitation.'}); eid=j['event']['id']
    S='/api/hq/events/'+eid+'/invite-send'; both={'audienceId':aid,'channels':{'wa':True,'mail':True}}
    ok('anon cannot send', anon.req(S,'POST',both)[0]==401)
    st,j,_=a.req(S,'POST',dict(both,dryRun=True)); ok('unpublished event refused', st==409 and 'yayınla' in j['error'], j)
    st,j,_=a.req('/api/hq/events/'+eid+'/publish','POST',{}); tok=j['event']['inviteToken']
    st,j,_=a.req(S,'POST',dict(both,dryRun=True)); ok('WhatsApp refused until the invite template is set', st==409 and 'şablon' in j['error'].lower(), j)
    st,j,_=a.req('/api/hq/events/'+eid+'/invite-sends'); ok('status: mail ready, WhatsApp not, audience listed, mail preview', j['ready']['mail'] and not j['ready']['wa'] and j['audiences']==[{'id':aid,'name':'Friends & Family'}] and 'Request your place' in j['mail']['html'] and j['sent']=={'wa':0,'mail':0}, j['ready'])
    a.req('/api/hq/whatsapp/settings','PUT',{'invite':{'projectId':'aaaa1111','version':'bbbb2222'}})
    # Ece has already applied
    st,ev,_=a.req('/api/hq/events/'+eid); anon.req('/api/public/rsvp','POST',{'t':tok,'name':'Ece','email':'ece@x.com','consent':True})
    st,j,_=a.req(S,'POST',dict(both,dryRun=True)); pl=j['plan']
    ok('plan: who gets what, who is skipped', pl['people']==4 and pl['wa']==2 and pl['mail']==3 and pl['skip']=={'optOut':1,'applied':1,'already':0,'noContact':0,'badPhone':1} and j['audience']['count']==6, j)
    ok('dry run sends nothing', not WA and not MAIL)
    ok('no channel refused', a.req(S,'POST',{'audienceId':aid,'channels':{}})[0]==400)
    sent={'wa':0,'mail':0}; frm=0; calls=0
    while frm is not None:
        st,j,_=a.req(S,'POST',dict(both,**{'from':frm,'size':2})); sent['wa']+=j['sent']['wa']; sent['mail']+=j['sent']['mail']; frm=j['next']; calls+=1
    ok('sent in windows', sent=={'wa':2,'mail':3} and calls==3 and len(WA)==2 and len(MAIL)==3, (sent,calls))
    to=sorted(x['to'][0] for x in MAIL); ok('mail only to the audience: no outsider, no opt-out, no one who applied', to==['ada@x.com','bora@x.com','mail@only.com'], to)
    ph=sorted(x['receiver']['contacts'][0]['identifierValue'] for x in WA); ok('WhatsApp only to valid audience numbers', ph==['+905321110001','+905321110003'], ph)
    prm={x['key']:x['value'] for x in [w for w in WA if w['receiver']['contacts'][0]['identifierValue']=='+905321110001'][0]['template']['parameters']}
    ok('WhatsApp variables (the link key is the person’s own)', prm['name']=='Ada' and prm['title']=='Santa' and prm['token']!=tok and len(prm['token'])>=24 and anon.req('/invite?t='+prm['token'],raw=True)[0]==200 and prm['promo']=='Strictly by invitation.' and 'V, Istanbul' in prm['line'], prm)
    ma=[x for x in MAIL if x['to']==['ada@x.com']][0]; mo=[x for x in MAIL if x['to']==['mail@only.com']][0]
    ok('mail: subject, first name, the same personal link, promo line', ma['subject']=='You’re invited — Santa' and 'Ada, you’re on the list' in ma['html'] and '/invite?t='+prm['token'] in ma['html'] and 'Strictly by invitation.' in ma['html'], ma['subject'])
    ok('nameless contact is not greeted by e-mail address', 'You’re on the list' in mo['html'] and 'mail@only.com, you' not in mo['html'])
    st,j,_=a.req(S,'POST',dict(both,dryRun=True)); ok('second run: nobody left', j['plan']['people']==0 and j['plan']['skip']['already']==4, j['plan'])
    st,j,_=a.req(S,'POST',dict(both,**{'from':0,'size':25})); ok('second send delivers nothing twice', j['sent']=={'wa':0,'mail':0} and len(WA)==2 and len(MAIL)==3, j)
    st,j,_=a.req('/api/hq/events/'+eid+'/invite-sends'); ok('totals on the event', j['sent']=={'wa':2,'mail':3} and j['ready']['wa'], j['sent'])
    # a refused message is reported and can be retried
    a.req('/api/hq/contacts','POST',{'name':'Fulya','email':'fulya@x.com','phone':'05321110006','tags':'friends and family'}); FAIL['mail']=True
    st,j,_=a.req(S,'POST',dict(both,**{'from':0,'size':25})); ok('provider refusal reported per person', j['sent']=={'wa':1,'mail':0} and j['failed']==[{'name':'Fulya','channel':'mail','error':'Domain not verified'}], j)
    FAIL['mail']=False; st,j,_=a.req(S,'POST',dict(both,**{'from':0,'size':25})); ok('retry sends only what failed', j['sent']=={'wa':0,'mail':1} and len(WA)==3 and MAIL[-1]['to']==['fulya@x.com'], j)
    st,j,_=a.req(S,'POST',{'audienceId':aid,'channels':{'mail':True},'dryRun':True}); ok('one channel only', j['plan']['wa']==0, j['plan'])
    st,j,_=a.req('/api/hq/automation/run','POST',{}); ok('scheduled automation unaffected by invite records', st==200, j)
    if os.environ.get('UI'):
        from playwright.async_api import async_playwright
        SHOT=os.environ.get('SHOTS','')
        async def ui():
            async with async_playwright() as p:
                b=await p.chromium.launch(); errs=[]; pg=await (await b.new_context(viewport={'width':1360,'height':1000})).new_page()
                pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' and 'Failed to load resource' not in m.text else None)
                a.req('/api/hq/contacts','POST',{'name':'Gül','email':'gul@x.com','phone':'05321110007','tags':'friends and family'}); n=(len(WA),len(MAIL))
                await pg.goto(B+'/hq?view=crm&tab=kitleler'); await pg.fill('#email','admin@example.com'); await pg.fill('#password','test-password-123'); await pg.click('#go')
                await pg.wait_for_selector('.aud'); await pg.click('.aud'); await pg.wait_for_selector('#a-inv'); await pg.click('#a-inv'); await pg.wait_for_selector('#inv-ev'); await pg.click('#m-ok')
                await pg.wait_for_selector('#isf'); ok('audience → event messages tab with the audience preselected', 'tab=mesajlar' in pg.url and await pg.input_value('#is-aud')==aid, pg.url)
                ok('send disabled until checked', await pg.is_disabled('#is-go'))
                await pg.click('#isf button[type=submit]'); await pg.wait_for_selector('#is-out .astats'); t=(await pg.inner_text('#is-out')).replace('\n',' '); ok('plan shown', '1 kişiye gidecek' in t and 'Gül' in t and 'daha önce gönderilmiş' in t, t)
                if SHOT: await pg.screenshot(path=SHOT+'/i1-plan.png')
                await pg.click('#is-go'); await pg.wait_for_selector('#m-ok'); mt=await pg.inner_text('.modal'); ok('confirmation names counts and cost', '1 WhatsApp mesajı ve 1 e-posta' in mt and 'ücretlidir' in mt, mt)
                await pg.click('#m-ok'); await pg.wait_for_selector('#is-out .note.ok'); ok('sent from the browser', (len(WA),len(MAIL))==(n[0]+1,n[1]+1), (len(WA),len(MAIL)))
                if SHOT: await pg.screenshot(path=SHOT+'/i2-done.png')
                await pg.click('#is-pv'); await pg.wait_for_selector('.drawer iframe'); ok('mail preview opens', True)
                if SHOT: await pg.wait_for_timeout(400); await pg.screenshot(path=SHOT+'/i3-mail.png')
                ok('no browser errors', not errs, errs); await b.close()
        asyncio.run(ui())
finally:
    srv.terminate()
print(sum(R),'/',len(R),'passed'); print(open('/tmp/dev.err').read()[-1500:])
sys.exit(0 if all(R) else 1)
