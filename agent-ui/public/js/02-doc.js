// QA Agents UI: doc. Klasyczny skrypt: wszystkie pliki z js/ dzielą jeden zakres globalny i ładują się po kolei (kolejność jest istotna).
/* ---------- doc: clicking a tree node opens its card ---------- */
const onTreeClick=e=>{
  const n=e.target.closest('.node'); if(!n)return;
  const card=document.getElementById(n.dataset.go); if(!card)return;
  n.closest('.tree').querySelectorAll('.node.on').forEach(x=>x.classList.remove('on'));
  n.classList.add('on');
  document.querySelectorAll('.flash').forEach(x=>x.classList.remove('flash'));
  card.classList.add('flash');
  card.scrollIntoView({behavior:'smooth',block:'center'});
  setTimeout(()=>card.classList.remove('flash'),2200);
};
$('#tree').onclick=onTreeClick;
$('#treeAi').onclick=onTreeClick;
$('#treeAuto').onclick=onTreeClick;

/* ---------- doc: scale a tree down so it always fits its card, and keep the
   anchor offset in step with the sticky header + chip bar (both can change
   height when the window is resized or the chips wrap) ---------- */
/* The tree is scaled down until it fits the panel. Two things the height has to allow for, or the
   bottom row is clipped by overflow-y:hidden — box-sizing is border-box, so the height carries the
   padding as well as the content, and a horizontal scrollbar sits inside that same box.
   A transform does not change layout size, so once the scaled tree fits we turn the scrollbar off
   rather than leave the browser offering to scroll content that is already fully visible. */
function fitTrees(){
  document.querySelectorAll('.tree').forEach(t=>{
    const ul=t.querySelector(':scope>ul'); if(!ul)return;
    ul.style.transform=''; t.style.height=''; t.style.overflowX='';
    const avail=t.clientWidth, w=ul.scrollWidth;
    if(!avail||w<=avail+1)return;

    const s=Math.max(avail/w,.62);
    ul.style.transform='scale('+s+')';

    const fits=w*s<=avail+1;
    t.style.overflowX=fits?'hidden':'auto';
    const scrollbar=fits?0:Math.max(t.offsetHeight-t.clientHeight,14);
    const cs=getComputedStyle(t);
    const padding=parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom);
    t.style.height=Math.ceil(ul.offsetHeight*s+padding+scrollbar)+'px';
  });
}
function stickyOffset(){
  const h=document.querySelector('header.topbar').offsetHeight;
  document.documentElement.style.setProperty('--header-h',(h+8)+'px');
  const c=document.querySelector('main:not([hidden]) .navchips');
  document.documentElement.style.setProperty('--sticky-h',(h+(c?c.offsetHeight+8:0)+20)+'px');
}
function relayoutDoc(){ stickyOffset(); fitTrees(); }
let rzT; addEventListener('resize',()=>{clearTimeout(rzT);rzT=setTimeout(()=>{relayoutDoc();if(bugs.length)renderRisk()},120)});
addEventListener('load',relayoutDoc);
