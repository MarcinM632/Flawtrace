// Flawtrace: settings (theme, "How to connect", help) and the welcome tour for first-time visitors.
/* ---------- theme ---------- */
const themePref=()=>{try{return localStorage.getItem('theme')||'auto'}catch(_){return 'auto'}};
const themeMq=matchMedia('(prefers-color-scheme: dark)');
function applyTheme(pref){
  try{localStorage.setItem('theme',pref)}catch(_){}
  document.documentElement.dataset.theme=pref==='dark'||(pref==='auto'&&themeMq.matches)?'dark':'light';
}
themeMq.addEventListener('change',()=>{if(themePref()==='auto')applyTheme('auto')});

/* ---------- settings window ---------- */
const ST={tab:'look',info:null,test:null,llm:null,llmMsg:null};
const stCode=(t)=>`<div class="st-code"><button type="button" class="btn sm st-copy" data-copy>Copy</button><pre>${esc(t)}</pre></div>`;
const stStep=(n,title,body)=>`<li class="st-step"><span class="st-n">${n}</span><div><b>${title}</b>${body}</div></li>`;

function stLook(){
  const cur=themePref();
  const opts=[['auto','Auto','Follow the system setting'],['light','Light','Bright background'],['dark','Dark','Easier on the eyes in a dim room']];
  return `<p class="st-lead">Choose how Flawtrace looks. The choice is remembered in this browser.</p>
    <div class="st-themes">${opts.map(([k,t,d])=>`<button type="button" class="st-theme ${cur===k?'on':''}" data-theme-pick="${k}" aria-pressed="${cur===k}"><span class="st-sw st-sw-${k}"></span><b>${t}</b><small>${d}</small></button>`).join('')}</div>`;
}

function stConnect(){
  const i=ST.info;
  if(!i)return '<p class="st-lead">Loading…</p>';
  const mcp=JSON.stringify({mcpServers:{flawtrace:{command:'node',args:[i.mcpScript],env:{FLAWTRACE_URL:i.url}}}},null,2);
  const keyBox=i.key
    ?`<div class="st-key"><code id="stKey" data-key="${esc(i.key)}">${'•'.repeat(24)}</code><button type="button" class="btn sm" id="stKeyShow">Show</button><button type="button" class="btn sm" data-copy-key>Copy</button></div>`
    :`<div class="chk warn">The key is shown only when you open Flawtrace directly on the machine it runs on. ${i.keyFromEnv?'It is the value of QA_API_KEY.':'Read it from '+esc(i.keyFile)+'.'}</div>`;
  const t=ST.test;
  const testRes=t?(t.ok?'<span class="ok-t">Connected. The API answers and the key is accepted.</span>':'<span class="bad-t">'+esc(t.msg)+'</span>'):'';
  return `<p class="st-lead">Two separate things can be connected. <b>A. Flawtrace to your product</b>, so the agents can test it. <b>B. An AI assistant to Flawtrace</b>, so Claude or ChatGPT can start tests for you. Start with A.</p>
  <h3 class="st-h">A. Connect Flawtrace to your product</h3>
  <ol class="st-steps">
    ${stStep(1,'Open the setup window','<p>Click the button below. The window walks you through the sources one at a time and can be closed at any moment.</p><button type="button" class="btn sm" id="stOpenSetup">Open setup</button>')}
    ${stStep(2,'Give the test environment API <span class="tag acc">required</span>','<p>Enter the base address (for example <code>https://test.example.com/api</code>), the authorization header if the API needs a login (usually <code>Authorization</code> with <code>Bearer &lt;token&gt;</code>) and the address of the Swagger / OpenAPI page. No address? Use <b>Upload JSON</b> with the exported specification. Click <b>Save and import endpoints</b>.</p>')}
    ${stStep(3,'Add the optional sources','<p>Jira (tasks, releases, bugs), Confluence (specifications), code repositories and your team\'s testing rules. Each one makes the agents more accurate; with the API alone they learn the application from its endpoints.</p>')}
    ${stStep(4,'Check that it works','<p>Open <b>QA MCP</b> or <b>UI Tests</b>, describe in a sentence what to check and press Run. The report appears on the same page when the agent finishes.</p>')}
  </ol>
  <h3 class="st-h">B. Connect an AI assistant to Flawtrace</h3>
  <ol class="st-steps">
    ${stStep(1,'Copy the API key','<p>The key proves that a request comes from you. Treat it like a password.</p>'+keyBox)}
    ${stStep(2,'Claude Desktop, Claude Code or another MCP client','<p>Add this server to the client\'s MCP configuration (<code>.mcp.json</code> for Claude Code), then restart the client. It needs Node.js and runs on the machine that has Flawtrace. On that machine the key is read automatically; elsewhere add <code>"FLAWTRACE_API_KEY"</code> to <code>env</code>.</p>'+stCode(mcp))}
    ${stStep(3,'ChatGPT (Custom GPT)','<p>ChatGPT calls Flawtrace from the internet, so Flawtrace needs a public address (a tunnel or a hosted copy). '+(i.publicUrlSet?'Your public address is set.':'Start Flawtrace with <code>QA_PUBLIC_URL</code> set to that address; otherwise the specification points at <code>'+esc(i.url)+'</code>, which ChatGPT cannot reach.')+'</p><p>In the GPT editor choose <b>Actions</b> &rarr; <b>Import from URL</b> and paste:</p>'+stCode(i.url+'/api/v1/openapi.json')+'<p>Then set <b>Authentication</b> to <b>API key</b>, type <b>Bearer</b>, and paste the key.</p>')}
    ${stStep(4,'Any other model or script','<p>Call the REST API with the header <code>Authorization: Bearer &lt;key&gt;</code>. Ready-made tool definitions for the OpenAI and Anthropic APIs, and an example call:</p>'+stCode(i.url+'/api/v1/tools?format=openai\n'+i.url+'/api/v1/tools?format=anthropic')+stCode('curl -X POST '+i.url+'/api/v1/tests/ui \\\n  -H "Authorization: Bearer <YOUR_API_KEY>" -H "Content-Type: application/json" \\\n  -d \'{"url":"https://test.example.com/login","goal":"Check that a user can log in"}\''))}
    ${stStep(5,'Test the connection','<p>Sends one request with the key to this Flawtrace.</p><button type="button" class="btn sm" id="stTest" '+(i.key?'':'disabled title="Needs the key, shown only on the local machine"')+'>Test connection</button> <span id="stTestRes" class="st-res">'+testRes+'</span>')}
  </ol>
  <p class="st-foot">Full reference: <code>agent-ui/INTEGRATIONS.md</code>.</p>`;
}


