---
name: missing-handling
description: Completeness of the change against the requirements and against sibling features. Finds functionality that is not implemented, only partly implemented or not handled in every place. Load it after map.md in step 3. Writes WORK_DIR/trace.md.
---

# Missing handling

A diff can be correct line by line and still miss part of the task. This skill checks what is absent.

## Procedure
1. **Requirements.** Split the task into atomic requirements R1…Rn from the ticket, every subtask, every comment (a later comment can cancel the description) and the newest Confluence page. Quote each briefly with `(src: ...)`.
2. **Trace each requirement** to the code in `kod-po` with `file:line` and one of:
   - `IMPLEMENTED` (the whole path entry → output exists and does what the requirement says),
   - `PARTIAL` (say which part is missing),
   - `NOT IMPLEMENTED`,
   - `CANNOT TELL` (the source is unclear; it becomes a question in "Do sprawdzenia ręcznie").
3. **Unrequested changes.** List code in the diff that no requirement explains. Each is a risk (see step 6 of CLAUDE.md).
4. **Every place that must know the new thing.** For each new or changed enum value, type, status, role, flag, event, endpoint or column, list all the places that branch on this kind of thing: `switch` and `when`, if-chains, maps and registries, database constraints, validators, permission checks, UI lists and labels, documentation of the API. Mark the places that do not handle the new value or have no default branch.
5. **Failure and absence.** For every input and every external call in the changed code, answer: what happens on failure, timeout, empty result, denied access, duplicate, partial success? A path with no answer is `UNHANDLED`.
6. **Lifecycle.** For the changed object check create, update, delete, disable and enable, restore, copy, migrate old data, repeat. A step the feature needs and does not handle is `UNHANDLED`.
7. **Sibling feature.** Find the closest existing feature of the same kind (Grep for the same pattern: another rule type, another list, another integration). List what it handles: validation, permissions, audit log, notification, cache invalidation, metrics, cleanup, export, translation. Mark what the new feature lacks. A difference without a reason in the sources is a candidate finding.

## Output: WORK_DIR/trace.md
Three tables:
- requirements: `| R | requirement (src: ...) | status | code (file:line) | what is missing |`
- places and paths (steps 4 to 6): `| element | place or path | handled / UNHANDLED | file:line |`
- sibling feature (step 7): `| sibling (file) | handles | new feature | difference |`

The header field `reqs:` of the report is `<IMPLEMENTED>/<total>` of the requirements. When the task has no stated requirements (no ticket, no text), write `reqs: 0/0` and say in trace.md what you used instead.

## Rules
- "Not found" means you searched: Grep the symbol, the spelling variants and the synonyms from the glossary before you write `NOT IMPLEMENTED`.
- A missing requirement is a finding even when no line of the diff is wrong. Its evidence is the requirement `(src: ...)` and the `file:line` where the code ends without doing it.
