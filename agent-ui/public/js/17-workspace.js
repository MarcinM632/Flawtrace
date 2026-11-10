// QA Agents UI: Workspace. Klasyczny skrypt: wszystkie pliki z js/ dzielą jeden zakres globalny i ładują się po kolei (kolejność jest istotna).
/* "Co teraz testować": zadania przypisane do mnie w Jirze, już posortowane przez serwer
   (lib/workspace.js) — priorytet Jiry, przy remisie ryzyko serwisu z rejestru błędów. Klik na task
   otwiera JEDEN panel "Details" z trzema sekcjami: w którym momencie jest (historia runów tej appki +
   faza Test Flow), jaki ma coverage (lib/coverage.js), i co jeszcze trzeba przetestować (checklist +
   dopasowane autotesty). "What should I do now?" to osobne, jednorazowe pytanie (na klik, nie w tle)
   nad tymi samymi, już policzonymi danymi — patrz POST /api/workspace/advise. */
let WS_TASKS=[],WS_META={},wsTimer=null,wsOpen=new Set(),wsCovTimer=null;
const wsGuidanceCache={},wsActivityCache={},wsReportCache={};

const WS_PRI_COLOR=p=>{const s=String(p||'').toLowerCase();
  return /block|highest|critical/.test(s)?'var(--bad)':/high/.test(s)?'var(--app-2)':/low/.test(s)?'var(--ink3)':'var(--info)'};
const wsPriPill=p=>`<span class="pill" style="color:${WS_PRI_COLOR(p)};border-color:color-mix(in srgb,${WS_PRI_COLOR(p)} 40%,transparent);background:color-mix(in srgb,${WS_PRI_COLOR(p)} 14%,transparent)"><span class="d" style="background:${WS_PRI_COLOR(p)}"></span>${esc(p||'No priority')}</span>`;

// Coverage: diff z repo serwisu (od daty ticketu) vs wykonane testy, policzony automatycznie na nowy
// komentarz w Jirze (lib/coverage.js). "null" percent = brak commitów do oceny (nic jeszcze nie zmieniono).
const WS_COV_COLOR=pct=>pct==null?'var(--ink3)':pct>=80?'var(--ok)':pct>=40?'var(--app-2)':'var(--bad)';
function wsCovPill(c){
  if(!c||c.ok==null)return'';
  if(c.checking)return`<span class="pill" style="color:var(--ink3)">Checking coverage…</span>`;
  if(c.error)return`<span class="pill" style="color:var(--bad)">Coverage: ${esc(c.error)}</span>`;
  if(c.percent==null)return`<span class="pill" style="color:var(--ink3)">Coverage: no diff yet</span>`;
  const col=WS_COV_COLOR(c.percent);
  return`<span class="pill" style="color:${col};border-color:color-mix(in srgb,${col} 40%,transparent);background:color-mix(in srgb,${col} 14%,transparent)"><span class="d" style="background:${col}"></span>${c.percent}% coverage</span>`;
}

// Etykiety faz Test Flow (lib/run-agent.js FLOW_NEXT) — "design" tutaj to Faza 4 Test design, nie mylić
// z ad-hoc agentami CORE/SVC/mcp (bez mode), które nie są częścią tego łańcucha.
const WS_FLOW_LABEL={planning:'Planning',analysis:'Analysis',design:'Test design',implementation:'Implementation',execution:'Execution',completion:'Completion'};

async function loadWorkspace(){
  clearTimeout(wsTimer);
  let d; try{d=await api('/api/workspace')}catch(e){$('#wsErr').textContent='Cannot reach the server.';return}
  WS_TASKS=d.tasks||[]; WS_META=d;
  renderWorkspace();
  if(d.busy && !$('#view-workspace').hidden) wsTimer=setTimeout(loadWorkspace,4000);
}

function wsAgo(ts){if(!ts)return'never fetched';const m=Math.max(0,Math.round((Date.now()-ts)/60000));return m<1?'just now':m+' min ago'}

