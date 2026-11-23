# Browser checks of the HQ screens (python3 tests/ui.py). Needs Playwright + Chromium.
import sys, os, asyncio, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ['GA4_MEASUREMENT_ID']='G-TEST12345'
from harness import *
from playwright.async_api import async_playwright
SHOT=os.environ.get('SHOTS','')
async def main():
    srv=start()
    try:
      async with async_playwright() as p:
        b=await p.chromium.launch(); errs=[]
        ctx=await b.new_context(viewport={'width':1360,'height':900}, accept_downloads=True); pg=await ctx.new_page()
        pg.on('pageerror',lambda e: errs.append(str(e))); pg.on('console',lambda m: errs.append('console: '+m.text) if m.type=='error' and 'favicon' not in m.text and 'Failed to load resource' not in m.text else None)
        async def shot(n):
            if SHOT: await pg.screenshot(path=SHOT+'/'+n+'.png')
        await pg.goto(B+'/hq?view=rsvp'); await pg.wait_for_selector('#email')
        await pg.fill('#email','admin@example.com'); await pg.fill('#password','test-password-123'); await pg.click('#go')
        await pg.wait_for_selector('#nav .navi'); ok('login returns to /hq?view=rsvp', 'view=rsvp' in pg.url and (await pg.inner_text('#nav [aria-current=page]')).startswith('Davetler & RSVP'), pg.url)
        ok('menu sections', [x.strip() for x in await pg.locator('#nav .navi span:not(.ico):not(.cnt)').all_inner_texts()]==['Özet','Etkinlikler','Davetler & RSVP','CRM','Talepler','Görevler','Website','SEO','Marketing','Ayarlar'], await pg.locator('#nav .navi').all_inner_texts())
        await pg.wait_for_selector('.empty'); await shot('01-rsvp-empty')
        # create event from the drawer
        await pg.goto(B+'/hq?view=etkinlikler'); await pg.wait_for_selector('#new'); await pg.click('#new'); await pg.wait_for_selector('#nf')
        await pg.fill('#f-title','Test Night'); await pg.fill('#f-date','2027-06-16'); await pg.fill('#f-time','17:00'); await pg.fill('#f-venue','Test Venue'); await pg.fill('#f-city','Bodrum'); await shot('02-new-event')
        await pg.click('button[form=nf]'); await pg.wait_for_selector('#gf'); ok('new event opens its detail screen', 'view=etkinlik&id=' in pg.url)
        eid=pg.url.split('id=')[1].split('&')[0]
        await pg.fill('#f-artist','Test Artist'); await pg.fill('#f-capacity','3'); await pg.fill('#f-description','A night by the sea.'); await pg.click('#gf button[type=submit]'); await pg.wait_for_selector('.toast.ok'); await pg.wait_for_selector('#gf'); await shot('03-event-general')
        ok('general form saved and kept', await pg.input_value('#f-artist')=='Test Artist')
        # failed save keeps values
        await pg.fill('#f-ticketUrl','http://bad'); await pg.fill('#f-venue','Kept Venue'); await pg.click('#gf button[type=submit]'); await pg.wait_for_selector('#gf .msg.bad:not(:empty)')
        ok('failed save shows error and keeps form values', await pg.input_value('#f-venue')=='Kept Venue' and 'https' in await pg.inner_text('#gf .msg.bad'))
        await pg.fill('#f-ticketUrl',''); await pg.click('#gf button[type=submit]'); await pg.wait_for_selector('.toast.ok')
        await pg.click('#pub'); await pg.wait_for_selector('.modal'); await shot('04-publish-modal'); ok('publish dialog lists the new URL', '/events/test-night' in await pg.inner_text('.modal'))
        await pg.click('#m-ok'); await pg.wait_for_selector('.pill.published'); ok('event published from UI', True)
        for t in ['public','davet','seo','gorevler','checkin']:
            await pg.goto(B+'/hq?view=etkinlik&id='+eid+'&tab='+t); await pg.wait_for_selector('#tab > *'); await pg.wait_for_timeout(250); await shot('05-tab-'+t)
        ok('event tabs render (8)', await pg.locator('.tabs button').count()==8)
        # guest submits via the public page in a second context
        g=await b.new_context(viewport={'width':390,'height':800}); gp=await g.new_page(); gp.on('pageerror',lambda e: errs.append('guest: '+str(e)))
        await gp.goto(B+'/events/test-night?utm_source=instagram&utm_medium=social&utm_campaign=ui-test'); await gp.fill('#g-name','Ayşe Yılmaz'); await gp.fill('#g-email','ayse@example.com'); await gp.check('#g-consent')
        if SHOT: await gp.screenshot(path=SHOT+'/06-public-event-mobile.png', full_page=True)
        await gp.click('#g-form button[type=submit]'); await gp.wait_for_selector('text=Request'); ok('guest sees "Request received", not a confirmation', 'not a confirmation yet' in await gp.inner_text('#card'))
        # approve in HQ
        await pg.goto(B+'/hq?view=rsvp'); await pg.wait_for_selector('[data-dec=approved]'); await shot('07-rsvp-pending')
        ok('pending badge in menu', await pg.locator('#nav .cnt').count()==1)
        await pg.click('[data-dec=approved]'); await pg.wait_for_selector('.empty'); await pg.click('[data-af=approved]'); await pg.wait_for_selector('a[href^="/pass?t="]'); await shot('08-rsvp-approved')
        href=await pg.get_attribute('a[href^="/pass?t="]','href'); tok=href.split('t=')[1]
        await gp.goto(B+href); await gp.wait_for_selector('.g-qr svg'); ok('pass page: confirmed + QR', 'Your attendance is confirmed' in await gp.inner_text('#card'))
        if SHOT: await gp.screenshot(path=SHOT+'/09-pass-mobile.png', full_page=True)
        # mobile check-in
        m=await b.new_context(viewport={'width':390,'height':800}, storage_state=await ctx.storage_state()); mp=await m.new_page(); mp.on('pageerror',lambda e: errs.append('mobile: '+str(e)))
        await mp.goto(B+'/hq?view=kapi&event='+eid); await mp.wait_for_selector('#k-scan'); await mp.evaluate("window.__hqCheck('%s/pass?t=%s')" % (B,tok)); await mp.wait_for_selector('.door.ok')
        if SHOT: await mp.screenshot(path=SHOT+'/10-checkin-mobile-ok.png')
        await mp.evaluate("window.__hqCheck('%s')" % tok); await mp.wait_for_selector('.door.duplicate'); ok('mobile check-in: ok then "already used"', 'Yeni giriş kaydedilmedi' in await mp.inner_text('#k-res'))
        await mp.evaluate("window.__hqCheck('garbage')"); await mp.wait_for_selector('.door.bad'); ok('mobile check-in: invalid card distinct', 'Geçersiz' in await mp.inner_text('#k-res'))
        ok('mobile: no horizontal scroll, bottom bar visible', await mp.evaluate('document.documentElement.scrollWidth<=window.innerWidth') and await mp.locator('#mbar button').count()==5)
        if SHOT: await mp.screenshot(path=SHOT+'/11-checkin-mobile.png')
        await mp.goto(B+'/hq?view=rsvp'); await mp.wait_for_selector('#apps .seg'); ok('mobile RSVP: no horizontal scroll', await mp.evaluate('document.documentElement.scrollWidth<=window.innerWidth'))
        if SHOT: await mp.screenshot(path=SHOT+'/12-rsvp-mobile.png')
        # door-staff link: phone, no HQ session
        await pg.goto(B+'/hq?view=etkinlik&id='+eid+'&tab=checkin'); await pg.wait_for_selector('[data-door=new]'); await pg.click('[data-door=new]'); await pg.wait_for_selector('[data-door=renew]'); await shot('12b-door-link')
        durl=await pg.get_attribute('#dl [data-copy]','data-copy'); dp=await g.new_page(); dp.on('pageerror',lambda e: errs.append('door: '+str(e))); await dp.goto(B+durl); await dp.wait_for_selector('#list .item')
        ok('door page lists the guest without contact details', 'Ayşe Yılmaz' in await dp.inner_text('#list') and 'example.com' not in await dp.content())
        await dp.evaluate("window.__doorCheck('%s')" % tok); await dp.wait_for_selector('.door.duplicate'); ok('door page flags the already-used pass', 'Yeni giriş kaydedilmedi' in await dp.inner_text('#res'))
        if SHOT: await dp.screenshot(path=SHOT+'/12c-door-mobile.png')
        ok('door page: no horizontal scroll', await dp.evaluate('document.documentElement.scrollWidth<=window.innerWidth'))
        st,_,_=C().req('/api/hq/summary',headers={'x-door':durl.split('k=')[1]}); ok('door key is not an HQ login', st==401, st)
        # analytics consent on the public site
        cp=await (await b.new_context(viewport={'width':1200,'height':800})).new_page(); await cp.goto(B+'/'); await cp.wait_for_selector('#ml-consent'); ok('consent banner shown, GA not loaded before choice', await cp.evaluate("typeof window.gtag")=='undefined' and await cp.locator('script[src*=googletagmanager]').count()==0)
        await cp.click('#ml-consent [data-v=no]'); await cp.reload(); await cp.wait_for_timeout(600); ok('declined: no banner, no GA on next visit', await cp.locator('#ml-consent').count()==0 and await cp.evaluate("typeof window.gtag")=='undefined')
        await cp.evaluate("localStorage.removeItem('ml-analytics')"); await cp.reload(); await cp.wait_for_selector('#ml-consent'); await cp.click('#ml-consent [data-v=yes]'); await cp.wait_for_timeout(300); ok('allowed: GA starts once', await cp.evaluate("typeof window.gtag")=='function' and await cp.locator('script[src*=googletagmanager]').count()==1)
        # CRM import with mapping
        open('/tmp/imp.csv','w').write('Full Name;Mail;GSM\nAyşe Y.;AYSE@example.com;\nCem Kaya;cem@example.com;0555 111 22 33\nCem Kaya;cem@example.com;\n;bad;\n')
        await pg.goto(B+'/hq?view=crm'); await pg.wait_for_selector('#csv-file', state='attached'); await pg.set_input_files('#csv-file','/tmp/imp.csv'); await pg.wait_for_selector('#mf')
        ok('CSV columns auto-mapped', await pg.input_value('#f-name')=='0' and await pg.input_value('#f-email')=='1' and await pg.input_value('#f-phone')=='2')
        await pg.click('#mf-pv'); await pg.wait_for_selector('#imp table'); await shot('13-crm-import'); t=await pg.inner_text('#imp')
        import re; t=re.sub(r'\s+',' ',t); ok('import preview totals', 'YENİ KAYIT 1 EŞLEŞEN 1 ÇAKIŞAN 0 MÜKERRER 1 HATALI 1' in t, t[:200])
        await pg.click('#imp-go'); await pg.wait_for_selector('.toast.ok'); await pg.wait_for_selector('table tbody tr'); ok('import added exactly one contact', await pg.locator('main table tbody tr').count()==2, await pg.locator('main table tbody tr').count()); await shot('14-crm')
        await pg.click('main [data-open] >> nth=0'); await pg.wait_for_selector('#cf'); await pg.wait_for_timeout(200); await shot('15-contact'); ok('contact card shows event history', 'Test Night' in await pg.inner_text('.drawer'))
        await pg.keyboard.press('Escape')
        # public site form -> HQ Talepler
        sp=await g.new_page(); sp.on('pageerror',lambda e: errs.append('site: '+str(e))); await sp.goto(B+'/#contact'); await sp.wait_for_selector('form[data-form=contact] textarea')
        fm=sp.locator('form[data-form=contact]'); await fm.locator('[name=name]').fill('Lara Demir'); await fm.locator('[name=email]').fill('lara@venue.com'); await fm.get_by_text('Booking & production').click(); await fm.locator('[name=message]').fill('Sunset opening in June?'); await fm.locator('button[type=submit]').click()
        await sp.wait_for_selector('form[data-form=contact] .result:not([hidden])'); ok('site contact form reports success', 'has been received' in await fm.locator('.result').inner_text(), await fm.locator('.result').inner_text())
        await pg.goto(B+'/hq?view=talepler'); await pg.wait_for_selector('.item'); await shot('13b-talepler'); ok('enquiry appears in HQ with badge', 'Lara Demir' in await pg.inner_text('.list') and await pg.locator('#nav [data-nav="view=talepler"] .cnt').count()==1)
        await pg.click('.item [data-open]'); await pg.wait_for_selector('#qf'); ok('enquiry drawer shows the message', 'Sunset opening in June?' in await pg.inner_text('.drawer')); await pg.select_option('#f-status','done'); await pg.click('button[form=qf]'); await pg.wait_for_selector('.empty')
        # tasks
        await pg.goto(B+'/hq?view=gorevler'); await pg.wait_for_selector('#tf'); await pg.fill('#t-title','Ses sistemi'); await pg.select_option('#t-ev',eid); await pg.fill('#t-as','Can'); await pg.fill('#t-due','2020-01-01'); await pg.select_option('#t-pr','high'); await pg.click('#tf button[type=submit]'); await pg.wait_for_selector('[data-ts]'); await shot('16-tasks')
        lt=await pg.inner_text('.list'); ok('task shows event, priority and overdue', all(x in lt for x in ['Test Night','Yüksek öncelik','Gecikti','Can']), lt)
        # website + seo + marketing + settings
        await pg.goto(B+'/hq?view=website'); await pg.wait_for_selector('#wf'); await pg.fill('#f-tagline','UI tagline'); await pg.click('#wf button[type=submit]'); await pg.wait_for_selector('.toast.ok'); await pg.wait_for_selector('#w-pub:not([disabled])'); await shot('17-website')
        await pg.click('#w-pub'); await pg.wait_for_selector('.modal'); await pg.click('#m-ok'); await pg.wait_for_selector('.note.ok'); st,t,_=C().req('/',raw=True); ok('website publish reaches public HTML', 'UI tagline' in t)
        await pg.goto(B+'/hq?view=seo'); await pg.wait_for_selector('table'); await shot('18-seo'); ok('SEO table lists home + event', await pg.locator('main table tbody tr').count()==2)
        await pg.goto(B+'/hq?view=seo&duzenle=home'); await pg.wait_for_selector('#sf'); await pg.fill('#f-title','More Life | UI title'); await pg.wait_for_timeout(100); ok('SERP preview updates live', 'More Life | UI title' in await pg.inner_text('#pv-t')); await shot('19-seo-editor')
        await pg.click('#sf button[type=submit]'); await pg.wait_for_selector('#h-pub:not([disabled])'); st,t,_=C().req('/',raw=True); ok('SEO draft not public before publish', 'More Life | UI title' not in t)
        await pg.click('#h-pub'); await pg.wait_for_selector('#h-pub[disabled]'); st,t,_=C().req('/',raw=True); ok('SEO published into first HTML', '<title>More Life | UI title</title>' in t)
        for tb in ['kontroller','varsayilanlar','sitemap']:
            await pg.goto(B+'/hq?view=seo&tab='+tb); await pg.wait_for_selector('.tabs'); await pg.wait_for_timeout(200); await shot('20-seo-'+tb)
        await pg.goto(B+'/hq?view=marketing&tab=linkler&event='+eid); await pg.wait_for_selector('#uf'); await pg.click('[data-pre="1"]'); await pg.fill('#f-campaign','ui test'); await pg.fill('#f-name','UI kampanya'); await shot('21-utm')
        ok('UTM preview shows built link', 'utm_source=instagram&utm_medium=social&utm_campaign=ui-test&utm_content=story' in await pg.inner_text('#u-pv'), await pg.inner_text('#u-pv'))
        await pg.click('#uf button[type=submit]'); await pg.wait_for_selector('#u-list .item'); ok('UTM link saved to list', 'UI kampanya' in await pg.inner_text('#u-list'))
        await pg.goto(B+'/hq?view=marketing'); await pg.wait_for_selector('table'); await shot('22-marketing'); t=await pg.inner_text('main'); ok('marketing: campaign row with name, sales column empty', 'UI kampanya' in t and 'BİLET SATIŞI' in t, t[-600:])
        for tb in ['gsc','ga4']:
            await pg.goto(B+'/hq?view=marketing&tab='+tb); await pg.wait_for_selector('.empty'); ok(tb+': not connected, steps, no numbers', 'bağlı değil' in await pg.inner_text('main') and await pg.locator('main table').count()==0)
        await shot('23-ga4'); await pg.goto(B+'/hq?view=ayarlar'); await pg.wait_for_selector('table'); await shot('24-settings'); ok('settings never shows secret values', 'test-password-123' not in await pg.content())
        await pg.goto(B+'/hq?view=ozet'); await pg.wait_for_selector('.stat'); await shot('25-ozet'); nums=[x.strip() for x in await pg.locator('.stat .num').all_inner_texts()]; ok('summary counters', nums==['1','0','1','1'], nums)
        await pg.click('.stat >> nth=3'); await pg.wait_for_selector('[data-ts]'); ok('counter opens filtered list', 'durum=overdue' in pg.url and await pg.get_attribute('[data-tf=overdue]','aria-pressed')=='true')
        await pg.goto(B+'/hq?view=etkinlikler'); await pg.wait_for_selector('.ev'); await shot('26-events')
        await pg.reload(); await pg.wait_for_selector('.ev'); ok('deep link survives refresh', 'view=etkinlikler' in pg.url)
        await pg.click('#logout'); await pg.wait_for_selector('#email'); ok('logout returns to login', True)
        ok('no JS errors', not errs, errs[:4])
        await b.close()
    finally:
        srv.terminate()
    print(sum(R),'/',len(R),'passed'); sys.exit(0 if all(R) else 1)
asyncio.run(main())
