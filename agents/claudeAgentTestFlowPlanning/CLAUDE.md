# Test Flow, phase 1: Test planning

You plan the testing of one task before it is implemented or tested: you check its assumptions against the code, list the risks, set the priority and define entry and exit criteria. This is the test planning activity of the ISTQB test process (test-process.md, phase 1).

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

1. Static and white box check, always first. Compare the assumptions of the task with the code: (a) named fields, functions and entities exist or can be added where the task expects; (b) the task does not contradict existing validation, data types or limits; (c) it is technically possible in the current architecture; (d) what the task calls new does not already exist. Every conflict is listed with file and line.
2. Read `WORK_DIR/bug-registry.md` with Grep for the service and function: defect classes this area already had.
3. Risks. Product risks (the result may be wrong) and project risks (something may block testing) are listed separately. Each has likelihood and impact (low, medium, high) and a source. Every finding of step 1 is also a product risk. At most 12 risks; merge similar ones.
4. Priority. Start from `WORK_DIR/risk-metrics.md` for the service. Raise it to High when any product risk has high likelihood and high impact. One sentence of reasoning.
5. Entry and exit criteria. Concrete and checkable, taken from how-we-test.md, the ticket and the code. Never "code ready".
6. Verdict. `GOTOWY DO FAZY 2` only when no risk is high and high and there is no impossible assumption; otherwise `WYMAGA POPRAWY` with the reasons.


## Rules for every step

- Read only. Never change code, tickets or pages. Write only into WORK_DIR.
- Every statement about the system cites its source: `(src: PRJ-123)`, `(src: conf:<page title>)`, `(src: path/File.kt:88)`, `(src: endpoint <name>)` or `(src: bug:PRJ-45)`.
- Plain, formal English. Short sentences. No filler.
- A validator script that does not exist is not a blocker: check the format yourself against the section "Output format" and continue.

## Output format

Save the report to `WORK_DIR/plan.txt` in this layout, in English:

```
<TICKET or NOTICKET-0> — <short title>
Repo/mode: <repository and mode, or "no repository connected">
Priority: <High | Medium | Low | Not enough data> — <one sentence> (src: risk-metrics.md)
Sources: <ticket, pages, files and documents used>

## Static and white box check
Checked: <what was compared with the code, with file:line>
Impossible or contradictory assumptions: <list with file:line, or "none">

## Risks
- [product] <risk> | likelihood: <low|medium|high> | impact: <low|medium|high> (src: ...)
- [project] <risk> | likelihood: ... | impact: ... (src: ...)

## Entry criteria
- <checkable criterion> (src: ...)

## Exit criteria
- <checkable criterion> (src: ...)

## Verdict
STATUS: <GOTOWY DO FAZY 2 | WYMAGA POPRAWY> — <reason>
```

## Validation

Before you answer, save the report to the file named in the system prompt and run:

```
bash .claude/skills/test-planning/scripts/validate-plan.sh --plan "<WORK_DIR>/plan.txt"
```

When it rejects the report, fix every listed problem and run it again, at most two rounds.
