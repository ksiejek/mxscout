/* MxScout's single-pick "choose the project folder" path
 * (public/mprImport.js: supportsDirectoryPicker/onDirectoryHandlePicked,
 * wired to the "…or choose a Mendix project folder" button in
 * public/app.js's renderNewProjectCard) is built on `showDirectoryPicker()`,
 * a native OS folder dialog with no DOM — nothing here can automate that,
 * same limitation as every other file/folder picker in this app, and
 * clicking the real button would hang a headless run rather than fail
 * cleanly. So this test opens the import flow the same way the button does
 * (window.MxMprImport.open()) and then drives the documented seam directly
 * (handleDirectoryHandle) with a small in-memory object shaped like a
 * FileSystemDirectoryHandle, built from the same v1/v2 fixtures
 * test/11-mpr.test.js and test/13-mpr-import-ui.test.js use.
 *
 * The v2 case also proves the lazy-navigation claim itself: the fake top
 * folder includes a sibling directory whose values() throws if ever called,
 * and the walk still reaches 'ready' — meaning the code path really did
 * stop at the .mpr and mprcontents/, not scan the whole folder.
 */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const v2b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v2.db')).toString('base64');
  const sidecar = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v2-contents.json'), 'utf8'));

  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'app loaded');

  // Shared fake-directory-handle builder, defined once in the page.
  await mx.evaluate(`(function(){
    function b64ToBytes(b64) { var bin = atob(b64); var u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; }
    window.__b64ToBytes = b64ToBytes;

    function asyncIterFrom(entries) {
      var i = 0;
      return { next: function () {
        if (i < entries.length) return Promise.resolve({ done: false, value: entries[i++] });
        return Promise.resolve({ done: true, value: undefined });
      } };
    }

    // A directory whose own values() throws — standing in for javasource/,
    // themesource/ etc: something that must never actually be opened.
    function poisonedDirHandle(name) {
      return { kind: 'directory', name: name, values: function () { throw new Error('poisoned dir ' + name + ' was read — the walk did not stay lazy'); } };
    }
    window.__poisonedDirHandle = poisonedDirHandle;

    // Builds a directory handle tree from a flat { 'a/b/c.ext': Uint8Array } map.
    function treeDirHandle(flatMap) {
      var root = { dirs: {}, files: {} };
      Object.keys(flatMap).forEach(function (relPath) {
        var parts = relPath.split('/');
        var node = root;
        for (var i = 0; i < parts.length - 1; i++) {
          node.dirs[parts[i]] = node.dirs[parts[i]] || { dirs: {}, files: {} };
          node = node.dirs[parts[i]];
        }
        node.files[parts[parts.length - 1]] = flatMap[relPath];
      });
      function toHandle(node, name) {
        var entries = Object.keys(node.dirs).map(function (n) { return toHandle(node.dirs[n], n); })
          .concat(Object.keys(node.files).map(function (n) {
            return { kind: 'file', name: n, getFile: function () { return Promise.resolve(new File([node.files[n]], n)); } };
          }));
        return { kind: 'directory', name: name, values: function () { return asyncIterFrom(entries); } };
      }
      return toHandle(root, '');
    }
    window.__treeDirHandle = treeDirHandle;

    // The picked project-folder handle itself: the .mpr at top level, plus
    // whatever else (poisoned siblings, an mprcontents/ subtree) is passed in.
    function projectDirHandle(mprFileName, mprBytes, extraTopEntries, mprcontentsHandle) {
      var mprEntry = { kind: 'file', name: mprFileName, getFile: function () { return Promise.resolve(new File([mprBytes], mprFileName)); } };
      var top = [mprEntry].concat(extraTopEntries || []);
      return {
        values: function () { return asyncIterFrom(top); },
        getDirectoryHandle: function (name) {
          if (name === 'mprcontents' && mprcontentsHandle) return Promise.resolve(mprcontentsHandle);
          return Promise.reject(new Error('no such directory: ' + name));
        }
      };
    }
    window.__projectDirHandle = projectDirHandle;
    return true; })()`);

  // ---- v1: no mprcontents/ needed, straight to ready ----
  // window.MxMprImport.open() is the same first step the real "…or choose a
  // Mendix project folder" button takes, before it calls the real (and here
  // unmockable) pickProjectFolder().
  await mx.evaluate(`window.MxMprImport.open()`);
  await mx.waitFor(`!!document.querySelector('.file-drop')`, 8000, 'import modal open');
  await mx.evaluate(`(function(){
    var bytes = window.__b64ToBytes("${v1b64}");
    var handle = window.__projectDirHandle('Other.mpr', bytes, [window.__poisonedDirHandle('themesource')]);
    window.MxMprImport.handleDirectoryHandle(handle);
    return true; })()`);
  const readyV1 = await mx.waitFor(`(function(){ var m = document.querySelector('.modal'); return m && /Found Other\\.mpr/.test(m.textContent) && m.textContent; })()`, 8000, 'v1 ready via directory handle');
  t.ok(/content is inline/.test(readyV1), 'a v1-format project reaches ready from one folder pick, no mprcontents step: ' + readyV1);
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Cancel').click()`);
  t.ok(await mx.waitFor(`!document.querySelector('.modal')`, 5000, 'modal closed'), 'Cancel closes the modal');

  // ---- v2: mprcontents/ found and walked automatically, siblings left alone ----
  await mx.evaluate(`window.MxMprImport.open()`);
  await mx.waitFor(`!!document.querySelector('.file-drop')`, 8000, 'import modal open 2');
  await mx.evaluate(`(function(){
    var mprBytes = window.__b64ToBytes("${v2b64}");
    var sidecar = ${JSON.stringify(sidecar)};
    var flat = {};
    Object.keys(sidecar).forEach(function (relPath) { flat[relPath] = window.__b64ToBytes(sidecar[relPath]); });
    var contentsHandle = window.__treeDirHandle(flat);
    var handle = window.__projectDirHandle('App.mpr', mprBytes, [window.__poisonedDirHandle('javasource')], contentsHandle);
    window.MxMprImport.handleDirectoryHandle(handle);
    return true; })()`);
  const readyV2 = await mx.waitFor(`(function(){ var m = document.querySelector('.modal'); return m && /Found App\\.mpr/.test(m.textContent) && m.textContent; })()`, 8000, 'v2 ready via directory handle');
  t.ok(/4 content files \(v2 project format\)/.test(readyV2), 'a v2-format project finds its mprcontents/ automatically, in one pick: ' + readyV2);

  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Import').click()`);
  await mx.waitFor(`!document.querySelector('.modal')`, 15000, 'modal closed after import');
  await mx.evaluate(`(function(){ var s = document.querySelector('.role-select'); if (s) { s.value = 'all'; s.dispatchEvent(new Event('change', { bubbles: true })); } return true; })()`);
  const projectOpen = await mx.waitFor(`document.body.textContent.indexOf('Customer') !== -1 && document.body.textContent.indexOf('Order') !== -1`, 8000, 'imported model visible');
  t.ok(projectOpen, 'the project imported via the one-pick folder path opens into its own model');

  // ---- error: no .mpr at the top level of the picked folder ----
  await mx.evaluate(`(function(){
    var b = Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'All projects');
    if (b) b.click();
    return true; })()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button')).find(n => n.textContent.trim() === '+ New project')`, 8000, 'back on list screen');
  await mx.evaluate(`window.MxMprImport.open()`);
  await mx.waitFor(`!!document.querySelector('.file-drop')`, 8000, 'import modal open 3');
  await mx.evaluate(`(function(){
    var handle = window.__projectDirHandle('README.txt', new Uint8Array(4), []);
    // No entry at the top level is a real .mpr file — the top-level list
    // built above always has one, so replace it with an always-empty one.
    handle.values = function () { return { next: function () { return Promise.resolve({ done: true }); } }; };
    window.MxMprImport.handleDirectoryHandle(handle);
    return true; })()`);
  const noMprErr = await mx.waitFor(`(function(){ var m = document.querySelector('.modal'); return m && /No \\.mpr file found/.test(m.textContent) && m.textContent; })()`, 8000, 'no-mpr error');
  t.ok(/choose the Mendix project.s own root folder/.test(noMprErr), 'an empty top level fails loudly, naming the actual problem: ' + noMprErr);

  await mx.close();
};
