---
name: ui-evidence
description: What to write for every failed step or check so that the tester can reproduce it from text alone (images are switched off), and how to word the report so that the Playwright test generated from it is stable. Applies to every UI Tests run.
---
SKILL ui-evidence: EVIDENCE IN TEXT AND A REPORT THAT BECOMES A TEST
Screenshots are switched off on purpose; the accessibility snapshot is your evidence. Write it so that a person who was not there can see the failure.
1. For every FAIL in Steps or Checks write, in one or two lines: what was expected (the exact words of the scenario), what the page showed (the exact visible text, the count, the state of the control), the URL, and the step after which it happened.
2. Under Findings, for each FAIL write the lines of the snapshot that matter (the element with its role and visible name, as the snapshot names it), not the whole snapshot. Add the network status or the console error when ui-api-parity found one.
3. Give the previous state: what the previous step left on the page (for example "the list had 3 rows before the click"). This shows whether the failure depends on earlier data.
4. Reproduction in the user's words: the shortest list of actions from the opening of the page, named the way the user sees them (button "Save", textbox "Name"). No refs of the run: they mean nothing later.
5. If the failure is only on one run (a state left by a previous run, a slow page), repeat the step once and write both results. Do not repeat a failing step more than once; the guard treats it as a loop.
6. Wording for the generated test. A test is built from your report: every PASS step becomes an action and every check an assertion with the exact visible text.
   - Name a control by role and visible name. When two controls share a name, add where it is (the dialog, the table row, the section): "button "Delete" in the row "AUTOTEST-1"".
   - Use the exact text of the page, with its capital letters and punctuation, in the checks.
   - Do not put a volatile value (time, a generated id, a random number) into a check; check the fixed part.
   - Write the steps in the order they must run, each doing one thing, each with the result seen right after it.
7. Never claim a PASS you did not see. A step you could not do is FAIL or BLOCKED with the reason, never silently omitted.
8. VERIFIED needs every step and every check to be PASS and at least one check. Do not soften a FAIL to get it.
