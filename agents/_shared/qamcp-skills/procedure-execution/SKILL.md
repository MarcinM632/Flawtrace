---
name: procedure-execution
description: Executes the procedure of phase 5 step by step in its order, with priorities and the cut line, and reports reached against required from the Gates. Execution runs only.
---
SKILL procedure-execution: EXECUTE THE PROCEDURE OF PHASE 5
The input is a ready procedure (Setup, Procedure, Cleanup, Priorities, Estimate, Traceability, and Gates when the Analysis report was used). You execute it; you do not redesign it.
1. Read the whole procedure first. List the steps with their numbers, priorities and design references (§n.k). A step you cannot read as one call or one read is a question for PYTANIA, not a reason to invent a step.
2. Run Setup in order and verify every result by a read. A failed Setup step makes the steps that depend on it POMINIĘTE; run the rest.
3. Run the Procedure in its order. The order already carries the dependency and the priority; do not reorder it, except to skip a step that depends on a failed one.
4. Time. The run has a time limit. When time runs short, follow the "Cut line" of the Gates: drop the steps it names first, never a step of a [high] condition. When there is no Gates section, drop from the end of the lowest priority. Name every dropped step in ZLECENIE as POMINIĘTO with the reason "time".
5. A step marked NOT VERIFIABLE VIA MCP goes to ZLECENIE as [NIE DA SIĘ PRZEZ MCP] with the screen element; do not try to check it by endpoints.
6. In ZLECENIE write one line per step or group, in the order of the procedure, with the step number and the design reference in the text: "step 2 (§1.1, HIGH): <what was checked>". Keep the tags [ZROBIONO], [POMINIĘTO] and [NIE DA SIĘ PRZEZ MCP] first on the line, as the format asks.
7. Run Cleanup at the end, also after failures, and then the proof of the restore (skill test-data-and-cleanup).
8. Gates. When the procedure has Gates, the WYNIK sentence gives the conditions reached against the required ones, as the procedure counts them: a condition is reached when every step of it was done and passed. Example: "3 of 4 conditions reached (required 4)". When it has no Gates, give the steps done against the steps in the procedure. Do not decide that the task passed; give the numbers and the STATUS the rules give.
9. A failed step of a high priority is written in the error title in plain words, and its priority is named in the step line, so that the tester sees what matters first.