function stAi(){
  const v=ST.llm;
  if(!v)return '<p class="st-lead">Loading…</p>';
  const p=v.providers.find(x=>x.id===v.selected)||v.providers[0];
  const m=ST.llmMsg;
  return `<p class="st-lead">Choose the AI that Flawtrace uses. <b>You use your own account and key; Flawtrace never pays for or sees your usage.</b> The key is stored only on the machine that runs Flawtrace and is never shown again.</p>
  <div class="chk warn">A Claude.ai or ChatGPT <b>subscription is not an API key</b>. An API key comes from the provider's developer console and is billed there. If you only have a subscription, use <b>Claude Code</b> below, or connect your assistant under <b>How to connect</b>.</div>
  <div class="st-form">
    <label>Provider<select id="llmProv">${v.providers.map(x=>`<option value="${x.id}" ${x.id===v.selected?'selected':''}>${esc(x.label)}</option>`).join('')}</select></label>
    ${p.needsModel?`<label>Model<input id="llmModel" value="${esc(v.model)}" placeholder="${esc(p.modelHint)}" autocomplete="off"></label>`:''}
    ${p.baseUrlEditable?`<label>Address${p.baseUrlRequired?' <span class="tag acc">required</span>':''}<input id="llmUrl" value="${esc(v.baseUrl)}" placeholder="${esc(p.defaultBaseUrl||'http://localhost:11434/v1')}" autocomplete="off"></label>`:''}
    ${v.acp?`<label>Agent<select id="llmAcpPreset">${v.acp.presets.map(x=>`<option value="${x.id}" ${x.id===v.acp.preset?'selected':''}>${esc(x.label)}</option>`).join('')}</select></label>
    ${v.acp.preset==='custom'?`<label>Command that starts the agent in ACP mode<input id="llmAcpCmd" value="${esc(v.acp.command)}" placeholder='"C:/path with spaces/agent" --acp' autocomplete="off"></label>`:'<p class="st-hint">Started with npx the first time it is needed (Node.js required, internet for the download). Sign in to that agent once in its own tool.</p>'}`:''}
    ${p.needsKey||p.id==='openai-compatible'?`<label>API key ${v.keySet?`<span class="st-hint">saved: ${esc(v.keyHint)}</span>`:''}<input id="llmKey" type="password" placeholder="${v.keySet?'leave empty to keep the saved key':'paste your key'}" autocomplete="off"></label>`:''}
  </div>
  ${p.note?`<p class="st-hint">${esc(p.note)}</p>`:''}
  ${v.agentsNote?`<div class="chk warn">${esc(v.agentsNote)}</div>`:''}
  <div class="st-actions"><button type="button" class="btn sm" id="llmSave">Save</button><button type="button" class="btn sm" id="llmTest">Test</button>${v.keySet?'<button type="button" class="btn sm danger" id="llmClear">Remove saved key</button>':''}<span class="st-res" id="llmRes">${m?(m.ok?`<span class="ok-t">${esc(m.text)}</span>`:`<span class="bad-t">${esc(m.text)}</span>`):''}</span></div>`;
}
async function llmLoad(){try{ST.llm=await api('/api/llm')}catch(e){ST.llm=null;ST.llmMsg={ok:false,text:e.message}}}
const llmBody=(extra)=>({provider:$('#llmProv').value,model:$('#llmModel')?$('#llmModel').value:'',baseUrl:$('#llmUrl')?$('#llmUrl').value:'',key:$('#llmKey')?$('#llmKey').value:'',acpPreset:$('#llmAcpPreset')?$('#llmAcpPreset').value:undefined,acpCommand:$('#llmAcpCmd')?$('#llmAcpCmd').value:undefined,...extra});
async function llmSave(extra){
  try{ST.llm=await post('/api/llm',llmBody(extra));ST.llmMsg={ok:true,text:'Saved.'}}
  catch(e){ST.llmMsg={ok:false,text:e.message}}
}

