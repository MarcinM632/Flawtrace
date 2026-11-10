// QA Agents UI: raport jako karty. Klasyczny skrypt: wszystkie pliki z js/ dzielą jeden zakres globalny.
/* The server parses the report (lib/report-format.js) and sends it as `view`; null means the raw text is shown.
   Cards follow the Autotests case card: what happened, step by step, expected vs actual. */
const RV_VERDICT={SUKCES:'p-done','RAPORT OK':'p-done','PROJEKT OK':'p-done',BŁĄD:'p-failed',NIEWERYFIKOWALNE:'p-running',PRZERWANO:'p-cancelled'};
function rvPill(v){if(!v)return '';const k=Object.keys(RV_VERDICT).find(x=>String(v).toUpperCase().includes(x));return `<span class="pill ${RV_VERDICT[k]||'p-cancelled'}"><span class="d"></span>${esc(v)}</span>`}
function rvSteps(steps){
  if(!steps||!steps.length)return '';
  return '<ol class="fc-steps">'+steps.map(s=>'<li'+(s.bad?' class="bad"':s.obs?' class="obs"':'')+'>'+(s.bad?'<b>Here it went wrong:</b> ':s.obs?'<b>Here you see it:</b> ':'')+esc(s.text)+'</li>').join('')+'</ol>';
}
function rvCmp(exp,act,expLabel,actLabel){
  if(!exp&&!act)return '';
  return '<div class="fc-cmp'+(exp?'':' one')+'">'+(exp?`<div><span>${expLabel||'Expected'}</span>${esc(exp)}</div>`:'')+`<div class="act"><span>${actLabel||'Actual'}</span>${esc(act||'—')}</div></div>`;
}
const RV_SCOPE={ZROBIONO:'ok',POMINIĘTO:'warn','NIE DA SIĘ PRZEZ MCP':'muted'};
function rvQamcp(v){
  let h=`<div class="rv-head">${rvPill(v.verdict)}<p>${esc(v.summary||'')}</p></div>`;
  if(v.scope.length)h+='<div class="rv-sec"><h5>What was asked</h5><ul class="rv-scope">'+v.scope.map(s=>`<li class="${RV_SCOPE[s.tag]||'muted'}"><span class="rv-tag">${esc(s.tag)}</span><span>${esc(s.text)}</span></li>`).join('')+'</ul></div>';
  if(v.steps.length)h+=`<div class="rv-sec"><h5>${v.format==='legacy'?'Replication':'What was done'}</h5>${rvSteps(v.steps)}</div>`;
  if(v.errors.length)h+='<div class="rv-sec"><h5>Errors</h5>'+v.errors.map((e,i)=>'<div class="fc"><div class="fc-h"><span class="fc-t2">'+esc(e.title||('Error '+(i+1)))+'</span>'+(e.kind?`<span class="rv-kind">${esc(e.kind)}</span>`:'')+'</div>'
    +'<div class="rv-chips">'+(e.step?`<span>step ${esc(e.step)}</span>`:'')+(e.endpoint?`<span class="mono">${esc(e.endpoint)}</span>`:'')+(!e.endpoint&&e.where?`<span>${esc(e.where)}</span>`:'')+'</div>'
    +rvCmp(e.expected,e.actual,'Expected','Got')+(e.gate?`<div class="rv-line"><b>Defect check:</b> ${esc(e.gate)}</div>`:'')+'</div>').join('')+'</div>';
  if(v.skipped)h+=`<div class="rv-line"><b>Skipped:</b> ${esc(v.skipped)}</div>`;
  if(v.endState)h+=`<div class="rv-line"><b>Left the environment:</b> ${esc(v.endState)}</div>`;
  return h;
}
function rvAnalysis(v){
  let h=`<div class="rv-head">${rvPill(v.verdict)}<p><span class="mono">${esc(v.ticket)}</span>${v.cases.length?` · ${v.cases.length} finding${v.cases.length>1?'s':''}`:''}</p></div>`;
  if(v.none)h+=`<div class="muted-note">${esc(v.none)}</div>`;
  h+=v.cases.map(c=>'<div class="fc"><div class="fc-h"><span class="fc-t2"><span class="rv-n">'+c.n+'</span>'+esc(c.title)+'</span></div>'
    +rvCmp(c.expected,c.actual,'Should be',c.expected?'Happens':'What happens')
    +(c.impact?`<div class="rv-line"><b>Why it matters:</b> ${esc(c.impact)}</div>`:'')
    +(c.steps.length?'<h6 class="rv-h6">How to reproduce</h6>'+rvSteps(c.steps):'')
    +(c.proof?`<div class="rv-proof"><span>Evidence</span><code>${esc(c.proof)}</code></div>`:'')+'</div>').join('');
  if(v.manual)h+=`<div class="rv-line"><b>To check by hand:</b> ${esc(v.manual)}</div>`;
  if(v.clean)h+=`<div class="rv-line"><b>Checked and clean:</b> ${esc(v.clean)}</div>`;
  if(v.coverage)h+=`<div class="rv-line mono">${esc(v.coverage)}</div>`;
  return h;
}
function rvDesign(v){
  let h=`<div class="rv-head">${rvPill(v.verdict)}<p>${esc(v.title)}</p></div>`;
  if(v.head.length)h+='<dl class="rv-kv">'+v.head.map(x=>`<dt>${esc(x.k)}</dt><dd>${esc(x.v)}</dd>`).join('')+'</dl>';
  h+=v.sections.map(s=>'<div class="fc"><div class="fc-h"><span class="fc-t2"><span class="rv-n">'+s.n+'</span>'+esc(s.title)+'</span>'+(s.technique?`<span class="rv-kind">${esc(s.technique)}</span>`:'')+'</div>'
    +'<div class="rv-checks">'+s.checks.map(c=>`<div class="rv-check"><div class="a">${esc(c.action)}</div><div class="e">${c.expected?'→ '+esc(c.expected):''}</div>${c.src?`<code>${esc(c.src)}</code>`:''}</div>`).join('')+'</div>'
    +(s.notCovered&&s.notCovered!=='-'?`<div class="rv-line"><b>Not covered:</b> ${esc(s.notCovered)}</div>`:'')+'</div>').join('');
  if(v.confirm.length)h+='<div class="rv-sec"><h5>To confirm before testing</h5><ul class="rv-confirm">'+v.confirm.map(c=>`<li>${esc(c)}</li>`).join('')+'</ul></div>';
  return h;
}
function rvAudit(m){
  const a=m.audit;if(!a)return '';
  const what=m.agent==='qamcp'||m.agent==='execution'?'every endpoint named in the report was really called in this run':`every file:line evidence${a.checked?` (${a.checked})`:''} exists in the downloaded code`;
  if(a.noCode)return '';
  if(!a.issues.length)return `<div class="rv-audit ok">${ico('check',13)} <span><b>Report check passed:</b> ${what}${a.corrected?'. The agent corrected the report after the first check found: '+esc((a.before||[]).map(i=>i.text).join('; ')):''}</span></div>`;
  return `<div class="rv-audit bad"><b>Report check: ${a.issues.length} problem${a.issues.length>1?'s':''} the agent did not fix</b><ul>${a.issues.map(i=>`<li>${esc(i.text)}</li>`).join('')}</ul></div>`;
}
/** Full report block: audit, cards, and the raw text one click away. */
const chatPill=v=>`<span class="pill ${v==='PASS'?'p-done':v==='FAIL'?'p-failed':'p-cancelled'}"><span class="d"></span>${esc(v||'Not evaluated')}</span>`;
/* Errors caused by the prompts sent to the MCP chat sit right under the matrix they were counted in: battery questions
   under their battery's (or MCP tool's) matrix, scored single messages under the whole-run matrix. Each row: the prompt
   exactly as sent, what the scorer found wrong, and the answer and tool calls one click away. Passed questions are only
   counted. */
