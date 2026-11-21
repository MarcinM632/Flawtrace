---
name: test-data-and-cleanup
description: Baseline, ledger of what the run created or changed, verification by reads and restore at the end, also when steps failed. Applies to QA MCP and Execution runs.
---
SKILL test-data-and-cleanup: BASELINE, LEDGER, RESTORE
1. Baseline. Before the first write, read every resource and field the test will touch and write the values into your notes: resource, field, value. Without a baseline you cannot prove the change was yours or that you restored it.
2. Ledger. Keep a running list of what you created (resource, id) and what you changed (resource, field, old value, new value). Update it after each write. Take the name prefix of test records from how-we-test.md (names of your own resources start with AUTOTEST).
3. Verify every write by reading it back (the _readBack of the write and, for a state change, an independent read). A non-empty mismatches field means the change did not enter; do not report it as set.
4. Restore at the end, even when steps failed or were skipped: restore changed fields to the baseline values and remove what you created, in the reverse order of creation. Never change or delete a resource that is not AUTOTEST or that you did not create in this run.
5. Prove the restore: read each touched resource once more and compare it with the baseline. A difference is written in STAN KOŃCOWY with the id and the reason.
6. A restore call that fails is repeated once; if it fails again, leave the resource, name it with its id in STAN KOŃCOWY and do not hide it.
7. When the procedure has its own Cleanup, run it, then do the proof of step 5; the ledger decides what is left, not the list of the procedure.
