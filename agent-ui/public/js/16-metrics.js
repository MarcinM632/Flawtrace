// QA Agents UI: Metrics generation. Pick a statistic, a period and a scope (apps/services or a
// Jira release), generate — the server computes it once and saves the result, so a saved chart
// is a frozen snapshot, not a live query. This file only builds the form, asks the server to
// compute, and draws whatever chart type comes back (donut / ranked bars / trend line).
let MG_CATALOG=null,MG_ITEMS=[],MG_PERIOD='all',EC_PERIOD='90',MV_CURRENT=null;

function renderChartInto(sel,rec){
  const d=rec.data;
  if(!d){$(sel).innerHTML='<div class="hint">No data.</div>';return}
  if(d.chartType==='donut'){
    if(!d.parts.length){$(sel).innerHTML='<div class="hint">No data for this selection.</div>';return}
    donutCard(sel,d.parts,{aria:rec.title,centerSub:d.centerSub});
  }else if(d.chartType==='bars'){
    if(!d.rows.length){$(sel).innerHTML='<div class="hint">No data for this selection.</div>';return}
    hbars(sel,d.rows,{rgt:160,aria:rec.title});
  }else if(d.chartType==='trend'){
    trendCard(sel,d.points||[],{aria:rec.title});
  }else if(d.chartType==='pareto'){
    if(!d.rows.length){$(sel).innerHTML='<div class="hint">No data for this selection.</div>';return}
    paretoCard(sel,d.rows,{aria:rec.title});
  }else if(d.chartType==='multiline'){
    if(!d.series||!d.series[0]||!d.series[0].points.length){$(sel).innerHTML=mgJiraNote(d)||'<div class="hint">No data for this selection.</div>';return}
    multiTrendCard(sel,d.series,{aria:rec.title,areaBetween:d.areaBetween});
    const note=mgJiraNote(d); if(note)$(sel).insertAdjacentHTML('beforeend',note);
  }else if(d.chartType==='boxplot'){
    if(!d.rows.length){$(sel).innerHTML=mgJiraNote(d)||'<div class="hint">No data for this selection — sync Jira first (Bug registry tab) or try again shortly.</div>';return}
    boxplotCard(sel,d.rows,{aria:rec.title});
  }else if(d.chartType==='econometric'){
    renderEconCompact(sel,rec);
  }else{
    $(sel).innerHTML='<div class="hint">Unknown chart type.</div>';
  }
}
/** Jira-backed stats (defects opened/closed, resolution time) fetch lazily in the background —
 * show a plain status line instead of silently looking broken while that first fetch runs. */
function mgJiraNote(d){
  if(!d||!d.jira)return'';
  if(d.jira.busy)return'<div class="hint">Fetching from Jira for the first time — this can take a minute or two. Reopen this chart shortly.</div>';
  if(d.jira.ok===false&&d.jira.error)return`<div class="hint">Jira sync failed: ${esc(d.jira.error)}</div>`;
  return'';
}
function renderEconCompact(sel,rec){
  const d=rec.data;
  const coefs=d.coefficients.filter(c=>c.name!=='Intercept');
  const sigN=coefs.filter(c=>c.significant).length;
  if(!coefs.length){$(sel).innerHTML='<div class="hint">No coefficients.</div>';return}
  const rows=coefs.map(c=>({
    label:c.name,
    value:Math.abs(c.beta),
    vlabel:(c.beta>=0?'+':'')+c.beta.toFixed(3),
    dot:c.significant?'var(--ok)':'var(--ink4)',
    tip:`${esc(c.name)}: β=${c.beta.toFixed(4)}  t=${c.t!=null?c.t.toFixed(2):'—'}  p=${c.p!=null?c.p.toFixed(4):'—'}`
  })).sort((a,b)=>b.value-a.value);
  hbars(sel,rows,{L:132,rgt:64,rh:26,fs:11.5,aria:rec.title,barColor:'var(--acc)'});
  $(sel).insertAdjacentHTML('beforeend',`<div class="econ-badges" style="margin-top:8px">
    <div class="econ-badge"><span class="l">N</span><span class="v">${d.n}</span></div>
    <div class="econ-badge${d.r2<0.3?' warn':''}"><span class="l">R²</span><span class="v">${d.r2.toFixed(2)}</span></div>
    <div class="econ-badge"><span class="l">Significant X</span><span class="v">${sigN}/${d.xs.length}</span></div>
  </div><p class="hint">${esc(d.yLabel)} explained by ${esc(d.xLabels.join(', '))}. Click to open the full report.</p>`);
}

