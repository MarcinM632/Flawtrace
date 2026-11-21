---
name: verdict-gate
description: Gives the verdict of phase 1 by fixed rules from the risks and the static check, names the blockers with their owners and the question to ask, and keeps the priority consistent with the exposure. Load it in step 6 of CLAUDE.md.
---

# Verdict gate

The verdict says whether phase 2 can start on this task. It follows from rules, not from impression, and a person who reads only the verdict must see what to do next.

## The rules
- `GOTOWY DO FAZY 2` only when all hold: no product risk has likelihood `high` and impact `high` at once; "Impossible or contradictory assumptions" says `none`; no entry criterion is known to fail.
- Otherwise `WYMAGA POPRAWY`.
- A verdict that breaks these rules is wrong whatever the reasons say. The validator checks it.

## Priority line
The priority starts from `risk-metrics.md` for the service. It is raised to `High` when any product risk has likelihood `high` and impact `high`, and it says so in one sentence. A priority of `Not enough data` stays that when the service is not in the metrics, and the sentence says it. Never lower the priority below what the metrics give without a source.

## When the verdict is `WYMAGA POPRAWY`
Write the reason and the blockers:
```
STATUS: WYMAGA POPRAWY — <reason that names the ids: P2, P5, or the assumption with its file:line>
Blockers:
- B1 <what must change or be decided before phase 2> (risk P2) | ask: <the question, to the author of the task>
- B2 ... (assumption: <file:line>) | ask: ...
```
- Each blocker names the risk id or the assumption it removes, the one change or decision that removes it, and a concrete question that can be answered in a sentence.
- A blocker is something the author of the task can change or decide. A risk that only needs a test is not a blocker.
- Do not list more blockers than there are risks and assumptions behind them.

## When the verdict is `GOTOWY DO FAZY 2`
One sentence of reason: which risks were looked at and why none is high on both axes. No blockers section. Risks with exposure `high` that remain (for example high likelihood and medium impact) are named, because the later phases test them hardest.

## Check before you answer
- The verdict agrees with the rules above and with the priority line.
- Every blocker traces back to a risk id or an assumption with a source.
- Nothing in the verdict is a risk that the risk list does not contain.
