/* Assist: what an agent helped with, kept as items with a status (Karol, 2026-10-15: a page "Assist",
 * tabs Tickets · Jira · Ideas · Workbook (kind "other", shown so since 2026-10-16), each a history list with search and a status filter; an item is
 * open, in progress, done or dropped, with a planned date; the person moves it by clicking, an agent by
 * sending an update; the tickets and changes of before move there).
 *
 * What this holds (the agent channel, the export and the package are test 87's; the project folder test 88's):
 *  - the envelope: what is read, what is refused, what is dropped, and that it all stays text;
 *  - apply: an item added, replaced by its id with its history kept, moved by an update;
 *  - a click: the status and the planned date, each written in the history as the person's;
 *  - the files a project folder keeps them in, and back;
 *  - the move from a descriptions file: tickets to Tickets, changes to Ideas, once;
 *  - the screen: Assist in the sidebar with its open count and no Tickets or Changes beside it, one
 *    list of every item with a kind dropdown, search and Open · Closed · All, one item with its parts, the buttons, the history, the
 *    Overview's small entry;
 *  - notes (Karol, 2026-10-16): what the person asked the agent to keep on an item — added and changed
 *    by an update, never lost when the item is written again, ticked by the person without a history
 *    entry, kept in the item's file — and drawn by topic, filtered, their model elements linked. */
