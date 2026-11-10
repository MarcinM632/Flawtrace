// QA Agents UI: risk. Klasyczny skrypt: wszystkie pliki z js/ dzielą jeden zakres globalny i ładują się po kolei (kolejność jest istotna).
/* ---------- risk metrics ---------- */
/* Severity weights make one critical worth five minors, so a service is ranked by the
   damage it produced, not by how many notes someone happened to write about it. */
const SEVW={krytyczny:5,wazny:3,drobny:1};
const num=(v,d=0)=>v==null?'—':v.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
let TIP=null;

function computeMetrics(){
  const order=bugApps().map(a=>a.key), apps=new Map();
  for(const b of bugs){
    const i=order.indexOf(b.agent); if(i<0)continue;
    let A=apps.get(b.agent);
    if(!A)apps.set(b.agent,A={key:b.agent,label:b.label,ci:i,color:i<3?`var(--app-${i+1})`:'var(--muted)',
      n:0,score:0,k:0,w:0,d:0,tickets:new Set(),svc:new Map()});
    let S=A.svc.get(b.service);
    if(!S)A.svc.set(b.service,S={name:b.service,app:A.label,color:A.color,
      n:0,score:0,k:0,w:0,d:0,tickets:new Set()});
    const wq=SEVW[b.severity]||1,
          sk=b.severity==='krytyczny'?'k':b.severity==='wazny'?'w':'d';
    for(const o of [A,S]){o.n++;o.score+=wq;o[sk]++;if(b.ticket)o.tickets.add(b.ticket)}
  }
  // per = damage score / tickets touched — risk density, the one number this whole tab
  // ranks by. Weighted (not a raw findings count) so one critical outweighs three minors,
  // same currency as "score" everywhere else on the page.
  const fin=o=>{o.sev=o.n?o.score/o.n:0;o.tick=o.tickets.size;o.per=o.tick?o.score/o.tick:null;return o};
  const list=[...apps.values()].sort((a,b)=>a.ci-b.ci)
    .map(A=>{A.svcList=[...A.svc.values()].map(fin).sort((x,y)=>y.score-x.score);return fin(A)});
  return {apps:list,services:list.flatMap(A=>A.svcList)};
}

function tipBind(root){
  if(!TIP){TIP=document.createElement('div');TIP.className='tip';document.body.appendChild(TIP)}
  root.querySelectorAll('[data-tip]').forEach(el=>{
    el.addEventListener('mousemove',e=>{
      TIP.innerHTML=el.dataset.tip;TIP.style.opacity='1';
      const r=TIP.getBoundingClientRect(),p=14;
      let x=e.clientX+p,y=e.clientY+p;
      if(x+r.width>innerWidth-8)x=e.clientX-r.width-p;
      if(y+r.height>innerHeight-8)y=e.clientY-r.height-p;
      TIP.style.left=x+'px';TIP.style.top=y+'px';
    });
    el.addEventListener('mouseleave',()=>{if(TIP)TIP.style.opacity='0'});
  });
}
const tipRows=s=>`<b>${esc(s.name)}</b>`
  +`<div class="r"><span>app</span><span>${esc(s.app||s.label)}</span></div>`
  +`<div class="r"><span>findings</span><span>${s.n}</span></div>`
  +`<div class="r"><span>critical / major / minor</span><span>${s.k} / ${s.w} / ${s.d}</span></div>`
  +`<div class="r"><span>weighted score</span><span>${s.score}</span></div>`
  +`<div class="r"><span>severity index</span><span>${num(s.sev,2)}</span></div>`
  +`<div class="r"><span>tickets touched</span><span>${s.tick}</span></div>`
  +`<div class="r"><span>damage per ticket</span><span>${num(s.per,2)}</span></div>`;

function renderTiles(apps){
  $('#rTiles').innerHTML=apps.map(A=>`<div class="tile">
      <div class="hd"><span class="sw" style="background:${A.color}"></span>${esc(A.label)}</div>
      <div class="big">${A.score}</div>
      <div class="sub">weighted damage score · ${A.n} findings</div>
      <div class="kv">
        <div>Critical<b>${A.k}</b></div>
        <div>Per ticket<b>${num(A.per,1)}</b></div>
        <div>Services<b>${A.svcList.length}</b></div>
        <div>Tickets<b>${A.tick}</b></div>
      </div>
    </div>`).join('');
}

