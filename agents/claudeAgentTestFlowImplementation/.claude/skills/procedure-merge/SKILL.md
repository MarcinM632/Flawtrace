---
name: procedure-merge
description: Merges the checks of the test design into one fast, stable procedure without losing any check. Inventory, shared setup once, order by dependency and priority, cleanup of everything created, traceability both ways. Load it in step 2 of CLAUDE.md. Writes WORK_DIR/design-input.md.
---

# Procedure merge

You do not design checks. The design (phase 4) did that. You arrange its checks into one sequence that runs quickly, can be run again, and loses nothing. The procedure is then executed in phase 6 on the test environment.

## Step 1. Inventory the design
Write `WORK_DIR/design-input.md` before you arrange anything: one line per check of the design.

`§<n>.<k> | <the check in one line> | resources it touches | depends on | src`

`§<n>` is the section, `<k>` the position of the check in it. Include the checks of "To confirm" that the design left open, marked `open`. The number of lines is the number of checks that the procedure must account for.

## Step 2. Group, then order
1. **Group by resource.** Checks that use the same resource and the same starting state run next to each other, so one set-up serves all of them.
2. **Shared set-up once.** Anything that several checks need (a customer, a rule, an order) is created once in `## Setup`, verified by a read, and used by every check that needs it. Do not repeat it inside the steps.
3. **Order by dependency first, then priority.** A step that needs the result of another comes after it. Among independent steps the higher priority runs first (see `priority-and-gates`), so a time-boxed run has covered the most important checks.
4. **Mind the state that checks leave behind.** A check that changes a shared resource (disables a rule, spends a limit, cancels an order) either runs last in its group, or is followed by a step that restores the starting state for the next check. Say which. Two steps that need the same resource in different states are never relied on to "just work" in sequence.
5. **Reads, not pauses.** A result that appears later is read with a condition and a limit from the source ("until the status is X, at most N seconds"), never with a fixed wait.
6. **Batch what can be batched.** Read several resources in one call when the endpoint allows it. Do not read the same value twice. Do not create the same resource twice.
7. **No hidden dependency on an earlier run.** The procedure starts from a neutral state: leftovers of a previous run of the same procedure are removed first. It must give the same result when run twice.

## Step 3. Cleanup
`## Cleanup` removes or resets every resource the procedure created or changed, in the reverse order of creation, and ends in the neutral state of the team (`how-we-test.md`: the prefix of test records, nothing left that belongs to someone else). List each created resource once in Setup or in a step, and once in Cleanup. A resource without its removal is a defect of the procedure. Never change or delete data that belongs to someone else.

## Step 4. Nothing disappears
- Every line of `design-input.md` appears in the procedure by its id, in a step or in "Traceability", or is named as not executable with the reason (see `step-executability`).
- Two checks may become one step only when they run on the same state in the same call and each keeps its own expected result. The step lists both ids: `(§2.1, §2.2)`.
- A check that the design marked `open` (To confirm) stays open. It is listed under "Traceability" as `open` and is not turned into an executable step by a guess.
- Count at the end: the number of ids in `design-input.md` equals the number of ids in "Traceability". A difference means something was lost.

## Output
- `WORK_DIR/design-input.md` (inventory).
- The report sections `## Setup`, `## Procedure`, `## Cleanup` and `## Traceability` of CLAUDE.md. `Traceability` has one line per design check: `- Step <n> → §<n>.<k> → <risk or scope item>`.
