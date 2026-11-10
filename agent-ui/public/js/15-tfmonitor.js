// QA Agents UI: Test Flow — Phase 2 (Test Monitoring and Control). Jeden dashboard per projekt:
// wydania (wersje Jiry) z metrykami i ryzykiem. Dane same się odświeżają w tle po stronie serwera
// (lib/test-monitor.js); ta strona tylko odpytuje i rysuje. (Widok "bieżący sprint" usunięty: zbierał
// też stare, dawno domknięte zadania, więc jego wykres statusów nic nie mówił o postępie wydania.)
let TFM_PROJECTS=[],tfmSel=null,tfmTimer=null,tfmRelSel=null;

/* Four families, four hues — a Jira board has more than "done/not done", and lumping
   everything-but-Done into one gray bucket (the old behaviour) is exactly why this tab
   read as flat and colorless. Within a family, same-named statuses keep one full-strength
   hue; two DIFFERENT statuses sharing a family (e.g. "In progress" and "Code review" both
   being "active") step one shade lighter so they stay tellable apart without a 5th hue. */
const tfmStatusFamily=s=>/block|wstrzym|hold|impediment/i.test(s||'')?'blocked'
  :/^done$|gotow|zrobion|zakończon|closed|resolved|release/i.test(s||'')?'done'
  :/progress|toku|review|test/i.test(s||'')?'active':'todo';
const TFM_FAM_HUE={done:'var(--ok)',blocked:'var(--bad)',active:'var(--acc)',todo:'var(--info)'};
function tfmStatusColors(statuses){
  const byFam={};
  [...new Set(statuses)].forEach(s=>{const f=tfmStatusFamily(s);(byFam[f]=byFam[f]||[]).push(s)});
  const map={};
  Object.values(byFam).forEach(list=>{
    list.sort();
    list.forEach((s,i)=>{map[s]={color:TFM_FAM_HUE[tfmStatusFamily(s)],fade:Math.max(.62,1-i*.16)}});
  });
  return map;
}
const tfmPill=(s,colors)=>{const c=colors[s]||{color:'var(--ink4)',fade:1};
  return `<span class="pill" style="color:${c.color};background:color-mix(in srgb,${c.color} ${Math.round(c.fade*16)}%,transparent);border-color:color-mix(in srgb,${c.color} ${Math.round(c.fade*40)}%,transparent)"><span class="d" style="background:${c.color};opacity:${c.fade}"></span>${esc(s)}</span>`};

/* Distinct, vivid hue per issue type — Story/Task/Sub-task used to share a washed-out gray
   (sub-task) or the same hue as Task (zadanie), which made the chart unreadable at a glance.
   Each named type now gets its own full-strength color; unknown types still rotate app-N. */
const TFM_TYPE_HUE={story:'var(--acc)','user story':'var(--acc)',task:'var(--app-1)',zadanie:'var(--app-1)',
  epic:'var(--info)',bug:'var(--bad)','błąd':'var(--bad)','sub-task':'var(--app-2)',subtask:'var(--app-2)',podzadanie:'var(--app-2)'};
function tfmTypeColors(types){
  const map={};
  [...new Set(types)].forEach((t,i)=>{map[t]=TFM_TYPE_HUE[String(t||'').toLowerCase()]||`var(--app-${(i%3)+1})`});
  return map;
}

