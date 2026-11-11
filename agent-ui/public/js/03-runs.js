// QA Agents UI: runs. Klasyczny skrypt: wszystkie pliki z js/ dzielą jeden zakres globalny i ładują się po kolei (kolejność jest istotna).
/* ---------- runs: shared plumbing for Analyses, QA MCP and Autotests ---------- */
/* Each tab keeps its own history; the Analyses list holds everything that is neither. */
const OWN_TABS=['qamcp','autotest','planning','analysis','design','implementation','execution','completion'];
const TAB_OF=a=>OWN_TABS.includes(a)?a:'runs';
const RUN_TABS=['runs','qamcp','autotest','planning','analysis','design','implementation','execution','completion'];
const PANEL={runs:'#detail',qamcp:'#qDetail',autotest:'#aDetail',planning:'#pfDetail',analysis:'#anDetail',design:'#dsDetail',implementation:'#imDetail',execution:'#exDetail',completion:'#cpDetail'};
const LIST={runs:'#list',qamcp:'#qList',autotest:'#aList',planning:'#pfList',analysis:'#anList',design:'#dsList',implementation:'#imList',execution:'#exList',completion:'#cpList'};
const LIST_COUNT={runs:'#listCount',qamcp:'#qListCount',autotest:'#aListCount',planning:'#pfListCount',analysis:'#anListCount',design:'#dsListCount',implementation:'#imListCount',execution:'#exListCount',completion:'#cpListCount'};
/* ---------- Test Flow chaining ---------- */
/* Which phase's finished report feeds which phase's input. Monitoring & control has no per-ticket
   report, so it is never a link in this chain — "push to next phase" simply does not exist there. */
const FLOW_NEXT={planning:'analysis',analysis:'design',design:'implementation',implementation:'execution',execution:'completion'};
const FLOW_LABEL={planning:'Planning',analysis:'Analysis',design:'Design',implementation:'Implementation',execution:'Execution',completion:'Completion'};
let flowMode='manual',flowAutoSince=0;
try{
  if(localStorage.getItem('flow.mode')==='auto')flowMode='auto';
  flowAutoSince=Number(localStorage.getItem('flow.autoSince'))||0;
}catch(_){}
function setFlowMode(v){
  const next=v==='auto'?'auto':'manual';
  /* Turning auto on arms it from this moment only — otherwise every phase run ever finished without
     being manually pushed (effectively the whole run history, across every ticket) would all fire
     their "push to next phase" at once the instant auto mode switches on, which looked like several
     unrelated tabs suddenly starting to run on their own. */
  if(next==='auto'&&flowMode!=='auto'){
    flowAutoSince=Date.now();
    try{localStorage.setItem('flow.autoSince',String(flowAutoSince))}catch(_){}
  }
  flowMode=next;
  try{localStorage.setItem('flow.mode',flowMode)}catch(_){}
  document.querySelectorAll('#flowMode button').forEach(b=>b.classList.toggle('on',b.dataset.m===flowMode));
}
/* Auto mode: when the run-status poll below sees a chainable run finish, push it on its own —
   no click needed — and follow it by switching to the phase it just started, so the whole
   Planning-to-Completion pass is something you watch happen, not something you have to drive. */
