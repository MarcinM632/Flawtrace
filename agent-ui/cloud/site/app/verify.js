(async function () {
  const { call, show, $ } = window.gw;
  try { const me = await call('/_gw/api/me', null, 'GET'); $('#where').textContent = 'We sent a confirmation link to ' + me.email + '. Open it, then come back here.'; if (!me.needsVerification) location.href = '/'; }
  catch (_) { location.href = '/_gw/login'; }
  $('#resend').addEventListener('click', async () => {
    try { await call('/_gw/api/resend-verification', {}); show($('#msg'), 'ok', 'Sent. It can take a minute to arrive. Check the spam folder too.'); }
    catch (e) { show($('#msg'), 'err', e.message); }
  });
  $('#out').addEventListener('click', async () => { try { await call('/_gw/api/logout', {}); } catch (_) { /* leave anyway */ } location.href = '/_gw/login'; });
})();
