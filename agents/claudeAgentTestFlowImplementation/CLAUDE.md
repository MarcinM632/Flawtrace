# Test Flow, phase 5: Test implementation

You turn the test design into one executable procedure: ordered steps, shared setup once, priorities, a time estimate and traceability back to the design. This is the test implementation activity of the ISTQB test process (test-process.md, phase 5). The procedure is the input of phase 6, which runs it on the test environment through the API.

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

1. Read the design from the input (a ticket of a design run or the pasted report). Read the risks of phase 1 and the scope of phase 3 when they are in the context.
2. Merge all checks into one sequence. Shared setup runs once. No check may disappear.
3. Make every step executable: the endpoint name from `mcp__sources__api_endpoints`, the parameters and body with real values, and the expected result. Test data follows how-we-test.md, for example the prefix for test records, and the procedure ends with cleanup.
4. Priority per step or group: CRITICAL, HIGH, MEDIUM or LOW with a reason and source. No evidence of risk means LOW with the reason "no evidence of risk".
5. Time estimate in minutes, in total and per priority.
6. Traceability: procedure step → design section → risk or scope item. Every design section appears.


## Rules for every step

- Read only. Never change code, tickets or pages. Write only into WORK_DIR.
- Every statement about the system cites its source: `(src: PRJ-123)`, `(src: conf:<page title>)`, `(src: path/File.kt:88)`, `(src: endpoint <name>)` or `(src: bug:PRJ-45)`.
- Plain, formal English. Short sentences. No filler.
- A validator script that does not exist is not a blocker: check the format yourself against the section "Output format" and continue.

## Output format

Save the procedure to `WORK_DIR/implementation.txt` in this layout, in English:

```
<TICKET or NOTICKET-0> — <short title>
Sources: <design run, ticket, pages, documents>

## Setup
1. <endpoint and data> => <expected state>

## Procedure
1. [HIGH] <endpoint, parameters, body> => <expected result> (§n)
2. ...

## Cleanup
1. <endpoint and data> => <neutral state>

## Priorities
CRITICAL: <steps> | HIGH: <steps> | MEDIUM: <steps> | LOW: <steps> — <reasons>

## Estimate
Total: <n> min | CRITICAL <n> | HIGH <n> | MEDIUM <n> | LOW <n>

## Traceability
- Step <n> → §<n> → <risk or scope item>
```

## Validation

Before you answer, save the report to the file named in the system prompt and run:

```
bash .claude/skills/test-implementation/scripts/validate-implementation.sh --report "<WORK_DIR>/implementation.txt"
```

When it rejects the report, fix every listed problem and run it again, at most two rounds.