const flowPushing=new Set(),flowFailed=new Set(),flowSummarized=new Set();
async function autoPushCheck(list){
  if(flowMode!=='auto')return;
  for(const r of list){
    /* Completion has no next phase to push to — the chain's last step opens Run Summary instead,
       once per finished Completion run, same arm-from-now-on guard as a normal push. */
    if(r.agent==='completion'){
      if(r.status!=='done'||flowSummarized.has(r.id))continue;
      if(!r.finishedAt||r.finishedAt<flowAutoSince)continue;
      flowSummarized.add(r.id);
      if(current&&current.id===r.id)rsAutoOpen(r.ticket);
      else toast('Completion for '+String(r.ticket).slice(0,60)+' has finished. The Run Summary is ready.');
      continue;
    }
    if(r.status!=='done'||r.pushedTo||!FLOW_NEXT[r.agent]||flowPushing.has(r.id)||flowFailed.has(r.id))continue;
    if(!r.finishedAt||r.finishedAt<flowAutoSince)continue;
    flowPushing.add(r.id);
    /* Only jump the view to the new phase if the tester is actually looking at the run that just
       finished — otherwise an unrelated auto-push (a different ticket's chain moving on in the
       background) would yank them away from a report they're in the middle of reading. */
    const watching=current&&current.id===r.id;
    try{
      const next=await post('/api/runs/'+r.id+'/push',{auto:true});
      r.pushedTo=next.id;
      if(watching){showTab(next.agent);await open(next.id)}
      else toast(FLOW_LABEL[r.agent]+' for '+String(r.ticket).slice(0,60)+' finished and moved on to '+FLOW_LABEL[next.agent]+'.');
    }catch(e){flowFailed.add(r.id)}
    finally{flowPushing.delete(r.id)}
  }
}
$('#flowMode').onclick=e=>{const b=e.target.closest('[data-m]');if(b)setFlowMode(b.dataset.m)};
setFlowMode(flowMode);
const LIST_EMPTY={
  runs:'No analyses yet. Run the first one above.',
  qamcp:'No test processes run yet. Describe one above.',
  autotest:'No autotests written yet. Describe a case above.',
  planning:'No planning checks run yet. Enter a backlog task above.',
  analysis:'No analysis checks run yet. Enter a backlog task above.',
  design:'No test designs written yet. Enter a ticket or requirement above.',
  implementation:'No implementation procedures written yet. Enter a test design above.',
  execution:'No executions run yet. Paste a Phase 5 procedure above.',
  completion:'No tasks explained yet. Enter a completed task above.',
};
const GUIDE={
  runs:[
    ['Select the agent','Each agent covers one product area and reads its own repositories.'],
    ['Enter the ticket','Enter a Jira key or describe what to check. Without a key, the agent checks your description against Jira, Confluence and the code.'],
    ['Review the report','Follow the activity log while the run is in progress. Confirmed defects can be added to the registry or replicated in QA MCP.'],
  ],
  qamcp:[
    ['Describe the process','Write the steps in plain words.'],
    ['The agent runs it','Every read and write is sent to the environment shown in the form.'],
    ['Check the evidence','The log lists every endpoint called and every value read. The result is a short verdict with replication steps.'],
    ['Create autotests','A finished run can be turned into API tests with pytest or UI tests with Playwright.'],
  ],
  autotest:[
    ['Describe the case','Describe one behaviour as you would in a test plan.'],
    ['Choose a folder','If left empty, the folder is chosen by topic.'],
    ['Review the tests','Each test checks one thing and has a short scenario and a descriptive name.'],
  ],
  planning:[
    ['Enter the task','Enter a Jira key or the task description.'],
    ['Feasibility check','The agent reads the relevant code first to find impossible or conflicting assumptions.'],
    ['Review the plan','Product and project risks with their sources, entry and exit criteria and a verdict on readiness.'],
  ],
  analysis:[
    ['Enter the task','Enter a Jira key or the task description.'],
    ['Test strategy','The agent selects one strategy and justifies it with the history and risk of the task.'],
    ['Review the analysis','Current coverage, dependent repositories and a prioritised scope for Design.'],
  ],
  design:[
    ['Enter the scope','Enter a Jira key or the requirement.'],
    ['Evidence first','The agent reads the code, the latest specification and the bug registry before writing any check.'],
    ['Review the design','Numbered test cases, each traceable to its source.'],
  ],
  implementation:[
    ['Enter the test design','Enter a ticket key or paste the test design report.'],
    ['Priorities and estimates','Each point receives a priority based on risk and a time estimate.'],
    ['Review the procedure','A ready procedure traced back to every test design point.'],
  ],
  execution:[
    ['Enter the procedure','Paste the procedure from Implementation.'],
    ['The agent runs it','Every failure is repeated once before it is reported.'],
    ['Review the report','Confirmed defects with retest evidence and a short verdict.'],
  ],
  completion:[
    ['Enter a finished task','Enter the Jira key of a completed ticket.'],
    ['The agent explains it','A short explanation of what the change does and why, based on the ticket.'],
    ['Knowledge base','The explanation is kept in the history and can be searched later.'],
  ],
};

