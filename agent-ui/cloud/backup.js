#!/usr/bin/env node
// Makes a consistent copy of the gateway database next to the data, ready for the backup tool to pick up:
//   docker compose exec -T gateway node agent-ui/cloud/backup.js
// A plain file copy of a running SQLite database can be torn; VACUUM INTO writes a clean snapshot instead.
// The master secret is deliberately NOT part of it: keep it apart from the data backups, or the encryption is pointless.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const cfg = require('./config');

const src = path.join(cfg.DATA, 'gateway.db');
if (!fs.existsSync(src)) { console.error('No database at ' + src); process.exit(1); }
const dir = path.join(cfg.DATA, 'db-snapshots');
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, 'gateway-' + new Date().toISOString().slice(0, 10) + '.db');
fs.rmSync(out, { force: true });
const db = new DatabaseSync(src);
db.exec(`vacuum into '${out.replace(/'/g, "''")}'`);
db.close();
// Keep the last 3 snapshots on the volume; the backup tool keeps the long history.
const all = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort();
for (const f of all.slice(0, Math.max(0, all.length - 3))) fs.rmSync(path.join(dir, f), { force: true });
console.log('Snapshot written: ' + out);
