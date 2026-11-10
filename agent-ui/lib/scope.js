// Zakres narzędzi MCP per run, wbudowane narzędzia Claude Code, limity czasu i zliczanie tokenów.
const fs = require('fs');
const path = require('path');
const { APP_DIR } = require('./config');
const { glossaryGroups } = require('./glossary');

// ---------------------------------------------------------------------------------------------
// Zakres narzędzi QA MCP. Claude Code ładuje narzędzia MCP leniwie (przez ToolSearch), ale sam katalog nadal zajmuje kontekst:
// zmierzone dla identycznego wywołania, pełne 628 narzędzi to ~44,9 tys. tokenów stałego kontekstu na turę, a 100 narzędzi
// ~32,8 tys. (różnica ~12 tys. na turę). Dlatego run dostaje tylko grupy potrzebne procesowi; reszta pozostaje widoczna w
// katalogu (pole loaded) i dostępna w trybie "All tools". Mapa narzędzie -> grupa: tool-groups.json (scripts/build-tool-groups.mjs).
// ---------------------------------------------------------------------------------------------
// Czytana ponownie, gdy plik się zmieni (przebudowa po "Reinitialize all endpoints" albo npm run tool-groups),
// żeby nowe grupy trafiały do runów bez restartu serwera.
const TOOL_GROUPS_FILE = path.join(APP_DIR, 'tool-groups.json');
let toolGroupsCache, toolGroupsMtime;
const resetToolGroups = () => { toolGroupsCache = undefined; };
const toolGroups = () => {
  let mtime = null;
  try { mtime = fs.statSync(TOOL_GROUPS_FILE).mtimeMs; } catch (_) { /* brak pliku */ }
  if (toolGroupsCache !== undefined && mtime === toolGroupsMtime) return toolGroupsCache;
  toolGroupsMtime = mtime;
  try { toolGroupsCache = JSON.parse(fs.readFileSync(TOOL_GROUPS_FILE, 'utf8')); } catch (_) { toolGroupsCache = null; }
  return toolGroupsCache;
};
// Baza: konta i handel (prawie każdy proces ich dotyka), wyszukiwanie kont w hedgerze i odczyt grupy kont AUTOTEST.
// core-hedger-exposure też: zasady QA MCP każą odczytać reguły AUTOTEST przed każdym handlem (run 124c nie miał jak).
const SCOPE_BASE = ['manager-accounts', 'manager-trading', 'manager-history', 'manager-reference', 'core-hedger-accounts', 'admin-accounts', 'core-hedger-exposure'];
const HEDGER = ['core-hedger-exposure', 'core-hedger-engine', 'core-hedger-tiers', 'plat-manager-risk', 'core-notify-risk', 'plat-admin-risk', 'core-admin-symbols'];
// Wzorce są celowo wąskie: długie opisy procesów wspominają wiele serwisów mimochodem, a luźne słowa ("group", "token", "feed")
// ściągałyby prawie cały katalog. Czego wzorce nie złapią, agent zgłosi jako NOT VERIFIABLE, a tester powtórzy z "All tools".
const SCOPE_RULES = [
  [/hedg|exposure|tranche|threshold|reaction step|volume rule|lp level|ekspozycj/i, HEDGER],
  [/routing|b-?book|a-?book|b2b/i, ['core-admin-routing', 'plat-admin-risk', 'plat-manager-risk']],
  [/abuse (rule|router)|latency arbitrage/i, ['core-admin-abuse', 'plat-admin-risk', 'core-notify-plat-admin']],
  [/markup|liquidity provider|lp (connector|symbol|markup|config)|external lp|order ?book|bad ?tick|candle/i, ['admin-liquidity', 'core-admin-lp', 'core-admin-orderbook', 'admin-market-data']],
  [/(spread|price) (rule|overcome|config)|negative spread|quick (price|spread)|stale feed|no quote|similar trading|rejected orders/i, ['core-manager-behaviour', 'core-manager-price', 'core-manager-spread']],
  [/instrument (config|group|categor|session|definition)|trading session|holiday|swap (config|rate)/i, ['admin-instruments', 'core-admin-symbols', 'core-manager-symbols']],
  [/account group|instrument group|core group|group (markup|delay|exposure)|special account|leverage/i, ['core-admin-groups']],
  [/fix (connector|session|conn)|settlement date/i, ['admin-fix']],
  [/\b(deposit|withdraw|credit)s?\b|ledger|wpłat|wypłat/i, ['core-manager-ledgers']],
  [/price feed|feed (delay|rule|pattern)|arbitrage opportunit/i, ['core-feed-patterns', 'core-feed-info']],
  [/permission|core user|audit log/i, ['core-gateway-users', 'core-gateway-audit', 'core-gateway-auth']],
  [/mailing|mail (type|template|generation)|smtp|trigger rule|e-?mail template/i, ['core-notify-mailing']],
  [/kafka|persistence|scheduler|automation script|global parameter|\belk\b|api token|logs?\b/i, ['admin-platform']],
];
/** Które grupy załadować dla procesu: baza (konto, handel, historia, referencje) + to, co wynika z treści. */
function scopeFor(text, mode) {
  const tg = toolGroups();
  if (mode === 'all' || !tg) return { mode: 'all', groups: null, tools: Object.keys((tg && tg.tools) || {}).length || 628 };
  const set = new Set(SCOPE_BASE);
  const s = String(text || '');
  for (const n of s.match(/\b(?:admin|manager|core)_[a-z0-9_]+\b/g) || []) if (tg.tools[n]) set.add(tg.tools[n]);
  for (const [re, gs] of SCOPE_RULES) if (re.test(s)) gs.forEach((g) => set.add(g));
  glossaryGroups(s, tg).forEach((g) => set.add(g));
  // Grupy auto-* (serwis dodany w specyfikacji, jeszcze nieopisany w groups.js) nie mają reguły: ładują się, gdy tekst
  // zawiera słowa z ich nazwy (np. auto-core-notify-mailing-template -> "mailing", "template"). Dzięki temu nowy
  // endpoint działa w runie bez zmian w kodzie.
  for (const [key, g] of Object.entries(tg.groups)) {
    if (!g.auto) continue;
    const words = key.replace(/^auto-(core-)?[a-z]+-/, '').split('-').filter((w) => w.length > 3);
    if (words.length && words.some((w) => new RegExp('\\b' + w, 'i').test(s))) set.add(key);
  }
  const groups = [...set].filter((g) => tg.groups[g]);
  return { mode: 'auto', groups, tools: groups.reduce((n, g) => n + tg.groups[g].tools, 0) };
}
const SCOPE_NOTE = `

ZAKRES NARZĘDZI: z oszczędności załadowano tylko część grup narzędzi MCP (lista w general_get_status -> loadedGroups).
Narzędzie z niezaładowanej grupy zwróci błąd "group ... is not loaded". Nie zgaduj i nie obchodź tego: krok, który go
wymaga, oznacz NOT VERIFIABLE VIA MCP — grupa niezaładowana: <nazwa grupy> i kontynuuj resztę procesu. Katalog
(general_read_list_endpoints) pokazuje też narzędzia niezaładowane, z polem loaded.`;

