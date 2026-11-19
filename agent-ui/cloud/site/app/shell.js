// Injected by the gateway into the product page. It adds a small account chip and sends you to the right page when your
// session ends (401) or the plan does not allow the action (402). Nothing here touches the product itself.
(function () {
  const orig = window.fetch.bind(window);
  window.fetch = async (...a) => {
    const r = await orig(...a);
    try {
      if (r.status === 401 && !String(a[0]).includes('/_gw/')) location.href = '/_gw/login?next=' + encodeURIComponent(location.pathname + location.search);
      if (r.status === 402) location.href = '/_gw/account';
    } catch (_) { /* leave it */ }
    return r;
  };
  const make = (me) => {
    const box = document.createElement('div');
    box.setAttribute('data-flawtrace-chip', '');
    Object.assign(box.style, { position: 'fixed', right: '12px', bottom: '12px', zIndex: '2147483000', display: 'flex', gap: '8px', alignItems: 'center', font: '600 12.5px system-ui, sans-serif', background: 'rgba(20,23,28,.92)', color: '#fff', padding: '7px 8px 7px 12px', borderRadius: '999px', boxShadow: '0 4px 18px rgba(0,0,0,.3)' });
    const t = document.createElement('span'); t.textContent = me.access.label; box.append(t);
    const a = document.createElement('a'); a.href = '/_gw/account'; a.textContent = 'Account';
    Object.assign(a.style, { color: '#0d1014', background: '#2fd1b9', textDecoration: 'none', padding: '4px 11px', borderRadius: '999px' });
    box.append(a); document.body.append(box);
  };
  const go = async () => { try { const r = await orig('/_gw/api/me', { credentials: 'same-origin' }); if (r.ok) make(await r.json()); } catch (_) { /* no chip */ } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
