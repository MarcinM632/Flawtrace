---
name: impact-in-reality
description: Turns every finding into a real-world consequence with severity and confidence. Load it in step 7 before the report is written. Defines the content of the line "Dlaczego to groźne:".
---

# Impact in reality

A finding says what the code does. The reader needs to know what it does to the business: who meets it, what goes wrong, whether anyone notices, whether it can be repaired.

## Build the chain for every finding
Answer each of these, in this order, from the sources:

1. **Trigger.** Which real situation sets it off: who does what, with which real values. Use the border or the combination that you traced (see `edge-cases.md`, `mapping.md`, `trace.md`).
2. **Result.** What exactly goes wrong: wrong amount, wrong status, lost or duplicated data, wrong message, rejected valid request, accepted invalid request, access that should not exist, an error page.
3. **Who and how many.** All customers, one role, only records with a certain value, only old data. Use the product knowledge (`product/`), the ticket and the data model. Do not invent numbers.
4. **Detectability.** `głośna` (an error, a log, an alert, a failed job: someone sees it) or `cicha` (wrong data or wrong decision with no signal).
5. **Reversibility.** Can the wrong data be repaired? Is money, a legal or contractual obligation, personal data or an external system involved?
6. **Severity.**

| Severity | Meaning |
| --- | --- |
| krytyczna | wrong money or data loss or exposure of data, in a common flow or for many users, and `cicha` or not reversible |
| wysoka | wrong result in a common flow, or a security or tenant boundary crossed, with a workaround or a loud signal |
| średnia | an edge flow, or a loud failure that blocks one operation and can be repeated |
| niska | cosmetic, very rare, or reversible with no loss |

7. **Confidence.** `potwierdzone (src: ...)` when the sources state the rule and the consequence, or `założenie: <what must be true>` when the consequence rests on something no source confirms. An assumption never carries severity `krytyczna`; lower it one level and put the open question in "Do sprawdzenia ręcznie".

## Use the history
Read `lessons/confirmed-defects.md` and `lessons/false-alarms.md` when they exist. A finding of the same class as a confirmed defect gets higher confidence. A behaviour listed as a false alarm is not reported again unless the task or the specification changed.

## The line in the report
One line per finding, same label as before so the application can read it:

`Dlaczego to groźne: Wyzwalacz: <real situation>; Skutek: <wrong result>; Dotyczy: <who, how many>; Wykrywalność: <cicha|głośna>; Dotkliwość: <krytyczna|wysoka|średnia|niska>; Pewność: <potwierdzone (src: ...)|założenie: ...>`

Rules for the line:
- Plain, short sentences in the words of the sources. No "may", "probably", "might". Either the source says it, or it is an assumption and is marked so.
- Order the numbered findings by severity, the most severe first. Within one severity put the confirmed ones first.
- The consequence must follow from the evidence in `Dowód:`. A grave consequence on a weak proof is a reason to prove more, not to raise the severity.
