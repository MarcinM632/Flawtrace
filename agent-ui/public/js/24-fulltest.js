// QA Agents UI: Full tests. Klasyczny skrypt: wszystkie pliki z js/ dzielą jeden zakres globalny i ładują się po kolei (kolejność jest istotna).
/* ---------- Full tests: the whole flow of one task, from 0 to 100% (server side: lib/pipeline.js) ---------- */
const FT_STAGES=[
  ['static','Static review','Is the task consistent, possible and complete?',()=> 'static'],
  ['whitebox','Whitebox','The change in the code, its integrations and what it breaks',v=>v.options.family],
  ['design','Test design','Blackbox checks, aimed by the two phases above',()=> 'design'],
  ['api','QA MCP (API)','Runs the checks that endpoints can verify',()=> 'execution'],
  ['ui','UI Tests','Runs the checks that are visible on the page',()=> 'uitest'],
];
const FT_PILL={running:['p-running','Running'],done:['p-done','Done'],failed:['p-failed','Failed'],cancelled:['p-cancelled','Cancelled'],skipped:['p-cancelled','Skipped'],pending:['p-cancelled','Waiting'],paused:['p-failed','Needs you'],waiting:['p-failed','Needs you']};
const FT_STAGE_OF={static:'Static review',whitebox:'Whitebox',design:'Test design',execute:'Execution',confirm:'Confirmation',done:'Finished'};
let FT={cases:[],sel:null,view:null,sig:'',conf:null,ag:null,decisions:{},docs:null,timer:null};
const ftPill=s=>{const [c,l]=FT_PILL[s]||FT_PILL.pending;return `<span class="pill ${c}"><span class="d"></span>${l}</span>`};
const ftMoney=n=>n?'$'+Number(n).toFixed(2):'$0';

/* ---- form ---- */
const FT_KEYS=['ftFam','ftUrl','ftBudget'];
/* Which phases the user wants. Static and design are the base of the others, but none is forced: any subset runs. */
const FT_PRESETS=[['all','Everything',['static','whitebox','design','api','ui']],['review','Review only',['static','whitebox']],['design','Review + design',['static','whitebox','design']],['exec','Execute only',['api','ui']]];
const FT_DEFAULT_SEL=['static','whitebox','design','api'];
function ftSel(){try{const a=JSON.parse(localStorage.getItem('ft.sel')||'null');if(Array.isArray(a))return a.filter(k=>FT_STAGES.some(s=>s[0]===k))}catch(_){}return FT_DEFAULT_SEL.slice()}
function ftSetSel(a){FT.pick=a;try{localStorage.setItem('ft.sel',JSON.stringify(a))}catch(_){}ftRenderForm()}
/* A phase that cannot run right now, with the reason (shown on the card). */
function ftBlocked(k){
  const ag=FT.ag;if(!ag)return '';
  if(k==='api'&&!ag.api)return 'No test environment connected under Sources';
  if(k==='whitebox'&&!ag.whitebox.length)return 'The Analyses agent is not available';
  if(k==='ui'&&!ag.ui)return 'UI Tests is not available';
  return '';
}
const FT_NEEDS={whitebox:'Runs only when the change is already in the code',ui:'Needs a page address'};
function ftRestore(){try{const s=JSON.parse(localStorage.getItem('ft.opts')||'{}');for(const k of FT_KEYS){const e=$('#'+k);if(!e||s[k]===undefined)continue;if(e.type==='checkbox')e.checked=!!s[k];else e.value=s[k]}}catch(_){}}
function ftSaveOpts(){try{const s={};for(const k of FT_KEYS){const e=$('#'+k);s[k]=e.type==='checkbox'?e.checked:e.value}localStorage.setItem('ft.opts',JSON.stringify(s))}catch(_){}}
function ftRenderForm(){
  const ag=FT.ag||{whitebox:[],api:false,ui:true};
  if(!FT.pick)FT.pick=ftSel();
  FT.pick=FT.pick.filter(k=>!ftBlocked(k));
  const on=new Set(FT.pick);
  const fam=$('#ftFam');
  const labels={core:'CORE',svc:'SVC',mcp:'mcp-server'};
  const cur=fam.value||'core';
  fam.innerHTML=['core','svc','mcp'].map(k=>`<option value="${k}"${ag.whitebox.includes(k)?'':' disabled'}>${labels[k]}${ag.whitebox.includes(k)?'':' (not available)'}</option>`).join('');
  fam.value=cur;
  /* The picker: one card per phase, any subset. A phase that cannot run says why and stays off. */
  $('#ftPicks').innerHTML=FT_STAGES.map(([k,name,desc])=>{
    const bl=ftBlocked(k),sel=on.has(k)&&!bl;
    const sub=bl||(k==='whitebox'||k==='ui'?FT_NEEDS[k]:desc);
    return `<button type="button" class="ft-pick${sel?' on':''}" data-pick="${k}" aria-pressed="${sel}" ${bl?'disabled':''}><span class="ft-pick-ck">${sel?'✓':''}</span><span class="ft-pick-tx"><b>${name}</b><small>${esc(sub)}</small></span></button>`;
  }).join('');
  $('#ftPresets').innerHTML='<span class="muted-note">Quick choice:</span>'+FT_PRESETS.map(([id,label,keys])=>`<button type="button" class="chip${keys.filter(k=>!ftBlocked(k)).length===FT.pick.length&&keys.filter(k=>!ftBlocked(k)).every(k=>on.has(k))?' on':''}" data-preset="${id}">${label}</button>`).join('');
  $('#ftUiBox').hidden=!on.has('ui');
  const names=Object.fromEntries(FT_STAGES.map(s=>[s[0],s[1]]));
  const plan=FT_STAGES.map(s=>s[0]).filter(k=>on.has(k)).map(k=>names[k]+(k==='ui'&&!$('#ftUrl').value.trim()?' (needs a page address)':''));
  $('#ftPlan').textContent=plan.length?'Runs: '+plan.join(' → ')+'. One pass each, nothing repeated. You confirm the results before autotests and documentation.':'Pick at least one phase to run.';
  $('#ftGo').disabled=!plan.length;
}
async function ftStart(){
  $('#ftErr').textContent='';$('#ftGo').disabled=true;
  try{
    ftSaveOpts();
    const v=await post('/api/fulltest',{task:$('#ftTask').value,details:$('#ftDetails').value,family:$('#ftFam').value,stages:Object.fromEntries(FT_STAGES.map(x=>[x[0],(FT.pick||[]).includes(x[0])])),url:$('#ftUrl').value,username:$('#ftUser').value,password:$('#ftPass').value,budgetUsd:$('#ftBudget').value});
    $('#ftTask').value='';$('#ftDetails').value='';$('#ftPass').value='';
    FT.sel=v.id;FT.decisions={};FT.docs=null;await ftRefresh(true);
  }catch(e){$('#ftErr').textContent=e.message}
  ftRenderForm();
}

