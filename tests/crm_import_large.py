# Large CSV import goes up in windows and never creates a person twice (python3 tests/crm_import_large.py).
import sys, os, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import *
srv=start()
def run(a, rows, commit, size=250):
    tot={'new':0,'match':0,'conflict':0,'duplicateInFile':0,'invalid':0}; created=updated=calls=0; frm=0; slow=0
    while frm is not None:
        t=time.time(); st,j,_=a.req('/api/hq/contacts/import','POST',{'rows':rows,'commit':commit,'from':frm,'size':size}); slow=max(slow,time.time()-t)
        assert st==200, (st,j)
        for k in tot: tot[k]+=j['totals'][k]
        created+=j.get('created',0); updated+=j.get('updated',0); frm=j['next']; calls+=1
    return tot,created,updated,calls,slow
try:
    a=C(); a.req('/api/hq/login','POST',{'email':'admin@example.com','password':'test-password-123'})
    N=2318
    rows=[{'name':'Kişi %d'%i,'email':'kisi%d@example.com'%i,'phone':'0532%07d'%i,'source':'Weeztix','tags':'bodrum','notes':'n'} for i in range(N)]
    rows[2000]=dict(rows[3]); rows[2001]={'name':'','email':''}; rows[2002]={'name':'Bozuk','email':'x@'}  # a repeat far from its original, two bad rows
    tot,_,_,calls,slow=run(a,rows,False); ok('preview in windows: totals over the whole file', tot=={'new':N-3,'match':0,'conflict':0,'duplicateInFile':1,'invalid':2} and calls==10, (tot,calls))
    st,j,_=a.req('/api/hq/contacts'); ok('preview writes nothing', len(j['contacts'])==0, len(j['contacts']))
    tot,created,updated,calls,slow=run(a,rows,True); ok('commit creates every new person once', created==N-3 and updated==0, (created,updated))
    st,j,_=a.req('/api/hq/contacts'); cs=j['contacts']; ok('all people listed, e-mails unique', len(cs)==N-3 and len(set(c['email'] for c in cs))==N-3, len(cs))
    tot,created,updated,_,_=run(a,rows,True); ok('running the same file again adds nobody', created==0 and tot['match']==N-3 and updated==0, (tot,created,updated))
    rows2=[dict(r,tags='bodrum, vip') for r in rows[:300]]+[{'name':'Yeni','email':'yeni@example.com'}]
    tot,created,updated,_,_=run(a,rows2,True); st,j,_=a.req('/api/hq/contacts'); ok('matches only gain new tags', created==1 and updated==300 and len(j['contacts'])==N-2 and sum('vip' in c['tags'] for c in j['contacts'])==300, (created,updated))
    # an import that died after the index write but before the record: the next run completes that person
    st,j,_=a.req('/api/hq/contacts/import','POST',{'rows':[{'name':'Tek','email':'tek@example.com','phone':'05321112233'}],'commit':True}); st,j,_=a.req('/api/hq/contacts'); one=[c for c in j['contacts'] if c['email']=='tek@example.com'][0]
    import glob
    for f in glob.glob(ROOT+'/.data/contacts*'+one['id']): os.remove(f)
    st,j,_=a.req('/api/hq/contacts/import','POST',{'rows':[{'name':'Tek','email':'tek@example.com','phone':'05321112233'}],'commit':True}); st,j2,_=a.req('/api/hq/contacts'); back=[c for c in j2['contacts'] if c['email']=='tek@example.com']
    ok('half-written person is completed, not lost or doubled', j['created']==1 and len(back)==1 and back[0]['id']==one['id'], (j,len(back)))
    st,j,_=a.req('/api/hq/contacts/import','POST',{'rows':['x',None,5],'commit':False}); ok('junk rows are invalid, not a server error', st==200 and j['totals']['invalid']==3, (st,j))
finally:
    srv.terminate()
print(sum(R),'/',len(R),'passed'); print(open('/tmp/dev.err').read()[-1500:])
sys.exit(0 if all(R) else 1)
