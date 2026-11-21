---
name: scenario-dry-run
description: Chooses business scenarios with real values, computes what the task demands and what the existing code gives, and compares. Every behaviour requirement must be covered by a scenario. Load it in step 4 of CLAUDE.md.
---

# Scenario dry run

Reading finds what is written badly. Running a case through the task and through the code finds what is written well and still wrong: a limit that is off by one, a rounding that differs between two places, two rules that both apply with no priority.

## Step 1. Choose scenarios from the requirements
- Take the requirements of type business rule, functional and data. Each must be covered by at least one scenario; one scenario may cover several requirements that act together.
- Cover, in this order: the normal case; the boundary of every ordered limit (the value at the limit and one unit on each side); the combination of two rules that can both apply; a repeated or parallel action; the empty and the maximum case; each role the task names.
- A requirement that no scenario can cover (a constraint, a pure wording statement) is listed in "Checked and consistent" with the words `no scenario:` and the reason.
- Use real values from the sources or the code: identifiers, amounts, limits, dates, currencies. Never letters.

## Step 2. Compute what the task demands
Take the rule as the task and its sources state it. Do the arithmetic yourself, with the unit, the rounding rule, the scale and the time zone of the source. Write the result and where it comes from. A rule the task does not state is not completed by you: it is an open question with the two possible readings, and the scenario is marked as such.

## Step 3. Trace the code
Follow the same input through the existing code, from the entry point (endpoint, job, event) through each layer that touches the value, with `file:line` for each step. Look for: the order of the checks, the first branch that returns, defaults, rounding and unit conversions between places, the same rule coded twice with different limits, a guard that stops the case earlier. Compute the result the code gives.

## Step 4. Compare
- Same result: `MATCH`.
- Different result: `MISMATCH → finding N`, and the finding states both results and where each comes from.
- The task gives no result for the scenario: a `Gap` finding, or an open question when the business decision is in no source.
- The code does not exist yet for the part the task adds: say so, and compare the task against the rest of the flow and the interfaces it must fit.

## Step 5. Scenario line in the report
`S<n> <the case with real values> | covers: R<a>, R<b> | task expects: <result> | system gives: <result> (src: path/File.kt:88) | MATCH`
or `... | MISMATCH → finding <n>`.
The `covers:` field lists the requirements the scenario exercises. Count at least three scenarios, and as many as the coverage of the behaviour requirements needs.

## Rules
- Never choose a value because it makes the code look right or wrong. Choose it from a limit or a rule in a source.
- Do the dry run once with the roles of the business owner, the user, the developer and the operator in mind, as in CLAUDE.md, and add a scenario only when a role finds a case the others did not.
- Do not write test cases: a scenario here is a thought experiment on the task and the code.
