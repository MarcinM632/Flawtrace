---
name: priority-and-gates
description: Priority of every step with its evidence, the time estimate by a stated method, and the gates that carry the done criteria of the Analysis report into the procedure so that execution and completion can count reached against required. Load it in steps 4 to 6 of CLAUDE.md.
---

# Priority, estimate and gates

## Priority of a step
Every step or group of steps gets CRITICAL, HIGH, MEDIUM or LOW, with a reason and a source. The priority is evidence, not a feeling.

| Priority | Evidence |
| --- | --- |
| CRITICAL | the step checks a rule with money, data loss, legal duty or access across a boundary in a common flow (named in the sources), or a defect class already confirmed in this area (`bug-registry.md`, `lessons/confirmed-defects.md`) |
| HIGH | the step belongs to a [high] condition of the Analysis or a [high] risk of phase 1, or to the main path of the change |
| MEDIUM | the step belongs to a [medium] condition or risk, or to an alternative path |
| LOW | a [low] condition, or no evidence of risk at all |

- No evidence of risk means LOW with the reason "no evidence of risk". It is never MEDIUM by default.
- The reason cites the source: `(src: ...)`, a quote of the risk, or a bug key.
- A step that others depend on (set-up that every check needs) takes the highest priority of the steps that depend on it.

## Time estimate
The estimate is a practical estimate from the number and kind of steps, not a metric of the ISTQB syllabus; say so in one phrase. When the team states times in `how-we-test.md`, use them. Otherwise use these defaults and state that they are defaults:

| Step kind | Minutes |
| --- | --- |
| a read of one resource | 0.5 |
| a write followed by its read-back | 1.5 |
| a step that waits on a condition | its limit from the source, plus 0.5 |
| creating a resource (set-up) | 1.5 |
| removing a resource (cleanup) | 0.5 |
| one retest of a failed step | the minutes of the step |

Add the retest allowance as 10% of the total. Write the total and the minutes per priority; the numbers add up.

## Gates (when the input contains the Analysis report)
When the input has the Analysis report, write `WORK_DIR/coverage-input.md` with its conditions: id `TC<n>`, priority, requirement and coverage items. The report then gets a section `## Gates`, so that phase 6 and phase 7 can report what was reached against what is required:

```
## Gates
Source of thresholds: <as in the Analysis report>
Done criteria: <the High, Medium and Low numbers of the Analysis in one line, with the Requirements, Impact, Regression and Defects gates>
- TC1 [high] → steps 2, 3, 5
- TC2 [medium] → steps 6
- TC3 [low] → To confirm
Cut line: <steps that may be dropped first when time is short, lowest priority and lowest rank first; never a step of a [high] condition>
```

- Map each condition to the steps that execute its items, through the design (`Coverage:` line of the design: TC → §, then §.k → step). A condition that no step executes is `→ To confirm` with the reason.
- Do not change the thresholds. They are the Analysis's; this phase carries them forward.
- The cut line follows the rank of the coverage matrix. It exists so that a time-boxed run drops the least important steps and not an arbitrary tail.

When the input has no Analysis report, omit `## Gates` and `coverage-input.md`.