/* ---- list ---- */
function ftRenderList(){
  $('#ftListCount').textContent=FT.cases.length?String(FT.cases.length):'';
  $('#ftList').innerHTML=FT.cases.length?FT.cases.map(c=>`<div class="item ${c.id===FT.sel?'on':''}" data-ft="${c.id}" title="${esc(c.ticket)}">
    <div class="top"><span class="tk">${esc(String(c.ticket).slice(0,70))}</span>${ftPill(c.status)}</div>
    <small>${esc(FT_STAGE_OF[c.stage]||'')}${c.stage?' · ':''}${new Date(c.createdAt).toLocaleString()} · ${ftMoney(c.costUsd)}</small></div>`).join('')
    :'<div class="list-empty">No full tests yet. Run the first one above.</div>';
}

/* ---- detail ---- */
function ftStageRow(v,[k,name,desc,agentOf]){
  const s=v.stages[k];
  const link=s.runId?`<button class="btn sm" data-ft-open="${s.runId}" data-ft-agent="${agentOf(v)}">Open run</button>`:'';
  return `<div class="ft-row"><div class="ft-main"><b>${name}</b> ${ftPill(s.status)}<div class="ft-sub">${esc(s.note||desc)}</div></div><div class="ft-side">${s.costUsd?`<span class="muted-note">${ftMoney(s.costUsd)}</span>`:''}${link}</div></div>`;
}
function ftConfirmHtml(v){
  const c=v.confirm;
  if(c.status==='pending')return '<div class="ft-sub">Appears when the execution tracks have finished.</div>';
  if(c.status==='done'){
    if(c.auto)return '<div class="ft-sub">Nothing failed, so nothing needed confirmation.</div>';
    return '<ul class="ft-list">'+c.items.map(i=>`<li>${i.decision==='defect'?'<b>Defect</b>':'Not a defect'} · ${i.layer.toUpperCase()} · ${esc(i.title)}</li>`).join('')+'</ul>'+(c.note?`<div class="ft-sub">Your note: ${esc(c.note)}</div>`:'');
  }
  const broken=['api','ui'].filter(k=>['failed','cancelled'].includes(v.stages[k].status));
  return `<div class="ft-sub">Decide for each result. Confirmed defects go to the documentation, and autotests will assert the correct behaviour for them. Nothing is run again.</div>`
    +(broken.length?`<div class="ft-warn">${broken.map(k=>k.toUpperCase()).join(' and ')} track did not finish, so its results are missing.</div>`:'')
    +c.items.map(i=>{const d=FT.decisions[i.id]||'defect';return `<div class="ft-item"><div class="ft-main"><span class="rv-kind">${i.layer.toUpperCase()}</span> <b>${esc(i.title)}</b>${i.detail?`<div class="ft-sub">${esc(i.detail)}</div>`:''}</div>
      <div class="seg" data-ft-dec="${esc(i.id)}"><button data-v="defect" class="${d==='defect'?'on':''}">Defect</button><button data-v="not-defect" class="${d==='not-defect'?'on':''}">Not a defect</button></div></div>`}).join('')
    +`<div class="field"><label for="ftNote">Note <span class="opt">optional</span></label><textarea id="ftNote" rows="2" placeholder="Anything the autotests and the documentation should know."></textarea></div>
      <button class="go" data-ft-act="confirm">Confirm results</button>`;
}
function ftAutotestsHtml(v){
  const ok=v.confirm.status==='done';
  const one=(k,label)=>{
    const a=v.autotests[k];const s=v.stages[k];
    const st=a?(a.state==='failed'?`<span class="ft-warn">${esc(a.error)}</span>`:`${a.state==='writing'?'Writing…':'Started'} ${a.runId?`<button class="btn sm" data-ft-open="${a.runId}" data-ft-agent="autotest">Open run</button>`:''}`):'';
    return `<div class="ft-row"><div class="ft-main"><b>${label}</b><div class="ft-sub">${a?st:s.status==='done'?'From the confirmed run. Saving to the repository stays in the Autotests tab, after the tests are verified.':'No finished run on this track.'}</div></div>
      <div class="ft-side"><button class="btn sm" data-ft-at="${k}" ${ok&&s.status==='done'&&!a?'':'disabled'}>Create</button></div></div>`;
  };
  return (ok?'':'<div class="ft-sub">Available after you confirm the results.</div>')+one('api','API autotests (pytest)')+one('ui','UI autotests (Playwright)');
}
function ftDocsHtml(v){
  const d=FT.docs;
  const target=FT.conf||{};
  const pub=v.docs?`<div class="ft-sub">Published: <a href="${esc(v.docs.url)}" target="_blank" rel="noopener">${esc(v.docs.url)}</a></div>`:'';
  return `<div class="ft-sub">Built from the results of this flow, with no model call, so it costs nothing. Publishing is always your click.</div>${pub}
    <div class="ft-actions"><button class="btn sm" data-ft-act="docs">${d?'Refresh preview':'Preview'}</button>
    <button class="btn sm" data-ft-act="download" ${d?'':'disabled'}>Download .md</button>
    <button class="btn sm" data-ft-act="publish" ${target.ready&&v.stages.design.status==='done'?'':'disabled'} title="${esc(target.ready?'':target.reason||'')}">Publish to Confluence</button></div>
    ${target.ready?'':`<div class="ft-sub">${esc(target.reason||'')} <a href="#sources" data-tab-link="sources">Open Sources</a></div>`}
    ${d?`<details class="rv-raw" open><summary>Preview</summary><pre>${esc(d.markdown)}</pre></details>`:''}`;
}
function ftRenderDetail(){
  const v=FT.view,box=$('#ftDetail');
  if(!v){box.innerHTML=emptyBox('inbox','No full test selected','Run one above, or pick one from the history.');return}
  const busy=['running','paused','waiting'].includes(v.status);
  const pause=v.pause?`<div class="ft-pause"><b>${esc(FT_STAGE_OF[v.pause.stage]||'Flow')}</b>: ${esc(v.pause.reason)}
    <div class="ft-actions">${v.pause.actions.includes('continue')?'<button class="go" data-ft-act="continue">Continue</button>':''}${v.pause.actions.includes('retry')?'<button class="btn" data-ft-act="retry">Retry this phase</button>':''}</div></div>`:'';
  const gate=v.static&&v.static.verdict?`<span class="rv-kind">${esc(v.static.verdict)}</span>`:'';
  box.innerHTML=`<div class="panel-h"><h2>${esc(v.ticket)}</h2>${ftPill(v.status)}<span class="grow"></span><span class="muted-note">${ftMoney(v.costUsd)}${v.options.budgetUsd?' of '+ftMoney(v.options.budgetUsd):''}</span>${busy?'<button class="btn sm danger" data-ft-act="stop">Stop</button>':''}</div>
  <div class="panel-b ft-body">${pause}
    <h5 class="ft-h">1 · Run ${gate}</h5>${FT_STAGES.map(s=>ftStageRow(v,s)).join('')}
    <h5 class="ft-h">2 · Confirm results</h5>${ftConfirmHtml(v)}
    <h5 class="ft-h">3 · Autotests</h5>${ftAutotestsHtml(v)}
    <h5 class="ft-h">4 · Documentation</h5>${ftDocsHtml(v)}</div>`;
}

