// Zestaw wzorcowy benchmarku AGENTA Test design: tickety sklepu z bench/shop-app.js (ta sama specyfikacja), każdy
// z oczekiwaniami, które da się sprawdzić w raporcie bez modelu:
//  rules       — reguły, które projekt MUSI przetestować: check, którego akcja pasuje do `action`, a oczekiwany wynik
//                do `expected`. Check pasujący akcją, którego wynik pasuje do `wrongIf` (a nie do `unless`), ma
//                błędny oczekiwany wynik (wrong) — np. sukces dla quantity=101.
//  mustAsk     — luki celowo zostawione w wymaganiu: muszą trafić do "To confirm" (pytanie do właściciela).
//  mustNotClaim— wartości, których wymaganie nie podaje: check, który je twierdzi, wymyślił wynik (invented).
// Każdy ticket ma celową lukę — agent, który ją "domyśla" zamiast zapytać, traci punkty.
const shop = require('./shop-app');
// Modele reguł tak, jak agent wypisałby je z TEGO ticketu (src = ticket). Rabaty: bez reguły dla klienta zwykłego
// poniżej 100 PLN — ticket jej nie podaje, to celowa luka.
const model = (id, src, fix = (m) => m) => fix({ ...JSON.parse(JSON.stringify(shop.MODELS.find((m) => m.id === id))), src });

