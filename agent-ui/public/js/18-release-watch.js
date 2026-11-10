// QA Agents UI: release watch. Klasyczny skrypt: wszystkie pliki z js/ dzielą jeden zakres globalny i ładują się po kolei.
/* Pasek na górze (każda zakładka): nowe taski wykryte w bieżącym wydaniu (lib/release-watch.js, serwer
   odpytuje Jirę co godzinę). Każdy taki task ma już uruchomiony test statyczny (domyślny tryb agenta,
   bramka domain-rules) — klik otwiera ten run. "Dismiss" oznacza WSZYSTKIE jako przeczytane (ack), nie
   usuwa z historii — pełna lista zostaje widoczna po ponownym otwarciu paska. */
let RW_ITEMS=[],RW_UNREAD=0,rwTimer=null;

async function loadReleaseWatch(){
  let d; try{d=await api('/api/release-watch')}catch(e){return}
  RW_ITEMS=d.notifications||[]; RW_UNREAD=d.unread||0;
  renderReleaseWatch();
  clearTimeout(rwTimer); rwTimer=setTimeout(loadReleaseWatch,60000);
}

function rwAgo(ts){const m=Math.max(0,Math.round((Date.now()-ts)/60000));return m<1?'just now':m<60?m+' min ago':Math.round(m/60)+' h ago'}

function renderReleaseWatch(){
  const el=$('#relwatch'); if(!el)return;
  if(!RW_UNREAD||!RW_ITEMS.length){el.hidden=true;return}
  const unread=RW_ITEMS.filter(n=>!n.read).slice(0,8);
  el.hidden=false;
  el.innerHTML=`<div class="rw-h">${ico('inbox',14)} <b>${RW_UNREAD} new task${RW_UNREAD===1?'':'s'}</b> in the current release — static test ${RW_UNREAD===1?'has':'have'} already started <button class="linkbtn" id="rwDismiss" style="float:right">Dismiss</button></div>`+
    unread.map(n=>`<button class="rw-row" data-rwopen="${esc(n.runId||'')}" data-rwagent="${esc(n.agent||'')}">
      <span class="pill">${esc(n.project)}</span>
      <span class="mono">${esc(n.key)}</span>
      <span class="rw-sum">${esc(n.summary||'')}</span>
      <span class="rw-ago">${rwAgo(n.detectedAt)}</span>
    </button>`).join('');
  $('#rwDismiss').onclick=async(e)=>{e.stopPropagation();try{await api('/api/release-watch/ack',{method:'POST'})}catch(_){}loadReleaseWatch()};
  el.querySelectorAll('[data-rwopen]').forEach(b=>b.onclick=()=>{
    const id=b.dataset.rwopen,agent=b.dataset.rwagent;
    if(!id){return}
    showTab(TAB_OF(agent));open(id);
  });
}

loadReleaseWatch();