const Q_WHY={FP:'Answered although the right answer is a refusal',FN:'Refused or found nothing although the data exists',WRONG:'Gave wrong data, tool, arguments or format'};
function qErrors(rows,title){
  if(!rows.length)return '';
  const why=c=>[Q_WHY[c.outcome]?`<b>${Q_WHY[c.outcome]}</b>`:'',...Object.entries(c.checks||{}).filter(([,x])=>!x.ok&&x.detail).map(([k,x])=>`${esc(k)}: ${esc(x.detail)}`),
    c.error?esc(c.error):`<small>„${esc(String(c.answer||'').replace(/\s+/g,' ').slice(0,160))}${String(c.answer||'').length>160?'…':''}”</small>`].filter(Boolean).join('<br>');
  return `<div class="q-err"><h6>${esc(title||'Errors from MCP prompts')} · ${rows.length}</h6><table class="q-cases"><tr><th>ID</th><th>Prompt sent</th><th>Outcome</th><th>What went wrong</th></tr>`
    +rows.map(c=>`<tr class="bad"><td class="mono">${esc(c.id)}</td><td><details><summary>${esc(c.message)}</summary>
      <div class="q-det"><div><span>Chat answer</span><pre>${esc(c.answer||c.error||'')}</pre></div>
      <div><span>Tools the chat called</span><pre>${esc((c.toolCalls||[]).map(t=>t.tool+' '+JSON.stringify(t.input)).join('\n')||'none')}</pre></div></div></details></td>
      <td>${chatPill('FAIL').replace('FAIL',esc(c.outcome||'ERROR'))}${c.attempts>1?`<small> ${c.attempts} tries</small>`:''}</td><td>${why(c)}</td></tr>`).join('')+'</table></div>';
}
/** MCP chat section of a run: whole-run matrix, then one matrix per battery / MCP tool, each followed by its errors. */
function chatQualitySection(m){
  const bats=m.batteries||[],chat=m.chat||[];
  const singles=chat.filter(s=>s.evaluation&&OUTCOME_PILL[s.evaluation.outcome]!=='PASS').map(s=>({id:s.ref,message:s.message,outcome:s.evaluation.outcome,
    checks:s.evaluation.checks,answer:s.answer,error:s.error,toolCalls:s.toolCalls,attempts:s.evaluation.attempts}));
  const unscored=chat.filter(s=>!s.evaluation).length;
  const parts=bats.flatMap(b=>b.byIntent?Object.entries(b.byIntent).map(([k,q])=>({q,title:k+' · '+(b.title||'Battery'),rows:b.cases.filter(c=>c.intent===k)}))
    :[{q:b.metrics,title:(b.title||'Battery')+' · '+(b.total??b.cases.length)+' questions · '+fmtMs(b.durationMs)+(b.costUsd?' · $'+b.costUsd:''),rows:b.cases}]);
  // A lone battery of one tool with no scored singles: its matrix is the whole-run matrix, so it is shown once.
  const wholeOnly=parts.length===1&&!chat.some(s=>s.evaluation);
  let h='';
  if(m.quality)h+='<div class="sec-head" style="margin-top:20px"><h4>MCP chat quality for the whole run</h4></div>'+qualityBlock(m.quality)
    +qErrors(wholeOnly?parts[0].rows:singles,wholeOnly?'Errors from MCP prompts':'Errors from single messages');
  if(unscored)h+=`<div class="muted-note">${unscored} message${unscored>1?'s were':' was'} sent without expect and not scored.</div>`;
  if(!wholeOnly&&parts.length)h+='<div class="sec-head" style="margin-top:20px"><h4>MCP chat batteries</h4><span class="tag-s">'+parts.length+'</span></div>'
    +parts.map(p=>qualityBlock(p.q,p.title)+qErrors(p.rows)).join('');
  return h;
}
/* Chat quality: confusion matrix, metrics against the acceptance criteria (agent-ui/kryteria/kryteria_akceptacji_mcp.json)
   and response time. Computed by mcp-server's scorer, never by the agent. */
