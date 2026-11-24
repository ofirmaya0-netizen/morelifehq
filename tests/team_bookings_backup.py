# Team roles + record of actions, booking pipeline, backups + restore, paged CRM list (python3 tests/team_bookings_backup.py)
import sys, os, base64, json as J
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import *
srv=start()
try:
    a=C(); anon=C(); a.req('/api/hq/login','POST',{'email':'admin@example.com','password':'test-password-123'})
    st,me,_=a.req('/api/hq/session'); ok('owner session has role and screens', me['role']=='owner' and 'booking' in me['screens'] and 'yedekler' in me['screens'], me)

    # ---------- team ----------
    ok('anon cannot read team', anon.req('/api/hq/team')[0]==401)
    ok('role required', a.req('/api/hq/team','POST',{'name':'Can','email':'can@x.com','role':'owner'})[0]==400)
    ok('owner e-mail refused', a.req('/api/hq/team','POST',{'name':'X','email':'admin@example.com','role':'door'})[0]==409)
    def member(name,email,role):
        st,j,_=a.req('/api/hq/team','POST',{'name':name,'email':email,'role':role}); assert st==201, j
        tok=j['setupUrl'].split('kur=')[1]; c=C()
        st2,info,_=c.req('/api/hq/setup?t='+tok); assert st2==200 and info['email']==email, info
        st3,r,_=c.req('/api/hq/setup','POST',{'t':tok,'password':'uzun-bir-sifre-'+role}); assert st3==200, r
        return j['member']['id'], c, tok
    st,j,_=a.req('/api/hq/team','POST',{'name':'Kapı Ali','email':'ali@x.com','role':'door'}); tok=j['setupUrl'].split('kur=')[1]; did=j['member']['id']
    ok('member created without password', st==201 and j['member']['hasPassword'] is False and j['member']['linkExpiresAt'], j)
    ok('duplicate e-mail refused', a.req('/api/hq/team','POST',{'name':'Ali 2','email':'ALI@x.com','role':'door'})[0]==409)
    d=C(); ok('cannot sign in before setting a password', d.req('/api/hq/login','POST',{'email':'ali@x.com','password':''})[0]==401)
    ok('setup link shows whose it is', d.req('/api/hq/setup?t='+tok)[1].get('name')=='Kapı Ali')
    ok('short password refused', d.req('/api/hq/setup','POST',{'t':tok,'password':'kisa'})[0]==400)
    ok('bad link refused', d.req('/api/hq/setup','POST',{'t':'nope','password':'uzun-bir-sifre-1'})[0]==404)
    ok('password set, signed in', d.req('/api/hq/setup','POST',{'t':tok,'password':'uzun-bir-sifre-1'})[0]==200 and d.req('/api/hq/session')[1]['role']=='door')
    ok('link works once', anon.req('/api/hq/setup','POST',{'t':tok,'password':'uzun-bir-sifre-2'})[0]==404)
    d2=C(); ok('member signs in with own password', d2.req('/api/hq/login','POST',{'email':'ali@x.com','password':'uzun-bir-sifre-1'})[0]==200)
    ok('wrong password refused', C().req('/api/hq/login','POST',{'email':'ali@x.com','password':'uzun-bir-sifre-x'})[0]==401)
    rid,r,_=member('Rsvp Ece','ece@x.com','rsvp'); vid,v,_=member('Gören Bora','bora@x.com','viewer'); mid,mg,_=member('Yönetici Can','can@x.com','manager')

    # an event with guests to act on
    st,j,_=a.req('/api/hq/events','POST',{'title':'Gece','date':'2027-06-16','time':'22:00','venue':'V','city':'Bodrum','capacity':10}); eid=j['event']['id']; a.req('/api/hq/events/'+eid+'/publish','POST',{})
    slug=a.req('/api/hq/events/'+eid)[1]['event']['slug']
    for n,e in [('Ada Y','ada@x.com'),('Bora K','borak@x.com'),('Cem T','cem@x.com')]: anon.req('/api/public/rsvp','POST',{'slug':slug,'name':n,'email':e,'consent':True})
    rows={x['name']:x for x in a.req('/api/hq/rsvps/'+eid)[1]['rsvps']}

    # door role
    ok('door: menu is check-in only', d.req('/api/hq/session')[1]['screens']==['ozet','kapi'])
    ok('door: cannot decide', d.req('/api/hq/rsvps/'+eid+'/'+rows['Ada Y']['id']+'/decision','POST',{'decision':'approved'})[0]==403)
    ok('door: no CRM, no bookings, no team, no backups', [d.req(p)[0] for p in ['/api/hq/contacts','/api/hq/bookings','/api/hq/team','/api/hq/backups','/api/hq/audit','/api/hq/contacts.csv','/api/hq/rsvps.csv?event='+eid]]==[403]*7)
    # rsvp role approves
    st,j,_=r.req('/api/hq/rsvps/'+eid+'/'+rows['Ada Y']['id']+'/decision','POST',{'decision':'approved'}); ok('rsvp role approves, name is kept on the guest', st==200 and j['rsvp']['decidedBy']=='Rsvp Ece', j)
    ok('rsvp role: bulk reject', r.req('/api/hq/rsvps/'+eid+'/bulk','POST',{'decision':'rejected','ids':[rows['Cem T']['id']]})[0]==200)
    ok('rsvp role: cannot edit the event, read CRM or tasks', [r.req('/api/hq/events/'+eid,'PUT',{'title':'X'})[0], r.req('/api/hq/contacts')[0], r.req('/api/hq/tasks')[0]]==[403,403,403])
    st,j,_=d.req('/api/hq/rsvps/'+eid); g=j['rsvps']
    ok('door: sees approved guests by name only', st==200 and len(g)==1 and g[0]['name']=='Ada Y' and not g[0].get('email') and not g[0].get('phone') and 'note' not in g[0], g)
    st,j,_=d.req('/api/hq/checkin','POST',{'eventId':eid,'rsvpId':g[0]['id']}); ok('door: checks in, no contact details back', j.get('result')=='ok' and 'email' not in j['rsvp'], j)
    ok('check-in remembers who', a.req('/api/hq/rsvps/'+eid)[1]['rsvps'][-1 if False else [x['name'] for x in a.req('/api/hq/rsvps/'+eid)[1]['rsvps']].index('Ada Y')].get('checkedInBy')=='Kapı Ali')
    # viewer
    ok('viewer: reads events and CRM', v.req('/api/hq/events')[0]==200 and v.req('/api/hq/contacts')[0]==200)
    ok('viewer: changes nothing', [v.req('/api/hq/events','POST',{'title':'Y'})[0], v.req('/api/hq/tasks','POST',{'title':'t'})[0], v.req('/api/hq/checkin','POST',{'eventId':eid,'rsvpId':g[0]['id']})[0]]==[403,403,403])
    ok('viewer: no bookings, no audit', v.req('/api/hq/bookings')[0]==403 and v.req('/api/hq/audit')[0]==403)
    ok('viewer summary carries no payments', v.req('/api/hq/summary')[1]['payments'] is None)
    ok('draft preview: viewer yes, door no', 'Gece' in v.req('/events/'+slug+'?preview=1',raw=True)[1] and v.req('/events/'+slug+'?preview=1')[2].get('x-robots-tag')=='noindex' and d.req('/events/'+slug+'?preview=1')[2].get('x-robots-tag')!='noindex')
    # manager
    ok('manager: edits, reads audit', mg.req('/api/hq/tasks','POST',{'title':'Ses teyidi','due':'2020-01-01'})[0]==201 and mg.req('/api/hq/audit')[0]==200)
    ok('manager: no team, no backups', mg.req('/api/hq/team')[0]==403 and mg.req('/api/hq/backups')[0]==403)
    # revoke
    ok('role change applies at once', a.req('/api/hq/team/'+rid,'PUT',{'role':'door'})[0]==200 and r.req('/api/hq/rsvps/'+eid+'/bulk','POST',{'decision':'approved','ids':[]})[0]==403)
    ok('switching off signs the member out', a.req('/api/hq/team/'+did,'PUT',{'active':False})[0]==200 and d.req('/api/hq/session')[0]==401 and d2.req('/api/hq/session')[0]==401)
    ok('switched-off member gets the login page', 'Giriş yap' in d.req('/hq',raw=True)[1])
    ok('switched-off member cannot sign in', C().req('/api/hq/login','POST',{'email':'ali@x.com','password':'uzun-bir-sifre-1'})[0]==401)
    st,j,_=a.req('/api/hq/team/'+vid+'/link','POST',{}); ok('new link ends the old session and password', st==200 and v.req('/api/hq/session')[0]==401 and C().req('/api/hq/login','POST',{'email':'bora@x.com','password':'uzun-bir-sifre-viewer'})[0]==401, j)
    ok('member changes own password', mg.req('/api/hq/me/password','POST',{'current':'uzun-bir-sifre-manager','next':'yepyeni-bir-sifre'})[0]==200 and mg.req('/api/hq/session')[0]==200 and C().req('/api/hq/login','POST',{'email':'can@x.com','password':'yepyeni-bir-sifre'})[0]==200)
    ok('delete member', a.req('/api/hq/team/'+rid,'DELETE',{})[0]==200 and r.req('/api/hq/session')[0]==401 and len(a.req('/api/hq/team')[1]['members'])==3)
    st,j,_=a.req('/api/hq/audit'); acts=[(x['name'],x['action'],x['target']) for x in j['entries']]
    ok('record: who approved whom', ('Rsvp Ece','Başvuruyu onayladı','Ada Y') in acts, acts[:12])
    ok('record: bulk, team and logins', any(x[1]=='1 başvuruyu reddetti' for x in acts) and any(x[1]=='Ekibe üye ekledi' for x in acts) and any(x[1]=='Giriş yaptı' and x[0]=='Sahip' for x in acts) and any(x[1]=='Şifresini belirledi' for x in acts), acts)
    ok('record: reads and refused requests are not logged', not any('GET' in x[1] for x in acts) and not any(x[0]=='Gören Bora' and x[1]!='Şifresini belirledi' and x[1]!='Giriş yaptı' for x in acts))
    ok('record: filter by person', all(x['name']=='Yönetici Can' for x in a.req('/api/hq/audit?uid='+mid)[1]['entries']) and len(a.req('/api/hq/audit?uid='+mid)[1]['entries'])>=2)

    # ---------- bookings ----------
    ok('artist required', a.req('/api/hq/bookings','POST',{'agency':'WME'})[0]==400)
    st,j,_=a.req('/api/hq/bookings','POST',{'artist':'PAWSA','agency':'Primary Talent','agent':'Marwan','agentEmail':'m@agency.com','eventId':eid,'date':'2027-06-16','venue':'Lucca','city':'Bodrum','fee':'100000','currency':'EUR','offerExpires':'2020-01-01'}); bid=j['booking']['id']
    ok('booking starts as an offer', st==201 and j['booking']['stage']=='offer' and j['booking']['fee']==100000 and j['booking']['offerExpired'] is True, j)
    ok('bad event refused', a.req('/api/hq/bookings','POST',{'artist':'X','eventId':'nope'})[0]==400)
    st,j,_=a.req('/api/hq/bookings/'+bid,'PUT',{'stage':'confirmed'}); ok('stage change is reported', j['booking']['stage']=='confirmed' and j['stageChanged']=='Teklif → Onay', j)
    st,j,_=a.req('/api/hq/bookings/'+bid+'/payments','POST',{'kind':'deposit','amount':'50000','due':'2020-02-01'}); dep=j['payment']['id']
    ok('deposit line added, named by itself', st==201 and j['payment']['label']=='Depozito' and j['booking']['planMismatch'] is True and j['booking']['overdue']==1, j)
    st,j,_=a.req('/api/hq/bookings/'+bid+'/payments','POST',{'kind':'balance','amount':'50000','due':'2099-06-01'}); bal=j['payment']['id']
    ok('plan matches the fee', j['booking']['planMismatch'] is False and j['booking']['unpaid']=={'EUR':100000}, j['booking'])
    ok('bad amount refused', a.req('/api/hq/bookings/'+bid+'/payments','POST',{'amount':'abc'})[0]==400)
    s2=a.req('/api/hq/summary')[1]; ok('summary: overdue payment and expired offer... offer no longer open', len(s2['payments'])==1 and s2['payments'][0]['late'] is True and s2['payments'][0]['artist']=='PAWSA' and s2['offers']==[] and s2['activeBookings']==1, s2['payments'])
    st,j,_=a.req('/api/hq/bookings/'+bid+'/payments/'+dep,'PUT',{'paid':True}); ok('paid deposit moves the deal to Depozito', j['booking']['stage']=='deposit' and j['payment']['paidBy']=='Sahip' and j['booking']['paid']=={'EUR':50000}, j['booking'])
    st,j,_=a.req('/api/hq/bookings/'+bid+'/payments/'+bal,'PUT',{'paid':True,'paidOn':'2027-06-10'}); ok('everything paid: Bakiye', j['booking']['stage']=='balance' and j['payment']['paidAt']=='2027-06-10' and j['booking']['nextPayment'] is None, j['booking'])
    st,j,_=a.req('/api/hq/bookings/'+bid+'/payments/'+bal,'PUT',{'paid':False}); ok('undoing a payment never moves the deal back', j['booking']['stage']=='balance' and j['booking']['unpaid']=={'EUR':50000})
    pdf='data:application/pdf;base64,'+base64.b64encode(b'%PDF-1.4 test contract').decode()
    st,j,_=a.req('/api/hq/bookings/'+bid+'/files','POST',{'name':'kontrat "PAWSA".pdf','kind':'contract','dataUrl':pdf}); fid=j['file']['id']
    ok('file stored', st==201 and j['file']['size']==22 and j['file']['kind']=='contract' and '"' not in j['file']['name'], j)
    ok('script file refused', a.req('/api/hq/bookings/'+bid+'/files','POST',{'name':'x.html','dataUrl':'data:text/html;base64,'+base64.b64encode(b'<script>').decode()})[0]==400)
    st,txt,h=a.req('/api/hq/bookings/'+bid+'/files/'+fid,raw=True); ok('file downloads as an attachment', st==200 and txt=='%PDF-1.4 test contract' and 'attachment' in h.get('content-disposition','') and h.get('x-content-type-options')=='nosniff', h.items())
    ok('file is not public', anon.req('/api/hq/bookings/'+bid+'/files/'+fid)[0]==401 and anon.req('/api/public/image/'+fid)[0]==404)
    ok('manager works on bookings', mg.req('/api/hq/bookings/'+bid)[1]['event']['title']=='Gece' and mg.req('/api/hq/bookings/'+bid,'PUT',{'notes':'rider geldi'})[0]==200)
    st,j,_=a.req('/api/hq/bookings'); ok('list carries totals and the event', j['bookings'][0]['eventTitle']=='Gece' and j['bookings'][0]['files']==1 and [x['key'] for x in j['stages']]==['offer','confirmed','contract','deposit','balance','cancelled'], j['bookings'][0])
    acts=[(x['action'],x['target'],x['detail']) for x in a.req('/api/hq/audit')[1]['entries']]
    ok('record: bookings', ('Booking durumunu değiştirdi','PAWSA','Teklif → Onay') in acts and any(x[0]=='Ödemeyi ödendi işaretledi' and 'Depozito' in x[2] for x in acts) and ('Dosya yükledi','PAWSA','kontrat  PAWSA .pdf') in acts, acts[:10])
    st,j,_=a.req('/api/hq/bookings','POST',{'artist':'Blond:ish','stage':'offer','offerExpires':'2020-01-01'}); b2=j['booking']['id']
    ok('summary: offer waiting for an answer', [x['artist'] for x in a.req('/api/hq/summary')[1]['offers']]==['Blond:ish'])

    # ---------- summary ----------
    s3=a.req('/api/hq/summary')[1]; e0=s3['upcoming'][0]
    ok('summary: waiting requests by event', s3['waiting'][0]['title']=='Gece' and s3['waiting'][0]['pending']==1 and s3['pendingRsvps']==1, s3['waiting'])
    ok('summary: countdown and pace', isinstance(e0['daysLeft'],int) and e0['daysLeft']>0 and e0['pace']['last7']==3 and e0['pace']['prev7']==0, e0.get('pace'))
    ok('summary: due tasks', s3['tasks'][0]['title']=='Ses teyidi' and s3['tasks'][0]['late'] is True and s3['overdueTasks']==1, s3['tasks'])
    anon.req('/api/public/hit','POST',{'e':eid,'k':'ticket'}); ok('summary: ticket link clicks of the week', a.req('/api/hq/summary')[1]['upcoming'][0]['pace']['clicks7']==1)

    # ---------- CRM paging ----------
    for i in range(7): a.req('/api/hq/contacts','POST',{'name':'Kişi %02d'%i,'email':'k%d@x.com'%i,'tags':'vip' if i%2 else 'basın'})
    st,j,_=a.req('/api/hq/contacts?limit=4'); ok('page 1', len(j['contacts'])==4 and j['total']==10 and j['matched']==10 and j['next']==4, (j.get('total'),j.get('next')))
    st,j2,_=a.req('/api/hq/contacts?limit=4&offset=8'); ok('last page', len(j2['contacts'])==2 and j2['next'] is None)
    st,j3,_=a.req('/api/hq/contacts?limit=4&tag=vip&q=ki%C5%9Fi'); ok('search and tag run on the server', j3['matched']==3 and {x['name'] for x in j['tags']}>={'vip','basın','rsvp'}, j3.get('matched'))
    ok('old shape still served', len(a.req('/api/hq/contacts')[1]['contacts'])==10)
    cid=j['contacts'][0]['id']; a.req('/api/hq/contacts/'+cid,'PUT',{'name':'Aaa Yeni'}); ok('snapshot follows an edit at once', a.req('/api/hq/contacts?limit=1')[1]['contacts'][0]['name']=='Aaa Yeni')
    anon.req('/api/public/rsvp','POST',{'slug':slug,'name':'Zed Yeni','email':'zed@x.com','consent':True}); ok('snapshot follows a public request', a.req('/api/hq/contacts?limit=1&q=zed')[1]['matched']==1)

    # ---------- backups ----------
    st,j,_=a.req('/api/hq/backups','POST',{}); bk=j['backup']
    ok('backup taken', st==201 and bk['kind']=='manual' and bk['counts']['contacts']==11 and bk['counts']['bookings']==2 and bk['bins']['copied']==1 and 'rate' not in bk['counts'] and 'hits' not in bk['counts'] and 'config' not in bk['counts'], bk)
    st,txt,h=a.req('/api/hq/backups/'+bk['id']+'/download',raw=True); snap=J.loads(txt)
    ok('download: full records, no password hashes, no session key', 'attachment' in h.get('content-disposition','') and any(k.startswith('bookings/') for k in snap['records']) and all(v['pass'] is None for k,v in snap['records'].items() if k.startswith('users/')) and not any(k.startswith('config/') for k in snap['records']))
    # damage the store, then restore
    a.req('/api/hq/bookings/'+bid,'DELETE',{}); a.req('/api/hq/contacts/'+cid,'PUT',{'name':'Bozuk'}); a.req('/api/hq/tasks','POST',{'title':'Sonradan eklendi'}); nb=a.req('/api/hq/bookings','POST',{'artist':'Sonradan'})[1]['booking']['id']
    newm=a.req('/api/hq/team','POST',{'name':'Sonradan Üye','email':'son@x.com','role':'door'})[1]['member']['id']
    ok('file gone with its booking', a.req('/api/hq/bookings/'+bid)[0]==404)
    ok('restore needs the typed confirmation', a.req('/api/hq/backups/'+bk['id']+'/restore','POST',{'step':'begin','confirm':'evet'})[0]==400)
    st,j,_=a.req('/api/hq/backups/'+bk['id']+'/restore','POST',{'step':'begin','confirm':'GERİ YÜKLE'}); ok('restore begins with a safety backup', st==200 and j['safety'] and j['total']>20, j)
    nxt=0; n=0
    while nxt is not None and n<50: nxt=a.req('/api/hq/backups/'+bk['id']+'/restore','POST',{'step':'write','from':nxt})[1]['next']; n+=1
    left=1; n=0
    while left and n<50: left=a.req('/api/hq/backups/'+bk['id']+'/restore','POST',{'step':'prune'})[1]['left']; n+=1
    ok('restore finishes', a.req('/api/hq/backups/'+bk['id']+'/restore','POST',{'step':'finish'})[1].get('ok') is True)
    ok('deleted booking is back with its payments', a.req('/api/hq/bookings/'+bid)[1]['booking']['stage']=='balance')
    ok('its file is back too', a.req('/api/hq/bookings/'+bid+'/files/'+fid,raw=True)[1]=='%PDF-1.4 test contract')
    ok('edited contact is as it was', a.req('/api/hq/contacts/'+cid)[1]['contact']['name']=='Aaa Yeni' and a.req('/api/hq/contacts?limit=1')[1]['contacts'][0]['name']=='Aaa Yeni')
    ok('records made after the backup are gone', a.req('/api/hq/bookings/'+nb)[0]==404 and not any(t['title']=='Sonradan eklendi' for t in a.req('/api/hq/tasks')[1]['tasks']))
    ok('team and the record of actions are left alone', any(x['id']==newm for x in a.req('/api/hq/team')[1]['members']) and any(x['action']=='Yedekten geri yüklemeyi başlattı' for x in a.req('/api/hq/audit')[1]['entries']))
    ok('still signed in, guests intact', a.req('/api/hq/session')[0]==200 and len(a.req('/api/hq/rsvps/'+eid)[1]['rsvps'])==4)
    st,j,_=a.req('/api/hq/backups'); kinds=[x['kind'] for x in j['backups']]; ok('list: manual + safety copy, newest first', kinds==['pre-restore','manual'] and j['scheduled'] is False, kinds)
    # the scheduled run takes one backup a day
    import subprocess
    env=dict(os.environ, HQ_LOCAL_STORE=ROOT+'/.data', HQ_ADMIN_EMAIL='admin@example.com', HQ_ADMIN_PASSWORD='test-password-123')
    run=lambda: subprocess.run(['node','-e',"import('./netlify/functions/cron.mjs').then(m=>m.default(new Request('http://x/'),{deploy:{context:'production'}})).then(()=>console.log('done'))"],cwd=ROOT,env=env,capture_output=True,text=True).stdout
    o1=run(); o2=run()
    # the scheduled run uses the production context; with the local file store both contexts share ./.data
    ok('scheduled run backs up once a day', '"total"' in o1 and '"skipped":true' in o2, (o1,o2))
    if not os.environ.get('BLOBS'): ok('automatic backup is listed', [x['kind'] for x in a.req('/api/hq/backups')[1]['backups']][0]=='auto')
finally:
    srv.terminate(); shutil.rmtree(ROOT+'/.data-backups', ignore_errors=True)
print('\n%d passed, %d failed' % (sum(R), len(R)-sum(R)))
sys.exit(0 if all(R) else 1)
