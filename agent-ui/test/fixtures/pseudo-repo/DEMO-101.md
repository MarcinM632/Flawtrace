DEMO-101: Limit on open orders per customer

Backend (billing-svc), branch feature/DEMO-101-max-open-orders.

Description
A limit rule gets a new field maxOpenOrders. A customer may have at most maxOpenOrders open orders.
A new order is rejected when the customer already has maxOpenOrders open orders or more.

Acceptance criteria
- maxOpenOrders is 1..1000, default 5.
- PUT /limits saves it and GET /limits/{customerId} returns it.
- GET /limits/check rejects the order with reason "too many open orders" when openOrders >= maxOpenOrders.
- Existing rules keep working after the migration.
- The limit.changed event carries the new field.
- Exposure checks work as before.

Comment (dev): while here I tidied the event field names and the default period.
