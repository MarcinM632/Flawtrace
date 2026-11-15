// UI Tests: the form (page, optional login, what to verify) starts a run of the "uitest" agent.
// The password lives only in the request body of this one run: it is not stored in the browser (no localStorage)
// and the server keeps it out of the history, the log and the report.
/* ---------- UI Tests ---------- */
$('#uGo').onclick=async()=>{
  const err=$('#uErr');err.textContent='';
  const url=$('#uPage').value.trim(),goal=$('#uGoal').value.trim();
  if(!url){err.textContent='Enter the address of the page to test.';$('#uPage').focus();return}
  if(goal.length<10){err.textContent='Describe what to verify in a few words (at least 10 characters).';$('#uGoal').focus();return}
  $('#uGo').disabled=true;
  try{
    const m=await post('/api/runs',{agent:'uitest',url,ticket:goal,username:$('#uUser').value,password:$('#uPass').value});
    $('#uPass').value='';   /* the password is not kept in the form after the run starts */
    await open(m.id);
  }catch(e){err.textContent=e.message}
  $('#uGo').disabled=false;
};
$('#uGoal').addEventListener('keydown',e=>{
  if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.isComposing){e.preventDefault();$('#uGo').click()}
});
/* Accept a fully passed run: the server checks it again and starts the TypeScript Playwright test writer. */
async function uiAccept(m){
  const b=$('#uiAccept');if(b)b.disabled=true;
  try{
    const run=await post('/api/runs/'+m.id+'/uitest-accept',{});
    toast('Accepted. The Playwright test is being written.');
    if(typeof setALayer==='function')setALayer('ui');
    showTab('autotest');await open(run.id);refreshAll();
  }catch(e){toast(e.message,'bad');if(b)b.disabled=false}
}
