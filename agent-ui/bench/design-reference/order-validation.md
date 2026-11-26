SHOP-10 — Order form validation
Business cases: BC1 customer orders the largest allowed quantity→§1 | BC2 customer types an invalid order→§2 | BC3 customer leaves a long note→§3
Bug patterns: none recorded for the order form
## 1. Customer orders the largest and the smallest allowed quantity [Boundary value analysis]
- POST /orders with quantity=100 => 201 created, GET /orders/{id} shows quantity 100 (src: SHOP-10; ci: BVA:post-orders:quantity:max)
- POST /orders with quantity=101 => 400 rejected, the order list count is unchanged (nothing stored) (src: SHOP-10; ci: BVA:post-orders:quantity:max+1)
- POST /orders with quantity=1 => 201 created, GET shows quantity 1 (src: SHOP-10; ci: BVA:post-orders:quantity:min)
- POST /orders with quantity=0 => 400 rejected, nothing stored (src: SHOP-10; ci: BVA:post-orders:quantity:min-1)
Not covered: nothing
## 2. Customer sends an order that breaks a rule [Equivalence partitioning]
- POST /orders with quantity=1.5 => 400 rejected, nothing stored (src: SHOP-10; ci: EP:post-orders:quantity:non-integer)
- POST /orders without customerId (missing) => 400 rejected, nothing stored (src: SHOP-10; ci: EP:post-orders:customerId:missing)
- POST /orders with currency=GBP (outside the list) => 400 rejected, nothing stored (src: SHOP-10; ci: EP:post-orders:currency:not-in-enum)
- POST /orders with currency=PLN, then EUR, then USD => 201 created each time, GET shows the currency sent (src: SHOP-10; ci: EP:post-orders:currency:enum=PLN, EP:post-orders:currency:enum=EUR, EP:post-orders:currency:enum=USD)
- POST /orders with quantity="abc" => 400 rejected, nothing stored (src: SHOP-10; ci: EP:post-orders:quantity:wrong-type)
Not covered: EP:post-orders:quantity:valid, EP:post-orders:customerId:valid — every accepted order in §1 is the valid partition; EP:post-orders:quantity:below-range, EP:post-orders:quantity:above-range — the boundaries in §1 test the same rule closer; EP:post-orders:quantity:missing, EP:post-orders:quantity:null, EP:post-orders:customerId:null, EP:post-orders:customerId:wrong-type, EP:post-orders:currency:wrong-type, EP:post-orders:currency:missing, EP:post-orders:currency:null — the same required-field check as the missing customer ID
## 3. Customer leaves a long note [Boundary value analysis]
- POST /orders with a note of 50 characters => 201 created, GET shows the note stored exactly as sent (src: SHOP-10; ci: BVA:post-orders:note:len-max)
- POST /orders with a note of 51 characters => 400 rejected, nothing stored (src: SHOP-10; ci: BVA:post-orders:note:len-max+1)
Not covered: nothing
## Summary
Boundaries of quantity and note, invalid orders store nothing | 11 checks
## To confirm
- The requirement gives no error messages, so checks expect a 4xx only.
