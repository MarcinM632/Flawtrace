// Raport kosztów z meta runów (costUsd i usage zapisuje już każdy przebieg): per agent i per ticket,
// z udziałem cache. Bez tego nie widać, która faza zjada budżet, więc optymalizacje byłyby zgadywaniem.
function summarize(metas) {
  const agg = (key) => {
    const m = new Map();
    for (const x of metas) {
      const k = key(x); if (!k) continue;
      const a = m.get(k) || { key: k, runs: 0, costUsd: 0, input: 0, output: 0, cacheRead: 0, cacheCreate: 0, turns: 0, minutes: 0 };
      const u = x.usage || {};
      a.runs++; a.costUsd += Number(x.costUsd) || 0;
      a.input += u.input || 0; a.output += u.output || 0; a.cacheRead += u.cacheRead || 0; a.cacheCreate += u.cacheCreate || 0; a.turns += u.turns || 0;
      if (x.finishedAt && x.startedAt) a.minutes += (x.finishedAt - x.startedAt) / 60000;
      m.set(k, a);
    }
    return [...m.values()].map((a) => {
      const inAll = a.input + a.cacheRead + a.cacheCreate;
      return { ...a, costUsd: +a.costUsd.toFixed(4), minutes: +a.minutes.toFixed(1), avgCostUsd: a.runs ? +(a.costUsd / a.runs).toFixed(4) : 0, cacheShare: inAll ? +(a.cacheRead / inAll).toFixed(3) : null };
    }).sort((x, y) => y.costUsd - x.costUsd);
  };
  const total = metas.reduce((s, x) => s + (Number(x.costUsd) || 0), 0);
  return { totalUsd: +total.toFixed(4), runs: metas.length, byAgent: agg((x) => x.agent), byTicket: agg((x) => String(x.ticket || '').slice(0, 60)).slice(0, 30) };
}
module.exports = { summarize };
