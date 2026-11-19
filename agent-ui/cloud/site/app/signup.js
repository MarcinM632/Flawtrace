// Sign-up page: shows the beta-code field when needed and fills in an invitation.
(async function () {
  const { call, params, $ } = window.gw;
  try { const c = await call('/_gw/api/config', null, 'GET'); if (c.betaCode && !params.get('invite')) $('#betaBox').hidden = false; } catch (_) { /* the form still works */ }
  const invite = params.get('invite');
  if (invite) {
    $('#invite').value = invite;
    try {
      const i = await call('/_gw/api/invite-info?token=' + encodeURIComponent(invite), null, 'GET');
      $('#title').textContent = 'Join ' + i.org;
      $('#sub').textContent = 'You were invited. Choose a password to create your account.';
      const e = $('#email'); e.value = i.email; e.readOnly = true;
    } catch (ex) { window.gw.show($('#err'), 'err', ex.message); }
  }
})();
