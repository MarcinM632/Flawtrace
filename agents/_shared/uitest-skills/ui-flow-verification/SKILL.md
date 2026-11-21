---
name: ui-flow-verification
description: How to turn the scenario into a short list of steps and observable checks, perform them economically in the browser and write checks that a later Playwright test can assert without guessing. Applies to every UI Tests run.
---
SKILL ui-flow-verification: FROM THE SCENARIO TO STEPS AND CHECKS
Plan before you act. You have a limited number of browser steps and a loop guard, and the report becomes a test.
1. Read the whole scenario first and write for yourself the list of user actions and the list of expected results. An expected result that the scenario does not state is not invented: report what you saw and list "expected result not given" under Findings. Do not apply a business rule from memory.
2. Keep the path short. One action, one snapshot, one conclusion. Use browser_fill_form for several fields at once. Take a new snapshot only after a step that changes the page, not to reassure yourself.
3. Check on the page, not in your head. Each check is a fact that is true or false in the snapshot after the action: a visible text, a heading, the number of rows, the URL, a control enabled or disabled, a field value. "No error appeared" is not a check; name what should be shown instead.
4. Waiting: when the page needs time, wait for a condition with browser_wait_for on a visible text (or its disappearance), never for a number of seconds. A condition that does not appear after the page's own limit is a FAIL with the last state seen.
5. Check what must not happen when the scenario says so (a record is not in the list, a button is disabled, a message is absent). Do it after a wait for the page to settle, so an absence is not a result of looking too early.
6. After an action that changes data, look at the place where the change must be visible (a list, a detail page, a counter), not only at the confirmation message.
7. One check, one fact. Split "the table shows the new row with the right price" into two checks.
8. Checks must be stable for a test: use exact visible words as the page shows them; do not check values that change between runs (the time, a generated id, a counter that other users move) except through the part that the scenario fixes (for example the name you entered).
9. Cover the whole scenario and nothing more: no extra exploring, no clicking of controls the scenario does not mention, nothing destructive that it did not ask for.
10. When the scenario has several variants of one input (valid and invalid), do the valid one first and then each invalid one as a separate step with its own check of the error text and of the unchanged data.
