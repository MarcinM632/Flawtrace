---
name: expected-result-oracle
description: How to derive the expected result of every check from the sources, compute it from the real configuration, and say where it is read. Load it in step 4 of CLAUDE.md before you write the first check.
---

# Expected-result oracle

An expected result is only as good as its source. A check whose expected value was copied from what the system returned proves nothing: it passes whatever the system does.

## Where the expected result comes from
In this order of authority:
1. The ticket, its subtasks and its comments (a later comment can cancel the description), and the newest Confluence page. These say what the business wants.
2. The rule in the code: validators, constants, enum values, messages, defaults. These say what the service enforces.
3. The API contract (`mcp__sources__api_endpoints`): field names, types, status codes, error formats, and the constraints of the fields (minimum, maximum, lengths, enum, required). For a technique, the expected outcome of each partition, boundary value, column or transition is computed by the application (`mcp__sources__test_design_items`, skill `technique-coverage`); the check follows that oracle or puts the difference in "To confirm".

When 1 and 2 differ, the expected result follows 1 (the requirement), the difference goes to "To confirm" with both sources, and the check states which source it follows.

Never take the expected result from running the system and copying the answer. A result that cannot be derived from a source is an open question in "To confirm", not a check.

## Compute it from the real configuration
1. Write the configuration of the check with real values (resources AUTOTEST from `WORK_DIR/autotest-setup.md`), never symbols.
2. Pass the configuration through every constraint of the service's validators, in the order of the code. A configuration that a validator refuses is a design error. Use the nearest allowed one and put the difference in "To confirm".
3. Compute the expected value from those numbers. State the formula or the rule in the check in a few words and show the inputs: `fee = 1.5% of 2,000.00 = 30.00, rounded half up (src: FeeCalc.kt:41)`. Take rounding mode, scale, unit and time zone from the code or the source, not from habit.
4. For a negative check, take the exact outcome from the code: the status code and the message or error code of the rule that rejects, with `file:line`. The check breaks exactly one rule; all earlier rules in the validator's order are valid.

## Say where the result is read
Every expected result names its place of reading: the endpoint and the field (`GET <endpoint>`, field `<name>`), or the screen element. Also write the state after the action, because a correct response with a wrong state afterwards is the common defect:
- the stored data (read back by an endpoint),
- the status of the object,
- side effects: an event, a history entry, a notification, a value on another screen or in another system,
- what must not change: neighbouring records and other customers' data.

## Time and asynchronous results
- A result that appears later is read by a condition ("the status is `X` within <limit from the source>"), not by a fixed pause. The limit comes from a source.
- A result that depends on the clock (end of a period, expiry) states the time zone and how the test sets or reaches that moment. When the environment cannot reach it, the check goes to "To confirm".

## Format of a check
`- <numbered steps with real endpoint, data> => <expected value, computed, with its place of reading and the state afterwards> (src: ...)`

The `(src: ...)` is the source of the expected result: ticket key, `conf:<title>`, `file:line`, an endpoint as `METHOD /path`, `kb:<service>#<section>` (the knowledge base of the service) or `bug:<key>`. When the code and the requirement both matter, cite both. A check of a technique adds `ci: <id>` of the coverage item it tests.

The application looks up every source after you finish: a ticket key must be the tested ticket, its subtasks or a key in the downloaded material; an endpoint must be in the imported specification; a `bug:` key must be in the bug registry; a `kb:` entry must exist and not be empty; a `file:line` must exist in the downloaded code. A check whose sources all fail has an expected result without a source and comes back to you: fix the reference or move the check to "To confirm".
