---
name: technique-selection
description: Chooses the ISTQB test technique, its strength and its coverage items for every test condition of the task. Load it in step 3 of CLAUDE.md, after the test conditions are listed with ids and priorities. Writes WORK_DIR/techniques.md and the report section "Technique selection".
---

# Technique selection

The technique decides which defects a test can find. A wrong technique gives coverage that looks complete and misses the defect: equivalence classes alone never find an off-by-one at a limit, and a single path never finds a wrong combination of rules.

You do not design test cases here. You decide, for every condition, which technique it needs, how strong it is, and what its coverage items are: the things that must each be exercised once. Test design (phase 4) turns the items into cases with steps and data.

Sources: `knowledge/test-techniques.md` (team reference), `../_shared/istqb-library/` and the ISTQB syllabus terms below. A limit, a rule or a state that a technique needs must come from a source. What no source states is never invented (see "When the source is missing").

## Step 1. Classify each condition by what varies

| What the condition is about (signal words in the sources) | Typical defect | Technique | Coverage item |
| --- | --- | --- | --- |
| Ordered domain: number, amount, count, length, date, time, percentage; "up to", "at least", "more than", "between", "within" | off by one, wrong operator, wrong rounding | Equivalence partitioning + Boundary value analysis | each valid and each invalid partition; each boundary with its neighbour (2-value: the boundary and the nearest value outside; 3-value: the boundary, one below, one above) |
| Unordered set: status, type, enum, country, role, currency | a value not handled, a wrong mapping | Equivalence partitioning | each group of values treated the same; each value separately when the code branches on it |
| A rule with several conditions: "and", "or", "unless", "only when", "if both", exceptions, priority between rules | wrong combination, an ignored condition, wrong precedence | Decision table | each feasible column (full table) or each column after collapsing a condition that does not matter (collapsed table) |
| Life cycle: status, enable and disable, draft → active, cooldown, rotation, cancel, expiry, retry, repeat | a forbidden transition allowed, leftovers after a change, wrong state after a repeat | State transition | each valid transition (0-switch); each pair of consecutive transitions (1-switch); each invalid transition attempted |
| A user or system flow with a main path and alternatives | a broken path, a missing alternative | Use case (scenario) | the main path, each alternative path, each error path |
| Many independent parameters with several values each (filters, settings, configuration) | interaction between two parameters | Pairwise (combinatorial) | each pair of values of any two parameters |
| A calculation: fee, total, limit, rate, rounding | wrong formula, rounding, scale, unit | Equivalence partitioning + Boundary value analysis on inputs and on results, plus the worked example from the source | each partition; each boundary; each rounding case |
| Time: period borders, time zones, daylight saving, schedules | wrong border, wrong zone | Boundary value analysis on time | start and end of the period, one unit either side, each zone or switch that applies |
| Format or text input: patterns, lengths, allowed characters | a valid value rejected, an invalid one accepted | Equivalence partitioning + Boundary value analysis on length | each rule of the format broken alone, plus the valid shapes |
| Interface or contract between components: fields, events, enum values, error codes | a field dropped, renamed or retyped | Interface check (checklist based) | each field and each enum value at the producer and at each consumer of the impact list |
| Permissions and tenants: role, owner, tenant boundary | access across a boundary | Decision table (role × action × owner) | each feasible column, the denied ones included |
| An area with a defect history (`bug-registry.md`, `lessons/confirmed-defects.md`) | the known class repeats | Error guessing | each known defect class that touches this change |
| A thin or unclear source, high uncertainty | unknown | Exploratory testing | each charter (one question, time boxed) |
| Performance conditions | see `performance-testing.md` | its load levels, time conditions and transactions | each load level and each transaction |

A condition can belong to more than one row. Take every row that fits, then apply step 3.

## Step 2. Strength follows the priority of the condition

| Priority tag | Strength | What it means |
| --- | --- | --- |
| [high] | strong | 3-value boundary analysis; full decision table (collapse only when the source says a condition is irrelevant); 1-switch transitions and every invalid transition; each invalid partition separately |
| [medium] | standard | 2-value boundary analysis; collapsed decision table; 0-switch transitions and each class of invalid transition |
| [low] | light | one representative per partition; the boundary of the one limit the source states; valid transitions only |

Raise the strength by one level when the area appears in `bug-registry.md` or `lessons/confirmed-defects.md`. Pairwise, use case and interface items do not change with strength; their item list is fixed by the rows above.

## Step 3. Combine, do not pile up
- Normally one or two techniques per condition. Equivalence partitioning and boundary value analysis always go together for an ordered domain.
- Do not add a technique that gives no new coverage item. Listing every technique for every condition is an error.
- A technique that cannot name its coverage item is not used. Exploratory testing names a charter, error guessing names a defect class.
- A negative item breaks exactly one rule and keeps every other rule valid, otherwise it does not show which rule rejected the input. Count one item per rule, never a combination of broken rules.

## Step 4. Count the items
List the items of every condition by label, not as steps, and compute how many there are. The number follows from the sources.

Example: the source says a customer may have up to 3 open orders. With strong boundary analysis the items are B1 = 2 open orders, B2 = 3, B3 = 4; the partitions are P1 valid (1 to 3) and P2 invalid (4 and above) and P3 invalid (0 or negative, only if the source or the validator treats it differently). Count: 6. Write the arithmetic in `techniques.md`.

## When the source is missing
- A limit, a rule or a transition that a technique needs but no source states is not guessed. The condition gets `exploratory (charter: <the open question>)` as its technique, with one item, and the question goes to "Check of assumptions" in the report.
- When two sources disagree, the newer and more specific one wins and the difference is stated.

## Output
`WORK_DIR/techniques.md`, one row per condition:

`| TC | kind (row of step 1) | technique(s) | strength | coverage items (labels) | count and arithmetic | why this and not another (one line) | src |`

The report gets the section `## Technique selection`, one line per condition, in the order of the conditions:

`- TC1 | <kind> | <technique(s)> | <strong|standard|light> | <items: labels> | <why this and not another> (src: ...)`

Every `TC` of the section "Test conditions" has exactly one line here. The labels are reused by the skill `coverage-matrix`, so write them once and keep them stable.
