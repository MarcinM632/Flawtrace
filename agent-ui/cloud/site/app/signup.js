// Sign-up page: shows the beta-code field when needed and fills in an invitation.
(async function () {
  const { call, params, $ } = window.gw;
  // Okres wybrany w cenniku (?plan=annual) przechodzi przez rejestrację na checkout.
  if (/^(monthly|semiannual|annual)$/.test(params.get('plan') || '')) { try { sessionStorage.setItem('ft.plan', params.get('plan')); } catch (_) { /* private mode */ } }
  try {
    const c = await call('/_gw/api/config', null, 'GET');
    if (c.betaCode && !params.get('invite')) $('#betaBox').hidden = false;
    // Płatność od razu (karta przy starcie albo brak triala): pokaż kroki, żeby było jasne, że po koncie przyjdzie płatność.
    if (c.billing && !params.get('invite') && (c.trialRequiresCard || c.trialDays <= 0)) {
      $('#signupSteps').hidden = false;
      if (c.trialDays <= 0) { $('#title').textContent = 'Create your account'; $('#sub').textContent = 'Next you choose how to pay. Cancel any time.'; }
    }
  } catch (_) { /* the form still works */ }
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
