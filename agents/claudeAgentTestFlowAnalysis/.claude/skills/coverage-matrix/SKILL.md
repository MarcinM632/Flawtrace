---
name: coverage-matrix
description: Builds the coverage matrix of the task (every coverage item, what already exists, what is a gap) and the done criteria that say how much must be executed for the task to count as checked. Load it in step 7 of CLAUDE.md, after the techniques and the impact are known. Writes WORK_DIR/coverage-matrix.md and the report sections "Coverage matrix" and "Done criteria".
---

# Coverage matrix and done criteria

Two questions must have exact answers before test design starts: what exactly has to be executed, and how much of it is enough to call the task checked. This skill answers both with numbers that the later phases (design, execution, completion) can count against.

## Definitions
- **Coverage item**: one thing that must be exercised once, defined by a technique (a partition, a boundary, a decision column, a transition, a path, a pair, a defect class, a consumer). Items come from `techniques.md`.
- **Covered**: the item was executed on the test environment with a recorded result and evidence. An item that was only designed, or that sits in a test nobody ran in this task, is not covered.
- **Existing**: an automated test already checks this exact item. It counts only after you read the test and saw that it checks this item with this value. A test in the same file or the same service is not enough (a nearby test does not close the risk of this task).
- **Checked task**: the task counts as checked only when every gate of the done criteria below is met. The overall percentage is information; it never passes a task by itself.

## Step 1. Inventory
1. Take the conditions `TC1…TCn` of the report, with their priority tags and requirements (`R1…`).
2. Take the items of each condition from `techniques.md`. Give each item the id `TC<n>-<label>`, for example `TC2-B3`.
3. Add one item per confirmed use of the changed component in another repository (from "Impact of the change"), kind `interface`. A confirmed use without an item is a gap in the analysis.
4. When `WORK_DIR` has a whitebox or static digest (`whitebox-findings.md`, `static-review.md`), add a condition for every finding that needs a run-time check and that no condition covers yet.
5. Every requirement `R` must have at least one item. A requirement without an item is a gap in the analysis; add the condition or write the open question.

## Step 2. Mark what exists
Read `WORK_DIR/autotests-coverage.md`. For each item mark `existing` with `path::test name`, or `gap`. When you did not read the test, the item is `gap`.

## Step 3. Rank the items
Inside one priority, rank the items so that the ones to drop first are known:
1. invalid and boundary items of rules changed by this task,
2. items of areas with a defect history,
3. consumer (`interface`) items,
4. valid partitions and happy paths,
5. repeated or similar items of the same partition.

Rank 1 is the last to drop. The ranking is written in `coverage-matrix.md`.

## Step 4. State the done criteria

### Thresholds come from the team first
Read the definition of done and the exit criteria of the team: `how-we-test.md` ("Definition of done for testing"), `test-process.md` and the exit criteria of phase 1 (planning) when its report is in `WORK_DIR`. A number written there is used as it is, and the line `Source of thresholds:` names the file. When the team states no number, use the defaults below and write `Source of thresholds: default (the team states none)`.

### Default gates
| Gate | Rule |
| --- | --- |
| High items | 100% covered. No item is dropped. An item that cannot be executed on the environment is named, with the reason, and counts as not covered |
| Medium items | at least 80% covered (round up). The rest are the lowest-ranked items, each named with the reason |
| Low items | at least 50% covered (round up), and every low condition has at least one covered item |
| Every condition | at least one covered item, whatever its priority |
| Requirements | 100% of the acceptance criteria have at least one covered item that passed (this is the team rule of `how-we-test.md`) |
| Impact | 100% of the confirmed uses have an item that is covered, or are named as not checked with the reason |
| Regression | the existing tests of the affected area ran, and they include every `existing` item of the matrix |
| Defects | no open defect of the highest two severities of the team scale (`how-we-test.md`, "Severity scale"); every defect found is reported with steps, expected result, actual result and evidence |

An existing test counts toward a gate only when it runs in the regression gate. An `existing` item whose test is not in the run is a gap for that run.

### What the numbers must say
For each priority write how many items there are, how many must be covered to pass, and how many are already `existing`. The required number is computed, not estimated: high = all; medium = round up(80% × m); low = round up(50% × l), unless the team gave other numbers.

## Step 5. Check the matrix before you write it
- Every condition has at least one item; every requirement has at least one item; every item has a technique (an item without one cannot be counted).
- Item ids are unique. Counts add up: `items = existing + to execute` for every condition, and the totals equal the sums.
- A [high] condition with fewer than 3 items needs one sentence saying why (for example a single yes or no rule).
- The sum of items stays reviewable. When one condition has more than about 15 items, check that equivalent items were not counted twice.

## Output
`WORK_DIR/coverage-matrix.md`: the full table, one row per item:

`| item | TC | requirement | kind | label | priority | rank | existing (path::test) or gap |`

The report gets these sections (the validator checks the arithmetic):

```
## Coverage matrix
- TC1 [high] (R1, R3) | items: <n> | existing: <n> | to execute: <n> | <item labels>
- TC2 [medium] (R2) | items: <n> | existing: <n> | to execute: <n> | <item labels>
Totals: items <N> | existing <E> | to execute <G> | high <h> | medium <m> | low <l>

## Done criteria
Source of thresholds: <file name | default (the team states none)>
- High items: <a> of <h> executed (100%)
- Medium items: <a> of <m> executed (<p>%)
- Low items: <a> of <l> executed (<p>%)
- Every condition: at least one executed item
- Requirements: <a> of <R> acceptance criteria with at least one passed item (100%)
- Impact: <a> of <n> confirmed uses checked (100%)
- Regression: <which existing tests must run>
- Defects: no open defect of severity <names from the team scale> (src: how-we-test.md)
- Overall: <a> of <N> items (<p>%), for information; the task counts as checked only when every line above is met
```

In the "Done criteria" lines, `<a>` is the number that must be reached for the task to pass (the required number from step 4), not the number reached so far; nothing has been executed when the analysis is written. Execution and completion report the reached numbers against these.

## Link to the coverage watch of the application
The coverage watch counts the business rules of the change that have executed evidence. Keep one condition per business rule and use the rule's own name in the condition, so that the percentage of the watch and this matrix can be compared.
