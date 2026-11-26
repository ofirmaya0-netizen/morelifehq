# The venue's floor plan and who sits where at an event (python3 tests/floor_plan.py).
import sys, os, json, threading, http.server
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
class Mock(http.server.BaseHTTPRequestHandler):
    def do_POST(self): self.rfile.read(int(self.headers['content-length'])); self.send_response(202); self.end_headers(); self.wfile.write(b'{"id":"m1"}')
    def log_message(self,*a): pass
m=http.server.ThreadingHTTPServer(('127.0.0.1',8993),Mock); threading.Thread(target=m.serve_forever,daemon=True).start()
os.environ.update(RESEND_API_KEY='re', EMAIL_FROM='rsvp@example.com', EMAIL_API_URL='http://127.0.0.1:8993/emails')
from harness import *
srv=start()
try:
    a=C(); anon=C(); a.req('/api/hq/login','POST',{'email':'admin@example.com','password':'test-password-123'})
    def event(title, venue):
        e=a.req('/api/hq/events','POST',{'title':title,'venue':venue,'city':'Istanbul','date':'2027-12-20','time':'22:00','visibility':'public'})[1]['event']
        a.req('/api/hq/events/'+e['id'],'PUT',{'invite':{'plusOnes':3}}); return a.req('/api/hq/events/'+e['id']+'/publish','POST',{})[1]['event']
    e1=event("Santa's Guestlist",'ALICE Club'); e2=event('Another Night','Alice'); other=event('Elsewhere','Some Rooftop')
    P='/api/hq/venue-links/plan'
    ok('anon cannot read a plan', anon.req(P+'?event='+e1['id'])[0]==401)
    st,j,_=a.req(P+'?event='+other['id']); ok('a venue without a plan has none', st==200 and j['plan'] is None, j)
    st,j,_=a.req(P+'?event='+e1['id']); ts=[s for s in j['plan']['shapes'] if s['k']=='table']
    ok('Alice has its plan whatever the spelling of the venue', st==200 and j['plan']['name']=='Alice Club' and a.req(P+'?event='+e2['id'])[1]['plan']['name']=='Alice Club')
    ok('the tables: Table 1–8, Sol, Sağ, Back 1–5, Sedir 1–6 and Son, Paris', sorted(s['label'] for s in ts)==sorted(['Table 1','Table 2','Table 3','Table 4','Table 5','Table 6','Table 7','Table 8','Table Sol','Table Sağ','Back 1','Back 2','Back 3','Back 4','Back 5','Sedir 1','Sedir 2','Sedir 3','Sedir 4','Sedir 5','Sedir 6','Sedir Son','Paris']) and len({s['id'] for s in ts})==23, [s['label'] for s in ts])
    ok('Kabin is drawn but is not a table; the bar and the DJ booth are scenery', {s['label'] for s in j['plan']['shapes'] if s['k']=='seat'}=={'Kabin'} and {s['label'] for s in j['plan']['shapes'] if s['k']=='fix' and s['label']}>={'BAR','DJ','Konsol'})
    ok('every shape lies inside the drawing', all(0<=s['x'] and 0<=s['y'] and s['x']+s['w']<=j['plan']['w']+1 and s['y']+s['h']<=j['plan']['h']+1 for s in j['plan']['shapes']))
    ok('nobody is seated, nobody to seat yet', all(v==[] for v in j['assign'].values()) and len(j['assign'])==23 and j['options']==[])

    for n,em,pl in [('Ada Yılmaz','ada@x.com',2),('Cem Bekleyen','cem@x.com',1)]: anon.req('/api/public/rsvp','POST',{'slug':e1['slug'],'name':n,'email':em,'plus':pl,'consent':True})
    rs={r['email']:r for r in a.req('/api/hq/rsvps/'+e1['id'])[1]['rsvps']}; a.req('/api/hq/rsvps/'+e1['id']+'/'+rs['ada@x.com']['id']+'/decision','POST',{'decision':'approved'})
    N='/api/hq/venue-links/notes'; mk=a.req(N,'POST',{'event':e1['id'],'name':'Kerem Öztürk','people':6,'label':'B4','note':'Doğum günü'})[1]['table']['key']; bk=a.req(N,'POST',{'event':e1['id'],'name':'Bora Kaya','people':4})[1]['table']['key']
    anon.req('/api/public/enquiries','POST',{'kind':'table','name':'Selin Talep','email':'s@x.com','phone':'+90 532 111 22 44','party':5,'area':'backstage','eventId':e1['id']})
    qid=[x for x in a.req('/api/hq/enquiries')[1]['enquiries'] if x['kind']=='table'][0]['id']
    j=a.req(P+'?event='+e1['id'])[1]; ok('only table reservations can be seated: no single guests, no request that is still waiting', [(o['type'],o['name'],o['people'],o['src']) for o in j['options']]==[('table','Bora Kaya',4,'Elle eklenen'),('table','Kerem Öztürk',6,'Elle eklenen')] and j['options'][1]['note']=='Doğum günü', j['options'])
    a.req('/api/hq/enquiries/'+qid+'/confirm','POST',{'party':5,'area':'backstage'}); j=a.req(P+'?event='+e1['id'])[1]; sk=[o for o in j['options'] if o['name']=='Selin Talep'][0]
    ok('a confirmed table request is a reservation too', sk['src']=='Onaylı masa talebi' and sk['people']==5 and len(j['options'])==3, j['options'])
    put=lambda **b: a.req(P,'PUT',dict({'event':e1['id']},**b)); T=lambda k: {'type':'table','id':k}
    ok('a guest cannot be seated on the plan, approved or not', put(table='table-1',add={'type':'rsvp','id':rs['ada@x.com']['id']})[0]==400 and put(table='table-1',add={'type':'rsvp','id':rs['cem@x.com']['id']})[0]==400)
    ok('must be a table of the plan and a reservation of this event', put(table='kabin',add=T(mk))[0]==404 and put(table='table-1',add=T('m-nope'))[0]==404 and put(table='table-1')[0]==400)
    st,j,_=put(table='table-3',add=T(mk)); ok('a reservation is seated', st==200 and [(o['name'],o['people']) for o in j['assign']['table-3']]==[('Kerem Öztürk',6)], j['assign'])
    st,j,_=put(table='table-3',add=T(bk)); ok('two reservations can share a table', [o['name'] for o in j['assign']['table-3']]==['Kerem Öztürk','Bora Kaya'])
    st,j,_=put(table='sedir-3',add=T(mk)); ok('seating it again moves it; sofa and back tables take reservations like any other', [o['name'] for o in j['assign']['sedir-3']]==['Kerem Öztürk'] and [o['name'] for o in j['assign']['table-3']]==['Bora Kaya'] and put(table='back-2',add=T(sk['id']))[1]['assign']['back-2'][0]['name']=='Selin Talep')
    ok('the other event at the same venue has its own seating', all(v==[] for v in a.req(P+'?event='+e2['id'])[1]['assign'].values()))

    # ---------- where it shows ----------
    tb={t['name']:t for t in a.req(N+'?event='+e1['id'])[1]['tables']}; ok('the table list carries the plan table instead of the hand-typed number', tb['Kerem Öztürk']['label']=='Sedir 3' and tb['Kerem Öztürk']['placed'] is True and tb['Kerem Öztürk']['note']=='Doğum günü' and tb['Bora Kaya']['label']=='Table 3' and tb['Selin Talep']['label']=='Back 2', tb)
    key2=a.req('/api/hq/venue-links','POST',{'venue':'ALICE Club'})[1]['link']['url'].split('k=')[1]; pj=anon.req('/api/public/venue?k='+key2)[1]
    ok('the venue sees the plan table on each reservation; guests carry no table', sorted(t['label'] for t in pj['event']['tables'])==['Back 2','Sedir 3','Table 3'] and all('table' not in g for g in pj['event']['guests']), pj['event'])
    ov={v['venue']:v for v in a.req('/api/hq/venue-links/overview')[1]['venues']}; ok('Mekânlar shows which venues have a plan', ov['ALICE Club']['plan']=={'name':'Alice Club','tables':23} and ov['Some Rooftop']['plan'] is None, ov['ALICE Club'].get('plan'))

    # ---------- removing ----------
    st,j,_=put(remove=T(bk)); ok('removed from the table', st==200 and j['assign']['table-3']==[])
    st,j,_=put(table='back-2',clear=True); ok('a table can be emptied', j['assign']['back-2']==[])
    a.req(N,'DELETE',{'event':e1['id'],'key':mk}); ok('a reservation that was deleted leaves the plan', a.req(P+'?event='+e1['id'])[1]['assign']['sedir-3']==[])

    # ---------- roles, log, bundle ----------
    st,j,_=a.req('/api/hq/team','POST',{'name':'Kapı','email':'kapi@example.com','role':'door'}); d=C(); d.req('/api/hq/setup','POST',{'t':j['setupUrl'].split('kur=')[1],'password':'door-password-123'}); d.req('/api/hq/login','POST',{'email':'kapi@example.com','password':'door-password-123'})
    ok('the door role can neither read nor change the seating', d.req(P+'?event='+e1['id'])[0]==403 and d.req(P,'PUT',{'event':e1['id'],'table':'table-1','clear':True})[0]==403)
    log=[x['action'] for x in a.req('/api/hq/audit')[1].get('entries',a.req('/api/hq/audit')[1].get('items',[]))]
    ok('seating is in the record of actions', all(any(w in x for x in log) for w in ['Masaya oturttu','Masadan kaldırdı','Masayı boşalttı']), log[:10])
    st,h,_=a.req('/hq',raw=True); ok('HQ bundle carries the plan', 'fp-table' in h and 'venue-links/plan' in h and 'Masa planı · ' in h and 'fp-chip' in h and 'fp-unseat' in h and 'Oturtulmamış rezervasyon' in h)
finally:
    srv.terminate()
print(sum(R),'/',len(R),'passed'); sys.exit(0 if all(R) else 1)
