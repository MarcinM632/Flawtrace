SHOP-13 — Shipping quote
Business cases: BC1 customer checks every way to ship→§1 | BC2 customer sends an unknown option→§2
Bug patterns: none recorded for shipping
## 1. Every combination of method, country and payment has a price [Pairwise]
- POST /shipping/quote method=express, country=CZ, payment=blik => 200, a price is returned (src: SHOP-13; ci: PW:shipping:8)
- POST /shipping/quote for each other pairwise row (method, country and payment as listed by the items) => 200, a price is returned for every row (src: SHOP-13; ci: PW:shipping:1, PW:shipping:2, PW:shipping:3, PW:shipping:4, PW:shipping:5, PW:shipping:6, PW:shipping:7, PW:shipping:9, PW:shipping:10)
Not covered: nothing
## 2. Customer sends an option outside the lists [Equivalence partitioning]
- POST /shipping/quote with method=drone (not on the list) => 400 rejected (src: SHOP-13; ci: EP:post-shipping-quote:method:not-in-enum)
Not covered: EP:post-shipping-quote:method:enum=standard, EP:post-shipping-quote:method:enum=express, EP:post-shipping-quote:method:enum=pickup — every method is in the pairwise rows of §1; EP:post-shipping-quote:method:wrong-type, EP:post-shipping-quote:method:missing, EP:post-shipping-quote:method:null — SHOP-13 says nothing about malformed requests beyond the lists
## Summary
Pairwise over three options, unknown option rejected | 3 checks
## To confirm
- Which price table applies? SHOP-13 does not state the prices, so checks expect only that a price is returned.
