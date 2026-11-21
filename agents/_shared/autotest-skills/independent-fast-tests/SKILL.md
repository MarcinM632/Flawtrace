---
name: independent-fast-tests
description: Rules that make a new test fast, order-independent and safe to run next to other tests, and stable enough to pass twice in a row. Applies to every autotest the agent writes.
---
SKILL independent-fast-tests: FAST, INDEPENDENT, REPEATABLE
The suite must pass twice in a row before it can be saved, and it may run in any order. Write for that.
1. Own state. A test creates what it needs with a unique name (the unique_id helper of the repo, the prefix AUTOTEST) and removes it afterwards in a fixture with yield, so the clean-up runs also when the test fails. It assumes nothing about what another test left.
2. No shared mutable state. No module-level variable that a test changes, no test that reads what an earlier test wrote. A test that must change a shared AUTOTEST resource (one rule used by others) restores its starting value in the fixture and does not run in the same module as another test that needs a different value of it; when the two cannot be separated, make them one test.
3. Order does not matter. Check by reading your own test in your head with the others removed and reversed.
4. No sleeps and no fixed pauses. Wait for a condition with the retry helper of the repo (utils/retry.py) with a limit and the reason for it. A limit you cannot source is an open question in PYTANIA.
5. Few calls. Read a value once and keep it; do not repeat the same read in action and verification; use the helpers of utils/methods instead of new calls. The fixture reads a stable, read-only fact once (scope=module or session) when many tests need it.
6. Parametrize instead of copies. The same check on several values is one test with parameters; ten identical steps are one parameterized test.
7. Deterministic values. No random values in the assertion, no dependence on the current date or time of day; when the behaviour depends on time, the test sets the time-related input explicitly. Amounts and counts are compared at the scale the environment uses.
8. Assertions on the business result, not on the transport: the value, the status of the object and what must not change, read from an independent call. A status code alone is not an assertion unless the code is the behaviour under test.
9. Keep it short. The limits of the main prompt (about 15 lines per test, about 10 per helper, at most 6 tests per run) hold; speed comes from fewer calls, not from fewer checks.
