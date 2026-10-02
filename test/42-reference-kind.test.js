/* "What reaches this flow" — resolved to the right document.
 *
 * A reference in a .mpr is a plain qualified-name STRING, and MxScout collects
 * every one of them and matches it against the finished model. That works
 * because of one thing it used to ignore: the PROPERTY the string sits under
 * says what kind of thing is meant. `Microflow`, `Nanoflow` and
 * `AuthenticationMicroflow` name a flow; `Form` and `Page` name a page.
 *
 * It mattered because a qualified name does not identify a document. Measured
 * across four real projects: 10 names in Helpdesk, 39 in Avalon, 2 in
 * HeadQuarters and 1 in Bridge belong to BOTH a microflow and a page, and 45
 * names in Helpdesk belong to two documents of some pair of kinds — most often
 * a scheduled event named after the microflow it runs. Two separate things
 * went wrong:
 *
 *   1. one lookup keyed by name held microflows, nanoflows and pages together,
 *      so for a shared name whichever went in last took every reference. In
 *      Helpdesk the microflow SpecialForms.EditForm therefore said nothing
 *      reached it while the page of that name was credited with the call;
 *   2. "is this the document naming itself?" was answered by name alone, so a
 *      scheduled event named after its own microflow looked like that
 *      microflow talking about itself, and the reference was dropped. Every
 *      one of Queues.QueuesStats, Queues.ScheduledQueuesRun and
 *      Queues.DeleteOldQueues lost its only caller that way.
 *
 * Fixing both moved real numbers on real projects: microflows, nanoflows and
 * pages saying "nothing reaches this" fell from 234 to 206 in Helpdesk, 337 to
 * 280 in Avalon, 155 to 148 in HeadQuarters and 107 to 98 in Bridge — and six
 * references in Helpdesk moved off a page that never had them.
 *
 * The fixture carries the same two shapes: a page and a microflow both called
 * Sales.CreateOrder, and a scheduled event called Sales.SweepOrders running
 * the microflow of that name. */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');

  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'app loaded');
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '${src}';
      s.onload = function () { resolve(true); };
      s.onerror = function () { reject(new Error('failed to load ${src}')); };
      document.head.appendChild(s);
    })`);
  }

  const model = await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales',
      readContentsFile: function () { throw new Error('v1 must not read content files'); } });
    delete model.meta.generatedAt;
    return model;
  })()`);

  function calledBy(list, qn) {
    const item = model[list].filter(function (i) { return i.qualifiedName === qn; })[0];
    return item ? item.calledBy.map(function (c) { return c.kind + ' ' + c.name; }) : null;
  }

  const flow = calledBy('microflows', 'Sales.CreateOrder');
  const page = calledBy('pages', 'Sales.CreateOrder');
  t.ok(flow !== null && page !== null,
    'the fixture really does hold a microflow and a page of the same qualified name');

  // The navigation document names it under `Microflow` (a role's home page
  // that runs a flow); the REST operation names it under `Microflow` too.
  // The navigation document has no name of its own, which is why a calledBy
  // row carries the kind as well as the name and the UI falls back to it.
  t.ok(flow.indexOf('navigation null') !== -1 && flow.indexOf('published REST service Sales.orders') !== -1,
    'a reference under a `Microflow` property reaches the MICROFLOW: ' + JSON.stringify(flow));
  t.ok(page.indexOf('navigation null') === -1 && page.indexOf('published REST service Sales.orders') === -1,
    'and does not reach the page that happens to share its name: ' + JSON.stringify(page));

  // The other page names it under `Form`, through the measured
  // ActionButton > FormAction > FormSettings chain.
  t.ok(page.indexOf('page Sales.Order_Overview') !== -1,
    'a reference under a `Form` property reaches the PAGE: ' + JSON.stringify(page));
  t.ok(flow.indexOf('page Sales.Order_Overview') === -1,
    'and not the microflow of the same name: ' + JSON.stringify(flow));

  // Named after what it runs — the case a name-only self-check threw away.
  const sweep = calledBy('microflows', 'Sales.SweepOrders');
  t.ok(sweep.indexOf('scheduled event Sales.SweepOrders') !== -1,
    'a scheduled event named after its own microflow still counts as reaching it: ' + JSON.stringify(sweep));

  // ...without that becoming a licence for a document to credit itself. The
  // microflow CreateOrder opens Sales.Order_Overview and calls SweepOrders; it
  // names neither itself nor anything of its own kind and name.
  t.ok(flow.indexOf('microflow Sales.CreateOrder') === -1 && page.indexOf('page Sales.CreateOrder') === -1,
    'while a document of the same name AND kind is still itself, not a caller: ' +
    JSON.stringify({ flow: flow, page: page }));

  t.ok(calledBy('pages', 'Sales.Order_Overview').indexOf('microflow Sales.CreateOrder') !== -1,
    'and an ordinary reference to a name nothing else shares is unchanged: ' +
    JSON.stringify(calledBy('pages', 'Sales.Order_Overview')));

  // ---- the same mistake was in the window that shows it ----
  // "Reached from" turns each row into a link by looking the name up as a
  // microflow, then a nanoflow, then a page — first match wins. For a name two
  // documents share, that opened the microflow however the row was labelled.
  // The row carries its kind, so the kind decides.
  const UI_MODEL = Object.assign({}, require('./model'), {
    microflows: [
      { qualifiedName: 'Sales.Entry', name: 'Entry', module: 'Sales', allowedModuleRoles: ['Sales.Agent'], parameters: [],
        calledBy: [{ kind: 'page', name: 'Sales.Dup' }] },
      { qualifiedName: 'Sales.Dup', name: 'Dup', module: 'Sales', allowedModuleRoles: ['Sales.Agent'], parameters: [], calledBy: [] }
    ],
    pages: [{ qualifiedName: 'Sales.Dup', name: 'Dup', module: 'Sales', allowedModuleRoles: ['Sales.Agent'], parameters: [], calledBy: [] }]
  });
  await mx.evaluate(`(async () => {
    await MxStore.saveProjectWithModel(
      { id: 'dup-p', name: 'DupProj', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        source: { kind: 'test' }, bytes: 100, summary: null, appUrl: null },
      ${JSON.stringify(UI_MODEL)});
    return true;
  })()`);
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.tree-project')).find(b => b.textContent.trim() === 'DupProj')`, 10000, 'project');
  await mx.evaluate(`Array.from(document.querySelectorAll('.tree-project')).find(b => b.textContent.trim() === 'DupProj').click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.tree-section')).find(b => /^Microflows/.test(b.textContent))`, 8000, 'sections');
  await mx.evaluate(`Array.from(document.querySelectorAll('.tree-section')).find(b => /^Microflows/.test(b.textContent)).click()`);
  await mx.waitFor(`!!document.querySelector('.flow-card')`, 8000, 'list');
  await mx.evaluate(`Array.from(document.querySelectorAll('.flow-card')).find(function (c) { return /Entry/.test(c.textContent); }).click()`);
  await mx.waitFor(`!!document.querySelector('.trig-row')`, 8000, 'reached-from');
  // That link had never worked: objects.js was written to call peekObject and
  // app.js never handed it one, so every click threw. Nothing clicked it until
  // this test did, which is the argument for asserting through the click
  // rather than stopping at "the row is there".
  t.ok(await mx.evaluate(`document.querySelector('.trig-row .trig-name').tagName`) === 'BUTTON',
    'the row offers a real button, not a label dressed as one');
  t.ok(await mx.evaluate(`document.querySelector('.trig-row').textContent`) === 'pageSales.Dup',
    'the row says a page reaches this flow: ' + await mx.evaluate(`document.querySelector('.trig-row').textContent`));
  await mx.evaluate(`document.querySelector('.trig-row .trig-name').click()`);
  const dupTabs = await mx.waitFor(`document.querySelectorAll('.popup-tab').length === 2 &&
    Array.from(document.querySelectorAll('.popup-tab')).map(function (t) { return t.textContent; }).join(',')`, 8000, 'popup');
  t.ok(dupTabs === 'Inputs,Comments',
    'and clicking it opens the PAGE of that name, not the microflow that shares it — a page has no Run tab: ' + dupTabs);

  await mx.close();
};
