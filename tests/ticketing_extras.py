# Add-ons, deposits collected at the door, offline door support, notices to ticket holders, "My tickets", settlement report (python3 tests/ticketing_extras.py)
import sys, os, hashlib, datetime, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import *
srv=start()
try:
    a=C(); anon=C(); a.req('/api/hq/login','POST',{'email':'admin@example.com','password':'test-password-123'})
    st,j,_=a.req('/api/hq/events','POST',{'title':'Sahil','date':'2027-07-10','time':'17:00','venue':'Lucca','city':'Bodrum'}); eid=j['event']['id']; a.req('/api/hq/events/'+eid+'/publish','POST',{})
    slug=a.req('/api/hq/events/'+eid)[1]['event']['slug']; T='/api/hq/tickets/'+eid
    def pay(tok):
        r=urllib.request.Request(B+'/api/public/pay/test?o='+tok,data=urllib.parse.urlencode({'result':'ok'}).encode(),method='POST',headers={'content-type':'application/x-www-form-urlencoded'})
        class NoRedir(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*a,**k): return None
        try: urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedir).open(r)
        except urllib.error.HTTPError: pass
    def buy(items,name='Ada Yılmaz',email='ada@x.com'):
        st,j,_=anon.req('/api/public/checkout','POST',{'slug':slug,'items':items,'name':name,'email':email,'terms':True})
        if st!=200: return st,j,None
        tok=j['url'].split('=')[-1]; pay(tok); return st,j,tok
    order=lambda tok: anon.req('/api/public/order?t='+tok)[1]
    a.req('/api/hq/tickets/settings','PUT',{'provider':'test','feeMode':'buyer','feePct':10,'feeFixed':0})
    ga=a.req(T+'/types','POST',{'name':'General','price':1000,'stock':50})[1]['type']['id']
    st,j,_=a.req(T+'/types','POST',{'name':'İçecek paketi','price':400,'stock':10,'addon':True}); dr=j['type']['id']; ok('add-on type saved', st==201 and j['type']['addon'] is True, j)
    ok('deposit must be below the price', a.req(T+'/types','POST',{'name':'Masa','price':20000,'deposit':20000})[0]==400 and a.req(T+'/types','POST',{'name':'Masa','price':20000,'deposit':0})[0]==400)
    st,j,_=a.req(T+'/types','POST',{'name':'Masa (4 kişi)','price':20000,'stock':3,'admits':4,'deposit':5000}); tb=j['type']['id']; ok('deposit type saved', st==201 and j['type']['deposit']==5000, j)
    a.req(T+'/shop','PUT',{'enabled':True,'currency':'TRY'})

    # ---------- add-ons ----------
    by={t['name']:t for t in anon.req('/api/public/shop?slug='+slug)[1]['types']}
    ok('shop marks add-ons and what is paid now', by['İçecek paketi']['addon'] is True and by['General']['addon'] is False and by['Masa (4 kişi)']['pay']==5000 and by['Masa (4 kişi)']['now']==20000 and by['Masa (4 kişi)']['fee']==500 and by['General']['pay']==1000, by)
    st,j,_=buy([{'typeId':dr,'qty':1}]); ok('an add-on alone cannot be bought', st==400 and 'ticket' in j['error'], j)
    st,j,t1=buy([{'typeId':ga,'qty':2},{'typeId':dr,'qty':1}]); o=order(t1); ok('ticket with an add-on', st==200 and o['order']['status']=='paid' and o['order']['total']==2640 and len(o['tickets'])==3, o.get('order'))
    s=a.req(T)[1]['sales']; ok('add-ons are counted apart from tickets', s['tickets']==2 and s['extras']==1 and s['net']==2640, {k:s[k] for k in ['tickets','extras','net']})

    # ---------- deposit ----------
    st,j,t2=buy([{'typeId':tb,'qty':1}],name='Bora Kaya',email='bora@x.com'); o=order(t2)
    ok('deposit: only the deposit and its fee are charged', st==200 and o['order']['status']=='paid' and o['order']['total']==5500 and o['order']['due']==15000 and len(o['tickets'])==4, o.get('order'))
    oid=[x for x in a.req(T+'/orders')[1]['orders'] if x['buyer']['email']=='bora@x.com'][0]['id']
    k=a.req('/api/hq/events/'+eid+'/door-link','POST',{})[1]['event']['doorUrl'].split('k=')[1]; D={'x-door':k}
    gs=anon.req('/api/door/list',headers=D)[1]['guests']; due=[g for g in gs if g.get('due')]
    ok('door list: amount due once per table, add-on is not a guest', len(due)==1 and due[0]['due']==15000 and due[0]['currency']=='TRY' and sum(g['guests'] for g in gs)==6 and [g for g in gs if g.get('addon')][0]['guests']==0, [(g['name'],g.get('due'),g['guests']) for g in gs])
    s=a.req(T)[1]['sales']; ok('sales: open amount to collect at the door', s['dueOpen']==15000 and s['collected']==0 and s['net']==2640+5500, {k:s[k] for k in ['dueOpen','collected','net']})
    st,j,_=a.req(T+'/orders/'+oid+'/collect','POST',{'method':'card'}); ok('remainder collected at the door', st==200 and j['order']['collected']['amount']==15000 and j['order']['collected']['method']=='card', j)
    ok('cannot collect twice', a.req(T+'/orders/'+oid+'/collect','POST',{})[0]==409)
    s=a.req(T)[1]['sales']; gs=anon.req('/api/door/list',headers=D)[1]['guests']
    ok('after collecting: nothing due at the door or on the order page', s['dueOpen']==0 and s['collected']==15000 and not [g for g in gs if g.get('due')] and order(t2)['order']['due']==0, s)
    ok('record: collection', any(x['action']=='Kalan tutarı kapıda tahsil etti' and '15000' in x['detail'] for x in a.req('/api/hq/audit')[1]['entries']))

    # ---------- door without a connection ----------
    tk=order(t1)['tickets']; tok=[x for x in tk if x['type']=='General'][0]['url'].split('t=')[1]; h=hashlib.sha256(tok.encode()).hexdigest()[:20]
    mine=[g for g in gs if g.get('h')==h]; ok('door list carries a one-way mark of each QR, never the key', len(mine)==1 and tok not in str(gs) and all(g.get('h') for g in gs), mine)
    past=(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=40)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    st,j,_=anon.req('/api/door/checkin','POST',{'rsvpId':mine[0]['id'],'at':past},headers=D); ok('a queued entry keeps the time the guest was let in', j['result']=='ok' and j['rsvp']['checkedInAt']==past, j)
    st,j,_=anon.req('/api/door/checkin','POST',{'rsvpId':mine[0]['id'],'at':past},headers=D); ok('the same entry sent again is a duplicate', j['result']=='duplicate')
    other=[g for g in gs if g.get('ticket')=='General' and g['id']!=mine[0]['id']][0]; fut=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=3)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    st,j,_=anon.req('/api/door/checkin','POST',{'rsvpId':other['id'],'at':fut},headers=D); ok('a time in the future is not believed', j['result']=='ok' and j['rsvp']['checkedInAt']<fut and j['rsvp']['checkedInAt']>past, j)
    st,t,_=anon.req('/door?k='+k,raw=True); ok('door page can work from its own copy', 'localStorage' in t and 'crypto.subtle' in t)

    # ---------- notice to ticket holders ----------
    st,j,_=a.req(T+'/message','POST',{'subject':'Kapı saati','text':'Kapı 18:00','dryRun':True}); ok('notice: one mail per address', st==200 and j['count']==2, j)
    ok('notice: only those not in yet', a.req(T+'/message','POST',{'subject':'x','text':'y','segment':'out','dryRun':True})[1]['count']==2 and a.req(T+'/message','POST',{'subject':'x','text':'y','segment':'type:'+tb,'dryRun':True})[1]['count']==1)
    ok('notice needs a subject and a text', a.req(T+'/message','POST',{'subject':'','text':'y'})[0]==400)
    st,j,_=a.req(T+'/message','POST',{'subject':'Kapı saati','text':'Kapı 18:00'}); ok('notice is refused, not faked, without a mail service', st==409, j)

    # ---------- my tickets ----------
    ok('my tickets: bad address', anon.req('/api/public/mytickets','POST',{'email':'nope'})[0]==400)
    r1=anon.req('/api/public/mytickets','POST',{'email':'ada@x.com'}); r2=anon.req('/api/public/mytickets','POST',{'email':'nobody@x.com'})
    ok('my tickets: same answer whether or not the address bought', r1[0]==200 and r2[0]==200 and r1[1]==r2[1]=={'ok':True}, (r1[1],r2[1]))
    for i in range(3): r3=anon.req('/api/public/mytickets','POST',{'email':'ada@x.com'})
    ok('my tickets: limited per address', r3[0]==429, r3[0])
    st,t,_=anon.req('/my-tickets',raw=True); ok('my tickets page is served and kept out of search', st==200 and 'noindex' in t and 'Disallow: /my-tickets' in anon.req('/robots.txt',raw=True)[1])

    # ---------- settlement report ----------
    a.req(T+'/orders','POST',{'channel':'comp','typeId':ga,'qty':2,'name':'Basın Listesi'}); a.req(T+'/orders','POST',{'channel':'boxoffice','typeId':ga,'qty':1,'name':'Kapı Misafiri'})
    st,j,_=a.req(T+'/report?format=json'); rw={x['name']:x for x in j['rows']}
    ok('report: by type and channel', rw['General']['online']==2 and rw['General']['comp']==2 and rw['General']['door']==1 and rw['General']['in']==2 and rw['Masa (4 kişi)']['online']==4, rw)
    ok('report: money', j['totals']['door']==1000 and j['totals']['collected']==15000 and j['totals']['net']==2640+5500+1000, j['totals'])
    st,t,_=a.req(T+'/report',raw=True); ok('report: printable page without buyer data', st==200 and 'Mutabakat raporu' in t and 'Sahil' in t and 'ada@x.com' not in t and 'Bora' not in t)
    ok('report is not public', anon.req(T+'/report')[0]==401)
finally:
    srv.terminate()
print('\n%d passed, %d failed' % (sum(R), len(R)-sum(R)))
sys.exit(0 if all(R) else 1)
