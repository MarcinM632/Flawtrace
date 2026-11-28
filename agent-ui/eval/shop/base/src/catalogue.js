// Product search and pagination (ticket BENCH-2).
const { db } = require('./store');
const config = require('./config');

const bad = (error) => ({ status: 400, body: { error } });
const int = (v, d) => (v === undefined || v === null || v === '' ? d : /^-?\d+$/.test(String(v)) ? Number(v) : NaN);

function search(query) {
  const q = String(query.q || '').trim();
  const page = int(query.page, 1);
  const pageSize = int(query.pageSize, config.DEFAULT_PAGE_SIZE);
  if (!Number.isInteger(page) || page < 1) return bad('page must be a whole number from 1');
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > config.MAX_PAGE_SIZE) return bad('pageSize must be a whole number from 1 to 50');
  const matches = (q.length < 2 ? db.products : db.products.filter((p) => p.name.includes(q)))
    .slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const start = (page - 1) * pageSize;
  return { status: 200, body: { items: matches.slice(start, start + pageSize), total: db.products.length, page, pageSize } };
}

function product(id) {
  const p = db.products.find((x) => String(x.id) === String(id));
  return p ? { status: 200, body: p } : { status: 404, body: { error: 'Product not found' } };
}

module.exports = { search, product };
