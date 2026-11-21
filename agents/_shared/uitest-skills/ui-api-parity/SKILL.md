---
name: ui-api-parity
description: Uses what the browser itself reports about network calls and console errors to confirm that the screen shows what the backend answered, and to catch screens that look right over a failed call. Applies when the browser tools return network and console data.
---
SKILL ui-api-parity: DOES THE SCREEN MATCH THE CALL BEHIND IT
The page shows a result of a call. A screen can say "Saved" over a failed call, or an error over a successful one. Use the browser's own data to see it, within these limits.
1. When to look. After a step that changes data or loads data the scenario cares about (a save, a delete, a search, a filter), read the calls the page made with browser_network_requests, and the console with browser_console_messages. Do not read them after every step; each read costs a step.
2. What to compare. For the call that belongs to the step: the method and the address (does it name the resource the user acted on), the status, and, when the tool returns the response, the field whose value the screen shows. The screen text and the value must be the same after the same formatting.
   - A success message with a call that returned 4xx or 5xx is a FAIL: write the status and the address.
   - An error message with a call that returned 2xx is a FAIL: write both.
   - A value on the screen that differs from the response field is a FAIL: write both values.
   - A call that was expected (the user pressed Save) and is not in the list is a FAIL.
3. Validation errors. A message under a field should match the reason in the answer of the backend when the tool shows it; a different reason is a finding.
4. Console. An error in the console during the step that the scenario exercises is a finding with its text. Warnings and messages of third-party scripts are ignored unless the scenario is about them.
5. Only what the tools return. If a body is not shown, compare status and address only. Never write a response you did not see and never guess a field name.
6. A call that went to another origin is not followed or repeated; the guard stops runs that leave the page under test. Note it as a finding.
7. Keep passwords, tokens and personal data out of the report: write <password> or the name of the header, not its value.