/* Autotests has two tabs over one history: pytest (API tests) and Playwright (UI tests). Each run remembers its layer. */
let aLayer='api'; try{if(localStorage.getItem('at.layer')==='ui')aLayer='ui'}catch(_){}
const runLayer=r=>r.layer==='ui'?'ui':'api';
const tabRuns=t=>RUNS.filter(r=>TAB_OF(r.agent)===t&&(t!=='autotest'||runLayer(r)===aLayer));
const LAYER_UI={
  api:{title:'Write an API test',empty:'No API autotests written yet. Describe a case above.',
    placeholder:`Describe it the way you would write it in a test plan, e.g.

Changing a group's default setting must not change the
setting of an account that already has its own value.`,
    folder:'Picked by topic if left blank',notes:'e.g. add it to the existing test_create_item.py'},
  ui:{title:'Write a UI test',empty:'No Playwright autotests written yet. Describe a case above.',
    placeholder:`Describe what a user does on a screen of the web app, e.g.

Notifications: filtering by a rule name shows only that rule's
notifications, and the count under the table matches what the
backend returns for the same filter.`,
    folder:'Picked by menu section if left blank',notes:'e.g. extend the existing page object for this screen',
    hint:''},
};
let AT_META=null, AT_API_HINT='';

const runItem=r=>`
    <div class="item ${current&&current.id===r.id?'on':''}" data-id="${r.id}" title="${esc(String(r.ticket).slice(0,300))}">
      <div class="it-main"><b>${esc(String(r.ticket).slice(0,80))}</b><small><span class="ag">${esc(r.label)}</span><span>·</span><span>${fmt(r.startedAt)}</span><span>·</span><span>${dur(r)}</span></small></div>
      ${pill(r.status,STAT[r.status])}
    </div>`;

let runsSig='';
async function refreshAll(){
  /* Karta w tle nie odpytuje serwera; po powrocie odświeżamy od razu (visibilitychange). */
  if(document.hidden)return;
  let next;
  try{next=await api('/api/runs');setConn(true)}catch(e){setConn(false);return}
  /* Bez zmian w danych i bez trwających runów nie przebudowujemy list (koniec migotania i utraty hovera). */
  const sig=JSON.stringify(next);
  if(sig===runsSig){
    if(next.some(r=>r.status==='running'))next.forEach(r=>{if(r.status!=='running')return;const it=document.querySelector('.item[data-id="'+r.id+'"] small span:last-child');if(it)it.textContent=dur(r)});
    return;
  }
  runsSig=sig;RUNS=next;renderPipe();
  autoPushCheck(next);
  for(const t of RUN_TABS){
    const rs=tabRuns(t);
    $(LIST[t]).innerHTML=rs.length?rs.map(runItem).join(''):`<div class="list-empty">${t==='autotest'?LAYER_UI[aLayer].empty:LIST_EMPTY[t]}</div>`;
    $(LIST_COUNT[t]).textContent=rs.length?`${rs.length} run${rs.length===1?'':'s'}`:'';
    const live=rs.filter(r=>r.status==='running').length, nb=$('#nb-'+t);
    nb.hidden=!live; nb.textContent=live; nb.title=live?`${live} running`:'';
    if(!current||TAB_OF(current.agent)!==t)renderOverview(t,rs);
  }
}
RUN_TABS.forEach(t=>{
  $(LIST[t]).onclick=e=>{const it=e.target.closest('.item');if(it)open(it.dataset.id)};
  /* The overview's recent-runs table opens a run the same way the history list does. */
  $(PANEL[t]).addEventListener('click',e=>{const r=e.target.closest('tr[data-id]');if(r)open(r.dataset.id)});
});

