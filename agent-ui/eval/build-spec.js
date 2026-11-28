#!/usr/bin/env node
// Writes the OpenAPI documents of the benchmark shop: shop/base/openapi.json and shop/change/openapi.json (adds discount codes).
// The documents describe the CORRECT contract from the tickets; the seeded defects are where the shop breaks it.
//   node eval/build-spec.js
const fs = require('fs');
const path = require('path');

const err = (d) => ({ description: d, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } });
const ok = (d, ref) => ({ description: d, content: { 'application/json': { schema: { $ref: '#/components/schemas/' + ref } } } });
const body = (ref) => ({ required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/' + ref } } } });
const auth = [{ bearer: [] }];

function spec(withDiscounts) {
  const cart = {
    type: 'object', required: ['items', 'subtotal', 'shipping', 'total'],
    properties: {
      items: { type: 'array', items: { $ref: '#/components/schemas/CartLine' } },
      subtotal: { type: 'number', description: 'Sum of the line totals, 2 decimals' },
      shipping: { type: 'number', description: '15.00, or 0 when the subtotal is 200.00 or more' },
      total: { type: 'number', description: withDiscounts ? 'subtotal - discount + shipping' : 'subtotal + shipping' },
    },
  };
  if (withDiscounts) {
    cart.required.push('codes', 'discount');
    cart.properties.codes = { type: 'array', maxItems: 1, items: { type: 'string' }, description: 'The applied code; at most one' };
    cart.properties.discount = { type: 'number', description: 'Taken off the item subtotal only (never the shipping), rounded half up to 2 decimals' };
  }
  const order = { type: 'object', required: ['id', 'items', 'subtotal', 'shipping', 'total', 'status', 'createdAt'], properties: {
    id: { type: 'integer' }, items: { type: 'array', items: { $ref: '#/components/schemas/CartLine' } }, subtotal: { type: 'number' }, shipping: { type: 'number' },
    total: { type: 'number', description: withDiscounts ? 'Equals the cart total at the moment of the order, discount included' : 'subtotal + shipping' },
    status: { type: 'string', enum: ['placed'] }, createdAt: { type: 'string', format: 'date-time' } } };
  if (withDiscounts) { order.properties.discount = { type: 'number' }; order.properties.code = { type: 'string', nullable: true }; }

  const paths = {
    '/api/products': { get: { operationId: 'searchProducts', summary: 'Search the catalogue', tags: ['catalogue'], parameters: [
      { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Part of the product name, case-insensitive. Shorter than 2 characters: ignored (all products).' },
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
      { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 } }],
      responses: { 200: ok('One page of matches, sorted by name A to Z (case-insensitive)', 'ProductPage'), 400: err('page or pageSize out of range') } } },
    '/api/products/{id}': { get: { operationId: 'getProduct', summary: 'One product', tags: ['catalogue'], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      responses: { 200: ok('The product', 'Product'), 404: err('No such product') } } },
    '/api/auth/register': { post: { operationId: 'register', summary: 'Create an account', tags: ['auth'], requestBody: body('RegisterRequest'),
      responses: { 201: ok('The account (never the password or its hash)', 'User'), 400: err('Invalid email, password or name'), 409: err('The email is already registered (case-insensitive)') } } },
    '/api/auth/login': { post: { operationId: 'login', summary: 'Sign in', tags: ['auth'], requestBody: body('LoginRequest'),
      responses: { 200: ok('Signed in', 'LoginResponse'), 401: err('"Invalid email or password", for a wrong password and for an unknown email alike'), 423: err('Locked after 5 failed attempts') } } },
    '/api/cart': { get: { operationId: 'getCart', summary: 'The cart of the signed-in customer', tags: ['cart'], security: auth, responses: { 200: ok('The cart', 'Cart'), 401: err('Not signed in') } } },
    '/api/cart/items': { post: { operationId: 'addToCart', summary: 'Add a product to the cart', tags: ['cart'], security: auth, requestBody: body('CartItemRequest'),
      responses: { 200: ok('The cart', 'Cart'), 400: err('quantity out of 1..99'), 401: err('Not signed in'), 404: err('No such product') } } },
    '/api/cart/items/{productId}': { delete: { operationId: 'removeFromCart', summary: 'Remove a product from the cart', tags: ['cart'], security: auth,
      parameters: [{ name: 'productId', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: ok('The cart', 'Cart'), 401: err('Not signed in'), 404: err('Not in the cart') } } },
    '/api/orders': { post: { operationId: 'placeOrder', summary: 'Place an order from the cart (empties the cart)', tags: ['orders'], security: auth,
      responses: { 201: ok('The order', 'Order'), 400: err('The cart is empty'), 401: err('Not signed in') } } },
    '/api/orders/{id}': { get: { operationId: 'getOrder', summary: 'One order of the signed-in customer', tags: ['orders'], security: auth,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { 200: ok('The order', 'Order'), 401: err('Not signed in'), 404: err('No such order of this customer') } } },
  };
  if (withDiscounts) paths['/api/cart/discount'] = { post: { operationId: 'applyDiscountCode', summary: 'Apply a discount code to the cart (replaces an applied one)', tags: ['cart'], security: auth, requestBody: body('DiscountRequest'),
    responses: { 200: ok('The cart with the discount', 'Cart'), 401: err('Not signed in'), 404: err('"Unknown code"'), 422: err('"Code expired" or "Order too small for this code"') } } };

  const schemas = {
    Error: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
    Product: { type: 'object', required: ['id', 'name', 'price', 'stock'], properties: { id: { type: 'integer' }, name: { type: 'string' }, price: { type: 'number' }, stock: { type: 'integer' } } },
    ProductPage: { type: 'object', required: ['items', 'total', 'page', 'pageSize'], properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Product' } },
      total: { type: 'integer', description: 'Number of products that match q' }, page: { type: 'integer' }, pageSize: { type: 'integer' } } },
    RegisterRequest: { type: 'object', required: ['email', 'password', 'name'], properties: { email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 8, description: 'At least 8 characters and at least one digit' }, name: { type: 'string', minLength: 1 } } },
    User: { type: 'object', additionalProperties: false, required: ['id', 'email', 'name', 'createdAt'], properties: { id: { type: 'integer' },
      email: { type: 'string', description: 'Saved in lower case' }, name: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } } },
    LoginRequest: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } },
    LoginResponse: { type: 'object', required: ['token', 'expiresIn', 'user'], properties: { token: { type: 'string' }, expiresIn: { type: 'integer', description: 'Seconds, 3600' },
      user: { type: 'object', properties: { id: { type: 'integer' }, email: { type: 'string' }, name: { type: 'string' } } } } },
    CartItemRequest: { type: 'object', required: ['productId', 'quantity'], properties: { productId: { type: 'integer' }, quantity: { type: 'integer', minimum: 1, maximum: 99 } } },
    CartLine: { type: 'object', properties: { productId: { type: 'integer' }, name: { type: 'string' }, price: { type: 'number' }, quantity: { type: 'integer' }, lineTotal: { type: 'number' } } },
    Cart: cart,
    Order: order,
  };
  if (withDiscounts) schemas.DiscountRequest = { type: 'object', required: ['code'], properties: { code: { type: 'string', description: 'Case-insensitive' } } };

  return { openapi: '3.0.3', info: { title: 'Shop API', version: withDiscounts ? '1.1.0' : '1.0.0' }, servers: [{ url: '/' }], paths,
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } }, schemas } };
}

const here = path.join(__dirname, 'shop');
fs.writeFileSync(path.join(here, 'base', 'openapi.json'), JSON.stringify(spec(false), null, 2) + '\n');
fs.writeFileSync(path.join(here, 'change', 'openapi.json'), JSON.stringify(spec(true), null, 2) + '\n');
console.log('Wrote shop/base/openapi.json and shop/change/openapi.json');
