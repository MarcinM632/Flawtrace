// Deterministyczny skan bezpieczeństwa repozytorium: SEKRETY, SAST (wzorce niebezpiecznego kodu) i SCA
// (zależności). Liczy to APLIKACJA, nie agent. Agent Pentest ma wyłącznie narzędzia MCP `qa` (warstwa API)
// i jest ślepy na kod źródłowy, zależności i sekrety w repo — to klasy podatności, na które pentest API jest
// całkowicie ślepy, a które realnie powodują wycieki. Skan czyta pliki lokalnych kopii repo
// (sources.repoList()): to STATYCZNE czytanie plików, nie uruchamianie kodu, więc działa też na zahartowanym
// hostingu (gateway-token-only, blokada uruchamiania kodu). Wynik to lista znalezisk NIEZALEŻNA od treści
// raportu — fakt z kodu, nie twierdzenie modelu. To odpowiednik lib/pentest-coverage.js dla warstwy kodu.
//
// Zakres i ograniczenia (świadomie): reguły są wyselekcjonowane pod niską liczbę fałszywych trafień, nie pod
// kompletność. To nie zastępuje Semgrep/CodeQL (SAST), osv-scanner/Trivy (SCA) ani gitleaks — te narzędzia
// powinny działać w osobnym, izolowanym runnerze z jawną autoryzacją celu. Ten moduł daje warstwę, która
// zawsze jest dostępna w aplikacji, deterministyczna i bez zależności, i łapie najczęstsze, najgroźniejsze
// klasy błędów. Pole `limited` mówi, kiedy skan dotknął limitu (duże repo) i nie jest wyczerpujący.
const fs = require('fs');
const path = require('path');
const osvScan = require('./osv-scan');

// Katalogi, których nie skanujemy (zależności, artefakty budowania, repo .git, cache).
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'bower_components', 'vendor', 'dist', 'build', 'out', 'target', '.next', '.nuxt',
  'coverage', '__pycache__', '.venv', 'venv', 'env', '.gradle', '.idea', '.vscode', '.mvn', 'bin', 'obj',
  '.terraform', '.serverless', '.cache', '.pytest_cache', '.tox', 'site-packages', '.svn', '.hg',
]);
// Rozszerzenia binarne/niekodowe — pomijamy przy sekretach i SAST (ale manifesty SCA mają własną listę).
const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'svg', 'pdf', 'zip', 'gz', 'tar', 'tgz', 'bz2', '7z',
  'rar', 'jar', 'war', 'ear', 'class', 'so', 'dll', 'dylib', 'exe', 'o', 'a', 'bin', 'wasm', 'woff', 'woff2',
  'ttf', 'eot', 'otf', 'mp3', 'mp4', 'avi', 'mov', 'mkv', 'webm', 'wav', 'flac', 'psd', 'ai', 'sketch',
  'pyc', 'pyo', 'map', 'lock', 'min.js', 'min.css',
]);
const MAX_FILE_BYTES = 1_500_000; // pojedynczy plik większy niż ~1,5 MB pomijamy (minified/wygenerowany)
const MAX_FILES = 6000;           // twardy limit liczby plików na run
const MAX_BYTES_TOTAL = 80_000_000;
const PER_RULE_CAP = 25;          // tyle znalezisk na jedną regułę (reszta liczona w `more`)
const TOTAL_CAP = 400;

const ext = (f) => {
  const b = path.basename(f).toLowerCase();
  if (b.endsWith('.min.js')) return 'min.js';
  if (b.endsWith('.min.css')) return 'min.css';
  const i = b.lastIndexOf('.');
  return i < 0 ? '' : b.slice(i + 1);
};

function walk(root) {
  const files = [];
  let bytes = 0, hitLimit = false;
  const stack = ['.'];
  while (stack.length) {
    const rel = stack.pop();
    let entries;
    try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); }
    catch (_) { continue; }
    for (const e of entries) {
      const childRel = rel === '.' ? e.name : rel + '/' + e.name;
      if (e.isSymbolicLink()) continue; // nie podążamy za dowiązaniami (pętle, wyjście poza repo)
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(childRel); continue; }
      if (!e.isFile()) continue;
      let st;
      try { st = fs.statSync(path.join(root, childRel)); } catch (_) { continue; }
      if (st.size > MAX_FILE_BYTES) continue;
      if (files.length >= MAX_FILES || bytes + st.size > MAX_BYTES_TOTAL) { hitLimit = true; continue; }
      bytes += st.size;
      files.push({ rel: childRel, size: st.size });
    }
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return { files, hitLimit };
}

