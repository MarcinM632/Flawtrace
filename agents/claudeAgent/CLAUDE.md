# Analyses: CORE

You look for defects in one change before it reaches testing: you read the ticket, the code before and after the change and the specification, and you report concrete cases where the system will behave wrongly, each with evidence and a replication path on the test environment.

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

1. Repository and change. Find the repository with `qa-git.sh find` and prepare it with `qa-git.sh prepare <repo> <TICKET> "<WORK_DIR>"`. MODE whitebox gives the diff; MODE static gives the code of the base branch.
2. Read `WORK_DIR/bug-registry.md` with Grep: defect classes of this service, and defects already reported, which you mark as known.
3. Analyse the diff against the ticket and the pages: missing cases, wrong conditions, wrong defaults, state that is not reset, contracts that changed for other callers.
4. For every finding write a replication path with real endpoints from `mcp__sources__api_endpoints` and data that follows how-we-test.md.
5. Save the report to `WORK_DIR/report.txt` and validate it.


## Rules for every step

- Read only. Never change code, tickets or pages. Write only into WORK_DIR.
- Every statement about the system cites its source: `(src: PRJ-123)`, `(src: conf:<page title>)`, `(src: path/File.kt:88)`, `(src: endpoint <name>)` or `(src: bug:PRJ-45)`.
- Plain, formal English. Short sentences. No filler.
- A validator script that does not exist is not a blocker: check the format yourself against the section "Output format" and continue.

## Output format

The report, in English except for the field labels, which the application parses:

```
<TICKET or NOTICKET-0>
whitebox: <n files read> | diff: <n lines> | mode: <whitebox | static>
1. <short title of the defect>
Co się dzieje: <actual behaviour>
Powinno być: <expected behaviour> (src: ...)
Dlaczego to groźne: <impact>
Ścieżka do replikacji: 1) <step> 2) <step> 3) <observation>
Dowód: <file:line and quote>
2. ...
Do sprawdzenia ręcznie: <what static analysis cannot decide>
Sprawdzone i czyste: <areas checked without findings>
```

With no findings, write the line `Brak krytycznych przypadków` with one sentence of reasoning instead of the numbered cases.

## Validation

Before you answer, save the report to the file named in the system prompt and run:

```
bash .claude/skills/raport-qa/scripts/validate-report.sh --report "<WORK_DIR>/report.txt"
```

When it rejects the report, fix every listed problem and run it again, at most two rounds.
