---
name: risk-assessment
description: Rates every product and project risk by likelihood and impact from evidence, gives it an id and an exposure, and links it to the finding or the source it came from. Load it in step 3 of CLAUDE.md.
---

# Risk assessment

A risk is a possible event with a cause, an effect and a way to see it. The rating decides how hard the later phases test, so it must come from evidence a reader can open, not from a feeling.

## Two kinds, never mixed
- **Product risk**: the thing that will be built may be wrong (a wrong result, lost data, a wrong limit, a broken consumer). Every finding of the static check of step 1 is also a product risk.
- **Project risk**: something may block planning, building or testing this iteration (an unclear description, no access, a dependency on another task, a missing test environment or data).
Ids: `P1`, `P2`, ... for product risks and `J1`, `J2`, ... for project risks. At most 12 in all; merge risks with the same cause and the same effect.

## Likelihood (evidence for each level)
- **high**: the code shows the case is already mishandled or can happen in a normal flow; the area has repeated defects in `bug-registry.md` or `lessons/confirmed-defects.md`; the change touches many consumers (`qa-git.sh refs`); the rule is complex (several conditions, state, arithmetic) and the sources leave it open.
- **medium**: the case needs an unusual input or a second condition; the area has had one defect; the specification is clear but the change is large.
- **low**: a small, well specified change in a stable area, with a guard in the code and no defect history.
State the evidence next to the rating: a key, a `file:line`, a page. A rating with no evidence is `medium` and says "no evidence either way".

## Impact (what the business or the user loses)
- **high**: money, data loss or corruption, a legal or audit duty, access across a boundary (tenant, role, owner), a wrong value that other services consume.
- **medium**: a wrong result in an alternative path, a result the user can correct, a visible but harmless wrong text or state.
- **low**: cosmetic or rare, with no wrong business result.
Take the impact from what the sources say the feature is for, never from what would be convenient.

## Exposure
Score low = 1, medium = 2, high = 3. Exposure is likelihood times impact: 6 or more is `high`, 3 or 4 is `medium`, 2 or less is `low`. The report line carries all three values, and the validator recomputes the exposure.

## Format of a risk line
`- [product] P1 <risk: cause → effect> | likelihood: <low|medium|high> | impact: <low|medium|high> | exposure: <low|medium|high> (src: ...)`
`- [project] J1 <risk> | likelihood: ... | impact: ... | exposure: ... (src: ...)`
The src is the evidence of the rating, not only of the risk existing.

## Rules
- A risk that repeats a registry entry says so and gives the key: `(src: bug:PRJ-45)`.
- No risk without a cause you can name. "Something may go wrong with the limit" is not a risk; "the limit is checked with >= in `placeOrder` but the task says 'above'" is.
- Do not add a risk to look thorough. A short list with evidence beats a long one.
- Project risks are about this iteration only; do not list general project problems.