/* With no run open, the right-hand panel summarises the tab's history instead of sitting empty. */
function renderOverview(t,rs){
  const el=$(PANEL[t]);
  const n=k=>rs.filter(r=>r.status===k).length;
  const fin=rs.filter(r=>r.finishedAt).map(secs).sort((a,b)=>a-b);
  const med=fin.length?fin[Math.floor((fin.length-1)/2)]:null;
  const cost=rs.reduce((s,r)=>s+(r.costUsd||0),0);
  const kpi=(l,v,c='')=>`<div class="kpi"><div class="l">${l}</div><div class="v ${c}">${v}</div></div>`;
  const recent=rs.slice(0,8);
  el.innerHTML=`<div class="ov">
    <div class="ov-head"><div><h3>Overview</h3><p>No run selected. Start a new one, or open a past run from the history.</p></div></div>
    <div class="kpis">
      ${kpi('Total runs',rs.length)}
      ${kpi('Running',n('running'),n('running')?'warn':'')}
      ${kpi('Completed',n('done'),n('done')?'ok':'')}
      ${kpi('Failed',n('failed'),n('failed')?'bad':'')}
      ${kpi('Median duration',med==null?'—':fmtSecs(med))}
      ${kpi('Total cost',cost?'$'+cost.toFixed(2):'—')}
    </div>
    <div class="ov-sec"><h4>Recent runs</h4>${recent.length?`<div style="overflow-x:auto"><table class="dtbl">
      <thead><tr><th>Subject</th><th>Agent</th><th>Started</th><th class="r">Duration</th><th class="r">Cost</th><th>Status</th></tr></thead>
      <tbody>${recent.map(r=>`<tr data-id="${r.id}">
        <td class="t" title="${esc(String(r.ticket).slice(0,300))}">${esc(String(r.ticket).slice(0,90))}</td>
        <td>${esc(r.label)}</td><td>${fmt(r.startedAt)}</td>
        <td class="r mono">${dur(r)}</td><td class="r mono">${r.costUsd?'$'+r.costUsd.toFixed(2):'—'}</td>
        <td>${pill(r.status,STAT[r.status])}</td></tr>`).join('')}</tbody></table></div>`
      :`<div class="ov-empty">Nothing has run here yet.</div>`}</div>
    <div class="ov-sec"><h4>How it works</h4><ol class="steps">${GUIDE[t].map(([b,s],i)=>`<li><span class="n">0${i+1}</span><b>${b}</b>${s}</li>`).join('')}</ol></div>
  </div>`;
}

/* ---------- analyses ---------- */
/* Run buttons follow the availability of each agent; the hint under the field says what is missing. */
const AVAIL={qamcp:['#qGo','#qHint'],planning:['#pfGo','#pfHint'],analysis:['#anGo','#anHint'],design:['#dsGo','#dsHint'],implementation:['#imGo','#imHint'],execution:['#exGo','#exHint'],completion:['#cpGo','#cpHint']};
function applyAvailability(){
  for(const [mode,[go,hint]] of Object.entries(AVAIL)){
    const a=agents.find(x=>x.mode===mode);if(!a||!$(go))continue;
    $(go).disabled=!a.available;
    const h=$(hint);if(h)h.innerHTML=a.available?'':esc(a.reason||'Not available.')+(/Sources/.test(a.reason||'')?' <a href="#sources" data-tab-link="sources">Open Sources</a>':'');
  }
  const at=agents.find(a=>a.mode==='autotest');
  if(at){AT_API_HINT=at.hint||''; if(!at.available)$('#aGo').disabled=true}
}
async function refreshAvailability(){try{agents=await api('/api/agents');applyAvailability()}catch(_){}}
async function init(){
  RUN_TABS.forEach(t=>$(LIST[t]).innerHTML='<div class="sk"></div><div class="sk"></div><div class="sk"></div>');
  try{agents=await api('/api/agents');setConn(true)}
  catch(e){
    setConn(false);
    RUN_TABS.forEach(t=>$(PANEL[t]).innerHTML=emptyBox('inbox','Cannot reach the server','Retrying in a few seconds. Check that the Agent UI server is running.'));
    return setTimeout(init,4000);
  }
  applyAvailability();
  setALayer(aLayer);
  /* Preferuj agenta, który faktycznie ma czym wystartować; gdy żaden nie ma, renderAgents()
     wyjaśni dlaczego, zamiast zostawić pierwszego z listy wyglądającego na wybranego. */
  sel=(analysisAgents().find(a=>a.available)||analysisAgents()[0]||agents[0]).key; bSel=sel;
  renderAgents(); await refreshAll(); await loadBugs(); applyHash(); jobsPoll();
  /* Co 3 s, gdy coś trwa; co 12 s, gdy nic (lista i tak odpowiada 304, gdy bez zmian). */
  (async function loop(){await refreshAll();setTimeout(loop,RUNS.some(r=>r.status==='running')?3000:12000)})();
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshAll()});
  tick=setInterval(()=>{if(current&&current.status==='running'&&$('#elapsed'))$('#elapsed').textContent=dur(current)},1000);
}
const emptyBox=(icon,t,s)=>`<div class="empty">${ico(icon,28)}<b>${esc(t)}</b><span>${esc(s)}</span></div>`;

