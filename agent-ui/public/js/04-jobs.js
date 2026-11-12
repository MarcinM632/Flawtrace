// QA Agents UI: jobs. Klasyczny skrypt: wszystkie pliki z js/ dzielą jeden zakres globalny i ładują się po kolei (kolejność jest istotna).
/* ---------- background jobs (prompt engineer) ---------- */
/* The prompt engineer takes tens of seconds, so the server runs it as a background job. The page only
   starts it and then polls /api/jobs; the state lives on the server, so switching tabs or refreshing the
   page neither cancels it nor loses the result. */
let JOBS={},jobTimer=null,jobConsumed={},lastAutoProcess='';
const jobOf=(kind,id)=>JOBS[kind+':'+id];
const repReady=(id)=>{const j=jobOf('replicate',id);return !!(j&&j.state==='done'&&j.result&&j.result.parsed&&jobConsumed['replicate:'+id]!==j.startedAt)};
function jobsSchedule(){
  const running=Object.values(JOBS).some(j=>j.state==='running');
  if(running&&!jobTimer)jobTimer=setInterval(jobsPoll,2000);
  if(!running&&jobTimer){clearInterval(jobTimer);jobTimer=null}
}
async function jobsPoll(){
  let list; try{list=await api('/api/jobs')}catch(e){return}
  const next={}; list.forEach(j=>next[j.kind+':'+j.runId]=j);
  const finished=[];
  for(const k in next){const was=JOBS[k];if(was&&was.state==='running'&&next[k].state!=='running'&&was.startedAt===next[k].startedAt)finished.push(next[k])}
  JOBS=next; jobsSchedule();
  qPendingSync();renderPipe();
  finished.forEach(jobDone);
  if(current)syncJobButtons(current);
}
/* Is the person still looking at this run's panel? Then the result may take them to the next tab; otherwise it only says it is ready. */
const viewingRun=id=>!!current&&current.id===id&&!$('#view-'+TAB_OF(current.agent)).hidden;
function loadReplicate(j,force){
  const f=$('#qProcess'),r=j.result,k='replicate:'+j.runId;
  if(!force&&f.value.trim()&&f.value!==lastAutoProcess)return false; /* never overwrite what the tester typed there */
  const m=RUNS.find(x=>x.id===j.runId)||{label:'',id:j.runId};
  f.value=r.prompt;f.dispatchEvent(new Event('input'));lastAutoProcess=r.prompt;
  qBriefShow(r,m);jobConsumed[k]=j.startedAt;
  return true;
}
function jobDone(j){
  if(j.state==='error'){toast((j.kind==='autotests'?'Autotests: ':'Replicate in QA MCP: ')+j.error,'bad');return}
  if(j.kind==='replicate'){
    if(!j.result||!j.result.parsed){toast('The prompt engineer did not return a process in the expected format. Run it again.','bad');return}
    const here=viewingRun(j.runId)||!$('#view-qamcp').hidden;
    if(!j.result.tooLong){autoRunReplicate(j,here);return}
    if(loadReplicate(j,false)){
      if(here){showTab('qamcp');$('#qProcess').focus()}
      else toast('The QA MCP process for '+j.runId+' is ready in the QA MCP tab.');
    }else toast('The process for '+j.runId+' is ready. Your text in QA MCP was kept. Open the run and select Load process into QA MCP.');
  }else{
    const id=j.result&&j.result.runId; if(!id)return;
    refreshAll();
    if(viewingRun(j.runId)||!$('#view-autotest').hidden){showTab('autotest');atSetSub('write');open(id)}
    else toast('The Autotests run has started.');
  }
}
/* Button labels come from the job state, so they survive every repaint of the run panel. */
function syncJobButtons(m){
  const q=$('#toQa');
  if(q){
    const j=jobOf('replicate',m.id), run=j&&j.state==='running';
    q.disabled=!!run;
    q.innerHTML=ico('term')+(run?' Preparing the process':repReady(m.id)?' Load process into QA MCP':' Replicate in QA MCP');
  }
  const t=$('#toTests');
  if(t){
    const j=jobOf('autotests',m.id), run=j&&j.state==='running';
    t.disabled=!!run;
    t.innerHTML=ico('code')+(run?' Preparing the prompt':' Create autotests');
  }
}
async function startJobFor(kind,m,what,comment,layer){
  try{
    const j=await post('/api/runs/'+m.id+'/'+(kind==='replicate'?'replicate':'autotests'),kind==='autotests'?{comment:comment||'',layer:layer==='ui'?'ui':'api'}:{});
    JOBS[kind+':'+m.id]=j;jobsSchedule();syncJobButtons(m);renderPipe();
    if(kind==='autotests'&&(layer==='ui'?'ui':'api')!==aLayer)setALayer(layer);
    showTab(kind==='replicate'?'qamcp':'autotest');qPendingSync();return
  }catch(e){toast(e.message,'bad')}
}
/* The rewritten process starts as a QA MCP run straight away — no second button. A process over the field
   limit cannot be started, so that one is only loaded into the field to be shortened. */
