/* MxMpr's flow graph — the DRAWING of a microflow, read out of the same .mpr
 * document MxScout already decodes.
 *
 * Studio Pro keeps the picture in the file: measured on a real Mendix 11
 * project, every one of 22 562 flow objects carries a middle point and a size,
 * and every edge carries its two endpoints, the sides it leaves and enters by,
 * its branch value and its bezier control vectors. So nothing here is laid out
 * by us — it is read.
 *
 * This is deliberately a SEPARATE reader from readFlowActivity: that one
 * answers "what will this do if I press Run" and is a summary with an
 * allowlist of the actions it understands. This one answers "what does this
 * look like" and has no allowlist at all — an activity's node carries whatever
 * action type the file names, which is why the thirteen action types the
 * summary has never recognised need no entry here, and why a Mendix version
 * that adds a fourteenth will draw it without a code change.
 *
 * Both fixtures (v1 Contents-inline, v2 contents-in-files) encode the same
 * flows, so the graph must come out identical from both. */
'use strict';
const fs = require('fs');
const path = require('path');

// id(0xc1) in the fixture generator — first byte, then 01..0f.
function nodeId(firstByte) {
  var hex = firstByte.toString(16);
  for (var i = 1; i < 16; i++) hex += i.toString(16).padStart(2, '0');
  return hex;
}