'use strict';
const { goToSection } = require('./helpers');
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxAssist && !!window.MxDocsAssist && !!window.MxDocsData', 15000, 'MxScout loaded');
  await mx.viewport(1440, 900);
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const entity = await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    var now = new Date().toISOString();
    await MxStore.saveProjectWithModel({ id: 'pas', name: 'AssistDemo', createdAt: now, updatedAt: now, source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, model);
    await MxStore.saveProjectWithModel({ id: 'pasold', name: 'AssistOldDemo', createdAt: now, updatedAt: now, source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, model);
    var d = MxDocsData.build(model, { name: 'AssistDemo' });
    return Object.keys(d.entities).filter(function (q) { return /^Sales\\./.test(q); })[0];
  })()`);
  t.ok(!!entity, 'the fixture has an entity to name: ' + entity);

  // ---- the envelope ----
  const ticket = {
    id: 'PROJ-12', kind: 'ticket', title: 'Cancelled orders still appear in the clerk’s queue', source: 'Jira, https://jira.example.com/browse/PROJ-12',
    reported: 'When a customer cancels an order it still shows up in my queue.\nExpected: cancelled orders are gone.',
    verdict: 'bug', confidence: 'high', summary: 'The ticket is right: the queue lists every order that has not shipped, cancelled ones among them.',
    story: 'The queue lists what has not shipped.\n\nNothing in its condition leaves out a cancelled order.',
    traced: { steps: ['The customer cancels', 'The clerk opens the queue'], flows: ['Sales.CreateOrder'],
      diagram: [{ step: 'Opens the queue', who: 'Clerk' }, { decision: 'Shipped?', ways: [{ label: 'yes', end: 'Left out' }, { label: 'no' }] }, { end: 'Listed' }] },
    evidence: [{ kind: 'microflow', target: 'Sales.CreateOrder', what: 'Makes the order.' }, { kind: 'entity', target: entity, what: 'No cancelled mark.' }, { kind: 'enumeration', target: 'Sales.ENUM_X', what: 'Not drawn.' }],
    needs: [], reply: 'Thanks — confirmed, we will change the queue.', change: 'queue-leaves-out-cancelled',
    fix: { summary: 'The queue’s retrieve leaves out Cancelled.', steps: ['The clerk opens the queue'], changes: [{ kind: 'microflow', target: 'Sales.CreateOrder', action: 'change', what: 'Leaves out Cancelled.' }], effort: 'small' }
  };
  const second = { id: 'PROJ-15', kind: 'ticket', title: 'The discount is sometimes missing', verdict: 'cannot-tell', confidence: 'low', summary: 'Depends on data.', needs: ['The order numbers'] };
  const jira = { id: 'SHOP-7', kind: 'jira', title: 'Export orders as CSV', summary: 'A CSV export for the clerk.', scope: { feasible: 'partly', why: 'The order overview only.', modules: ['Sales'], touches: ['Sales.CreateOrder', 'Sales.Nowhere'] },
    proposal: { summary: 'A button that exports the list.', steps: ['Add a button'], changes: [{ kind: 'microflow', target: 'Sales.ACT_Order_Export', action: 'add', what: 'Writes the CSV.' }] },
    impact: 'Nothing existing changes.', risks: [{ level: 'P3', title: 'Large lists', detail: 'Slow.', fix: 'Page it.' }], open: ['Which columns?'], effort: 'small', reply: 'We can do this.' };
  const idea = { id: 'queue-leaves-out-cancelled', kind: 'idea', title: 'The queue leaves out cancelled orders', reported: 'Cancelled orders should leave the queue.',
    now: { summary: 'The queue lists what has not shipped.', steps: ['A', 'B'], flows: ['Sales.CreateOrder'] },
    proposal: { summary: 'The queue’s retrieve also leaves out Cancelled.', steps: ['Leave out Cancelled'], changes: [{ kind: 'microflow', target: 'Sales.CreateOrder', action: 'change', what: 'Leaves out Cancelled.' }] },
    impact: { flows: ['Sales.CreateOrder'], roles: ['Clerk'], data: 'None.' }, effort: 'an hour' };
  const other = { id: 'note-1', kind: 'other', title: 'Where the discounts are set', summary: 'In one flow.', sources: ['Sales.CreateOrder'] };
  const env = { format: 'mxscout-assist', version: 1, items: [ticket, second, jira, idea, other] };

  const parse = JSON.parse(await mx.evaluate(`(function () {
    function p(x) { var r = MxAssist.parseEnvelope(typeof x === 'string' ? x : JSON.stringify(x)); return r.error ? 'ERR ' + r.error : r.value; }
    var odd = p({ format: 'mxscout-assist', version: 1, items: [
      { id: 'A 1', kind: 'ticket', title: 't' }, { id: 'A-2', kind: 'bug', title: 't' }, { id: 'A-3', kind: 'ticket' },
      { id: 'A-4', kind: 'ticket', title: '<b>t</b>', summary: '<i>s</i>', verdict: 'maybe', reported: 'x'.repeat(9000), planned: 'tomorrow', status: 'closed' },
      { id: 'A-4', kind: 'ticket', title: 'twice' }, { id: 'a-4', kind: 'idea', title: 'the same id, another kind' }, { id: 'A-4', kind: 'idea', title: 'an idea’s id is a slug' },
      { id: 'NODIGIT', kind: 'ticket', title: 'a ticket’s key has a digit' }, { id: '#SD-9', kind: 'ticket', title: 'the leading # is dropped', language: 'pl' },
      { id: 'A-5', kind: 'jira', update: true, status: 'done', history: [{ date: '2026-10-15', what: 'Merged.', by: 'agent' }] }, { id: 'A-6', kind: 'jira', update: true, planned: null },
      { id: 'A-7', kind: 'ticket', update: true, verdict: 'bug' } ], language: 'de' });
    var a4 = odd.items[0];
    return JSON.stringify({
      notJson: p('{'), format: p({ format: 'mxscout-descriptions', version: 1 }), version: p({ format: 'mxscout-assist', version: 2, items: [] }),
      noItems: p({ format: 'mxscout-assist', version: 1 }), empty: p({ format: 'mxscout-assist', version: 1, items: [{ id: 'x' }] }),
      ok: p(${JSON.stringify(JSON.stringify(env))}).items.map(function (x) { return x.kind + ':' + x.id; }),
      kept: odd.items.map(function (x) { return x.kind + ':' + x.id; }), updates: odd.updates, dropped: odd.dropped.length,
      a4: [a4.title, a4.summary, a4.verdict, a4.reported.length, a4.planned, a4.status].join(' | '), langs: odd.items.map(function (x) { return x.language; }).join(),
      whyDropped: odd.dropped.filter(function (d) { return /A-7/.test(d); })[0] || null,
      setLang: [p({ format: 'mxscout-assist', version: 1, language: 'pl', setLanguage: true, items: [{ id: 'x-1', kind: 'other', title: 't' }] }).setLanguage, p({ format: 'mxscout-assist', version: 1, language: 'pl', items: [{ id: 'x-1', kind: 'other', title: 't' }] }).setLanguage].join(),
      isEnv: [MxAssist.isEnvelope('{ "format": "mxscout-assist" }'), MxAssist.isEnvelope('{ "format": "mxscout-descriptions" }')]
    });
  })()`));
  t.ok(/^ERR That is not JSON/.test(parse.notJson) && /^ERR That is not an Assist file/.test(parse.format) && /^ERR This Assist file is version 2/.test(parse.version) &&
    /^ERR The file has no "items"/.test(parse.noItems) && /^ERR The file has the right format but no item/.test(parse.empty), 'what is not an Assist file, of another version or empty is refused, saying why: ' + JSON.stringify(parse.empty));
  t.ok(parse.ok.join() === 'ticket:PROJ-12,ticket:PROJ-15,jira:SHOP-7,idea:queue-leaves-out-cancelled,other:note-1', 'an envelope of the four kinds is read: ' + parse.ok.join());
  t.ok(parse.kept.join() === 'ticket:A-4,idea:a-4,ticket:SD-9' && parse.dropped === 7,
    'an item without a usable id — a ticket’s key with a digit, an idea’s a slug — a known kind or a title is dropped, and so is a second with the same kind and id: ' + parse.kept.join());
  t.ok(parse.langs === 'de,de,pl' && parse.setLang === 'pl,', 'an item says its language, or takes the envelope’s; setLanguage asks for the project’s to change: ' + parse.langs);
  t.ok(/A-7: an update carries only what changed — "verdict" is not one of its fields; send the whole item instead/.test(parse.whyDropped || ''), 'an update with anything else in it is refused, saying to send the whole item: ' + parse.whyDropped);
  t.ok(parse.a4 === '<b>t</b> | <i>s</i> |  | 8000 |  | open', 'markup stays text, an unknown verdict is none, the report is cut at 8,000, a planned date that is no date and an unknown status are left out: ' + parse.a4);
  t.ok(JSON.stringify(parse.updates) === JSON.stringify([{ id: 'A-5', kind: 'jira', updated: null, status: 'done', history: [{ date: '2026-10-15', what: 'Merged.', by: 'agent' }] }, { id: 'A-6', kind: 'jira', updated: null, planned: null }]),
    'an entry that says "update": true carries only what changed, and is read as a move, not an item: ' + JSON.stringify(parse.updates));
  t.ok(parse.isEnv[0] === true && parse.isEnv[1] === false, 'an Assist file is told from a descriptions file by its format');

  // ---- apply, and a click ----
  const applied = JSON.parse(await mx.evaluate(`(async function () {
    var r1 = await MxAssist.apply('pas', ${JSON.stringify(JSON.stringify(env))});
    var a = (await MxAssist.list('pas')).filter(function (x) { return x.id === 'PROJ-12'; })[0];
    await MxAssist.set('pas', 'ticket', 'PROJ-12', { status: 'in-progress' });
    await MxAssist.set('pas', 'ticket', 'PROJ-12', { planned: '2026-11-02' });
    var again = Object.assign({}, ${JSON.stringify(ticket)}, { title: 'Checked again: cancelled orders stay in the queue' });
    var r2 = await MxAssist.apply('pas', { items: [MxAssist.parseEnvelope(JSON.stringify({ format: 'mxscout-assist', version: 1, items: [again] })).value.items[0]], updates: [], dropped: [] });
    var b = (await MxAssist.list('pas')).filter(function (x) { return x.id === 'PROJ-12'; })[0];
    var refused = await MxAssist.apply('pas', JSON.stringify({ format: 'mxscout-assist', version: 1, items: [{ id: 'SHOP-7', kind: 'jira', update: true, status: 'done' }, { id: 'GONE-1', kind: 'jira', update: true, status: 'done' }] })).then(function () { return null; }, function (e) { return e.message; });
    var stillOpen = (await MxAssist.list('pas')).filter(function (x) { return x.id === 'SHOP-7'; })[0].status;
    var r3 = await MxAssist.apply('pas', JSON.stringify({ format: 'mxscout-assist', version: 1, items: [{ id: 'SHOP-7', kind: 'jira', update: true, updated: '2026-10-20', status: 'done', closed: '2026-10-20', planned: '2026-10-20',
      history: [{ date: '2026-10-20', what: 'Merged in sprint 4.', by: 'person' }] }] }));
    var c = (await MxAssist.list('pas')).filter(function (x) { return x.id === 'SHOP-7'; })[0];
    var all = await MxAssist.list('pas');
    return JSON.stringify({ r1: r1.changed.map(function (x) { return x.how + ' ' + x.kind + ':' + x.id; }), what1: r1.what,
      a: [a.status, a.history.length, a.history[0].by, !!a.created].join(' '),
      r2: r2.changed.map(function (x) { return x.how; }).join(), b: [b.title.slice(0, 13), b.status, b.planned, b.history.map(function (h) { return h.by + ':' + h.what; }).join(' / ')].join(' | '),
      created: a.created === b.created, r3: r3.changed.map(function (x) { return x.how + ' ' + x.id; }).join(), refused: refused, stillOpen: stillOpen,
      c: [c.status, c.planned, !!c.closed, c.history[c.history.length - 1].by + ':' + c.history[c.history.length - 1].what].join(' | '),
      count: all.length, open: MxAssist.openCount(all), stored: (await MxStore.get('assist', 'pas')).items.length });
  })()`));
  t.ok(applied.r1.join() === 'added ticket:PROJ-12,added ticket:PROJ-15,added jira:SHOP-7,added idea:queue-leaves-out-cancelled,added other:note-1' && /the ticket PROJ-12|2 tickets PROJ-12, PROJ-15/.test(applied.what1),
    'apply adds each item and says what it added: ' + applied.what1);
  t.ok(applied.a === 'open 1 agent true', 'a new item is open, with the agent’s hand-in as the first line of its history: ' + applied.a);
  t.ok(applied.r2 === 'replaced' && applied.b === 'Checked again | in-progress | 2026-11-02 | agent:Handed in by the agent / person:In progress / person:Planned for 2026-11-02 / agent:Written again by the agent' && applied.created,
    'the same id again replaces the item — where the person moved it and its planned date stay, its history is appended to, its creation date kept: ' + applied.b);
  t.ok(/^Nothing was saved: an update is for jira GONE-1, which MxScout does not keep for this project — send the whole item instead\.$/.test(applied.refused || '') && applied.stillOpen === 'open',
    'an update for an item MxScout does not keep refuses the whole file, saying so, and nothing of it is saved: ' + applied.refused);
  t.ok(applied.r3 === 'updated SHOP-7' && applied.c === 'done | 2026-10-20 | true | person:Merged in sprint 4.',
    'an update closes an item and plans it, the history entry it carries appended as it says: ' + applied.c);
  t.ok(applied.count === 5 && applied.open === 4 && applied.stored === 5, 'all of it is kept in the browser’s database, four of five open or in progress');

  // ---- the files a project folder keeps them in ----
  const files = JSON.parse(await mx.evaluate(`(async function () {
    var items = await MxAssist.list('pas');
    var f = MxAssist.toFiles(items);
    var back = MxAssist.fromFiles(f.concat([{ path: 'assist/tickets/WRONG-1.json', text: f[0].text }, { path: 'assist/ideas/x.json', text: '{' }, { path: 'notes.txt', text: 'x' }]));
    var t0 = back.items.filter(function (x) { return x.id === 'PROJ-12'; })[0];
    return JSON.stringify({ paths: f.map(function (x) { return x.path; }), same: JSON.stringify(back.items) === JSON.stringify(items), errors: back.errors.map(function (e) { return e.path + ': ' + e.error; }),
      diagram: t0.traced.diagram.length === 3 && t0.traced.diagram[1].t === 'decision', raw: JSON.parse(f[0].text).traced.diagram[0].step });
  })()`));
  t.ok(files.paths.indexOf('assist/tickets/PROJ-12.json') !== -1 && files.paths.indexOf('assist/ideas/queue-leaves-out-cancelled.json') !== -1 && files.paths.indexOf('assist/jira/SHOP-7.json') !== -1 && files.paths.indexOf('assist/other/note-1.json') !== -1 && files.paths.length === 5,
    'toFiles writes one file per item, at assist/<tickets|jira|ideas|other>/<id>.json: ' + files.paths.join(', '));
  t.ok(files.same && files.diagram && files.raw === 'Opens the queue', 'fromFiles reads them back to the same items, diagrams and history included');
  t.ok(files.errors.length === 3 && /WRONG-1\.json: its kind and id/.test(files.errors[0]) && /not JSON/.test(files.errors[1]) && /not an assist/.test(files.errors[2]),
    'a file whose path does not name its item, one that is not JSON and one that is not an item are reported: ' + JSON.stringify(files.errors));

  // ---- the move from a descriptions file ----
  const oldDesc = { format: 'mxscout-descriptions', version: 1, microflows: { 'Sales.CreateOrder': 'Opens an order.' },
    tickets: [{ id: 'OLD-3', title: 'An old ticket', verdict: 'as-designed', confidence: 'medium', summary: 'Works as built.', date: '2026-10-14', reply: 'It is meant to.' }],
    changes: [{ id: 'old-change', title: 'An old change', asked: 'Make it so.', date: '2026-10-13', status: 'accepted', now: { summary: 'Now.' }, proposal: { summary: 'Then.', changes: [] } }] };
  const moved = JSON.parse(await mx.evaluate(`(async function () {
    var v = MxDescribe.parse(${JSON.stringify(JSON.stringify(oldDesc))}).value;
    var r1 = await MxAssist.migrate('pasold', v);
    await MxAssist.set('pasold', 'ticket', 'OLD-3', { status: 'done' });
    var r2 = await MxAssist.migrate('pasold', v);
    var items = await MxAssist.list('pasold'), row = await MxStore.get('assist', 'pasold');
    var att = MxDocsData.build(await MxStore.getModel('pasold'), { name: 'x' });
    MxDescribe.attach(att, v);
    var file = MxDescribe.toFile(v);
    return JSON.stringify({ r1: r1.moved, r2: r2.moved, items: items.map(function (x) { return x.kind + ':' + x.id + ':' + x.status + ':' + (x.created || '').slice(0, 10); }),
      reply: items[0].reply, history: items[1].history[0].what, migrated: !!row.migrated, docsHave: 'tickets' in att.ai || 'changes' in att.ai, fileHas: 'tickets' in file || 'changes' in file, flow: !!file.microflows['Sales.CreateOrder'] });
  })()`));
  t.ok(moved.r1 === 2 && moved.items.join() === 'ticket:OLD-3:done:2026-10-14,idea:old-change:in-progress:2026-10-13' && moved.reply === 'It is meant to.' && /moved here from the Changes page/.test(moved.history),
    'a descriptions file’s ticket moves to Tickets and its change to Ideas, an accepted change in progress, each with its date and history: ' + moved.items.join());
  t.ok(moved.r2 === 0 && moved.migrated, 'moving again moves nothing — the ticket closed since stays closed — and the record says it was moved');
  t.ok(!moved.docsHave && !moved.fileHas && moved.flow, 'the documentation and the descriptions file written from them no longer carry tickets or changes; the rest is as it was');

  // ---- the screen ----
  const SW = "(function(q){var s=document.querySelector('.switcher[aria-expanded=\"false\"]'); if (s) s.click(); return document.querySelectorAll(q);})";
  async function open(name) {
    await mx.navigate(t.MX);
    await mx.waitFor(`!!Array.from(${SW}('.tree-project')).find(b => b.textContent.indexOf(${JSON.stringify(name)}) !== -1)`, 10000, 'project');
    await mx.evaluate(`Array.from(${SW}('.tree-project')).find(b => b.textContent.trim().indexOf(${JSON.stringify(name)}) === 0).click()`);
    await mx.waitFor(`!!Array.from(document.querySelectorAll('.tree-section')).find(b => /^Overview/.test(b.textContent))`, 8000, 'sections');
  }
  const sections = () => mx.evaluate(`Array.from(document.querySelectorAll('.tree-section')).map(function (b) { return b.textContent.trim(); }).join('|')`);
  await open('AssistDemo');
  const side = await mx.waitFor(`(function(){ var s = Array.from(document.querySelectorAll('.tree-section')).map(function (b) { return b.textContent.trim(); }).join('|'); return /Assist4/.test(s) && s; })()`, 5000, 'assist in the sidebar');
  t.ok(/Risks\|Assist4\|Solved cases\|Model quality/.test(side) && !/Tickets|Changes/.test(side), 'Assist is under Review with its open count, and there is no Tickets or Changes section: ' + side);

  await goToSection(mx, 'Assist', '.doc-screen .dx-as-list');
  // One list beside the item (Karol, 2026-10-16): every item, a kind chosen from a dropdown, a search, Open · Closed · All.
  const rowsNow = `Array.from(document.querySelectorAll('.doc-screen .dx-as-li')).filter(function (r) { return !r.parentNode.hidden; }).map(function (r) { return r.getAttribute('data-id') + '/' + r.querySelector('.dx-as-st').textContent; }).join('|')`;
  const pick = (kind, show) => mx.evaluate(`(function(){ var s = document.querySelector('.doc-screen .dx-as-kind'); s.value = ${JSON.stringify(kind)}; s.dispatchEvent(new Event('change'));
    ${show ? `document.querySelector('.doc-screen .dx-as-seg button[data-show="${show}"]').click();` : ''} return true; })()`);
  const list = JSON.parse(await mx.evaluate(`JSON.stringify({ h1: document.querySelector('.xe-head h1').textContent, tabs: document.querySelectorAll('.doc-screen .dx-as-tab, .doc-screen .dx-as-index').length,
    kinds: Array.from(document.querySelectorAll('.doc-screen .dx-as-kind option')).map(function (o) { return o.textContent; }),
    seg: Array.from(document.querySelectorAll('.doc-screen .dx-as-seg button')).map(function (b) { return b.textContent + (b.classList.contains('on') ? '*' : ''); }),
    opened: !!document.querySelector('.doc-screen .dx-as-li.on') && !!document.querySelector('.doc-screen .dx-as-bar') })`));
  t.ok(list.h1 === 'Assist' && list.tabs === 0 && list.kinds.join('|') === 'All kinds · 5 (4 open)|Tickets · 2 (2 open)|Jira · 1|Ideas · 1 (1 open)|Workbook · 1 (1 open)'
    && list.seg.join('|') === 'Open4*|Closed1|All5' && list.opened,
    'one list: no tabs and no second list on the page, a dropdown of the kinds with their counts, Open · Closed · All, and the first item open beside it: ' + JSON.stringify(list));
  await pick('ticket', 'all');
  const tickets = JSON.parse(await mx.evaluate(`JSON.stringify({ rows: ${rowsNow}, verdicts: Array.from(document.querySelectorAll('.doc-screen .dx-as-li .dx-tk-v')).filter(function (c) { return !c.closest('[role=listitem]').hidden; }).map(function (c) { return c.textContent; }) })`));
  t.ok(tickets.rows === 'PROJ-12/In progress|PROJ-15/Open' && tickets.verdicts.join() === 'Bug in the model,Cannot tell from the model',
    'Tickets: each a row with its id, title, status and verdict, the last moved first: ' + JSON.stringify(tickets));
  await mx.evaluate(`(function(){ var q = document.querySelector('.doc-screen .dx-as-q'); q.value = 'discount'; q.dispatchEvent(new Event('input')); return true; })()`);
  const bySearch = await mx.evaluate(rowsNow);
  await mx.evaluate(`(function(){ var q = document.querySelector('.doc-screen .dx-as-q'); q.value = 'nothing like it'; q.dispatchEvent(new Event('input')); return true; })()`);
  const noneShown = await mx.evaluate(`[${rowsNow}, !document.querySelector('.doc-screen .dx-as-lnone').hidden].join('/')`);
  await mx.evaluate(`(function(){ var q = document.querySelector('.doc-screen .dx-as-q'); q.value = ''; q.dispatchEvent(new Event('input')); return true; })()`);
  await pick('', 'closed');
  const closedRows = await mx.evaluate(rowsNow);
  await pick('ticket', 'all');
  t.ok(bySearch === 'PROJ-15/Open' && noneShown === '/true' && closedRows === 'SHOP-7/Done' && await mx.evaluate(rowsNow) === tickets.rows,
    'the search shows what the words are in, says when nothing matches, and Closed shows what is done or dropped, of every kind: ' + [bySearch, noneShown, closedRows].join(' · '));

  // one ticket, and the buttons that move it
  await mx.evaluate(`document.querySelector('.doc-screen .dx-as-li[data-id="PROJ-12"]').click()`);
  await mx.waitFor(`!!document.querySelector('.doc-screen .dx-as-bar')`, 5000, 'one ticket');
  const one = JSON.parse(await mx.evaluate(`(function () {
    var host = document.querySelector('.doc-screen');
    return JSON.stringify({ title: host.querySelector('.dx-as h2').textContent, eye: host.querySelector('.dx-pd-eye').textContent, anchors: host.querySelectorAll('a[href^="http"]').length,
      verdict: host.querySelector('.dx-tk-verdict .dx-tk-v').textContent, evidence: Array.from(host.querySelectorAll('.dx-tk-evidence .dx-ch-target')).map(function (c) { return c.textContent + (c.querySelector('.link') ? '+' : ''); }),
      graph: host.querySelectorAll('.dx-tk-traced .dx-pd-diagram .fg').length, reply: (host.querySelector('.dx-tk-reply-t') || {}).textContent, copy: !!host.querySelector('.dx-tk-copy'),
      fix: (host.querySelector('.dx-tk-change b') || {}).textContent, proposedFix: !!host.querySelector('.dx-as-fix') && Array.from(host.querySelectorAll('.dx-ch-model .dx-ch-target')).map(function (c) { return c.textContent + (c.querySelector('.link') ? '+' : ''); }).join(), status: host.querySelector('.dx-as-now .dx-as-st').textContent,
      buttons: Array.from(host.querySelectorAll('.dx-as-btns button')).map(function (b) { return b.textContent; }), planned: host.querySelector('.dx-as-date').value,
      history: Array.from(host.querySelectorAll('.dx-as-hist li')).map(function (l) { return l.children[1].textContent + ':' + l.children[2].textContent; }) });
  })()`));
  t.ok(one.title === 'Checked again: cancelled orders stay in the queue' && /PROJ-12/.test(one.eye) && /jira\.example\.com/.test(one.eye) && one.anchors === 0, 'one ticket names its id and source — the address as text, not a link');
  t.ok(one.verdict === 'Bug in the model' && one.evidence.join() === 'Sales.CreateOrder+,' + entity + '+,Sales.ENUM_X' && one.graph === 1 && one.reply === ticket.reply && one.copy && one.fix === idea.title && one.proposedFix === 'Sales.CreateOrder+',
    'with the ticket’s parts: the verdict, the evidence linked where the model has it, the diagram, the reply with Copy, the idea that fixes it: ' + one.evidence.join());
  t.ok(one.status === 'In progress' && one.buttons.join() === 'Close,Waiting for the reporter,Back to open,Drop' && one.planned === '2026-11-02', 'its status, the buttons for it and its planned date: ' + one.buttons.join());
  t.ok(one.history.join(' / ') === 'Agent:Written again by the agent / You:Planned for 2026-11-02 / You:In progress / Agent:Handed in by the agent', 'and its history, newest first, saying who: ' + one.history.join(' / '));

  await mx.evaluate(`document.querySelector('.doc-screen .dx-as-btns button[data-status="done"]').click()`);
  const closed = await mx.waitFor(`(function(){ var s = document.querySelector('.doc-screen .dx-as-now .dx-as-st'); return s && s.textContent === 'Done' && Array.from(document.querySelectorAll('.doc-screen .dx-as-btns button')).map(function (b) { return b.textContent; }).join(); })()`, 5000, 'closed');
  const sideAfter = await mx.waitFor(`(function(){ var s = Array.from(document.querySelectorAll('.tree-section')).map(function (b) { return b.textContent.trim(); }).join('|'); return /Assist3/.test(s) && s; })()`, 5000, 'count after close');
  t.ok(closed === 'Reopen' && /Assist3/.test(sideAfter), 'Close marks it done, leaves only Reopen, and the sidebar counts one fewer open');
  await mx.evaluate(`(function(){ var d = document.querySelector('.doc-screen .dx-as-date'); d.value = '2026-12-01'; d.dispatchEvent(new Event('change')); return true; })()`);
  await mx.waitFor(`(function(){ var d = document.querySelector('.doc-screen .dx-as-date'); return d && d.value === '2026-12-01' && /Planned for 2026-12-01/.test(document.querySelector('.doc-screen .dx-as-hist li').textContent); })()`, 5000, 'planned');
  await mx.evaluate(`document.querySelector('.doc-screen .dx-as-btns button[data-status="open"]').click()`);
  await mx.waitFor(`(function(){ var s = document.querySelector('.doc-screen .dx-as-now .dx-as-st'); return s && s.textContent === 'Open'; })()`, 5000, 'reopened');
  await mx.evaluate(`document.querySelector('.doc-screen .dx-as-btns button[data-status="dropped"]').click()`);
  await mx.waitFor(`(function(){ var s = document.querySelector('.doc-screen .dx-as-now .dx-as-st'); return s && s.textContent === 'Dropped'; })()`, 5000, 'dropped');
  const kept = JSON.parse(await mx.evaluate(`(async function () { var x = (await MxStore.get('assist', 'pas')).items.filter(function (i) { return i.id === 'PROJ-12'; })[0];
    return JSON.stringify({ status: x.status, planned: x.planned, closed: !!x.closed, last: x.history.slice(-4).map(function (h) { return h.by + ':' + h.what; }) }); })()`));
  t.ok(kept.status === 'dropped' && kept.planned === '2026-12-01' && kept.closed && kept.last.join(' / ') === 'person:Closed (done) / person:Planned for 2026-12-01 / person:Reopened / person:Dropped',
    'Close, a planned date, Reopen and Drop are each saved and written in the history as the person’s: ' + kept.last.join(' / '));
  t.ok(await mx.evaluate(`!!document.querySelector('.doc-screen .dx-as-bar') && document.querySelector('.doc-screen .dx-as h2').textContent.indexOf('Checked again') === 0`), 'and the screen stayed on the item through every click');

  // the fix opens the idea, on the Ideas tab: now beside the proposal, the model changes
  await mx.evaluate(`document.querySelector('.doc-screen .dx-tk-change').click()`);
  const ideaShown = await mx.waitFor(`(function(){ var h = document.querySelector('.doc-screen .dx-as h2'), on = document.querySelector('.doc-screen .dx-as-li.on'); return h && on && on.getAttribute('data-kind') === 'idea' && document.querySelector('.doc-screen .dx-ch-cols .dx-ch-col.now') && document.querySelector('.doc-screen .dx-ch-model') && h.textContent; })()`, 5000, 'the idea');
  t.ok(ideaShown === idea.title, 'the fix opens its idea, how it works now beside the proposal and the model changes: ' + ideaShown);
  await pick('jira', 'all');
  await mx.waitFor(`(function(){ var r = document.querySelector('.doc-screen .dx-as-li[data-id="SHOP-7"]'); return !!r && !r.parentNode.hidden; })()`, 5000, 'jira');
  await mx.evaluate(`document.querySelector('.doc-screen .dx-as-li[data-id="SHOP-7"]').click()`);
  const jiraShown = JSON.parse(await mx.waitFor(`(function(){ var host = document.querySelector('.doc-screen'); if (!host.querySelector('.dx-as-bar')) return null;
    return JSON.stringify({ status: host.querySelector('.dx-as-now .dx-as-st').textContent, proposal: !!host.querySelector('.dx-ch-col.proposal'), now: !!host.querySelector('.dx-ch-col.now'),
      model: Array.from(host.querySelectorAll('.dx-ch-model .dx-ch-target')).map(function (c) { return c.textContent; }), impact: (host.querySelector('.dx-ch-data') || {}).textContent, reply: !!host.querySelector('.dx-tk-copy'),
      scope: [(host.querySelector('.dx-as-feas') || {}).textContent].concat(Array.from(host.querySelectorAll('.dx-as-touches > *')).map(function (c) { return c.textContent + (c.classList.contains('link') ? '+' : ''); })).join() }); })()`, 5000, 'jira item'));
  t.ok(jiraShown.status === 'Done' && jiraShown.proposal && !jiraShown.now && jiraShown.model.join() === 'Sales.ACT_Order_Exportnew' && jiraShown.reply && jiraShown.scope === 'Partly feasible,Sales.CreateOrder+,Sales.Nowhere',
    'a Jira issue shows its proposal and model changes, its reply, and the status the agent gave it: ' + JSON.stringify(jiraShown));

  // ---- the Overview names it ----
  await goToSection(mx, 'Overview', '.doc-screen .dx-glance');
  const glance = await mx.evaluate(`Array.from(document.querySelectorAll('.doc-screen .dx-glance dt')).map(function (x) { return x.textContent + ':' + x.nextSibling.textContent; }).filter(function (x) { return /^Assist/.test(x); }).join()`);
  t.ok(glance === 'Assist:3 open', 'the Overview has a small Assist entry with how many are open: ' + glance);
  await mx.evaluate(`Array.from(document.querySelectorAll('.doc-screen .dx-glance dd button, .doc-screen .dx-glance dd a')).find(function (b) { return /open/.test(b.textContent); }).click()`);
  const there = await mx.waitFor(`(function(){ var h = document.querySelector('.xe-head h1'); return h && h.textContent === 'Assist' && !!document.querySelector('.doc-screen .dx-as') && h.textContent; })()`, 5000, 'assist from the overview');
  t.ok(there === 'Assist', 'and it opens the Assist screen');

  // ---- a project whose descriptions still carry tickets and changes: they arrive on Assist ----
  await mx.evaluate(`MxStore.put('descriptions', { projectId: 'pasold2', importedAt: new Date().toISOString(), fileName: 'old.json', value: MxDescribe.parse(${JSON.stringify(JSON.stringify(oldDesc))}).value })`);
  await mx.evaluate(`(async function () { var m = await MxStore.getModel('pasold'); var now = new Date().toISOString();
    await MxStore.saveProjectWithModel({ id: 'pasold2', name: 'AssistMovedDemo', createdAt: now, updatedAt: now, source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, m); return true; })()`);
  await open('AssistMovedDemo');
  const movedSide = await mx.waitFor(`(function(){ var s = Array.from(document.querySelectorAll('.tree-section')).map(function (b) { return b.textContent.trim(); }).join('|'); return /Assist2/.test(s) && s; })()`, 8000, 'moved items counted');
  await goToSection(mx, 'Assist', '.doc-screen .dx-as-list');
  const movedRows = await mx.evaluate(`Array.from(document.querySelectorAll('.doc-screen .dx-as-kind option')).map(function (o) { return o.textContent; }).join('|')`);
  t.ok(/Assist2/.test(movedSide) && !/Tickets|Changes/.test(movedSide) && movedRows === 'All kinds · 2 (2 open)|Tickets · 1 (1 open)|Jira · 0|Ideas · 1 (1 open)|Workbook · 0',
    'opening a project whose descriptions hold a ticket and a change moves them to Assist, where they are counted: ' + movedRows);

  // ---- questions for the reporter, the conversation, and waiting ----
  const W = { id: 'WAIT-1', kind: 'ticket', title: 'The export misses some orders', status: 'waiting', verdict: 'cannot-tell', confidence: 'low', summary: 'It depends on which orders.',
    questions: [{ id: 'q1', text: 'Which order numbers are missing?', why: 'The model exports every order with a status; the numbers tell which status they had.' },
      { id: 'q2', text: 'Which browser did you use?', why: 'Asked out of habit.' }, { id: 'q3', text: 'When did you run the export?', why: 'A scheduled event changes the statuses at night.' }],
    thread: [{ date: '2026-10-15T09:00:00.000Z', from: 'agent', text: 'Asked the reporter three questions.' }] };
  const conv = JSON.parse(await mx.evaluate(`(async function () {
    await MxAssist.apply('pasold2', JSON.stringify({ format: 'mxscout-assist', version: 1, items: [${JSON.stringify(W)}] }));
    var u = MxAssist.parseEnvelope(JSON.stringify({ format: 'mxscout-assist', version: 1, items: [{ id: 'WAIT-1', kind: 'ticket', update: true,
      thread: [{ date: '2026-10-15T10:00:00.000Z', from: 'reporter', text: 'Orders 1001 and 1002.', answers: ['q1'] }], questions: [{ id: 'q2', status: 'dropped' }] }] })).value;
    var r = await MxAssist.apply('pasold2', u);
    var a = (await MxAssist.list('pasold2')).filter(function (x) { return x.id === 'WAIT-1'; })[0];
    // the whole item again, without its conversation and without the questions' statuses: none of it is lost
    await MxAssist.apply('pasold2', JSON.stringify({ format: 'mxscout-assist', version: 1, items: [Object.assign({}, ${JSON.stringify(W)}, { thread: [], status: undefined })] }));
    var b = (await MxAssist.list('pasold2')).filter(function (x) { return x.id === 'WAIT-1'; })[0];
    return JSON.stringify({ update: u.updates.length === 1 && !u.items.length, how: r.changed.map(function (x) { return x.how; }).join(),
      a: [a.status, a.thread.length, a.thread[1].from, a.questions.map(function (q) { return q.id + ':' + q.status; }).join(','), a.history[a.history.length - 1].what].join(' | '),
      b: [b.status, b.thread.length, b.questions.map(function (q) { return q.id + ':' + q.status; }).join(',')].join(' | '), open: MxAssist.openCount(await MxAssist.list('pasold2')) });
  })()`));
  t.ok(conv.update && conv.how === 'updated' && conv.a === 'waiting | 2 | reporter | q1:answered,q2:dropped,q3:open | 1 entry added to the conversation · questions: q2 dropped'.replace('1 entry', 'one entry'),
    'an update appends to the conversation — an entry that answers a question marks it answered — and changes a question’s status by its id, the rest of the item as it was: ' + conv.a);
  t.ok(conv.b === 'waiting | 2 | q1:answered,q2:dropped,q3:open', 'the whole item sent again without its conversation and the questions’ statuses loses neither: ' + conv.b);
  t.ok(conv.open === 3, 'an item waiting for the reporter counts as open');
  const sideW = await mx.waitFor(`(function(){ var s = Array.from(document.querySelectorAll('.tree-section')).map(function (b) { return b.textContent.trim(); }).join('|'); return /Assist3/.test(s) && s; })()`, 5000, 'waiting counted');
  t.ok(/Assist3/.test(sideW), 'and the sidebar counts it');
  await pick('ticket', 'open');
  await mx.waitFor(`!!document.querySelector('.doc-screen .dx-as-li[data-id="WAIT-1"]')`, 5000, 'the waiting ticket');
  const wrows = await mx.evaluate(rowsNow);
  t.ok(/(^|\|)WAIT-1\/Waiting(\||$)/.test(wrows), 'a waiting ticket is listed under Open, with its badge: ' + wrows);
  await mx.evaluate(`document.querySelector('.doc-screen .dx-as-li[data-id="WAIT-1"]').click()`);
  await mx.waitFor(`!!document.querySelector('.doc-screen .dx-as-questions')`, 5000, 'its questions');
  await mx.evaluate(`(function(){ window.__copied = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: function (t) { window.__copied = t; return Promise.resolve(); } } }); return true; })()`);
  const qs = JSON.parse(await mx.evaluate(`(function () { var host = document.querySelector('.doc-screen');
    return JSON.stringify({ cap: host.querySelector('.dx-as-questions .dx-cap').textContent, list: Array.from(host.querySelectorAll('.dx-as-qn')).map(function (q) { return q.getAttribute('data-q') + ':' + (q.querySelector('.dx-as-qst') ? q.querySelector('.dx-as-qst').textContent.split(' ')[0] : 'open') + (q.querySelector('.dx-as-q-why') ? '+why' : ''); }),
      thread: Array.from(host.querySelectorAll('.dx-as-th-e')).map(function (e) { return e.querySelector('.dx-as-by').textContent + ':' + e.querySelector('.dx-as-th-t').textContent; }),
      buttons: Array.from(host.querySelectorAll('.dx-as-bar .dx-as-btns button')).map(function (b) { return b.textContent; }) }); })()`));
  t.ok(qs.cap === 'Questions for the reporter · 1 open' && qs.list.join() === 'q3:open+why,q1:Answered+why,q2:Dropped+why', 'the questions, the open ones first, each with why it is asked: ' + qs.list.join());
  t.ok(qs.thread.join(' / ') === 'Agent:Asked the reporter three questions. / Reporter:Orders 1001 and 1002.' && qs.buttons.join() === 'Back to open,Close,Drop',
    'the conversation, newest last, and the buttons of an item that waits: ' + qs.thread.join(' / '));
  await mx.evaluate(`document.querySelector('.doc-screen .dx-as-copyq').click()`);
  t.ok(await mx.waitFor(`window.__copied`, 3000, 'copied') === '1. When did you run the export?', 'Copy questions copies the open ones as plain text');
  await mx.evaluate(`document.querySelector('.doc-screen .dx-as-add').click()`);
  await mx.evaluate(`(function(){ var host = document.querySelector('.doc-screen'); host.querySelector('.dx-as-answer-t').value = 'Last night, around 23:00.';
    host.querySelector('.dx-as-tick input[value="q3"]').click(); host.querySelector('.dx-as-save').click(); return true; })()`);
  const answered = await mx.waitFor(`(function(){ var s = document.querySelector('.doc-screen .dx-as-now .dx-as-st'); var e = Array.from(document.querySelectorAll('.doc-screen .dx-as-th-e')); return s && s.textContent === 'Open' && e.length === 3 && e[2].textContent; })()`, 5000, 'the answer added');
  const kept2 = JSON.parse(await mx.evaluate(`(async function () { var x = (await MxStore.get('assist', 'pasold2')).items.filter(function (i) { return i.id === 'WAIT-1'; })[0];
    return JSON.stringify({ last: x.thread[2].from + ':' + x.thread[2].answers.join(), q3: x.questions.filter(function (q) { return q.id === 'q3'; })[0].status, h: x.history[x.history.length - 1].by + ':' + x.history[x.history.length - 1].what }); })()`));
  t.ok(/^Reporter.*answers q3Last night, around 23:00\.$/.test(answered) && kept2.last === 'reporter:q3' && kept2.q3 === 'answered' && kept2.h === 'person:Reopened · Added the reporter’s answer (q3)',
    'Add the reporter’s answer appends it as the reporter’s, marks the question it answers, and takes the item from waiting back to open: ' + JSON.stringify(kept2));

  // ---- notes: what the person asked the agent to keep on an item (Karol, 2026-10-16) ----
  const N = { id: 'cancel-rework', kind: 'other', title: 'Rework order cancellation', reported: 'A bigger task: cancelling has to give the stock back.', summary: 'Cancelling only flips the status.',
    story: 'Today it only sets Cancelled.', status: 'in-progress',
    notes: [{ text: 'CancelOrder must roll back the stock', topic: 'Data integrity', refs: ['Sales.CreateOrder', entity] }, { id: 'n5', text: 'Ask finance first' },
      { text: '<b>not markup</b>', topic: 'Data integrity', status: 'done' }] };
  const nt = JSON.parse(await mx.evaluate(`(async function () {
    function env(list) { return JSON.stringify({ format: 'mxscout-assist', version: 1, items: list }); }
    function get() { return MxAssist.list('pasold2').then(function (l) { return l.filter(function (x) { return x.id === 'cancel-rework'; })[0]; }); }
    function sum(it) { return it.notes.map(function (n) { return n.id + ':' + n.status + ':' + (n.topic || '-'); }).join(','); }
    await MxAssist.apply('pasold2', env([${JSON.stringify(N)}]));
    var a = await get();
    var bad = MxAssist.parseEnvelope(env([{ id: 'cancel-rework', kind: 'other', update: true, notes: [{ status: 'done' }] }]));
    await MxAssist.apply('pasold2', env([{ id: 'cancel-rework', kind: 'other', update: true,
      notes: [{ text: 'BulkCancel commits per order', topic: 'Performance', refs: ['Sales.CreateOrder'] }, { id: 'n1', status: 'done' }, { id: 'n5', topic: 'Finance' }] }]));
    var b = await get();
    await MxAssist.set('pasold2', 'other', 'cancel-rework', { note: { id: 'n1', status: 'open' } }, 'person');
    var c = await get();
    // the whole item again, from an older copy: n1 still done there, three notes missing, one new
    await MxAssist.apply('pasold2', env([Object.assign({}, ${JSON.stringify(N)}, { notes: [{ id: 'n1', text: 'CancelOrder must roll back the stock in one transaction', status: 'done' }, { text: 'A new one from the copy' }] })]));
    var d = await get();
    var back = MxAssist.fromFiles(MxAssist.toFiles([d])).items[0];
    return JSON.stringify({ a: sum(a), aText: a.notes[2].text, aDone: !!a.notes[2].done, aRefs: a.notes[0].refs.join(), bad: bad.error || '',
      b: sum(b), bLast: b.history[b.history.length - 1].by + ':' + b.history[b.history.length - 1].what,
      c: sum(c), cHist: c.history.length === b.history.length, cDone: c.notes[0].done,
      d: sum(d), dText: d.notes[0].text, file: JSON.stringify(back.notes) === JSON.stringify(d.notes) });
  })()`));
  t.ok(nt.a === 'n1:open:Data integrity,n5:open:-,n2:done:Data integrity' && nt.aText === '<b>not markup</b>' && nt.aDone && nt.aRefs === 'Sales.CreateOrder,' + entity,
    'an item’s notes are kept with their topic, refs and status — a note sent without an id gets the first free one, its text kept as text: ' + [nt.a, nt.aText, nt.aDone, nt.aRefs].join(' / '));
  t.ok(/a note is sent with its text/.test(nt.bad), 'an update’s note with neither a text nor an id is refused, saying why: ' + nt.bad);
  t.ok(nt.b === 'n1:done:Data integrity,n5:open:Finance,n2:done:Data integrity,n3:open:Performance' && nt.bLast === 'agent:one note added · one note changed · notes: n1 done',
    'an update adds a note, changes one by its id and ticks one off, and says so in the history: ' + nt.b + ' / ' + nt.bLast);
  t.ok(nt.c === 'n1:open:Data integrity,n5:open:Finance,n2:done:Data integrity,n3:open:Performance' && nt.cHist && nt.cDone === null,
    'the person opens a note again by clicking, kept on the note and not in the history: ' + nt.c);
  t.ok(nt.d === 'n1:open:Data integrity,n5:open:Finance,n2:done:Data integrity,n3:open:Performance,n4:open:-' && nt.dText === 'CancelOrder must roll back the stock in one transaction',
    'the item written again whole loses no note, keeps each one’s status as it is now, takes a corrected text and adds the new one: ' + nt.d);
  t.ok(nt.file, 'the notes go into the item’s file and come back from it as they were');

  await pick('other', 'all');
  await mx.waitFor(`!!document.querySelector('.doc-screen .dx-as-li[data-id="cancel-rework"]')`, 5000, 'the workbook');
  const nrow = await mx.evaluate(`(function(){ var o = document.querySelector('.doc-screen .dx-as-kind').selectedOptions[0].textContent, r = document.querySelector('.doc-screen .dx-as-li[data-id="cancel-rework"]'); return o + ' / ' + r.querySelector('.dx-as-kd').textContent + ' / ' + r.querySelector('.dx-as-nc').textContent; })()`);
  t.ok(nrow === 'Workbook · 1 (1 open) / Workbook / 1/5', 'the kind is called Workbook, and its row says how many notes are done: ' + nrow);
  await mx.evaluate(`document.querySelector('.doc-screen .dx-as-li[data-id="cancel-rework"]').click()`);
  const nv = JSON.parse(await mx.waitFor(`(function(){ var host = document.querySelector('.doc-screen'), sec = host.querySelector('.dx-as-notes'); if (!sec) return null;
    return JSON.stringify({ cap: sec.querySelector('.dx-cap').textContent, bar: sec.querySelector('.dx-as-n-bar span').style.width, topics: Array.from(sec.querySelectorAll('.dx-as-n-group')).map(function (g) { return (g.getAttribute('data-topic') || 'General') + (g.hidden ? '(hidden)' : ''); }),
      shown: Array.from(sec.querySelectorAll('.dx-as-n')).filter(function (n) { return !n.hidden; }).map(function (n) { return n.getAttribute('data-note'); }),
      refs: Array.from(sec.querySelectorAll('.dx-as-n[data-note="n1"] .dx-as-n-refs > *')).map(function (c) { return c.textContent + (c.classList.contains('link') ? '+' : ''); }),
      markup: !!sec.querySelector('.dx-as-n b'), conv: !!host.querySelector('.dx-as-thread') }); })()`, 5000, 'the notes'));
  t.ok(nv.cap === 'Notes · 4 of 5 open' && nv.bar === '20%' && nv.topics.join() === 'General,Data integrity,Finance,Performance' && nv.shown.join() === 'n4,n1,n5,n3',
    'the notes, by topic — those without one first — open ones shown, with how far along it is: ' + JSON.stringify(nv));
  t.ok(nv.refs.join() === 'Sales.CreateOrder+,' + entity + '+' && !nv.markup && !nv.conv, 'each element a note names links to the model; a note’s text is never markup; a workbook item has no empty conversation: ' + nv.refs.join());
  await mx.evaluate(`document.querySelector('.doc-screen .dx-as-n-chip[data-show="all"]').click()`);
  const nall = await mx.evaluate(`Array.from(document.querySelectorAll('.doc-screen .dx-as-n')).filter(function (n) { return !n.hidden; }).length`);
  await mx.evaluate(`document.querySelector('.doc-screen .dx-as-n[data-note="n3"] .dx-as-n-box').click()`);
  const ticked = await mx.waitFor(`(function(){ var c = document.querySelector('.doc-screen .dx-as-notes .dx-cap'); return c && c.textContent === 'Notes · 3 of 5 open' && c.textContent; })()`, 5000, 'ticked');
  const n3 = await mx.evaluate(`(async function () { var x = (await MxStore.get('assist', 'pasold2')).items.filter(function (i) { return i.id === 'cancel-rework'; })[0]; return x.notes.filter(function (n) { return n.id === 'n3'; })[0].status; })()`);
  t.ok(nall === 5 && ticked && n3 === 'done', 'All shows every note, and ticking a box marks the note done and saves it: ' + nall + ' / ' + n3);

  // ---- the descriptions of the change: for the business and technical (Karol, 2026-10-16) ----
  const BIZ = { title: 'Cancelling now <gives> the stock back', written: '2026-10-16', summary: 'Cancelling gives the stock back.\n\nAnd refunds.',
    sections: [{ heading: 'What changes', text: '- Agents cancel as before.\n- Stock is right at once, via `Sales.CreateOrder`.' }, { heading: 'Risks', text: 'Old orders keep their figures.' }] };
  const TECH = { written: '2026-10-16', summary: 'One transaction.', sections: [{ heading: 'Model changes', text: '- `Sales.CreateOrder`: change' }] };
  const wu = JSON.parse(await mx.evaluate(`(async function () {
    function env(list) { return JSON.stringify({ format: 'mxscout-assist', version: 1, items: list }); }
    function get() { return MxAssist.list('pasold2').then(function (l) { return l.filter(function (x) { return x.id === 'cancel-rework'; })[0]; }); }
    var bad = MxAssist.parseEnvelope(env([{ id: 'cancel-rework', kind: 'other', update: true, business: { title: 'only a title' } }]));
    await MxAssist.apply('pasold2', env([{ id: 'cancel-rework', kind: 'other', update: true, updated: '2026-10-16', business: ${JSON.stringify(BIZ)}, technical: ${JSON.stringify(TECH)} }]));
    var a = await get();
    await MxAssist.apply('pasold2', env([Object.assign({}, ${JSON.stringify(N)}, { notes: [] })]));
    var b = await get();
    var md = MxDocsAssist.asMarkdown(b, 'business'), html = MxDocsAssist.asHtml(b, 'business', false), mail = MxDocsAssist.asHtml(b, 'business', true);
    return JSON.stringify({ bad: bad.error || '', hist: a.history[a.history.length - 1].what, kept: !!b.business && !!b.technical && b.business.sections.length === 2,
      md: md, html: html, mail: mail });
  })()`));
  t.ok(/"business" needs a summary or at least one section/.test(wu.bad), 'a description with neither a summary nor a section is refused, saying why: ' + wu.bad);
  t.ok(wu.hist === 'Business description written · Technical description written' && wu.kept,
    'an update writes both descriptions, says so in the history, and the item written again whole keeps them: ' + wu.hist);
  t.ok(wu.md === '# Cancelling now <gives> the stock back\n\n*Business description · Workbook cancel-rework · 2026-10-16*\n\nCancelling gives the stock back.\n\nAnd refunds.\n\n## What changes\n\n- Agents cancel as before.\n- Stock is right at once, via `Sales.CreateOrder`.\n\n## Risks\n\nOld orders keep their figures.\n',
    'Markdown: the title, what it is, the summary, each section with its heading, lists and names as written: ' + JSON.stringify(wu.md));
  t.ok(/^<!doctype html>\n<html lang="en">/.test(wu.html) && /<title>Cancelling now &lt;gives&gt; the stock back<\/title>/.test(wu.html) && /<ul><li>Agents cancel as before\.<\/li><li>Stock is right at once, via <code>Sales\.CreateOrder<\/code>\.<\/li><\/ul>/.test(wu.html)
    && !/<gives>/.test(wu.html) && !/<script|<link|src=/.test(wu.html),
    'HTML: a whole page, every text escaped, lists and names drawn, nothing loaded from anywhere');
  t.ok(/^<div style="/.test(wu.mail) && !/<style|<html/.test(wu.mail) && /<code style="/.test(wu.mail), 'for an e-mail: a fragment with its styles on each element, no <style> a mail program would drop');

  await mx.waitFor(`!!document.querySelector('.doc-screen .dx-as-wu-seg')`, 5000, 'the descriptions drawn');
  const panes = JSON.parse(await mx.evaluate(`JSON.stringify({ tabs: Array.from(document.querySelectorAll('.doc-screen .dx-as-itab')).map(function (b) { return b.textContent + (b.classList.contains('on') ? '*' : ''); }),
    work: !document.querySelector('.doc-screen .dx-as-pane[data-pane="work"]').hidden, desc: !document.querySelector('.doc-screen .dx-as-pane[data-pane="desc"]').hidden,
    notesIn: !!document.querySelector('.doc-screen .dx-as-pane[data-pane="work"] .dx-as-notes'), wuIn: !!document.querySelector('.doc-screen .dx-as-pane[data-pane="desc"] .dx-as-wu') })`));
  await mx.evaluate(`document.querySelector('.doc-screen .dx-as-itab[data-pane="desc"]').click()`);
  const descShown = await mx.evaluate(`!document.querySelector('.doc-screen .dx-as-pane[data-pane="desc"]').hidden && document.querySelector('.doc-screen .dx-as-pane[data-pane="work"]').hidden`);
  t.ok(panes.tabs.join('|') === 'Work3 open*|Descriptionbusiness · technical' && panes.work && !panes.desc && panes.notesIn && panes.wuIn && descShown,
    'the item opens on Work — the notes, the solving, the conversation — and the descriptions are a tab of their own, entered by a click: ' + JSON.stringify(panes));
  const wv = JSON.parse(await mx.evaluate(`(function () { var sec = document.querySelector('.doc-screen .dx-as-wu');
    return JSON.stringify({ seg: Array.from(sec.querySelectorAll('.dx-as-wu-seg button')).map(function (b) { return b.textContent + (b.classList.contains('on') ? '*' : ''); }),
      title: sec.querySelector('.dx-as-wu-t').textContent, lead: sec.querySelectorAll('.dx-as-wu-lead p').length, heads: Array.from(sec.querySelectorAll('.dx-as-wu-h')).map(function (x) { return x.textContent; }),
      code: Array.from(sec.querySelectorAll('.dx-as-wu-body code')).map(function (x) { return x.textContent; }), tools: Array.from(sec.querySelectorAll('.dx-as-wu-tools button')).map(function (b) { return b.textContent; }) }); })()`));
  t.ok(wv.seg.join() === 'Business*,Technical' && wv.title === BIZ.title && wv.lead === 2 && wv.heads.join() === 'What changes,Risks' && wv.code.join() === 'Sales.CreateOrder'
    && wv.tools.join() === 'Copy for e-mail,HTML,Markdown',
    'the business description on the item: its title as text, the summary in a box, the sections, names as code, Copy for e-mail, HTML and Markdown: ' + JSON.stringify(wv));
  await mx.evaluate(`document.querySelector('.doc-screen .dx-as-wu-seg button[data-wu="technical"]').click()`);
  await mx.evaluate(`(function(){ window.__copied = null; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: function (t) { window.__copied = t; return Promise.resolve(); } } }); return true; })()`);
  const tcopy = await mx.evaluate(`document.querySelector('.doc-screen .dx-as-wu-copy').textContent`);
  await mx.evaluate(`document.querySelector('.doc-screen .dx-as-wu-copy').click()`);
  const copiedMd = await mx.waitFor(`window.__copied`, 3000, 'copied');
  t.ok(tcopy === 'Copy Markdown' && /^# Rework order cancellation\n\n\*Technical description · Workbook cancel-rework · 2026-10-16\*\n\nOne transaction\.\n\n## Model changes\n\n- `Sales\.CreateOrder`: change\n$/.test(copiedMd),
    'Technical shows the other one, and Copy Markdown puts it on the clipboard as Markdown: ' + JSON.stringify(copiedMd));

  // ---- the limit refuses what is new, and never drops what is kept (an external audit, 2026-10-15, B07) ----
  // The audit added a case to 2000 open ones: case-0 was gone, and the result said only that one was added.
  const lim = JSON.parse(await mx.evaluate(`(async function () {
    var now = new Date().toISOString(), items = [];
    for (var i = 0; i < 2000; i++) items.push({ id: 'case-' + i, kind: 'other', title: 'Case ' + i, status: 'open', created: now, updated: now, history: [], questions: [], thread: [], language: 'en', sources: [] });
    await MxStore.put('assist', { projectId: 'plim', items: items, migrated: null, updatedAt: now });
    MxAssist.forget('plim');
    var env = function (list) { return JSON.stringify({ format: 'mxscout-assist', version: 1, items: list }); };
    var refused = await MxAssist.apply('plim', env([{ id: 'case-2000', kind: 'other', title: 'One too many' }])).then(function () { return 'saved'; }, function (e) { return e.message; });
    var r = await MxStore.get('assist', 'plim');
    var upd = await MxAssist.apply('plim', env([{ id: 'case-0', kind: 'other', update: true, status: 'done' }, { id: 'case-1', kind: 'other', title: 'Case 1, written again' }])).then(function (x) { return x.changed.length; }, function (e) { return e.message; });
    var r2 = await MxStore.get('assist', 'plim');
    var big = [];
    for (var j = 0; j < 2001; j++) big.push({ id: 'b-' + j, kind: 'other', title: 'B' });
    var parsed = MxAssist.parseEnvelope(env(big)).value;
    return JSON.stringify({ refused: refused, n: r.items.length, first: r.items[0].id, upd: upd, n2: r2.items.length, st: r2.items[0].status, t1: r2.items[1].title, cut: parsed.items.length, said: parsed.dropped[0] });
  })()`));
  t.ok(/^Nothing was saved, and nothing was removed: MxScout keeps at most 2000 items on the Assist page of one project, this one has 2000, and one more would pass it\./.test(lim.refused) && /never drops an item to make room/.test(lim.refused),
    'a new item past the limit refuses the file, saying the limit, that nothing was removed and what still works: ' + lim.refused);
  t.ok(lim.n === 2000 && lim.first === 'case-0', 'and every item kept stays — case-0 first among them');
  t.ok(lim.upd === 2 && lim.n2 === 2000 && lim.st === 'done' && lim.t1 === 'Case 1, written again', 'an update, or an item written again in its own place, still goes through at the limit');
  t.ok(lim.cut === 2000 && /^items 2001–2001: a file carries at most 2000 items; send the rest in another$/.test(lim.said), 'a file with more items than a project keeps says which were left out — never cut off silently: ' + lim.said);
  await mx.close();
};
