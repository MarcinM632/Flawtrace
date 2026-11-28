#!/usr/bin/env node
// Builds the pseudo repositories as real git repos: for every service a bare "origin" and a clone with origin/develop.
// billing-svc also gets the branch feature/DEMO-101-max-open-orders (the change under test, with seeded defects).
// orders-svc has no branch: it is the consumer that the change forgot. See expected.json for the seeded defects.
//   node build.js [outDir]                    builds the repos and prints where they are
//   node build.js --data-dir <QA_DATA_DIR>    also installs them into the app: clones in <dir>/repos and the repos list in <dir>/sources.json
//                                             (start the app with QA_DATA_DIR=<dir>; the existing settings in sources.json are kept)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const BRANCH = 'feature/DEMO-101-max-open-orders';
const GIT_ID = ['-c', 'user.name=Pseudo Dev', '-c', 'user.email=dev@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false'];
const git = (cwd, ...a) => execFileSync('git', [...GIT_ID, ...a], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

function copyTree(from, to) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyTree(s, d); } else fs.writeFileSync(d, fs.readFileSync(s)); // a fresh mtime: a copy keeps the source mtime on Windows, and git then misses a same-size change
  }
}

function build(outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pseudo-repos-'))) {
  const repos = path.join(outDir, 'repos');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(repos, { recursive: true });
  for (const svc of ['billing-svc', 'orders-svc']) {
    const origin = path.join(outDir, 'origin', svc + '.git');
    const work = path.join(outDir, 'work', svc);
    fs.mkdirSync(origin, { recursive: true }); fs.mkdirSync(work, { recursive: true });
    git(origin, 'init', '--bare', '-b', 'develop');
    git(work, 'init', '-b', 'develop');
    copyTree(path.join(HERE, svc, 'base'), work);
    git(work, 'add', '-A'); git(work, 'commit', '-m', 'Initial ' + svc);
    git(work, 'remote', 'add', 'origin', origin);
    git(work, 'push', 'origin', 'develop');
    const change = path.join(HERE, svc, 'change');
    if (fs.existsSync(change)) {
      git(work, 'checkout', '-b', BRANCH);
      copyTree(change, work);
      git(work, 'add', '-A'); git(work, 'commit', '-m', 'DEMO-101 max open orders per customer');
      git(work, 'push', 'origin', BRANCH);
    }
    git(repos, 'clone', '--no-checkout', origin, svc);
  }
  fs.rmSync(path.join(outDir, 'work'), { recursive: true, force: true });
  return { outDir, reposDir: repos, task: fs.readFileSync(path.join(HERE, 'DEMO-101.md'), 'utf8') };
}

module.exports = { build, BRANCH };

// Puts the repos where the app looks for them: DATA_DIR/repos/<name> and the repos list of DATA_DIR/sources.json.
// The url is a file:// address of the bare origin, so the app treats it as a normal remote (not as a local folder).
function install(built, dataDir) {
  const dest = path.join(dataDir, 'repos');
  fs.mkdirSync(dest, { recursive: true });
  const names = fs.readdirSync(built.reposDir);
  for (const n of names) { fs.rmSync(path.join(dest, n), { recursive: true, force: true }); copyTree(path.join(built.reposDir, n), (fs.mkdirSync(path.join(dest, n), { recursive: true }), path.join(dest, n))); }
  const file = path.join(dataDir, 'sources.json');
  let cur = {}; try { cur = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { /* new file */ }
  const keep = (cur.repos || []).filter((r) => !names.includes(r.name));
  cur.repos = [...keep, ...names.map((n) => ({ name: n, url: 'file:///' + path.join(built.outDir, 'origin', n + '.git').split(path.sep).join('/'), branch: 'develop' }))];
  fs.writeFileSync(file, JSON.stringify(cur, null, 2));
  return dest;
}

module.exports.install = install;

if (require.main === module) {
  const args = process.argv.slice(2);
  const di = args.indexOf('--data-dir');
  const dataDir = di >= 0 ? path.resolve(args.splice(di, 2)[1] || '') : '';
  const r = build(args[0] ? path.resolve(args[0]) : undefined);
  console.log('Repos built in ' + r.reposDir.split(path.sep).join('/'));
  if (dataDir) console.log('Installed into the app data dir: ' + install(r, dataDir).split(path.sep).join('/') + '  (start the app with QA_DATA_DIR=' + dataDir + ')');
  console.log('Task text for the run: ' + path.join(HERE, 'DEMO-101.md'));
  console.log('Score the report:      node ' + path.join(HERE, 'score.js') + ' <report.txt>');
}