async function loadMetricsGen(){
  if(!MG_CATALOG){
    try{MG_CATALOG=await api('/api/metrics/catalog')}catch(e){$('#mgGallery').innerHTML=`<div class="hint">Could not reach the server.</div>`;return}
    mgRenderForm();
    ecRenderForm();
  }else{
    try{MG_CATALOG=await api('/api/metrics/catalog')}catch(e){/* keep the form as-is if a refresh fails */}
  }
  renderDlStatus();
  try{const d=await api('/api/metrics');MG_ITEMS=d.items||[]}catch(e){MG_ITEMS=[]}
  renderGallery();
}
function renderDlStatus(){
  const dl=MG_CATALOG&&MG_CATALOG.defectLifecycle;
  if(!dl){$('#mgDlSt').textContent='';return}
  if(dl.busy){$('#mgDlSt').textContent='Jira defect history: fetching now — this can take a minute or two.';return}
  if(!dl.fetchedAt){$('#mgDlSt').textContent='Jira defect history: not fetched yet. Needed for "Defects opened vs closed" and "Defect resolution time".';return}
  const ago=Math.max(0,Math.round((Date.now()-dl.fetchedAt)/60000));
  $('#mgDlSt').textContent=dl.ok===false?`Jira defect history: last sync failed (${dl.error}).`:`Jira defect history: last synced ${ago} min ago.`;
}
$('#mgDlSync').onclick=async()=>{
  $('#mgDlSync').disabled=true;
  try{await api('/api/metrics/defect-lifecycle/sync',{method:'POST'})}catch(e){}
  setTimeout(async()=>{try{MG_CATALOG=await api('/api/metrics/catalog');renderDlStatus()}catch(e){};$('#mgDlSync').disabled=false},2000);
};

/* ---------- Econometric analysis: builder form ---------- */
function ecGranDef(){return (MG_CATALOG.econGranularities||{})[$('#ecGran').value]}
function ecRenderForm(){
  const grans=MG_CATALOG.econGranularities||{};
  $('#ecGran').innerHTML=Object.entries(grans).map(([k,g])=>`<option value="${esc(k)}">${esc(g.label)}</option>`).join('');
  ecOnGranChange();
}
function ecOnGranChange(){
  const g=ecGranDef(); if(!g)return;
  $('#ecGranDesc').textContent=g.label;
  $('#ecY').innerHTML=g.variables.map(v=>`<option value="${esc(v.key)}" title="${esc(v.desc||'')}">${esc(v.label)}</option>`).join('');
  ecRenderX();
}
function ecRenderX(){
  const g=ecGranDef(); if(!g)return;
  const y=$('#ecY').value;
  $('#ecX').innerHTML=g.variables.map(v=>`<label class="${v.key===y?'is-y':''}" title="${esc(v.desc||'')}"><input type="checkbox" value="${esc(v.key)}" ${v.key===y?'disabled':''}> ${esc(v.label)}</label>`).join('');
}
$('#ecGran').onchange=ecOnGranChange;
$('#ecY').onchange=ecRenderX;
$('#ecPeriod').onclick=e=>{
  const b=e.target.closest('[data-p]');if(!b)return;
  EC_PERIOD=b.dataset.p;
  $('#ecPeriod').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));
};
function ecBuildFilters(){
  if(EC_PERIOD==='all')return{};
  return{period:{from:Date.now()-Number(EC_PERIOD)*86400000}};
}
$('#ecGo').onclick=async()=>{
  $('#ecErr').textContent='';
  const granularity=$('#ecGran').value,y=$('#ecY').value;
  const xs=[...document.querySelectorAll('#ecX input:checked')].map(i=>i.value);
  if(!xs.length){$('#ecErr').textContent='Pick at least one explanatory variable.';return}
  $('#ecGo').disabled=true;
  try{
    const rec=await api('/api/metrics/econometrics',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({granularity,y,xs,filters:ecBuildFilters(),title:$('#ecTitle').value})});
    MG_ITEMS.unshift(rec);
    $('#ecTitle').value='';
    renderGallery();
    toast('Model built');
    openMetricView(rec.id);
  }catch(e){$('#ecErr').textContent=e.message}
  finally{$('#ecGo').disabled=false}
};

