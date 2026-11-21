---
name: mapping-check
description: Field by field mapping check across layers (database, entity, DTO, API contract, UI, events, other consumers). Load it in step 5 whenever a field, enum value, type, name or default changes. Writes WORK_DIR/mapping.md.
---

# Mapping check

Most integration defects are one field that one layer forgot, renamed, retyped or reads under the old name. Check the whole chain for every changed field, not only the layer in the diff.

## Which elements
Every field, column, enum value, status, config key, event field, error code and default that the change adds, removes, renames, retypes or gives a new meaning. Take the list from `map.md` (changed symbols).

## Layers to cover
Database column and migration → entity or model → domain object → DTO or request/response → serializer and deserializer → API contract (`mcp__sources__api_endpoints`, OpenAPI) → event or message payload → other services that consume it → UI form, table and filter → export, report, search index, cache key → test data and fixtures. Skip a layer only when it does not exist in this product, and say so.

## Procedure
1. **Find every spelling.** Search each element in all connected repositories with `qa-git.sh refs` and Grep: camelCase, snake_case, UPPER_CASE, kebab-case, the display label, the translated label.
2. **One row per element and layer.** Record name, type, nullability, unit or scale, allowed values, default, where it is read and where it is written, with `file:line`.
3. **Compare neighbours.** Check these classes explicitly:
   - name differs between layers, or one layer still uses the old name;
   - type or format differs (number vs string, date format, decimal scale, time zone, boolean vs enum);
   - nullability differs (nullable in the API, NOT NULL in the database; old rows without the value);
   - enum values differ in spelling, number or meaning; a new value is unknown to a consumer;
   - a copy function drops the field: mapper, builder, copy constructor, clone, `toEntity`, `toDto`, PATCH or partial update that overwrites unspecified fields with null;
   - read path and write path map the field differently;
   - default differs between layers or between new and old records;
   - a list, filter, sort, export or report that should include the field does not;
   - a label or status text in the UI that does not match the status used in the sources.
4. **Direction.** Check both directions: what the changed code sends and the receiver accepts, and what it receives and the sender really sends.
5. **Contract.** A field in the code but not in the API contract, or the reverse, is a finding.

## Output: WORK_DIR/mapping.md
`| element | layer | name | type, null, unit | values, default | read at (file:line) | written at (file:line) | result: OK / MISMATCH / MISSING |`

Every `MISMATCH` and `MISSING` row is a candidate finding for step 7 of CLAUDE.md. The header field `maps:` of the report is the number of rows. When nothing mappable changed, write one line saying so and why, and put `maps: 0`.

## Rules
- A mapping is checked at both ends with `file:line`. A guess from the name is not a check.
- A consumer you could not read goes to "Do sprawdzenia ręcznie" with the reason, never to `OK`.