async function autoRunReplicate(j,here){
  const r=j.result,k='replicate:'+j.runId;
  const m=RUNS.find(x=>x.id===j.runId)||{label:'',id:j.runId};
  jobConsumed[k]=j.startedAt;
  try{
    const run=await post('/api/runs',{agent:'qamcp',ticket:r.prompt,notes:''});
    $('#qProcess').value=r.prompt;$('#qProcess').dispatchEvent(new Event('input'));lastAutoProcess=r.prompt;
    qBriefShow(r,m,true);
    if(here){showTab('qamcp');await open(run.id)}
    else toast('The QA MCP test for '+j.runId+' is running in QA MCP.');
    refreshAll();
  }catch(e){
    loadReplicate(j,true);
    toast('The process is ready but could not start: '+e.message,'bad');
  }
}
/* While the prompt engineer works, the target tab shows it working right where the result will land. */
const PEND={
  replicate:{box:'#qBrief',msg:'Writing the QA MCP process from the result of',tail:'The test starts on the environment automatically as soon as the process is written.'},
  autotests:{box:'#aBrief',msg:'Writing the test specification from the QA MCP run',tail:'The Autotests agent starts automatically as soon as the specification is written.'},
};
const pendTimers={};
function pendingSync(kind){
  const c=PEND[kind],j=Object.values(JOBS).find(x=>x.kind===kind&&x.state==='running'),box=$(c.box);
  if(!box)return;
  if(!j){
    if(pendTimers[kind]){clearInterval(pendTimers[kind]);pendTimers[kind]=null}
    if(box.querySelector('.pe-wait'))box.innerHTML='';
    return;
  }
  if(!box.querySelector('.pe-wait'))box.innerHTML='<div class="pe-wait"><div class="spin"></div><div>'+c.msg+' <span class="mono">'+esc(j.runId)+'</span>…</div><div class="hint" style="margin:0">Elapsed <span class="pendT">0</span> s · usually 10–40 s. '+c.tail+'</div></div>';
  const tick=()=>{const t=box.querySelector('.pendT');if(t)t.textContent=Math.round((Date.now()-j.startedAt)/1000)};
  tick();
  if(!pendTimers[kind])pendTimers[kind]=setInterval(tick,1000);
}
const qPendingSync=()=>{pendingSync('replicate');pendingSync('autotests')};