/* QA MCP and Autotests have their own tabs and forms, so neither appears in the Analyses picker. */
const analysisAgents=()=>agents.filter(a=>!OWN_TABS.includes(a.key));
function renderAgents(){
  const list=analysisAgents();
  if(list.length&&!list.some(a=>a.key===sel))sel=list[0].key;
  /* Niedostępny agent zostaje klikalny: wybranie go pokazuje, czego mu brakuje. Wyszarzony
     przycisk, który nic nie mówi poza tooltipem, jest tym, co czyni ten picker nieruchomym. */
  $('#agents').innerHTML=list.map(a=>`<button data-k="${a.key}" class="${a.key===sel?'on':''}${a.available?'':' muted'}"${a.available?'':` title="No CLAUDE.md in ${esc(a.dir||'')}"`}>${esc(a.label)}</button>`).join('');
  const a=agents.find(x=>x.key===sel)||{};
  showAgentWarning(a,list);
  $('#hint').textContent='';
  $('#ticketLabel').textContent=a.freeform?'Ticket or requirement':'Ticket key';
  const t=$('#ticket');
  t.placeholder=a.freeform?'Ticket key or task description. Add any context you want the agent to consider.':'Ticket key';
  t.style.height=a.freeform?'':'38px';t.style.minHeight=a.freeform?'':'0';
  $('#goKbd').parentNode.innerHTML=a.freeform?'or press <kbd>Ctrl</kbd> + <kbd id="goKbd">Enter</kbd>':'or press <kbd id="goKbd">Enter</kbd>';
}
$('#agents').onclick=e=>{const b=e.target.closest('button');if(b&&b.dataset.k){sel=b.dataset.k;renderAgents()}};

/* Dlaczego nic się nie da uruchomić — z nazwą katalogu, którego brakuje, bo to jedyna
   informacja, na podstawie której tester może to naprawić. Run gaśnie razem z tym. */
function showAgentWarning(a,list){
  const w=$('#agentWarn');
  const go=$('#go');
  if(a.available!==false){w.hidden=true;go.disabled=false;return}
  const allGone=list.length&&list.every(x=>!x.available);
  w.hidden=false;
  w.textContent=allGone
    ? `No analysis agent found in ${a.agentsRoot||'?'} . Set QA_AGENTS_ROOT to the folder with the agent directories and restart the server.`
    : `${a.label} cannot run: no CLAUDE.md in ${a.dir||'?'}.`;
  go.disabled=true;
}

$('#go').onclick=async()=>{
  $('#err').textContent='';$('#go').disabled=true;
  try{const m=await post('/api/runs',{agent:sel,ticket:$('#ticket').value,notes:$('#notes').value,dataFiles:FILES.runs});await open(m.id);FILE_UI.runs.clear()}
  catch(e){$('#err').textContent=e.message}
  $('#go').disabled=!((agents.find(x=>x.key===sel)||{}).available!==false);
};
/* ---------- QA MCP ---------- */
/* The strip answers, before the run starts, the one question worth knowing: which environment
   is this pointed at. Every request the process makes goes through — reads and writes alike. */
async function loadPlatStatus(sel='#qEnv'){
  const el=$(sel);
  let s; try{s=await api('/api/plat-status')}catch(e){el.innerHTML=`<span class="b bad">status unavailable</span>`;return}
  if(!s.configured){el.innerHTML=`<span class="b bad">No test environment</span><span class="note"><a href="#sources" data-tab-link="sources">Connect it in Sources</a></span>`;return}
  const host=(s.hosts[0]||'').replace(/^https?:\/\//,'').split('/')[0];
  el.innerHTML=[
    `<span class="b ok">${esc(host||'test environment')}</span>`,
    `<span class="b">${s.endpoints} endpoints</span>`,
    `<span class="note">${s.readOnly?'Read only. Only GET requests are sent.':'Reads and writes are sent to this environment.'}</span>`,
  ].join('');
}
$('#qGo').onclick=async()=>{
  $('#qErr').textContent='';$('#qGo').disabled=true;
  try{
    const m=await post('/api/runs',{agent:'qamcp',url:$('#qUrl').value.trim(),ticket:$('#qProcess').value,notes:$('#qNotes').value,scope:$('#qScope').value,dataFiles:FILES.qamcp});
    $('#qBrief').innerHTML='';
    await open(m.id);
    FILE_UI.qamcp.clear();
  }catch(e){$('#qErr').textContent=e.message}
  $('#qGo').disabled=false;
};
$('#qProcess').addEventListener('keydown',e=>{
  if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();$('#qGo').click()}
});

