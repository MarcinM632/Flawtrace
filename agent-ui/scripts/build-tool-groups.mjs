// Zapisuje mapę "narzędzie QA MCP -> grupa" do tool-groups.json. Apka używa jej, żeby do runu QA MCP załadować tylko
// grupy, których proces naprawdę potrzebuje (pełny katalog to ~12 tys. tokenów kontekstu więcej na każdą turę).
// Uruchom ponownie po odświeżeniu specyfikacji (npm run fetch-specs w mcp-server):  node scripts/build-tool-groups.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mcp = path.resolve(here, '..', '..', 'mcp-server', 'src');
const { GROUPS } = await import(pathToFileURL(path.join(mcp, 'mcp', 'groups.js')).href);
const { buildRegistry } = await import(pathToFileURL(path.join(mcp, 'mcp', 'registry.js')).href);

const tools = {};
const groups = {};
const entries = buildRegistry().entries; // najpierw: składanie katalogu rejestruje grupy auto-* dla nowych serwisów
for (const [key, g] of Object.entries(GROUPS)) groups[key] = { label: g.label, target: g.target, tools: 0, ...(g.auto ? { auto: true } : {}) };
for (const e of entries) { tools[e.name] = e.group; if (groups[e.group]) groups[e.group].tools++; }
fs.writeFileSync(path.join(here, '..', 'tool-groups.json'), JSON.stringify({ generatedAt: new Date().toISOString(), groups, tools }));
console.log(`${Object.keys(tools).length} tools in ${Object.keys(groups).length} groups`);
