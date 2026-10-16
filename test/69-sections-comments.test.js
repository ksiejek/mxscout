/* The remaining sections in the redesign's frame, comments where their object is, and no blank screen.
 * Karol, 2026-10-13:
 *  - Security and Live app did not match the rest: they take the same header (the section's name, what
 *    it is for, the search, the project menu) and start from the left edge;
 *  - "I add comments but see nothing": a flow with comments says so in the list (💬 N) and lists them
 *    beside the drawing, each opening to read or edit;
 *  - "sometimes I click and get an empty screen": a screen that fails to draw says what broke and
 *    offers a way back. */
'use strict';
const { goToSection } = require('./helpers');
const MODEL = require('./model');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'MxScout loaded');
  await mx.evaluate(`(async () => {
    await MxStore.saveProjectWithModel({ id: 'psec', name: 'SectionsDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null, devTools: true }, ${JSON.stringify(MODEL)});
    return true; })()`);
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button')).find(n => n.textContent.trim() === 'SectionsDemo')`, 10000, 'project');
  await mx.evaluate(`Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button')).find(n => n.textContent.trim() === 'SectionsDemo').click()`);
  const go = (name) => goToSection(mx, name);
  // A click and nothing more, for a screen that is meant to fail to draw (there is no sidebar to wait on).
  const click = (name) => mx.evaluate(`Array.from(document.querySelectorAll('.sidebar button, .sidebar a')).find(n => new RegExp('^' + ${JSON.stringify(name)}).test(n.textContent.trim())).click()`);

  // ---- Security and Live app: the same header, from the left edge ----
  for (const name of ['Security', 'Live app']) {
    await goToSection(mx, name, '.xe-pagescreen .xe-head h1');
    const r = JSON.parse(await mx.evaluate(`(function(){ var page = document.querySelector('.xe-page'), first = page.firstElementChild.getBoundingClientRect(), p = page.getBoundingClientRect();
      return JSON.stringify({ old: !!document.querySelector('.detail-head'), search: !!document.querySelector('.xe-pagescreen .xe-search'), menu: !!document.querySelector('.xe-pagescreen .xe-more'), left: Math.round(first.left - p.left) }); })()`));
    t.ok(!r.old && r.search && r.menu && r.left <= 40, name + ' has the redesign’s header — search, project menu — and starts at the page margin the documentation uses (40px), not in a centred column: ' + JSON.stringify(r));
  }

  // ---- comments where their flow is ----
  await go('Microflows');
  await mx.evaluate(`(function(){ var s = document.querySelector('.xe-head .role-select'); if (s) { s.value = 'all'; s.dispatchEvent(new Event('change')); } return true; })()`);
  await mx.waitFor(`!!document.querySelector('.mf-mod-card, .mf-row')`, 5000, 'microflows');
  await mx.evaluate(`(function(){ var c = Array.from(document.querySelectorAll('.mf-mod-card')).find(function (x) { return /^Sales/.test(x.textContent); }); if (c) c.click(); return true; })()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.mf-row')).find(r => /CancelOrder/.test(r.textContent))`, 5000, 'rows');
  await mx.evaluate(`Array.from(document.querySelectorAll('.mf-row')).find(r => /CancelOrder/.test(r.textContent)).click()`);
  t.ok(await mx.waitFor(`!document.querySelector('.obj-comments') && !document.querySelector('.mf-cm')`, 3000, 'none yet'), 'with no comment, neither the panel nor the count shows');
  await mx.evaluate(`Array.from(document.querySelectorAll('.mf-btn')).find(b => b.textContent === 'Add comment').click()`);
  await mx.waitFor(`!!document.querySelector('.editor-area')`, 3000, 'editor');
  await mx.evaluate(`(function(){ var a = document.querySelectorAll('.editor-area'); a[0].value = 'Cancelling does not refund'; a[0].dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.editor-foot button')).find(b => /Save comment/.test(b.textContent)).click()`);
  const link = await mx.waitFor(`(function(){ var b = document.querySelector('.mf .comments-link'); return b && b.textContent; })()`, 5000, 'comments link');
  t.ok(link === 'Comments · 1' && await mx.evaluate(`document.querySelectorAll('.mf .comments-link').length === 1 && !document.querySelector('.obj-comments')`),
    'the flow says once that it has a comment — one link, not a second list beside the drawing: ' + link);
  t.ok(/💬 1/.test(await mx.evaluate(`Array.from(document.querySelectorAll('.mf-row')).find(r => /CancelOrder/.test(r.textContent)).textContent`)), 'and its row in the list says it has one');
  await mx.evaluate(`document.querySelector('.mf .comments-link').click()`);
  const dlg = await mx.waitFor(`(function(){ var d = document.querySelector('.obj-comments-dialog'); return d && d.textContent; })()`, 5000, 'dialog');
  t.ok(/Cancelling does not refund/.test(dlg), 'the link opens its comments in a window: ' + dlg.slice(0, 100));

  // ---- a comment's object is a way to it: a flow on its own screen ----
  await mx.evaluate(`document.querySelector('.obj-comments-dialog .dm-data-close').click()`);
  await go('Comments');
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.comment-target')).find(b => b.textContent === 'Sales.CancelOrder')`, 5000, 'comment row');
  await mx.evaluate(`Array.from(document.querySelectorAll('.comment-target')).find(b => b.textContent === 'Sales.CancelOrder').click()`);
  const landed = await mx.waitFor(`(function(){ var h = document.querySelector('.xe-head h1'); var on = document.querySelector('.mf-row.on'); return h && h.textContent === 'Microflows' && !document.querySelector('.modal-backdrop') ? (on ? on.textContent : 'no-row') : null; })()`, 5000, 'landed');
  t.ok(/CancelOrder/.test(landed || ''),
    'following a comment on a microflow lands on the Microflows screen with that flow picked, not in a popup: ' + landed);

  // ---- a screen that fails to draw says so ----
  await mx.evaluate(`(function(){ window.__realSec = MxSecurity.renderPanel; MxSecurity.renderPanel = function () { throw new Error('boom in the security panel'); }; return true; })()`);
  await click('Security');
  const err = await mx.waitFor(`(function(){ var e = document.querySelector('.render-error'); return e && e.textContent; })()`, 3000, 'error');
  t.ok(/could not be drawn/.test(err) && /boom in the security panel/.test(err), 'a screen that throws shows what broke instead of a blank page');
  await mx.evaluate(`(function(){ MxSecurity.renderPanel = window.__realSec; Array.from(document.querySelectorAll('.render-error button')).find(b => /Back to Overview/.test(b.textContent)).click(); return true; })()`);
  t.ok(await mx.waitFor(`!document.querySelector('.render-error') && !!document.querySelector('.sidebar')`, 3000, 'back'), 'and Back to Overview gets out of it');

  // ---- a project can be renamed from its menu (Karol, 2026-10-14) ----
  await go('Microflows');
  await mx.waitFor(`!!document.querySelector('.xe-head .xe-more button')`, 5000, 'menu button');
  await mx.evaluate(`document.querySelector('.xe-head .xe-more button').click()`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.xe-menu button')).find(b => b.textContent === 'Rename…').click()`);
  await mx.waitFor(`!!document.querySelector('.modal [aria-label="Project name"]') || !!Array.from(document.querySelectorAll('.modal h3')).find(h => h.textContent === 'Rename project')`, 5000, 'rename window');
  await mx.evaluate(`(function(){ var i = document.querySelector('.modal input'); i.value = '  Sections  renamed '; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
  const renamed = await mx.waitFor(`MxStore.get('projects', 'psec').then(function (p) { return p && p.name === 'Sections renamed' && !document.querySelector('.modal') && p.name; })`, 5000, 'renamed');
  t.ok(renamed === 'Sections renamed', 'Rename… in the project menu renames it, spaces tidied, and the name is kept: ' + renamed);
  t.ok(await mx.evaluate(`document.body.textContent.indexOf('Sections renamed') !== -1`), 'and the app shows the new name');
};
