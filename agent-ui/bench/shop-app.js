// Cel benchmarku testów funkcjonalnych: mały sklep (zamówienia, rabaty, wycena wysyłki, cykl życia zamówienia)
// ze ZNANYMI, celowo wszczepionymi błędami funkcjonalnymi. Każdy błąd ma identyfikator i listę elementów pokrycia,
// które powinny go wykryć (GROUND_TRUTH). Ten sam serwer w trybie { bugs: false } jest poprawny — każdy alarm na nim
// to fałszywy alarm silnika. Tylko 127.0.0.1, tylko dane w pamięci. Wymagania (to, z czego agent wypisałby modele):
//  SHOP-10 zamówienie: customerId 1–20 znaków (wymagane), quantity całkowite 1–100 (wymagane), currency PLN/EUR/USD
//          (wymagane), note do 50 znaków, express tak/nie.
//  SHOP-11 rabat: premium i suma ≥ 100 → 10%; premium i < 100 → 5%; nie-premium i ≥ 100 → 5%; nie-premium i < 100 → 0%.
//  SHOP-12 cykl życia: created –pay→ paid –ship→ shipped –deliver→ delivered; created/paid –cancel→ cancelled.
//  SHOP-13 wycena wysyłki: każda kombinacja metody (standard/express/pickup), kraju (PL/DE/CZ) i płatności
//          (card/blik/transfer) ma cenę.
const http = require('http');

const SPEC = {
  openapi: '3.0.0',
  info: { title: 'Bench shop', version: '1.0.0' },
  paths: {
    '/orders': {
      get: { operationId: 'listOrders', responses: { 200: { description: 'orders' } } },
      post: {
        operationId: 'createOrder',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/OrderIn' } } } },
        responses: { 201: { description: 'created' }, 400: { description: 'invalid' } },
      },
    },
    '/orders/{id}': { get: { operationId: 'getOrder', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'order' } } } },
    '/orders/{id}/{event}': {
      post: {
        operationId: 'orderEvent',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'event', in: 'path', required: true, schema: { type: 'string', enum: ['pay', 'ship', 'deliver', 'cancel'] } }],
        responses: { 200: { description: 'moved' }, 409: { description: 'not allowed in this state' } },
      },
    },
    '/discounts/quote': {
      post: {
        operationId: 'discountQuote',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['premium', 'total'], properties: { premium: { type: 'boolean' }, total: { type: 'number', minimum: 0, multipleOf: 0.01 } } } } } },
        responses: { 200: { description: 'discount in percent' } },
      },
    },
    '/shipping/quote': {
      post: {
        operationId: 'shippingQuote',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['method', 'country', 'payment'], properties: {
          method: { type: 'string', enum: ['standard', 'express', 'pickup'] }, country: { type: 'string', enum: ['PL', 'DE', 'CZ'] }, payment: { type: 'string', enum: ['card', 'blik', 'transfer'] } } } } } },
        responses: { 200: { description: 'price' } },
      },
    },
  },
  components: {
    schemas: {
      OrderIn: {
        type: 'object', required: ['customerId', 'quantity', 'currency'],
        properties: {
          customerId: { type: 'string', minLength: 1, maxLength: 20 },
          quantity: { type: 'integer', minimum: 1, maximum: 100 },
          currency: { type: 'string', enum: ['PLN', 'EUR', 'USD'] },
          note: { type: 'string', maxLength: 50 },
          express: { type: 'boolean' },
        },
      },
    },
  },
};

// Modele reguł, które agent wypisałby z ticketów SHOP-11/12/13 (to wejście silnika technik, nie odpowiedzi).
const MODELS = [
  { kind: 'decision-table', id: 'discount', src: 'SHOP-11', conditions: [{ name: 'premium' }, { name: 'total', threshold: 100, op: '>=', step: 0.01 }],
    rules: [{ when: { premium: true, total: true }, then: { discount: 10 } }, { when: { premium: true, total: false }, then: { discount: 5 } },
      { when: { premium: false, total: true }, then: { discount: 5 } }, { when: { premium: false, total: false }, then: { discount: 0 } }] },
  { kind: 'state-machine', id: 'order', src: 'SHOP-12', initial: 'created', transitions: [
    { from: 'created', event: 'pay', to: 'paid' }, { from: 'paid', event: 'ship', to: 'shipped' }, { from: 'shipped', event: 'deliver', to: 'delivered' },
    { from: 'created', event: 'cancel', to: 'cancelled' }, { from: 'paid', event: 'cancel', to: 'cancelled' }] },
  { kind: 'pairwise', id: 'shipping', src: 'SHOP-13', endpoint: 'POST /shipping/quote', fields: ['method', 'country', 'payment'] },
];

