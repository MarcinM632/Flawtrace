---
name: results-consolidation
description: Distils the results of the earlier phases (execution, analysis gates, design) into the one line "Stan testów:" with real numbers and into the example of the entry. Load it in step 2 of CLAUDE.md.
---

# Results consolidation

The entry is not a test report. Phase 7 keeps one line of numbers so that the next tester sees in a second how far the task was checked, and one real example taken from what the system did.

## What you read
Only reports that are in the input or the context: the Execution report (ZLECENIE, KROKI, BŁĘDY), the Analysis report (`## Done criteria`), the Implementation procedure (`## Gates`, `## Estimate`), the Planning verdict. A report that is not there is not guessed. The app does not hand them over by itself; when the input is only a ticket key, there may be none.

## The line `Stan testów:`
One line, numbers copied from those reports, each with its phase:
`Stan testów: execution <n> of <m> orders done, <k> skipped, <p> product defects | gates <reached> of <required> | verdict <status>`

Rules:
1. **Copy, never compute from memory.** Take counts from the lines of the report: the `[ZROBIONO]`, `[POMINIĘTO]` and `[NIE DA SIĘ PRZEZ MCP]` markers of ZLECENIE, the entries of BŁĘDY with `RODZAJ: PRODUKT`, the totals of Done criteria and Gates. When you add numbers, say so (`computed`).
2. **Only product defects count as defects.** `KONFIGURACJA TESTU` and `OGRANICZENIE ŚRODOWISKA` entries are not defects of the product; give them as a separate count or leave them out.
3. **Reached against required.** When the Analysis report or the Gates give a required number, write the reached number next to it. When the reached number is not in any report, write `reached: not reported`. Do not decide that the task passed; give the numbers and the status the phase reports gave.
4. **Not run is not passed.** A phase with no report is written as `<phase>: no report`. Never fill the gap.
5. **Recording or transcript.** A recording that was available only as a link adds nothing to the numbers.
6. When no phase report is in the input, the line is exactly `Stan testów: no phase reports in the input`.

## The example
The example in "Jak to działa w praktyce" comes from the sources. When the Execution report is available, prefer one real step of it (identifiers, the value before and after, the call number of the proof) over an invented illustration. A value you did not read in a source is not used.

## Check before you answer
- The line has numbers only from reports in the input, each with its phase.
- No count of defects includes a test-configuration or environment entry.
- The line did not push the entry over 2000 characters.