function paint(m){
  if(!$('#title'))return;
  const t=String(m.ticket);
  $('#title').textContent=t.length>140?t.slice(0,140)+'…':t; $('#title').title=t;
  const mi=(l,v,id,tip)=>`<span class="mi"${tip?` title="${esc(tip)}"`:''}><span class="ml">${l}</span><span class="mono"${id?` id="${id}"`:''}>${v}</span></span>`;
  const kt=n=>n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?Math.round(n/1e3)+'k':String(n);
  const fmtTok=u=>kt(u.input+u.cacheCreate)+' / '+kt(u.cacheRead)+' / '+kt(u.output);
  $('#meta').innerHTML=pill(m.status,STAT[m.status])
    +mi('Started',fmtFull(m.startedAt))
    +mi('Duration',dur(m),'elapsed')
    +(m.costUsd?mi('Cost','$'+m.costUsd.toFixed(2)):'')
    +(m.usage?mi('Tokens',fmtTok(m.usage),null,'input + cache written / cache read / output · '+m.usage.turns+' turns'):'')
    +(m.scope&&(m.agent==='qamcp'||m.agent==='execution')?mi('Tools',m.scope.groups?m.scope.groups.length+' groups · '+m.scope.tools:'all '+m.scope.tools,null,m.scope.groups?m.scope.groups.join(', '):'every tool group'):'');
  $('#actions').innerHTML=(m.status==='running'?`<button class="btn danger" id="cancel">${ico('x')} Cancel run</button>`:'')
    +(FLOW_NEXT[m.agent]&&m.status==='done'&&!m.pushedTo?`<button class="btn" id="pushNext" title="Starts ${esc(FLOW_LABEL[FLOW_NEXT[m.agent]])} with this report as its input">${ico('play')} Push to ${esc(FLOW_LABEL[FLOW_NEXT[m.agent]])}</button>`:'')
    +(m.pushedTo?`<button class="btn" id="pushedTag" title="Open the run this was pushed to">${ico('check')} Pushed to ${esc(FLOW_LABEL[FLOW_NEXT[m.agent]]||'the next phase')}</button>`:'')
    +(m.agent==='completion'&&m.status==='done'?`<button class="btn" id="toSummary" title="All Test Flow phases of this ticket on one page">${ico('chart',13)} Open Run Summary</button>`:'')
    +(canReplicate(m)?`<button class="btn" id="toQa" title="Turn this result into a process and run it in QA MCP">${ico('term')} Replicate in QA MCP</button>`:'')
    +((m.agent==='qamcp'||m.agent==='execution')&&m.status==='done'&&m.eps?`<button class="btn" id="toTests" title="Write automated tests that replicate this run">${ico('code')} Create autotests</button>`:'')
    +(m.status==='done'?`<button class="btn" id="toBug">${ico('bug')} Report a bug</button>`:'');
  if($('#pushNext'))$('#pushNext').onclick=async()=>{
    $('#pushNext').disabled=true;
    try{
      const next=await post('/api/runs/'+m.id+'/push',{});
      toast('Pushed to '+FLOW_LABEL[next.agent]);
      showTab('flow');
      await open(next.id);
    }catch(e){toast(e.message,'bad');$('#pushNext').disabled=false}
  };
  if($('#pushedTag'))$('#pushedTag').onclick=()=>{const t=RUNS.find(r=>r.id===m.pushedTo);showTab('flow');open(m.pushedTo)};
  if($('#toSummary'))$('#toSummary').onclick=()=>rsAutoOpen(m.ticket);
  if($('#toTests'))$('#toTests').onclick=()=>askComment(m);
  if($('#toQa'))$('#toQa').onclick=()=>{
    if(repReady(m.id)){loadReplicate(jobOf('replicate',m.id),true);showTab('qamcp');$('#qProcess').focus();syncJobButtons(m);return}
    startJobFor('replicate',m,'The QA MCP process');
  };
  syncJobButtons(m);
  if($('#cancel'))$('#cancel').onclick=()=>api('/api/runs/'+m.id+'/cancel',{method:'POST'}).then(()=>reload(m.id));
  if($('#toBug'))$('#toBug').onclick=()=>{
    if(bugApps().some(a=>a.key===m.agent))bSel=m.agent;
    showBugs();$('#bTicket').value=m.ticket;renderBugAgents();$('#bTitle').focus();
  };
  const r=$('#result');
  if(m.status==='running'){r.innerHTML='';return}
  let h='';
  if(m.error)h+=`<div class="sec-head"><h4 style="color:var(--bad)">Error</h4></div><pre class="errpre">${esc(m.error)}</pre>`;
  const out=m.report||(!m.error&&m.finalText)||'';
  if(out)h+=`<div class="sec-head"${m.error?' style="margin-top:20px"':''}><h4>${m.report?'Report':'Agent answer'}</h4>${m.reportStatus?`<span class="tag-s">${esc(m.reportStatus)}</span>`:''}<span class="grow"></span><button class="btn sm" id="copy">${ico('copy',13)} Copy</button></div>${m.report&&m.view?reportBlock(m,m.view):`<pre>${esc(out)}</pre>`}`;
  h+=chatQualitySection(m);
  if(!h)h=`<div class="muted-note">${m.status==='cancelled'?'The run was cancelled before it produced a report.':'No report was produced.'}</div>`;
  h+=savedBlock(m);
  r.innerHTML=h;
  bindStaging(m);
  if($('#copy'))$('#copy').onclick=()=>{navigator.clipboard.writeText(m.report||m.finalText||'');$('#copy').innerHTML=ico('check',13)+' Copied'};
}

/* ---------- analysis result -> QA MCP process ---------- */
/* Only a finished analysis or test design that actually produced a report can be replicated. */
function canReplicate(m){
  const a=agents.find(x=>x.key===m.agent);
  return !!a&&(a.mode==='qa'||a.mode==='design')&&m.status==='done'&&!!m.report&&!/PRZERWANO/i.test(m.reportStatus||'');
}
/* What the prompt engineer assumed or could not confirm, shown under the process field. Nothing was run. */
function qBriefShow(r,m,started){
  const warn=[];
  if(r.unknownTools&&r.unknownTools.length)warn.push('These tools are not in the endpoint catalogue: <span class="mono">'+r.unknownTools.map(esc).join(', ')+'</span>');
  if(r.tooLong)warn.push('The process is longer than the 8000-character limit of this field. Shorten it before running.');
  const notes=(r.notes||[]).map(n=>{
    const k=n.match(/^(CHANGED|ADDED|ASSUMED|TO CONFIRM):\s*(.*)$/i);
    return k?'<li><span class="tg'+(/confirm/i.test(k[1])?' q':'')+'">'+esc(k[1].toUpperCase())+'</span><span>'+esc(k[2])+'</span></li>'
            :'<li><span class="tg">NOTE</span><span>'+esc(n)+'</span></li>';
  }).join('');
  $('#qBrief').innerHTML='<div class="pe-hint"><b>Written by the prompt engineer</b> from the '+esc(m.label)+' result of <span class="mono">'+esc(m.id)+'</span>.'+(started?' The test was started automatically.':' Review it and select Run test process.')+'</div>'
    +warn.map(w=>'<div class="pe-warn" style="margin:10px 0 0">'+w+'</div>').join('')
    +(notes?'<ul class="pe-notes" style="margin-top:10px">'+notes+'</ul>':'');
}