const CASES = [
  {
    id: 'order-validation',
    models: [],
    ticket: 'SHOP-10 Order form validation',
    notes: `SHOP-10 Order form validation.
Customer ID is required and has 1 to 20 characters. Quantity is required and is a whole number from 1 to 100.
Currency is required: PLN, EUR or USD. The note is optional, up to 50 characters, and is stored exactly as typed.
An invalid order is rejected and nothing is stored.`,
    rules: [
      { id: 'R1', what: 'quantity 100 accepted', action: [/quantit/i, /\b100\b/], expected: [/\b(2\d\d|accept|created|stored|saved)/i], wrongIf: { match: /\b(4\d\d|reject|refus|error|invalid)/i, unless: /\b(2\d\d|accept|created|stored|saved)/i } },
      { id: 'R2', what: 'quantity 101 rejected', action: [/quantit/i, /\b101\b/], expected: [/\b(4\d\d|reject|refus|error|invalid)/i], wrongIf: { match: /\b(2\d\d|accept|created|stored|saved|success)/i, unless: /\b(4\d\d|reject|refus|error|invalid)/i } },
      { id: 'R3', what: 'quantity 1 accepted', action: [/quantit/i, /(=|of|with|is)\s*1\b(?![.,]\d)/i], expected: [/\b(2\d\d|accept|created|stored|saved)/i], wrongIf: { match: /\b(4\d\d|reject|refus|error|invalid)/i, unless: /\b(2\d\d|accept|created|stored|saved)/i } },
      { id: 'R4', what: 'quantity 0 rejected', action: [/quantit/i, /(=|of|with|is)\s*0\b/i], expected: [/\b(4\d\d|reject|refus|error|invalid)/i], wrongIf: { match: /\b(2\d\d|accept|created|stored|saved|success)/i, unless: /\b(4\d\d|reject|refus|error|invalid)/i } },
      { id: 'R5', what: 'fractional quantity rejected', action: [/quantit/i, /\b\d+[.,]\d+\b|fraction|decimal|non-integer/i], expected: [/\b(4\d\d|reject|refus|error|invalid)/i], wrongIf: { match: /\b(2\d\d|accept|created|stored|saved|success)/i, unless: /\b(4\d\d|reject|refus|error|invalid)/i } },
      { id: 'R6', what: 'missing customer ID rejected', action: [/customer\s*id|customerId/i, /miss|without|omit|empty|absent|no customer/i], expected: [/\b(4\d\d|reject|refus|error|invalid|required)/i], wrongIf: { match: /\b(2\d\d|accept|created|stored|saved|success)/i, unless: /\b(4\d\d|reject|refus|error|invalid)/i } },
      { id: 'R7', what: 'currency outside the list rejected', action: [/currenc/i, /(?!PLN|EUR|USD)\b[A-Z]{3}\b|outside|not (in|on) the list|unsupported|unknown/], expected: [/\b(4\d\d|reject|refus|error|invalid)/i], wrongIf: { match: /\b(2\d\d|accept|created|stored|saved|success)/i, unless: /\b(4\d\d|reject|refus|error|invalid)/i } },
      { id: 'R8', what: 'note of 50 characters stored exactly', action: [/note/i, /\b50\b/], expected: [/stor|saved|read back|GET|exactly|same|unchanged|full/i] },
      { id: 'R9', what: 'note of 51 characters rejected', action: [/note/i, /\b51\b/], expected: [/\b(4\d\d|reject|refus|error|invalid)/i], wrongIf: { match: /\b(2\d\d|accept|created|stored|saved|success)/i, unless: /\b(4\d\d|reject|refus|error|invalid)/i } },
      { id: 'R10', what: 'rejected order stores nothing', action: [/./], expected: [/nothing (is )?(stored|saved|created)|no (new )?order|not stored|count.*(same|unchanged)/i] },
    ],
    mustAsk: [],
    mustNotClaim: [{ id: 'N1', what: 'an exact error message text (not in the requirement)', action: [/./], expected: [/message\s*["“'][^"”']{6,}["”']/i] }],
    techniques: ['BVA', 'EP'],
  },
  {
    id: 'discount-rules',
    models: [model('discount', 'SHOP-11', (m) => ({ ...m, rules: m.rules.slice(0, 3) }))],
    ticket: 'SHOP-11 Discount for premium customers',
    notes: `SHOP-11 Discount for premium customers.
A premium customer whose order total is 100 PLN or more gets a 10% discount. A premium customer below 100 PLN gets 5%.
A regular customer gets 5% when the total is 100 PLN or more.`,
    // Celowa luka: nic nie mówi o kliencie zwykłym poniżej 100 PLN.
    rules: [
      { id: 'R1', what: 'premium, total exactly 100 → 10%', action: [/premium\s*(=|:)\s*true|\bpremium customer|\bpremium\b(?![^,;]*false)/i, /\b100(?:[.,]00)?\b/], expected: [/\b10\s*%|\bdiscount\s*(=|of|is)?\s*10\b/i], wrongIf: { match: /\b5\s*%|\bdiscount\s*(=|of|is)?\s*5\b/i, unless: /\b10\s*%/ } },
      { id: 'R2', what: 'premium, total just below 100 → 5%', action: [/premium\s*(=|:)\s*true|\bpremium customer|\bpremium\b(?![^,;]*false)/i, /\b99(?:[.,]\d+)?\b/], expected: [/\b5\s*%|\bdiscount\s*(=|of|is)?\s*5\b/i], wrongIf: { match: /\b10\s*%|\bdiscount\s*(=|of|is)?\s*10\b/i, unless: /\b5\s*%/ } },
      { id: 'R3', what: 'regular, total exactly 100 → 5%', action: [/regular|non-premium|not premium|standard customer|premium\s*(=|:)\s*false/i, /\b100(?:[.,]00)?\b/], expected: [/\b5\s*%|\bdiscount\s*(=|of|is)?\s*5\b/i], wrongIf: { match: /\b(0|10)\s*%|no discount/i, unless: /\b5\s*%/ } },
    ],
    mustAsk: [{ id: 'Q1', what: 'regular customer below 100 PLN', match: [/regular|non-premium|not premium|standard/i, /below|under|less|<\s*100|\b99/i] }],
    mustNotClaim: [{ id: 'N1', what: 'a discount for a regular customer below 100 PLN', action: [/regular|non-premium|not premium|standard customer|premium\s*(=|:)\s*false/i, /\b99(?:[.,]\d+)?\b|below 100|under 100|less than 100/i], expected: [/\b\d+\s*%|\bdiscount\s*(=|of|is)?\s*\d+|no discount/i] }],
    techniques: ['DT'],
  },
  {
    id: 'order-lifecycle',
    models: [model('order', 'SHOP-12')],
    ticket: 'SHOP-12 Order life cycle',
    notes: `SHOP-12 Order life cycle.
A new order is "created". It is paid ("paid"), then shipped ("shipped"), then delivered ("delivered").
An order can be cancelled ("cancelled") before it is shipped. A shipped order cannot be cancelled.`,
    // Celowa luka: czy anulowane zamówienie po opłaceniu jest zwracane (refund) i w jakiej kwocie.
    rules: [
      { id: 'R1', what: 'pay a created order → paid', action: [/\bpay/i], expected: [/\bpaid\b/i] },
      { id: 'R2', what: 'ship a paid order → shipped', action: [/\bship(?!ped)/i], expected: [/\bshipped\b/i] },
      { id: 'R3', what: 'deliver a shipped order → delivered', action: [/deliver(?!ed)/i], expected: [/\bdelivered\b/i] },
      { id: 'R4', what: 'cancel a paid order → cancelled', action: [/cancel/i, /\bpaid\b/i], expected: [/\bcancelled\b/i] },
      { id: 'R5', what: 'cancel a shipped order → refused, state unchanged', action: [/cancel/i, /\bshipped\b/i], expected: [/\b(4\d\d|refus|reject|not allowed|error|conflict|unchanged|stays)/i], wrongIf: { match: /\bcancelled\b/i, unless: /\b(4\d\d|refus|reject|not allowed|error|conflict|unchanged|stays)/i } },
    ],
    mustAsk: [{ id: 'Q1', what: 'refund when a paid order is cancelled', match: [/refund|money back|return (of )?(the )?payment|zwrot/i] }],
    mustNotClaim: [{ id: 'N1', what: 'a refund amount or a refund being made', action: [/cancel/i], expected: [/refund(ed)?\s*(of|=|is)?\s*\d|full refund|is refunded/i] }],
    techniques: ['ST'],
  },
  {
    id: 'shipping-quote',
    models: [model('shipping', 'SHOP-13')],
    ticket: 'SHOP-13 Shipping quote',
    notes: `SHOP-13 Shipping quote.
The quote takes the method (standard, express, pickup), the country (PL, DE, CZ) and the payment (card, blik, transfer).
Every combination has a price.`,
    // Celowa luka: wymaganie nie podaje cennika — wynik to "jest cena", nie konkretna kwota.
    rules: [
      { id: 'R1', what: 'express to CZ has a price', action: [/express/i, /\bCZ\b/], expected: [/price|2\d\d|quote|returned|amount/i] },
      { id: 'R2', what: 'combinations covered pairwise', action: [/standard|express|pickup/i, /\bPL\b|\bDE\b|\bCZ\b/, /card|blik|transfer/i], expected: [/price|2\d\d|quote/i] },
      { id: 'R3', what: 'value outside a list rejected', action: [/method|country|payment/i, /outside|not (in|on) the list|unknown|unsupported|invalid|\bUS\b|\bFR\b|drone|cash/i], expected: [/\b(4\d\d|reject|refus|error|invalid)/i], wrongIf: { match: /\b(2\d\d|accept|created|stored|saved|success)/i, unless: /\b(4\d\d|reject|refus|error|invalid)/i } },
    ],
    mustAsk: [{ id: 'Q1', what: 'the price table', match: [/price|cost|amount|tariff|cennik/i, /\b(which|what|how much|table|list|source|not (given|stated|specified))\b/i] }],
    mustNotClaim: [{ id: 'N1', what: 'a concrete price', action: [/./], expected: [/\b\d+(?:[.,]\d+)?\s*(PLN|zł|EUR)\b|price\s*(=|of|is)\s*\d/i] }],
    techniques: ['PW'],
  },
];

module.exports = { CASES };
