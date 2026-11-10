// QA Agents UI: bugs. Klasyczny skrypt: wszystkie pliki z js/ dzielą jeden zakres globalny i ładują się po kolei (kolejność jest istotna).
/* ---------- bug registry ---------- */
const bugApps=()=>agents.filter(a=>a.mode!=='design'&&!OWN_TABS.includes(a.key));
function renderBugAgents(){
  if(!bugApps().length)return;
  if(!bugApps().some(a=>a.key===bSel))bSel=bugApps()[0].key;
  $('#bAgents').innerHTML=bugApps().map(a=>`<button data-k="${a.key}" class="${a.key===bSel?'on':''}">${esc(a.label)}</button>`).join('');
  const a=agents.find(x=>x.key===bSel)||{services:[]};
  $('#serviceList').innerHTML=(a.services||[]).map(s=>`<option value="${esc(s)}">`).join('');
}
$('#bAgents').onclick=e=>{const b=e.target.closest('button');if(b&&b.dataset.k){bSel=b.dataset.k;$('#bService').value='';renderBugAgents()}};

/* Import z Jiry działa w tle na serwerze. Gdy trwa, dopytujemy co kilka sekund; po zakończeniu
   przeładowujemy rejestr (i Risk), a nowe wpisy zgłaszamy komunikatem. */
let jiraPoll=null,jiraWasRunning=false;
function jiraStatus(j){
  const el=$('#jiraSt'); if(!el||!j)return;
  const ago=j.lastOk?Math.max(0,Math.round((Date.now()-j.lastOk)/60000)):null;
  el.textContent=j.state==='running'?'Jira sync: fetching new bugs…'
    :j.error?'Jira sync failed: '+j.error
    :ago==null?'Jira sync: not run yet':'Jira sync: up to date ('+(ago<1?'just now':ago+' min ago')+')';
  el.className=j.error&&j.state!=='running'?'bad':'';
  $('#jiraGo').disabled=$('#jiraFull').disabled=j.state==='running';
  if(j.state==='running'){jiraWasRunning=true;if(!jiraPoll)jiraPoll=setInterval(()=>{if(document.hidden||($('#view-bugs').hidden&&$('#view-risk').hidden))return;loadBugs().catch(()=>{})},3000)}
  else{
    if(jiraPoll){clearInterval(jiraPoll);jiraPoll=null}
    if(jiraWasRunning){jiraWasRunning=false;if(j.added)toast(j.added+' new bug'+(j.added===1?'':'s')+' imported from Jira');if(!$('#view-risk').hidden)renderRisk()}
  }
}
async function loadBugs(){
  const d=await api('/api/bugs');
  bugs=d.bugs;
  jiraStatus(d.jira);
  $('#bugCount').textContent=bugs.length;
  if(!severities.length){
    severities=d.severities;
    $('#bSeverity').innerHTML=severities.map(s=>`<option value="${s}"${s==='wazny'?' selected':''}>${SEVL[s]}</option>`).join('');
    $('#fSeverity').innerHTML='<option value="">All severities</option>'+severities.map(s=>`<option value="${s}">${SEVL[s]}</option>`).join('');
    ['#fService','#fSeverity'].forEach(id=>$(id).onchange=()=>{listOpen=false;renderBugs()});
    $('#fQuery').oninput=debounce(()=>{listOpen=false;renderBugs()});
    renderBugAgents();
  }
  if($('#view-bugs').hidden)return;
  renderAppTabs();fillServiceFilter();renderBugs();
}
/* Each app gets its own chart — CORE, SVC and mcp-server are separate systems, so their
   bug counts are never summed. The tab picks what is shown below. */
function renderAppTabs(){
  const apps=bugApps();
  if(!apps.some(a=>a.key===appSel))appSel=apps[0]?.key||null;
  $('#appTabs').innerHTML=apps.map(a=>{
    const n=bugs.filter(b=>b.agent===a.key).length;
    return `<button data-k="${a.key}" class="${a.key===appSel?'on':''}">${esc(a.label)} <span class="c">${n}</span></button>`;
  }).join('');
}
$('#appTabs').onclick=e=>{
  const b=e.target.closest('button'); if(!b||!b.dataset.k||b.dataset.k===appSel)return;
  appSel=b.dataset.k; $('#fService').value=''; rankOpen=false; listOpen=false;
  renderAppTabs();fillServiceFilter();renderBugs();
};
$('#rankMore').onclick=()=>{rankOpen=!rankOpen;renderBugs()};
$('#listMore').onclick=()=>{listOpen=!listOpen;renderBugs()};
function fillServiceFilter(){
  const keep=$('#fService').value;
  const list=[...new Set(bugs.filter(b=>b.agent===appSel).map(b=>b.service))].sort();
  $('#fService').innerHTML='<option value="">All services</option>'+list.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
  if(list.includes(keep))$('#fService').value=keep;
}
const filtered=()=>{
  const q=$('#fQuery').value.trim().toLowerCase();
  return bugs.filter(b=>
    b.agent===appSel
    &&(!$('#fService').value||b.service===$('#fService').value)
    &&(!$('#fSeverity').value||b.severity===$('#fSeverity').value)
    &&(!q||(b.title+' '+b.notes+' '+b.ticket+' '+b.service).toLowerCase().includes(q)));
};

