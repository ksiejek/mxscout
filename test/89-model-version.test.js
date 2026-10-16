/* Which version of the app a model is (public/modelversion.js, mprImport.js, docs.js, folder.js, describe.js).
 *
 * Karol, 2026-10-15: the model, and the descriptions written for it, say which version of the Mendix app
 * they describe — read from the Mendix project's own .git, as plain files, with no git program and no
 * network. A headless browser cannot click a directory picker, so the Mendix project folders here are
 * folders of the Origin Private File System, handed to the same seam a picked folder goes through
 * (MxMprImport.handleDirectoryHandle), each with a .git written by hand: HEAD, a ref or packed-refs, a
 * loose commit object (deflated in the page, as git does), and the reflog. What has to hold: the stamp
 * is read (branch, commit, date, message) from a loose object or, when packed, from the reflog; a
 * detached HEAD, a worktree's .git file, no .git and an unborn branch each say why the version is
 * unknown and the import goes on; no name or e-mail is kept; the stamp is shown on import, on the
 * Overview, in Settings and Documentation, and written into project.json, documentation.md and the AI
 * pack; descriptions saved are stamped with the version (describedAt), and after the model moves the
 * Documentation says what they describe and which commits came since — the same in documentation.md. */
'use strict';
const fs = require('fs');
const path = require('path');
const { goToSection } = require('./helpers');

