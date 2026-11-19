// Outgoing e-mail. With RESEND_API_KEY the mail goes through Resend's HTTP API (no dependency); without it the mail is
// printed in the log, so development and tests need no account. Mails are plain and short on purpose.
const cfg = require('./config');

const outbox = []; // the last mails, for tests and for the console mode
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function render(subject, lines, button) {
  const text = lines.join('\n\n') + (button ? `\n\n${button.label}: ${button.url}` : '') + '\n\n-- Flawtrace';
  const html = `<div style="font:15px/1.55 -apple-system,Segoe UI,Roboto,sans-serif;color:#1b1f24;max-width:520px;margin:auto;padding:24px">`
    + lines.map((l) => `<p>${esc(l)}</p>`).join('')
    + (button ? `<p style="margin:28px 0"><a href="${esc(button.url)}" style="background:#1f6feb;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;display:inline-block">${esc(button.label)}</a></p><p style="color:#667;font-size:13px">If the button does not work, copy this address into your browser:<br>${esc(button.url)}</p>` : '')
    + `<p style="color:#667;font-size:13px">Flawtrace</p></div>`;
  return { subject, text, html };
}

async function send(to, subject, lines, button) {
  const mail = { to, ...render(subject, lines, button) };
  outbox.push(mail); if (outbox.length > 50) outbox.shift();
  if (!cfg.RESEND_API_KEY) { console.log(`[mail to ${to}] ${subject}\n${mail.text}\n`); return { sent: false, console: true }; }
  try {
    const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + cfg.RESEND_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ from: cfg.MAIL_FROM, to: [to], subject, html: mail.html, text: mail.text }), signal: AbortSignal.timeout(15000) });
    if (!res.ok) { console.error('mail failed', res.status, (await res.text()).slice(0, 200)); return { sent: false }; }
    return { sent: true };
  } catch (e) { console.error('mail failed', e.message); return { sent: false }; }
}

const verifyMail = (to, token) => send(to, 'Confirm your e-mail for Flawtrace', ['Welcome to Flawtrace. Please confirm your e-mail address to start testing.', 'The link works for 3 days.'], { label: 'Confirm e-mail', url: `${cfg.appUrl}/_gw/verify?token=${encodeURIComponent(token)}` });
const resetMail = (to, token) => send(to, 'Reset your Flawtrace password', ['Someone asked to reset the password of this account. If it was you, use the button. The link works for one hour and only once.', 'If it was not you, ignore this mail: nothing changes.'], { label: 'Choose a new password', url: `${cfg.appUrl}/_gw/reset?token=${encodeURIComponent(token)}` });
const inviteMail = (to, token, who, org) => send(to, `${who} invited you to Flawtrace`, [`${who} invited you to the workspace "${org}" on Flawtrace.`, 'The invitation works for 7 days.'], { label: 'Accept the invitation', url: `${cfg.appUrl}/_gw/signup?invite=${encodeURIComponent(token)}&email=${encodeURIComponent(to)}` });

module.exports = { inviteMail, outbox, resetMail, send, verifyMail };
