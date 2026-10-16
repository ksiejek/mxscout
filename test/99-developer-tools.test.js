/* Developer tools, the per-project switch (Karol, 2026-10-16: MxScout and MxScout Dev are one app again;
 * what was Dev's is shown in a project that turns it on).
 *
 * What this holds:
 *  - off by default: a new project's sidebar has no Security, Performance, Logs, Live app or Comments, the
 *    name has no "Dev" beside it, and an entity's window has its model tab alone — no Data, no Comments,
 *    no + Comment;
 *  - the switch on the project's Settings turns them on: the sections, "Dev", the window's tabs, kept with
 *    the project;
 *  - turned off, nothing it kept is lost: a comment written while it was on is still kept, and Comments is
 *    back when it is turned on again. */
'use strict';
const { goToSection, openEntity } = require('./helpers');
const MODEL = require('./model');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxDevTools', 15000, 'MxScout loaded');
  await mx.evaluate(`MxStore.saveProjectWithModel({ id: 'pdev', name: 'DevToolsDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, ${JSON.stringify(MODEL)}).then(function () { return true; })`);
  await mx.navigate(t.MX);
  const SW = "(function(q){var s=document.querySelector('.switcher[aria-expanded=\"false\"]'); if (s) s.click(); return document.querySelectorAll(q);})";
  await mx.waitFor(`!!Array.from(${SW}('button')).find(n => n.textContent.trim() === 'DevToolsDemo')`, 10000, 'project');
  await mx.evaluate(`Array.from(${SW}('button')).find(n => n.textContent.trim() === 'DevToolsDemo').click()`);
  await goToSection(mx, 'Overview', '.doc-screen');
  const sections = () => mx.evaluate(`Array.from(document.querySelectorAll('.tree-section')).map(function (b) { return b.textContent.trim().replace(/\\d+$/, ''); }).join('|')`);
  const dev = () => mx.evaluate(`!!document.querySelector('.sidebar-brand .sidebar-dev')`);
  const tabs = () => mx.evaluate(`Array.from(document.querySelectorAll('.popup-tab')).map(function (b) { return b.textContent; }).join('|')`);
  const closeWindow = () => mx.evaluate(`(function(){ var b = Array.from(document.querySelectorAll('.modal-detail button')).find(function (x) { return x.textContent === 'Close'; }); if (b) b.click(); return true; })()`);

  // ---- off by default ----
  const off = await sections();
  t.ok(!/Security|Performance|Logs|Live app|Comments/.test(off) && /^Overview\|Processes\|Modules\|Architecture\|Entities\|Microflows\|Nanoflows\|Pages\|Risks/.test(off) && !(await dev()),
    'off by default: no Security, Performance, Logs, Live app or Comments in the sidebar, no "Dev" beside the name: ' + off);
  t.ok(await mx.evaluate(`MxStore.get('projects', 'pdev').then(function (p) { return !p.devTools; })`), 'and the project keeps no flag until someone turns it on');
  await openEntity(mx, 'Order');
  const offTabs = await tabs();
  const offComment = await mx.evaluate(`!!Array.from(document.querySelectorAll('.modal-detail button')).find(function (b) { return /Comment/.test(b.textContent); })`);
  t.ok(offTabs === 'Attributes & access' && !offComment, 'an entity’s window shows what the model says — no Data, no Comments tab, no + Comment: ' + offTabs);
  await closeWindow();

  // ---- on, on the project's Settings ----
  await goToSection(mx, 'Settings', '.dev-tools-box');
  t.ok(await mx.evaluate(`!document.querySelector('.dev-tools-box').checked && /Live app/.test(document.querySelector('.dev-tools-card').textContent) && /nothing it kept is deleted/.test(document.querySelector('.dev-tools-card').textContent)`),
    'Settings has the switch, off, saying what it adds and that turning it off deletes nothing');
  await mx.evaluate(`document.querySelector('.dev-tools-box').click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.tree-section')).find(function (n) { return /^Security/.test(n.textContent.trim()); })`, 5000, 'Developer tools on');
  const on = await sections();
  t.ok(/Security/.test(on) && /Performance/.test(on) && /Logs/.test(on) && /Live app/.test(on) && /Comments/.test(on) && await dev(),
    'turned on: Security, Performance, Logs, Live app and Comments are in the sidebar, and "Dev" beside the name: ' + on);
  t.ok(await mx.evaluate(`MxStore.get('projects', 'pdev').then(function (p) { return p.devTools === true; })`), 'kept with the project');
  await openEntity(mx, 'Order');
  await mx.waitFor(`document.querySelectorAll('.popup-tab').length === 3`, 5000, 'the full window');
  const onTabs = await tabs();
  t.ok(onTabs === 'Attributes & access|Data|Comments' && await mx.evaluate(`!!Array.from(document.querySelectorAll('.modal-detail button')).find(function (b) { return b.textContent === '+ Comment'; })`),
    'and an entity’s window has Data, Comments and + Comment: ' + onTabs);
  await closeWindow();

  // a comment written while it is on
  await mx.evaluate(`MxStore.put('findings', { id: 'f-dev-1', projectId: 'pdev', target: { kind: 'entity', qualifiedName: 'Sales.Order', module: 'Sales', name: 'Order' }, title: 'Check the totals', status: 'open', severity: 'minor', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [] }).then(function () { return true; })`);

  // ---- off again ----
  await goToSection(mx, 'Security', '.sec-band');
  await goToSection(mx, 'Settings', '.dev-tools-box');
  await mx.evaluate(`document.querySelector('.dev-tools-box').click()`);
  await mx.waitFor(`!Array.from(document.querySelectorAll('.tree-section')).find(function (n) { return /^Security/.test(n.textContent.trim()); })`, 5000, 'Developer tools off');
  const offAgain = await sections();
  const kept = await mx.evaluate(`MxStore.getAll('findings').then(function (rows) { return rows.filter(function (r) { return r.projectId === 'pdev'; }).length; })`);
  t.ok(!/Security|Comments/.test(offAgain) && !(await dev()) && kept === 1, 'turned off: the sections go, and the comment written meanwhile is still kept: ' + offAgain + ' · ' + kept);
  await mx.evaluate(`document.querySelector('.dev-tools-box').click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.tree-section')).find(function (n) { return /^Comments/.test(n.textContent.trim()); })`, 5000, 'on again');
  t.ok(true, 'and turned on again, Comments is back');
  await mx.close();
};