function tfmRender(){
  const p=TFM_PROJECTS.find(x=>x.key===tfmSel);
  $('#tfmProjects').innerHTML=TFM_PROJECTS.map(x=>`<button data-k="${x.key}" class="${x.key===tfmSel?'on':''}">${esc(x.label)}${x.total?`<span class="tfm-n">${x.total}</span>`:''}</button>`).join('');
  const body=$('#tfmBody');
  if(!p){body.innerHTML='';return}
  const versions=p.releases||[];
  if(versions.length&&(!tfmRelSel||!versions.some(v=>v.name===tfmRelSel))){
    tfmRelSel=(p.currentReleaseName&&versions.some(v=>v.name===p.currentReleaseName))?p.currentReleaseName:versions[0].name;
  }
  body.innerHTML=`
    <div class="tfm-head">
      <h3>${esc(p.label)} <span class="mono" style="font-weight:400;color:var(--ink3)">${esc(p.jiraKey)}</span></h3>
      <span class="sec-meta">${p.releaseFetchedAt?('updated '+fmt(p.releaseFetchedAt)):'not fetched yet'} · checked once a day${p.releaseRefreshing?' · refreshing…':''}</span>
      <button class="btn sm" id="tfmRefreshRel">Refresh</button>
    </div>
    ${tfmReleaseBody(p,versions)}
  `;
  const relPicker=$('#tfmRelPicker');
  if(relPicker)relPicker.onclick=e=>{const b=e.target.closest('[data-v]');if(b&&b.dataset.v!==tfmRelSel){tfmRelSel=b.dataset.v;tfmRender()}};
  const relBtn=$('#tfmRefreshRel');
  if(relBtn)relBtn.onclick=async()=>{relBtn.disabled=true;try{await api('/api/test-flow/monitor/'+p.key+'/release/refresh',{method:'POST'});setTimeout(loadMonitor,1500)}catch(e){}};
  body.querySelectorAll('.jira-row').forEach(tr=>tr.onclick=()=>openJiraPrev(tr.dataset.key));
  tipBind(body);
}

/* Release view: fetched at most once a day (lib/test-monitor.js) — a version doesn't change its
   shape minute to minute. All matching upcoming versions are kept (not just the auto-picked
   "current" one), so this is a picker across releases, mirroring the project's Jira release page. */
function tfmReleaseBody(p,versions){
  if(p.releaseOk===false&&!versions.length)return `<div class="empty">${ico('gauge',28)}<b>Could not read releases</b><span>${esc(p.releaseError||'Unknown error')}</span></div>`;
  const sel=versions.find(v=>v.name===tfmRelSel)||versions[0];
  if(!sel)return `<div class="ov-empty">No upcoming releases found for this project.</div>`;
  const rm=sel.metrics||{total:0,done:0,doneRatio:0,byType:[],byStatus:[]};
  const statusColors=tfmStatusColors(rm.byStatus.map(x=>x.status));
  const typeColors=tfmTypeColors(rm.byType.map(x=>x.type));
  const typeParts=rm.byType.map(t=>({label:t.type,value:t.count,color:typeColors[t.type]}));
  const statusParts=rm.byStatus.map(s=>({label:s.status,value:s.count,color:statusColors[s.status].color,fade:statusColors[s.status].fade}));
  const issues=sel.issues||[];
  return `
    ${versions.length>1?`<div class="seg" id="tfmRelPicker" style="margin-bottom:14px">
      ${versions.map(v=>`<button data-v="${esc(v.name)}" class="${v.name===sel.name?'on':''}">${esc(v.name)}${v.name===p.currentReleaseName?' ★':''}</button>`).join('')}
    </div>`:'<div id="tfmRelPicker" hidden></div>'}
    <div class="tfm-head" style="margin:0 0 14px">
      <h3 style="margin:0">${esc(sel.name)}${sel.releaseDate?` <span class="mono" style="font-weight:400;color:var(--ink3)">due ${esc(sel.releaseDate)}</span>`:''}</h3>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="l">Issues in release</div><div class="v">${rm.total}</div></div>
      <div class="kpi"><div class="l">Done</div><div class="v ${rm.done?'ok':''}">${rm.done}</div></div>
      <div class="kpi"><div class="l">Done %</div><div class="v">${rm.total?Math.round(rm.doneRatio*100)+'%':'—'}</div></div>
    </div>
    <div class="tfm-charts">
      <div class="section"><div class="sec-head"><h4>By type</h4></div>
        ${typeParts.length?donutChart(typeParts,{aria:'Release issues by type',centerSub:'issues'}):'<div class="ov-empty">No issues in this release.</div>'}
      </div>
      <div class="section"><div class="sec-head"><h4>By status</h4></div>
        ${statusParts.length?donutChart(statusParts,{aria:'Release issues by status',centerSub:'issues'}):''}
      </div>
    </div>
    ${issues.length?`<div class="section"><div class="sec-head"><h4>Issues</h4><span class="sec-meta">${issues.length} · click a row to read the ticket</span></div>
      <div style="overflow-x:auto"><table class="dtbl">
        <thead><tr><th>Key</th><th>Summary</th><th>Status</th><th>Type</th><th>Priority</th></tr></thead>
        <tbody>${issues.map(it=>`<tr class="jira-row" data-key="${esc(it.key)}">
          <td class="mono">${esc(it.key)}</td>
          <td class="t" title="${esc(it.summary||'')}">${esc(it.summary||'')}</td>
          <td>${tfmPill(it.status||'',statusColors)}</td>
          <td>${esc(it.type||'')}</td>
          <td>${esc(it.priority||'')}</td>
        </tr>`).join('')}</tbody>
      </table></div></div>`:''}`;
}

