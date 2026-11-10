# Test Flow, phase 3: Test analysis

You decide what exactly has to be tested: the test strategy, the test conditions with priority, the coverage gap and the reach of the change in other components. This is the test analysis activity of the ISTQB test process (test-process.md, phase 3). You do not design test cases.

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

1. Test strategy. Choose one strategy, at most two combined, from the seven ISTQB types in `../_shared/istqb-library/test-strategy.md`, and explain why it fits this task. Listing all seven is an error.
2. Test conditions. From the ticket, the pages and the code, list what must be tested: functions, business rules, data, states, interfaces. For a performance related task use the conditions of performance-testing.md: load levels, time conditions and transactions.
3. Coverage. Read `WORK_DIR/autotests-coverage.md`. Name the existing tests of this area and what will not be covered after the change.
4. Impact of the change. Find the changed component or contract in other repositories with `qa-git.sh find`, and confirm each hit by reading it: a real call, import or shared contract. Every confirmed use gets a line with its source. No hits outside the own repository is stated, not skipped.
5. Check of assumptions. Does the strategy cover the risks from bug-registry.md and phase 1? Is "only this task" justified by step 4?
6. Scope for test design. A numbered list of areas to design, each tagged [high], [medium] or [low] by risk and impact.


## Rules for every step

- Read only. Never change code, tickets or pages. Write only into WORK_DIR.
- Every statement about the system cites its source: `(src: PRJ-123)`, `(src: conf:<page title>)`, `(src: path/File.kt:88)`, `(src: endpoint <name>)` or `(src: bug:PRJ-45)`.
- Plain, formal English. Short sentences. No filler.
- A validator script that does not exist is not a blocker: check the format yourself against the section "Output format" and continue.

## Output format

Save the report to `WORK_DIR/analysis.txt` in this layout, in English:

```
<TICKET or NOTICKET-0> — <short title>
Sources: <ticket, pages, files and documents used>

## Strategy
<strategy name>: <why it fits this task> (src: ...)

## Test conditions
- <condition> (src: ...)

## Coverage
Existing: <tests that cover this area, by name>
Gap after the change: <what is not covered>

## Impact of the change
- <repository>: <use of the changed component> (src: file:line)

## Check of assumptions
- <statement> (src: ...)

## Scope for test design
1. [high] <area>
2. [medium] <area>
```

## Validation

Before you answer, save the report to the file named in the system prompt and run:

```
bash .claude/skills/test-strategy/scripts/validate-strategy.sh --report "<WORK_DIR>/analysis.txt"
```

When it rejects the report, fix every listed problem and run it again, at most two rounds.
