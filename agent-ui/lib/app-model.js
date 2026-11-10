// Application model built only from the OpenAPI specifications.
// When nothing but the API is connected, this is what the agents learn the application from: which
// resources exist, what each one can do, which resource has to exist before another one can be made
// (an {orderId} in a path or an orderId in a body), the order to create test data in and the
// life-cycle flow to test for every resource. It is computed, not guessed by a model, so every claim
// points to an endpoint of the specification.

const isParam = (s) => /^\{.+\}$/.test(s);
const segs = (p) => String(p || '').split('/').filter(Boolean);
const singular = (w) => String(w).toLowerCase().replace(/ies$/, 'y').replace(/(ss|x|ch|sh)es$/, '$1').replace(/s$/, '');
const words = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const label = (p) => segs(p).filter((s) => !isParam(s)).slice(-1)[0] || '/';

/** "/orders/{id}/items/{itemId}" -> the collection "/orders/{id}/items" and whether the path addresses one item. */
function shape(path) {
  const s = segs(path);
  const item = s.length > 1 && isParam(s[s.length - 1]);
  const collection = '/' + (item ? s.slice(0, -1) : s).join('/');
  return { collection, item };
}

/** Kind of operation, by method and by whether the path ends in an {id}. */
function kind(e, item) {
  const m = e.method;
  if (!item && m === 'GET') return 'list';
  if (!item && m === 'POST') return 'create';
  if (item && m === 'GET') return 'read';
  if (item && (m === 'PUT' || m === 'PATCH')) return 'update';
  if (item && m === 'DELETE') return 'delete';
  return 'action';
}

function build(endpoints) {
  const res = new Map();
  const get = (collection) => {
    if (!res.has(collection)) res.set(collection, { path: collection, name: label(collection), groups: new Set(), ops: { list: [], create: [], read: [], update: [], delete: [], action: [] }, needs: new Set(), why: [] });
    return res.get(collection);
  };
  // An action such as POST /orders/{id}/cancel belongs to /orders, not to a collection of its own.
  for (const e of endpoints) {
    let { collection, item } = shape(e.path);
    const s = segs(e.path);
    if (!item && s.length > 2 && isParam(s[s.length - 2]) && e.method !== 'GET' && !endpoints.some((x) => x.path === e.path && x.method === 'GET') && !endpoints.some((x) => x.path.startsWith(e.path + '/'))) {
      collection = '/' + s.slice(0, -2).join('/'); item = true;
      const r = get(collection); r.groups.add(e.groupLabel); r.ops.action.push(e); continue;
    }
    const r = get(collection);
    r.groups.add(e.groupLabel);
    r.ops[kind(e, item)].push(e);
  }
  const all = [...res.values()];
  const byWord = (w) => {
    const sw = singular(w);
    return all.find((r) => singular(r.name) === sw) || all.find((r) => singular(r.name).endsWith(sw) || sw.endsWith(singular(r.name)));
  };
  // Dependencies: a parent path segment, an {xxxId} in the path, or an xxxId field in a request body.
  for (const r of all) {
    const s = segs(r.path);
    for (let i = 0; i < s.length; i++) {
      if (!isParam(s[i])) continue;
      const parent = res.get('/' + s.slice(0, i).join('/'));
      if (parent && parent !== r) { r.needs.add(parent.path); r.why.push(`${s[i]} in the path`); }
    }
    for (const e of [...r.ops.create, ...r.ops.update, ...r.ops.action]) {
      for (const f of Object.keys(e.body && typeof e.body === 'object' ? e.body : {})) {
        const field = f.replace(/\?$/, '');
        const m = field.match(/^(.+?)_?(id|ids|Id|Ids|ID)$/);
        if (!m) continue;
        const target = byWord(words(m[1]).join(''));
        if (target && target !== r) { r.needs.add(target.path); r.why.push(`${field} in ${e.name}`); }
      }
    }
  }
  // Order to create test data in: resources that need nothing first.
  const order = [];
  const seen = new Set();
  const visit = (r, stack = new Set()) => {
    if (seen.has(r.path) || stack.has(r.path)) return;
    stack.add(r.path);
    for (const n of r.needs) if (res.has(n)) visit(res.get(n), stack);
    seen.add(r.path); order.push(r.path);
  };
  for (const r of all.sort((a, b) => a.path.localeCompare(b.path))) visit(r);

  const pick = (list) => (list[0] ? list[0].name : null);
  const resources = order.map((p) => {
    const r = res.get(p);
    const flow = [];
    const step = (what, list, check) => { const n = pick(list); if (n) flow.push({ step: what, endpoint: n, check }); };
    step('create', r.ops.create, 'answer 2xx and returns the new id; keep it for the next steps');
    step('read', r.ops.read, 'the fields match what was sent');
    step('list', r.ops.list, 'the new item is in the list');
    step('update', r.ops.update, 'answer 2xx; read again and see the change');
    for (const a of r.ops.action) flow.push({ step: 'action', endpoint: a.name, check: a.summary || 'the state changes as the action says' });
    step('delete', r.ops.delete, 'answer 2xx; reading it again answers 404');
    const count = Object.values(r.ops).reduce((n, l) => n + l.length, 0);
    return {
      path: r.path, name: r.name, groups: [...r.groups].filter(Boolean), endpoints: count,
      can: Object.entries(r.ops).filter(([, l]) => l.length).map(([k, l]) => `${k}: ${l.map((e) => e.name).join(', ')}`),
      needs: [...r.needs], because: [...new Set(r.why)], flow,
      readOnly: !r.ops.create.length && !r.ops.update.length && !r.ops.delete.length && !r.ops.action.length,
    };
  });
  return { resources, order, endpoints: endpoints.length };
}

/** The model as Markdown, for the agents and for the setup summary. */
function markdown(model, title = 'the application') {
  const L = [`# What the API says about ${title}`, '',
    `${model.resources.length} resources, ${model.endpoints} endpoints. Built from the OpenAPI specification only: business rules and expected values are not in it, so derive them from field names, enums, required fields and summaries, and list everything else as an open question.`, '',
    '## Order to create test data in', '', model.order.map((p, i) => `${i + 1}. ${p}`).join('\n'), ''];
  for (const r of model.resources) {
    L.push(`## ${r.path}${r.groups.length ? ' (' + r.groups.join(', ') + ')' : ''}${r.readOnly ? ', read only' : ''}`);
    L.push(...r.can.map((c) => '- ' + c));
    if (r.needs.length) L.push(`- needs first: ${r.needs.join(', ')} (${r.because.join('; ')})`);
    if (r.flow.length > 1) L.push('- life-cycle flow: ' + r.flow.map((f) => `${f.step} ${f.endpoint}`).join(' -> '));
    L.push('');
  }
  return L.join('\n');
}

module.exports = { build, markdown, shape };
