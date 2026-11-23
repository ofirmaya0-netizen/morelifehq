# Reminders, self-cancel, waitlist offers, friend links, thank-you note, attendance tag (python3 tests/automation.py).
import sys, os, json, threading, http.server, glob, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
SENT=[]
class Mock(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        b=json.loads(self.rfile.read(int(self.headers['content-length']))); SENT.append(b); self.send_response(200); self.end_headers(); self.wfile.write(b'{"id":"m1"}')
    def log_message(self,*a): pass
m=http.server.ThreadingHTTPServer(('127.0.0.1',8992),Mock); threading.Thread(target=m.serve_forever,daemon=True).start()
os.environ.update(RESEND_API_KEY='re_test', EMAIL_FROM='rsvp@example.com', EMAIL_API_URL='http://127.0.0.1:8992/emails')
from harness import *
IST=datetime.timezone(datetime.timedelta(hours=3))
def at(hours): d=datetime.datetime.now(IST)+datetime.timedelta(hours=hours); return d.strftime('%Y-%m-%d'), d.strftime('%H:%M')
def patch(rid, fn):
    hit=[f for f in glob.glob(ROOT+'/.data/**/*', recursive=True) if os.path.isfile(f) and 'rsvps' in f and rid in f]; assert hit, rid
    j=json.load(open(hit[0])); fn(j); json.dump(j, open(hit[0],'w'))
def subjects(to=None): return [b['subject'] for b in SENT if not to or to in b['to']]
srv=start()
try:
    a=C(); anon=C(); a.req('/api/hq/login','POST',{'email':'admin@example.com','password':'test-password-123'})
    def event(title, hours, **kw):
        d,t=at(hours); st,j,_=a.req('/api/hq/events','POST',{'title':title,'date':d,'time':t,'venue':'Alice','city':'Istanbul',**kw}); assert st==201,(st,j); e=j['event']
        st,j,_=a.req('/api/hq/events/'+e['id']+'/publish','POST',{}); return j['event']
    def rsvp(e, name, **kw):
        [os.remove(f) for f in glob.glob(ROOT+'/.data/**/*', recursive=True) if os.path.isfile(f) and '/rate' in f]  # the per-address request limit is not under test here
        st,j,_=anon.req('/api/public/rsvp','POST',{'slug':e['slug'],'name':name,'email':name.split()[0].lower()+'@example.com','consent':True,**kw}); assert st==200 and j['created'],(st,j)
        st,j,_=a.req('/api/hq/rsvps/'+e['id']); return [r for r in j['rsvps'] if r['name']==name][0]
    def decide(e, r, dec):
        st,j,_=a.req('/api/hq/rsvps/'+e['id']+'/'+r['id']+'/decision','POST',{'decision':dec}); assert st==200,(st,j); return j['rsvp']
    def get(e, name): st,j,_=a.req('/api/hq/rsvps/'+e['id']); return [r for r in j['rsvps'] if r['name']==name][0]
    old=lambda j: j.update(decidedAt='2020-01-01T00:00:00.000Z')

    st,j,_=anon.req('/api/hq/automation/run','POST',{}); ok('automation run needs login', st==401, st)
    # --- reminders
    e1=event('Tomorrow Night', 20, dressCode='All black'); ada=decide(e1, rsvp(e1,'Ada Yilmaz'), 'approved'); pend=rsvp(e1,'Pending Person')
    st,j,_=a.req('/api/hq/automation/run','POST',{}); ok('no reminder right after approval', j['reminders']==0, j)
    patch(ada['id'], old)
    st,j,_=a.req('/api/hq/automation/run','POST',{}); ok('day-before reminder sent once to approved guest', j['reminders']==1 and subjects('ada@example.com').count('Tomorrow: Tomorrow Night')==1, (j,subjects()))
    ok('reminder carries pass link and dress code', any('Dress code: All black' in b['html'] and '/pass?t='+ada['passToken'] in b['html'] for b in SENT if b['subject'].startswith('Tomorrow')))
    st,j,_=a.req('/api/hq/automation/run','POST',{}); ok('second run sends nothing', j['reminders']==0 and 'pending@example.com' not in json.dumps(SENT), j)
    e2=event('Tonight Show', 2); can=decide(e2, rsvp(e2,'Can Demir'), 'approved'); patch(can['id'], old)
    st,j,_=a.req('/api/hq/automation/run','POST',{}); ok('same-day reminder', j['reminders']==1 and 'Tonight: Tonight Show' in subjects('can@example.com'), (j,subjects()))
    e3=event('Quiet Night', 20); a.req('/api/hq/events/'+e3['id'],'PUT',{'invite':{'reminders':False}}); el=decide(e3, rsvp(e3,'Elif Kaya'), 'approved'); patch(el['id'], old)
    st,j,_=a.req('/api/hq/automation/run','POST',{}); ok('reminders off for an event are respected', j['reminders']==0, j)
    # --- friend link
    st,j,_=anon.req('/api/public/pass?t='+ada['passToken']); fu=j['pass']['friendUrl']; ok('pass offers friend link + cancel', fu.startswith('/events/'+e1['slug']+'?ref=') and j['pass']['canCancel'] is True, j)
    fr=rsvp(e1,'Friend One', ref=fu.split('ref=')[1]); ok('request through the link is credited', fr['referredBy']==ada['id'], fr)
    x=rsvp(e1,'No Ref', ref='nonsense'); ok('unknown code credits nobody', x['referredBy']=='')
    y=rsvp(e2,'Wrong Event', ref=fu.split('ref=')[1]); ok('code of another event credits nobody', y['referredBy']=='')
    pv=event('Secret', 50, visibility='private'); z=None
    st,j,_=a.req('/api/hq/events/'+pv['id']); tok=j['event']['inviteUrl'].split('t=')[1]
    anon.req('/api/public/rsvp','POST',{'t':tok,'name':'Priv Guest','email':'priv@example.com','consent':True}); pg=decide(pv, get(pv,'Priv Guest'), 'approved')
    st,j,_=anon.req('/api/public/pass?t='+pg['passToken']); ok('private event: no friend link', j['pass']['friendUrl']=='', j)
    # --- self cancel + waitlist offer
    e4=event('Full House', 60); a.req('/api/hq/events/'+e4['id'],'PUT',{'capacity':1,'invite':{'autoWaitlist':True}})
    g1=decide(e4, rsvp(e4,'Mert Aksoy'), 'approved'); w1=decide(e4, rsvp(e4,'Selin Ozturk'), 'waitlist'); w2=decide(e4, rsvp(e4,'Deniz Ar'), 'waitlist')
    st,j,_=anon.req('/api/public/pass','POST',{'t':'bad','action':'cancel'}); ok('cancel needs a valid pass', st==404)
    st,j,_=anon.req('/api/public/pass','POST',{'t':g1['passToken'],'action':'cancel'}); ok('guest cancels own place', st==200 and get(e4,'Mert Aksoy')['status']=='cancelled' and get(e4,'Mert Aksoy')['cancelledBy']=='guest', j)
    st,j,_=anon.req('/api/public/pass?t='+g1['passToken']); ok('cancelled pass no longer valid', st==404)
    w1=get(e4,'Selin Ozturk'); w2=get(e4,'Deniz Ar')
    ok('first in line is offered the place, second is not', w1.get('offer') and not w2.get('offer') and 'A place has opened — Full House' in subjects('selin@example.com') and not subjects('deniz@example.com'), (w1.get('offer'),subjects()))
    st,j,_=anon.req('/api/public/offer?t='+w1['offer']['token']); ok('offer page data', st==200 and j['name']=='Selin' and j['event']['title']=='Full House', j)
    patch(w1['id'], lambda j: j['offer'].update(expiresAt='2020-01-01T00:00:00.000Z'))
    st,j,_=anon.req('/api/public/offer','POST',{'t':w1['offer']['token']}); ok('lapsed offer cannot be taken', st==410, (st,j))
    st,j,_=a.req('/api/hq/automation/run','POST',{}); w2=get(e4,'Deniz Ar'); ok('lapsed offer passes to the next person', j['offersExpired']==1 and j['offersSent']==1 and w2.get('offer') and get(e4,'Selin Ozturk')['status']=='waitlist', j)
    st,j,_=anon.req('/api/public/offer','POST',{'t':w2['offer']['token']}); ok('offer accepted -> approved with pass', st==200 and j['pass'].startswith('/pass?t=') and get(e4,'Deniz Ar')['status']=='approved', (st,j))
    ok('accepted guest gets the pass mail', 'Your entry pass — Full House' in subjects('deniz@example.com'))
    st,j,_=anon.req('/api/public/offer','POST',{'t':w2['offer']['token']}); ok('offer cannot be used twice', st in (404,409), st)
    e5=event('Manual Only', 60); h1=decide(e5, rsvp(e5,'Hale Su'), 'approved'); h2=decide(e5, rsvp(e5,'Ilke Tan'), 'waitlist')
    anon.req('/api/public/pass','POST',{'t':h1['passToken'],'action':'cancel'}); ok('waitlist automation is off unless switched on', not get(e5,'Ilke Tan').get('offer') and not subjects('ilke@example.com'))
    a.req('/api/hq/events/'+e2['id'],'PUT',{'invite':{'selfCancel':False}}); st,j,_=anon.req('/api/public/pass','POST',{'t':can['passToken'],'action':'cancel'}); ok('self-cancel can be switched off', st==403 and get(e2,'Can Demir')['status']=='approved', st)
    # --- attendance tag + thank-you
    e6=event('Last Night', -20, galleryUrl='https://photos.example.com/last-night'); k1=decide(e6, rsvp(e6,'Kaan Er'), 'approved'); k2=decide(e6, rsvp(e6,'Lale Oz'), 'approved')
    st,j,_=a.req('/api/hq/checkin','POST',{'eventId':e6['id'],'token':k1['passToken']}); ok('checked in', j['result']=='ok', j)
    st,j,_=a.req('/api/hq/contacts'); kc=[c for c in j['contacts'] if c['email']=='kaan@example.com'][0]; ok('attendee tagged in CRM', 'katıldı' in kc['tags'] and 'katıldı' not in [c for c in j['contacts'] if c['email']=='lale@example.com'][0]['tags'], kc)
    st,j,_=a.req('/api/hq/automation/run','POST',{}); ok('thank-you goes only to who came, with gallery', j['thanks']==1 and 'Thank you — Last Night' in subjects('kaan@example.com') and not [s for s in subjects('lale@example.com') if s.startswith('Thank')] and any('photos.example.com' in b['html'] for b in SENT if b['subject'].startswith('Thank')), (j,subjects()))
    st,j,_=a.req('/api/hq/automation/run','POST',{}); ok('thank-you sent once', j['thanks']==0, j)
    st,j,_=a.req('/api/hq/contacts/'+kc['id']); ok('contact history marks past events', j['history'][0]['past'] is True and j['history'][0]['checkedInAt'], j['history'])
    # --- page details + previews
    e7=event('Details', 100, dressCode='All black', listenUrl='https://open.spotify.com/artist/x', artist='Nick Jojo')
    st,t,_=anon.req('/events/'+e7['slug'],raw=True); ok('page shows dress code, directions, listen', 'Dress code: All black' in t and 'google.com/maps/search' in t and 'href="https://open.spotify.com/artist/x"' in t)
    st,j,_=a.req('/api/hq/events','POST',{'title':'Bad','listenUrl':'javascript:alert(1)'}); ok('listen link must be https', st==400, st)
    st,j,_=a.req('/api/hq/events/'+e4['id']+'/messages'); ok('five mail previews, switches reflected', [x['key'] for x in j['email']['all']]==['pass','d1','h4','offer','thanks'] and j['email']['all'][3]['on'] is True, [ (x['key'],x['on']) for x in j['email']['all']])
finally:
    srv.terminate()
print(sum(R),'/',len(R)); sys.exit(0 if all(R) else 1)