// Wszczepione błędy i elementy pokrycia, których porażka znaczy "wykryty". `needs` mówi, czego wymaga wykrycie.
const GROUND_TRUTH = [
  { id: 'B1', title: 'quantity 101 accepted (upper bound off by one)', detectedBy: ['BVA:post-orders:quantity:max+1'], technique: 'BVA' },
  { id: 'B2', title: 'quantity 0 accepted (lower bound off by one)', detectedBy: ['BVA:post-orders:quantity:min-1'], technique: 'BVA' },
  { id: 'B3', title: 'note of 51 characters accepted (length bound off by one)', detectedBy: ['BVA:post-orders:note:len-max+1'], technique: 'BVA' },
  { id: 'B4', title: 'currency outside the list accepted', detectedBy: ['EP:post-orders:currency:not-in-enum'], technique: 'EP' },
  { id: 'B5', title: 'missing customerId accepted (required not enforced)', detectedBy: ['EP:post-orders:customerId:missing'], technique: 'EP' },
  { id: 'B6', title: 'fractional quantity 1.5 accepted', detectedBy: ['EP:post-orders:quantity:non-integer'], technique: 'EP' },
  { id: 'B7', title: 'note of 50 characters accepted but stored cut to 40', detectedBy: ['BVA:post-orders:note:len-max'], technique: 'BVA', needs: 'read-back of the stored value' },
  { id: 'B8', title: 'non-premium order of 100+ gets 0% instead of 5%', detectedBy: ['DT:discount:3'], technique: 'DT' },
  { id: 'B9', title: 'premium order of exactly 100 gets 5% (uses > instead of >=)', detectedBy: ['DT:discount:1'], technique: 'DT', needs: 'input exactly on the condition threshold' },
  { id: 'B10', title: 'shipped order can be cancelled', detectedBy: ['ST:order:shipped+cancel'], technique: 'ST', needs: 'invalid transitions' },
  { id: 'B11', title: 'ship moves a paid order to "delivered" instead of "shipped"', detectedBy: ['ST:order:paid+ship'], technique: 'ST', needs: 'read-back of the state' },
  { id: 'B12', title: 'express shipping to CZ crashes (500)', detectedBy: ['PW:shipping:*'], technique: 'PW', needs: 'a 2-way interaction' },
  { id: 'B13', title: 'quantity "abc" answers 400 but the order is stored anyway', detectedBy: ['EP:post-orders:quantity:wrong-type'], technique: 'EP', needs: 'a "nothing stored" check after a rejection' },
  // Kontrola negatywna: SHOP-13 nie podaje cennika, więc żadna wyrocznia nie zna poprawnej ceny. Silnik NIE MOŻE tego
  // wykryć — jeśli "wykryje", to zgaduje. Liczone osobno, poza odsetkiem wykrytych defektów.
  { id: 'B14', title: 'DE shipping surcharge 22 instead of 20 (no source states the price)', detectedBy: ['PW:shipping:*', 'EP:post-shipping-quote:*'], technique: 'PW', blindSpot: true, needs: 'a price table in the requirement' },
];