const Q_METRICS=[['accuracy','Accuracy','Correct answers out of all questions'],['precision','Precision','How often stated data is correct'],
  ['recall','Recall','Answerable questions answered correctly'],['specificity','Specificity','Unanswerable questions correctly refused'],['f1','F1','Balance of precision and recall']];
const fmtPct=v=>v==null?'—':(v*100).toFixed(1)+'%';
const fmtMs=v=>v==null?'—':v>=1000?(v/1000).toFixed(1)+' s':v+' ms';
function qualityBlock(q,title){
  if(!q)return '';
  if(q.error)return `<div class="muted-note">Chat quality could not be computed: ${esc(q.error)}</div>`;
  const M=q.matrix,v=q.verdicts;
  const cell=(k,label,good)=>`<td class="${good?'q-good':'q-bad'}"><b>${M[k]}</b><small>${k} · ${label}</small></td>`;
  return `<div class="fc q">${title?`<div class="fc-h"><span class="fc-t2">${esc(title)}</span><span class="grow"></span>${chatPill(q.overall)}</div>`:''}
    <div class="q-grid"><div><h6>Confusion matrix · ${q.n} questions</h6><table class="q-mx"><tr><th></th><th>Correct data</th><th>Wrong data</th><th>Refused / not found</th></tr>
      <tr><th>Data exists</th>${cell('TP','right',1)}${cell('WRONG','wrong',0)}${cell('FN','missed',0)}</tr>
      <tr><th>Should refuse</th><td class="q-na">—</td>${cell('FP','invented',0)}${cell('TN','refused',1)}</tr></table></div>
    <div><h6>Metrics vs acceptance criteria</h6><table class="q-tb"><tr><th>Metric</th><th>Value</th><th>Required</th><th></th></tr>
      ${Q_METRICS.map(([k,l,d])=>`<tr title="${esc(d)}"><td>${l}</td><td><b>${fmtPct(q.values[k])}</b></td><td>≥ ${fmtPct(q.thresholds[k])}</td><td>${chatPill(v[k])}</td></tr>`).join('')}
      ${[['p50Ms','Latency p50'],['p95Ms','Latency p95'],['maxMs','Latency max']].map(([k,l])=>`<tr><td>${l}</td><td><b>${fmtMs(q.latency[k])}</b></td><td>≤ ${fmtMs(q.latencyLimits[k])}</td><td>${chatPill(v['latency_'+k])}</td></tr>`).join('')}
    </table></div></div>
    <div class="rv-chips"><span>min ${fmtMs(q.latency.minMs)}</span><span>avg ${fmtMs(q.latency.avgMs)}</span>${q.afterChange&&q.afterChange.retriedCases?`<span>re-asked after a change: ${q.afterChange.retriedCases}, passed on retry: ${q.afterChange.passedOnRetry}, consistent after ≤ ${fmtMs(q.afterChange.maxConsistentAfterMs)}</span>`:''}</div>
    ${(q.notes||[]).map(n=>`<div class="rv-line"><b>Inconclusive:</b> ${esc(n)}</div>`).join('')}</div>`;
}
const OUTCOME_PILL={TP:'PASS',TN:'PASS',FP:'FAIL',FN:'FAIL',WRONG:'FAIL'};
function reportBlock(m,v){
  const body=v.kind==='qamcp'?rvQamcp(v):v.kind==='analysis'?rvAnalysis(v):rvDesign(v);
  return rvAudit(m)+'<div class="rv">'+body+'</div><details class="rv-raw"><summary>Raw report text</summary><pre>'+esc(m.report||'')+'</pre></details>';
}
