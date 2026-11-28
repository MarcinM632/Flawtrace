// The cart of the signed-in customer.
const { db } = require('./store');
const config = require('./config');

const r2 = (x) => Math.round(x * 100) / 100;
const cartOf = (user) => { if (!db.carts.has(user.id)) db.carts.set(user.id, { items: [] }); return db.carts.get(user.id); };

function view(user) {
  const cart = cartOf(user);
  const items = cart.items.map((i) => { const p = db.products.find((x) => x.id === i.productId); return { productId: p.id, name: p.name, price: p.price, quantity: i.quantity, lineTotal: r2(p.price * i.quantity) }; });
  const subtotal = r2(items.reduce((s, i) => s + i.lineTotal, 0));
  const shipping = !items.length || subtotal >= config.FREE_SHIPPING_FROM ? 0 : config.SHIPPING_FEE;
  return { items, subtotal, shipping, total: r2(subtotal + shipping) };
}

function addItem(user, b) {
  const { productId, quantity } = b || {};
  const p = db.products.find((x) => x.id === productId);
  if (!p) return { status: 404, body: { error: 'Product not found' } };
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return { status: 400, body: { error: 'quantity must be a whole number from 1 to 99' } };
  const cart = cartOf(user);
  const line = cart.items.find((i) => i.productId === productId);
  if (line) line.quantity = Math.min(99, line.quantity + quantity); else cart.items.push({ productId, quantity });
  return { status: 200, body: view(user) };
}

function removeItem(user, productId) {
  const cart = cartOf(user);
  const before = cart.items.length;
  cart.items = cart.items.filter((i) => String(i.productId) !== String(productId));
  if (cart.items.length === before) return { status: 404, body: { error: 'This product is not in the cart' } };
  return { status: 200, body: view(user) };
}

module.exports = { view, addItem, removeItem, cartOf, r2 };