/** Sumuje zużycie tokenów z przejść agenta; potem widać, ile naprawdę kosztuje run, a nie tylko w dolarach. */
function addUsage(meta, res) {
  if (!res || !res.usage) return;
  const u = meta.usage || (meta.usage = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, turns: 0 });
  u.input += res.usage.input_tokens || 0;
  u.output += res.usage.output_tokens || 0;
  u.cacheCreate += res.usage.cache_creation_input_tokens || 0;
  u.cacheRead += res.usage.cache_read_input_tokens || 0;
  u.turns += res.turns || 0;
}

// Twardy limit czasu jednego przejścia agenta. Zawieszony run kosztuje, dopóki ktoś go nie anuluje (w historii jest run,
// który wisiał ponad 16 godzin).
// Wbudowane narzędzia Claude Code, które agent faktycznie dostaje (--tools). Domyślny zestaw to kilkadziesiąt narzędzi,
// których schematy wchodzą do kontekstu każdej tury; ToolSearch zostaje, bo to on ładuje narzędzia MCP na żądanie
// (z `--tools ''` wszystkie narzędzia MCP lądują w kontekście od razu). Zmierzone dla QA MCP: 32,8 tys. -> 11,7 tys.
// tokenów stałego kontekstu, dla sesji Jiry: 57,3 tys. -> 3,7 tys.
const BUILTIN_TOOLS = {
  qamcp: ['ToolSearch'],
  autotest: ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Skill', 'ToolSearch'],
  qa: ['Bash', 'Read', 'Grep', 'Glob', 'Agent', 'Skill', 'Edit', 'Write', 'ToolSearch'],
};
BUILTIN_TOOLS.design = BUILTIN_TOOLS.qa;
BUILTIN_TOOLS.planning = BUILTIN_TOOLS.qa;
BUILTIN_TOOLS.analysis = BUILTIN_TOOLS.qa;
BUILTIN_TOOLS.execution = BUILTIN_TOOLS.qamcp;
BUILTIN_TOOLS.implementation = BUILTIN_TOOLS.qa;
BUILTIN_TOOLS.completion = BUILTIN_TOOLS.qa;
const RUN_LIMIT_MIN = { design: 60, qa: 45, qamcp: 30, autotest: 20, planning: 50, analysis: 50, execution: 30, implementation: 40, completion: 15 };
const runLimitMs = (mode) => (Number(process.env.QA_RUN_LIMIT_MIN) || RUN_LIMIT_MIN[mode] || 45) * 60000;

module.exports = {
  BUILTIN_TOOLS,
  SCOPE_NOTE,
  addUsage,
  runLimitMs,
  scopeFor,
  resetToolGroups,
  toolGroups,
};
