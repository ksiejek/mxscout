/* The Microflows screen — the redesign's way of reading one flow (private
 * spec 02): the list with its triage, the flow drawn DRAKON-style, tracing a
 * variable through it, the step inspector with every detail of the action,
 * the flow as a whole, and the Studio Pro view with its properties dialogs.
 *
 * Built on the same real .mpr fixture as the documentation tests, so every
 * step, decision and loop below is one the reader actually read, with an
 * imported descriptions file for the agent's text and risks. */
'use strict';
const { goToSection, readText } = require('./helpers');
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxMicroflows && !!window.MxStudioView && !!window.MxFlowTrace', 15000, 'MxScout loaded');
  await mx.viewport(1440, 900);
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const desc = {
    format: 'mxscout-descriptions', version: 1,
    microflows: { 'Sales.CreateOrder': { text: 'Opens a fresh order for a customer.' } },
    risks: [{ level: 'P2', title: 'The order Number is a fixed letter', detail: 'Every order gets the same Number.', fix: 'Number the orders.', where: ['Sales.CreateOrder'] }]
  };
  await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    await MxStore.saveProjectWithModel({ id: 'pmf', name: 'FlowDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null, devTools: true }, model);
    await MxStore.put('descriptions', { projectId: 'pmf', importedAt: new Date().toISOString(), fileName: 'd.json',
      value: MxDescribe.parse(${JSON.stringify(JSON.stringify(desc))}).value });
  })()`);
  const SW = "(function(q){var s=document.querySelector('.switcher[aria-expanded=\"false\"]'); if (s) s.click(); return document.querySelectorAll(q);})";
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(${SW}('.tree-project')).find(b => b.textContent.indexOf('FlowDemo') !== -1)`, 10000, 'project');
  await mx.evaluate(`Array.from(${SW}('.tree-project')).find(b => b.textContent.indexOf('FlowDemo') !== -1).click()`);
  await goToSection(mx, 'Microflows', '.mf-mods, .mf-grid');
  await mx.evaluate(`(function(){ var s = document.querySelector('.xe-head .role-select'); s.value = 'all'; s.dispatchEvent(new Event('change')); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.mf-mods')`, 8000, 'the modules');

  // ---- nothing picked yet: the modules first (Karol, 2026-10-13) ----
  const mods = await mx.evaluate(`Array.from(document.querySelectorAll('.mf-mod-card')).map(function (c) { return c.textContent; }).join('|')`);
  t.ok(/(^|\|)Sales2 microflows · 1 with risksP2(\||$)/.test(mods), 'the screen starts on the modules, each with how many flows and how many carry a risk: ' + mods);
  await mx.evaluate(`Array.from(document.querySelectorAll('.mf-mod-card')).find(function (c) { return /^Sales/.test(c.textContent); }).click()`);
  await mx.waitFor(`!!document.querySelector('.mf-grid')`, 8000, 'the module');

  // ---- layout at 1440: the list, the flow top to bottom, the panel beside it (Workflow, the default) ----
  const lay = JSON.parse(await mx.evaluate(`JSON.stringify({
    list: Math.round(document.querySelector('.mf-list').getBoundingClientRect().width),
    side: !!document.querySelector('.mf-side'), cards: document.querySelectorAll('.mf-canvas .fg-card').length,
    actions: Array.from(document.querySelectorAll('.mf-actions button')).map(function (b) { return b.textContent; }).join('|')
  })`));
  t.ok(lay.list === 306 && lay.side && lay.cards > 0, 'at 1440 the list is 306px, the flow drawn top to bottom with the panel beside it: ' + JSON.stringify(lay));
  t.ok(lay.actions === 'Workflow|Modeler|+ Context|Run…|Add comment', 'the flow’s actions, the switch between the two views first, then + Context (basket.js): ' + lay.actions);

  // ---- the list ----
  const rows = () => mx.evaluate(`Array.from(document.querySelectorAll('.mf-row')).map(function (r) { return r.textContent; }).join(',')`);
  t.ok(await rows() === 'CreateOrderP2,SweepOrders', 'a row is its name and one badge, the highest level: ' + await rows());
  const tri = await mx.evaluate(`Array.from(document.querySelectorAll('.mf-list .xe-seg')).map(function (b) { return b.textContent; }).join('|')`);
  t.ok(tri === 'All2|With risks1|No callers' + await mx.evaluate(`String(document.querySelectorAll('.mf-row .xe-tag').length)`), 'the triage counts come from the data: ' + tri);
  await mx.evaluate(`Array.from(document.querySelectorAll('.mf-list .xe-seg')).find(function (b) { return /With risks/.test(b.textContent); }).click()`);
  t.ok(await rows() === 'CreateOrderP2', 'With risks keeps only the flows a risk names');
  await mx.evaluate(`Array.from(document.querySelectorAll('.mf-list .xe-seg')).find(function (b) { return /^All/.test(b.textContent); }).click()`);
  await mx.evaluate(`document.querySelector('.mf-list .xe-sort').click()`);
  t.ok(await mx.evaluate(`document.querySelector('.mf-list .xe-sort').getAttribute('title')`) === 'Sorted by steps — switch to A to Z', 'the sort switches to steps and says so');
  t.ok(/^SweepOrders/.test(await rows()), 'and the flow with more steps comes first, its count not shown: ' + await rows());
  await mx.evaluate(`document.querySelector('.mf-list .xe-sort').click()`);
  t.ok(await mx.evaluate(`document.querySelector('.mf-row.on').getAttribute('aria-current')`) === 'true', 'the chosen row is marked as current');

  // ---- Workflow: a step picked in the drawing is read in the panel; a variable is traced ----
  await mx.evaluate(`Array.from(document.querySelectorAll('.mf-row')).find(function (r) { return /SweepOrders/.test(r.textContent); }).click()`);
  await mx.evaluate(`document.querySelector('.fg-decision').click()`);
  t.ok(await mx.evaluate(`document.querySelector('.fg-decision').classList.contains('on') && /^Step \\d+ · Decision/.test(document.querySelector('.mf-side .mf-step-kick').textContent)`),
    'Workflow: a click on a decision picks it and the panel shows it');
  await mx.evaluate(`Array.from(document.querySelectorAll('.mf-row')).find(function (r) { return /CreateOrder/.test(r.textContent); }).click()`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.mf-trace-row .mf-chip')).find(function (c) { return c.textContent === '$Order'; }).click()`);
  t.ok(await mx.evaluate(`document.querySelector('.mf-trace-sum').textContent`) === '$Order · Sales.Order · set in step 2 · returned at the end', 'and a variable traced through it, in words');
  await mx.evaluate(`document.querySelector('.mf-clear').click()`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.fg-card')).find(function (c) { return /Create object/.test(c.textContent); }).click()`);
  const wfMembers = await mx.evaluate(`Array.from(document.querySelectorAll('.mf-side .mf-mo-row')).map(function (r) { return r.textContent; }).join('|')`);
  t.ok(/^NumberString \(50\)'X'$/.test(wfMembers) && !(await mx.evaluate(`!!document.querySelector('.mf-side .mf-arrow, .mf-side .mf-members-head .xe-seg')`)),
    'a Create object lists its members once — the member, its type, its value — with no switch and no arrow: ' + wfMembers);

  // ---- Modeler: the flow as Studio Pro keeps it ----
  // From a step in Workflow, "Show in the Modeler" goes to the drawing — no step window over it (Karol, 2026-10-14).
  await mx.evaluate(`document.querySelector('.mf-side .mf-studio-link').click()`);
  t.ok(await mx.waitFor(`!!document.querySelector('.mf-board .sv-strip')`, 3000, 'modeler') && !(await mx.evaluate(`!!document.querySelector('.mf-step-win')`)),
    '“Show in the Modeler” switches to the drawing and opens no window');
  await mx.evaluate(`Array.from(document.querySelectorAll('.mf-mode button')).find(function (b) { return b.textContent === 'Modeler'; }).click()`);
  t.ok(await mx.evaluate(`!document.querySelector('.mf-side') && !!document.querySelector('.mf-board .sv-strip') && Array.from(document.querySelectorAll('.mf-actions button')).map(function (b) { return b.textContent; }).join('|') === 'Workflow|Modeler|About this microflow|+ Context|Run…|Add comment'`),
    'Modeler: the drawing takes the whole middle, About beside the switch');
  await mx.evaluate(`Array.from(document.querySelectorAll('.mf-row')).find(function (r) { return /SweepOrders/.test(r.textContent); }).click()`);
  const drawing = JSON.parse(await mx.evaluate(`JSON.stringify({
    name: document.querySelector('.mf-head .xi-name').textContent,
    acts: document.querySelectorAll('.mf-board .sv-act').length, decs: document.querySelectorAll('.mf-board .sv-dec').length,
    start: !!document.querySelector('.mf-board .sv-start'), end: !!document.querySelector('.mf-board .sv-end'), zoom: !!document.querySelector('.mf-board-foot .sv-zoom, .mf-board-foot .sv-mono')
  })`));
  t.ok(drawing.name === 'SweepOrders' && drawing.acts >= 2 && drawing.decs >= 1 && drawing.start && drawing.end && drawing.zoom,
    'a row loads its flow, drawn as Studio Pro draws it — activities, a decision, a start and an end — with its zoom: ' + JSON.stringify(drawing));
  await mx.evaluate(`document.querySelector('.mf-board .sv-dec').click()`);
  t.ok(await mx.waitFor(`!!document.querySelector('.mf-step-win') && /^Step \\d+ · Decision/.test(document.querySelector('.mf-step-win .mf-step-kick').textContent)`, 3000, 'decision'),
    'a click on a decision opens its window');
  t.ok(/^If\$OrderList != empty/.test(await mx.evaluate(`document.querySelector('.mf-step-win .mf-kv').textContent`)), 'with its condition and where each way goes: ' + await mx.evaluate(`document.querySelector('.mf-step-win .mf-kv').textContent`));
  await mx.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  t.ok(await mx.waitFor(`!document.querySelector('.mf-step-win')`, 3000, 'closed'), 'Esc closes it');

  // ---- a step's window: what it does, beside Studio Pro's properties ----
  await mx.evaluate(`Array.from(document.querySelectorAll('.mf-row')).find(function (r) { return /CreateOrder/.test(r.textContent); }).click()`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.mf-board .sv-act')).find(function (a) { return /^Step 2: /.test(a.getAttribute('aria-label')); }).click()`);
  await mx.waitFor(`!!document.querySelector('.mf-step-win')`, 3000, 'step window');
  const goLook = await mx.evaluate(`(function () { var g = document.querySelector('.mf-step-win .sv-go'); if (!g) return 'none'; var s = getComputedStyle(g); return s.color + ' on ' + s.backgroundColor; })()`);
  t.ok(goLook === 'none' || /^rgb\(255, 255, 255\) on rgb\(\d+, \d+, 2\d\d\)/.test(goLook), 'the window’s Open button is white on blue, readable: ' + goLook);
  const insp = JSON.parse(await mx.evaluate(`JSON.stringify({
    head: document.querySelector('.mf-step-win-head .xe-caps').textContent,
    title: document.querySelector('.mf-step-win .mf-step-title').textContent,
    sum: document.querySelector('.mf-step-win .mf-step-sum').textContent,
    heads: Array.from(document.querySelectorAll('.mf-step-win .mf-step h3')).map(function (h) { return h.textContent.replace(/ \\d+$/, ''); }),
    groups: Array.from(document.querySelectorAll('.mf-step-win .mf-group-head')).map(function (g) { return g.textContent; }),
    flag: (document.querySelector('.mf-step-win .mf-target.flagged') || {}).textContent,
    flagTitle: (document.querySelector('.mf-step-win .mf-target-wrap') || { getAttribute: function () { return null; } }).getAttribute('title'),
    out: (document.querySelector('.mf-step-win .mf-output') || {}).textContent,
    props: document.querySelector('.mf-step-win .mf-props').textContent,
    fields: Array.from(document.querySelectorAll('.mf-step-win .sv-flabel')).map(function (n) { return n.textContent + '=' + n.nextSibling.textContent; }),
    flagged: (document.querySelector('.mf-step-win .sv-table td.c0.flagged') || {}).textContent,
    picked: (document.querySelector('.mf-board .sv-act.on') || { getAttribute: function () { return null; } }).getAttribute('aria-label')
  })`));
  t.ok(insp.head === 'Step 2 · Create Object' && /^Step 2: /.test(insp.picked), 'the step is marked on the drawing and its window names it as Studio Pro does: ' + insp.head);
  t.ok(insp.title === 'Sales.Order' && /^Sets \$Order with 1 member\./.test(insp.sum), 'the step names what it makes and says what it does: ' + insp.sum);
  t.ok(insp.heads.join(',') === 'Output,Properties' && !insp.groups.length, 'a Create object shows its output and its properties — its members once, in the properties dialog’s table beside them: ' + insp.heads);
  t.ok(insp.out === '$OrderSales.Order' && /Refers toSales\.Order/.test(insp.props) && /On errordefault handling/.test(insp.props), 'its output and properties: ' + insp.props);
  t.ok(insp.fields.indexOf('Entity=Sales.Order') !== -1 && insp.fields.indexOf('Refresh in client=[not read yet]') !== -1 && insp.flagged === 'Number',
    'beside it the properties dialog, a field the model does not hold said to be unread, the member a risk names flagged: ' + JSON.stringify(insp.fields));
  t.ok(!(await mx.evaluate(`!!document.querySelector('.mf-step-win .mf-members-head')`)), 'and no second list of members with a By source / Model order switch');
  await mx.evaluate(`document.querySelector('.mf-step-win .mf-x').click()`);

  // Item usages, on the flow whose retrieved list several activities use.
  await mx.evaluate(`Array.from(document.querySelectorAll('.mf-row')).find(function (r) { return /SweepOrders/.test(r.textContent); }).click()`);
  const usages = await mx.evaluate(`(function () {
    var seen = { name: false, usage: false }, n = document.querySelectorAll('.mf-board .sv-act').length;
    for (var i = 0; i < n; i++) {
      document.querySelectorAll('.mf-board .sv-act')[i].click();
      if (document.querySelector('.mf-board .sv-out-name.used')) seen.name = true;
      if (document.querySelector('.mf-board .sv-usage')) seen.usage = true;
      var x = document.querySelector('.mf-step-win .mf-x'); if (x) x.click();
    }
    return JSON.stringify(seen); })()`);
  t.ok(/"name":true/.test(usages) && /"usage":true/.test(usages), 'picking an activity marks the variables it uses (Name) and the activities that use its output (Usage): ' + usages);
  await mx.evaluate(`Array.from(document.querySelectorAll('.mf-row')).find(function (r) { return /CreateOrder/.test(r.textContent); }).click()`);

  // ---- the flow as a whole, behind About ----
  await mx.evaluate(`document.querySelector('.mf-about-open').click()`);
  const rail = JSON.parse(await mx.evaluate(`JSON.stringify({
    desc: (document.querySelector('.mf-about .xi-desc') || {}).textContent, prov: (document.querySelector('.mf-about .xi-prov') || {}).textContent,
    heads: Array.from(document.querySelectorAll('.mf-about .mf-rail h3')).map(function (h) { return h.textContent.replace(/ \\d+$/, ''); }).join(',')
  })`));
  t.ok(rail.desc === 'Opens a fresh order for a customer.' && /^Written by an agent/.test(rail.prov), 'About carries the agent’s description, marked as the agent’s');
  t.ok(rail.heads === 'Takes and returns,Who can start it,Calls,Called by,Data,Risks',
    'and what it takes and returns, who may start it, what it calls and what calls it, the data it reads and writes, its risks: ' + rail.heads);
  await mx.evaluate(`document.querySelector('.mf-about .mf-x').click()`);
  t.ok(await mx.evaluate(`!document.querySelector('.mf-about')`), 'and closes again');

  // Run… is the flow's own window, as before.
  await mx.evaluate(`Array.from(document.querySelectorAll('.mf-btn')).find(function (b) { return b.textContent === 'Run…'; }).click()`);
  t.ok(await mx.waitFor(`!!document.querySelector('.popup-tabs')`, 3000, 'window'), 'Run… opens the window that runs it');
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(function (b) { return b.textContent === 'Close'; }).click()`);

  // ---- wide ----
  await mx.viewport(2560, 1440);
  await new Promise((r) => setTimeout(r, 200));
  const wideList = await mx.evaluate(`Math.round(document.querySelector('.mf-list').getBoundingClientRect().width)`);
  t.ok(wideList === 370, 'at 2560 the list is 370px: ' + wideList);

  t.ok(['microflows.js', 'studioview.js', 'flowtrace.js', 'flowview.js'].every(function (f) { return !/innerHTML|insertAdjacentHTML/.test(readText(path.join(__dirname, '..', 'public', f))); }),
    'the screen, the drawing and the analysis build every node with createElement');
  await mx.close();
};
