// In-memory data of the shop. Everything is lost on restart, which is what a test environment wants.
const crypto = require('crypto');

const hash = (password) => crypto.createHash('sha256').update('shop-salt:' + password).digest('hex');

const PRODUCTS = [
  ['Ceramic mug white', 24.9], ['Ceramic mug black', 24.9], ['Travel mug steel', 59], ['Espresso cup set', 79.99],
  ['Tea mug with lid', 34.5], ['Mug warmer', 89], ['Desk lamp', 129.99], ['Notebook A5 dotted', 12.5],
  ['Notebook A4 lined', 18], ['Fountain pen', 149], ['Pencil set', 22], ['Backpack 20 l', 199],
  ['Water bottle 0.7 l', 45], ['Lunch box', 39.9], ['Kitchen scale', 99], ['Coffee grinder', 219],
  ['Pour-over kettle', 179], ['eco bag', 9.99], ['Zebra notebook', 15], ['Mug coaster set', 19.9],
  ['Thermal mug 0.5 l', 69], ['Glass mug double wall', 49.9], ['Apron', 54],
];

function fresh() {
  return {
    products: PRODUCTS.map(([name, price], i) => ({ id: i + 1, name, price, stock: 25 })),
    users: [{ id: 1, email: 'demo@shop.test', name: 'Demo Customer', passwordHash: hash('Demo12345'), createdAt: '2026-01-05T09:00:00.000Z', failed: 0 }],
    tokens: new Map(),
    carts: new Map(),
    orders: [],
    seq: { user: 1, order: 0 },
  };
}

const db = fresh();
module.exports = { db, hash };
