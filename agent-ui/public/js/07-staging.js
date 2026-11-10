// QA Agents UI: staging. Klasyczny skrypt: wszystkie pliki z js/ dzielą jeden zakres globalny i ładują się po kolei (kolejność jest istotna).
/* ---------- autotests: what was saved, and does pytest accept it ---------- */
function savedBlock(m){
  if(m.agent!=='autotest'||m.status==='running')return '';
  const f=m.files||[],c=m.collect,v=m.verify;
  if(!f.length&&!c&&!v)return '';
  const st=m.staging&&m.staging.state;
  const head=st==='pending'?['Waiting in staging','not in autotests/ yet · nothing was committed or pushed']
    :st==='saved'?['Saved to autotests/','locally · nothing was committed or pushed']
    :st==='discarded'?['Discarded','these files were never added to autotests/']
    :['Saved locally','autotests/ · nothing was committed or pushed'];
  let h='<div class="sec-head" style="margin-top:20px"><h4>'+head[0]+'</h4><span class="sec-meta">'+head[1]+'</span></div>';
  if(f.length)h+='<ul class="files">'+f.map(x=>'<li><span class="tg'+(x.status==='new'?' ok':'')+'">'+(x.status==='new'?'NEW':'CHANGED')+'</span><span class="mono">'+esc(x.path)+'</span></li>').join('')+'</ul>';
  if(c){
    const cls=c.ok===true?'ok':c.ok===false?'bad':'';
    h+='<div class="chk '+cls+'">'+(c.ok===true?'pytest accepts the new tests: ':c.ok===false?'':'')+esc(c.summary||'')+(c.detail?'<pre>'+esc(c.detail)+'</pre>':'')+'</div>';
  }
  if(v){
    const lab={passed:'VERIFIED',flaky:'FLAKY',defect:'POSSIBLE DEFECT',failing:'FAILING',unverified:'NOT RUN'}[v.state]||v.state;
    const cls=v.state==='passed'?'ok':(v.state==='unverified'?'warn':'bad');
    const att=(v.attempts||[]).map(a=>'<div class="at"><b>'+(a.repeat?'Repeat run, all tests':a.only?'Run '+(a.round+1)+', only the '+a.only.length+' that failed':'Run '+(a.round+1))+':</b> '+a.passed+' passed, '+a.failed+' failed'
      +(a.cases&&a.cases.length?'</div>'+a.cases.map(caseCard).join(''):(a.note?'<div class="at-note">'+esc(a.note)+'</div>':'')+'</div>')).join('');
    h+='<div class="sec-head" style="margin-top:20px"><h4>Run on the environment</h4><span class="sec-meta">the app ran these tests itself'+((v.attempts||[]).some(a=>a.note)?' and sent failures back to the agent':'')+'</span></div>'
      +'<div class="chk '+cls+' vf"><b>'+lab+'</b> · '+esc(v.summary||'')+att+(v.output?'<details><summary>pytest output</summary><pre>'+esc(v.output)+'</pre></details>':'')+'</div>';
  }
  if(st==='pending'){
    const ok=v&&v.state==='passed';
    h+='<div class="stg"><div class="stg-act">'
      +(ok?'<button class="btn" id="stSave">'+ico('check',13)+' Save to repo</button>':'')
      +'<button class="btn sm" id="stDiscard">Discard</button></div>'
      +'<div class="stg-note">'+(ok?'These tests passed twice on the environment. They are added to autotests/ only when you click Save.'
        :'Only tests that pass on the environment can be saved, so there is no Save button for this result. Nothing was added to autotests/.')+'</div></div>';
  }
  return h;
}
// One failing test, as the fix agent described it: what it checks, the steps on the environment, expected vs actual.
function caseCard(c){
  const vd=String(c.verdict||'');
  const vc=/DEFEKT/i.test(vd)?'p-failed':/POPRAWIONO/i.test(vd)?'p-done':'p-cancelled';
  return '<div class="fc"><div class="fc-h"><span class="mono fc-t">'+esc(c.test)+'</span>'+(vd?'<span class="pill '+vc+'"><span class="d"></span>'+esc(vd)+'</span>':'')+'</div>'
    +(c.checks?'<div class="fc-chk">'+esc(c.checks)+'</div>':'')
    +(c.steps.length?'<ol class="fc-steps">'+c.steps.map(s=>'<li'+(s.bad?' class="bad"':'')+'>'+(s.bad?'<b>Here it went wrong:</b> ':'')+esc(s.text)+'</li>').join('')+'</ol>':'')
    +((c.expected||c.actual)?'<div class="fc-cmp"><div><span>Expected</span>'+esc(c.expected||'—')+'</div><div class="act"><span>Actual</span>'+esc(c.actual||'—')+'</div></div>':'')
    +(c.cause?'<div class="fc-cause"><span>Why</span>'+esc(c.cause)+'</div>':'')
    +'</div>';
}
function bindStaging(m){
  const go=(url,msg)=>api(url,{method:'POST'}).then(j=>{toast(msg(j));return reload(m.id)}).catch(e=>toast(e.message,'bad'));
  if($('#stSave'))$('#stSave').onclick=()=>{$('#stSave').disabled=true;go('/api/runs/'+m.id+'/autotests/save',j=>j.files.length+' file'+(j.files.length===1?'':'s')+' saved to autotests/')};
  if($('#stDiscard'))$('#stDiscard').onclick=()=>{if(confirm('Discard these tests? They have not been saved and will be deleted.'))go('/api/runs/'+m.id+'/autotests/discard',()=>'Discarded')};
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-open-run]');
  if(b){showTab('qamcp');open(b.dataset.openRun)}
});
function toast(msg,kind){
  const t=document.createElement('div');t.className='toast'+(kind?' '+kind:'');t.textContent=msg;t.setAttribute('role','status');
  document.body.appendChild(t);setTimeout(()=>t.remove(),6000);
}
