/* The project's package key (public/crypto.js, transfer.js, store.js) and what a package says about its version.
 *
 * Karol, 2026-10-15: one person updates the descriptions and puts the package on a shared drive, the
 * others import it — and nobody types a code twice. Each project has a random AES-256-GCM key, made by
 * its first package and kept in the browser; every package of it is encrypted with that key, which
 * travels wrapped by the access code under a random key id. A browser that keeps the key opens the next
 * package of the project without the code, and says so; the first import into a browser still needs
 * the code; a kept key that does not open a package falls back to asking for it; a format-1 package
 * still opens with its code; Forget this project's key requires the code again. A package going into a
 * project already here first says whether it is newer, older or the same version, and asks before an
 * older one replaces a model. The Package… dialog says which version it packs. */
'use strict';
const MODEL = require('./model');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxTransfer', 15000, 'MxScout loaded');
  const until = (expr, what, ms) => mx.waitFor(expr, ms || 10000, what);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const A = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  const B = 'f00ba12e5f60718293a4b5c6d7e8f9012345678a';
  const O = '0ddba11e5f60718293a4b5c6d7e8f9012345678a';
  const ver = (c, date, msg) => ({ commit: c, short: c.slice(0, 7), branch: 'main', date, message: msg });
  const VA = ver(A, '2026-10-10T09:00:00.000Z', 'Fix order status');
  const VB = ver(B, '2026-10-14T09:00:00.000Z', 'Add a cancel button');
  const VO = ver(O, '2026-10-01T09:00:00.000Z', 'An old state');

  await mx.evaluate(`(async () => {
    var model = Object.assign({}, ${JSON.stringify(MODEL)}, { version: Object.assign({ log: [] }, ${JSON.stringify(VA)}) });
    await MxStore.saveProjectWithModel({ id: 'pk', name: 'Keyed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 1, summary: { modules: 2, generatedAt: '2026-10-10T10:00:00.000Z', version: ${JSON.stringify(VA)} } }, model);
    await MxStore.put('descriptions', { projectId: 'pk', importedAt: '2026-10-10T11:00:00.000Z', fileName: 'x.json',
      value: { project: 'Keyed', app: { summary: 'Orders for the depot.', story: null, audience: null, users: [], processes: [] }, modules: {}, microflows: {}, nanoflows: {}, pages: {}, entities: {}, risks: [],
        describedAt: ${JSON.stringify(VA)} } });
    return true;
  })()`);
  await mx.navigate(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxTransfer', 15000, 'MxScout loaded again');
  // Downloads are caught, not saved.
  await mx.evaluate(`(function(){ window.__files = []; var real = URL.createObjectURL; URL.createObjectURL = function (blob) { blob.text().then(function (x) { window.__files.push(x); }); return real.call(URL, blob); }; return true; })()`);

  const openByName = async (name) => {
    await until(`!!Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button,a')).find(n => n.textContent.trim() === ${JSON.stringify(name)})`, 'project ' + name);
    await mx.evaluate(`(function(){ var e = Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button,a')).filter(n => n.textContent.trim() === ${JSON.stringify(name)}); e[e.length-1].click(); return true; })()`);
    await until(`!!document.querySelector('.xe-head .xe-icon-btn')`, 'project ' + name + ' open', 15000);
  };
  const menu = async (label) => {
    await until(`!!document.querySelector('.xe-head .xe-icon-btn')`, 'the menu button');
    await mx.evaluate(`(function(){ if (!Array.from(document.querySelectorAll('.xe-menu button')).some(b => b.textContent === ${JSON.stringify(label)})) document.querySelector('.xe-head .xe-icon-btn').click(); return true; })()`);
    await until(`!!Array.from(document.querySelectorAll('.xe-menu button')).find(b => b.textContent === ${JSON.stringify(label)})`, label);
    await mx.evaluate(`Array.from(document.querySelectorAll('.xe-menu button')).find(b => b.textContent === ${JSON.stringify(label)}).click()`);
  };
  const click = (label, scope) => mx.evaluate(`(function(){ var b = Array.from(document.querySelectorAll(${JSON.stringify((scope || '.modal') + ' button')})).find(x => x.textContent === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`);
  // Package the open project through the dialog: { code, file, dialog }.
  const packageIt = async () => {
    const before = await mx.evaluate('window.__files.length');
    await menu('Package…');
    await until(`!!document.querySelector('.modal .pkg-key')`, 'the package dialog, with what it knows of the key');
    const dialog = JSON.parse(await mx.evaluate(`JSON.stringify({ version: document.querySelector('.modal .pkg-version').textContent, key: document.querySelector('.modal .pkg-key').getAttribute('data-key'),
      keyText: document.querySelector('.modal .pkg-key').textContent, described: (document.querySelector('.modal .pkg-described') || {}).textContent || null })`));
    await click('Create package');
    const code = await until(`document.querySelector('.code-value') && document.querySelector('.code-value').textContent`, 'the code', 20000);
    const file = await until(`window.__files.length > ${before} && window.__files[window.__files.length - 1]`, 'the file');
    await click('Done');
    return { code, file, dialog };
  };
  const dropNew = async (text, name) => {
    await mx.evaluate(`(function(){ document.querySelector('.sidebar-new').click(); return true; })()`);
    await until(`!!document.querySelector('.store-opt[data-mode="browser"]')`, 'the new project card');
    await mx.evaluate(`document.querySelector('.store-opt[data-mode="browser"]').click()`);
    await mx.evaluate(`(function(){ var dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name || 'p.mxscout')}, { type: 'application/json' }));
      document.querySelector('.file-drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return true; })()`);
  };
  const dropReplace = async (text) => {
    await menu('Replace model…');
    await until(`document.querySelectorAll('.modal .file-drop').length > 0`, 'the Replace model dialog');
    await mx.evaluate(`(function(){ var dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(text)}], 'p.mxscout', { type: 'application/json' }));
      var boxes = document.querySelectorAll('.modal .file-drop'); boxes[boxes.length - 1].dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return true; })()`);
  };
  const step = () => until(`(function(){ var m = document.querySelector('.unlock-modal'); return m && m.getAttribute('data-step') !== 'trying' && m.getAttribute('data-step'); })()`, 'the package dialog past trying', 15000);
  const enterCode = (code) => mx.evaluate(`(function(){ var c = document.querySelector('.modal .code-input'); c.value = ${JSON.stringify(code)}; c.dispatchEvent(new Event('input', { bubbles: true }));
    Array.from(document.querySelectorAll('.modal button')).find(x => x.textContent === 'Open').click(); return true; })()`);
  // A package of the project made somewhere else with the same key — a colleague's, from a newer or older model.
  const colleague = (v) => mx.evaluate(`(async function(){ var k = await MxStore.getPackageKey('pk');
    var model = Object.assign({}, ${JSON.stringify(MODEL)}, { version: Object.assign({ log: [] }, ${JSON.stringify(v)}), meta: { generatedAt: ${JSON.stringify(v.date)} } });
    return JSON.stringify(await MxCrypto.pack({ project: { name: 'Keyed' }, model: model, descriptions: null }, MxCrypto.generateCode(), k)); })()`);

  // ---- the first package: the dialog says what it packs, and that it makes the key ----
  await openByName('Keyed');
  const first = await packageIt();
  t.ok(/^Model: main @ a1b2c3d · 10 Oct 2026 · “Fix order status”$/.test(first.dialog.version), 'Package… says which version it packs: ' + first.dialog.version);
  t.ok(first.dialog.described === 'With its descriptions, written for main @ a1b2c3d — this version.', 'and which version its descriptions were written for: ' + first.dialog.described);
  t.ok(first.dialog.key === 'new' && /first package of this project/.test(first.dialog.keyText), 'the first package of a project says it needs the code once: ' + first.dialog.keyText);
  const env1 = JSON.parse(first.file);
  const kept = await mx.evaluate(`MxStore.getPackageKey('pk').then(function (k) { return { id: k.id, how: k.how }; })`);
  t.ok(env1.version === 2 && env1.key.id === kept.id && kept.how === 'made' && !/Fix order status|a1b2c3d/.test(first.file),
    'it makes the project’s key, keeps it, names its id in the envelope — and the version is not readable in the file');
  const again = await packageIt();
  t.ok(again.dialog.key === 'known' && /without a code/.test(again.dialog.keyText), 'the next package says those who opened one before need no code: ' + again.dialog.keyText);
  t.ok(JSON.parse(again.file).key.id === kept.id && again.code !== first.code, 'it reuses the project’s key under a new code');

  // ---- re-import without the code: this browser keeps the key ----
  await dropNew(first.file);
  t.ok(await step() === 'compare', 'a package whose key this browser keeps opens without asking for the code');
  const same = JSON.parse(await mx.evaluate(`JSON.stringify({ by: (document.querySelector('.unlock-by-key') || {}).textContent, rel: document.querySelector('.unlock-compare').getAttribute('data-rel'),
    cmp: document.querySelector('.unlock-compare').textContent, title: document.querySelector('.modal h3').textContent })`));
  t.ok(same.by === 'Opened with the key you already have for this project; no code needed.', 'and says so: ' + same.by);
  t.ok(same.title === 'You already have “Keyed”' && same.rel === 'same' && same.cmp === 'This package: main @ a1b2c3d · 10 Oct 2026 — the same version as yours.',
    'it is a project already here: it says so, and that it is the same version: ' + same.cmp);
  await click('Open as a new project…');
  await until(`document.querySelector('.unlock-modal').getAttribute('data-step') === 'new'`, 'Open as a new project');
  await mx.evaluate(`(function(){ var n = document.querySelector('.modal input[placeholder="Project name"]'); n.value = 'Keyed copy'; n.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await click('Open');
  const copyId = await until(`MxStore.getAll('projects').then(function (ps) { var p = ps.filter(function (x) { return x.name === 'Keyed copy'; })[0]; return p ? p.id : false; })`, 'the copy');
  t.ok(await until(`!!document.querySelector('.msg') && /No code was needed/.test(document.querySelector('.msg').textContent)`, 'the message'), 'Open as a new project: opened, no code, and said so');
  t.ok(await mx.evaluate(`MxStore.getPackageKey(${JSON.stringify(copyId)}).then(function (k) { return !!k && k.id === ${JSON.stringify(kept.id)}; })`), 'the new project keeps the same key');

  // A recipient's own package reuses the key, so the round goes both ways.
  await openByName('Keyed copy');
  const back = await packageIt();
  t.ok(JSON.parse(back.file).key.id === kept.id && back.dialog.key === 'known', 'a package made from a project that came in a package reuses its key');

  // ---- newer, older, the same: into the project with Replace model… ----
  await openByName('Keyed');
  await dropReplace(await colleague(VB));
  t.ok(await step() === 'compare', 'Replace model… with a package of this project: opened with the key kept, no code');
  const newer = JSON.parse(await mx.evaluate(`JSON.stringify({ rel: document.querySelector('.unlock-compare').getAttribute('data-rel'), cmp: document.querySelector('.unlock-compare').textContent, warn: !!document.querySelector('.modal .warn-text') })`));
  t.ok(newer.rel === 'newer' && newer.cmp === 'This package: main @ f00ba12 · 14 Oct 2026 — newer than yours (yours: main @ a1b2c3d · 10 Oct 2026).' && !newer.warn,
    'a newer package says so, with both versions: ' + newer.cmp);
  t.ok(await click('Replace model'), 'Replace model, for a newer one');
  t.ok(await until(`MxStore.get('projects', 'pk').then(function (p) { return p.summary.version.commit === ${JSON.stringify(B)}; })`, 'replaced'), 'and the model is the newer one');
  t.ok(await until(`!!document.querySelector('.msg') && /newer than yours/.test(document.querySelector('.msg').textContent)`, 'the message'), 'the message says what it took');
  t.ok(await mx.evaluate(`MxStore.get('descriptions', 'pk').then(function (r) { return !!r && r.value.describedAt.commit === ${JSON.stringify(A)}; })`),
    'descriptions the package does not carry stay, still saying which version they describe');

  await dropReplace(await colleague(VO));
  await step();
  const older = JSON.parse(await mx.evaluate(`JSON.stringify({ rel: document.querySelector('.unlock-compare').getAttribute('data-rel'), cmp: document.querySelector('.unlock-compare').textContent,
    warn: (document.querySelector('.modal .warn-text') || {}).textContent || null, buttons: Array.from(document.querySelectorAll('.modal button')).map(b => b.textContent) })`));
  t.ok(older.rel === 'older' && older.cmp === 'This package: main @ 0ddba11 · 1 Oct 2026 — older than yours (yours: main @ f00ba12 · 14 Oct 2026).', 'an older package says so: ' + older.cmp);
  t.ok(/older than the model you have/.test(older.warn || '') && older.buttons.indexOf('Replace with the older one') !== -1 && older.buttons.indexOf('Replace model') === -1,
    'and asks before an older model replaces this one: ' + JSON.stringify(older.buttons));
  await click('Cancel');
  await sleep(200);
  t.ok(await mx.evaluate(`MxStore.get('projects', 'pk').then(function (p) { return p.summary.version.commit === ${JSON.stringify(B)}; })`), 'Cancel leaves the newer model in place');

  // ---- a kept key that does not open a package: the code is asked for ----
  await mx.evaluate(`(async function(){ var k = await MxStore.getPackageKey('pk'); var other = await MxCrypto.newProjectKey();
    await MxStore.putPackageKey('pk', { id: k.id, key: other.key }, 'opened'); await MxStore.forgetPackageKey(${JSON.stringify(copyId)}); return true; })()`);
  await dropReplace(first.file);
  t.ok(await step() === 'code', 'a key kept under the package’s id that does not open it is not trusted: the code is asked for');
  t.ok(await mx.evaluate(`/The key this browser keeps for “Keyed” does not open this package/.test(document.querySelector('.unlock-key-note').textContent)`), 'and the dialog says why');
  await enterCode(first.code);
  await until(`document.querySelector('.unlock-modal') && document.querySelector('.unlock-modal').getAttribute('data-step') === 'compare'`, 'opened with the code', 20000);
  t.ok(await mx.evaluate(`!document.querySelector('.unlock-by-key') && document.querySelector('.unlock-compare').getAttribute('data-rel') === 'older'`), 'the code opens it, and it is compared like any other');
  await click('Replace with the older one');
  await until(`MxStore.get('projects', 'pk').then(function (p) { return p.summary.version.commit === ${JSON.stringify(A)}; })`, 'older taken');
  // The key is saved just after the model it came with: waited for, not read at the moment the model lands.
  const fixed = await until(`(async function(){ var k = await MxStore.getPackageKey('pk'); try { await MxCrypto.openWithKey(${JSON.stringify(env1)}, k); return true; } catch (e) { return false; } })()`, 'the key kept', 8000).catch(() => false);
  t.ok(fixed, 'Replace with the older one takes it, and the project keeps the key the code unwrapped — the next package opens without the code');

  // ---- the first import into a browser still needs the code ----
  await mx.evaluate(`MxStore.forgetPackageKey('pk').then(function () { return true; })`);
  await dropNew(again.file);
  t.ok(await step() === 'code' && await mx.evaluate(`!document.querySelector('.unlock-key-note')`), 'with no key for it here, a package asks for the access code — as on its first import');
  await click('Cancel');

  // ---- an old package (format 1) still opens, with its code ----
  const old = await mx.evaluate(`(async function(){
    var code = MxCrypto.generateCode(), salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    var norm = MxCrypto.normalizeCode(code);
    var base = await crypto.subtle.importKey('raw', new TextEncoder().encode(norm), 'PBKDF2', false, ['deriveKey']);
    var key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: 600000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    var payload = { project: { name: 'Old one' }, model: ${JSON.stringify(MODEL)}, descriptions: null };
    var gz = new Uint8Array(await new Response(new Blob([new TextEncoder().encode(JSON.stringify(payload))]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    var ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, gz));
    function b64(u) { var s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s); }
    var env = { format: 'mxscout-package', version: 1, createdAt: new Date().toISOString(), kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt: b64(salt) },
      cipher: { name: 'AES-GCM', iv: b64(iv) }, compression: 'gzip', payload: b64(ct) };
    var back = await MxCrypto.openWithCode(env, code);
    // The same format MxCrypto still writes for a file that opens with its code alone (packCodeOnly).
    var own = await MxCrypto.packCodeOnly({ x: 1 }, code), ownBack = await MxCrypto.open(own, code);
    return { code: code, text: JSON.stringify(env), name: back.payload.project.name, key: back.projectKey, keyId: MxCrypto.keyIdOf(env), own: own.version === 1 && !own.key && ownBack.x === 1 };
  })()`);
  t.ok(old.name === 'Old one' && old.key === null && old.keyId === null, 'a format-1 package opens with its code, and has no project key to keep');
  t.ok(old.own, 'packCodeOnly writes that format, and it opens with the code');
  await dropNew(old.text, 'old.mxscout');
  t.ok(await step() === 'code', 'dropped, it asks for its code');
  await mx.evaluate(`(function(){ var n = document.querySelector('.modal input[placeholder="Project name"]'); n.value = 'Old one'; n.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await enterCode(old.code);
  const oldId = await until(`MxStore.getAll('projects').then(function (ps) { var p = ps.filter(function (x) { return x.name === 'Old one'; })[0]; return p ? p.id : false; })`, 'old imported', 20000);
  t.ok(await mx.evaluate(`MxStore.getPackageKey(${JSON.stringify(oldId)}).then(function (k) { return !k; })`), 'and imports as before, with no key kept for it');

  // ---- Forget this project's key, in Settings ----
  await openByName('Keyed');
  await dropReplace(first.file);
  await step();
  await enterCode(first.code);
  await until(`document.querySelector('.unlock-modal') && document.querySelector('.unlock-modal').getAttribute('data-step') === 'compare'`, 'opened again with the code', 20000);
  await click('Replace model');
  await until(`MxStore.getPackageKey('pk').then(function (k) { return !!k; })`, 'the key kept again');
  await mx.evaluate(`(function(){ var b = Array.from(document.querySelectorAll('.tree-section')).find(function (n) { var l = n.querySelector('.tree-section-label'); return (l ? l.textContent : n.textContent).trim() === 'Settings'; }); b.click(); return true; })()`);
  await until(`!!document.querySelector('.pkg-key-card[data-key="kept"]')`, 'the Packages card with a key');
  t.ok(await mx.evaluate(`/open here without the access code/.test(document.querySelector('.pkg-key-card').textContent)`), 'Settings says packages of this project open here without the code');
  await click('Forget this project’s key', '.pkg-key-card');
  t.ok(await until(`MxStore.getPackageKey('pk').then(function (k) { return !k; })`, 'forgotten'), 'Forget this project’s key deletes it');
  t.ok(await until(`!!document.querySelector('.pkg-key-card[data-key="none"]')`, 'the card without a key'), 'and the card says there is none');
  await dropReplace(again.file);
  t.ok(await step() === 'code', 'the next package of the project asks for the code again');
  await click('Cancel');

  // The key never reaches a project folder: nothing in store.js mirrors settings, and project.json has no key in it.
  const pj = await mx.evaluate(`MxFolder.projectJson({ id: 'pk', name: 'Keyed', summary: { version: ${JSON.stringify(VA)} } }, null, '1')`);
  t.ok(!/"[^"]*key[^"]*":/i.test(pj) && pj.indexOf(kept.id) === -1, 'project.json has no key in it, nor the key’s id');

  // The projects this file made are taken away again: a later file's search must not find them.
  await mx.evaluate(`MxStore.getAll('projects').then(function (ps) { return Promise.all(ps.filter(function (p) { return ["Keyed", "Keyed copy", "Old one"].indexOf(p.name) !== -1; }).map(function (p) {
    return (MxStore.hasFolder(p.id) ? MxStore.unlinkFolder(p.id) : Promise.resolve()).then(function () { return MxStore.deleteProjectDeep(p.id); }); })); }).then(function () { return true; })`);
  await mx.close();
};
