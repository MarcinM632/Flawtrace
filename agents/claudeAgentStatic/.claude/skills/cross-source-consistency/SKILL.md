---
name: cross-source-consistency
description: Compares every fact the task depends on across ticket, comments, subtasks, Confluence, code, API contract and knowledge base, applies the rules of source precedence and reports differences with both quotes. Load it in step 1 and step 3 of CLAUDE.md. Writes WORK_DIR/facts.md.
---

# Cross-source consistency

A task is rarely wrong in one place. It is wrong because the description says one thing, a comment changes it, a page says another and the code does a third. Find those differences systematically, not by reading.

## Step 1. Build the table of facts
Write `WORK_DIR/facts.md`: one row per fact the task depends on (a field and its type or limit, a threshold, a status and its transitions, a role and what it may do, a term, a flow step, an event, an error code).

`fact | description | comments (number) | subtasks | Confluence (page, date) | code (file:line) | API contract | knowledge base | result`

The result is `agree`, `differ`, `one source only` or `source missing`. Fill a cell only with what you read; an empty cell is empty, not "n/a".

## Step 2. Precedence (what wins over what)
- Between statements of the task: a later comment wins over the description for the same point; a subtask refines its parent unless it contradicts it, and then it is a finding.
- Between pages: the newest version of the newest relevant page wins. The older page is only evidence of what changed.
- What should be: the task and the specification decide. What exists today: the code decides. A task that changes existing behaviour is not inconsistent with the code, because it asks for the change. A task that assumes existing behaviour that the code does not have is a finding.
- The interface: the API contract (`mcp__sources__api_endpoints`) and the code decide what a field is called and what it returns.
- The way the team tests: how-we-test.md of the knowledge base.

## Step 3. Classify each difference
- Two statements of the task demand incompatible results at once: `Inconsistency`.
- The task assumes something the code or the contract does not have: `Impossible` when it cannot be built without a decision outside the task, otherwise `Inconsistency`.
- A page, a comment and the description disagree and no source says which is current: an open question with the readings, not a guess.
- A comment that changes scope or a value and the description that was never updated: say it in the finding, with the comment number.
- The same fact exists only in one source and the task relies on it: note it; it is a finding only if a wrong reading is possible.

## Step 4. Terms
Build the glossary of the task and of the code. A task word that the code and the specification call differently, or the same word used for two things, is a defect candidate: `Ambiguity` or `Inconsistency`. Use the word of the client's sources in the report, and name the task's word only inside the quote.

## Step 5. Staleness
Compare dates: a page older than the last comment, a comment older than a later change of status, a decision in a comment that the page never took over. Report only a staleness that changes what a builder or a tester would do.

## Rules
- Every difference is quoted from both sides with the source and the place. A difference you can state only from memory is not a finding.
- Check that you read the whole comment thread and every subtask before you call a fact `source missing`.
- A fact with result `differ` that you cannot resolve goes to Open questions with the two readings.
