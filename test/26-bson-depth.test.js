/* bson.js — the recursion-depth guard. The decoder is byte-bounded everywhere
 * else (see the need() checks), but DOCUMENT/ARRAY recurse, and without a cap a
 * pathologically nested blob would overflow the JS stack instead of failing
 * with a message. The input is normally the user's own .mpr, so this is about a
 * clean error rather than a hostile one — but a crash is never the right answer.
 *
 * MxBson is not loaded on the page (it lives in the worker), so this injects it
 * as a same-origin script — allowed by the CSP's script-src 'self' — and builds
 * the nested documents by hand, matching bson.js's own reader: a document is an
 * int32 length, its elements, and a terminating zero byte. */
'use strict';

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'app loaded');

  await mx.evaluate(`new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = '/bson.js';
    s.onload = resolve;
    s.onerror = function () { reject(new Error('could not load /bson.js')); };
    document.head.appendChild(s);
  })`);
  await mx.waitFor('!!window.MxBson', 5000, 'MxBson injected');

  const out = await mx.evaluate(`(function () {
    // An empty BSON document: length 5, then its terminator.
    function emptyDoc() { return new Uint8Array([5, 0, 0, 0, 0]); }
    // Wrap a document as the sole DOCUMENT-typed field "x" of a new one.
    function wrap(child) {
      var len = 4 /*int32 length*/ + 1 /*type byte*/ + 2 /*"x" + NUL*/ + child.length + 1 /*terminator*/;
      var out = new Uint8Array(len);
      var dv = new DataView(out.buffer);
      dv.setInt32(0, len, true);
      var p = 4;
      out[p++] = 0x03;            // DOCUMENT
      out[p++] = 0x78; out[p++] = 0x00; // "x\\0"
      out.set(child, p); p += child.length;
      out[p++] = 0x00;            // document terminator
      return out;
    }
    function nest(n) { var d = emptyDoc(); for (var i = 0; i < n; i++) d = wrap(d); return d; }

    function tryDecode(bytes) {
      try { MxBson.decode(bytes); return { ok: true, message: null }; }
      catch (e) { return { ok: false, message: e.message }; }
    }

    return { shallow: tryDecode(nest(10)), deep: tryDecode(nest(250)) };
  })()`);

  t.ok(out.shallow.ok, 'a normally-nested document still decodes: ' + JSON.stringify(out.shallow));
  t.ok(!out.deep.ok, 'a document nested past the cap is refused rather than crashing the decoder');
  t.ok(/nested deeper than/.test(out.deep.message || ''),
    'and refused with a clear message, not a RangeError: ' + out.deep.message);

  await mx.close();
};