/* ---- data ---- */
async function ftRefresh(force){
  let d;try{d=await api('/api/fulltest')}catch(e){return}
  FT.cases=d.cases;FT.conf=d.confluence;FT.ag=d.agents;
  if(!FT.sel&&FT.cases.length)FT.sel=FT.cases[0].id;
  ftRenderList();
  if(FT.sel){
    try{
      const v=await api('/api/fulltest/'+FT.sel);
      const sig=JSON.stringify([v.status,v.updatedAt,v.costUsd,v.docs,v.autotests,v.pause,v.stages.static.status,v.stages.whitebox.status,v.stages.design.status,v.stages.api.status,v.stages.ui.status,v.confirm.status]);
      if(force||sig!==FT.sig){FT.view=v;FT.sig=sig;ftRenderDetail()}
    }catch(e){FT.view=null;ftRenderDetail()}
  }else ftRenderDetail();
  if(force)ftRenderForm();
}
async function loadFullTests(){await ftRefresh(true);ftPoll()}
function ftPoll(){
  clearTimeout(FT.timer);
  const live=!$('#view-fulltest').hidden&&!document.hidden;
  if(!$('#view-fulltest').hidden)FT.timer=setTimeout(async()=>{if(live)await ftRefresh(false);ftPoll()},FT.cases.some(c=>['running'].includes(c.status))?3000:10000);
}
async function ftAct(a,body){
  const id=FT.sel;if(!id)return;
  try{
    if(a==='docs'){FT.docs=await api('/api/fulltest/'+id+'/docs');ftRenderDetail();return}
    if(a==='download'){const b=new Blob([FT.docs.markdown],{type:'text/markdown'});const u=URL.createObjectURL(b);const l=document.createElement('a');l.href=u;l.download=(FT.view.ticket.replace(/[^\w-]+/g,'-').slice(0,60)||'full-test')+'.md';l.click();setTimeout(()=>URL.revokeObjectURL(u),2000);return}
    if(a==='publish'){
      if(!confirm('Publish this documentation to Confluence space '+((FT.conf&&FT.conf.space)||'')+'? An existing page with the same title is updated.'))return;
      const r=await post('/api/fulltest/'+id+'/publish',{});toast('Published: '+r.url);
    }else if(a==='confirm'){
      await post('/api/fulltest/'+id+'/confirm',{decisions:FT.decisions,note:($('#ftNote')||{}).value||''});FT.decisions={};
    }else await post('/api/fulltest/'+id+'/'+a,body||{});
  }catch(e){toast(e.message,'err')}
  await ftRefresh(true);
}

