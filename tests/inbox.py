# Incoming WhatsApp messages: Bird's signed webhook → HQ → reply (python3 tests/inbox.py).
import sys, os, json, threading, http.server, hmac, hashlib, base64, time, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
SUBS=[]; SENT=[]; DEL=[]
class Mock(http.server.BaseHTTPRequestHandler):
    def _out(self,code,obj): self.send_response(code); self.end_headers(); self.wfile.write(json.dumps(obj).encode())
    def do_GET(self): self._out(200,{'results':[{'id':'ch-wa','platformId':'whatsapp','name':'WhatsApp','status':'active'}]})
    def do_DELETE(self): DEL.append(self.path); self.send_response(204); self.end_headers()
    def do_POST(self):
        b=json.loads(self.rfile.read(int(self.headers['content-length'])))
        if self.path.endswith('/webhook-subscriptions'): SUBS.append(b); return self._out(201,{'id':'sub-%d'%len(SUBS)})
        SENT.append((self.path,b)); self._out(202,{'id':'out1','status':'accepted'})
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
    st,j,_=a.req('/api/hq/audit'); ok('connect and reply are in the record of actions', any('gelen mesaj' in x['action'] for x in j['entries']) and any('yanıtladı' in x['action'] for x in j['entries']), [x['action'] for x in j.get('entries',[])][:8])
    st,j,_=a.req('/api/hq/inbox/connect','POST',{}); ok('reconnect removes the old subscription and makes a new key', st==200 and DEL[-1].endswith('/webhook-subscriptions/sub-1') and SUBS[-1]['signingKey']!=KEY, (st,DEL))
    st,j=hook(inbound('m5','+905321112233','x'),KEY); ok('old key stops working after reconnect', st==401, st)
    st,j,_=a.req('/api/hq/inbox/connect','DELETE'); st2,j2=hook(inbound('m6','+905321112233','x'),SUBS[-1]['signingKey']); ok('disconnect: subscription removed, hook closed', st==200 and not j['hook']['connected'] and st2==503, (st,j,st2))
finally:
    srv.terminate()
print(sum(R),'/',len(R),'passed'); sys.exit(0 if all(R) else 1)
