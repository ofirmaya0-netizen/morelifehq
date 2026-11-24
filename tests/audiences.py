# CRM audiences: rule-based segments, live preview, CSV export (python3 tests/audiences.py). UI part needs Playwright (UI=1).
import sys, os, asyncio
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import *
srv=start()
try:
    a=C(); anon=C(); a.req('/api/hq/login','POST',{'email':'admin@example.com','password':'test-password-123'})
    P=[('Ada','ada@x.com','05321110001','vip, bodrum','Weeztix'),('Bora','bora@x.com','','vip','Weeztix'),('Cem','','05321110003','bodrum','Elle'),('Derin','derin@x.com','05321110004','vip, bodrum, basın','Elle'),('Ece','ece@x.com','05321110005','','Weeztix')]
    ids={}
    for n,e,p,t,s in P: st,j,_=a.req('/api/hq/contacts','POST',{'name':n,'email':e,'phone':p,'tags':t,'source':s}); ids[n]=j['contact']['id']
    def prev(**r): return a.req('/api/hq/audiences/preview','POST',{'rules':r})[1]
    ok('anon cannot read audiences', anon.req('/api/hq/audiences')[0]==401)
    ok('no rules = everyone', prev()['count']==5)
    ok('any of tags', prev(tags=['vip','bodrum'])['count']==4)
    ok('all of tags', prev(tags=['vip','bodrum'],tagMode='all')['count']==2)
    ok('exclude tag', prev(tags=['vip'],exclude=['basın'])['count']==2)
    ok('source', prev(source='Weeztix')['count']==3)
    j=prev(reach='phone'); ok('reach: phone', j['count']==4 and j['phone']==4 and j['email']==3, j)
    ok('reach: both', prev(reach='both')['count']==3)
    # event participation
    st,j,_=a.req('/api/hq/events','POST',{'title':'Gece','date':'2027-06-16','time':'22:00','venue':'V','city':'Bodrum'}); eid=j['event']['id']; a.req('/api/hq/events/'+eid+'/publish','POST',{})
    st,ev,_=a.req('/api/hq/events/'+eid); tok=ev['event']['inviteToken']; slug=ev['event']['slug']
    rs={}
    for n,e in [('Ada','ada@x.com'),('Bora','bora@x.com'),('Ece','ece@x.com')]:
        st,j,_=anon.req('/api/public/rsvp','POST',{'slug':slug,'invite':tok,'name':n,'email':e,'guests':1,'consent':True}); rs[n]=j
    st,lst,_=a.req('/api/hq/rsvps/'+eid); rows=lst.get('rsvps',[])
    by={r['name']:r for r in rows}
    ok('rsvps created', len(by)==3, (rs,lst if not rows else ''))
    for n in ['Ada','Bora']: a.req('/api/hq/rsvps/'+eid+'/'+by[n]['id']+'/decision','POST',{'decision':'approved'})
    a.req('/api/hq/checkin','POST',{'eventId':eid,'rsvpId':by['Ada']['id']})
    ok('event: applied', prev(eventId=eid,eventState='applied')['count']==3, prev(eventId=eid,eventState='applied'))
    ok('event: approved', prev(eventId=eid,eventState='approved')['count']==2, prev(eventId=eid,eventState='approved'))
    ok('event: attended', prev(eventId=eid,eventState='attended')['sample']==['Ada'], prev(eventId=eid,eventState='attended'))
    ok('event: approved no-show', prev(eventId=eid,eventState='noshow')['sample']==['Bora'])
    ok('event: did not apply', prev(eventId=eid,eventState='none')['count']==2)
    ok('preview saves nothing', a.req('/api/hq/audiences')[1]['audiences']==[])
    # save / list / members / csv / edit / delete
    ok('name required', a.req('/api/hq/audiences','POST',{'name':' ','rules':{}})[0]==400)
    ok('unknown event refused', a.req('/api/hq/audiences','POST',{'name':'X','rules':{'eventId':'nope'}})[0]==400)
    st,j,_=a.req('/api/hq/audiences','POST',{'name':'Bodrum VIP','note':'yaz','rules':{'tags':['VIP','bodrum'],'tagMode':'all','reach':'phone'}}); aid=j['audience']['id']; ok('created, tags normalised', st==201 and j['audience']['rules']['tags']==['vip','bodrum'], j)
    st,j,_=a.req('/api/hq/audiences'); A=j['audiences'][0]; ok('list carries sizes and options', A['count']==2 and A['phone']==2 and j['total']==5 and j['options']['tags'][0]['name'] in ('vip','bodrum') and {x['name'] for x in j['options']['sources']}=={'Weeztix','Elle'} and j['options']['events'][0]['id']==eid, j)
    st,j,_=a.req('/api/hq/audiences/'+aid); ok('members', [m['name'] for m in j['members']]==['Ada','Derin'], j)
    a.req('/api/hq/contacts','POST',{'name':'Fulya','phone':'05321110006','tags':'vip, bodrum'}); st,j,_=a.req('/api/hq/audiences/'+aid); ok('a new matching contact joins by itself', [m['name'] for m in j['members']]==['Ada','Derin','Fulya'])
    st,t,h=a.req('/api/hq/audiences/'+aid+'.csv',raw=True); ok('csv export', st==200 and 'kitle-bodrum-vip.csv' in h.get('content-disposition','') and t.count('\r\n')==3 and 'Derin' in t and 'Bora' not in t, t)
    st,j,_=a.req('/api/hq/audiences/'+aid,'PUT',{'name':'Bodrum','rules':{'tags':['bodrum']}}); st,j,_=a.req('/api/hq/audiences/'+aid); ok('edit', j['audience']['name']=='Bodrum' and j['audience']['count']==4 and j['audience']['note']=='yaz', j['audience'])
    st,_,_=a.req('/api/hq/audiences/'+aid,'DELETE'); ok('delete removes the audience, not the people', a.req('/api/hq/audiences/'+aid)[0]==404 and len(a.req('/api/hq/contacts')[1]['contacts'])==6)
    if os.environ.get('UI'):
        from playwright.async_api import async_playwright
        SHOT=os.environ.get('SHOTS','')
        async def ui():
            async with async_playwright() as p:
                b=await p.chromium.launch(); errs=[]; pg=await (await b.new_context(viewport={'width':1360,'height':900})).new_page()
                pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' and 'Failed to load resource' not in m.text else None)
                await pg.goto(B+'/hq?view=crm'); await pg.fill('#email','admin@example.com'); await pg.fill('#password','test-password-123'); await pg.click('#go')
                await pg.wait_for_selector('.tabs'); await pg.click('.tabs button:has-text("Kitleler")'); await pg.wait_for_selector('.empty'); ok('tab opens the empty state', 'tab=kitleler' in pg.url)
                if SHOT: await pg.screenshot(path=SHOT+'/a1-empty.png')
                await pg.click('#a-new'); await pg.wait_for_selector('#a-live .astats'); ok('builder starts with everyone', '6 kişi' in (await pg.inner_text('#a-live')).replace('\n',' '), await pg.inner_text('#a-live'))
                await pg.fill('#f-name','Bodrum VIP'); await pg.click('.chips label:has(input[data-chip=tags][value=vip])'); await pg.click('.chips label:has(input[data-chip=tags][value=bodrum])'); await pg.select_option('#f-tagMode','all')
                await pg.wait_for_function("document.querySelector('#a-live').innerText.replace(/\\s+/g,' ').includes('3 kişi')"); ok('live count follows the rules', True)
                ok('event state disabled until an event is chosen', await pg.is_disabled('#f-eventState'))
                if SHOT: await pg.screenshot(path=SHOT+'/a2-builder.png')
                await pg.click('button[form=af]'); await pg.wait_for_selector('.aud'); t=(await pg.inner_text('.aud')).replace('\n',' '); ok('card shows rules and sizes', 'Bodrum VIP' in t and 'bodrum ve vip' in t and '3 kişi' in t, t)
                if SHOT: await pg.screenshot(path=SHOT+'/a3-list.png')
                await pg.click('.aud'); await pg.wait_for_selector('.drawer table'); ok('members listed', await pg.locator('.drawer tbody tr').count()==3)
                if SHOT: await pg.screenshot(path=SHOT+'/a4-members.png')
                await pg.click('#a-edit'); await pg.wait_for_selector('#af'); ok('edit keeps the rules', await pg.input_value('#f-name')=='Bodrum VIP' and await pg.locator('input[data-chip=tags]:checked').count()==2 and await pg.input_value('#f-tagMode')=='all')
                await pg.click('#af-x'); await pg.wait_for_selector('#a-del'); await pg.click('#a-del'); await pg.wait_for_selector('#m-ok'); await pg.click('#m-ok'); await pg.wait_for_selector('.empty'); ok('delete from the drawer', True)
                await pg.click('.tabs button:has-text("Kişiler")'); await pg.wait_for_selector('#c-q'); ok('back to people', await pg.locator('tbody tr').count()==6)
                await pg.set_viewport_size({'width':390,'height':800}); await pg.goto(B+'/hq?view=crm&tab=kitleler'); await pg.wait_for_selector('#a-new2'); await pg.click('#a-new2'); await pg.wait_for_selector('#a-live .astats')
                ok('no sideways scroll on a phone', await pg.evaluate("document.documentElement.scrollWidth<=window.innerWidth"))
                if SHOT: await pg.screenshot(path=SHOT+'/a5-mobile.png')
                ok('no browser errors', not errs, errs); await b.close()
        asyncio.run(ui())
finally:
    srv.terminate()
print(sum(R),'/',len(R),'passed'); print(open('/tmp/dev.err').read()[-1500:])
sys.exit(0 if all(R) else 1)