/* ---------- Test Flow: Phase 1 Planning ---------- */
$('#pfGo').onclick=async()=>{
  $('#pfErr').textContent='';$('#pfGo').disabled=true;
  try{
    const m=await post('/api/runs',{agent:'planning',ticket:$('#pfTask').value,notes:$('#pfNotes').value,dataFiles:FILES.planning});
    await open(m.id);
    FILE_UI.planning.clear();
  }catch(e){$('#pfErr').textContent=e.message}
  $('#pfGo').disabled=false;
};
$('#pfTask').addEventListener('keydown',e=>{
  if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();$('#pfGo').click()}
});

/* ---------- Test Flow: Phase 3 Analysis ---------- */
$('#anGo').onclick=async()=>{
  $('#anErr').textContent='';$('#anGo').disabled=true;
  try{
    const m=await post('/api/runs',{agent:'analysis',ticket:$('#anTask').value,notes:$('#anNotes').value,dataFiles:FILES.analysis});
    await open(m.id);
    FILE_UI.analysis.clear();
  }catch(e){$('#anErr').textContent=e.message}
  $('#anGo').disabled=false;
};
$('#anTask').addEventListener('keydown',e=>{
  if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();$('#anGo').click()}
});

/* ---------- Test Flow: Phase 5 Implementation ---------- */
$('#imGo').onclick=async()=>{
  $('#imErr').textContent='';$('#imGo').disabled=true;
  try{
    const m=await post('/api/runs',{agent:'implementation',ticket:$('#imTask').value,notes:$('#imNotes').value,dataFiles:FILES.implementation});
    await open(m.id);
    FILE_UI.implementation.clear();
  }catch(e){$('#imErr').textContent=e.message}
  $('#imGo').disabled=false;
};
$('#imTask').addEventListener('keydown',e=>{
  if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();$('#imGo').click()}
});

/* ---------- Test Flow: Phase 6 Execution ---------- */
$('#exGo').onclick=async()=>{
  $('#exErr').textContent='';$('#exGo').disabled=true;
  try{
    const m=await post('/api/runs',{agent:'execution',ticket:$('#exProcess').value,notes:$('#exNotes').value,scope:$('#exScope').value,dataFiles:FILES.execution});
    await open(m.id);
    FILE_UI.execution.clear();
  }catch(e){$('#exErr').textContent=e.message}
  $('#exGo').disabled=false;
};
$('#exProcess').addEventListener('keydown',e=>{
  if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();$('#exGo').click()}
});

/* ---------- Test Flow: Phase 7 Completion ---------- */
$('#cpGo').onclick=async()=>{
  $('#cpErr').textContent='';$('#cpGo').disabled=true;
  try{
    const m=await post('/api/runs',{agent:'completion',ticket:$('#cpTask').value,notes:$('#cpNotes').value,dataFiles:FILES.completion});
    await open(m.id);
    FILE_UI.completion.clear();
  }catch(e){$('#cpErr').textContent=e.message}
  $('#cpGo').disabled=false;
};
$('#cpTask').addEventListener('keydown',e=>{
  if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();$('#cpGo').click()}
});

/* ---------- Test Flow: Phase 4 Design (existing Test Design agent, exposed here instead of the Analyses picker) ---------- */
$('#dsGo').onclick=async()=>{
  $('#dsErr').textContent='';$('#dsGo').disabled=true;
  try{
    const m=await post('/api/runs',{agent:'design',ticket:$('#dsTask').value,notes:$('#dsNotes').value,dataFiles:FILES.design});
    await open(m.id);
    FILE_UI.design.clear();
  }catch(e){$('#dsErr').textContent=e.message}
  $('#dsGo').disabled=false;
};
$('#dsTask').addEventListener('keydown',e=>{
  if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();$('#dsGo').click()}
});

