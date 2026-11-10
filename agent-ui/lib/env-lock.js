// Jeden przebieg pytest na środowisku naraz. Weryfikacja Autotests i zakładka Test suite używają tej samej reguły
// Hedge AUTOTEST i tych samych kont; dwa przebiegi równolegle nadpisują sobie regułę i pozycje (2026-10-20).
let holder = null;
const waiters = [];

function release() {
  holder = null;
  const next = waiters.shift();
  if (next) next();
}

/** Zajmuje środowisko od razu albo zwraca null, gdy ktoś już na nim pracuje (patrz: current()). */
function tryAcquire(label) {
  if (holder) return null;
  holder = { label, since: Date.now() };
  return release;
}

/** Czeka na wolne środowisko; onWait dostaje opis tego, kto je trzyma. */
async function acquire(label, onWait) {
  while (holder) {
    if (onWait) onWait(holder);
    await new Promise((resolve) => waiters.push(resolve));
  }
  holder = { label, since: Date.now() };
  return release;
}

const current = () => holder;

module.exports = { acquire, current, tryAcquire };
