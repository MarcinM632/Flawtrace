# Static testing (ISTQB Foundation Level, chapter "Static testing", summary)

Static testing finds defects in a work product without running it. It applies to the test basis (requirements, user stories, acceptance criteria, tickets, specifications) and to code. It is cheaper to fix a defect found before implementation than after.

## What static testing finds
- Requirement defects: inconsistencies, contradictions, ambiguities, omissions, inaccuracies, duplication, statements that cannot be tested.
- Design defects: a structure or algorithm that cannot deliver the required behaviour, inefficient design.
- Coding defects: variables used before they are set, unreachable or dead code, duplicated logic, conditions that are always true or false, overflow and rounding errors.
- Interface defects: an interface described one way and implemented another.
- Deviations from the rules the team already coded or documented.
- Gaps in the test basis: an expectation that no acceptance criterion covers, so no test can be derived from it.
- Security weaknesses visible in the code or in the requirement (missing authorisation, trust in input).

## Review techniques
- Ad hoc: read and note what looks wrong. Weakest, use only to start.
- Checklist-based: walk the work product through a list of typical defects (see the checklist in the agent instructions). Gives coverage of defect classes.
- Scenario-based and dry run: take a concrete business scenario with real values and walk it step by step through the requirement and through the code. A mismatch between the expected and the computed result is a defect.
- Role-based and perspective-based: read the same work product as the user, the business analyst, the developer, the tester and the operator. Each role asks different questions.

## Static analysis of code (no execution)
- Control flow: unreachable branches, missing else, conditions that cannot change, loops that may not end.
- Data flow: a value set and never used, used before it is set, overwritten before use, null on a path.
- Consistency: the same rule coded twice with different limits, magic numbers, units and rounding that differ between places.
- Ranges and partitions: thresholds that leave a gap or overlap (for example 0-10 and 11-20 for a decimal value, or 1-5 and 5-10).

## Quality of a requirement (what makes it testable)
- Single idea, unambiguous, with an observable result.
- Uses the terms of the domain, defined once.
- Consistent with the other requirements and with the existing system.
- Complete: normal path, boundaries, errors, permissions, existing data, who and when.
- Feasible in the current architecture and data model.
- Traceable: each statement has a source and can be covered by at least one test condition.