/* One horizontal-bar renderer for every ranked chart on this page. Bars beat bubbles and
   pies here: the job is ranking magnitude, and length on a common baseline is the only
   encoding people read accurately. Every bar shares ONE flat hue — these are nominal
   categories (services), so color-ramping by value would double-encode the same number
   the length already shows. Identity, where it matters, rides a small dot beside the
   label instead of recoloring the bar, so ranking and identity never collide. */
function roundedBarPath(x,y,w,h,r){
  const rr=Math.max(0,Math.min(r,h/2,w));
  if(rr<0.75)return `M${x},${y} h${w} v${h} h${-w}Z`;
  return `M${x},${y} h${w-rr} a${rr},${rr} 0 0 1 ${rr},${rr} v${h-2*rr} a${rr},${rr} 0 0 1 ${-rr},${rr} h${-(w-rr)}Z`;
}
function hbars(sel,rows,opt){
  opt=opt||{};
  const W=opt.W||Math.max(640,Math.round($(sel).clientWidth)||900), rh=opt.rh||32, L=opt.L||212, RG=opt.rgt||128;
  const foot=opt.ref!=null?22:6, H=rows.length*rh+foot;
  const max=opt.max||Math.max(1,...rows.map(r=>r.value));
  const bw=Math.max(40,W-L-RG), cut=opt.cut||26, barColor=opt.barColor||'var(--risk)';
  let g='';
  rows.forEach((r,i)=>{if(i%2===0)g+=`<rect x="0" y="${i*rh+1}" width="${W}" height="${rh-2}" rx="4" fill="var(--surface2)"/>`});
  if(opt.ref!=null&&opt.ref>0){
    const x=L+opt.ref/max*bw;
    g+=`<line x1="${x}" y1="2" x2="${x}" y2="${rows.length*rh}" stroke="var(--muted)" stroke-width="1.25" stroke-dasharray="4 4"/>`
      +`<text x="${x+5}" y="${rows.length*rh+15}" font-size="10.5" font-weight="600" fill="var(--muted)">${esc(opt.refLabel||'median')}</text>`;
  }
  rows.forEach((r,i)=>{
    const h=Math.min(16,rh-14), y=i*rh+(rh-h)/2, wpx=Math.max(2,r.value/max*bw), lx=r.dot?16:6;
    const nm=r.label.length>cut?r.label.slice(0,cut-1)+'…':r.label;
    if(r.dot)g+=`<circle cx="8" cy="${y+h/2}" r="3" fill="${r.dot}"/>`;
    g+=`<text x="${lx}" y="${y+h-3.5}" font-size="${opt.fs||12.5}" font-weight="500" fill="var(--ink)">${esc(nm)}</text>`
      +`<path d="${roundedBarPath(L,y,wpx,h,3)}" fill="${barColor}" data-tip="${esc(r.tip)}" style="cursor:pointer"/>`
      +`<text x="${L+wpx+9}" y="${y+h-3.5}" font-size="${opt.fs||12}" font-weight="600" fill="var(--ink)">${esc(r.vlabel)}</text>`;
    if(r.sub)g+=`<text x="${L+wpx+13+String(r.vlabel).length*7.6}" y="${y+h-3.5}" font-size="10.5" fill="var(--muted)">${esc(r.sub)}</text>`;
  });
  $(sel).innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.aria||'')}" font-family="Roboto,Arial,sans-serif">${g}</svg>`;
  tipBind($(sel));
}

/* THE headline chart: every service, one list, ranked by damage per ticket touched — the
   forward-looking number, not the historical one. A service that breaks on most of its
   changes surfaces here even with a short history, which is exactly the early warning a
   lifetime-total chart can't give. Capped to the top 10 by default — a long thin-bar list
   reads as noise past a screenful; "Show all" is one click away, not hidden. */