/* ---------- Autotests ---------- */
/* Areas are read from tests/ itself, so the suggestions cannot drift from what is there. */
async function loadAutotestMeta(){
  const el=$('#aEnv');
  let m; try{m=await api('/api/autotest-meta')}catch(e){el.innerHTML=`<span class="b bad">repo unreachable</span>`;return}
  if(!m.available){
    el.innerHTML=`<span class="b bad">autotests/ not found</span><span class="note">${esc(m.repo)}</span>`;
    $('#aGo').disabled=true;return;
  }
  $('#aGo').disabled=false;
  AT_META=m;renderAutotestMeta();
}
/* Areas and counts of the active tab: tests/<area> for pytest, tests/ui/<area> for Playwright. */
function renderAutotestMeta(){
  const m=AT_META; if(!m)return;
  const ui=aLayer==='ui', part=ui?(m.ui||{folders:[],tests:0}):m;
  $('#folderList').innerHTML=part.folders.map(f=>`<option value="${esc(f)}">`).join('');
  $('#aEnv').innerHTML=[
    `<span class="b ok">autotests/${ui?'tests/ui/':''}</span>`,
    `<span class="b">${part.tests} test file${part.tests===1?'':'s'} · ${part.folders.length} area${part.folders.length===1?'':'s'}</span>`,
    `<span class="note">${ui?'Playwright tests in the UI folder.':'Follows the style of the existing tests.'}</span>`,
  ].join('');
}
function setALayer(l){
  aLayer=l==='ui'?'ui':'api';
  try{localStorage.setItem('at.layer',aLayer)}catch(_){}
  const L=LAYER_UI[aLayer];
  document.querySelectorAll('#aLayer button').forEach(b=>{const on=b.dataset.l===aLayer;b.classList.toggle('on',on);b.setAttribute('aria-selected',on)});
  $('#aTitle').textContent=L.title;
  $('#aCase').placeholder=L.placeholder;
  $('#aFolder').placeholder=L.folder;
  $('#aNotes').placeholder=L.notes;
  $('#aHint').textContent='';
  renderAutotestMeta();
  /* A run of the other layer stays in its own tab's history, so its detail closes with the switch. */
  if(current&&TAB_OF(current.agent)==='autotest'&&runLayer(current)!==aLayer){if(es){es.close();es=null}current=null}
  runsSig='';refreshAll();
}
$('#aLayer').onclick=e=>{const b=e.target.closest('button[data-l]');if(b&&b.dataset.l!==aLayer)setALayer(b.dataset.l)};
$('#aGo').onclick=async()=>{
  $('#aErr').textContent='';$('#aGo').disabled=true;
  try{
    const m=await post('/api/runs',{agent:'autotest',layer:aLayer,ticket:$('#aCase').value,notes:$('#aNotes').value,folder:$('#aFolder').value,dataFiles:FILES.autotest});
    await open(m.id);
    FILE_UI.autotest.clear();
  }catch(e){$('#aErr').textContent=e.message}
  $('#aGo').disabled=false;
};
$('#aCase').addEventListener('keydown',e=>{
  if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();$('#aGo').click()}
});

$('#ticket').addEventListener('keydown',e=>{
  const ff=(agents.find(a=>a.key===sel)||{}).freeform;
  if(e.key==='Enter'&&(e.ctrlKey||!ff)){e.preventDefault();$('#go').click()}
});

/* Live character count under the long free-text fields; the server limit is 8000. */
function bindCount(inputSel,cntSel,max){
  const el=$(inputSel),c=$(cntSel);
  const upd=()=>{const n=el.value.trim().length;c.textContent=n?n+' / '+max+' chars':'';c.classList.toggle('over',n>max)};
  el.addEventListener('input',upd);upd();
}
bindCount('#qProcess','#qCnt',8000);bindCount('#aCase','#aCnt',8000);bindCount('#exProcess','#exCnt',8000);

