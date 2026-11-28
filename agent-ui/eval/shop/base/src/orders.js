// Orders are placed from the cart.
const { db } = require('./store');
const cart = require('./cart');
const config = require('./config');

function place(user) {
  const c = cart.cartOf(user);
  if (!c.items.length) return { status: 400, body: { error: 'The cart is empty' } };
  const v = cart.view(user);
  const shipping = v.subtotal >= config.FREE_SHIPPING_FROM ? 0 : config.SHIPPING_FEE;
  const order = { id: ++db.seq.order, userId: user.id, items: v.items, subtotal: v.subtotal, shipping, total: cart.r2(v.subtotal + shipping), status: 'placed', createdAt: new Date().toISOString() };
  db.orders.push(order);
  c.items = [];
  return { status: 201, body: order };
}

function get(user, id) {
  const o = db.orders.find((x) => String(x.id) === String(id) && x.userId === user.id);
  return o ? { status: 200, body: o } : { status: 404, body: { error: 'Order not found' } };
}

module.exports = { place, get };
