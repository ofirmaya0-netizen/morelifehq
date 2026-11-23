# Guest list visibility (initials vs names) and per-event message previews.
import sys; sys.path.insert(0, __import__('os').path.dirname(__file__))
from harness import *
p=start()
try:
    a=C(); anon=C()
    a.req('/api/hq/login','POST',{'email':'admin@example.com','password':'test-password-123'})
    st,j,_=a.req('/api/hq/events','POST',{'title':'More Life Presents: Test Night','date':'2027-12-24','time':'21:00','venue':'Alice','city':'Istanbul','waPromo':'Line one.\nLine two.'}); ev=j['event']
    ok('promo line stored without line breaks', ev['waPromo']=='Line one. Line two.', ev.get('waPromo'))
    a.req('/api/hq/events/'+ev['id']+'/publish','POST',{})
    st,t,_=anon.req('/events/'+ev['slug'],raw=True)
    ok('eyebrow not doubled when title starts with More Life Presents', t.count('More Life presents')==0 and 'More Life Presents: Test Night' in t)
    ok('form offers show-my-name, unticked', 'name="showName" type="checkbox">' in t and 'id="g-guests"' in t)
    people=[('Ada Yilmaz',True),('Can Demir',True),('Elif Kaya',False),('Pending Person',True)]
    for n,show in people:
        st,j,_=anon.req('/api/public/rsvp','POST',{'slug':ev['slug'],'name':n,'email':n.split()[0].lower()+'@example.com','consent':True,'showName':show}); assert st==200, j
    st,j,_=a.req('/api/hq/rsvps/'+ev['id']); rs={r['name']:r for r in j['rsvps']}
    st,j,_=anon.req('/api/public/guests?e='+ev['id']); ok('nobody listed before approval', j=={'enabled':True,'going':0,'names':False,'guests':[]}, j)
    for n in ['Ada Yilmaz','Can Demir','Elif Kaya']:
        st,j,_=a.req('/api/hq/rsvps/'+ev['id']+'/'+rs[n]['id']+'/decision','POST',{'decision':'approved'}); assert st==200,(st,j)
    st,j,_=a.req('/api/hq/rsvps/'+ev['id']); rs={r['name']:r for r in j['rsvps']}
    st,j,_=anon.req('/api/public/guests?e='+ev['id'])
    ok('public sees initials only', j['going']==3 and j['names'] is False and sorted(g['i'] for g in j['guests'])==['AY','CD'] and all(list(g)==['i'] for g in j['guests']), j)
    ok('no name leaks to the public', 'Yilmaz' not in json.dumps(j) and 'Kaya' not in json.dumps(j))
    st,j,_=anon.req('/api/public/guests?e='+ev['id']+'&p='+rs['Ada Yilmaz']['passToken'])
    ok('pass holder sees names of consenting guests', j['names'] and sorted(g['n'] for g in j['guests'])==['Ada Yilmaz','Can Demir'], j)
    ok('guest who did not consent stays hidden even from pass holders', 'Elif' not in json.dumps(j))
    st,j,_=anon.req('/api/public/guests?e='+ev['id']+'&p=wrong-token'); ok('bad pass -> initials only', j['names'] is False)
    # a pass for another event does not unlock this one
    st,j,_=a.req('/api/hq/events','POST',{'title':'Other','date':'2027-12-25'}); o=j['event']; a.req('/api/hq/events/'+o['id']+'/publish','POST',{})
    anon.req('/api/public/rsvp','POST',{'slug':o['slug'],'name':'Zed Zed','email':'z@example.com','consent':True})
    st,j,_=a.req('/api/hq/rsvps/'+o['id']); z=j['rsvps'][0]; st,j,_=a.req('/api/hq/rsvps/'+o['id']+'/'+z['id']+'/decision','POST',{'decision':'approved'}); zt=j['rsvp']['passToken']
    st,j,_=anon.req('/api/public/guests?e='+ev['id']+'&p='+zt); ok('pass of another event does not unlock names', j['names'] is False, j)
    st,j,_=anon.req('/api/public/pass?t='+rs['Ada Yilmaz']['passToken']); ok('pass response carries event id', j.get('eventId')==ev['id'])
    # private event
    st,j,_=a.req('/api/hq/events','POST',{'title':'Secret','date':'2027-12-26','visibility':'private'}); pv=j['event']; st,j,_=a.req('/api/hq/events/'+pv['id']+'/publish','POST',{}); tok=j['event']['inviteUrl'].split('t=')[1]
    st,j,_=anon.req('/api/public/guests?e='+pv['id']); ok('private list closed without key', st==404, st)
    st,j,_=anon.req('/api/public/guests?e='+pv['id']+'&t='+tok); ok('private list opens with invite key', st==200 and j['enabled'], j)
    # switch off
    a.req('/api/hq/events/'+ev['id'],'PUT',{'invite':{'showGuests':False}})
    st,j,_=anon.req('/api/public/guests?e='+ev['id']+'&p='+rs['Ada Yilmaz']['passToken']); ok('list off -> nothing returned', j=={'enabled':False}, j)
    st,t,_=anon.req('/events/'+ev['slug'],raw=True); ok('list off -> no checkbox, no section', 'showName' not in t and 'g-guests"' not in t)
    # message previews
    st,j,_=anon.req('/api/hq/events/'+ev['id']+'/messages'); ok('previews need login', st==401, st)
    st,j,_=a.req('/api/hq/events/'+ev['id']+'/messages')
    ok('whatsapp invite preview from event', j['whatsapp']['invite']['title']=='More Life Presents: Test Night' and 'Alice, Istanbul' in j['whatsapp']['invite']['line'] and j['whatsapp']['invite']['promo']=='Line one. Line two.', j['whatsapp'])
    ok('templates not claimed ready', j['whatsapp']['inviteReady'] is False and j['whatsapp']['status']['connected'] is False and j['email']['status']['connected'] is False)
    ok('e-mail preview is the real pass mail', 'Your entry pass — More Life Presents: Test Night'==j['email']['pass']['subject'] and 'Open your entry pass' in j['email']['pass']['html'] and 'Hi Ada' in j['email']['pass']['html'])
finally:
    p.terminate()
print(sum(R),'/',len(R)); sys.exit(0 if all(R) else 1)