const SEVCLS={krytyczny:'sv-k',wazny:'sv-w',drobny:'sv-d'};
const RANK_CAP=8;
let rankOpen=false;
const LIST_CAP=20;
let listOpen=false;
function renderBugs(){
  const rows=filtered();
  const inApp=bugs.filter(b=>b.agent===appSel).length;
  $('#bTotal').textContent=inApp?`${rows.length} of ${inApp} shown`:'No entries for this application yet';
  $('#bShown').textContent=rows.length?`${rows.length} report${rows.length===1?'':'s'}`:'';
  const bySvc={};
  for(const b of rows){const v=bySvc[b.service]??={n:0,sev:{}};v.n++;v.sev[b.severity]=(v.sev[b.severity]||0)+1}
  const svc=Object.entries(bySvc).sort((a,b)=>b[1].n-a[1].n);
  const max=Math.max(1,...svc.map(([,v])=>v.n));
  const view=rankOpen?svc:svc.slice(0,RANK_CAP);
  $('#rank').innerHTML=svc.length?view.map(([s,v],i)=>{
    const sev=severities.filter(x=>v.sev[x]).map(x=>`${SEVL[x]} ${v.sev[x]}`).join(' · ');
    const on=$('#fService').value===s;
    const segs=severities.filter(x=>v.sev[x]).map(x=>`<span class="${SEVCLS[x]||'sv-d'}" style="width:${v.sev[x]/max*100}%"></span>`).join('');
    return `<div class="row${on?' on':''}${i===0?' top':''}" data-s="${esc(s)}" title="${on?'Clear the service filter':'Show only '+esc(s)}"><div class="nm"><b>${esc(s)}</b>${sev?`<span>${esc(sev)}</span>`:''}</div><div class="track">${segs}</div><div class="ct">${v.n}</div></div>`;
  }).join(''):`<div class="list-empty" style="padding:6px 0">Nothing matches this filter.</div>`;
  $('#rank').onclick=e=>{const r=e.target.closest('.row');if(!r)return;$('#fService').value=$('#fService').value===r.dataset.s?'':r.dataset.s;renderBugs()};
  const more=$('#rankMore');
  if(svc.length>RANK_CAP){
    more.hidden=false;
    more.classList.toggle('open',rankOpen);
    more.innerHTML=`<span>${rankOpen?`Show top ${RANK_CAP} only`:`Show all ${svc.length} services`}</span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
  }else more.hidden=true;

  const q=$('#fQuery').value.trim().toLowerCase();
  const listView=listOpen?rows:rows.slice(0,LIST_CAP);
  $('#bugList').innerHTML=rows.length?listView.map(b=>{
    const first=(b.notes||'').split('\n').find(l=>l.trim())||'';
    const openNotes=q&&(b.notes||'').toLowerCase().includes(q);
    return `<article class="bug" data-id="${b.id}">
    <div class="top"><div class="ttl">${esc(b.title)}</div>${pill(b.severity,SEVL[b.severity])}</div>
    <div class="path"><span class="chip">${esc(b.label)}</span><span class="chev">›</span><span class="chip">${esc(b.service)}</span>${b.ticket?`<span class="chip mono">${esc(b.ticket)}</span>`:''}<span class="date">${fmt(b.createdAt)}</span></div>
    ${b.notes?`<details${openNotes?' open':''}><summary>Evidence &amp; notes <span class="pv">— ${esc(first.slice(0,160))}</span></summary><pre>${esc(b.notes)}</pre></details>`:''}
    <div class="acts">
      <span class="lbl">Correct:</span>
      <select data-f="severity" aria-label="Severity">${severities.map(s=>`<option value="${s}"${s===b.severity?' selected':''}>${SEVL[s]}</option>`).join('')}</select>
      <input data-f="service" value="${esc(b.service)}" list="serviceList" aria-label="Service" title="Service">
    </div></article>`}).join('')
    :emptyBox('bug','No reports','Nothing matches these filters. Adjust them, or log the first bug using the form on the left.');
  const lmore=$('#listMore');
  if(rows.length>LIST_CAP){
    lmore.hidden=false;
    lmore.classList.toggle('open',listOpen);
    lmore.innerHTML=`<span>${listOpen?`Show first ${LIST_CAP} only`:`Show all ${rows.length} reports`}</span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
  }else lmore.hidden=true;
}
$('#bugList').addEventListener('change',async e=>{
  const card=e.target.closest('.bug'),f=e.target.dataset.f; if(!f)return;
  const v=e.target.value.trim(); if(!v)return loadBugs();
  await api('/api/bugs/'+card.dataset.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({[f]:v})});
  loadBugs();
});
$('#bGo').onclick=async()=>{
  $('#bErr').textContent='';$('#bGo').disabled=true;
  try{
    await post('/api/bugs',{agent:bSel,service:$('#bService').value,title:$('#bTitle').value,ticket:$('#bTicket').value,severity:$('#bSeverity').value,notes:$('#bNotes').value,source:current?current.id:''});
    $('#bTitle').value='';$('#bNotes').value='';$('#bTicket').value='';
    await loadBugs();
  }catch(e){$('#bErr').textContent=e.message}
  $('#bGo').disabled=false;
};
