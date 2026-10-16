/* A flow's window — the one Run… opens on the Microflows screen, and the aside a flow opens in from a
 * recording, the log, Security or the search (public/objects.js).
 *
 * It used to carry a Diagram tab with two more drawings of the flow: the documentation's old workflow
 * and Studio Pro's own layout, drawn from the positions stored in the model (public/flowdraw.js). Karol,
 * 2026-10-13: one Studio Pro view, not two — and the flow must still be visible in the window. What has
 * to hold:
 *  - the window has Flow, Run and Comments; Run… opens it on Run;
 *  - Flow is the same graph the Microflows screen draws; a click on a step says what it does, and a
 *    button takes it to the Microflows screen, on that step;
 *  - the old drawings are gone from the app, not just hidden: no MxFlowDraw, no MxDocsView.flow. */
'use strict';
const { goToSection } = require('./helpers');
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxDocsView', 15000, 'MxScout loaded');
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    await MxStore.saveProjectWithModel({ id: 'pwin', name: 'WindowDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null, devTools: true }, model);
    return true;
  })()`);
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button')).find(n => n.textContent.trim() === 'WindowDemo')`, 10000, 'project');
  await mx.evaluate(`Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button')).find(n => n.textContent.trim() === 'WindowDemo').click()`);
  await goToSection(mx, 'Microflows', '.mf-mods, .mf-grid');
  await mx.evaluate(`(function(){ var sel = Array.from(document.querySelectorAll('select')).find(x => Array.from(x.options).some(o => o.value === 'all')); if (sel) { sel.value = 'all'; sel.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
  await mx.waitFor(`(function(){ var c = document.querySelector('.mf-mod-card'); if (c) c.click(); return !!document.querySelector('.mf-row'); })()`, 5000, 'list');
  await mx.evaluate(`(function(){ var r = Array.from(document.querySelectorAll('.mf-row')).find(function (n) { return n.querySelector('.mf-row-name').textContent === 'SweepOrders'; }); if (!r) { var s = document.querySelector('.mf-module-select'); for (var i = 0; s && i < s.options.length && !r; i++) { if (!s.options[i].value) continue; s.value = s.options[i].value; s.dispatchEvent(new Event('change')); s = document.querySelector('.mf-module-select'); r = Array.from(document.querySelectorAll('.mf-row')).find(function (n) { return n.querySelector('.mf-row-name').textContent === 'SweepOrders'; }); } } r.click(); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.fg-card')`, 5000, 'the graph');
  t.ok(await mx.evaluate(`document.querySelectorAll('.fg-card').length > 3 && !!document.querySelector('.fg-loop')`), 'the Microflows screen draws the flow, loop and all');
  await mx.evaluate(`Array.from(document.querySelectorAll('.mf-btn')).find(function (b) { return b.textContent === 'Run…'; }).click()`);
  await mx.waitFor(`!!document.querySelector('.popup-tab')`, 5000, 'the flow window');
  const tabs = await mx.evaluate(`Array.from(document.querySelectorAll('.popup-tab')).map(b => b.textContent + (b.classList.contains('is-active') ? '*' : '')).join()`);
  t.ok(tabs === 'Flow,Run*,Comments', 'the window has Flow, Run and Comments, and Run… opens it on Run: ' + tabs);
  await mx.evaluate(`Array.from(document.querySelectorAll('.popup-tab')).find(b => b.textContent === 'Flow').click()`);
  await mx.waitFor(`!!document.querySelector('.modal .flow-pane .sv-act')`, 3000, 'the flow tab');
  t.ok(await mx.evaluate(`!!document.querySelector('.modal .flow-pane .sv-frame') && /Click a step/.test(document.querySelector('.modal .flow-pane-bar').textContent)`), 'Flow is the same graph the screen draws');
  await mx.evaluate(`document.querySelector('.modal .flow-pane .sv-act').click()`);
  const said = await mx.waitFor(`(function(){ var p = document.querySelector('.modal .flow-pane-bar p'); return p && /^Step \\d+: /.test(p.textContent) && p.textContent; })()`, 3000, 'a step');
  t.ok(!!said, 'a click on a step says what it does: ' + said);
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal .flow-pane-bar button')).find(b => /Microflows screen/.test(b.textContent)).click()`);
  t.ok(await mx.waitFor(`!document.querySelector('.modal') && !!document.querySelector('.mf-detail .fg-card.on')`, 3000, 'the screen'), 'and the button opens it on the Microflows screen, on that step');
  t.ok(await mx.evaluate(`!window.MxFlowDraw && !MxDocsView.flow && !document.querySelector('script[src="/flowdraw.js"]')`), 'the old drawings are gone from the app, not hidden');
  t.ok((await mx.evaluate(`fetch('/flowdraw.js').then(r => r.status)`)) === 404, 'and the file is gone from the server');
};
