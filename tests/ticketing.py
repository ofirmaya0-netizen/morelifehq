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
    vg=[x for x in g if x['name']=='Derin Su'][0]; st,j,_=anon.req('/api/door/checkin','POST',{'rsvpId':vg['id']},headers={'x-door':dk}); ok('door link checks a ticket in by name', j['result']=='ok' and 'email' not in j['rsvp'], j)
    ok('checked-in ticket cannot be transferred', anon.req('/api/public/ticket','POST',{'o':tok,'ticketId':tk[0]['id'],'name':'Yeni Kişi','email':'yeni@x.com'})[0]==409)
    t2=order(tok2)['tickets'][0]; old=t2['url'].split('=')[1]
    st,j,_=anon.req('/api/public/ticket','POST',{'o':tok2,'ticketId':t2['id'],'name':'Yeni Kişi','email':'yeni@x.com'}); new=j['url'].split('=')[1]
    ok('transfer: new QR, old one dead', st==200 and j['moved'] and new!=old and anon.req('/api/public/pass?t='+old)[0]==404 and anon.req('/api/public/pass?t='+new)[1]['pass']['name']=='Yeni Kişi')
    ok('old QR is refused at the door', a.req('/api/hq/checkin','POST',{'eventId':eid,'token':old})[1]['result']=='invalid')
    ok('someone else’s order key cannot move a ticket', anon.req('/api/public/ticket','POST',{'o':tok,'ticketId':t2['id'],'name':'Kötü Niyet','email':'k@x.com'})[0]==404)
    ok('transfers can be switched off', a.req(T+'/shop','PUT',{'transfers':False})[0]==200 and anon.req('/api/public/ticket','POST',{'o':tok2,'ticketId':order(tok2)['tickets'][1]['id'],'name':'Baş Ka','email':'b@x.com'})[0]==403)

    # ---------- language ----------
    st,j,_=anon.req('/api/public/checkout','POST',{'slug':slug,'items':[{'typeId':ga,'qty':1}],'name':'Tek','email':'x@x.com','terms':True,'lang':'tr'}); ok('errors come back in the buyer’s language', st==400 and 'geçerli bir e-posta' in j['error'], j)

    # ---------- waitlist + resale ----------
    solo=a.req(T+'/types','POST',{'name':'Backstage','price':500,'stock':1})[1]['type']['id']
    st,j,tb=buy([{'typeId':solo,'qty':1}],email='first@x.com',name='İlk Alan'); tkb=order(tb)['tickets'][0]
    sv=lambda: {t['name']:t for t in anon.req('/api/public/shop?slug='+slug)[1]['types']}['Backstage']
    ok('sold-out type offers its waitlist', sv()['state']=='soldout' and sv()['notify']=='waitlist', sv())
    ok('waitlist needs an e-mail', anon.req('/api/public/waitlist','POST',{'slug':slug,'typeId':solo,'email':'nope'})[0]==400)
    ok('joined, twice is still one place', anon.req('/api/public/waitlist','POST',{'slug':slug,'typeId':solo,'email':'wait@x.com','name':'Bekleyen Biri','qty':1})[0]==200 and anon.req('/api/public/waitlist','POST',{'slug':slug,'typeId':solo,'email':'WAIT@x.com'})[0]==200 and {t['id']:t for t in a.req(T)[1]['types']}[solo]['waiting']==1)
    ok('no waitlist for a type that is on sale', anon.req('/api/public/waitlist','POST',{'slug':slug,'typeId':ga,'email':'w2@x.com'})[0]==409)
    ok('waitlist CSV', 'wait@x.com' in a.req(T+'/waitlist.csv',raw=True)[1])
    ok('resale is off unless switched on', anon.req('/api/public/resale','POST',{'o':tb,'ticketId':tkb['id']})[0]==403 and order(tb)['tickets'][0]['canResell'] is False)
    a.req(T+'/shop','PUT',{'resale':True}); ok('holder may now list the ticket', order(tb)['tickets'][0]['canResell'] is True and order(tb)['tickets'][0]['back']==500)
    ok('a table seat cannot be resold alone', order(tok3)['tickets'][0]['canResell'] is False and anon.req('/api/public/resale','POST',{'o':tok3,'ticketId':order(tok3)['tickets'][0]['id']})[0]==409)
    ok('listed: still the holder’s, and on sale again', anon.req('/api/public/resale','POST',{'o':tb,'ticketId':tkb['id']})[0]==200 and order(tb)['tickets'][0]['listed'] and anon.req('/api/public/pass?t='+tkb['url'].split('=')[1])[0]==200 and sv()['state']=='on' and sv()['resale'] is True)
    ok('listed ticket cannot be handed over at the same time', anon.req('/api/public/ticket','POST',{'o':tb,'ticketId':tkb['id'],'name':'Baş Ka','email':'b@x.com'})[0]==409)
    ok('holder can take it off sale', anon.req('/api/public/resale','POST',{'o':tb,'ticketId':tkb['id'],'list':False})[0]==200 and sv()['state']=='soldout')
    anon.req('/api/public/resale','POST',{'o':tb,'ticketId':tkb['id']})
    st,j,tn=buy([{'typeId':solo,'qty':1}],email='second@x.com',name='İkinci Alan',pay=None)
    ok('while someone is paying, the listing is taken and cannot be withdrawn', sv()['state']=='soldout' and anon.req('/api/public/resale','POST',{'o':tb,'ticketId':tkb['id'],'list':False})[0]==409)
    ok('second buyer cannot take the same listing', buy([{'typeId':solo,'qty':1}],email='third@x.com',name='Üçüncü Alan')[0]==409)
    form(anon,'/api/public/pay/test?o='+tn,{'result':'ok'}); ob=order(tb)
    ok('sold on: old QR dead, new holder has a ticket', order(tn)['order']['status']=='paid' and len(order(tn)['tickets'])==1 and ob['tickets'][0]['status']=='void' and ob['tickets'][0]['resold'] and anon.req('/api/public/pass?t='+tkb['url'].split('=')[1])[0]==404)
    ok('first holder gets the ticket price back, not the fee', ob['order']['status']=='refunded' and ob['order']['refunded']==500 and ob['order']['total']==555, ob['order'])
    ok('still exactly one unit sold', {t['id']:t for t in a.req(T)[1]['types']}[solo]['taken']==1 and sv()['state']=='soldout')
    a.req(T+'/shop','PUT',{'resale':False})

    # ---------- promoters, friends, early access, nudges ----------
    ok('promoter needs a name', a.req(T+'/promoters','POST',{'code':'CAN'})[0]==400)
    st,j,_=a.req(T+'/promoters','POST',{'name':'Can Promoter','code':'can','pct':10,'fixed':20}); ptk=j['promoter']['token']
    ok('promoter created with a private panel link', st==201 and j['promoter']['code']=='CAN' and a.req(T+'/promoters','POST',{'name':'Kopya','code':'CAN'})[0]==409, j)
    st,j,tp=buy([{'typeId':ga,'qty':2}],email='promo@x.com',name='Promo Alıcı',promo='can'); pid=tp
    st,j,_=anon.req('/api/public/promoter?t='+ptk); ok('promoter page: own sales, no buyer contact', st==200 and j['tickets']==2 and j['revenue']==3000 and j['commission']==340 and j['sales'][0]['who']=='Promo A.' and 'email' not in str(j['sales']) and j['link'].endswith('?p=CAN'), j)
    ok('promoter page needs its key', anon.req('/api/public/promoter?t=nope')[0]==404)
    pr={x['code']:x for x in a.req(T)[1]['promoters']}; ok('HQ sees the promoter’s numbers', pr['CAN']['tickets']==2 and pr['CAN']['commission']==340)
    ok('unknown promoter code is ignored, sale still goes through', buy([{'typeId':free,'qty':1}],email='np@x.com',name='No Promo',promo='ghost')[0]==200)
    fr=order(tp)['friends']; ok('buyer gets a link for friends', fr and '?ref=' in fr['url'] and fr['bought']==0, fr)
    buy([{'typeId':ga,'qty':1}],email='friend@x.com',name='Arkadaş Bir',ref=fr['url'].split('ref=')[1]); buy([{'typeId':free,'qty':1}],email='promo@x.com',name='Promo Alıcı',ref=fr['url'].split('ref=')[1])
    ok('friends counted, own purchases are not', order(tp)['friends']['bought']==1 and any(x['email']=='promo@x.com' and x['tickets']==1 for x in a.req(T)[1]['sales']['referrers']), a.req(T)[1]['sales']['referrers'])
    by={t['name']:t for t in anon.req('/api/public/shop?slug='+slug)[1]['types']}; ok('nudge: price of the next phase and last few', by['Early Bird']['next']==1500 and by['Backstage']['state']=='soldout', by['Early Bird'])
    au=a.req('/api/hq/audiences','POST',{'name':'Geçen yaz gelenler','rules':{'tags':['bilet']}})[1]['audience']['id']
    ok('early access needs both audience and time', a.req(T+'/types','POST',{'name':'Members','price':800,'stock':5,'earlyFor':au})[0]==400)
    mem=a.req(T+'/types','POST',{'name':'Members','price':800,'stock':5,'earlyFor':au,'earlyUntil':'2099-01-01T00:00'})[1]['type']['id']
    ok('shop marks the type as early access', {t['id']:t for t in anon.req('/api/public/shop?slug='+slug)[1]['types']}[mem]['early']=='2099-01-01T00:00')
    ok('a stranger cannot buy during early access', buy([{'typeId':mem,'qty':1}],email='stranger@x.com',name='Yabancı Biri')[0]==403)
    ok('a past buyer can', buy([{'typeId':mem,'qty':1}],email='ada@x.com',name='Ada Yılmaz')[0]==200)
    a.req(T+'/types/'+mem,'PUT',{'earlyUntil':'2020-01-01T00:00'}); ok('after the window it is open to everyone', buy([{'typeId':mem,'qty':1}],email='stranger@x.com',name='Yabancı Biri')[0]==200)

    # ---------- profit and loss ----------
    bk=a.req('/api/hq/bookings','POST',{'artist':'PAWSA','agency':'Primary','eventId':eid,'fee':1000,'currency':'EUR'})[1]['booking']['id']
    a.req('/api/hq/bookings/'+bk+'/payments','POST',{'kind':'deposit','amount':500}); pp=a.req('/api/hq/bookings/'+bk)[1]['booking']['payments'][0]['id']; a.req('/api/hq/bookings/'+bk+'/payments/'+pp,'PUT',{'paid':True})
    P='/api/hq/pnl/'+eid; st,j,_=a.req(P)
    ok('P&L starts from tickets and bookings', {r['auto'] for r in j['rows']}=={'tickets','booking'} and j['missing']==['EUR'] and j['totals']['complete'] is False and j['totals']['expense']==0, j['totals'])
    ok('line needs a label and an amount', a.req(P+'/lines','POST',{'kind':'expense','amount':'x','label':'Ses'})[0]==400 and a.req(P+'/lines','POST',{'kind':'expense','amount':100})[0]==400)
    st,j,_=a.req(P+'/lines','POST',{'kind':'expense','category':'Prodüksiyon (ses, ışık, sahne)','label':'Ses ve ışık','amount':5000,'currency':'TRY'}); lid=j['line']['id']
    a.req(P+'/lines','POST',{'kind':'income','category':'Sponsorluk','label':'Marka X','amount':2000,'currency':'TRY','settled':True})
    ok('bad rate refused', a.req(P,'PUT',{'rates':{'EUR':-3}})[0]==400)
    a.req(P,'PUT',{'rates':{'EUR':40}}); j=a.req(P)[1]; tk=[r for r in j['rows'] if r.get('auto')=='tickets'][0]['amount']
    ok('with the rate entered the result is complete', j['totals']['complete'] and j['totals']['expense']==45000 and j['totals']['income']==tk+2000 and j['totals']['net']==tk+2000-45000 and j['totals']['unpaid']==25000, j['totals'])
    ok('cost per ticket and break-even', j['perTicket']['tickets']>0 and j['perTicket']['breakEven']>j['perTicket']['tickets'], j['perTicket'])
    ok('line edited and removed', a.req(P+'/lines/'+lid,'PUT',{'amount':6000,'settled':True})[1]['line']['amount']==6000 and a.req(P+'/lines/'+lid,'DELETE',{})[0]==200 and a.req(P)[1]['totals']['expense']==40000)
    a.req('/api/hq/bookings/'+bk,'DELETE',{})

    # ---------- admin: orders, refunds, comps, box office ----------
    st,j,_=a.req(T+'/orders'); ords={o['buyer']['email']:o for o in j['orders']}; ok('orders listed without stock keys or payment internals', 'ada@x.com' in ords and 'slots' not in ords['ada@x.com'] and 'items' not in (ords['ada@x.com'].get('payment') or {}), ords.get('ada@x.com'))
    ok('search', a.req(T+'/orders?q=bora')[1]['total']==1)
    oid=ords['bora@x.com']['id']; d=a.req(T+'/orders/'+oid)[1]; tids=[t['id'] for t in d['tickets']]
    st,j,_=a.req(T+'/orders/'+oid+'/refund','POST',{'ticketIds':[tids[1]],'reason':'gelemiyor'}); ok('one ticket refunded with its fee', st==200 and j['refund']['amount']==1325 and j['order']['status']=='partial' and j['order']['refunded']==1325, j)
    ok('refunded ticket is dead, the other lives', [t['status'] for t in order(tok2)['tickets']]==['valid','void'])
    ok('cannot refund more than was paid', a.req(T+'/orders/'+oid+'/refund','POST',{'amount':5000})[0]==400)
    st,j,_=a.req(T+'/orders/'+oid+'/refund','POST',{}); ok('rest refunded: order closed, total back', j['order']['status']=='refunded' and j['order']['refunded']==2650, j['order'])
    ok('refunded units are on sale again', {t['id']:t for t in a.req(T)[1]['types']}[ga]['taken']==3)  # the promoter sale (2) and the friend (1) remain
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
    ok('sales: net is gross minus refunds, refunds as made', s['refunds']==2650+500 and s['net']==round(s['gross']-s['refunds'],2) and s['gross']>28365, {k:s[k] for k in ['gross','refunds','net','orders','tickets']})
    ok('sales: by type and check-ins', bt['Early Bird']['sold']==2 and s['checkedIn']==2 and bt['VIP Masa (4 kişi)']['sold']==4 and bt['General']['sold']==6, bt)
    ok('sales: by source', any(x['name']=='instagram / launch' and x['tickets']==2 for x in s['bySource']) and any(x['name']=='Kapı satışı' for x in s['bySource']), s['bySource'])
    e0=a.req('/api/hq/summary')[1]['upcoming'][0]; ok('Özet carries ticket sales', e0['sales']['tickets']==s['tickets'] and e0['sales']['last7']>0 and e0['sales']['net']==s['net'], e0.get('sales'))
    ok('all-events sales list', a.req('/api/hq/tickets/sales')[1]['events'][0]['tickets']==s['tickets'])
    ok('buyers land in the CRM tagged', a.req('/api/hq/contacts?limit=5&tag=bilet')[1]['matched']>=4)
    mk=a.req('/api/hq/marketing')[1]['events'][0]; ok('Marketing shows tickets sold here', mk['tickets']==s['tickets'] and mk['net']==s['net'], mk)
    acts=[(x['action'],x['target']) for x in a.req('/api/hq/audit')[1]['entries']]
    ok('record: sales changes', ('Bilet iadesi yaptı','Bora Kaya') in acts and ('Bilet satışını açtı','Gece') in acts and ('Davetiye bileti verdi','Basın Listesi') in acts and any(x[0]=='Bilet türü ekledi' for x in acts), acts[:14])
    # roles
    st,j,_=a.req('/api/hq/team','POST',{'name':'Kapı Ali','email':'ali@x.com','role':'door'}); d=C(); d.req('/api/hq/setup','POST',{'t':j['setupUrl'].split('kur=')[1],'password':'uzun-bir-sifre-1'})
    ok('door role: no orders, but ticket holders at the door', d.req(T+'/orders')[0]==403 and len(d.req('/api/hq/rsvps/'+eid)[1]['tickets'])>=8 and 'email' not in d.req('/api/hq/rsvps/'+eid)[1]['tickets'][0])
    # unpaid baskets expire
    a.req(T+'/shop','PUT',{'remind':True})  # the reminder path runs too (no mail service here, so nothing is sent)
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
