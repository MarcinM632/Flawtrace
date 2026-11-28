#!/usr/bin/env node
// Stands in for the claude CLI (QA_CLAUDE_CMD) in end-to-end tests of the Full tests flow. No AI: it reads the prompt
// from stdin, picks the report of the phase from what the prompt says, and answers in stream-json like the real CLI.
// Every prompt is appended to $FAKE_CLAUDE_LOG (when set) so a test can see what each phase was given.
const fs = require('fs');

const REPORTS = {
  static: `STATUS: STATIC OK
--- TREŚĆ ---
DEMO-1 static review
Repo/mode: no repository connected
## Requirements
R1 The password has at least 8 characters.
## Findings
1. [Consistency] [Major] The lock lasts 15 minutes in the description and 30 minutes in the criteria.
## Scenarios
S1 MATCH register with 8 characters
## Open questions
- What is the longest name allowed?
## Verdict
STATUS: NEEDS REWORK — finding 1 makes the lock untestable.
--- KONIEC TREŚCI ---`,
  design: `STATUS: PROJEKT OK
--- TREŚĆ ---
DEMO-1 test design
## 1. Password length [BVA]
- register with an 8-character password => 201 created (src: DEMO-1)
- register with a 7-character password => 400 rejected (src: DEMO-1)
## Summary
| 1 | BVA | 2 |
--- KONIEC TREŚCI ---`,
  execution: `STATUS: BŁĄD
--- TREŚĆ ---
WYNIK: 1 of 2 checks failed.
ZLECENIE:
- [ZROBIONO] password length
KROKI:
1. Registered with an 8-character password (status 400) [c1].
BŁĘDY:
### An 8-character password is rejected
KROK: 1
ENDPOINT: \`addPet\`
OCZEKIWANO: 201 for an 8-character password
OTRZYMANO: 400 [c1]
RODZAJ: PRODUKT
BRAMKA: the rule says at least 8, so 8 must pass.
STAN KOŃCOWY: nothing left behind.
--- KONIEC TREŚCI ---`,
  uitest: `STATUS: FAILED
--- TREŚĆ ---
## Steps
[s1] PASS — open the page → heading "Create an account"
[s2] FAIL — type a 7-character password → the form says "at least 6 characters"
## Checks
[a1] FAIL — the rule shown is 8 characters (after s2)
## Findings
- The registration form says "at least 6 characters"; the rule is 8.
--- KONIEC TREŚCI ---`,
};

let prompt = '';
process.stdin.on('data', (c) => { prompt += c; });
process.stdin.on('end', () => {
  if (process.env.FAKE_CLAUDE_LOG) fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ args: process.argv.slice(2), prompt }) + '\n');
  // A correction turn (--resume <session>) belongs to the phase of that session; a first turn is told by its prompt.
  const argv = process.argv.slice(2);
  const resumed = argv.includes('--resume') ? String(argv[argv.indexOf('--resume') + 1] || '').replace(/^fake-/, '') : '';
  const kind = REPORTS[resumed] ? resumed
    : /Scenario to verify on the page|PAGE UNDER TEST/.test(prompt) ? 'uitest'
    : /through the qa MCP server/.test(prompt) ? 'execution'
    : /Zaprojektuj testy|static-review\.md/.test(prompt) ? 'design'
    : 'static';
  const text = REPORTS[kind];
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  out({ type: 'system', subtype: 'init', session_id: 'fake-' + kind });
  out({ type: 'assistant', session_id: 'fake-' + kind, message: { content: [{ type: 'text', text }] } });
  out({ type: 'result', session_id: 'fake-' + kind, result: text, total_cost_usd: 0.01, num_turns: 1, usage: { input_tokens: 10, output_tokens: 10 } });
});
