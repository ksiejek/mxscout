/* mprWorker.js — the message protocol around MxMpr.buildModel, run in an
 * actual Worker (same-origin, allowed by the CSP's default-src fallback —
 * there is no separate worker-src). Uses the same tiny fixtures as
 * test/11-mpr.test.js; this file is about the postMessage contract
 * (progress/done/error), not the model-building logic itself. */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const v2b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v2.db')).toString('base64');
  const sidecar = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v2-contents.json'), 'utf8'));

  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'app loaded');

  // ---- v1: no content files needed ----
  const v1 = await mx.evaluate(`(function () {
    return new Promise(function (resolve, reject) {
      var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
      var w = new Worker('/mprWorker.js');
      var messages = [];
      var timeout = setTimeout(function () { reject(new Error('worker never replied')); }, 10000);
      w.onmessage = function (ev) {
        messages.push(ev.data.type);
        if (ev.data.type === 'done') { clearTimeout(timeout); w.terminate(); resolve({ messages: messages, model: ev.data.model }); }
        if (ev.data.type === 'error') { clearTimeout(timeout); w.terminate(); reject(new Error('worker error: ' + ev.data.message)); }
      };
      w.onerror = function (e) { clearTimeout(timeout); reject(new Error('worker threw: ' + e.message)); };
      w.postMessage({ mprBuffer: bytes, contentsFiles: new Map() });
    });
  })()`);
  t.ok(v1.messages.indexOf('progress') !== -1, 'the worker reports progress before finishing: ' + JSON.stringify(v1.messages));
  t.ok(v1.messages[v1.messages.length - 1] === 'done', 'and finishes with done: ' + JSON.stringify(v1.messages));
  t.ok(v1.model.modules.length === 1 && v1.model.modules[0].name === 'Sales', 'the model that comes back is the real one: ' + JSON.stringify(v1.model.modules));
  t.ok(v1.model.microflows.length === 1 && v1.model.microflows[0].qualifiedName === 'Sales.CreateOrder',
    'including a microflow resolved through the worker end to end: ' + JSON.stringify(v1.model.microflows));

  // ---- v2: contentsFiles is a real Map<relativePath, File> ----
  const v2 = await mx.evaluate(`(function () {
    return new Promise(function (resolve, reject) {
      var sidecar = ${JSON.stringify(sidecar)};
      function b64ToBytes(b64) {
        var bin = atob(b64);
        var u8 = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return u8;
      }
      var files = new Map();
      Object.keys(sidecar).forEach(function (relPath) {
        files.set(relPath, new File([b64ToBytes(sidecar[relPath])], relPath.split('/').pop()));
      });
      var bytes = Uint8Array.from(atob("${v2b64}"), function (c) { return c.charCodeAt(0); }).buffer;
      var w = new Worker('/mprWorker.js');
      var timeout = setTimeout(function () { reject(new Error('worker never replied')); }, 10000);
      w.onmessage = function (ev) {
        if (ev.data.type === 'done') { clearTimeout(timeout); w.terminate(); resolve(ev.data.model); }
        if (ev.data.type === 'error') { clearTimeout(timeout); w.terminate(); reject(new Error('worker error: ' + ev.data.message)); }
      };
      w.onerror = function (e) { clearTimeout(timeout); reject(new Error('worker threw: ' + e.message)); };
      w.postMessage({ mprBuffer: bytes, contentsFiles: files });
    });
  })()`);
  t.ok(v2.entities.length === 2 && v2.userRoles.length === 1,
    'a real File-backed Map survives the postMessage structured clone into the worker: ' + JSON.stringify({ entities: v2.entities.length, userRoles: v2.userRoles.length }));

  // ---- errors come back as a message, not as a thrown/unhandled worker error ----
  const errored = await mx.evaluate(`(function () {
    return new Promise(function (resolve, reject) {
      var w = new Worker('/mprWorker.js');
      var timeout = setTimeout(function () { reject(new Error('worker never replied')); }, 10000);
      w.onmessage = function (ev) { clearTimeout(timeout); w.terminate(); resolve(ev.data); };
      w.onerror = function (e) { clearTimeout(timeout); reject(new Error('worker threw instead of posting an error message: ' + e.message)); };
      w.postMessage({ mprBuffer: new Uint8Array(4).buffer, contentsFiles: new Map() });
    });
  })()`);
  t.ok(errored.type === 'error' && /SQLite/.test(errored.message),
    'a bad .mpr buffer comes back as an error message the UI can show: ' + JSON.stringify(errored));

  await mx.close();
};
