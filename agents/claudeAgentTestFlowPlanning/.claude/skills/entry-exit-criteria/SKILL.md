---
name: entry-exit-criteria
description: Writes checkable entry and exit criteria, each with a measure and a source, from how-we-test.md, the test environment setup, the ticket and the code, so that nothing like "code ready" remains. Load it in step 5 of CLAUDE.md.
---

# Entry and exit criteria

A criterion is good when someone can look at one place and answer yes or no. The entry criteria decide whether testing may start; the exit criteria decide whether it may stop. Both come from sources, not from habit.

## The form of every criterion
`<what must be true> — measure: <the number, the state or the artefact that shows it> (src: ...)`
- The measure is a number, a named state, or a named artefact (a ticket status, a file, a resource on the environment, a build version).
- The src is where the rule comes from: `how-we-test.md`, the ticket, a page, the code, `autotest-setup.md`.
- No vague words: ready, done, stable, sufficient, appropriate, adequate, as needed, enough, good, working, tested. The validator rejects them.

## Entry criteria: where to look
- **Understanding**: the task has no open Critical finding of the static check; open questions to the author are answered or listed. Measure: the number of open questions, the status of the ticket.
- **Code**: the change is on the branch or the build that the test environment runs. Measure: the build or commit id, or the deployment named in the sources.
- **Environment**: the test environment is reachable and the AUTOTEST resources the task needs exist in the state `autotest-setup.md` describes. Measure: the resources by name and their key values.
- **Data and access**: accounts, rules and values named in the task exist; the sources the agents use are connected. Measure: named resources, a successful read.
- **Specification**: the expected results of the acceptance criteria are written in a source. Measure: each criterion has a statement of the result.

## Exit criteria: where to look
- **Coverage**: the thresholds of the team in `how-we-test.md`; when the team states none, the defaults the Analysis phase uses (high priority 100%, medium at least 80%, low at least 50%) and the criterion says they are defaults.
- **Acceptance criteria**: every criterion of the ticket has at least one passed check (the team's definition of done in `how-we-test.md`).
- **Risks**: every risk with exposure `high` (id `Pn`) has been tested and its result is known. Measure: the ids.
- **Defects**: no open defect of the severity the team stops on; every defect found is reported with its key. Measure: the count and the key list.
- **Regression**: the regression suite named in the sources ran and passed. Measure: the run and its result.
- **Open questions**: none left that change the expected result.

## Rules
- At least two entry and two exit criteria, and not more than eight of each.
- A criterion that no source supports is not written; put the missing source in the project risks instead.
- Do not copy the list of this skill; keep only what applies to this task, and name its real values.
