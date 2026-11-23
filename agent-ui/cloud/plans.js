// Katalog planów: jedno źródło dla strony z cennikiem, checkoutu i rozliczeń.
// Okresy: miesięczny, półroczny, roczny (rabat liczony względem ceny miesięcznej) + Enterprise (umowa i faktura).
const cfg = require('./config');

const PERIODS = [
  { id: 'monthly', name: 'Monthly', months: 1, every: 'per month' },
  { id: 'semiannual', name: '6 months', months: 6, every: 'every 6 months' },
  { id: 'annual', name: 'Annual', months: 12, every: 'per year' },
];

/** Kwota w walucie cennika: bez groszy, gdy kwota jest całkowita ($15, $12.50). */
function money(amount, currency = cfg.PRICE_CURRENCY) {
  const whole = Math.round(amount * 100) % 100 === 0;
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(amount); }
  catch (_) { return `${amount} ${currency}`; }
}

/** Plany do sprzedaży (cena > 0). sellable = jest cena w Stripe. */
function catalog() {
  const monthly = cfg.PRICES.monthly;
  return PERIODS.filter((p) => cfg.PRICES[p.id] > 0).map((p) => {
    const price = cfg.PRICES[p.id];
    const perMonth = price / p.months;
    const save = monthly > 0 && p.months > 1 ? Math.round((1 - perMonth / monthly) * 100) : 0;
    return {
      ...p, price, perMonth: Math.round(perMonth * 100) / 100, save, currency: cfg.PRICE_CURRENCY,
      priceText: money(price), perMonthText: money(Math.round(perMonth * 100) / 100), stripePrice: cfg.STRIPE_PRICES[p.id] || '',
      sellable: !!cfg.STRIPE_PRICES[p.id],
    };
  });
}
const find = (id) => catalog().find((p) => p.id === id) || null;
const defaultPlan = () => (catalog().find((p) => p.sellable) || catalog()[0] || null);

/** Jednozdaniowy opis cen do regulaminu, gdy PRICE_LABEL nie jest ustawione. */
function label() {
  if (cfg.PRICE_LABEL) return cfg.PRICE_LABEL;
  const c = catalog();
  if (!c.length) return 'Pricing is announced at launch';
  const parts = c.map((p) => `${p.priceText} ${p.every}`);
  return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' or ' + parts[parts.length - 1] : parts[0];
}

const enterprise = () => ({ from: cfg.ENTERPRISE_FROM, fromText: money(cfg.ENTERPRISE_FROM), seats: cfg.ENTERPRISE_SEATS });

module.exports = { PERIODS, catalog, defaultPlan, enterprise, find, label, money };
