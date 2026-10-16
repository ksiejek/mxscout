/* Changes: a change the person asked for, worked out by an agent (Karol, 2026-10-14: "I have a change I
 * want to make — show me how it works now and what the solution would be, as changes, not as a process").
 *
 * The same three programs meet as for the descriptions (test 48), so the same three are held here:
 *  - the skill's checker: a part that adds a change passes; a bad change is an error or a warning, by
 *    whether MxScout would drop it or only show it worse; merge replaces a change by its id;
 *  - MxScout's reading of the file: a change kept as text, bounded, laid over what is kept by its id;
 *  - what the person sees: since 2026-10-15 a change is an idea on the Assist page (tests 86 to 88):
 *    the changes a descriptions file carries move there, its Ideas tab lists them, one change shows how
 *    it works now and the proposal, both drawn, the model changes with links to what is there and "new"
 *    on what is not; the exported file and its Markdown copy no longer carry them. */
'use strict';
const { goToSection, readText } = require('./helpers');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { readPack, todo, check, merge } = require(path.join(__dirname, '..', 'skills', 'mendix-describe', 'check-descriptions.js'));

module.exports = async function (t) {
  const SKILL = path.join(__dirname, '..', 'skills', 'mendix-describe');
  const skillText = readText(path.join(SKILL, 'SKILL.md'));
  t.ok(/## A change, when the person asks/.test(skillText) && /You never change the model itself/.test(skillText),
    'the skill has a flow for a change, and says it proposes rather than changes the model');
  // The older format, kept for reading an older file only (reference/migration.md; audit 2026-10-15, B11).
  const format = readText(path.join(SKILL, 'reference', 'migration.md'));
  const example = JSON.parse((/```json\n(\{\n  "format": "mxscout-descriptions",\n  "version": 1,\n  "add": true,[\s\S]*?)\n```/.exec(format) || [])[1] || 'null');
  t.ok(example && example.changes && example.changes.length === 1 && example.changes[0].proposal.changes.length >= 3,
    'migration.md carries a full example of an older file’s change, and it is JSON');

  // ---- the pack, from the real exporter ----
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxDescribe && !!window.MxDocsData && !!window.MxDocsChanges', 15000, 'MxScout loaded');
  await mx.viewport(1440, 900);
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const text = await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    window.__chModel = model;
    await MxStore.saveProjectWithModel({ id: 'pchg', name: 'ChangeDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, model);
    await MxStore.saveProjectWithModel({ id: 'pnochg', name: 'NoChangeDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, model);
    return MxDescribe.pack(MxDocsData.build(model, { name: 'ChangeDemo' })).text;
  })()`);
  const pack = readPack(text);
  const flows = Object.keys(pack.microflows);
  const entity = Object.keys(pack.entities)[0];
  const FLOW2 = flows.filter((n) => n !== 'Sales.CreateOrder')[0];
  t.ok(flows.indexOf('Sales.CreateOrder') !== -1 && entity && FLOW2, 'the pack has flows and an entity to name: ' + [flows.join(','), entity].join(' · '));

  const STORY = 'A clerk opens the order page and presses New order. Sales.CreateOrder makes the order, gives it its number and opens it for editing, and the clerk adds the lines the customer asked for.\n\n' +
    'Once saved, the order waits until it is shipped. Nothing in the model lets anyone take an order back: there is no status for it and no flow that sets one.';
  const LONG = STORY.split('\n\n').map((p) => [p, p, p].join(' ')).join('\n\n');
  const change = {
    id: 'cancel-order', title: 'Customers can cancel an order until it ships', asked: 'A customer should be able to cancel their order as long as it has not shipped.',
    date: '2026-10-14', status: 'proposed',
    now: { summary: 'An order, once saved, can only go forward.', story: LONG,
      steps: ['A clerk opens a new order for the customer', 'The application numbers the order and saves it', 'The order waits until it is shipped'],
      flows: ['Sales.CreateOrder', FLOW2],
      diagram: [{ step: 'Opens a new order', who: 'Clerk' }, { decision: 'Is the customer known?', ways: [{ label: 'no', end: 'The order waits' }, { label: 'yes' }] }, { step: 'Numbers and saves it', by: 'app' }, { end: 'Saved' }] },
    proposal: { summary: 'A Cancel button on the order, shown until it ships, sets a new status Cancelled.', story: LONG,
      steps: ['The customer opens the order and presses Cancel', 'The application checks the order has not shipped', 'The application sets the order to Cancelled'],
      diagram: [{ step: 'Presses Cancel', who: 'Customer' }, { decision: 'Shipped already?', ways: [{ label: 'yes', end: 'Refused with a message' }, { label: 'no' }] }, { step: 'Sets the status to Cancelled', by: 'app' }, { end: 'Cancelled' }],
      changes: [
        { kind: 'microflow', target: 'Sales.ACT_Order_Cancel', action: 'add', what: 'Checks the order has not shipped and sets it to Cancelled.' },
        { kind: 'microflow', target: 'Sales.CreateOrder', action: 'change', what: 'Sets the new status on create.' },
        { kind: 'entity', target: entity, action: 'change', what: 'Gets a CancelledOn date.' },
        { kind: 'enumeration', target: 'Sales.ENUM_OrderStatus', action: 'change', what: 'Gets the value Cancelled.' }
      ] },
    impact: { flows: ['Sales.CreateOrder'], roles: ['Customer', 'Clerk'], data: 'Existing orders keep their status; none is cancelled.' },
    risks: [{ level: 'P2', title: 'A shipped order could still be cancelled', detail: 'If the shipping flow does not lock the order.', fix: 'Check the status inside the flow, not only on the button.' }],
    open: ['Can a clerk cancel on the customer’s behalf?'], effort: 'small: one new flow, one changed flow and an enumeration value'
  };
  const part = { format: 'mxscout-descriptions', version: 1, add: true, changes: [change] };

  // ---- the checker ----
  const ok = check(pack, part);
  t.ok(ok.filter((p) => p.level === 'error').length === 0 && !ok.some((p) => /cancel-order/.test(p.text) && !/Sales\.ENUM/.test(p.text)),
    'a part that adds one change passes the check, and is not asked for the application’s overview: ' + JSON.stringify(ok.map((p) => p.text)));
  t.ok(todo(pack, part).flows === todo(pack, null).flows, 'todo is not affected by changes');
  const bad = JSON.parse(JSON.stringify(part));
  bad.changes.push({ id: 'Cancel Order', title: '' }, JSON.parse(JSON.stringify(change)));
  const b = bad.changes[0];
  b.now.story = STORY; b.now.flows.push('Sales.NoSuchFlow'); b.now.diagram.push({ note: 'x' });
  b.proposal.changes.push({ kind: 'widget', target: 'Sales.Somewhere', action: 'rename' }, { kind: 'microflow', target: 'Sales.Ghost', action: 'remove', what: 'Gone.' });
  b.proposal.diagram = [{ step: 'Presses Cancel' }, { end: 'Cancelled' }];
  delete b.asked;
  const bp = check(pack, bad).map((p) => p.level + ' ' + p.text);
  const has = (re) => bp.some((x) => re.test(x));
  t.ok(has(/^error change "Cancel Order": "id" must be a slug/) && has(/^error change "Cancel Order": no "title"/) && has(/^error change "cancel-order": the id is used twice/),
    'an id that is no slug, a change without a title and an id used twice are errors — MxScout drops them');
  t.ok(has(/^warning change "cancel-order" now: the story is \d+ words — how it works now follows one case/) && has(/^warning change "cancel-order": no "asked"/),
    'how it works now told in a paragraph, and a change without the request, are warned about');
  t.ok(has(/^warning change "cancel-order" now names Sales\.NoSuchFlow, which is not in the pack/) && has(/^warning .*Sales\.Ghost is not in the pack — to change or remove it/) &&
    !has(/Sales\.ACT_Order_Cancel/),
    'a flow it names that is not in the pack, and a target it changes or removes that is not there, are warned about — a target it adds is not');
  t.ok(has(/^error .*proposal\.changes\[4\]: "action" must be one of add, change, remove/) && has(/^warning .*proposal\.changes\[4\]: "kind" "widget" is not one of/),
    'a model change with an unknown action is an error, one with an unknown kind a warning');
  t.ok(has(/^error change "cancel-order" now: diagram\[4\] is neither a "step", a "decision" nor an "end"/) && has(/^warning change "cancel-order" proposal: its diagram has no decision/),
    'both diagrams are checked by the rules a process’s diagram is');
  const grown = merge([{ format: 'mxscout-descriptions', version: 1, changes: [Object.assign({}, change, { id: 'other' }), change] },
    { format: 'mxscout-descriptions', version: 1, add: true, changes: [Object.assign({}, change, { title: 'Told again' }), Object.assign({}, change, { id: 'third' })] }]);
  t.ok(grown.changes.map((c) => c.id + ':' + c.title.slice(0, 10)).join('|') === 'other:Customers |cancel-order:Told again|third:Customers ',
    'merge replaces a change by its id and adds a new one at the end: ' + JSON.stringify(grown.changes.map((c) => c.id)));

  // ---- MxScout's own reading ----
  const read = JSON.parse(await mx.evaluate(`(function () {
    var base = MxDescribe.parse(JSON.stringify({ format: 'mxscout-descriptions', version: 1, microflows: { 'Sales.CreateOrder': 'Opens an order.' }, changes: [Object.assign({}, ${JSON.stringify(change)}, { id: 'old-one' }), ${JSON.stringify(change)}] })).value;
    var more = MxDescribe.parse(${JSON.stringify(JSON.stringify(part))}).value;
    var odd = MxDescribe.parse(JSON.stringify({ format: 'mxscout-descriptions', version: 1, changes: [
      { id: 'Not A Slug', title: 'x' }, { id: 'no-title' }, { id: 'odd', title: '<b>t</b>', status: 'maybe', proposal: { changes: [{ kind: 'Widget', target: 'A.B', action: 'add' }, { kind: 'page', target: 'A.C', action: 'rename' }, { kind: 'page', action: 'add' }] } },
      { id: 'odd', title: 'second with the same id' }] })).value;
    var m = MxDescribe.merge(base, Object.assign({}, more, { changes: [Object.assign({}, more.changes[0], { title: 'Told again' }), Object.assign({}, more.changes[0], { id: 'new-one' })] }));
    var round = MxDescribe.parse(JSON.stringify(MxDescribe.toFile(m))).value;
    return JSON.stringify({ only: !!more && more.changes.length === 1 && more.add === true, kept: base.changes[1].proposal.changes.length,
      odd: odd.changes.map(function (c) { return [c.id, c.title, c.status, c.proposal.changes.map(function (x) { return x.kind + ':' + x.action; }).join(',')].join(' '); }),
      merged: m.changes.map(function (c) { return c.id + ':' + c.title; }), flow: !!m.microflows['Sales.CreateOrder'],
      round: !round.changes.length && !!round.microflows['Sales.CreateOrder'] });
  })()`));
  t.ok(read.only && read.kept === 4, 'a file holding only a change is read, its model changes kept: ' + JSON.stringify(read));
  t.ok(read.odd.length === 1 && read.odd[0] === 'odd <b>t</b> proposed other:add', 'a change without a slug id or a title is dropped, a second with the same id too, an unknown status reads as proposed, an unknown kind as other, and a model change with an unknown action or no target is dropped — the rest kept as text: ' + JSON.stringify(read.odd));
  t.ok(read.merged.join('|') === 'old-one:Customers can cancel an order until it ships|cancel-order:Told again|new-one:Customers can cancel an order until it ships' && read.flow,
    'on import, a part that adds replaces a change by its id and adds a new one, the rest kept: ' + JSON.stringify(read.merged));
  t.ok(read.round, 'a package does not carry changes — they are Assist items, which stay in this browser (toFile, then parse)');

  // ---- the sidebar: no Changes section; the changes are counted on Assist ----
  await mx.evaluate(`MxStore.put('descriptions', { projectId: 'pchg', importedAt: new Date().toISOString(), fileName: 'd.json', value: MxDescribe.parse(${JSON.stringify(JSON.stringify({ format: 'mxscout-descriptions', version: 1,
    microflows: { 'Sales.CreateOrder': { text: 'Opens a fresh order.' } }, changes: [change, Object.assign({}, change, { id: 'second', title: 'A second change', status: 'accepted' })] }))}).value })`);
  const SW = "(function(q){var s=document.querySelector('.switcher[aria-expanded=\"false\"]'); if (s) s.click(); return document.querySelectorAll(q);})";
  async function open(name) {
    await mx.navigate(t.MX);
    await mx.waitFor(`!!Array.from(${SW}('.tree-project')).find(b => b.textContent.indexOf(${JSON.stringify(name)}) !== -1)`, 10000, 'project');
    await mx.evaluate(`Array.from(${SW}('.tree-project')).find(b => b.textContent.trim().indexOf(${JSON.stringify(name)}) === 0).click()`);
    await mx.waitFor(`!!Array.from(document.querySelectorAll('.tree-section')).find(b => /^Overview/.test(b.textContent))`, 8000, 'sections');
  }
  const sections = () => mx.evaluate(`Array.from(document.querySelectorAll('.tree-section')).map(function (b) { return b.textContent.trim(); }).join('|')`);
  await open('NoChangeDemo');
  await new Promise((r) => setTimeout(r, 300));
  t.ok(!/Changes/.test(await sections()), 'a project with no changes has no Changes in its sidebar: ' + await sections());
  await open('ChangeDemo');
  const side = await mx.waitFor(`(function(){ var s = Array.from(document.querySelectorAll('.tree-section')).map(function (b) { return b.textContent.trim(); }).join('|'); return /Assist2/.test(s) && s; })()`, 8000, 'changes counted on Assist');
  t.ok(!/Changes/.test(side) && /Risks\|Assist2\|Solved cases\|Model quality/.test(side), 'one with changes has no Changes section: they are counted on Assist, open and in progress: ' + side);

  // ---- the screen: the Ideas tab, then one change ----
  await goToSection(mx, 'Assist', '.doc-screen .dx-as');
  await mx.evaluate(`(function(){ var s = document.querySelector('.doc-screen .dx-as-kind'); s.value = 'idea'; s.dispatchEvent(new Event('change')); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.doc-screen .dx-as-li')`, 5000, 'the ideas');
  const list = JSON.parse(await mx.evaluate(`(function () { var rows = Array.from(document.querySelectorAll('.doc-screen .dx-as-li')).filter(function (r) { return !r.parentNode.hidden; });
    return JSON.stringify({ h1: document.querySelector('.xe-head h1').textContent, rows: rows.map(function (r) { return r.querySelector('b').textContent + '/' + r.querySelector('.dx-as-st').textContent; }),
      summary: (rows[0].querySelector('.dx-as-ls') || {}).textContent, side: rows.length }); })()`));
  t.ok(list.h1 === 'Assist' && list.rows.join('|') === 'Customers can cancel an order until it ships/Open|A second change/In progress' && /Cancel button/.test(list.summary) && list.side === 2,
    'Ideas, chosen in the list, has every change with its status — proposed is open, accepted in progress — and the proposal in a line: ' + JSON.stringify(list));
  await mx.evaluate(`Array.from(document.querySelectorAll('.doc-screen .dx-as-li')).find(function (r) { return /cancel an order/.test(r.textContent); }).click()`);
  await mx.waitFor(`!!document.querySelector('.doc-screen .dx-ch-cols')`, 5000, 'one change');
  const one = JSON.parse(await mx.evaluate(`(function () {
    var host = document.querySelector('.doc-screen');
    var cols = Array.from(host.querySelectorAll('.dx-ch-col')).map(function (c) { var r = c.getBoundingClientRect(); return { cap: c.querySelector('.dx-cap').textContent, left: Math.round(r.left), top: Math.round(r.top), graphs: c.querySelectorAll('.dx-pd-diagram .fg').length, paras: c.querySelectorAll('.dx-pd-story p').length, steps: c.querySelectorAll('.dx-ch-steps li').length }; });
    var rows = Array.from(host.querySelectorAll('.dx-ch-table tbody tr:not(.dx-ch-kind)')).map(function (tr) { var t = tr.querySelector('.dx-ch-target'); return tr.querySelector('.dx-ch-act').textContent + ' ' + t.firstChild.textContent + (t.querySelector('.link') ? ' (link)' : '') + (t.querySelector('.dx-ch-new') ? ' (new)' : ''); });
    return JSON.stringify({ asked: (host.querySelector('.dx-ch-asked p') || {}).textContent, cols: cols, kinds: Array.from(host.querySelectorAll('.dx-ch-kind th')).map(function (x) { return x.textContent; }), rows: rows,
      decisions: Array.from(host.querySelectorAll('.dx-pd-diagram .fg-dec-title')).map(function (x) { return x.textContent; }),
      flowLinks: host.querySelectorAll('.dx-ch-col.now .dx-pd-flow').length, risk: (host.querySelector('.dx-ch-risk .dx-lv') || {}).textContent, open: host.querySelectorAll('.dx-ch-open li').length,
      ai: /✦ AI/.test((host.querySelector('.dx-ch .dx-prov') || {}).textContent), roles: Array.from(host.querySelectorAll('.dx-ch-role')).map(function (x) { return x.textContent; }).join(',') });
  })()`));
  t.ok(one.asked === 'A customer should be able to cancel their order as long as it has not shipped.', 'one change opens with the request as it was asked, quoted');
  t.ok(one.cols.length === 2 && one.cols[0].cap === 'How it works now' && one.cols[1].cap === 'Proposed solution' && one.cols[0].top === one.cols[1].top && one.cols[1].left > one.cols[0].left,
    'how it works now and the proposed solution side by side on a wide screen: ' + JSON.stringify(one.cols));
  t.ok(one.cols.every((c) => c.graphs === 1 && c.paras === 2 && c.steps === 3) && one.decisions.join('|') === 'Is the customer known?|Shipped already?',
    'each with its steps, its story in paragraphs and its own diagram, drawn as a flow is: ' + JSON.stringify(one.decisions));
  t.ok(one.kinds.map((k) => k.replace(/\s*\d+$/, '')).join('|') === 'Entities|Enumerations|Microflows', 'the model changes are grouped by kind: ' + JSON.stringify(one.kinds));
  t.ok(one.rows.indexOf('Add Sales.ACT_Order_Cancel (new)') !== -1 && one.rows.indexOf('Change Sales.CreateOrder (link)') !== -1 && one.rows.indexOf('Change ' + entity + ' (link)') !== -1 && one.rows.indexOf('Change Sales.ENUM_OrderStatus') !== -1,
    'a target the model has is a link, one the change adds is marked new, one this documentation cannot open is plain: ' + JSON.stringify(one.rows));
  t.ok(one.flowLinks === 2 && one.risk === 'P2' && one.open === 1 && one.roles === 'Customer,Clerk' && one.ai, 'its flows, impact, risks and open questions are there, and it is marked as an agent’s');
  await mx.viewport(800, 900);
  const narrow = JSON.parse(await mx.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('.doc-screen .dx-ch-col')).map(function (c) { return Math.round(c.getBoundingClientRect().top); }))`));
  t.ok(narrow[1] > narrow[0], 'and one under the other on a narrow one: ' + JSON.stringify(narrow));
  await mx.viewport(1440, 900);
  await mx.evaluate(`Array.from(document.querySelectorAll('.doc-screen .dx-ch-target .link')).find(function (a) { return a.textContent === 'Sales.CreateOrder'; }).click()`);
  const landed = await mx.waitFor(`(function(){ var h = document.querySelector('.xe-head h1'), on = document.querySelector('.mf-row.on'); return h && h.textContent === 'Microflows' && on ? on.textContent : null; })()`, 5000, 'flow');
  t.ok(/CreateOrder/.test(landed), 'a flow a change names opens on the Microflows screen: ' + landed);

  // ---- the exported file and its Markdown copy: no change in them ----
  await goToSection(mx, 'Documentation');
  await mx.waitFor(`!!window.MxDocs.current()`, 8000, 'the documentation built');
  const html = await mx.evaluate(`(async function () {
    var data = JSON.parse(JSON.stringify(window.MxDocs.current()));
    return window.MxDocs.buildFile(data, await window.MxDocs.stylesheet(), data.project, await window.MxDocs.flowScripts());
  })()`);
  const md = await mx.evaluate(`MxDocsView.markdown(MxDocs.current())`);
  t.ok(!/^## Changes$/m.test(md) && md.indexOf('Customers can cancel an order') === -1 && html.indexOf('Customers can cancel an order') === -1 && html.indexOf('Opens a fresh order.') !== -1,
    'the exported file and its Markdown copy carry the descriptions, and no change');
  const server = http.createServer(function (req, res) { res.setHeader('Content-Type', 'text/html'); res.end(html); });
  const port = await new Promise(function (resolve) { server.listen(0, '127.0.0.1', function () { resolve(server.address().port); }); });
  try {
    const ex = await t.tab('http://127.0.0.1:' + port + '/#/changes/cancel-order');
    await ex.viewport(1440, 900);
    await ex.waitFor(`!!document.querySelector('#doc .dx[data-view="start"]')`, 8000, 'the file opens on the Overview');
    const nav = await ex.evaluate(`Array.from(document.querySelectorAll('.dx-nav-item')).map(function (b) { return b.querySelector('.dx-nav-label').textContent; }).join('|')`);
    t.ok(!/Changes|Assist/.test(nav), 'an old address of a change opens the file’s Overview, and its menu has no Changes or Assist page: ' + nav);
  } finally { server.close(); }

  // A project whose descriptions were imported before changes existed draws as it did.
  const old = await mx.evaluate(`(function () { var d = JSON.parse(JSON.stringify(MxDocs.current())); delete d.ai.changes; var host = document.createElement('div'); var v = MxDocsView.mount(d, host, { preview: true, state: { view: 'changes' } }); return v.state().view + ':' + v.pages().indexOf('changes'); })()`);
  t.ok(old === 'start:-1', 'data without changes has no Changes page, and an address to one opens the Overview: ' + old);
};
