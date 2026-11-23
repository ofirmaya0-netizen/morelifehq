# Door-staff link, archive import and the GA4 tag (python3 tests/door_import_ga.py).
import sys, os, json, threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ['GA4_MEASUREMENT_ID']='G-TEST12345'
from harness import *
srv=start()
try:
    a=C(); anon=C(); a.req('/api/hq/login','POST',{'email':'admin@example.com','password':'test-password-123'})
    st,j,_=a.req('/api/hq/events','POST',{'title':'Door Night','venue':'V','date':'2027-06-16','time':'17:00','visibility':'private'}); ev=j['event']; st,j,_=a.req('/api/hq/events/'+ev['id']+'/publish','POST',{}); tok=j['event']['inviteToken']
    st,j,_=a.req('/api/hq/events','POST',{'title':'Other Night','venue':'V','date':'2027-06-17','time':'17:00'}); ev2=j['event']; a.req('/api/hq/events/'+ev2['id']+'/publish','POST',{})
    for n,em,ph in [('Ayşe Yılmaz','ayse@example.com','0532 111 22 33'),('Cem Kaya','cem@example.com','')]:
        anon.req('/api/public/rsvp','POST',{'t':tok,'name':n,'email':em,'phone':ph,'note':'secret note','consent':True})
    anon.req('/api/public/rsvp','POST',{'slug':ev2['slug'],'name':'Other Guest','email':'o@example.com','consent':True})
    st,j,_=a.req('/api/hq/rsvps/'+ev['id']); rs=j['rsvps']; ay=[r for r in rs if r['email']=='ayse@example.com'][0]; cem=[r for r in rs if r['email']=='cem@example.com'][0]
    st,j,_=a.req('/api/hq/rsvps/'+ev['id']+'/'+ay['id']+'/decision','POST',{'decision':'approved'}); pt=j['rsvp']['passToken']
    st,j,_=a.req('/api/hq/rsvps/'+ev2['id']); og=j['rsvps'][0]; st,j,_=a.req('/api/hq/rsvps/'+ev2['id']+'/'+og['id']+'/decision','POST',{'decision':'approved'}); pt2=j['rsvp']['passToken']
    # door link
    st,t,_=anon.req('/door?k=x',raw=True); ok('door page is a shell with no guest data', st==200 and 'Ayşe' not in t and 'noindex' in t)
    st,j,_=anon.req('/api/door/list',headers={'x-door':'nope'}); ok('door API rejects unknown key', st==401, st)
    st,j,_=anon.req('/api/door/list'); ok('door API rejects missing key', st==401, st)
    st,j,_=anon.req('/api/hq/events/'+ev['id']+'/door-link','POST',{}); ok('anon cannot create door link', st==401, st)
    st,j,_=a.req('/api/hq/events/'+ev['id']+'/door-link','POST',{}); k=j['event']['doorUrl'].split('k=')[1]; ok('admin creates door link', len(k)>=24)
    D={'x-door':k}
    st,j,_=anon.req('/api/door/list',headers=D); txt=json.dumps(j,ensure_ascii=False)
    ok('door list: approved guests of this event only, names + party size only', st==200 and [g['name'] for g in j['guests']]==['Ayşe Yılmaz'] and 'example.com' not in txt and '0532' not in txt and 'secret note' not in txt and 'passToken' not in txt and 'Other Guest' not in txt, txt)
    for p in ['summary','events','contacts','rsvps/'+ev['id'],'rsvps.csv?event='+ev['id']]:
        st,_,_=anon.req('/api/hq/'+p,headers=D); ok('door key opens no HQ API: '+p, st==401, st)
    st,j,_=anon.req('/api/door/checkin','POST',{'token':pt2},headers=D); ok('door: other event pass rejected', j['result']=='wrong-event', j)
    st,j,_=anon.req('/api/door/checkin','POST',{'rsvpId':og['id']},headers=D); ok('door: cannot check in another event guest by id', j['result']=='invalid', j)
    st,j,_=anon.req('/api/door/checkin','POST',{'rsvpId':cem['id']},headers=D); ok('door: unapproved guest refused, no contact data', j['result']=='not-approved' and 'example.com' not in json.dumps(j), j)
    res=[]
    def scan(i): res.append((anon if i%2 else a).req('/api/door/checkin' if i%2 else '/api/hq/checkin','POST',{'token':pt,'eventId':ev['id']},headers=D if i%2 else None)[1]['result'])
    th=[threading.Thread(target=scan,args=(i,)) for i in range(6)]; [x.start() for x in th]; [x.join() for x in th]
    ok('door + HQ scanning together: exactly one entry', sorted(res)==['duplicate']*5+['ok'], res)
    st,j,_=anon.req('/api/door/checkin','POST',{'token':pt},headers=D); ok('door: duplicate shows first entry time, no e-mail', j['result']=='duplicate' and j['rsvp']['checkedInAt'] and 'email' not in j['rsvp'], j)
    st,j,_=a.req('/api/hq/events/'+ev['id']+'/door-link','POST',{}); k2=j['event']['doorUrl'].split('k=')[1]; st,_,_=anon.req('/api/door/list',headers=D); st2,_,_=anon.req('/api/door/list',headers={'x-door':k2}); ok('renewed: old key dead, new works', st==401 and st2==200, (st,st2))
    a.req('/api/hq/events/'+ev['id']+'/door-link','POST',{'close':True}); st,_,_=anon.req('/api/door/list',headers={'x-door':k2}); ok('closed door link stops working', st==401, st)
    a.req('/api/hq/events/'+ev['id']+'/door-link','POST',{}); st,j,_=a.req('/api/hq/events/'+ev['id']); k3=j['event']['doorUrl'].split('k=')[1]; a.req('/api/hq/events/'+ev['id']+'/status','POST',{'status':'draft'}); st,_,_=anon.req('/api/door/list',headers={'x-door':k3}); ok('door link dead when event is unpublished', st==401, st)
    # archive import
    st,j,_=anon.req('/api/hq/import-site-events','POST',{}); ok('anon cannot import', st==401, st)
    st,j,_=a.req('/api/hq/import-site-events','POST',{}); ok('12 archive events imported', j['created']==12 and j['skipped']==0, j)
    st,j,_=a.req('/api/hq/import-site-events','POST',{}); ok('second import creates nothing', j['created']==0 and j['skipped']==12, j)
    st,t,_=anon.req('/events/pawsa',raw=True); ok('imported event has a public page + JSON-LD, no RSVP form', st==200 and '<h1 class="g-title">PAWSA</h1>' in t and '2025-07-19T17:30:00+03:00' in t and 'Lucca Beach' in t and 'g-form' not in t, st)
    st,t,_=anon.req('/sitemap.xml',raw=True); ok('sitemap lists imported events', t.count('<loc>')==1+1+12, t.count('<loc>'))
    st,j,_=anon.req('/api/public/events'); st2,j2,_=anon.req('/api/public/events?scope=all'); ok('upcoming list excludes past; scope=all includes them', len(j['events'])==1 and len(j2['events'])==13, (len(j['events']),len(j2['events'])))
    # GA4 tag
    st,t,_=anon.req('/',raw=True); ok('GA tag on home when configured, behind consent loader', 'window.ML_GA="G-TEST12345"' in t and '/js/consent.js' in t and 'googletagmanager' not in t)
    st,t,_=anon.req('/events/pawsa',raw=True); ok('GA tag on public event page', 'G-TEST12345' in t)
    a.req('/api/hq/events/'+ev['id']+'/publish','POST',{}); st,t,_=anon.req('/invite?t='+tok,raw=True); ok('no GA on invite page', st==200 and 'G-TEST12345' not in t and 'consent.js' not in t)
    st,t,_=anon.req('/pass?t='+pt,raw=True); ok('no GA on pass page', 'G-TEST' not in t and 'consent.js' not in t)
    st,t,_=anon.req('/js/consent.js',raw=True); ok('consent script served', st==200 and 'doNotTrack' in t)
finally:
    srv.terminate()
print(sum(R),'/',len(R),'passed'); sys.exit(0 if all(R) else 1)
