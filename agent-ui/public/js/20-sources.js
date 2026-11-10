// QA Agents UI: sources. Jira, Confluence, repositories, the knowledge base and the API of the test environment.
const SRC={data:null,specs:[],repos:[]};
const MASK='********';

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
  const chip=(on,label,val)=>`<span class="src-chip${on?' on':''}">${label}${val?` <b>${esc(String(val))}</b>`:''}</span>`;
  $('#srcSt').innerHTML=[
    chip(s.knowledge>0,'Knowledge base',s.knowledge+' documents'),
    chip(s.jira,'Jira',s.jira?'connected':'not connected'),
    chip(s.confluence,'Confluence',s.confluence?'connected':'not connected'),
    chip(s.repos>0,'Repositories',s.repos+' of '+s.reposTotal),
    chip(s.api,'Test environment',s.endpoints+' endpoints'),
  ].join('');
  const n=[s.jira,s.confluence,s.repos>0,s.api].filter(Boolean).length;
  const c=$('#srcCount');if(c){c.textContent=n+'/4';c.hidden=false}
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
    $('#srcTestOut').innerHTML=rows.length?srcResult(rows):'<div class="src-res"><div class="muted-note">Nothing to test yet. Fill in at least one source below.</div></div>';
  }catch(e){toast(e.message,'bad')}
  srcBusy(b,false,'Test connections');
};
document.addEventListener('click',e=>{const a=e.target.closest('[data-tab-link]');if(a){e.preventDefault();showTab(a.dataset.tabLink)}});
