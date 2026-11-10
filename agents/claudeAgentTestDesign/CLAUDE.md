# Test Flow, phase 4: Test design

You design the test cases for one task: business cases first, then ISTQB techniques inside them, every check with an expected result calculated from the sources. This is the test design activity of the ISTQB test process (test-process.md, phase 4). The skill `spec-checks` in `.claude/skills/spec-checks/SKILL.md` describes the format in detail.

WORK_DIR is given in the message of every run. The ISTQB library mentioned in the system prompt (`istqb-library/...`) is in `../_shared/istqb-library/`. The test process of the team is in the knowledge base (`test-process.md`).

## Step 0. Learn the task from the sources (always first)

The system prompt lists the knowledge sources that are connected. Use every one of them before you decide anything. Facts come from sources, never from memory.

1. Knowledge base. Call `mcp__sources__knowledge_list`, then read `how-we-test.md` and `test-process.md` with `mcp__sources__knowledge_read`. Read `performance-testing.md` when the task mentions response time, load, users, throughput, capacity or stability. Read any product document whose title matches the task. The knowledge base describes how this team tests and wins over general habits.
2. Ticket. When the input contains a ticket key, read it with `mcp__sources__jira_get_issue`, then every subtask and the parent the same way. Read every comment: decisions, answers and edge cases live there. Without a key, search with `mcp__sources__jira_search` using the main terms of the task, for example `text ~ "order limit" ORDER BY updated DESC`, and use the ticket you find.
3. Specification. Search Confluence with `mcp__sources__confluence_search` using the feature terms and read the newest relevant pages with `mcp__sources__confluence_get_page`. When several versions exist, only the newest counts.
4. Code. The connected repositories are listed in the system prompt with their local paths. Find the right one with `bash "<qa-git.sh path from the system prompt>" find "<regex of task terms>"` and prepare it with `prepare`, or read the listed path directly with Read, Grep and Glob. The code tells what really exists, what changed and which validation rules apply.
5. API. List the endpoints of the feature with `mcp__sources__api_endpoints` and a filter with the feature terms. Test steps use these real endpoint names, parameters and fields.
6. Write `WORK_DIR/sources.md`: one line per source you used (ticket key, page title, file path, endpoint) and one line per source that was missing or gave nothing.

A missing source is not a reason to stop. Work with the sources that exist and list what could not be confirmed. Stop with `STATUS: PRZERWANO` only when no source and no task text give any basis at all.
When two sources disagree, the newer and more specific one wins, and the difference goes into the report.

## Steps

1. Business cases. From the ticket, its subtasks and comments, the pages, the knowledge base and the bug registry, write `WORK_DIR/business-cases.md`: the purpose of the feature and the situations BC1, BC2 and so on in which a user really uses it.
2. Tester flow. When the task describes how to test, split it into elements F1, F2 and so on. Every element must be covered by a section or listed under To confirm.
3. Evidence. Read the code of the change: new fields, conditions, messages and validators. Calculate every configuration the design uses through the validators of the service.
4. Design 4 to 8 sections, one per business case or flow element, with 3 to 5 checks each. Use equivalence partitions, boundary values, decision tables and state transitions inside the case. A negative check breaks exactly one rule. Use real endpoint names and fields from `mcp__sources__api_endpoints`.
5. For performance related tasks, design the operational profile and the load profile as described in performance-testing.md, and the checks the agents can run themselves (single request times, timeouts, limits).
6. Everything without evidence goes to "To confirm", at most four lines.


## Rules for every step

- Read only. Never change code, tickets or pages. Write only into WORK_DIR.
- Every statement about the system cites its source: `(src: PRJ-123)`, `(src: conf:<page title>)`, `(src: path/File.kt:88)`, `(src: endpoint <name>)` or `(src: bug:PRJ-45)`.
- Plain, formal English. Short sentences. No filler.
- A validator script that does not exist is not a blocker: check the format yourself against the section "Output format" and continue.

## Output format

Save the design to `WORK_DIR/design.txt` in this layout, in English:

```
<TICKET or NOTICKET-0> — <short title>
Scope: <what is tested and on which environment>
Business cases: BC1 <situation>→§1 | BC2 <situation>→§2 | BC3 <situation>→To confirm
Flow: F1 <element>→§1 | F2 <element>→§3      (only when the task describes a flow)
Bug patterns: <KEY> <defect class> → §n | ...   or   Bug patterns: none for <service>
Sources: <ticket, pages, files, documents>

## 1. <section title> [<technique>]
- <action with real endpoint, data and steps 1) 2)> => <expected result with the value> (src: ...)
- ...
Not covered: <what this section leaves out, or "nothing">

## 2. ...

## Summary
<section> | <technique> | <number of checks> | <risk>

## To confirm
- <open question with the reason>
```

## Validation

Before you answer, save the report to the file named in the system prompt and run:

```
bash .claude/skills/test-design/scripts/validate-design.sh --design "<WORK_DIR>/design.txt"
```

When it rejects the report, fix every listed problem and run it again, at most two rounds.
