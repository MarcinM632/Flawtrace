// Flawtrace: setup wizard. Opens on the first visit and stays open until the test environment API is connected,
// because without it no agent can do anything. It shows the Sources panels one at a time (the same forms, so
// saving and importing work exactly as on the Sources page) and ends with what the agents will learn from.
const SETUP={i:0,panels:[],homes:[],open:false};
const SETUP_STEPS=[
  {t:'Test environment API',d:'Swagger or OpenAPI of the environment',req:true},
  {t:'Jira',d:'Tasks, releases and bugs'},
  {t:'Confluence',d:'Specifications'},
  {t:'Code repositories',d:'What really exists in the code'},
  {t:'Knowledge base',d:'How your team tests'},
  {t:'Ready',d:'What the agents learn from'},
];

function setupPanels(){
  if(!SETUP.panels.length)SETUP.panels=[...document.querySelectorAll('#view-sources > .col > section.panel')].slice(1,7);
  return SETUP.panels;
}
const setupDone=()=>{const s=SRC.data&&SRC.data.status;return s?srcStepsDone(s):[]};
const setupApiReady=()=>!!(SRC.data&&SRC.data.status&&SRC.data.status.api);

function setupRender(){
  const done=setupDone();
  $('#setupSteps').innerHTML=SETUP_STEPS.map((s,i)=>`<li class="${i===SETUP.i?'on':''} ${done[i]?'done':''}" data-i="${i}">
    <span class="ss-n">${done[i]&&i<5?SRC_TICK:String(i+1).padStart(2,'0')}</span>
    <span class="ss-t"><b>${s.t}</b><small>${s.d}${s.req?' · required':''}</small></span></li>`).join('');
  $('#setupCount').textContent=`Step ${SETUP.i+1} of ${SETUP_STEPS.length}`;
  const stage=$('#setupStage');
  [...stage.children].forEach(c=>{if(c.classList.contains('panel'))setupRestore(c)});
  stage.innerHTML='';
  if(SETUP.i===5){stage.insertAdjacentHTML('beforeend','<div id="setupSummary" class="setup-summary"></div>');setupSummary()}
  const p=setupPanels()[SETUP.i];
  if(p){SETUP.homes[SETUP.i]=SETUP.homes[SETUP.i]||document.createComment('setup');if(!SETUP.homes[SETUP.i].parentNode)p.before(SETUP.homes[SETUP.i]);stage.appendChild(p)}
  stage.classList.remove('enter');void stage.offsetWidth;stage.classList.add('enter');
  const ready=setupApiReady();
  $('#setupBack').hidden=SETUP.i===0;
  $('#setupSkip').hidden=SETUP.i===5;
  const next=$('#setupNext');
  next.textContent=SETUP.i===5?'Start using Flawtrace':'Next';
  next.disabled=false;
  $('#setupHint').textContent=SETUP.i===0&&!ready?'Required to finish the setup. You can fill in the other steps first.':SETUP.i===5&&!ready?'Connect the API in step 1 to finish the setup.':'';
  if(SETUP.i===5)next.disabled=!ready;
}
function setupRestore(p){const i=setupPanels().indexOf(p);const h=SETUP.homes[i];if(h&&h.parentNode)h.replaceWith(p)}

