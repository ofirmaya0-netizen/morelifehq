// More Life ticket shop on another website.
//   <div id="morelife-tickets"></div>
//   <script src="https://morelife.events/js/embed.js" data-event="event-slug" async></script>
// Campaign tags, a promoter code (?p=) and a discount code (?code=) on the host page's address are passed on, so sales are still credited.
(function () {
  var s = document.currentScript, slug = s && s.getAttribute('data-event'); if (!slug) return;
  var base = new URL(s.src).origin, here = new URLSearchParams(location.search), q = new URLSearchParams({ embed: '1' });
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'p', 'code', 'ref', 'lang'].forEach(function (k) { var v = here.get(k) || s.getAttribute('data-' + k.replace('utm_', 'utm-')); if (v) q.set(k, v.slice(0, 80)); });
  var box = document.getElementById(s.getAttribute('data-target') || 'morelife-tickets'); if (!box) { box = document.createElement('div'); s.parentNode.insertBefore(box, s); }
  var f = document.createElement('iframe');
  f.src = base + '/tickets/' + encodeURIComponent(slug) + '?' + q.toString(); f.title = 'Tickets'; f.loading = 'lazy'; f.allow = 'payment';
  f.style.cssText = 'width:100%;border:0;display:block;min-height:320px;color-scheme:normal'; f.setAttribute('scrolling', 'no');
  box.appendChild(f);
  window.addEventListener('message', function (ev) { if (ev.origin === base && ev.source === f.contentWindow && ev.data && ev.data.mlTickets && ev.data.height > 0) f.style.height = Math.ceil(ev.data.height) + 'px'; });
})();