module.exports = async function (t) {
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxModelVersion', 15000, 'MxScout loaded');
  const until = (expr, what, ms) => mx.waitFor(expr, ms || 10000, what);

  const A = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
  const X = 'c3d4e5f60718293a4b5c6d7e8f9012345678a1b2';
  const B = 'f00ba12e5f60718293a4b5c6d7e8f9012345678a';
  const TA = 1760400000, TX = 1760500000, TB = 1760600000; // Oct 2025: A, then X, then B
  // The OPFS, emptied, and a writer for a Mendix project folder with a .git in it.
  await mx.evaluate(`(async function () {
    var root = await navigator.storage.getDirectory();
    var names = [];
    for (var it = root.keys(), r = await it.next(); !r.done; r = await it.next()) names.push(r.value);
    for (var i = 0; i < names.length; i++) await root.removeEntry(names[i], { recursive: true });
    function b64(b) { var bin = atob(b), u = new Uint8Array(bin.length); for (var j = 0; j < bin.length; j++) u[j] = bin.charCodeAt(j); return u; }
    window.__mpr = b64(${JSON.stringify(v1b64)});
    window.__deflate = async function (text) {
      var s = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream('deflate'));
      return new Uint8Array(await new Response(s).arrayBuffer());
    };
    // files: { 'path/in/folder': string | Uint8Array }
    window.__folder = async function (name, files) {
      var dir = await root.getDirectoryHandle(name, { create: true });
      for (var p in files) {
        var parts = p.split('/'), file = parts.pop(), d = dir;
        for (var k = 0; k < parts.length; k++) d = await d.getDirectoryHandle(parts[k], { create: true });
        var w = await (await d.getFileHandle(file, { create: true })).createWritable();
        await w.write(files[p]); await w.close();
      }
      return dir;
    };
    window.__commit = function (msg, ts) {
      var body = 'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\\nauthor Karol Siejek <karol@example.com> ' + ts + ' +0200\\ncommitter Karol Siejek <karol@example.com> ' + ts + ' +0200\\n\\n' + msg + '\\n\\nThe longer body of the message.\\n';
      return window.__deflate('commit ' + new TextEncoder().encode(body).length + '\\0' + body);
    };
    window.__reflog = function (lines) {
      return lines.map(function (l) { return l[0] + ' ' + l[1] + ' Karol Siejek <karol@example.com> ' + l[2] + ' +0200\\t' + l[3]; }).join('\\n') + '\\n';
    };
    return true;
  })()`);

  // ---- reading .git, every shape ----
  const shapes = await mx.evaluate(`(async function () {
    var Z = '0000000000000000000000000000000000000000';
    var loose = await window.__folder('Loose', {
      '.git/HEAD': 'ref: refs/heads/main\\n', '.git/refs/heads/main': '${A}\\n',
      ['.git/objects/${A.slice(0, 2)}/${A.slice(2)}']: await window.__commit('Fix order status', ${TA}),
      '.git/logs/HEAD': window.__reflog([[Z, '${A}', ${TA}, 'commit (initial): Fix order status']])
    });
    var packed = await window.__folder('Packed', {
      '.git/HEAD': 'ref: refs/heads/feature/cancel\\n',
      '.git/packed-refs': '# pack-refs with: peeled fully-peeled sorted\\n${X} refs/heads/feature/cancel\\n^${A}\\n${A} refs/heads/main\\n',
      '.git/logs/HEAD': window.__reflog([[Z, '${A}', ${TA}, 'commit (initial): Fix order status'], ['${A}', '${X}', ${TX}, 'commit: Add cancel']])
    });
    var detached = await window.__folder('Detached', { '.git/HEAD': '${X}\\n' });
    var worktree = await window.__folder('Worktree', { '.git': 'gitdir: /Users/someone/Projects/App/.git/worktrees/App2\\n' });
    var unborn = await window.__folder('Unborn', { '.git/HEAD': 'ref: refs/heads/main\\n' });
    async function git(dir) { for (var it = dir.values(), r = await it.next(); !r.done; r = await it.next()) if (r.value.name === '.git') return r.value; return null; }
    var V = MxModelVersion;
    var out = {};
    out.loose = await V.fromHandle(await git(loose), 'Loose');
    out.packed = await V.fromHandle(await git(packed), 'Packed');
    out.detached = await V.fromHandle(await git(detached), 'Detached');
    out.worktree = await V.fromHandle(await git(worktree), 'Worktree');
    out.unborn = await V.fromHandle(await git(unborn), 'Unborn');
    out.none = await V.fromHandle(null, 'Plain');
    // A whole folder picked as files (a browser without the folder picker, or a folder dropped): the same reading.
    function f(text, name) { return new File([text], name); }
    out.entries = await V.fromEntries([{ relativePath: 'Drop/App.mpr', file: f('x', 'App.mpr') }, { relativePath: 'Drop/.git/HEAD', file: f('ref: refs/heads/main\\n', 'HEAD') },
      { relativePath: 'Drop/.git/refs/heads/main', file: f('${A}\\n', 'main') }, { relativePath: 'Drop/.git/logs/HEAD', file: f(window.__reflog([[Z, '${A}', ${TA}, 'commit (initial): Fix order status']]), 'HEAD') }], 'Drop');
    out.entriesWorktree = await V.fromEntries([{ relativePath: 'Drop/.git', file: f('gitdir: ../x', '.git') }], 'Drop');
    out.labels = { loose: V.label(out.loose), worktree: V.label(out.worktree), none: V.label(out.none), packed: V.label(out.packed) };
    return out;
  })()`);
  const L = shapes.loose;
  t.ok(L.commit === A && L.short === A.slice(0, 7) && L.branch === 'main' && L.dateFrom === 'commit' && L.date === new Date(TA * 1000).toISOString() && L.message === 'Fix order status',
    'HEAD → refs/heads/main → a loose commit: the branch, the commit, the commit’s own date and the first line of its message: ' + JSON.stringify({ c: L.short, b: L.branch, d: L.date, m: L.message }));
  t.ok(shapes.labels.loose === 'main @ ' + A.slice(0, 7) + ' · ' + MxDay(TA) + ' · “Fix order status”', 'and it reads as “main @ a1b2c3d · 14 Oct 2025 · “Fix order status””: ' + shapes.labels.loose);
  t.ok(JSON.stringify(shapes).indexOf('example.com') === -1 && JSON.stringify(shapes).indexOf('Karol Siejek') === -1,
    'no name and no e-mail is kept, from the commit or from the reflog');
  const P = shapes.packed;
  t.ok(P.commit === X && P.branch === 'feature/cancel' && P.dateFrom === 'reflog' && P.date === new Date(TX * 1000).toISOString() && P.message === 'Add cancel',
    'a branch in packed-refs and a packed commit: the commit from packed-refs, the date and message from the reflog: ' + JSON.stringify({ c: P.short, b: P.branch, from: P.dateFrom, m: P.message }));
  t.ok(P.log.length === 2 && P.log[0].c === X && P.log[0].msg === 'Add cancel' && P.log[1].c === A, 'the reflog is kept newest first, the commit and its message only');
  t.ok(shapes.detached.commit === X && shapes.detached.branch === null, 'a detached HEAD: the commit, no branch');
  t.ok(shapes.worktree.commit === null && shapes.worktree.why === 'worktree' && /worktree/.test(shapes.labels.worktree),
    'a worktree’s .git file points outside the picked folder: the version is unknown, and says why: ' + shapes.labels.worktree);
  t.ok(shapes.unborn.commit === null && shapes.unborn.why === 'no-commit', 'a branch with no commit yet: unknown, no-commit');
  t.ok(shapes.none.commit === null && shapes.none.why === 'no-git' && /has no \.git/.test(shapes.labels.none), 'no .git at all: unknown — ' + shapes.labels.none);
  t.ok(shapes.entries.commit === A && shapes.entries.branch === 'main' && shapes.entries.message === 'Fix order status' && shapes.entriesWorktree.why === 'worktree',
    'a whole folder handed over as files reads the same .git the same way');

  const cmp = await mx.evaluate(`(function () {
    var V = MxModelVersion, a = ${JSON.stringify(L)}, p = ${JSON.stringify(P)};
    return { newer: V.compare(p, a).rel, older: V.compare(a, p).rel, same: V.compare(a, a).rel, byRead: V.compare(null, null, '2026-10-02', '2026-10-01'),
      since: V.since(a, p), sameSince: V.since(a, a) };
  })()`);
  t.ok(cmp.newer === 'newer' && cmp.older === 'older' && cmp.same === 'same', 'two versions compare by their commit, then their dates: newer, older, the same');
  t.ok(cmp.byRead.rel === 'newer' && cmp.byRead.by === 'read', 'with no git on either side, by when each model was read');
  t.ok(cmp.since && cmp.since.commits.length === 1 && cmp.since.commits[0].msg === 'Add cancel' && cmp.sameSince.same,
    'and the commits between two versions come from the newer one’s reflog: ' + JSON.stringify(cmp.since));

  // ---- importing a Mendix project folder with a .git ----
  await mx.evaluate(`(async function () {
    var Z = '0000000000000000000000000000000000000000';
    window.__orderA = await window.__folder('OrderPortal', {
      'OrderPortal.mpr': window.__mpr,
      '.git/HEAD': 'ref: refs/heads/main\\n', '.git/refs/heads/main': '${A}\\n',
      ['.git/objects/${A.slice(0, 2)}/${A.slice(2)}']: await window.__commit('Fix order status', ${TA}),
      '.git/logs/HEAD': window.__reflog([[Z, '${A}', ${TA}, 'commit (initial): Fix order status']])
    });
    MxMprImport.open();
    MxMprImport.handleDirectoryHandle(window.__orderA);
    return true;
  })()`);
  const ready = await until(`(function(){ var l = document.querySelector('.modal .model-version-line'); return l && l.textContent; })()`, 'the ready step with its version');
  t.ok(/^Version: main @ a1b2c3d · .* · “Fix order status” — from the project’s git$/.test(ready), 'picking the folder says which version it is, before importing: ' + ready);
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Import').click()`);
  const pid = await until(`MxStore.getAll('projects').then(function (ps) { var p = ps.filter(function (x) { return x.name === 'OrderPortal'; })[0]; return p ? p.id : false; })`, 'project imported', 30000);
  const stored = await mx.evaluate(`MxStore.getModel(${JSON.stringify(pid)}).then(function (m) { return MxStore.get('projects', ${JSON.stringify(pid)}).then(function (p) { return { v: m.version, s: p.summary.version }; }); })`);
  t.ok(stored.v.commit === A && stored.v.branch === 'main' && stored.v.folder === 'OrderPortal' && stored.v.log.length === 1 && stored.s.commit === A && !stored.s.log,
    'the stamp is kept with the model (with its reflog) and, without the reflog, with the project');

  await until(`!!document.querySelector('.dx-glance')`, 'the Overview');
  t.ok(await until(`(function(){ var dt = Array.from(document.querySelectorAll('.dx-glance dt')).find(function (d) { return d.textContent === 'Version'; }); return !!dt && /main @ a1b2c3d/.test(dt.nextSibling.textContent) && /Fix order status/.test(dt.nextSibling.textContent); })()`, 'Version on the Overview'),
    'the Overview’s At a glance says the version');
  await goToSection(mx, 'Settings', '.lang-select');
  t.ok(await mx.evaluate(`Array.from(document.querySelectorAll('.kv-row')).some(function (r) { return /^Model version/.test(r.textContent) && /main @ a1b2c3d/.test(r.textContent); })`), 'Settings has it as Model version');
  await goToSection(mx, 'Documentation', '.docs-head');
  t.ok(await mx.evaluate(`/^Model: main @ a1b2c3d · .* · “Fix order status”$/.test(document.querySelector('.docs-model-version').textContent)`), 'and the Documentation’s header');

  // ---- into a folder: project.json, documentation.md, the AI pack ----
  await mx.evaluate(`(async function () { var root = await navigator.storage.getDirectory(); MxFolder.test.picker = function () { return root.getDirectoryHandle('OP-mxscout', { create: true }); }; return true; })()`);
  await goToSection(mx, 'Settings', '.xe-head .xe-icon-btn');
  await mx.evaluate(`document.querySelector('.xe-head .xe-icon-btn').click()`);
  await until(`!!Array.from(document.querySelectorAll('.xe-menu button')).find(b => b.textContent === 'Keep in a folder…')`, 'Keep in a folder…');
  await mx.evaluate(`Array.from(document.querySelectorAll('.xe-menu button')).find(b => b.textContent === 'Keep in a folder…').click()`);
  await until(`!!MxStore.folderInfo(${JSON.stringify(pid)})`, 'linked');
  const read = (p) => mx.evaluate(`(async function () { try { var d = await (await navigator.storage.getDirectory()).getDirectoryHandle('OP-mxscout'); var parts = ${JSON.stringify(p)}.split('/'), n = parts.pop(); for (var i = 0; i < parts.length; i++) d = await d.getDirectoryHandle(parts[i]); return await (await (await d.getFileHandle(n)).getFile()).text(); } catch (e) { return null; } })()`);
  await until(`(async function () { try { var d = await (await navigator.storage.getDirectory()).getDirectoryHandle('OP-mxscout'); await d.getFileHandle('ai-pack.md'); return true; } catch (e) { return false; } })()`, 'ai-pack.md written');
  const pj = JSON.parse(await read('project.json'));
  t.ok(pj.model.version && pj.model.version.commit === A && pj.model.version.branch === 'main' && pj.model.version.message === 'Fix order status' && !pj.model.version.log,
    'project.json says which version the model is: ' + JSON.stringify(pj.model.version));
  const docs0 = await read('documentation.md');
  t.ok(/^model: main @ a1b2c3d · 2025-10-1\d · Fix order status$/m.test(docs0) && new RegExp('^model commit: ' + A + '$', 'm').test(docs0), 'documentation.md’s header names it, with the commit in full');
  const pack0 = await read('ai-pack.md');
  t.ok(/^model: main @ a1b2c3d · 2025-10-1\d · Fix order status$/m.test(pack0) && new RegExp('^model commit: ' + A + '$', 'm').test(pack0), 'and the AI pack’s');

  // ---- descriptions are stamped with the version they describe ----
  const fmt = await mx.evaluate('MxDescribe.FORMAT');
  await mx.evaluate(`(async function () { var d = await (await navigator.storage.getDirectory()).getDirectoryHandle('OP-mxscout'); var ib = await d.getDirectoryHandle('inbox', { create: true });
    var w = await (await ib.getFileHandle('a.json', { create: true })).createWritable(); await w.write(${JSON.stringify(JSON.stringify({ format: fmt, version: 1, project: 'OrderPortal', by: 'test agent', app: { summary: 'Orders for the depot.' } }))}); await w.close(); return true; })()`);
  await new Promise((r) => setTimeout(r, 1100));
  await mx.evaluate('MxDocs.folderTick()');
  const desc = await until(`MxStore.get('descriptions', ${JSON.stringify(pid)}).then(function (r) { return r && r.value && r.value.describedAt ? r.value.describedAt : false; })`, 'descriptions saved');
  t.ok(desc.commit === A && desc.branch === 'main' && desc.message === 'Fix order status', 'descriptions an agent sends are saved with the version of the model they describe (describedAt)');
  t.ok(await until(`(async function () { var d = await (await navigator.storage.getDirectory()).getDirectoryHandle('OP-mxscout'); try { var t = await (await (await d.getFileHandle('descriptions.json')).getFile()).text(); return JSON.parse(t).describedAt.commit === ${JSON.stringify(A)}; } catch (e) { return false; } })()`, 'descriptions.json describedAt'),
    'descriptions.json carries it');
  t.ok(await until(`(async function () { var d = await (await navigator.storage.getDirectory()).getDirectoryHandle('OP-mxscout'); var t = await (await (await d.getFileHandle('project.json')).getFile()).text(); var j = JSON.parse(t); return !!j.descriptions && !!j.descriptions.describedAt && j.descriptions.describedAt.commit === ${JSON.stringify(A)}; })()`, 'project.json describedAt'),
    'and project.json says which version the descriptions describe');
  await goToSection(mx, 'Documentation', '.docs-head');
  t.ok(await until(`!!document.querySelector('.docs-since') && document.querySelector('.docs-since').textContent === 'Descriptions describe this version of the model.'`, 'the same version'),
    'the Documentation says the descriptions describe this version of the model');

  // ---- the model moves on: Replace model… from the folder, now at B ----
  await mx.evaluate(`(async function () {
    var Z = '0000000000000000000000000000000000000000';
    var dir = await window.__folder('OrderPortal', {
      '.git/refs/heads/main': '${B}\\n',
      ['.git/objects/${B.slice(0, 2)}/${B.slice(2)}']: await window.__commit('Add a cancel button', ${TB}),
      '.git/logs/HEAD': window.__reflog([[Z, '${A}', ${TA}, 'commit (initial): Fix order status'], ['${A}', '${X}', ${TX}, 'commit: Add cancel'],
        ['${X}', '${X}', ${TX + 10}, 'checkout: moving from feature to main'], ['${X}', '${B}', ${TB}, 'commit: Add a cancel button']])
    });
    MxMprImport.openReplace(${JSON.stringify(pid)});
    MxMprImport.handleDirectoryHandle(dir);
    return true;
  })()`);
  await until(`!!Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Compare')`, 'Compare');
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Compare').click()`);
  const diff = await until(`(function(){ var l = document.querySelector('.modal .model-version-diff'); return l && l.textContent; })()`, 'the diff step', 30000);
  t.ok(/^Version: main @ a1b2c3d · .* → main @ f00ba12 · .* · “Add a cancel button”$/.test(diff), 'Replace model shows the version it was and the one it becomes: ' + diff);
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Replace model').click()`);
  await until(`MxStore.get('projects', ${JSON.stringify(pid)}).then(function (p) { return p.summary.version.commit === ${JSON.stringify(B)}; })`, 'replaced');
  await goToSection(mx, 'Documentation', '.docs-head');
  const since = await until(`(function(){ var s = document.querySelector('.docs-since'); return s && /now main @ f00ba12/.test(s.textContent) && s.textContent; })()`, 'the since hint');
  t.ok(/^Descriptions describe main @ a1b2c3d \(\d+ Oct 2025\); the model is now main @ f00ba12 — 2 commits: “Add a cancel button”, “Add cancel”\.$/.test(since),
    'after the model moved, Documentation says what the descriptions describe, what the model is now, and the commits since — a checkout left out: ' + since);
  const docs1 = await until(`(async function () { var d = await (await navigator.storage.getDirectory()).getDirectoryHandle('OP-mxscout'); var t = await (await (await d.getFileHandle('documentation.md')).getFile()).text(); return /^since then:/m.test(t) && t; })()`, 'documentation.md since');
  t.ok(new RegExp('^described at: main @ a1b2c3d · 2025-10-1\\d · Fix order status$', 'm').test(docs1) && new RegExp('^described commit: ' + A + '$', 'm').test(docs1) &&
    /^since then: 2 commits in the Mendix project’s local git — f00ba12 Add a cancel button; c3d4e5f Add cancel$/m.test(docs1),
    'documentation.md’s header has the described version, its commit, and the commits since, for the agent');

  // ---- a folder with no .git, and a .mpr on its own ----
  await mx.evaluate(`(async function () { var dir = await window.__folder('NoGit', { 'NoGit.mpr': window.__mpr }); MxMprImport.open(); MxMprImport.handleDirectoryHandle(dir); return true; })()`);
  const noGit = await until(`(function(){ var l = document.querySelector('.modal .model-version-line'); return l && /NoGit|unknown/.test(document.querySelector('.modal').textContent) && l.textContent; })()`, 'no .git ready');
  t.ok(noGit === 'Version: unknown — the Mendix project folder has no .git', 'a folder with no .git imports as before, its version unknown and why: ' + noGit);
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Cancel').click()`);
  await mx.evaluate(`(function(){ MxMprImport.open(); MxMprImport.handleMprFile(new File([window.__mpr], 'Single.mpr')); return true; })()`);
  const single = await until(`(function(){ var l = document.querySelector('.modal .model-version-line'); return l && /Single/.test(document.querySelector('.modal').textContent) && l.textContent; })()`, 'single file ready');
  t.ok(/^Version: unknown — read from the \.mpr file alone/.test(single), 'a .mpr picked on its own: unknown, read from the file alone: ' + single);
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Cancel').click()`);

  await mx.evaluate(`(async function () { MxFolder.test.picker = null; var root = await navigator.storage.getDirectory(); var n = []; for (var it = root.keys(), r = await it.next(); !r.done; r = await it.next()) n.push(r.value); for (var i = 0; i < n.length; i++) await root.removeEntry(n[i], { recursive: true }); return true; })()`);
  // The projects this file made are taken away again: a later file's search must not find them.
  await mx.evaluate(`MxStore.getAll('projects').then(function (ps) { return Promise.all(ps.filter(function (p) { return ["OrderPortal"].indexOf(p.name) !== -1; }).map(function (p) {
    return (MxStore.hasFolder(p.id) ? MxStore.unlinkFolder(p.id) : Promise.resolve()).then(function () { return MxStore.deleteProjectDeep(p.id); }); })); }).then(function () { return true; })`);
  await mx.close();

  // "14 Oct 2025", as modelversion.js writes a day in the browser's own time zone.
  function MxDay(ts) {
    const d = new Date(ts * 1000);
    return d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + ' ' + d.getFullYear();
  }
};
