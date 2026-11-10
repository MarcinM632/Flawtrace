// The application model the agents read when only the API is connected.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseSpec } = require('../lib/openapi');
const model = require('../lib/app-model');

const op = (id, extra = {}) => ({ operationId: id, ...extra });
const body = (props) => ({ requestBody: { content: { 'application/json': { schema: { type: 'object', properties: props } } } } });
const spec = {
  openapi: '3.0.0', info: { title: 'Shop' },
  paths: {
    '/orders': { get: op('listOrders'), post: op('createOrder', body({ customerId: { type: 'integer' }, item: { type: 'string' } })) },
    '/orders/{orderId}': { get: op('getOrder'), patch: op('updateOrder'), delete: op('deleteOrder') },
    '/orders/{orderId}/cancel': { post: op('cancelOrder') },
    '/orders/{orderId}/items': { get: op('listItems'), post: op('addItem') },
    '/customers': { get: op('listCustomers'), post: op('createCustomer') },
    '/customers/{id}': { get: op('getCustomer') },
  },
};

test('app model: resources, dependencies, the order to create data in and a life-cycle flow', () => {
  const m = model.build(parseSpec(spec, 'shop').endpoints);
  const by = Object.fromEntries(m.resources.map((r) => [r.path, r]));
  assert.deepEqual(Object.keys(by).sort(), ['/customers', '/orders', '/orders/{orderId}/items']);
  // customerId in the body of create_order makes customers come first.
  assert.deepEqual(by['/orders'].needs, ['/customers']);
  assert.ok(m.order.indexOf('/customers') < m.order.indexOf('/orders'));
  assert.ok(m.order.indexOf('/orders') < m.order.indexOf('/orders/{orderId}/items'));
  assert.deepEqual(by['/orders/{orderId}/items'].needs, ['/orders']);
  // cancel has no GET of its own, so it is an action of /orders; items has one, so it is a collection.
  assert.deepEqual(by['/orders'].flow.map((f) => f.step), ['create', 'read', 'list', 'update', 'action', 'delete']);
  assert.equal(by['/orders'].flow.find((f) => f.step === 'action').endpoint, 'cancel_order');
  const md = model.markdown(m, 'Shop');
  assert.match(md, /## Order to create test data in\n\n1\. \/customers/);
  assert.match(md, /needs first: \/customers \(customerId in create_order\)/);
});
