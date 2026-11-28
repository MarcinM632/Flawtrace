BENCH-3: Discount codes in the cart

Repository: shop, branch feature/BENCH-3-discount-codes (against develop). API: POST /api/cart/discount, GET /api/cart, POST /api/orders. Page: #/cart.

Description
A signed-in customer can enter a discount code in the cart. The discount is shown in the cart and kept on the order.

Codes
- SAVE10: 10% off, needs an item subtotal of at least 100.00. Valid until 2026-12-31.
- FIXED20: 20.00 off, needs an item subtotal of at least 150.00. Valid until 2026-12-31.
- WINTER15: 15% off, no minimum. Valid until 2026-12-31.
- OLD5: 5% off, expired on 2025-12-31.

Acceptance criteria
- Codes are case-insensitive: "save10" works like "SAVE10".
- A code is valid through its last day (SAVE10 still works on 2026-12-31).
- The discount is taken off the item subtotal only, never off the shipping. The amount is rounded half up to 2 decimals (10% of 129.99 is 13.00).
- Only one code per cart: applying a second code replaces the first, the discounts never add up.
- An unknown code returns 404 "Unknown code". An expired code returns 422 "Code expired". A subtotal below the minimum returns 422 "Order too small for this code". Exactly 100.00 is enough for SAVE10.
- The cart shows subtotal, discount, shipping and total = subtotal - discount + shipping. Shipping is 15.00 and is free from an item subtotal of 200.00 (the free-shipping rule does not change with this ticket).
- The order placed from the cart has the same total as the cart, discount included, and keeps the applied code.
- On the cart page, a valid code shows "Code applied: <CODE>"; an invalid code shows the error message from the server and no discount.

Comment (dev): codes must be typed exactly as printed on the voucher.

Test account: demo@shop.test / Demo12345.
