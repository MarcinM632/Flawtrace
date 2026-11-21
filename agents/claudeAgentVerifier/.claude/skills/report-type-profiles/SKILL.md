---
name: report-type-profiles
description: What to check in each kind of report (whitebox, design, planning, static, analysis, implementation, test run, completion). The application tells you the type in "REPORT TYPE"; only the matching profile is shown.
---

# Report type profiles

The first line of your input is `REPORT TYPE: <kind>`. The checks of the main instruction apply to every report. The profile below adds what is specific to that kind, so you check the claims that matter most for it and do not waste effort on the others.

How to spend effort: first the claims that a reader would act on (a defect to fix, a test to run, a verdict, a number), then the rest.

## kind: qa
A whitebox report: numbered findings of the code, each with `Co się dzieje`, `Powinno być`, `Dlaczego to groźne`, `Ścieżka do replikacji`, `Dowód`, plus the tails `Integracje`, `Poza zmianą`, `Do sprawdzenia ręcznie`, `Sprawdzone i czyste`.
- Every `Dowód` goes through `quote-vs-line-check`.
- Every finding goes through `finding-adversary`, most severe first. This is the check that matters most here.
- `Powinno być` must come from a source (ticket, page, code of the same product), not from taste.
- The structured `Dlaczego to groźne` (Wyzwalacz, Skutek, Dotyczy, Wykrywalność, Dotkliwość, Pewność): `Pewność: potwierdzone` needs a `src`; an assumption must be marked as one.
- The header counts (`edge`, `maps`, `reqs`) must equal the entries of the report. A count that does not match is `contradiction`.
- `Sprawdzone i czyste` names areas that were really read; a clean area the report never opened is `unsupported`.

## kind: design
A test design: sections of business situations, checks `step => expected result (src: ...)`.
- Every expected result has a `(src: ...)` that you open; the value in the check must be the value in the source.
- A section title that is a technique name (boundary values, equivalence classes) is `vague`: the title must be a business situation.
- Terms of the checks are the client's words from the sources (fields, statuses, roles). A synonym is `term-not-in-sources`.
- A negative check must break one rule only; if the step breaks two, the failure would not show which one the system rejected: say so in `problem`.
- Real identifiers and values for the test environment, not symbols.

## kind: planning
A phase-1 plan: static check, product risks, priority, entry and exit criteria, verdict.
- Every risk has a source (ticket, code, bug registry); a risk without one is `unsupported`.
- The priority matches the metrics in the working folder (`risk-metrics.md`) and the registry; a priority that the figures do not support is `overstated`.
- The verdict must follow from the risks and the criteria: a blocking risk with a go verdict is `contradiction`.
- Entry and exit criteria are measurable and agree with `how-we-test.md` of the knowledge base.

## kind: static
A static review of the task: findings on the ticket, the specification and the code change.
- Each finding must quote the ambiguity, gap or contradiction from the source it names; open that place (`quote-vs-line-check`).
- A "contradiction between sources" needs both quotes, from two sources, and the newer source wins; if the report took the older one, say so.
- A "missing requirement" must be searched in all the sources (ticket and comments, Confluence, knowledge base) before it is accepted.

## kind: analysis
A test strategy and coverage analysis: technique selection, coverage matrix, done criteria, impact, scope.
- The matrix arithmetic: items = existing + to execute; totals and priority sums agree; the done criteria use the numbers of the matrix. A number that does not add up is `contradiction`.
- The thresholds (high 100%, medium, low) must be the team's from `how-we-test.md` or be marked as defaults.
- "Existing coverage" is proved by an autotest named in `autotests-coverage.md`; a claimed existing test that is not there is `bad-source`.
- The impact reach (who calls the changed code) is proved by the `qa-git.sh find` result or a line in the code.

## kind: implementation
An executable test procedure: Setup, Procedure, Cleanup, Priorities, Estimate, Traceability, Gates.
- Every endpoint name is in `mcp__sources__api_endpoints`; every field is in its contract.
- Each step has an expected value with a source. A step that expects a bare status code is `unsupported`.
- Traceability: every check of the design appears; a missing one is `contradiction` with the design.
- The estimate adds up. The priority of a step has its reason and source.

## kind: qamcp
The report of a live test run on the test environment (a QA MCP run, an Execution run of phase 6, or a pentest). The application already compares the report with the call log; you check what it cannot.
- Every value with a call number `[cN]` must be in that call in `calls.jsonl` (`quote-vs-line-check`). A value in the report that has no call is `unsupported`.
- The expected value (`OCZEKIWANO`) must come from a source. If it is the system's own earlier answer, say so.
- `RODZAJ`: a rejected configuration that the validation correctly refused is `KONFIGURACJA TESTU`, not `PRODUKT`. A product defect with a gate sentence that does not hold (a normal validation or an accepted behaviour) is `refuted`.
- A pentest finding needs two independent proofs (retest); a single proof is `overstated`. A pentest report that names a host other than the connected test environment is `contradiction` with the authorisation.
- Terms (accounts, rules, fields) as in the sources, not renamed.

## kind: completion
A short knowledge-base entry about a finished task.
- Every fact about how the feature works is in the ticket, the pages or the code; the reason of a decision that no source states must be written as undocumented.
- `Stan testów` numbers must equal the numbers of the phase reports named; compare them with those reports when you can reach them, otherwise `cannot-verify`.
- Each defect of the list has its key in `bug-registry.md` (or is marked `new`); a key that is not there is `bad-source`. A severity or certainty with no source is `overstated`.
- Length: the entry stays at about 2000 characters. Do not lengthen it with your fixes.
