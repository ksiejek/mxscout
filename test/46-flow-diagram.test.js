/* The drawing of a flow — the Diagram tab of the flow window: the documentation's workflow
 * (public/docs-view.js) by default, and Studio Pro's own layout (public/flowdraw.js) one click away.
 *
 * What the Studio Pro layout has to get right: it draws the flow Studio Pro drew, from the model and nothing else — every node
 * in the graph, at its place, children of a loop inside the loop; branch values on the arrows out of a
 * decision; the whole text of a step available on hover however little of it fits the box; a step that calls
 * another flow opens that flow (on its own drawing); and a model with no drawings says so instead of showing
 * an empty canvas. */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxFlowDraw', 15000, 'MxScout loaded');
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const counts = await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    await MxStore.saveProjectWithModel({ id: 'pdraw', name: 'DrawDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, model);
    var sweep = model.microflows.filter(function (f) { return f.qualifiedName === 'Sales.SweepOrders'; })[0];
    return { nodes: sweep.graph.nodes.length, loops: sweep.graph.nodes.filter(function (n) { return n.kind === 'loop'; }).length };
  })()`);
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button')).find(n => n.textContent.trim() === 'DrawDemo')`, 10000, 'project');
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(n => n.textContent.trim() === 'DrawDemo').click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.tree-section')).find(n => /^Microflows/.test(n.textContent))`, 8000, 'sections');
  await mx.evaluate(`Array.from(document.querySelectorAll('.tree-section')).find(n => /^Microflows/.test(n.textContent)).click()`);
  // Every role, so both flows are listed whatever role the project opened as.
  await mx.evaluate(`(function(){ var sel = Array.from(document.querySelectorAll('select')).find(x => Array.from(x.options).some(o => o.value === 'all')); if (sel) { sel.value = 'all'; sel.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
  const openDiagram = async (name) => {
    await mx.waitFor(`!!Array.from(document.querySelectorAll('.flow-card')).find(n => n.querySelector('.flow-card-name').textContent === ${JSON.stringify(name)})`, 5000, name);
    await mx.evaluate(`Array.from(document.querySelectorAll('.flow-card')).find(n => n.querySelector('.flow-card-name').textContent === ${JSON.stringify(name)}).click()`);
    await mx.waitFor(`!!Array.from(document.querySelectorAll('.popup-tab')).find(b => b.textContent === 'Diagram')`, 5000, 'Diagram tab');
    await mx.evaluate(`Array.from(document.querySelectorAll('.popup-tab')).find(b => b.textContent === 'Diagram').click()`);
  };
  const openFlow = async (name) => {
    await openDiagram(name);
    await mx.evaluate(`(function(){ var b = Array.from(document.querySelectorAll('.fd-mode-btn')).find(x => x.textContent === 'Studio Pro layout'); if (!b.classList.contains('on')) b.click(); })()`);
    await mx.waitFor(`!!document.querySelector('.fd-svg')`, 5000, 'drawing');
  };

  // ---- the Diagram opens on the documentation's own workflow ----
  // The flow window and the exported documentation draw a flow with the SAME
  // code from the same entry (docs-view.js flow, docs-data.js flowEntry), so
  // the two cannot disagree about what a flow does.
  await openDiagram('CreateOrder');
  await mx.waitFor(`!!document.querySelector('.modal .dx-embed .wfx-step')`, 5000, 'workflow');
  t.ok(await mx.evaluate(`Array.from(document.querySelectorAll('.fd-mode-btn.on')).map(b => b.textContent).join() === 'Workflow'`),
    'the Diagram tab opens on the workflow, with Studio Pro’s layout one click away');
  t.ok(await mx.evaluate(`!!document.querySelector('.modal .wfx > .wfx-in .wfx-param') && !!document.querySelector('.modal .wfx > .wfx-out') && !document.querySelector('.modal .dx-ends')`),
    'it says what the flow takes above Start and what it returns below the last step, inside the drawing rather than in cards above it');
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal .wfx-step')).find(s => /Create object/i.test(s.textContent)).click()`);
  const created = await mx.waitFor(`(function(){ var d = document.querySelector('.modal .wfx-detail'); return d && !d.hidden && d.textContent; })()`, 3000, 'detail');
  t.ok(/Created with/.test(created) && /Number/.test(created) && /'X'/.test(created),
    'clicking a create step pins it, with each member and the value it gets: ' + created.slice(0, 160));
  // Next to the step, inside the drawing, not in a panel at the canvas's side.
  const beside = await mx.evaluate(`(function () {
    var d = document.querySelector('.modal .wfx-detail'), s = document.querySelector('.modal .wfx-step.pinned');
    var dr = d.getBoundingClientRect(), sr = s.getBoundingClientRect();
    var side = /at-(right|left|below)/.exec(d.className);
    var gap = !side ? -1 : side[1] === 'right' ? dr.left - sr.right : side[1] === 'left' ? sr.left - dr.right : dr.top - sr.bottom;
    return { inside: d.parentNode.classList.contains('wfx'), side: side && side[1], gap: Math.round(gap) };
  })()`);
  t.ok(beside.inside && beside.side && beside.gap >= 6 && beside.gap <= 24,
    'a step’s details open next to that step, inside the drawing: ' + JSON.stringify(beside));
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Close').click()`);

  await openFlow('SweepOrders');
  const drawn = await mx.evaluate(`({
    nodes: document.querySelectorAll('.fd-node').length,
    loops: document.querySelectorAll('.fd-loopbox').length,
    edges: document.querySelectorAll('.fd-edge').length,
    branches: Array.from(document.querySelectorAll('.fd-branch text')).map(t => t.textContent).sort(),
    viewBox: document.querySelector('.fd-svg').getAttribute('viewBox')
  })`);
  t.ok(drawn.nodes === counts.nodes, 'every node of the graph is drawn: ' + drawn.nodes + ' of ' + counts.nodes);
  t.ok(drawn.loops === counts.loops && counts.loops === 1, 'the loop is drawn as a container');
  t.ok(drawn.edges > 5, 'the arrows are drawn: ' + drawn.edges);
  t.ok(drawn.branches.indexOf('true') !== -1 && drawn.branches.indexOf('false') !== -1, 'the decision’s arrows carry their branch values: ' + JSON.stringify(drawn.branches));
  t.ok(!!drawn.viewBox, 'the drawing has a view to pan and zoom');
  // Studio Pro's layout takes the whole screen bar a 1% margin, and the
  // window itself does not scroll: only the drawing moves.
  const fill = await mx.evaluate(`(function () {
    var m = document.querySelector('.modal'), r = m.getBoundingClientRect();
    return { fill: m.classList.contains('modal-fill'), w: r.width / innerWidth, h: r.height / innerHeight, scrolls: m.scrollHeight > m.clientHeight + 1 };
  })()`);
  t.ok(fill.fill && fill.w > 0.96 && fill.h > 0.96 && !fill.scrolls,
    'Studio Pro’s layout fills the screen and the window around it does not scroll: ' + JSON.stringify(fill));

  // The children of a loop sit inside it.
  const inside = await mx.evaluate(`(function () {
    var loop = document.querySelector('.fd-loopbox').getBoundingClientRect();
    var kids = Array.from(document.querySelectorAll('.fd-node.fd-activity')).map(function (g) { return g.getBoundingClientRect(); })
      .filter(function (r) { return r.left >= loop.left - 1 && r.right <= loop.right + 1 && r.top >= loop.top - 1 && r.bottom <= loop.bottom + 1; });
    return kids.length;
  })()`);
  t.ok(inside === 2, 'the two steps inside the loop are drawn inside it: ' + inside);

  // Hover: the whole text, not what fits the box.
  await mx.evaluate(`(function () {
    var g = Array.from(document.querySelectorAll('.fd-node.fd-activity')).find(function (x) { return /Retrieve/.test(x.textContent); });
    var r = g.getBoundingClientRect();
    g.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  })()`);
  const card = await mx.evaluate(`(function () { var c = document.querySelector('.fd-card'); return { hidden: c.hidden, text: c.textContent }; })()`);
  t.ok(!card.hidden && card.text.indexOf('Sales.Order_Customer/Sales.Customer/Age > 18') !== -1, 'hovering a step shows all of it, the XPath included: ' + card.text.slice(0, 120));

  // Fit and zoom change the view, and only the view.
  const before = await mx.evaluate(`document.querySelector('.fd-svg').getAttribute('viewBox')`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.fd-tools button')).find(b => b.textContent === '+').click()`);
  const after = await mx.evaluate(`document.querySelector('.fd-svg').getAttribute('viewBox')`);
  t.ok(before !== after, 'zooming changes the view');
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Close').click()`);

  // A call opens the called flow, on its drawing.
  await openFlow('CreateOrder');
  await mx.evaluate(`(function () {
    var g = Array.from(document.querySelectorAll('.fd-node.is-link')).find(function (x) { return /SweepOrders/.test(x.textContent); });
    g.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  })()`);
  await mx.waitFor(`/Sales\\.SweepOrders/.test((document.querySelector('.popup-head') || {}).textContent || '')`, 5000, 'called flow opened');
  t.ok(await mx.evaluate(`!!document.querySelector('.popup-tab.is-active') && document.querySelector('.popup-tab.is-active').textContent === 'Diagram' && !!document.querySelector('.fd-loopbox')`),
    'clicking a call opens that flow, on its own drawing');
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Close').click()`);

  // No drawing in the model: said, not an empty canvas.
  const empty = await mx.evaluate(`(function () {
    var node = MxFlowDraw.render({ qualifiedName: 'X.Y', graph: null });
    return node.className + ' | ' + node.textContent;
  })()`);
  t.ok(/fd-empty/.test(empty) && /No drawing/.test(empty), 'a flow with no drawing says so: ' + empty.slice(0, 80));

  // Nothing the model says can become markup: a step's text is set as text.
  const safe = await mx.evaluate(`(function () {
    var frame = MxFlowDraw.render({ qualifiedName: 'X.Y', graph: { nodes: [
      { id: 'a', kind: 'start', at: { x: 0, y: 0 }, size: { width: 20, height: 20 } },
      { id: 'b', kind: 'activity', action: 'LogMessageAction', kicker: 'Log', title: '<img src=x onerror=alert(1)>', at: { x: 150, y: 0 }, size: { width: 120, height: 60 } }
    ], edges: [{ from: 'a', to: 'b', fromSide: 1, toSide: 3 }] } });
    return { imgs: frame.querySelectorAll('img').length, text: frame.textContent.indexOf('<img') !== -1 };
  })()`);
  t.ok(safe.imgs === 0 && safe.text, 'a step whose text looks like markup is shown as text');
  await mx.close();
};
