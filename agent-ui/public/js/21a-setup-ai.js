// Flawtrace: setup wizard, step 1. How Flawtrace reaches an AI. The same choices as Settings > AI provider, but asked
// first, with "found on this machine" next to each tool (from GET /api/llm/detect, which only runs `<tool> --version`).
const SETUP_AI=[
  {id:'claude',prov:'claude-cli',tool:'claude',t:'Claude Code',tag:'Recommended',d:'Your Claude subscription or key, signed in on this machine with Claude Code. Runs every agent in Flawtrace.',miss:'Not found. Install Claude Code and sign in once with <code>claude</code>.'},
  {id:'codex',prov:'acp',preset:'codex',tool:'codex',t:'ChatGPT (through Codex)',d:'Your ChatGPT plan, used through the Codex coding agent. Sign in once with <code>codex login</code>. Runs UI Tests, QA MCP and Execution; the other agents fall back to Claude Code.',miss:'Codex not found. Install it (<code>npm i -g @openai/codex</code>) and sign in.'},
  {id:'acp',prov:'acp',preset:'custom',tool:'npx',t:'Another coding agent',d:'Gemini CLI or any agent that speaks the Agent Client Protocol. You type the command that starts it.',miss:'Needs Node.js (npx).'},
  {id:'api',prov:'anthropic',t:'API key',d:'A key from the Anthropic, OpenAI or Google developer console, billed there. Serves the single-step features; the agents still need Claude Code.'},
  {id:'local',prov:'openai-compatible',t:'Local or other model',d:'Ollama, vLLM, LiteLLM or any OpenAI-compatible address. Single-step features only.'},
  {id:'mcp',t:'I use Claude Desktop or ChatGPT',d:'Flawtrace calls no AI itself. Your assistant starts the tests through the MCP server or the API, on your own subscription.'},
];

async function setupAiStart(){
  const a=SETUP.ai;
  try{a.llm=await api('/api/llm')}catch(e){a.llm=null;a.msg={ok:false,text:e.message}}
  if(a.llm&&a.llm.chosen&&!a.card){
    const v=a.llm;
    a.card=v.selected==='claude-cli'?'claude':v.selected==='acp'?(v.acp&&v.acp.preset==='codex'?'codex':'acp'):v.selected==='openai-compatible'?'local':'api';
  }
  setupAiPaint();
  if(!a.det){
    try{a.det=await api('/api/llm/detect')}catch(_){a.det={}}
    if(SETUP.open&&SETUP.i===0)setupAiPaint();
  }
  setupTicks();
}
// Re-tick the left list after a choice is saved, without redrawing the stage.
function setupTicks(){
  const d=setupDone();
  document.querySelectorAll('#setupSteps li').forEach((li,i)=>li.classList.toggle('done',!!d[i]));
}

function setupAiPaint(){
  const stage=$('#setupStage');
  if(SETUP.i!==0||!stage)return;
  const a=SETUP.ai,det=a.det;
  const cards=SETUP_AI.map(c=>{
    const f=!c.tool||!det?null:!!(det[c.tool]&&det[c.tool].found);
    const st=f===true?`<span class="wz-st ok">Found on this machine${det[c.tool].version?' · '+esc(det[c.tool].version):''}</span>`
      :f===false?`<span class="wz-st bad">${c.miss}</span>`
      :c.tool?'<span class="wz-st">Checking…</span>':'';
    return `<button type="button" class="wz-card ${a.card===c.id?'on':''}" data-wz="${c.id}" aria-pressed="${a.card===c.id}"><span class="wz-t"><b>${c.t}</b>${c.tag?`<span class="tag acc">${c.tag}</span>`:''}</span><span class="wz-d">${c.d}</span>${st}</button>`;
  }).join('');
  stage.innerHTML=`<div class="wz"><p class="setup-kicker">AI connection</p><h3>How should Flawtrace use an AI?</h3>
    <p class="setup-lead"><b>You use your own account or key. Flawtrace never pays for or sees your usage.</b> A Claude.ai or ChatGPT <b>subscription is not an API key</b>: with a plain subscription pick Claude Code, ChatGPT through Codex, or the last option.</p>
    <div class="wz-cards">${cards}</div><div id="wzForm" class="wz-form"></div></div>`;
  setupAiForm();
}

