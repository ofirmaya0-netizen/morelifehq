# Venue portal: one private link per venue, showing who is coming and who has a table (python3 tests/venue_portal.py).
import sys, os, json, threading, http.server, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
MAIL=[]
class Mock(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        MAIL.append(json.loads(self.rfile.read(int(self.headers['content-length'])))); self.send_response(202); self.end_headers(); self.wfile.write(b'{"id":"m1"}')
    def log_message(self,*a): pass
m=http.server.ThreadingHTTPServer(('127.0.0.1',8994),Mock); threading.Thread(target=m.serve_forever,daemon=True).start()
os.environ.update(RESEND_API_KEY='re', EMAIL_FROM='rsvp@example.com', EMAIL_API_URL='http://127.0.0.1:8994/emails')
from harness import *
srv=start()
try:
    a=C(); anon=C(); a.req('/api/hq/login','POST',{'email':'admin@example.com','password':'test-password-123'})
    def event(title, venue, date, publish=True):
        e=a.req('/api/hq/events','POST',{'title':title,'venue':venue,'city':'Bodrum','date':date,'time':'17:00','doors':'16:00','visibility':'public'})[1]['event']
        return a.req('/api/hq/events/'+e['id']+'/publish','POST',{})[1]['event'] if publish else e
    e1=event('Sunset One','Lucca Beach','2027-07-10'); e2=event('Sunset Two','LUCCA  beach','2027-07-17'); other=event('Elsewhere','Before Sunset','2027-07-11'); draft=event('Draft Night','Lucca Beach','2027-07-20',False); past=event('Long Ago','Lucca Beach','2024-07-10')

    # ---------- the link ----------
    st,j,_=anon.req('/api/hq/venue-links?venue=Lucca%20Beach'); ok('anon cannot read venue links', st==401, st)
    st,j,_=a.req('/api/hq/venue-links?venue=Lucca%20Beach'); ok('no link yet; two current events at the venue', st==200 and j['link'] is None and j['events']==2, j)
    ok('a link needs a venue name', a.req('/api/hq/venue-links','POST',{'venue':'  '})[0]==400)
    st,j,_=a.req('/api/hq/venue-links','POST',{'venue':'Lucca Beach'}); url=j['link']['url']; key=url.split('k=')[1]
    ok('link made', st==201 and url.startswith('/venue?k=') and len(key)>=24 and j['link']['events']==2, j)
    ok('found again under another spelling of the venue', a.req('/api/hq/venue-links?venue=lucca%20BEACH')[1]['link']['url']==url)
    ok('listed', [x['venue'] for x in a.req('/api/hq/venue-links')[1]['links']]==['Lucca Beach'])
    st,h,hd=anon.req('/venue?k='+key,raw=True); ok('portal page is served', st==200 and 'api/public/venue' in h)
    ok('robots keeps the portal out of search', 'Disallow: /venue' in anon.req('/robots.txt',raw=True)[1])
    ok('a wrong key opens nothing', anon.req('/api/public/venue?k=nope')[0]==404 and anon.req('/api/public/venue')[0]==404)
    P='/api/public/venue?k='+key
    st,j,hd=anon.req(P); ok('only this venue’s published, current events, soonest first', st==200 and j['venue']=='Lucca Beach' and [x['title'] for x in j['events']]==['Sunset One','Sunset Two'] and j['event']['id']==e1['id'] and hd.get('cache-control')=='no-store', j)
    ok('empty event: zero counts', j['events'][0]['counts']=={'tables':0,'tablePeople':0,'list':0,'tickets':0,'in':0,'expected':0} and j['event']['tables']==[] and j['event']['guests']==[], j['events'][0])

    # ---------- guest list ----------
    a.req('/api/hq/events/'+e1['id'],'PUT',{'invite':{'plusOnes':3}})
    for n,em,plus in [('Ayşe Yılmaz','ayse@example.com',2),('Bekleyen Kişi','bek@example.com',0),('Reddedilen Kişi','red@example.com',0)]:
        anon.req('/api/public/rsvp','POST',{'slug':e1['slug'],'name':n,'email':em,'phone':'+90 532 111 22 33','note':'gizli not','plus':plus,'consent':True})
    rs={r['email']:r for r in a.req('/api/hq/rsvps/'+e1['id'])[1]['rsvps']}; base='/api/hq/rsvps/'+e1['id']+'/'
    a.req(base+rs['ayse@example.com']['id']+'/decision','POST',{'decision':'approved'}); a.req(base+rs['red@example.com']['id']+'/decision','POST',{'decision':'rejected'})
    j=anon.req(P)[1]; g=j['event']['guests']
    ok('approved guest only, with party size', g==[{'name':'Ayşe Yılmaz','people':3,'in':0,'list':True}] and j['events'][0]['counts']['list']==3, g)
    raw=anon.req(P,raw=True)[1]; ok('no e-mail, phone, note or pass key leaves the server', 'example.com' not in raw and '532' not in raw and 'gizli' not in raw and 'passToken' not in raw and 'token' not in raw)

    # ---------- tickets and tables ----------
    T='/api/hq/tickets/'+e1['id']
    ga=a.req(T+'/types','POST',{'name':'General','price':1000,'stock':50})[1]['type']['id']
    lo=a.req(T+'/types','POST',{'name':'Backstage','price':30000,'max':2})[1]['type']['id']
    dp=a.req(T+'/types','POST',{'name':'Masa (4 kişi)','price':20000,'stock':3,'admits':4,'deposit':5000})[1]['type']['id']
    tb={x['label']:x for x in a.req(T+'/map','PUT',{'tables':[{'label':'B2','typeId':lo,'seats':6,'x':100,'y':100},{'label':'B10','typeId':lo,'seats':4,'x':300,'y':100}]})[1]['map']['tables']}
    a.req(T+'/shop','PUT',{'enabled':True})
    st,c1,_=a.req(T+'/orders','POST',{'channel':'comp','typeId':ga,'qty':2,'name':'Basın Listesi'}); ok('comp tickets issued', st==201, c1)
    st,c2,_=a.req(T+'/orders','POST',{'channel':'comp','typeId':lo,'tableId':tb['B10']['id'],'name':'Sponsor Masası'}); ok('comp table issued', st==201, c2)
    a.req(T+'/orders','POST',{'channel':'comp','typeId':lo,'tableId':tb['B2']['id'],'name':'Deniz Kaya'})
    a.req('/api/hq/tickets/settings','PUT',{'provider':'test','feeMode':'buyer','feePct':10,'feeFixed':0})
    st,j,_=anon.req('/api/public/checkout','POST',{'slug':e1['slug'],'items':[{'typeId':dp,'qty':1}],'name':'Depozito Masası','email':'dep@example.com','terms':True}); tok=j['url'].split('=')[-1]
    r=urllib.request.Request(B+'/api/public/pay/test?o='+tok,data=b'result=ok',method='POST',headers={'content-type':'application/x-www-form-urlencoded'})
    class NoRedir(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*a,**k): return None
    try: urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedir).open(r)
    except urllib.error.HTTPError: pass
    ok('deposit table bought', anon.req('/api/public/order?t='+tok)[1]['order']['status']=='paid')
    j=anon.req(P)[1]; ev=j['event']; c=j['events'][0]['counts']
    ok('mapped tables: label, area, holder, seats; ordered B2 before B10', [(t['label'],t['area'],t['name'],t['people'],t['in']) for t in ev['tables'] if t['label']]==[('B2','Backstage','Deniz Kaya',6,0),('B10','Backstage','Sponsor Masası',4,0)], ev['tables'])
    dt=[t for t in ev['tables'] if not t['label']]
    ok('a table sold by number: one row for its four seats, with what is still due at the venue', dt==[{'label':'','area':'Masa (4 kişi)','name':'Depozito Masası','people':4,'in':0,'due':15000,'currency':'TRY'}], dt)
    ok('single tickets are on the guest list, one row per order and name', [x for x in ev['guests'] if not x.get('list')]==[{'name':'Basın Listesi','people':2,'in':0,'type':'General'}], ev['guests'])
    ok('counts add up', c['tickets']==2 and c['list']==3 and c['tablePeople']==sum(t['people'] for t in ev['tables']) and c['expected']==c['tablePeople']+5 and c['in']==0, c)

    # ---------- check-in shows up ----------
    tid=c2['tickets'][0]['id']; st,j,_=a.req('/api/hq/checkin','POST',{'eventId':e1['id'],'rsvpId':'tk-'+tid}); ok('one seat of B10 checked in', st==200 and j['result']=='ok', j)
    a.req('/api/hq/checkin','POST',{'eventId':e1['id'],'rsvpId':rs['ayse@example.com']['id']})
    j=anon.req(P)[1]; b10=[t for t in j['event']['tables'] if t['label']=='B10'][0]
    ok('arrivals: 1 / 4 at the table, the guest and her +2 are in', b10['in']==1 and j['event']['guests'][0]['in']==3 and j['events'][0]['counts']['in']==4, j['events'][0]['counts'])

    # ---------- a table asked for on the table page ----------
    st,_,_=anon.req('/api/public/enquiries','POST',{'kind':'table','name':'Masa İsteyen','email':'mi@example.com','phone':'+90 532 111 22 44','party':8,'area':'backstage','eventId':e1['id']}); ok('table request made', st==200, st)
    q=[x for x in a.req('/api/hq/enquiries')[1]['enquiries'] if x['kind']=='table'][0]
    ok('an unconfirmed request is not shown to the venue', not [t for t in anon.req(P)[1]['event']['tables'] if t.get('request')])
    st,j,_=a.req('/api/hq/enquiries/'+q['id']+'/confirm','POST',{'party':7,'area':'backstage'}); ok('request confirmed', st==200 and j['confirmed'], j)
    hl=[t for t in anon.req(P)[1]['event']['tables'] if t.get('request')]
    ok('a confirmed one is: held by name, confirmed party and area', hl==[{'label':'','area':'backstage','name':'Masa İsteyen','people':7,'in':None,'request':True}], hl)

    # ---------- the other event, the other venue ----------
    j=anon.req(P+'&e='+e2['id'])[1]; ok('second event can be picked; it has its own (empty) lists', j['event']['id']==e2['id'] and j['event']['tables']==[] and j['event']['guests']==[], j['event'])
    ok('an event of another venue cannot be picked through this key', anon.req(P+'&e='+other['id'])[1]['event']['id']==e1['id'])
    ok('unpublishing takes the event off the portal', a.req('/api/hq/events/'+e2['id']+'/status','POST',{'status':'draft'})[0]==200 and [x['title'] for x in anon.req(P)[1]['events']]==['Sunset One'])

    # ---------- renew, close, roles, log ----------
    st,j,_=a.req('/api/hq/venue-links','POST',{'venue':'lucca beach'}); new=j['link']['url'].split('k=')[1]
    ok('renewed: the old key is dead, the new one works', st==201 and j['renewed'] and new!=key and anon.req(P)[0]==404 and anon.req('/api/public/venue?k='+new)[0]==200)
    st,j,_=a.req('/api/hq/team','POST',{'name':'Kapı Görevlisi','email':'kapi@example.com','role':'door'}); d=C()
    d.req('/api/hq/setup','POST',{'t':j['setupUrl'].split('kur=')[1],'password':'door-password-123'}); d.req('/api/hq/login','POST',{'email':'kapi@example.com','password':'door-password-123'})
    ok('the door role is signed in but cannot read or make venue links', d.req('/api/hq/session')[1].get('role')=='door' and d.req('/api/hq/venue-links')[0]==403 and d.req('/api/hq/venue-links','POST',{'venue':'Lucca Beach'})[0]==403)
    st,j,_=a.req('/api/hq/venue-links','POST',{'venue':'Lucca Beach','close':True}); ok('closed: nothing opens', st==200 and j['closed'] and anon.req('/api/public/venue?k='+new)[0]==404 and a.req('/api/hq/venue-links?venue=Lucca%20Beach')[1]['link'] is None)
    log=[x['action'] for x in a.req('/api/hq/audit')[1].get('entries',a.req('/api/hq/audit')[1].get('items',[]))]
    ok('making, renewing and closing are in the record of actions', all(any(w in x for x in log) for w in ['linki oluşturdu','linkini yeniledi','linkini kapattı']), log[:8])
    st,h,_=a.req('/hq',raw=True); ok('HQ bundle carries the venue portal card', 'Mekân portalı' in h and 'venue-links' in h)
finally:
    srv.terminate()
print(sum(R),'/',len(R),'passed'); sys.exit(0 if all(R) else 1)
