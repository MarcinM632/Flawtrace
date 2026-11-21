---
name: requirement-testability
description: Turns the task into atomic requirements that a tester could verify, checks six attributes of each, and tags each with what varies in it so the next phases choose the right technique. Load it in step 2 of CLAUDE.md. Writes WORK_DIR/requirements.md.
---

# Requirement testability

A requirement is good when two people read it, build it and test it, and get the same result. Your job is to split the task into such statements and to show where the task falls short. You do not fix the task; you ask.

## Step 1. Split
- One statement is one rule, one condition or one result. "The order is rejected and the customer is notified when the limit is exceeded" is two requirements: the rejection and the notification.
- A sentence with "and", "or", "unless", "except", "if ... then ... otherwise" is split along those words. A list in the description is one requirement per item.
- A requirement keeps the exact words of the source so the quote can be checked. Never paraphrase it.
- Acceptance criteria are requirements too. When a criterion repeats a statement of the description, keep one and note both sources.

## Step 2. Six attributes of every requirement
Write them in `WORK_DIR/requirements.md` under the requirement. A missing attribute is not a finding on its own; it becomes one only when a developer or a tester could go wrong because of it.

| Attribute | The question |
| --- | --- |
| Actor | Who or what does it: a user role, a job, another service? |
| Trigger | What starts it: an action, an event, a time, a state? |
| Condition | When does it apply, and what happens when it does not (the else)? |
| Data | Which fields, with units, ranges, rounding, currency, time zone? |
| Observable result | What can a tester read after it: a value, a status, a screen text, a message, a stored record? |
| Source | Where is it written? |

An attribute that the task states vaguely ("fast", "appropriate", "as before", "etc.", "properly", "similar", a number without a unit, a pronoun with two subjects) goes to Ambiguity. An observable result that does not exist goes to Untestable.

## Step 3. Tag what varies
Add to the requirement line the tag `| varies: <kind>`, taken from this list. It tells phase 3 which technique the requirement needs, so use the same words:
`ordered domain` (number, amount, date, length, limit), `set of values` (status, type, role, currency), `rule combination` (several conditions, exceptions, priority), `life cycle` (states and transitions), `flow` (main path with alternatives), `parameters` (many independent settings), `calculation` (formula, rounding, scale), `time` (periods, zones, schedules), `format` (pattern, allowed characters), `interface` (fields, events, error codes between components), `permissions` (role, owner, tenant), `performance`, `none` (a constraint or a statement with nothing that varies).
More than one kind is allowed, separated by commas. Choose from what the source says, not from what would be convenient to test.

## Step 4. Type
`[business rule]`, `[functional]`, `[data]`, `[interface]`, `[non-functional]` or `[constraint]`, as in CLAUDE.md. A statement of the result a user sees is functional; a statement of a limit, formula or condition is a business rule.

## What goes into the report
The line `R<n> [<type>] "<quote>" (src: ...) | varies: <kind>`. The six attributes stay in requirements.md; only the findings they produced go into the report.
