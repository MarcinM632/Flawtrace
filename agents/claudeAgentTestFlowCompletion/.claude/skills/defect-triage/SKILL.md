---
name: defect-triage
description: Builds the list "Znane defekty tego obszaru" from the bug registry, the execution report and the lessons of the tester: one entry per cause, with severity and certainty, no duplicates, no false alarms. Load it in step 3 of CLAUDE.md.
---

# Defect triage

The list tells the next tester where this area breaks. It is short and every entry can be trusted.

## Where entries come from
1. `WORK_DIR/bug-registry.md`: Grep by service and function of the task. Take the key, the one-sentence description and the status as the registry writes them.
2. The Execution report, when it is in the input: the entries of BŁĘDY with `RODZAJ: PRODUKT`. Entries of `KONFIGURACJA TESTU` and `OGRANICZENIE ŚRODOWISKA` are not defects of the product and do not enter the list.
3. The confirmed defects of the lessons (`lessons/confirmed-defects.md`, in the brief of the run): entries of the area of this task.
4. The false alarms (`lessons/false-alarms.md`) are never in the list; see the skill `lessons-check`.

## One entry per cause
- Entries with the same cause (the same rule broken on several resources, the same defect found by two phases, the same defect in the registry and in the report) are one entry with all keys: `KEY-1, KEY-2: <sentence>`.
- A defect found in this run and not yet in the registry has no key. Write `new:` and the step or call number as its proof.
- Cap: 5 entries, the most severe first. When more exist, end with `Oraz <n> podobnych: <what they share>.`

## Severity and certainty (in English, in square brackets at the end of the line)
`[<severity>; <certainty>]`

| Severity | When |
| --- | --- |
| critical | money, data loss, legal duty or access across a boundary in a common flow, named in a source |
| high | a main path of the feature gives a wrong result |
| medium | an alternative path or an edge case gives a wrong result |
| low | a cosmetic or rare effect, no wrong business result |
| not assessed | the sources do not say; never guess |

| Certainty | When |
| --- | --- |
| confirmed | the tester confirmed it (lessons) or a retest confirmed it (call number) |
| reported | it is in the registry or the report, with no confirmation in the sources you have |
| suspected | a phase named it as a doubt with no proof |

A severity that you cannot source is `not assessed`. A defect already marked fixed in the registry is written with that status in the sentence, so that the next tester knows to retest it and not to avoid the area.

## Format of an entry
`- <KEY or new>: <one sentence, what goes wrong and when> [<severity>; <certainty>]`

Short sentences, under 35 words. When the registry has nothing for this area, the whole list is the one line `Brak znanych defektów tego obszaru w rejestrze` (the line is never skipped).
