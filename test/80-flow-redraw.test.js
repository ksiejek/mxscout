/* A click on a flow's screen draws the screen again, but not the flow
 * (public/flowview.js, flowgraph.js select, studioview.js select): what a
 * flow does with its variables is worked out once, and the drawing — the
 * Workflow graph and the Modeler's board — is kept while it is the same flow,
 * with only the nodes that say which step is picked changed. On a large
 * project a click on a step used to build the whole drawing anew.
 *
 * Nothing here times anything. It checks that the work is not done again and
 * that what is drawn after a pick is exactly what a fresh drawing of that pick
 * draws. Built on the same real .mpr fixture as test 55.
 *
 * Developer tools add to the head of a flow Run… (the flow's window) and Add
 * comment; they are built outside the kept drawing, so they are checked here
 * to still work after a pick that kept it. */
'use strict';
const { goToSection } = require('./helpers');
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
  await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    await MxStore.saveProjectWithModel({ id: 'predraw', name: 'RedrawDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null, devTools: true }, model);
  })()`);
  const SW = "(function(q){var s=document.querySelector('.switcher[aria-expanded=\"false\"]'); if (s) s.click(); return document.querySelectorAll(q);})";
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(${SW}('.tree-project')).find(b => b.textContent.indexOf('RedrawDemo') !== -1)`, 10000, 'project');
  await mx.evaluate(`Array.from(${SW}('.tree-project')).find(b => b.textContent.indexOf('RedrawDemo') !== -1).click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.tree-section')).find(b => /^Microflows/.test(b.textContent))`, 8000, 'sections');
  // Count the analyses, and keep the last one to draw a fresh copy from.
  await mx.evaluate(`(function () {
    var real = MxFlowTrace.analyse;
    window.__analyses = 0;
    MxFlowTrace.analyse = function (entry, ctx) { window.__analyses++; var an = real(entry, ctx); window.__last = { entry: entry, an: an }; return an; };
    return true; })()`);
  await goToSection(mx, 'Microflows', '.mf-mods, .mf-grid');
  await mx.evaluate(`(function(){ var s = document.querySelector('.xe-head .role-select'); s.value = 'all'; s.dispatchEvent(new Event('change')); return true; })()`);
  await mx.evaluate(`MxMicroflows.select('Sales.CreateOrder'); true`);
  await mx.waitFor(`!!document.querySelector('.mf-canvas .fg-card')`, 8000, 'the drawing');
  const frame = `new Promise(function (r) { requestAnimationFrame(function () { setTimeout(r, 0); }); })`;
  await mx.evaluate(frame);

  // ---- Workflow: a click on a step changes the pick, not the drawing ----
  const w = JSON.parse(await mx.evaluate(`(async function () {
    var out = { analyses0: window.__analyses };
    var fg = document.querySelector('.mf-canvas .fg'); fg.__probe = true;
    var cards = Array.from(document.querySelectorAll('.mf-canvas [data-step]'));
    var other = cards.filter(function (c) { return !c.classList.contains('on'); }).pop();
    var to = other.getAttribute('data-step');
    other.click(); await ${frame};
    var fg2 = document.querySelector('.mf-canvas .fg');
    out.same = fg2 === fg && !!fg2.__probe;
    out.picked = Array.from(fg2.querySelectorAll('[data-step].on')).map(function (n) { return n.getAttribute('data-step') + n.getAttribute('aria-pressed'); });
    out.to = to;
    out.panel = document.querySelector('.mf-side .mf-step-kick').textContent;
    Array.from(document.querySelectorAll('.mf-tabs .xe-seg'))[1].click(); await ${frame};
    Array.from(document.querySelectorAll('.mf-tabs .xe-seg'))[0].click(); await ${frame};
    out.stillSame = document.querySelector('.mf-canvas .fg') === fg;
    out.analyses = window.__analyses;
    // the kept drawing, beside one drawn fresh for the same pick
    var live = document.querySelector('.mf-canvas .fg');
    var fresh = MxFlowGraph.render(window.__last.entry, { analysis: window.__last.an, selected: Number(to), traceVar: null, onPick: function () {} });
    function looks(root) { return Array.from(root.querySelectorAll('[data-step]')).map(function (n) { return n.getAttribute('data-step') + ':' + n.getAttribute('class') + ':' + n.getAttribute('aria-pressed'); }).join('|'); }
    out.asFresh = looks(live) === looks(fresh);
    out.looks = looks(live);
    // a variable traced draws it again: what it dims is the drawing itself
    document.querySelector('.mf-trace-row .mf-chip').click(); await ${frame};
    out.traceRedraws = document.querySelector('.mf-canvas .fg') !== fg;
    return JSON.stringify(out); })()`));
  t.ok(w.analyses0 === 1, 'opening a flow works out what it does with its variables once: ' + w.analyses0);
  t.ok(w.same && w.picked.join() === w.to + 'true', 'a click on a step keeps the drawing and marks that step, and only it, as picked: ' + JSON.stringify(w));
  t.ok(new RegExp('^Step ' + w.to + ' ').test(w.panel), 'the panel beside it shows the step clicked: ' + w.panel);
  t.ok(w.stillSame && w.analyses === 1, 'the tabs beside the drawing keep it too, and nothing is worked out again: ' + JSON.stringify([w.stillSame, w.analyses]));
  t.ok(w.asFresh, 'the kept drawing marks the steps exactly as a fresh drawing of that pick does: ' + w.looks);
  t.ok(w.traceRedraws, 'tracing a variable draws the flow again, dimmed where it is not used');

  // ---- Developer tools: Run… and Add comment sit outside the kept drawing ----
  // The head's buttons are built again on every redraw while the drawing is
  // not, so after a pick that kept it they must still open what they open —
  // the flow's window on Run, and a new comment on this flow — and closing
  // either must leave the same drawing, still marking the same step.
  const d = JSON.parse(await mx.evaluate(`(async function () {
    var out = {};
    var clear = document.querySelector('.mf-trace .mf-clear'); if (clear) { clear.click(); await ${frame}; }
    var fg = document.querySelector('.mf-canvas .fg');
    var other = Array.from(fg.querySelectorAll('[data-step]')).filter(function (c) { return !c.classList.contains('on'); })[0];
    var to = out.to = other.getAttribute('data-step');
    other.click(); await ${frame};
    function same() {
      var g = document.querySelector('.mf-canvas .fg'), on = g && g.querySelectorAll('[data-step].on');
      return g === fg && on.length === 1 && on[0].getAttribute('data-step') === to;
    }
    out.kept = same();
    function btn(text) { return Array.from(document.querySelectorAll('.mf-actions .mf-btn')).find(function (b) { return b.textContent === text; }); }
    btn('Run…').click(); await ${frame};
    out.run = Array.from(document.querySelectorAll('.modal .popup-tab')).map(function (b) { return b.textContent + (b.classList.contains('is-active') ? '*' : ''); }).join();
    out.runFor = /CreateOrder/.test((document.querySelector('.modal') || {}).textContent || '');
    Array.from(document.querySelectorAll('.modal .popup-head-actions button')).find(function (b) { return b.textContent === 'Close'; }).click(); await ${frame};
    out.runClosed = !document.querySelector('.modal') && same();
    btn('Add comment').click(); await ${frame};
    out.editor = MxComments.editorOpen() && (document.querySelector('.editor-target-name') || {}).textContent;
    Array.from(document.querySelectorAll('.editor-head button')).find(function (b) { return b.textContent === 'Close'; }).click(); await ${frame};
    out.editorClosed = !MxComments.editorOpen() && same();
    // and the kept drawing still answers a click after both
    var next = Array.from(fg.querySelectorAll('[data-step]')).filter(function (c) { return !c.classList.contains('on'); }).pop();
    to = next.getAttribute('data-step');
    next.click(); await ${frame};
    out.again = same() && new RegExp('^Step ' + to + ' ').test(document.querySelector('.mf-side .mf-step-kick').textContent);
    return JSON.stringify(out); })()`));
  t.ok(d.kept && d.run === 'Flow,Run*,Comments' && d.runFor, 'after a pick that kept the drawing, Run… still opens the flow’s window on Run: ' + JSON.stringify(d));
  t.ok(d.runClosed, 'and closing it leaves the same drawing, the same step marked');
  t.ok(d.editor === 'Sales.CreateOrder' && d.editorClosed, 'Add comment still starts a comment on this flow, and closing it keeps the drawing: ' + JSON.stringify([d.editor, d.editorClosed]));
  t.ok(d.again, 'the kept drawing still answers a click on a step after both');

  // ---- Modeler: a step's window opens and closes over the same board ----
  const m = JSON.parse(await mx.evaluate(`(async function () {
    var out = {};
    // a flow with a list it retrieves and loops over, so a pick marks names and usages
    MxMicroflows.select('Sales.SweepOrders'); await ${frame};
    Array.from(document.querySelectorAll('.mf-mode .xe-seg')).find(function (b) { return b.textContent === 'Modeler'; }).click(); await ${frame};
    var canvas = document.querySelector('.mf-board .sv-canvas'); canvas.__probe = true;
    var acts = Array.from(document.querySelectorAll('.mf-board .sv-act'));
    // the step whose output another step uses, so the pick marks names and usages
    var an = window.__last.an, pick = null;
    acts.forEach(function (a) { var no = Number(/^Step (\\d+)/.exec(a.getAttribute('aria-label'))[1]); Object.keys(an.du).forEach(function (v) { if (an.du[v][no] === 'defines' && Object.keys(an.du[v]).some(function (k) { return /^\\d+$/.test(k) && an.du[v][k] !== 'defines'; })) pick = pick || a; }); });
    pick = pick || acts[0];
    var no = Number(/^Step (\\d+)/.exec(pick.getAttribute('aria-label'))[1]);
    pick.click(); await ${frame};
    out.window = !!document.querySelector('.mf-step-win');
    out.same = document.querySelector('.mf-board .sv-canvas') === canvas;
    out.usages = document.querySelectorAll('.mf-board .sv-usage').length;
    out.used = document.querySelectorAll('.mf-board .sv-out-name.used').length;
    function norm(html) { return html.replace(/sv-arr-\\d+/g, 'sv-arr-N'); }
    var fresh = MxStudioView.board(window.__last.entry, an, { selected: no, qn: window.__last.entry.qn, name: window.__last.entry.name, inline: true, onPick: function () {} });
    out.asFresh = norm(canvas.outerHTML) === norm(fresh.strip.querySelector('.sv-canvas').outerHTML);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await ${frame};
    out.closed = !document.querySelector('.mf-step-win') && document.querySelector('.mf-board .sv-canvas') === canvas;
    var none = MxStudioView.board(window.__last.entry, an, { selected: null, qn: window.__last.entry.qn, name: window.__last.entry.name, inline: true, onPick: function () {} });
    out.closedAsFresh = norm(canvas.outerHTML) === norm(none.strip.querySelector('.sv-canvas').outerHTML);
    out.leftover = canvas.querySelectorAll('.sv-usage, .sv-out-name.used, .sv-act.on, .sv-dec.on').length;
    // a click on the kept board still opens that step's window
    document.querySelector('.mf-board .sv-act').click(); await ${frame};
    out.again = !!document.querySelector('.mf-step-win');
    // Developer tools: with the window closed, Run… opens over the same board
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await ${frame};
    Array.from(document.querySelectorAll('.mf-actions .mf-btn')).find(function (b) { return b.textContent === 'Run…'; }).click(); await ${frame};
    out.run = !!document.querySelector('.modal .popup-tab.is-active') && document.querySelector('.modal .popup-tab.is-active').textContent;
    Array.from(document.querySelectorAll('.modal .popup-head-actions button')).find(function (b) { return b.textContent === 'Close'; }).click(); await ${frame};
    out.runKept = !document.querySelector('.modal') && document.querySelector('.mf-board .sv-canvas') === canvas;
    out.analyses = window.__analyses;
    return JSON.stringify(out); })()`));
  t.ok(m.window && m.same, 'Modeler: a click on an activity opens its window over the same board: ' + JSON.stringify(m));
  t.ok(m.asFresh && m.usages > 0, 'and the board marks the pick, what it uses and what uses its output exactly as a fresh board does: ' + JSON.stringify([m.asFresh, m.usages, m.used]));
  t.ok(m.closed && m.closedAsFresh && m.leftover === 0, 'Esc closes the window and takes every mark off again, as a board drawn with nothing picked: ' + JSON.stringify([m.closed, m.closedAsFresh, m.leftover]));
  t.ok(m.again, 'a click on the kept board still opens a step');
  t.ok(m.run === 'Run' && m.runKept, 'Run… opens the flow’s window over the kept board, and closing it leaves the board: ' + JSON.stringify([m.run, m.runKept]));
  t.ok(m.analyses === 2, 'another flow is worked out once too; switching to the Modeler and picking there ask nothing again: ' + m.analyses);
};