async function setupSummary(){
  const box=$('#setupSummary');if(!box)return;
  const s=SRC.data.status;
  const src=[['API',s.api,s.endpoints+' endpoints'],['Jira',s.jira,'tasks and releases'],['Confluence',s.confluence,'specifications'],['Repositories',s.repos>0,s.repos+' ready'],['Team rules',s.rulesFilled,'how-we-test.md']];
  const apiOnly=s.api&&!s.jira&&!s.confluence&&!s.repos&&!s.rulesFilled;
  box.innerHTML=`<p class="setup-kicker">${apiOnly?'API-only mode':'Connected sources'}</p>
    <h3>${apiOnly?'The agents learn the application from its endpoints':'The agents work from these sources'}</h3>
    <p class="setup-lead">${apiOnly
      ?'There are no tickets or documents yet, so every agent first reads the application model below: the resources, what each one can do, which one must exist before another and the order to create test data in. From it they work out what the application is for and build the test flows. Anything the contract does not settle is reported as an open question.'
      :'Expected results come from these sources. Anything they do not settle is reported as an open question, never assumed.'}</p>
    <div class="setup-src">${src.map(([n,on,d])=>`<span class="${on?'on':''}"><i></i><b>${n}</b>${on?d:'not connected'}</span>`).join('')}</div>
    <div id="setupModel" class="setup-model"><div class="muted-note">Reading the specification…</div></div>`;
  if(!s.api){$('#setupModel').innerHTML='';return}
  try{
    const m=await api('/api/sources/app-model');
    const res=m.resources.filter(r=>!r.readOnly||r.endpoints>1).slice(0,6);
    $('#setupModel').innerHTML=`<div class="sm-head"><b>Application model</b><span>${m.resources.length} resources · ${m.endpoints} endpoints</span></div>
      <div class="sm-order">${m.order.slice(0,10).map((p,i)=>`<span><em>${String(i+1).padStart(2,'0')}</em>${esc(p)}</span>`).join('')}</div>
      ${res.map(r=>`<div class="sm-res"><div><b>${esc(r.path)}</b>${r.needs.length?`<small>needs ${r.needs.map(esc).join(', ')}</small>`:''}</div>
        <div class="sm-flow">${r.flow.map(f=>`<span title="${esc(f.check)}">${esc(f.step==='action'?f.endpoint.replace(/_.*$/,''):f.step)}</span>`).join('<i>→</i>')||'<span>read only</span>'}</div></div>`).join('')}`;
  }catch(e){$('#setupModel').innerHTML=`<div class="chk bad">${esc(e.message)}</div>`}
}

async function openSetup(start){
  if(!SRC.data||!$('#srcBase').value)await loadSources();
  SETUP.open=true;
  const done=setupDone();
  SETUP.i=start!=null?start:(done[0]?5:0);
  $('#setupModal').hidden=false;document.body.classList.add('modal-open');
  setupRender();
}
function closeSetup(){
  if(!setupApiReady())return;
  setupPanels().forEach(setupRestore);
  SETUP.open=false;$('#setupModal').hidden=true;document.body.classList.remove('modal-open');
  try{localStorage.setItem('setup.seen','1')}catch(_){}
  loadSources();
}
function setupGo(i){SETUP.i=Math.max(0,Math.min(SETUP_STEPS.length-1,i));setupRender()}

$('#setupNext').onclick=()=>{if(SETUP.i===5)return closeSetup();setupGo(SETUP.i+1)};
$('#setupBack').onclick=()=>setupGo(SETUP.i-1);
$('#setupSkip').onclick=()=>setupGo(SETUP.i+1);
$('#setupSteps').addEventListener('click',e=>{const li=e.target.closest('li');if(!li)return;const i=+li.dataset.i;setupGo(i)});
$('#setupGuide').onclick=()=>$('#srcGuide').click();
$('#srcWizard').onclick=()=>openSetup(0);
// Esc and clicks outside never close the wizard before the API is connected.
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&SETUP.open&&$('#guideModal').hidden){e.stopPropagation();closeSetup()}},true);
// Saving inside the wizard re-renders the ticks and unlocks Next.
const _srcRender=renderSources;
renderSources=function(){_srcRender();if(SETUP.open)setupRender()};
// "Run a check in QA MCP" leaves the wizard for the QA MCP page.
$('#srcTry').addEventListener('click',()=>{if(SETUP.open&&setupApiReady())closeSetup()},true);

/* First visit: the wizard replaces the old redirect to Sources. */
srcFirstRun=function(){};
srcStatus.then(s=>{if(s&&!s.api)openSetup(0)});
