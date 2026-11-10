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
      else toast('Completion for '+String(r.ticket).slice(0,60)+' finished — Run Summary is ready.');
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
    ['Pick the agent','Each agent covers one product area and reads its own repositories.'],
    ['Enter the ticket','A Jira key such as PRJ-297 — or just say what to check. Without a key the agent verifies your text against Jira, Confluence and the code.'],
    ['Review the report','Follow the activity log live. When the run completes, log confirmed defects straight to the registry — or press Replicate in QA MCP to have the prompt engineer turn the result into a process QA MCP runs to reproduce it.'],
  ],
  qamcp:[
    ['Describe the process','Write the steps in plain words, the way you would brief a colleague.'],
    ['It runs for real','Every read and write goes through mcp-server to the environment shown in the form.'],
    ['Check the evidence','The log lists each endpoint called and the values read; the answer is a short verdict with replication steps.'],
    ['Turn it into autotests','When the run is done, Create autotests asks for the test type: pytest (API) or Playwright (UI, on the CORE screens that call the same endpoints). The Autotests agent then saves small, plainly named tests in autotests/.'],
  ],
  autotest:[
    ['Describe the case','One behaviour, written the way it would appear in a test plan.'],
    ['Choose an area','Optional — leave it blank and the folder under tests/ is picked by topic.'],
    ['Review the tests','Each test checks one thing, has a short plain-language scenario and a name that says what is tested. Files are saved locally and checked with pytest.'],
  ],
  planning:[
    ['Enter the backlog task','A Jira key, or the task’s description/story if it has no key yet — it should already be well specified for this iteration.'],
    ['It checks feasibility first','A static/white-box pass reads the relevant repo before anything else, to catch impossible, illogical or conflicting assumptions.'],
    ['Review risk, entry and exit criteria','Product and project risk, each with a source — past bugs on similar tasks, a code location, or the ISTQB risk category — plus concrete entry/exit criteria and a verdict on whether the plan is ready for the next phase.'],
  ],
  analysis:[
    ['Enter the backlog task','A Jira key, or its description — ideally already checked by Phase 1 Planning.'],
    ['It picks one strategy, not seven','Justified against this task’s own history and risk — never a checklist of every ISTQB strategy type.'],
    ['Review coverage, blast radius and scope','What’s covered today, what repos actually depend on the changed component (checked for real, not assumed), and a prioritised scope ready for Phase 4.'],
  ],
  design:[
    ['Enter the scope','A Jira key, or the requirement itself — ideally the scope and priorities handed off from Phase 3 Analysis.'],
    ['It designs from evidence','Pulls the repo, the latest spec and the bug registry’s failure patterns before writing a single check.'],
    ['Review the test design','A short, pointed report: one numbered point per test design, each check traceable to a source, ready to hand to Phase 5.'],
  ],
  implementation:[
    ['Paste the Phase 4 test design','A ticket key, or the test design report itself — every point gets merged into one procedure, nothing dropped.'],
    ['It prioritises and estimates time','Each point gets a priority from real risk (Phase 1/3, or the bug registry) and a time estimate — never a guess.'],
    ['Review the ready-to-run procedure','Traced back to every Phase 4 point, written the way QA MCP/Execution expects it — paste it straight into Phase 6.'],
  ],
  execution:[
    ['Paste the Phase 5 procedure','The merged, prioritised procedure — executed step by step in the order given.'],
    ['It runs for real, and retests failures','Every read and write goes through mcp-server to the live environment; a failure is repeated once before it’s reported, to rule out a blip.'],
    ['Review the defect report','The same evidence-based report format as QA MCP — confirmed defects, retest evidence, and a short verdict.'],
  ],
  completion:[
    ['Enter a finished task','A Jira key for a completed ticket — its description, comments and linked discussion.'],
    ['It explains, it doesn’t just summarise','A short, plain-English answer to “what does this do and why” — grounded in the ticket, not reworded boilerplate.'],
    ['Builds the knowledge base','Stays in history as a searchable record — the next tester asking the same question finds the answer here.'],
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
    hint:'Playwright drives the web app in a browser; the backend supplies the expected values, setup and cleanup. Tests go to tests/ui/, selectors to page objects in utils/pages/.'},
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
async function init(){
  RUN_TABS.forEach(t=>$(LIST[t]).innerHTML='<div class="sk"></div><div class="sk"></div><div class="sk"></div>');
  try{agents=await api('/api/agents');setConn(true)}
  catch(e){
    setConn(false);
    RUN_TABS.forEach(t=>$(PANEL[t]).innerHTML=emptyBox('inbox','Cannot reach the server','Retrying in a few seconds. Check that the Agent UI server is running.'));
    return setTimeout(init,4000);
  }
  const q=agents.find(a=>a.mode==='qamcp');
  if(q){$('#qHint').textContent=q.hint; if(!q.available)$('#qGo').disabled=true}
  const at=agents.find(a=>a.mode==='autotest');
  if(at){AT_API_HINT=at.hint||''; if(!at.available)$('#aGo').disabled=true}
  const pf=agents.find(a=>a.mode==='planning');
  if(pf){$('#pfHint').textContent=pf.hint||''; if(!pf.available)$('#pfGo').disabled=true}
  const an=agents.find(a=>a.mode==='analysis');
  if(an){$('#anHint').textContent=an.hint||''; if(!an.available)$('#anGo').disabled=true}
  const ds=agents.find(a=>a.mode==='design');
  if(ds){$('#dsHint').textContent=ds.hint||''; if(!ds.available)$('#dsGo').disabled=true}
  const im=agents.find(a=>a.mode==='implementation');
  if(im){$('#imHint').textContent=im.hint||''; if(!im.available)$('#imGo').disabled=true}
  const ex=agents.find(a=>a.mode==='execution');
  if(ex){$('#exHint').textContent=ex.hint||''; if(!ex.available)$('#exGo').disabled=true}
  const cp=agents.find(a=>a.mode==='completion');
  if(cp){$('#cpHint').textContent=cp.hint||''; if(!cp.available)$('#cpGo').disabled=true}
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
  $('#hint').textContent=a.hint||'';
  $('#ticketLabel').textContent=a.freeform?'Ticket or requirement':'Ticket key';
  const t=$('#ticket');
  t.placeholder=a.freeform?'e.g. SVC-318 — or the requirement itself: markup update must reject values outside 0–100':'e.g. OPS-170';
  t.style.height=a.freeform?'96px':'38px';
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
    ? `No analysis agent found in ${a.agentsRoot||'?'} — expected claudeAgent/, claudeAgentB/, claudeAgentMcp/ and claudeAgentTestDesign/, each with a CLAUDE.md. Set QA_AGENTS_ROOT to the folder that holds them and restart the server.`
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
  if(!s.configured){el.innerHTML=`<span class="b bad">mcp-server not configured</span><span class="note">Fill in mcp-server/.env first.</span>`;return}
  const host=(s.hosts[0]||'').replace(/^https?:\/\//,'').split(':')[0];
  el.innerHTML=[
    `<span class="b ok">env ${esc(s.environment||'?')}</span>`,
    host?`<span class="b">${esc(host)}</span>`:'',
    `<span class="note">Reads and writes both go through — this hits the real environment.</span>`,
  ].join('');
}
$('#qGo').onclick=async()=>{
  $('#qErr').textContent='';$('#qGo').disabled=true;
  try{
    const m=await post('/api/runs',{agent:'qamcp',ticket:$('#qProcess').value,notes:$('#qNotes').value,scope:$('#qScope').value,dataFiles:FILES.qamcp});
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
    `<span class="note">${ui?'Playwright, logged in to the web app. Style comes from tests/ui/ and utils/pages/.':'Style comes from the tests already in this folder.'}</span>`,
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
  $('#aHint').textContent=aLayer==='ui'?L.hint:AT_API_HINT;
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
  m.eps=d.events.filter(e=>e.type==='endpoint').length;
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
      <div class="dh-actions"><span id="actions"></span><button class="btn icon" id="closeRun" title="Close — back to overview" aria-label="Close run">${ico('x')}</button></div>
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
