// Checkout: billing details + consent -> Stripe Checkout (hosted; we never see the card) -> success page confirms
// the session with Stripe and opens the app. Works with the webhook too: whichever arrives first activates the workspace.
(function () {
  const { call, show, params, $ } = window.gw;

  const money = (amount, currency) => {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount / 100); } catch (_) { return (amount / 100).toFixed(2) + ' ' + currency; }
  };
  const per = (p) => (p.intervalCount > 1 ? ` every ${p.intervalCount} ${p.interval}s` : ` / ${p.interval}`);
  const dateIn = (days) => new Date(Date.now() + days * 86400000).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

  async function checkoutPage() {
    let me, plan;
    try { me = await call('/_gw/api/me', null, 'GET'); } catch (_) { location.href = '/_gw/login?next=' + encodeURIComponent(location.pathname + location.search); return; }
    try { plan = await call('/_gw/api/plan', null, 'GET'); } catch (_) { plan = { billing: false }; }
    const form = $('#coForm'), notice = $('#notice');

    // Order summary
    $('#planName').textContent = plan.name || 'Team workspace';
    $('#planSeats').textContent = plan.seats ? `Per workspace, up to ${plan.seats} people.` : '';
    const p = plan.price;
    const priceText = p && p.amount != null ? money(p.amount, p.currency) + per(p) : (plan.priceLabel || '');
    $('#planPrice').textContent = priceText;
    if (plan.stripeTrialDays > 0) {
      $('#todayLabel').textContent = `Due today (${plan.stripeTrialDays}-day free trial)`;
      $('#todayAmount').textContent = p ? money(0, p.currency) : '0';
      $('#thenLine').hidden = false;
      $('#thenLabel').textContent = `From ${dateIn(plan.stripeTrialDays)}`;
      $('#thenAmount').textContent = priceText;
      $('#payBtn').textContent = 'Continue to add a payment method';
      $('#coTitle').textContent = `Start your ${plan.stripeTrialDays}-day free trial`;
      $('#coSub').textContent = 'Confirm your billing details. On the next step you add a payment method on a secure page run by Stripe; nothing is charged until the trial ends.';
    } else {
      $('#todayAmount').textContent = priceText.replace(/\s*\/.*/, '') || priceText;
    }
    $('#taxNote').textContent = plan.taxAtCheckout ? 'Taxes (for example VAT) are calculated on the payment page from your billing address.' : 'Prices include no tax unless shown otherwise on the payment page.';

    // Prefill
    $('#company').value = (me.org && me.org.name) || '';
    $('#billingEmail').value = me.email || '';

    // States in which there is nothing to pay here
    const lock = (title, text, actions) => {
      $('#coTitle').textContent = title; $('#coSub').textContent = text; form.hidden = true;
      if (actions) { const r = document.createElement('div'); r.className = 'row'; for (const [label, href, ghost] of actions) { const a = document.createElement('a'); a.className = 'btn' + (ghost ? ' ghost' : ''); a.textContent = label; a.href = href; r.append(a); } $('#formBox').append(r); }
    };
    if (!plan.billing) return lock('No payment needed', 'Flawtrace is free during the beta.', [['Open Flawtrace', '/']]);
    if (me.needsVerification) return lock('Confirm your e-mail first', 'We sent you a link. After confirming, come back here to subscribe.', [['Account', '/_gw/account', true]]);
    if (me.role !== 'owner') return lock('Ask the workspace owner', 'Only the owner of the workspace can subscribe and manage billing.', [['Account', '/_gw/account', true]]);
    if (me.access.state === 'active' && me.billing.subscribed) return lock('You are subscribed', 'Your subscription is active. Invoices, card and cancellation are in the billing portal.', [['Open Flawtrace', '/'], ['Account and billing', '/_gw/account', true]]);

    if (params.get('canceled')) show(notice, 'warn', 'Payment was cancelled. Nothing was charged. You can try again whenever you are ready.');
    else if (!me.access.ok) show(notice, 'warn', me.access.label);
    else if (me.access.state === 'trial') show(notice, 'ok', me.access.label + '. Subscribe now to keep access after the trial.');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#err'); err.hidden = true;
      if (!$('#acceptTerms').checked) { show(err, 'err', 'Accept the Terms of Service and the automatic monthly renewal to continue.'); $('#acceptTerms').focus(); return; }
      const email = $('#billingEmail').value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { show(err, 'err', 'Enter a valid billing e-mail address.'); $('#billingEmail').focus(); return; }
      const btn = $('#payBtn'), label = btn.textContent;
      btn.disabled = true; btn.textContent = 'Opening secure payment…';
      try {
        const r = await call('/_gw/api/checkout', { company: $('#company').value, billingEmail: email, acceptTerms: true });
        const s = document.querySelectorAll('.steps li'); if (s[2]) { s[1].className = 'done'; s[2].className = 'on'; }
        location.href = r.url;
      } catch (ex) { show(err, 'err', ex.message); btn.disabled = false; btn.textContent = label; }
    });
  }

  async function successPage() {
    const sid = params.get('session_id');
    const ic = $('#statusIc'), title = $('#okTitle'), text = $('#okText'), hint = $('#okHint'), actions = $('#okActions');
    const done = (ok, t, x) => { ic.className = 'status-ic ' + (ok ? 'ok' : 'warn'); title.textContent = t; text.textContent = x; actions.hidden = false; };
    for (let i = 0; i < 15; i++) {
      try {
        const r = await call('/_gw/api/checkout/confirm', { sessionId: sid });
        if (r.access && r.access.ok && r.access.state !== 'trial') {
          done(true, 'You are all set', 'Your subscription is active. A receipt is on its way to your billing e-mail.');
          let n = 5; hint.textContent = `Opening Flawtrace in ${n} s…`;
          const t = setInterval(() => { n--; hint.textContent = n > 0 ? `Opening Flawtrace in ${n} s…` : ''; if (n <= 0) { clearInterval(t); location.href = '/'; } }, 1000);
          return;
        }
        if (r.pending) { done(false, 'Payment is being processed', 'Your bank is still confirming the payment. We will activate the workspace as soon as it clears and send you an e-mail.'); return; }
      } catch (_) { /* try again */ }
      await new Promise((ok) => setTimeout(ok, 2000));
    }
    done(false, 'Almost there', 'We have not received the confirmation from Stripe yet. Refresh this page in a minute; if it does not change, contact us — you will not be charged twice.');
  }

  if ($('#okBox')) successPage(); else checkoutPage();
})();
