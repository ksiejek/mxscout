/* The Documentation section of a project (public/docs-data.js · docs-view.js · docs.js).
 *
 * What it has to get right: it reads the whole model out of itself — modules, every microflow,
 * nanoflow and page with its workflow, the domain model, and where the model looks unfinished —
 * and draws it in the mendix-docs look (a rail, a list, a focus page with KPI tiles, tabs and
 * workflow cards from top to bottom). A call in a workflow, and the focus page's own button, open
 * that object's window in MxScout over the documentation. And the one export is a single HTML file
 * that opens in any browser, without an access code, and mounts the very same reader the app ran —
 * with nothing from the model able to become markup on the way. */
'use strict';
const { goToSection, goToDocsTab } = require('./helpers');
const fs = require('fs');
const http = require('http');
const path = require('path');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxDocs && !!window.MxDocsData && !!window.MxDocsView', 15000, 'MxScout loaded');
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    // A Marketplace module, hidden by default everywhere else: the export
    // still offers it, unticked.
    model.modules.push({ name: 'Atlas_Core', fromAppStore: true });
    await MxStore.saveProjectWithModel({ id: 'pdocs', name: 'DocDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, model);
  })()`);

  // ---- the section on screen ----
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button')).find(n => n.textContent.trim() === 'DocDemo')`, 10000, 'project');
  await mx.evaluate(`Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button')).find(n => n.textContent.trim() === 'DocDemo').click()`);
  await goToSection(mx, 'Documentation', '.docs-landing');
  t.ok(await mx.evaluate(`(function(){ var on = document.querySelector('.docs-tab.on'); return !!on && on.getAttribute('data-tab') === 'folder'; })()`),
    'the section opens on its Folder tab');
  t.ok(await mx.evaluate(`!document.querySelector('.docs-shot')`), 'and builds no previews there: they are on the Export tab only');
  await goToDocsTab(mx, 'export', '.docs-shot');

  // ---- the data behind it, read straight out of the model ----
  const built = await mx.evaluate(`(function () {
    var d = window.MxDocs.current();
    var create = d.flows['microflow:Sales.CreateOrder'];
    return {
      v: d.v, project: d.project, kpiMF: d.kpi.microflows, kpiEnt: d.kpi.entities,
      hasCreate: !!create, createHasWorkflow: !!(create && create.workflow && create.workflow.length),
      createCalls: (create ? create.calls : []).map(function (c) { return c.qn; }).join(','),
      entityKeys: Object.keys(d.entities).filter(function (k) { return !d.entities[k].builtin; }).length, hasOrder: !!d.entities['Sales.Order']
    };
  })()`);
  t.ok(built.v === 1 && built.project === 'DocDemo', 'the section is a versioned bundle built from the model: v' + built.v);
  t.ok(built.kpiMF === 2 && built.kpiEnt === built.entityKeys && built.entityKeys >= 3,
    'it counts the model — ' + built.kpiMF + ' microflows, ' + built.entityKeys + ' entities');
  t.ok(built.hasCreate && built.createHasWorkflow, 'every microflow carries a workflow tree, drawn from its graph');
  t.ok(/Sales\.SweepOrders/.test(built.createCalls), 'and the calls it makes are read out of the model: ' + built.createCalls);
  t.ok(built.hasOrder, 'the domain model is there too, every entity by qualified name');

  // ---- the section: what the file holds, a look at it, the export ----
  // The documentation is read in one place, the exported file. The section
  // says what is in it, shows the file's own reader drawn small, and builds it.
  const landing = await mx.evaluate(`document.querySelector('.docs-landing').textContent`);
  t.ok(/What is in it/.test(landing) && /Microflows, Nanoflows, Pages/.test(landing) && /Entities/.test(landing),
    'the section says what the documentation holds');
  t.ok(await mx.evaluate(`!!Array.from(document.querySelectorAll('.docs-landing button')).find(b => /Export documentation/.test(b.textContent))`),
    'and offers the export');
  t.ok(await mx.evaluate(`document.querySelectorAll('.docs-shot .dx.preview').length >= 2`),
    'its previews are the reader itself, drawn small from this project: ' + await mx.evaluate(`document.querySelectorAll('.docs-shot .dx.preview').length`));
  t.ok(await mx.evaluate(`!document.querySelector('.docs-landing > .dx')`), 'and there is no second, full reader in the app to keep true');
  const tiles = await mx.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('.docs-inside > .card')).map(function (x) { var r = x.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height)]; }))`);
  // Tiles side by side start at one height and are one height: the bug was a
  // margin that pushed every tile but the first 14px down.
  t.ok(JSON.parse(tiles).every(function (a, i, all) { return all.every(function (b) { var d = Math.abs(b[0] - a[0]); return d > 40 || (d === 0 && b[1] === a[1]); }); }),
    'the tiles of "What is in it" in one row are one height, the first no taller than the rest: ' + tiles);

  // ---- the export: which modules go in, chosen first ----
  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-landing button')).find(b => /Export documentation/.test(b.textContent)).click()`);
  await mx.waitFor(`!!document.querySelector('.docs-mods')`, 5000, 'module chooser');
  const mods = JSON.parse(await mx.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('.docs-mod')).map(function (l) { return [l.querySelector('strong').textContent, l.querySelector('input').checked]; }))`));
  t.ok(mods.some(function (m) { return m[0] === 'Sales' && m[1]; }) && mods.some(function (m) { return m[0] === 'Atlas_Core' && !m[1]; }),
    'every module is offered, own ones ticked and Marketplace ones not: ' + JSON.stringify(mods));
  const buildBtn = `Array.from(document.querySelectorAll('.modal button')).find(function (b) { return /Build file/.test(b.textContent); })`;
  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-mods-quick button')).find(function (b) { return b.textContent === 'None'; }).click()`);
  t.ok(await mx.evaluate(`${buildBtn}.disabled && /now 0 microflows/.test(document.querySelector('.modal').textContent)`),
    'with no module chosen there is nothing to build, and the count says so');
  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-mods-quick button')).find(function (b) { return b.textContent === 'Own modules'; }).click()`);
  t.ok(await mx.evaluate(`!${buildBtn}.disabled && /now 2 microflows/.test(document.querySelector('.modal').textContent)`),
    'and "Own modules" puts the project’s own back');
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(function (b) { return b.textContent === 'Close'; }).click()`);

  // ---- the export, round-tripped ----
  // Build the file exactly as the Export button does, then open it from a real origin.
  await mx.waitFor(`!!window.MxDocs.current()`, 5000, 'data kept');
  const html = await mx.evaluate(`(async function () {
    var data = JSON.parse(JSON.stringify(window.MxDocs.current()));
    data.project = data.project + '</script><b id="injected">x</b>';
    var css = await window.MxDocs.stylesheet();
    return window.MxDocs.buildFile(data, css, data.project, await window.MxDocs.flowScripts());
  })()`);
  t.ok(/^<!doctype html>/i.test(html) && html.indexOf('mxscout-data') !== -1 && html.indexOf('window.MxDocsView=') !== -1,
    'the file is one self-contained HTML page: the data, the reader source and the call that mounts it');
  t.ok(html.indexOf('CreateOrder') !== -1 && html.indexOf('MXS-') === -1 && html.indexOf('access code') === -1,
    'it carries the model as plain data and asks for no access code');
  t.ok(html.indexOf('--acc:') !== -1 && (html.match(/url\("data:font\/woff2;base64,/g) || []).length === 2 && !/url\("fonts\//.test(html),
    'it carries the design tokens and both fonts inside it, so it needs nothing from anywhere');

  const exportServer = http.createServer(function (req, res) { res.setHeader('Content-Type', 'text/html'); res.end(html); });
  const port = await new Promise(function (resolve) { exportServer.listen(0, '127.0.0.1', function () { resolve(exportServer.address().port); }); });
  try {
    const ex = await t.tab('http://127.0.0.1:' + port + '/');
    t.ok(await ex.waitFor(`!!document.querySelector('#doc .dx')`, 8000, 'mounts'),
      'it opens straight into the very reader the app ran');
    t.ok(await ex.evaluate(`!document.getElementById('injected') && !document.getElementById('gate') && !document.querySelector('.dx-lock')`),
      'no gate, and a project name with markup in it stays text — it cannot end the data block');
    t.ok(await ex.evaluate(`!Array.from(document.querySelectorAll('.dx button')).some(function (b) { return b.textContent.trim() === 'Export'; })`),
      'the exported copy carries no Export button — it is a leaf, not another source');
    // The project's documentation, not the tool's (redesign spec 10 §1).
    t.ok(await ex.evaluate(`document.querySelector('.dx-brand-tile').textContent === 'D' && /^DocDemo/.test(document.querySelector('.dx-brand-text').textContent) && /^DocDemo.* – documentation$/.test(document.title)`),
      'it carries the project’s mark — its first letter — and the project’s name in the title');
    t.ok(await ex.evaluate(`!/MxScout/.test(document.body.innerText) && !document.querySelector('meta[name="generator"]')`),
      'and names no tool anywhere a reader sees');

    // The reader, in the file.
    const nav = await ex.evaluate(`Array.from(document.querySelectorAll('.dx-nav-item')).map(function (b) { return b.querySelector('.dx-nav-label').textContent; }).join('|')`);
    t.ok(nav === 'Overview|Modules|Architecture|Entities|Microflows|Nanoflows|Pages|Model quality', 'the sections as MxScout has them — Architecture too, its modules and roles read from the model: ' + nav);
    t.ok(await ex.evaluate(`Array.from(document.querySelectorAll('.dx-nav-cap')).map(function (c) { return c.textContent; }).join('|')`) === 'Application|Model|Review',
      'grouped as MxScout’s sidebar is');
    t.ok(await ex.evaluate(`!!document.querySelector('.dx-ov-hero') && /^DocDemo/.test(document.querySelector('.dx-ov-h1').textContent) && document.querySelectorAll('.dx-glance dt').length >= 9`),
      'it opens on an overview: the project, and the model at a glance');
    // In the file a way to another page is a real link to that page's address (redesign spec 11).
    const links = await ex.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('.dx-glance a')).map(function (a) { return a.getAttribute('href'); }))`);
    t.ok(/"#\/modules"/.test(links) && /"#\/domain"/.test(links) && /"#\/quality\/sched"/.test(links), 'its figures are links to the pages they count: ' + links);
    t.ok(await ex.evaluate(`['light','dark'].indexOf(document.querySelector('.dx').getAttribute('data-theme')) !== -1 && document.querySelectorAll('.dx-theme button').length === 3`),
      'in a dark or a light theme, the reader’s choice or the system’s');

    // Every page has an address (redesign spec 10 §3), and the file carries
    // the values its pages work out (reportdata.js).
    t.ok(await ex.evaluate(`(function () { var d = JSON.parse(document.getElementById('mxscout-data').textContent); return !!(d.derived && d.derived.quality && d.derived.arch && d.derived.modules); })()`),
      'the file carries the derived values');
    await ex.evaluate(`Array.from(document.querySelectorAll('.dx-nav-item')).find(function (b) { return /Entities/.test(b.textContent); }).click()`);
    t.ok(await ex.evaluate(`location.hash`) === '#/domain', 'a page in the menu has its own address: ' + await ex.evaluate(`location.hash`));
    await ex.evaluate(`(function () { history.pushState(null, '', '#/flows/Sales.CreateOrder'); window.dispatchEvent(new PopStateEvent('popstate')); return true; })()`);
    t.ok(await ex.waitFor(`document.querySelector('.dx-nav-item.on .dx-nav-label').textContent === 'Microflows' && document.querySelector('.mf-row.on .mf-row-name') && document.querySelector('.mf-row.on .mf-row-name').textContent === 'CreateOrder'`, 3000, 'deep link'),
      'and an address opens the flow it names');
    await ex.evaluate(`(function () { history.pushState(null, '', '#/'); window.dispatchEvent(new PopStateEvent('popstate')); return true; })()`);

    // Microflows is MxScout's own flow screen, carried in the file (redesign spec 14).
    await ex.evaluate(`Array.from(document.querySelectorAll('.dx-nav-item')).find(function (b) { return /^Microflows/.test(b.textContent); }).click()`);
    await ex.waitFor(`!!document.querySelector('.dx-flows .mf-row')`, 5000, 'flow list');
    t.ok(await ex.evaluate(`document.querySelector('.dx-page-head h1').textContent === 'Microflows' && !document.querySelector('.dx-flows .xe-head')`),
      'its header names the page, as MxScout’s does; the sidebar picks microflows, nanoflows or pages');
    await ex.evaluate(`Array.from(document.querySelectorAll('.mf-row')).find(function (x) { return /CreateOrder/.test(x.textContent); }).click()`);
    // Workflow first: the flow top to bottom, the step beside it (Karol, 2026-10-14: both views, a switch).
    await ex.waitFor(`document.querySelectorAll('.fg-card').length >= 2 && !!document.querySelector('.mf-side')`, 5000, 'the workflow');
    t.ok(await ex.evaluate(`Array.from(document.querySelectorAll('.mf-actions button')).map(function (b) { return b.textContent; }).join('|')`) === 'Workflow|Modeler|Copy link',
      'a flow’s actions in the file: the Workflow | Modeler switch and Copy link — none of the app’s');
    await ex.evaluate(`Array.from(document.querySelectorAll('.mf-mode button')).find(function (b) { return b.textContent === 'Modeler'; }).click()`);
    await ex.waitFor(`document.querySelectorAll('.mf-board .sv-act').length >= 2`, 5000, 'the drawing');
    t.ok(await ex.evaluate(`Array.from(document.querySelectorAll('.mf-actions button')).map(function (b) { return b.textContent; }).join('|')`) === 'Workflow|Modeler|About this microflow|Copy link',
      'Modeler draws it as Studio Pro keeps it, with About beside the switch');
    // In Modeler a click on a step opens its window.
    await ex.evaluate(`Array.from(document.querySelectorAll('.mf-board .sv-act')).find(function (s) { return /^Step 2: /.test(s.getAttribute('aria-label')); }).click()`);
    const step = await ex.waitFor(`(function(){ var p = document.querySelector('.mf-step-win'); return p && /Members/.test(p.textContent) && p.textContent; })()`, 3000, 'step');
    t.ok(/Number/.test(step) && /^#\/flows\/Sales\.CreateOrder\?step=\d+$/.test(await ex.evaluate(`location.hash`)),
      'a click on a step opens what it does in a window, the members it sets among it, and the address keeps the step: ' + await ex.evaluate(`location.hash`));
    const stepNo = await ex.evaluate(`location.hash.split('step=')[1]`);
    await ex.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    t.ok(await ex.waitFor(`!document.querySelector('.mf-step-win') && !/step=/.test(location.hash)`, 3000, 'closed'), 'Esc closes it, and the step leaves the address');
    await ex.evaluate(`(function () { history.pushState(null, '', '#/'); window.dispatchEvent(new PopStateEvent('popstate')); history.pushState(null, '', '#/flows/Sales.CreateOrder?step=${stepNo}'); window.dispatchEvent(new PopStateEvent('popstate')); return true; })()`);
    t.ok(await ex.waitFor(`document.querySelector('.mf-step-win .mf-step-kick') && /^Step ${stepNo} /.test(document.querySelector('.mf-step-win .mf-step-kick').textContent)`, 3000, 'step link'),
      'and an address with a step opens the flow with that step’s window');
    await ex.evaluate(`document.querySelector('.mf-step-win .mf-x').click()`);
    await ex.evaluate(`Array.from(document.querySelectorAll('.dx-nav-item')).find(function (b) { return /^Pages/.test(b.textContent); }).click()`);
    await ex.waitFor(`!!document.querySelector('.dx-flows .mf-row')`, 5000, 'page list');
    await ex.evaluate(`document.querySelector('.dx-flows .mf-row').click()`);
    await ex.evaluate(`(function(){ var b = document.querySelector('.mf-detail .mf-about-open'); if (b) b.click(); return true; })()`);
    const page = await ex.waitFor(`(function(){ var d = document.querySelector('.mf-detail'); return d && /^Selected page/.test(d.getAttribute('aria-label')) && d.textContent; })()`, 3000, 'page');
    t.ok(/Details/.test(page) && /Opened from/.test(page) && /Roles that may open it/.test(page), 'a page shows its details and what opens it: ' + page.slice(0, 120));
    // The page drawn as Studio Pro draws it travels in the file too (pagepreview.js in SCRIPTS):
    // the overview page's list of every order is drawn as a list, its item and two faded repeats, and its three inputs.
    await ex.evaluate(`Array.from(document.querySelectorAll('.dx-flows .mf-row')).find(function (r) { return /Order_Overview/.test(r.textContent); }).click()`);
    const drawn = await ex.waitFor(`(function(){ var p = document.querySelector('.dx-flows .pp'); return p && JSON.stringify({ lists: p.querySelectorAll('.pp-lst').length, ghosts: p.querySelectorAll('.pp-ghost').length, inputs: p.querySelectorAll('.pp-fld').length }); })()`, 3000, 'drawn page');
    t.ok(/"lists":[1-9]/.test(drawn) && /"inputs":3/.test(drawn), 'and the exported file draws the page itself, as the app does: ' + drawn);

    // The domain model: one module drawn, the chosen entity beside it (redesign spec 15).
    await ex.evaluate(`Array.from(document.querySelectorAll('.dx-nav-item')).find(function (b) { return /Entities/.test(b.textContent); }).click()`);
    await ex.waitFor(`!!document.querySelector('.dx-dm-box')`, 5000, 'canvas');
    await ex.evaluate(`Array.from(document.querySelectorAll('.dx-dm-box')).find(function (x) { return x.querySelector('.dx-dm-bh b').textContent === 'Order'; }).click()`);
    t.ok(await ex.waitFor(`document.querySelector('.dx-dm-box.on .dx-dm-bh b') && document.querySelector('.dx-dm-box.on .dx-dm-bh b').textContent === 'Order' && location.hash === '#/domain/Sales/Order'`, 5000, 'picked'),
      'the module is drawn, a click picks an entity, and its address follows: ' + await ex.evaluate(`location.hash`));
    const around = await ex.evaluate(`document.querySelectorAll('.dx-dm-edge').length`);
    t.ok(around >= 1, 'with its associations drawn as lines: ' + around);
    await ex.evaluate(`Array.from(document.querySelectorAll('.dx-dm-box')).find(function (x) { return x.querySelector('.dx-dm-bh b').textContent === 'Customer'; }).click()`);
    const acc = await ex.waitFor(`document.querySelector('.dx-dm-insp h2').textContent === 'Customer' && document.querySelector('.dx-acc-row') && document.querySelector('.dx-acc').textContent`, 5000, 'access card');
    t.ok(/module role User/.test(acc) && /read/.test(acc) && /create/.test(acc) && /Only rows where/.test(acc) && /\[Age > 0\]/.test(acc),
      'one card per rule: the role, what it may do, and the XPath that limits the rows, exactly: ' + acc);
    await ex.evaluate(`Array.from(document.querySelectorAll('.dx-nav-item')).find(function (b) { return /quality/i.test(b.textContent); }).click()`);
    t.ok(await ex.waitFor(`/Nothing reaches these/.test(document.querySelector('.dx-main').textContent)`, 5000, 'quality'),
      'and Model quality reports where the model looks unfinished');
    t.ok(await ex.evaluate(`!/without access rules|skip entity access/.test(document.querySelector('.dx-main').textContent)`),
      'without the two access lists: what access a role has belongs to the entity and to the Security section, not to a list of exceptions (Karol, 2026-10-09)');
    await ex.close();
  } finally {
    exportServer.close();
  }

  await mx.close();
};
