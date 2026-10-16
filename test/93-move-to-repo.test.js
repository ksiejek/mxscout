/* A project already in this browser, moved into its Mendix project's mxscout/ (public/repoui.js startMove ·
 * folderui.js menuItem · docs.js Folder tab · store.js linkFolder/openFolder).
 *
 * Karol, 2026-10-15: a project kept in this browser only, or in a folder of its own (layout 1), could not
 * go into <MendixProject>/mxscout/ (layout 2) — the repo layout was offered on New project only. What has to
 * hold: from the project menu, a browser-only project with descriptions, an Assist item, a solved case, a
 * comment and a decision about a risk goes into mxscout/ — every file written (comments/ and triage.json too), the link layout 2, the Assist item only in .local/, the browser's
 * own data intact, the status line naming the model's version; from the Folder tab, a layout-1 project goes
 * there and its old folder is left exactly as it was; a mxscout/ holding the same project is linked and what
 * it holds wins, its comments merged with this browser's by id; one holding another project asks first, and Cancel changes nothing — Use theirs opens theirs
 * and keeps this one; a conflict there, or a folder with no .mpr, is refused and nothing moves; another
 * application's .mpr is said before anything is written. The suite cannot click a directory picker, so it
 * hands MxScout folders of the Origin Private File System (MxFolder.test.picker), as test 90 does. */
'use strict';
const fs = require('fs');
const path = require('path');
const { goToSection, goToDocsTab } = require('./helpers');