const DENSITY_CAP=10;
let densityPool=[],densityOpen=false;
function renderDensity(m){
  densityPool=m.services.filter(s=>s.tick>0).sort((a,b)=>b.per-a.per);
  drawDensity();
}
function drawDensity(){
  const pool=densityPool;
  if(!pool.length){$('#rWatch').innerHTML='<div class="hint">No ticket data yet.</div>';$('#rMore').hidden=true;return}
  const v=[...pool].map(s=>s.per).sort((a,b)=>a-b);
  const med=v.length%2?v[(v.length-1)/2]:(v[v.length/2-1]+v[v.length/2])/2;
  const view=densityOpen?pool:pool.slice(0,DENSITY_CAP);
  const rows=view.map(s=>({
    label:s.name,value:s.per,vlabel:num(s.per,1),dot:s.color,
    sub:s.tick<=2?'low n':'',tip:tipRows(s)}));
  hbars('#rWatch',rows,{rgt:150,ref:med,refLabel:'median '+num(med,1),
    aria:'Risk density by service'});
  $('#rWatchLeg').innerHTML=densityLegend();
  const more=$('#rMore');
  if(pool.length>DENSITY_CAP){
    more.hidden=false;
    more.classList.toggle('open',densityOpen);
    more.innerHTML=`<span>${densityOpen?`Show top ${DENSITY_CAP} only`:`Show all ${pool.length} services`}</span><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
  }else more.hidden=true;
}
const densityLegend=()=>`<span class="rcap">● = app</span><span class="rcap">dashed = median</span><span class="rcap warn">low n = ≤2 tickets</span>`;
$('#rMore').onclick=()=>{densityOpen=!densityOpen;drawDensity()};

/* Historical total, one donut per app instead of a stacked bar — the stacked bar gave every
   service in an app the SAME hue, stepped only by opacity, so which-service-is-which was
   unreadable past the top one or two rows. Each service in a donut gets its own color from a
   fixed palette (stable: the same service always lands on the same color while it stays in
   the top 5), named directly in the legend beside it. Capped at 5 named services per app;
   the rest fold into a muted "Other" slice (dataviz skill: a ring reads at most ~6 parts). */
const DAMAGE_PALETTE=['var(--acc)','var(--ok)','var(--warn)','var(--info)','var(--app-2)'];
function renderDamageStack(m){
  const apps=m.apps.filter(A=>A.score>0);
  if(!apps.length){$('#rStack').innerHTML='<div class="hint">No ticket data yet.</div>';return}
  $('#rStack').innerHTML=`<div class="dmg-grid">${apps.map(A=>{
    const top=A.svcList.slice(0,5);
    const rest=A.svcList.slice(5);
    const restScore=rest.reduce((s,x)=>s+x.score,0);
    const parts=top.map((s,i)=>({label:s.name,value:s.score,color:DAMAGE_PALETTE[i%DAMAGE_PALETTE.length],
      tip:tipRows(s)}));
    if(restScore>0)parts.push({label:`Other (${rest.length})`,value:restScore,color:'var(--ink4)',
      tip:`<b>Other ${esc(A.label)} services</b><div class="r"><span>services</span><span>${rest.length}</span></div><div class="r"><span>weighted score</span><span>${restScore}</span></div>`});
    return `<div class="dmg-app">
      <div class="dmg-app-h"><span class="sw" style="background:${A.color}"></span><b>${esc(A.label)}</b><span class="tot">${A.score} total</span></div>
      ${donutChart(parts,{aria:A.label+' damage by service',centerSub:'score'})}
    </div>`;
  }).join('')}</div>`;
  tipBind($('#rStack'));
}

/* The one figure this dashboard leads with: the single riskiest service right now,
   ranked by damage per ticket touched (the forward-looking metric, see renderDensity). */
function renderTopRisk(m){
  const pool=m.services.filter(s=>s.tick>0).sort((a,b)=>b.per-a.per);
  const box=$('#rTopBox');
  if(!pool.length||!pool[0].per){box.hidden=true;return}
  const top=pool[0];
  box.hidden=false;
  $('#rTop').innerHTML=`
    <span class="sw" style="background:${top.color}"></span>
    <div class="mid">
      <div class="lbl">Highest risk right now</div>
      <div class="name">${esc(top.name)}${top.app&&top.app!==top.name?` <span style="color:var(--ink3);font-weight:500;font-size:14px">· ${esc(top.app)}</span>`:''}</div>
    </div>
    <div class="stat"><div class="v">${num(top.per,1)}</div><div class="u">damage per ticket touched</div></div>
    <div class="note2">${top.k?`${top.k} critical finding${top.k===1?'':'s'} · `:''}${top.n} finding${top.n===1?'':'s'} across ${top.tick} ticket${top.tick===1?'':'s'}. Test this service first before its next change.</div>`;
}

/* ---------- test effort & priority forecast ---------- */
/* ISTQB CTFL §5.1.4 "estimation techniques" names extrapolation from recent actuals as the
   technique for iterative work (no separate dev-effort ratio exists here to drive ratio-based
   estimation) — median of past runs for the same app, with the middle-50% band as "±", is
   exactly that: the honest range a new, similar task should fall into, not a point guess. */
function computeTimeStats(){
  const byApp=new Map();
  RUNS.filter(r=>r.status==='done'&&r.finishedAt&&bugApps().some(a=>a.key===r.agent)).forEach(r=>{
    if(!byApp.has(r.agent))byApp.set(r.agent,{key:r.agent,label:r.label,durs:[]});
    byApp.get(r.agent).durs.push(secs(r));
  });
  return [...byApp.values()].map(a=>{
    const v=[...a.durs].sort((x,y)=>x-y);
    const q=p=>v[Math.min(v.length-1,Math.floor(p*(v.length-1)))];
    return {...a,n:v.length,p25:q(.25),med:q(.5),p75:q(.75)};
  }).filter(a=>a.n>0).sort((a,b)=>b.med-a.med);
}
function renderTimeChart(){
  const apps=computeTimeStats();
  if(!apps.length){$('#rTime').innerHTML='<div class="hint">No finished runs yet.</div>';$('#rTimeLeg').innerHTML='';return}
  const appColor=k=>{const A=bugApps().find(a=>a.key===k);const i=bugApps().indexOf(A);return i<3?`var(--app-${i+1})`:'var(--muted)'};
  const rows=apps.map(a=>({
    label:a.label,value:a.med,vlabel:fmtSecs(a.med),dot:appColor(a.key),
    sub:a.n>=3?`± ${fmtSecs(a.p25)}–${fmtSecs(a.p75)}`:'low n',
    tip:`<b>${esc(a.label)}</b><div class="r"><span>median</span><span>${fmtSecs(a.med)}</span></div>`
      +(a.n>=3?`<div class="r"><span>middle 50%</span><span>${fmtSecs(a.p25)}–${fmtSecs(a.p75)}</span></div>`:'')
      +`<div class="r"><span>finished runs</span><span>${a.n}</span></div>`}));
  hbars('#rTime',rows,{rgt:160,aria:'Expected testing time by app, median with middle-50% range'});
  $('#rTimeLeg').innerHTML=`<span class="rcap">● = app</span><span class="rcap warn">low n = fewer than 3 finished runs</span>`;
}

/* Same service list as the weighted density chart above, but the plain (unweighted) average —
   "what to expect" rather than "how bad it is when it happens". The two can rank services
   differently: a service with many minor bugs can lead here while trailing on weighted risk. */
function renderBugsAvgChart(m){
  const pool=m.services.filter(s=>s.tick>0).map(s=>({...s,avg:s.n/s.tick})).sort((a,b)=>b.avg-a.avg).slice(0,DENSITY_CAP);
  if(!pool.length){$('#rBugsAvg').innerHTML='<div class="hint">No ticket data yet.</div>';$('#rBugsAvgLeg').innerHTML='';return}
  const rows=pool.map(s=>({label:s.name,value:s.avg,vlabel:num(s.avg,2),dot:s.color,
    sub:s.tick<=2?'low n':'',tip:tipRows(s)}));
  hbars('#rBugsAvg',rows,{rgt:150,aria:'Average bugs per task by service'});
  $('#rBugsAvgLeg').innerHTML=`<span class="rcap">● = app</span><span class="rcap warn">low n = ≤2 tickets</span>`;
}

/* Priority tier = where a service's risk level (likelihood × impact, i.e. the weighted "per"
   already computed above) sits among its peers — tertiles, not fixed thresholds, since "high
   risk" is relative to this registry's own history (ISTQB CTAL-TM: risk is not evenly spread
   across test items, so there is no universal cutoff). Services with too little history (≤2
   tickets) are never ranked "High": one unlucky ticket should not brand a service permanently. */
const PRI_TIER={High:{color:'var(--bad)',note:'test first, most rigor'},Medium:{color:'var(--warn)',note:'normal pass'},Low:{color:'var(--ok)',note:'can wait, lighter pass'}};
function renderPriorityList(m){
  const ranked=m.services.filter(s=>s.tick>0).sort((a,b)=>b.per-a.per);
  const pers=ranked.filter(s=>s.tick>2).map(s=>s.per).sort((a,b)=>a-b);
  const q=(p)=>pers.length?pers[Math.min(pers.length-1,Math.floor(p*(pers.length-1)))]:0;
  const hi=q(.67),lo=q(.33);
  const tier=s=>s.tick<=2?null:s.per>=hi?'High':s.per<=lo?'Low':'Medium';
  const rows=ranked.slice(0,12).map(s=>{
    const t=tier(s);
    const badge=t?`<span class="pill" style="color:${PRI_TIER[t].color};background:color-mix(in srgb,${PRI_TIER[t].color} 14%,transparent);border-color:color-mix(in srgb,${PRI_TIER[t].color} 40%,transparent)"><span class="d" style="background:${PRI_TIER[t].color}"></span>${t}</span>`
      :`<span class="pill" style="color:var(--ink4)"><span class="d" style="background:var(--ink4)"></span>low n</span>`;
    return `<tr><td class="mono">${esc(s.name)}</td><td>${esc(s.app)}</td><td>${num(s.n/s.tick,2)}</td><td>${num(s.per,1)}</td><td>${badge}</td><td class="t">${t?PRI_TIER[t].note:'too little history ('+s.tick+' ticket'+(s.tick===1?'':'s')+')'}</td></tr>`;
  }).join('');
  $('#rPriority').innerHTML=ranked.length?`<div style="overflow-x:auto"><table class="dtbl">
    <thead><tr><th>Service</th><th>App</th><th>Avg bugs/task</th><th>Risk score</th><th>Priority</th><th>What it means</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>${ranked.length>12?`<p class="rlede" style="margin-top:10px">Showing the top 12 of ${ranked.length} services by risk score.</p>`:''}`
    :'<div class="hint">No ticket data yet.</div>';
}

function renderRisk(){
  if($('#view-risk').hidden)return;
  const m=computeMetrics();
  if(!m.apps.length){$('#rTiles').innerHTML='<div class="hint">The registry is empty.</div>';$('#rTopBox').hidden=true;return}
  renderTopRisk(m);
  renderTiles(m.apps);
  const sev=m.apps.reduce((a,A)=>({k:a.k+A.k,w:a.w+A.w,d:a.d+A.d}),{k:0,w:0,d:0});
  donutCard('#rSev',[
    {label:'Critical',value:sev.k,color:'var(--bad)'},
    {label:'Major',value:sev.w,color:'var(--warn)'},
    {label:'Minor',value:sev.d,color:'var(--ok)'},
  ],{aria:'Findings split by severity',centerSub:'findings'});
  donutCard('#rApp',m.apps.map(A=>({label:A.label,value:A.score,color:A.color})),
    {aria:'Weighted damage split by application',centerSub:'score'});
  renderDensity(m);
  renderDamageStack(m);
  renderTimeChart();
  renderBugsAvgChart(m);
  renderPriorityList(m);
}