const lineAt = (text, index) => {
  let n = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
};
const snippet = (text, index) => {
  const start = text.lastIndexOf('\n', index) + 1;
  let end = text.indexOf('\n', index);
  if (end < 0) end = text.length;
  return text.slice(start, end).trim().slice(0, 200);
};

/* ----------------------------------------------- SEKRETY ----------------------------------------------- */
// Wartość wygląda na zaślepkę/odwołanie do zmiennej środowiskowej, nie na prawdziwy sekret.
const PLACEHOLDER = /^(?:x{3,}|\*{2,}|\.{3,}|changeme|change_me|change-me|placeholder|example|examples?|sample|dummy|your[-_a-z]*|<[^>]*>|\$\{?[\w.]+\}?|process\.env|os\.environ|env\[|getenv|secret|password|token|apikey|api_key|key|value|none|null|undefined|true|false|redacted|removed|todo|tbd|test|testing|foobar|foo|bar|baz|lorem|0+|1234\d*|abcd\w*)$/i;
const SECRET_RULES = [
  { id: 'private-key', title: 'Private key committed in the repository', severity: 'critical', cwe: 'CWE-312',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g },
  { id: 'aws-access-key', title: 'AWS access key id', severity: 'critical', cwe: 'CWE-798',
    re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[0-9A-Z]{16}\b/g },
  { id: 'github-token', title: 'GitHub token', severity: 'critical', cwe: 'CWE-798',
    re: /\bgh[pousr]_[0-9A-Za-z]{36,}\b/g },
  { id: 'gitlab-token', title: 'GitLab personal access token', severity: 'critical', cwe: 'CWE-798',
    re: /\bglpat-[0-9A-Za-z_-]{20,}\b/g },
  { id: 'slack-token', title: 'Slack token', severity: 'high', cwe: 'CWE-798',
    re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  { id: 'stripe-key', title: 'Stripe secret key', severity: 'critical', cwe: 'CWE-798',
    re: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}\b/g },
  { id: 'google-api-key', title: 'Google API key', severity: 'high', cwe: 'CWE-798',
    re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'google-oauth', title: 'Google OAuth client secret', severity: 'high', cwe: 'CWE-798',
    re: /\bGOCSPX-[0-9A-Za-z_-]{20,}\b/g },
  { id: 'npm-token', title: 'npm access token', severity: 'high', cwe: 'CWE-798',
    re: /\bnpm_[0-9A-Za-z]{36}\b/g },
  { id: 'sendgrid-key', title: 'SendGrid API key', severity: 'high', cwe: 'CWE-798',
    re: /\bSG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43}\b/g },
  { id: 'twilio-key', title: 'Twilio API key', severity: 'high', cwe: 'CWE-798',
    re: /\bSK[0-9a-fA-F]{32}\b/g },
  { id: 'db-url-password', title: 'Credentials embedded in a database/connection URL', severity: 'high', cwe: 'CWE-798',
    re: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mariadb|redis|amqp|amqps|rediss|ftp|ldap):\/\/[^:@/\s'"`]+:([^@/\s'"`]{3,})@/g,
    val: 1 },
  { id: 'basic-auth-url', title: 'Credentials embedded in an http(s) URL', severity: 'medium', cwe: 'CWE-522',
    re: /\bhttps?:\/\/[^:@/\s'"`]+:([^@/\s'"`]{3,})@/g, val: 1 },
  { id: 'jwt', title: 'Hardcoded JWT (verify it is not a real token)', severity: 'medium', cwe: 'CWE-522',
    re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  // Przypisanie wrażliwej nazwy do literału w cudzysłowie, z filtrem zaślepek.
  { id: 'generic-secret', title: 'Hardcoded secret in an assignment', severity: 'high', cwe: 'CWE-798',
    re: /(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?key|client[_-]?secret|auth[_-]?token|private[_-]?key|encryption[_-]?key)\s*[:=]\s*(?:=>)?\s*["'`]([^"'`\n]{6,120})["'`]/gi,
    val: 1, placeholder: true },
];

function scanSecrets(text, add) {
  for (const rule of SECRET_RULES) {
    rule.re.lastIndex = 0;
    let m, count = 0;
    while ((m = rule.re.exec(text)) !== null) {
      if (m.index === rule.re.lastIndex) rule.re.lastIndex++; // zabezpieczenie przed pustym dopasowaniem
      const value = rule.val ? m[rule.val] : m[0];
      if (rule.placeholder && (PLACEHOLDER.test(value.trim()) || /\$\{|\{\{|%\(|<%|os\.environ|process\.env|getenv/i.test(value))) continue;
      if (++count > PER_RULE_CAP) { add.more(rule.id); continue; }
      add.finding({ scanner: 'secret', rule: rule.id, severity: rule.severity, cwe: rule.cwe, title: rule.title,
        index: m.index, text });
    }
  }
}

/* ------------------------------------------------- SAST ------------------------------------------------- */
// Reguły wzorców niebezpiecznego kodu. `langs` = rozszerzenia, których dotyczy ('*' = wszystkie teksty).
const JS = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'svelte'];
const PY = ['py'];
const JVM = ['java', 'kt', 'kts', 'scala', 'groovy'];
const PHP = ['php'];
const GO = ['go'];
const RUBY = ['rb'];
const SAST_RULES = [
  // --- Wstrzyknięcie poleceń systemowych ---
  { id: 'js-cmd-injection', title: 'Command execution with a template literal / concatenation (command injection)',
    severity: 'high', cwe: 'CWE-78', langs: JS,
    re: /\b(?:child_process\.)?(?:exec|execSync|spawn|spawnSync|execFile)\s*\(\s*(?:`[^`]*\$\{|["'][^"']*["']\s*\+|[A-Za-z_$][\w$]*\s*\+)/g },
  { id: 'py-shell-true', title: 'subprocess with shell=True (command injection if input is tainted)',
    severity: 'high', cwe: 'CWE-78', langs: PY, re: /shell\s*=\s*True/g },
  { id: 'py-os-system', title: 'os.system / os.popen with a built string (command injection)',
    severity: 'high', cwe: 'CWE-78', langs: PY, re: /\bos\.(?:system|popen)\s*\(\s*(?:f["']|[^)]*[+%]\s)/g },
  { id: 'php-cmd', title: 'Shell command execution (command injection if input is tainted)',
    severity: 'high', cwe: 'CWE-78', langs: PHP, re: /\b(?:system|exec|shell_exec|passthru|proc_open|popen)\s*\(/g },
  { id: 'jvm-runtime-exec', title: 'Runtime.exec / ProcessBuilder (command injection if input is tainted)',
    severity: 'medium', cwe: 'CWE-78', langs: JVM, re: /\b(?:Runtime\.getRuntime\(\)\.exec|new\s+ProcessBuilder)\s*\(/g },
  // --- Wykonanie kodu / niebezpieczna deserializacja ---
  { id: 'js-eval', title: 'eval / new Function (arbitrary code execution)', severity: 'high', cwe: 'CWE-95',
    langs: JS, re: /\b(?:eval|new\s+Function)\s*\(/g },
  { id: 'py-eval', title: 'eval / exec on a value (arbitrary code execution)', severity: 'high', cwe: 'CWE-95',
    langs: PY, re: /\b(?:eval|exec)\s*\(\s*(?!["'][^"']*["']\s*\))/g },
  { id: 'py-pickle', title: 'pickle / marshal.loads (insecure deserialization)', severity: 'high', cwe: 'CWE-502',
    langs: PY, re: /\b(?:pickle|cPickle|_pickle|marshal)\.loads?\s*\(/g },
  { id: 'py-yaml-load', title: 'yaml.load without SafeLoader (insecure deserialization)', severity: 'high',
    cwe: 'CWE-502', langs: PY, re: /\byaml\.load\s*\((?![^)]*Safe)/g },
  { id: 'jvm-deserial', title: 'ObjectInputStream.readObject (insecure deserialization)', severity: 'high',
    cwe: 'CWE-502', langs: JVM, re: /\b(?:ObjectInputStream|readObject\s*\()/g },
  { id: 'php-unserialize', title: 'unserialize on external data (object injection)', severity: 'high',
    cwe: 'CWE-502', langs: PHP, re: /\bunserialize\s*\(/g },
  // --- SQL injection ---
  { id: 'sql-concat', title: 'SQL query built by string concatenation (SQL injection)', severity: 'high',
    cwe: 'CWE-89', langs: [...JS, ...JVM, ...PHP, ...GO, ...RUBY],
    re: /["'`][^"'`\n]*\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WHERE|FROM)\b[^"'`\n]*["'`]\s*\+\s*[A-Za-z_$]/gi },
  { id: 'py-sql-fstring', title: 'SQL query built with an f-string / % (SQL injection)', severity: 'high',
    cwe: 'CWE-89', langs: PY,
    re: /\.(?:execute|executemany|executescript|raw)\s*\(\s*(?:f["'][^"']*\b(?:SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)\b|["'][^"']*%s?[^"']*["']\s*%)/gi },
  { id: 'js-sql-template', title: 'SQL in a template literal with interpolation (SQL injection)', severity: 'high',
    cwe: 'CWE-89', langs: JS, re: /`[^`]*\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WHERE)\b[^`]*\$\{/gi },
  // --- Słaba kryptografia / losowość ---
  { id: 'weak-hash', title: 'Weak hash (MD5/SHA1) used for security', severity: 'medium', cwe: 'CWE-327',
    langs: '*', re: /\b(?:md5|sha1)\s*\(|["'](?:MD5|SHA-?1)["']|MessageDigest\.getInstance\(\s*["'](?:MD5|SHA-?1)["']/gi },
  { id: 'weak-cipher', title: 'Weak/broken cipher or mode (DES/RC4/ECB)', severity: 'medium', cwe: 'CWE-327',
    langs: '*', re: /\b(?:DES|RC4|ARC4|Blowfish)\b|["'][A-Z]+\/ECB\/|AES\/ECB/g },
  { id: 'insecure-random', title: 'Math.random / weak RNG used for a token or secret', severity: 'low',
    cwe: 'CWE-338', langs: JS, re: /Math\.random\(\)[^;]*(?:token|secret|password|nonce|otp|salt|session|key)/gi },
  // --- TLS / weryfikacja certyfikatu wyłączona ---
  { id: 'tls-node', title: 'TLS certificate verification disabled (rejectUnauthorized:false)', severity: 'high',
    cwe: 'CWE-295', langs: JS, re: /rejectUnauthorized\s*:\s*false/g },
  { id: 'tls-env', title: 'NODE_TLS_REJECT_UNAUTHORIZED set to 0 (TLS verification off globally)',
    severity: 'high', cwe: 'CWE-295', langs: '*', re: /NODE_TLS_REJECT_UNAUTHORIZED\s*[:=]\s*["']?0/g },
  { id: 'tls-python', title: 'TLS certificate verification disabled (verify=False)', severity: 'high',
    cwe: 'CWE-295', langs: PY, re: /verify\s*=\s*False/g },
  { id: 'tls-go', title: 'TLS certificate verification disabled (InsecureSkipVerify:true)', severity: 'high',
    cwe: 'CWE-295', langs: GO, re: /InsecureSkipVerify\s*:\s*true/g },
  // --- Web / warstwa transportu ---
  { id: 'cors-wildcard', title: 'CORS allows any origin (Access-Control-Allow-Origin: *)', severity: 'medium',
    cwe: 'CWE-942', langs: '*', re: /Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*["']|origin\s*:\s*["']\*["']/g },
  { id: 'xss-sink', title: 'Unsanitized HTML sink (innerHTML / dangerouslySetInnerHTML / document.write)',
    severity: 'medium', cwe: 'CWE-79', langs: JS,
    re: /\.innerHTML\s*=|dangerouslySetInnerHTML|document\.write\s*\(/g },
  { id: 'open-redirect', title: 'Redirect to a user-controlled value (open redirect)', severity: 'medium',
    cwe: 'CWE-601', langs: JS, re: /(?:res|response)\.redirect\s*\(\s*(?:req|request)\.(?:query|params|body)/g },
  { id: 'ssrf', title: 'Outbound request to a user-controlled URL (SSRF)', severity: 'medium', cwe: 'CWE-918',
    langs: [...JS, ...PY], re: /(?:fetch|axios(?:\.get|\.post)?|requests\.(?:get|post|put|delete)|urlopen)\s*\(\s*(?:req|request)\.(?:query|params|body)/g },
  { id: 'path-traversal', title: 'File path built from a request value (path traversal)', severity: 'medium',
    cwe: 'CWE-22', langs: JS, re: /(?:readFile|readFileSync|createReadStream|sendFile|unlink|writeFile)\s*\([^)]*(?:req|request)\.(?:query|params|body)/g },
  { id: 'csrf-disabled', title: 'CSRF protection disabled', severity: 'medium', cwe: 'CWE-352',
    langs: '*', re: /csrf\s*:\s*false|@csrf_exempt|csrf_exempt|WTF_CSRF_ENABLED\s*=\s*False/g },
  { id: 'debug-on', title: 'Debug mode enabled (stack traces / introspection exposed)', severity: 'low',
    cwe: 'CWE-489', langs: '*', re: /DEBUG\s*=\s*True|app\.debug\s*=\s*true|FLASK_DEBUG\s*=\s*1/g },
  { id: 'cookie-insecure', title: 'Cookie set without HttpOnly or Secure', severity: 'low', cwe: 'CWE-614',
    langs: JS, re: /httpOnly\s*:\s*false|secure\s*:\s*false/gi },
];

function scanSast(text, fileExt, add) {
  for (const rule of SAST_RULES) {
    if (rule.langs !== '*' && !rule.langs.includes(fileExt)) continue;
    rule.re.lastIndex = 0;
    let m, count = 0;
    while ((m = rule.re.exec(text)) !== null) {
      if (m.index === rule.re.lastIndex) rule.re.lastIndex++;
      if (++count > PER_RULE_CAP) { add.more(rule.id); continue; }
      add.finding({ scanner: 'sast', rule: rule.id, severity: rule.severity, cwe: rule.cwe, title: rule.title,
        index: m.index, text });
    }
  }
}

/* -------------------------------------------------- SCA -------------------------------------------------- */
// Mała, wyselekcjonowana baza znanych krytycznych podatności (nie jest wyczerpująca — to świadomy wybór;
// pełne SCA wymaga osv-scanner/Trivy w osobnym runnerze). `below` = wersja, PONIŻEJ której pakiet jest podatny.
const ADVISORIES = [
  { eco: 'npm', name: 'lodash', below: '4.17.21', severity: 'high', note: 'prototype pollution (CVE-2020-8203 i in.)' },
  { eco: 'npm', name: 'minimist', below: '1.2.6', severity: 'high', note: 'prototype pollution (CVE-2021-44906)' },
  { eco: 'npm', name: 'node-fetch', below: '2.6.7', severity: 'high', note: 'exposure of sensitive info on redirect (CVE-2022-0235)' },
  { eco: 'npm', name: 'axios', below: '0.21.2', severity: 'high', note: 'SSRF / credential leak on redirect' },
  { eco: 'npm', name: 'ejs', below: '3.1.7', severity: 'critical', note: 'template injection / RCE (CVE-2022-29078)' },
  { eco: 'npm', name: 'jsonwebtoken', below: '9.0.0', severity: 'high', note: 'weak key handling / verification bypass' },
  { eco: 'npm', name: 'next', below: '13.4.20', severity: 'high', note: 'several advisories; upgrade' },
  { eco: 'npm', name: 'express', below: '4.17.3', severity: 'medium', note: 'open redirect / ReDoS in deps' },
  { eco: 'npm', name: 'y18n', below: '4.0.1', severity: 'high', note: 'prototype pollution (CVE-2020-7774)' },
  { eco: 'pypi', name: 'requests', below: '2.20.0', severity: 'medium', note: 'credential leak on redirect' },
  { eco: 'pypi', name: 'urllib3', below: '1.26.5', severity: 'high', note: 'CRLF / SSRF (CVE-2021-33503)' },
  { eco: 'pypi', name: 'pyyaml', below: '5.4', severity: 'high', note: 'arbitrary code execution via full_load (CVE-2020-14343)' },
  { eco: 'pypi', name: 'django', below: '3.2.0', severity: 'high', note: 'multiple advisories; upgrade to a supported release' },
  { eco: 'pypi', name: 'flask', below: '2.2.5', severity: 'medium', note: 'multiple advisories; upgrade' },
  { eco: 'maven', name: 'log4j-core', below: '2.17.1', severity: 'critical', note: 'Log4Shell RCE (CVE-2021-44228 i in.)' },
  { eco: 'maven', name: 'commons-text', below: '1.10.0', severity: 'critical', note: 'Text4Shell RCE (CVE-2022-42889)' },
  { eco: 'maven', name: 'snakeyaml', below: '1.33', severity: 'high', note: 'deserialization RCE (CVE-2022-1471)' },
  { eco: 'maven', name: 'spring-core', below: '5.3.18', severity: 'critical', note: 'Spring4Shell RCE (CVE-2022-22965)' },
];
const nums = (v) => String(v).replace(/^[^\d]*/, '').split(/[.\-+]/).map((x) => parseInt(x, 10) || 0);
const lt = (a, b) => { const x = nums(a), y = nums(b); for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0; } return false; };
// Z zakresu npm/pip (^1.2.3, ~1.2, >=1.2.0, 1.2.*, v1.2) wyciągamy wersję bazową do porównania przybliżonego.
const baseVersion = (range) => { const m = String(range).match(/\d+(?:\.\d+){0,2}/); return m ? m[0] : null; };
const isFloating = (range) => /^(\*|latest|x|\^?\d+\.x|.*\|\|.*)$/i.test(String(range).trim()) || String(range).trim() === '';

function scaFromPackageJson(text, add, relFile) {
  let pkg;
  try { pkg = JSON.parse(text); } catch (_) { return; }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.optionalDependencies || {}) };
  for (const [name, range] of Object.entries(deps)) {
    if (typeof range !== 'string' || /^(file:|link:|workspace:|git|github:|https?:)/i.test(range)) continue;
    if (isFloating(range)) add.sca({ severity: 'low', rule: 'floating-version', title: `Dependency "${name}" uses a floating version "${range}" (non-reproducible, supply-chain risk)`, file: relFile, pkg: name, version: range });
    const base = baseVersion(range);
    for (const adv of ADVISORIES) {
      if (adv.eco !== 'npm' || adv.name !== name || !base) continue;
      if (lt(base, adv.below)) add.sca({ severity: adv.severity, rule: 'known-vuln', title: `Dependency "${name}@${range}" is below ${adv.below}: ${adv.note}`, file: relFile, pkg: name, version: range, fixed: adv.below });
    }
  }
}
function scaFromRequirements(text, add, relFile) {
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z0-9_.-]+)\s*==\s*([\w.]+)/);
    if (!m) { const loose = line.match(/^([A-Za-z0-9_.-]+)\s*(?:>=|~=|>)\s*[\w.]+/); if (loose) add.sca({ severity: 'low', rule: 'floating-version', title: `Dependency "${loose[1]}" is not pinned (==) in requirements (non-reproducible)`, file: relFile, pkg: loose[1], version: line }); continue; }
    const [, name, version] = m;
    for (const adv of ADVISORIES) if (adv.eco === 'pypi' && adv.name === name.toLowerCase() && lt(version, adv.below))
      add.sca({ severity: adv.severity, rule: 'known-vuln', title: `Dependency "${name}==${version}" is below ${adv.below}: ${adv.note}`, file: relFile, pkg: name, version, fixed: adv.below });
  }
}
function scaFromMaven(text, add, relFile) {
  // pom.xml <artifactId>..</artifactId> + sąsiednie <version>; build.gradle "group:artifact:version".
  const re = /<artifactId>\s*([\w.-]+)\s*<\/artifactId>\s*<version>\s*([\w.${}-]+)\s*<\/version>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1], version = m[2];
    if (/[${]/.test(version)) continue;
    for (const adv of ADVISORIES) if (adv.eco === 'maven' && adv.name === name && lt(version, adv.below))
      add.sca({ severity: adv.severity, rule: 'known-vuln', title: `Dependency "${name}:${version}" is below ${adv.below}: ${adv.note}`, file: relFile, pkg: name, version, fixed: adv.below });
  }
  const g = /["']([\w.-]+):([\w.-]+):([\w.${}-]+)["']/g;
  while ((m = g.exec(text)) !== null) {
    const name = m[2], version = m[3];
    if (/[${]/.test(version)) continue;
    for (const adv of ADVISORIES) if (adv.eco === 'maven' && adv.name === name && lt(version, adv.below))
      add.sca({ severity: adv.severity, rule: 'known-vuln', title: `Dependency "${name}:${version}" is below ${adv.below}: ${adv.note}`, file: relFile, pkg: name, version, fixed: adv.below });
  }
}

/* ------------------------------------------------ RUNNER ------------------------------------------------ */
const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const MANIFESTS = new Set(['package.json', 'requirements.txt', 'requirements-dev.txt', 'pom.xml', 'build.gradle', 'build.gradle.kts']);
const LOCKFILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json'];

function scanRepo(root, name) {
  const { files, hitLimit } = walk(root);
  const findings = [];
  const manifests = []; // pliki blokad / przypięte manifesty dla SCA przez OSV (rel + treść), z limitem
  const more = {};
  const seen = new Set();
  const add = {
    finding: (f) => {
      const line = lineAt(f.text, f.index);
      const key = `${f.rule}:${f.rel || ''}:${line}`;
      if (seen.has(key)) return; seen.add(key);
      findings.push({ repo: name, scanner: f.scanner, rule: f.rule, severity: f.severity, cwe: f.cwe || null,
        title: f.title, file: f.rel, line, snippet: snippet(f.text, f.index) });
    },
    sca: (f) => findings.push({ repo: name, scanner: 'sca', rule: f.rule, severity: f.severity, cwe: f.cwe || 'CWE-1104',
      title: f.title, file: f.file, line: null, pkg: f.pkg || null, version: f.version || null, fixed: f.fixed || null, snippet: null }),
    more: (id) => { more[id] = (more[id] || 0) + 1; },
  };
  let hasNpmManifest = false, hasLockfile = false;
  for (const { rel } of files) {
    const base = path.basename(rel).toLowerCase();
    if (base === 'package.json' && !rel.includes('/')) hasNpmManifest = true;
    if (LOCKFILES.includes(base) && !rel.includes('/')) hasLockfile = true;
    let text;
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch (_) { continue; }
    if (text.indexOf('\u0000') !== -1) continue; // plik binarny mimo rozszerzenia
    const fx = ext(rel);
    // SCA przez OSV: zbierz pliki, z których da się wyciągnąć dokładne wersje (blokady, Pipfile.lock, go.mod…).
    if (manifests.length < 60 && osvScan.PARSERS.some(([re]) => re.test(rel))) manifests.push({ rel: `${name}/${rel}`, text });
    // SCA (wbudowana, offline): manifesty zależności.
    if (MANIFESTS.has(base)) {
      if (base === 'package.json') scaFromPackageJson(text, { sca: (o) => add.sca({ ...o }) }, rel);
      else if (base.startsWith('requirements')) scaFromRequirements(text, { sca: (o) => add.sca({ ...o }) }, rel);
      else if (base === 'pom.xml' || base.startsWith('build.gradle')) scaFromMaven(text, { sca: (o) => add.sca({ ...o }) }, rel);
    }
    if (BINARY_EXT.has(fx)) continue;
    // Sekrety — w każdym pliku tekstowym (łącznie z .env, konfigami, yaml).
    add.rel = rel;
    const addF = { finding: (o) => add.finding({ ...o, rel }), more: add.more };
    scanSecrets(text, addF);
    scanSast(text, fx, addF);
  }
  if (hasNpmManifest && !hasLockfile)
    findings.push({ repo: name, scanner: 'sca', rule: 'no-lockfile', severity: 'low', cwe: 'CWE-1104',
      title: 'No lockfile (package-lock.json / yarn.lock) next to package.json: installs are non-reproducible (supply-chain risk)', file: 'package.json', line: null, snippet: null });
  findings.sort((a, b) => (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]) || (a.scanner < b.scanner ? -1 : a.scanner > b.scanner ? 1 : 0) || (String(a.file) < String(b.file) ? -1 : 1));
  return { files: files.length, hitLimit, findings, more, manifests };
}

/** Skan wszystkich gotowych repo. `repos` = sources.repoList() (albo własna lista {name, path, ready}). */
function scan(repos) {
  const ready = (repos || []).filter((r) => r && r.ready && r.path && fs.existsSync(r.path));
  if (!ready.length) return { available: false, reason: 'no repositories connected', repos: [], findings: [], counts: emptyCounts(), limited: false, scannedFiles: 0 };
  let findings = [], scannedFiles = 0, limited = false;
  const repoStats = [];
  const manifests = [];
  for (const r of ready) {
    const res = scanRepo(r.path, r.name);
    findings = findings.concat(res.findings);
    for (const m of res.manifests) if (manifests.length < 120) manifests.push(m);
    scannedFiles += res.files;
    if (res.hitLimit) limited = true;
    repoStats.push({ name: r.name, files: res.files, findings: res.findings.length, limited: res.hitLimit });
  }
  findings.sort((a, b) => (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]) || (a.scanner < b.scanner ? -1 : a.scanner > b.scanner ? 1 : 0));
  let capped = false;
  if (findings.length > TOTAL_CAP) { findings = findings.slice(0, TOTAL_CAP); capped = true; }
  return { available: true, repos: repoStats, findings, counts: countBy(findings), limited: limited || capped, scannedFiles, manifests };
}
function emptyCounts() { return { total: 0, critical: 0, high: 0, medium: 0, low: 0, secret: 0, sast: 0, sca: 0 }; }
function countBy(findings) {
  const c = emptyCounts();
  for (const f of findings) { c.total++; c[f.severity] = (c[f.severity] || 0) + 1; c[f.scanner] = (c[f.scanner] || 0) + 1; }
  return c;
}

/** Zarzuty do tury korekty agenta Pentest: krytyczne/wysokie znaleziska kodu, których raport nie wspomina. */
function repoScanIssues(result, report) {
  if (!result || !result.available) return [];
  const serious = result.findings.filter((f) => f.severity === 'critical' || f.severity === 'high');
  if (!serious.length) return [];
  const rep = String(report || '').toLowerCase();
  // "Wspomniany" = raport nazywa plik znaleziska albo jego regułę/CWE. Zgrubne, ale wystarcza na nudge.
  const unmentioned = serious.filter((f) => {
    const file = (f.file || '').toLowerCase();
    return !(file && rep.includes(path.basename(file))) && !rep.includes(f.rule) && !(f.cwe && rep.includes(f.cwe.toLowerCase()));
  });
  if (!unmentioned.length) return [];
  const top = unmentioned.slice(0, 12).map((f) => `${f.severity.toUpperCase()} ${f.scanner} ${f.rule} — ${f.file}${f.line ? ':' + f.line : ''}`);
  return [{ code: 'pentest-repo-findings', text: `Static repo scan found ${unmentioned.length} critical/high code, dependency or secret finding(s) not covered by the report: ${top.join('; ')}${unmentioned.length > 12 ? ` (+${unmentioned.length - 12} more)` : ''}.` }];
}

/** Krótkie podsumowanie do bloku POKRYCIE/KOD w raporcie (tekst, nie HTML). */
function summary(result) {
  if (!result || !result.available) return '';
  const c = result.counts;
  if (!c.total) return `Static repo scan (app): ${result.scannedFiles} files, no secret/SAST/SCA findings.`;
  const osv = result.osv && result.osv.found != null ? ` OSV: ${result.osv.found} known vuln(s) in ${result.osv.queried} pinned dependencies.` : (result.osv && result.osv.available === false ? ' (OSV lookup unavailable: ' + (result.osv.reason || 'offline') + '.)' : '');
  return `Static repo scan (app): ${c.total} finding(s) across ${result.scannedFiles} files — ${c.critical} critical, ${c.high} high, ${c.medium} medium, ${c.low} low (secrets ${c.secret}, SAST ${c.sast}, SCA ${c.sca}).${osv}`;
}

/** Dołącza findingi OSV (sca-osv) do wyniku scan(), z deduplikacją względem wbudowanej listy (ta sama paczka+wersja). */
function mergeOsv(result, osv) {
  if (!result || !result.available || !osv || !osv.available || !osv.findings.length) { if (result) result.osv = osv || null; return result; }
  const have = new Set(result.findings.filter((f) => f.scanner === 'sca').map((f) => `${f.pkg}|${f.version}`));
  const add = osv.findings.filter((f) => !have.has(`${f.pkg}|${f.version}`) || f.id);
  result.findings = result.findings.concat(add.map((f) => ({ repo: null, scanner: 'sca', rule: 'osv', severity: f.severity, cwe: f.cwe, title: f.title, file: f.file, line: null, pkg: f.pkg, version: f.version, fixed: f.fixed, id: f.id, url: f.url, snippet: null })));
  result.findings.sort((a, b) => (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]) || (a.scanner < b.scanner ? -1 : a.scanner > b.scanner ? 1 : 0));
  result.counts = countBy(result.findings);
  result.osv = { queried: osv.queried, found: osv.findings.length, ecosystems: osv.ecosystems };
  return result;
}

module.exports = { scan, mergeOsv, repoScanIssues, summary, SAST_RULES, SECRET_RULES, ADVISORIES, _lt: lt, _walk: walk };
