---
name: edge-cases
description: Boundary values and edge cases for every changed condition, field, calculation, date and state. Load it in step 4 for each hunk with conditions, numbers, dates, collections or state. Writes WORK_DIR/edge-cases.md.
---

# Edge cases

A diff is usually correct for the normal value and wrong at the border. This skill makes the border explicit, runs each border value through the real code and compares the result with what the sources require.

## Where the limits come from
Only from sources: the ticket and its comments, the newest Confluence page, the knowledge base (`product/`), validators, schema constraints, constants and configuration in the code, the API contract. A limit that no source states is not invented. It goes to "Do sprawdzenia ręcznie" as a question: "what must happen at <value>?".

## Procedure
1. **Inventory.** For every changed hunk list each input it reads: variable, field, parameter, column, config key, enum, time value. One row each. Note the source of its limits, or `no source`.
2. **Candidate values.** For each input take the classes that can occur in this product, from this table. Skip a class that cannot occur and say why in one line.

| Input | Values to try |
| --- | --- |
| Number | min-1, min, min+1, max-1, max, max+1, 0, negative, decimal places beyond the scale, very large (overflow), missing |
| Text | empty, only spaces, max length -1/max/+1, diacritics and unicode, upper/lower case, characters used in queries, paths or templates |
| Collection | 0, 1, 2, many, duplicates, order, a null element, one huge |
| Date and time | exact start and end of the period, midnight, month end, leap day, daylight saving switch, time zone of server vs user, same instant twice, past, future |
| Money | scale, rounding mode, currency, sum of rounded parts vs rounded sum |
| Optional | absent, null, present but empty, default applied, old rows without the value |
| Enum, type, flag | every value, an unknown value, the new value, flag on and off |
| State and repeat | first call, second identical call, after reset or disable, two calls at once |

3. **Operators against wording.** For every comparison read the source sentence and decide whether the border is inside or outside: "up to", "at least", "more than", "from … to … inclusive", "within 30 days". Compare it with `>`, `>=`, `<`, `<=` in the code. This is the most common single defect.
4. **Several conditions.** When a decision has two or more conditions, build the small decision table of their combinations. Do not test each condition alone only.
5. **Trace.** Walk each value through the changed code and through what it calls, with `file:line` at the decisive step. Record the result: `OK` (matches the source), `DIFFERS` (code gives another result than the source), `UNDEFINED` (nothing handles it: exception, null dereference, silent truncation, wrong default).
6. **Candidates.** Every `DIFFERS` and `UNDEFINED` row is a candidate finding. It goes through step 7 of CLAUDE.md (try to disprove it). A row where the source gives no expected result goes to "Do sprawdzenia ręcznie".

## Output: WORK_DIR/edge-cases.md
One table, one row per value tried:

`| hunk (file:line) | input | value | source of the expectation (src: ...) | expected | code gives (file:line) | OK / DIFFERS / UNDEFINED |`

Add a real-life example in the value column when it helps ("customer with exactly 3 open orders", "invoice on 31 October"). The header field `edge:` of the report is the number of rows. When no hunk has anything to try (text only, an internal rename) write one line saying so and why, and put `edge: 0`.

## Rules
- Every row is a value you traced, not a value you listed. A table of untraced values is not a result.
- Never mark a row `OK` from the title of the test or the name of the method. Read the lines.
- Tests in the diff that pin a border value are evidence for `OK`, only after you read their assertion.