function mgRenderForm(){
  $('#mgStat').innerHTML=MG_CATALOG.stats.map(s=>`<option value="${esc(s.key)}">${esc(s.label)}</option>`).join('');
  $('#mgApps').innerHTML=MG_CATALOG.apps.map(a=>`<label><input type="checkbox" value="${esc(a.key)}"> ${esc(a.label)}</label>`).join('');
  $('#mgReleaseApp').innerHTML=MG_CATALOG.apps.map(a=>`<option value="${esc(a.key)}">${esc(a.label)}</option>`).join('');
  mgOnStatChange();
  mgRefreshServices();
  mgOnReleaseAppChange();
}
function mgOnStatChange(){
  const stat=MG_CATALOG.stats.find(s=>s.key===$('#mgStat').value);
  $('#mgStatDesc').textContent=stat?stat.desc:'';
  const rel=!!(stat&&stat.needsRelease);
  $('#mgAppsField').hidden=rel;
  $('#mgServicesField').hidden=rel;
  $('#mgReleaseField').hidden=!rel;
  $('#mgErr').textContent='';
}
function mgOnReleaseAppChange(){
  const names=(MG_CATALOG.releases[$('#mgReleaseApp').value]||[]);
  $('#mgReleaseName').innerHTML=names.length?names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join('')
    :'<option value="">No releases cached yet for this app</option>';
}
function mgRefreshServices(){
  const checked=[...document.querySelectorAll('#mgApps input:checked')].map(i=>i.value);
  const apps=checked.length?checked:MG_CATALOG.apps.map(a=>a.key);
  const names=new Set();
  apps.forEach(a=>(MG_CATALOG.servicesByApp[a]||[]).forEach(s=>names.add(s)));
  const sorted=[...names].sort();
  $('#mgServices').innerHTML=sorted.length?sorted.map(s=>`<label><input type="checkbox" value="${esc(s)}"> ${esc(s)}</label>`).join('')
    :'<p class="hint">No services recorded yet.</p>';
}
$('#mgStat').onchange=mgOnStatChange;
$('#mgReleaseApp').onchange=mgOnReleaseAppChange;
$('#mgApps').onchange=mgRefreshServices;
$('#mgPeriod').onclick=e=>{
  const b=e.target.closest('[data-p]');if(!b)return;
  MG_PERIOD=b.dataset.p;
  $('#mgPeriod').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));
  $('#mgRange').hidden=MG_PERIOD!=='custom';
};

function mgBuildFilters(stat){
  const filters={};
  if(MG_PERIOD==='custom'){
    const f=$('#mgFrom').value,t=$('#mgTo').value;
    const period={};
    if(f)period.from=new Date(f+'T00:00:00').getTime();
    if(t)period.to=new Date(t+'T23:59:59').getTime();
    if(period.from||period.to)filters.period=period;
  }else if(MG_PERIOD!=='all'){
    filters.period={from:Date.now()-Number(MG_PERIOD)*86400000};
  }
  if(stat&&stat.needsRelease){
    const app=$('#mgReleaseApp').value,name=$('#mgReleaseName').value;
    if(app&&name)filters.release={app,name};
  }else{
    const apps=[...document.querySelectorAll('#mgApps input:checked')].map(i=>i.value);
    if(apps.length)filters.apps=apps;
    const services=[...document.querySelectorAll('#mgServices input:checked')].map(i=>i.value);
    if(services.length)filters.services=services;
  }
  return filters;
}
$('#mgGo').onclick=async()=>{
  const stat=MG_CATALOG.stats.find(s=>s.key===$('#mgStat').value);
  $('#mgErr').textContent='';
  if(stat&&stat.needsRelease&&!($('#mgReleaseApp').value&&$('#mgReleaseName').value)){
    $('#mgErr').textContent='Pick an app and a release first.';
    return;
  }
  $('#mgGo').disabled=true;
  try{
    const rec=await api('/api/metrics',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({statKey:stat.key,filters:mgBuildFilters(stat),title:$('#mgTitle').value})});
    MG_ITEMS.unshift(rec);
    $('#mgTitle').value='';
    renderGallery();
    toast('Chart generated');
  }catch(e){$('#mgErr').textContent=e.message}
  finally{$('#mgGo').disabled=false}
};

