SHOP-11 — Discount for premium customers
Business cases: BC1 premium customer at exactly 100 PLN→§1 | BC2 regular customer at 100 PLN→§1 | BC3 regular customer below 100 PLN→To confirm
Bug patterns: none recorded for discounts
## 1. The discount follows the customer type and the total [Decision table]
- POST /discounts/quote premium=true, total=100 => discount 10% (src: SHOP-11; ci: DT:discount:1)
- POST /discounts/quote premium=true, total=99.99 => discount 5% (src: SHOP-11; ci: DT:discount:2)
- POST /discounts/quote regular customer (premium=false), total=100 => discount 5% (src: SHOP-11; ci: DT:discount:3)
Not covered: DT:discount:4 — no rule in SHOP-11, see To confirm
## Summary
Three stated rules on their boundary at 100 PLN | 3 checks
## To confirm
- DT:discount:4: what does a regular customer below 100 PLN get? SHOP-11 does not say (no discount, or something else?).
