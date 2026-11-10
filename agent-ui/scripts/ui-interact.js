// Test interakcji: steruje headless Edge przez DevTools Protocol, klika w interfejs i sprawdza skutki (bez kosztownych akcji:
// niczego nie uruchamia). Serwer musi działać na PORT (domyślnie 4317).   node scripts/ui-interact.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
if (!EDGE) { console.error('Edge not found'); process.exit(2); }
const URL_BASE = 'http://localhost:' + (process.env.PORT || 4317) + '/';
const DBG = 9333 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-ui-edge-'));
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--window-size=1500,1000', `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let ws; const results = []; const pageErrors = [];
  const finish = (code) => { try { ws && ws.close(); } catch (_) { /* zamknięte */ } edge.kill(); setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) { /* tymczasowe */ } process.exit(code); }, 500); };
  try {
    let targets;
    for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); if (targets.length) break; } catch (_) { /* jeszcze startuje */ } await sleep(250); }
    const page = targets.find((t) => t.type === 'page');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0; const pending = new Map();
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
      if (d.method === 'Runtime.exceptionThrown') pageErrors.push(d.params.exceptionDetails.exception ? d.params.exceptionDetails.exception.description : d.params.exceptionDetails.text);
    };
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error('eval: ' + (r.result.exceptionDetails.exception || {}).description); return r.result.result.value; };
    const until = async (expr, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch (_) { /* jeszcze nie ma */ } await sleep(200); } return false; };
    const check = (name, ok, extra) => { results.push(ok); console.log((ok ? 'OK   ' : 'FAIL ') + name + (ok || !extra ? '' : '  -> ' + extra)); };

    await send('Runtime.enable'); await send('Page.enable');
    await send('Page.navigate', { url: URL_BASE });
    check('app boots and connects to the server', await until("document.querySelector('#connTxt') && /connected/i.test(document.querySelector('#connTxt').textContent)"));

    // navigation through every tab
    const tabs = await ev("[...document.querySelectorAll('.nav [data-tab]')].map(b=>b.dataset.tab)");
    for (const t of tabs) {
      await ev(`document.querySelector('.nav [data-tab="${t}"]').click()`);
      const shown = await until(`!document.querySelector('#view-${t}').hidden && [...document.querySelectorAll('main')].filter(m=>!m.hidden).length===1`, 5000);
      check('tab "' + t + '" opens alone', shown);
    }

    // Test suite: list, selection, filters, editor
    await ev("document.querySelector('.nav [data-tab=suite]').click()");
    check('suite: tests are listed', await until("/of (\\d+)/.test(document.querySelector('#suCount').textContent) && document.querySelectorAll('#suTree .su-t').length>0"));
    const total = await ev("Number((document.querySelector('#suCount').textContent.match(/of (\\d+)/)||[])[1])");
    check('suite: nothing selected at the start, Run disabled', await ev("/^0 selected/.test(document.querySelector('#suCount').textContent) && document.querySelector('#suGo').disabled"));
    await ev("document.querySelector('#suTree .su-t .su-cb').click()");
    check('suite: ticking one test selects it and enables Run', await ev("/^1 selected/.test(document.querySelector('#suCount').textContent) && !document.querySelector('#suGo').disabled"));
    await ev("document.querySelector('#suTree .su-fh .su-cb').click()");
    check('suite: folder checkbox selects everything inside it', await ev("Number(document.querySelector('#suCount').textContent.match(/^(\\d+)/)[1])>1"));
    await ev("document.querySelector('#suNone').click()");
    check('suite: Clear empties the selection', await ev("/^0 selected/.test(document.querySelector('#suCount').textContent)"));
    await ev("document.querySelector('#suAll').click()");
    check('suite: Select shown selects all ' + total, await ev(`new RegExp('^${total} selected').test(document.querySelector('#suCount').textContent)`));
    await ev("document.querySelector('#suNone').click()");
    await ev("(()=>{const q=document.querySelector('#suQ');q.value='balance';q.dispatchEvent(new Event('input'))})()");
    check('suite: search narrows the list (debounced)', await until(`Number((document.querySelector('#suCount').textContent.match(/· (\\d+) of/)||[])[1])<${total}`, 3000));
    await ev("(()=>{const q=document.querySelector('#suQ');q.value='';q.dispatchEvent(new Event('input'))})()");
    await until(`Number((document.querySelector('#suCount').textContent.match(/· (\\d+) of/)||[])[1])===${total}`, 3000);
    await ev("(()=>{const s=document.querySelector('#suMarker');s.value='SMOKE';s.dispatchEvent(new Event('change'))})()");
    check('suite: marker filter works', await until(`Number((document.querySelector('#suCount').textContent.match(/· (\\d+) of/)||[])[1])<${total}`, 3000));
    await ev("(()=>{const s=document.querySelector('#suMarker');s.value='';s.dispatchEvent(new Event('change'))})()");
    await ev("document.querySelector('#suTree [data-edit]').click()");
    check('suite: Edit opens the file in the editor', await until("document.querySelector('#suEd') && document.querySelector('#suEd').value.length>50", 5000));
    await ev("document.querySelector('#suEdCancel').click()");
    check('suite: editor closes back to the results', await until("!document.querySelector('#suEd')", 3000));

    // QA MCP form
    await ev("document.querySelector('.nav [data-tab=qamcp]').click()");
    check('qamcp: tools selector offers Auto and All', await ev("[...document.querySelectorAll('#qScope option')].map(o=>o.value).join()==='auto,all'"));

    // Bug registry search + risk
    await ev("document.querySelector('.nav [data-tab=bugs]').click()");
    check('bugs: list renders', await until("document.querySelectorAll('#bugList > *').length>0", 8000));
    const all = await ev("document.querySelectorAll('#bugList > *').length");
    await ev("(()=>{const q=document.querySelector('#fQuery');q.value='zzzz-no-such-bug';q.dispatchEvent(new Event('input'))})()");
    check('bugs: search filters the list (debounced)', await until(`document.querySelectorAll('#bugList > .bug, #bugList > article, #bugList > div').length!==${all} || /No|0 /.test(document.querySelector('#bugList').textContent)`, 3000));
    await ev("(()=>{const q=document.querySelector('#fQuery');q.value='';q.dispatchEvent(new Event('input'))})()");
    await ev("document.querySelector('.nav [data-tab=risk]').click()");
    check('risk: charts render', await until("document.querySelectorAll('#view-risk svg').length>0", 8000));

    // Pasek statusu runów jest na każdej z trzech zakładek; okienko komentarza otwiera się przed Create autotests i się zamyka.
    await ev("(()=>{RUNS=[{id:'t1',agent:'qamcp',label:'QA MCP',ticket:'status strip probe',status:'running',startedAt:Date.now()-5000,finishedAt:null}];})()");
    for (const tab of ['runs', 'qamcp', 'autotest']) {
      await ev(`document.querySelector('.nav [data-tab=${tab}]').click()`);
      check('status strip shows the running run on ' + tab, await until("(()=>{renderPipe();const p=document.querySelector('#pipe');return !p.hidden&&/status strip probe/.test(p.textContent)&&/Running/.test(p.textContent)})()", 3000));
    }
    await ev("document.querySelector('.nav [data-tab=suite]').click()");
    check('status strip is hidden outside the run tabs', await until("document.querySelector('#pipe').hidden", 3000));
    await ev("(()=>{askComment({id:'t1'})})()");
    check('comment dialog opens', await until("!document.querySelector('#cmtModal').hidden&&document.activeElement.id==='cmtText'", 2000));
    await ev("document.querySelector('#cmtCancel').click()");
    check('comment dialog closes on Cancel', await until("document.querySelector('#cmtModal').hidden", 2000));
    await ev("(()=>{RUNS=[];renderPipe()})()");

    // Tools: serwisy z endpointami, wejście w serwis rozwija listę, wejście w endpoint pokazuje parametry, szukajka filtruje.
    await ev("document.querySelector('.nav [data-tab=tools]').click()");
    check('tools: services are listed', await until("document.querySelectorAll('#tlList .tl-gh').length>=30", 15000));
    check('tools: reinitialize button is present', await until("!!document.querySelector('#tlFull')&&/Reinitialize/.test(document.querySelector('#tlFull').textContent)", 2000));
    await ev("document.querySelector('#tlList .tl-gh').click()");
    check('tools: opening a service lists its endpoints', await until("document.querySelectorAll('#tlList .tl-eh').length>0", 3000));
    await ev("document.querySelector('#tlList .tl-eh').click()");
    check('tools: opening an endpoint shows its parameters', await until("!!document.querySelector('#tlList .tl-det')", 3000));
    await ev("(()=>{const q=document.querySelector('#tlQ');q.value='zzzz-no-such-tool';q.dispatchEvent(new Event('input'))})()");
    check('tools: search with no match says so', await until("/No endpoint matches/.test(document.querySelector('#tlList').textContent)", 3000));
    await ev("(()=>{const q=document.querySelector('#tlQ');q.value='';q.dispatchEvent(new Event('input'))})()");

    check('no uncaught JavaScript errors during the whole session', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  } catch (e) {
    console.log('FAIL harness: ' + e.message); results.push(false);
  }
  const bad = results.filter((x) => !x).length;
  console.log(bad ? `\n${bad} check(s) failed` : `\nall ${results.length} checks passed`);
  finish(bad ? 1 : 0);
}
main();