function renderGallery(){
  $('#mgCount').textContent=MG_ITEMS.length?MG_ITEMS.length+' saved':'';
  if(!MG_ITEMS.length){$('#mgGallery').innerHTML='<div class="hint">No charts yet — build one above.</div>';return}
  $('#mgGallery').innerHTML=`<div class="mgen-gallery">${MG_ITEMS.map(m=>`
    <div class="mg-card" data-id="${m.id}">
      <div class="mg-card-h"><b title="${esc(m.title)}">${esc(m.title)}</b><button class="btn icon sm" data-del="${m.id}" title="Delete">${ico('x',13)}</button></div>
      <p class="mg-card-cap">${esc(m.caption)}</p>
      <div class="chartbox" id="mg-chart-${m.id}"></div>
    </div>`).join('')}</div>`;
  MG_ITEMS.forEach(m=>renderChartInto('#mg-chart-'+m.id,m));
  $('#mgGallery').querySelectorAll('.mg-card').forEach(card=>{
    card.onclick=e=>{if(e.target.closest('[data-del]'))return;openMetricView(card.dataset.id)};
  });
  $('#mgGallery').querySelectorAll('[data-del]').forEach(b=>{
    b.onclick=e=>{e.stopPropagation();mgDelete(b.dataset.del)};
  });
}

async function mgDelete(id){
  if(!confirm('Delete this chart? This cannot be undone.'))return;
  try{
    await api('/api/metrics/'+id,{method:'DELETE'});
    MG_ITEMS=MG_ITEMS.filter(m=>m.id!==id);
    renderGallery();
    if(MV_CURRENT===id)closeMetricView();
  }catch(e){toast(e.message,'err')}
}
function openMetricView(id){
  const rec=MG_ITEMS.find(m=>m.id===id);
  if(!rec)return;
  MV_CURRENT=id;
  $('#mvTitle').textContent=rec.title;
  $('#mvCaption').textContent=rec.caption;
  if(rec.statKey==='econometric_model'){
    renderEconFull(rec);
  }else{
    $('#mvBody').innerHTML='<div class="chartbox" id="mvChart"></div>';
    renderChartInto('#mvChart',rec);
  }
  $('#metricViewModal').hidden=false;
}

