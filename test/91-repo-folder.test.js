/* A project kept inside the Mendix project, in mxscout/ (public/repodocs.js · repoui.js · store.js · folder.js).
 *
 * Karol, 2026-10-15: a team keeps MxScout's files in the app's own git. The suite cannot click a
 * directory picker, so it hands MxScout a folder of the Origin Private File System as the Mendix
 * project (window.showDirectoryPicker answered with it): the v1 .mpr fixture, a fake .git and a
 * javasource/ file that must stay untouched. What has to hold: New project offers it first; the
 * layout is written (mxscout.json, README.md, AGENTS.md, .gitignore, .local/), and nothing outside
 * mxscout/; descriptions split into small files that join back exactly; docs/ by topic with front
 * matter and a manifest, written only when the descriptions change — never when the model is read
 * again; the status line in both states; a newer file wins, with Undo; git's conflict markers are
 * shown, not overwritten, and a side can be kept; a second browser links the committed project at
 * once and writes nothing shared; agent.js, check-descriptions.js and check-assist.js on the layout;
 * and the documentation engine in Node writes byte-identical docs/. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { goToSection, goToDocsTab, readText } = require('./helpers');

const A = 'a'.repeat(40), B = 'b'.repeat(40);

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'MxScout loaded');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = (expr, what, ms) => mx.waitFor(expr, ms || 12000, what);
  const mprB64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');

  // Small readers and writers for the OPFS, in the page — again after every reload.
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
      // Every file under a folder, with its text and date — .local/ left out unless asked for.
      window.__tree = async function (p, withLocal) {
        var out = {};
        async function walk(d, at) {
          for (var it = d.entries(), r = await it.next(); !r.done; r = await it.next()) {
            var name = r.value[0], h = r.value[1], rel = at ? at + '/' + name : name;
            if (h.kind === 'directory') { if (name === '.local' && !withLocal) continue; await walk(h, rel); }
            else { var f = await h.getFile(); out[rel] = { at: f.lastModified, text: await f.text() }; }
          }
        }
        await walk(await window.__dir(p), '');
        return out;
      };
      window.showDirectoryPicker = function () { return window.__dir('OrderPortal'); };
      return true;
    })()`);
  }
  await inject();
  // The OPFS emptied, and a Mendix project in it: the .mpr, a .git on main @ aaaaaaa, a javasource/ file.
  await mx.evaluate(`(async function () {
    var root = await navigator.storage.getDirectory();
    var names = [];
    for (var it = root.keys(), r = await it.next(); !r.done; r = await it.next()) names.push(r.value);
    for (var i = 0; i < names.length; i++) await root.removeEntry(names[i], { recursive: true });
    await window.__writeB64('OrderPortal/OrderPortal.mpr', ${JSON.stringify(mprB64)});
    await window.__write('OrderPortal/.git/HEAD', 'ref: refs/heads/main\\n');
    await window.__write('OrderPortal/.git/refs/heads/main', '${A}\\n');
    await window.__write('OrderPortal/.git/logs/HEAD', '${'0'.repeat(40)} ${A} Someone <s@example.com> 1760500000 +0200\\tcommit (initial): First version\\n');
    await window.__write('OrderPortal/javasource/Keep.java', 'class Keep {}\\n');
    // Claude Code's own folder, with what is not MxScout's: it must stay exactly as it is.
    await window.__write('OrderPortal/.claude/settings.json', '{ "permissions": {} }\\n');
    await window.__write('OrderPortal/.claude/skills/someone-elses/SKILL.md', '# not ours\\n');
    return true;
  })()`);
  const tree = (p, withLocal) => mx.evaluate(`window.__tree(${JSON.stringify(p)}, ${!!withLocal})`);
  const read = (p) => mx.evaluate(`window.__read(${JSON.stringify(p)})`);
  const write = (p, text) => mx.evaluate(`window.__write(${JSON.stringify(p)}, ${JSON.stringify(text)})`);
  const list = (p) => mx.evaluate(`window.__list(${JSON.stringify(p)})`);
  const outside0 = await tree('OrderPortal');
  const stamps = (tr) => JSON.stringify(Object.keys(tr).sort().map((k) => [k, tr[k].at]));
  const tick = async () => { await mx.evaluate('MxDocs.folderTick()'); };

  // ---- New project: the Mendix project first, as the default ----
  await mx.evaluate(`(function(){ var b = Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'All projects'); if (b) b.click(); return true; })()`);
  await until(`!!document.querySelector('.sidebar-new')`, 'list screen');
  await mx.evaluate(`document.querySelector('.sidebar-new').click()`);
  await until(`!!document.querySelector('.store-opt[data-mode="repo"].on')`, 'the Mendix project option, chosen');
  const card = JSON.parse(await mx.evaluate(`JSON.stringify({ first: document.querySelectorAll('.store-opt')[0].textContent, hint: Array.from(document.querySelectorAll('.new-project .hint')).map(function (h) { return h.textContent; }).join(' '),
    fileBox: !!document.querySelector('.new-project .file-drop'), note: !!document.querySelector('.repo-file-note') })`));
  t.ok(/In the Mendix project \(mxscout\/\) — recommended/.test(card.first) && /shared with your team through the app’s own git/i.test(card.first),
    'New project offers “In the Mendix project (mxscout/)” first, as the default: ' + card.first);
  t.ok(/kept in mxscout\/ inside the Mendix project/.test(card.hint) && /never runs git/.test(card.hint), 'and says where it goes, and that MxScout never runs git');
  t.ok(!card.fileBox && card.note, 'a JSON model or a package, which has no Mendix project beside it, is not offered there — the card says why');
  await mx.evaluate(`document.querySelector('.folder-pick').click()`);
  const ready = await until(`(function(){ var n = document.querySelector('.repo-ready'); return n && n.textContent; })()`, 'the ready step');
  t.ok(/Kept in OrderPortal\/mxscout\/ — shared with your team through git/.test(ready), 'the import says where it will be kept: ' + ready);
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Import').click()`);
  const id = await until(`MxStore.getAll('projects').then(function (rows) { var r = rows.find(function (x) { var i = MxStore.folderInfo(x.id); return i && i.layout === 2; }); return r ? r.id : false; })`, 'the project, kept in the Mendix project', 30000);
  await until(`window.__list('OrderPortal/mxscout/.local').then(function (l) { return !!l && ['ai-pack.md', 'documentation.md', 'inbox', 'model.json'].every(function (f) { return l.indexOf(f) !== -1; }); })`, '.local written', 15000);

  // ---- the layout ----
  const top = await list('OrderPortal/mxscout');
  t.ok(JSON.stringify(top) === JSON.stringify(['.gitignore', '.local', 'AGENTS.md', 'GUIDE.html', 'GUIDE.md', 'README.md', 'mxscout.json']),
    'mxscout/ holds mxscout.json, README.md, AGENTS.md, GUIDE.md, GUIDE.html, .gitignore and .local/ — no descriptions or docs while there are none: ' + JSON.stringify(top));
  const version = require('../package.json').version, edition = await mx.evaluate('MxFolder.EDITION');
  const st = edition + ' ' + version;
  const guideMd = await read('OrderPortal/mxscout/GUIDE.md');
  t.ok(guideMd === '<!-- ' + st + ' — written by MxScout; it replaces this file only with a newer copy. -->\n' + readText(path.join(__dirname, '..', 'public', 'guide-team.md')).replace(/\s+$/, '') + '\n',
    'GUIDE.md is the guide this MxScout ships (public/guide-team.md), stamped with the version that wrote it');
  const guidePage = readText(path.join(__dirname, '..', 'public', 'guide-team.html'));
  t.ok(await read('OrderPortal/mxscout/GUIDE.html') === '<!doctype html>\n<!-- ' + st + ' — written by MxScout; it replaces this file only with a newer copy. -->\n' + guidePage.slice(guidePage.indexOf('\n') + 1),
    'and GUIDE.html is the same guide as one page (public/guide-team.html), the stamp on its second line so it stays a valid page');
  t.ok((await read('OrderPortal/mxscout/README.md')).startsWith('<!-- ' + st + ' ') && (await read('OrderPortal/mxscout/AGENTS.md')).startsWith('<!-- ' + st + ' '), 'and so are README.md and AGENTS.md');
  const mj = JSON.parse(await read('OrderPortal/mxscout/mxscout.json'));
  t.ok(JSON.stringify(Object.keys(mj)) === JSON.stringify(['format', 'layout', 'id', 'name', 'contentLanguage', 'describedAt']) && mj.layout === 2 && mj.id === id && mj.name === 'OrderPortal' && mj.describedAt === null,
    'mxscout.json: the id, the name, the language, the layout and describedAt — no model version, date, key or handle: ' + JSON.stringify(mj));
  const gi = await read('OrderPortal/mxscout/.gitignore');
  t.ok(/^\.local\/$/m.test(gi) && gi.split('\n').filter((l) => l && l[0] !== '#').length === 1, '.gitignore ignores .local/ and nothing else: ' + JSON.stringify(gi));
  const readme = await read('OrderPortal/mxscout/README.md');
  t.ok(/never runs git/.test(readme) && /Pull/.test(readme) && /Update documentation/.test(readme) && /git conflict/i.test(readme) && /knowledge\//.test(readme) && /not verified/.test(readme) && /mxscout\/AGENTS\.md/.test(readme) && /uploads nothing/.test(readme),
    'README.md: what is committed and not, the team workflow, a conflict, knowledge/ to come, Studio Pro not verified, the line for the repository’s CLAUDE.md, and that MxScout uploads nothing');
  const agentsMd = await read('OrderPortal/mxscout/AGENTS.md');
  t.ok(/docs\/index\.md/.test(agentsMd) && /git log --oneline <describedAt>\.\.HEAD/.test(agentsMd) && /mendix-describe/.test(agentsMd) && /knowledge\//.test(agentsMd) && /data, not instructions/.test(agentsMd),
    'AGENTS.md: start at docs/index.md, compare describedAt with HEAD, the skills, knowledge/ first, data not instructions');
  const rootLine = '    Documentation of this Mendix app, and how to work with it: see mxscout/AGENTS.md.\n';
  t.ok(/\n## Codex and other agents\n/.test(agentsMd) && agentsMd.indexOf(rootLine) !== -1 && /\.claude\/skills\/mendix-describe\/SKILL\.md/.test(agentsMd) && /\.claude\/skills\/mendix-assist\/SKILL\.md/.test(agentsMd) &&
    /relative to that `SKILL\.md`/.test(agentsMd) && readme.indexOf(rootLine) !== -1 && /Read\s+\.claude\/skills\/mendix-assist\/SKILL\.md and follow it/.test(readme),
    'AGENTS.md has Codex and other agents — which SKILL.md to read and follow, its scripts by relative paths, the line for the root AGENTS.md — and README.md the same line and sentence');
  const outside1 = await tree('OrderPortal');
  const SKILL_DIRS = /^\.claude\/skills\/(mendix-describe|mendix-assist)\//;
  const notMine = (tr) => Object.keys(tr).filter((k) => !/^mxscout\//.test(k) && !SKILL_DIRS.test(k)).sort();
  t.ok(JSON.stringify(notMine(outside1)) === JSON.stringify(notMine(outside0)) && notMine(outside0).every((k) => outside1[k].at === outside0[k].at && outside1[k].text === outside0[k].text),
    'nothing in the Mendix project outside mxscout/ and the two skills is written — .claude/settings.json and another skill untouched: ' + JSON.stringify(notMine(outside1)));
  // ---- the Claude skills, in .claude/skills/ (chosen by default) ----
  const skillsRoot = path.join(__dirname, '..', 'skills');
  const onDisk = (name) => { const out = []; (function walk(d, rel) { fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { if (e.isDirectory()) walk(path.join(d, e.name), rel + e.name + '/'); else out.push(rel + e.name); }); })(path.join(skillsRoot, name), ''); return out.sort(); };
  const served = await (await fetch(t.MX + '/api/skills')).json();
  t.ok(served.skills.map((x) => x.name).join() === 'mendix-describe,mendix-assist' && served.skills.every((x) => JSON.stringify(x.files.map((f) => f.path).sort()) === JSON.stringify(onDisk(x.name)) && x.files.every((f) => f.text === readText(path.join(skillsRoot, x.name, f.path)))),
    'GET /api/skills serves the two skills, read-only — its allowlist is every file in skills/mendix-describe and skills/mendix-assist, as they are on disk');
  t.ok((await fetch(t.MX + '/api/skills', { headers: { Origin: 'http://evil.example' } })).status === 403, 'and refuses another origin, as every route does');
  const sk = ['mendix-describe', 'mendix-assist'].every((n) => onDisk(n).every((f) => outside1['.claude/skills/' + n + '/' + f] && outside1['.claude/skills/' + n + '/' + f].text === readText(path.join(skillsRoot, n, f))) &&
    outside1['.claude/skills/' + n + '/VERSION'].text.startsWith(st + '\n' + n + ' — '));
  t.ok(sk, 'New project writes mendix-describe and mendix-assist, whole, into the Mendix project’s .claude/skills/, each with a VERSION naming the MxScout that wrote it');
  t.ok(JSON.stringify(Object.keys(outside1).filter((k) => /^\.claude\//.test(k) && !SKILL_DIRS.test(k)).sort()) === JSON.stringify(['.claude/settings.json', '.claude/skills/someone-elses/SKILL.md']), 'and nothing else in .claude/');

  // ---- the skills on the Folder tab: only a newer copy replaces the one there ----
  await goToSection(mx, 'Settings', '.repo-skills'); // in Settings since 2026-10-16 (settings.js)
  t.ok(await mx.evaluate(`document.querySelector('.repo-skills-auto input').checked && /up to date/.test(document.querySelector('.repo-skill[data-skill="mendix-assist"]').textContent)`), 'the Folder tab says the project has them, up to date, and keeps them so');
  await write('OrderPortal/.claude/skills/mendix-assist/VERSION', edition + ' 99.0.0\nmendix-assist — a teammate’s newer MxScout\nfiles:\nSKILL.md\n');
  await write('OrderPortal/.claude/skills/mendix-assist/SKILL.md', '# from a newer MxScout\n');
  await mx.evaluate(`document.querySelector('.repo-skills-update').click()`);
  await until(`(function(){ var m = document.querySelector('.msg'); return m && /nothing written/.test(m.textContent); })()`, 'nothing written');
  t.ok(await read('OrderPortal/.claude/skills/mendix-assist/SKILL.md') === '# from a newer MxScout\n', 'a copy from a newer MxScout is never downgraded — Update the skills writes nothing');
  await write('OrderPortal/.claude/skills/mendix-assist/VERSION', edition + ' 0.1.0\nmendix-assist — an older copy\nfiles:\nSKILL.md\nold-notes.md\n');
  await write('OrderPortal/.claude/skills/mendix-assist/old-notes.md', 'old\n');
  await mx.evaluate(`document.querySelector('.repo-skills-update').click()`);
  await until(`window.__read('OrderPortal/.claude/skills/mendix-assist/VERSION').then(function (t) { return !!t && t.indexOf('${st}') === 0; })`, 'updated');
  t.ok(await read('OrderPortal/.claude/skills/mendix-assist/SKILL.md') === readText(path.join(skillsRoot, 'mendix-assist', 'SKILL.md')) && await read('OrderPortal/.claude/skills/mendix-assist/old-notes.md') === null,
    'an older copy is replaced, and a file it listed that this one has not is removed');

  // ---- the status line, before any descriptions ----
  await goToSection(mx, 'Documentation', '.repo-status');
  const line0 = await mx.evaluate(`document.querySelector('.repo-status-line').textContent`);
  t.ok(line0 === 'Model main @ aaaaaaa · no descriptions yet', 'the status line: ' + line0);
  t.ok(/Pull in Studio Pro or git, then Re-read/.test(await mx.evaluate(`document.querySelector('.repo-status-hint').textContent`)) && await mx.evaluate(`!!document.querySelector('.repo-reread')`),
    'with the hint and a Re-read button');

  // ---- descriptions: split into small files, docs/ by topic ----
  const fmt = await mx.evaluate('MxDescribe.FORMAT');
  const desc = {
    format: fmt, version: 1, project: 'OrderPortal', language: 'en', by: 'test agent', written: '2026-10-15',
    app: { summary: 'Takes orders from customers. Ships them.', story: 'A longer story about the orders.', audience: [{ who: 'Clerks', what: 'enter orders' }],
      processes: [{ name: 'Order to cash', summary: 'From an order to its payment.', steps: ['Order', 'Pay'], flows: ['Sales.CreateOrder'] },
        { name: 'Łódź returns', summary: 'Returns, Polish style.', steps: ['Return'], flows: [] }] },
    modules: { Sales: { summary: 'Sales holds the orders.', story: 'Its story.', notes: [{ title: 'Before you change it', items: ['Keep the status enumeration.'] }] } },
    microflows: { 'Sales.CreateOrder': 'Creates an order for a customer.', 'Sales.SweepOrders': { text: 'Sweeps old orders.' } },
    entities: { 'Sales.Order': 'An order a customer placed.' },
    risks: [{ level: 'P2', title: 'Sweep deletes orders', detail: 'It deletes without a check.', fix: 'Add a check.', where: ['Sales.SweepOrders'] }],
    c4: { context: { nodes: [{ id: 'app', name: 'Order portal', kind: 'app' }, { id: 'erp', name: 'ERP' }], links: [{ from: 'app', to: 'erp', label: 'orders' }] } },
    context: { pitfalls: ['Do not rename the Order entity.'] }
  };
  await write('OrderPortal/mxscout/.local/inbox/first.json', JSON.stringify(desc));
  await sleep(1100);
  await tick();
  await until(`MxStore.get('descriptions', ${JSON.stringify(id)}).then(function (r) { return !!(r && r.value && r.value.microflows['Sales.CreateOrder']); })`, 'descriptions taken');
  await until(`window.__read('OrderPortal/mxscout/docs/manifest.json').then(function (t) { return !!t; })`, 'docs written', 15000);
  const dtree = await tree('OrderPortal/mxscout');
  const dfiles = Object.keys(dtree).filter((k) => /^descriptions\//.test(k)).sort();
  t.ok(JSON.stringify(dfiles) === JSON.stringify(['descriptions/app.json', 'descriptions/c4.json', 'descriptions/context.json', 'descriptions/modules/Sales.json',
    'descriptions/processes/lodz-returns.json', 'descriptions/processes/order-to-cash.json', 'descriptions/risks.json']),
    'the descriptions are split: app, one file per process, one per module, risks, c4, context: ' + JSON.stringify(dfiles));
  t.ok(dfiles.every((k) => /\n$/.test(dtree[k].text) && !/\n\n$/.test(dtree[k].text) && /^[{[]\n {2}/.test(dtree[k].text)), 'each as JSON with two-space indent and one trailing newline');
  const salesJ = JSON.parse(dtree['descriptions/modules/Sales.json'].text);
  t.ok(salesJ.module === 'Sales' && salesJ.summary.text === 'Sales holds the orders.' && salesJ.summary.notes.length === 1 && Object.keys(salesJ.microflows).join() === 'Sales.CreateOrder,Sales.SweepOrders' && !!salesJ.entities['Sales.Order'],
    'a module’s file holds its summary and notes, its flows’ sentences and its entities');
  t.ok(JSON.parse(dtree['descriptions/app.json'].text).processes.join() === 'order-to-cash,lodz-returns', 'app.json keeps the processes’ order, by file name');
  const mj1 = JSON.parse(dtree['mxscout.json'].text);
  t.ok(mj1.describedAt && mj1.describedAt.commit === A && mj1.contentLanguage === 'en', 'mxscout.json says which version they describe: ' + JSON.stringify(mj1.describedAt));
  // Joined back, exactly the descriptions kept; split again, the same bytes.
  const rt = JSON.parse(await mx.evaluate(`(async function () {
    var files = Object.keys(${JSON.stringify(Object.fromEntries(dfiles.map((k) => [k, dtree[k].text])))}).map(function (k) { return { path: k, text: ${JSON.stringify(Object.fromEntries(dfiles.map((k) => [k, dtree[k].text])))}[k] }; });
    var row = await MxStore.get('descriptions', ${JSON.stringify(id)});
    var j = MxRepoDocs.join(files, row.value.describedAt);
    var a = JSON.stringify(MxRepoDocs.canonical(j.value)), b = JSON.stringify(MxRepoDocs.canonical(MxDescribe.toFile(row.value)));
    var again = MxRepoDocs.split(j.value).map(function (p) { return p.path + '\\n' + p.text; }).join('\\u0000') === files.map(function (p) { return p.path + '\\n' + p.text; }).join('\\u0000');
    var reparsed = MxRepoDocs.split(MxDescribe.toFile(MxDescribe.parse(JSON.stringify(j.value)).value)).map(function (p) { return p.text; }).join('') === files.map(function (p) { return p.text; }).join('');
    return JSON.stringify({ same: a === b, again: again, reparsed: reparsed });
  })()`));
  t.ok(rt.same, 'the files join back into exactly the descriptions kept (round trip)');
  t.ok(rt.again && rt.reparsed, 'and split again — as kept, or read back the way a teammate’s MxScout reads them — give the same bytes');

  const docs = Object.keys(dtree).filter((k) => /^docs\//.test(k)).sort();
  t.ok(['docs/app.md', 'docs/architecture.md', 'docs/developers.md', 'docs/index.md', 'docs/manifest.json', 'docs/modules/Sales.md', 'docs/processes/lodz-returns.md',
    'docs/processes/order-to-cash.md', 'docs/quality.md', 'docs/risks.md'].every((f) => docs.indexOf(f) !== -1), 'docs/ by topic: index, app, processes, modules, risks, architecture, quality, developers, manifest: ' + JSON.stringify(docs));
  const salesMd = dtree['docs/modules/Sales.md'].text;
  t.ok(salesMd.startsWith('---\napp: "OrderPortal"\nkind: "module"\nname: "Sales"\nmodule: "Sales"\ndescribed: "' + A + '"\nsource: "mxscout"\nid: "' + id + '/module/Sales"\n---\n'),
    'each file starts with front matter: app, kind, name, module, the commit described, source, a stable id');
  t.ok(/Sales holds the orders\./.test(salesMd) && /Creates an order for a customer\./.test(salesMd) && /## Domain model/.test(salesMd) && /Keep the status enumeration/.test(salesMd) && /Sweep deletes orders/.test(salesMd),
    'a module’s file: its description and notes, its flows’ sentences, its entities, its risks');
  const idx = dtree['docs/index.md'].text;
  t.ok(/\]\(processes\/order-to-cash\.md\)/.test(idx) && /\]\(modules\/Sales\.md\)/.test(idx) && /\]\(risks\.md\)/.test(idx) && /git log --oneline aaaaaaa\.\.HEAD/.test(idx) && /## Solved cases/.test(idx) && /knowledge\//.test(idx),
    'index.md is the map: processes, modules and topics with their paths, the version described, solved cases (knowledge/, to come)');
  t.ok(!/model of |Model read/.test(docs.filter((k) => /\.md$/.test(k)).map((k) => dtree[k].text).join('')), 'no date the model was read, in any of them');
  const man = JSON.parse(dtree['docs/manifest.json'].text);
  t.ok(man.files.length === docs.length - 1 && man.files.every((f) => dtree[f.path] && f.sha256 === crypto.createHash('sha256').update(dtree[f.path].text).digest('hex') && f.id && f.kind) && man.described === A && /^[0-9a-f]{64}$/.test(man.descriptions),
    'manifest.json lists every file with its id, kind and SHA-256, and what it was made from');
  const again = await mx.evaluate(`(async function () {
    var row = await MxStore.get('descriptions', ${JSON.stringify(id)});
    var h = await MxRepoDocs.descriptionsHash(MxRepoDocs.split(MxDescribe.toFile(row.value)), row.value.describedAt);
    var files = await MxDocs.repoDocs(${JSON.stringify(id)}, h);
    var disk = ${JSON.stringify(Object.fromEntries(docs.map((k) => [k, dtree[k].text])))};
    return files.length === Object.keys(disk).length && files.every(function (f) { return disk[f.path] === f.text; });
  })()`);
  t.ok(again, 'made again from the same model and descriptions: byte-identical');
  await goToSection(mx, 'Documentation', '.repo-status');
  const line1 = await until(`(function(){ var l = document.querySelector('.repo-status-line'); return l && /up to date/.test(l.textContent) && l.textContent; })()`, 'up to date');
  t.ok(line1 === 'Model main @ aaaaaaa · Descriptions describe this version — up to date', 'the status line when they describe the model: ' + line1);

  // ---- reading the model again writes nothing shared ----
  const before = stamps(await tree('OrderPortal/mxscout'));
  await mx.evaluate(`document.querySelector('.repo-reread').click()`);
  await until(`(function(){ var m = document.querySelector('.msg.ok'); return m && /Read the model again from OrderPortal\\.mpr/.test(m.textContent); })()`, 're-read');
  await sleep(600); await tick(); await sleep(600);
  t.ok(stamps(await tree('OrderPortal/mxscout')) === before, 'Re-read reads the model again and writes nothing in mxscout/ — docs/ never follows the model');
  // A pull moves HEAD: the line says so, and still nothing shared is written.
  await write('OrderPortal/.git/refs/heads/main', B + '\n');
  await write('OrderPortal/.git/logs/HEAD', '0'.repeat(40) + ' ' + A + ' S <s@x> 1760500000 +0200\tcommit (initial): First version\n' + A + ' ' + B + ' S <s@x> 1760600000 +0200\tpull: Fast-forward\n');
  await mx.evaluate(`document.querySelector('.repo-reread').click()`);
  const line2 = await until(`(function(){ var l = document.querySelector('.repo-status-line'); return l && /bbbbbbb/.test(l.textContent) && l.textContent; })()`, 'moved', 20000);
  t.ok(line2 === 'Model main @ bbbbbbb · descriptions aaaaaaa (no described flow changed since)', 'after a pull the status line: ' + line2);
  await sleep(600); await tick(); await sleep(600);
  t.ok(stamps(await tree('OrderPortal/mxscout')) === before, 'and docs/, descriptions/ and mxscout.json stay as they are');

  // ---- a newer file wins, with Undo; docs/ follows the descriptions ----
  const pulled = JSON.parse(dtree['descriptions/modules/Sales.json'].text);
  pulled.microflows['Sales.CreateOrder'].text = 'Creates an order, as a teammate wrote it.';
  await write('OrderPortal/mxscout/descriptions/modules/Sales.json', JSON.stringify(pulled, null, 2) + '\n');
  await tick();
  t.ok(await until(`MxStore.get('descriptions', ${JSON.stringify(id)}).then(function (r) { return r.value.microflows['Sales.CreateOrder'].text === 'Creates an order, as a teammate wrote it.'; })`, 'newer taken'),
    'a descriptions file newer than this browser’s copy is taken in while the project is open');
  t.ok(await until(`(function(){ var m = document.querySelector('.msg'); return m && /Took mxscout\\/descriptions\\/ from the project’s folder/.test(m.textContent) && !!Array.from(m.querySelectorAll('button')).find(function (b) { return b.textContent === 'Undo'; }); })()`, 'said, with Undo'),
    'said, with Undo');
  t.ok(await until(`window.__read('OrderPortal/mxscout/docs/modules/Sales.md').then(function (t) { return /as a teammate wrote it/.test(t); })`, 'docs follow'), 'docs/ is written again, because the descriptions changed');
  await mx.evaluate(`Array.from(document.querySelector('.msg').querySelectorAll('button')).find(function (b) { return b.textContent === 'Undo'; }).click()`);
  t.ok(await until(`window.__read('OrderPortal/mxscout/descriptions/modules/Sales.json').then(function (t) { return /Creates an order for a customer\\./.test(t); })`, 'undone'),
    'Undo puts them back, in mxscout/ too');
  await until(`window.__read('OrderPortal/mxscout/docs/modules/Sales.md').then(function (t) { return /Creates an order for a customer\\./.test(t); })`, 'docs undone');

  // ---- git's conflict markers: shown, not overwritten ----
  const conflict = '[\n<<<<<<< HEAD\n  {"level": "P2", "title": "Sweep deletes orders", "detail": "It deletes without a check.", "fix": "Add a check.", "theme": null, "where": ["Sales.SweepOrders"]}\n' +
    '=======\n  {"level": "P1", "title": "Sweep deletes every order", "detail": "Everything goes.", "fix": "Stop it.", "theme": null, "where": ["Sales.SweepOrders"]}\n>>>>>>> teammate\n]\n';
  await write('OrderPortal/mxscout/descriptions/risks.json', conflict);
  await tick();
  await goToSection(mx, 'Documentation', '.repo-conflicts');
  const shown = JSON.parse(await mx.evaluate(`JSON.stringify({ head: document.querySelector('.repo-conflicts h3').textContent, path: document.querySelector('.repo-conflict').getAttribute('data-path'),
    said: document.querySelector('.repo-conflict p').textContent, ours: document.querySelector('.repo-side[data-side="ours"]').textContent, theirs: document.querySelector('.repo-side[data-side="theirs"]').textContent })`));
  t.ok(shown.path === 'descriptions/risks.json' && /this file has a git conflict/.test(shown.said) && /Yours \(HEAD\)/.test(shown.ours) && /Sweep deletes orders/.test(shown.ours) && /Theirs \(teammate\)/.test(shown.theirs) && /every order/.test(shown.theirs),
    'a file with conflict markers is shown with both sides: ' + JSON.stringify({ head: shown.head, path: shown.path }));
  // A save meanwhile is held, not written over the conflict.
  await mx.evaluate(`MxStore.get('projects', ${JSON.stringify(id)}).then(function (p) { p.contentLanguage = 'pl'; return MxStore.put('projects', p); })`);
  await sleep(500); await tick(); await sleep(500);
  t.ok(await read('OrderPortal/mxscout/descriptions/risks.json') === conflict && JSON.parse(await read('OrderPortal/mxscout/mxscout.json')).contentLanguage === 'en',
    'and nothing shared is written while it is there — the file keeps its markers, mxscout.json waits');
  await mx.evaluate(`Array.from(document.querySelectorAll('.repo-side[data-side="theirs"] button')).find(function (b) { return b.textContent === 'Use theirs'; }).click()`);
  t.ok(await until(`MxStore.get('descriptions', ${JSON.stringify(id)}).then(function (r) { return r.value.risks.length === 1 && r.value.risks[0].title === 'Sweep deletes every order'; })`, 'theirs kept'),
    'Use theirs keeps that side: the file is written with it and taken in');
  t.ok(await until(`window.__read('OrderPortal/mxscout/descriptions/risks.json').then(function (t) { return !/<<<<<<<|>>>>>>>/.test(t) && JSON.parse(t)[0].level === 'P1'; })`, 'resolved file'), 'with no markers left');
  t.ok(await until(`window.__read('OrderPortal/mxscout/mxscout.json').then(function (t) { return JSON.parse(t).contentLanguage === 'pl'; })`, 'held save written'), 'and what waited is written after it');
  t.ok(await until(`!document.querySelector('.repo-conflicts')`, 'card gone'), 'the conflict card goes');
  await mx.evaluate(`MxStore.get('projects', ${JSON.stringify(id)}).then(function (p) { p.contentLanguage = 'en'; return MxStore.put('projects', p); })`);
  await until(`window.__read('OrderPortal/mxscout/mxscout.json').then(function (t) { return JSON.parse(t).contentLanguage === 'en'; })`, 'language back');
  await sleep(800);

  // ---- agent.js, check-descriptions.js, check-assist.js on the layout (Node) ----
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mxscout-repo-'));
  const repoDir = path.join(tmp, 'OrderPortal');
  const all = await tree('OrderPortal', true);
  Object.keys(all).forEach((k) => { if (/\.mpr$/.test(k)) return; const f = path.join(repoDir, k); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, all[k].text); });
  // The .mpr as bytes (the tree reads text): agent.js reads the model from it, as it is now (audit B02).
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db'), path.join(repoDir, 'OrderPortal.mpr'));
  const skills = path.join(__dirname, '..', 'skills');
  const agent = path.join(skills, 'mendix-describe', 'agent.js');
  const run = (args, cwd) => execFileSync(process.execPath, args, { cwd: cwd || tmp, encoding: 'utf8', env: Object.assign({}, process.env, { MXSCOUT_TOKEN: '', MXSCOUT_FOLDER: '', MXSCOUT_WORK: path.join(tmp, 'work') }) });
  const statusOut = run([agent, 'status', '--folder', repoDir]);
  t.ok(/kept in the Mendix project/.test(statusOut) && /model in the repository: main @ bbbbbbb/.test(statusOut) && /describe aaaaaaa/.test(statusOut) && /git log --oneline aaaaaaa\.\.HEAD/.test(statusOut) && /never runs git/.test(statusOut),
    'agent.js status on the Mendix project: the layout, HEAD against what the descriptions describe, and git log to see what changed');
  t.ok(/kept in the Mendix project/.test(run([agent, 'status'], path.join(repoDir, 'mxscout', 'docs'))), 'and finds mxscout/ when run inside it');
  t.ok(/^# MxScout documentation/.test(run([agent, 'docs', '--folder', path.join(repoDir, 'mxscout')])), 'agent.js docs reads .local/documentation.md');
  const todo = run([path.join(skills, 'mendix-describe', 'check-descriptions.js'), 'todo', '--folder', repoDir]);
  t.ok(/flows to describe/.test(todo), 'check-descriptions.js todo --folder takes the Mendix project: ' + todo.split('\n')[0]);
  fs.writeFileSync(path.join(tmp, 'more.json'), JSON.stringify({ format: fmt, version: 1, add: true, by: 'node agent', microflows: { 'Sales.SweepOrders': 'Sweeps old orders every night.' } }));
  const salesBefore = readText(path.join(repoDir, 'mxscout', 'descriptions', 'app.json'));
  const wrote = run([agent, 'write', '--folder', repoDir, path.join(tmp, 'more.json')]);
  t.ok(/Wrote 1 file\(s\)/.test(wrote) && /describe main @ bbbbbbb/.test(wrote) && /git add mxscout/.test(wrote), 'agent.js write puts the descriptions straight into descriptions/ — only the file that changed: ' + wrote.split('\n')[0]);
  t.ok(/every night/.test(readText(path.join(repoDir, 'mxscout', 'descriptions', 'modules', 'Sales.json'))) && readText(path.join(repoDir, 'mxscout', 'descriptions', 'app.json')) === salesBefore &&
    JSON.parse(readText(path.join(repoDir, 'mxscout', 'mxscout.json'))).describedAt.commit === B, 'laid over what is there, and stamped with the commit HEAD names');
  run([agent, 'send', '--folder', repoDir, path.join(tmp, 'more.json')]);
  t.ok(fs.readdirSync(path.join(repoDir, 'mxscout', '.local', 'inbox')).some((f) => /more\.json$/.test(f)), 'agent.js send hands a file to .local/inbox/');
  // The Mendix project kept clean (Karol, 2026-10-15): an agent's own files go into the work folder — MXSCOUT_WORK
  // here — never into the project; inside it agent.js writes only the documentation, through its own writers.
  const work = path.join(tmp, 'work');
  const checker = path.join(skills, 'mendix-describe', 'check-descriptions.js');
  const runW = (args) => { try { return { code: 0, out: execFileSync(process.execPath, args, { cwd: repoDir, encoding: 'utf8', stdio: 'pipe', env: Object.assign({}, process.env, { MXSCOUT_TOKEN: '', MXSCOUT_FOLDER: '', MXSCOUT_WORK: work }) }) }; } catch (e) { return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') }; } };
  const listAll = (d) => { const out = []; (function walk(x) { fs.readdirSync(x, { withFileTypes: true }).forEach((n) => { if (n.isDirectory()) walk(path.join(x, n.name)); else out.push(path.relative(d, path.join(x, n.name))); }); })(d); return out.sort().join('\n'); };
  const untouched = listAll(repoDir);
  let w = runW([agent, 'docs', '--out', 'docs.md']);
  t.ok(w.code === 0 && fs.existsSync(path.join(work, 'docs.md')) && w.out.indexOf(path.join(work, 'docs.md')) !== -1 && listAll(repoDir) === untouched,
    'agent.js docs --out docs.md, run in the Mendix project, lands in the work folder (its full path said), and nothing new appears in the project');
  t.ok(/work folder: /.test(runW([agent, 'status']).out) && runW([agent, 'workdir']).out.trim() === work, 'status names the work folder, and workdir prints it');
  w = runW([agent, 'docs', '--out', path.join(repoDir, 'mxscout', 'notes.md')]);
  const w2 = runW([agent, 'module', 'Sales', '--out', path.join(repoDir, 'mxscout', 'docs', 'Sales-copy.md')]);
  t.ok(w.code === 1 && /Refusing to write/.test(w.out) && /node agent\.js workdir/.test(w.out) && w2.code === 1 && /Refusing to write/.test(w2.out) && listAll(repoDir) === untouched,
    'an absolute --out inside the Mendix project is refused — in mxscout/ and even in mxscout/docs/, which only agent.js’s own writers write: ' + w.out.trim().slice(0, 70));
  w = runW([checker, 'merge', path.join(repoDir, 'merged.json'), path.join(tmp, 'more.json')]);
  t.ok(w.code !== 0 && /Refusing to write/.test(w.out) && listAll(repoDir) === untouched, 'check-descriptions.js merge refuses the Mendix project too');
  w = runW([checker, 'merge', 'merged.json', path.join(tmp, 'more.json')]);
  t.ok(w.code === 0 && fs.existsSync(path.join(work, 'merged.json')) && w.out.indexOf(path.join(work, 'merged.json')) !== -1, 'and merges into the work folder');
  w = runW([agent, 'write', 'merged.json']);
  t.ok(w.code === 0 && /nothing changed/.test(w.out), 'agent.js write still writes descriptions/ from a file in the work folder (here, nothing new to write)');
  w = runW([agent, 'send', 'merged.json']);
  t.ok(w.code === 0 && fs.readdirSync(path.join(repoDir, 'mxscout', '.local', 'inbox')).some((f) => /merged\.json$/.test(f)), 'and agent.js send hands it from the work folder to .local/inbox/');
  t.ok(listAll(repoDir).split('\n').filter((f) => untouched.split('\n').indexOf(f) === -1).every((f) => /^mxscout[\\/]\.local[\\/]inbox[\\/]/.test(f)), 'the project gained only the inbox file');
  const al = run([path.join(skills, 'mendix-assist', 'check-assist.js'), 'list', repoDir]);
  t.ok(new RegExp('No assist/ folder in ' + path.join(repoDir, 'mxscout', '.local').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(al) && /waiting in inbox/.test(al), 'check-assist.js list reads the Assist items and the inbox in .local/');
  t.ok(readText(path.join(skills, 'mendix-describe', 'repodocs.js')) === readText(path.join(__dirname, '..', 'public', 'repodocs.js')),
    'the skill’s repodocs.js is MxScout’s own, unchanged');
  // The engine mendix-describe carries (agent.js update-docs, and write): MxScout's own files, byte for byte, and exactly the ones agent.js loads.
  const engineDir = path.join(skills, 'mendix-describe', 'engine');
  const engineFiles = fs.readdirSync(engineDir).sort();
  const loads = (/const ENGINE = (\[[^\]]*\])/.exec(readText(agent)) || [])[1];
  t.ok(engineFiles.length === 11 && engineFiles.every((f) => readText(path.join(engineDir, f)) === readText(path.join(__dirname, '..', 'public', f))) &&
    loads && JSON.stringify(JSON.parse(loads.replace(/'/g, '"')).sort()) === JSON.stringify(engineFiles),
    'the skill’s engine/ is MxScout’s own files, unchanged — the ones agent.js loads: ' + engineFiles.join(', '));
  // What agent.js wrote, taken by MxScout as a pull would bring it: docs/ follows, made from that commit.
  for (const f of ['mxscout/descriptions/modules/Sales.json', 'mxscout/mxscout.json']) await write('OrderPortal/' + f, readText(path.join(repoDir, f)));
  await tick();
  t.ok(await until(`window.__read('OrderPortal/mxscout/docs/manifest.json').then(function (t) { return JSON.parse(t).described === '${B}'; })`, 'docs from the agent’s write', 15000) &&
    /every night/.test(await read('OrderPortal/mxscout/docs/modules/Sales.md')), 'MxScout takes what agent.js wrote and writes docs/ from it, for that commit');
  await sleep(800);

  // ---- the same docs/ from the documentation engine in Node ----
  const model = JSON.parse(await mx.evaluate(`MxStore.getModel(${JSON.stringify(id)}).then(function (m) { return JSON.stringify(m); })`));
  const shared = await tree('OrderPortal/mxscout');
  const ctx = { console, TextDecoder, TextEncoder, document: {}, crypto: crypto.webcrypto };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  ['docs-data.js', 'describe.js', 'reportdata.js', 'docs-changes.js', 'docs-tickets.js', 'docs-triage.js', 'docs-view.js', 'docs-file.js', 'repodocs.js']
    .forEach((f) => vm.runInContext(readText(path.join(__dirname, '..', 'public', f)), ctx, { filename: f }));
  const R = ctx.MxRepoDocs, pj = JSON.parse(shared['mxscout.json'].text);
  const parts = Object.keys(shared).filter((k) => /^descriptions\//.test(k)).sort().map((k) => ({ path: k, text: shared[k].text }));
  const value = ctx.MxDescribe.parse(JSON.stringify(R.join(parts, pj.describedAt).value)).value;
  const data = ctx.MxDocsData.build(model, { id: pj.id, name: pj.name });
  ctx.MxDescribe.attach(data, value);
  const own = {};
  data.modules.forEach((m) => { own[m.name] = !m.marketplace; });
  const hash = await R.descriptionsHash(R.split(ctx.MxDescribe.toFile(value)), value.describedAt);
  const nodeDocs = await R.docsFiles(ctx.MxDocsFile.withDerived(ctx.MxDocsFile.subset(data, own)), { id: pj.id, app: pj.name, describedAt: value.describedAt, descriptions: hash, cases: [] });
  const diskDocs = Object.keys(shared).filter((k) => /^docs\//.test(k)).sort();
  const differ = nodeDocs.filter((f) => !shared[f.path] || shared[f.path].text !== f.text).map((f) => f.path);
  t.ok(nodeDocs.length === diskDocs.length && !differ.length, 'the engine in Node, from the same model and the files in mxscout/, writes byte-identical docs/' + (differ.length ? ': differ ' + differ.join(', ') : ''));

  // ---- MxScout Dev: the comments and what was decided about the risks are the team's, committed ----
  await mx.evaluate(`MxStore.put('findings', { id: 'c-1', projectId: ${JSON.stringify(id)}, target: { kind: 'microflow', qualifiedName: 'Sales.CreateOrder' }, severity: 'high', problem: 'Creates without a check.', change: 'Check first.', status: 'open', author: 'Tester', history: [], createdAt: '2026-10-15T08:00:00.000Z', updatedAt: '2026-10-15T08:00:00.000Z' })`);
  t.ok(await until(`window.__read('OrderPortal/mxscout/comments/c-1.json').then(function (t) { var c = t && JSON.parse(t); return !!c && c.problem === 'Creates without a check.' && !('projectId' in c); })`, 'the comment’s file'),
    'a comment is written into mxscout/comments/, one file per comment, by the whitelist a package uses');
  await mx.evaluate(`MxStore.put('triage', { projectId: ${JSON.stringify(id)}, updatedAt: '2026-10-15T08:00:00.000Z', risks: { 'r-1': { key: 'r-1', origin: 'ai', status: 'false-positive', note: 'Checked: only admins reach it.', by: 'Tester', at: '2026-10-15T08:00:00.000Z', risk: { level: 'P2', title: 'Sweep deletes every order', where: ['Sales.SweepOrders'] }, history: [] } } })`);
  t.ok(await until(`window.__read('OrderPortal/mxscout/triage.json').then(function (t) { var c = t && JSON.parse(t); return !!c && c.format === 'mxscout-triage' && c.triage.risks['r-1'].status === 'false-positive'; })`, 'triage.json'),
    'and what was decided about a risk into mxscout/triage.json');
  t.ok((await list('OrderPortal/mxscout/.local') || []).indexOf('recordings') === -1 && (await list('OrderPortal/mxscout')).indexOf('recordings') === -1, 'performance recordings stay in the browser');
  await sleep(800); await tick(); await sleep(800);

  // ---- agent.js update-docs with the comments and what was decided: the same docs/ as MxScout's ----
  await until(`window.__read('OrderPortal/mxscout/docs/manifest.json').then(function (t) { return !!t; })`, 'docs there');
  const nodeRepo = path.join(tmp, 'NodeCopy');
  const sharedNow = await tree('OrderPortal/mxscout');
  Object.keys(sharedNow).forEach((k) => { const f = path.join(nodeRepo, 'mxscout', k); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, sharedNow[k].text); });
  fs.cpSync(path.join(repoDir, '.git'), path.join(nodeRepo, '.git'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db'), path.join(nodeRepo, 'OrderPortal.mpr'));
  t.ok(/docs\/ is current/.test(run([agent, 'update-docs', '--folder', nodeRepo])), 'agent.js update-docs counts the comments and triage.json in what docs/ is made from, as MxScout does: current');
  fs.rmSync(path.join(nodeRepo, 'mxscout', 'docs'), { recursive: true });
  run([agent, 'update-docs', '--folder', nodeRepo]);
  // What the browser makes of the same files — with triage.js's own copy dropped, as after a pull: docs/ reads what was
  // decided and the comments from storage, as Node reads triage.json and comments/, not from this tab's copies.
  const browserDocs = JSON.parse(await mx.evaluate(`(async function () {
    MxTriage.forget(${JSON.stringify(id)});
    var man = JSON.parse(await window.__read('OrderPortal/mxscout/docs/manifest.json'));
    var files = await MxDocs.repoDocs(${JSON.stringify(id)}, man.descriptions);
    var out = {}; files.forEach(function (f) { out[f.path] = f.text; }); return JSON.stringify(out);
  })()`));
  const devDiffer = Object.keys(browserDocs).filter((k) => readText(path.join(nodeRepo, 'mxscout', k)) !== browserDocs[k]);
  t.ok(Object.keys(browserDocs).length > 5 && !devDiffer.length && /Not counted as risks \(1\)/.test(browserDocs['docs/risks.md']),
    'and made in Node, with what was decided about the risks applied, docs/ is byte-identical to what MxScout makes of the same files' + (devDiffer.length ? ': ' + devDiffer.join(', ') : ''));

  // ---- a teammate's browser: links the committed project at once, writes nothing shared ----
  const committed = stamps(await tree('OrderPortal/mxscout')) + stamps(await tree('OrderPortal/.claude'));
  await mx.evaluate(`new Promise(function (resolve) { var r = indexedDB.deleteDatabase('mxscout'); r.onsuccess = r.onerror = r.onblocked = function () { resolve(true); }; })`);
  await mx.navigate(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'MxScout loaded again');
  await inject();
  t.ok(await until(`MxStore.getAll('projects').then(function (r) { return r.length === 0; })`, 'an empty browser'), 'a second browser: nothing in its database, the folder as git left it');
  await mx.evaluate(`(function(){ var b = Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'All projects'); if (b) b.click(); return true; })()`);
  await until(`!!document.querySelector('.sidebar-new')`, 'list screen again');
  await mx.evaluate(`document.querySelector('.sidebar-new').click()`);
  await until(`!!document.querySelector('.folder-pick')`, 'the card');
  await mx.evaluate(`document.querySelector('.folder-pick').click()`);
  t.ok(await until(`MxStore.get('projects', ${JSON.stringify(id)}).then(function (p) { return !!p && p.name === 'OrderPortal' && !!MxStore.folderInfo(p.id) && MxStore.folderInfo(p.id).layout === 2; })`, 'linked at once', 30000),
    'picking the Mendix project links the committed project at once — its id and name from mxscout.json, no package, no code, no import step');
  t.ok(await until(`MxStore.get('descriptions', ${JSON.stringify(id)}).then(function (r) { return !!r && /every night/.test(r.value.microflows['Sales.SweepOrders'].text) && r.value.describedAt.commit === '${B}'; })`, 'descriptions taken', 15000),
    'the descriptions come from mxscout/descriptions/, with the version they describe');
  t.ok(await until(`Promise.all([MxStore.byIndex('findings', 'byProject', ${JSON.stringify(id)}), MxStore.get('triage', ${JSON.stringify(id)})]).then(function (b) { return b[0].length === 1 && b[0][0].problem === 'Creates without a check.' && !!b[1] && b[1].risks['r-1'].status === 'false-positive'; })`, 'comments and triage taken', 15000),
    'and the comments and what was decided about the risks from comments/ and triage.json');
  await sleep(1500); await tick(); await sleep(1500); await tick(); await sleep(800);
  t.ok(stamps(await tree('OrderPortal/mxscout')) + stamps(await tree('OrderPortal/.claude')) === committed, 'and nothing shared is written — the skills neither: a teammate who only pulls finds git’s status clean');
  t.ok(await mx.evaluate(`MxStore.folderInfo(${JSON.stringify(id)}).skills === true`), 'the project had the skills, so this browser keeps them up to date too');
  t.ok((await list('OrderPortal/mxscout/.local') || []).indexOf('model.json') !== -1, 'only its own .local/ (the model cache, the pack) is written');

  // ---- a comment a teammate deleted (its file gone after a pull) goes here too, and is not written back ----
  const drop = (p) => mx.evaluate(`(async function () { var w = await window.__walk(${JSON.stringify('x')}.replace('x', ${JSON.stringify(p)})); await w.d.removeEntry(w.name); return true; })()`);
  await mx.evaluate(`MxStore.put('findings', { id: 'c-2', projectId: ${JSON.stringify(id)}, target: { kind: 'microflow', qualifiedName: 'Sales.SweepOrders' }, severity: 'low', problem: 'Runs every night.', change: null, status: 'open', author: 'Tester', history: [], createdAt: '2026-10-15T09:00:00.000Z', updatedAt: '2026-10-15T09:00:00.000Z' })`);
  t.ok(await until(`window.__read('OrderPortal/mxscout/comments/c-2.json').then(function (t) { return !!t; })`, 'c-2 written'), 'a second comment is written into mxscout/comments/');
  await sleep(800);
  await drop('OrderPortal/mxscout/comments/c-1.json');
  await tick();
  t.ok(await until(`MxStore.byIndex('findings', 'byProject', ${JSON.stringify(id)}).then(function (r) { return r.length === 1 && r[0].id === 'c-2'; })`, 'c-1 removed', 15000),
    'a comment whose file was deleted in mxscout/comments/ (a teammate deleted it, a pull brought that) is removed here too — the other stays');
  await sleep(1500); await tick(); await sleep(800);
  t.ok(await read('OrderPortal/mxscout/comments/c-1.json') === null && !!(await read('OrderPortal/mxscout/comments/c-2.json')),
    'and it is not written back: the deletion holds after the next write');
  fs.rmSync(tmp, { recursive: true, force: true });
};
