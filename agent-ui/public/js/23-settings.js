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
const ST={tab:'look',info:null,test:null};
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

function stHelp(){
  return `<p class="st-lead">New here? These re-open the guided parts of the app.</p>
  <div class="st-help">
    <button type="button" class="btn" id="stTour">${ico('play',13)}Replay the welcome tour</button>
    <button type="button" class="btn" id="stSetup2">${ico('play',13)}Open the setup window</button>
    <button type="button" class="btn" id="stGuide">${ico('book',13)}Read the full guide</button>
  </div>`;
}

function stRender(){
  document.querySelectorAll('.st-tabs button').forEach(b=>b.classList.toggle('on',b.dataset.st===ST.tab));
  $('#stBody').innerHTML=ST.tab==='look'?stLook():ST.tab==='connect'?stConnect():stHelp();
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
document.querySelector('.st-tabs').addEventListener('click',e=>{const b=e.target.closest('button[data-st]');if(b){ST.tab=b.dataset.st;stRender()}});
async function copyText(t,btn){
  const o=btn.textContent;
  try{await navigator.clipboard.writeText(t);btn.textContent='Copied'}catch(_){btn.textContent='Select and copy by hand'}
  setTimeout(()=>{btn.textContent=o},1400);
}
$('#stBody').addEventListener('click',async e=>{
  const t=e.target.closest('button');if(!t)return;
  if(t.dataset.themePick){applyTheme(t.dataset.themePick);stRender()}
  else if(t.hasAttribute('data-copy'))copyText(t.parentElement.querySelector('pre').textContent,t);
  else if(t.hasAttribute('data-copy-key'))copyText(ST.info.key,t);
  else if(t.id==='stKeyShow'){const c=$('#stKey');const hid=c.textContent.startsWith('•');c.textContent=hid?c.dataset.key:'•'.repeat(24);t.textContent=hid?'Hide':'Show'}
  else if(t.id==='stOpenSetup'||t.id==='stSetup2'){closeSettings();openSetup(0)}
  else if(t.id==='stGuide'){closeSettings();$('#srcGuide').click()}
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
const TOUR=[
  {t:'Welcome to Flawtrace',p:'Flawtrace is a workbench for testers. AI agents read your tickets, specifications and code, design tests, run them on your test environment and write the reports. This short tour shows where things are.'},
  {t:'Find your way around',p:'The left menu groups the work: <b>Agents</b> run analyses, QA MCP checks and UI tests; <b>Metrics</b> tracks bugs, risk and releases; <b>Reference</b> holds testing guides. Every page has a one-line description under its title.'},
  {t:'Your first test',p:'Open <b>UI Tests</b> to check a web page, or <b>QA MCP</b> to test the API: write in a sentence what to check and press Run. Watch the agent work, then read the report. Nothing runs until you press the button.'},
  {t:'Connect your product first',p:'To run tests, Flawtrace needs the address of your test environment API. The setup window guides you step by step; Jira, Confluence and repositories are optional extras that make the agents more accurate.'},
  {t:'Settings are always at hand',p:'The gear at the bottom of the menu opens <b>Settings</b>: light or dark theme, a step-by-step <b>How to connect</b> (including Claude and ChatGPT) and this tour again whenever you want it.'},
];
const TOUR_S={i:0,open:false};
const tourSeen=()=>{try{return !!localStorage.getItem('tour.seen')}catch(_){return false}};
function tourRender(){
  const s=TOUR[TOUR_S.i],last=TOUR_S.i===TOUR.length-1;
  $('#tourTitle').textContent=s.t;$('#tourText').innerHTML=s.p;
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
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&TOUR_S.open){e.stopPropagation();tourEnd(false)}},true);
// Everyone who has not seen the tour gets it once, also when the API is already connected.
srcStatus.then(()=>{if(!tourSeen())tourStart()});
