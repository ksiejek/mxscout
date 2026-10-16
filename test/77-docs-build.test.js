/* The documentation's data: built without searching a page's text once per entity, and built
 * once per model, not once per click (public/docs-data.js pagePreview, public/docs.js buildData).
 *
 * Karol, 2026-10-14: on a large project the browser bogged down on opening Documentation. Each
 * page's preview searched the page's text once per entity and attribute of the whole model; and
 * the data was built again whenever the section was drawn afresh — sharing with an agent,
 * stopping, an answer arriving — and once more for each screen that read the model with the
 * System module added. What has to hold, none of it measured in time:
 *  - a page's preview names exactly the entities and attributes its text names — the same
 *    answer the search over the text gave, on names that start alike;
 *  - opening a project builds the data once, with its descriptions, not first without them;
 *  - opening the section builds the data and nothing else: not the AI pack, not the file;
 *  - drawing the section again, the export dialog, sharing and stopping build nothing;
 *  - the documentation's screens and the Entities screen share one build, and going back and
 *    forth between them builds nothing.
 * Karol, later the same day: on a large project Share with an agent and the first entry into
 * Documentation still took a while. The screens and the section build from two models that
 * hold the same flows and pages, and a click on Share drew the whole section again. So also:
 *  - a page's preview read from a second model, the same page, still names what THAT model has
 *    — and a model with an entity named without a module is read with every name;
 *  - a flow's entry is worked out once and handed to each build as its own copy: the copies
 *    share their workflow, carry their own descriptions, and the file does not see the link;
 *  - opening a project reads its descriptions beside its model, not after it;
 *  - the flows' texts are worked out while the browser is idle, and the pack still is not;
 *  - Share, a poll for an answer, and Stop draw the agent's card again and nothing else: not
 *    the previews, not the chat assistant's card, not the pack a second time. */
'use strict';
const { goToSection, goToDocsTab } = require('./helpers');
const fs = require('fs');
const path = require('path');

// The preview's entities and attributes as docs-data.js worked them out before: the page's text
// searched once per entity and attribute of the model. Kept here as the reference the faster
// lookup must agree with.
function referencePreview(p, model) {
  var snippetsByName = {};
  (model.snippets || []).forEach(function (s) { snippetsByName[s.qualifiedName] = s; });
  var snippets = {};
  (function place(structure) {
    (function walk(nodes) {
      (nodes || []).forEach(function (n) {
        if (n.kind === 'snippet' && n.snippet && !snippets[n.snippet] && snippetsByName[n.snippet] && snippetsByName[n.snippet].structure) {
          var s = snippetsByName[n.snippet];
          snippets[n.snippet] = { parameters: (s.parameters || []).map(function (x) { return { name: x.name, type: x.entityQualifiedName || x.type || 'value' }; }), structure: s.structure };
          place(s.structure);
        }
        walk(n.widgets); walk(n.footer);
      });
    })((structure.regions || []).reduce(function (all, r) { return all.concat(r.widgets || []); }, []));
  })(p.structure);
  var text = JSON.stringify(p.structure) + JSON.stringify(snippets) + JSON.stringify(p.parameters || []);
  var enums = {};
  (model.enumerations || []).forEach(function (e) { enums[e.qualifiedName] = e.values || []; });
  var attributes = {}, entities = {};
  (model.entities || []).forEach(function (e) {
    if (text.indexOf('"' + e.qualifiedName) === -1) return;
    if (text.indexOf('"' + e.qualifiedName + '"') !== -1) entities[e.qualifiedName] = { stored: e.persistable !== false, view: !!e.viewEntity };
    (e.attributes || []).forEach(function (a) {
      var q = e.qualifiedName + '.' + a.name;
      if (text.indexOf('"' + q + '"') === -1) return;
      var vals = a.enumerationQualifiedName && enums[a.enumerationQualifiedName];
      attributes[q] = vals ? { type: 'Enumeration', values: vals.map(function (v) { return v.caption || v.name; }) } : { type: a.type || null };
    });
  });
  return { structure: p.structure, snippets: snippets, attributes: attributes, entities: entities };
}

