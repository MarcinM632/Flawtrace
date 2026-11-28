// Shop front end: catalogue, sign-in, registration and cart. Hash routes, no framework.
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const session = () => { try { return JSON.parse(localStorage.getItem('session') || 'null'); } catch (_) { return null; } };

async function call(method, url, body) {
  const s = session();
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(s ? { Authorization: 'Bearer ' + s.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

const money = (n) => n + ' PLN';

function nav() {
  const s = session();
  $('#nav').innerHTML = s
    ? `<span id="who">${esc(s.user.email)}</span><a href="#/cart">Cart</a><a href="#/" id="signout">Sign out</a>`
    : '<a href="#/login">Sign in</a><a href="#/register">Register</a><a href="#/cart">Cart</a>';
  const so = $('#signout');
  if (so) so.onclick = () => { localStorage.removeItem('session'); nav(); };
}

let state = { q: '', page: 1 };

async function catalogue() {
  $('#view').innerHTML = `<h1>Products</h1>
    <form id="search"><input id="q" type="search" placeholder="Search products" aria-label="Search products" value="${esc(state.q)}"><button>Search</button></form>
    <ul class="products" id="list"></ul><div class="pager" id="pager"></div>`;
  $('#search').onsubmit = (e) => { e.preventDefault(); state = { q: $('#q').value, page: 1 }; load(); };
  load();
}

async function load() {
  const r = await call('GET', `/api/products?q=${encodeURIComponent(state.q)}&page=${state.page}`);
  if (!r.ok) { $('#list').innerHTML = `<li class="error">${esc(r.data.error || 'Could not load the products')}</li>`; return; }
  const { items, total, page, pageSize } = r.data;
  $('#list').innerHTML = items.map((p) => `<li><span>${esc(p.name)}</span><span>${money(p.price)} <button data-add="${p.id}">Add to cart</button></span></li>`).join('');
  const pages = Math.max(1, Math.ceil(total / pageSize));
  $('#pager').innerHTML = `<button id="prev" ${page <= 1 ? 'disabled' : ''}>Previous</button><span>Page ${page} of ${pages}</span><button id="next" ${page > pages ? 'disabled' : ''}>Next</button>`;
  $('#prev').onclick = () => { state.page -= 1; load(); };
  $('#next').onclick = () => { state.page += 1; load(); };
  document.querySelectorAll('[data-add]').forEach((b) => { b.onclick = async () => {
    if (!session()) { location.hash = '#/login'; return; }
    const a = await call('POST', '/api/cart/items', { productId: Number(b.dataset.add), quantity: 1 });
    b.textContent = a.ok ? 'Added' : 'Error';
  }; });
}

function login() {
  $('#view').innerHTML = `<h1>Sign in</h1><form id="f"><label>Email <input id="email" type="email" autocomplete="username"></label>
    <label>Password <input id="password" type="password" autocomplete="current-password"></label><button>Sign in</button><p id="msg" class="error" role="alert"></p></form>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const r = await call('POST', '/api/auth/login', { email: $('#email').value, password: $('#password').value });
    if (!r.ok) { $('#msg').textContent = r.data.error || 'Sign-in failed'; return; }
    localStorage.setItem('session', JSON.stringify({ token: r.data.token, user: r.data.user }));
    nav(); location.hash = '#/';
  };
}

function register() {
  $('#view').innerHTML = `<h1>Create an account</h1><form id="f"><label>Name <input id="name"></label><label>Email <input id="email" type="email"></label>
    <label>Password <input id="password" type="password" autocomplete="new-password"></label><button>Create account</button><p id="msg" class="error" role="alert"></p></form>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const pw = $('#password').value;
    if (pw.length < 6) { $('#msg').textContent = 'Password must be at least 6 characters'; return; }
    const r = await call('POST', '/api/auth/register', { name: $('#name').value, email: $('#email').value, password: pw });
    if (!r.ok) { $('#msg').textContent = r.data.error || 'Registration failed'; return; }
    $('#view').innerHTML = '<h1>Account created</h1><p class="notice">You can sign in now.</p><a href="#/login">Sign in</a>';
  };
}

async function cartPage() {
  if (!session()) { location.hash = '#/login'; return; }
  const r = await call('GET', '/api/cart');
  if (!r.ok) { $('#view').innerHTML = `<p class="error">${esc(r.data.error || 'Could not load the cart')}</p>`; return; }
  const c = r.data;
  $('#view').innerHTML = `<h1>Cart</h1>${c.items.length ? `<table><tr><th>Product</th><th>Qty</th><th>Price</th><th></th></tr>${c.items.map((i) => `<tr><td>${esc(i.name)}</td><td>${i.quantity}</td><td>${money(i.lineTotal)}</td><td><button data-rm="${i.productId}">Remove</button></td></tr>`).join('')}</table>` : '<p>Your cart is empty.</p>'}
    <p>Subtotal: <span id="subtotal">${money(c.subtotal)}</span></p><p>Shipping: <span id="shipping">${money(c.shipping)}</span></p><p><b>Total: <span id="total">${money(c.total)}</span></b></p>
    ${c.items.length ? '<button id="order">Place order</button>' : ''}<p id="msg" role="status"></p>`;
  document.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = async () => { await call('DELETE', '/api/cart/items/' + b.dataset.rm); cartPage(); }; });
  const o = $('#order');
  if (o) o.onclick = async () => { const p = await call('POST', '/api/orders'); $('#view').innerHTML = p.ok ? `<h1>Thank you</h1><p class="notice">Order ${p.data.id} placed. Total ${money(p.data.total)}.</p>` : `<p class="error">${esc(p.data.error)}</p>`; };
}

function route() {
  nav();
  const h = location.hash || '#/';
  if (h === '#/login') return login();
  if (h === '#/register') return register();
  if (h === '#/cart') return cartPage();
  return catalogue();
}
window.addEventListener('hashchange', route);
route();
