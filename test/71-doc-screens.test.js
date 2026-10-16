/* The documentation's pages as MxScout's own screens (public/docs.js pageScreen, app.js renderDocPage).
 *
 * Karol, 2026-10-13: the report's Overview "is a fairy tale — MxScout should have it too", and so
 * Processes, the modules' descriptions, Architecture, Risks, Model quality and For developers. What
 * has to hold:
 *  - each is a screen in the sidebar, in the frame every other screen has: its title and what it is
 *    for in the header, the search, the project's menu — not the documentation's own sidebar;
 *  - a link on one of them opens MxScout's screen for what it names: a page of the documentation
 *    its screen, a flow the Microflows screen with that flow picked;
 *  - a page only an agent writes says how to get it while there is none. */
'use strict';
const { goToSection } = require('./helpers');
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxDocs && !!window.MxDescribe', 15000, 'MxScout loaded');
  await mx.viewport(1440, 900);
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const desc = {
    format: 'mxscout-descriptions', version: 1,
    microflows: { 'Sales.CreateOrder': { text: 'Opens a fresh order for a customer.' } },
    risks: [{ level: 'P2', theme: 'logic', title: 'The order Number is a fixed letter', detail: 'Every order gets the same Number.', fix: 'Number the orders.', where: ['Sales.CreateOrder'] }]
  };
  // enough findings for the list to scroll
  for (let i = 1; i <= 40; i++) desc.risks.push({ level: 'P3', theme: 'naming', title: 'Filler finding ' + i, detail: 'x', fix: 'y', where: ['Sales.CreateOrder'] });
  await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    await MxStore.saveProjectWithModel({ id: 'pdoc', name: 'DocDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null, devTools: true }, model);
    await MxStore.put('descriptions', { projectId: 'pdoc', importedAt: new Date().toISOString(), fileName: 'd.json',
      value: MxDescribe.parse(${JSON.stringify(JSON.stringify(desc))}).value });
  })()`);
  const SW = "(function(q){var s=document.querySelector('.switcher[aria-expanded=\"false\"]'); if (s) s.click(); return document.querySelectorAll(q);})";
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(${SW}('.tree-project')).find(b => b.textContent.indexOf('DocDemo') !== -1)`, 10000, 'project');
  await mx.evaluate(`Array.from(${SW}('.tree-project')).find(b => b.textContent.indexOf('DocDemo') !== -1).click()`);
  await mx.waitFor(`!!document.querySelector('.tree-section')`, 8000, 'sections');
  const go = (name) => goToSection(mx, name);
  const head = () => mx.evaluate(`(function(){ var h = document.querySelector('.xe-head h1'); return h ? h.textContent : null; })()`);

  // ---- in the sidebar, in their groups ----
  const groups = await mx.evaluate(`(function(){ var out = []; Array.from(document.querySelectorAll('.tree-group-label, .tree-section')).forEach(function (n) { out.push(n.classList.contains('tree-section') ? '-' + n.textContent.replace(/\\d+$/, '').trim() : '#' + n.textContent.trim()); }); return out.join(' '); })()`);
  t.ok(/-Overview -Processes -Modules -Architecture/.test(groups) && /-Risks -Assist -Solved cases -Model quality -For developers -Comments/.test(groups),
    'the documentation’s pages are in the sidebar — what the app is, then the review, Assist among it: ' + groups);

  const bare = await mx.evaluate(`Array.from(document.querySelectorAll('.tree-section')).filter(function (b) { var i = b.querySelector('svg.nav-icon'); return !i || !i.childNodes.length; }).map(function (b) { return b.textContent.trim(); })`);
  t.ok(bare.length === 0, 'every section in the sidebar has its icon: ' + JSON.stringify(bare));
  // ---- a screen in the app's frame ----
  await go('Overview');
  await mx.waitFor(`!!document.querySelector('.doc-screen .dx-only')`, 8000, 'overview');
  const frame = await mx.evaluate(`(function(){
    var side = document.querySelector('.doc-screen .dx-side');
    return { h1: document.querySelector('.xe-head h1').textContent, search: !!document.querySelector('.xe-head .xe-search-input'), menu: !!document.querySelector('.xe-head .xe-more'),
      docSide: !!side && getComputedStyle(side).display !== 'none', text: document.querySelector('.doc-screen').textContent.length };
  })()`);
  t.ok(await mx.evaluate(`!document.querySelector('.doc-screen .dx-toc-file')`), 'the card about the HTML file is the file’s, not on MxScout’s screen');
  t.ok(frame.h1 === 'Overview' && frame.search && frame.menu && !frame.docSide && frame.text > 200,
    'Overview is a screen like the others: its title, the search and the project menu above it, no second sidebar: ' + JSON.stringify(frame));

  // ---- a link to another page opens its screen ----
  await mx.evaluate(`Array.from(document.querySelectorAll('.doc-screen .dx a, .doc-screen .dx button')).find(function (b) { return /^Modules/.test(b.textContent.trim()); }).click()`);
  t.ok(await mx.waitFor(`document.querySelector('.xe-head h1') && document.querySelector('.xe-head h1').textContent === 'Modules' && !!document.querySelector('.tree-section.active, .tree-section[aria-current="true"]') && /^Modules/.test(document.querySelector('.tree-section.active, .tree-section[aria-current="true"]').textContent.trim())`, 5000, 'modules'),
    'a link to Modules on the Overview opens the Modules screen, with the sidebar on it');

  // ---- a page only an agent writes ----
  await go('Processes');
  const empty = await mx.waitFor(`(function(){ var c = document.querySelector('.doc-screen .doc-empty'); return c && c.textContent; })()`, 5000, 'empty');
  t.ok(/An agent writes this page/.test(empty) && (await head()) === 'Processes', 'a page no agent has written yet says how to get it: ' + empty);
  // Karol, 2026-10-14: that card sat on the screen's edge, with no margin.
  const gapAt = JSON.parse(await mx.evaluate(`(function(){ var c = document.querySelector('.doc-screen .doc-empty').getBoundingClientRect(), s = document.querySelector('.doc-screen').getBoundingClientRect(); return JSON.stringify({ left: Math.round(c.left - s.left), top: Math.round(c.top - document.querySelector('.doc-screen > .xe-page').getBoundingClientRect().top) }); })()`));
  t.ok(gapAt.left >= 20 && gapAt.top >= 16, 'and it stands inside the page’s margins, not on its edge: ' + JSON.stringify(gapAt));

  // ---- risks, and a flow named in one ----
  await go('Risks');
  await mx.waitFor(`!!document.querySelector('.doc-screen .dx-only') && /The order Number is a fixed letter/.test(document.querySelector('.doc-screen').textContent)`, 8000, 'risks');
  t.ok((await head()) === 'Risks', 'Risks is its own screen, with the agent’s risk on it');
  // A click on a finding further down keeps the list where the reader left it (Karol, 2026-10-13:
  // "it holds to the bottom of the list instead of the top"), and moves nothing around it.
  const kept = await mx.evaluate(`new Promise(function (res) {
    var list = document.querySelector('.dx-rk-list');
    list.scrollTop = 300; list.dispatchEvent(new Event('scroll'));
    var b = list.getBoundingClientRect();
    var row = Array.from(list.querySelectorAll('.dx-rk-row')).find(function (r) { var x = r.getBoundingClientRect(); return x.top > b.top + 40 && x.bottom < b.top + 160; });
    var title = row.textContent;
    row.click();
    setTimeout(function () {
      var l2 = document.querySelector('.dx-rk-list'), on = l2.querySelector('.dx-rk-row.on');
      res({ y: l2.scrollTop, on: on && on.textContent === title, page: document.scrollingElement.scrollTop, host: document.querySelector('main.main').scrollTop });
    }, 300);
  })`);
  t.ok(kept.on && Math.abs(kept.y - 300) < 2 && kept.page === 0 && kept.host === 0, 'picking a finding keeps the list where it was: ' + JSON.stringify(kept));
  await mx.evaluate(`(function(){ var r = Array.from(document.querySelectorAll('.doc-screen .dx button, .doc-screen .dx a')).find(function (b) { return /The order Number is a fixed letter/.test(b.textContent); }); if (r) r.click(); return true; })()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.doc-screen .dx button, .doc-screen .dx a')).find(function (b) { return /CreateOrder/.test(b.textContent); })`, 5000, 'the risk’s flow');
  await mx.evaluate(`Array.from(document.querySelectorAll('.doc-screen .dx button, .doc-screen .dx a')).find(function (b) { return /CreateOrder/.test(b.textContent); }).click()`);
  const landed = await mx.waitFor(`(function(){ var h = document.querySelector('.xe-head h1'), on = document.querySelector('.mf-row.on'); return h && h.textContent === 'Microflows' && on ? on.textContent : null; })()`, 5000, 'flow');
  t.ok(/CreateOrder/.test(landed), 'a flow a risk names opens on the Microflows screen, picked: ' + landed);

  // ---- Modules: the project's own and the Marketplace's apart (Karol, 2026-10-13) ----
  const split = JSON.parse(await mx.evaluate(`(function () {
    var model = { modules: [{ name: 'Sales' }, { name: 'Billing' }, { name: 'CommunityCommons', fromAppStore: true }], entities: [], microflows: [
      { qualifiedName: 'Sales.A', module: 'Sales', name: 'A' }, { qualifiedName: 'Billing.B', module: 'Billing', name: 'B' }, { qualifiedName: 'CommunityCommons.C', module: 'CommunityCommons', name: 'C' }], nanoflows: [], pages: [] };
    var data = MxDocsData.build(model, { name: 'Split' });
    var host = document.createElement('div'); host.style.cssText = 'width:1200px;height:700px'; document.body.appendChild(host);
    var v = MxDocsView.mount(data, host, { only: 'modules', preview: true });
    function look() { return { scope: Array.from(host.querySelectorAll('.dx-ml-scope button')).map(function (b) { return b.textContent + (b.classList.contains('on') ? '*' : ''); }).join('|'),
      list: Array.from(host.querySelectorAll('.dx-ml-item b')).map(function (b) { return b.textContent; }).join(','), eye: (host.querySelector('.dx-md-head .dx-pd-eye') || {}).textContent,
      sort: !!host.querySelector('.dx-list .dx-ml-sort') && getComputedStyle(host.querySelector('.dx-page-head')).display === 'none' }; }
    var out = { own: look() };
    Array.from(host.querySelectorAll('.dx-ml-scope button')).find(function (b) { return /^Marketplace/.test(b.textContent); }).click();
    out.mp = look();
    host.remove();
    return JSON.stringify(out);
  })()`));
  t.ok(split.own.scope === 'Own2*|Marketplace1' && split.own.list === 'Billing,Sales' && split.own.eye === 'Own module',
    'Modules lists the project’s own modules, with an Own | Marketplace switch: ' + JSON.stringify(split.own));
  t.ok(split.mp.scope === 'Own2|Marketplace1*' && split.mp.list === 'CommunityCommons' && split.mp.eye === 'Marketplace module',
    'and Marketplace the others: ' + JSON.stringify(split.mp));
  t.ok(split.own.sort, 'in MxScout there is no second header row: the sort sits over the module list it sorts');

  // ---- the rest are there ----
  for (const [name, title] of [['Architecture', 'Architecture'], ['Model quality', 'Model quality']]) {
    await go(name);
    t.ok(await mx.waitFor(`document.querySelector('.xe-head h1') && document.querySelector('.xe-head h1').textContent === ${JSON.stringify(title)} && !!document.querySelector('.doc-screen .dx-only')`, 5000, name),
      name + ' is a screen too');
  }
};
