// QA Agents UI: suite. Klasyczny skrypt: wszystkie pliki z js/ dzielą jeden zakres globalny i ładują się po kolei (kolejność jest istotna).
/* ---------- test suite: pick tests from the repo and run them ---------- */
const SU={hist:null,outOpen:false,tests:[],last:{},sel:new Set(),closed:new Set(),q:'',marker:'',status:'',run:null,view:null,editing:null,poll:null,error:null,loaded:false};
const suAgo=t=>{if(!t)return '';const s=Math.max(0,Math.round((Date.now()-t)/1000));return s<60?'just now':s<3600?Math.round(s/60)+' min ago':s<86400?Math.round(s/3600)+' h ago':Math.round(s/86400)+' d ago'};
const suOutcome=id=>{
  const live=SU.run&&(SU.run.status==='running'||SU.run.status==='cancelling')?SU.run.results[id]:null;
  if(live)return {o:live,live:true};
  const l=SU.last[id];return l?{o:l.outcome,at:l.at}:{o:null};
};
const suRunning=()=>SU.run&&(SU.run.status==='running'||SU.run.status==='cancelling');
const suShort=id=>id.replace(/^tests\//,'');
function suVisible(t){
  if(SU.q){const q=SU.q.toLowerCase();if(!(t.file+' '+t.name+' '+t.param).toLowerCase().includes(q))return false}
  if(SU.marker&&!t.markers.includes(SU.marker))return false;
  if(SU.status){const o=suOutcome(t.id).o;
    if(SU.status==='passed'&&o!=='passed')return false;
    if(SU.status==='failed'&&o!=='failed'&&o!=='error')return false;
    if(SU.status==='notrun'&&o)return false}
  return true;
}
async function loadSuite(){
  try{
    const d=await api('/api/suite');
    SU.tests=d.tests||[];SU.last=d.last||{};SU.error=d.error||null;SU.loaded=true;
    const ids=new Set(SU.tests.map(t=>t.id));[...SU.sel].forEach(i=>{if(!ids.has(i))SU.sel.delete(i)});
    if(d.run&&(d.run.status==='running'||d.run.status==='cancelling')){await suPoll(true)}
    else if(!SU.run){const r=await api('/api/suite/run');SU.run=r.run}
  }catch(e){SU.error=e.message}
  renderSuite();suLoadHist();
}

/* ---------- Autotests: Write / Smoke / System / Suite runner ---------- */
/* One tab, four phases of the ISTQB flow this app's own autotest suite follows: Write is test
   implementation (turning a designed case into a script, already tagged with its ISTQB level —
   SMOKE/INTEGRATION/SYSTEM — by the writing agent, see pytest.ini); Smoke and System are each a
   fixed, named pack you run in full, not a cherry-picked selection (that's what makes a smoke pack
   a build-verification gate rather than just "some tests"); Suite runner is the general-purpose
   picker behind both, and behind any ad-hoc regression run. */
let AT_SUB='write';
const AT_SUB_DESC={
  write:'Describe a test case and the agent writes it as an automated test with the correct level marker.',
  smoke:'A short set of checks that confirms the environment is ready for testing. Run it after every new build.',
  system:'End to end tests of the complete system. Run them before a release to confirm that everything still works together.',
  suite:'Select and run any test from the repository.',
};
const PACKS={
  SMOKE:{listId:'#smList',goId:'#smGo',countId:'#smCount',detailId:'#smDetail',nbId:'#nb-smoke',label:'smoke'},
  SYSTEM:{listId:'#sysList',goId:'#sysGo',countId:'#sysCount',detailId:'#sysDetail',nbId:'#nb-system',label:'system'},
};
function atSetSub(sub){
  if(!['write','smoke','system','suite'].includes(sub))sub='write';
  AT_SUB=sub;
  document.querySelectorAll('#atSub [data-s]').forEach(b=>{const on=b.dataset.s===sub;b.classList.toggle('on',on);b.setAttribute('aria-selected',String(on))});
  document.querySelectorAll('#view-autotest .at-pane').forEach(el=>{el.hidden=el.dataset.pane!==sub});
  $('#atSubDesc').textContent=AT_SUB_DESC[sub]||'';
  try{history.replaceState(null,'','#autotest/'+sub)}catch(e){}
  if(sub==='write')return;
  if(!SU.loaded){loadSuite();return} // loadSuite()'s own renderSuite() call reaches atRefreshActivePane()
  atRefreshActivePane();
}
$('#atSub').onclick=e=>{const b=e.target.closest('[data-s]');if(b)atSetSub(b.dataset.s)};

/** Whatever Smoke/System/Suite-runner pane is on screen right now, repainted — the one place both
   loadSuite() and the run-status poller go through, so none of the three drifts out of sync with
   a run that finished, or with a fresh test list. */
function atRefreshActivePane(){
  if(!SU.loaded||$('#view-autotest').hidden)return;
  if(AT_SUB==='smoke')renderPack('SMOKE');
  else if(AT_SUB==='system')renderPack('SYSTEM');
  else if(AT_SUB==='suite'){renderSuiteList();renderSuiteDetail()}
}
const suPackTests=marker=>SU.tests.filter(t=>t.markers.includes(marker));
const suPackFiles=marker=>[...new Set(suPackTests(marker).map(t=>t.file))];
function renderPack(marker){
  const p=PACKS[marker];if(!p)return;
  const tests=suPackTests(marker);
  $(p.countId).textContent=tests.length?tests.length+' test'+(tests.length===1?'':'s'):'';
  const box=$(p.listId);
  if(!tests.length){
    box.innerHTML=`<div class="muted-note">No test is tagged <span class="mono">@pytest.mark.${marker}</span> yet. ${marker==='SMOKE'?'Smoke tests are stored in the smoke folder.':'UI tests are system tests by default. Write one in the Write tab.'}</div>`;
  }else{
    const byFile=new Map();
    tests.forEach(t=>{if(!byFile.has(t.file))byFile.set(t.file,[]);byFile.get(t.file).push(t)});
    box.innerHTML=[...byFile.entries()].map(([file,ts])=>`<div class="su-file"><div class="su-row su-fl"><span class="mono">${esc(file.split('/').pop())}</span><span class="su-n">${ts.length}</span></div>`
      +ts.map(t=>`<div class="su-row su-t"><span class="su-body"><span class="su-nm">${esc(t.name.replace(/^test_/,'').replace(/_/g,' '))}${t.param?`<span class="su-pm mono">[${esc(t.param)}]</span>`:''}</span><span class="su-meta">${suDot(t.id)}</span></span></div>`).join('')
      +'</div>').join('');
  }
  const go=$(p.goId);
  go.disabled=!tests.length||suRunning();
  go.innerHTML=suRunning()?ico('play',13)+' Running…':ico('play',13)+` Run ${p.label} pack`+(tests.length?` (${tests.length})`:'');
  go.onclick=()=>{if(suRunning())return;const files=suPackFiles(marker);if(files.length)suStart(files)};
  $(p.detailId).innerHTML=suRunBlock(SU.run,p.label[0].toUpperCase()+p.label.slice(1)+' pack — latest run',false);
  const cancelBtn=$(p.detailId).querySelector('#suCancel');
  if(cancelBtn)cancelBtn.onclick=()=>api('/api/suite/cancel',{method:'POST'}).then(()=>suPoll(false)).catch(e=>toast(e.message,'bad'));
  const nb=$(p.nbId);
  if(nb)nb.hidden=!(suRunning()&&(SU.run.targets||[]).some(t=>suPackFiles(marker).includes(t)));
}
function suGroups(){
  const folders=new Map();
  for(const t of SU.tests.filter(suVisible)){
    const parts=t.file.split('/');const folder=parts.length>2?parts.slice(1,-1).join('/'):'(root)';
    if(!folders.has(folder))folders.set(folder,new Map());
    const f=folders.get(folder);if(!f.has(t.file))f.set(t.file,[]);f.get(t.file).push(t);
  }
  return folders;
}
function suCheck(ids){const n=ids.filter(i=>SU.sel.has(i)).length;return n===0?'':n===ids.length?'checked':'part'}
const suBox=(key,ids,label)=>{const c=suCheck(ids);return `<input type="checkbox" class="su-cb" data-ids="${esc(key)}" ${c==='checked'?'checked':''} data-part="${c==='part'?1:0}" aria-label="${esc(label)}">`};
function suDot(id){
  const x=suOutcome(id);
  const cls=x.o==='passed'?'ok':x.o==='failed'||x.o==='error'?'bad':x.o?'mut':'none';
  const txt=x.live?(x.o==='passed'?'passed':x.o):x.o?(x.o==='passed'?'passed':x.o)+' · '+suAgo(x.at):'not run';
  return `<span class="su-st ${cls}"><i></i>${esc(txt)}</span>`;
}
function renderSuiteList(){
  const box=$('#suTree');if(!box)return;
  if(!SU.loaded){box.innerHTML='<div class="sk"></div><div class="sk"></div>';return}
  const groups=suGroups();
  const allMarkers=[...new Set(SU.tests.flatMap(t=>t.markers))].sort();
  const ms=$('#suMarker');const cur=SU.marker;
  ms.innerHTML='<option value="">Any marker</option>'+allMarkers.map(m=>`<option ${m===cur?'selected':''}>${esc(m)}</option>`).join('');
  let h='';
  if(SU.error)h+=`<div class="chk bad" style="margin-bottom:10px">${esc(SU.error)}</div>`;
  if(!groups.size)h+=`<div class="muted-note">${SU.tests.length?'No test matches the filter.':'There are no tests in autotests/ yet.'}</div>`;
  for(const [folder,files] of groups){
    const fIds=[...files.values()].flat().map(t=>t.id);const fk='d:'+folder;
    h+=`<div class="su-folder"><div class="su-row su-fh">${suBox(fk,fIds,folder)}<button class="su-tg" data-tg="${esc(fk)}">${SU.closed.has(fk)?'▸':'▾'} ${esc(folder)}</button><span class="su-n">${fIds.length}</span></div>`;
    if(!SU.closed.has(fk))for(const [file,tests] of files){
      const ids=tests.map(t=>t.id);const k='f:'+file;
      h+=`<div class="su-file"><div class="su-row su-fl">${suBox(k,ids,file)}<button class="su-tg" data-tg="${esc(k)}" title="${esc(file)}">${SU.closed.has(k)?'▸':'▾'} <span class="mono">${esc(file.split('/').pop())}</span></button><span class="su-n">${tests.length}</span>
        <button class="su-lnk" data-run-file="${esc(file)}" title="Run this file now"${suRunning()?' disabled':''}>Run</button><button class="su-lnk" data-edit="${esc(file)}">Edit</button></div>`;
      if(!SU.closed.has(k))for(const t of tests){
        h+=`<label class="su-row su-t" title="${esc(t.id)}"><input type="checkbox" class="su-cb" data-ids="t:${esc(t.id)}" ${SU.sel.has(t.id)?'checked':''}>
          <span class="su-body"><span class="su-nm">${esc(t.name.replace(/^test_/,'').replace(/_/g,' '))}${t.param?`<span class="su-pm mono">[${esc(t.param)}]</span>`:''}</span>
          <span class="su-meta">${suDot(t.id)}${t.markers.filter(m=>m!=='MANAGER'&&m!=='PLAT'&&m!=='ADMIN').map(m=>`<span class="su-mk">${esc(m)}</span>`).join('')}</span></span></label>`;
      }
      h+='</div>';
    }
    h+='</div>';
  }
  box.innerHTML=h;
  box.querySelectorAll('input[data-part="1"]').forEach(i=>{i.indeterminate=true});
  const vis=SU.tests.filter(suVisible).length;
  $('#suCount').textContent=SU.sel.size+' selected · '+vis+' of '+SU.tests.length+' shown';
  const nbs=$('#nb-suiterun');if(nbs){nbs.hidden=!suRunning();nbs.textContent=suRunning()?1:''}
  const go=$('#suGo');go.disabled=!SU.sel.size||suRunning();
  go.innerHTML=suRunning()?ico('play',13)+' Running…':ico('play',13)+' Run selected'+(SU.sel.size?' ('+SU.sel.size+')':'');
}
function suIdsOf(key){
  if(key.startsWith('t:'))return [key.slice(2)];
  if(key.startsWith('f:'))return SU.tests.filter(t=>t.file===key.slice(2)&&suVisible(t)).map(t=>t.id);
  const folder=key.slice(2);return SU.tests.filter(t=>suVisible(t)&&(t.file.split('/').slice(1,-1).join('/')||'(root)')===folder).map(t=>t.id);
}
/* Whole files go as the file path, so a big selection stays short and pytest runs it as it is on disk. */
function suTargets(){
  const out=[];const byFile=new Map();
  SU.tests.forEach(t=>{if(!byFile.has(t.file))byFile.set(t.file,[]);byFile.get(t.file).push(t.id)});
  for(const [file,ids] of byFile){
    const picked=ids.filter(i=>SU.sel.has(i));
    if(!picked.length)continue;
    if(picked.length===ids.length)out.push(file);else out.push(...picked);
  }
  return out;
}
async function suStart(targets){
  try{
    await api('/api/suite/run',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({targets})});
    SU.view=null;SU.editing=null;SU.run={status:'running',results:{},messages:{},output:'',total:null,startedAt:Date.now(),targets};
    renderSuite();suPoll(false);
  }catch(e){toast(e.message,'bad')}
}
async function suPoll(once){
  if(SU.poll){clearTimeout(SU.poll);SU.poll=null}
  try{
    const d=await api('/api/suite/run');SU.run=d.run;
    const nb=$('#nb-suiterun');if(nb){nb.hidden=!suRunning();nb.textContent=suRunning()?1:'';}
    /* Karta Autotests zamknięta (albo inny jej subtab): nie przebudowujemy drzewa; po powrocie loadSuite()/atSetSub() odświeży wszystko. */
    const paneHidden=$('#view-autotest').hidden||AT_SUB==='write';
    if(!paneHidden){
      const frame=SU.run?SU.run.status+'|'+Object.keys(SU.run.results||{}).length+'|'+(SU.run.output||'').length:'';
      if(frame!==SU.frame){SU.frame=frame;atRefreshActivePane()}
    }
    if(suRunning()){SU.poll=setTimeout(()=>suPoll(false),document.hidden||paneHidden?5000:1500);return}
    if(!once){await loadSuite()}
  }catch(e){SU.poll=setTimeout(()=>suPoll(false),3000)}
}
function suRunBlock(r,title,past){
  if(!r)return '<div class="muted-note">Nothing has been run yet. Tick some tests on the left and press Run selected.</div>';
  const res=r.results||{};const ids=Object.keys(res);
  const passed=ids.filter(i=>res[i]==='passed').length,failed=ids.filter(i=>res[i]==='failed'||res[i]==='error').length;
  const running=!past&&(r.status==='running'||r.status==='cancelling');
  const total=r.total||null;
  const pct=total?Math.min(100,Math.round(ids.length/total*100)):null;
  const state=running?(r.status==='cancelling'?'Cancelling…':'Running'):r.status==='cancelled'?'Cancelled':r.status==='failed'?'Failed':failed?'Finished with failures':'All passed';
  const cls=running?'':failed||r.status==='failed'?'bad':r.status==='cancelled'?'':'ok';
  let h=`<div class="sec-head"><h4>${esc(title)}</h4><span class="tag-s">${esc(state)}</span><span class="grow"></span>`
    +(running?'<button class="btn sm danger" id="suCancel">Cancel</button>':'')+`</div>`
    +`<div class="chk ${cls}"><b>${passed} passed, ${failed} failed</b>${total?` · ${ids.length} of ${total} done`:` · ${ids.length} done`}`
    +(r.finishedAt?` · ${Math.max(1,Math.round((r.finishedAt-r.startedAt)/1000))} s`:running?' · running…':'')
    +(r.error?`<div style="margin-top:6px">${esc(r.error)}</div>`:'')
    +(pct!==null&&running?`<div class="su-bar"><i style="width:${pct}%"></i></div>`:'')+'</div>';
  if(ids.length){
    h+='<ul class="su-res">'+ids.sort((a,b)=>(res[a]==='passed')-(res[b]==='passed')).map(i=>{
      const o=res[i];const bad=o==='failed'||o==='error';const msg=(r.messages||{})[i];
      return `<li><div class="su-rh"><span class="tg ${o==='passed'?'ok':bad?'bad':''}">${esc(o.toUpperCase())}</span><span class="mono">${esc(suShort(i))}</span></div>`
        +(bad&&msg?`<details open><summary>why it failed</summary><pre>${esc(msg)}</pre></details>`:'')+'</li>';
    }).join('')+'</ul>';
  }
  if(r.output)h+=`<details class="su-out" ${SU.outOpen?'open':''}><summary>pytest output</summary><pre>${esc(r.output.slice(-12000))}</pre></details>`;
  return h;
}
async function renderSuiteDetail(){
  const box=$('#sDetail');if(!box)return;
  if(SU.editing){
    const e=SU.editing;
    box.innerHTML=`<div class="panel-b"><div class="sec-head"><h4>Edit <span class="mono">${esc(e.path)}</span></h4><span class="grow"></span><button class="btn sm" id="suEdCancel">Close</button></div>
      <textarea id="suEd" class="su-ed mono" spellcheck="false">${esc(e.content)}</textarea>
      <div class="stg-act" style="margin-top:10px"><button class="btn" id="suEdSave">${ico('check',13)} Save</button><span class="stg-note" style="margin:0">The file is saved only if pytest can still collect the tests. Otherwise it stays as it was.</span></div>
      <div id="suEdErr"></div></div>`;
    $('#suEdCancel').onclick=()=>{SU.editing=null;renderSuiteDetail()};
    $('#suEdSave').onclick=async()=>{
      const b=$('#suEdSave');b.disabled=true;$('#suEdErr').innerHTML='';
      try{await api('/api/suite/file',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({path:e.path,content:$('#suEd').value})});
        toast('Saved '+e.path);e.content=$('#suEd').value;await loadSuite()}
      catch(err){$('#suEdErr').innerHTML=`<div class="chk bad" style="margin-top:10px">${esc(err.message)}</div>`}
      b.disabled=false;
    };
    return;
  }
  let h='<div class="panel-b">';
  h+=SU.view?`<div style="margin-bottom:10px"><button class="btn sm" id="suBack">← Back to the latest run</button></div>`+suRunBlock(SU.view,'Run from '+new Date(SU.view.startedAt).toLocaleString(),true)
    :suRunBlock(SU.run,suRunning()?'Current run':'Latest run',false);
  h+='<div class="sec-head" style="margin-top:22px"><h4>History</h4><span class="sec-meta">last 30 runs</span></div><div id="suHist"><div class="muted-note">Loading…</div></div></div>';
  box.innerHTML=h;
  if($('#suCancel'))$('#suCancel').onclick=()=>api('/api/suite/cancel',{method:'POST'}).then(()=>suPoll(false)).catch(e=>toast(e.message,'bad'));
  if($('#suBack'))$('#suBack').onclick=()=>{SU.view=null;renderSuiteDetail()};
  const so=box.querySelector('.su-out');if(so)so.addEventListener('toggle',()=>{SU.outOpen=so.open});
  suPaintHist();
}
async function suLoadHist(){try{SU.hist=await api('/api/suite/history')}catch(_){SU.hist=SU.hist||[]}suPaintHist()}
function suPaintHist(){
  const el=$('#suHist');if(!el)return;
  if(!SU.hist){el.innerHTML='<div class="muted-note">Loading…</div>';return}
  el.innerHTML=SU.hist.length?'<div class="su-hist">'+SU.hist.map(x=>`<button data-h="${esc(x.id)}"><span>${esc(new Date(x.startedAt).toLocaleString())}</span><span class="mono">${x.passed} passed · ${x.failed} failed</span><span class="su-n">${esc(x.status)}</span></button>`).join('')+'</div>':'<div class="muted-note">No runs yet.</div>';
  el.querySelectorAll('[data-h]').forEach(b=>b.onclick=async()=>{SU.view=await api('/api/suite/history/'+b.dataset.h);renderSuiteDetail()});
}
function renderSuite(){atRefreshActivePane()}
(function suiteInit(){
  const tree=$('#suTree');
  tree.addEventListener('change',e=>{
    const cb=e.target.closest('.su-cb');if(!cb)return;
    const ids=suIdsOf(cb.dataset.ids);
    ids.forEach(i=>cb.checked?SU.sel.add(i):SU.sel.delete(i));
    renderSuiteList();
  });
  tree.addEventListener('click',e=>{
    const tg=e.target.closest('[data-tg]');
    if(tg){const k=tg.dataset.tg;SU.closed.has(k)?SU.closed.delete(k):SU.closed.add(k);renderSuiteList();return}
    const rf=e.target.closest('[data-run-file]');
    if(rf){suStart([rf.dataset.runFile]);return}
    const ed=e.target.closest('[data-edit]');
    if(ed){api('/api/suite/file?path='+encodeURIComponent(ed.dataset.edit)).then(j=>{SU.editing=j;SU.view=null;renderSuiteDetail();scrollTo(0,0)}).catch(err=>toast(err.message,'bad'))}
  });
  $('#suQ').oninput=debounce(e=>{SU.q=e.target.value;renderSuiteList()});
  $('#suMarker').onchange=e=>{SU.marker=e.target.value;renderSuiteList()};
  $('#suStatus').onchange=e=>{SU.status=e.target.value;renderSuiteList()};
  $('#suAll').onclick=()=>{SU.tests.filter(suVisible).forEach(t=>SU.sel.add(t.id));renderSuiteList()};
  $('#suNone').onclick=()=>{SU.sel.clear();renderSuiteList()};
  $('#suFailed').onclick=()=>{SU.sel.clear();SU.tests.filter(t=>['failed','error'].includes(suOutcome(t.id).o)).forEach(t=>SU.sel.add(t.id));renderSuiteList()};
  $('#suGo').onclick=()=>{const t=suTargets();if(t.length)suStart(t)};
})();