function renderWorkspace(){
  $('#wsSub').textContent=`Your open tasks in PRJ / SVC / OPS, ranked by Jira priority, then by service risk from the bug registry. Last synced ${wsAgo(WS_META.fetchedAt)}${WS_META.busy?' · syncing…':''}.`;
  $('#wsErr').textContent=(WS_META.ok===false&&WS_META.error)?('Jira sync failed: '+WS_META.error):'';
  const next=WS_TASKS[0];
  $('#wsNextBox').innerHTML=next?`
    <div class="panel-h"><h2>Test this next</h2><span class="meta-r">${esc(next.label)} · ${esc(next.key)}</span></div>
    <div class="panel-b">${wsCard(next,true)}</div>
  `:`<div class="panel-b"><div class="empty">${ico('inbox',28)}<b>No open tasks assigned to you</b><span>Nothing in PRJ, SVC or OPS is currently assigned to you with an open status.</span></div></div>`;
  $('#wsCount').textContent=WS_TASKS.length?`${WS_TASKS.length} task${WS_TASKS.length===1?'':'s'}`:'';
  $('#wsList').innerHTML=WS_TASKS.length?WS_TASKS.map((t,i)=>wsCard(t,false,i)).join(''):(next?'':'');
  $('#view-workspace').querySelectorAll('[data-wsopen]').forEach(b=>b.onclick=()=>wsToggle(b.dataset.wsopen));
  $('#view-workspace').querySelectorAll('[data-wsread]').forEach(b=>b.onclick=()=>openJiraPrev(b.dataset.wsread));
  $('#view-workspace').querySelectorAll('[data-wsrecheck]').forEach(b=>b.onclick=()=>wsRecheck(b.dataset.wsrecheck));
  $('#view-workspace').querySelectorAll('[data-wsrunopen]').forEach(b=>b.onclick=()=>{showTab(TAB_OF(b.dataset.wsrunagent));open(b.dataset.wsrunopen)});
  wsOpen.forEach(k=>{wsLoadGuidance(k);wsLoadActivity(k);wsLoadReport(k)});
}

function wsCard(t,isTop,i){
  const open=wsOpen.has(t.key);
  return `<div class="ws-task${isTop?' ws-top':''}">
    <div class="ws-row">
      <div class="ws-main">
        <div class="ws-title"><span class="mono">${esc(t.key)}</span> ${esc(t.summary||'(no summary)')}</div>
        <div class="ws-meta">${wsPriPill(t.priority)} <span class="pill">${esc(t.status||'—')}</span> <span class="pill">${esc(t.type||'—')}</span> <span class="pill">${esc(t.label)}</span> <span class="pill">${esc(t.service)}</span> ${wsCovPill(t.coverage)}</div>
        <div class="ws-reason muted-note">${esc(t.reason)}</div>
      </div>
      <div class="ws-act">
        <button class="btn sm" data-wsread="${esc(t.key)}">Read ticket</button>
        <button class="btn sm" data-wsopen="${esc(t.key)}">${open?'Hide details':'Details'}</button>
      </div>
    </div>
    ${open?wsDetailPanel(t):''}
  </div>`;
}

/* Panel "Details": trzy sekcje nad danymi, które już mamy — historia runów + faza Test Flow (lib/workspace.js
   activityFor), coverage (lib/coverage.js, już dołączone do /api/workspace), i strategia testowa z dopasowanymi
   autotestami (lib/workspace.js guidanceFor, jak wcześniej). Activity i guidance dociągane leniwie przy otwarciu. */
function wsDetailPanel(t){
  const key=t.key, act=wsActivityCache[key], g=wsGuidanceCache[key], rep=wsReportCache[key];
  return `<div class="ws-guidance" id="wsd-${esc(key)}">
    <div class="ws-detail-h">What to do</div>
    ${rep?wsAdviseCard(rep,null):'<div class="spin">Loading…</div>'}
    <div class="ws-detail-h" style="margin-top:12px">Stage</div>
    ${act?wsStageBody(act):'<div class="spin">Loading…</div>'}
    <div class="ws-detail-h" style="margin-top:12px">Coverage</div>
    ${wsCovBody(t.coverage,key)}
    <div class="ws-detail-h" style="margin-top:12px">What still needs testing</div>
    ${g?wsChecklistBody(g):'<div class="spin">Loading…</div>'}
  </div>`;
}