// Names that start alike, an attribute named like an entity, a snippet inside a snippet, a name
// that is an object's own property elsewhere, a key that is a name, a name inside other text.
const MODEL = {
  entities: [
    { qualifiedName: 'Shop.Order', attributes: [{ name: 'Number', type: 'String' }, { name: 'State', enumerationQualifiedName: 'Shop.OrderState' }, { name: 'Line', type: 'Integer' }] },
    { qualifiedName: 'Shop.OrderLine', persistable: false, attributes: [{ name: 'Qty', type: 'Integer' }, { name: 'constructor', type: 'String' }] },
    { qualifiedName: 'Shop.Customer', viewEntity: true, attributes: [{ name: 'Name', type: 'String' }] },
    { qualifiedName: 'Shop.Unused', attributes: [{ name: 'X', type: 'String' }] },
    { qualifiedName: 'Shop.Order', attributes: [{ name: 'Twice', type: 'Boolean' }] }
  ],
  enumerations: [{ qualifiedName: 'Shop.OrderState', values: [{ name: 'Open', caption: 'Open' }, { name: 'Done' }] }],
  snippets: [
    { qualifiedName: 'Shop.Snip', parameters: [{ name: 'C', entityQualifiedName: 'Shop.Customer' }],
      structure: { regions: [{ widgets: [{ kind: 'snippet', snippet: 'Shop.Inner' }, { kind: 'input', attribute: 'Shop.Customer.Name' }] }] } },
    { qualifiedName: 'Shop.Inner', structure: { regions: [{ widgets: [{ kind: 'input', attribute: 'Shop.OrderLine.constructor' }] }] } }
  ]
};
const PAGES = [
  { qualifiedName: 'Shop.Edit', parameters: [{ name: 'Order', entityQualifiedName: 'Shop.Order' }],
    structure: { regions: [{ widgets: [
      { kind: 'input', attribute: 'Shop.Order.Number', caption: 'see "Shop.Unused" and Shop.OrderLine.Qty' },
      { kind: 'input', attribute: 'Shop.Order.State', 'Shop.Order.Line': 'a key, not a value' },
      { kind: 'text', name: '__proto__', caption: 'constructor' },
      { kind: 'snippet', snippet: 'Shop.Snip' }] }] } },
  { qualifiedName: 'Shop.Empty', structure: { regions: [] } },
  { qualifiedName: 'Shop.Bare' }
];

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxDocs && !!window.MxDocsData && !!window.MxDescribe', 15000, 'MxScout loaded');
  await mx.viewport(1440, 900);

  // ---- a page's preview: the lookup agrees with the search over the text ----
  const previews = await mx.evaluate(`(function () {
    var model = ${JSON.stringify(MODEL)}, pages = ${JSON.stringify(PAGES)};
    var reference = ${referencePreview.toString()};
    return pages.map(function (p) {
      var now = window.MxDocsData.pageEntry(p, model).preview;
      var was = p.structure ? reference(p, model) : null;
      return { page: p.qualifiedName, same: JSON.stringify(now) === JSON.stringify(was), now: now && { e: Object.keys(now.entities), a: Object.keys(now.attributes) } };
    });
  })()`);
  t.ok(previews.every((p) => p.same), 'a page’s preview names the same entities and attributes, in the same order, as the search over its text did: ' + JSON.stringify(previews));
  const across = await mx.evaluate(`(function () {
    var model = ${JSON.stringify(MODEL)}, pages = ${JSON.stringify(PAGES)};
    var reference = ${referencePreview.toString()};
    // The same page read from a second model — another list of entities, the same snippets — and
    // from a model with an entity named without a module.
    var more = Object.assign({}, model, { entities: model.entities.concat([{ qualifiedName: 'System.User', attributes: [{ name: 'Name', type: 'String' }] }]) });
    var loose = Object.assign({}, model, { entities: model.entities.concat([{ qualifiedName: 'Loose', attributes: [{ name: 'Qty', type: 'Integer' }] }]) });
    var p = pages[0];
    p.structure.regions[0].widgets.push({ kind: 'input', attribute: 'System.User.Name', entity: 'System.User', note: 'Loose', other: 'Loose.Qty' });
    return [model, more, loose, model].map(function (m) {
      var now = window.MxDocsData.pageEntry(p, m).preview, was = reference(p, m);
      return { same: JSON.stringify(now) === JSON.stringify(was), e: Object.keys(now.entities), a: Object.keys(now.attributes) };
    });
  })()`);
  t.ok(across.every((x) => x.same) && across[1].e.indexOf('System.User') !== -1 && across[0].e.indexOf('System.User') === -1 && across[2].e.indexOf('Loose') !== -1 && across[2].a.indexOf('Loose.Qty') !== -1,
    'the same page read from another model names what that model has — read again for each, not handed the first one’s answer — and an entity named without a module is found: ' + JSON.stringify(across));
  const edit = previews[0].now;
  t.ok(edit && edit.e.join() === 'Shop.Order,Shop.Customer' && edit.a.join() === 'Shop.Order.Number,Shop.Order.State,Shop.Order.Line,Shop.OrderLine.constructor,Shop.Customer.Name',
    'and that is what the page and its snippets name — a key included, a name inside other text not: ' + JSON.stringify(edit));

  // ---- a project, opened ----
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    await MxStore.saveProjectWithModel({ id: 'ponce', name: 'BuiltOnce', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, model);
    await MxStore.put('descriptions', { projectId: 'ponce', importedAt: new Date().toISOString(), fileName: 'd.json',
      value: MxDescribe.parse(JSON.stringify({ format: 'mxscout-descriptions', version: 1, microflows: { 'Sales.CreateOrder': { text: 'Opens a fresh order.' } } })).value });
  })()`);
  const SW = "(function(q){var s=document.querySelector('.switcher[aria-expanded=\"false\"]'); if (s) s.click(); return document.querySelectorAll(q);})";
  await mx.navigate(t.MX);
  await mx.waitFor(`!!window.MxDocs && !!Array.from(${SW}('.tree-project')).find(b => b.textContent.indexOf('BuiltOnce') !== -1)`, 10000, 'project');
  // Counted from here: how often this project's data is built, and what the pack and the file are asked for.
  await mx.evaluate(`(function () {
    window.__asked = { pack: 0, file: 0, data: 0, text: 0, reads: [] };
    var pack = window.MxDescribe.pack, file = window.MxDocsFile.build, data = window.MxDocsData.build, text = window.MxDescribe.flowText;
    window.MxDescribe.flowText = function () { window.__asked.text++; return text.apply(this, arguments); };
    var getModel = window.MxStore.getModel, get = window.MxStore.get;
    window.MxStore.getModel = function (id) {
      if (id === 'ponce') window.__asked.reads.push('model asked');
      return getModel.apply(this, arguments).then(function (m) { if (id === 'ponce') window.__asked.reads.push('model read'); return m; });
    };
    window.MxStore.get = function (store, id) { if (store === 'descriptions' && id === 'ponce') window.__asked.reads.push('descriptions asked'); return get.apply(this, arguments); };
    // Only this project's: another one the app had open may still be drawn while this one opens.
    window.MxDocsData.build = function (model, project) { if (project && project.id === 'ponce') window.__asked.data++; return data.apply(this, arguments); };
    window.MxDescribe.pack = function () { window.__asked.pack++; return pack.apply(this, arguments); };
    window.MxDocsFile.build = function () { window.__asked.file++; return file.apply(this, arguments); };
    return true;
  })()`);
  await mx.evaluate(`Array.from(${SW}('.tree-project')).find(b => b.textContent.indexOf('BuiltOnce') !== -1).click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.tree-section')).find(b => /^Documentation/.test(b.textContent))`, 8000, 'sections');
  const go = (name) => goToSection(mx, name);
  const builds = () => mx.evaluate('window.__asked.data');
  const button = (label) => mx.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === ${JSON.stringify(label)}).click()`);

  // ---- opening the project: one build, with its descriptions ----
  await mx.waitFor(`!!document.querySelector('.doc-screen .dx-only') && window.MxDocs.descriptionsFor('ponce') !== undefined`, 8000, 'the project’s Overview, its descriptions read');
  t.ok(await builds() === 1, 'opening the project builds the data once, with its descriptions — not first without them while they are read, and again with them: ' + (await builds()));
  const reads = await mx.evaluate('window.__asked.reads');
  t.ok(reads.indexOf('descriptions asked') !== -1 && reads.indexOf('descriptions asked') < reads.indexOf('model read'),
    'its descriptions are asked for beside its model, before the model is read — not after: ' + reads.join(' → '));
  const flowCount = await mx.evaluate(`MxStore.getModel('ponce').then(function (m) { return m.microflows.length + m.nanoflows.length; })`);
  await mx.waitFor('window.__asked.text >= ' + flowCount, 8000, 'the flows’ texts worked out while idle');
  t.ok((await mx.evaluate('window.__asked.pack')) === 0, 'the flows’ texts are worked out while the browser is idle, before anything asks for them — and the pack still is not made');

  // ---- opening the section ----
  await go('Documentation');
  await mx.waitFor(`!!document.querySelector('.docs-landing') && window.MxDocs.descriptionsFor('ponce') !== undefined`, 8000, 'the section, its descriptions read');
  const opened = await builds();
  t.ok(await mx.evaluate(`window.MxDocs.current().flows['microflow:Sales.CreateOrder'].desc`) === 'Opens a fresh order.', 'and the section’s data carries the descriptions');
  const asked = await mx.evaluate('window.__asked');
  t.ok(asked.pack === 0 && asked.file === 0, 'opening Documentation builds neither the AI pack nor the file — those wait to be asked for: ' + JSON.stringify(asked));

  // ---- a flow's entry: worked out once, a copy for each build ----
  const copies = await mx.evaluate(`(async function () {
    // Another project's id, so the builds counted above are this project's own.
    var model = await MxStore.getModel('ponce'), p = { id: 'copies', name: 'BuiltOnce' };
    var more = Object.assign({}, model, { entities: model.entities.concat([{ module: 'System', name: 'User', qualifiedName: 'System.User', attributes: [], accessRules: [] }]) });
    var a = MxDocsData.build(model, p), b = MxDocsData.build(more, p);
    var keys = Object.keys(a.flows).filter(function (k) { return a.flows[k].kind !== 'page'; });
    var k = 'microflow:Sales.CreateOrder';
    var out = {
      flows: keys.length,
      own: keys.every(function (k) { return a.flows[k] !== b.flows[k]; }),
      shared: keys.every(function (k) { return a.flows[k].workflow === b.flows[k].workflow && JSON.stringify(a.flows[k]) === JSON.stringify(b.flows[k]); }),
      hidden: keys.every(function (k) { return Object.keys(a.flows[k]).indexOf('same') === -1; }) && JSON.stringify(a).indexOf('"same"') === -1
    };
    a.flows[k].desc = 'only on this build';
    out.desc = b.flows[k].desc === undefined;
    var c = MxDocsData.build(Object.assign({}, model), p);
    c.generatedAt = a.generatedAt;
    out.pack = MxDescribe.pack(a).text === MxDescribe.pack(c).text;
    window.__asked.pack -= 2;
    return out;
  })()`);
  t.ok(copies.flows > 0 && copies.own && copies.shared && copies.desc && copies.hidden,
    'two builds of the same flows hand each its own entry, sharing the workflow worked out once, each keeping its own descriptions, the link not in the file: ' + JSON.stringify(copies));
  t.ok(copies.pack, 'and the pack says the same from either build');

  // ---- drawn again: the export dialog, sharing and stopping ----
  await goToDocsTab(mx, 'export', '.docs-shots');
  await button('Export documentation…');
  await mx.waitFor(`!!document.querySelector('.docs-mods input')`, 5000, 'export dialog');
  await mx.evaluate(`document.querySelector('.docs-mods input').click()`);
  await button('Close');
  await mx.waitFor(`!document.querySelector('.modal')`, 5000, 'dialog closed');
  // Sharing is on its own tab: what is checked is that a press there draws its card again and
  // nothing else — the section's header stays the one drawn, and the reader is mounted no more.
  await goToDocsTab(mx, 'agent', '.docs-agent');
  await mx.evaluate(`(function () {
    window.__kept = { shots: document.querySelector('.docs-head'), copilot: document.querySelector('.docs-tabs'), mounts: 0, polls: 0 };
    var mount = window.MxDocsView.mount, f = window.fetch;
    window.MxDocsView.mount = function () { window.__kept.mounts++; return mount.apply(this, arguments); };
    window.fetch = function (u) { if (String(u).indexOf('/api/agent/inbox') !== -1) window.__kept.polls++; return f.apply(this, arguments); };
    return true;
  })()`);
  const untouched = `(function () { var k = window.__kept; return k.shots && k.shots === document.querySelector('.docs-head') && k.copilot === document.querySelector('.docs-tabs') && k.mounts === 0; })()`;
  await button('Share with an agent');
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Stop sharing')`, 8000, 'sharing');
  t.ok(await mx.evaluate(untouched), 'Share draws the agent’s card again and nothing else: the header and the tabs are the ones drawn before, the reader mounted no more: ' + JSON.stringify(await mx.evaluate('window.__kept.mounts')));
  await mx.waitFor('window.__kept.polls >= 1', 8000, 'a poll for an answer');
  await new Promise((r) => setTimeout(r, 300));
  t.ok(await mx.evaluate(untouched) && (await mx.evaluate('window.__asked.pack')) === 1, 'a poll for an answer draws nothing and makes no pack');
  await button('Stop sharing');
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Share with an agent')`, 8000, 'stopped');
  t.ok(await mx.evaluate(untouched), 'and Stop sharing draws the card again, nothing else');
  t.ok(await builds() === opened, 'the export dialog, sharing and stopping draw the section again without building its data again: ' + opened + ' then ' + (await builds()));
  t.ok((await mx.evaluate('window.__asked.pack')) === 1, 'and sharing made the pack once, when it was asked for');

  // ---- the screens: one build for all of them ----
  // View as starts on the app's first role; Entities under a role reads a narrower model of its own
  // (domain.js). Everything first, so the screens below all read the whole model.
  await go('Entities');
  await mx.waitFor(`!!document.querySelector('.dm-screen .role-select')`, 8000, 'entities header');
  await mx.evaluate(`(function(){ var s = document.querySelector('.dm-screen .role-select'); if (s.value !== 'all') { s.value = 'all'; s.dispatchEvent(new Event('change')); } return true; })()`);
  await mx.waitFor(`!!document.querySelector('.dm-embed')`, 8000, 'entities, everything');
  await go('Overview');
  await mx.waitFor(`!!document.querySelector('.doc-screen')`, 8000, 'overview');
  const screens = await builds();
  await go('Entities');
  await mx.waitFor(`!!document.querySelector('.dm-embed')`, 8000, 'entities');
  t.ok(await builds() === screens, 'the Entities screen reads the same build as the documentation’s screens: ' + screens + ' then ' + (await builds()));
  for (const name of ['Modules', 'Risks', 'Documentation', 'Overview', 'Entities', 'Model quality', 'Documentation']) {
    await go(name);
    await mx.waitFor(`!!document.querySelector('.docs-landing, .doc-screen, .dm-embed')`, 8000, name);
  }
  t.ok(await builds() === screens, 'and going back and forth between them and Documentation builds nothing more: ' + (await builds()));
  t.ok((await mx.evaluate('window.__asked.file')) === 0, 'nor the file, which only Build file makes');
};