$('#tfmProjects').onclick=e=>{const b=e.target.closest('[data-k]');if(b&&b.dataset.k!==tfmSel){tfmSel=b.dataset.k;tfmRelSel=null;tfmRender()}};

async function loadMonitor(){
  let d;try{d=await api('/api/test-flow/monitor')}catch(e){$('#tfmBody').innerHTML=`<div class="empty">${ico('gauge',28)}<b>Cannot reach the server</b></div>`;return}
  TFM_PROJECTS=d.projects||[];
  if(!tfmSel||!TFM_PROJECTS.some(x=>x.key===tfmSel))tfmSel=(TFM_PROJECTS[0]||{}).key||null;
  tfmRender();
  clearTimeout(tfmTimer);
  if(!$('#view-tfmonitor').hidden)tfmTimer=setTimeout(loadMonitor,20000);
}

/* ---------- Jira issue preview: read what a ticket actually says, from inside the app ---------- */
/* Fetching a single ticket's text is a short `claude -p` run against Jira (lib/bugs.js) — not
   instant, so the modal opens immediately with a loading state and fills in once the answer
   lands. Cached client-side per key for the rest of the session: re-opening the same ticket
   should not pay for another Jira round trip. */
let jiraPrevCache={};
function closeJiraPrev(){$('#jiraPrevModal').hidden=true}
async function openJiraPrev(key){
  $('#jiraPrevTitle').textContent=key;
  $('#jiraPrevSub').textContent='';
  $('#jiraPrevBody').innerHTML='<div class="spin">Fetching '+esc(key)+' from Jira…</div>';
  $('#jiraPrevModal').hidden=false;
  if(jiraPrevCache[key]){renderJiraPrev(key,jiraPrevCache[key]);return}
  try{
    const d=await api('/api/jira/issue-text/'+encodeURIComponent(key));
    jiraPrevCache[key]=d.text;
    renderJiraPrev(key,d.text);
  }catch(e){
    $('#jiraPrevBody').innerHTML=`<div class="empty">${ico('gauge',24)}<b>Could not load ${esc(key)}</b><span>${esc(e.message||'Unknown error')}</span></div>`;
  }
}
function renderJiraPrev(key,text){
  const title=(text.split('\n')[0]||'').replace(/^##\s*/,'').trim();
  $('#jiraPrevTitle').textContent=title||key;
  $('#jiraPrevBody').innerHTML=jiraMdLite(text);
}
function jiraMdLite(text){
  const out=[];let para=[];
  const flush=()=>{if(para.length){out.push('<p>'+esc(para.join('\n'))+'</p>');para=[]}};
  for(const raw of String(text||'').split('\n')){
    const line=raw.replace(/\r$/,'');
    if(/^##\s+/.test(line)){flush();continue}
    if(/^###\s+/.test(line)){flush();out.push('<h4>'+esc(line.replace(/^###\s+/,''))+'</h4>');continue}
    if(/^####\s+/.test(line)){flush();out.push('<h5>'+esc(line.replace(/^####\s+/,''))+'</h5>');continue}
    if(/^Status:/.test(line)){flush();out.push('<div class="meta">'+esc(line)+'</div>');continue}
    if(!line.trim()){flush();continue}
    para.push(line);
  }
  flush();
  return out.join('')||'<p>No description.</p>';
}
$('#jiraPrevClose').onclick=closeJiraPrev;
$('#jiraPrevModal').addEventListener('mousedown',e=>{if(e.target.id==='jiraPrevModal')closeJiraPrev()});
document.addEventListener('keydown',e=>{if(!$('#jiraPrevModal').hidden&&e.key==='Escape')closeJiraPrev()});
