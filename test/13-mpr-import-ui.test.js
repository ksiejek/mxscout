/* "+ New project" offers exactly two clear things on Chromium: the "Choose
 * the Mendix project folder" tile (test/16-mpr-directory-pick.test.js covers
 * that path) and a JSON-file box for a model exported from MxSonar or a
 * .mxscout package. A .mpr file dropped onto the JSON box (rather than
 * picked through the folder tile) still works — nothing this file does
 * disables that — it's just not advertised there any more; the assertion
 * below exercises exactly that "still works even though it's not the
 * labelled path" case, real drop event onto the same box the JSON path
 * uses, the extension check that routes to MxMprImport being the one bit
 * of app.js this file touches. Picking is two steps for a v2 project: the
 * .mpr file itself, then the mprcontents folder MxMprImport.handleMprFile
 * discovers is needed (driven through MxMprImport.handleContentsEntries
 * directly, the documented seam for "how files got selected" — nothing
 * here can automate an OS folder picker dialog). Uses the same v2 fixture
 * as test/11-mpr.test.js. */
'use strict';
const { goToSection, readText } = require('./helpers');
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const v2b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v2.db')).toString('base64');
  const sidecar = JSON.parse(readText(path.join(__dirname, 'fixtures', 'mpr-v2-contents.json')));

  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'app loaded');
  await mx.evaluate(`(function(){
    var b = Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button,a')).find(n => n.textContent.trim() === 'All projects');
    if (b) b.click();
    return true; })()`);
  await mx.waitFor(`!!document.querySelector('.sidebar-new')`, 10000, 'list screen');

  await mx.evaluate(`(function(){
    window.__requests = [];
    var realFetch = window.fetch;
    window.fetch = function (input) { window.__requests.push(String(typeof input === 'string' ? input : input.url)); return realFetch.apply(this, arguments); };
    var open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, url) { window.__requests.push(String(url)); return open.apply(this, arguments); };
    return true; })()`);

  await mx.evaluate(`document.querySelector('.sidebar-new').click()`);
  // Kept in this browser only: the Mendix project and a folder, first on the card, have tests of their own (90, 83).
  await mx.waitFor(`!!document.querySelector('.store-opt[data-mode="browser"]')`, 8000, 'new project card');
  await mx.evaluate(`document.querySelector('.store-opt[data-mode="browser"]').click()`);
  await mx.waitFor(`!!document.querySelector('.file-drop')`, 8000, 'the file box');
  t.ok(await mx.evaluate(`!!document.querySelector('.folder-pick')`),
    'the card offers the project-folder tile as its own, separate option');
  t.ok(/A model exported from MxSonar, or a \.mxscout package/.test(await mx.evaluate(`document.querySelector('.file-drop').parentElement.textContent`)),
    'and the file box next to it is now just for a JSON export — two clear options, not a blurred one');

  // ---- error path: garbage bytes are not a .mpr file ----
  await mx.evaluate(`(function(){
    var evt = new Event('drop', { bubbles: true, cancelable: true });
    evt.dataTransfer = { files: [new File([new Uint8Array(4)], 'not-really.mpr')] };
    document.querySelector('.file-drop').dispatchEvent(evt);
    return true; })()`);
  const badErr = await mx.waitFor(`(function(){ var m = document.querySelector('.modal'); return m && /doesn.t look like a Mendix|SQLite/.test(m.textContent) && m.textContent; })()`, 8000, 'bad mpr error');
  t.ok(/doesn.t look like a Mendix \.mpr file|SQLite/.test(badErr), 'a file that is not really a .mpr fails loudly, not silently: ' + badErr);
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Cancel').click()`);
  await mx.waitFor(`!document.querySelector('.modal')`, 5000, 'error modal closed');

  // ---- the real thing: dropping a real v2-format .mpr onto the SAME drop zone ----
  await mx.evaluate(`document.querySelector('.sidebar-new').click()`);
  await mx.waitFor(`!!document.querySelector('.store-opt[data-mode="browser"]')`, 8000, 'new project card again');
  await mx.evaluate(`document.querySelector('.store-opt[data-mode="browser"]').click()`);
  await mx.waitFor(`!!document.querySelector('.file-drop')`, 8000, 'the file box again');
  await mx.evaluate(`(function(){
    var mprBytes = Uint8Array.from(atob("${v2b64}"), function (c) { return c.charCodeAt(0); });
    var evt = new Event('drop', { bubbles: true, cancelable: true });
    evt.dataTransfer = { files: [new File([mprBytes], 'App.mpr')] };
    document.querySelector('.file-drop').dispatchEvent(evt);
    return true; })()`);

  const contentsStep = await mx.waitFor(`(function(){ var m = document.querySelector('.modal'); return m && /mprcontents/.test(m.textContent) && m.textContent; })()`, 8000, 'contents step');
  t.ok(/v2-format project/.test(contentsStep) && /App\.mpr/.test(contentsStep),
    'a v2-format .mpr triggers a second, explicit ask for its mprcontents folder — not a silent full-project scan: ' + contentsStep);
  // handleContentsEntries is the documented seam for "how the mprcontents
  // folder's files got selected" — a real webkitdirectory pick or a real
  // folder drop both hand it exactly this shape.
  await mx.evaluate(`(function(){
    var sidecar = ${JSON.stringify(sidecar)};
    function b64ToBytes(b64) { var bin = atob(b64); var u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; }
    var entries = Object.keys(sidecar).map(function (relPath) {
      return { relativePath: 'mprcontents/' + relPath, file: new File([b64ToBytes(sidecar[relPath])], relPath.split('/').pop()) };
    });
    window.MxMprImport.handleContentsEntries(entries);
    return true; })()`);

  const ready = await mx.waitFor(`(function(){ var m = document.querySelector('.modal'); return m && /Found App\\.mpr/.test(m.textContent) && m.textContent; })()`, 8000, 'ready step');
  t.ok(/19 content files \(v2 project format\)/.test(ready), 'the modal names the file it found and its format: ' + ready);
  t.ok(await mx.evaluate(`document.querySelector('.modal input[type=text]').value`) === 'App',
    'the project name is pre-filled from the .mpr file name');

  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Import').click()`);
  t.ok(await mx.waitFor(`!!document.querySelector('.modal progress')`, 5000, 'progress bar'),
    'starting the import shows a progress bar, not a frozen screen');

  await mx.waitFor(`!document.querySelector('.modal')`, 15000, 'modal closed');
  t.ok(await mx.waitFor(`/imported from App\\.mpr/.test(document.body.textContent)`, 5000, 'success message'),
    'a plain success message names the file the project came from');

  // Order carries no access rule at all in this fixture, so the default
  // role (the project's first user role) hides it — correctly, that role
  // really cannot read it. Switch to "Everything" to check the import
  // itself, not role filtering (covered elsewhere).
  // A project opens on its Overview; the entities are on Entities.
  await mx.waitFor(`/^Overview/.test((document.querySelector('.tree-section.active') || {}).textContent || '')`, 8000, 'opens on Overview');
  await goToSection(mx, 'Entities', '.role-select');
  await mx.evaluate(`(function(){ var s = document.querySelector('.role-select'); s.value = 'all'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  const projectOpen = await mx.waitFor(`document.body.textContent.indexOf('Customer') !== -1 && document.body.textContent.indexOf('Order') !== -1`, 8000, 'imported model visible');
  t.ok(projectOpen, 'the imported project opens straight into its own model — both entities are visible');

  const requests = await mx.evaluate(`JSON.stringify(window.__requests)`);
  const outside = JSON.parse(requests).filter((u) => /^https?:\/\//.test(u) && u.indexOf(t.MX) !== 0);
  t.ok(outside.length === 0, 'importing a project folder reached nothing outside MxScout — requests were ' + requests);

  // ---- Cancel on the "ready" step closes without creating a project ----
  await mx.evaluate(`(function(){
    var b = Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button,a')).find(n => n.textContent.trim() === 'All projects');
    if (b) b.click();
    return true; })()`);
  await mx.waitFor(`!!document.querySelector('.sidebar-new')`, 8000, 'back on list screen');
  const countBefore = await mx.evaluate(`document.querySelectorAll('.project-card').length`);
  await mx.evaluate(`document.querySelector('.sidebar-new').click()`);
  await mx.waitFor(`!!document.querySelector('.store-opt[data-mode="browser"]')`, 8000, 'new project card 3');
  await mx.evaluate(`document.querySelector('.store-opt[data-mode="browser"]').click()`);
  await mx.waitFor(`!!document.querySelector('.file-drop')`, 8000, 'the file box 3');
  // A v1-shaped .mpr (Contents inline) needs no second pick at all.
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  await mx.evaluate(`(function(){
    var mprBytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); });
    var evt = new Event('drop', { bubbles: true, cancelable: true });
    evt.dataTransfer = { files: [new File([mprBytes], 'Other.mpr')] };
    document.querySelector('.file-drop').dispatchEvent(evt);
    return true; })()`);
  const readyV1 = await mx.waitFor(`(function(){ var m = document.querySelector('.modal'); return m && /Found Other\\.mpr/.test(m.textContent) && m.textContent; })()`, 8000, 'v1 ready');
  t.ok(/content is inline/.test(readyV1), 'a v1-format .mpr goes straight to ready — no mprcontents step needed: ' + readyV1);
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Cancel').click()`);
  t.ok(await mx.waitFor(`!document.querySelector('.modal')`, 5000, 'modal gone'), 'Cancel on the ready step closes the modal');
  const countAfter = await mx.evaluate(`document.querySelectorAll('.project-card').length`);
  t.ok(countAfter === countBefore, 'and no project was created: ' + countBefore + ' -> ' + countAfter);

  await mx.close();
};
