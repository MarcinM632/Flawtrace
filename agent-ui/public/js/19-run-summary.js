// QA Agents UI: Run Summary (Test Flow phase 8). One page, built fresh on every open from the
// phase runs already on disk — no new state of its own, so nothing here can go stale or need
// cleanup. Manual mode: run Completion, then open this tab and pick the ticket. Auto mode: 03-runs.js
// opens this tab on its own the moment the chain's Completion run finishes (see rsAutoOpen below).
const RS_ICON={planning:'flask',analysis:'term',design:'code',implementation:'layers',execution:'play',completion:'check'};
const RS_STATUS_LABEL={done:'Done',running:'Running…',failed:'Failed',cancelled:'Cancelled',missing:'Not run yet'};
const RS_OVERALL={
  PASS:{cls:'ok',label:'All phases clean',text:'Every phase ran, finished and passed its own report check.'},
  FAIL:{cls:'bad',label:'Needs attention',text:'At least one phase failed, was flagged by its report check, or ended in error.'},
  RUNNING:{cls:'warn',label:'Still running',text:'At least one phase for this ticket is in progress right now.'},
  PARTIAL:{cls:'warn',label:'Incomplete chain',text:'One or more phases were never run for this ticket.'},
  EMPTY:{cls:'muted',label:'Nothing to show',text:'No Test Flow phase has been run yet for this ticket.'},
};

async function loadRunSummary(){
  $('#rsRecent').innerHTML='<span class="hint">Loading recent tickets…</span>';
  try{
    const{tickets}=await api('/api/run-summary/recent');
    $('#rsRecent').innerHTML=tickets.length
      ?'<span class="hint">Recent:</span> '+tickets.map(t=>`<button class="chip" data-rs-t="${esc(t)}">${esc(t.length>40?t.slice(0,39)+'…':t)}</button>`).join(' ')
      :'<span class="hint">No Completion run yet.</span>';
  }catch(e){$('#rsRecent').innerHTML='';}
  const pending=sessionStorage.getItem('rs.open');
  if(pending){sessionStorage.removeItem('rs.open');$('#rsTicket').value=pending;rsShow(pending)}
}
$('#rsRecent').onclick=e=>{const b=e.target.closest('[data-rs-t]');if(!b)return;$('#rsTicket').value=b.dataset.rsT;rsShow(b.dataset.rsT)};
$('#rsGo').onclick=()=>rsShow($('#rsTicket').value.trim());
$('#rsTicket').onkeydown=e=>{if(e.key==='Enter')rsShow($('#rsTicket').value.trim())};

/** Called by 03-runs.js auto-mode polling once a Completion run finishes — opens straight to it. */
function rsAutoOpen(ticket){
  sessionStorage.setItem('rs.open',ticket);
  showTab('runsummary');
}

async function rsShow(ticket){
  if(!ticket){toast('Type or pick a ticket first','err');return}
  $('#rsBody').innerHTML='<div class="spin"></div>';
  let d;
  try{d=await api('/api/run-summary/'+encodeURIComponent(ticket))}catch(e){$('#rsBody').innerHTML=`<div class="hint">${esc(e.message)}</div>`;return}
  const ov=RS_OVERALL[d.overall]||RS_OVERALL.EMPTY;
  const ran=d.phases.filter(p=>p.status!=='missing').length;
  $('#rsBody').innerHTML=`
    <div class="rs-banner ${ov.cls}">
      <div class="rs-banner-top"><span class="rs-banner-pill">${esc(ov.label)}</span><span class="rs-banner-t">${esc(d.ticket)}</span></div>
      <p>${esc(ov.text)} ${ran}/${d.phases.length} phases run.</p>
    </div>
    <ol class="rs-timeline">${d.phases.map(rsPhaseCard).join('')}</ol>`;
  $('#rsBody').querySelectorAll('[data-rs-open]').forEach(b=>{
    b.onclick=()=>{showTab(b.dataset.rsOpen);open(b.dataset.rsId)};
  });
}

function rsPhaseCard(p){
  const missing=p.status==='missing';
  const stLabel=RS_STATUS_LABEL[p.status]||p.status;
  const stCls=missing?'muted':p.status==='done'?(p.auditBad||/BŁĄD|FAIL|PRZERWANO/i.test(p.verdict||'')?'bad':'ok'):p.status==='running'?'warn':p.status==='failed'?'bad':'muted';
  return `<li class="rs-phase rs-${p.key}">
    <div class="rs-dot">${ico(RS_ICON[p.key]||'check',15)}</div>
    <div class="rs-card">
      <div class="rs-card-h">
        <b>${esc(p.label)}</b>
        <span class="rs-chip ${stCls}">${esc(stLabel)}</span>
        ${p.durationMs!=null?`<span class="rs-dur">${rsDuration(p.durationMs)}</span>`:''}
      </div>
      ${missing?'<p class="hint">This phase was never run for this ticket.</p>':`
      <p class="rs-verdict">${esc(p.verdict)}</p>
      ${p.excerpt?`<p class="rs-excerpt">${esc(p.excerpt)}${p.excerpt.length>=220?'…':''}</p>`:''}
      ${p.auditBad?`<div class="rs-audit-bad">${ico('x',12)} Report check found ${p.auditIssues} unresolved problem${p.auditIssues>1?'s':''}.</div>`:(p.status==='done'?`<div class="rs-audit-ok">${ico('check',12)} Report check passed.</div>`:'')}
      ${p.stale?'<p class="hint">This is the latest attempt, which did not finish.</p>':''}
      <button class="linkbtn" data-rs-open="${esc(p.key)}" data-rs-id="${esc(p.id)}">Open full report →</button>`}
    </div>
  </li>`;
}
function rsDuration(ms){
  const m=Math.round(ms/60000);
  if(m<1)return '<1 min';
  if(m<60)return m+' min';
  return (m/60).toFixed(1)+' h';
}
