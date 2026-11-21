---
name: test-from-design
description: Turns the checks of a Test Flow artefact (design of phase 4, procedure of phase 5, Execution report of phase 6) into autotests, one behaviour per test, with the expected value and its source carried into the assertion. Applies when the input is such an artefact.
---
SKILL test-from-design: WHEN THE INPUT IS A DESIGN, A PROCEDURE OR AN EXECUTION REPORT
The input may be a Test Flow artefact and not a prose case: a design (sections of business situations with checks "step => expected result (src: ...)"), a procedure of phase 5 (steps with a priority tag and a design reference §n.k, Setup, Cleanup, Gates) or an Execution report (ZLECENIE, KROKI, BŁĘDY). The rules of the main prompt stay; this adds how to read such an input.
1. One behaviour is one test. A check of a design or a step of a procedure is a behaviour; steps that only prepare the state (Setup) or restore it (Cleanup) are fixtures or helpers of the test, not tests.
2. The expected result is the one the artefact states with its source. Put it in the verify_* helper and write the source into the scenario comment or the message of the assertion in a few words ("per PRJ-123"). Never replace the expected value by what the system returned in an Execution report: a defect of the report means the test states the correct behaviour and fails until it is fixed.
3. Traceability stays in the test. Put the design reference (§n.k) and, when the input names it, the condition (TC) in the scenario comment, so that a failing test points back to its check.
4. Choosing, when there are more checks than the limit of tests: priority first (CRITICAL, HIGH, then lower), then checks that no existing test covers (Grep the tests of the repo for the same behaviour). A check you do not write goes to PYTANIA with its reference, never silently.
5. A step marked NOT VERIFIABLE VIA MCP or [NIE DA SIĘ PRZEZ MCP] is not an API test. In an API run say so in PYTANIA; in a UI run it is a candidate for a test of the page.
6. Values (accounts, lots, identifiers) come from the artefact and go to parametrize. A value that is a symbol in the artefact (A, B, T) is not used: ask in PYTANIA for the real one or read it from the AUTOTEST resources the repo already uses.
7. A step that failed in the Execution report: write the test for the expected behaviour and note in PYTANIA that it is expected to fail with the call number of the report. A step skipped there for a test-configuration reason is written on the allowed configuration, with both values in the comment.
8. Do not copy the procedure step by step. Ordered steps of one scenario become one test with a helper per action, or several independent tests when the behaviours are independent.
