// Which backend environment the running tests target. Stripped-down stub for this public copy:
// the original switched between the (removed) private test-env/.env files of the backend MCP
// server; only the generic single-profile shape is kept so the rest of the app still loads.
const fs = require('fs');

const PROFILES = {
  'default': {
    key: 'default',
    label: 'default',
    envFile: '',
    confirm: false,
  },
};

let current = 'default';

function list() {
  return Object.values(PROFILES).map((p) => ({
    key: p.key,
    label: p.label,
    confirm: p.confirm,
    ready: p.envFile ? fs.existsSync(p.envFile) : false,
  }));
}

function get() {
  return current;
}

function profile(key = current) {
  return PROFILES[key] || PROFILES.default;
}

function set(key) {
  if (!PROFILES[key]) throw Object.assign(new Error(`Unknown environment "${key}"`), { code: 400 });
  current = key;
  return profile();
}

module.exports = { get, set, list, profile };
