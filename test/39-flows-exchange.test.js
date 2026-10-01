/* The flows exchange document — MxScout's half of the contract with
 * MxScaffold (../mxscaffold, a separate tool: Vite + React, its own repo).
 *
 * The two applications are joined by a FILE, not by shared code. MxScout has
 * zero npm dependencies and no build step, which is its whole argument to a
 * security department; MxScaffold has 38k lines of React. Either sharing code
 * breaks that promise or it rewrites the other tool. So the boundary is this
 * document, modelled on the one MxScaffold already defines for a domain model
 * (`{ mxscaffold: 'domain-model', schemaVersion: 1 }`): references by
 * qualified name, positions optional, unknown fields ignored. This adds the
 * second kind.
 *
 * Two jobs here that belong to the EXPORTER and not to the reader:
 *   - translation into MxScaffold's own vocabulary. public/mpr.js deliberately
 *     keeps Mendix's names (`RetrieveAction`), so that it needs no table of
 *     somebody else's type names and a new Mendix action still reads. Turning
 *     that into `retrieve` happens here, once.
 *   - compaction. The model keeps a fixed shape with nulls, because there
 *     "null" means "the reader looked and there was nothing". A file on its
 *     way to another tool does not need to say that 22,562 times. */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
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
  t.ok(await mx.evaluate('!!window.MxExchange && !!window.MxExchange.buildFlowsDocument'),
    'MxExchange ships with the app and needs no init — it is a pure transform');

  const built = await mx.evaluate(`(async function () {
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
    window.__model = model;
    return window.MxExchange.buildFlowsDocument(model, { version: '9.9.9' });
  })()`);

  const doc = built.doc;
  t.ok(doc.mxscaffold === 'flows' && doc.schemaVersion === 1,
    'the document names its kind and version, the way the domain-model one does: ' +
    JSON.stringify([doc.mxscaffold, doc.schemaVersion]));
  t.ok(doc.source && doc.source.tool === 'mxscout' && doc.source.version === '9.9.9' &&
    /^\d{4}-\d\d-\d\dT/.test(doc.source.exportedAt || ''),
    'and says which tool wrote it, in which version, when: ' + JSON.stringify(doc.source));
  t.ok(doc.project && doc.project.name === 'Sales' && doc.project.mendixVersion === '11.12.0',
    'the project it came from, and the Mendix version that wrote the .mpr: ' + JSON.stringify(doc.project));
  t.ok(built.included === 2 && built.skipped === 0,
    'the builder says how many flows it put in and how many it left out: ' +
    JSON.stringify([built.included, built.skipped]));

  const byName = {};
  doc.flows.forEach(function (f) { byName[f.name] = f; });
  const create = byName['Sales.CreateOrder'];
  const sweep = byName['Sales.SweepOrders'];
  t.ok(!!create && create.kind === 'microflow' && create.module === 'Sales',
    'a flow carries its qualified name, its kind and its module: ' + JSON.stringify(create && {
      name: create.name, kind: create.kind, module: create.module
    }));
  t.ok(JSON.stringify(create.parameters) === JSON.stringify([{ name: 'Customer', type: 'Sales.Customer' }]),
    'a parameter is written in the notation MxScaffold uses — the entity for an object: ' +
    JSON.stringify(create.parameters));
  t.ok(JSON.stringify(create.allowedModuleRoles) === JSON.stringify(['Sales.User']) &&
    create.applyEntityAccess === true,
    'what can set it off, and whether it obeys entity access, travel with it: ' +
    JSON.stringify([create.allowedModuleRoles, create.applyEntityAccess]));

  // ---- translation into MxScaffold's vocabulary ----
  const types = {};
  sweep.steps.concat(create.steps).forEach(function (s) { types[s.type] = (types[s.type] || 0) + 1; });
  ['retrieve', 'create', 'change', 'commit', 'delete', 'callMicroflow', 'callNanoflow',
    'javaAction', 'showPage', 'aggregateList', 'listOperation', 'callRest', 'callWebService',
    'message', 'importMapping', 'exportMapping', 'decision', 'objectTypeDecision', 'merge',
    'loop', 'annotation', 'parameter', 'start', 'end', 'errorEvent'].forEach(function (want) {
    t.ok(types[want] > 0, 'a step of MxScaffold\'s own type "' + want + '" is in the document');
  });
  const retrieve = sweep.steps.filter(function (s) { return s.type === 'retrieve'; })[0];
  t.ok(retrieve.action === 'RetrieveAction',
    'and Mendix\'s own name is kept beside it, so nothing is lost in translation: ' + retrieve.action);
  t.ok(retrieve.kicker === 'Retrieve from database' && retrieve.title === 'Order' &&
    retrieve.ref === 'Sales.Order',
    'the three text slots and the reference come along as they are: ' +
    JSON.stringify([retrieve.kicker, retrieve.title, retrieve.ref]));
  t.ok(retrieve.at && retrieve.at.x === 160 && retrieve.size.width === 120,
    'so does the geometry, which is the whole point: ' + JSON.stringify([retrieve.at, retrieve.size]));

  // ---- compaction, and that it loses nothing that matters ----
  t.ok(create.steps.every(function (s) { return /^n\d+$/.test(s.id); }),
    'ids are renumbered per flow — a 32-character hex key is of no use to a drawing: ' +
    JSON.stringify(create.steps.map(function (s) { return s.id; })));
  const ids = {};
  sweep.steps.forEach(function (s) { ids[s.id] = true; });
  t.ok(sweep.edges.every(function (e) { return ids[e.from] && ids[e.to]; }),
    'and every edge still lands on a step after the renumbering');
  const loopStep = sweep.steps.filter(function (s) { return s.type === 'loop'; })[0];
  const inLoop = sweep.steps.filter(function (s) { return s.parent === loopStep.id; });
  t.ok(inLoop.length === 2,
    'nesting survives it too: the loop keeps its two children: ' + inLoop.length);
  t.ok(sweep.steps.every(function (s) {
    return !Object.keys(s).some(function (k) { return s[k] === null; });
  }), 'no field is written as null — in a file, an absent field says the same thing');
  t.ok(create.steps.every(function (s) { return !('parent' in s); }),
    'and a step in no loop has no parent field at all');

  // ---- edges say what they are in MxScaffold's terms ----
  const plain = sweep.edges.filter(function (e) { return !e.kind; });
  t.ok(plain.length > 0, 'an ordinary sequence edge carries no kind — it is the default');
  const errEdge = sweep.edges.filter(function (e) { return e.kind === 'error'; });
  t.ok(errEdge.length === 1,
    'the error outlet is a kind, not a flag: MxScaffold models it that way: ' + JSON.stringify(errEdge));
  const noteEdge = sweep.edges.filter(function (e) { return e.kind === 'annotation'; });
  t.ok(noteEdge.length === 1, 'and so is the line to an annotation');
  const cases = sweep.edges.filter(function (e) { return e.caseValue; })
    .map(function (e) { return e.caseValue; }).sort();
  t.ok(JSON.stringify(cases) === JSON.stringify(['Sales.Order', 'false', 'true']),
    'branch values travel as values: ' + JSON.stringify(cases));
  t.ok(plain[0].fromSide === 1 && plain[0].toSide === 3 && plain[0].fromVector.x === 30,
    'the sides and the bezier vectors go too, so the curve can be the one Studio Pro drew');

  // ---- scope is a predicate, and the same builder serves both buttons ----
  const scoped = await mx.evaluate(`(function () {
    var one = window.MxExchange.buildFlowsDocument(window.__model, {
      scope: function (flow) { return flow.qualifiedName === 'Sales.SweepOrders'; } });
    return { names: one.doc.flows.map(function (f) { return f.name; }),
      included: one.included, skipped: one.skipped };
  })()`);
  t.ok(JSON.stringify(scoped.names) === JSON.stringify(['Sales.SweepOrders']) &&
    scoped.included === 1,
    'one flow or all of them is the same call with a different predicate: ' + JSON.stringify(scoped));

  // ---- a model with no drawing in it is not exported as empty flows ----
  const older = await mx.evaluate(`(function () {
    var model = JSON.parse(JSON.stringify(window.__model));
    model.microflows.forEach(function (f) { delete f.graph; });
    var out = window.MxExchange.buildFlowsDocument(model);
    return { flows: out.doc.flows.length, included: out.included, skipped: out.skipped };
  })()`);
  t.ok(older.flows === 0 && older.included === 0 && older.skipped === 2,
    'a flow with no graph is left out and counted, never shipped as a flow with no steps — ' +
    'an empty drawing would read as "this flow does nothing": ' + JSON.stringify(older));

  // ---- the two type mappings that depend on the flow, not the action ----
  const kinds = await mx.evaluate(`(function () {
    return [
      window.MxExchange.stepTypeOf('SynchronizeAction', 'microflow'),
      window.MxExchange.stepTypeOf('SynchronizeAction', 'nanoflow'),
      window.MxExchange.stepTypeOf('SomeFutureAction', 'microflow')
    ];
  })()`);
  t.ok(kinds[0] === 'synchronizeToDevice' && kinds[1] === 'synchronize',
    'Synchronize is a different element in a microflow than in a nanoflow, so the flow decides: ' +
    JSON.stringify(kinds));
  t.ok(kinds[2] === null,
    'an action with no counterpart gets no type at all rather than a wrong one — ' +
    'the Mendix name is still on the step: ' + JSON.stringify(kinds[2]));

  // ---- the button: it counts what it will export, and hides when it can't ----
  const MODEL = require('./model');
  const { openSeededProject } = require('./helpers');
  const EXPORT_BUTTON = `(function () {
    var b = Array.from(document.querySelectorAll('.view-controls button'))
      .filter(function (n) { return /^Export/.test(n.textContent); });
    return b.length ? b[0].textContent : null; })()`;
  const openMicroflows = `(function () {
    var n = Array.from(document.querySelectorAll('button,a')).filter(function (e) {
      return /^Microflows/.test(e.textContent.trim()); });
    n[n.length - 1].click(); return true; })()`;

  const plainModel = JSON.parse(JSON.stringify(MODEL));
  const ui = await openSeededProject(t, t.APP, plainModel);
  await ui.evaluate(openMicroflows);
  await ui.waitFor(`!!document.querySelector('.flow-card')`, 8000, 'flow list');
  t.ok(await ui.evaluate(EXPORT_BUTTON) === null,
    'a model with no drawings in it offers no export button — there would be nothing in the file');

  // The same project with one drawing stored on one microflow.
  const drawnModel = JSON.parse(JSON.stringify(MODEL));
  drawnModel.microflows[0].graph = {
    nodes: [
      { id: 'a', kind: 'start', action: null, caption: null, documentation: null,
        at: { x: 0, y: 0 }, size: { width: 20, height: 20 }, parentId: null, expression: null,
        rule: null, variable: null, returnValue: null, loop: null, disabled: false,
        kicker: null, title: null, meta: null, ref: null },
      { id: 'b', kind: 'activity', action: 'CommitAction', caption: null, documentation: null,
        at: { x: 100, y: 0 }, size: { width: 120, height: 60 }, parentId: null, expression: null,
        rule: null, variable: null, returnValue: null, loop: null, disabled: false,
        kicker: 'Commit object(s)', title: '$Order', meta: 'with events', ref: null }
    ],
    edges: [{ from: 'a', to: 'b', fromSide: 1, toSide: 3, kind: 'sequence', caseKind: null,
      caseValue: null, isError: false, fromVector: null, toVector: null }]
  };
  const ui2 = await openSeededProject(t, t.APP, drawnModel);
  await ui2.evaluate(openMicroflows);
  await ui2.waitFor(`!!document.querySelector('.flow-card')`, 8000, 'flow list again');
  const label = await ui2.evaluate(EXPORT_BUTTON);
  t.ok(label === 'Export 1 drawing',
    'the button names the number it will write, so the scope is never a guess: ' + JSON.stringify(label));

  // Pressing it, so the whole path is exercised rather than assumed: build the
  // document, serialise it, hand it to the browser's download, say what
  // happened. The toast names the file, which is the only part of a download
  // a test can see.
  await ui2.evaluate(`(function () {
    Array.from(document.querySelectorAll('.view-controls button'))
      .filter(function (n) { return /^Export/.test(n.textContent); })[0].click();
    return true; })()`);
  const toast = await ui2.waitFor(`document.querySelector('.msg.ok') && document.querySelector('.msg.ok').textContent`,
    8000, 'export confirmation');
  // If the click had thrown, no toast would appear and this is the assertion
  // that would say so — which is the console check, in the only form this
  // harness can make.
  t.ok(/^1 flow written to mxscout-flows-.*\.json$/.test(toast),
    'and pressing it writes the file and says so: ' + JSON.stringify(toast));
};
