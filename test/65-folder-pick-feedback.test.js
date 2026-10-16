/* The folder pick that Safari and Firefox use (public/mprImport.js pickFolder, a webkitdirectory
 * <input>) never ends in silence. Karol, 2026-10-13, Safari on a Mac: "I pick the folder and
 * nothing happens" — the code returned without a word when the browser handed over no files,
 * and showed nothing while Safari was still listing a big folder. What has to hold:
 *  - from the click on, the box says it is waiting for the folder;
 *  - a pick that hands over no files says so, and names the way that works: dragging the folder;
 *  - cancelling the dialog clears the waiting, and a drop still works after it.
 * No test can drive an OS folder dialog, so the input's click() is replaced by what the browser
 * would do next: fire change (with no files), or cancel. */
'use strict';
const { readText } = require('./helpers');
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const v2b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v2.db')).toString('base64');
  const sidecar = JSON.parse(readText(path.join(__dirname, 'fixtures', 'mpr-v2-contents.json')));
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxMprImport && !!window.MxStore', 15000, 'app loaded');
  // the contents step, as after picking a v2 .mpr in Safari
  await mx.evaluate(`(function(){
    window.MxMprImport.open();
    var bytes = Uint8Array.from(atob("${v2b64}"), function (c) { return c.charCodeAt(0); });
    window.MxMprImport.handleMprFile(new File([bytes], 'App.mpr'));
    return true; })()`);
  await mx.waitFor(`(function(){ var m = document.querySelector('.modal'); return m && /Choose the mprcontents folder/.test(m.textContent); })()`, 8000, 'contents step');

  const r = JSON.parse(await mx.evaluate(`(async function(){
    var realClick = HTMLInputElement.prototype.click, next = null, out = {};
    HTMLInputElement.prototype.click = function () {
      if (this.type !== 'file' || !this.hasAttribute('webkitdirectory')) return realClick.call(this);
      out.attrs = this.hasAttribute('multiple');
      var input = this;
      setTimeout(function () { input.dispatchEvent(new Event(next)); }, 30);
    };
    function box() { return Array.from(document.querySelectorAll('.modal .file-drop')).find(function (b) { return /mprcontents/.test(b.textContent); }); }
    function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
    var m = function () { return document.querySelector('.modal').textContent; };
    next = 'change';
    box().click();
    out.waiting = !!document.querySelector('.modal .mpr-waiting');
    await wait(150);
    out.afterEmpty = { waiting: !!document.querySelector('.modal .mpr-waiting'), text: (document.querySelector('.modal .warn-text') || {}).textContent, inputs: document.querySelectorAll('body > input[type=file]').length };
    next = 'cancel';
    box().click();
    out.waiting2 = !!document.querySelector('.modal .mpr-waiting') && !document.querySelector('.modal .warn-text');
    await wait(150);
    out.afterCancel = { waiting: !!document.querySelector('.modal .mpr-waiting'), inputs: document.querySelectorAll('body > input[type=file]').length };
    HTMLInputElement.prototype.click = realClick;
    // a drop still works after all that
    var sidecar = ${JSON.stringify(sidecar)};
    window.MxMprImport.handleContentsEntries(Object.keys(sidecar).map(function (rel) {
      var bytes = Uint8Array.from(atob(sidecar[rel]), function (c) { return c.charCodeAt(0); });
      return { relativePath: 'mprcontents/' + rel, file: new File([bytes], rel.split('/').pop()) };
    }));
    await wait(100);
    out.ready = !document.querySelector('.modal .mpr-waiting') && /Import|ready|files/i.test(m());
    Array.from(document.querySelectorAll('.modal button')).filter(function (b) { return b.textContent === 'Cancel'; }).forEach(function (b) { b.click(); });
    return JSON.stringify(out);
  })()`));
  t.ok(r.attrs && r.waiting, 'from the click on, the box says it is waiting for the folder');
  t.ok(!r.afterEmpty.waiting && /handed over no files/.test(r.afterEmpty.text || '') && /Drag the folder/.test(r.afterEmpty.text || ''),
    'a pick that hands over no files says so, and names the way that works: ' + JSON.stringify(r.afterEmpty));
  t.ok(r.afterEmpty.inputs === 0, 'and the hidden input is gone');
  t.ok(r.waiting2 && !r.afterCancel.waiting && r.afterCancel.inputs === 0, 'a new pick clears the old error; cancelling clears the waiting: ' + JSON.stringify([r.waiting2, r.afterCancel]));
  t.ok(r.ready, 'and dropping the folder still works after it');
};
