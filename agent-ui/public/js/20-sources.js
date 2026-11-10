// QA Agents UI: sources. Jira, Confluence, repositories, the knowledge base and the API of the test environment.
const SRC={data:null,specs:[],repos:[],checked:false};
const MASK='********';
const SRC_STEPS=['Test environment API','Jira','Confluence','Code repositories','Knowledge base','Check'];
const SRC_TICK='<svg width="12" height="12"><use href="#i-check"/></svg>';
const srcStepsDone=s=>[s.api,s.jira,s.confluence,s.repos>0,s.knowledge>0&&s.rulesFilled,SRC.checked];

/* Status of the required step, read once on load; the first-run banner and start page depend on it. */
const srcStatus=api('/api/sources').then(d=>{if(!SRC.data)SRC.data=d;return d.status}).catch(()=>null);
const SETUP_HIDE='setup.banner.hidden';
function updateSetupBanner(){
  const b=$('#setupBanner');if(!b)return;
  const s=SRC.data&&SRC.data.status;
  let hidden=false;try{hidden=sessionStorage.getItem(SETUP_HIDE)==='1'}catch(_){}
  const onSources=!$('#view-sources').hidden;
  b.hidden=!s||s.api||hidden||onSources;
}
function srcFirstRun(){srcStatus.then(s=>{if(s&&!s.api&&!location.hash)showTab('sources')})}
srcStatus.then(updateSetupBanner);
$('#setupBannerX').onclick=()=>{try{sessionStorage.setItem(SETUP_HIDE,'1')}catch(_){}updateSetupBanner()};

async function loadSources(){
  try{SRC.data=await api('/api/sources')}catch(e){$('#srcSt').innerHTML=`<div class="chk bad">${esc(e.message)}</div>`;return}
  const d=SRC.data;
  $('#srcBase').value=d.api.baseUrl||'';
  $('#srcAuthH').value=d.api.authHeader||'Authorization';
  $('#srcAuthV').value=d.api.authValue||'';
  $('#srcRO').checked=!!d.api.readOnly;
  $('#srcJiraUrl').value=d.jira.url||'';$('#srcJiraProj').value=d.jira.projects||'';
  $('#srcJiraEmail').value=d.jira.email||'';$('#srcJiraToken').value=d.jira.token||'';
  $('#srcConfUrl').value=d.confluence.url||'';$('#srcConfSpaces').value=d.confluence.spaces||'';
  $('#srcConfEmail').value=d.confluence.email||'';$('#srcConfToken').value=d.confluence.token||'';
  $('#srcKbDir').value=d.knowledgeDir||'';$('#srcKbDir').placeholder=d.knowledgeDefault||'knowledge';
  SRC.specs=(d.api.specs||[]).map(s=>({...s}));
  SRC.repos=(d.repos||[]).map(r=>({...r}));
  renderSources();
  api('/api/sources/knowledge').then(k=>{
    $('#srcKbMeta').textContent=k.files.length+' documents';
    $('#srcKbFiles').innerHTML=k.files.length?k.files.map(f=>`<span>${esc(f.path)}</span>`).join(''):'<div class="muted-note">The folder is empty. Add Markdown or text files that describe how the team tests.</div>';
  }).catch(()=>{});
}

function renderSources(){
  const s=SRC.data.status;
  const done=srcStepsDone(s);
  $('#srcSt').innerHTML=SRC_STEPS.map((t,i)=>`<li class="${done[i]?'done':''}" data-go="${i+1}"><span class="step-n${done[i]?' done':''}">${done[i]?SRC_TICK:i+1}</span><span>${t}</span></li>`).join('');
  document.querySelectorAll('#view-sources .step-h .step-n').forEach(el=>{const i=+el.dataset.step-1;el.classList.toggle('done',!!done[i]);el.innerHTML=done[i]?SRC_TICK:String(i+1)});
  const n=done.filter(Boolean).length;
  $('#srcProgress').textContent=n+' of 6 done.';
  const c=$('#srcCount');if(c){c.textContent=n+'/6';c.hidden=false}
  updateSetupBanner();
  $('#srcApiMeta').textContent=s.endpoints?s.endpoints+' endpoints':'';
  $('#srcRepoMeta').textContent=s.reposTotal?s.repos+' of '+s.reposTotal+' ready':'';
  $('#srcSpecs').innerHTML=SRC.specs.length?SRC.specs.map((x,i)=>`<div class="src-row" data-i="${i}"><input data-k="name" value="${esc(x.name||'')}" placeholder="Name" aria-label="Name"><input data-k="url" value="${esc(x.url||'')}" placeholder="https://test.example.com/v3/api-docs" aria-label="Address of the OpenAPI or Swagger JSON"><button type="button" class="btn icon" data-del title="Remove"><svg width="13" height="13"><use href="#i-x"/></svg></button></div>`).join('')
    :'<div class="muted-note">No specification yet. Add the address of an OpenAPI or Swagger JSON document, or of a Swagger UI page.</div>';
  $('#srcRepos').innerHTML=SRC.repos.length?SRC.repos.map((x,i)=>`<div class="src-row repo" data-i="${i}"><input data-k="name" value="${esc(x.name||'')}" placeholder="Name" aria-label="Name"><input data-k="url" value="${esc(x.url||'')}" placeholder="https://git.example.com/team/service.git or a local folder" aria-label="Clone address or local folder"><input data-k="branch" value="${esc(x.branch||'')}" placeholder="Branch" aria-label="Branch"><button type="button" class="btn icon" data-del title="Remove"><svg width="13" height="13"><use href="#i-x"/></svg></button></div>`).join('')
    :'<div class="muted-note">No repository yet. The agents read the code to check what really exists and what changed.</div>';
}