function wsStageBody(act){
  if(act.error)return`<div class="err">${esc(act.error)}</div>`;
  if(!act.runs.length)return'<div class="muted-note">No agent runs yet for this ticket.</div>';
  const stageLine=act.stage?`<div class="muted-note">Furthest Test Flow phase reached: <b>${esc(WS_FLOW_LABEL[act.stage]||act.stage)}</b></div>`:'<div class="muted-note">No Test Flow phase has been run yet.</div>';
  return stageLine+`<ul class="ws-checklist">${act.runs.map(r=>`<li><button class="linkbtn" data-wsrunopen="${esc(r.id)}" data-wsrunagent="${esc(r.agent)}">${esc(r.label)}</button> — ${esc(r.status)}${r.reportStatus?' · '+esc(r.reportStatus):''}${r.staging?' · autotest '+esc(r.staging):''} <span class="ws-ago">${wsAgo(r.finishedAt||r.startedAt)}</span></li>`).join('')}</ul>`;
}

function wsCovBody(c,key){
  const btn=`<div style="margin-top:8px"><button class="btn sm" data-wsrecheck="${esc(key)}">${c&&c.ok!=null&&!c.checking?'Re-check':'Check now'}</button></div>`;
  if(!c||c.ok==null)return`<div class="muted-note">Not checked yet. The check runs after the next Jira comment.</div>${btn}`;
  if(c.checking)return'<div class="muted-note">Checking…</div>';
  if(c.error)return`<div class="err">${esc(c.error)}</div>${btn}`;
  if(c.percent==null)return`<div class="muted-note">${esc(c.note||'No commits to compare yet.')}</div>${btn}`;
  return `<div class="muted-note">${esc(c.repo||'')} · ${esc(c.note||'')}</div>
    <ul class="ws-checklist">${(c.rules||[]).map(r=>`<li>${r.covered?'✓':'✗'} ${esc(r.rule)}${r.covered&&r.evidence?': <span class="muted-note">'+esc(r.evidence)+'</span>':''}</li>`).join('')||'<li>No business-logic changes found in the diff.</li>'}</ul>${btn}`;
}

function wsChecklistBody(g){
  return `<ol class="ws-checklist">${g.checklist.map(s=>`<li>${esc(s)}</li>`).join('')}</ol>`;
}

function wsToggle(key){
  if(wsOpen.has(key))wsOpen.delete(key);else wsOpen.add(key);
  renderWorkspace();
}

async function wsLoadGuidance(key){
  if(wsGuidanceCache[key])return;
  try{wsGuidanceCache[key]=await api('/api/workspace/guidance/'+encodeURIComponent(key))}
  catch(e){wsGuidanceCache[key]={checklist:['Could not build a strategy for this task: '+(e.message||'')]}}
  renderWorkspace();
}

async function wsLoadActivity(key){
  if(wsActivityCache[key])return;
  try{wsActivityCache[key]=await api('/api/workspace/activity/'+encodeURIComponent(key))}
  catch(e){wsActivityCache[key]={runs:[],stage:null,error:e.message||'Could not load activity.'}}
  renderWorkspace();
}

async function wsLoadReport(key){
  if(wsReportCache[key])return;
  try{wsReportCache[key]=await api('/api/workspace/report/'+encodeURIComponent(key))}
  catch(e){wsReportCache[key]={stage:null,status:'',priority:'',label:'',service:'',staticTest:{done:false},testDesign:{done:false},coverage:null,autotestMatches:0}}
  renderWorkspace();
}

async function wsRecheck(key){
  try{await api('/api/coverage/'+encodeURIComponent(key)+'/check',{method:'POST'})}catch(e){return}
  delete wsReportCache[key];
  clearTimeout(wsCovTimer);
  let tries=0;
  const poll=async()=>{
    tries++;
    await loadWorkspace();
    const t=WS_TASKS.find(x=>x.key===key);
    if(t&&t.coverage&&!t.coverage.checking){delete wsReportCache[key];wsLoadReport(key);return}
    if(tries<20)wsCovTimer=setTimeout(poll,6000);
  };
  wsCovTimer=setTimeout(poll,3000);
}

