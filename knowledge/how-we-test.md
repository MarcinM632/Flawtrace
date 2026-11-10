# How we test

This file is the agreement of the team. The agents follow it before any general habit. Replace every line in angle brackets.

## Sources of truth

- Requirements: <Jira project keys and the Confluence spaces that hold specifications>
- Code: <repositories and the branch that holds released code, for example main>
- API contracts: <address of the OpenAPI or Swagger documents>

## Environments

- Test environment: <base address>. Automated tests and agents may change data here.
- Other environments: <name, address and whether agents may use them>
- Never test on production.

## Test data

- Use only accounts, users and records whose name starts with <prefix, for example AUTOTEST>.
- A test creates the data it needs, checks the result by reading it back and removes or resets it at the end.
- Never change data that belongs to someone else.

## Definition of done for testing

- Every acceptance criterion of the ticket has at least one passed check.
- Every defect found is reported with steps, expected result, actual result and evidence.
- Regression checks for the affected area have run.

## Conventions

- Ticket keys look like <PRJ-123>.
- Reports are written in <language>.
- Severity scale: <critical, major, minor, trivial and what each means here>.
