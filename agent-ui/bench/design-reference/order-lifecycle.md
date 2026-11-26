SHOP-12 — Order life cycle
Business cases: BC1 order goes the whole way to the customer→§1 | BC2 customer changes their mind→§2 | BC3 refund after cancelling a paid order→To confirm
Bug patterns: none recorded for orders
## 1. Order goes from created to delivered [State transition]
- create an order, then POST /orders/{id}/pay => 200, GET shows state paid (src: SHOP-12; ci: ST:order:created+pay)
- for a paid order POST /orders/{id}/ship => 200, GET shows state shipped (src: SHOP-12; ci: ST:order:paid+ship)
- for a shipped order POST /orders/{id}/deliver => 200, GET shows state delivered (src: SHOP-12; ci: ST:order:shipped+deliver)
Not covered: nothing
## 2. Customer cancels the order [State transition]
- for a created order POST /orders/{id}/cancel => 200, state cancelled (src: SHOP-12; ci: ST:order:created+cancel)
- for a paid order POST /orders/{id}/cancel => 200, GET shows state cancelled (src: SHOP-12; ci: ST:order:paid+cancel)
- for a shipped order POST /orders/{id}/cancel => 409 refused, GET shows the state unchanged (shipped) (src: SHOP-12; ci: ST:order:shipped+cancel)
Not covered: nothing
## Summary
Whole life cycle and cancelling before and after shipping | 6 checks
## To confirm
- Is the payment refunded when a paid order is cancelled, and how much? SHOP-12 does not say.
