/* Two tabs of MxScout on one project (an external audit, 2026-10-15, B05). Each tab used to keep its own copy
 * of a project's Assist items, solved cases and descriptions, change THAT copy and write it back whole — so
 * the second tab's save quietly undid the first one's. Reproduced in two real tabs: both read an empty
 * project, tab A added "one", tab B added "two", and the database held only "two".
 *
 * What has to hold, in two real tabs of one browser:
 *  - every change is made on the record as the database holds it now (store.js update — one transaction, a
 *    revision number): tab A adds one item, tab B adds two, all three are kept; the same for solved cases, and
 *    for descriptions an agent hands to each tab;
 *  - the other tab hears of it (a BroadcastChannel of this origin) and draws what is kept now;
 *  - the same item moved in both tabs: a click that would undo what the other tab did is refused and says
 *    what it is now; one that changes something else is made on top of it, so both changes stay;
 *  - Undo never takes back what another tab saved since;
 *  - Developer tools: a risk decided in each tab at once keeps both decisions, and one comment moved in both tabs at
 *    once is never silently written over — the second save is refused and says so. */
'use strict';
const { goToDocsTab } = require('./helpers');
const MODEL = require('./model');

module.exports = async function (t) {
  const a = await t.tab(t.MX);
  await a.waitFor('!!window.MxStore && !!window.MxAssist && !!window.MxKnowledge', 15000, 'tab A loaded');
  await a.evaluate(`(async function () {
    var now = new Date().toISOString();
    await MxStore.saveProjectWithModel({ id: 'two', name: 'TwoTabs', createdAt: now, updatedAt: now, source: { kind: 'test' }, bytes: 1, summary: null }, ${JSON.stringify(MODEL)});
    return true;
  })()`);
  const b = await t.tab(t.MX);
  await b.waitFor('!!window.MxStore && !!window.MxAssist && !!window.MxKnowledge', 15000, 'tab B loaded');
  const env = (items) => JSON.stringify({ format: 'mxscout-assist', version: 1, items: items });
  const item = (id, title) => ({ id: id, kind: 'other', title: title });

  // ---- both tabs read the project's items: none ----
  t.ok(await a.evaluate(`MxAssist.list('two').then(function (l) { return l.length === 0; })`) && await b.evaluate(`MxAssist.list('two').then(function (l) { return l.length === 0; })`),
    'both tabs have read the project: no Assist items');

  // ---- A adds one, B — without reading again — adds two ----
  await a.evaluate(`MxAssist.apply('two', ${JSON.stringify(env([item('one', 'Added in tab A')]))}).then(function () { return true; })`);
  await b.evaluate(`MxAssist.apply('two', ${JSON.stringify(env([item('two', 'Added in tab B'), item('three', 'Also added in tab B')]))}).then(function () { return true; })`);
  const kept = await a.evaluate(`MxStore.get('assist', 'two').then(function (r) { return r.items.map(function (x) { return x.id; }).sort().join(); })`);
  t.ok(kept === 'one,three,two', 'tab A adds one item, tab B adds two: the database keeps all three — ' + kept);
  t.ok(await a.waitFor(`(MxAssist.peek('two') || []).length === 3`, 5000, 'tab A hears of it') && await b.waitFor(`(MxAssist.peek('two') || []).length === 3`, 5000, 'tab B has it'),
    'and each tab draws all three: the other tab hears of the save and reads it again');

  // ---- the same in the same moment ----
  await Promise.all([
    a.evaluate(`MxAssist.apply('two', ${JSON.stringify(env([item('four', 'At once, from A')]))}).then(function () { return true; })`),
    b.evaluate(`MxAssist.apply('two', ${JSON.stringify(env([item('five', 'At once, from B')]))}).then(function () { return true; })`)
  ]);
  t.ok(await a.evaluate(`MxStore.get('assist', 'two').then(function (r) { return r.items.length === 5 && typeof r.rev === 'number'; })`),
    'two saves in the same moment, one from each tab: both kept, the record carrying its revision number');

  // ---- one item, moved in both tabs ----
  // Both show "one" as it is now; A closes it; B, still showing it open, drops it — and, separately, plans it.
  const seen = await b.evaluate(`JSON.stringify((MxAssist.peek('two') || []).filter(function (x) { return x.id === 'one'; })[0])`);
  await a.evaluate(`MxAssist.hook('two').act('other', 'one', { status: 'done' }, (MxAssist.peek('two') || []).filter(function (x) { return x.id === 'one'; })[0]).then(function () { return true; })`);
  const refused = await b.evaluate(`MxAssist.hook('two').act('other', 'one', { status: 'dropped' }, ${seen}).then(function () { return 'saved'; }, function (e) { return e.message; })`);
  t.ok(/^Not saved: workbook item one was changed elsewhere meanwhile/.test(refused) && /status is Done now/.test(refused),
    'a click in tab B that would undo what tab A did to the same item is refused, and says what it is now: ' + refused);
  await b.evaluate(`MxAssist.hook('two').act('other', 'one', { planned: '2026-11-20' }, ${seen}).then(function () { return true; })`);
  const both = await a.evaluate(`MxStore.get('assist', 'two').then(function (r) { var x = r.items.filter(function (i) { return i.id === 'one'; })[0]; return x.status + ' ' + x.planned; })`);
  t.ok(both === 'done 2026-11-20', 'a click that changes something else is made on top of the other tab’s change: both stay — ' + both);

  // ---- Undo never takes back what another tab saved since ----
  const undo = await a.evaluate(`(async function () {
    var res = await MxAssist.apply('two', ${JSON.stringify(env([item('six', 'Added in A, to be undone')]))});
    window.__res = res;
    return MxAssist.canUndo('two', res);
  })()`);
  await b.evaluate(`MxAssist.apply('two', ${JSON.stringify(env([item('seven', 'Added in B after it')]))}).then(function () { return true; })`);
  await a.waitFor(`(MxAssist.peek('two') || []).some(function (x) { return x.id === 'seven'; })`, 5000, 'tab A hears of seven');
  const undone = await a.evaluate(`MxAssist.undo('two', window.__res).then(function () { return 'undone'; }, function (e) { return e.message; })`);
  t.ok(undo && /Something changed on the Assist page since/.test(undone) && await a.evaluate(`MxStore.get('assist', 'two').then(function (r) { return r.items.some(function (x) { return x.id === 'seven'; }) && r.items.some(function (x) { return x.id === 'six'; }); })`),
    'Undo in tab A after tab B saved is refused, and B’s item stays: ' + undone);

  // ---- solved cases ----
  const note = (id) => ['---', 'id: "' + id + '"', 'kind: "ticket"', 'title: "Orders saved twice"', 'status: "solved"', 'solved: "2026-10-15"', 'flows: []', 'entities: []', 'pages: []',
    'keywords: ["duplicate"]', 'related: []', 'language: "en"', '---', '', '# ' + id + ' — Orders saved twice', '', '## Problem', '', 'A clerk saw every new order twice.', '', '## Cause', '', 'The button has no guard.', '',
    '## Solution', '', '- Disable it while saving.', '', '## What did not work', '', 'Hiding it.', '', '## How to recognise it next time', '', 'Two orders a second apart.', ''].join('\n');
  const kenv = (id) => JSON.stringify({ format: 'mxscout-knowledge', version: 1, cases: [{ path: 'knowledge/' + id + '-orders-saved-twice.md', text: note(id) }] });
  const rk = await a.evaluate(`MxKnowledge.list('two').then(function (l) { return l.length; })`) + await b.evaluate(`MxKnowledge.list('two').then(function (l) { return l.length; })`);
  const ka = await a.evaluate(`MxKnowledge.apply('two', ${JSON.stringify(kenv('SD-1'))}).then(function (r) { return r.changed.length; }, function (e) { return e.message; })`);
  const kb = await b.evaluate(`MxKnowledge.apply('two', ${JSON.stringify(kenv('SD-2'))}).then(function (r) { return r.changed.length; }, function (e) { return e.message; })`);
  const cases = await a.evaluate(`MxStore.get('knowledge', 'two').then(function (r) { return r ? r.files.map(function (f) { return f.path; }).join() : ''; })`);
  t.ok(rk === 0 && ka === 1 && kb === 1 && cases === 'knowledge/SD-1-orders-saved-twice.md,knowledge/SD-2-orders-saved-twice.md',
    'a solved case saved in each tab: both kept — ' + [ka, kb, cases].join(' | '));
  t.ok(await b.waitFor(`(MxKnowledge.peek('two') || []).length === 2`, 5000, 'tab B draws both') && await a.waitFor(`(MxKnowledge.peek('two') || []).length === 2`, 5000, 'tab A draws both'), 'and both tabs draw both');

  // ---- descriptions: an agent hands a part to each tab ----
  const SW = "(function(q){var s=document.querySelector('.switcher[aria-expanded=\"false\"]'); if (s) s.click(); return document.querySelectorAll(q);})";
  async function openDocs(tab) {
    await tab.navigate(t.MX);
    await tab.waitFor(`!!window.MxDocs && !!Array.from(${SW}('button,a')).find(n => n.textContent.trim() === 'TwoTabs')`, 10000, 'project listed');
    await tab.evaluate(`(function(){ var e = Array.from(${SW}('button,a')).filter(n => n.textContent.trim() === 'TwoTabs'); e[e.length-1].click(); return true; })()`);
    await tab.waitFor(`!!document.querySelector('.tree-section')`, 10000, 'project open');
    await goToDocsTab(tab, 'agent', '.docs-agent button');
  }
  async function share(tab) {
    await tab.waitFor(`!!Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Share with an agent')`, 10000, 'share button');
    await tab.evaluate(`Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Share with an agent').click()`);
    return (await tab.waitFor(`(function(){ var c = document.querySelector('.docs-agent .code-value'); var m = c && /token ([0-9a-f]{48})\\./.exec(c.textContent); return m && m[1]; })()`, 10000, 'token'));
  }
  await openDocs(b);
  await openDocs(a);
  // B has read the project's descriptions — none — before A saves any.
  t.ok(await b.evaluate(`MxStore.get('descriptions', 'two').then(function (r) { return !r; })`), 'tab B has the Documentation open, with no descriptions yet');
  const part = (flow, text) => JSON.stringify({ format: 'mxscout-descriptions', version: 1, add: true, by: 'test agent', microflows: { [flow]: { text: text } } });
  const send = (token, body) => fetch(t.MX + '/api/agent/descriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body });
  const flows = Object.keys(await a.evaluate(`JSON.stringify(MxDocs.current().flows)`).then(JSON.parse)).filter((k) => /^microflow:/.test(k)).map((k) => k.slice('microflow:'.length));
  const tokA = await share(a);
  await send(tokA, part(flows[0], 'Described through tab A.'));
  await a.waitFor(`MxStore.get('descriptions', 'two').then(function (r) { return !!r; })`, 8000, 'A saved it');
  const tokB = await share(b);
  await send(tokB, part(flows[1], 'Described through tab B.'));
  const desc = await b.waitFor(`MxStore.get('descriptions', 'two').then(function (r) { var m = r && r.value.microflows; return m && m[${JSON.stringify(flows[1])}] ? JSON.stringify(Object.keys(m).sort()) : false; })`, 8000, 'B saved it');
  t.ok(desc === JSON.stringify([flows[0], flows[1]].sort()), 'descriptions an agent handed to tab A, then a part handed to tab B: both kept — ' + desc);
  await b.evaluate(`(function(){ var x = Array.from(document.querySelectorAll('.docs-agent button')).find(function (n) { return n.textContent === 'Stop sharing'; }); if (x) x.click(); return true; })()`);

  // ---- Developer tools: what was decided about the risks, and the comments ----
  const risk = (title) => ({ level: 'P2', title: title, detail: 'Found by the agent.', origin: 'ai' });
  await a.evaluate(`(function(){ MxTriage.recordFor('two'); return true; })()`);
  await b.evaluate(`(function(){ MxTriage.recordFor('two'); return true; })()`);
  await a.waitFor(`MxTriage.recordFor('two') !== undefined`, 5000, 'A read the decisions');
  await b.waitFor(`MxTriage.recordFor('two') !== undefined`, 5000, 'B read the decisions');
  await Promise.all([
    a.evaluate(`MxTriage.set('two', ${JSON.stringify(risk('Saved twice'))}, 'fixed', 'Guarded the button.').then(function () { return true; })`),
    b.evaluate(`MxTriage.set('two', ${JSON.stringify(risk('Deletes without asking'))}, 'false-positive', 'It asks on the page.').then(function () { return true; })`)
  ]);
  const decided = await a.evaluate(`MxStore.get('triage', 'two').then(function (r) { return Object.keys(r.risks).map(function (k) { return r.risks[k].status; }).sort().join(); })`);
  t.ok(decided === 'false-positive,fixed', 'a risk decided in each tab at the same moment: both decisions kept — ' + decided);

  await a.evaluate(`MxStore.put('findings', { id: 'c-two', projectId: 'two', status: 'open', history: [], author: null, createdAt: '2026-10-15T10:00:00Z', updatedAt: '2026-10-15T10:00:00Z',
    target: { kind: 'entity', qualifiedName: 'Sales.Order', module: 'Sales', name: 'Order', attributes: [] }, severity: 'medium', risk: null, role: null, problem: 'Two tabs, one comment.', change: '' }).then(function () { return true; })`);
  // Both tabs show the comment as it is now; each moves it at the same moment, from the copy it holds.
  await a.evaluate(`MxComments.loadFindings('two').then(function () { return true; })`);
  await b.evaluate(`MxComments.loadFindings('two').then(function () { return true; })`);
  await Promise.all([
    a.evaluate(`(function(){ MxComments.setStatusById('c-two', 'fixed'); return true; })()`),
    b.evaluate(`(function(){ MxComments.setStatusById('c-two', 'wontfix'); return true; })()`)
  ]);
  await new Promise((r) => setTimeout(r, 800));
  const kept2 = JSON.parse(await a.evaluate(`MxStore.get('findings', 'c-two').then(function (f) { return JSON.stringify({ status: f.status, moves: f.history.length, rev: f.rev }); })`));
  const told = (await a.evaluate(`(document.querySelector('.msg') || {}).textContent || ''`)) + ' ' + (await b.evaluate(`(document.querySelector('.msg') || {}).textContent || ''`));
  t.ok(kept2.moves === 1 && kept2.rev === 1 && /changed in another tab since — nothing was saved here/.test(told),
    'one comment moved in both tabs at once: one move is kept, the other tab is told nothing was saved — never one silently written over the other: ' + JSON.stringify(kept2));
  await a.close();
  await b.close();
};
