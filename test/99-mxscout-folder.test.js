/* The MxScout folder (store.js home, folderui.js; Karol, 2026-10-16: "one folder I point at, where MxScout
 * keeps everything that does not go to git — a folder of its own per project; in the Mendix project only
 * what is the team's").
 *
 * What this holds, on the browser's private file system standing in for the disk:
 *  - a project kept in its Mendix project, with no MxScout folder set: its local part in mxscout/.local/, as before;
 *  - the projects list says the MxScout folder is not set, and Choose… sets it;
 *  - the project opened again: its local part moves into a folder of its own in the MxScout folder — model,
 *    documentation, AI pack, inbox, and a project.json naming its id — and mxscout/.local/ is removed from the
 *    Mendix project, which then holds the team's files only;
 *  - New project offers the MxScout folder, and Open a project folder… on a local part says what it is. */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'MxScout loaded');
  const until = (expr, what, ms) => mx.waitFor(expr, ms || 15000, what);
  const mprB64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  async function inject() {
    await mx.evaluate(`(async function () {
      var root = await navigator.storage.getDirectory();
      window.__dir = async function (p) { var d = root; var parts = p.split('/'); for (var j = 0; j < parts.length; j++) d = await d.getDirectoryHandle(parts[j], { create: true }); return d; };
      window.__walk = async function (p, create) { var parts = p.split('/'), name = parts.pop(), d = root; for (var j = 0; j < parts.length; j++) d = await d.getDirectoryHandle(parts[j], { create: !!create }); return { d: d, name: name }; };
      window.__read = async function (p) { try { var w = await window.__walk(p); var f = await (await w.d.getFileHandle(w.name)).getFile(); return await f.text(); } catch (e) { return null; } };
      window.__write = async function (p, data) { var w = await window.__walk(p, true); var wr = await (await w.d.getFileHandle(w.name, { create: true })).createWritable(); await wr.write(data); await wr.close(); return true; };
      window.__writeB64 = function (p, b64) { var bin = atob(b64), u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return window.__write(p, u8); };
      window.__list = async function (p) { try { var w = await window.__walk(p + '/x'); var out = []; for (var it = w.d.keys(), r = await it.next(); !r.done; r = await it.next()) out.push(r.value); return out.sort(); } catch (e) { return null; } };
      window.__pickNext = window.__pickNext || 'HomeApp';
      window.showDirectoryPicker = function () { return window.__dir(window.__pickNext); };
      return true;
    })()`);
  }
  await inject();
  await mx.evaluate(`(async function () {
    var root = await navigator.storage.getDirectory();
    var names = []; for (var it = root.keys(), r = await it.next(); !r.done; r = await it.next()) names.push(r.value);
    for (var i = 0; i < names.length; i++) await root.removeEntry(names[i], { recursive: true });
    await MxStore.setHome(null);
    await window.__writeB64('HomeApp/HomeApp.mpr', ${JSON.stringify(mprB64)});
    return true;
  })()`);
  const list = (p) => mx.evaluate(`window.__list(${JSON.stringify(p)})`);

  // ---- a project in its Mendix project, no MxScout folder yet: .local/ as before ----
  await mx.navigate(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'MxScout loaded again');
  await inject();
  await mx.evaluate(`(function(){ var s = document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); var b = Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'All projects'); if (b) b.click(); return true; })()`);
  const none = await until(`(function(){ var h = document.querySelector('.home-line'); return h && h.getAttribute('data-home') === 'none' && h.textContent; })()`, 'the hint, not set');
  t.ok(/Set your MxScout folder/.test(none) && /Open Settings/.test(none), 'the projects list says the MxScout folder is not set, and opens Settings: ' + none);
  await mx.evaluate(`document.querySelector('.sidebar-new').click()`);
  await until(`!!document.querySelector('.store-opt[data-mode="repo"].on')`, 'the Mendix project option');
  await mx.evaluate(`document.querySelector('.folder-pick').click()`);
  await until(`!!document.querySelector('.repo-ready')`, 'the ready step');
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Import').click()`);
  const id = await until(`MxStore.getAll('projects').then(function (rows) { var r = rows.find(function (x) { var i = MxStore.folderInfo(x.id); return i && i.layout === 2; }); return r ? r.id : false; })`, 'the project', 30000);
  await until(`window.__list('HomeApp/mxscout/.local').then(function (l) { return !!l && l.indexOf('model.json') !== -1 && l.indexOf('documentation.md') !== -1; })`, '.local written');
  t.ok(true, 'with no MxScout folder, the local part is in mxscout/.local/, as before');

  // ---- the MxScout folder set, from the projects list ----
  await mx.evaluate(`(function(){ var s = document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); var b = Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'All projects'); if (b) b.click(); return true; })()`);
  await until(`(function(){ var b = document.querySelector('.home-settings, .foot-settings'); if (b && !document.querySelector('.home-pick')) b.click(); return !!document.querySelector('.home-pick'); })()`, 'Settings, with Choose');
  await mx.evaluate(`(function(){ window.__pickNext = 'MxHome'; document.querySelector('.home-pick').click(); return true; })()`);
  const set = await until(`(function(){ var r = document.querySelector('.set-home'); return r && /MxHome/.test(r.textContent) && r.textContent; })()`, 'the MxScout folder set');
  t.ok(/MxHome/.test(set) && /Change…/.test(set), 'Settings → Choose… sets it: ' + set);

  // ---- the project opened again: its local part moves into the MxScout folder ----
  await mx.navigate(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'MxScout loaded again');
  await inject();
  await mx.evaluate(`(function(){ var s = document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); var b = Array.from(document.querySelectorAll('.tree-project')).find(function (n) { return /HomeApp/.test(n.textContent); }); if (b) b.click(); return true; })()`);
  await until(`window.__list('HomeApp/mxscout').then(function (l) { return !!l && l.indexOf('.local') === -1; })`, '.local moved away', 30000);
  const moved = await list('MxHome/HomeApp');
  const stamp = JSON.parse(await mx.evaluate(`window.__read('MxHome/HomeApp/project.json')`) || 'null');
  t.ok(moved && ['ai-pack.md', 'documentation.md', 'inbox', 'model.json', 'project.json'].every((f) => moved.indexOf(f) !== -1) && stamp && stamp.part === 'local' && stamp.id === id,
    'the local part is now a folder of its own in the MxScout folder — model, documentation, AI pack, inbox — and says whose it is: ' + JSON.stringify(moved));
  const shared = await list('HomeApp/mxscout');
  t.ok(JSON.stringify(shared) === JSON.stringify(['.gitignore', 'AGENTS.md', 'GUIDE.html', 'GUIDE.md', 'README.md', 'mxscout.json']),
    'and mxscout/.local/ is gone from the Mendix project, which holds the team’s files only: ' + JSON.stringify(shared));
  t.ok((await list('HomeApp')).indexOf('HomeApp.mpr') !== -1, 'the .mpr and the rest of the Mendix project as they were');

  // ---- New project offers it; a local part is not a project to open ----
  await mx.evaluate(`(function(){ var s = document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); var b = Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'All projects'); if (b) b.click(); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.sidebar-new')`, 8000, 'list screen');
  await mx.evaluate(`document.querySelector('.sidebar-new').click()`);
  const homeOpt = await until(`(function(){ var o = document.querySelector('.store-opt[data-mode="home"]'); return o && o.textContent; })()`, 'the MxScout folder option');
  t.ok(/In your MxScout folder/.test(homeOpt) && /MxHome/.test(homeOpt) && /\/mxscout-project/.test(homeOpt), 'New project offers your MxScout folder, naming it: ' + homeOpt);
  const refused = await mx.evaluate(`MxStore.readFolderProject && window.__dir('MxHome/HomeApp').then(function (h) { return MxStore.readFolderProject(h).then(function (r) { return r.project && r.project.part; }); }).catch(function (e) { return 'error: ' + e.message; })`);
  t.ok(refused === 'local', 'the local part reads as one, so Open a project folder… on it says what it is: ' + refused);
  await mx.evaluate(`MxStore.setHome(null).then(function () { return true; })`);
  await mx.close();
};