/* ---------- Econometric analysis: full report (coefficient table, flags, heatmap, residuals, AI) ---------- */
const SIG_STAR=p=>p==null?'':p<0.001?'★★★':p<0.01?'★★':p<0.05?'★':'';
function renderEconFull(rec){
  const d=rec.data;
  const rows=d.coefficients.map(c=>`<tr class="${c.significant?'sig':''}">
    <td>${esc(c.name)}</td>
    <td>${c.beta.toFixed(4)}</td>
    <td>${c.se.toFixed(4)}</td>
    <td>${c.t!=null?c.t.toFixed(2):'—'}</td>
    <td>${c.p!=null?c.p.toFixed(4):'—'}<span class="star">${SIG_STAR(c.p)}</span></td>
    <td class="${c.vif!=null&&c.vif>10?'vifwarn':''}">${c.vif==null?'—':c.vif===Infinity?'∞':c.vif.toFixed(1)}</td>
  </tr>`).join('');
  const flagsHtml=d.flags.map(f=>`<li class="${/not causation/.test(f)?'causation':''}">${esc(f)}</li>`).join('');
  $('#mvBody').innerHTML=`
    <p class="hint" style="margin-bottom:10px">${esc(d.granularityLabel)} · dependent variable: <b>${esc(d.yLabel)}</b></p>
    <div class="econ-badges">
      <div class="econ-badge"><span class="l">N</span><span class="v">${d.n}</span></div>
      <div class="econ-badge${d.r2<0.3?' warn':''}"><span class="l">R²</span><span class="v">${d.r2.toFixed(3)}</span></div>
      <div class="econ-badge"><span class="l">Adj. R²</span><span class="v">${d.adjR2!=null?d.adjR2.toFixed(3):'—'}</span></div>
      <div class="econ-badge${d.fPValue!=null&&d.fPValue>=0.05?' warn':''}"><span class="l">F-stat (p)</span><span class="v">${d.fStat!=null?d.fStat.toFixed(2):'—'} (${d.fPValue!=null?d.fPValue.toFixed(3):'—'})</span></div>
      ${d.durbinWatson!=null?`<div class="econ-badge${(d.durbinWatson<1||d.durbinWatson>3)?' warn':''}"><span class="l">Durbin-Watson</span><span class="v">${d.durbinWatson.toFixed(2)}</span></div>`:''}
    </div>
    <table class="econ-table"><thead><tr><th>Variable</th><th>β</th><th>SE</th><th>t</th><th>p</th><th>VIF</th></tr></thead><tbody>${rows}</tbody></table>
    <ul class="econ-flags">${flagsHtml}</ul>
    <div class="econ-charts">
      ${d.xLabels.length>1?`<div><p class="hint" style="margin-bottom:6px">Correlation between explanatory variables</p><div class="chartbox" id="mvHeat"></div></div>`:''}
      <div><p class="hint" style="margin-bottom:6px">Residuals vs fitted (even scatter around 0 = good fit)</p><div class="chartbox" id="mvScatter"></div></div>
    </div>
    <button class="btn" id="mvAiGo">${ico('chip',14)} ${d.aiNarrative?'Regenerate AI interpretation':'Generate AI interpretation'}</button>
    <div class="err" id="mvAiErr"></div>
    <div id="mvAiBox">${d.aiNarrative?`<div class="econ-narrative">${esc(d.aiNarrative)}</div>`:''}</div>
  `;
  if(d.xLabels.length>1)heatmapCard('#mvHeat',d.corrMatrix,d.xLabels,{aria:'Correlation between explanatory variables'});
  scatterCard('#mvScatter',d.scatter,{aria:'Residuals vs fitted'});
  $('#mvAiGo').onclick=async()=>{
    $('#mvAiErr').textContent='';
    $('#mvAiGo').disabled=true;
    $('#mvAiBox').innerHTML='<div class="spin"></div>';
    try{
      const updated=await api('/api/metrics/'+rec.id+'/ai',{method:'POST'});
      const idx=MG_ITEMS.findIndex(m=>m.id===rec.id);
      if(idx>=0)MG_ITEMS[idx]=updated;
      $('#mvAiBox').innerHTML=`<div class="econ-narrative">${esc(updated.data.aiNarrative)}</div>`;
      $('#mvAiGo').innerHTML=`${ico('chip',14)} Regenerate AI interpretation`;
    }catch(e){$('#mvAiErr').textContent=e.message;$('#mvAiBox').innerHTML=''}
    finally{$('#mvAiGo').disabled=false}
  };
}
function closeMetricView(){$('#metricViewModal').hidden=true;MV_CURRENT=null}
$('#mvClose').onclick=closeMetricView;
$('#mvDelete').onclick=()=>{if(MV_CURRENT)mgDelete(MV_CURRENT)};
$('#metricViewModal').addEventListener('mousedown',e=>{if(e.target.id==='metricViewModal')closeMetricView()});
document.addEventListener('keydown',e=>{if(!$('#metricViewModal').hidden&&e.key==='Escape')closeMetricView()});