$('#wsSync').onclick=async()=>{
  const b=$('#wsSync'); b.disabled=true;
  try{await api('/api/workspace/sync',{method:'POST'});setTimeout(loadWorkspace,1500)}catch(e){}
  finally{setTimeout(()=>b.disabled=false,1500)}
};

/* Checklista, nie proza: każdy wiersz to fakt już policzony server-side (activityFor/coverage/guidanceFor),
   zero oceny modelu. Kolejność = ranked() (priorytet Jiry, potem ryzyko serwisu) — #1 to "zrób to pierwsze". */
function wsAdviseLine(ok,text){return`<li class="${ok?'adv-ok':'adv-bad'}">${ok?'✓':'✗'} ${esc(text)}</li>`}
function wsAdviseCovLine(c){
  if(!c||c.ok==null)return wsAdviseLine(false,'Coverage not checked yet');
  if(c.checking)return wsAdviseLine(false,'Checking coverage');
  if(c.error)return wsAdviseLine(false,'Coverage — '+c.error);
  if(c.percent==null)return wsAdviseLine(false,c.note||'No changes to check yet');
  return wsAdviseLine(c.percent>=80&&!(c.gaps||[]).length,`Coverage — ${c.percent}%`+((c.gaps||[]).length?` (${c.gaps.length} gap${c.gaps.length===1?'':'s'})`:''));
}
function wsAdviseCard(t,rank){
  const stage=t.stage?(WS_FLOW_LABEL[t.stage]||t.stage):'No Test Flow run yet';
  const head=rank==null?'':`<div class="ws-adv-h"><b>#${rank}</b> <span class="mono">${esc(t.key)}</span> ${esc(t.summary||'(no summary)')} ${wsPriPill(t.priority)}</div>`;
  return `<div class="ws-adv-card">
    ${head}
    <div class="muted-note">Stage: ${esc(stage)} · Status: ${esc(t.status||'—')} · ${esc(t.label)}/${esc(t.service)}</div>
    <ul class="ws-checklist">
      ${wsAdviseLine(t.staticTest.done,'Static test'+(t.staticTest.status?' — '+t.staticTest.status:' — not done'))}
      ${wsAdviseLine(t.testDesign.done,'Test design'+(t.testDesign.status?' — '+t.testDesign.status:' — not done'))}
      ${wsAdviseCovLine(t.coverage)}
      ${wsAdviseLine(t.autotestMatches>0,t.autotestMatches>0?`${t.autotestMatches} matching autotest file(s)`:'No matching autotest file found')}
    </ul>
  </div>`;
}
function wsAdvisePending(items){
  if(!items.length)return'';
  return `<div class="ws-adv-card"><div class="ws-adv-h"><b>Awaiting review</b> <span class="muted-note">static test already auto-started by release-watch</span></div>
    <ul class="ws-checklist">${items.map(n=>`<li><button class="linkbtn" data-wsrunopen="${esc(n.runId||'')}" data-wsrunagent="${esc(n.agent||'')}">${esc(n.key)}</button> ${esc(n.summary||'')} <span class="pill">${esc(n.project)} ${esc(n.version||'')}</span></li>`).join('')}</ul>
  </div>`;
}

$('#wsAdviseBtn').onclick=async()=>{
  const b=$('#wsAdviseBtn'),out=$('#wsAdviseOut');
  b.disabled=true; out.innerHTML='<div class="spin">Loading…</div>';
  try{
    const r=await api('/api/workspace/advise',{method:'POST'});
    const cards=(r.tasks||[]).map((t,i)=>wsAdviseCard(t,i+1)).join('');
    out.innerHTML=(cards||'<div class="muted-note">No open tasks assigned to you.</div>')+wsAdvisePending(r.pending||[]);
    out.querySelectorAll('[data-wsrunopen]').forEach(b2=>b2.onclick=()=>{
      const id=b2.dataset.wsrunopen,agent=b2.dataset.wsrunagent;
      if(!id)return;
      showTab(TAB_OF(agent));open(id);
    });
  }catch(e){out.innerHTML=`<div class="err">${esc(e.message||'Could not build the report.')}</div>`}
  finally{b.disabled=false}
};
