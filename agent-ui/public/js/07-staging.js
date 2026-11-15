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
  if(v&&!m.stack){
    const lab={passed:'VERIFIED',flaky:'FLAKY',defect:'POSSIBLE DEFECT',failing:'FAILING',unverified:'NOT RUN'}[v.state]||v.state;
    const cls=v.state==='passed'?'ok':(v.state==='unverified'?'warn':'bad');
    const att=(v.attempts||[]).map(a=>'<div class="at"><b>'+(a.repeat?'Repeat run, all tests':a.only?'Run '+(a.round+1)+', only the '+a.only.length+' that failed':'Run '+(a.round+1))+':</b> '+a.passed+' passed, '+a.failed+' failed'
      +(a.cases&&a.cases.length?'</div>'+a.cases.map(caseCard).join(''):(a.note?'<div class="at-note">'+esc(a.note)+'</div>':'')+'</div>')).join('');
    h+='<div class="sec-head" style="margin-top:20px"><h4>Run on the environment</h4><span class="sec-meta">the app ran these tests itself'+((v.attempts||[]).some(a=>a.note)?' and sent failures back to the agent':'')+'</span></div>'
      +'<div class="chk '+cls+' vf"><b>'+lab+'</b> · '+esc(v.summary||'')+att+(v.output?'<details><summary>pytest output</summary><pre>'+esc(v.output)+'</pre></details>':'')+'</div>';
  }
  h+=tsRunBlock(m);
  if(st==='pending'){
    const proj=!!m.stack;
    const ok=proj?f.length>0:v&&v.state==='passed';
    h+='<div class="stg"><div class="stg-act">'
      +(ok?'<button class="btn" id="stSave">'+ico('check',13)+' Save to repo</button>':'')
      +'<button class="btn sm" id="stDiscard">Discard</button></div>'
      +'<div class="stg-note">'+(ok?proj?'This is a ready project folder. The app does not run it, so run it yourself with the command above. It is added to autotests/ only when you click Save.':'These tests passed twice on the environment. They are added to autotests/ only when you click Save.'
        :'Only tests that pass on the environment can be saved, so there is no Save button for this result. Nothing was added to autotests/.')+'</div></div>';
  }
  return h;
}
/* ---------- TypeScript Playwright project: run it on the page and see the evidence ---------- */
const TR_BUSY=['preparing','installing','running'];
const TR_LABEL={preparing:'Preparing the project',installing:'Installing Playwright and the browser (only the first time, about a minute)',running:'Running the tests in a browser'};
function tsRunBlock(m){
  if(m.stack!=='ts-playwright'||m.status!=='done'||!(m.staging&&m.staging.state==='pending'))return '';
  const tr=m.testRun,busy=!!tr&&TR_BUSY.includes(tr.state);
  let h='<div class="sec-head" style="margin-top:20px"><h4>Run on the page</h4><span class="sec-meta">the app runs the project itself and keeps screenshots, video and a trace of every test</span></div><div class="tr">';
  if(busy){
    h+='<div class="chk warn"><b>'+esc(TR_LABEL[tr.state])+'</b> · '+Math.max(0,Math.round((Date.now()-tr.startedAt)/1000))+' s'
      +(tr.tail?'<details><summary>output</summary><pre>'+esc(tr.tail)+'</pre></details>':'')+'</div>'
      +'<div class="stg-act"><button class="btn sm" id="trCancel">Cancel</button></div>';
  }else{
    h+='<div class="u-cred"><input type="text" id="trUser" placeholder="User name (if the page has a login)" autocomplete="off" spellcheck="false"><input type="password" id="trPass" placeholder="Password" autocomplete="new-password"></div>'
      +'<div class="hint">The login is given to the tests as E2E_USERNAME and E2E_PASSWORD for this run only. It is not saved.</div>'
      +'<div class="stg-act"><button class="btn" id="trRun">'+ico('play',13)+' '+(tr?'Run again':'Run the test')+'</button></div>';
  }
  if(tr&&!busy){
    const ok=tr.state==='passed',cls=ok?'ok':tr.state==='failed'||tr.state==='error'?'bad':'warn';
    const s=tr.stats;
    h+='<div class="chk '+cls+'"><b>'+esc({passed:'PASSED',failed:'FAILED',error:'DID NOT RUN',cancelled:'CANCELLED'}[tr.state]||tr.state)+'</b>'
      +(s?' · '+s.passed+' passed, '+s.failed+' failed'+(s.flaky?', '+s.flaky+' flaky':'')+(s.skipped?', '+s.skipped+' skipped':''):'')
      +(tr.finishedAt?' · '+Math.round((tr.finishedAt-tr.startedAt)/1000)+' s':'')
      +(tr.error?'<div>'+esc(tr.error)+'</div>':'')
      +((tr.tests||[]).length?'<ul class="files">'+tr.tests.map(t=>'<li><span class="tg'+(t.status==='expected'?' ok':'')+'">'+esc(t.status==='expected'?'PASS':t.status==='unexpected'?'FAIL':String(t.status).toUpperCase())+'</span><span>'+esc(t.title)+'</span> <span class="mono">'+(t.ms/1000).toFixed(1)+' s</span>'+(t.error?'<pre>'+esc(t.error)+'</pre>':'')+'</li>').join('')+'</ul>':'')
      +(tr.hasReport?'<div class="stg-act"><a class="btn" id="trReport" target="_blank" rel="noopener" href="/api/runs/'+encodeURIComponent(m.id)+'/test-report/">'+ico('chart',13)+' Open the report with screenshots and video</a></div>':'')
      +(tr.tail?'<details><summary>output</summary><pre>'+esc(tr.tail)+'</pre></details>':'')+'</div>';
  }
  return h+'</div>';
}
let trTimer=null;
function bindTsRun(m){
  const busy=!!m.testRun&&TR_BUSY.includes(m.testRun.state);
  if(busy&&!trTimer)trTimer=setInterval(()=>{if(!current||current.id!==m.id){clearInterval(trTimer);trTimer=null;return}reload(m.id)},2000);
  if(!busy&&trTimer){clearInterval(trTimer);trTimer=null}
  if($('#trRun'))$('#trRun').onclick=async()=>{
    $('#trRun').disabled=true;
    try{
      await post('/api/runs/'+m.id+'/test-run',{username:$('#trUser').value,password:$('#trPass').value});
      await reload(m.id);
    }catch(e){toast(e.message,'bad');$('#trRun').disabled=false}
  };
  if($('#trCancel'))$('#trCancel').onclick=()=>api('/api/runs/'+m.id+'/test-run',{method:'DELETE'}).then(()=>reload(m.id)).catch(e=>toast(e.message,'bad'));
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
  bindTsRun(m);
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
