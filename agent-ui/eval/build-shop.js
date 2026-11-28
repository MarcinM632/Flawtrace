#!/usr/bin/env node
// Builds the benchmark shop as a real git repository:
//   origin/shop.git  bare repo with branch develop (shop/base) and feature/BENCH-3-discount-codes (shop/change on top)
//   app/             a checkout of the feature branch: this is the shop that runs as the test environment
//   node eval/build-shop.js [outDir]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const HERE = __dirname;
const BRANCH = 'feature/BENCH-3-discount-codes';
const GIT_ID = ['-c', 'user.name=Shop Dev', '-c', 'user.email=dev@shop.test', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false'];
const git = (cwd, ...a) => execFileSync('git', [...GIT_ID, ...a], { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) copyTree(s, d); else fs.copyFileSync(s, d);
  }
}

function build(outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-shop-'))) {
  fs.rmSync(outDir, { recursive: true, force: true });
  const origin = path.join(outDir, 'origin', 'shop.git');
  const work = path.join(outDir, 'work');
  const app = path.join(outDir, 'app');
  fs.mkdirSync(origin, { recursive: true }); fs.mkdirSync(work, { recursive: true });
  git(origin, 'init', '-q', '--bare', '-b', 'develop');
  git(work, 'init', '-q', '-b', 'develop');
  copyTree(path.join(HERE, 'shop', 'base'), work);
  git(work, 'add', '-A'); git(work, 'commit', '-q', '-m', 'Shop: catalogue, accounts, cart and orders');
  git(work, 'remote', 'add', 'origin', origin);
  git(work, 'push', '-q', 'origin', 'develop');
  git(work, 'checkout', '-q', '-b', BRANCH);
  copyTree(path.join(HERE, 'shop', 'change'), work);
  git(work, 'add', '-A'); git(work, 'commit', '-q', '-m', 'BENCH-3 discount codes in the cart');
  git(work, 'push', '-q', 'origin', BRANCH);
  fs.rmSync(work, { recursive: true, force: true });
  git(outDir, 'clone', '-q', '--branch', BRANCH, origin, 'app');
  return { outDir, origin, app, branch: BRANCH, originUrl: 'file:///' + origin.split(path.sep).join('/').replace(/^\/+/, '') };
}

module.exports = { build, BRANCH };

if (require.main === module) {
  const r = build(process.argv[2] ? path.resolve(process.argv[2]) : undefined);
  console.log('Origin: ' + r.originUrl + '\nShop to run: node ' + path.join(r.app, 'server.js'));
}
