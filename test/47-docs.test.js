/* The Documentation section of a project (public/docs-data.js · docs-view.js · docs.js).
 *
 * What it has to get right: it reads the whole model out of itself — modules, every microflow,
 * nanoflow and page with its workflow, the domain model, and where the model looks unfinished —
 * and draws it in the mendix-docs look (a rail, a list, a focus page with KPI tiles, tabs and
 * workflow cards from top to bottom). A call in a workflow, and the focus page's own button, open
 * that object's window in MxScout over the documentation. And the one export is a single HTML file,
 * encrypted with the same WebCrypto envelope and access code as the review report: it opens in any
 * browser, asks for the code, and mounts the very same reader the app ran — while the file itself
 * carries none of the model in the clear. */
'use strict';
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
    await MxStore.saveProjectWithModel({ id: 'pdocs', name: 'DocDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, model);
  })()`);

  // ---- the section on screen ----
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button')).find(n => n.textContent.trim() === 'DocDemo')`, 10000, 'project');
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(n => n.textContent.trim() === 'DocDemo').click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.tree-section')).find(n => /^Documentation/.test(n.textContent))`, 8000, 'sections');
  await mx.evaluate(`Array.from(document.querySelectorAll('.tree-section')).find(n => /^Documentation/.test(n.textContent)).click()`);
  await mx.waitFor(`!!document.querySelector('.docs-landing')`, 8000, 'section opens');

  // ---- the data behind it, read straight out of the model ----
  const built = await mx.evaluate(`(function () {
    var d = window.MxDocs.current();
    var create = d.flows['microflow:Sales.CreateOrder'];
    return {
      v: d.v, project: d.project, kpiMF: d.kpi.microflows, kpiEnt: d.kpi.entities,
      hasCreate: !!create, createHasWorkflow: !!(create && create.workflow && create.workflow.length),
      createCalls: (create ? create.calls : []).map(function (c) { return c.qn; }).join(','),
      entityKeys: Object.keys(d.entities).length, hasOrder: !!d.entities['Sales.Order']
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
  t.ok(/What is in it/.test(landing) && /Microflows & pages/.test(landing) && /Domain model/.test(landing),
    'the section says what the documentation holds');
  t.ok(await mx.evaluate(`!!Array.from(document.querySelectorAll('.docs-landing button')).find(b => /Export documentation/.test(b.textContent))`),
    'and offers the export');
  t.ok(await mx.evaluate(`document.querySelectorAll('.docs-shot .dx.preview').length >= 2`),
    'its previews are the reader itself, drawn small from this project: ' + await mx.evaluate(`document.querySelectorAll('.docs-shot .dx.preview').length`));
  t.ok(await mx.evaluate(`!document.querySelector('.docs-landing > .dx')`), 'and there is no second, full reader in the app to keep true');

  // ---- the encrypted export, round-tripped ----
  // Build the file exactly as the Export button does, then open it from a real
  // origin (127.0.0.1 is a secure context, so the browser allows decryption).
  await mx.waitFor(`!!window.MxDocs.current()`, 5000, 'data kept');
  const bundle = await mx.evaluate(`(async function () {
    var data = window.MxDocs.current();
    var code = window.MxCrypto.generateCode();
    var css = await (await fetch('/docs.css')).text();
    var env = await window.MxCrypto.pack(data, code);
    return { html: window.MxDocs.buildFile(env, css, data.project), code: code };
  })()`);
  const html = bundle.html, code = bundle.code;
  t.ok(/^<!doctype html>/i.test(html) && html.indexOf('mxscout-payload') !== -1 && html.indexOf('window.MxDocsView=') !== -1,
    'the file is one self-contained HTML page: the payload, the reader source and the gate');
  // The documentation names the app's weak spots, so none of the model may be
  // in the file in the clear — only the encrypted payload.
  t.ok(html.indexOf('CreateOrder') === -1 && html.indexOf('SweepOrders') === -1 && html.indexOf('Sales.Order') === -1,
    'and nothing of the model is readable in it — it is encrypted, not merely bundled');

  const exportServer = http.createServer(function (req, res) { res.setHeader('Content-Type', 'text/html'); res.end(html); });
  const port = await new Promise(function (resolve) { exportServer.listen(0, '127.0.0.1', function () { resolve(exportServer.address().port); }); });
  try {
    const ex = await t.tab('http://127.0.0.1:' + port + '/');
    await ex.waitFor(`!!document.getElementById('unlock') && !!document.getElementById('gate')`, 8000, 'gate');
    t.ok(!(await ex.evaluate(`!!document.querySelector('.dx')`)), 'it opens locked — no documentation until the code is given');

    // Wrong code is refused.
    await ex.evaluate(`document.getElementById('code').value = 'MXS-AAAAA-BBBBB-CCCCC-DDDDD'; document.getElementById('unlock').click()`);
    await ex.waitFor(`/does not open/.test(document.getElementById('err').textContent)`, 8000, 'wrong code');
    t.ok(await ex.evaluate(`!document.querySelector('.dx')`), 'a wrong access code opens nothing');

    // The right code mounts the reader.
    await ex.evaluate(`document.getElementById('unlock').disabled = false; document.getElementById('code').value = ${JSON.stringify(code)}; document.getElementById('unlock').click()`);
    t.ok(await ex.waitFor(`!!document.querySelector('#doc .dx')`, 8000, 'mounts'),
      'the right access code mounts the very reader the app ran');
    t.ok(await ex.evaluate(`document.getElementById('gate').style.display === 'none' && !!document.querySelector('.dx-lock')`),
      'the gate steps aside and the reader marks itself encrypted');
    t.ok(await ex.evaluate(`!Array.from(document.querySelectorAll('.dx button')).some(function (b) { return b.textContent.trim() === 'Export'; })`),
      'the exported copy carries no Export button — it is a leaf, not another source');
    t.ok(await ex.evaluate(`!!document.querySelector('.dx-brand') && /MxScout/.test(document.querySelector('.dx-brand').textContent)`),
      'it carries MxScout’s mark, so a reader can see what made it');

    // The reader, in the file.
    const nav = await ex.evaluate(`Array.from(document.querySelectorAll('.dx-nav-item')).map(function (b) { return b.firstChild.textContent; }).join('|')`);
    t.ok(nav === 'Overview|Modules|Microflows & pages|Domain model|Model quality', 'five sections: ' + nav);
    t.ok(await ex.evaluate(`!!document.querySelector('.dx-hero') && document.querySelectorAll('.dx-kpi').length === 8`),
      'it opens on an overview and eight figures');
    t.ok(await ex.evaluate(`['light','dark'].indexOf(document.querySelector('.dx').getAttribute('data-theme')) !== -1 && document.querySelectorAll('.dx-theme button').length === 3`),
      'in a dark or a light theme, the reader’s choice or the system’s');

    // A flow: what it takes, where it ends, its workflow, and a step's data on a click.
    await ex.evaluate(`Array.from(document.querySelectorAll('.dx-nav-item')).find(function (b) { return /Microflows/.test(b.textContent); }).click()`);
    await ex.waitFor(`!!document.querySelector('.dx-list .dx-item')`, 5000, 'flow list');
    await ex.evaluate(`Array.from(document.querySelectorAll('.dx-list .dx-item')).find(function (x) { return /CreateOrder/.test(x.textContent); }).click()`);
    await ex.waitFor(`document.querySelectorAll('.wfx-step').length >= 2`, 5000, 'export workflow');
    t.ok(await ex.evaluate(`!!document.querySelector('.dx-ends .dx-end.in') && !!document.querySelector('.dx-ends .dx-end.out')`),
      'a flow states its entry and its exits before its first step');
    await ex.evaluate(`Array.from(document.querySelectorAll('.wfx-step')).find(function (s) { return /Create object/i.test(s.textContent); }).click()`);
    const step = await ex.waitFor(`(function(){ var d = document.querySelector('.wfx-detail'); return d && !d.hidden && d.textContent; })()`, 3000, 'pinned');
    t.ok(/Created with/.test(step) && /Number/.test(step), 'a click on a step pins it, with the data it sets — from the decrypted data alone');

    // The domain model: a map around one entity.
    await ex.evaluate(`Array.from(document.querySelectorAll('.dx-nav-item')).find(function (b) { return /Domain/.test(b.textContent); }).click()`);
    await ex.evaluate(`Array.from(document.querySelectorAll('.dx-list .dx-item')).find(function (x) { return x.querySelector('b').textContent === 'Order'; }).click()`);
    t.ok(await ex.waitFor(`!!document.querySelector('.dm-map .dm-c') && document.querySelectorAll('.dm-map .dm-col').length === 2`, 5000, 'map'),
      'the domain model is a map: the entity in the middle, a column on each side');
    const around = await ex.evaluate(`document.querySelectorAll('.dm-map .dm-n').length`);
    t.ok(around >= 1, 'with the entities it is associated with around it: ' + around);
    await ex.evaluate(`Array.from(document.querySelectorAll('.dx-nav-item')).find(function (b) { return /quality/i.test(b.textContent); }).click()`);
    t.ok(await ex.waitFor(`/without access rules/.test(document.querySelector('.dx-main').textContent)`, 5000, 'quality'),
      'and Model quality reports where the model looks unfinished');
    await ex.close();
  } finally {
    exportServer.close();
  }

  await mx.close();
};
