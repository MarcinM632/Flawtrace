// Reads OpenAPI 3 and Swagger 2 documents into one flat endpoint list.
// Used by the Tools tab (catalogue and change tracking) and by the API MCP server (calls on the test environment).
const fs = require('fs');
const path = require('path');

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'api';
const ident = (s) => String(s || '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();

/** Follows a local $ref such as "#/components/schemas/Order". External references are left as they are. */
function deref(doc, node, seen = new Set()) {
  if (!node || typeof node !== 'object' || !node.$ref || typeof node.$ref !== 'string' || !node.$ref.startsWith('#/')) return node;
  if (seen.has(node.$ref)) return {};
  seen.add(node.$ref);
  const target = node.$ref.slice(2).split('/').reduce((o, k) => (o ? o[k.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined), doc);
  return deref(doc, target || {}, seen);
}

/** A short type label for a schema, for example "string", "integer", "Order", "array of Order". */
function typeOf(doc, schema) {
  if (!schema) return 'any';
  if (schema.$ref) return schema.$ref.split('/').pop();
  const s = deref(doc, schema);
  if (s.type === 'array') return 'array of ' + typeOf(doc, s.items);
  return s.type || (s.properties ? 'object' : 'any');
}

/** Expands a schema into a compact example-like outline (depth limited), so an agent can build a request body. */
function outline(doc, schema, depth = 0) {
  const s = deref(doc, schema);
  if (!s || depth > 4) return typeOf(doc, schema);
  if (s.enum) return s.enum.slice(0, 20).join(' | ');
  if (s.type === 'array') return [outline(doc, s.items, depth + 1)];
  const all = s.allOf ? s.allOf.map((x) => deref(doc, x)) : [s];
  const props = Object.assign({}, ...all.map((x) => x.properties || {}));
  if (!Object.keys(props).length) return s.type || 'any';
  const req = new Set(all.flatMap((x) => x.required || []));
  const out = {};
  for (const [k, v] of Object.entries(props)) out[k + (req.has(k) ? '' : '?')] = outline(doc, v, depth + 1);
  return out;
}

/**
 * Parses one specification. `source` names the specification (shown as the group of its endpoints when an
 * operation has no tag). Returns { title, version, servers, endpoints }.
 */
function parseSpec(doc, source) {
  const v2 = !!doc.swagger;
  const servers = v2
    ? (doc.host ? [(doc.schemes && doc.schemes[0] ? doc.schemes[0] : 'https') + '://' + doc.host + (doc.basePath || '')] : [])
    : (doc.servers || []).map((s) => s.url).filter(Boolean);
  const endpoints = [];
  const used = new Set();
  for (const [p, item] of Object.entries(doc.paths || {})) {
    const shared = (item && item.parameters) || [];
    for (const m of METHODS) {
      const op = item && item[m];
      if (!op) continue;
      const params = [];
      for (const raw of [...shared, ...(op.parameters || [])]) {
        const q = deref(doc, raw);
        if (!q || !q.name) continue;
        if (q.in === 'body') {
          params.push({ name: 'body', in: 'body', required: !!q.required, type: typeOf(doc, q.schema) });
          continue;
        }
        const sch = q.schema ? deref(doc, q.schema) : q;
        params.push({ name: q.name, in: q.in, required: !!q.required, type: typeOf(doc, sch), ...(sch.enum ? { enum: sch.enum.slice(0, 30) } : {}) });
      }
      let body = null;
      if (op.requestBody) {
        const rb = deref(doc, op.requestBody);
        const ct = rb.content && (rb.content['application/json'] || Object.values(rb.content)[0]);
        if (ct) {
          body = outline(doc, ct.schema);
          params.push({ name: 'body', in: 'body', required: !!rb.required, type: typeOf(doc, ct.schema) });
        }
      } else {
        const b = (op.parameters || []).map((x) => deref(doc, x)).find((x) => x && x.in === 'body');
        if (b) body = outline(doc, b.schema);
      }
      const tag = (op.tags && op.tags[0]) || source;
      let name = ident(op.operationId || (m + '_' + p));
      if (!name) name = ident(m + '_' + p);
      let n = name;
      for (let i = 2; used.has(n); i++) n = name + '_' + i;
      used.add(n);
      endpoints.push({
        name: n,
        method: m.toUpperCase(),
        path: p,
        group: slug(source + '-' + tag),
        groupLabel: tag,
        source,
        summary: String(op.summary || op.description || '').split('\n')[0].slice(0, 200),
        read: m === 'get' || m === 'head' || m === 'options',
        params,
        body,
      });
    }
  }
  return { title: (doc.info && doc.info.title) || source, version: (doc.info && doc.info.version) || '', servers, endpoints };
}

/** Loads every *.json specification in a folder. A file that does not parse is reported, not thrown. */
function loadFolder(dir) {
  const specs = [];
  const errors = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'sources.json').sort(); } catch (_) { /* no folder yet */ }
  for (const f of files) {
    const source = f.replace(/\.json$/, '');
    try { specs.push({ source, ...parseSpec(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), source) }); }
    catch (e) { errors.push({ source, error: e.message }); }
  }
  return { specs, errors, endpoints: specs.flatMap((s) => s.endpoints) };
}

module.exports = { loadFolder, parseSpec, slug };
