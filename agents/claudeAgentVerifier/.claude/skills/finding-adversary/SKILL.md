---
name: finding-adversary
description: Tries to refute each numbered finding of a report by looking for the guard, validator, constraint, default or caller rule that makes it impossible, and checks that the consequence really follows. Applies to reports that list defects or risks.
---

# Finding adversary

A source check tells you that a reference exists. It does not tell you that the finding is true. For every finding (defect, risk, error of a test run) your job is to try to disprove it with the sources, as a sceptical reviewer of the code would. A finding that survives is stronger for it; a finding that falls is removed before it costs the tester an hour.

## What to try, in this order
1. **The trigger is reachable.** Follow the path from an entry point (endpoint, job, event, screen) to the cited line. Is there a caller that can really send that input? A branch no caller can reach is not a defect.
2. **A guard before the line.** Search the same function, its callers and the layers around it for a check that stops the bad input earlier: a validator, an annotation (`@Valid`, `@NotNull`, `@Min`), a `require`/`check`, a guard clause, a framework default, an interceptor or filter.
3. **A constraint after the line.** A database constraint (NOT NULL, UNIQUE, CHECK, foreign key), a unique index, a transaction boundary or an idempotency key that makes the bad state impossible or harmless.
4. **A rule in configuration.** A feature flag that is off, a default value, an environment setting, a rule of the test environment (`AUTOTEST` setup) that changes the outcome.
5. **The source says this is intended.** The ticket, a comment, a Confluence page or the knowledge base describes the behaviour as the decision. A behaviour the specification describes is not a defect. If the report calls it one, it contradicts the source.
6. **Already handled elsewhere.** The code, a test in the repo or the bug registry shows that the case is covered or the defect is already reported and fixed. Check the status as the registry writes it.
7. **The consequence follows.** Take the claim "Skutek", "impact" or the "Dlaczego to groźne" statement and walk it step by step from the trigger to the harm named. If a step is missing or needs a second condition the report did not state, the consequence is overstated.
8. **Severity and detectability.** A severity or detectability the report gives (critical, high; silent, loud) needs a stated reason in a source: money, data loss, legal duty, access across a boundary; and whether any log, alert or validation would show it. A rating with no support is overstated.

## How to report
- `refuted`: you found a guard, constraint, setting or source that makes the finding impossible or already handled. `evidence` quotes it with its path and line (or the source name). `fix`: remove the finding, or narrow it to the case that still holds.
- `overstated`: the finding is real, but the consequence, the severity or the detectability is not supported. `evidence` says what the sources support. `fix`: the narrower statement.
- `contradiction`: a source says the opposite and names the behaviour as intended.
- If you looked and found nothing that disproves the finding, say nothing about it. Do not write that it "holds". A finding you could not check goes into the one `cannot-verify` entry.

## Rules
- Quote only what you opened. A guard you remember but did not read is not evidence.
- Do not refute a finding because the code "probably" handles it. Name the line.
- Do not add findings of your own and do not rewrite the finding. Give the short fix only.
- Order of effort: the most severe findings first. When the report has many findings, check all that claim critical or high severity before the rest.
