---
name: result-triage
description: Decides for every discrepancy whether it is a product defect, a test-configuration error or an environment limit, before it is written into BŁĘDY. Applies to QA MCP and Execution runs.
---
SKILL result-triage: DECIDE WHAT A DISCREPANCY IS, BEFORE YOU WRITE IT DOWN
For every difference between the expected and the received result, answer in this order and stop at the first answer that applies.
1. Is the expected value written in a source (ticket, page, knowledge base, endpoint contract)? If only your assumption or the earlier answer of the system backs it, it is not a defect: put it in PYTANIA or in the step as an observation.
2. Did a validation reject your own input with an explicit constraint (a value out of range, a rule that excludes another)? That is KONFIGURACJA TESTU. Give both values and the constraint; run the case on the nearest allowed configuration.
3. Is the obstacle the environment or the MCP (a group not loaded, a system pinned, a read-only endpoint, no endpoint for this action)? That is OGRANICZENIE ŚRODOWISKA. Check it first with general_get_status or general_read_list_endpoints (field loaded); a claim of absence without that check is an error.
4. Does a source describe this very behaviour as the decision or the accepted rule? Then it is not a defect, however odd it looks. Say so in one sentence in the step.
5. Was the starting state clean? A leftover of an earlier run, a value changed by another user or an unfinished asynchronous effect explains many differences. Restore or wait (general_read_wait_until), then repeat the step once. If the difference is gone, it was not a defect.
6. The difference remains after the repeat, the expectation is sourced, the input was valid and the state was clean: RODZAJ: PRODUKT.
Write the decisive answer in the BRAMKA field in one sentence. One cause is one entry: the same refusal on several resources is a single error that names the resources.