module.exports = async function (t) {
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const v2b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v2.db')).toString('base64');
  const sidecar = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v2-contents.json'), 'utf8'));

  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'app loaded');

  async function loadScript(src) {
    await mx.evaluate(`new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '${src}';
      s.onload = function () { resolve(true); };
      s.onerror = function () { reject(new Error('failed to load ${src}')); };
      document.head.appendChild(s);
    })`);
  }
  await loadScript('/sqlite.js');
  await loadScript('/bson.js');
  await loadScript('/mpr.js');

  const v1 = await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales',
      readContentsFile: function () { throw new Error('v1 must not read content files'); } });
    delete model.meta.generatedAt;
    return model;
  })()`);

  const v2 = await mx.evaluate(`(async function () {
    var sidecar = ${JSON.stringify(sidecar)};
    function b64ToBuffer(b64) {
      var bin = atob(b64);
      var u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return u8.buffer;
    }
    var bytes = Uint8Array.from(atob("${v2b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales',
      readContentsFile: function (rel) { return Promise.resolve(sidecar[rel] ? b64ToBuffer(sidecar[rel]) : null); } });
    delete model.meta.generatedAt;
    return model;
  })()`);

  function flowOf(model, qn) {
    return model.microflows.filter(function (f) { return f.qualifiedName === qn; })[0];
  }
  // Looked up by id, never by position: the fixture grows, and a test that
  // counts list slots breaks for a reason that has nothing to do with it.
  function nodeById(flow, firstByte) {
    const want = nodeId(firstByte);
    return flow.graph.nodes.filter(function (n) { return n.id === want; })[0];
  }
  const create = flowOf(v1, 'Sales.CreateOrder');
  const sweep = flowOf(v1, 'Sales.SweepOrders');

  t.ok(!!create && !!create.graph && Array.isArray(create.graph.nodes) && Array.isArray(create.graph.edges),
    'a microflow carries a graph of nodes and edges');
  t.ok(JSON.stringify(flowOf(v2, 'Sales.CreateOrder').graph) === JSON.stringify(create.graph) &&
    JSON.stringify(flowOf(v2, 'Sales.SweepOrders').graph) === JSON.stringify(sweep.graph),
    'the two .mpr formats produce the identical graph');

  // ---- nodes: kind, position, size ----
  t.ok(JSON.stringify(create.graph.nodes.map(function (n) { return n.kind; })) ===
    JSON.stringify(['parameter', 'start', 'activity', 'activity', 'activity', 'activity',
      'activity', 'activity', 'end']),
    'every object in the body becomes a node, in document order, named by what it is: ' +
    JSON.stringify(create.graph.nodes.map(function (n) { return n.kind; })));

  const createNode = nodeById(create, 0xc2);
  t.ok(createNode.id === nodeId(0xc2),
    'a node is keyed by the object id the edges point at: ' + createNode.id);
  t.ok(createNode.at && createNode.at.x === 160 && createNode.at.y === 100,
    'the stored "160;100" is read as numbers, and it is the MIDDLE of the object: ' + JSON.stringify(createNode.at));
  t.ok(createNode.size && createNode.size.width === 120 && createNode.size.height === 60,
    'and so is the size: ' + JSON.stringify(createNode.size));
  t.ok(createNode.action === 'CreateChangeAction',
    'an activity node carries the action type the file names, unmapped: ' + createNode.action);

  // ---- captions: the one thing the file does NOT carry ----
  // On a real project 9988 of 10 332 activities leave AutoGenerateCaption at
  // true, and the Caption stored next to it is a dead placeholder — the word
  // "Activity" 9895 times. Passing that through would put it on 96% of cards.
  t.ok(createNode.caption === 'Open a fresh order',
    'a caption a person typed is kept: ' + JSON.stringify(createNode.caption));
  t.ok(nodeById(create, 0xc3).caption === null,
    'an auto-generated caption is NOT passed through — the stored "Activity" is a placeholder, not a label: ' +
    JSON.stringify(nodeById(create, 0xc3).caption));
  t.ok(createNode.documentation === 'Numbered X until the real number is known.',
    'documentation written on an activity comes along: ' + JSON.stringify(createNode.documentation));
  t.ok(nodeById(create, 0xc5).disabled === true && createNode.disabled === false,
    'a disabled activity says so, and an ordinary one says it is not');
  t.ok(nodeById(create, 0xc6).returnValue === '$Order',
    'an end event carries what it returns: ' + JSON.stringify(nodeById(create, 0xc6).returnValue));
  t.ok(nodeById(create, 0xc0).kind === 'parameter' && nodeById(create, 0xc0).caption === 'Customer',
    'the parameter chip Studio Pro draws on the canvas is a node too');

  // ---- edges ----
  const ce = create.graph.edges;
  t.ok(ce.length === 6 && ce[0].from === nodeId(0xc1) && ce[0].to === nodeId(0xc2),
    'edges point from node id to node id: ' + JSON.stringify(ce.map(function (e) { return e.from + '->' + e.to; })));
  t.ok(ce[0].fromSide === 1 && ce[0].toSide === 3,
    'the side an edge leaves and enters by is kept as the raw connection index: ' + ce[0].fromSide + '->' + ce[0].toSide);
  t.ok(ce[0].kind === 'sequence' && ce[0].isError === false && ce[0].caseValue === null,
    'an ordinary edge is a sequence edge with no branch value and no error flag: ' + JSON.stringify(ce[0]));
  t.ok(ce[0].fromVector && ce[0].fromVector.x === 30 && ce[0].toVector.x === -30,
    'the bezier control vectors come through, so the curve can be the one Studio Pro drew: ' +
    JSON.stringify([ce[0].fromVector, ce[0].toVector]));

  // ---- the loop: nesting, and coordinates relative to it ----
  const loop = nodeById(sweep, 0xd3);
  const inLoop = nodeById(sweep, 0xd4);
  t.ok(!!loop && loop.kind === 'loop' && loop.parentId === null,
    'a looped activity is a node of its own');
  t.ok(!!inLoop && inLoop.parentId === loop.id,
    'an object inside the loop names the loop as its parent: ' + JSON.stringify(inLoop && inLoop.parentId));
  t.ok(inLoop.at.x === 90 && inLoop.at.y === 80,
    'and keeps the loop-relative point the file stores, un-shifted: ' + JSON.stringify(inLoop.at));
  t.ok(!!loop.loop && loop.loop.mode === 'list' && loop.loop.listVariable === 'OrderList' &&
    loop.loop.iteratorVariable === 'IteratorOrder',
    'the loop says what it iterates over: ' + JSON.stringify(loop.loop));
  t.ok(sweep.graph.edges.filter(function (e) { return e.from === inLoop.id; }).length === 1,
    'an edge between two objects inside the loop sits in the flow\'s one flat edge list, not on the loop');

  // ---- branching ----
  const split = nodeById(sweep, 0xd2);
  t.ok(split.kind === 'decision' && split.expression === '$OrderList != empty' && split.caption === 'Any orders?',
    'a decision carries its condition and its caption: ' + JSON.stringify([split.caption, split.expression]));
  const outs = sweep.graph.edges.filter(function (e) { return e.from === split.id; })
    .map(function (e) { return e.caseKind + ':' + e.caseValue; }).sort();
  t.ok(JSON.stringify(outs) === JSON.stringify(['enumeration:false', 'enumeration:true']),
    'its outlets are values, not labels: ' + JSON.stringify(outs));
  t.ok(nodeById(sweep, 0xd6).kind === 'merge', 'a merge is a node');
  const inherit = nodeById(sweep, 0xdf);
  t.ok(inherit.kind === 'objectTypeDecision' && inherit.variable === 'IteratorOrder',
    'an inheritance split says which variable it splits on: ' + JSON.stringify(inherit.variable));
  const inheritEdge = sweep.graph.edges.filter(function (e) { return e.from === inherit.id; })[0];
  t.ok(inheritEdge.caseKind === 'inheritance' && inheritEdge.caseValue === 'Sales.Order',
    'and its outlet names the specialization: ' + JSON.stringify([inheritEdge.caseKind, inheritEdge.caseValue]));

  // ---- the two edges that are not ordinary sequence ----
  const errEdge = sweep.graph.edges.filter(function (e) { return e.isError; });
  t.ok(errEdge.length === 1 && errEdge[0].to === nodeId(0xdd) && nodeById(sweep, 0xdd).kind === 'errorEvent',
    'the error outlet is marked as one and lands on the error event: ' + JSON.stringify(errEdge));
  const noteEdge = sweep.graph.edges.filter(function (e) { return e.kind === 'annotation'; });
  t.ok(noteEdge.length === 1 && noteEdge[0].caseValue === null,
    'the line to an annotation is an annotation edge, not a sequence one');
  t.ok(nodeById(sweep, 0xde).kind === 'annotation' &&
    nodeById(sweep, 0xde).caption === 'Nothing to sweep is not an error.',
    'an annotation keeps its text — it is always a caption somebody typed');

  // ---- no allowlist: the three actions the summary never recognised ----
  const drawn = sweep.graph.nodes.filter(function (n) { return n.kind === 'activity'; })
    .map(function (n) { return n.action; });
  t.ok(['AggregateAction', 'ListOperationsAction', 'CallWebServiceAction'].every(function (a) {
    return drawn.indexOf(a) !== -1;
  }), 'actions the "what it does" summary has no case for are still drawn, by name: ' + JSON.stringify(drawn));

  // ---- and the summary is untouched by all of this ----
  t.ok(sweep.activity && sweep.activity.restCalls === 1 && sweep.activity.loops === 1 &&
    JSON.stringify(sweep.activity.commits) === JSON.stringify(['Sales.Order']),
    'readFlowActivity still answers the question it answered before: ' + JSON.stringify(sweep.activity && {
      restCalls: sweep.activity.restCalls, loops: sweep.activity.loops, commits: sweep.activity.commits
    }));

  // ---- a page is not a flow ----
  t.ok(v1.pages.length === 1 && v1.pages[0].graph === undefined,
    'a page gets no graph: it has a body, but not this kind of one');
};