function setupAiForm(){
  const a=SETUP.ai,v=a.llm,box=$('#wzForm');
  if(!box)return;
  const c=SETUP_AI.find(x=>x.id===a.card);
  if(!c){box.innerHTML='';return}
  const m=a.msg?`<span class="st-res"><span class="${a.msg.ok?'ok-t':'bad-t'}">${esc(a.msg.text)}</span></span>`:'';
  if(c.id==='mcp'){
    box.innerHTML=`<p class="st-hint">Add the Flawtrace MCP server to Claude Desktop or Claude Code, or import the OpenAPI spec into a Custom GPT. The exact steps and your key are under <b>Settings &rarr; How to connect</b>.</p>
      <div class="st-actions"><button type="button" class="btn sm" id="wzMcp">Open How to connect</button><button type="button" class="btn sm" id="wzMcpOk">Use this option</button>${m}</div>`;
    return;
  }
  if(!v){box.innerHTML=`<div class="chk bad">${esc(a.msg?a.msg.text:'Could not read the AI settings.')}</div>`;return}
  let f='';
  if(c.id==='api'){
    const ids=['anthropic','openai','gemini'];
    const cur=ids.includes(v.selected)?v.selected:'anthropic';
    const p=v.providers.find(x=>x.id===cur);
    const saved=v.keySet&&v.selected===cur;
    f=`<label>Provider<select id="wzProv">${ids.map(id=>`<option value="${id}" ${id===cur?'selected':''}>${esc(v.providers.find(x=>x.id===id).label)}</option>`).join('')}</select></label>
      <label>Model<input id="wzModel" value="${esc(v.selected===cur?v.model:'')}" placeholder="${esc(p.modelHint)}" autocomplete="off"></label>
      <label>API key ${saved?`<span class="st-hint">saved: ${esc(v.keyHint)}</span>`:''}<input id="wzKey" type="password" placeholder="${saved?'leave empty to keep the saved key':'paste your key'}" autocomplete="off"></label>`;
  }else if(c.id==='local'){
    const on=v.selected==='openai-compatible';
    f=`<label>Address <span class="tag acc">required</span><input id="wzUrl" value="${esc(on?v.baseUrl:'')}" placeholder="http://localhost:11434/v1" autocomplete="off"></label>
      <label>Model<input id="wzModel" value="${esc(on?v.model:'')}" placeholder="model name served at the address" autocomplete="off"></label>
      <label>API key (only if the endpoint needs one)<input id="wzKey" type="password" placeholder="optional" autocomplete="off"></label>`;
  }else if(c.id==='acp'){
    f=`<label>Command that starts the agent in ACP mode<input id="wzCmd" value="${esc(v.acp&&v.acp.preset==='custom'?v.acp.command:'')}" placeholder='"C:/path with spaces/agent" --acp' autocomplete="off"></label>`;
  }else{
    f=`<p class="st-hint">${c.id==='claude'?'Nothing to type. Flawtrace runs the <code>claude</code> command that is signed in on this machine.':'Started with npx the first time it is needed (Node.js and internet for the download). Sign in to Codex once in its own tool.'}</p>`;
  }
  const testable=c.prov!=='acp';
  box.innerHTML=`<div class="st-form">${f}</div>
    <div class="st-actions"><button type="button" class="btn sm" id="wzSave">Save</button>${testable?'<button type="button" class="btn sm" id="wzTest">Save and test</button>':''}${m}</div>
    ${testable?'':'<p class="st-hint">An agent started over ACP cannot be tested here with a single message. Its first real run (for example UI Tests) shows whether it works.</p>'}`;
}

function setupAiBody(){
  const c=SETUP_AI.find(x=>x.id===SETUP.ai.card);
  if(!c)return null;
  const val=id=>{const e=document.getElementById(id);return e?e.value:''};
  return {provider:c.id==='api'?(val('wzProv')||'anthropic'):c.prov,model:val('wzModel'),baseUrl:val('wzUrl'),key:val('wzKey'),acpPreset:c.preset,acpCommand:c.id==='acp'?val('wzCmd'):undefined};
}
async function setupAiSave(){
  const b=setupAiBody();
  if(!b)return false;
  try{SETUP.ai.llm=await post('/api/llm',b);SETUP.ai.msg={ok:true,text:'Saved.'};return true}
  catch(e){SETUP.ai.msg={ok:false,text:e.message};return false}
}

$('#setupStage').addEventListener('click',async e=>{
  if(SETUP.i!==0)return;
  const t=e.target.closest('button');
  if(!t)return;
  const a=SETUP.ai;
  if(t.dataset.wz){a.card=t.dataset.wz;a.msg=null;setupAiPaint();return}
  if(t.id==='wzMcp'){closeSetup();openSettings('connect');return}
  if(t.id==='wzMcpOk'){try{localStorage.setItem('setup.ai.mcp','1')}catch(_){}a.msg={ok:true,text:'Noted. Flawtrace will not call an AI itself.'};setupAiForm();setupTicks();return}
  if(t.id==='wzSave'){await setupAiSave();setupAiForm();setupTicks();return}
  if(t.id==='wzTest'){
    if(!await setupAiSave()){setupAiForm();return}
    a.msg={ok:true,text:'Testing…'};setupAiForm();
    try{const r=await post('/api/llm/test',{});a.msg=r.ok?{ok:true,text:'Works. The AI answered: '+r.text}:{ok:false,text:r.error}}
    catch(err){a.msg={ok:false,text:err.message}}
    setupAiForm();setupTicks();
  }
});