const A = 'a'.repeat(40);

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxRepoUI', 15000, 'MxScout loaded');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = (expr, what, ms) => mx.waitFor(expr, ms || 15000, what);
  const mprB64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const fmt = await mx.evaluate('MxDescribe.FORMAT');

  async function inject() {
    await mx.evaluate(`(async function () {
      var root = await navigator.storage.getDirectory();
      window.__walk = async function (p, create) {
        var parts = p.split('/'), name = parts.pop(), d = root;
        for (var j = 0; j < parts.length; j++) d = await d.getDirectoryHandle(parts[j], { create: !!create });
        return { d: d, name: name };
      };
      window.__dir = async function (p) { var d = root; var parts = p.split('/'); for (var j = 0; j < parts.length; j++) d = await d.getDirectoryHandle(parts[j], { create: true }); return d; };
      window.__read = async function (p) { try { var w = await window.__walk(p); var f = await (await w.d.getFileHandle(w.name)).getFile(); return await f.text(); } catch (e) { return null; } };
      window.__write = async function (p, data) {
        var w = await window.__walk(p, true);
        var wr = await (await w.d.getFileHandle(w.name, { create: true })).createWritable();
        await wr.write(data); await wr.close(); return true;
      };
      window.__writeB64 = function (p, b64) { var bin = atob(b64), u8 = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return window.__write(p, u8); };
      window.__list = async function (p) {
        try { var d = await window.__dir(p); var out = []; for (var it = d.keys(), r = await it.next(); !r.done; r = await it.next()) out.push(r.value); return out.sort(); } catch (e) { return null; }
      };
      window.__tree = async function (p) {
        var out = {};
        async function walk(d, at) {
          for (var it = d.entries(), r = await it.next(); !r.done; r = await it.next()) {
            var name = r.value[0], h = r.value[1], rel = at ? at + '/' + name : name;
            if (h.kind === 'directory') await walk(h, rel);
            else { var f = await h.getFile(); out[rel] = { at: f.lastModified, text: name.slice(-4) === '.mpr' ? '' : await f.text() }; }
          }
        }
        await walk(await window.__dir(p), '');
        return out;
      };
      window.__pick = function (p) { MxFolder.test.picker = function () { return window.__dir(p); }; };
      window.__mendix = async function (name) {
        await window.__writeB64(name + '/' + name + '.mpr', ${JSON.stringify(mprB64)});
        await window.__write(name + '/.git/HEAD', 'ref: refs/heads/main\\n');
        await window.__write(name + '/.git/refs/heads/main', '${A}\\n');
        await window.__write(name + '/.git/logs/HEAD', '${'0'.repeat(40)} ${A} S <s@x> 1760500000 +0200\\tcommit (initial): First version\\n');
        return true;
      };
      return true;
    })()`);
  }
  await inject();
  const tree = (p) => mx.evaluate(`window.__tree(${JSON.stringify(p)})`);
  const read = (p) => mx.evaluate(`window.__read(${JSON.stringify(p)})`);
  const list = (p) => mx.evaluate(`window.__list(${JSON.stringify(p)})`);
  const stamps = (tr) => JSON.stringify(Object.keys(tr).sort().map((k) => [k, tr[k].at, tr[k].text.length]));

  // ---- the Mendix projects, and the projects in this browser ----
  const desc = (text) => JSON.stringify({ format: fmt, version: 1, project: 'Sales', language: 'en', by: 'test agent', written: '2026-10-15',
    app: { summary: 'Takes orders.', processes: [{ name: 'Order to cash', summary: 'From an order to its payment.', steps: ['Order'], flows: ['Sales.CreateOrder'] }] },
    modules: { Sales: { summary: 'Sales holds the orders.' } }, microflows: { 'Sales.CreateOrder': text } });
  const note = ['---', 'id: "MV-7"', 'kind: "ticket"', 'title: "Orders created twice"', 'status: "solved"', 'solved: "2026-10-15"', 'model: null',
    'flows: ["Sales.CreateOrder"]', 'entities: []', 'pages: []', 'keywords: ["duplicate"]', 'related: []', 'language: "en"', '---', '', '# MV-7 — Orders created twice', '',
    '## Problem', '', 'Every new order showed twice.', '', '## Cause', '', 'The flow `Sales.CreateOrder` commits twice.', '', '## Solution', '', '- Commit once.', '',
    '## What did not work', '', 'Hiding it on the page.', '', '## How to recognise it next time', '', 'Two rows per order.', ''].join('\n');
  await mx.evaluate(`(async function () {
    var root = await navigator.storage.getDirectory();
    var names = [];
    for (var it = root.keys(), r = await it.next(); !r.done; r = await it.next()) names.push(r.value);
    for (var i = 0; i < names.length; i++) await root.removeEntry(names[i], { recursive: true });
    var all = await MxStore.getAll('projects');
    for (var k = 0; k < all.length; k++) { await MxStore.unlinkFolder(all[k].id); await MxStore.deleteProjectDeep(all[k].id); }
    var names2 = ['OrderPortal', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'];
    for (var n = 0; n < names2.length; n++) await window.__mendix(names2[n]);
    await window.__write('NoMpr/readme.txt', 'not a Mendix project\\n');
    // The model, as a project kept in this browser has it: read from the .mpr once, with no git (its version unknown).
    var read = await MxMprImport.readModel(await window.__dir('OrderPortal'));
    var model = read.model; delete model.version;
    var other = JSON.parse(JSON.stringify(model)); other.modules = [{ name: 'Billing', fromAppStore: false }, { name: 'People', fromAppStore: false }];
    var now = new Date().toISOString();
    var mk = function (id, name, m) { return MxStore.saveProjectWithModel({ id: id, name: name, createdAt: now, updatedAt: now, source: { kind: 'mpr' }, bytes: 1, summary: null }, m || model); };
    await mk('mv1', 'Moving'); await mk('mv2', 'Standalone'); await mk('mv3', 'SameId'); await mk('mv4', 'Mine'); await mk('mv6', 'OtherApp', other);
    var d = function (text) { return { projectId: null, importedAt: now, fileName: 'test', value: MxDescribe.parse(${JSON.stringify(desc('X'))}.replace('"X"', JSON.stringify(text))).value }; };
    var put = function (id, text) { var r = d(text); r.projectId = id; return MxStore.put('descriptions', r); };
    await put('mv1', 'Creates an order, as this browser has it.');
    await put('mv2', 'Creates an order, from the standalone folder.');
    await put('mv3', 'Creates an order, as this browser wrote it.');
    await put('mv4', 'Mine, and only mine.');
    await MxAssist.apply('mv1', JSON.stringify({ format: 'mxscout-assist', version: 1, items: [{ id: 'MV-1', kind: 'ticket', title: 'A ticket that stays on this machine' }] }));
    await MxAssist.apply('mv3', JSON.stringify({ format: 'mxscout-assist', version: 1, items: [{ id: 'MV-3', kind: 'ticket', title: 'Only in this browser' }] }));
    // Developer tools: a comment and a decision about a risk, on mv1; a comment of this browser's own on mv3.
    var comment = function (id, pid, problem) { return { id: id, projectId: pid, target: { kind: 'microflow', qualifiedName: 'Sales.CreateOrder' }, severity: 'high', problem: problem, change: null, status: 'open', author: 'Tester', history: [], createdAt: '2026-10-15T08:00:00.000Z', updatedAt: '2026-10-15T08:00:00.000Z' }; };
    await MxStore.put('findings', comment('c-mv1', 'mv1', 'Creates without a check.'));
    await MxStore.put('triage', { projectId: 'mv1', updatedAt: '2026-10-15T08:00:00.000Z', risks: { 'r-1': { key: 'r-1', origin: 'ai', status: 'false-positive', note: 'Only admins reach it.', by: 'Tester', at: '2026-10-15T08:00:00.000Z', risk: { level: 'P2', title: 'Sweep deletes every order', where: ['Sales.SweepOrders'] }, history: [] } } });
    await MxStore.put('findings', comment('c-mine', 'mv3', 'Only this browser has it.'));
    var team = comment('c-team', null, 'The team wrote it.'); delete team.projectId;
    await window.__write('Third/mxscout/comments/c-team.json', JSON.stringify(team, null, 2) + '\\n');
    await MxKnowledge.takeFromPackage('mv1', [{ path: 'knowledge/MV-7-orders-created-twice.md', text: ${JSON.stringify(note)} }]);
    // Standalone is kept in a folder of its own (layout 1).
    await MxStore.linkFolder('mv2', await window.__dir('Standalone-folder'));
    // Third's mxscout/ holds the same project, as a teammate committed it; Fourth's another one; Fifth's a conflict.
    var theirs = MxDescribe.parse(${JSON.stringify(desc('X'))}.replace('"X"', JSON.stringify('Creates an order, as the team wrote it.'))).value;
    var parts = MxRepoDocs.split(MxDescribe.toFile(theirs));
    await window.__write('Third/mxscout/mxscout.json', JSON.stringify({ format: 'mxscout-project', layout: 2, id: 'mv3', name: 'SameId', contentLanguage: 'en', describedAt: null }, null, 2) + '\\n');
    for (var p = 0; p < parts.length; p++) await window.__write('Third/mxscout/' + parts[p].path, parts[p].text);
    await window.__write('Fourth/mxscout/mxscout.json', JSON.stringify({ format: 'mxscout-project', layout: 2, id: 'someone-else', name: 'TheirPortal', contentLanguage: 'en', describedAt: null }, null, 2) + '\\n');
    await window.__write('Fifth/mxscout/mxscout.json', JSON.stringify({ format: 'mxscout-project', layout: 2, id: 'mv4', name: 'Mine', contentLanguage: 'en', describedAt: null }, null, 2) + '\\n');
    await window.__write('Fifth/mxscout/descriptions/risks.json', '[\\n<<<<<<< HEAD\\n  {"level": "P2"}\\n=======\\n  {"level": "P1"}\\n>>>>>>> teammate\\n]\\n');
    return true;
  })()`);
  await until(`window.__list('Standalone-folder').then(function (l) { return !!l && l.indexOf('descriptions.json') !== -1; })`, 'the standalone folder written');

  const SW = "(function(q){var s=document.querySelector('.switcher[aria-expanded=\"false\"]'); if (s) s.click(); return document.querySelectorAll(q);})";
  async function open(name) {
    await mx.evaluate(`(function(){ var b = Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'All projects'); if (b) b.click(); return true; })()`);
    await until(`!!Array.from(${SW}('button,a')).find(n => n.textContent.trim() === ${JSON.stringify(name)})`, name + ' in the list');
    await mx.evaluate(`(function(){ var e = Array.from(${SW}('button,a')).filter(n => n.textContent.trim() === ${JSON.stringify(name)}); e[e.length-1].click(); return true; })()`);
    await until(`!!document.querySelector('.xe-head .xe-icon-btn')`, name + ' open');
  }
  async function startFor(id) {
    await mx.evaluate(`MxStore.get('projects', ${JSON.stringify(id)}).then(function (p) { MxRepoUI.startMove(p); return true; })`);
    await until(`!!document.querySelector('.modal.repo-move .repo-move-pick')`, 'the dialog');
  }
  const pickIn = async (dir) => { await mx.evaluate(`window.__pick(${JSON.stringify(dir)}); document.querySelector('.repo-move-pick').click()`); };
  await mx.navigate(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'reloaded');
  await inject();

  // ---- a browser-only project, from the project menu ----
  await open('Moving');
  await mx.evaluate(`document.querySelector('.xe-head .xe-icon-btn').click()`);
  await until(`!!Array.from(document.querySelectorAll('.xe-menu button')).find(b => b.textContent === 'Keep in the Mendix project (mxscout/)…')`, 'the menu entry');
  const items = await mx.evaluate(`Array.from(document.querySelectorAll('.xe-menu button')).map(b => b.textContent).join(' | ')`);
  t.ok(/Keep in a folder… \| Keep in the Mendix project \(mxscout\/\)…/.test(items), 'the project menu offers Keep in the Mendix project (mxscout/)… beside Keep in a folder…: ' + items);
  await mx.evaluate(`Array.from(document.querySelectorAll('.xe-menu button')).find(b => b.textContent === 'Keep in the Mendix project (mxscout/)…').click()`);
  await until(`!!document.querySelector('.modal.repo-move .repo-move-pick')`, 'the dialog');
  const intro = JSON.parse(await mx.evaluate(`JSON.stringify({ text: document.querySelector('.modal.repo-move').textContent, tick: document.querySelector('.modal.repo-move .repo-skills-choice').checked })`));
  t.ok(/shared with your team through the app’s own git/.test(intro.text) && /Assist items stay on this machine, in mxscout\/\.local\//.test(intro.text) && /never runs git/.test(intro.text) && intro.tick &&
    /Add the Claude skills to this project \(\.claude\/skills\) — teammates get them with the next pull/.test(intro.text),
    'the dialog says what goes where, and offers the Claude skills ticked, as New project does');

  // a folder without a .mpr: refused, nothing moves
  await pickIn('NoMpr');
  const noMpr = await until(`(function(){ var e = document.querySelector('.repo-move-error'); return e && e.textContent; })()`, 'refused');
  t.ok(/no \.mpr directly inside it/.test(noMpr) && /unchanged/.test(noMpr), 'a folder with no .mpr is refused, plainly: ' + noMpr);
  t.ok(await mx.evaluate(`!MxStore.folderInfo('mv1')`) && JSON.stringify(await list('NoMpr')) === '["readme.txt"]', 'and nothing is linked or written');

  await pickIn('OrderPortal');
  await until(`!!MxStore.folderInfo('mv1') && MxStore.folderInfo('mv1').layout === 2`, 'linked, layout 2', 30000);
  await until(`!document.querySelector('.modal.repo-move')`, 'the dialog closed');
  const said1 = await until(`(function(){ var m = document.querySelector('.msg'); return m && /Moved "Moving"/.test(m.textContent) && m.textContent; })()`, 'said');
  t.ok(/into OrderPortal\/mxscout\/, with the Claude skills in \.claude\/skills\/ — commit it/.test(said1), 'said: ' + said1);
  await until(`window.__read('OrderPortal/mxscout/docs/manifest.json').then(function (t) { return !!t; })`, 'docs/ written');
  const t1 = await tree('OrderPortal');
  const keys = Object.keys(t1);
  const want = ['mxscout/mxscout.json', 'mxscout/AGENTS.md', 'mxscout/README.md', 'mxscout/GUIDE.md', 'mxscout/GUIDE.html', 'mxscout/.gitignore', 'mxscout/descriptions/app.json', 'mxscout/descriptions/modules/Sales.json',
    'mxscout/docs/index.md', 'mxscout/docs/manifest.json', 'mxscout/knowledge/MV-7-orders-created-twice.md', 'mxscout/.local/model.json', 'mxscout/.local/documentation.md', 'mxscout/.local/ai-pack.md',
    'mxscout/.local/assist/tickets/MV-1.json', '.claude/skills/mendix-describe/VERSION', '.claude/skills/mendix-assist/VERSION', 'mxscout/comments/c-mv1.json', 'mxscout/triage.json'];
  t.ok(want.every((k) => keys.indexOf(k) !== -1), 'every file is written — mxscout.json, AGENTS/README/GUIDE (.md and .html), .gitignore, descriptions/, docs/, knowledge/, .local/ with the model, the pack and assist/, the skills: missing ' + JSON.stringify(want.filter((k) => keys.indexOf(k) === -1)));
  t.ok(JSON.parse(t1['mxscout/mxscout.json'].text).id === 'mv1' && /as this browser has it/.test(t1['mxscout/descriptions/modules/Sales.json'].text) && t1['mxscout/knowledge/MV-7-orders-created-twice.md'].text === note,
    'mxscout/ holds THIS project: its id, its descriptions, its solved case');
  t.ok(JSON.parse(t1['mxscout/comments/c-mv1.json'].text).problem === 'Creates without a check.' && JSON.parse(t1['mxscout/triage.json'].text).triage.risks['r-1'].status === 'false-positive',
    'Developer tools: the comment into mxscout/comments/, what was decided about the risk into mxscout/triage.json');
  t.ok(!keys.some((k) => /^mxscout\/assist\//.test(k)) && !keys.some((k) => /MV-1/.test(k) && !/^mxscout\/\.local\//.test(k)), 'the Assist item is only in .local/, never in the committed part');
  t.ok(await mx.evaluate(`(async function () {
    var d = await MxStore.get('descriptions', 'mv1'), a = await MxStore.get('assist', 'mv1'), k = await MxStore.get('knowledge', 'mv1');
    return /as this browser has it/.test(d.value.microflows['Sales.CreateOrder'].text) && a.items.length === 1 && a.items[0].id === 'MV-1' && k.files.length === 1;
  })()`), 'and this browser’s own copy is intact: the descriptions, the Assist item, the case');
  await goToSection(mx, 'Documentation', '.repo-status');
  const line = await mx.evaluate(`document.querySelector('.repo-status-line').textContent`);
  t.ok(/^Model main @ aaaaaaa · /.test(line), 'the status line names the model’s version, read from the Mendix project’s git: ' + line);
  t.ok(await mx.evaluate(`MxStore.getModel('mv1').then(function (m) { return m.version && m.version.commit === '${A}' && m.modules.length === 1; })`), 'the project kept its model, stamped with that version');

  // ---- a layout-1 project, from the Folder tab: the old folder is left as it was ----
  await open('Standalone');
  // Opening a project kept in a folder writes what it derives into that folder — documentation.md and
  // ai-pack.md — a second or so later. That is the project being opened, not moved, so the folder is
  // read as it is once they are there: what the move must leave alone. The picture used to be taken
  // before opening, and on a slow machine (the audit's Windows run, 2026-10-15) those two files landed
  // before the move and read as the move writing into the old folder.
  await until(`window.__list('Standalone-folder').then(function (l) { return !!l && l.indexOf('documentation.md') !== -1 && l.indexOf('ai-pack.md') !== -1; })`, 'what opening it derives, written into its folder');
  const standalone0 = await tree('Standalone-folder');
  await goToDocsTab(mx, 'folder', '.docs-folder-repo');
  await mx.evaluate(`document.querySelector('.docs-folder-repo').click()`);
  await until(`!!document.querySelector('.modal.repo-move .repo-move-pick')`, 'the dialog, from the Folder tab');
  t.ok(/Its folder Standalone-folder is left as it is/.test(await mx.evaluate(`document.querySelector('.modal.repo-move').textContent`)), 'the dialog says the old folder stays');
  await pickIn('Second');
  await until(`!!MxStore.folderInfo('mv2') && MxStore.folderInfo('mv2').layout === 2`, 'mv2 linked', 30000);
  const said2 = await until(`(function(){ var m = document.querySelector('.msg'); return m && /Moved "Standalone"/.test(m.textContent) && m.textContent; })()`, 'said');
  t.ok(/Your old folder Standalone-folder is left as it was; delete it when you no longer need it\./.test(said2), 'said, with the old folder: ' + said2);
  t.ok(/from the standalone folder/.test(await read('Second/mxscout/descriptions/modules/Sales.json') || ''), 'its descriptions are in Second/mxscout/');
  await sleep(800);
  t.ok(stamps(await tree('Standalone-folder')) === stamps(standalone0), 'and its old folder is untouched — not one file written or removed');

  // ---- mxscout/ holding the same project: linked, what it holds wins ----
  await startFor('mv3');
  await pickIn('Third');
  await until(`!!MxStore.folderInfo('mv3') && MxStore.folderInfo('mv3').layout === 2`, 'mv3 linked', 30000);
  t.ok(await until(`MxStore.get('descriptions', 'mv3').then(function (r) { return /as the team wrote it/.test(r.value.microflows['Sales.CreateOrder'].text); })`, 'theirs taken', 20000),
    'mxscout/ holding the same project: linked, and what it holds wins for the descriptions');
  t.ok(await until(`(function(){ var m = document.querySelector('.msg'); return m && /Took mxscout\\/descriptions\\//.test(m.textContent) && !!Array.from(m.querySelectorAll('button')).find(function (b) { return b.textContent === 'Undo'; }); })()`, 'with Undo'),
    'taken with Undo');
  t.ok(await until(`window.__read('Third/mxscout/.local/assist/tickets/MV-3.json').then(function (t) { return !!t; })`, 'assist written', 15000) &&
    /as the team wrote it/.test(await read('Third/mxscout/descriptions/modules/Sales.json')), 'what only this browser had (its Assist item) is written into .local/; the team’s descriptions stay');
  t.ok(await until(`MxStore.byIndex('findings', 'byProject', 'mv3').then(function (r) { return r.map(function (c) { return c.id; }).sort().join() === 'c-mine,c-team'; })`, 'comments merged', 15000) &&
    await until(`window.__read('Third/mxscout/comments/c-mine.json').then(function (t) { return !!t; })`, 'c-mine written', 15000) && !!(await read('Third/mxscout/comments/c-team.json')),
    'Developer tools: the comments merge by id — the team’s taken in here, this browser’s written into comments/');

  // ---- mxscout/ holding another project: asked, Cancel changes nothing ----
  const fourth0 = stamps(await tree('Fourth'));
  await startFor('mv4');
  await pickIn('Fourth');
  const asked = await until(`(function(){ var e = document.querySelector('.repo-move-theirs'); return e && e.textContent; })()`, 'asked', 30000);
  t.ok(/This Mendix project’s mxscout\/ already holds "TheirPortal"/.test(asked) && await mx.evaluate(`!!Array.from(document.querySelectorAll('.modal.repo-move button')).find(b => b.textContent === 'Use theirs')`),
    'another project in mxscout/: asked first — Use theirs / Cancel: ' + asked);
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal.repo-move button')).find(b => b.textContent === 'Cancel').click()`);
  await until(`!document.querySelector('.modal.repo-move')`, 'closed');
  await sleep(500);
  t.ok(await mx.evaluate(`!MxStore.folderInfo('mv4')`) && stamps(await tree('Fourth')) === fourth0 && await mx.evaluate(`MxStore.get('projects', 'someone-else').then(function (p) { return !p; })`),
    'Cancel changes nothing: not linked, nothing written in Fourth/, no new project');
  await startFor('mv4');
  await pickIn('Fourth');
  await until(`!!document.querySelector('.repo-move-theirs')`, 'asked again', 30000);
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal.repo-move button')).find(b => b.textContent === 'Use theirs').click()`);
  t.ok(await until(`MxStore.get('projects', 'someone-else').then(function (p) { return !!p && !!MxStore.folderInfo(p.id) && MxStore.folderInfo(p.id).layout === 2; })`, 'theirs opened', 30000),
    'Use theirs: their project opens here, kept in Fourth/mxscout/');
  t.ok(await mx.evaluate(`Promise.all([MxStore.get('projects', 'mv4'), MxStore.get('descriptions', 'mv4')]).then(function (b) { return !!b[0] && !MxStore.folderInfo('mv4') && /only mine/.test(b[1].value.microflows['Sales.CreateOrder'].text); })`) &&
    JSON.parse(await read('Fourth/mxscout/mxscout.json')).id === 'someone-else',
    'and this browser’s project stays as it was, separate, with its descriptions — mxscout/ is not written over');
  t.ok(/Your project "Mine" stays in this browser as it was/.test(await until(`(function(){ var m = document.querySelector('.msg'); return m && /stays in this browser/.test(m.textContent) && m.textContent; })()`, 'said')), 'and says so');

  // ---- a git conflict in mxscout/: refused ----
  const fifth0 = stamps(await tree('Fifth'));
  await startFor('mv4');
  await pickIn('Fifth');
  const conflict = await until(`(function(){ var e = document.querySelector('.repo-move-error'); return e && e.textContent; })()`, 'refused');
  t.ok(/mxscout\/ has a git conflict in mxscout\/descriptions\/risks\.json/.test(conflict) && /unchanged/.test(conflict), 'a git conflict in mxscout/ is refused: ' + conflict);
  t.ok(await mx.evaluate(`!MxStore.folderInfo('mv4')`) && stamps(await tree('Fifth')) === fifth0, 'and nothing is linked or written');
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal.repo-move button')).find(b => b.textContent === 'Cancel').click()`);

  // ---- another application's .mpr: said before anything is written ----
  await startFor('mv6');
  await pickIn('Sixth');
  const differs = await until(`(function(){ var e = document.querySelector('.repo-move-differs'); return e && e.textContent; })()`, 'warned', 30000);
  t.ok(/Sixth\.mpr looks like another application: 0 of this project’s 2 modules are in it, and it has 1\./.test(differs),
    'another application’s .mpr is said first: ' + differs);
  t.ok(JSON.stringify(await list('Sixth')) === JSON.stringify(['.git', 'Sixth.mpr']), 'and nothing is written until the person says so');
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal.repo-move button')).find(b => b.textContent === 'Move anyway').click()`);
  await until(`!!MxStore.folderInfo('mv6') && MxStore.folderInfo('mv6').layout === 2`, 'mv6 linked', 30000);
  t.ok(await mx.evaluate(`MxStore.getModel('mv6').then(function (m) { return m.modules.length === 1 && m.modules[0].name === 'Sales' && m.version.commit === '${A}'; })`), 'Move anyway: the model is the .mpr’s');

  // ---- the same application, another snapshot: never "content A + commit B" (an external audit, B06) ----
  // This browser's model A has the same modules as the .mpr beside mxscout/ — B — but other logic: an attribute's
  // type changed. The same module names make it the same application; they say nothing about the snapshot.
  const kept7 = await mx.evaluate(`(async function () {
    await window.__mendix('Seventh');
    var b = (await MxMprImport.readModel(await window.__dir('Seventh'))).model;
    var a = JSON.parse(JSON.stringify(b)); delete a.version;
    var ent = a.entities.filter(function (e) { return e.attributes && e.attributes.length; })[0];
    ent.attributes[0].type = ent.attributes[0].type === 'String' ? 'Integer' : 'String';
    var now = new Date().toISOString();
    await MxStore.saveProjectWithModel({ id: 'mv7', name: 'Snapshot', createdAt: now, updatedAt: now, source: { kind: 'mpr' }, bytes: 1, summary: null }, a);
    window.__changed = { entity: ent.qualifiedName, type: ent.attributes[0].type, was: b.entities.filter(function (e) { return e.qualifiedName === ent.qualifiedName; })[0].attributes[0].type };
    return JSON.stringify(window.__changed);
  })()`);
  const ch7 = JSON.parse(kept7);
  t.ok(ch7.type !== ch7.was && JSON.stringify(await mx.evaluate(`MxStore.getModel('mv7').then(function (m) { return m.modules.map(function (x) { return x.name; }); })`)) === JSON.stringify(['Sales']),
    'a project whose model has the same modules as Seventh.mpr and other logic: ' + kept7);
  await mx.navigate(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'reloaded');
  await inject();
  await open('Snapshot');
  await startFor('mv7');
  await pickIn('Seventh');
  await until(`!!MxStore.folderInfo('mv7') && MxStore.folderInfo('mv7').layout === 2`, 'mv7 linked', 30000);
  const said7 = await until(`(function(){ var m = document.querySelector('.msg'); return m && /Moved "Snapshot"/.test(m.textContent) && m.textContent; })()`, 'said');
  const model7 = JSON.parse(await mx.evaluate(`MxStore.getModel('mv7').then(function (m) { var e = m.entities.filter(function (x) { return x.qualifiedName === ${JSON.stringify(ch7.entity)}; })[0]; return JSON.stringify({ type: e.attributes[0].type, commit: m.version && m.version.commit || null }); })`));
  t.ok(model7.type === ch7.type && model7.commit !== A, 'moved: the model is still A — its own logic — and it does NOT carry the .mpr’s commit: ' + JSON.stringify(model7));
  t.ok(/Its model is still the one this browser had \(version unknown\): Seventh\.mpr there is another snapshot of the same application — press Re-read/.test(said7), 'and the message says the .mpr there is another snapshot, and how to take it: ' + said7);
  await open('Snapshot');
  await goToSection(mx, 'Documentation', '.repo-status');
  const st7 = await until(`(function(){ var d = document.querySelector('.repo-status-differs'); return d && d.textContent; })()`, 'the status says so');
  t.ok(/not the one in Seventh\.mpr — that is another snapshot of the same application\. Re-read takes it\./.test(st7) &&
    await mx.evaluate(`document.querySelector('.repo-status').getAttribute('data-up-to-date') === 'false' && !/aaaaaaa/.test(document.querySelector('.repo-status-line').textContent)`),
    'the status line names no commit for it, and says the .mpr beside is another snapshot: ' + st7);
  await mx.evaluate(`document.querySelector('.repo-reread').click()`);
  await until(`MxStore.getModel('mv7').then(function (m) { return !!m.version && m.version.commit === '${A}'; })`, 're-read', 30000);
  t.ok(await mx.evaluate(`MxStore.getModel('mv7').then(function (m) { var e = m.entities.filter(function (x) { return x.qualifiedName === ${JSON.stringify(ch7.entity)}; })[0]; return e.attributes[0].type === ${JSON.stringify(ch7.was)}; })`) &&
    await until(`!document.querySelector('.repo-status-differs') && /^Model main @ aaaaaaa/.test((document.querySelector('.repo-status-line') || {}).textContent || '')`, 'the note gone'),
    'Re-read takes B — its own logic, with its own commit — and the note is gone');
};
