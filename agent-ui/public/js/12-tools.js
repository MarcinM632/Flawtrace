// QA Agents UI: tools. Klasyczny skrypt: wszystkie pliki z js/ dzielą jeden zakres globalny i ładują się po kolei (kolejność jest istotna).
/* ---------- tools: endpoints available through mcp-server, by service ---------- */
const TL={data:null,open:new Set(),ep:new Set(),q:'',changed:false,busy:false,error:null};
const tlAgo=t=>{if(!t)return 'never';const s=Math.max(0,Math.round((Date.now()-t)/1000));return s<60?'just now':s<3600?Math.round(s/60)+' min ago':s<86400?Math.round(s/3600)+' h ago':Math.round(s/86400)+' d ago'};
async function loadTools(){
  try{TL.data=await api('/api/tools');TL.error=null}catch(e){TL.error=e.message}
  renderTools();
}
function tlMatch(e){
  if(TL.changed&&!e.mark)return false;
  if(!TL.q)return true;
  return (e.name+' '+e.path+' '+e.method+' '+e.description).toLowerCase().includes(TL.q.toLowerCase());
}
const tlMark=m=>m?`<span class="tl-mk ${m.kind}" title="${m.kind==='new'?'Added':'Parameters changed'} ${esc(tlAgo(m.at))}">${m.kind==='new'?'NEW':'CHANGED'}</span>`:'';
function tlParams(e){
  if(!e.params.length)return '<div class="muted-note">No parameters.</div>';
  const d=e.mark&&e.mark.detail;
  const added=new Set(d?d.added.map(x=>x.replace(/ \(.*$/,'')):[]),mod=new Set(d?d.modified.map(x=>x.name):[]);
  let h='<table class="dtbl tl-pt"><thead><tr><th>Parameter</th><th>Type</th><th></th></tr></thead><tbody>'
    +e.params.map(p=>`<tr class="${added.has(p.name)?'tl-add':mod.has(p.name)?'tl-mod':''}"><td class="mono">${esc(p.name)}${p.required?' <b class="tl-req">required</b>':''}</td><td class="mono">${esc(p.type)}${p.enum?`<div class="tl-en">${esc(p.enum.join(' · '))}</div>`:''}</td><td>${added.has(p.name)?'<span class="tl-mk new">NEW</span>':mod.has(p.name)?'<span class="tl-mk changed">CHANGED</span>':''}</td></tr>`).join('')+'</tbody></table>';
  if(d&&(d.removed.length||d.modified.length||d.moved)){
    h+='<div class="tl-chg">'+(d.moved?`<div><b>Moved:</b> <span class="mono">${esc(d.moved.from)}</span> → <span class="mono">${esc(d.moved.to)}</span></div>`:'')
      +d.modified.map(m=>`<div><b>Changed:</b> <span class="mono">${esc(m.name)}</span>: ${esc(m.from)} → ${esc(m.to)}</div>`).join('')
      +d.removed.map(r=>`<div><b>Removed:</b> <span class="mono">${esc(r)}</span></div>`).join('')+'</div>';
  }
  return h;
}
function tlReport(){
  const h=TL.data&&TL.data.history[0];
  if(!h)return '';
  const f=(h.fetched||[]);const bad=f.filter(x=>!x.ok);
  if(h.rolledBack)return '<div class="tl-rep bad"><b>Last scan · '+esc(tlAgo(h.at))+' · the new specification was NOT applied.</b> It adds services that mcp-server does not map to a group yet, so the previous specification was put back and nothing was lost. '
    +(h.unmapped&&h.unmapped.length?'New and unmapped: <span class="mono">'+h.unmapped.map(esc).join(', ')+'</span>. Assign them in <span class="mono">mcp-server/src/mcp/groups.js</span>, then reinitialize again.':esc(h.error||''))+'</div>'
    +(bad.length?'<div class="tl-rep warn"><b>Not refreshed from the service:</b><ul>'+bad.map(x=>`<li>${esc(x.label)}${x.message?': '+esc(x.message):''}</li>`).join('')+'</ul></div>':'');
  let s='<div class="tl-rep"><b>Last scan · '+esc(tlAgo(h.at))+'</b> · '+h.total+' endpoints · ';
  s+=h.baseline?'first scan, this is now the reference state':`${h.added.length} new · ${h.changed.length} with changed parameters · ${h.removed.length} removed`;
  s+='</div>';
  if(!h.baseline&&(h.removed.length))s+='<div class="tl-rep bad">Removed: <span class="mono">'+h.removed.map(esc).join(', ')+'</span></div>';
  if(bad.length)s+='<div class="tl-rep warn"><b>Not refreshed, the cached copy was kept:</b><ul>'+bad.map(x=>`<li>${esc(x.label)}${x.message?': '+esc(x.message):''}</li>`).join('')+'</ul></div>';
  return s;
}
function renderTools(){
  const box=$('#tlList');if(!box)return;
  const d=TL.data;
  $('#tlSt').textContent=TL.error?'':d?`${d.total} endpoints in ${d.groups.length} ${d.groups.length===1?'group':'groups'}${d.baseUrl?' · '+d.baseUrl:''} · last scanned ${tlAgo(d.scannedAt)}`:'Loading…';
  const go=$('#tlFull');go.disabled=TL.busy;go.textContent=TL.busy?'Scanning…':'Rescan specifications';
  $('#tlReport').innerHTML=TL.busy?'<div class="tl-rep">Downloading the specifications and comparing every endpoint…</div>':tlReport();
  if(TL.error){box.innerHTML=`<div class="chk bad">${esc(TL.error)}</div>`;return}
  if(!d){box.innerHTML='<div class="sk"></div><div class="sk"></div>';return}
  if(!d.total){box.innerHTML='<div class="muted-note">No endpoints yet. Add the OpenAPI or Swagger address of the test environment in <a href="#sources" data-tab-link="sources">Sources</a>.</div>';return}
  let h='',shown=0;
  const byGw=new Map();
  d.groups.forEach(g=>{if(!byGw.has(g.gateway))byGw.set(g.gateway,[]);byGw.get(g.gateway).push(g)});
  for(const [gw,groups] of byGw){
    let gh='';
    for(const g of groups){
      const eps=g.endpoints.filter(tlMatch);
      if(!eps.length&&(TL.q||TL.changed))continue;
      shown+=eps.length;
      const open=TL.open.has(g.key)||((TL.q||TL.changed)&&eps.length>0);
      const marks=g.endpoints.filter(e=>e.mark).length;
      gh+=`<div class="tl-grp"><button class="tl-gh" data-g="${esc(g.key)}" aria-expanded="${open}"><span class="tl-car">${open?'▾':'▸'}</span><span class="tl-gn">${esc(g.label)}</span><span class="mono tl-gk">${esc(g.key)}</span>${marks?`<span class="tl-mk changed">${marks} changed</span>`:''}<span class="su-n">${g.endpoints.length}</span></button>`;
      if(open){
        gh+='<div class="tl-eps">'+eps.map(e=>{
          const k=e.name,op=TL.ep.has(k);
          return `<div class="tl-ep"><button class="tl-eh" data-e="${esc(k)}" aria-expanded="${op}"><span class="tl-m m-${esc(e.method)}">${esc(e.method)}</span><span class="tl-en1"><span class="mono tl-nm">${esc(e.name)}</span><span class="mono tl-pa">${esc(e.path)}</span></span>${tlMark(e.mark)}<span class="tl-rw ${e.read?'r':'w'}">${e.read?'READ':'WRITE'}</span></button>`
            +(op?`<div class="tl-det">${e.description?`<p>${esc(e.description)}</p>`:''}${tlParams(e)}</div>`:'')+'</div>';
        }).join('')+'</div>';
      }
      gh+='</div>';
    }
    if(gh)h+=`<div class="tl-gw"><h4>${esc(gw)}</h4>${gh}</div>`;
  }
  if(!h)h='<div class="muted-note">'+(TL.changed&&!TL.q?'No endpoint was added or changed in the last two weeks.':'No endpoint matches the search.')+'</div>';
  box.innerHTML=h;
  $('#tlCount').textContent=(TL.q||TL.changed)?shown+' shown':'';
}
(function toolsInit(){
  $('#tlList').addEventListener('click',e=>{
    const g=e.target.closest('[data-g]');
    if(g){const k=g.dataset.g;TL.open.has(k)?TL.open.delete(k):TL.open.add(k);renderTools();return}
    const x=e.target.closest('[data-e]');
    if(x){const k=x.dataset.e;TL.ep.has(k)?TL.ep.delete(k):TL.ep.add(k);renderTools()}
  });
  $('#tlQ').oninput=debounce(e=>{TL.q=e.target.value;renderTools()});
  $('#tlChanged').onchange=e=>{TL.changed=e.target.checked;renderTools()};
  $('#tlFull').onclick=async()=>{
    if(TL.busy)return;
    if(!confirm('Download the API specifications again and compare every endpoint with the previous scan? A specification that cannot be downloaded keeps its previous copy.'))return;
    TL.busy=true;renderTools();
    try{TL.data=await api('/api/tools/rescan',{method:'POST'});TL.error=null;const h=TL.data.history[0];
      toast(h&&!h.baseline?`Scan finished: ${h.added.length} new, ${h.changed.length} changed, ${h.removed.length} removed`:'Scan finished')}
    catch(err){toast(err.message,'bad')}
    TL.busy=false;renderTools();
  };
})();
