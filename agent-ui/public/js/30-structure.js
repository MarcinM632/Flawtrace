/* Zakładka Struktura: jeden obraz całej konfiguracji testowania — agenci i ich skille (zdolności/subagenci), jednolita
   baza wiedzy per serwis oraz edytowalne pliki wiedzy. Lewy panel to drzewo, prawy to podgląd/edycja wybranego elementu.
   Pliki wiedzy można otworzyć, zmienić i zapisać albo usunąć; dokumenty generowane (baza per serwis) są podglądem. */
let STRUCT = null;
const jput = (p, b) => api(p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const jdel = (p, b) => api(p, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const stBadge = (s) => s === 'ready' ? 'ok' : (s === 'running' || s === 'queued') ? 'warn' : s === 'error' ? 'bad' : 'muted';

async function loadStructure() {
  const tree = document.getElementById('stTree');
  if (!tree) return;
  try { STRUCT = await api('/api/structure'); } catch (e) { tree.innerHTML = `<div class="chk bad">${esc(e.message)}</div>`; return; }
  renderTree();
  // odśwież, dopóki baza wiedzy się buduje
  if ((STRUCT.knowledgeBase.services || []).some(s => s.status === 'running' || s.status === 'queued')) { clearTimeout(window._stT); window._stT = setTimeout(loadStructure, 2500); }
}

function renderTree() {
  const tree = document.getElementById('stTree');
  const g = STRUCT;
  const byKind = {};
  g.agents.forEach(a => { (byKind[a.kind] = byKind[a.kind] || []).push(a); });
  const agentSec = Object.entries(byKind).map(([kind, list]) =>
    `<div class="st-sub">${esc(kind)}</div>` + list.map(a =>
      `<button class="st-item" data-t="agent" data-k="${esc(a.key)}"><span class="st-dot ${a.available ? 'ok' : 'muted'}"></span>${esc(a.label)}<span class="st-meta">${a.skills.length ? a.skills.length + ' skills' : esc(a.mode)}</span></button>`).join('')
  ).join('');

  const skillGroups = {};
  g.skills.forEach(s => { (skillGroups[s.group] = skillGroups[s.group] || []).push(s); });
  const skillSec = Object.entries(skillGroups).map(([grp, list]) =>
    `<div class="st-sub">${esc(grp)}</div>` + list.map(s =>
      `<button class="st-item" data-t="skill" data-k="${esc(s.group + '/' + s.name)}">${esc(s.name)}</button>`).join('')
  ).join('');

  const kbSec = (g.knowledgeBase.services || []).length
    ? g.knowledgeBase.services.map(s => `<button class="st-item" data-t="kb" data-k="${esc(s.source)}"><span class="st-dot ${stBadge(s.status)}"></span>${esc(s.source)}<span class="st-meta">${esc(s.status)}</span></button>`).join('')
    : '<div class="muted-note st-empty">No source connected yet. Connect Jira, Confluence, a repo or an API spec under Sources and the base builds itself.</div>';

  const fileGroups = {};
  g.knowledge.forEach(f => { (fileGroups[f.group] = fileGroups[f.group] || []).push(f); });
  const fileSec = Object.entries(fileGroups).map(([grp, list]) =>
    `<div class="st-sub">${esc(grp)}</div>` + list.map(f =>
      `<button class="st-item" data-t="file" data-k="${esc(f.path)}">${esc(f.path.split('/').pop())}${f.generated ? '<span class="st-meta">generated</span>' : ''}</button>`).join('')
  ).join('');

  tree.innerHTML =
    `<div class="st-group">Agents</div>${agentSec}` +
    `<div class="st-group">Skills (agent capabilities)</div>${skillSec}` +
    `<div class="st-group">Knowledge base — per service</div>${kbSec}` +
    `<div class="st-group">Knowledge files</div>${fileSec}`;

  tree.querySelectorAll('.st-item').forEach(b => b.onclick = () => {
    tree.querySelectorAll('.st-item').forEach(x => x.classList.remove('on')); b.classList.add('on');
    const t = b.dataset.t, k = b.dataset.k;
    if (t === 'agent') showAgent(k);
    else if (t === 'skill') showSkill(k);
    else if (t === 'kb') showKb(k);
    else if (t === 'file') openFile(k);
  });
}

function detail(html) { document.getElementById('stDetail').innerHTML = html; }

function showAgent(key) {
  const a = STRUCT.agents.find(x => x.key === key); if (!a) return;
  const skills = a.skills.length
    ? '<ul class="st-list">' + a.skills.map(s => `<li><b>${esc(s.name)}</b>${s.description ? ' — ' + esc(s.description) : ''}</li>`).join('') + '</ul>'
    : '<div class="muted-note">This agent gets its roles from its CLAUDE.md, not from a shared skill group.</div>';
  detail(
    `<h2 class="st-h2">${esc(a.label)} <span class="tag ${a.available ? 'acc' : ''}">${a.available ? 'ready' : 'not ready'}</span></h2>` +
    `<p class="st-p">Kind: <b>${esc(a.kind)}</b> · mode: <code>${esc(a.mode)}</code></p>` +
    (a.available ? '' : `<div class="chk warn">${esc(a.reason)}</div>`) +
    `<h3 class="st-h3">Skills (capabilities it loads)</h3>${skills}` +
    (a.services.length ? `<h3 class="st-h3">Services</h3><p class="st-p">${a.services.map(esc).join(', ')}</p>` : '') +
    (a.hasInstructions ? `<h3 class="st-h3">Instructions</h3><p class="st-p"><code>${esc(a.dir)}/CLAUDE.md</code></p>` : '') +
    `<h3 class="st-h3">Knowledge it reads</h3><p class="st-p">The shared knowledge files and the per-service knowledge base below — the same for every agent, so the structure is uniform.</p>`
  );
}

function showSkill(key) {
  const s = STRUCT.skills.find(x => x.group + '/' + x.name === key); if (!s) return;
  detail(
    `<h2 class="st-h2">${esc(s.title || s.name)}</h2>` +
    `<p class="st-p">Skill <code>${esc(s.name)}</code> in group <b>${esc(s.group)}</b>.</p>` +
    (s.description ? `<p class="st-p">${esc(s.description)}</p>` : '') +
    `<p class="st-p"><code>${esc(s.path)}</code></p>` +
    `<div class="muted-note">Skills ship with the app and define what an agent can do. Edit the knowledge files to change how the agents behave on your product.</div>`
  );
}

async function showKb(source) {
  detail('<div class="muted-note">Loading…</div>');
  let doc; try { doc = await api('/api/knowledge/base/' + encodeURIComponent(source)); } catch (e) { detail(`<div class="chk bad">${esc(e.message)}</div>`); return; }
  const sec = Object.entries(doc.sections).map(([k, items]) => {
    if (!items.length) return `<h3 class="st-h3">${esc(k)}</h3><div class="muted-note">${esc(doc.notes && doc.notes[k] || 'brak danych z tego źródła')}</div>`;
    return `<h3 class="st-h3">${esc(k)} <span class="st-meta">${items.length}</span></h3><ul class="st-list">` +
      items.slice(0, 40).map(it => `<li>${esc(it.name || it.title || it.text || it.term || it.value || JSON.stringify(it))}${it.detail ? ' — ' + esc(it.detail) : ''}</li>`).join('') +
      (items.length > 40 ? `<li class="muted-note">…${items.length - 40} more</li>` : '') + '</ul>';
  }).join('');
  detail(
    `<h2 class="st-h2">${esc(doc.title || source)} <span class="tag ${stBadge(doc.status)}">${esc(doc.status)}</span></h2>` +
    `<p class="st-p">Source <code>${esc(doc.source)}</code> (${esc(doc.kind)})${doc.url ? ' · ' + esc(doc.url) : ''}. Built ${new Date(doc.builtAt).toLocaleString()}.</p>` +
    `<div class="chk muted">This document is rebuilt automatically from the service — to change it, change the source, not the file. Same section structure for every service.</div>` +
    sec
  );
}

async function openFile(rel, isNew) {
  detail('<div class="muted-note">Loading…</div>');
  let data = { path: rel, content: '', generated: false };
  if (!isNew) { try { data = await api('/api/knowledge/file?path=' + encodeURIComponent(rel)); } catch (e) { detail(`<div class="chk bad">${esc(e.message)}</div>`); return; } }
  detail(
    `<div class="st-filehead"><h2 class="st-h2">${esc(rel)}</h2></div>` +
    (data.generated ? '<div class="chk warn">This file is generated automatically (per-service base, onboarding or lessons). Your edits will be overwritten on the next rebuild — change the source instead.</div>' : '') +
    `<textarea id="stEditor" class="st-editor" spellcheck="false">${esc(data.content)}</textarea>` +
    `<div class="st-filebtns"><button type="button" class="btn" id="stSave">Save</button><button type="button" class="btn ghost" id="stDelete">Delete</button><span id="stFileMsg" class="st-msg"></span></div>`
  );
  document.getElementById('stSave').onclick = async () => {
    try { await jput('/api/knowledge/file', { path: rel, content: document.getElementById('stEditor').value }); document.getElementById('stFileMsg').textContent = 'Saved.'; await loadStructure(); } catch (e) { toast(e.message, 'err'); }
  };
  document.getElementById('stDelete').onclick = async () => {
    if (!confirm('Delete ' + rel + '?')) return;
    try { await jdel('/api/knowledge/file', { path: rel }); detail('<div class="muted-note">File deleted.</div>'); await loadStructure(); } catch (e) { toast(e.message, 'err'); }
  };
}

document.getElementById('stNewFile') && (document.getElementById('stNewFile').onclick = () => {
  const rel = prompt('New knowledge file path (inside the knowledge folder), e.g. team/our-conventions.md', 'notes.md');
  if (!rel) return;
  if (!/\.(md|txt|json)$/i.test(rel)) { toast('Use a .md, .txt or .json file.', 'err'); return; }
  openFile(rel.replace(/^\/+/, ''), true);
});
document.getElementById('stRebuildKb') && (document.getElementById('stRebuildKb').onclick = async (e) => {
  e.target.disabled = true;
  try { await post('/api/knowledge/init', {}); toast('Rebuilding the knowledge base…'); setTimeout(loadStructure, 800); } catch (err) { toast(err.message, 'err'); } finally { e.target.disabled = false; }
});
