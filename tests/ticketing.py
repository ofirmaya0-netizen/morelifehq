# Ticket sales: types and stock, codes, checkout, test payment, tickets at the door, transfers, refunds, comps, sales figures (python3 tests/ticketing.py)
import sys, os, threading, urllib.parse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import *
srv=start()
try:
    a=C(); anon=C(); a.req('/api/hq/login','POST',{'email':'admin@example.com','password':'test-password-123'})
    st,j,_=a.req('/api/hq/events','POST',{'title':'Gece','date':'2027-06-16','time':'22:00','venue':'Lucca','city':'Bodrum'}); eid=j['event']['id']; a.req('/api/hq/events/'+eid+'/publish','POST',{})
    slug=a.req('/api/hq/events/'+eid)[1]['event']['slug']; T='/api/hq/tickets/'+eid
    def form(c,path,data):
        r=urllib.request.Request(B+path,data=urllib.parse.urlencode(data).encode(),method='POST',headers={'content-type':'application/x-www-form-urlencoded'})
        class NoRedir(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*a,**k): return None
        try: resp=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedir).open(r)
        except urllib.error.HTTPError as e: resp=e
        return resp.status, resp.headers.get('location','')
    def buy(items,name='Ada Yılmaz',email='ada@x.com',code='',pay='ok',**kw):
        d={'slug':slug,'items':items,'name':name,'email':email,'terms':True,'code':code}; d.update(kw)
        st,j,_=anon.req('/api/public/checkout','POST',d)
        if st!=200: return st,j,None
        tok=j['url'].split('=')[-1]
        if '/pay/test' in j['url'] and pay: form(anon,'/api/public/pay/test?o='+tok,{'result':pay})
        return st,j,tok
    order=lambda tok: anon.req('/api/public/order?t='+tok)[1]

    # ---------- setup ----------
    ok('shop is off until switched on', anon.req('/api/public/shop?slug='+slug)[1]=={'enabled':False})
    ok('cannot open the shop without ticket types', a.req(T+'/shop','PUT',{'enabled':True})[0]==400)
    ok('type needs a name', a.req(T+'/types','POST',{'price':100})[0]==400)
    st,j,_=a.req(T+'/types','POST',{'name':'Early Bird','price':'1000','stock':3,'max':4}); eb=j['type']['id']; ok('type created', st==201 and j['type']['price']==1000 and j['type']['stock']==3)
    ga=a.req(T+'/types','POST',{'name':'General','price':1500,'stock':50,'after':eb})[1]['type']['id']
    vip=a.req(T+'/types','POST',{'name':'VIP Masa (4 kişi)','price':20000,'stock':2,'admits':4,'hidden':True})[1]['type']['id']
    free=a.req(T+'/types','POST',{'name':'Guest','price':0,'stock':5})[1]['type']['id']
    ok('shop opens', a.req(T+'/shop','PUT',{'enabled':True,'currency':'TRY'})[0]==200)
    st,j,_=anon.req('/api/public/shop?slug='+slug); ok('no provider chosen: shown but not ready', j['enabled'] and j['ready'] is False, j)
    ok('checkout refused until payments are set up', buy([{'typeId':eb,'qty':1}])[0]==409)
    ok('settings: fee percent bounded', a.req('/api/hq/tickets/settings','PUT',{'feePct':80})[0]==400)
    st,j,_=a.req('/api/hq/tickets/settings','PUT',{'provider':'iyzico'}); ok('iyzico without keys blocks selling, names what is missing', 'IYZICO_API_KEY' in j['blocked'], j)
    st,j,_=a.req('/api/hq/tickets/settings','PUT',{'provider':'test','feeMode':'buyer','feePct':10,'feeFixed':5}); ok('test provider is ready on preview data', j['blocked']=='', j)
    st,j,_=anon.req('/api/public/shop?slug='+slug); by={t['name']:t for t in j['types']}
    ok('shop: hidden type not listed, phase 2 waits for phase 1', j['ready'] and 'VIP Masa (4 kişi)' not in by and by['Early Bird']['state']=='on' and by['General']['state']=='soon' and by['Early Bird']['fee']==105, by)
    ok('private order data is not public', anon.req(T)[0]==401 and anon.req(T+'/orders')[0]==401)

    # ---------- checkout ----------
    ok('needs terms', anon.req('/api/public/checkout','POST',{'slug':slug,'items':[{'typeId':eb,'qty':1}],'name':'Ada Y','email':'ada@x.com'})[0]==400)
    ok('needs full name + e-mail', buy([{'typeId':eb,'qty':1}],name='Ada')[0]==400)
    ok('quantity limits', buy([{'typeId':eb,'qty':5}])[0]==400)
    ok('phase 2 cannot be bought early', buy([{'typeId':ga,'qty':1}])[0]==409)
    ok('hidden type needs its code', buy([{'typeId':vip,'qty':1}])[0]==400)
    st,j,tok=buy([{'typeId':eb,'qty':2}],pay=None,utm={'source':'Instagram','campaign':'launch'})
    o=order(tok); ok('order pending with stock held', st==200 and o['order']['status']=='pending' and o['order']['total']==2210 and o['order']['fee']==210 and o['tickets']==[] and o['order']['payUrl'], o['order'])
    ok('held stock counts', {t['name']:t for t in anon.req('/api/public/shop?slug='+slug)[1]['types']}['Early Bird']['max']==1)
    ok('test payment page', 'Approve payment' in anon.req('/pay/test?o='+tok,raw=True)[1])
    st,loc=form(anon,'/api/public/pay/test?o='+tok,{'result':'fail'}); ok('declined payment: back to the order, nothing issued', st==303 and loc=='/order?t='+tok and order(tok)['order']['status']=='pending' and order(tok)['order']['error'])
    form(anon,'/api/public/pay/test?o='+tok,{'result':'ok'}); o=order(tok)
    ok('paid: one ticket per person', o['order']['status']=='paid' and len(o['tickets'])==2 and all(t['url'].startswith('/pass?t=') for t in o['tickets']), o)
    form(anon,'/api/public/pay/test?o='+tok,{'result':'ok'}); ok('paying twice issues nothing more', len(order(tok)['tickets'])==2)
    ok('a wrong order key opens nothing', anon.req('/api/public/order?t=nope')[0]==404)
    # race for the last unit
    res=[]; th=[threading.Thread(target=lambda i=i: res.append(buy([{'typeId':eb,'qty':1}],email='r%d@x.com'%i,name='Race %d X'%i,pay=None)[0])) for i in range(6)]
    [x.start() for x in th]; [x.join() for x in th]
    # the local Blobs emulator (BLOBS=1) does not enforce onlyIfNew for writes that arrive together; the hosted service does
    if not os.environ.get('BLOBS'): ok('six buyers, one unit left: exactly one gets it', sorted(res)==[200,409,409,409,409,409], res)
    by={t['name']:t for t in anon.req('/api/public/shop?slug='+slug)[1]['types']}; ok('sold out opens the next phase', by['Early Bird']['state']=='soldout' and by['General']['state']=='on', by)

    # ---------- codes ----------
    ok('code needs 3 characters', a.req(T+'/codes','POST',{'code':'A','kind':'percent','value':10})[0]==400)
    ok('percent capped', a.req(T+'/codes','POST',{'code':'WOW','kind':'percent','value':120})[0]==400)
    ok('code created', a.req(T+'/codes','POST',{'code':'friends20','kind':'percent','value':20,'maxUses':1})[0]==201 and a.req(T+'/codes','POST',{'code':'FRIENDS20','value':5})[0]==409)
    a.req(T+'/codes','POST',{'code':'VIPACCESS','kind':'amount','value':0,'typeIds':[vip]})
    st,j,_=anon.req('/api/public/shop?slug='+slug+'&code=friends20'); by={t['name']:t for t in j['types']}; ok('code lowers the shown price', j['code']=={'ok':True,'code':'FRIENDS20'} and by['General']['now']==1200 and by['General']['price']==1500, by['General'])
    ok('bad code says so', anon.req('/api/public/shop?slug='+slug+'&code=nope')[1]['code']['ok'] is False)
    st,j,_=anon.req('/api/public/shop?slug='+slug+'&code=VIPACCESS'); ok('access code reveals the hidden type', any(t['id']==vip for t in j['types']))
    st,j,tok2=buy([{'typeId':ga,'qty':2}],email='bora@x.com',name='Bora Kaya',code='FRIENDS20'); o2=order(tok2)['order']
    ok('discount and fee on the discounted price', o2['status']=='paid' and o2['discount']==600 and o2['fee']==250 and o2['total']==2650, o2)
    ok('code limit reached', buy([{'typeId':ga,'qty':1}],email='c@x.com',name='Cem Tan',code='FRIENDS20')[0] in (400,409))
    st,j,tok3=buy([{'typeId':vip,'qty':1}],email='vip@x.com',name='Derin Su',code='VIPACCESS'); ok('one table admits four: four QR tickets', len(order(tok3)['tickets'])==4, order(tok3))
    st,j,tok4=buy([{'typeId':free,'qty':1}],email='free@x.com',name='Ece Free'); ok('free ticket skips payment', '/order?t=' in j['url'] and order(tok4)['order']['status']=='paid' and order(tok4)['order']['total']==0, j)

    # ---------- ticket page, door, transfer ----------
    tk=order(tok)['tickets']; ptok=tk[0]['url'].split('=')[1]
    st,j,_=anon.req('/api/public/pass?t='+ptok); ok('ticket opens as an entry pass', j['pass']['name']=='Ada Yılmaz' and j['pass']['type']=='Early Bird' and j['pass']['checkedIn'] is False, j)
    st,j,_=a.req('/api/hq/rsvps/'+eid); ok('door list shows ticket holders', len(j['tickets'])==2+2+4+1 and j['tickets'][0]['id'].startswith('tk-'), len(j['tickets']))
    st,j,_=a.req('/api/hq/checkin','POST',{'eventId':eid,'token':ptok}); ok('QR scan checks the ticket in', j['result']=='ok' and j['rsvp']['ticket']=='Early Bird' and j['rsvp']['name']=='Ada Yılmaz', j)
    ok('second scan is a duplicate', a.req('/api/hq/checkin','POST',{'eventId':eid,'token':ptok})[1]['result']=='duplicate')
    a.req('/api/hq/events/'+eid+'/door-link','POST',{}); dk=a.req('/api/hq/events/'+eid)[1]['event']['doorUrl'].split('k=')[1]
    st,j,_=anon.req('/api/door/list',headers={'x-door':dk}); g=[x for x in j['guests'] if x.get('ticket')]; ok('door link lists tickets by name only', len(g)==9 and 'email' not in g[0], g[:1])
    st,j,_=anon.req('/api/door/checkin','POST',{'rsvpId':g[1]['id']},headers={'x-door':dk}); ok('door link checks a ticket in by name', j['result']=='ok' and 'email' not in j['rsvp'], j)
    ok('checked-in ticket cannot be transferred', anon.req('/api/public/ticket','POST',{'o':tok,'ticketId':tk[0]['id'],'name':'Yeni Kişi','email':'yeni@x.com'})[0]==409)
    t2=order(tok2)['tickets'][0]; old=t2['url'].split('=')[1]
    st,j,_=anon.req('/api/public/ticket','POST',{'o':tok2,'ticketId':t2['id'],'name':'Yeni Kişi','email':'yeni@x.com'}); new=j['url'].split('=')[1]
    ok('transfer: new QR, old one dead', st==200 and j['moved'] and new!=old and anon.req('/api/public/pass?t='+old)[0]==404 and anon.req('/api/public/pass?t='+new)[1]['pass']['name']=='Yeni Kişi')
    ok('old QR is refused at the door', a.req('/api/hq/checkin','POST',{'eventId':eid,'token':old})[1]['result']=='invalid')
    ok('someone else’s order key cannot move a ticket', anon.req('/api/public/ticket','POST',{'o':tok,'ticketId':t2['id'],'name':'Kötü Niyet','email':'k@x.com'})[0]==404)
    ok('transfers can be switched off', a.req(T+'/shop','PUT',{'transfers':False})[0]==200 and anon.req('/api/public/ticket','POST',{'o':tok2,'ticketId':order(tok2)['tickets'][1]['id'],'name':'Baş Ka','email':'b@x.com'})[0]==403)

    # ---------- admin: orders, refunds, comps, box office ----------
    st,j,_=a.req(T+'/orders'); os={o['buyer']['email']:o for o in j['orders']}; ok('orders listed without stock keys or payment internals', 'ada@x.com' in os and os['ada@x.com']['slots'] is None if 'slots' in os['ada@x.com'] else True)
    ok('search', a.req(T+'/orders?q=bora')[1]['total']==1)
    oid=os['bora@x.com']['id']; d=a.req(T+'/orders/'+oid)[1]; tids=[t['id'] for t in d['tickets']]
    st,j,_=a.req(T+'/orders/'+oid+'/refund','POST',{'ticketIds':[tids[1]],'reason':'gelemiyor'}); ok('one ticket refunded with its fee', st==200 and j['refund']['amount']==1325 and j['order']['status']=='partial' and j['order']['refunded']==1325, j)
    ok('refunded ticket is dead, the other lives', [t['status'] for t in order(tok2)['tickets']]==['valid','void'])
    ok('cannot refund more than was paid', a.req(T+'/orders/'+oid+'/refund','POST',{'amount':5000})[0]==400)
    st,j,_=a.req(T+'/orders/'+oid+'/refund','POST',{}); ok('rest refunded: order closed, total back', j['order']['status']=='refunded' and j['order']['refunded']==2650, j['order'])
    ok('refunded units are on sale again', {t['id']:t for t in a.req(T)[1]['types']}[ga]['taken']==0)
    st,j,_=a.req(T+'/orders','POST',{'channel':'comp','typeId':ga,'qty':2,'name':'Basın Listesi','email':'basin@x.com'}); ok('comp tickets: free, issued at once', st==201 and j['order']['total']==0 and j['order']['channel']=='comp' and len(j['tickets'])==2, j)
    st,j,_=a.req(T+'/orders','POST',{'channel':'boxoffice','typeId':ga,'qty':1,'name':'Kapı Müşterisi','method':'cash'}); ok('box office sale recorded at the list price', j['order']['total']==1500 and j['order']['method']=='cash' and j['order']['fee']==0, j['order'])
    ok('comp beyond stock refused', a.req(T+'/orders','POST',{'channel':'comp','typeId':vip,'qty':5,'name':'Çok Kişi'})[0]==409)
    ok('stock cannot drop below what is sold', a.req(T+'/types/'+eb,'PUT',{'stock':1})[0]==409 and a.req(T+'/types/'+eb,'PUT',{'stock':10})[0]==200)
    ok('sold type cannot be deleted', a.req(T+'/types/'+eb,'DELETE',{})[0]==409)
    ok('currency locked after orders', a.req(T+'/shop','PUT',{'currency':'EUR'})[0]==409)
    st,txt,h=a.req(T+'/orders.csv',raw=True); ok('orders CSV', 'ML-' in txt and 'ada@x.com' in txt and 'attachment' in h.get('content-disposition',''))
    ok('tickets CSV', 'Early Bird' in a.req(T+'/tickets.csv',raw=True)[1])

    # ---------- figures ----------
    s=a.req(T)[1]['sales']; bt={x['name']:x for x in s['byType']}
    # the race winner never paid. ada 2210 + bora 2650 (refunded) + vip 22005 + free 0 + comp 0 + door 1500
    ok('sales: gross, refunds, net', s['gross']==28365 and s['refunds']==2650 and s['net']==25715 and s['orders']==6, {k:s[k] for k in ['gross','refunds','net','orders','tickets']})
    ok('sales: by type and check-ins', bt['Early Bird']['sold']==2 and s['checkedIn']==2 and bt['VIP Masa (4 kişi)']['sold']==4 and bt['General']['sold']==3, bt)
    ok('sales: by source', any(x['name']=='instagram / launch' and x['tickets']==2 for x in s['bySource']) and any(x['name']=='Kapı satışı' for x in s['bySource']), s['bySource'])
    e0=a.req('/api/hq/summary')[1]['upcoming'][0]; ok('Özet carries ticket sales', e0['sales']['tickets']==s['tickets'] and e0['sales']['last7']>0 and e0['sales']['net']==25715, e0.get('sales'))
    ok('all-events sales list', a.req('/api/hq/tickets/sales')[1]['events'][0]['tickets']==s['tickets'])
    ok('buyers land in the CRM tagged', a.req('/api/hq/contacts?limit=5&tag=bilet')[1]['matched']>=4)
    acts=[(x['action'],x['target']) for x in a.req('/api/hq/audit')[1]['entries']]
    ok('record: sales changes', ('Bilet iadesi yaptı','Bora Kaya') in acts and ('Bilet satışını açtı','Gece') in acts and ('Davetiye bileti verdi','Basın Listesi') in acts and any(x[0]=='Bilet türü ekledi' for x in acts), acts[:14])
    # roles
    st,j,_=a.req('/api/hq/team','POST',{'name':'Kapı Ali','email':'ali@x.com','role':'door'}); d=C(); d.req('/api/hq/setup','POST',{'t':j['setupUrl'].split('kur=')[1],'password':'uzun-bir-sifre-1'})
    ok('door role: no orders, but ticket holders at the door', d.req(T+'/orders')[0]==403 and len(d.req('/api/hq/rsvps/'+eid)[1]['tickets'])>=8 and 'email' not in d.req('/api/hq/rsvps/'+eid)[1]['tickets'][0])
    # unpaid baskets expire
    st,j,tokx=buy([{'typeId':eb,'qty':3}],email='late@x.com',name='Geç Kalan',pay=None); before={t['id']:t for t in a.req(T)[1]['types']}[eb]['taken']
    import glob, json as J, datetime
    for f in glob.glob(ROOT+'/.data/pending*'):
        J.dump({'exp':'2020-01-01T00:00:00.000Z'},open(f,'w'))
    after={t['id']:t for t in a.req(T)[1]['types']}[eb]['taken']
    if not os.environ.get('BLOBS'): ok('unpaid baskets give their stock back', after==2 and order(tokx)['order']['status']=='expired', (before,after))
    form(anon,'/api/public/pay/test?o='+tokx,{'result':'ok'}); ok('late payment still gets tickets while stock allows', order(tokx)['order']['status']=='paid' and len(order(tokx)['tickets'])==3)
    ok('cancelled event stops sales', a.req('/api/hq/events/'+eid,'PUT',{'eventStatus':'cancelled'})[0]==200 and a.req('/api/hq/events/'+eid+'/publish','POST',{})[0]==200 and anon.req('/api/public/shop?slug='+slug)[1]=={'enabled':False})
finally:
    srv.terminate()
print('\n%d passed, %d failed' % (sum(R), len(R)-sum(R)))
sys.exit(0 if all(R) else 1)
