---
name: technique-coverage
description: How to get the coverage items of the ISTQB test techniques (equivalence partitions, boundary values, decision tables, state transitions, pairwise) computed by the application, tie every technique check to one of them with "ci:", and report gaps in the rules. Load it in step 4 of CLAUDE.md, after business-case-design and before you write the first check of a point that names a technique.
---

# Technique coverage computed by the application

You decide WHERE a technique fits (business-case-design: the business rule has the shape of the technique). You do not decide WHICH values or columns it needs. The application computes them, the same every time, from the API specification and from the rule models you write down. It then measures the coverage of the design from your report. A point that names a technique and covers only some of its items is reported back to you.

## 1. Write down the rules as models (with their source)
When a business rule has the shape of a technique, write it as a model. Take every value from a source and put the source in `src`.
- Decision table (a result depends on a combination of conditions):
  `{"kind":"decision-table","id":"discount","src":"PRJ-12","conditions":[{"name":"premium"},{"name":"total","threshold":100,"op":">="}],"rules":[{"when":{"premium":true,"total":true},"then":{"discount":10}}]}`
  A condition with `threshold` gets its input exactly on the threshold (true) and right next to it (false). The table then also checks the boundary of the condition (`>=` against `>`).
  Use `"-"` for "does not matter". List impossible combinations in `infeasible`.
- State machine (an object moves through statuses):
  `{"kind":"state-machine","id":"order","src":"conf:Order life cycle","initial":"created","transitions":[{"from":"created","event":"pay","to":"paid"}]}`
- Pairwise (several independent options that combine):
  `{"kind":"pairwise","id":"quote","src":"PRJ-12","parameters":{"shipping":["standard","express"],"country":["PL","DE"]}}`
  Or `{"kind":"pairwise","id":"quote","endpoint":"POST /quotes","fields":["shipping","country"]}`, which takes the values from the enums of the specification.

- UI form (fields with limits on a screen):
  `{"kind":"form","id":"order","src":"web/src/OrderForm.tsx:12","html":"<input name=\"qty\" type=\"number\" min=\"1\" max=\"100\" required>…"}`
  Copy the code of the form from the frontend repository (HTML or JSX). The application reads `required`, `min`/`max`/`step`, `minlength`/`maxlength`, `pattern`, the input type and the `<select>` options. It then gives EP/BVA items like `BVA:form-order:qty:max+1`. In the UI, "rejected" means a validation message, the form is not submitted and nothing is saved.

Add `"quote"`: the sentence of the source that states the rule, copied word for word. The application checks the model against its source:
- every threshold, rule result, state name and parameter value must appear in the quote, or in the source when there is no quote;
- the quote must appear in the source word for word, when the application has the text of that source.

A value the source does not state (you assumed "no discount" for the last column) is a gap. Put it in "To confirm" instead of the model.

Save all models with Write to `WORK_DIR/technique-models.json` (a JSON array). The application measures coverage from this file. A model that is only in your head is not measured.

## 2. Get the items
Call `mcp__sources__test_design_items` with the endpoints the point tests (`["POST /orders"]`) and the same models. For every field with constraints in the specification it returns the equivalence partitions (EP) and the boundary values (BVA). For every model it returns the columns, the transitions or the rows. Each item has:
- an id, for example `BVA:post-orders:quantity:max+1`, `DT:discount:3`, `ST:order:paid+ship`, `PW:quote:2`,
- the input,
- the expected outcome,
- the oracle (where the expected outcome comes from).

## 3. One check per item, cited with "ci:"
Every check of a technique names the item it tests at the end of its source:
`- POST /orders with quantity=101 => 422, error "quantity must be ≤ 100", GET /orders shows no new order (src: PRJ-12; ci: BVA:post-orders:quantity:max+1)`
- The expected result follows the oracle of the item. When the item says "rejected", the check expects a rejection and states that nothing was stored. When it says "discount = 10", the check states 10.
- A check may cite several items when one action really tests them all.
- When you think the oracle is wrong (the specification says 100, the ticket says 50), the check follows the requirement. Put the difference with both sources in "To confirm".

## 4. Everything required is covered or excused
A technique named in the point means every REQUIRED item of that target is tested: all partitions of the field, all boundary values, all columns of the table, all valid transitions, all pairwise rows.
- An item you do not test goes into the point's `Not covered:` line with its id and a reason (`Not covered: BVA:post-orders:quantity:min — the same path as max, covered by §2`).
- Invalid transitions are optional items. Test those that matter to the business.
- Do not add a technique to a point only to fill it. "Business first" still decides where a technique belongs.

## 5. Gaps in the rules are defects of the requirement
The tool lists problems in the models, for example:
- a column that no rule covers,
- rules that contradict each other,
- a state that cannot be reached.

Each one is a question for the owner of the requirement. It goes into "To confirm" with the item id (`DT:discount:4`) or the state name. Never invent the result of a column that no rule covers.
