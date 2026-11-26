# The venue's floor plan and who sits where at an event (python3 tests/floor_plan.py).
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
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
    ok('the ten tables of the drawing (its “Launch” shapes) are named Table', sorted(s['label'] for s in ts)==sorted(['Table 1','Table 2','Table 3','Table 4','Table 5','Table 6','Table 7','Table 8','Table Sol','Table Sağ']) and len({s['id'] for s in ts})==10, [s['label'] for s in ts])
    ok('the other seating is drawn but is not a table; the bar and the DJ booth are scenery', {s['label'] for s in j['plan']['shapes'] if s['k']=='seat'}>={'Back 1','Back 5','Sedir 1','Sedir Son','Paris','Kabin'} and {s['label'] for s in j['plan']['shapes'] if s['k']=='fix' and s['label']}>={'BAR','DJ','Konsol'})
    ok('every shape lies inside the drawing', all(0<=s['x'] and 0<=s['y'] and s['x']+s['w']<=j['plan']['w']+1 and s['y']+s['h']<=j['plan']['h']+1 for s in j['plan']['shapes']))
    ok('nobody is seated, nobody to seat yet', all(v==[] for v in j['assign'].values()) and len(j['assign'])==10 and j['options']==[])

    for n,em,pl in [('Ada Yılmaz','ada@x.com',2),('Bora Kaya','bora@x.com',0),('Cem Bekleyen','cem@x.com',1)]: anon.req('/api/public/rsvp','POST',{'slug':e1['slug'],'name':n,'email':em,'plus':pl,'consent':True})
    rs={r['email']:r for r in a.req('/api/hq/rsvps/'+e1['id'])[1]['rsvps']}
    for em in ['ada@x.com','bora@x.com']: a.req('/api/hq/rsvps/'+e1['id']+'/'+rs[em]['id']+'/decision','POST',{'decision':'approved'})
    mk=a.req('/api/hq/venue-links/notes','POST',{'event':e1['id'],'name':'Kerem Öztürk','people':6,'label':'B4','note':'Doğum günü'})[1]['table']['key']
    j=a.req(P+'?event='+e1['id'])[1]; ok('approved guests and the event’s tables can be seated; pending ones cannot', [(o['type'],o['name'],o['people']) for o in j['options']]==[('rsvp','Ada Yılmaz',3),('rsvp','Bora Kaya',1),('table','Kerem Öztürk',6)], j['options'])
    put=lambda **b: a.req(P,'PUT',dict({'event':e1['id']},**b))
    ok('must be a table of the plan, and somebody of this event', put(table='back-1',add={'type':'rsvp','id':rs['ada@x.com']['id']})[0]==404 and put(table='table-1',add={'type':'rsvp','id':'nope'})[0]==404 and put(table='table-1',add={'type':'rsvp','id':rs['cem@x.com']['id']})[0]==404 and put(table='table-1',add={'type':'table','id':'m-nope'})[0]==404 and put(table='table-1')[0]==400)
    st,j,_=put(table='table-3',add={'type':'rsvp','id':rs['ada@x.com']['id']}); ok('a guest is seated', st==200 and [(o['name'],o['people']) for o in j['assign']['table-3']]==[('Ada Yılmaz',3)], j['assign'])
    put(table='table-3',add={'type':'rsvp','id':rs['bora@x.com']['id']}); st,j,_=put(table='table-5',add={'type':'table','id':mk})
    ok('two parties can share a table; a table entry can be seated too', len(j['assign']['table-3'])==2 and [o['name'] for o in j['assign']['table-5']]==['Kerem Öztürk'])
    st,j,_=put(table='table-1',add={'type':'rsvp','id':rs['ada@x.com']['id']}); ok('seating somebody again moves them', [o['name'] for o in j['assign']['table-1']]==['Ada Yılmaz'] and [o['name'] for o in j['assign']['table-3']]==['Bora Kaya'])
    ok('the other event at the same venue has its own seating', all(v==[] for v in a.req(P+'?event='+e2['id'])[1]['assign'].values()))

    # ---------- where it shows ----------
    tb=a.req('/api/hq/venue-links/notes?event='+e1['id'])[1]['tables'][0]; ok('the table list carries the plan table instead of the hand-typed number', tb['label']=='Table 5' and tb['placed'] is True and tb['note']=='Doğum günü', tb)
    key2=a.req('/api/hq/venue-links','POST',{'venue':'ALICE Club'})[1]['link']['url'].split('k=')[1]; pj=anon.req('/api/public/venue?k='+key2)[1]
    ok('the venue sees the table name on the table and on the seated guests', [t['label'] for t in pj['event']['tables']]==['Table 5'] and {g['name']:g.get('table') for g in pj['event']['guests']}=={'Ada Yılmaz':'Table 1','Bora Kaya':'Table 3'}, pj['event'])
    ov={v['venue']:v for v in a.req('/api/hq/venue-links/overview')[1]['venues']}; ok('Mekânlar shows which venues have a plan', ov['ALICE Club']['plan']=={'name':'Alice Club','tables':10} and ov['Some Rooftop']['plan'] is None, ov['ALICE Club'].get('plan'))

    # ---------- removing ----------
    st,j,_=put(remove={'type':'rsvp','id':rs['bora@x.com']['id']}); ok('removed from the table', st==200 and j['assign']['table-3']==[])
    st,j,_=put(table='table-1',clear=True); ok('a table can be emptied', j['assign']['table-1']==[])
    a.req('/api/hq/rsvps/'+e1['id']+'/'+rs['ada@x.com']['id']+'/decision','POST',{'decision':'approved'})
    put(table='table-2',add={'type':'rsvp','id':rs['ada@x.com']['id']}); a.req('/api/hq/rsvps/'+e1['id']+'/'+rs['ada@x.com']['id']+'/decision','POST',{'decision':'cancelled'})
    ok('a guest who is no longer approved leaves the plan', a.req(P+'?event='+e1['id'])[1]['assign']['table-2']==[])
    a.req('/api/hq/venue-links/notes','DELETE',{'event':e1['id'],'key':mk}); ok('so does a table that was deleted', a.req(P+'?event='+e1['id'])[1]['assign']['table-5']==[])

    # ---------- roles, log, bundle ----------
    st,j,_=a.req('/api/hq/team','POST',{'name':'Kapı','email':'kapi@example.com','role':'door'}); d=C(); d.req('/api/hq/setup','POST',{'t':j['setupUrl'].split('kur=')[1],'password':'door-password-123'}); d.req('/api/hq/login','POST',{'email':'kapi@example.com','password':'door-password-123'})
    ok('the door role can neither read nor change the seating', d.req(P+'?event='+e1['id'])[0]==403 and d.req(P,'PUT',{'event':e1['id'],'table':'table-1','clear':True})[0]==403)
    log=[x['action'] for x in a.req('/api/hq/audit')[1].get('entries',a.req('/api/hq/audit')[1].get('items',[]))]
    ok('seating is in the record of actions', all(any(w in x for x in log) for w in ['Masaya oturttu','Masadan kaldırdı','Masayı boşalttı']), log[:10])
    st,h,_=a.req('/hq',raw=True); ok('HQ bundle carries the plan', 'fp-table' in h and 'venue-links/plan' in h and 'Masa planı · ' in h)
finally:
    srv.terminate()
print(sum(R),'/',len(R),'passed'); sys.exit(0 if all(R) else 1)
