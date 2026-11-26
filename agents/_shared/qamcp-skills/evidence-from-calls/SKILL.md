---
name: evidence-from-calls
description: How to keep the expected value, the read value and the computed value apart in a live run, and what proves an absence. Applies to QA MCP and Execution runs; the application compares call numbers with the call log, this skill covers what it cannot.
---
SKILL evidence-from-calls: THREE KINDS OF VALUE
- Expected: written before you read, from a source (ticket, page, knowledge base, contract). Write its source next to it in the notes. If the only source is the system's own earlier answer, say so in the step: that proves consistency, not correctness.
- Read: a value of a response, with its call number [cN]. Scale, unit and precision come from the configuration of the environment, not from habit.
- Computed: a result of a formula over read values. Mark it "(wyliczone: formula)" and name the call numbers of the inputs. It is never an evidence of a reading.
Rules:
1. A before and an after proof has two call numbers ("... 4 → 6 [c9, c14]").
2. A claim that something does not exist needs a list call with the right filter and every page of the result; one page proves nothing.
3. A rounded or estimated number is not written. If a precision is needed, read it from the response.
4. Compare numbers after bringing both to the same scale and unit; say which scale was used.
5. A condition that holds only after some time is read with general_read_wait_until; met=false with the last values is a result, not a reason to wait longer.
6. Never write what a read returns when you only read the description of the endpoint.
7. Equivalence-partition and boundary-value items of the design ("ci: EP:..." / "ci: BVA:...") are run with technique_run_items, not by hand. Its verdict is evidence: "fail" with its call numbers is a defect candidate, "blocked" means the control request with a valid body was refused and nothing was measured. Never report a blocked item as passed or failed.