/* ---- events ---- */
$('#ftGo').onclick=ftStart;
$('#ftTask').addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.isComposing){e.preventDefault();ftStart()}});
['ftUrl','ftFam'].forEach(k=>{$('#'+k).addEventListener('input',ftRenderForm)});
$('#ftPicks').onclick=e=>{const b=e.target.closest('[data-pick]');if(!b||b.disabled)return;const k=b.dataset.pick,s=new Set(FT.pick||[]);s.has(k)?s.delete(k):s.add(k);ftSetSel(FT_STAGES.map(x=>x[0]).filter(x=>s.has(x)))};
$('#ftPresets').onclick=e=>{const b=e.target.closest('[data-preset]');if(!b)return;const pr=FT_PRESETS.find(x=>x[0]===b.dataset.preset);if(pr)ftSetSel(pr[2].filter(k=>!ftBlocked(k)))};
$('#ftList').onclick=e=>{const it=e.target.closest('[data-ft]');if(it){FT.sel=it.dataset.ft;FT.decisions={};FT.docs=null;FT.sig='';ftRefresh(true)}};
$('#ftDetail').onclick=async e=>{
  const o=e.target.closest('[data-ft-open]');
  if(o){const a=o.dataset.ftAgent;showTab(a==='static'||a==='core'||a==='svc'||a==='mcp'?'runs':TAB_OF(a));try{await open(o.dataset.ftOpen)}catch(_){}return}
  const dec=e.target.closest('[data-ft-dec] button');
  if(dec){const id=dec.parentNode.dataset.ftDec;FT.decisions[id]=dec.dataset.v;dec.parentNode.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b===dec));return}
  const at=e.target.closest('[data-ft-at]');
  if(at){at.disabled=true;try{await post('/api/fulltest/'+FT.sel+'/autotests',{layer:at.dataset.ftAt});toast('Autotests started. Open the run to follow it.')}catch(err){toast(err.message,'err')}await ftRefresh(true);return}
  const a=e.target.closest('[data-ft-act]');
  if(a){a.disabled=true;await ftAct(a.dataset.ftAct);a.disabled=false}
};
ftRestore();ftRenderForm();
