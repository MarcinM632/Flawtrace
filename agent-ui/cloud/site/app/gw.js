// Shared script of the sign-in, sign-up, reset and verify pages. A form with data-api is posted as JSON.
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const params = new URLSearchParams(location.search);

  // Only a path on this site is accepted as the place to go next.
  const safeNext = (n) => (typeof n === 'string' && /^\/(?!\/)/.test(n) && !n.startsWith('/_gw/api') ? n : '/');

  function show(box, kind, text) { if (!box) return; box.className = 'msg ' + kind; box.textContent = text; box.hidden = false; }

  async function call(url, body, method) {
    const res = await fetch(url, { method: method || 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
    let data = {}; try { data = await res.json(); } catch (_) { /* not JSON */ }
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Try again.'), { status: res.status });
    return data;
  }
  window.gw = { call, show, params, safeNext, $ };

  // Messages passed in the address (for example after e-mail confirmation).
  const top = $('#notice');
  if (top) {
    if (params.get('verified')) show(top, 'ok', 'Your e-mail is confirmed. You can sign in.');
    else if (params.get('error')) show(top, 'err', params.get('error'));
  }

  // Prefill from the address.
  for (const el of document.querySelectorAll('input[data-from]')) { const v = params.get(el.dataset.from); if (v) el.value = v; }
  const next = $('input[name=next]'); if (next) next.value = safeNext(params.get('next'));

  // Show/hide password.
  for (const b of document.querySelectorAll('[data-toggle-password]')) {
    b.addEventListener('click', () => { const i = $('#' + b.dataset.togglePassword); const on = i.type === 'password'; i.type = on ? 'text' : 'password'; b.textContent = on ? 'Hide' : 'Show'; });
  }

  for (const form of document.querySelectorAll('form[data-api]')) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.err', form) || $('#err'); if (err) err.hidden = true;
      const btn = $('button[type=submit]', form); const label = btn && btn.textContent;
      const body = {};
      for (const el of form.elements) {
        if (!el.name) continue;
        if (el.type === 'checkbox') body[el.name] = el.checked; else if (el.type !== 'submit') body[el.name] = el.value;
      }
      if (form.dataset.confirm && body.password !== body.password2) return show(err, 'err', 'The two passwords are not the same.');
      delete body.password2;
      if (btn) { btn.disabled = true; btn.textContent = 'Please wait…'; }
      try {
        const r = await call(form.dataset.api, body);
        if (form.dataset.done) { const ok = $(form.dataset.done); if (ok) { show(ok, 'ok', form.dataset.doneText || 'Done.'); form.hidden = !!form.dataset.hide; } if (btn) { btn.disabled = false; btn.textContent = label; } return; }
        location.href = safeNext(body.next && body.next !== '/' ? body.next : (r.next || '/'));
      } catch (ex) {
        show(err, 'err', ex.message);
        if (btn) { btn.disabled = false; btn.textContent = label; }
      }
    });
  }
})();
