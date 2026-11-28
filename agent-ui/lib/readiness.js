// Is the task ready to be tested? A check before Full tests spends anything. No model: plain rules on the text and on
// what is connected. It never blocks the start; it tells the tester what the agents would otherwise have to guess.
//
//   assess({ task, details, stages, url, sources }) -> { ready, items: [{ level: 'stop'|'warn', code, text }] }
//   level 'stop': the run would almost surely produce nothing useful; 'warn': the result will be weaker or partial.
const KEY = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
// Words that make a requirement untestable unless a number or a rule comes with them (ISTQB: testability).
const VAGUE = /\b(fast|quick(?:ly)?|instant(?:ly)?|responsive|secure(?:ly)?|user[- ]friendly|intuitive|easy|simple|nice|modern|appropriate(?:ly)?|reasonable|robust|seamless(?:ly)?|flexible|efficient(?:ly)?|as usual|etc\.?|and so on|should work|works? (?:well|properly|correctly))\b/gi;
const CRITERIA = /acceptance criteria|kryteria akceptacji|definition of done|\bAC\d*\b|^\s*given\b.*$|^\s*(?:[-*•]|\d+[.)])\s+\S/im;

function assess({ task = '', details = '', stages = {}, url = '', sources = {} } = {}) {
  const items = [];
  const add = (level, code, text) => items.push({ level, code, text });
  const raw = String(task || '').trim();
  const text = [raw, String(details || '').trim()].filter(Boolean).join('\n');
  const keyOnly = KEY.test(raw) && !String(details || '').trim();
  const on = (k) => !!stages[k];

  if (!raw) return { ready: false, items: [{ level: 'stop', code: 'empty', text: 'Enter a ticket key or the text of the task.' }] };
  if (keyOnly && !sources.jira) add('stop', 'key-without-jira', `Only the key ${raw} was given and Jira is not connected, so the agents have no text to work from. Paste the ticket text (description and acceptance criteria), or connect Jira under Sources.`);
  if (!keyOnly) {
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words < 25) add('warn', 'short', `The task has only ${words} words. The agents will derive the expected results from very little and ask many open questions. Add the description and the acceptance criteria if you have them.`);
    if (!CRITERIA.test(text)) add('warn', 'no-criteria', 'No acceptance criteria were found (no "Acceptance criteria" section and no list of rules). Expected results will come from the specification and the code only, or end up as open questions.');
    const vague = [...new Set((text.match(VAGUE) || []).map((w) => w.toLowerCase()))];
    if (vague.length) add('warn', 'vague', `Words that cannot be tested as written: ${vague.map((w) => `"${w}"`).join(', ')}. The Static review will report them; if you know the number or the rule behind them, add it now.`);
  }
  if (on('api') && !sources.api) add('warn', 'no-api', 'The API track is selected but no test environment is connected (base URL and specification under Sources), so it will be skipped.');
  if (on('ui') && !String(url || '').trim()) add('warn', 'no-url', 'UI Tests is selected but no page address is given, so the UI track will be skipped.');
  if (on('whitebox') && !sources.repos) add('warn', 'no-repo', 'Whitebox is selected but no repository is connected, so the change cannot be read from the code.');
  if (!sources.jira && !sources.confluence && !sources.repos && !sources.api && !sources.knowledge) add('warn', 'no-sources', 'No source is connected (Jira, Confluence, repository, API, knowledge base): the task text is the only basis.');
  return { ready: !items.some((i) => i.level === 'stop'), items };
}

module.exports = { assess, VAGUE };
