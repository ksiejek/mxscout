/* A click in a list leaves the list where it was.
 *
 * Karol, 2026-10-14: in every menu a click near the bottom moved the list on
 * its own, further down, and cut the link he had clicked. Every click draws
 * the screen again, so each scrolling box has to come back exactly where the
 * reader left it — the list of flows, entities and pages, and the app's own
 * sidebar. */
'use strict';
const { goToSection } = require('./helpers');
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxMicroflows', 15000, 'MxScout loaded');
  await mx.viewport(1440, 640);
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  // Sixty copies of each flow and entity, so every list scrolls.
  await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    function many(list, qnKey) {
      var base = list.slice();
      for (var i = 0; i < 60; i++) base.forEach(function (x) {
        var c = JSON.parse(JSON.stringify(x)), n = 'Z' + (i < 10 ? '0' : '') + i + '_' + c.name;
        c.name = n; c[qnKey] = c.module + '.' + n; list.push(c);
      });
    }
    many(model.microflows, 'qualifiedName');
    await MxStore.saveProjectWithModel({ id: 'pscroll', name: 'ScrollDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, model);
  })()`);
  const SW = "(function(q){var s=document.querySelector('.switcher[aria-expanded=\"false\"]'); if (s) s.click(); return document.querySelectorAll(q);})";
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(${SW}('.tree-project')).find(b => b.textContent.indexOf('ScrollDemo') !== -1)`, 10000, 'project');
  await mx.evaluate(`Array.from(${SW}('.tree-project')).find(b => b.textContent.indexOf('ScrollDemo') !== -1).click()`);
  await goToSection(mx, 'Microflows', '.mf-mods, .mf-grid', 20000);
  await mx.evaluate(`(function(){ var s = document.querySelector('.xe-head .role-select'); s.value = 'all'; s.dispatchEvent(new Event('change')); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.mf-mods')`, 8000, 'the modules');
  await mx.evaluate(`Array.from(document.querySelectorAll('.mf-mod-card')).find(function (c) { return /^Sales/.test(c.textContent); }).click()`);
  await mx.waitFor(`document.querySelectorAll('.mf-rows .mf-row').length > 50`, 8000, 'the list');

  // Scroll the list and the sidebar, click the last row that is fully in view, and look again two frames later.
  const r = JSON.parse(await mx.evaluate(`(async function () {
    function frames() { return new Promise(function (res) { requestAnimationFrame(function () { requestAnimationFrame(function () { setTimeout(res, 50); }); }); }); }
    var out = { clicks: [] };
    var side = document.querySelector('.sidebar-scroll');
    if (side) { side.scrollTop = 40; out.sideBefore = side.scrollTop; }
    var list = document.querySelector('.mf-rows');
    list.scrollTop = 300; await frames();
    for (var k = 0; k < 3; k++) {
      list = document.querySelector('.mf-rows');
      var before = list.scrollTop, box = list.getBoundingClientRect();
      var rows = Array.from(list.children).filter(function (x) { var b = x.getBoundingClientRect(); return b.top >= box.top && b.bottom <= box.bottom; });
      var row = rows[rows.length - 1], label = row.textContent, top = row.getBoundingClientRect().top;
      row.click(); await frames();
      list = document.querySelector('.mf-rows');
      var again = Array.from(list.children).find(function (x) { return x.textContent === label; });
      out.clicks.push({ before: before, after: list.scrollTop, moved: again ? Math.round(again.getBoundingClientRect().top - top) : null });
    }
    side = document.querySelector('.sidebar-scroll');
    out.sideAfter = side ? side.scrollTop : null;
    return JSON.stringify(out);
  })()`));
  t.ok(r.clicks.length === 3 && r.clicks.every(function (c) { return c.moved === 0; }),
    'a row clicked at the bottom of the flows list stays where it was clicked, the list unmoved: ' + JSON.stringify(r));
  t.ok(r.sideAfter === r.sideBefore, 'and the sidebar keeps its own place: ' + JSON.stringify([r.sideBefore, r.sideAfter]));
};
