---
name: impact-radius
description: Finds where the changed component or contract is really used outside its own repository, and confirms or rejects every hit by reading it. Load it in step 5 of CLAUDE.md, after existing coverage is read. Writes WORK_DIR/impact.md and the report section "Impact of the change".
---

# Impact radius

A change is tested where it is made and also where it is used. A field renamed in one service breaks the consumer that nobody tested. The impact list decides which confirmed uses phase 4 must design for and which regression tests must run; a missed consumer is a missed defect, an invented consumer is wasted work.

You do not test anything here and you do not repeat static or white-box review. You find the uses, prove each one from the code, and write them down.

## Step 1. Name what changed
From the ticket, the pages and the diff or code, write the exact names that other code would use:
- the component: class, module, function, endpoint path, queue or topic name, table or column;
- the contract: request and response fields, event fields, enum values, error codes, configuration keys.

Use the names as they appear in the code, not the words of the ticket. A ticket that says "order limit" may mean `maxOpenOrders` in code. When the code name cannot be found, the impact cannot be checked: say so in "Check of assumptions" and stop this skill for that name.

## Step 2. Search
Run one search per name, each as its own command:

`bash "${QA_GIT}" find "<regex>"`

- Build the regex from the code name and its common spellings in other languages: `maxOpenOrders|max_open_orders|MAX_OPEN_ORDERS`. For an endpoint, search the path without the host: `/orders/[^"]*/limit`.
- Too many hits (more than about 50): narrow the regex with a word boundary or the owning package, never drop the search.
- No hits outside the own repository is a result. Write it.

## Step 3. Confirm every hit
For each hit outside the own repository, fetch the repository with `bash "${QA_GIT}" prepare "<repo>"` when needed and read the line with Read or Grep. Classify it:

| Class | What you saw | In the report |
| --- | --- | --- |
| call | the code calls the endpoint, function or method | confirmed use |
| import | the code imports the class, type, client or generated model | confirmed use |
| contract | the code reads or writes the same field, event, enum value, table or key | confirmed use |
| config | a configuration or deployment file sets or reads the key | confirmed use |
| test only | only a test or a mock refers to it | not a use; a regression test to run |
| name only | same text, different meaning (a comment, a log text, an unrelated variable) | rejected, with the reason |

A hit is confirmed only after you read the line. A file name or a search snippet alone is not proof.

## Step 4. Describe the effect
For each confirmed use write one line: what the consumer does with it, and what the change does to it there. Use the words "breaks", "changes behaviour", "unaffected (reason)" or "unknown (open question)". "Unknown" goes to "Check of assumptions" as a question.

## Output
`WORK_DIR/impact.md`, one row per hit:

`| name searched | repository | file:line | class | effect | src |`

The report gets the section `## Impact of the change`, one line per confirmed use:

`- <repository>: <class> - <what uses it and the effect> (src: path/File.kt:88)`

When nothing outside the own repository uses it, the section has the single line:

`- No use outside <own repository>: searched <regex list> with qa-git.sh find (src: qa-git.sh find)`

Rejected hits are not listed in the report; keep them in `impact.md`. Test-only hits go to the "Regression" line of "Done criteria". The number of confirmed uses is the `<n>` of the "Impact" line in "Done criteria", and each confirmed use needs at least one coverage item in the matrix (skill `coverage-matrix`).
