/* A page being read keeps its place (app.js renderScreen · docs-view.js draw · flowview.js · folderui.js adoptChanges).
 *
 * Karol, 2026-10-15: "I scroll down to read, and the page jumps back to the top by itself." The project was
 * kept inside the Mendix project (mxscout/), an agent writing into it. Every two seconds MxScout looks at the
 * folder; a file there that was only touched, or written again with what this browser already holds, drew
 * the whole app again — and the documentation's page, whose own box scrolls, carried no key to come back to.
 * What has to hold: nothing an agent did that changes nothing on screen draws the app; a change that does
 * draw it leaves the reader where they were; a render on purpose keeps the place of every screen's own
 * scrolling box — Overview, Processes, an Assist item, a solved case, Security, Settings, the Microflows
 * screen, the Entities screen, Comments and Performance; and another page, or another item, still starts
 * at the top. */
'use strict';
const fs = require('fs');
const path = require('path');
const { goToSection } = require('./helpers');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxAssist', 15000, 'MxScout loaded');
  await mx.viewport(1280, 420);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = (expr, what, ms) => mx.waitFor(expr, ms || 12000, what);
  const mprB64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const A = 'a'.repeat(40);

  // ---- a Mendix project in the Origin Private File System, MxScout's files kept in its mxscout/ ----
  await mx.evaluate(`(async function () {
    var root = await navigator.storage.getDirectory();
    var names = [];
    for (var it = root.keys(), r = await it.next(); !r.done; r = await it.next()) names.push(r.value);
    for (var i = 0; i < names.length; i++) await root.removeEntry(names[i], { recursive: true });
    async function dir(p) { var d = root; var parts = p.split('/'); for (var j = 0; j < parts.length; j++) d = await d.getDirectoryHandle(parts[j], { create: true }); return d; }
    window.__write = async function (p, data) { var parts = p.split('/'), name = parts.pop(); var d = await dir(parts.join('/')); var w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(data); await w.close(); return true; };
    window.__read = async function (p) { try { var parts = p.split('/'), name = parts.pop(); var d = await dir(parts.join('/')); return await (await (await d.getFileHandle(name)).getFile()).text(); } catch (e) { return null; } };
    var bin = atob(${JSON.stringify(mprB64)}), u8 = new Uint8Array(bin.length); for (var k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
    await window.__write('ScrollApp/ScrollApp.mpr', u8);
    await window.__write('ScrollApp/.git/HEAD', 'ref: refs/heads/main\\n');
    await window.__write('ScrollApp/.git/refs/heads/main', '${A}\\n');
    window.showDirectoryPicker = function () { return dir('ScrollApp'); };
    return true;
  })()`);
  const read = (p) => mx.evaluate(`window.__read(${JSON.stringify(p)})`);
  const write = (p, text) => mx.evaluate(`window.__write(${JSON.stringify(p)}, ${JSON.stringify(text)})`);
  await mx.evaluate(`(function(){ var b = Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'All projects'); if (b) b.click(); return true; })()`);
  await until(`!!document.querySelector('.sidebar-new')`, 'list screen');
  await mx.evaluate(`document.querySelector('.sidebar-new').click()`);
  await until(`!!document.querySelector('.store-opt[data-mode="repo"].on')`, 'the Mendix project option');
  await mx.evaluate(`document.querySelector('.folder-pick').click()`);
  await until(`!!document.querySelector('.repo-ready')`, 'the ready step');
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Import').click()`);
  const id = await until(`MxStore.getAll('projects').then(function (rows) { var r = rows.find(function (x) { var i = MxStore.folderInfo(x.id); return x.name === 'ScrollApp' && i && i.layout === 2; }); return r ? r.id : false; })`, 'the project, kept in the Mendix project', 30000);

  // Security and Comments are Developer tools: turned on, on the project's Settings, as a person would.
  await goToSection(mx, 'Settings', '.dev-tools-box');
  await mx.evaluate(`(function(){ var b = document.querySelector('.dev-tools-box'); if (!b.checked) b.click(); return true; })()`);
  await until(`!!Array.from(document.querySelectorAll('.tree-section')).find(function (n) { return /^Security/.test(n.textContent.trim()); })`, 'Developer tools on');

  // ---- long pages: descriptions from the inbox, Assist items ----
  const long = (s, n) => Array.from({ length: n || 30 }, (_, i) => s + ' ' + i + '.').join(' ');
  const fmt = await mx.evaluate('MxDescribe.FORMAT');
  const desc = { format: fmt, version: 1, project: 'ScrollApp', language: 'en', by: 'test agent', written: '2026-10-15',
    app: { summary: 'Takes orders.', story: long('A long story about the orders, told at length'), audience: [{ who: 'Clerks', what: 'enter orders' }],
      processes: Array.from({ length: 12 }, (_, i) => ({ name: 'Process ' + i, summary: long('What process ' + i + ' does', 20), steps: ['One', 'Two', 'Three', 'Four', 'Five'], flows: ['Sales.CreateOrder'] })) },
    modules: { Sales: { summary: 'Sales holds the orders.', story: long('The module story') } },
    microflows: { 'Sales.CreateOrder': 'Creates an order.' } };
  await write('ScrollApp/mxscout/.local/inbox/first.json', JSON.stringify(desc));
  await sleep(1100);
  await mx.evaluate('MxDocs.folderTick()');
  await until(`MxStore.get('descriptions', ${JSON.stringify(id)}).then(function (r) { return !!(r && r.value && r.value.app); })`, 'descriptions taken');
  const story = Array.from({ length: 14 }, (_, i) => long('Paragraph ' + i + ' of what the model shows', 8)).join('\n\n');
  const item = (n) => ({ id: 'SD-' + n, kind: 'ticket', title: 'Ticket number ' + n, verdict: 'bug', confidence: 'high', summary: 'Confirmed.', story: story, reported: 'It breaks.', needs: [] });
  await mx.evaluate(`MxAssist.apply(${JSON.stringify(id)}, ${JSON.stringify(JSON.stringify({ format: 'mxscout-assist', version: 1, items: [item(1), item(2)] }))}).then(function () { return true; })`);
  const note = (n) => ['---', 'id: "SD-' + n + '"', 'kind: "ticket"', 'title: "Solved number ' + n + '"', 'status: "solved"', 'solved: "2026-10-15"', 'model: "' + A + '"',
    'flows: ["Sales.CreateOrder"]', 'entities: []', 'pages: []', 'keywords: ["order"]', 'related: []', 'language: "en"', '---', '', '# SD-' + n + ' — Solved number ' + n, '',
    '## Problem', '', long('The problem, described', 40), '', '## Cause', '', long('The cause, described', 40), '', '## Solution', '', '- ' + long('Do this', 20), '',
    '## What did not work', '', long('Tried that', 30), '', '## How to recognise it next time', '', long('Look for this', 30), ''].join('\n');

  // How often the app was drawn, and a place to stand: the box a screen reads in, scrolled.
  await mx.evaluate(`(function () { window.__draws = 0; new MutationObserver(function (m) { m.forEach(function (x) { if (x.removedNodes.length) window.__draws++; }); }).observe(document.getElementById('app'), { childList: true }); return true; })()`);
  const draws = () => mx.evaluate('window.__draws');
  const scrollTo = (sel, y) => mx.evaluate(`(function () { var n = document.querySelector(${JSON.stringify(sel)}); if (!n) return -1; void n.offsetHeight; n.scrollTop = ${y}; return n.scrollTop; })()`);
  const topOf = (sel) => mx.evaluate(`(function () { var n = document.querySelector(${JSON.stringify(sel)}); return n ? n.scrollTop : -1; })()`);
  const settle = () => mx.evaluate(`new Promise(function (res) { requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(function () { res(true); }, 60); }); }); })`);
  // The project menu opened and closed: two renders of the whole app, as any button on a screen makes one.
  const redraw = async () => {
    const n = await draws();
    await mx.evaluate(`document.querySelector('.xe-head .xe-icon-btn').click()`);
    await until(`!!document.querySelector('.xe-menu')`, 'the menu open');
    await mx.evaluate(`document.querySelector('.xe-head .xe-icon-btn').click()`);
    await until(`!document.querySelector('.xe-menu')`, 'the menu closed');
    await settle();
    return (await draws()) - n;
  };

  // ---- Overview: an agent writing into the folder, and nothing on screen changing ----
  const MAIN = '.dm-host .dx-main';
  await goToSection(mx, 'Overview', MAIN, 20000);
  await sleep(10000); // the message the inbox's file left behind goes away on its own after 9 s
  const y0 = await scrollTo(MAIN, 600);
  t.ok(y0 === 600, 'the Overview reads in its own box, scrolled down to 600: ' + y0);
  const d0 = await draws();
  await write('ScrollApp/mxscout/descriptions/app.json', await read('ScrollApp/mxscout/descriptions/app.json'));
  await write('ScrollApp/mxscout/mxscout.json', await read('ScrollApp/mxscout/mxscout.json'));
  await sleep(6500); // three of the folder's ticks
  const quiet = { draws: (await draws()) - d0, top: await topOf(MAIN) };
  t.ok(quiet.draws === 0 && quiet.top === 600,
    'descriptions/ and mxscout.json written again as they were, over three ticks, draw nothing — the page stays at 600: ' + JSON.stringify(quiet));

  // MxScout's own writes (an Assist item changed here goes to .local/assist/) are not someone else's change:
  // the change itself draws the app once, and the folder's ticks after it nothing more.
  await mx.evaluate(`MxAssist.set(${JSON.stringify(id)}, 'ticket', 'SD-2', { planned: '2026-11-20' }, 'person').then(function () { return true; })`);
  await until(`window.__read('ScrollApp/mxscout/.local/assist/tickets/SD-2.json').then(function (x) { return !!x && x.indexOf('2026-11-20') !== -1; })`, 'the item written to .local/assist/');
  await settle();
  const d1 = await draws();
  await sleep(4500);
  const own = { draws: (await draws()) - d1, top: await topOf(MAIN) };
  t.ok(own.draws === 0 && own.top === 600, 'what MxScout writes into the folder itself does not come back as a change: nothing drawn, the page at 600: ' + JSON.stringify(own));

  // A real change does draw the app — and the page is still where the reader left it.
  const d2 = await draws();
  const sales = JSON.parse(await read('ScrollApp/mxscout/descriptions/modules/Sales.json'));
  sales.summary.text = 'Sales holds the orders, and now says so differently.';
  await write('ScrollApp/mxscout/descriptions/modules/Sales.json', JSON.stringify(sales, null, 2) + '\n');
  await until(`MxStore.get('descriptions', ${JSON.stringify(id)}).then(function (r) { return !!(r && JSON.stringify(r.value).indexOf('says so differently') !== -1); })`, 'the agent’s change taken in');
  await settle();
  const real = { draws: (await draws()) - d2, top: await topOf(MAIN) };
  t.ok(real.draws >= 1 && real.top === 600, 'an agent’s real change to descriptions/ draws the app again, and the Overview stays at 600: ' + JSON.stringify(real));
  await sleep(9500); // its message, with Undo, goes away on its own — another render
  const gone = await topOf(MAIN);
  t.ok(gone === 600, 'and the message going away on its own leaves it there too: ' + gone);

  // Solved cases the agent leaves in knowledge/: taken in, the reader on the Overview not moved.
  await write('ScrollApp/mxscout/knowledge/SD-7-solved-number-7.md', note(7));
  await write('ScrollApp/mxscout/knowledge/SD-8-solved-number-8.md', note(8));
  await until(`!!MxKnowledge.peek(${JSON.stringify(id)}) && MxKnowledge.peek(${JSON.stringify(id)}).length === 2`, 'the cases taken in', 15000);
  await settle();
  const cases = await topOf(MAIN);
  t.ok(cases === 600, 'two solved cases written into knowledge/ are taken in, and the Overview stays at 600: ' + cases);
  // Their message, with Undo, goes away on its own after 9 s — another render, and every screen's box taller by
  // its height. Left up, it went away in the middle of whichever screen below was being measured on a slow run,
  // and a box scrolled near its bottom (the wide Entities panel, 68 of 69) came back at the new bottom, 27.
  await until(`!document.querySelector('.msg.ok')`, 'the cases’ message gone', 15000);
  await settle();

  // Comments enough to scroll (Developer tools).
  await mx.evaluate(`(async function () {
    var now = new Date().toISOString();
    for (var i = 0; i < 14; i++) await MxStore.put('findings', { id: 'scroll-' + i, projectId: ${JSON.stringify(id)}, role: null, severity: 'medium', change: '', status: 'open', author: 'Karol', history: [], createdAt: now, updatedAt: now,
      problem: 'Comment number ' + i + ' on the order, long enough to take a few lines of the list.', target: { kind: 'microflow', qualifiedName: 'Sales.CreateOrder', module: 'Sales', name: 'CreateOrder' } });
    await MxComments.loadFindings(${JSON.stringify(id)});
    return true;
  })()`);

  // ---- a render on purpose keeps every screen's own box where it was ----
  const PAGE = '.xe-pagescreen .xe-page';
  const screens = [
    ['Overview', MAIN, MAIN],
    ['Processes', MAIN, MAIN],
    ['Assist', MAIN, MAIN, 'SD-1'],
    ['Solved cases', MAIN, MAIN, 'SD-7'],
    ['Security', PAGE, PAGE],
    ['Settings', PAGE, PAGE],
    ['Microflows', '.mf-mods, .mf-detail', '.mf-body', 'Sales.CreateOrder'],
    ['Entities', '.dx-dm', '.dx-dm'],
    ['Comments', PAGE, PAGE],
    ['Performance', PAGE, PAGE]
  ];
  const keeps = async (screens, how) => { for (const [name, ready, box, pick] of screens) {
    await goToSection(mx, name, ready, 20000);
    if (pick && name === 'Entities') {
      await mx.evaluate(`Array.from(document.querySelectorAll('.dx-dm-box')).find(function (b) { return b.title === ${JSON.stringify(pick)}; }).click()`);
      await until(`!!document.querySelector('.dx-dm-box.on')`, pick + ' picked');
    } else if (pick && name === 'Microflows') {
      await mx.evaluate(`MxMicroflows.select(${JSON.stringify(pick)})`);
      await until(`!!document.querySelector('.mf-detail')`, pick + ' open');
      await settle();
    } else if (pick) {
      await mx.evaluate(`Array.from(document.querySelectorAll('.dx-pl-item')).find(function (b) { return b.textContent.indexOf(${JSON.stringify(pick)}) !== -1; }).click()`);
      await until(`!!document.querySelector('.dx-pl-item.on') && document.querySelector('.dx-pl-item.on').textContent.indexOf(${JSON.stringify(pick)}) !== -1`, pick + ' open');
    }
    await settle();
    const room = await mx.evaluate(`(function () { var n = document.querySelector(${JSON.stringify(box)}); return n ? n.scrollHeight - n.clientHeight : -1; })()`);
    const want = Math.min(250, room - 1);
    const at = await scrollTo(box, want);
    const n = await redraw();
    const after = await topOf(box);
    t.ok(room > 10 && at === want && n >= 2 && after === want, how + name + (pick ? ' (' + pick + ')' : '') + ': drawn again ' + n + ' times, its box (' + box + ') stays at ' + want + ': ' + after);
  } };
  await keeps(screens, '');
  // Wide, the flow's panel and the entity's panel scroll on their own beside the drawing.
  await mx.viewport(1920, 360);
  await keeps([['Microflows', '.mf-mods, .mf-detail', '.mf-panel.mf-step', 'Sales.CreateOrder'], ['Entities', '.dx-dm-insp', '.dx-dm-insp', 'Sales.Order']], 'wide, ');
  await mx.viewport(1280, 420);

  // Another flow starts at its top.
  await goToSection(mx, 'Microflows', '.mf-mods, .mf-detail');
  await mx.evaluate(`MxMicroflows.select('Sales.CreateOrder')`);
  await until(`!!document.querySelector('.mf-detail')`, 'CreateOrder open');
  await settle();
  await scrollTo('.mf-body', 250);
  await mx.evaluate(`MxMicroflows.select('Sales.SweepOrders')`);
  await until(`/SweepOrders/.test(document.querySelector('.mf-detail').getAttribute('aria-label'))`, 'SweepOrders open');
  await settle();
  const flow = await topOf('.mf-body');
  t.ok(flow === 0, 'another microflow opens at its top: ' + flow);

  // ---- another item, another page: the top ----
  await goToSection(mx, 'Assist', MAIN);
  const open = async (pick) => {
    await mx.evaluate(`Array.from(document.querySelectorAll('.dx-pl-item')).find(function (b) { return b.textContent.indexOf(${JSON.stringify(pick)}) !== -1; }).click()`);
    await until(`!!document.querySelector('.dx-pl-item.on') && document.querySelector('.dx-pl-item.on').textContent.indexOf(${JSON.stringify(pick)}) !== -1`, pick + ' open');
    await settle();
  };
  await open('SD-1');
  await scrollTo(MAIN, 300);
  await open('SD-2');
  const other = await topOf(MAIN);
  t.ok(other === 0, 'another Assist item opens at its top: ' + other);
  await scrollTo(MAIN, 300);
  await goToSection(mx, 'Overview', MAIN);
  await settle();
  const page = await topOf(MAIN);
  t.ok(page === 0, 'and another page does too: ' + page);
  await mx.viewport(1440, 900);
};
