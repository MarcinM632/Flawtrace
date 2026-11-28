# Benchmark of the testing flow

A small web shop with **29 seeded defects** and **5 traps** (correct behaviour that looks suspicious), three tickets and a scorer. It answers one question: how many real defects does Full tests find, and how many false alarms does it raise?

| Ticket | Feature | Phases | Seeded defects |
| --- | --- | --- | --- |
| BENCH-1 | Registration and sign-in | static, design, API, UI | R1-R7, S1-S3 |
| BENCH-2 | Search and pagination | static, design, API, UI | P1-P7, S4-S5 |
| BENCH-3 | Discount codes (change on `feature/BENCH-3-discount-codes`) | static, whitebox, design, API, UI | W1-W7, U1, S6-S7 |

- `shop/base` is branch `develop`; `shop/change` is laid over it on the feature branch. The running shop is the feature branch.
- `tickets/` are the task texts. The S-defects are in the tickets themselves (contradictions, untestable or missing rules).
- `expected.js` lists every defect, the phase that should find it and the patterns a finding must match. The traps are listed there too.
- `history.jsonl` has one line per live run: recall, false alarms, per phase, cost, time, commit.

## Run it

```
npm run eval -- --dry              # check the setup only, no tokens
npm run eval                       # all three tickets, one after another (real agents, real tokens)
npm run eval -- --parallel         # the same, at the same time
npm run eval -- --only BENCH-2     # one ticket
npm run eval -- --score eval/results/<stamp>   # score saved reports again (after a change of expected.js or the scorer)
```

The run uses its own Flawtrace instance with a temporary data folder: your sources, lessons and product knowledge are neither used nor changed. Reports of every phase are saved in `eval/results/<stamp>/` (not in git).

## Keeping it honest

`test/eval.test.js` (part of `npm test`) starts the shop and proves that every seeded defect is really there and every trap really behaves as its ticket says. It also checks that the scorer tells a good report from a shallow one. When you change the shop, a ticket or a pattern, that test must stay green.

Do not tune prompts to the exact wording of these tickets. The benchmark measures the method, so a change that helps only here is a regression.