function stHelp(){
  return `<p class="st-lead">New here? These re-open the guided parts of the app.</p>
  <div class="st-help">
    <button type="button" class="btn" id="stTour">${ico('play',13)}Replay the welcome tour</button>
    <button type="button" class="btn" id="stSetup2">${ico('play',13)}Open the setup window</button>
    <button type="button" class="btn" id="stGuide">${ico('book',13)}Read the full guide</button>
  </div>
  <h3 class="st-h">Where is what</h3>
  ${TOUR.slice(1,6).map(x=>`<h4 class="st-sub">${esc(x.t)}</h4>${tourItems(x.items)}`).join('')}`;
}

function stRender(){
  document.querySelectorAll('.st-tabs button').forEach(b=>b.classList.toggle('on',b.dataset.st===ST.tab));
  $('#stBody').innerHTML=ST.tab==='look'?stLook():ST.tab==='ai'?stAi():ST.tab==='connect'?stConnect():stHelp();
}
async function openSettings(tab){
  ST.tab=tab||ST.tab;$('#settingsModal').hidden=false;document.body.classList.add('modal-open');stRender();
  if(!ST.info){
    try{ST.info=await api('/api/integration')}
    catch(e){ST.info={url:location.origin,key:null,keyFile:'agent-ui/api-key.txt',mcpScript:'agent-ui/mcp/flawtrace-server.js'}}
    stRender();
  }
}
function closeSettings(){$('#settingsModal').hidden=true;if($('#setupModal').hidden&&$('#tourModal').hidden)document.body.classList.remove('modal-open')}
$('#settingsBtn').onclick=()=>openSettings('look');
$('#stClose').onclick=closeSettings;
$('#settingsModal').addEventListener('mousedown',e=>{if(e.target===$('#settingsModal'))closeSettings()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('#settingsModal').hidden){e.stopPropagation();closeSettings()}},true);
document.querySelector('.st-tabs').addEventListener('click',async e=>{const b=e.target.closest('button[data-st]');if(!b)return;ST.tab=b.dataset.st;if(ST.tab==='ai'){ST.llmMsg=null;await llmLoad()}stRender()});
async function copyText(t,btn){
  const o=btn.textContent;
  try{await navigator.clipboard.writeText(t);btn.textContent='Copied'}catch(_){btn.textContent='Select and copy by hand'}
  setTimeout(()=>{btn.textContent=o},1400);
}
$('#stBody').addEventListener('change',async e=>{
  if(e.target.id==='llmAcpPreset'){await llmSave();stRender();return}
  if(e.target.id!=='llmProv')return;
  const id=e.target.value;ST.llmMsg=null;
  const keep=ST.llm.providers.find(x=>x.id===id);
  try{ST.llm=await post('/api/llm',{provider:id,model:'',baseUrl:''})}catch(err){ST.llmMsg={ok:false,text:err.message}}
  stRender();
});
$('#stBody').addEventListener('click',async e=>{
  const t=e.target.closest('button');if(!t)return;
  if(t.dataset.themePick){applyTheme(t.dataset.themePick);stRender()}
  else if(t.id==='llmSave'){await llmSave();stRender()}
  else if(t.id==='llmClear'){await llmSave({clearKey:true,key:''});stRender()}
  else if(t.id==='llmTest'){
    await llmSave();ST.llmMsg={ok:true,text:'Testing…'};stRender();
    try{const r=await post('/api/llm/test',{});ST.llmMsg=r.ok?{ok:true,text:'Works. The provider answered: '+r.text}:{ok:false,text:r.error}}catch(err){ST.llmMsg={ok:false,text:err.message}}
    stRender();
  }
  else if(t.hasAttribute('data-copy'))copyText(t.parentElement.querySelector('pre').textContent,t);
  else if(t.hasAttribute('data-copy-key'))copyText(ST.info.key,t);
  else if(t.id==='stKeyShow'){const c=$('#stKey');const hid=c.textContent.startsWith('•');c.textContent=hid?c.dataset.key:'•'.repeat(24);t.textContent=hid?'Hide':'Show'}
  else if(t.id==='stOpenSetup'||t.id==='stSetup2'){closeSettings();openSetup(0)}
  else if(t.id==='stGuide'){closeSettings();$('#srcGuide').click()}
  else if(t.dataset.go){closeSettings();showTab(t.dataset.go)}
  else if(t.id==='stTour'){closeSettings();tourStart(true)}
  else if(t.id==='stTest'){
    $('#stTestRes').textContent='Testing…';
    try{
      const r=await fetch('/api/v1/health',{headers:{Authorization:'Bearer '+ST.info.key}});
      ST.test=r.ok?{ok:true}:{ok:false,msg:r.status===401?'The server rejected the key (401). Check QA_API_KEY and api-key.txt.':'HTTP '+r.status};
    }catch(err){ST.test={ok:false,msg:'No answer: '+err.message}}
    stRender();
  }
});

