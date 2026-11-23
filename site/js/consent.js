// Optional analytics (GA4). Loaded only when a measurement ID is configured, and it starts only after the visitor allows it.
// Do Not Track and Global Privacy Control count as "no". The choice is kept on this device and can be changed with "Privacy choices".
(function () {
  'use strict';
  var ID = window.ML_GA, KEY = 'ml-analytics', started = false; if (!ID) return;
  var blocked = navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function start() {
    if (started) return; started = true;
    window.dataLayer = window.dataLayer || []; window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date()); window.gtag('config', ID, { anonymize_ip: true }); // the one and only page_view for this load
    var s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ID); document.head.appendChild(s);
    window.addEventListener('hashchange', function () { window.gtag('event', 'page_view', { page_path: '/' + location.hash.replace(/^#/, ''), page_location: location.origin + '/' + location.hash.replace(/^#/, '') }); });
    document.addEventListener('click', function (e) { var a = e.target.closest && e.target.closest('a[href]'); if (a && (a.id === 'g-tix' || /weeztix\.com/.test(a.href))) window.gtag('event', 'ticket_click', { link_domain: a.hostname }); });
  }
  function banner() {
    if (document.getElementById('ml-consent')) return;
    var b = document.createElement('div'); b.id = 'ml-consent'; b.setAttribute('role', 'dialog'); b.setAttribute('aria-label', 'Analytics choice');
    b.style.cssText = 'position:fixed;z-index:9998;left:16px;right:16px;bottom:16px;max-width:520px;margin:0 auto;padding:16px 18px;border-radius:18px;background:#17110F;border:1px solid rgba(243,238,230,.25);color:#F3EEE6;font:15px/1.45 Inter Tight,system-ui,sans-serif;box-shadow:0 14px 50px rgba(0,0,0,.6)';
    b.innerHTML = '<p style="margin:0 0 12px">May we measure visits to improve this site? No screen recording, no form contents. <a href="/#privacy" style="color:inherit">Privacy</a></p><div style="display:flex;gap:10px;flex-wrap:wrap"><button type="button" data-v="yes" style="min-height:44px;padding:0 16px;border-radius:12px;border:0;background:#F3EEE6;color:#0E0B0A;font:600 15px inherit;cursor:pointer">Allow analytics</button><button type="button" data-v="no" style="min-height:44px;padding:0 16px;border-radius:12px;border:1px solid rgba(243,238,230,.4);background:none;color:inherit;font:600 15px inherit;cursor:pointer">Decline</button></div>';
    b.addEventListener('click', function (e) { var v = e.target.getAttribute && e.target.getAttribute('data-v'); if (!v) return; set(v); b.remove(); if (v === 'yes') start(); });
    document.body.appendChild(b);
  }
  window.MLConsent = { open: banner, state: function () { return blocked ? 'blocked' : get(); } };
  if (blocked) return;
  if (get() === 'yes') start(); else if (get() !== 'no') (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', banner) : banner());
})();
