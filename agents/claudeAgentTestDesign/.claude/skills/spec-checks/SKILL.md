---
name: spec-checks
description: Format and rules of a test design report. Business cases first, techniques inside them, every check with evidence.
---

# Spec checks

## Business first
A section of the report is a business case: a situation in which a user really uses the feature and what must be true afterwards in data, state and results. Collect the cases from the tester's flow, the ticket and every subtask and comment, the newest Confluence page, the bug registry and the existing automated tests. A section about pure mechanics (field limits, error codes, list filters) without a business case is a theoretical test; mechanics become a line inside the case they serve.

## Tester flow
When the task says how to test, the flow is the skeleton of the design. Split it into F1, F2 and so on. Each element is executed in practice: configure, trigger the behaviour, observe the result. No element disappears; one that cannot be run goes to To confirm.

## On the test environment
Write every check on the real environment: real identifiers instead of A and B, numbers from the configuration instead of symbols, numbered steps in execution order, fields under their API names, the expected result calculated from the configuration and where it is read.

## Evidence
Every check ends with `(src: ...)`: a file and line, a ticket key, `conf:<page title>`, an endpoint or `bug:<key>`. Without evidence there is no check.

## Format
See the section "Output format" in CLAUDE.md.
