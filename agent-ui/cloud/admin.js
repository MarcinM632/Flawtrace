#!/usr/bin/env node
// Operator tool for Flawtrace Cloud. Run on the server, next to the data folder:
//   node cloud/admin.js stats
//   node cloud/admin.js list [text]
//   node cloud/admin.js show <email>
//   node cloud/admin.js suspend <email> | unsuspend <email>
//   node cloud/admin.js extend-trial <email> <days>
//   node cloud/admin.js grant <email>            mark the workspace as paid by hand (invoice customers)
//   node cloud/admin.js verify <email>           confirm an e-mail by hand
//   node cloud/admin.js disable <email> | enable <email>
//   node cloud/admin.js audit <email> [n]
// It changes the database only; a suspended or expired workspace loses access on its next request.
const path = require('path');
const cfg = require('./config');
const db = require('./db');
const auth = require('./auth');
const tenants = require('./tenants');

db.open(path.join(cfg.DATA, 'gateway.db'));
const [cmd, a, b] = process.argv.slice(2);
const day = 86400000;
const when = (t) => (t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') : '-');
const user = (email) => { const u = db.one('select * from users where email = ?', String(email || '').toLowerCase()); if (!u) { console.error('No user with that e-mail.'); process.exit(1); } return u; };
const show = (u) => { const o = db.one('select * from orgs where id = ?', u.org_id); const acc = auth.access(o); console.log(`${u.email}  ${u.role}  verified=${u.email_verified}  disabled=${u.disabled}  last login ${when(u.last_login)}\n  workspace ${o.id} "${o.name}"  status=${o.status}  ${acc.label}\n  trial ends ${when(o.trial_ends)}  stripe ${o.stripe_customer || '-'} / ${o.stripe_subscription || '-'}\n  data ${(tenants.dirSize(tenants.orgDir(o.id), 1e12) / 1048576).toFixed(1)} MB`); };

switch (cmd) {
  case 'stats': {
    const n = (sql, ...p) => db.one(sql, ...p).n;
    console.log(`users ${n('select count(*) n from users')}, workspaces ${n('select count(*) n from orgs')}`);
    for (const s of ['trial', 'active', 'past_due', 'canceled', 'suspended']) console.log(`  ${s.padEnd(10)} ${n('select count(*) n from orgs where status = ?', s)}`);
    console.log(`sign-ups last 7 days ${n('select count(*) n from users where created > ?', Date.now() - 7 * day)}, sessions open ${n('select count(*) n from sessions where expires > ?', Date.now())}`);
    break;
  }
  case 'list': {
    const rows = db.all("select u.email, u.role, o.status, o.trial_ends, u.created from users u join orgs o on o.id = u.org_id where u.email like ? order by u.created desc limit 200", '%' + (a || '') + '%');
    for (const r of rows) console.log(`${r.email.padEnd(40)} ${r.role.padEnd(7)} ${r.status.padEnd(10)} joined ${when(r.created)}  trial ends ${when(r.trial_ends)}`);
    console.log(rows.length + ' shown');
    break;
  }
  case 'show': show(user(a)); break;
  case 'suspend': { const u = user(a); db.run("update orgs set status = 'suspended' where id = ?", u.org_id); tenants.init(); db.audit('admin_suspend', { org: u.org_id, detail: a }); console.log('Suspended. A running workspace process stops by itself when idle.'); break; }
  case 'unsuspend': { const u = user(a); db.run("update orgs set status = case when stripe_subscription is not null then 'active' else 'trial' end where id = ?", u.org_id); db.audit('admin_unsuspend', { org: u.org_id, detail: a }); show(user(a)); break; }
  case 'extend-trial': { const u = user(a); const d = Number(b); if (!d) { console.error('Give a number of days.'); process.exit(1); } const o = db.one('select * from orgs where id = ?', u.org_id); db.run("update orgs set trial_ends = ?, status = case when status in ('trial','canceled') then 'trial' else status end where id = ?", Math.max(o.trial_ends || 0, Date.now()) + d * day, u.org_id); db.audit('admin_extend_trial', { org: u.org_id, detail: `${a} +${d}d` }); show(user(a)); break; }
  case 'grant': { const u = user(a); db.run("update orgs set status = 'active' where id = ?", u.org_id); db.audit('admin_grant', { org: u.org_id, detail: a }); show(user(a)); break; }
  case 'verify': { const u = user(a); db.run('update users set email_verified = 1 where id = ?', u.id); show(user(a)); break; }
  case 'disable': { const u = user(a); db.run('update users set disabled = 1 where id = ?', u.id); db.run('delete from sessions where user_id = ?', u.id); show(user(a)); break; }
  case 'enable': { const u = user(a); db.run('update users set disabled = 0 where id = ?', u.id); show(user(a)); break; }
  case 'audit': { const u = user(a); for (const r of db.all('select * from audit where user_id = ? or org_id = ? order by ts desc limit ?', u.id, u.org_id, Number(b) || 30)) console.log(`${when(r.ts)}  ${r.type.padEnd(20)} ${r.detail || ''} ${r.ip || ''}`); break; }
  default: console.log(fs_help());
}
function fs_help() { return require('fs').readFileSync(__filename, 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'); }
db.close();
