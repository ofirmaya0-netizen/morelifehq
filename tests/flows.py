# End-to-end checks of the six acceptance flows against the local server (python3 tests/flows.py).
import sys, os, re, json, threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import *
srv=start()
try:
    a=C(); anon=C()
    # --- access control (flow 4, part 2)
    st,t,_=anon.req('/hq',raw=True); ok('anon /hq shows login only', st==200 and 'id="password"' in t and 'vEtkinlik' not in t)
    for p in ['summary','events','contacts','tasks','session','site','seo','utm','marketing','marketing/google','settings','rsvps.csv?event=x','contacts.csv']:
        st,_,_=anon.req('/api/hq/'+p); ok('anon GET /api/hq/'+p+' -> 401', st==401, st)
    st,_,_=anon.req('/api/hq/events','POST',{'title':'x'}); ok('anon POST event -> 401', st==401, st)
    st,_,_=anon.req('/api/hq/checkin','POST',{}); ok('anon check-in -> 401', st==401, st)
    st,_,_=anon.req('/api/hq/login','POST',{'email':'admin@example.com','password':'nope'}); ok('wrong password -> 401', st==401, st)
    st,_,_=anon.req('/api/hq/login','POST',{'email':'admin@example.com','password':''}); ok('e-mail alone is not enough', st==401, st)
    st,_,_=anon.req('/api/hq/summary',headers={'cookie':'hq_s=eyJlIjoiYWRtaW5AZXhhbXBsZS5jb20iLCJ4Ijo5OTk5OTk5OTk5fQ.forged'}); ok('forged cookie -> 401', st==401, st)
    st,_,_=anon.req('/?preview=1'); ok('anon cannot preview drafts (gets live page)', st==200)
    # --- flow 1: login -> create -> preview draft -> publish -> public URL
    st,_,_=a.req('/api/hq/login','POST',{'email':'admin@example.com','password':'test-password-123'}); ok('admin login', st==200 and a.cookie)
    st,j,_=a.req('/api/hq/events','POST',{'title':'Açılış Gecesi','artist':'Test Artist','support':'Warm Up DJ','venue':'Test Venue','city':'Bodrum','date':'2027-06-16','time':'17:00','endDate':'2027-06-17','endTime':'02:00','doors':'16:00','ageLimit':'18+','capacity':3,'description':'A long sunset session by the sea.','ticketUrl':'https://tickets.example.com/x?ref=1','useTickets':True,'useRsvp':True,'imageAlt':'Crowd at sunset'})
    ok('event created as draft', st==201 and j['event']['status']=='draft' and j['event']['slug']=='acilis-gecesi', j); ev=j['event']
    st,t,_=anon.req('/events/acilis-gecesi',raw=True); ok('draft not public', st==404, st)
    st,t,_=anon.req('/events/acilis-gecesi?preview=1',raw=True); ok('anon cannot preview draft', st==404, st)
    st,t,_=a.req('/events/acilis-gecesi?preview=1',raw=True); ok('admin previews draft (noindex)', st==200 and 'Açılış Gecesi' in t and 'noindex' in t and 'Taslak önizleme' in t, st)
    st,j,_=a.req('/api/hq/events/'+ev['id']); ok('publish check lists new URL', j['changes'][0]['type']=='new', j.get('changes'))
    st,j,_=a.req('/api/hq/events/'+ev['id']+'/publish','POST',{}); ok('published', st==200 and j['event']['status']=='published' and j['event']['listed'], j)
    st,t,_=anon.req('/events/acilis-gecesi',raw=True)
    ok('public event URL opens directly', st==200 and '<h1 class="g-title">Açılış Gecesi</h1>' in t and 'Get tickets' in t and 'Europe/Istanbul' not in t and 'Istanbul time' in t, st)
    ok('event JSON-LD in first HTML', '"@type":"MusicEvent"' in t and '"startDate":"2027-06-16T17:00:00+03:00"' in t and 'schema.org/EventScheduled' in t and 'tickets.example.com' in t)
    st,j,_=anon.req('/api/public/events'); ok('listed in public events API', any(e['slug']=='acilis-gecesi' for e in j['events']), j)
    # --- flow 3: SEO draft vs publish, first HTML, sitemap
    st,j,_=a.req('/api/hq/events/'+ev['id'],'PUT',{'seo':{'title':'Opening Night Bodrum | More Life','description':'Custom description for the opening night in Bodrum, with all details you need.'}})
    ok('SEO edit saved as draft (dirty)', st==200 and j['event']['dirty'], j)
    st,t,_=anon.req('/events/acilis-gecesi',raw=True); ok('draft SEO not on public page', 'Opening Night Bodrum' not in t and '<title>Açılış Gecesi — Test Venue, 16 June 2027 | More Life</title>' in t, re.findall('<title>.*?</title>',t))
    st,j,_=a.req('/api/hq/images','POST',{'dataUrl':'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='}); img=j['id']
    a.req('/api/hq/events/'+ev['id'],'PUT',{'seo':{'ogImageId':img}})
    st,j,_=a.req('/api/hq/events/'+ev['id']+'/publish','POST',{})
    st,t,_=anon.req('/events/acilis-gecesi',raw=True)
    ok('published SEO in first HTML', '<title>Opening Night Bodrum | More Life</title>' in t and 'content="Custom description for the opening night' in t and 'og:image" content="https://morelife.events/api/public/image/'+img in t and '<link rel="canonical" href="https://morelife.events/events/acilis-gecesi">' in t, re.findall('<title>.*?</title>',t))
    st,t,_=anon.req('/sitemap.xml',raw=True); ok('sitemap has home + public event', '<loc>https://morelife.events/</loc>' in t and '/events/acilis-gecesi</loc>' in t, t)
    st,t,_=anon.req('/robots.txt',raw=True); ok('robots points to sitemap, blocks hq', 'Sitemap: https://morelife.events/sitemap.xml' in t and 'Disallow: /hq' in t)
    st,j,_=a.req('/api/hq/seo'); row=[r for r in j['rows'] if r['key']=='event:'+ev['id']][0]
    ok('SEO screen shows effective values + source', row['title']=='Opening Night Bodrum | More Life' and row['from']['title']=='custom' and row['from']['canonical']=='default' and row['jsonld']['@type']=='MusicEvent', row)
    # slug change -> 301, no chain
    a.req('/api/hq/events/'+ev['id'],'PUT',{'slug':'opening-night'})
    st,j,_=a.req('/api/hq/events/'+ev['id']); ok('slug change shown before publish', j['changes'] and j['changes'][0]['type']=='moved', j['changes'])
    st,t,_=anon.req('/events/opening-night',raw=True); ok('new slug not live before publish', st==404, st)
    a.req('/api/hq/events/'+ev['id']+'/publish','POST',{'redirect':True})
    st,_,h=anon.req('/events/acilis-gecesi'); ok('old slug 301 -> new', st==301 and h.get('location')=='/events/opening-night', (st,h.get('location')))
    a.req('/api/hq/events/'+ev['id'],'PUT',{'slug':'opening-night-2027'}); a.req('/api/hq/events/'+ev['id']+'/publish','POST',{'redirect':True})
    st,_,h=anon.req('/events/acilis-gecesi'); ok('no redirect chain (first slug -> newest)', h.get('location')=='/events/opening-night-2027', h.get('location'))
    a.req('/api/hq/events/'+ev['id'],'PUT',{'slug':'acilis-gecesi'}); a.req('/api/hq/events/'+ev['id']+'/publish','POST',{'redirect':True})
    st,t,_=anon.req('/events/acilis-gecesi',raw=True); ok('slug reused: page live, no loop', st==200, st)
    # cancelled -> text + structured data agree
    a.req('/api/hq/events/'+ev['id'],'PUT',{'eventStatus':'cancelled'}); a.req('/api/hq/events/'+ev['id']+'/publish','POST',{})
    st,t,_=anon.req('/events/acilis-gecesi',raw=True); ok('cancelled: text + JSON-LD consistent', 'has been cancelled' in t and 'EventCancelled' in t and 'Get tickets' not in t and '"offers"' not in t)
    a.req('/api/hq/events/'+ev['id'],'PUT',{'eventStatus':'scheduled'}); a.req('/api/hq/events/'+ev['id']+'/publish','POST',{})
    # --- flow 2 + 4: private invite -> RSVP -> approve -> QR -> check-in -> second scan
    st,j,_=a.req('/api/hq/events','POST',{'title':'Private Dinner','venue':'Secret','city':'Istanbul','date':'2027-07-01','time':'20:00','capacity':3,'visibility':'private','invite':{'plusOnes':1,'askPhone':'optional','askNote':True},'inviteTitle':'You are invited','inviteText':'Tell us who you are.'})
    pv=j['event']; st,j,_=a.req('/api/hq/events/'+pv['id']+'/publish','POST',{}); pv=j['event']; tok=pv['inviteToken']
    st,t,_=anon.req('/events/private-dinner',raw=True); ok('private event has no public URL', st==404, st)
    st,j,_=anon.req('/api/public/events'); ok('private not in public list', all(e['slug']!='private-dinner' for e in j['events']))
    st,t,_=anon.req('/sitemap.xml',raw=True); ok('private not in sitemap', 'private-dinner' not in t and tok not in t)
    st,t,h=anon.req('/invite?t='+tok,raw=True); ok('invite page opens with key, noindex, no JSON-LD', st==200 and 'You are invited' in t and 'noindex' in t and 'ld+json' not in t and 'Guests with you' in t, st)
    st,t,_=anon.req('/invite?t=wrongkey',raw=True); ok('wrong key -> 404', st==404)
    g={'t':tok,'name':'Ayşe Yılmaz','email':'Ayse@Example.com','phone':'0532 111 22 33','plus':1,'note':'vegan','consent':True,'utm':{'source':'instagram','medium':'social','campaign':'private-dinner-story'}}
    st,j,_=anon.req('/api/public/rsvp','POST',g); ok('RSVP saved', st==200 and j['created'] and j.get('ref'), j)
    st,j,_=anon.req('/api/public/rsvp','POST',g); ok('same person again: no duplicate guest', st==200 and j['created'] is False, j)
    st,j,_=anon.req('/api/public/rsvp','POST',{**g,'email':'cem@example.com','name':'Cem Kaya','phone':'0533 999 88 77','plus':5,'utm':{}}); ok('second guest saved', j['created'])
    st,j,_=anon.req('/api/public/rsvp','POST',{**g,'email':'x@example.com','consent':False}); ok('consent required', st==400)
    st,j,_=anon.req('/api/public/rsvp','POST',{'slug':'private-dinner','name':'X','email':'y@example.com','consent':True}); ok('private event cannot be reached by slug', st==404, st)
    st,j,_=a.req('/api/hq/rsvps/'+pv['id']); rs=j['rsvps']; ok('2 applications, +1 capped at 1', len(rs)==2 and all(r['guests']==2 for r in rs) and j['email']['connected'] is False, rs)
    ayse=[r for r in rs if r['email']=='ayse@example.com'][0]; cem=[r for r in rs if r['email']=='cem@example.com'][0]
    st,j,_=a.req('/api/hq/rsvps/'+pv['id']+'/bulk','POST',{'ids':[ayse['id'],cem['id']],'decision':'approved','dryRun':True}); ok('bulk preview: count + capacity effect', j['count']==2 and j['guests']==4 and j['over'] is True and j['approvedAfter']==4, j)
    st,j,_=a.req('/api/hq/rsvps/'+pv['id']+'/bulk','POST',{'ids':[ayse['id'],cem['id']],'decision':'approved'}); ok('bulk over capacity refused without confirm', st==409 and j.get('overCapacity'), j)
    st,j,_=a.req('/api/hq/rsvps/'+pv['id']+'/'+ayse['id']+'/decision','POST',{'decision':'approved'}); ok('approved -> pass created', st==200 and j['rsvp']['passToken'], j); pt=j['rsvp']['passToken']
    a.req('/api/hq/rsvps/'+pv['id']+'/'+cem['id']+'/decision','POST',{'decision':'waitlist'})
    st,j,_=anon.req('/api/public/pass?t='+pt); ok('pass API valid for approved guest', st==200 and j['pass']['name']=='Ayşe Yılmaz' and j['event']['title']=='Private Dinner', j)
    st,j,_=a.req('/api/hq/checkin','POST',{'token':pt,'eventId':ev['id']}); ok('pass at wrong event rejected', j['result']=='wrong-event', j)
    st,j,_=a.req('/api/hq/checkin','POST',{'token':'nope','eventId':pv['id']}); ok('invalid pass rejected', j['result']=='invalid', j)
    res=[]
    def scan(): res.append(a.req('/api/hq/checkin','POST',{'token':pt,'eventId':pv['id']})[1]['result'])
    th=[threading.Thread(target=scan) for _ in range(6)]; [x.start() for x in th]; [x.join() for x in th]
    ok('6 simultaneous scans -> exactly one entry', sorted(res)==['duplicate']*5+['ok'], res)
    st,j,_=a.req('/api/hq/checkin','POST',{'token':pt,'eventId':pv['id']}); ok('later scan flagged with first entry time', j['result']=='duplicate' and j['rsvp']['checkedInAt'] and j['rsvp']['scanCount']>=2, j)
    st,j,_=a.req('/api/hq/rsvps/'+pv['id']); ok('one check-in counted', j['event']['counts']['checkedIn']==2, j['event']['counts'])
    st,t,_=a.req('/api/hq/rsvps.csv?event='+pv['id']+'&status=approved',raw=True); ok('CSV export honours filter', 'Ayşe Yılmaz' in t and 'Cem Kaya' not in t and 'private-dinner-story' in t, t)
    a.req('/api/hq/rsvps/'+pv['id']+'/'+cem['id']+'/decision','POST',{'decision':'cancelled'})
    old=tok; st,j,_=a.req('/api/hq/events/'+pv['id']+'/invite-token','POST',{}); tok=j['event']['inviteToken']
    st,_,_=anon.req('/invite?t='+old,raw=True); st2,_,_=anon.req('/invite?t='+tok,raw=True); ok('regenerated link: old dead, new works', st==404 and st2==200, (st,st2))
    a.req('/api/hq/events/'+pv['id'],'PUT',{'invite':{'enabled':False}}); st,_,_=anon.req('/invite?t='+tok,raw=True); ok('invite can be closed', st==404, st); a.req('/api/hq/events/'+pv['id'],'PUT',{'invite':{'enabled':True}})
    a.req('/api/hq/events/'+pv['id'],'PUT',{'invite':{'closesAt':'2020-01-01T00:00'}}); st,j,_=anon.req('/api/public/rsvp','POST',{**g,'t':tok,'email':'late@example.com'}); ok('form closes at closing time', st==409, (st,j)); a.req('/api/hq/events/'+pv['id'],'PUT',{'invite':{'closesAt':''}})
    # --- flow 5: UTM link -> attributed RSVP -> counted once
    st,j,_=a.req('/api/hq/utm','POST',{'name':'Story 16 Haziran','eventId':ev['id'],'target':'https://morelife.events/events/acilis-gecesi?ref=abc','source':'Instagram','medium':'social','campaign':'acilis story','content':'story'})
    ok('UTM link built, existing query kept', st==201 and j['link']['url']=='https://morelife.events/events/acilis-gecesi?ref=abc&utm_source=instagram&utm_medium=social&utm_campaign=acilis-story&utm_content=story', j)
    u={'source':'instagram','medium':'social','campaign':'acilis-story','content':'story'}
    anon.req('/api/public/hit','POST',{'e':ev['id'],'k':'view','utm':u}); anon.req('/api/public/hit','POST',{'e':ev['id'],'k':'ticket','utm':u}); anon.req('/api/public/hit','POST',{'e':ev['id'],'k':'view'})
    p={'slug':'acilis-gecesi','name':'Deniz Ak','email':'deniz@example.com','consent':True,'utm':u}
    st,j,_=anon.req('/api/public/rsvp','POST',p); st2,j2,_=anon.req('/api/public/rsvp','POST',p); ok('RSVP from campaign link saved once', j['created'] and j2['created'] is False)
    st,j,_=a.req('/api/hq/marketing?event='+ev['id']); c=[x for x in j['campaigns'] if x['campaign']=='acilis-story']; e0=j['events'][0]
    ok('campaign report: right event + campaign, counted once', len(c)==1 and c[0]['rsvps']==1 and c[0]['name']=='Story 16 Haziran' and c[0]['views']==1 and c[0]['ticketClicks']==1 and e0['rsvps']==1 and e0['views']==2, j)
    ok('unknown source shown as Bilinmiyor', any(x['name']=='Bilinmiyor' and x['views']==1 for x in j['campaigns']), j['campaigns'])
    st,j,_=a.req('/api/hq/marketing/google'); ok('Google: not connected, setup steps, no numbers', j['gsc']['connected'] is False and j['gsc']['steps'] and 'pages' not in j['gsc'] and j['ga4']['connected'] is False, j)
    # --- website: draft / publish / rollback, first HTML
    st,t,_=anon.req('/',raw=True); ok('home: default tags in first HTML', st==200 and '<title>More Life — Event production &amp; talent booking</title>' in t and '"@type":"Organization"' in t and 'rel="canonical" href="https://morelife.events/"' in t, re.findall('<title>.*?</title>',t))
    ok('home: nav + ticket links intact', 'href="#events"' in t and 'data-nav="contact"' in t and 'js/site.js' in t)
    st,j,_=a.req('/api/hq/site/home','PUT',{'content':{'tagline':'Sunset sessions & talent booking','ctaText':'See what is next','ctaHref':'#events'},'seo':{'title':'More Life | Sunset sessions','description':'More Life produces events and books artists across the season, with early ticket news.'}})
    ok('home draft saved', st==200 and j['home']['dirty'], j)
    st,t,_=anon.req('/',raw=True); ok('home draft not public', 'Sunset sessions &amp; talent booking' not in t and 'More Life | Sunset sessions' not in t)
    st,t,_=a.req('/?preview=1',raw=True); ok('home draft preview for admin', 'Sunset sessions &amp; talent booking' in t and 'noindex' in t)
    st,j,_=a.req('/api/hq/site/home/publish','POST',{}); ok('home published, URL reported', j['changed']==['/'] and not j['home']['dirty'] and j['home']['publishedAt'], j)
    st,t,_=anon.req('/',raw=True); ok('home published content + SEO in first HTML', 'data-cms="tagline">Sunset sessions &amp; talent booking</p>' in t and '<title>More Life | Sunset sessions</title>' in t and 'data-cms="cta">See what is next</a>' in t)
    a.req('/api/hq/site/home','PUT',{'content':{'tagline':'Second version'}}); st,j,_=a.req('/api/hq/site/home/publish','POST',{}); v=j['home']['versions'][0]['at']
    st,j,_=a.req('/api/hq/site/home/rollback','POST',{'at':v}); st,t,_=anon.req('/',raw=True); ok('rollback to previous published version', 'Sunset sessions &amp; talent booking' in t and 'Second version' not in t)
    st,j,_=a.req('/api/hq/site/home','PUT',{'content':{'ctaHref':'#nope'}}); a.req('/api/hq/site/home/publish','POST',{}); st,j,_=a.req('/api/hq/seo'); hr=[r for r in j['rows'] if r['key']=='home'][0]
    ok('SEO check flags broken internal link', any(i['code']=='broken-link' for i in hr['issues']), hr['issues']); a.req('/api/hq/site/home','PUT',{'content':{'ctaHref':'#events'}}); a.req('/api/hq/site/home/publish','POST',{})
    # --- CRM + tasks
    st,j,_=a.req('/api/hq/contacts'); cs=j['contacts']; ok('RSVP guests became single contacts', len(cs)==3 and sorted(c['email'] for c in cs)==['ayse@example.com','cem@example.com','deniz@example.com'], cs)
    rows=[{'name':'Ayşe Y.','email':'AYSE@example.com','tags':'vip'},{'name':'Yeni Kişi','email':'yeni@example.com','phone':'+90 555 000 11 22'},{'name':'Yeni Kişi 2','email':'yeni@example.com'},{'name':'','email':'bad'},{'name':'Karışık','email':'cem@example.com','phone':'0532 111 22 33'}]
    st,j,_=a.req('/api/hq/contacts/import','POST',{'rows':rows,'commit':False}); ok('import preview: new/match/dup/invalid/conflict', j['totals']=={'new':1,'match':1,'conflict':1,'duplicateInFile':1,'invalid':1}, j['totals'])
    ok('import preview names the failing lines', [r['line'] for r in j['rows'] if r['status'] in ('invalid','conflict')]==[5,6], [(r['line'],r['status']) for r in j['rows']])
    st,j,_=a.req('/api/hq/contacts/import','POST',{'rows':rows,'commit':True}); st,j2,_=a.req('/api/hq/contacts'); ok('import: no duplicates, conflict not merged', j['created']==1 and len(j2['contacts'])==4 and 'vip' in [c for c in j2['contacts'] if c['email']=='ayse@example.com'][0]['tags'], j)
    aid=[c for c in j2['contacts'] if c['email']=='ayse@example.com'][0]['id']; st,j,_=a.req('/api/hq/contacts/'+aid); ok('contact card shows event history with check-in', j['history'] and j['history'][0]['event']=='Private Dinner' and j['history'][0]['checkedInAt'], j['history'])
    st,t,_=a.req('/api/hq/contacts.csv?tag=vip',raw=True); ok('contacts CSV uses active filter', 'ayse@example.com' in t and 'yeni@example.com' not in t)
    st,j,_=a.req('/api/hq/tasks','POST',{'title':'Ses sistemi','eventId':ev['id'],'assignee':'Can','due':'2020-01-01','priority':'high'}); ok('task with event, assignee, priority', st==201 and j['task']['priority']=='high')
    st,j,_=a.req('/api/hq/summary'); ok('summary counters', j['overdueTasks']==1 and len(j['upcoming'])==2 and j['approvedGuests']==2 and j['pendingRsvps']==1, j)
    st,j,_=a.req('/api/hq/settings'); ok('settings: env names only, integrations honest', j['env']['HQ_ADMIN_EMAIL'] is True and j['integrations']['email']['connected'] is False and j['schema']['version']==j['schema']['expected'] and 'test-password' not in json.dumps(j), j)
    # --- guest API leaks nothing
    st,j,_=anon.req('/api/public/events'); ok('public API exposes no guest or admin data', 'inviteToken' not in json.dumps(j) and 'capacity' not in json.dumps(j) and 'counts' not in json.dumps(j))
    a.req('/api/hq/logout','POST',{}); st,_,_=a.req('/api/hq/summary',headers={'cookie':''}); a.cookie=''; st,_,_=a.req('/api/hq/summary'); ok('after logout -> 401', st==401, st)
finally:
    srv.terminate()
print(sum(R),'/',len(R),'passed'); print(open('/tmp/dev.err').read()[-1500:])
sys.exit(0 if all(R) else 1)
