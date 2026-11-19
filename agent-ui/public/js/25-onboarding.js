// QA Agents UI: Onboarding. Klasyczny skrypt: dzieli zakres globalny z innymi plikami z js/ (kolejność ładowania jest istotna).
/* ---------- Onboarding: the app reads the connected sources and writes what the agents need to know about the product (server side: lib/onboarding.js) ---------- */
const OB={d:null,sel:null,timer:null,sig:''};
const OB_DEPTH=[['quick','Quick','About 40 documents. Cheapest, good for a first look.'],['standard','Standard','About 90 documents. The usual choice.'],['deep','Deep','About 200 documents. For a large product; costs the most.']];
const OB_STEP_PILL={pending:['p-cancelled','Waiting'],running:['p-running','Running'],done:['p-done','Done'],failed:['p-failed','Failed'],cancelled:['p-cancelled','Stopped']};
const OB_NAMES={'product/overview.md':'Product overview','product/glossary.md':'Glossary','product/business-rules.md':'Business rules','product/test-flows.md':'Key flows and test data','product/known-defects.md':'Known defects and fragile areas','product/digest.md':'Briefing for every agent','lessons/confirmed-defects.md':'Confirmed defects','lessons/false-alarms.md':'False alarms'};
const obPill=s=>{const [c,l]=OB_STEP_PILL[s]||OB_STEP_PILL.pending;return `<span class="pill ${c}"><span class="d"></span>${l}</span>`};
const obName=p=>OB_NAMES[p]||p.replace(/^[a-z]+\//,'').replace(/\.new\.md$/,' (new draft)').replace(/\.md$/,'');

function obSourcesHtml(s){
  const chip=(ok,label,hint)=>`<span class="ob-src ${ok?'on':''}" title="${esc(hint)}"><span class="ob-dot"></span>${label}</span>`;
  return chip(s.jira,'Jira',s.jira?'Bugs, epics and stories are read':'Not connected')
    +chip(s.confluence,'Confluence',s.confluence?'Pages are read':'Not connected')
    +chip(s.repos>0,'Repositories'+(s.repos?' · '+s.repos:''),s.repos?'READMEs, docs and the structure are read':'None cloned')
    +chip(s.api,'API specification',s.api?'The application model is read':'Not imported')
    +chip(s.knowledge>0,'Knowledge files'+(s.knowledge?' · '+s.knowledge:''),'Your own documents in the knowledge folder');
}
function obRenderForm(){
  const d=OB.d;if(!d)return;
  const s=d.sources;
  const none=!(s.jira||s.confluence||s.repos>0||s.api||s.knowledge>0);
  $('#obSources').innerHTML=obSourcesHtml(s);
  $('#obNone').hidden=!none;
  const run=d.running;
  $('#obGo').disabled=run||none;$('#obScan').disabled=run||none;
  const cur=$('#obDepth').value||'standard';
  $('#obDepth').innerHTML=OB_DEPTH.map(([k,l])=>`<option value="${k}">${l}</option>`).join('');$('#obDepth').value=cur;
  $('#obDepthNote').textContent=(OB_DEPTH.find(x=>x[0]===$('#obDepth').value)||OB_DEPTH[1])[2];
  $('#obLlm').innerHTML=d.llm==='acp'?'Your own agent (ACP) cannot do this yet. Pick Claude Code or an API key under Settings &gt; AI provider.':'';
}
function obRenderProgress(){
  const d=OB.d,box=$('#obProgress');
  if(!d||!d.steps||!d.steps.length){box.hidden=true;return}
  box.hidden=false;
  const head=d.status==='running'?'Working…':d.status==='done'?(d.scanOnly?'Scan finished':'Finished'):d.status==='failed'?'Failed':d.status==='cancelled'?'Stopped':'';
  const scan=d.scan?`<div class="ft-sub">${d.scan.docs} documents read (${esc(Object.entries(d.scan.counts||{}).map(([k,v])=>v+' '+k).join(', ')||'none')}).${d.scanOnly?` A full run would make about <b>${d.scan.estimatedCalls}</b> model calls.`:''}</div>`:'';
  box.querySelector('.panel-b').innerHTML=`<div class="ob-head"><b>${head}</b>${d.status==='running'?'<button class="btn sm danger" id="obStop">Stop</button>':''}<span class="grow"></span>${d.calls?`<span class="muted-note">${d.calls} model calls${d.costUsd?' · $'+d.costUsd.toFixed(2):''}</span>`:''}</div>
    ${d.error?`<div class="ft-warn">${esc(d.error)}</div>`:''}${scan}
    ${d.steps.map(s=>`<div class="ft-row"><div class="ft-main"><b>${esc(s.label)}</b> ${obPill(s.status)}<div class="ft-sub">${esc(s.note||'')}</div></div></div>`).join('')}
    <details class="rv-raw"><summary>Log</summary><pre>${esc((d.log||[]).join('\n'))}</pre></details>`;
}
function obRenderFiles(){
  const d=OB.d,box=$('#obFiles');if(!d)return;
  const fs_=d.files||[];
  if(!fs_.length){box.innerHTML='<div class="list-empty">Nothing yet. Run the onboarding above and the files appear here.</div>';$('#obView').hidden=true;return}
  box.innerHTML=fs_.map(f=>`<div class="item ${f.path===OB.sel?'on':''}" data-obf="${esc(f.path)}"><div class="top"><span class="tk">${esc(obName(f.path))}</span><span class="rv-kind">${f.generated?'generated':'edited by you'}</span></div><small>${esc(f.path)} · ${(f.bytes/1024).toFixed(1)} KB · ${new Date(f.modified).toLocaleString()}</small></div>`).join('');
}
async function obOpen(p){
  OB.sel=p;obRenderFiles();
  try{const r=await api('/api/onboarding/file?path='+encodeURIComponent(p));$('#obView').hidden=false;$('#obViewTitle').textContent=obName(p);$('#obViewText').textContent=r.text}catch(e){toast(e.message,'err')}
}
async function obRefresh(force){
  let d;try{d=await api('/api/onboarding')}catch(_){return}
  const sig=JSON.stringify([d.status,d.steps,d.log&&d.log.length,d.calls,(d.files||[]).map(f=>f.path+f.modified),d.sources,d.llm]);
  OB.d=d;
  if(force||sig!==OB.sig){OB.sig=sig;obRenderForm();obRenderProgress();obRenderFiles()}
}
async function loadOnboarding(){await obRefresh(true);obPoll()}
function obPoll(){
  clearTimeout(OB.timer);
  if($('#view-onboarding').hidden)return;
  OB.timer=setTimeout(async()=>{if(!document.hidden)await obRefresh(false);obPoll()},OB.d&&OB.d.running?1500:8000);
}
async function obStart(scanOnly){
  $('#obErr').textContent='';
  try{await post('/api/onboarding/start',{depth:$('#obDepth').value,language:$('#obLang').value,scanOnly});OB.sig='';await obRefresh(true)}
  catch(e){$('#obErr').textContent=e.message}
}
$('#obGo').onclick=()=>obStart(false);
$('#obScan').onclick=()=>obStart(true);
$('#obDepth').addEventListener('input',obRenderForm);
$('#obProgress').onclick=async e=>{if(e.target.closest('#obStop')){try{await post('/api/onboarding/stop',{})}catch(err){toast(err.message,'err')}await obRefresh(true)}};
$('#obFiles').onclick=e=>{const it=e.target.closest('[data-obf]');if(it)obOpen(it.dataset.obf)};
