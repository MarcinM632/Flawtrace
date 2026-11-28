BENCH-2: Product search and pagination

Repository: shop (branch develop). API: GET /api/products. Page: #/ (catalogue).

Description
Customers search the catalogue by product name and page through the results.
The results are sorted by popularity by default. Search should feel instant.

Acceptance criteria
- q matches any part of the product name and ignores letter case ("MUG" finds "Ceramic mug white").
- A q shorter than 2 characters is ignored: all products are listed.
- pageSize is 10 by default and at most 50; a larger or smaller value returns 400. page starts at 1; page 0 returns 400.
- total is the number of products that match q (not the size of the whole catalogue).
- Results are sorted by name from A to Z, ignoring letter case.
- On the page, prices are shown with two decimals and the currency, for example "12.50 PLN".
- When nothing matches, the page shows "No products found".
- The pager shows "Page X of Y"; "Previous" is disabled on the first page and "Next" is disabled on the last page.
