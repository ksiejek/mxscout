/* The project TREE: modules, the folders a team made inside them, and every
 * document in them.
 *
 * The `Unit` table in a .mpr IS that tree, and MxScout has always walked it —
 * it climbed from a document through its folders to find the owning module and
 * dropped every folder name it passed on the way. This is what keeping them
 * looks like.
 *
 * Measured on four real projects (Helpdesk, Avalon, Bridge, HeadQuarters)
 * before any of it was written, and three of those measurements are the reason
 * for a shape here that would otherwise look like over-engineering:
 *   - a folder name can contain a slash (`Endpoint/Service mapping`), so a
 *     path is a LIST of names and never a joined string;
 *   - 14 to 34 folders per project hold no document at all, and are named
 *     `#v1.0.0` or `_Version 11.1.0` — a note somebody left, so `folders`
 *     carries them rather than letting a document-built tree drop them;
 *   - a qualified name is not unique across kinds (a scheduled event named
 *     after the microflow it runs), so a document is identified by its type as
 *     well as its name, and a flow carries its own path instead of looking one
 *     up by name.
 *
 * Both fixtures (v1 Contents-inline, v2 contents-in-files) encode the same
 * tree, so it must come out identical from both. */
'use strict';
const fs = require('fs');
const path = require('path');

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

  function docOf(model, name, type) {
    return model.documents.filter(function (d) {
      return d.name === name && (!type || d.type === type);
    })[0];
  }
  function folderOf(model, name) {
    return model.folders.filter(function (f) { return f.name === name; })[0];
  }

  t.ok(JSON.stringify(v2.folders) === JSON.stringify(v1.folders) &&
    JSON.stringify(v2.documents) === JSON.stringify(v1.documents),
    'the two .mpr formats produce the identical tree');

  // ---- folders ----
  t.ok(v1.folders.length === 3,
    'every folder unit is in the model, not only the ones holding something: ' + v1.folders.length);
  t.ok(JSON.stringify(folderOf(v1, 'Orders')) ===
    JSON.stringify({ module: 'Sales', name: 'Orders', path: [] }),
    'a folder directly in a module has an empty path: ' + JSON.stringify(folderOf(v1, 'Orders')));
  t.ok(JSON.stringify(folderOf(v1, 'Export/Import')) ===
    JSON.stringify({ module: 'Sales', name: 'Export/Import', path: ['Orders'] }),
    'a folder inside a folder names the one it is in: ' + JSON.stringify(folderOf(v1, 'Export/Import')));

  const empty = folderOf(v1, '#v1.0.0');
  t.ok(!!empty && !v1.documents.some(function (d) { return d.path.indexOf('#v1.0.0') !== -1; }),
    'a folder with nothing in it is still in the model — in four real projects that is where ' +
    'a team wrote down which version of a Marketplace module it took');

  // ---- documents: all of them, not only the three kinds MxScout models ----
  t.ok(v1.documents.length === 11,
    'every named document under a module gets a line: ' + v1.documents.length);
  const kinds = v1.documents.map(function (d) { return d.kind; }).sort();
  t.ok(JSON.stringify(kinds) === JSON.stringify(['Java action', 'constant', 'enumeration',
    'microflow', 'microflow', 'page', 'page', 'published REST service', 'scheduled event',
    'snippet', 'view entity source document']),
    'including the kinds MxScout models nothing else about: ' + JSON.stringify(kinds));
  t.ok(docOf(v1, 'SendMail').kind === 'Java action',
    'a kind that the type name alone would lowercase into a typo is spelled properly: ' +
    docOf(v1, 'SendMail').kind);
  t.ok(docOf(v1, 'OpenOrders').kind === 'view entity source document' &&
    docOf(v1, 'OpenOrders').type === 'DomainModels$ViewEntitySourceDocument',
    'a kind nobody listed falls back to the type’s own words rather than being dropped, ' +
    'and the raw type is on the row either way: ' + JSON.stringify(docOf(v1, 'OpenOrders')));
  t.ok(v1.documents.every(function (d) { return d.module === 'Sales' && d.qualifiedName === 'Sales.' + d.name; }),
    'every document names its module and its qualified name');

  // ---- the path, and why it is a list ----
  const page = docOf(v1, 'Order_Overview');
  t.ok(JSON.stringify(page.path) === JSON.stringify(['Orders', 'Export/Import']),
    'a document two folders down carries both names, outermost first: ' + JSON.stringify(page.path));
  t.ok(page.path.length === 2,
    'the slash in "Export/Import" is INSIDE one name — a path joined into a string would read ' +
    'as three folders here, which is why it is a list: ' + JSON.stringify(page.path));
  t.ok(JSON.stringify(docOf(v1, 'SweepOrders').path) === JSON.stringify([]),
    'a document straight in the module has no path at all: ' + JSON.stringify(docOf(v1, 'SweepOrders').path));

  // ---- the same path, on the objects the rest of the app already renders ----
  function flowOf(model, qn) {
    return model.microflows.filter(function (f) { return f.qualifiedName === qn; })[0];
  }
  t.ok(JSON.stringify(flowOf(v1, 'Sales.CreateOrder').path) === JSON.stringify(['Orders']),
    'a microflow carries where it lives: ' + JSON.stringify(flowOf(v1, 'Sales.CreateOrder').path));
  const overview = v1.pages.filter(function (p) { return p.name === 'Order_Overview'; })[0];
  t.ok(JSON.stringify(overview.path) === JSON.stringify(['Orders', 'Export/Import']),
    'and so does a page: ' + JSON.stringify(overview.path));

  // ---- order ----
  // Folders before the documents beside them, and a path compared name by
  // name: "Orders" sorts before "Orders / Export/Import", which a joined
  // string would also get right here and would get wrong on a name whose
  // slash falls between two real folder names.
  const order = v1.documents.map(function (d) { return d.path.concat([d.name]).join(' > '); });
  t.ok(JSON.stringify(order) === JSON.stringify([
    'MaxOrders', 'OpenOrders', 'orders', 'SendMail', 'Status', 'SweepOrders', 'SweepOrders',
    'Orders > CreateOrder', 'Orders > CreateOrder', 'Orders > OrderLines',
    'Orders > Export/Import > Order_Overview'
  ]), 'documents come out in tree order: module, then folder path, then name: ' + JSON.stringify(order));
  t.ok(JSON.stringify(v1.documents.filter(function (d) { return d.name === 'CreateOrder'; })
    .map(function (d) { return d.kind; })) === JSON.stringify(['page', 'microflow']),
    'and where two documents in one folder share a name, the type breaks the tie rather than one of ' +
    'them disappearing: ' + JSON.stringify(v1.documents.filter(function (d) { return d.name === 'CreateOrder'; })));

  // ---- and it reaches the handover file MxScaffold reads ----
  await loadScript('/exchange.js');
  const exported = await mx.evaluate(`(function () {
    var model = ${JSON.stringify({
      meta: v1.meta, microflows: v1.microflows, nanoflows: v1.nanoflows
    })};
    var built = window.MxExchange.buildFlowsDocument(model, { scope: null, version: '1.0.0' });
    return built.doc.flows.map(function (f) { return { name: f.name, path: f.path || null }; });
  })()`);
  t.ok(exported.some(function (f) { return f.name === 'Sales.CreateOrder' && JSON.stringify(f.path) === '["Orders"]'; }),
    'an exported flow says which folder it came out of: ' + JSON.stringify(exported));
  t.ok(exported.some(function (f) { return f.name === 'Sales.SweepOrders' && f.path === null; }),
    'and one that sits straight in its module leaves the field out rather than carrying an empty list');

  await mx.close();
};
