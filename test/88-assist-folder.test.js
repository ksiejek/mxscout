/* Assist items in a project's folder (assist.js toFiles/fromFiles/adoptFiles · store.js · folder.js · folderui.js).
 *
 * A project kept in a folder keeps its Assist items there too, one file per item at
 * assist/<tickets|jira|ideas|other>/<id>.json, written by MxScout after every save; an agent reads them
 * and hands changes back through inbox/, like a descriptions file. What has to hold: linking writes
 * them; a click rewrites the item's file; an Undo removes the file of the item it took back; an
 * Assist envelope dropped into inbox/ is taken (saved at once, moved to inbox/done/) and its item
 * written; a newer file in the folder wins when the project is opened; Open a project folder reads
 * them. As in test 85, the folders are the Origin Private File System's (MxFolder.test.picker). */
'use strict';
const MODEL = require('./model');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxAssist && !!window.MxFolder', 15000, 'MxScout loaded');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = (expr, what, ms) => mx.waitFor(expr, ms || 10000, what);
  const T1 = { id: 'AF-1', kind: 'ticket', title: 'Invoices print the wrong date', verdict: 'data-config', confidence: 'medium', summary: 'A setting decides it.',
    questions: [{ id: 'q1', text: 'Which invoice?', why: 'Two templates exist.' }], thread: [{ date: '2026-10-15', from: 'agent', text: 'Asked which invoice.' }], status: 'waiting' };
  const I1 = { id: 'af-idea', kind: 'idea', title: 'Print the date the invoice was sent', now: { summary: 'The creation date is printed.' }, proposal: { summary: 'Print the sent date.' } };
  const env = (items) => JSON.stringify({ format: 'mxscout-assist', version: 1, items: items });
  // Small readers and writers for the folder, in the page — installed again after every reload.
  const HELPERS = `(async function () {
    var root = await navigator.storage.getDirectory();
    window.__root = root;
    window.__walk = async function (p, create) {
      var parts = p.split('/'), name = parts.pop(), d = await root.getDirectoryHandle('AF-folder', { create: true });
      for (var j = 0; j < parts.length; j++) d = await d.getDirectoryHandle(parts[j], { create: !!create });
      return { d: d, name: name };
    };
    window.__read = async function (p) { try { var w = await window.__walk(p); return await (await (await w.d.getFileHandle(w.name)).getFile()).text(); } catch (e) { return null; } };
    window.__write = async function (p, text) { var w = await window.__walk(p, true); var wr = await (await w.d.getFileHandle(w.name, { create: true })).createWritable(); await wr.write(text); await wr.close(); return true; };
    window.__list = async function (p) { try { var w = await window.__walk(p + '/x'); var out = []; for (var it = w.d.keys(), r = await it.next(); !r.done; r = await it.next()) out.push(r.value); return out.sort(); } catch (e) { return []; } };
    return true; })()`;
  const helpers = () => mx.evaluate(HELPERS);
  await mx.evaluate(`navigator.storage.getDirectory().then(function (r) { return r.removeEntry('AF-folder', { recursive: true }).then(function () { return true; }, function () { return true; }); })`);
  await helpers();
  await mx.evaluate(`(async function () {
    var root = window.__root;
    var now = new Date().toISOString();
    await MxStore.saveProjectWithModel({ id: 'paf', name: 'AssistFolderDemo', createdAt: now, updatedAt: now, source: { kind: 'test' }, bytes: 1, summary: null }, ${JSON.stringify(MODEL)});
    await MxAssist.apply('paf', ${JSON.stringify(env([T1, I1]))});
    await MxStore.linkFolder('paf', await root.getDirectoryHandle('AF-folder', { create: true }));
    return true;
  })()`);
  const read = (p) => mx.evaluate(`window.__read(${JSON.stringify(p)})`);
  const list = (p) => mx.evaluate(`window.__list(${JSON.stringify(p)})`);

  // ---- linking writes one file per item ----
  const t1 = JSON.parse(await read('assist/tickets/AF-1.json') || 'null');
  const i1 = JSON.parse(await read('assist/ideas/af-idea.json') || 'null');
  t.ok(t1 && t1.id === 'AF-1' && t1.kind === 'ticket' && t1.status === 'waiting' && t1.questions[0].id === 'q1' && t1.thread.length === 1 && i1 && i1.kind === 'idea',
    'keeping a project in a folder writes its Assist items there, one file each, at assist/tickets/ and assist/ideas/');
  t.ok(/assist\//.test(await read('README.md')), 'README.md says what assist/ holds');

  // ---- open it, and a click rewrites the item's file ----
  await mx.navigate(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'reloaded');
  await helpers();
  const SW = "(function(q){var s=document.querySelector('.switcher[aria-expanded=\"false\"]'); if (s) s.click(); return document.querySelectorAll(q);})";
  await until(`!!Array.from(${SW}('.tree-project')).find(b => b.textContent.indexOf('AssistFolderDemo') !== -1)`, 'project');
  await mx.evaluate(`Array.from(${SW}('.tree-project')).find(b => b.textContent.trim().indexOf('AssistFolderDemo') === 0).click()`);
  await until(`MxStore.folderInfo('paf') && MxStore.folderInfo('paf').status === 'connected'`, 'the folder connected');
  await mx.evaluate(`MxAssist.set('paf', 'ticket', 'AF-1', { status: 'done' })`);
  t.ok(await until(`window.__read('assist/tickets/AF-1.json').then(function (x) { return !!x && JSON.parse(x).status === 'done'; })`, 'rewritten'),
    'closing an item rewrites its file');

  // ---- an agent's save writes a file; Undo takes it away again ----
  await mx.evaluate(`MxAssist.apply('paf', ${JSON.stringify(env([{ id: 'AF-2', kind: 'ticket', title: 'Taken back' }]))}).then(function (r) { window.__r = r; return true; })`);
  t.ok(await until(`window.__read('assist/tickets/AF-2.json').then(function (x) { return !!x; })`, 'AF-2 written'), 'an agent’s new item is written to the folder');
  await mx.evaluate(`MxAssist.undo('paf', window.__r)`);
  t.ok(await until(`window.__list('assist/tickets').then(function (l) { return l.indexOf('AF-2.json') === -1 && l.indexOf('AF-1.json') !== -1; })`, 'AF-2 removed'),
    'and Undo removes the file of the item it took back, the others left');
  // An item that is simply not in the record — not taken out on purpose — never loses its file (B07: a limit that
  // dropped items took their files with it).
  await mx.evaluate(`MxStore.get('assist', 'paf').then(function (r) { window.__full = JSON.parse(JSON.stringify(r)); r.items = r.items.filter(function (x) { return x.id !== 'AF-1'; }); return MxStore.put('assist', r); }).then(function () { return true; })`);
  await sleep(1200);
  t.ok((await list('assist/tickets')).indexOf('AF-1.json') !== -1, 'an item missing from the record without being taken out keeps its file in the folder');
  await mx.evaluate(`MxStore.put('assist', window.__full).then(function () { MxAssist.forget('paf'); return MxAssist.list('paf'); }).then(function () { return true; })`);

  // ---- an Assist envelope in inbox/ ----
  await mx.evaluate(`window.__write('inbox/assist-AF-3.json', ${JSON.stringify(env([{ id: 'AF-3', kind: 'ticket', title: 'Left in the inbox', status: 'open' }, { id: 'AF-1', kind: 'ticket', update: true, thread: [{ date: '2026-10-16', from: 'reporter', text: 'The March invoice.', answers: ['q1'] }] }]))})`);
  await sleep(1100);
  await mx.evaluate('MxDocs.folderTick()');
  await until(`(MxAssist.peek('paf') || []).some(function (x) { return x.id === 'AF-3'; })`, 'AF-3 taken');
  t.ok(await until(`Promise.all([window.__list('inbox'), window.__list('inbox/done')]).then(function (l) { return l[0].indexOf('assist-AF-3.json') === -1 && l[1].indexOf('assist-AF-3.json') !== -1; })`, 'moved to done'),
    'an Assist file dropped into inbox/ is taken at once and moved to inbox/done/');
  t.ok(await until(`Promise.all([window.__read('assist/tickets/AF-3.json'), window.__read('assist/tickets/AF-1.json')]).then(function (x) { return !!x[0] && JSON.parse(x[1]).thread.length === 2 && JSON.parse(x[1]).questions[0].status === 'answered'; })`, 'written'),
    'its new item is written to assist/, and the update to the item it names — the reporter’s answer appended, the question answered');
  t.ok(await until(`(function(){ var m = document.querySelector('.msg'); return !!m && /Saved what the agent left in the folder’s inbox: .*AF-3.* on the Assist page/.test(m.textContent) && !!m.querySelector('.msg-action'); })()`, 'said, with Undo'),
    'and says so, with Undo');

  // ---- a newer file in the folder wins when the project is opened ----
  await until(`MxStore.folderInfo('paf').pending.length === 0 && !MxStore.folderInfo('paf').writing`, 'everything written');
  await sleep(50);
  const edited = JSON.parse(await read('assist/ideas/af-idea.json'));
  edited.title = 'Print the date the invoice was sent — edited in the folder';
  await mx.evaluate(`window.__write('assist/ideas/af-idea.json', ${JSON.stringify(JSON.stringify(edited, null, 2))})`);
  await mx.navigate(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'reloaded');
  await helpers();
  t.ok(await until(`MxStore.get('assist', 'paf').then(function (r) { return !!r && r.items.some(function (x) { return x.id === 'af-idea' && /edited in the folder$/.test(x.title); }); })`, 'folder wins', 15000),
    'opening the project takes the newer Assist file from the folder');
  t.ok(await until(`(function(){ var m = document.querySelector('.msg'); return !!m && /Took an Assist item from the project’s folder — af-idea/.test(m.textContent); })()`, 'said'), 'and says so');

  // ---- Open a project folder reads them ----
  const opened = JSON.parse(await mx.evaluate(`window.__root.getDirectoryHandle('AF-folder').then(function (h) { return MxStore.readFolderProject(h); }).then(function (r) {
    return JSON.stringify(r.assist.map(function (f) { return f.path; }).sort()); })`));
  t.ok(opened.join() === 'assist/ideas/af-idea.json,assist/tickets/AF-1.json,assist/tickets/AF-3.json', 'reading a project folder reads its Assist files too: ' + opened.join());
  const back = JSON.parse(await mx.evaluate(`window.__root.getDirectoryHandle('AF-folder').then(function (h) { return MxStore.readFolderProject(h); }).then(function (r) {
    var f = MxAssist.fromFiles(r.assist); return JSON.stringify({ n: f.items.length, errors: f.errors.length }); })`));
  t.ok(back.n === 3 && back.errors === 0, 'and they read back as the items');
  await mx.close();
};
