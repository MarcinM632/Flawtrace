// Checkout: billing details + consent -> Stripe Checkout (hosted; we never see the card) -> success page confirms
// the session with Stripe and opens the app. Works with the webhook too: whichever arrives first activates the workspace.
(function () {
  const { call, show, params, $ } = window.gw;

  const money = (amount, currency) => {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount / 100); } catch (_) { return (amount / 100).toFixed(2) + ' ' + currency; }
  };
  const per = (p) => (p.intervalCount > 1 ? ` every ${p.intervalCount} ${p.interval}s` : ` / ${p.interval}`);
  const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

  const all4 = (st) => { const l = st.querySelectorAll('li'); if (l.length) l[l.length - 1].setAttribute('aria-current', 'step'); };

  async function checkoutPage() {
    let me, plan;
    try { me = await call('/_gw/api/me', null, 'GET'); } catch (_) { location.href = '/_gw/login?next=' + encodeURIComponent(location.pathname + location.search); return; }
    try { plan = await call('/_gw/api/plan', null, 'GET'); } catch (_) { plan = { billing: false }; }
    const form = $('#coForm'), notice = $('#notice');

    // Billing periods (monthly / 6 months / annual) and the order summary for the chosen one
    const list = (plan.plans || []).filter((x) => x.sellable);
    const wanted = params.get('plan') || (() => { try { return sessionStorage.getItem('ft.plan'); } catch (_) { return null; } })();
    let sel = list.find((x) => x.id === wanted) || list.find((x) => x.id === plan.defaultPlan) || list[0] || null;
    const periodText = (x) => (x.months === 1 ? 'Billed every month' : x.months === 12 ? 'Billed once a year' : `Billed every ${x.months} months`);
    const renewText = (x) => (x.months === 1 ? 'every month' : x.months === 12 ? 'every year' : `every ${x.months} months`);
    function summary() {
      if (!sel) return;
      const sp = sel.stripe; // what Stripe will actually charge
      const total = sp && sp.amount != null ? money(sp.amount, sp.currency) : sel.priceText;
      $('#planName').textContent = `${plan.name || 'Team workspace'} · ${sel.name}`;
      $('#planPrice').textContent = sel.months === 1 ? `${total} / month` : `${sel.perMonthText} / month`;
      $('#planPeriod').textContent = sel.months === 1 ? periodText(sel) + '.' : `${total} ${sel.months === 12 ? 'per year' : 'every ' + sel.months + ' months'}${sel.save ? ` — you save ${sel.save}% compared with monthly` : ''}.`;
      $('#renewEvery').textContent = renewText(sel);
      $('#cancelNote').textContent = sel.months > 1 ? 'Cancel any time; you keep access until the paid period ends' : 'Cancel any time, no long-term contract';
      if (plan.stripeTrialDays > 0) {
        $('#todayLabel').textContent = plan.trialRequiresCard ? `Due today (${plan.stripeTrialDays}-day free trial)` : 'Due today (rest of your free trial)';
        $('#todayAmount').textContent = money(0, (sp && sp.currency) || sel.currency);
        $('#thenLine').hidden = false;
        $('#thenLabel').textContent = `From ${fmtDate(plan.firstCharge || Date.now() + plan.stripeTrialDays * 86400000)}`;
        $('#thenAmount').textContent = `${total} ${sel.months === 1 ? '/ month' : sel.months === 12 ? '/ year' : '/ ' + sel.months + ' months'}`;
      } else {
        $('#todayLabel').textContent = 'Due today'; $('#todayAmount').textContent = total; $('#thenLine').hidden = true;
      }
      // Na telefonie podsumowanie jest daleko od przycisku: krótka linia z kwotą tuż nad nim.
      $('#payNote').textContent = `Due today: ${$('#todayAmount').textContent}` + ($('#thenLine').hidden ? '' : ` · ${$('#thenLabel').textContent.replace(/^From/, 'from')}: ${$('#thenAmount').textContent}`);
    }
    const box = $('#periodList');
    for (const x of list) {
      const l = document.createElement('label'); l.className = 'period';
      const r = document.createElement('input'); r.type = 'radio'; r.name = 'period'; r.value = x.id; r.checked = sel && x.id === sel.id;
      const t = document.createElement('span'); t.className = 'p-main';
      const n = document.createElement('b'); n.textContent = x.name; t.append(n);
      if (x.save) { const sv = document.createElement('em'); sv.className = 'p-save'; sv.textContent = `Save ${x.save}%`; t.append(sv); }
      const d = document.createElement('small'); d.textContent = x.months === 1 ? periodText(x) : `${x.priceText} ${x.months === 12 ? 'per year' : 'every ' + x.months + ' months'}`; t.append(d);
      const pr = document.createElement('span'); pr.className = 'p-price'; pr.textContent = `${x.perMonthText} / mo`;
      l.append(r, t, pr); box.append(l);
      r.addEventListener('change', () => { sel = x; try { sessionStorage.setItem('ft.plan', x.id); } catch (_) { /* private mode */ } summary(); });
    }
    if (list.length < 2) $('#periods').hidden = true;
    $('#planSeats').textContent = plan.seats ? `Per workspace, up to ${plan.seats} people.` : '';
    if (plan.enterprise) { const a = document.createElement('a'); a.href = `mailto:${plan.contact}?subject=Flawtrace%20Enterprise`; a.textContent = 'Talk to us'; $('#entNote').append(`Bigger team or invoice billing? Enterprise starts at ${plan.enterprise.fromText} / month for up to ${plan.enterprise.seats} people. `, a, '.'); }
    if (plan.stripeTrialDays > 0 && !plan.trialRequiresCard) {
      $('#coSub').textContent = `Confirm your billing details. On the next step you add a payment method on a secure page run by Stripe. Your free trial continues; the first payment is taken on ${fmtDate(plan.firstCharge || Date.now() + plan.stripeTrialDays * 86400000)}.`;
    } else if (plan.stripeTrialDays > 0) {
      $('#payBtn').textContent = 'Continue to add a payment method';
      $('#coTitle').textContent = `Start your ${plan.stripeTrialDays}-day free trial`;
      $('#coSub').textContent = 'Confirm your billing details. On the next step you add a payment method on a secure page run by Stripe; nothing is charged until the trial ends.';
    }
    summary();
    $('#taxNote').textContent = plan.taxAtCheckout ? 'Taxes (for example VAT) are calculated on the payment page from your billing address.' : 'Prices include no tax unless shown otherwise on the payment page.';

    // Prefill
    $('#company').value = (me.org && me.org.name) || '';
    $('#billingEmail').value = me.email || '';

    // States in which there is nothing to pay here
    const lock = (title, text, actions, done) => {
      $('#coTitle').textContent = title; $('#coSub').textContent = text; form.hidden = true;
      // Nic tu do zapłacenia: bez podsumowania zamówienia („Due today”) i bez kroków płatności, jeden wyśrodkowany panel.
      $('#summary').hidden = true; document.querySelector('main').classList.add('narrow');
      const st = document.querySelector('.steps'); if (st) { if (done) { st.querySelectorAll('li').forEach((li, i, all) => { li.className = i === all.length - 1 ? 'on' : 'done'; li.removeAttribute('aria-current'); }); all4(st); } else st.hidden = true; }
      if (actions) { const r = document.createElement('div'); r.className = 'row'; for (const [label, href, ghost] of actions) { const a = document.createElement('a'); a.className = 'btn' + (ghost ? ' ghost' : ''); a.textContent = label; a.href = href; r.append(a); } $('#formBox').append(r); }
    };
    if (!plan.billing) return lock('No payment needed', 'Flawtrace is free during the beta.', [['Open Flawtrace', '/']]);
    if (!sel) return lock('Plans are being updated', 'No billing period is available right now. Try again in a few minutes.', [['Account', '/_gw/account', true]]);
    if (me.needsVerification) return lock('Confirm your e-mail first', 'We sent you a link. After confirming, come back here to subscribe.', [['Account', '/_gw/account', true]]);
    if (me.role !== 'owner') return lock('Ask the workspace owner', 'Only the owner of the workspace can subscribe and manage billing.', [['Account', '/_gw/account', true]]);
    if (me.access.state === 'active' && me.billing.subscribed) {
      const cur = (plan.plans || []).find((x) => x.id === (me.org && me.org.plan));
      return lock('You are subscribed', `Your ${cur ? ({ monthly: 'monthly', semiannual: '6-month', annual: 'annual' }[cur.id] || cur.name) + ' ' : ''}subscription is active. Invoices, card, plan changes and cancellation are in the billing portal.`, [['Open Flawtrace', '/'], ['Account and billing', '/_gw/account', true]], true);
    }

    if (params.get('canceled')) show(notice, 'warn', 'Payment was cancelled. Nothing was charged. You can try again whenever you are ready.');
    else if (!me.access.ok) show(notice, 'warn', me.access.label);
    else if (me.access.state === 'trial') show(notice, 'ok', me.access.label + (plan.stripeTrialDays > 0 ? '. Subscribe now to keep access after the trial; nothing is charged before it ends.' : '. Subscribe now to keep access after the trial.'));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#err'); err.hidden = true;
      if (!$('#acceptTerms').checked) { show(err, 'err', `Accept the Terms of Service and the automatic renewal ${renewText(sel)} to continue.`); $('#acceptTerms').focus(); return; }
      const email = $('#billingEmail').value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { show(err, 'err', 'Enter a valid billing e-mail address.'); $('#billingEmail').focus(); return; }
      const btn = $('#payBtn'), label = btn.textContent;
      btn.disabled = true; btn.textContent = 'Opening secure payment…';
      try {
        const r = await call('/_gw/api/checkout', { plan: sel.id, company: $('#company').value, billingEmail: email, acceptTerms: true });
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
          if (r.trial && r.firstCharge) done(true, 'You are all set', `Your subscription is set up. The free trial runs until ${fmtDate(r.firstCharge)}; the first payment is taken then and the receipt goes to your billing e-mail. You can cancel before that in the billing portal.`);
          else done(true, 'You are all set', 'Your subscription is active. A receipt is on its way to your billing e-mail.');
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
