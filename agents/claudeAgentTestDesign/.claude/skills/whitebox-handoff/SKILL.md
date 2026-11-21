---
name: whitebox-handoff
description: Turns the findings of the whitebox and static reviews into black-box checks that a tester can run on the test environment. Load it in step 4 of CLAUDE.md when WORK_DIR has whitebox-findings.md or static-review.md, or when the input contains such findings.
---

# Whitebox hand-off

The whitebox review read the code and found where the system will behave wrongly. The static review read the task and found where it is unclear or inconsistent. The design turns what can be seen from outside into checks. Nothing is copied: a finding is a lead, and the check is written from the sources.

## What you receive
- `whitebox-findings.md` (or the whitebox report): numbered findings with what happens, what should happen, the consequence in the real world (trigger, result, who is affected, severity), the path to replicate and the evidence as `file:line`.
- `static-review.md` (or the static report): the requirements R1…Rn, inconsistencies, impossible or unclear requirements, gaps, and its verdict.

## Procedure
1. **Sort by severity.** Take the whitebox findings with the highest severity first. The room of the report is limited (see `business-case-design`, step 6), so the severe ones are placed first.
2. **Observable from outside?** For each finding ask whether a tester can see the wrong behaviour through an endpoint of `mcp__sources__api_endpoints` or in the web interface. If not (an internal log, a code path with no visible effect), it goes to "Not covered:" or "To confirm" with that reason.
3. **Business case.** Put the finding in the business case where its consequence happens. When no case fits, write a new case from the finding's consequence: "a customer exactly at the limit is accepted although the ticket says rejected". The case is a situation, not a defect description.
4. **Trigger.** Build the set-up from the finding's trigger on real resources, and compute it through the validators of the service (the configuration must be accepted, see `expected-result-oracle`). A trigger that the validators refuse is a design error; use the nearest allowed configuration and note the difference in "To confirm".
5. **Expected result from the source.** The check states what the ticket, the page or the code rule says should happen (the finding's "should be" and its `(src: ...)`). It does not state what the finding says the code does, and it does not accept the author's claim without the source.
6. **Evidence.** The check cites the source of the expected result and the `file:line` of the finding. A finding with no source for its "should be" becomes a question in "To confirm".
7. **Static findings.** A requirement that is unclear or contradictory is a question for the task owner: it goes to "To confirm" in one line. A requirement that is clear and testable becomes part of a business case. A static verdict BLOCKED is stated in "To confirm" with its reason.
8. **Existing behaviour.** A finding marked as existing behaviour (`stan zastany`) is designed only when the task asks for a general review.
9. **Do not duplicate.** A defect that the tester already reported in the ticket is not designed again.

## Rules
- Do not copy wording, values or steps from the findings. The check is written for this feature with this feature's real resources.
- Do not drop a high-severity finding silently. It is a check, or it is named in "Not covered:" or "To confirm" with the reason.
- The whitebox digest says which findings the review proved and which it left for manual checking. The second kind goes to "To confirm" unless a source settles it.
