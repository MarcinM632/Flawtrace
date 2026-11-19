// Account page: plan and billing, members and invitations, password, data export, workspace deletion.
(function () {
  const { call, show, params, $ } = window.gw;
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
  let me = null;

  function button(label, cls, fn) { const b = el('button', label, 'btn ' + (cls || '')); b.type = 'button'; b.addEventListener('click', async () => { b.disabled = true; try { await fn(); } catch (e) { show($('#notice'), 'err', e.message); } b.disabled = false; }); return b; }

  function renderPlan() {
    const a = me.access, owner = me.role === 'owner';
    const pill = $('#planPill');
    pill.textContent = a.state === 'beta' ? 'Beta' : a.state === 'active' ? 'Active' : a.state === 'trial' ? 'Trial' : a.state === 'past_due' ? 'Payment due' : 'Inactive';
    pill.className = 'pill' + (a.ok ? (a.state === 'past_due' ? ' warn' : '') : ' bad');
    $('#planText').textContent = a.label + (a.ok || !me.billing.enabled ? '' : ' Subscribe to keep using Flawtrace.');
    const box = $('#planActions'); box.replaceChildren();
    if (me.needsVerification) { box.append(el('span', 'Confirm your e-mail first: we sent you a link.', 'hint')); box.append(button('Send it again', 'ghost small', async () => { await call('/_gw/api/resend-verification', {}); show($('#notice'), 'ok', 'Sent. Check your inbox.'); })); return; }
    if (a.ok) box.append(el('a', 'Open the app', 'btn small')), box.lastChild.href = '/';
    if (me.billing.enabled && owner) {
      if (me.billing.subscribed) box.append(button('Manage billing', 'ghost small', async () => { location.href = (await call('/_gw/api/portal', {})).url; }));
      if (a.state !== 'active') box.append(button(me.billing.subscribed ? 'Resubscribe' : 'Subscribe', 'small', async () => { location.href = (await call('/_gw/api/checkout', {})).url; }));
    } else if (me.billing.enabled && !owner && !a.ok) box.append(el('span', 'Ask the owner of the workspace to subscribe.', 'hint'));
  }

  function renderTeam() {
    $('#wsName').textContent = me.org.name + ' · ' + me.members.length + ' of ' + me.seats + ' seats used';
    const t = $('#members'); t.replaceChildren();
    for (const m of me.members) {
      const tr = el('tr'); tr.append(el('td', m.name ? m.name + ' (' + m.email + ')' : m.email), el('td', m.role));
      const td = el('td', null); td.className = 'r';
      if (me.role === 'owner' && m.email !== me.email) td.append(button('Remove', 'ghost small', async () => { await call('/_gw/api/remove-member', { email: m.email }); await load(); }));
      tr.append(td); t.append(tr);
    }
    for (const i of me.invites) {
      const tr = el('tr'); tr.append(el('td', i.email + ' (invited)'), el('td', 'pending'));
      const td = el('td', null); td.className = 'r';
      td.append(button('Cancel', 'ghost small', async () => { await call('/_gw/api/revoke-invite', { email: i.email }); await load(); }));
      tr.append(td); t.append(tr);
    }
    $('#inviteBox').hidden = me.role !== 'owner';
    $('#dangerBox').hidden = me.role !== 'owner';
  }

  async function load() {
    try { me = await call('/_gw/api/me', null, 'GET'); }
    catch (_) { location.href = '/_gw/login'; return; }
    $('#who').textContent = 'Signed in as ' + me.email + '.';
    renderPlan(); renderTeam();
  }

  $('#inviteBtn').addEventListener('click', async () => {
    const i = $('#inviteEmail');
    try { await call('/_gw/api/invite', { email: i.value }); i.value = ''; show($('#notice'), 'ok', 'Invitation sent.'); await load(); } catch (e) { show($('#notice'), 'err', e.message); }
  });
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await call('/_gw/api/change-password', { current: $('#pwCur').value, next: $('#pwNew').value }); $('#pwCur').value = ''; $('#pwNew').value = ''; show($('#pwMsg'), 'ok', 'Password changed.'); }
    catch (ex) { show($('#pwMsg'), 'err', ex.message); }
  });
  $('#delForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await call('/_gw/api/delete-workspace', { password: $('#delPw').value, confirm: $('#delConfirm').value }); location.href = '/_gw/login'; }
    catch (ex) { show($('#delMsg'), 'err', ex.message); }
  });
  $('#signout').addEventListener('click', async () => { try { await call('/_gw/api/logout', {}); } catch (_) { /* leave anyway */ } location.href = '/_gw/login'; });

  // Back from Stripe: the webhook may need a few seconds to reach us.
  if (params.get('paid')) {
    show($('#notice'), 'ok', 'Thank you. Activating your subscription…');
    let n = 0; const t = setInterval(async () => { n++; await load(); if ((me && me.access.state === 'active') || n > 10) { clearInterval(t); if (me && me.access.state === 'active') show($('#notice'), 'ok', 'Your subscription is active.'); } }, 2000);
  }
  load();
})();
