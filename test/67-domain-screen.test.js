/* The Entities screen is the Domain model (public/domain.js; docs-view.js mounted with only: 'domain').
 * Karol, 2026-10-13: the documentation's Domain model reads much better than the old list and map, so
 * the screen is that page, with the app's differences:
 *  - nothing is picked on arrival: every entity drawn in full, none greyed;
 *  - a click picks one and greys the ones not linked to it; a click beside the boxes lets go;
 *  - only the diagram — no List view — and no search of the reader's own (Ctrl K is the app's);
 *  - the picked entity's inspector has Browse data (its window, whose Data tab searches the connected
 *    app's rows) and Add comment. */
'use strict';
const { goToSection } = require('./helpers');
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxDomain', 15000, 'MxScout loaded');
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    await MxStore.saveProjectWithModel({ id: 'pdom', name: 'DomainDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null, devTools: true }, model);
    return true;
  })()`);
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button')).find(n => n.textContent.trim() === 'DomainDemo')`, 10000, 'project');
  await mx.evaluate(`Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button')).find(n => n.textContent.trim() === 'DomainDemo').click()`);
  await goToSection(mx, 'Entities', '.dm-screen .role-select');
  // View as starts on the app's first role; the arrival checks below are about the whole model.
  await mx.evaluate(`(function(){ var s = document.querySelector('.dm-screen .role-select'); if (s && s.value !== 'all') { s.value = 'all'; s.dispatchEvent(new Event('change')); } return true; })()`);
  await mx.waitFor(`!!document.querySelector('.dm-screen .dx-dm-box') && document.querySelector('.dm-screen .role-select').value === 'all'`, 8000, 'everything');
  await mx.evaluate(`(function(){ var r = Array.from(document.querySelectorAll('.dx-dm-mrow')).find(function (x) { return x.firstChild.textContent === 'Sales'; }); if (r && !r.classList.contains('on')) r.click(); return true; })()`);
  await mx.waitFor(`document.querySelectorAll('.dm-screen .dx-dm-box').length > 2`, 5000, 'Sales');

  const first = JSON.parse(await mx.evaluate(`JSON.stringify({
    boxes: document.querySelectorAll('.dx-dm-box').length, dim: document.querySelectorAll('.dx-dm-box.dim').length, on: document.querySelectorAll('.dx-dm-box.on').length,
    insp: document.querySelector('.dx-dm-insp').textContent, list: !!Array.from(document.querySelectorAll('.dx-seg2 button')).find(function (b) { return b.textContent === 'List'; }),
    side: getComputedStyle(document.querySelector('.dx-only .dx-side')).display, search: !!document.querySelector('.dx-only .dx-searchbox:not([hidden])') && getComputedStyle(document.querySelector('.dx-only .dx-side')).display !== 'none'
  })`));
  t.ok(first.boxes > 2 && first.dim === 0 && first.on === 0, 'nothing is picked on arrival: every entity drawn in full: ' + JSON.stringify(first));
  t.ok(/Click an entity/.test(first.insp), 'and the panel says what a click shows');
  t.ok(!first.list && first.side === 'none' && !first.search, 'only the diagram, without the reader’s sidebar and search');

  // a click picks one and greys the rest that are not linked to it
  const where = `JSON.stringify(Array.from(document.querySelectorAll('.dx-dm-box')).map(function (b) { return b.title + '@' + b.style.left + ',' + b.style.top; }))`;
  const before = await mx.evaluate(where);
  // Where the boxes sit is worked out once per module, not on every pick: a large module's layout is
  // a search that took a second, cut off by the clock. With a clock that says the time is up at once,
  // a search run again would leave the boxes where it started; a kept layout leaves them where they were.
  const lone = await mx.evaluate(`(function(){
    var real = Date.now, at = real.call(Date); Date.now = function () { at += 10000; return at; };
    try { Array.from(document.querySelectorAll('.dx-dm-box'))[0].click(); } finally { Date.now = real; }
    return true; })()`);
  await mx.waitFor(`!!document.querySelector('.dx-dm-box.on')`, 3000, 'picked');
  t.ok(await mx.evaluate(where) === before, 'a pick leaves every box where it was: the module is not laid out again');
  const picked = JSON.parse(await mx.evaluate(`JSON.stringify({ on: document.querySelector('.dx-dm-box.on b').textContent, dim: document.querySelectorAll('.dx-dm-box.dim').length,
    total: document.querySelectorAll('.dx-dm-box').length, acts: Array.from(document.querySelectorAll('.dx-dm-acts button')).map(function (b) { return b.textContent; }).join('|') })`));
  t.ok(picked.dim > 0 && picked.dim < picked.total, 'a click picks one and greys the ones not linked to it: ' + JSON.stringify(picked));
  t.ok(/Browse data/.test(picked.acts) && /Add comment/.test(picked.acts), 'its panel has Browse data and Add comment: ' + picked.acts);

  // a click beside the boxes lets go
  await mx.evaluate(`(function(){ var w = document.querySelector('.dx-dm-wrap'); w.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  t.ok(await mx.waitFor(`!document.querySelector('.dx-dm-box.on') && !document.querySelector('.dx-dm-box.dim')`, 3000, 'let go'), 'a click beside the boxes lets go: every entity in full again');

  // Browse data opens the rows alone, in the screen's style: no tabs, no role picker, no comment button
  await mx.evaluate(`Array.from(document.querySelectorAll('.dx-dm-box')).find(function (b) { return b.querySelector('b').textContent === 'Order'; }).click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.dx-dm-acts button')).find(b => b.textContent === 'Browse data')`, 3000, 'Order picked');
  await mx.evaluate(`Array.from(document.querySelectorAll('.dx-dm-acts button')).find(b => b.textContent === 'Browse data').click()`);
  await mx.waitFor(`!!document.querySelector('.dm-data')`, 5000, 'the data dialog');
  const data = JSON.parse(await mx.evaluate(`JSON.stringify({ title: document.querySelector('.dm-data h2').textContent, eyebrow: document.querySelector('.dm-data .xe-caps').textContent,
    tabs: document.querySelectorAll('.dm-data .popup-tab').length, roles: !!document.querySelector('.dm-data select'), comment: /Comment/.test(document.querySelector('.dm-data-head').textContent),
    body: document.querySelector('.dm-data-body').textContent.slice(0, 120) })`));
  t.ok(data.title === 'Order' && data.eyebrow === 'Data · Sales' && data.tabs === 0 && !data.comment,
    'Browse data opens only the rows, in a dialog of the screen’s own style — no tabs, no comment button: ' + JSON.stringify(data));
  t.ok(/address of the running app|Connect/.test(data.body), 'and with no app connected it says how to reach one: ' + data.body);
  await mx.evaluate(`document.querySelector('.dm-data-close').click()`);
  await mx.waitFor(`!document.querySelector('.dm-data')`, 3000, 'closed');
  t.ok(await mx.evaluate(`!!document.querySelector('.dx-dm-box.on') && document.querySelector('.dx-dm-box.on b').textContent === 'Order'`), 'and closing it leaves the screen as it was, Order still picked');
  t.ok(await mx.evaluate(`!document.querySelector('.dm-screen .dx-title') || getComputedStyle(document.querySelector('.dm-screen .dx-title')).display === 'none'`), 'the screen says “Domain model” once, in its own header');

  // Add comment starts a comment on that entity
  await mx.evaluate(`Array.from(document.querySelectorAll('.dx-dm-acts button')).find(b => /Add comment/.test(b.textContent)).click()`);
  t.ok(await mx.waitFor(`!!window.MxComments.editorOpen()`, 3000, 'editor'), 'Add comment starts a comment on it');
  // in a dialog in the middle, like Browse data — not a drawer at the side
  const box = JSON.parse(await mx.evaluate(`(function(){ var r = document.querySelector('.editor').getBoundingClientRect(); return JSON.stringify({ left: r.left, right: window.innerWidth - r.right, top: r.top }); })()`));
  t.ok(Math.abs(box.left - box.right) < 4 && box.top > 20, 'the comment opens as a dialog in the middle of the screen, not a drawer: ' + JSON.stringify(box));
  t.ok(await mx.evaluate(`!document.querySelector('.dx-dm-acts .comments-link')`), 'with no comment yet, there is no link to comments');
  await mx.evaluate(`(function(){ var a = document.querySelectorAll('.editor-area'); a[0].value = 'Orders are readable by anyone'; a[0].dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.editor-foot button')).find(b => /Save comment/.test(b.textContent)).click()`);
  await mx.waitFor(`!document.querySelector('.editor-backdrop')`, 5000, 'saved');
  const link = await mx.waitFor(`(function(){ var b = document.querySelector('.dx-dm-acts .comments-link'); return b && b.textContent; })()`, 5000, 'comments link');
  t.ok(link === 'Comments · 1', 'once it has one, the panel links to its comments: ' + link);
  t.ok(await mx.evaluate(`!document.querySelector('.dm-comments, .obj-comments')`), 'and the comments are not listed a second time beside the entity');
  await mx.evaluate(`document.querySelector('.dx-dm-acts .comments-link').click()`);
  const dlg = await mx.waitFor(`(function(){ var d = document.querySelector('.obj-comments-dialog'); return d && d.textContent; })()`, 5000, 'comments dialog');
  t.ok(/Comments · 1/.test(dlg) && /Order/.test(dlg) && /Orders are readable by anyone/.test(dlg), 'the link opens that entity’s comments in a window over the screen: ' + dlg.slice(0, 120));
  await mx.evaluate(`Array.from(document.querySelectorAll('.obj-comments-dialog button')).find(b => /Comments section/.test(b.textContent)).click()`);
  t.ok(await mx.waitFor(`!document.querySelector('.obj-comments-dialog') && !!document.querySelector('.filter-input') && document.querySelector('.filter-input').value === 'Sales.Order'`, 5000, 'comments section'),
    'and from there the Comments section, narrowed to it');
  // Back on the Entities screen for View as.
  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).find(n => /^Entities/.test(n.textContent.trim())).click()`);
  await mx.waitFor(`!!document.querySelector('.dm-screen .role-select')`, 8000, 'entities again');
  // ---- View as: the entities the chosen role reaches, the others gone (Karol, 2026-10-14) ----
  const plan = JSON.parse(await mx.evaluate(`MxStore.getModel('pdom').then(function (m) {
    var sel = document.querySelector('.dm-screen .role-select');
    var roles = (m.userRoles || []).map(function (r) {
      var set = {}; (r.moduleRoles || []).forEach(function (x) { set[x] = true; });
      var reach = (m.entities || []).filter(function (e) { return e.module === 'Sales' && (e.accessRules || []).some(function (a) { return set[a.moduleRole]; }); }).map(function (e) { return e.name; });
      return { name: r.name, reach: reach };
    });
    return JSON.stringify({ all: (m.entities || []).filter(function (e) { return e.module === 'Sales'; }).length, roles: roles, options: sel ? Array.from(sel.options).map(function (o) { return o.value; }) : [] });
  })`));
  const narrow = plan.roles.filter((r) => r.reach.length && r.reach.length < plan.all).sort((a, b) => a.reach.length - b.reach.length)[0];
  t.ok(!!narrow && plan.options.indexOf(narrow.name) !== -1, 'the fixture has a role that reaches only part of Sales, offered in View as: ' + JSON.stringify(plan));
  if (narrow) {
    await mx.evaluate(`(function(){ var s = document.querySelector('.dm-screen .role-select'); s.value = ${JSON.stringify(narrow.name)}; s.dispatchEvent(new Event('change')); return true; })()`);
    await mx.waitFor(`(function(){ var s = document.querySelector('.dm-screen .xe-sub'); return s && / of /.test(s.textContent); })()`, 5000, 'narrowed');
    await mx.evaluate(`(function(){ var r = Array.from(document.querySelectorAll('.dx-dm-mrow')).find(function (x) { return x.firstChild.textContent === 'Sales'; }); if (r && !r.classList.contains('on')) r.click(); return true; })()`);
    const shown = JSON.parse(await mx.evaluate(`JSON.stringify({ names: Array.from(document.querySelectorAll('.dm-screen .dx-dm-box')).map(function (b) { return (b.querySelector('.dx-dm-name') || b).textContent; }), sub: document.querySelector('.dm-screen .xe-sub').textContent })`));
    t.ok(shown.names.length === narrow.reach.length && narrow.reach.every((n) => shown.names.some((x) => x.indexOf(n) !== -1)) && new RegExp('that ' + narrow.name + ' reaches').test(shown.sub),
      'View as ' + narrow.name + ' leaves only the entities it reaches, and the header says so: ' + JSON.stringify(shown) + ' expected ' + JSON.stringify(narrow.reach));
    await mx.evaluate(`(function(){ var s = document.querySelector('.dm-screen .role-select'); s.value = 'all'; s.dispatchEvent(new Event('change')); return true; })()`);
    t.ok(await mx.waitFor(`document.querySelectorAll('.dm-screen .dx-dm-box').length === ${plan.all}`, 5000, 'everything'), 'and Everything brings every entity back');
    const empty = plan.roles.filter((r) => !r.reach.length && plan.options.indexOf(r.name) !== -1)[0];
    if (empty) {
      await mx.evaluate(`(function(){ var s = document.querySelector('.dm-screen .role-select'); s.value = ${JSON.stringify(empty.name)}; s.dispatchEvent(new Event('change')); return true; })()`);
      t.ok(await mx.waitFor(`/reaches no entity/.test((document.querySelector('.dm-screen .doc-empty') || {}).textContent || '')`, 5000, 'none'), 'a role that reaches no entity is told so, not shown an empty canvas');
      await mx.evaluate(`(function(){ var s = document.querySelector('.dm-screen .role-select'); s.value = 'all'; s.dispatchEvent(new Event('change')); return true; })()`);
    }
  }

};
