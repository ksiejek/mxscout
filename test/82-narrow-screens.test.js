/* Narrower screens: a column goes under its neighbour, it does not vanish (Karol, 2026-10-14: "on smaller
 * screens a column — for example risks, or information in general — disappears; it could go under the
 * column right next to it instead").
 *
 * At 1024 and 768 px wide, on the screens where it used to happen:
 *  - Risks: the filters (where they gather, severity, patterns) and the column beside a finding (the same
 *    pattern elsewhere, the rest of its module) — that column was shown only at 2000 px and wider;
 *  - Microflows: the drawing keeps a readable width, the step and the flow as a whole are under it, both;
 *  - Entities: the drawing keeps a readable width, the entity's panel is under it;
 *  - Overview: the card at a glance, and the contents that stood beside the document only when wide.
 * Each one present, drawn, of a readable width, and inside the window — not cut by a box that hides what
 * overflows it. At 2400 px the column beside a finding is still beside it: the wide layout is unchanged. */
'use strict';
const fs = require('fs');
const path = require('path');
const { goToSection } = require('./helpers');

// Where a node is, and whether anything hides it: display, a zero size, the window's edges, or an
// ancestor that hides what overflows it and has it outside its box.
const SEEN = `function seen(sel, minWidth) {
  var n = document.querySelector(sel);
  if (!n) return sel + ': missing';
  if (n.checkVisibility && !n.checkVisibility({ checkVisibilityCSS: true })) return sel + ': not drawn';
  var r = n.getBoundingClientRect();
  if (r.width < (minWidth || 1) || r.height < 1) return sel + ': ' + Math.round(r.width) + '×' + Math.round(r.height) + 'px';
  if (r.left < -1 || r.left > window.innerWidth - 20) return sel + ': outside the window (left ' + Math.round(r.left) + ')';
  for (var a = n.parentElement; a; a = a.parentElement) {
    var cs = getComputedStyle(a), ar = a.getBoundingClientRect();
    if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && (r.right <= ar.left + 1 || r.left >= ar.right - 1)) return sel + ': cut by ' + a.className;
    if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') break;
  }
  return null;
}`;

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxDescribe', 15000, 'MxScout loaded');
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const R = (level, theme, title, where) => ({ level: level, theme: theme, title: title, detail: 'What happens with ' + title + '.', fix: 'Fix ' + title + '.', where: where });
  const desc = { format: 'mxscout-descriptions', version: 1,
    app: { summary: 'Sales takes orders from customers and hands them to clerks.' },
    risks: [R('P1', 'access', 'Anyone can sweep', ['Sales.SweepOrders']), R('P1', 'access', 'Anyone can create', ['Sales.CreateOrder']),
      R('P2', 'logic', 'Saved twice', ['Sales.CreateOrder']), R('P3', 'naming', 'Odd name', ['Sales.Customer'])] };
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    await MxStore.saveProjectWithModel({ id: 'pnarrow', name: 'NarrowDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, model);
    await MxStore.put('descriptions', { projectId: 'pnarrow', importedAt: new Date().toISOString(), fileName: 'd.json', value: MxDescribe.parse(${JSON.stringify(JSON.stringify(desc))}).value });
    return true;
  })()`);
  await mx.viewport(1440, 900);
  await mx.navigate(t.MX);
  const SW = "(function(q){var s=document.querySelector('.switcher[aria-expanded=\"false\"]'); if (s) s.click(); return document.querySelectorAll(q);})";
  await mx.waitFor(`!!Array.from(${SW}('button')).find(n => n.textContent.trim() === 'NarrowDemo')`, 10000, 'project');
  await mx.evaluate(`Array.from(${SW}('button')).find(n => n.textContent.trim() === 'NarrowDemo').click()`);
  const everything = () => mx.evaluate(`(function(){ var s = document.querySelector('.role-select'); if (s && s.value !== 'all') { s.value = 'all'; s.dispatchEvent(new Event('change')); } return true; })()`);
  const check = (sels) => mx.evaluate(`(function(){ ${SEEN} return JSON.stringify(${JSON.stringify(sels)}.map(function (s) { return seen(s[0], s[1]); }).filter(Boolean)); })()`).then(JSON.parse);
  const settle = () => new Promise((r) => setTimeout(r, 400));

  for (const w of [1024, 768]) {
    await mx.viewport(w, 900);
    await settle();

    await goToSection(mx, 'Risks', '.doc-screen .dx-rk-detail .dx-rk-main');
    await settle();
    const rk = await check([['.dx-rk-strip [aria-label="Modules"]', 150], ['.dx-rk-strip [aria-label="Severity"]', 150], ['.dx-rk-strip [aria-label="Patterns"]', 150],
      ['.dx-rk-list', 250], ['.dx-rk-main', 250], ['.dx-rk-rail', 250]]);
    const railUnder = await mx.evaluate(`(function(){ var m = document.querySelector('.dx-rk-main').getBoundingClientRect(), r = document.querySelector('.dx-rk-rail').getBoundingClientRect();
      return r.top >= m.bottom - 1 && /Also in Sales/.test(document.querySelector('.dx-rk-rail').textContent) && /Same pattern elsewhere/.test(document.querySelector('.dx-rk-rail').textContent); })()`);
    t.ok(rk.length === 0 && railUnder, w + 'px: Risks keeps its filters, the list, the finding, and under the finding the same pattern elsewhere and the rest of its module: ' + JSON.stringify(rk));

    await goToSection(mx, 'Microflows', '.mf .role-select');
    await everything();
    await mx.waitFor(`(function(){ var c = document.querySelector('.mf-mod-card'); if (c) c.click(); var r = document.querySelector('.mf-row'); if (r && !document.querySelector('.mf-row.on')) r.click(); return !!document.querySelector('.mf-side'); })()`, 8000, 'a flow');
    await settle();
    const mf = await check([['.mf-flow', 300], ['.mf-canvas .fg-card', 200], ['.mf-side', 300], ['.mf-side .mf-step', 250], ['.mf-side .mf-rail', 250]]);
    t.ok(mf.length === 0, w + 'px: a flow is drawn at a readable width, its step and the flow as a whole under it: ' + JSON.stringify(mf));

    await goToSection(mx, 'Entities', '.dm-screen .role-select');
    await everything();
    await mx.waitFor(`(function(){ var b = document.querySelector('.dm-screen .dx-dm-box'); if (b && !document.querySelector('.dx-dm-box.on')) b.click(); return !!document.querySelector('.dx-dm-box.on'); })()`, 8000, 'an entity');
    await settle();
    const dm = await check([['.dm-screen .dx-dm-canvas', 300], ['.dm-screen .dx-dm-insp', 300], ['.dm-screen .dx-dm-insp h2', 50]]);
    t.ok(dm.length === 0, w + 'px: Entities draws the module at a readable width and the entity’s panel under it: ' + JSON.stringify(dm));

    await goToSection(mx, 'Overview', '.doc-screen .dx-ov');
    await settle();
    const ov = await check([['.dx-glance', 250], ['.dx-toc', 250], ['.dx-toc-a', 20]]);
    t.ok(ov.length === 0, w + 'px: the Overview keeps its card at a glance and, under the document, its contents: ' + JSON.stringify(ov));
  }

  // The wide layout: the column beside a finding stands beside it.
  await mx.viewport(2400, 1200);
  await goToSection(mx, 'Risks', '.doc-screen .dx-rk-detail .dx-rk-main');
  await settle();
  const wide = await mx.evaluate(`(function(){ var m = document.querySelector('.dx-rk-main').getBoundingClientRect(), r = document.querySelector('.dx-rk-rail').getBoundingClientRect(),
    f = document.querySelector('.dx-rk-facets'); return r.left >= m.right && Math.abs(r.top - m.top) < 80 && !!f && f.getBoundingClientRect().width > 200; })()`);
  t.ok(wide, 'at 2400px the facets stand on the left and the column beside a finding beside it, as before');
  await mx.viewport(1440, 900);
  await mx.close();
};
