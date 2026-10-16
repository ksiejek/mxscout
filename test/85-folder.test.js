/* A project kept in a folder on disk (public/folder.js · store.js · folderui.js · docs.js).
 *
 * Karol, 2026-10-15: the folder is the main way in. The browser writes it — through the File System
 * Access API, which a headless browser cannot click through — so the suite hands MxScout folders of
 * the Origin Private File System instead (MxFolder.test.picker), the same FileSystemDirectoryHandle
 * a picked folder is. What has to hold: a project kept in a folder writes its files there; a save
 * rewrites the file it changed; a file an agent drops into inbox/ is taken as the channel's answers
 * are (saved at once, Undo works, moved to inbox/done/); a newer file in the folder wins when the
 * project is opened; a folder that cannot be written loses nothing and is written when it is back;
 * New project, a package, Open a project folder and Move all go into folders; the Documentation tabs;
 * the project's language of written content; and agent.js reads and writes the same folder. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { goToSection, goToDocsTab, readText } = require('./helpers');

module.exports = async function (t) {
  // The project seeded straight into this browser's database and opened — no running app is needed here.
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'MxScout loaded');
  // Comments other tests left on this project would be in its comments.json too: none, to start.
  await mx.evaluate(`MxStore.byIndex('findings', 'byProject', 'p1').then(function (rows) { return Promise.all(rows.map(function (r) { return MxStore.delete('findings', r.id); })).then(function () { return MxStore.delete('triage', 'p1'); }); })`);
  await mx.evaluate(`MxStore.saveProjectWithModel({ id: 'p1', name: 'Demo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: { kind: 'test' }, bytes: 100, summary: null, appUrl: null }, ${JSON.stringify(require('./model'))}).then(function () { return MxStore.put('settings', { key: 'activeProject', value: 'p1' }); })`);
  await mx.navigate(t.MX);
  await mx.waitFor(`!!document.querySelector('.tree-section')`, 15000, 'project open');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // The OPFS, emptied, and small readers and writers for it in the page.
  await mx.evaluate(`(async function () {
    var root = await navigator.storage.getDirectory();
    var names = [];
    for (var it = root.keys(), r = await it.next(); !r.done; r = await it.next()) names.push(r.value);
    for (var i = 0; i < names.length; i++) await root.removeEntry(names[i], { recursive: true });
    window.__root = root;
    window.__dir = function (name) { return root.getDirectoryHandle(name, { create: true }); };
    window.__walk = async function (dir, p, create) {
      var parts = p.split('/'), name = parts.pop(), d = typeof dir === 'string' ? await window.__dir(dir) : dir;
      for (var j = 0; j < parts.length; j++) d = await d.getDirectoryHandle(parts[j], { create: !!create });
      return { d: d, name: name };
    };
    window.__read = async function (dir, p) {
      try { var w = await window.__walk(dir, p); var f = await (await w.d.getFileHandle(w.name)).getFile(); return await f.text(); } catch (e) { return null; }
    };
    window.__write = async function (dir, p, text) {
      var w = await window.__walk(dir, p, true);
      var wr = await (await w.d.getFileHandle(w.name, { create: true })).createWritable();
      await wr.write(text); await wr.close(); return true;
    };
    window.__list = async function (dir, p) {
      try { var d = await window.__dir(dir); if (p) { var parts = p.split('/'); for (var j = 0; j < parts.length; j++) d = await d.getDirectoryHandle(parts[j]); }
        var out = []; for (var it = d.keys(), r = await it.next(); !r.done; r = await it.next()) out.push(r.value); return out.sort(); } catch (e) { return null; }
    };
    window.__pick = function (name) { MxFolder.test.picker = function () { return window.__dir(name); }; };
    return true;
  })()`);
  const read = (dir, p) => mx.evaluate(`window.__read(${JSON.stringify(dir)}, ${JSON.stringify(p)})`);
  const write = (dir, p, text) => mx.evaluate(`window.__write(${JSON.stringify(dir)}, ${JSON.stringify(p)}, ${JSON.stringify(text)})`);
  const list = (dir, p) => mx.evaluate(`window.__list(${JSON.stringify(dir)}, ${JSON.stringify(p || '')})`);
  const until = async (expr, what, ms) => mx.waitFor(expr, ms || 10000, what);
  const fmt = await mx.evaluate('MxDescribe.FORMAT');
  const descFile = (extra) => JSON.stringify(Object.assign({ format: fmt, version: 1, project: 'Demo', by: 'test agent', microflows: { 'Sales.CancelOrder': { text: 'Cancels an order and tells the customer.' } } }, extra || {}));

  // ---- Keep in a folder, from the project's menu ----
  await mx.evaluate(`window.__pick('Demo-folder')`);
  await until(`!!document.querySelector('.xe-head .xe-icon-btn')`, 'the screen header');
  await mx.evaluate(`document.querySelector('.xe-head .xe-icon-btn').click()`);
  await until(`!!Array.from(document.querySelectorAll('.xe-menu button')).find(b => b.textContent === 'Keep in a folder…')`, 'Keep in a folder… in the menu');
  await mx.evaluate(`Array.from(document.querySelectorAll('.xe-menu button')).find(b => b.textContent === 'Keep in a folder…').click()`);
  await until(`!!MxStore.folderInfo('p1')`, 'the project linked to its folder');
  const files = await list('Demo-folder');
  t.ok(['README.md', 'ai-pack.md', 'documentation.md', 'inbox', 'model.json', 'project.json'].every((f) => files.indexOf(f) !== -1),
    'Keep in a folder… writes the project’s files there: ' + JSON.stringify(files));
  const pj = JSON.parse(await read('Demo-folder', 'project.json'));
  t.ok(pj.format === 'mxscout-project' && pj.layout === 1 && pj.id === 'p1' && pj.name === 'Demo' && pj.mxscout && pj.edition === 'MxScout',
    'project.json names the project, the layout version and the MxScout version: ' + JSON.stringify({ format: pj.format, layout: pj.layout, id: pj.id, v: pj.mxscout }));
  const model = JSON.parse(await read('Demo-folder', 'model.json'));
  t.ok(model.microflows.length === require('./model').microflows.length && model.modules.length === 2, 'model.json is the model, whole, written in pieces');
  t.ok(/^# MxScout AI pack\n/.test(await read('Demo-folder', 'ai-pack.md')), 'ai-pack.md is the AI pack');
  const docs0 = await read('Demo-folder', 'documentation.md');
  t.ok(/^# MxScout documentation/.test(docs0) && /flows described: 0 of/.test(docs0) && /Write in: not set yet/.test(docs0),
    'documentation.md says there are no descriptions yet, and that the language is not chosen');
  t.ok(/inbox\//.test(await read('Demo-folder', 'README.md')), 'README.md says what each file is, and that inbox/ is how to hand results back');
  t.ok(files.indexOf('descriptions.json') === -1, 'and there is no descriptions.json while there are no descriptions');

  // ---- MxScout Dev: the comments and what was decided about the risks go to the folder too ----
  await mx.evaluate(`MxStore.put('findings', { id: 'c-1', projectId: 'p1', target: { kind: 'microflow', qualifiedName: 'Sales.CancelOrder' }, severity: 'high', problem: 'Cancels without asking.', change: 'Ask first.', status: 'open', author: 'Tester', history: [], createdAt: '2026-10-15T08:00:00.000Z', updatedAt: '2026-10-15T08:00:00.000Z' })`);
  t.ok(await until(`window.__read('Demo-folder', 'comments.json').then(function (t) { var c = t && JSON.parse(t); return !!c && c.format === 'mxscout-comments' && c.comments.length === 1 && c.comments[0].problem === 'Cancels without asking.' && !('projectId' in c.comments[0]); })`, 'comments.json'),
    'a comment saved writes comments.json, by the whitelist a package uses');
  await mx.evaluate(`MxStore.put('triage', { projectId: 'p1', updatedAt: '2026-10-15T08:00:00.000Z', risks: { 'r-1': { key: 'r-1', origin: 'ai', status: 'false-positive', note: 'Checked: only admins reach it.', by: 'Tester', at: '2026-10-15T08:00:00.000Z', risk: { level: 'P2', title: 'A flow nobody guards', where: [] }, history: [] } } })`);
  t.ok(await until(`window.__read('Demo-folder', 'triage.json').then(function (t) { var c = t && JSON.parse(t); return !!c && c.format === 'mxscout-triage' && !!c.triage.risks['r-1']; })`, 'triage.json'),
    'and a decision about a risk writes triage.json');
  await mx.evaluate(`MxStore.delete('findings', 'c-1')`);
  t.ok(await until(`window.__read('Demo-folder', 'comments.json').then(function (t) { return t === null; })`, 'comments.json gone'),
    'deleting the last comment takes comments.json away');
  await mx.evaluate(`MxStore.put('findings', { id: 'c-1', projectId: 'p1', target: { kind: 'microflow', qualifiedName: 'Sales.CancelOrder' }, severity: 'high', problem: 'Cancels without asking.', change: 'Ask first.', status: 'open', author: 'Tester', history: [], createdAt: '2026-10-15T08:00:00.000Z', updatedAt: '2026-10-15T08:00:00.000Z' })`);
  await until(`window.__read('Demo-folder', 'comments.json').then(function (t) { return !!t; })`, 'comments.json back');

  // ---- the Documentation section: Folder first ----
  await goToSection(mx, 'Documentation', '.docs-folder');
  t.ok(await mx.evaluate(`document.querySelector('.docs-tab.on').getAttribute('data-tab') === 'folder'`), 'Documentation opens on the Folder tab');
  const card = JSON.parse(await mx.evaluate(`JSON.stringify({
    name: document.querySelector('.docs-folder-name').textContent,
    files: Array.from(document.querySelectorAll('.docs-folder-file code')).map(function (c) { return c.textContent; }),
    line: document.querySelector('.docs-folder-line').textContent,
    status: document.querySelector('.docs-folder-state').getAttribute('data-status') })`));
  t.ok(card.name === 'Demo-folder' && card.files.length === 10 && card.files.indexOf('knowledge/') !== -1 && card.status === 'connected', 'it names the folder and each file with its role, connected: ' + JSON.stringify(card));
  t.ok(card.line === 'Use the mendix-describe skill on the MxScout project in Demo-folder.', 'and gives the line to paste to an agent: ' + card.line);
  await mx.evaluate(`(function(){ var i = document.querySelector('.docs-folder-path'); i.value = '~/Projects/Demo/mxscout'; i.dispatchEvent(new Event('change')); return true; })()`);
  t.ok(await until(`document.querySelector('.docs-folder-line') && /in ~\\/Projects\\/Demo\\/mxscout\\.$/.test(document.querySelector('.docs-folder-line').textContent)`, 'the line with the path'),
    'a path typed once goes into that line (the browser knows only the folder’s name)');

  // ---- the inbox: an agent's file, saved at once, Undo, moved to done/ ----
  await write('Demo-folder', 'inbox/20261015-a.json', descFile({ language: 'pl' }));
  await sleep(1100);
  await mx.evaluate('MxDocs.folderTick()');
  await until(`MxStore.get('descriptions', 'p1').then(function (r) { return !!(r && r.value && r.value.microflows['Sales.CancelOrder']); })`, 'the file taken');
  t.ok(await until(`Promise.all([window.__list('Demo-folder', 'inbox'), window.__list('Demo-folder', 'inbox/done')]).then(function (l) { return l[0].indexOf('20261015-a.json') === -1 && (l[1] || []).indexOf('20261015-a.json') !== -1; })`, 'moved to done'),
    'a descriptions file dropped into inbox/ is taken at once and moved to inbox/done/');
  t.ok(await until(`window.__read('Demo-folder', 'descriptions.json').then(function (t) { return !!t && /Cancels an order/.test(t); })`, 'descriptions.json'),
    'the save rewrites descriptions.json');
  t.ok(await until(`window.__read('Demo-folder', 'documentation.md').then(function (t) { return !!t && /flows described: 1 of/.test(t); })`, 'documentation.md rewritten'),
    'and documentation.md');
  t.ok(await until(`MxStore.get('projects', 'p1').then(function (p) { return p.contentLanguage === 'pl'; })`, 'language kept'),
    'the first result that names a language sets the project’s language of written content');
  t.ok(await until(`window.__read('Demo-folder', 'project.json').then(function (t) { return JSON.parse(t).contentLanguage === 'pl'; })`, 'project.json language'),
    'project.json carries it');
  t.ok(await until(`window.__read('Demo-folder', 'documentation.md').then(function (t) { return /Write in: Polish \\(pl\\)/.test(t); })`, 'header language'),
    'and documentation.md’s header says it: Write in: Polish (pl)');
  await until(`!!document.querySelector('.docs-folder-saved button')`, 'Undo on the Folder tab');
  await mx.evaluate(`document.querySelector('.docs-folder-saved button').click()`);
  t.ok(await until(`MxStore.get('descriptions', 'p1').then(function (r) { return !r; })`, 'undone'), 'Undo puts the descriptions back as they were');
  t.ok(await until(`window.__read('Demo-folder', 'descriptions.json').then(function (t) { return t === null; })`, 'descriptions.json gone'),
    'and the folder follows: descriptions.json is gone again');

  // A whole file over descriptions already kept waits for Import them.
  await write('Demo-folder', 'inbox/b.json', descFile());
  await sleep(1100);
  await mx.evaluate('MxDocs.folderTick()');
  await until(`MxStore.get('descriptions', 'p1').then(function (r) { return !!r; })`, 'b taken');
  await write('Demo-folder', 'inbox/c.json', descFile({ microflows: { 'Sales.CancelOrder': { text: 'A whole new file.' } } }));
  await sleep(1100);
  await mx.evaluate('MxDocs.folderTick()');
  await until(`!!Array.from(document.querySelectorAll('.docs-folder button')).find(function (b) { return b.textContent === 'Import them'; })`, 'Import them');
  t.ok(await mx.evaluate(`MxStore.get('descriptions', 'p1').then(function (r) { return r.value.microflows['Sales.CancelOrder'].text === 'Cancels an order and tells the customer.'; })`),
    'a whole file that would replace the descriptions waits for Import them');
  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-folder button')).find(function (b) { return b.textContent === 'Import them'; }).click()`);
  t.ok(await until(`MxStore.get('descriptions', 'p1').then(function (r) { return r.value.microflows['Sales.CancelOrder'].text === 'A whole new file.'; })`, 'imported'),
    'and is kept when pressed');
  t.ok(await until(`window.__list('Demo-folder', 'inbox/done').then(function (l) { return l.indexOf('c.json') !== -1; })`, 'c moved'), 'then moved to inbox/done/');

  // An agent result with setLanguage changes the project's language.
  await write('Demo-folder', 'inbox/d.json', descFile({ add: true, language: 'de', setLanguage: true }));
  await sleep(1100);
  await mx.evaluate('MxDocs.folderTick()');
  t.ok(await until(`MxStore.get('projects', 'p1').then(function (p) { return p.contentLanguage === 'de'; })`, 'setLanguage'),
    'a result with "setLanguage": true changes the project’s language');
  t.ok(await until(`window.__read('Demo-folder', 'project.json').then(function (t) { return JSON.parse(t).contentLanguage === 'de'; })`, 'project.json de'), 'and project.json with it');

  // ---- the tabs ----
  await goToDocsTab(mx, 'agent', '.docs-agent');
  t.ok(await mx.evaluate(`!!Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Share with an agent') && !document.querySelector('.docs-shot')`),
    'Agent channel: the Share with an agent card, and no previews');
  await goToDocsTab(mx, 'manual', '.docs-copilot');
  t.ok(await mx.evaluate(`['Export AI pack', 'Import descriptions…'].every(function (n) { return !!Array.from(document.querySelectorAll('.docs-ai button')).find(b => b.textContent === n); })`),
    'Without an agent tool: Export AI pack, Import descriptions… and the chat assistant');
  await goToDocsTab(mx, 'export', '.docs-shots');
  t.ok(await mx.evaluate(`!!Array.from(document.querySelectorAll('.docs-landing button')).find(b => /Export documentation/.test(b.textContent)) && document.querySelectorAll('.docs-shot .dx.preview').length >= 2`),
    'Export: the export and its previews');
  await goToSection(mx, 'Settings', '.lang-select');
  t.ok(await mx.evaluate(`document.querySelector('.lang-select').value === 'de'`), 'Settings shows the language of written content');
  await mx.evaluate(`(function(){ var s = document.querySelector('.lang-select'); s.value = 'pl'; s.dispatchEvent(new Event('change')); return true; })()`);
  t.ok(await until(`MxStore.get('projects', 'p1').then(function (p) { return p.contentLanguage === 'pl'; })`, 'language from Settings'), 'and changes it, kept with the project');
  await goToDocsTab(mx, 'folder', '.docs-folder');
  await goToSection(mx, 'Settings', '.lang-select');
  t.ok(await mx.evaluate(`document.querySelector('.set-sec .lang-select').value === 'pl'`), 'and keeps it, back in Settings (where the language is set since 2026-10-16)');

  // ---- a newer descriptions.json in the folder wins when the project is opened ----
  await until(`MxStore.folderInfo('p1').pending.length === 0`, 'everything written');
  await sleep(50);
  const edited = JSON.parse(await read('Demo-folder', 'descriptions.json'));
  edited.microflows['Sales.CancelOrder'].text = 'Edited by hand in the folder.';
  await write('Demo-folder', 'descriptions.json', JSON.stringify(edited));
  await mx.navigate(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'reloaded');
  t.ok(await until(`MxStore.get('descriptions', 'p1').then(function (r) { return r && r.value.microflows['Sales.CancelOrder'].text === 'Edited by hand in the folder.'; })`, 'folder wins', 15000),
    'opening the project takes the newer descriptions.json from the folder');
  t.ok(await until(`(function(){ var m = document.querySelector('.msg'); return !!m && /Took descriptions\\.json from the project/.test(m.textContent) && !!m.querySelector('.msg-action'); })()`, 'said, with Undo'),
    'and says so, with Undo');

  // ---- the folder unavailable: nothing lost, written when it is back ----
  await mx.evaluate(`window.__root = null; (async function () { var root = await navigator.storage.getDirectory(); window.__dir = function (n) { return root.getDirectoryHandle(n, { create: true }); }; return true; })()`);
  // helpers again after the reload
  await mx.evaluate(`(async function () {
    var root = await navigator.storage.getDirectory();
    window.__walk = async function (dir, p, create) { var parts = p.split('/'), name = parts.pop(), d = await root.getDirectoryHandle(dir, { create: true }); for (var j = 0; j < parts.length; j++) d = await d.getDirectoryHandle(parts[j], { create: !!create }); return { d: d, name: name }; };
    window.__read = async function (dir, p) { try { var w = await window.__walk(dir, p); return await (await (await w.d.getFileHandle(w.name)).getFile()).text(); } catch (e) { return null; } };
    window.__write = async function (dir, p, text) { var w = await window.__walk(dir, p, true); var wr = await (await w.d.getFileHandle(w.name, { create: true })).createWritable(); await wr.write(text); await wr.close(); return true; };
    window.__list = async function (dir, p) { try { var d = await root.getDirectoryHandle(dir); if (p) { var parts = p.split('/'); for (var j = 0; j < parts.length; j++) d = await d.getDirectoryHandle(parts[j]); } var out = []; for (var it = d.keys(), r = await it.next(); !r.done; r = await it.next()) out.push(r.value); return out.sort(); } catch (e) { return null; } };
    window.__pick = function (name) { MxFolder.test.picker = function () { return root.getDirectoryHandle(name, { create: true }); }; };
    return true; })()`);
  await until(`MxStore.folderInfo('p1') && MxStore.folderInfo('p1').status === 'connected'`, 'connected after the reload');
  await mx.evaluate(`MxFolder.test.permission = 'prompt'; MxStore.syncFolder('p1', false)`);
  await until(`MxStore.folderInfo('p1').status === 'needs-permission'`, 'needs permission');
  await mx.evaluate(`(function(){ var p = MxStore; return MxStore.get('projects', 'p1').then(function (row) { row.name = 'Demo renamed'; return MxStore.put('projects', row); }); })()`);
  t.ok(await until(`!!Array.from(document.querySelectorAll('.folder-reconnect')).find(function (b) { return b.textContent === 'Reconnect the folder'; })`, 'Reconnect the folder'),
    'a folder the browser needs permission for again shows Reconnect the folder in the header');
  t.ok(JSON.parse(await read('Demo-folder', 'project.json')).name === 'Demo' && (await mx.evaluate(`MxStore.folderInfo('p1').pending.indexOf('project.json') !== -1`)),
    'meanwhile the change is kept in this browser and waits for the folder');
  await mx.evaluate(`document.querySelector('.folder-reconnect').click()`);
  t.ok(await until(`window.__read('Demo-folder', 'project.json').then(function (t) { return JSON.parse(t).name === 'Demo renamed'; })`, 'written after reconnect'),
    'Reconnect asks for permission and writes what waited');
  // A write that fails is said, and tried again.
  await mx.evaluate(`MxFolder.test.failWrites = 'Demo-folder/project.json'; MxStore.get('projects', 'p1').then(function (row) { row.name = 'Demo again'; return MxStore.put('projects', row); })`);
  t.ok(await until(`MxStore.folderInfo('p1').status === 'error' && !!document.querySelector('.msg.error') && /Could not write the project’s folder/.test(document.querySelector('.msg.error').textContent)`, 'write error said'),
    'a write that fails is said where the person is');
  t.ok(await mx.evaluate(`MxStore.get('projects', 'p1').then(function (p) { return p.name === 'Demo again'; })`), 'and the browser kept the change');
  await mx.evaluate(`MxFolder.test.failWrites = null`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.folder-reconnect')).find(function (b) { return b.textContent === 'Retry the folder'; }).click()`);
  t.ok(await until(`window.__read('Demo-folder', 'project.json').then(function (t) { return JSON.parse(t).name === 'Demo again'; })`, 'written after retry'),
    'Retry writes it once the folder takes writes again');

  // ---- agent.js on the same folder (Node) ----
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mxscout-folder-'));
  const copy = JSON.parse(await mx.evaluate(`(async function () {
    var out = {};
    for (var f of ['project.json', 'model.json', 'descriptions.json', 'documentation.md', 'ai-pack.md', 'README.md']) out[f] = await window.__read('Demo-folder', f);
    return JSON.stringify(out); })()`));
  Object.keys(copy).forEach((f) => fs.writeFileSync(path.join(tmp, f), copy[f]));
  fs.mkdirSync(path.join(tmp, 'inbox'));
  const agent = path.join(__dirname, '..', 'skills', 'mendix-describe', 'agent.js');
  // The agent's own files go into a work folder outside the project (MXSCOUT_WORK here, so the run leaves nothing behind).
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mxscout-work-'));
  const env = Object.assign({}, process.env, { MXSCOUT_TOKEN: '', MXSCOUT_WORK: work });
  const run = (...a) => execFileSync(process.execPath, [agent].concat(a), { env, encoding: 'utf8' });
  const status = run('status', '--folder', tmp);
  t.ok(/project: Demo again/.test(status) && /language: Polish \(pl\)/.test(status) && /^Sales \| \d+-\d+ \|/m.test(status) && /documentation: yes/.test(status),
    'agent.js status --folder reads project.json, the pack’s index and documentation.md: ' + status.split('\n').slice(0, 3).join(' / '));
  const insideStatus = execFileSync(process.execPath, [agent, 'status'], { env, encoding: 'utf8', cwd: tmp });
  t.ok(/project: Demo again/.test(insideStatus), 'and finds the folder by itself when run inside it');
  t.ok(run('docs', '--folder', tmp) === copy['documentation.md'], 'agent.js docs --folder is documentation.md');
  const mod = run('module', 'Sales', '--folder', tmp);
  t.ok(/^## module Sales\n/.test(mod) && mod.indexOf('## module Admin') === -1, 'agent.js module Sales --folder is that module’s lines of ai-pack.md, by its index');
  const held = fs.readdirSync(tmp).sort().join(',');
  t.ok(run('workdir', '--folder', tmp).trim() === work, 'agent.js workdir prints the work folder');
  const packed = run('pack', 'p.md', '--folder', tmp);
  t.ok(readText(path.join(work, 'p.md')) === copy['ai-pack.md'] && packed.indexOf(path.join(work, 'p.md')) !== -1, 'agent.js pack --folder writes the pack to a file — named alone, in the work folder, its full path said');
  let intoFolder = '';
  try { execFileSync(process.execPath, [agent, 'pack', path.join(tmp, 'p.md'), '--folder', tmp], { env, encoding: 'utf8', stdio: 'pipe' }); } catch (e) { intoFolder = String(e.stderr); }
  t.ok(/Refusing to write/.test(intoFolder) && /MxScout project folder/.test(intoFolder) && fs.readdirSync(tmp).sort().join(',') === held, 'and refuses to write it into the project folder, which gains nothing: ' + intoFolder.trim().slice(0, 90));
  const todo = execFileSync(process.execPath, [path.join(__dirname, '..', 'skills', 'mendix-describe', 'check-descriptions.js'), 'todo', '--folder', tmp], { encoding: 'utf8' });
  t.ok(/flows to describe/.test(todo), 'check-descriptions.js todo --folder works with descriptions.json: ' + todo.split('\n')[0]);
  fs.writeFileSync(path.join(work, 'mine.json'), descFile({ add: true, microflows: { 'Sales.OrphanSweep': { text: 'Sweeps up orders nobody owns.' } } }));
  run('send', '--folder', tmp, 'mine.json');
  const sent = fs.readdirSync(path.join(tmp, 'inbox'));
  t.ok(sent.length === 1 && /^\d{4}-\d\d-\d\dT[\d-]+Z-mine\.json$/.test(sent[0]), 'agent.js send --folder takes the file from the work folder and writes it whole into inbox/, under a timestamped name: ' + sent.join(','));
  let refused = '';
  try { execFileSync(process.execPath, [agent, 'send', '--folder', tmp, path.join(work, 'p.md')], { env, encoding: 'utf8', stdio: 'pipe' }); } catch (e) { refused = String(e.stderr); }
  t.ok(/Cannot read .* as JSON|not a descriptions file|not a case note/.test(refused), 'and refuses what is not a descriptions file: ' + refused.trim());
  // What it wrote, handed to MxScout's own inbox, is taken.
  await write('Demo-folder', 'inbox/' + sent[0], readText(path.join(tmp, 'inbox', sent[0])));
  await sleep(1100);
  await mx.evaluate('MxDocs.folderTick()');
  t.ok(await until(`MxStore.get('descriptions', 'p1').then(function (r) { return !!r.value.microflows['Sales.OrphanSweep']; })`, 'agent.js file taken'), 'and MxScout takes what agent.js wrote');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });

  // ---- New project, kept in a folder ----
  await mx.evaluate(`document.querySelector('.sidebar-new').click()`);
  // Inside the Mendix project (mxscout/) comes first since 2026-10-15 (test 91); a folder of its own second.
  await until(`!!document.querySelector('.store-opt[data-mode="repo"].on')`, 'the Mendix project option first, chosen');
  t.ok(await mx.evaluate(`document.querySelectorAll('.store-opt')[0].getAttribute('data-mode') === 'repo' && /recommended/.test(document.querySelectorAll('.store-opt')[0].textContent) && document.querySelectorAll('.store-opt')[1].getAttribute('data-mode') === 'folder'`),
    'New project offers the Mendix project first, as the recommended way, then a folder on disk');
  await mx.evaluate(`document.querySelector('.store-opt[data-mode="folder"]').click()`);
  await until(`!!document.querySelector('.store-opt[data-mode="folder"].on') && !!document.querySelector('.store-pick')`, 'the folder option chosen');
  // A folder that already holds another project is refused.
  await mx.evaluate(`window.__pick('Demo-folder'); document.querySelector('.store-pick').click()`);
  t.ok(/already holds an MxScout project/.test(await until(`(function(){ var w = document.querySelector('.store-choice .warn-text'); return w && w.textContent; })()`, 'refused')),
    'a folder that holds another project is refused');
  // A folder with other files gets a folder of MxScout's own inside it.
  await write('Mendix-app', 'App.mpr', 'not really');
  await mx.evaluate(`window.__pick('Mendix-app'); document.querySelector('.store-pick').click()`);
  t.ok(/makes a folder of its own inside it/.test(await until(`(function(){ var w = document.querySelector('.store-picked'); return w && w.textContent; })()`, 'picked')),
    'a folder holding other files gets a folder of MxScout’s own inside it');
  await mx.evaluate(`(function(){
    var i = document.querySelector('.new-project input[type=text]'); i.value = 'Orders'; i.dispatchEvent(new Event('input'));
    var dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify({ modules: [{ name: 'Orders' }], entities: [], associations: [], userRoles: [], microflows: [], nanoflows: [], pages: [] })], 'orders.json'));
    document.querySelector('.file-drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    return true; })()`);
  await until(`document.querySelector('.file-drop') && /orders\\.json/.test(document.querySelector('.file-drop').textContent)`, 'file picked');
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(n => n.textContent.trim() === 'Create project').click()`);
  const ordersId = await until(`(function(){ var p = (window.__p = window.__p || null); return MxStore.getAll('projects').then(function (rows) { var r = rows.find(function (x) { return x.name === 'Orders'; }); return r && MxStore.folderInfo(r.id) ? r.id : false; }); })()`, 'Orders created in a folder');
  const inside = await list('Mendix-app');
  t.ok(inside.indexOf('Orders') !== -1 && inside.indexOf('App.mpr') !== -1, 'the project is written into a folder named after it, beside the other files: ' + JSON.stringify(inside));
  t.ok(JSON.parse(await mx.evaluate(`window.__read('Mendix-app', 'Orders/project.json')`)).id === ordersId && !!(await mx.evaluate(`window.__read('Mendix-app', 'Orders/model.json')`)),
    'with its project.json and model.json');

  // ---- Open a project folder ----
  await mx.evaluate(`window.__pick('Mendix-app')`);
  await mx.evaluate(`window.MxFolderUI.openFolder()`);
  t.ok(/Mendix project folder without MxScout’s files/.test(await until(`(function(){ var m = document.querySelector('.msg.error'); return m && m.textContent; })()`, 'not a project')),
    'a Mendix project folder that is not an MxScout project folder is refused, saying why');
  // The decision about a risk again: the Undo above put back what triage.js held before that answer.
  await mx.evaluate(`MxStore.put('triage', { projectId: 'p1', updatedAt: '2026-10-15T08:00:00.000Z', risks: { 'r-1': { key: 'r-1', origin: 'ai', status: 'false-positive', note: 'Checked: only admins reach it.', by: 'Tester', at: '2026-10-15T08:00:00.000Z', risk: { level: 'P2', title: 'A flow nobody guards', where: [] }, history: [] } } }).then(function () { MxTriage.forget('p1'); return true; })`);
  await until(`window.__read('Demo-folder', 'triage.json').then(function (t) { return !!t; })`, 'triage.json again');
  // A copy of Demo's folder, as from git on another machine, under another id.
  await mx.evaluate(`(async function () {
    for (var f of ['project.json', 'model.json', 'descriptions.json', 'README.md', 'comments.json', 'triage.json']) {
      var text = await window.__read('Demo-folder', f);
      if (text === null) { window.__missing = (window.__missing || []).concat(f); continue; }
      if (f === 'project.json') { var p = JSON.parse(text); p.id = 'from-git'; p.name = 'Cloned demo'; text = JSON.stringify(p); }
      await window.__write('Cloned', f, text);
    }
    window.__pick('Cloned'); window.MxFolderUI.openFolder(); return true; })()`);
  t.ok(await until(`MxStore.get('projects', 'from-git').then(function (p) { return !!p && p.name === 'Cloned demo' && p.contentLanguage === 'pl'; })`, 'opened from the folder'),
    'Open a project folder… makes the folder’s project a project here — name, model and language');
  t.ok(await until(`MxStore.get('descriptions', 'from-git').then(function (r) { return !!r && !!r.value.microflows['Sales.CancelOrder']; })`, 'its descriptions'), 'with its descriptions');
  t.ok(await until(`MxStore.byIndex('findings', 'byProject', 'from-git').then(function (rows) { return rows.length === 1 && rows[0].problem === 'Cancels without asking.'; })`, 'its comments'),
    'its comments, merged in by id');
  t.ok(await until(`MxStore.get('triage', 'from-git').then(function (r) { return !!r && !!r.risks['r-1'] && r.risks['r-1'].status === 'false-positive'; })`, 'its triage'),
    'and what was decided about its risks');
  t.ok(await mx.evaluate(`!!MxStore.folderInfo('from-git') && MxStore.folderInfo('from-git').name === 'Cloned'`), 'and keeps it in that folder');
  // The same folder again: this browser has that project now.
  await mx.evaluate(`window.__pick('Cloned'); window.MxFolderUI.openFolder()`);
  await until(`!!document.querySelector('.folder-clash')`, 'asked');
  t.ok(await mx.evaluate(`['Link it', 'Open as a new project'].every(function (n) { return !!Array.from(document.querySelectorAll('.folder-clash button')).find(b => b.textContent === n); })`),
    'a folder holding a project this browser has asks: link it, or open it as a new project');
  await mx.evaluate(`Array.from(document.querySelectorAll('.folder-clash button')).find(b => b.textContent === 'Open as a new project').click()`);
  t.ok(await until(`MxStore.getAll('projects').then(function (rows) { return rows.filter(function (r) { return r.name === 'Cloned demo'; }).length === 2; })`, 'a second project'),
    'Open as a new project makes a second project, with an id of its own');
  t.ok(await until(`window.__read('Cloned', 'project.json').then(function (t) { return JSON.parse(t).id !== 'from-git'; })`, 'project.json re-keyed'), 'and project.json in the folder carries the new id');
  t.ok(await mx.evaluate(`!MxStore.folderInfo('from-git')`), 'the first one is no longer kept in that folder: one folder, one project');

  // ---- a package opened as a new project goes into a folder ----
  const pkg = await mx.evaluate(`(async function () {
    var code = MxCrypto.generateCode();
    var model = await MxStore.getModel('p1');
    var env = await MxCrypto.pack({ project: { name: 'Packed', createdAt: new Date().toISOString(), source: null }, model: model,
      descriptions: { importedAt: new Date().toISOString(), fileName: 'd.json', file: JSON.parse(${JSON.stringify(descFile({ language: 'pl' }))}) } }, code);
    return JSON.stringify({ code: code, text: JSON.stringify(env) }); })()`);
  const P = JSON.parse(pkg);
  await mx.evaluate(`window.__pick('Packed-folder'); MxTransfer.handlePickedFile('packed.mxscout', ${JSON.stringify(P.text)}, 'new', null)`);
  await until(`!!document.querySelector('.modal .code-input') && !!document.querySelector('.modal .store-opt[data-mode="folder"].on')`, 'the code, with the folder first');
  await mx.evaluate(`document.querySelector('.modal .store-pick').click()`);
  await until(`!!document.querySelector('.modal .store-picked')`, 'package folder picked');
  await mx.evaluate(`(function(){ var c = document.querySelector('.modal .code-input'); c.value = ${JSON.stringify(P.code)}; c.dispatchEvent(new Event('input')); Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Open').click(); return true; })()`);
  t.ok(await until(`window.__read('Packed-folder', 'descriptions.json').then(function (t) { return !!t && /Cancels an order/.test(t); })`, 'package written', 20000),
    'a package opened as a new project is written into the folder chosen for it, descriptions included');
  t.ok(!!(await read('Packed-folder', 'model.json')), 'with its model');

  // ---- Move all projects to folders: one parent, a folder each, one failing ----
  await mx.evaluate(`(async function () {
    var m = await MxStore.getModel('p1');
    for (var n of ['Alpha', 'Beta']) await MxStore.saveProjectWithModel({ id: 'mv-' + n, name: n, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: { kind: 'test' }, bytes: 1, summary: null }, m);
    return true; })()`);
  await mx.navigate(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxFolderUI', 15000, 'reloaded');
  await mx.evaluate(`(async function () { var root = await navigator.storage.getDirectory(); window.__root = root;
    MxFolder.test.picker = function () { return root.getDirectoryHandle('All', { create: true }); };
    MxFolder.test.failWrites = 'Beta/model.json'; return true; })()`);
  await until(`(function(){ var s = document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); var a = Array.from(document.querySelectorAll('button')).find(n => n.textContent.trim() === 'All projects'); if (a) a.click(); return !!document.querySelector('.project-list'); })()`, 'the list of projects');
  // Behind the projects page's ⋯ (home.js).
  await until(`(function(){ var m = document.querySelector('.home-head .xe-more .xe-icon-btn'); if (m && !document.querySelector('.home-head .xe-menu')) m.click(); return !!Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Move all projects to folders…'); })()`, 'Move all on the list');
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Move all projects to folders…').click()`);
  await until(`!!document.querySelector('.move-all')`, 'the dialog');
  t.ok(/another port keeps its own projects/.test(await mx.evaluate(`document.querySelector('.move-all').textContent`)), 'it says an MxScout on another port keeps and moves its own projects (separate browser databases)');
  await mx.evaluate(`Array.from(document.querySelectorAll('.move-all button')).find(b => b.textContent === 'Choose the folder…').click()`);
  const summary = await until(`(function(){ var s = document.querySelector('.move-summary'); return s && s.textContent; })()`, 'the summary', 30000);
  const rows = JSON.parse(await mx.evaluate(`JSON.stringify(Array.from(document.querySelectorAll('.move-row')).map(function (r) { return [r.querySelector('strong').textContent, r.getAttribute('data-state')]; }))`));
  const stateOf = (n) => (rows.find((r) => r[0] === n) || [])[1];
  t.ok(stateOf('Alpha') === 'done' && stateOf('Beta') === 'failed' && stateOf('Demo again') === 'skipped',
    'each project in turn: one moved, one failed, one already in a folder skipped: ' + JSON.stringify(rows));
  t.ok(/failed/.test(summary) && /already in a folder/.test(summary), 'and a summary at the end: ' + summary);
  t.ok(await mx.evaluate(`!!MxStore.folderInfo('mv-Alpha') && !MxStore.folderInfo('mv-Beta')`), 'the one that failed is not linked to a folder');
  t.ok(await mx.evaluate(`MxStore.getModel('mv-Beta').then(function (m) { return !!m && m.microflows.length > 0; })`), 'and is whole in this browser');
  t.ok(!!(await mx.evaluate(`(async function () { var d = await (await window.__root.getDirectoryHandle('All')).getDirectoryHandle('Alpha'); return await (await (await d.getFileHandle('model.json')).getFile()).text(); })()`)),
    'the one that moved has its own folder inside the one picked');
  await mx.evaluate(`MxFolder.test.failWrites = null`);

  // ---- leave nothing behind for the tests after this one: no folder links, none of these projects ----
  await mx.evaluate(`MxStore.getAll('projects').then(function (rows) { return Promise.all(rows.map(function (r) {
    var mine = ['Orders', 'Cloned demo', 'Packed', 'Alpha', 'Beta'].indexOf(r.name) !== -1;
    return (MxStore.hasFolder(r.id) ? MxStore.unlinkFolder(r.id) : Promise.resolve()).then(function () { return mine ? MxStore.deleteProjectDeep(r.id) : null; });
  })); }).then(function () { return Promise.all([MxStore.delete('findings', 'c-1'), MxStore.delete('triage', 'p1')]); })`);
  await mx.close();
};
