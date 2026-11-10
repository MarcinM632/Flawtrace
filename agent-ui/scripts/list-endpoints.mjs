// Wypisuje katalog endpointów mcp-server jako JSON (z cache specyfikacji, bez łączenia się z serwisami).
// Osobny proces: ładuje ESM mcp-server i zawsze czyta aktualny cache specyfikacji (bez zapamiętanego katalogu).
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mcp = path.resolve(here, '..', '..', 'mcp-server', 'src');
const load = (p) => import(pathToFileURL(path.join(mcp, p)).href);
const { GROUPS } = await load('mcp/groups.js');
const { buildRegistry } = await load('mcp/registry.js');

const typeOf = (p) => (Array.isArray(p.type) ? p.type.join('|') : p.type || (p.enum ? 'enum' : p.properties ? 'object' : '')) + (p.format ? ':' + p.format : '');
/** Spłaszcza schemat wejściowy do ścieżek (body.a.b), z typem, wymagalnością i enumem; tablice jako name[]. */
function params(schema) {
  const out = [];
  const walk = (node, prefix, depth) => {
    const req = new Set((node && node.required) || []);
    for (const [name, p] of Object.entries((node && node.properties) || {})) {
      const full = prefix ? prefix + '.' + name : name;
      let child = p;
      let label = full;
      if (p && p.type === 'array' && p.items) { child = p.items; label = full + '[]'; }
      out.push({ name: label, required: req.has(name), type: typeOf(p), ...(p.enum ? { enum: p.enum } : {}) });
      if (depth < 6 && child && child.properties) walk(child, label, depth + 1);
    }
  };
  walk(schema, '', 0);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
// Najpierw rejestr: dopiero on zakłada grupy auto-* dla kontrolerów, których groups.js jeszcze nie zna. Lista grup
// zrobiona przed nim gubiła ich endpointy w zakładce Tools (licznik 644, a na liście 628).
const entries = buildRegistry().entries;
const groups = {};
for (const [key, g] of Object.entries(GROUPS)) groups[key] = { label: g.label, target: g.target };
const endpoints = entries.map((e) => ({
  name: e.name, group: e.group, target: e.target, service: e.service, method: e.method, path: e.path, read: !!e.read,
  description: String(e.description || '').split('\n')[0].slice(0, 240), params: params(e.inputSchema),
}));
process.stdout.write(JSON.stringify({ groups, endpoints }));
