# Incoming WhatsApp messages: Bird's signed webhook → HQ → reply (python3 tests/inbox.py).
import sys, os, json, threading, http.server, hmac, hashlib, base64, time, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
SUBS=[]; SENT=[]; DEL=[]; LISTED=[]; HIST=[]; OUT=[]
class Mock(http.server.BaseHTTPRequestHandler):
    def _out(self,code,obj): self.send_response(code); self.end_headers(); self.wfile.write(json.dumps(obj).encode())
    def do_GET(self):
        if '/messages' in self.path:
            LISTED.append(self.path); second='pageToken=p2' in self.path
            if 'direction=outgoing' in self.path: return self._out(200,{'results':OUT})
            return self._out(200,{'results':HIST[25:] if second else HIST[:25], **({} if second else {'nextPageToken':'p2'})})
        self._out(200,{'results':[{'id':'ch-wa','platformId':'whatsapp','name':'WhatsApp','status':'active'}]})
    def do_DELETE(self): DEL.append(self.path); self.send_response(204); self.end_headers()
    def do_POST(self):
        b=json.loads(self.rfile.read(int(self.headers['content-length'])))
        if self.path.endswith('/webhook-subscriptions'): SUBS.append(b); return self._out(201,{'id':'sub-%d'%len(SUBS)})
        SENT.append((self.path,b)); self._out(202,{'id':'out%d'%len(SENT),'status':'accepted'})
    def log_message(self,*a): pass
m=http.server.ThreadingHTTPServer(('127.0.0.1',8992),Mock); threading.Thread(target=m.serve_forever,daemon=True).start()
os.environ.update(BIRD_ACCESS_KEY='bk_test', BIRD_WORKSPACE_ID='ws1', BIRD_API_URL='http://127.0.0.1:8992')
from harness import *
import urllib.request
URL=B+'/api/public/wa-hook'
def hook(payload, key, url=URL, raw=None):
    body=raw if raw is not None else json.dumps(payload).encode(); ts=str(int(time.time()))
    sig=base64.b64encode(hmac.new(key.encode(), (ts+'\n'+url+'\n').encode()+hashlib.sha256(body).digest(), hashlib.sha256).digest()).decode()
    r=urllib.request.Request(URL, data=body, method='POST', headers={'content-type':'application/json','messagebird-signature':sig,'messagebird-request-timestamp':ts})
    try: resp=urllib.request.build_opener(urllib.request.ProxyHandler({})).open(r)
    except urllib.error.HTTPError as e: resp=e
    t=resp.read().decode()
    try: return resp.status, json.loads(t)
    except Exception: return resp.status, t
def inbound(mid, phone, text, name='Ayşe', at=None, typ='text'):
    body={'type':typ, typ:({'text':text} if typ=='text' else {'images':[{'mediaUrl':'https://x/y.jpg'}],'text':text})}
    return {'service':'channels','event':'whatsapp.inbound','payload':{'id':mid,'channelId':'ch-wa','sender':{'contact':{'id':'c1','identifierKey':'phonenumber','identifierValue':phone,'annotations':{'name':name}}},'receiver':{'connector':{'id':'x'}},'body':body,'direction':'incoming','createdAt':at or datetime.datetime.utcnow().isoformat()+'Z'}}