function srcRowsInput(box,list){
  box.addEventListener('input',e=>{const r=e.target.closest('[data-i]');if(r&&e.target.dataset.k)list()[+r.dataset.i][e.target.dataset.k]=e.target.value});
  box.addEventListener('click',e=>{const b=e.target.closest('[data-del]');if(!b)return;list().splice(+b.closest('[data-i]').dataset.i,1);renderSources()});
}
srcRowsInput($('#srcSpecs'),()=>SRC.specs);
srcRowsInput($('#srcRepos'),()=>SRC.repos);
$('#srcSpecAdd').onclick=()=>{SRC.specs.push({name:'',url:''});renderSources();const r=$('#srcSpecs').lastElementChild;if(r)r.querySelector('[data-k="url"]').focus()};
$('#srcRepoAdd').onclick=()=>{SRC.repos.push({name:'',url:'',branch:''});renderSources();const r=$('#srcRepos').lastElementChild;if(r)r.querySelector('[data-k="url"]').focus()};

function srcForm(){
  return {
    jira:{url:$('#srcJiraUrl').value,email:$('#srcJiraEmail').value,token:$('#srcJiraToken').value,projects:$('#srcJiraProj').value},
    confluence:{url:$('#srcConfUrl').value,email:$('#srcConfEmail').value,token:$('#srcConfToken').value,spaces:$('#srcConfSpaces').value},
    api:{baseUrl:$('#srcBase').value,authHeader:$('#srcAuthH').value||'Authorization',authValue:$('#srcAuthV').value,readOnly:$('#srcRO').checked,specs:SRC.specs},
    repos:SRC.repos,
    knowledgeDir:$('#srcKbDir').value,
  };
}
async function srcSave(){SRC.data=await post('/api/sources',srcForm());SRC.specs=SRC.data.api.specs.map(s=>({...s}));SRC.repos=SRC.data.repos.map(r=>({...r}));renderSources();return SRC.data}
const srcResult=rows=>'<div class="src-res">'+rows.map(r=>`<div class="chk ${r.ok?'ok':'bad'}"><b>${esc(r.label||r.name)}</b>: ${esc(r.ok?(r.operations!=null?r.operations+' endpoints':r.message||'ready'):r.message)}</div>`).join('')+'</div>';
const srcBusy=(btn,on,text)=>{btn.disabled=on;if(text)btn.textContent=text};

$('#srcApiSave').onclick=async()=>{
  const b=$('#srcApiSave');$('#srcApiErr').textContent='';srcBusy(b,true,'Importing…');
  try{
    await srcSave();
    const t=await api('/api/tools/rescan',{method:'POST'});
    const h=t.history[0]||{fetched:[]};
    $('#srcApiOut').innerHTML=(h.fetched||[]).length?srcResult(h.fetched):'';
    toast(t.total+' endpoints imported');
    await loadSources();refreshAvailability();
  }catch(e){$('#srcApiErr').textContent=e.message}
  srcBusy(b,false,'Save and import endpoints');
};
$('#srcSpecFile').onclick=()=>$('#srcSpecInput').click();
$('#srcSpecInput').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  try{const r=await post('/api/sources/specs/upload',{name:f.name,text:await f.text()});toast(r.operations+' endpoints imported from '+f.name);await loadSources();refreshAvailability()}
  catch(err){$('#srcApiErr').textContent=err.message}
};
for(const [id,label] of [['#srcJiraSave','Jira'],['#srcConfSave','Confluence'],['#srcKbSave','Knowledge base']]){
  $(id).onclick=async()=>{try{await srcSave();toast(label+' saved');if(id==='#srcKbSave')loadSources()}catch(e){toast(e.message,'bad')}};
}
$('#srcRepoSave').onclick=async()=>{
  const b=$('#srcRepoSave');$('#srcRepoErr').textContent='';srcBusy(b,true,'Syncing…');
  try{await srcSave();const r=await api('/api/sources/repos/sync',{method:'POST'});$('#srcRepoOut').innerHTML=srcResult(r.results);SRC.data=r.view;renderSources()}
  catch(e){$('#srcRepoErr').textContent=e.message}
  srcBusy(b,false,'Save and sync');
};
$('#srcTest').onclick=async()=>{
  const b=$('#srcTest');srcBusy(b,true,'Testing…');
  try{
    const r=await api('/api/sources/test',{method:'POST'});
    const names={jira:'Jira',confluence:'Confluence',api:'Test environment'};
    const rows=Object.entries(r).map(([k,v])=>({label:names[k]||k,ok:v.ok,message:v.message}));
    $('#srcTestOut').innerHTML=rows.length?srcResult(rows):'<div class="src-res"><div class="muted-note">Nothing to test yet. Start with step 1.</div></div>';
    SRC.checked=rows.length>0&&rows.every(x=>x.ok)&&!!(SRC.data&&SRC.data.status.api);
    renderSources();
  }catch(e){toast(e.message,'bad')}
  srcBusy(b,false,'Test connections');
};

