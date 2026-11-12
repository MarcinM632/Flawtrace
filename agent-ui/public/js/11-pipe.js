// QA Agents UI: pipe. Klasyczny skrypt: wszystkie pliki z js/ dzielą jeden zakres globalny i ładują się po kolei (kolejność jest istotna).
/* ---------- comment dialog: asked before the Autotests agent is briefed ---------- */
let cmtRun=null, cmtLayer='api';
const CMT_LAYER_HINT={
  api:'Backend tests that call the same endpoints.',
  ui:'UI tests that repeat the steps on the related screens.',
};
function setCmtLayer(l){
  cmtLayer=l==='ui'?'ui':'api';
  document.querySelectorAll('#cmtLayer button').forEach(b=>{const on=b.dataset.l===cmtLayer;b.classList.toggle('on',on);b.setAttribute('aria-checked',on)});
  $('#cmtLayerHint').textContent=CMT_LAYER_HINT[cmtLayer];
}
$('#cmtLayer').onclick=e=>{const b=e.target.closest('button[data-l]');if(b)setCmtLayer(b.dataset.l)};
function askComment(m){
  cmtRun=m;
  /* Starts on the type picked last in the Autotests tab; the choice here does not change that tab. */
  setCmtLayer(aLayer);
  $('#cmtSub').textContent='From the QA MCP run '+m.id+'. Tell the agent what the flow cannot: a finding that is not a real bug, what to leave out, what to focus on. Leave it empty to continue without a comment.';
  const t=$('#cmtText');t.value='';$('#cmtCnt').textContent='';
  $('#cmtModal').hidden=false;t.focus();
}
function closeComment(){cmtRun=null;$('#cmtModal').hidden=true}
$('#cmtText').addEventListener('input',e=>{const n=e.target.value.trim().length;$('#cmtCnt').textContent=n?n+' / 2000 chars':''});
$('#cmtCancel').onclick=closeComment;
$('#cmtModal').addEventListener('mousedown',e=>{if(e.target.id==='cmtModal')closeComment()});
$('#cmtGo').onclick=()=>{const m=cmtRun,c=$('#cmtText').value.trim();if(!m)return;const l=cmtLayer;closeComment();startJobFor('autotests',m,'The autotest prompt',c,l)};
document.addEventListener('keydown',e=>{
  if($('#cmtModal').hidden)return;
  if(e.key==='Escape')closeComment();
  else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();$('#cmtGo').click()}
});

/* ---------- run status strip: the same view on every run tab ---------- */
/* Shows what is running right now (prompt-engineer jobs and agent runs, whichever tab started them)
   and what finished in the last few minutes, so the status never depends on which tab you are on. */
const PIPE_JOB={replicate:'Writing QA MCP process',autotests:'Writing test specification'};
const PIPE_TABS=['runs','qamcp','autotest','flow'];
const PIPE_RECENT=5*60*1000;
let pipeSig='';
function pipeItems(){
  const now=Date.now(),out=[];
  Object.values(JOBS).forEach(j=>{
    const kind=PIPE_JOB[j.kind]||j.kind;
    if(j.state==='running')out.push({key:'j:'+j.kind+':'+j.runId,st:'running',kind,text:'from run '+j.runId,t0:j.startedAt,t1:0,run:null});
    else if(j.state==='error'&&now-j.finishedAt<PIPE_RECENT)out.push({key:'j:'+j.kind+':'+j.runId,st:'failed',kind,text:j.error,t0:j.startedAt,t1:j.finishedAt,run:null});
  });
  RUNS.forEach(r=>{
    if(r.status==='running'||(r.finishedAt&&now-r.finishedAt<PIPE_RECENT))
      out.push({key:'r:'+r.id+':'+r.status,st:r.status,kind:r.label,text:String(r.ticket).replace(/\s+/g,' ').slice(0,90),t0:r.startedAt,t1:r.finishedAt||0,run:r.id});
  });
  return out.sort((a,b)=>(b.st==='running')-(a.st==='running')||b.t0-a.t0).slice(0,5);
}
function renderPipe(){
  const el=$('#pipe');if(!el)return;
  const tab=VIEWS.find(v=>!$('#view-'+v).hidden);
  const items=PIPE_TABS.includes(tab)?pipeItems():[];
  el.hidden=!items.length;
  if(!items.length){pipeSig='';return}
  const sig=items.map(i=>i.key).join('|');
  const t=i=>fmtSecs(Math.max(0,Math.round(((i.t1||Date.now())-i.t0)/1000)));
  if(sig!==pipeSig){
    pipeSig=sig;
    el.innerHTML=items.map(i=>{
      const inner=`<span class="pk">${esc(i.kind)}</span><span class="pt1" title="${esc(i.text)}">${esc(i.text)}</span><span class="pt" data-t0="${i.t0}" data-t1="${i.t1}">${t(i)}</span>${pill(i.st,STAT[i.st]||i.st)}`;
      return i.run?`<button class="pr" data-run="${esc(i.run)}">${inner}</button>`:`<div class="pr">${inner}</div>`;
    }).join('');
  }else el.querySelectorAll('.pt').forEach(n=>{if(n.dataset.t1==='0')n.textContent=fmtSecs(Math.max(0,Math.round((Date.now()-n.dataset.t0)/1000)))});
}
$('#pipe').addEventListener('click',e=>{
  const b=e.target.closest('[data-run]');if(!b)return;
  const r=RUNS.find(x=>x.id===b.dataset.run);if(!r)return;
  showTab(TAB_OF(r.agent));open(r.id);
});
setInterval(renderPipe,1000);
