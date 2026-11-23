import json, os, subprocess, time, shutil, urllib.request, urllib.error, sys, threading
B='http://localhost:8888'; ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
class C:
    def __init__(s): s.cookie=''
    def req(s, path, method='GET', data=None, headers=None, raw=False):
        h={'x-hq':'1','user-agent':'Mozilla/5.0 test'}; h.update(headers or {})
        if s.cookie: h['cookie']=s.cookie
        d=None
        if data is not None: d=json.dumps(data).encode(); h['content-type']='application/json'
        r=urllib.request.Request(B+path, data=d, method=method, headers=h)
        class NoRedir(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*a,**k): return None
        op=urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedir)
        try: resp=op.open(r)
        except urllib.error.HTTPError as e: resp=e
        body=resp.read(); sc=resp.headers.get('set-cookie')
        if sc and 'hq_s=' in sc: s.cookie=sc.split(';')[0]
        txt=body.decode('utf8','replace')
        try: j=json.loads(txt)
        except Exception: j=None
        return resp.status, (txt if raw or j is None else j), resp.headers
R=[]
def ok(name, cond, extra=''):
    R.append(bool(cond)); print(('PASS ' if cond else 'FAIL ')+name+((' — '+str(extra)[:300]) if not cond and extra!='' else ''))
def start():
    shutil.rmtree(ROOT+'/.data', ignore_errors=True)
    env=dict(os.environ, HQ_ADMIN_EMAIL='admin@example.com', HQ_ADMIN_PASSWORD='test-password-123', PORT='8888')
    for k in ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy']: env.pop(k,None)
    p=subprocess.Popen(['node','scripts/dev-server.mjs'],cwd=ROOT,env=env,stdout=subprocess.DEVNULL,stderr=open('/tmp/dev.err','w')); time.sleep(1.5); return p