/* Step 6: a read-only process on the first GET endpoint, ready to run in QA MCP. */
$('#srcTry').onclick=async()=>{
  let t;try{t=await api('/api/tools')}catch(e){return toast(e.message,'bad')}
  const eps=t.groups.flatMap(g=>g.endpoints).filter(e=>e.method==='GET');
  const e=eps.find(x=>!x.params.some(p=>p.required))||eps[0];
  if(!e)return toast('Import the endpoints in step 1 first.','bad');
  showTab('qamcp');
  const q=$('#qProcess');q.value=`Call ${e.method} ${e.path} and check that the answer is HTTP 200.`;q.focus();
};

/* Steps in the overview scroll to their panel. */
$('#srcSt').addEventListener('click',e=>{
  const li=e.target.closest('[data-go]');if(!li)return;
  const h=document.querySelector(`#view-sources .step-h .step-n[data-step="${li.dataset.go}"]`);
  if(h)h.closest('.panel').scrollIntoView({behavior:'smooth',block:'start'});
});

/* Full guide: GETTING_STARTED.md rendered with a small Markdown subset. */
function mdInline(s){
  return esc(s)
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>')
    .replace(/(https?:\/\/[^\s<|)]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>');
}
function mdRender(md){
  const out=[],lines=md.replace(/\r/g,'').split('\n');
  for(let i=0;i<lines.length;i++){
    const l=lines[i];
    if(/^```/.test(l)){const code=[];while(++i<lines.length&&!/^```/.test(lines[i]))code.push(lines[i]);out.push('<pre><code>'+esc(code.join('\n'))+'</code></pre>');continue}
    const h=l.match(/^(#{1,3})\s+(.*)$/);if(h){out.push(`<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`);continue}
    if(/^\|/.test(l)){
      const rows=[];while(i<lines.length&&/^\|/.test(lines[i]))rows.push(lines[i++]);i--;
      const cells=r=>r.replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
      const body=rows.slice(2).map(r=>'<tr>'+cells(r).map(c=>'<td>'+mdInline(c)+'</td>').join('')+'</tr>').join('');
      out.push('<table><thead><tr>'+cells(rows[0]).map(c=>'<th>'+mdInline(c)+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table>');continue;
    }
    if(/^(\d+\.|-)\s/.test(l)){
      const ol=/^\d/.test(l),items=[];
      while(i<lines.length&&/^(\d+\.|-)\s/.test(lines[i]))items.push(lines[i++].replace(/^(\d+\.|-)\s+/,''));i--;
      out.push(`<${ol?'ol':'ul'}>`+items.map(x=>'<li>'+mdInline(x)+'</li>').join('')+`</${ol?'ol':'ul'}>`);continue;
    }
    if(l.trim())out.push('<p>'+mdInline(l)+'</p>');
  }
  return out.join('');
}
$('#srcGuide').onclick=async()=>{
  try{const g=await api('/api/guide');$('#guideBody').innerHTML=mdRender(g.text);$('#guideModal').hidden=false;$('#guideBody').scrollTop=0}
  catch(e){toast(e.message,'bad')}
};
$('#guideClose').onclick=()=>{$('#guideModal').hidden=true};
$('#guideModal').addEventListener('mousedown',e=>{if(e.target.id==='guideModal')$('#guideModal').hidden=true});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#guideModal').hidden)$('#guideModal').hidden=true});
document.addEventListener('click',e=>{const a=e.target.closest('[data-tab-link]');if(a){e.preventDefault();showTab(a.dataset.tabLink)}});