function start({ bugs = true, port = 0 } = {}) {
  const on = (id) => bugs === true || (bugs instanceof Set && bugs.has(id));
  const orders = new Map();
  let seq = 0;
  const NEXT = { created: { pay: 'paid', cancel: 'cancelled' }, paid: { ship: 'shipped', cancel: 'cancelled' }, shipped: { deliver: 'delivered' } };
  const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const isStr = (v) => typeof v === 'string';

  function validateOrder(b) {
    if (!b || typeof b !== 'object') return 'body must be an object';
    if (on('B5') ? b.customerId === null : b.customerId == null) return 'customerId is required';
    if (b.customerId !== undefined && (!isStr(b.customerId) || b.customerId.length < 1 || b.customerId.length > 20)) return 'customerId must be 1–20 characters';
    if (b.quantity == null) return 'quantity is required';
    if (typeof b.quantity !== 'number') return 'quantity must be a number';
    if (!on('B6') && !Number.isInteger(b.quantity)) return 'quantity must be an integer';
    if (on('B2') ? b.quantity < 0 : b.quantity < 1) return 'quantity must be at least 1';
    if (on('B1') ? b.quantity > 101 : b.quantity > 100) return 'quantity must be at most 100';
    if (b.currency == null) return 'currency is required';
    if (!isStr(b.currency)) return 'currency must be a string';
    if (!['PLN', 'EUR', 'USD'].includes(b.currency) && !(on('B4') && /^[A-Z]{3}$|^__/.test(b.currency))) return 'currency must be PLN, EUR or USD';
    if (b.note !== undefined && (!isStr(b.note) || b.note.length > (on('B3') ? 51 : 50))) return 'note must be at most 50 characters';
    if (b.express !== undefined && typeof b.express !== 'boolean') return 'express must be true or false';
    return null;
  }

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch (_) { return send(res, 400, { error: 'invalid JSON' }); }
      const url = new URL(req.url, 'http://x');
      const p = url.pathname;
      try {
        if (req.method === 'GET' && p === '/openapi.json') return send(res, 200, SPEC);
        if (req.method === 'GET' && p === '/orders') return send(res, 200, [...orders.values()]);
        if (req.method === 'POST' && p === '/orders') {
          // B13: zamówienie z ilością jako tekst trafia do bazy, zanim walidacja je odrzuci.
          if (on('B13') && body && typeof body.quantity === 'string') { const id = String(++seq); orders.set(id, { id, ...body, state: 'created' }); }
          const err = validateOrder(body);
          if (err) return send(res, 400, { error: err });
          const id = String(++seq);
          const o = { id, customerId: body.customerId, quantity: body.quantity, currency: body.currency, note: body.note, express: body.express, state: 'created' };
          if (on('B7') && isStr(o.note)) o.note = o.note.slice(0, 40);
          orders.set(id, o);
          return send(res, 201, o);
        }
        let m;
        if (req.method === 'GET' && (m = p.match(/^\/orders\/([^/]+)$/))) { const o = orders.get(m[1]); return o ? send(res, 200, o) : send(res, 404, { error: 'not found' }); }
        if (req.method === 'POST' && (m = p.match(/^\/orders\/([^/]+)\/([a-z]+)$/))) {
          const o = orders.get(m[1]);
          if (!o) return send(res, 404, { error: 'not found' });
          const ev = m[2];
          if (!['pay', 'ship', 'deliver', 'cancel'].includes(ev)) return send(res, 400, { error: 'unknown event' });
          let to = (NEXT[o.state] || {})[ev];
          if (on('B10') && o.state === 'shipped' && ev === 'cancel') to = 'cancelled';
          if (on('B11') && o.state === 'paid' && ev === 'ship') to = 'delivered';
          if (!to) return send(res, 409, { error: `cannot ${ev} an order in state ${o.state}` });
          o.state = to;
          return send(res, 200, o);
        }
        if (req.method === 'POST' && p === '/discounts/quote') {
          if (!body || typeof body.premium !== 'boolean') return send(res, 400, { error: 'premium must be true or false' });
          if (typeof body.total !== 'number' || body.total < 0) return send(res, 400, { error: 'total must be a number ≥ 0' });
          const big = body.premium && on('B9') ? body.total > 100 : body.total >= 100;
          const discount = body.premium ? (big ? 10 : 5) : (big ? (on('B8') ? 0 : 5) : 0);
          return send(res, 200, { discount });
        }
        if (req.method === 'POST' && p === '/shipping/quote') {
          const ok = (k, list) => body && list.includes(body[k]);
          if (!ok('method', ['standard', 'express', 'pickup']) || !ok('country', ['PL', 'DE', 'CZ']) || !ok('payment', ['card', 'blik', 'transfer'])) return send(res, 400, { error: 'method, country and payment must come from their lists' });
          if (on('B12') && body.method === 'express' && body.country === 'CZ') throw new Error('rate table has no express row for CZ');
          const price = { standard: 15, express: 35, pickup: 0 }[body.method] + { PL: 0, DE: on('B14') ? 22 : 20, CZ: 18 }[body.country] + (body.payment === 'transfer' ? 0 : 1);
          return send(res, 200, { price });
        }
        return send(res, 404, { error: 'not found' });
      } catch (e) { return send(res, 500, { error: 'internal error' }); }
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) })));
}

module.exports = { start, SPEC, MODELS, GROUND_TRUTH };
