// Discount codes (ticket BENCH-3).
const CODES = {
  SAVE10: { type: 'percent', value: 10, minSubtotal: 100, validUntil: '2026-12-31' },
  FIXED20: { type: 'amount', value: 20, minSubtotal: 150, validUntil: '2026-12-31' },
  WINTER15: { type: 'percent', value: 15, minSubtotal: 0, validUntil: '2026-12-31' },
  OLD5: { type: 'percent', value: 5, minSubtotal: 0, validUntil: '2025-12-31' },
};

const find = (code) => CODES[String(code || '').trim()] || null;

/** A code is valid through its last day. */
const isValid = (def, now = Date.now()) => now < new Date(def.validUntil).getTime();

/** How much the code takes off. */
function amountOf(def, subtotal, shipping) {
  if (def.type === 'percent') return Math.floor((subtotal + shipping) * def.value / 100);
  return Math.min(def.value, subtotal);
}

module.exports = { CODES, find, isValid, amountOf };
