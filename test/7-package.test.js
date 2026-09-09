/* The encrypted package and the merge rule — the two pieces of this codebase
 * that fail QUIETLY when they fail. A wrong-looking screen gets reported; a
 * package that opens into subtly wrong comments does not.
 *
 * Both run in the browser because both need the browser: WebCrypto exists only
 * in a secure context, and http://127.0.0.1 is one. */
'use strict';

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxCrypto && !!window.MxComments', 15000, 'MxScout loaded');

  // ---- the access code ----
  const codes = await mx.evaluate(`(function(){
    var out = [];
    for (var i = 0; i < 200; i++) out.push(MxCrypto.generateCode());
    return { sample: out[0], unique: new Set(out).size, allWellFormed: out.every(function (c) { return /^MXS(-[0-9A-HJKMNP-TV-Z]{5}){4}$/.test(c); }) };
  })()`);
  t.ok(codes.allWellFormed, 'every generated code has the shape MXS-XXXXX-XXXXX-XXXXX-XXXXX: ' + codes.sample);
  t.ok(codes.unique === 200, 'two hundred codes, two hundred distinct values');
  t.ok(!/[ILOU]/.test(codes.sample.slice(4)), 'the alphabet has no I, L, O or U — nothing to mishear');

  const norm = await mx.evaluate(`(function(){
    var c = MxCrypto.generateCode();
    var mangled = c.toLowerCase().replace(/-/g, ' ');
    return {
      same: MxCrypto.normalizeCode(mangled) === MxCrypto.normalizeCode(c),
      confusables: MxCrypto.normalizeCode('OIL') === '011' && MxCrypto.normalizeCode('U') === 'V',
      complete: MxCrypto.codeLooksComplete(c) && !MxCrypto.codeLooksComplete('MXS-ABC')
    };
  })()`);
  t.ok(norm.same, 'lower case and spaces instead of dashes still open it');
  t.ok(norm.confusables, 'O reads as 0, I and L as 1, U as V');
  t.ok(norm.complete, 'a short code is recognised as incomplete before anything is tried');

  // ---- pack / open ----
  const trip = await mx.evaluate(`(async function(){
    var code = MxCrypto.generateCode();
    var payload = { project: { name: 'Demo', createdAt: 'x' }, model: { modules: [{ name: 'Sales' }], entities: [] },
                    findings: [{ id: 'f1', problem: 'Totally secret weakness', target: { qualifiedName: 'Sales.Order' } }] };
    var env = await MxCrypto.pack(payload, code);
    var text = JSON.stringify(env);
    var back = await MxCrypto.open(env, code);
    return {
      format: env.format, version: env.version,
      kdf: env.kdf.name + '/' + env.kdf.hash + '/' + env.kdf.iterations,
      cipher: env.cipher.name, compression: env.compression,
      saltLen: atob(env.kdf.salt).length, ivLen: atob(env.cipher.iv).length,
      roundTripped: JSON.stringify(back) === JSON.stringify(payload),
      leaksSecret: text.indexOf('Totally secret weakness') !== -1,
      leaksEntity: text.indexOf('Sales.Order') !== -1,
      leaksName: text.indexOf('Demo') !== -1,
      looksLike: MxCrypto.looksLikePackage(text) && !MxCrypto.looksLikePackage('{"hello":1}')
    };
  })()`);
  t.ok(trip.roundTripped, 'a package opens back into exactly what went in');
  t.ok(trip.kdf === 'PBKDF2/SHA-256/600000', 'key derivation is PBKDF2-HMAC-SHA256 at 600,000 iterations');
  t.ok(trip.cipher === 'AES-GCM' && trip.ivLen === 12 && trip.saltLen === 16, 'AES-GCM with a 12-byte IV and a 16-byte salt');
  t.ok(trip.compression === 'gzip', 'the payload is compressed before it is encrypted');
  t.ok(!trip.leaksSecret && !trip.leaksEntity && !trip.leaksName,
    'nothing readable survives in the file — not the finding, not the entity, not the project name');
  t.ok(trip.looksLike, 'a package is recognisable as one without decrypting it');

  // ---- the ways it must refuse ----
  const refusals = await mx.evaluate(`(async function(){
    async function fails(fn) {
      try { await fn(); return null; } catch (e) { return e.message; }
    }
    var code = MxCrypto.generateCode();
    var other = MxCrypto.generateCode();
    var env = await MxCrypto.pack({ model: { modules: [], entities: [] } }, code);

    var wrongCode = await fails(function () { return MxCrypto.open(env, other); });

    var tampered = JSON.parse(JSON.stringify(env));
    var bytes = atob(tampered.payload);
    var flipped = String.fromCharCode(bytes.charCodeAt(0) ^ 0xff) + bytes.slice(1);
    tampered.payload = btoa(flipped);
    var modified = await fails(function () { return MxCrypto.open(tampered, code); });

    var future = JSON.parse(JSON.stringify(env)); future.version = 99;
    var newer = await fails(function () { return MxCrypto.open(future, code); });

    var alien = await fails(function () { return MxCrypto.open({ format: 'something-else' }, code); });

    var swapped = JSON.parse(JSON.stringify(env)); swapped.kdf.name = 'PBKDF1';
    var scheme = await fails(function () { return MxCrypto.open(swapped, code); });

    // A package that asks for an absurd iteration count would freeze the tab
    // if honoured — the key is derived locally. It must be refused, and
    // refused FAST: if the KDF actually ran a trillion rounds this evaluate
    // would time out rather than come back with a message.
    var absurd = JSON.parse(JSON.stringify(env)); absurd.kdf.iterations = 1e12;
    var startedAt = Date.now();
    var tooMuchWork = await fails(function () { return MxCrypto.open(absurd, code); });
    var refusedInMs = Date.now() - startedAt;

    return { wrongCode: wrongCode, modified: modified, newer: newer, alien: alien, scheme: scheme,
             tooMuchWork: tooMuchWork, refusedInMs: refusedInMs };
  })()`);
  t.ok(/access code does not open/.test(refusals.wrongCode || ''), 'a wrong code is refused, in words a person can act on');
  t.ok(!!refusals.modified, 'a single flipped byte makes it refuse outright — the GCM tag, not a garbled model');
  t.ok(/newer MxScout/.test(refusals.newer || ''), 'a package from a newer format version says so instead of guessing');
  t.ok(/not an MxScout package/.test(refusals.alien || ''), 'a file that is not a package is named as such');
  t.ok(/encryption scheme this version does not know/.test(refusals.scheme || ''), 'an unknown algorithm is refused rather than attempted');
  t.ok(/unreasonable amount of work/.test(refusals.tooMuchWork || ''), 'a package demanding an absurd iteration count is refused, not honoured');
  t.ok(refusals.refusedInMs < 1000, 'and refused immediately, without ever running the KDF: ' + refusals.refusedInMs + 'ms');

  // ---- merging comments ----
  // The case this exists for: a package goes out, comes back changed, and is
  // imported over the copy that never left.
  const merge = await mx.evaluate(`(function(){
    function f(id, problem, updatedAt, extra) {
      return Object.assign({ id: id, target: { qualifiedName: 'Sales.Order', kind: 'entity' }, severity: 'high',
        problem: problem, change: '', status: 'open', author: 'Karol', history: [],
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: updatedAt }, extra || {});
    }
    var mine = [f('a', 'mine A', '2026-05-01T10:00:00.000Z'), f('b', 'mine B', '2026-05-01T10:00:00.000Z')];

    var newer = MxComments.merge(mine, [f('a', 'their A', '2026-06-01T10:00:00.000Z')], 'p1');
    var older = MxComments.merge(mine, [f('a', 'stale A', '2026-04-01T10:00:00.000Z')], 'p1');
    var fresh = MxComments.merge(mine, [f('c', 'their C', '2026-06-01T10:00:00.000Z')], 'p1');
    var junk  = MxComments.merge(mine, [{ problem: 'no id' }, { id: 'z' }, null], 'p1');
    var roundTrip = MxComments.merge(mine, mine.map(MxComments.serialize), 'p1');

    // Round trip: send out, they mark one fixed, it comes back.
    var returned = f('b', 'mine B', '2026-07-01T10:00:00.000Z', { status: 'fixed', history: [{ at: '2026-07-01T10:00:00.000Z', status: 'fixed' }] });
    var fixed = MxComments.merge(mine, [returned], 'p1');
    var fixedB = fixed.merged.filter(function (x) { return x.id === 'b'; })[0];

    var stray = MxComments.serialize(Object.assign({}, mine[0], { projectId: 'other', uiFlag: true, cachedThing: 1 }));

    return {
      newerWins: newer.merged.filter(function (x) { return x.id === 'a'; })[0].problem,
      newerCounts: newer.added + '/' + newer.updated,
      olderIgnored: older.merged.filter(function (x) { return x.id === 'a'; })[0].problem,
      olderCounts: older.added + '/' + older.updated,
      freshAdded: fresh.merged.length + ' ' + fresh.added + '/' + fresh.updated,
      junkDropped: junk.merged.length === 2 && junk.added === 0,
      idempotent: roundTrip.merged.length === 2 && roundTrip.added === 0 && roundTrip.updated === 0,
      fixedStatus: fixedB.status, fixedHistory: fixedB.history.length,
      projectIdRewritten: newer.merged.filter(function (x) { return x.id === 'a'; })[0].projectId,
      whitelisted: Object.keys(stray).sort().join(',')
    };
  })()`);
  t.ok(merge.newerWins === 'their A' && merge.newerCounts === '0/1', 'a newer copy of the same comment replaces mine');
  t.ok(merge.olderIgnored === 'mine A' && merge.olderCounts === '0/0', 'a stale copy arriving late does NOT overwrite mine');
  t.ok(merge.freshAdded === '3 1/0', 'a comment I have never seen is added');
  t.ok(merge.junkDropped, 'a finding with no id or no target is dropped, not repaired into a duplicate');
  t.ok(merge.idempotent, 'importing the same package twice changes nothing — no duplicates on a round trip');
  t.ok(merge.fixedStatus === 'fixed' && merge.fixedHistory === 1,
    'a comment sent out and returned marked fixed comes back fixed, with its history');
  t.ok(merge.projectIdRewritten === 'p1', 'an imported comment is re-homed onto the project importing it');
  t.ok(merge.whitelisted === 'author,change,createdAt,history,id,problem,role,severity,status,target,updatedAt',
    'serialize is a whitelist: projectId and stray fields do not travel');

  // ---- the real path: package a project through the UI ----
  // Everything above tests the pieces. This tests the thing the user actually
  // does, so a broken call site between them cannot pass unnoticed.
  const MODEL = require('./model');
  await mx.evaluate(`(async () => {
    await MxStore.saveProjectWithModel(
      { id: 'pkg1', name: 'Packable', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        source: { kind: 'test' }, bytes: 1, summary: null, appUrl: 'https://leaky-test.example.com' },
      ${JSON.stringify(MODEL)});
    await MxStore.put('findings', {
      id: 'fx', projectId: 'pkg1', target: { kind: 'entity', qualifiedName: 'Sales.Order', name: 'Order', module: 'Sales' },
      role: 'Agent', severity: 'critical', problem: 'Anyone can read every order', change: 'Add an owner constraint',
      status: 'open', author: 'Karol', history: [],
      createdAt: '2026-05-01T09:00:00.000Z', updatedAt: '2026-05-01T09:00:00.000Z'
    });
    return true;
  })()`);
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'Packable')`, 10000, 'project');

  // Catch the download instead of letting it leave the browser.
  await mx.evaluate(`(function(){
    window.__packaged = null;
    var real = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
      blob.text().then(function (txt) { window.__packaged = txt; });
      return real.call(URL, blob);
    };
    return true; })()`);

  await mx.evaluate(`(function(){ var e = Array.from(document.querySelectorAll('button,a')).filter(n => n.textContent.trim() === 'Packable'); e[e.length-1].click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 700));
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(b => /Package/.test(b.textContent)).click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Create package')`, 8000, 'package dialog');
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Create package').click()`);

  const shownCode = await mx.waitFor(`document.querySelector('.code-value') && document.querySelector('.code-value').textContent`, 20000, 'code shown');
  t.ok(/^MXS-/.test(shownCode), 'packaging shows an access code once: ' + shownCode);

  const opened = await mx.waitFor(`window.__packaged && window.__packaged.length && window.__packaged.length`, 10000, 'file captured');
  t.ok(opened > 100, 'a file was produced (' + opened + ' bytes)');

  const check = await mx.evaluate(`(async function(){
    var text = window.__packaged;
    var env = JSON.parse(text);
    var payload = await MxCrypto.open(env, ${JSON.stringify(shownCode)});
    return {
      isPackage: MxCrypto.looksLikePackage(text),
      name: payload.project.name,
      entities: payload.model.entities.length,
      findings: payload.findings.length,
      problem: payload.findings[0] && payload.findings[0].problem,
      carriesProjectId: JSON.stringify(payload.findings[0] || {}).indexOf('projectId') !== -1,
      leaksAppUrl: text.indexOf('leaky-test.example.com') !== -1,
      plaintextName: text.indexOf('Packable') !== -1
    };
  })()`);
  t.ok(check.isPackage && check.name === 'Packable', 'the file it wrote is a package, and it opens with the code it showed');
  t.ok(check.entities === 3 && check.findings === 1 && /Anyone can read/.test(check.problem || ''),
    'the model and the comment are inside it');
  t.ok(!check.carriesProjectId, 'the comment travels without the id of the project it came from');
  t.ok(!check.leaksAppUrl, 'the address of the environment the developer connected to does NOT travel');
  t.ok(!check.plaintextName, 'the project name is inside the encrypted part, not readable in the file');

  // ---- and back again: import the package we just wrote ----
  // The round trip is the product: a reviewer sends findings out, they come
  // back changed, and the two copies have to reconcile. Testing the halves
  // separately would not catch the seam between them.
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Done').click()`);
  await new Promise((r) => setTimeout(r, 400));
  await mx.evaluate(`(function(){ var b = Array.from(document.querySelectorAll('button')).find(n => /New project/.test(n.textContent)); b.click(); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.file-drop')`, 8000, 'new project form');

  await mx.evaluate(
    '(function(){' +
    '  var dt = new DataTransfer();' +
    '  dt.items.add(new File([window.__packaged], "demo.mxscout", { type: "application/json" }));' +
    '  document.querySelector(".file-drop").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));' +
    '  return true; })()'
  );

  // It must ask for the code — a package that opened without one would be the
  // whole feature failing silently.
  const asked = await mx.waitFor(`!!document.querySelector('.modal .code-input')`, 10000, 'code prompt');
  t.ok(!!asked, 'dropping a package asks for the access code before anything is read');
  t.ok(await mx.evaluate(`/This file is encrypted/.test(document.querySelector('.modal').textContent)`),
    'and says why, naming the file');

  // Fill the project name once; only the code changes between the two attempts.
  function enterCode(code) {
    return mx.evaluate(
      '(function(){' +
      '  var name = document.querySelector(".modal input[placeholder=\'Project name\']");' +
      '  if (name) { name.value = "Imported"; name.dispatchEvent(new Event("input", { bubbles: true })); }' +
      '  var c = document.querySelector(".modal .code-input");' +
      '  c.value = ' + JSON.stringify(code) + ';' +
      '  c.dispatchEvent(new Event("input", { bubbles: true }));' +
      '  var b = Array.from(document.querySelectorAll(".modal button")).find(function (x) { return x.textContent === "Open"; });' +
      '  return b ? (b.disabled ? "disabled" : (b.click(), "clicked")) : "no button"; })()'
    );
  }

  // A code of the right SHAPE but the wrong value — otherwise the button is
  // simply disabled and this proves nothing about decryption.
  const wrong = await mx.evaluate(`(function(){
    var c = ${JSON.stringify(shownCode)};
    var last = c.charAt(c.length - 1);
    return c.slice(0, -1) + (last === 'Z' ? 'Y' : 'Z');
  })()`);
  t.ok(wrong !== shownCode, 'built a wrong code of the correct shape: ' + wrong);
  t.ok(await enterCode(wrong) === 'clicked', 'a well-formed code is accepted for trying');
  t.ok(await mx.waitFor(`(function(){ var m = document.querySelector('.modal'); return m && /does not open this package/.test(m.textContent); })()`, 15000, 'refusal'),
    'the wrong code is refused, and the dialog says so');
  t.ok(await mx.evaluate(`!Array.from(document.querySelectorAll('button,a')).some(n => n.textContent.trim() === 'Imported')`),
    'and no project was created from it');

  await enterCode(shownCode);
  t.ok(await mx.waitFor(`Array.from(document.querySelectorAll('button,a')).some(n => n.textContent.trim() === 'Imported')`, 25000, 'imported'),
    'the right code imports it as a project');

  const landed = await mx.evaluate(`(async function(){
    var projects = await MxStore.getAll('projects');
    var p = projects.filter(function (x) { return x.name === 'Imported'; })[0];
    if (!p) return { ok: false };
    var model = await MxStore.getModel(p.id);
    var findings = await MxStore.byIndex('findings', 'byProject', p.id);
    return {
      ok: true,
      entities: model.entities.length,
      findings: findings.length,
      problem: findings[0] && findings[0].problem,
      rehomed: findings[0] && findings[0].projectId === p.id,
      appUrl: p.appUrl || null
    };
  })()`);
  t.ok(landed.ok && landed.entities === 3, 'the model came through the round trip intact');
  t.ok(landed.findings === 1 && /Anyone can read/.test(landed.problem || ''), 'so did the comment');
  t.ok(landed.rehomed, 'and it was re-homed onto the project that imported it');
  t.ok(!landed.appUrl, 'the sender’s environment address did not arrive with it');

  await mx.close();
};
