---
name: step-executability
description: Makes every step of the procedure executable as written on the test environment, with real endpoints, real values and a precise expected result (value, place of reading, state afterwards). Load it in step 3 of CLAUDE.md.
---

# Step executability

The agent of phase 6 executes the procedure call by call. A step it has to interpret, complete or guess is a defect of this phase. A step that only checks "the call returned 200" proves nothing about the business.

## What an executable step contains
`<n>. [PRIORITY] <endpoint name, path parameters, query, body with real values> => <expected value, place of reading, state afterwards> (§<n>.<k>)`

1. **Real endpoint.** The name exactly as `mcp__sources__api_endpoints` lists it. A name you did not find in the list is not used; the step goes to "Traceability" as not executable with that reason.
2. **Real values.** Identifiers, amounts, limits and fields come from the real resources of the test environment (`WORK_DIR/autotest-setup.md`, the design) and from the API contract: the field names exactly as the API names them. Never symbols (A, B, T) and never "a valid customer". When the setup file is missing, take the values from the design and name the missing file in "Traceability".
3. **Expected result with the value.** The value is the one the design computed from the sources, with its place of reading: the endpoint and the field, or the screen element. Copy the source of the design check `(src: ...)`; do not recompute it from what the system returns.
4. **State afterwards.** The step states what must be true after the call: the stored data read back, the status of the object, what must not change (neighbouring records, other customers' data). A write is followed by an independent read of the result. A status code alone is never the expected result.
5. **Negative step.** It breaks exactly one rule and keeps every other rule valid, with the exact status code and message or error code of that rule (from the design). The set-up behind it passed all the validators of the service in the design; do not change values without checking this again.

## Steps that the endpoints cannot check
A check that needs the web page (a visible text, a control, a screen state) is not run by endpoint calls. Keep the step, name the screen element, and end its expected result with `NOT VERIFIABLE VIA MCP` so that the execution can list it for the UI track instead of failing it. Do not invent an endpoint that "probably shows the same".

## Ready for evidence
Every read in the procedure is a call that the execution can number as evidence. Write one read per value you need. A value you ask the agent to "check" without saying which call reads it cannot be proven.

## Time and asynchronous results
Write the condition and its limit, with the source of the limit: `until <field> = <value>, at most <n> s (src: ...)`. A limit with no source goes to "To confirm" of the design, not into the step.

## Self-check before the report
- Every step has an endpoint from the list, real values, an expected value with its place of reading, and `(§n.k)`.
- No step expects only a status code, and no step is a negative check that breaks two rules.
- Every `NOT VERIFIABLE VIA MCP` names the screen element.
- Nothing in the procedure needs a decision from the person who runs it.
