---
name: lessons-check
description: Uses the lessons of the tester (confirmed defects and false alarms) in the entry so the next tester does not repeat a known mistake. The application writes the lessons files itself; this skill only reads them. Load it in step 3 of CLAUDE.md.
---

# Lessons check

The application records lessons by itself, without a model, when the tester confirms the results of a Full test: `lessons/confirmed-defects.md` and `lessons/false-alarms.md`. Their latest lines are in the brief of every run. You do not write these files and you do not copy lines of them wholesale. You read them for the area of this task.

## What to do
1. Find the lines of the lessons that match the service or function of the task (same words, same resource). A line of another area is not used.
2. **Confirmed defects of the area.** They enter the list of defects through `defect-triage` with certainty `confirmed`. If the area has any, the line "Jak to działa w praktyce" or the list says what to check first: one sentence, taken from the lines, not from memory.
3. **False alarms of the area.** One line `Nie jest defektem:` after the list, with the behaviour the tester judged to be not a defect and the reason when the line has it. This stops the next tester and the next agent from reporting it again. Include it only when the area has such lines; otherwise omit the line completely.
4. A false alarm that this run's Execution report lists as a product defect is a conflict. Do not decide it. Write both in one sentence: `report says defect, tester earlier judged it not a defect (<date, ticket of the lesson>)`, and leave the list entry with certainty `suspected`.
5. A lesson older than the specification or the task changing is not valid: the lessons say so themselves ("unless the task or the specification changed"). When the ticket or the page is newer than the lesson date, do not use the lesson and say that in the line.

## What you never do
- Write into `lessons/`, or propose lesson lines. The tester decides what a lesson is.
- Turn a single lesson into a rule about the whole service.
- Use a lesson without its date and ticket when you cite it.

## Check before you answer
- Every line you took from the lessons matches the area of this task.
- A false alarm is not in the list of defects.
- No conflict was silently resolved.