srv=start()
try:
    a=C(); anon=C(); a.req('/api/hq/login','POST',{'email':'admin@example.com','password':'test-password-123'})
    st,_,_=anon.req('/api/hq/inbox'); ok('anon cannot read the inbox', st==401, st)
    st,j=hook(inbound('m0','+905321112233','hi'),'whatever'); ok('hook refuses everything before it is connected', st==503, (st,j))
    st,j,_=a.req('/api/hq/inbox'); ok('inbox starts empty and not connected', st==200 and j['threads']==[] and not j['hook']['connected'], j)
    st,j,_=a.req('/api/hq/inbox/connect','POST',{}); sub=SUBS[-1] if SUBS else {}
    ok('connect: subscription for inbound WhatsApp on this channel, pointing at the hook', st==200 and j['hook']['connected'] and sub.get('service')=='channels' and sub.get('event')=='whatsapp.inbound' and sub.get('url')==URL and sub.get('eventFilters')==[{'key':'channelId','value':'ch-wa'}] and len(sub.get('signingKey',''))>=40, (st,j,sub))
    KEY=sub['signingKey']
    st,j,_=a.req('/api/hq/inbox'); ok('signing key is never returned', KEY not in json.dumps(j))
    st,j,_=a.req('/api/hq/settings'); ok('signing key is not in settings either', KEY not in json.dumps(j))
    st,j=hook(inbound('m1','+905321112233','hi'),'wrong-key'); ok('wrong signature refused', st==401, (st,j))
    st,j=hook(inbound('m1','+905321112233','hi'),KEY,url='http://evil.example/api/public/wa-hook'); ok('signature for another URL refused', st==401, (st,j))
    a.req('/api/hq/contacts','POST',{'name':'Ayşe Yılmaz','email':'ayse@example.com','phone':'0532 111 22 33'})
    st,j=hook(inbound('m1','+905321112233','Merhaba, yarın kaçta başlıyor?'),KEY); ok('signed message stored', st==200 and j.get('stored') is True, (st,j))
    st,j=hook(inbound('m1','+905321112233','Merhaba, yarın kaçta başlıyor?'),KEY); ok('same message delivered twice is stored once', st==200 and j.get('stored') is False, (st,j))
    st,j=hook({'service':'channels','event':'whatsapp.outbound','payload':{'id':'o9'}},KEY); ok('other events acknowledged, not stored', st==200 and j.get('stored') is False, (st,j))
    st,j=hook(None,KEY,raw=b'not json'); ok('signed junk does not break the hook', st==200 and j.get('stored') is False, (st,j))
    st,j,_=a.req('/api/hq/inbox'); t=j['threads'][0] if j['threads'] else {}
    ok('one unread conversation, matched to the CRM contact', len(j['threads'])==1 and t['unread'] and t['phone']=='+905321112233' and t['contactName']=='Ayşe Yılmaz' and t['lastText'].startswith('Merhaba'), j)
    st,j,_=a.req('/api/hq/summary'); ok('summary counts the unread conversation', j['unreadMessages']==1, j.get('unreadMessages'))
    st,j,_=a.req('/api/hq/inbox/'+t['key']); ok('conversation opens with its message; reply window open', st==200 and len(j['messages'])==1 and j['messages'][0]['dir']=='in' and j['canReply'], j)
    st,j,_=a.req('/api/hq/inbox/'+t['key']+'/reply','POST',{'text':'  '}); ok('empty reply refused', st==400, st)
    st,j,_=a.req('/api/hq/inbox/'+t['key']+'/reply','POST',{'text':'Kapılar 17:00’de açılıyor.'}); p,b=SENT[-1] if SENT else ('',{})
    ok('reply goes out as free text on the channel to that number', st==200 and p=='/workspaces/ws1/channels/ch-wa/messages' and b['receiver']['contacts'][0]['identifierValue']=='+905321112233' and b['body']=={'type':'text','text':{'text':'Kapılar 17:00’de açılıyor.'}}, (st,j,b))
    st,j,_=a.req('/api/hq/inbox'); ok('replying marks the conversation read', not j['threads'][0]['unread'] and j['threads'][0]['lastDir']=='out', j['threads'][0])
    st,j=hook(inbound('m2','+905321112233','bak','Ayşe',typ='image'),KEY); st,j,_=a.req('/api/hq/inbox'); ok('image shown by type and caption; unread again', j['threads'][0]['unread'] and j['threads'][0]['lastText']=='[Görsel] bak', j['threads'][0])
    st,j,_=a.req('/api/hq/inbox/'+t['key']+'/read','POST',{}); st,j,_=a.req('/api/hq/summary'); ok('mark read clears the count', j['unreadMessages']==0, j.get('unreadMessages'))
    st,j=hook(inbound('m3','+905321112233',' Stop '),KEY); st,j,_=a.req('/api/hq/contacts'); c=[x for x in j['contacts'] if x['email']=='ayse@example.com'][0]
    ok('STOP tags the contact so invitations skip them', 'mesaj-istemiyor' in c['tags'], c)
    old=(datetime.datetime.utcnow()-datetime.timedelta(hours=30)).isoformat()+'Z'
    st,j=hook(inbound('m4','+447700900123','hello','Sam',at=old),KEY); st,j,_=a.req('/api/hq/inbox'); t2=[x for x in j['threads'] if x['phone']=='+447700900123'][0]
    ok('unknown number gets its own conversation, not a CRM contact', len(j['threads'])==2 and t2['contactId']=='' and t2['name']=='Sam', j)
    n=len(SENT); st,j,_=a.req('/api/hq/inbox/'+t2['key']+'/reply','POST',{'text':'hi'}); ok('reply after 24 hours refused, nothing sent', st==409 and len(SENT)==n, (st,j))
    st,j=hook({'type':'whatsapp.received','timestamp':datetime.datetime.utcnow().isoformat()+'Z','data':{'whatsapp_id':'wam_1','direction':'inbound','from':{'phone_number':'+14155550100','display_name':'Alex'},'to':{'phone_number':'+1'},'text':{'body':'new shape'}}},KEY)
    st2,j2,_=a.req('/api/hq/inbox'); ok('Bird’s newer payload shape is read too', j.get('stored') is True and any(x['phone']=='+14155550100' and x['lastText']=='new shape' for x in j2['threads']), (j,j2))
    ago=lambda h:(datetime.datetime.utcnow()-datetime.timedelta(hours=h)).isoformat()+'Z'
    HIST.extend([inbound('h%d'%i,'+9055500000%02d'%i,'eski %d'%i,'Eski',at=ago(200+i))['payload'] for i in range(25)])
    HIST.extend([inbound('m1','+905321112233','Merhaba, yarın kaçta başlıyor?')['payload'], inbound('h90','+905559990001','dün yazdım','Deniz',at=ago(2))['payload'], inbound('h91','+905559990001','önce',at=ago(50))['payload'], dict(inbound('h92','+905559990002','giden')['payload'],direction='outgoing')])
    before=len(a.req('/api/hq/inbox')[1]['threads']); st,p1,_=a.req('/api/hq/inbox/import','POST',{'pageToken':''}); st2,p2,_=a.req('/api/hq/inbox/import','POST',{'pageToken':p1.get('nextPageToken','')})
    ok('history is read from Bird page by page, incoming only', st==200 and p1['stored']==25 and p1['nextPageToken']=='p2' and 'direction=incoming' in LISTED[0] and 'pageToken=p2' in LISTED[1] and p2['nextPageToken']=='', (p1,p2,LISTED))
    ok('second page: already stored and outgoing ones skipped', p2['read']==4 and p2['stored']==2, p2)
    st,j,_=a.req('/api/hq/inbox'); th={x['phone']:x for x in j['threads']}
    ok('old history arrives read; one inside 24 hours is unread', len(j['threads'])==before+26 and not th['+905550000003']['unread'] and th['+905559990001']['unread'] and th['+905559990001']['lastText']=='dün yazdım', (len(j['threads']),before))
    st,p3,_=a.req('/api/hq/inbox/import','POST',{}); ok('loading again adds nothing', p3['stored']==0, p3)
    a.req('/api/hq/whatsapp/settings','PUT',{'invite':{'projectId':'aaaaaaaa-0000-0000-0000-000000000001','version':'bbbbbbbb-0000-0000-0000-000000000001'}})
    rc=lambda ph:{'contacts':[{'identifierValue':ph,'identifierKey':'phonenumber'}]}
    OUT.extend([{'id':'o1','direction':'outgoing','status':'delivered','receiver':rc('+905559990001'),'createdAt':ago(60),'template':{'projectId':'aaaaaaaa-0000-0000-0000-000000000001','version':'x','parameters':[{'key':'name','value':'Deniz'},{'key':'title','value':'Santa’s Guestlist'},{'key':'line','value':'19 December 2026 · 22:00'},{'key':'token','value':'secret-token'}]},'body':{}},
      {'id':'o2','direction':'outgoing','status':'delivered','receiver':rc('+905559990001'),'createdAt':ago(1),'body':{'type':'text','text':{'text':'Bird’den yazılan yanıt'}}},
      {'id':'o3','direction':'outgoing','status':'delivered','receiver':rc('+905558887766'),'createdAt':ago(60),'template':{'projectId':'zz','version':'x','parameters':[{'key':'event','value':'WA Night'}]}},
      {'id':'o4','direction':'outgoing','status':'sending_failed','receiver':rc('+905559990001'),'createdAt':ago(3),'body':{'type':'text','text':{'text':'gitmedi'}}}])
    n0=len(a.req('/api/hq/inbox')[1]['threads']); st,po,_=a.req('/api/hq/inbox/import','POST',{'direction':'outgoing'}); st,j,_=a.req('/api/hq/inbox'); dz=[x for x in j['threads'] if x['phone']=='+905559990001'][0]
    ok('sent messages are loaded; a failed one is not; a number that never wrote gets no conversation', po['stored']==3 and len(j['threads'])==n0 and 'direction=outgoing' in LISTED[-1], (po,len(j['threads']),n0))
    st,j,_=a.req('/api/hq/inbox/'+dz['key']); ms=j['messages']; tp=[x for x in ms if x['kind']=='template']
    ok('template sits in the conversation in time order, named by what it was about, without its link key', [x['birdId'] for x in ms]==['o1','h91','h90','o2'] and tp[0]['dir']=='out' and tp[0]['text']=='Davet: Santa’s Guestlist · 19 December 2026 · 22:00' and 'secret-token' not in json.dumps(ms), ms)
    ok('conversation shows the later reply last and stays unread', dz['lastDir']=='out' and dz['lastText'].startswith('Bird’den') and dz['unread'], dz)
    st,po,_=a.req('/api/hq/inbox/import','POST',{'direction':'outgoing'}); ok('loading sent messages again adds nothing', po['stored']==0, po)
    hook(inbound('n1','+905558887766','ben de geliyorum','Can'),KEY); st,j,_=a.req('/api/hq/inbox'); cn=[x for x in j['threads'] if x['phone']=='+905558887766'][0]; st,j,_=a.req('/api/hq/inbox/'+cn['key'])
    ok('when that number writes, the earlier template is already in its history', [x['birdId'] for x in j['messages']]==['o3','n1'] and j['messages'][0]['text']=='Şablon mesajı: WA Night', j['messages'])
    n=len(SENT); st,j,_=a.req('/api/hq/whatsapp/test','POST',{'to':'+905558887766','projectId':'aaaaaaaa-0000-0000-0000-000000000001','version':'bbbbbbbb-0000-0000-0000-000000000001','parameters':{'title':'Yeni Gece','line':'1 January 2027'}}); st2,j2,_=a.req('/api/hq/inbox/'+cn['key'])
    ok('a template sent from HQ is written to the conversation as it goes out', st==200 and len(SENT)==n+1 and j2['messages'][-1]['kind']=='template' and j2['messages'][-1]['text']=='Davet: Yeni Gece · 1 January 2027', (st,j2['messages'][-1]))
    st,j,_=a.req('/api/hq/audit'); ok('connect and reply are in the record of actions', any('gelen mesaj' in x['action'] for x in j['entries']) and any('yanıtladı' in x['action'] for x in j['entries']), [x['action'] for x in j.get('entries',[])][:8])
    st,j,_=a.req('/api/hq/inbox/connect','POST',{}); ok('reconnect removes the old subscription and makes a new key', st==200 and DEL[-1].endswith('/webhook-subscriptions/sub-1') and SUBS[-1]['signingKey']!=KEY, (st,DEL))
    st,j=hook(inbound('m5','+905321112233','x'),KEY); ok('old key stops working after reconnect', st==401, st)
    st,j,_=a.req('/api/hq/inbox/connect','DELETE'); st2,j2=hook(inbound('m6','+905321112233','x'),SUBS[-1]['signingKey']); ok('disconnect: subscription removed, hook closed', st==200 and not j['hook']['connected'] and st2==503, (st,j,st2))
finally:
    srv.terminate()
print(sum(R),'/',len(R),'passed'); sys.exit(0 if all(R) else 1)
