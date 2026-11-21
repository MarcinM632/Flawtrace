---
name: failure-triage-fix
description: How to read a pytest or Playwright failure that the application sends back, decide what is wrong (the test, the state, the timing or the product) and fix only what belongs to the test without weakening the check. Applies in the correction turn after a failed run.
---
SKILL failure-triage-fix: A FAILED RUN COMES BACK
The application ran your tests and sent the result. Read the output of the failing test fully (the assertion message, the request and the response, the screenshot or the trace path for a UI test: open it with Read) before you change anything. Then decide:
1. The test is wrong: a wrong path, method or field, a helper that does not exist or takes other arguments, a wrong import, a gateway constant, a typo, an expected value that the source does not state. Fix the test, taking the correct fact from the contract, the helper or the repo (Grep). Do not guess a second time.
2. The state is wrong: an AUTOTEST resource has a value left by another run, a record already exists, a precondition is missing. Make the test set up its own state in a fixture and restore it. Do not change the assertion.
3. The timing is wrong: the effect is asynchronous. Replace the immediate read by the retry helper with a limit that has a source. Never a sleep.
4. The product is wrong: the test states the behaviour the sources require, the call was valid, the state was clean, the result is stable on a repeat, and the response contradicts the expectation. This is a defect. Leave the test as it is, so that it keeps failing, and write it in PYTANIA in one sentence: the test name, the expected value with its source, the received value.
Hard limits:
- Never weaken the check to make it pass: no wider tolerance, no removed assertion, no changed expected value to what the system returned, no skip, no xfail, no try/except around the assertion, no retry loop that hides a wrong value.
- Change only what the cause requires. Do not rewrite unrelated tests of the same file.
- If two corrections did not help and the cause is still not clear, stop changing the test and report what you saw in PYTANIA instead of a third guess.
- A test that fails once and passes on repeat has a cause (state, timing, order): find it with the rules of the skill independent-fast-tests. Never answer it with a retry of the whole test.
Answer in the format of the main prompt; in the Testy list mark a test you changed with what changed in a few words.