/* ---------- welcome tour ---------- */
// items: [name, what it does, tab to open]. The same data feeds the tour and the "Where is what" list in Settings > Help.
const TOUR=[
  {t:'Welcome to Flawtrace',p:'Flawtrace is a workbench for testers. AI agents read your tickets, specifications and code, design tests, run them on your test environment and write the reports. You stay in control: nothing runs until you press a button, and every report names the sources it is based on.',
   items:[['1. Connect','Give Flawtrace the address of your test environment (and, optionally, Jira, Confluence and your code).','sources'],['2. Ask','Pick an agent, write in a sentence what to check and press Run.','runs'],['3. Read','The report appears on the same page. Defects can go to the bug registry.','bugs']]},
  {t:'Workspace: where you start',p:'Two pages at the top of the menu. They are about you and your connections, not about one test.',
   items:[['Workspace','Your Jira tasks ranked by priority and by how risky their service is, each with a testing checklist, so you know what to test first.','workspace'],['Sources','Everything the agents learn from: the test environment API (required), Jira, Confluence, code repositories and your team rules for testing. Connect it first.','sources']]},
  {t:'Agents: who does what',p:'Each agent has a different job. Pick the one that matches what you want to know.',
   items:[['Analyses (CORE, SVC, mcp-server)','Finds defects in one change before it reaches testing. It reads the ticket, the code before and after the change and the specification, then reports concrete failing cases with evidence. The three tabs use the same method, each on its own part of the code.','runs'],
          ['QA MCP','Runs a test process you describe on the live test environment, calling its API step by step. The report lists every call it made, so each value can be checked.','qamcp'],
          ['Pentest','Runs a thorough, persistent penetration test of the connected test environment, as a full engagement (PTES: recon, threat modelling, exploitation, attack-path chaining): authentication, session and token handling, object- and function-level access control, mass assignment, business logic, resource limits, injection, SSRF, misconfiguration and more — following OWASP WSTG and API Security Top 10, trying many bypass tactics per control. Only tests what you connected, with no real brute force or denial of service.','pentest'],
          ['UI Tests','Opens a web page in a browser, checks what you ask (also behind a login) and reports step by step. A run that fully passes and that you accept becomes a Playwright test.','uitest'],
          ['Autotests','Turns a written test case into an automated pytest test in your suite, and runs the Smoke pack, the System pack or any test from the suite.','autotest']]},
  {t:'Test Flow: the whole process on one ticket',p:'One prompt walks a ticket through seven phases. Each phase is its own agent and passes its report to the next, so the chain is traceable from risk to closing.',
   items:[['1 Planning','Risk, entry and exit criteria and a static check, before the task goes to implementation.',null],['2 Monitoring','Progress and status of the release, read from Jira (page Release monitoring).','tfmonitor'],['3 Analysis','Chooses and justifies the test strategy, finds coverage gaps and the blast radius of the change.',null],['4 Test design','Designs the test cases from the requirement, using the recognised techniques.',null],['5 Implementation','Merges the cases into one execution procedure, prioritised by risk, with a time estimate.',null],['6 Execution','Runs that procedure live on the test environment.',null],['7 Completion','Explains simply how the finished task works, with the known defects of that area.',null],['Run summary','All phases of one ticket on a single page.','runsummary']]},
  {t:'Metrics: how it is going',p:'Pages that show the state of quality. They read from the bug registry, your run history and Jira.',
   items:[['Bug registry','Record findings, see where defects concentrate. Defects found by agents can be added here.','bugs'],['Risk','Defect density by service, calculated from the bug registry. Tells you where to test more.','risk'],['Release monitoring','Progress, status and priority of each release, from Jira.','tfmonitor']]},
  {t:'Reference: the testing know-how',p:'Short, practical guides that the agents also follow. Read them when you want to know why a test was designed the way it was.',
   items:[['Tools','The endpoints of your test environment, imported from its API specification.','tools'],['Manual testing','Test levels, design techniques and how to choose between them.','doc'],['AI testing','Testing AI systems and testing with generative AI.','ai'],['Automated testing','How a test automation suite is structured.','autodoc'],['Tests procedure','The seven activities of the test process and the strategy behind them.','testproc']]},
  {t:'Connect your product first',p:'To run any test Flawtrace needs the address of your test environment API: the base address, the authorization header if it needs a login, and the Swagger / OpenAPI page. The setup window guides you step by step. Jira, Confluence and repositories are optional and make the agents more accurate. Reports always separate what a source confirmed from what stays an open question.'},
  {t:'Settings are always at hand',p:'The gear at the bottom of the menu opens Settings.',
   items:[['Appearance','Light, dark or automatic theme.',null],['How to connect','Step by step: connect Flawtrace to your product, and connect Claude or ChatGPT to Flawtrace, with a connection test.',null],['Help','Replay this tour, see where everything is, or open the full guide.',null]]},
];
function tourItems(items){
  return `<div class="tour-items">${items.map(([n,d,tab])=>`<div class="tour-item"><b>${esc(n)}</b><span>${esc(d)}</span>${tab?`<button type="button" class="btn sm" data-go="${tab}">Open</button>`:''}</div>`).join('')}</div>`;
}
const TOUR_S={i:0,open:false};
const tourSeen=()=>{try{return !!localStorage.getItem('tour.seen')}catch(_){return false}};
function tourRender(){
  const s=TOUR[TOUR_S.i],last=TOUR_S.i===TOUR.length-1;
  $('#tourTitle').textContent=s.t;$('#tourText').innerHTML=s.p+(s.items?tourItems(s.items):'');$('#tourCount').textContent=`${TOUR_S.i+1} of ${TOUR.length}`;$('#tourBody').scrollTop=0;
  $('#tourDots').innerHTML=TOUR.map((_,i)=>`<i class="${i===TOUR_S.i?'on':''}"></i>`).join('');
  $('#tourBack').hidden=TOUR_S.i===0;$('#tourSkip').hidden=last;
  $('#tourNext').textContent=last?(setupApiReady()?'Done':'Connect now'):'Next';
}
function tourStart(force){
  if(TOUR_S.open||(!force&&tourSeen()))return false;
  TOUR_S.i=0;TOUR_S.open=true;$('#tourModal').hidden=false;document.body.classList.add('modal-open');tourRender();return true;
}
function tourEnd(openWizard){
  TOUR_S.open=false;$('#tourModal').hidden=true;document.body.classList.remove('modal-open');
  try{localStorage.setItem('tour.seen','1')}catch(_){}
  if(openWizard&&!setupApiReady())openSetup(0);
}
$('#tourNext').onclick=()=>{if(TOUR_S.i===TOUR.length-1)return tourEnd(true);TOUR_S.i++;tourRender()};
$('#tourBack').onclick=()=>{TOUR_S.i--;tourRender()};
$('#tourSkip').onclick=()=>tourEnd(false);
$('#tourModal').addEventListener('click',e=>{const b=e.target.closest('[data-go]');if(!b)return;tourEnd(false);showTab(b.dataset.go)});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&TOUR_S.open){e.stopPropagation();tourEnd(false)}},true);
// Everyone who has not seen the tour gets it once, also when the API is already connected.
srcStatus.then(()=>{if(!tourSeen())tourStart()});