/* ---------- run detail ---------- */
const KIND={endpoint:['ep','API'],tool:['tool','TOOL'],text:['say','MSG'],status:['st','SYS']};
/* HTTP method of each mcp-server endpoint, from the Tools catalogue; loaded once, then paints the endpoint lines by method. */
const EPM={map:null,p:null};
function paintEp(el){
  const mt=EPM.map&&EPM.map[el.dataset.ep];if(!mt)return;
  el.classList.add('m-'+mt);el.querySelector('.k').textContent=mt;
}
function epMethods(){
  if(!EPM.map&&!EPM.p)EPM.p=api('/api/tools').then(d=>{
    const m={};(d.groups||[]).forEach(g=>g.endpoints.forEach(e=>{m[e.name]=e.method}));
    EPM.map=m;document.querySelectorAll('.feed .ln.ep[data-ep]').forEach(paintEp);
  }).catch(()=>{EPM.p=null});
}
async function open(id){
  if(es){es.close();es=null}
  const d=await api('/api/runs/'+id); current=d.meta; current.view=d.view;current.chat=d.chat;current.batteries=d.batteries;current.quality=d.quality;
  const m=d.meta, tab=TAB_OF(m.agent), panel=PANEL[tab];
  m.eps=d.events.filter(e=>e.type==='endpoint'||e.type==='browser').length;
  /* An autotest run opens in the tab of its own layer (e.g. from QA MCP's Create autotests with Playwright). */
  if(tab==='autotest'&&runLayer(m)!==aLayer)setALayer(runLayer(m));
  /* One detail panel at a time. The other tabs fall back to their overview, so the ids below stay unique. */
  RUN_TABS.forEach(t=>{if(t!==tab)renderOverview(t,tabRuns(t))});
  const t=String(m.ticket);
  const req=[];
  if(tab==='autotest')req.push(['Type',runLayer(m)==='ui'?'Playwright · UI test':'pytest · API test']);
  if(t.length>70)req.push(['Input',esc(t)]);
  if(m.notes)req.push(['Context',esc(m.notes)]);
  if(m.folder)req.push(['Area',`<span class="mono">tests/${esc(m.folder)}</span>`]);
  if(m.dataFiles&&m.dataFiles.length)req.push([m.dataFiles.length===1?'Data file':'Data files',m.dataFiles.map(f=>`<span class="mono">${esc(f)}</span>`).join(', ')]);
  if(m.brief)req.push(['Brief',esc(m.brief)]);
  if(m.source)req.push(['Source','<button class="linkbtn" data-open-run="'+esc(m.source)+'">Open the QA MCP run this was made from</button>']);
  $(panel).innerHTML=`
    <div class="detail-head">
      <div class="dh-main">
        <div class="eyebrow"><b>${esc(m.label)}</b><span>·</span><span class="mono">${esc(m.id)}</span></div>
        <h3 id="title"></h3>
        <div class="metarow" id="meta"></div>
      </div>
      <div class="dh-actions"><span id="actions"></span><button class="btn icon" id="closeRun" title="Close" aria-label="Close run">${ico('x')}</button></div>
    </div>
    <div class="body">
      ${req.length?`<div class="section"><div class="sec-head"><h4>Request</h4></div><dl class="reqkv">${req.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></div>`:''}
      <div class="section"><div class="sec-head"><h4>Activity log</h4><span class="sec-meta" id="evCount"></span></div><div class="feed" id="feed"></div></div>
      <div class="section" id="result"></div>
    </div>`;
  $('#closeRun').onclick=()=>{if(es){es.close();es=null}current=null;refreshAll()};
  const feed=$('#feed'); let n=0, live=false;
  const add=ev=>{
    if(ev.type==='end')return reload(id);
    const w=feed.querySelector('.wait'); if(w)w.remove();
    const [kind,tag]=KIND[ev.type]||['st',String(ev.type||'').toUpperCase()];
    const el=document.createElement('div');
    el.className='ln '+kind+(ev.who==='sub'?' sub':'');
    /* An endpoint line is the test's evidence, so the tool name is set apart from its argument. */
    const inner=ev.type==='endpoint'
      ? (()=>{const [nm,...rest]=String(ev.text).split(' · ');
              return `<b>${esc(nm)}</b>${rest.length?' · '+esc(rest.join(' · ')):''}`})()
      : esc(ev.type==='text'?ev.text.slice(0,300):ev.text);
    el.innerHTML=`<span class="k">${tag}</span><span class="tx">${inner}</span>`;
    if(ev.type==='endpoint'){el.dataset.ep=String(ev.text).split(' · ')[0];paintEp(el);epMethods()}
    feed.appendChild(el);if(live)feed.scrollTop=feed.scrollHeight;
    const c=$('#evCount'); if(c)c.textContent=`${++n} event${n===1?'':'s'}`;
  };
  d.events.forEach(ev=>ev.type!=='end'&&add(ev));
  live=true;feed.scrollTop=feed.scrollHeight;
  if(!feed.children.length)feed.innerHTML='<div class="ln wait"><span class="k">…</span><span class="tx">Waiting for the first event…</span></div>';
  paint(m);
  if(m.status==='running'){
    es=new EventSource('/api/runs/'+id+'/events');let skip=d.events.length;
    es.onmessage=e=>{if(skip>0){skip--;return}add(JSON.parse(e.data))};
    es.onerror=()=>{es&&es.close()};
  }
  refreshAll();
}
async function reload(id){const d=await api('/api/runs/'+id);current=d.meta;current.view=d.view;current.chat=d.chat;current.batteries=d.batteries;current.quality=d.quality;current.eps=d.events.filter(e=>e.type==='endpoint').length;paint(d.meta);refreshAll();if(es){es.close();es=null}}
