// QA Agents UI: core. Klasyczny skrypt: wszystkie pliki z js/ dzielą jeden zakres globalny i ładują się po kolei (kolejność jest istotna).
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ico=(n,sz=14)=>`<svg width="${sz}" height="${sz}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const STAT={running:'Running',done:'Completed',failed:'Failed',cancelled:'Cancelled'};
/* Storage keys stay as they are — only the labels are English. */
const SEVL={krytyczny:'Critical',wazny:'Major',drobny:'Minor'};
const fmt=t=>new Date(t).toLocaleString('en-GB',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
const fmtFull=t=>new Date(t).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
const secs=m=>Math.max(0,Math.round(((m.finishedAt||Date.now())-m.startedAt)/1000));
const fmtSecs=s=>s>=3600?Math.floor(s/3600)+'h '+String(Math.floor(s%3600/60)).padStart(2,'0')+'m'
  :Math.floor(s/60)+'m '+String(s%60).padStart(2,'0')+'s';
const dur=m=>fmtSecs(secs(m));
const pill=(cls,txt)=>`<span class="pill p-${cls}"><span class="d"></span>${txt}</span>`;
async function api(p,o){const r=await fetch(p,o);const j=await r.json();if(!r.ok)throw new Error(j.error||r.status);return j}
const post=(p,b)=>api(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});

/* ---------- donut chart: the one part-to-whole chart every tab shares ---------- */
/* A ring with a big center total reads faster than a thin segmented bar or a stacked bar
   where same-hue shades blur into each other — the exact complaint that forced this: in
   "damage by application" every service in an app shared one hue, stepped only by opacity,
   so which-service-is-which was unreadable at a glance. Each arc still carries a rich hover
   tip (data-tip, same convention as hbars/segRow) with the exact count and share. */
function donut(parts,opts={}){
  const total=parts.reduce((s,p)=>s+p.value,0);
  const size=opts.size||150,sw=22,r=size/2-sw/2,c=2*Math.PI*r,cx=size/2,cy=size/2;
  let off=0;
  const arcs=!total?'':parts.map(p=>{
    const frac=p.value/total,len=Math.max(frac*c,p.value?3:0);
    const tip=esc(`<b>${esc(p.label)}</b><div class="r"><span>count</span><span>${p.value}</span></div><div class="r"><span>share</span><span>${Math.round(frac*100)}%</span></div>`);
    const seg=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${p.color}" stroke-opacity="${p.fade!=null?p.fade:1}" stroke-width="${sw}" stroke-linecap="butt" stroke-dasharray="${len} ${Math.max(c-len,0)}" stroke-dashoffset="${-off}" transform="rotate(-90 ${cx} ${cy})" data-tip="${tip}" style="cursor:default"></circle>`;
    off+=len;
    return seg;
  }).join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(opts.aria||'')}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${sw}"></circle>
    ${arcs}
    <text x="${cx}" y="${cy-2}" text-anchor="middle" font-family="var(--display)" font-size="${Math.round(size*0.17)}" font-weight="800" fill="var(--ink)">${total}</text>
    <text x="${cx}" y="${cy+17}" text-anchor="middle" font-size="11" fill="var(--ink3)">${esc(opts.centerSub||'issues')}</text>
  </svg>`;
}
/** Donut + a legend sorted largest-first, each row showing swatch, label, count and share. */
function donutChart(parts,opts={}){
  const total=parts.reduce((s,p)=>s+p.value,0)||1;
  const sorted=[...parts].sort((a,b)=>b.value-a.value);
  return `<div class="donut-wrap">
    ${donut(sorted,opts)}
    <div class="donut-legend">${sorted.map(p=>`<div class="row"><span class="sw" style="background:${p.color};opacity:${p.fade!=null?p.fade:1}"></span><span class="lbl">${esc(p.label)}</span><b>${p.value}</b><span class="pct">${Math.round(p.value/total*100)}%</span></div>`).join('')}</div>
  </div>`;
}
/** Convenience: render into `sel` and wire tooltips in one call. */
function donutCard(sel,parts,opts){ $(sel).innerHTML=donutChart(parts,opts); tipBind($(sel)); }

/* ---------- trend chart: the "something that isn't a bar or a ring" ---------- */
/* A filled line, not a bar per period: counts over time are a continuous story (rising,
   falling, flat), and a line reads that shape in one glance where a row of bars would just
   be a bar chart with extra steps. Gridlines + a capped, evenly-spaced set of x labels (never
   one per point) are what keeps this from turning into the overlapping-label mess a naive
   line chart gets with more than a handful of points. */
let TREND_SEQ=0;
function trendChart(points,opts={}){
  if(!points.length)return '<div class="hint">No data in this range.</div>';
  const W=opts.W||760,H=opts.H||230,padL=40,padR=16,padT=16,padB=30;
  const plotW=W-padL-padR,plotH=H-padT-padB,n=points.length;
  const max=Math.max(1,...points.map(p=>p.value));
  const x=i=>padL+(n>1?i/(n-1)*plotW:plotW/2);
  const y=v=>padT+plotH-(v/max)*plotH;
  const linePts=points.map((p,i)=>`${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const areaPts=`${x(0).toFixed(1)},${(padT+plotH).toFixed(1)} ${linePts} ${x(n-1).toFixed(1)},${(padT+plotH).toFixed(1)}`;
  const gid='trendFill'+(TREND_SEQ++);
  const gridN=3;
  const grid=Array.from({length:gridN+1},(_,i)=>{
    const v=Math.round(max*i/gridN),yy=y(v);
    return `<line x1="${padL}" y1="${yy}" x2="${W-padR}" y2="${yy}" stroke="var(--line)" stroke-width="1"/>`
      +`<text x="${padL-8}" y="${yy+4}" text-anchor="end" font-size="10.5" fill="var(--ink3)">${v}</text>`;
  }).join('');
  const maxLabels=7,step=Math.max(1,Math.ceil(n/maxLabels));
  const labels=points.map((p,i)=>(i%step===0||i===n-1)?`<text x="${x(i).toFixed(1)}" y="${H-10}" text-anchor="middle" font-size="10.5" fill="var(--ink3)">${esc(p.label)}</text>`:'').join('');
  const dots=points.map((p,i)=>`<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.5" fill="var(--acc)"></circle>`
    +`<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="11" fill="transparent" data-tip="${esc(`<b>${esc(p.label)}</b><div class="r"><span>count</span><span>${p.value}</span></div>`)}"></circle>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria||'')}">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="var(--acc)" stop-opacity=".28"/>
      <stop offset="100%" stop-color="var(--acc)" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}
    <polygon points="${areaPts}" fill="url(#${gid})"></polygon>
    <polyline points="${linePts}" fill="none" stroke="var(--acc)" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"></polyline>
    ${dots}${labels}
  </svg>`;
}
function trendCard(sel,points,opts){ $(sel).innerHTML=trendChart(points,opts); tipBind($(sel)); }

/* ---------- multi-line trend: cumulative flow / planned-vs-executed ---------- */
/* Two or more named series sharing one axis — the cumulative-flow read (opened vs closed defects:
   the gap between the lines IS the open backlog) only works as lines, never as grouped bars, so
   this is a distinct primitive from trendChart rather than a "series" option bolted onto it. */
function multiTrendChart(series,opts={}){
  const pts0=(series[0]&&series[0].points)||[];
  if(!pts0.length)return '<div class="hint">No data in this range.</div>';
  const W=opts.W||760,H=opts.H||230,padL=44,padR=16,padT=16,padB=34;
  const plotW=W-padL-padR,plotH=H-padT-padB,n=pts0.length;
  const max=Math.max(1,...series.flatMap(s=>s.points.map(p=>p.value)));
  const x=i=>padL+(n>1?i/(n-1)*plotW:plotW/2);
  const y=v=>padT+plotH-(v/max)*plotH;
  const gridN=3;
  const grid=Array.from({length:gridN+1},(_,i)=>{
    const v=Math.round(max*i/gridN),yy=y(v);
    return `<line x1="${padL}" y1="${yy}" x2="${W-padR}" y2="${yy}" stroke="var(--line)" stroke-width="1"/>`
      +`<text x="${padL-8}" y="${yy+4}" text-anchor="end" font-size="10.5" fill="var(--ink3)">${v}</text>`;
  }).join('');
  const maxLabels=6,step=Math.max(1,Math.ceil(n/maxLabels));
  const labels=pts0.map((p,i)=>(i%step===0||i===n-1)?`<text x="${x(i).toFixed(1)}" y="${H-10}" text-anchor="middle" font-size="10" fill="var(--ink3)">${esc(p.label)}</text>`:'').join('');
  let areaSvg='';
  if(opts.areaBetween&&series[opts.areaBetween[0]]&&series[opts.areaBetween[1]]){
    const a=series[opts.areaBetween[0]].points,b=series[opts.areaBetween[1]].points;
    const fwd=a.map((p,i)=>`${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    const bwd=b.map((p,i)=>i).slice().reverse().map(i=>`${x(i).toFixed(1)},${y(b[i].value).toFixed(1)}`).join(' ');
    areaSvg=`<polygon points="${fwd} ${bwd}" fill="var(--bad)" fill-opacity=".1"></polygon>`;
  }
  const lines=series.map(s=>{
    const c=s.color||'var(--acc)';
    const linePts=s.points.map((p,i)=>`${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
    const dots=s.points.map((p,i)=>`<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3" fill="${c}"></circle>`
      +`<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="10" fill="transparent" data-tip="${esc(`<b>${esc(s.label)}</b><div class="r"><span>${esc(p.label)}</span><span>${p.value}</span></div>`)}"></circle>`).join('');
    return `<polyline points="${linePts}" fill="none" stroke="${c}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"></polyline>${dots}`;
  }).join('');
  const legend=`<div class="mtrend-legend">${series.map(s=>`<span><i style="background:${s.color||'var(--acc)'}"></i>${esc(s.label)}</span>`).join('')}</div>`;
  return `<div class="mtrend-wrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria||'')}">${grid}${areaSvg}${lines}${labels}</svg>${legend}</div>`;
}
function multiTrendCard(sel,series,opts){ $(sel).innerHTML=multiTrendChart(series,opts); tipBind($(sel)); }

/* ---------- Pareto: ranked bars + cumulative share line (80/20) ---------- */
/* The one chart shape built to answer "where does most of the damage concentrate" at a glance —
   a plain ranked bar list (hbars) shows WHAT is worst, but not how much of the total the top few
   items already account for. The dashed 80% guide is the classic Pareto-principle reference line. */
function paretoChart(rows,opts={}){
  if(!rows.length)return '<div class="hint">No data for this selection.</div>';
  const W=opts.W||760,H=opts.H||300,padL=46,padR=46,padT=16,padB=86;
  const plotW=W-padL-padR,plotH=H-padT-padB,n=rows.length;
  const bw=plotW/n,barW=Math.min(50,bw*.6);
  const maxV=Math.max(1,...rows.map(r=>r.value));
  const xC=i=>padL+i*bw+bw/2;
  const yv=v=>padT+plotH-(v/maxV)*plotH;
  const yp=pc=>padT+plotH-(pc/100)*plotH;
  const gridN=4;
  const grid=Array.from({length:gridN+1},(_,i)=>{
    const v=Math.round(maxV*i/gridN),yy=yv(v);
    return `<line x1="${padL}" y1="${yy}" x2="${W-padR}" y2="${yy}" stroke="var(--line)" stroke-width="1"/>`
      +`<text x="${padL-8}" y="${yy+4}" text-anchor="end" font-size="10" fill="var(--ink3)">${v}</text>`;
  }).join('');
  const bars=rows.map((r,i)=>{
    const h=(r.value/maxV)*plotH,bx=xC(i)-barW/2,by=padT+plotH-h;
    const tip=esc(`<b>${esc(r.label)}</b><div class="r"><span>count</span><span>${r.value}</span></div><div class="r"><span>cumulative</span><span>${r.cumPct}%</span></div>`);
    return `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1,h).toFixed(1)}" rx="3" fill="var(--acc)" data-tip="${tip}"></rect>`;
  }).join('');
  const linePts=rows.map((r,i)=>`${xC(i).toFixed(1)},${yp(r.cumPct).toFixed(1)}`).join(' ');
  const dots=rows.map((r,i)=>`<circle cx="${xC(i).toFixed(1)}" cy="${yp(r.cumPct).toFixed(1)}" r="3.5" fill="var(--bad)"></circle>`).join('');
  const ref=`<line x1="${padL}" y1="${yp(80).toFixed(1)}" x2="${W-padR}" y2="${yp(80).toFixed(1)}" stroke="var(--bad)" stroke-width="1" stroke-dasharray="4 4" opacity=".55"></line>`
    +`<text x="${W-padR}" y="${(yp(80)-5).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--bad)">80%</text>`;
  const labels=rows.map((r,i)=>{
    const nm=r.label.length>14?r.label.slice(0,13)+'…':r.label;
    return `<text x="${xC(i).toFixed(1)}" y="${(H-padB+16).toFixed(1)}" text-anchor="end" font-size="10.5" fill="var(--ink3)" transform="rotate(-35 ${xC(i).toFixed(1)} ${(H-padB+16).toFixed(1)})">${esc(nm)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria||'')}">
    ${grid}${bars}${ref}<polyline points="${linePts}" fill="none" stroke="var(--bad)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>${dots}${labels}
    <text x="4" y="${padT+2}" font-size="10" fill="var(--ink3)">count</text>
    <text x="${W-4}" y="${padT+2}" text-anchor="end" font-size="10" fill="var(--bad)">cumulative %</text>
  </svg>`;
}
function paretoCard(sel,rows,opts){ $(sel).innerHTML=paretoChart(rows,opts); tipBind($(sel)); }

/* ---------- box plot: a distribution per category, not just its median ---------- */
/* "Testing time" used to hand-roll a median + IQR sub-label on a bar chart; a real box (quartile
   box + whisker to min/max) reads the same five numbers at a glance and is the standard shape for
   "distribution per group" (ISTQB's own metrics guidance calls for exactly this over a single
   average once outliers matter — a slow p95 run hiding behind a fast median is the common case). */
function boxplotChart(rows,opts={}){
  if(!rows.length)return '<div class="hint">No data for this selection.</div>';
  const W=opts.W||760,rh=opts.rh||52,L=opts.L||130,R=opts.R||20,padT=8;
  const H=rows.length*rh+padT*2;
  const maxV=Math.max(1,...rows.map(r=>r.max));
  const plotW=W-L-R;
  const x=v=>L+(v/maxV)*plotW;
  let g='';
  rows.forEach((r,i)=>{
    const cy=padT+i*rh+rh/2,boxH=18;
    if(i%2===0)g+=`<rect x="0" y="${padT+i*rh}" width="${W}" height="${rh}" fill="var(--surface2)"></rect>`;
    const tip=esc(`<b>${esc(r.label)}</b><div class="r"><span>min</span><span>${r.min}</span></div><div class="r"><span>p25</span><span>${r.p25}</span></div><div class="r"><span>median</span><span>${r.median}</span></div><div class="r"><span>p75</span><span>${r.p75}</span></div><div class="r"><span>max</span><span>${r.max}</span></div><div class="r"><span>n</span><span>${r.n}</span></div>`);
    g+=`<text x="8" y="${(cy+4).toFixed(1)}" font-size="12.5" font-weight="600" fill="var(--ink)">${esc(r.label)}</text>`;
    g+=`<line x1="${x(r.min).toFixed(1)}" y1="${cy}" x2="${x(r.p25).toFixed(1)}" y2="${cy}" stroke="var(--muted)" stroke-width="1.5"></line>`;
    g+=`<line x1="${x(r.p75).toFixed(1)}" y1="${cy}" x2="${x(r.max).toFixed(1)}" y2="${cy}" stroke="var(--muted)" stroke-width="1.5"></line>`;
    g+=`<line x1="${x(r.min).toFixed(1)}" y1="${(cy-5).toFixed(1)}" x2="${x(r.min).toFixed(1)}" y2="${(cy+5).toFixed(1)}" stroke="var(--muted)" stroke-width="1.5"></line>`;
    g+=`<line x1="${x(r.max).toFixed(1)}" y1="${(cy-5).toFixed(1)}" x2="${x(r.max).toFixed(1)}" y2="${(cy+5).toFixed(1)}" stroke="var(--muted)" stroke-width="1.5"></line>`;
    g+=`<rect x="${x(r.p25).toFixed(1)}" y="${(cy-boxH/2).toFixed(1)}" width="${Math.max(2,x(r.p75)-x(r.p25)).toFixed(1)}" height="${boxH}" rx="3" fill="var(--acc)" fill-opacity=".32" stroke="var(--acc)" stroke-width="1.5" data-tip="${tip}"></rect>`;
    g+=`<line x1="${x(r.median).toFixed(1)}" y1="${(cy-boxH/2).toFixed(1)}" x2="${x(r.median).toFixed(1)}" y2="${(cy+boxH/2).toFixed(1)}" stroke="var(--acc)" stroke-width="2.5"></line>`;
    if(r.sub)g+=`<text x="${(x(r.max)+10).toFixed(1)}" y="${(cy+4).toFixed(1)}" font-size="11" fill="var(--ink3)">${esc(r.sub)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria||'')}" font-family="Roboto,Arial,sans-serif">${g}</svg>`;
}
function boxplotCard(sel,rows,opts){ $(sel).innerHTML=boxplotChart(rows,opts); tipBind($(sel)); }

/* ---------- correlation heatmap: the visual companion to a VIF table ---------- */
/* Explanatory variables fighting over the same signal (high VIF) almost always show up here first,
   as a dark off-diagonal cell — this is what makes a multicollinearity warning concrete instead of
   an abstract number in a table. */
function heatmapChart(matrix,labels,opts={}){
  if(!labels.length)return '<div class="hint">No data.</div>';
  const cell=opts.cell||52,L=opts.L||Math.min(140,Math.max(70,...labels.map(l=>l.length*6.2)));
  const n=labels.length,W=L+n*cell+10,H=L+n*cell+10;
  let g='';
  labels.forEach((rl,i)=>{
    g+=`<text x="${L-8}" y="${(L+i*cell+cell/2+4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--ink2)">${esc(rl.length>22?rl.slice(0,21)+'…':rl)}</text>`;
    g+=`<text x="${(L+i*cell+cell/2).toFixed(1)}" y="${L-10}" text-anchor="start" font-size="11" fill="var(--ink2)" transform="rotate(-38 ${(L+i*cell+cell/2).toFixed(1)} ${L-10})">${esc(rl.length>22?rl.slice(0,21)+'…':rl)}</text>`;
    labels.forEach((cl,j)=>{
      const v=matrix[i][j],mag=Math.min(1,Math.abs(v));
      const fill=v>=0?`color-mix(in srgb, var(--bad) ${Math.round(mag*78)}%, var(--surface2))`:`color-mix(in srgb, var(--info) ${Math.round(mag*78)}%, var(--surface2))`;
      const tip=esc(`<b>${esc(rl)} × ${esc(cl)}</b><div class="r"><span>correlation</span><span>${v.toFixed(2)}</span></div>`);
      g+=`<rect x="${(L+j*cell).toFixed(1)}" y="${(L+i*cell).toFixed(1)}" width="${cell-3}" height="${cell-3}" rx="5" fill="${fill}" data-tip="${tip}"></rect>`;
      g+=`<text x="${(L+j*cell+cell/2).toFixed(1)}" y="${(L+i*cell+cell/2+4).toFixed(1)}" text-anchor="middle" font-size="11.5" font-weight="700" fill="var(--ink)">${v.toFixed(2)}</text>`;
    });
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria||'Correlation matrix')}">${g}</svg>`;
}
function heatmapCard(sel,matrix,labels,opts){ $(sel).innerHTML=heatmapChart(matrix,labels,opts); tipBind($(sel)); }

/* ---------- residual scatter: the standard OLS "is this model well-specified" check ---------- */
/* A fan or curved shape here (not an even cloud around the zero line) is the classic visual tell
   for heteroscedasticity or a missing non-linear term — the thing the R² number alone can't show. */
function scatterChart(points,opts={}){
  if(!points.length)return '<div class="hint">No data.</div>';
  const W=opts.W||420,H=opts.H||260,padL=44,padR=16,padT=16,padB=30;
  const xs=points.map(p=>p.fitted),ys=points.map(p=>p.residual);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(0,...ys),maxY=Math.max(0,...ys);
  const spanX=Math.max(1e-9,maxX-minX),spanY=Math.max(1e-9,maxY-minY);
  const x=v=>padL+((v-minX)/spanX)*(W-padL-padR);
  const y=v=>padT+(H-padT-padB)-((v-minY)/spanY)*(H-padT-padB);
  const dots=points.map(p=>`<circle cx="${x(p.fitted).toFixed(1)}" cy="${y(p.residual).toFixed(1)}" r="4" fill="var(--acc)" fill-opacity=".72" data-tip="${esc(`<b>${esc(p.label)}</b><div class="r"><span>fitted</span><span>${p.fitted.toFixed(2)}</span></div><div class="r"><span>residual</span><span>${p.residual.toFixed(2)}</span></div>`)}"></circle>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria||'Residuals vs fitted')}">
    <line x1="${padL}" y1="${y(0).toFixed(1)}" x2="${W-padR}" y2="${y(0).toFixed(1)}" stroke="var(--line2)" stroke-width="1.5" stroke-dasharray="3 3"></line>
    ${dots}
    <text x="${padL}" y="${H-8}" font-size="10.5" fill="var(--ink3)">fitted →</text>
    <text x="6" y="${padT+10}" font-size="10.5" fill="var(--ink3)">residual</text>
  </svg>`;
}
function scatterCard(sel,points,opts){ $(sel).innerHTML=scatterChart(points,opts); tipBind($(sel)); }

let agents=[],sel=null,current=null,es=null,tick=null,RUNS=[];
let bugs=[],severities=[],bSel=null,appSel=null;

/* ---------- connection indicator ---------- */
function setConn(ok){
  const c=$('#conn'); c.classList.remove('wait'); c.classList.toggle('bad',!ok);
  $('#connTxt').textContent=ok?'Server connected':'Server unreachable';
}

/* ---------- restart server ---------- */
/* Static files (HTML/CSS/JS) are re-read from disk on every request (lib/http.js), so editing them
   takes effect on the next reload with no restart. The Node process itself only reads server.js and
   lib/*.js once, at startup — a code change there needs a real restart, which is what this button is
   for. The server re-execs itself (same argv/env, so PORT/QA_DATA_DIR/etc. survive) and this page
   polls until the new process answers, then reloads itself automatically. */
let restartPoll=null;
$('#restartBtn').onclick=async()=>{
  if(!confirm('Restart the server now?\n\nAny open streaming connection or in-progress work is interrupted. This page reloads on its own once the server is back.'))return;
  $('#restartBtn').disabled=true;
  setConn(false);
  $('#connTxt').textContent='Restarting server…';
  try{await api('/api/admin/restart',{method:'POST'})}catch(e){/* the connection can drop before the response lands — expected */}
  clearInterval(restartPoll);
  restartPoll=setInterval(async()=>{
    try{await api('/api/agents');clearInterval(restartPoll);location.reload()}catch(e){/* still coming back up */}
  },1000);
};

/* ---------- test environment switch ---------- */
/* Which environment every run (QA MCP, Autotests, Test suite) executes against. In-memory on the
   server, so a restarted app is always back on test-env — eks-test-env is a per-session choice. */
let ENV_STATE={current:'test-env',profiles:[]};
function renderEnvBtn(){
  const b=$('#envBtn'); if(!b)return;
  const p=ENV_STATE.profiles.find(x=>x.key===ENV_STATE.current)||{label:ENV_STATE.current};
  b.classList.toggle('is-alt',ENV_STATE.current!=='test-env');
  $('#envBtnTxt').textContent=p.label;
  b.title=`Test environment: ${p.label}. Click to switch.`;
}
async function loadEnv(){
  try{ENV_STATE=await api('/api/environment')}catch(e){return}
  renderEnvBtn();
}
$('#envBtn').onclick=async()=>{
  const next=ENV_STATE.profiles.find(p=>p.key!==ENV_STATE.current);
  if(!next)return;
  if(next.confirm&&!confirm(`Switch the test environment to ${next.label}?\n\nFrom this point on, every run of QA MCP, Autotests and the test suite uses ${next.label} until you switch back.`))return;
  try{
    ENV_STATE=await post('/api/environment',{key:next.key});
    renderEnvBtn();
    if(!$('#view-qamcp').hidden)loadPlatStatus();
    if(!$('#view-execution').hidden)loadPlatStatus('#exEnv');
    toast(`Environment switched to ${ENV_STATE.current}`,'ok');
  }catch(e){toast(e.message,'err')}
};
loadEnv();

/* ---------- data file attachment (Analyses / QA MCP / Autotests) ---------- */
/* Lets a tester attach any number of files alongside the prompt. Each is embedded into the
   agent's prompt as DATA (never as instructions) and kept on disk for the run to read in full.
   Held in memory only, per tab — nothing is uploaded until "Go" is pressed. The server enforces
   the real caps (per-file transport size, combined size, and what actually fits in the prompt);
   the numbers here just keep the browser from choking on something absurd before that.
   Content always travels as base64 of the raw bytes (never file.text()) so a binary file, e.g. a
   PDF, reaches the server byte-for-byte instead of being mangled by a text decode. */
const FILES={},FILE_UI={};
const MAX_FILE=5*1024*1024; // 5MB per file
const MAX_TOTAL=20*1024*1024; // 20MB combined per run — matches the server's DATA_FILES_MAX_TOTAL
const TEXT_EXT=/\.(csv|tsv|txt|json|jsonl|xml|ya?ml|log|md|markdown|ini|conf|sql)$/i;
/* Sniffs whether a file is text or binary: known text extensions/mime types short-circuit to text;
   otherwise a NUL byte in the first 4KB marks it binary (how file(1) and most editors decide). */
async function sniffBinary(file){
  if(TEXT_EXT.test(file.name))return false;
  if(file.type&&(/^text\//.test(file.type)||file.type==='application/json'))return false;
  try{
    const bytes=new Uint8Array(await file.slice(0,4096).arrayBuffer());
    for(let i=0;i<bytes.length;i++)if(bytes[i]===0)return true;
  }catch(e){/* can't sniff it — treat as text and let the server/agent sort it out */}
  return false;
}
function bufToBase64(buf){
  let bin='';const bytes=new Uint8Array(buf),chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+chunk));
  return btoa(bin);
}
function wireFileField(key,ids){
  FILES[key]=[];
  const drop=$(ids.drop),input=$(ids.input),empty=$(ids.empty),list=$(ids.list),err=$(ids.err);
  input.multiple=true;
  const totalBytes=()=>FILES[key].reduce((s,f)=>s+f.size,0);
  const render=()=>{
    const fl=FILES[key];
    empty.hidden=!!fl.length; list.hidden=!fl.length;
    list.innerHTML=fl.map((f,i)=>`<div class="dz-file"><span class="dz-name" title="${esc(f.name)}">${esc(f.name)}</span>${f.binary?'<span class="dz-bin" title="Binary file. Only agents that can read files will use it.">bin</span>':''}<span class="dz-size">${Math.max(1,Math.round(f.size/1024))} KB</span><button type="button" class="btn icon sm" data-rm="${i}" title="Remove ${esc(f.name)}"><svg width="13" height="13"><use href="#i-x"/></svg></button></div>`).join('');
  };
  const take=async(fileList)=>{
    err.textContent='';
    for(const file of fileList){
      if(file.size>MAX_FILE){err.textContent=`${file.name} is ${Math.round(file.size/1024)} KB; the per-file limit is 5 MB.`;continue}
      if(totalBytes()+file.size>MAX_TOTAL){err.textContent=`Adding ${file.name} would pass the ${MAX_TOTAL/1024/1024} MB combined limit for this run.`;continue}
      try{
        const binary=await sniffBinary(file);
        const content=bufToBase64(await file.arrayBuffer());
        FILES[key].push({name:file.name,size:file.size,binary,content});
        if(binary&&ids.warnBinary)err.textContent=`${file.name} looks like a binary file. ${ids.warnBinary}`;
      }catch(e){err.textContent='Could not read '+file.name}
    }
    render();
  };
  drop.onclick=()=>input.click();
  drop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click()}};
  input.onchange=()=>{take([...input.files]);input.value=''};
  drop.ondragover=e=>{e.preventDefault();drop.classList.add('drag')};
  drop.ondragleave=()=>drop.classList.remove('drag');
  drop.ondrop=e=>{e.preventDefault();drop.classList.remove('drag');take([...e.dataTransfer.files])};
  drop.onpaste=e=>{const fl=e.clipboardData&&e.clipboardData.files;if(fl&&fl.length){e.preventDefault();take([...fl])}};
  list.onclick=e=>{const b=e.target.closest('[data-rm]');if(b){e.stopPropagation();FILES[key].splice(+b.dataset.rm,1);render()}};
  /* The task textarea and the attach bar form one box: files can be dropped or pasted straight into the text. */
  const box=drop.closest('.composer'), ta=box&&box.querySelector('textarea');
  if(ta){
    ta.addEventListener('dragover',e=>{if(e.dataTransfer&&[...e.dataTransfer.types].includes('Files')){e.preventDefault();box.classList.add('drag')}});
    ta.addEventListener('dragleave',()=>box.classList.remove('drag'));
    ta.addEventListener('drop',e=>{const fl=e.dataTransfer&&e.dataTransfer.files;box.classList.remove('drag');if(fl&&fl.length){e.preventDefault();take([...fl])}});
    ta.addEventListener('paste',e=>{const fl=e.clipboardData&&e.clipboardData.files;if(fl&&fl.length){e.preventDefault();take([...fl])}});
    drop.addEventListener('dragover',()=>box.classList.add('drag'));
    drop.addEventListener('drop',()=>box.classList.remove('drag'));
  }
  render();
  FILE_UI[key]={clear:()=>{FILES[key]=[];err.textContent='';render()}};
}
wireFileField('runs',{drop:'#fileDrop',input:'#fileInput',empty:'#fileEmpty',list:'#fileList',err:'#fileErr'});
wireFileField('qamcp',{drop:'#qFileDrop',input:'#qFileInput',empty:'#qFileEmpty',list:'#qFileList',err:'#qFileErr',
  warnBinary:'QA MCP cannot read binary files. Attach a text or CSV export instead.'});
wireFileField('autotest',{drop:'#aFileDrop',input:'#aFileInput',empty:'#aFileEmpty',list:'#aFileList',err:'#aFileErr'});
wireFileField('planning',{drop:'#pfFileDrop',input:'#pfFileInput',empty:'#pfFileEmpty',list:'#pfFileList',err:'#pfFileErr'});
wireFileField('design',{drop:'#dsFileDrop',input:'#dsFileInput',empty:'#dsFileEmpty',list:'#dsFileList',err:'#dsFileErr'});
wireFileField('analysis',{drop:'#anFileDrop',input:'#anFileInput',empty:'#anFileEmpty',list:'#anFileList',err:'#anFileErr'});
wireFileField('implementation',{drop:'#imFileDrop',input:'#imFileInput',empty:'#imFileEmpty',list:'#imFileList',err:'#imFileErr'});
wireFileField('execution',{drop:'#exFileDrop',input:'#exFileInput',empty:'#exFileEmpty',list:'#exFileList',err:'#exFileErr'});
wireFileField('completion',{drop:'#cpFileDrop',input:'#cpFileInput',empty:'#cpFileEmpty',list:'#cpFileList',err:'#cpFileErr'});

/* ---------- theme ---------- */
/* Light theme only. */
document.documentElement.dataset.theme='light';
try{localStorage.removeItem('theme')}catch(e){}

/* ---------- navigation ---------- */
const VIEWS=['workspace','sources','runs','qamcp','autotest','planning','tfmonitor','analysis','design','implementation','execution','completion','runsummary','bugs','risk','metricsgen','fix','tools','doc','ai','autodoc','testproc'];
const PAGE={
  workspace:['Workspace','Workspace','Your assigned Jira tasks ranked by priority and service risk, with a testing checklist for each.'],
  runs:['Agents','Ticket analyses','Run a QA agent on a ticket and review its findings.'],
  qamcp:['Agents','QA MCP','Run a test process on the configured test environment.'],
  autotest:['Agents','Autotests','Write automated tests, run the Smoke and System packs or run any test from the suite.'],
  planning:['Test Flow','1. Planning','Risk, entry and exit criteria and a feasibility check before a task is implemented.'],
  tfmonitor:['Test Flow','2. Monitoring & control','Release progress, status and priority for each project, read from Jira.'],
  analysis:['Test Flow','3. Analysis','Test strategy, coverage gap and impact on other repositories.'],
  design:['Test Flow','4. Design','Concrete test cases based on the code and the bug registry.'],
  implementation:['Test Flow','5. Implementation','One prioritised and estimated procedure built from the test designs.'],
  execution:['Test Flow','6. Execution','Runs the procedure on the test environment and reports confirmed defects.'],
  completion:['Test Flow','7. Completion','A short explanation of a finished task, saved to the knowledge base.'],
  runsummary:['Test Flow','8. Run Summary','All phases of one ticket on a single page, built from the latest runs.'],
  bugs:['Metrics','Bug registry','Record findings and see where defects concentrate.'],
  risk:['Metrics','Risk','Defect density by service, calculated from the bug registry.'],
  metricsgen:['Metrics','Metrics generation','Build and save charts from the bug registry, run history and Jira releases.'],
  fix:['FIX Sessions','FIX client','Connect as a FIX client, send messages and review the message log.'],
  sources:['Workspace','Sources','Knowledge the agents learn from and the test environment they test on.'],
  tools:['Reference','Tools','Endpoints of the test environment imported from its API specifications.'],
  doc:['Reference','Manual testing','Test levels, design techniques and how to choose between them.'],
  ai:['Reference','AI testing','Testing AI systems and testing with generative AI.'],
  autodoc:['Reference','Automated testing','How a test automation suite is structured.'],
  testproc:['Reference','Tests procedure','The seven activities of the test process and the strategy behind them.'],
};
/* The registry can change outside this page, so coming back to the window re-reads it. */
/* Wyszukiwarki przebudowują duże listy, więc reagują po chwili ciszy, a nie na każdy klawisz. */
const debounce=(fn,ms=150)=>{let h;return(...a)=>{clearTimeout(h);h=setTimeout(()=>fn(...a),ms)}};
$('#jiraGo').onclick=async()=>{try{await api('/api/bugs/jira-sync',{method:'POST'});await loadBugs()}catch(e){toast(e.message,'err')}};
$('#jiraFull').onclick=async()=>{if(!confirm('This fetches all bugs and task comments from Jira again. Nothing is deleted or duplicated, but it takes longer than a normal sync. Continue?'))return;try{await api('/api/bugs/jira-sync?full=1',{method:'POST'});await loadBugs()}catch(e){toast(e.message,'err')}};
addEventListener('focus',()=>{if(!$('#view-bugs').hidden)loadBugs().catch(()=>{});else if(!$('#view-risk').hidden)loadBugs().then(renderRisk).catch(()=>{})});
function showTab(t){
  document.querySelectorAll('.nav [data-tab]').forEach(x=>{
    const on=x.dataset.tab===t; x.classList.toggle('on',on);
    on?x.setAttribute('aria-current','page'):x.removeAttribute('aria-current');
  });
  VIEWS.forEach(v=>{const el=$('#view-'+v);if(el)el.hidden=v!==t});
  const [crumb,title,desc]=PAGE[t];
  $('#crumb').textContent=crumb; $('#pageTitle').textContent=title; $('#pageDesc').textContent=desc;
  document.title=title+' · Flawtrace';
  try{history.replaceState(null,'',t==='runs'?location.pathname+location.search:'#'+t)}catch(e){}
  scrollTo(0,0);
  if(t==='workspace')loadWorkspace();
  if(t==='bugs')loadBugs().catch(()=>{});
  if(t==='risk')loadBugs().then(renderRisk).catch(()=>{});
  if(t==='metricsgen')loadMetricsGen();
  if(t==='qamcp'){loadPlatStatus();refreshAll();qPendingSync()}
  if(t==='execution'){loadPlatStatus('#exEnv');refreshAll();qPendingSync()}
  if(t==='autotest'){loadAutotestMeta();refreshAll();qPendingSync();atSetSub(AT_SUB)}
  if(t==='runs')refreshAll();
  if(t==='planning')refreshAll();
  if(t==='tfmonitor')loadMonitor();
  if(t==='analysis')refreshAll();
  if(t==='design')refreshAll();
  if(t==='implementation')refreshAll();
  if(t==='completion')refreshAll();
  if(t==='runsummary')loadRunSummary();
  if(t==='tools')loadTools();
  if(t==='sources')loadSources();
  if(t==='fix')fxLoad();
  if(typeof updateSetupBanner==='function')updateSetupBanner();
  renderPipe();
  requestAnimationFrame(relayoutDoc);
}
document.querySelector('.nav').onclick=e=>{const b=e.target.closest('[data-tab]');if(b)showTab(b.dataset.tab)};
const showBugs=()=>showTab('bugs');
/* deep link: #doc / #risk / #bugs / #qamcp … opens that page — applied from init(),
   once the agent list is in, because every page but the docs needs it. */
function applyHash(){
  const [t,sub]=(location.hash||'').slice(1).split('/');
  if(VIEWS.includes(t)&&t!=='runs')showTab(t);
  /* First visit with nothing connected and no page in the address: start on the setup. */
  if(!t&&typeof srcFirstRun==='function')srcFirstRun();
  if(t==='autotest'&&sub)atSetSub(sub);
}
(function(){const [c,t,d]=PAGE.runs;$('#crumb').textContent=c;$('#pageTitle').textContent=t;$('#pageDesc').textContent=d})();
