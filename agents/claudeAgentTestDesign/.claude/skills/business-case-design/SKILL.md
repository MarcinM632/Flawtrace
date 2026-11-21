---
name: business-case-design
description: Designs the checks of a business case from its business rules, and uses an ISTQB technique to choose variants only when the rule has the shape the technique fits. One skill for partitions, boundaries, decision tables, state transitions and negative checks. Load it in step 4 of CLAUDE.md.
---

# Business case design

Business logic decides what is tested. An ISTQB technique is a tool for choosing variants inside a business case, and it is used only when the business rule has the shape the technique fits. There is no fixed set of techniques to apply to every task, no section that exists because a technique exists, and no variant that exists to make a technique "complete".

## Step 1. Write the rules of each business case
For each case BCn of `WORK_DIR/business-cases.md` write down, from the sources only:
- the situation, the actors and the starting state, on real resources (see "On the test environment" in `spec-checks`);
- the business rules the case touches, each as `if <conditions> then <outcome> (src: ...)`;
- what must be true afterwards: data, state, results, side effects (events, history, what each user sees);
- what a business user would call broken.

A rule that no source states is not designed. It goes to "To confirm".

## Step 2. Name the shape of each rule
Look at how the business states the rule, then take the variants the business needs. A technique is named only in the last column, and only when the shape matches.

| Shape of the rule | The business question | Variants the business needs | Technique that fits |
| --- | --- | --- | --- |
| One condition, one outcome ("a blocked customer cannot order") | does the rule fire, and does nothing else stop the case | the case in which it fires; one case that breaks only this rule | none |
| A limit, a period or a threshold ("up to 3 open orders", "within 30 days") | what happens inside, at and just outside the limit | the values around this limit; the side of the limit follows the wording of the source | equivalence partitions and boundary values, on this limit only |
| Several conditions decide the outcome, with exceptions or priority ("free delivery unless …") | which combination gives which outcome | the combinations that give different outcomes; combinations with the same outcome are merged | decision table |
| The object has a life: status, enable and disable, cooldown, cancel, expiry, repeat | which changes the business allows, which it forbids, what is left behind | the allowed changes in business order; a forbidden change attempted; the same action repeated; the state afterwards | state transitions |
| A calculation: fee, total, interest, limit | is the number right and rounded as the business expects | one worked example from the source; the case where the formula changes branch or the rounding matters | worked example, plus boundaries of the inputs that switch the formula |
| A flow across systems or screens (create, pay, confirm, invoice) | does the whole path end in the right state in every system | the main path, each alternative the sources state, each point where the path can stop | scenario (use case) |
| Permissions: who may do what on whose data | is access given and refused as stated | each role and owner relation the business distinguishes | decision table of role, action and owner |
| Several settings that act together | does the combination change the outcome | only the pairs that a source or a defect history links | pairwise, and only then |
| A defect class from the bug registry or `lessons/` | does the same class repeat in this feature | one check built from the class on this feature, with this feature's values | error guessing |

A rule can have more than one shape (a limit inside a life cycle). Take the variants of each shape that the business case needs, no more.

## Step 3. The fit test
A variant stays in the design only when all three hold:
1. **Source.** The rule and its limit or outcome are written in a source you can cite.
2. **Difference.** The business outcome, or the code path that produces it, differs from the variants already kept. Variants with the same outcome and the same path are merged into one representative.
3. **Reason.** You can say in one sentence why a business person cares: "a customer with exactly 3 open orders; the limit says up to 3".

A variant that fails one of these is dropped. When only the source is missing it goes to "To confirm". The reverse also holds: when the business case needs more than a technique offers (a long set-up, a flow with several systems, data that must exist first), follow the business case and use the technique only for its variants.

## Step 4. Most rules need no technique
A plain rule gets one positive check that really fires it, and one negative check that breaks exactly that rule. Do not name a technique for it and do not add variants. The section tag is `[none]` or the technique that did shape some of the variants.

## Step 5. Negative checks
- A negative check breaks exactly one rule and keeps every other rule valid. The service reports the first violated condition in the order of its code, so a rule broken together with an earlier one is never checked. Set every other constraint valid, and compute the set-up through all the validators of the service (see `expected-result-oracle`).
- A check about permissions or misuse exists only when a rule of the sources distinguishes who may do what. This skill does not design security probing.

## Step 6. Size and priority
The report holds 4 to 8 sections, one per business case or flow element, 3 to 5 checks each, in at most 6500 characters.
1. Spend the room by business impact first (money, data, legal duty, how many customers), then by what the change touched, then by the defect history.
2. Several variants of one rule can be one check with a value list: `limit 3, open orders 2 / 3 / 4 => accepted / accepted / rejected with <message> (src: ...)`. Prefer this to three near-identical checks.
3. What does not fit goes to "Not covered:" of its section with the reason. Growing the report to complete a technique is a defect of the design.

## Step 7. When the Analysis report is in the input
When the input contains the Analysis report (its sections "Test conditions", "Coverage matrix", "Done criteria", "Scope for test design"):
1. Write `WORK_DIR/coverage-input.md`: one line per condition with its id `TC<n>`, priority, requirement and coverage items.
2. Design so that every item of a [high] condition is exercised by some check, or named in "To confirm" with the reason. The techniques chosen by the Analysis are the start; a business case may show a better shape, and then the business case wins and the difference is one line in "To confirm".
3. Write the header line `Coverage: TC1→§1 | TC2→§3 | TC4→To confirm`. Every condition of `coverage-input.md` appears in it.
4. A condition that fits no business case of the design gets a case of its own from its requirement.

## Step 8. Titles
A section title names a business situation: "Customer at the order limit places another order". It never names a technique, a validation or a field ("Boundary values of maxOpenOrders" is the wrong kind of title; the application rejects it). In the brackets after the title write the technique that shaped the variants, or `none`.

## Example
Ticket: a customer may have up to 3 open orders; a cancelled order frees one place.
- BC1 "A customer with 3 open orders places a fourth". Shape: a limit. Variants: open orders 2 / 3 / 4 on this limit, the side taken from the words "up to". Technique: boundary values, one check with a value list. Tag `[boundary values]`.
- BC2 "A customer cancels an order and places a new one". Shape: a life cycle of the order. Variants: cancel then place (allowed), cancel the same order twice (forbidden repeat), the open count afterwards. Tag `[state transitions]`.
- BC3 "The order limit is shown on the customer card". Shape: one condition, one outcome. One positive, one negative. Tag `[none]`.
No section about "validation" or "negative testing" exists, and no technique was applied to BC3.
