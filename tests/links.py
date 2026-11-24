# Link-in-bio page (/links): page served, sign-ups reach the CRM with their source, link presses are counted (python3 tests/links.py).
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import *
srv=start()
try:
    a=C(); anon=C(); a.req('/api/hq/login','POST',{'email':'admin@example.com','password':'test-password-123'})
    st,t,_=anon.req('/links',raw=True); ok('links page served', st==200 and 'Guest List' in t and '/api/public/linkhit' in t and 'claude.ai' not in t and 'godaddy' not in t, st)
    q={'kind':'community','name':'Deniz Ak','email':'Deniz@Example.com','phone':'0532 111 22 33','instagram':'@denizak','city':'all','consent':True,'analyticsPath':'/links','website':''}
    st,j,_=anon.req('/api/public/enquiries','POST',{**q,'consent':False}); ok('bio sign-up needs consent', st==400, st)
    st,j,_=anon.req('/api/public/enquiries','POST',q); ok('bio sign-up saved', st==200 and j=={'ok':True}, (st,j))
    st,j,_=a.req('/api/hq/contacts'); c=[x for x in j['contacts'] if x['email']=='deniz@example.com']
    ok('bio sign-up is a CRM contact with source, tags, phone and handle', len(c)==1 and c[0]['source']=='Link sayfası (Instagram bio)' and c[0]['tags']==['community','instagram-bio'] and c[0]['phone']=='0532 111 22 33' and c[0]['instagram']=='denizak', c)
    anon.req('/api/public/enquiries','POST',{'kind':'community','name':'Ali','email':'ali@example.com','city':'all','consent':True})
    anon.req('/api/public/enquiries','POST',{**q,'name':'Ali','email':'ali@example.com','phone':'','instagram':''})
    st,j,_=a.req('/api/hq/contacts'); c=[x for x in j['contacts'] if x['email']=='ali@example.com']
    ok('known contact only gains the bio tag; nothing overwritten', len(c)==1 and c[0]['tags']==['community','instagram-bio'] and c[0]['source']=='Site formu: Community kaydı', c)
    for body in [{'k':'view'},{'k':'view'},{'k':'click','l':'tickets'},{'k':'click','l':'tickets'},{'k':'click','l':'Instagram'},{'k':'click','l':'view'},{'k':'click','l':'../x y'},{'k':'click','l':''}]:
        st,j,_=anon.req('/api/public/linkhit','POST',body)
    anon.req('/api/public/linkhit','POST',{'k':'view'},headers={'user-agent':'Googlebot'})
    st,j,_=a.req('/api/hq/marketing'); L=j.get('links')
    ok('HQ marketing counts views, presses per link and sign-ups', L=={'views':2,'signups':2,'clicks':[{'label':'tickets','n':2},{'label':'instagram','n':1},{'label':'xy','n':1}]}, L)
    st,j,_=anon.req('/api/hq/marketing'); ok('anon cannot read the report', st==401, st)
finally:
    srv.terminate()
print(sum(R),'/',len(R),'passed'); sys.exit(0 if all(R) else 1)
