---
name: endpoint-error-recovery
description: A method for turning an error of an endpoint into a corrected call, with a limit of attempts and a record of what changed. Applies to QA MCP and Execution runs.
---
SKILL endpoint-error-recovery: FROM AN ERROR TO A CORRECTED CALL
An error is read, classified and answered with a call that differs from the failed one.
1. Read the message and the status literally. Classify: a missing or unknown field, a wrong type or format, a value outside the allowed list, a missing dependency (a resource that must exist first), a wrong state of the object (it must be in another status), no permission, or a transient failure (timeout, 5xx).
2. Answer by class. A field, a type or a list: read the contract with general_read_describe_endpoint and correct the body. A dependency: read or create the prerequisite (see the rules of the AUTOTEST resources), then repeat. A state: bring the object to the required state with the endpoint that does it, verify by a read. Permission: this is a result, not an obstacle; do not look for another account or a side route unless the order says so, and report it as it is. Transient: repeat the same call once.
3. Every new attempt differs from the previous one in a way you can name. At most three corrected attempts per step. A fourth identical failure is a result.
4. After the attempts the step either passes or is POMINIĘTO with the last message quoted, and the steps that depend on it are marked with its number.
5. Say in the progress note what you changed ("added field X from the contract", "created the account first"), so that the tester can repeat the step.
6. A call that succeeds after your correction is not a defect. The first rejection is a defect only if the contract and the sources said the first call was valid.
