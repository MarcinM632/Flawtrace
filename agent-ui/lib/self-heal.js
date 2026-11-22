// Fundament samonaprawialnych testów UI. Wygenerowany test Playwright jest deterministyczny, ale kruchy: gdy UI się
// zmieni (inny selektor, przesunięty element, zmiana nawigacji), test pada, choć CEL po ludzku się nie zmienił.
// Wzorem frameworka e2e (intencja po ludzku zostaje w teście, a mechanika jest tylko cache'em) aplikacja przy
// akceptacji zachowuje INTENCJĘ przebiegu (flow NL), a ten moduł patrzy na komunikat błędu Playwrighta i
// deterministycznie doradza: ODTWÓRZ z intencji (zmiana UI — niech agent przejdzie cel od nowa i zapisze nowy test)
// czy ZAŁATAJ (dryf logiki/oczekiwań — popraw asercję). To nie wykonuje naprawy; daje bramkę decyzyjną dla ui-fix /
// ponownej akceptacji. Czysty, bez efektów ubocznych.

/** Klasa awarii na podstawie komunikatu Playwrighta. Lokator sprawdzamy przed timeoutem, bo „Timeout … waiting for
 *  locator" to zmiana UI, nie zbyt krótki czas. */
function classify(errorText) {
  const t = String(errorText || '');
  if (/strict mode violation|resolved to \d+ element|locator\(|getBy\w+\(|waiting for (?:locator|selector|element)|element is (?:not visible|not attached|not stable|not enabled|outside)|no element|selector resolved/i.test(t)) return 'locator';
  if (/net::ERR|ERR_[A-Z]|NS_ERROR|page\.goto|navigation (?:failed|timeout)|ERR_CONNECTION|Target closed|crashed/i.test(t)) return 'navigation';
  if (/expect\(|toBe\b|toEqual|toHaveText|toContainText|toHaveURL|toHaveValue|toHaveCount|Received:|Expected (?:string|pattern|substring|value)/i.test(t)) return 'assertion';
  if (/Timeout .* exceeded|Timed out|timeout of \d+ms/i.test(t)) return 'timeout';
  return 'unknown';
}

const COUNT = (failures) => {
  const classes = { locator: 0, navigation: 0, timeout: 0, assertion: 0, unknown: 0 };
  for (const f of failures || []) classes[classify(f)]++;
  return classes;
};

/**
 * @param failures string[] — komunikaty błędów padających testów.
 * @param hasIntent boolean  — czy zachowano intencję (flow NL), z której można odtworzyć test.
 * @returns { action:'redrive'|'patch'|'investigate', reason, classes, dominant }
 */
function recommend({ failures, hasIntent } = {}) {
  const classes = COUNT(failures);
  const total = Object.values(classes).reduce((s, n) => s + n, 0);
  if (!total) return { action: 'investigate', reason: 'no failure details to classify', classes, dominant: null };
  // Dominująca klasa; remis rozstrzygamy na korzyść „zmiany UI" (locator > navigation > assertion > timeout > unknown).
  const order = ['locator', 'navigation', 'assertion', 'timeout', 'unknown'];
  const dominant = order.reduce((best, k) => (classes[k] > classes[best] ? k : best), order[0]);
  if (dominant === 'locator' || dominant === 'navigation')
    return { action: hasIntent ? 'redrive' : 'patch', classes, dominant,
      reason: hasIntent ? 'the UI changed (selector/navigation): re-drive from the saved intent and write a fresh test' : 'the UI changed, but no saved intent — patch the selectors' };
  if (dominant === 'assertion')
    return { action: 'patch', classes, dominant, reason: 'an expected result drifted: fix the assertion, not the whole test' };
  if (dominant === 'timeout')
    return { action: hasIntent ? 'redrive' : 'investigate', classes, dominant,
      reason: hasIntent ? 'a step timed out (likely a UI change): re-drive from the saved intent' : 'a step timed out: investigate before changing the test' };
  return { action: 'investigate', classes, dominant, reason: 'the failure is unclear: look at the trace before changing the test' };
}

/** Intencja (flow NL) zachowana przy teście, jeśli jest — źródło dla odtworzenia. */
function intentFrom(meta) {
  if (!meta) return '';
  return String((meta.accepted && meta.accepted.intent) || meta.intent || meta.flow || '').trim();
}

/**
 * Plan wykonania rekomendacji: z akcji (redrive/patch/investigate) i tego, czym dysponujemy, wybiera realny krok.
 * @param action 'redrive'|'patch'|'investigate'
 * @param ctx { url?, hasSource? } — url oryginalnej strony (do odtworzenia) i czy znamy run źródłowy.
 * @returns { kind:'redrive'|'patch'|'investigate'|'error', reason }
 */
function plan(action, ctx = {}) {
  if (action === 'patch') return { kind: 'patch', reason: 'patch the failing test on a copy and prove it' };
  if (action === 'redrive') {
    if (!ctx.url) return { kind: 'error', reason: 'cannot re-drive: the original page URL is unknown' };
    return { kind: 'redrive', reason: 're-drive the UI agent from the saved intent and write a fresh test' };
  }
  return { kind: 'investigate', reason: 'look at the trace before changing the test' };
}

/** Jedno zdanie do UI/raportu. */
function summary(rec) {
  if (!rec) return '';
  const label = { redrive: 'Re-drive from intent', patch: 'Patch the test', investigate: 'Investigate' }[rec.action] || rec.action;
  return `Self-heal suggestion: ${label} — ${rec.reason}.`;
}

module.exports = { classify, recommend, intentFrom, plan, summary };
