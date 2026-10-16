/* The solved cases: knowledge/ (public/knowledge.js · docs-knowledge.js · repodocs.js · store.js, and
 * skills/mendix-describe/agent.js update-docs with MxScout's engine).
 *
 * Karol, 2026-10-15: when a ticket, a Jira issue or an idea is solved in a conversation, a note stays
 * behind in mxscout/knowledge/ that any agent on another machine can use — written by the agent itself,
 * committed with the fix. What has to hold:
 *  - an agent working with no MxScout writes the descriptions and a case note, and agent.js writes
 *    docs/ — the index lists the cases, the manifest names every case file with its SHA-256 — byte for
 *    byte as MxScout would: MxScout, linking that repository, finds nothing to write;
 *  - a note with personal data is neither listed nor taken, and never written over or removed;
 *  - Solved cases: the list, the search, a case opened as text, "may be out of date" when a flow it names
 *    changed since (its fingerprint moved);
 *  - an Assist item whose solution is a case shows "In the documentation", and the link opens it;
 *  - a note an agent leaves in the inbox (a .md file) or sends through the channel (format
 *    "mxscout-knowledge") is saved at once into knowledge/, with Undo; one with personal data is refused;
 *  - the export leaves the cases out unless "Include solved cases" is ticked;
 *  - a package carries them, and opening it writes them into the folder the project is kept in. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { goToSection, goToDocsTab, readText } = require('./helpers');

const A = 'c'.repeat(40);

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxKnowledge', 15000, 'MxScout loaded');
  await mx.viewport(1440, 900);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = (expr, what, ms) => mx.waitFor(expr, ms || 12000, what);
  const skills = path.join(__dirname, '..', 'skills');
  const agent = path.join(skills, 'mendix-describe', 'agent.js');
  // The agent's work folder (its pack of the model, the files it replaced) inside this test's own temporary folder.
  const run = (args, cwd) => execFileSync(process.execPath, args, { cwd: cwd || os.tmpdir(), encoding: 'utf8', env: Object.assign({}, process.env, { MXSCOUT_TOKEN: '', MXSCOUT_FOLDER: '', MXSCOUT_WORK: path.join(tmp, 'work') }) });

  // ---- an agent, with no MxScout: the Mendix project, its descriptions and two solved cases ----
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mxscout-knowledge-'));
  const repo = path.join(tmp, 'ShopApp');
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };
  fs.mkdirSync(repo, { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db'), path.join(repo, 'ShopApp.mpr'));
  put('.git/HEAD', 'ref: refs/heads/main\n');
  put('.git/refs/heads/main', A + '\n');
  put('.git/logs/HEAD', '0'.repeat(40) + ' ' + A + ' S <s@x> 1760500000 +0200\tcommit (initial): First version\n');
  put('mxscout/mxscout.json', JSON.stringify({ format: 'mxscout-project', layout: 2, id: 'kn-shop', name: 'ShopApp', contentLanguage: 'en', describedAt: null }, null, 2) + '\n');
  const note = (o) => ['---', 'id: ' + JSON.stringify(o.id), 'kind: ' + JSON.stringify(o.kind), 'title: ' + JSON.stringify(o.title), 'status: "solved"', 'solved: "2026-10-15"', 'model: "' + A + '"',
    'flows: ' + JSON.stringify(o.flows || []), 'entities: ' + JSON.stringify(o.entities || []), 'pages: []', 'keywords: ' + JSON.stringify(o.keywords || []), 'related: ' + JSON.stringify(o.related || []), 'language: "en"',
    o.fp ? 'fingerprints: ' + JSON.stringify(o.fp) : null, '---', '', '# ' + o.id + ' — ' + o.title, '',
    '## Problem', '', o.problem, '', '## Cause', '', 'The flow `' + (o.flows || ['Sales.X'])[0] + '` does not check it.', '', '## Solution', '', '- Add the check.\n- Retrieve again.', '',
    '## What did not work', '', 'Hiding it on the page.', '', '## How to recognise it next time', '', '**Records** that should have left a list.', ''].filter((l) => l !== null).join('\n');
  const SD = note({ id: 'SD-4711', kind: 'ticket', title: 'Orders created twice', flows: ['Sales.CreateOrder'], keywords: ['duplicate', 'order'], fp: { 'Sales.CreateOrder': 'ba7ad270' }, problem: 'A clerk saw every new order twice. The list doubled.' });
  const SALES = note({ id: 'SALES-90', kind: 'jira', title: 'Sweep removes open orders', flows: ['Sales.SweepOrders'], entities: ['Sales.Order'], keywords: ['sweep', 'nightly'], related: ['SD-4711'], fp: { 'Sales.SweepOrders': '00000000' }, problem: 'The nightly sweep removed orders still open.' });
  const PRIVATE = note({ id: 'SD-9999', kind: 'ticket', title: 'Reported with a name', flows: ['Sales.CreateOrder'], keywords: ['x'], problem: 'Anna (anna.nowak@example.com) could not save.' });
  put('mxscout/knowledge/SD-4711-orders-created-twice.md', SD);
  put('mxscout/knowledge/SALES-90-sweep-removes-open-orders.md', SALES);
  put('mxscout/knowledge/SD-9999-reported-with-a-name.md', PRIVATE);
  const desc = { format: 'mxscout-descriptions', version: 1, project: 'ShopApp', language: 'en', by: 'test agent', written: '2026-10-15',
    app: { summary: 'Takes orders for an invented shop.', story: 'A story.', processes: [{ name: 'Order to cash', summary: 'From an order to its payment.', steps: ['Order'], flows: ['Sales.CreateOrder'] }] },
    modules: { Sales: { summary: 'Sales holds the orders.' } }, microflows: { 'Sales.CreateOrder': 'Creates an order.', 'Sales.SweepOrders': 'Sweeps old orders.' }, entities: { 'Sales.Order': 'An order.' },
    risks: [{ level: 'P2', title: 'Sweep deletes orders', detail: 'Without a check.', fix: 'Add a check.', where: ['Sales.SweepOrders'] }] };
  fs.writeFileSync(path.join(tmp, 'desc.json'), JSON.stringify(desc));
  const wrote = run([agent, 'write', '--folder', repo, path.join(tmp, 'desc.json')]);
  t.ok(/describe main @ ccccccc/.test(wrote) && /docs\/ written from them: \d+ of \d+ file\(s\) changed — the same files MxScout writes/.test(wrote),
    'agent.js write, with no MxScout: the descriptions, and docs/ written from them with MxScout’s engine (the .mpr read in Node): ' + wrote.split('\n')[1]);
  const index = readText(path.join(repo, 'mxscout', 'docs', 'index.md'));
  t.ok(/^- \[SD-4711 — Orders created twice\]\(\.\.\/knowledge\/SD-4711-orders-created-twice\.md\) — ticket, solved 2026-10-15: A clerk saw every new order twice\.$/m.test(index) &&
    /^- \[SALES-90 — Sweep removes open orders\]\(\.\.\/knowledge\/SALES-90-sweep-removes-open-orders\.md\) — jira, solved 2026-10-15: /m.test(index) && !/SD-9999/.test(index),
    'docs/index.md lists the solved cases — id, title, kind, date, the problem in a line, the path — and not the note with personal data');
  const man = JSON.parse(readText(path.join(repo, 'mxscout', 'docs', 'manifest.json')));
  const kEntries = man.files.filter((f) => /^knowledge\//.test(f.path));
  t.ok(kEntries.length === 2 && kEntries.every((f) => f.kind === 'case' && /^kn-shop\/case\//.test(f.id) && f.sha256 === crypto.createHash('sha256').update(readText(path.join(repo, 'mxscout', f.path))).digest('hex')) &&
    kEntries.some((f) => f.case === 'jira' && f.status === 'solved' && f.name === 'Sweep removes open orders'),
    'docs/manifest.json lists every case file with its id, kind, and SHA-256 — what a pipeline ingests: ' + JSON.stringify(kEntries.map((f) => f.path)));
  t.ok(/docs\/ is current/.test(run([agent, 'update-docs', '--folder', repo])), 'agent.js update-docs writes nothing when the manifest says docs/ is made from these already');
  const status = run([agent, 'status', '--folder', repo]);
  t.ok(/solved cases: 2 in mxscout\/knowledge\//.test(status) && /^snapshot: [0-9a-f]{12} — made from ShopApp\.mpr/m.test(status), 'agent.js status counts the solved cases, and makes the pack from the .mpr when MxScout never ran here');
  const checked = run([path.join(skills, 'mendix-assist', 'check-assist.js'), 'cases', repo, '--find', 'sweep']);
  t.ok(/^1 of 3 cases match/m.test(checked) && /^SALES-90 \| jira \| solved/m.test(checked), 'check-assist.js cases finds the case by a word: ' + checked.split('\n')[0]);

  // ---- into MxScout: the committed repository, linked — nothing shared to write ----
  const files = [];
  (function walk(d, rel) { fs.readdirSync(d, { withFileTypes: true }).forEach((e) => { if (e.isDirectory()) walk(path.join(d, e.name), rel + e.name + '/'); else files.push(rel + e.name); }); })(repo, '');
  const payload = files.map((f) => [f, fs.readFileSync(path.join(repo, f)).toString('base64')]);
  await mx.evaluate(`(async function () {
    var root = await navigator.storage.getDirectory();
    var names = [];
    for (var it = root.keys(), r = await it.next(); !r.done; r = await it.next()) names.push(r.value);
    for (var i = 0; i < names.length; i++) await root.removeEntry(names[i], { recursive: true });
    window.__walk = async function (p, create) {
      var parts = p.split('/'), name = parts.pop(), d = root;
      for (var j = 0; j < parts.length; j++) d = await d.getDirectoryHandle(parts[j], { create: !!create });
      return { d: d, name: name };
    };
    window.__dir = async function (p) { var d = root; var parts = p.split('/'); for (var j = 0; j < parts.length; j++) d = await d.getDirectoryHandle(parts[j], { create: true }); return d; };
    window.__read = async function (p) { try { var w = await window.__walk(p); var f = await (await w.d.getFileHandle(w.name)).getFile(); return await f.text(); } catch (e) { return null; } };
    window.__write = async function (p, data) { var w = await window.__walk(p, true); var wr = await (await w.d.getFileHandle(w.name, { create: true })).createWritable(); await wr.write(data); await wr.close(); return true; };
    window.__tree = async function (p) {
      var out = {};
      async function walk(d, at) {
        for (var it = d.entries(), r = await it.next(); !r.done; r = await it.next()) {
          var name = r.value[0], h = r.value[1], rel = at ? at + '/' + name : name;
          if (h.kind === 'directory') { if (name !== '.local') await walk(h, rel); }
          else { var f = await h.getFile(); out[rel] = { at: f.lastModified, text: await f.text() }; }
        }
      }
      await walk(await window.__dir(p), '');
      return out;
    };
    var files = ${JSON.stringify(payload)};
    for (var k = 0; k < files.length; k++) { var bin = atob(files[k][1]), u8 = new Uint8Array(bin.length); for (var b = 0; b < bin.length; b++) u8[b] = bin.charCodeAt(b); await window.__write('ShopApp/' + files[k][0], u8); }
    window.showDirectoryPicker = function () { return window.__dir('ShopApp'); };
    return true;
  })()`);
  const tree = (p) => mx.evaluate(`window.__tree(${JSON.stringify(p)})`);
  const read = (p) => mx.evaluate(`window.__read(${JSON.stringify(p)})`);
  const write = (p, text) => mx.evaluate(`window.__write(${JSON.stringify(p)}, ${JSON.stringify(text)})`);
  // What an agent and MxScout both write: mxscout.json, descriptions/, docs/, knowledge/ (README.md, AGENTS.md, GUIDE.md, GUIDE.html and
  // .gitignore are MxScout's alone, written when they are missing).
  const stamps = (tr) => JSON.stringify(Object.keys(tr).filter((k) => /^(mxscout\.json|descriptions\/|docs\/|knowledge\/)/.test(k)).sort().map((k) => [k, tr[k].at]));
  const tick = () => mx.evaluate('MxDocs.folderTick()');
  const committed = stamps(await tree('ShopApp/mxscout'));
  await mx.evaluate(`(function(){ var b = Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'All projects'); if (b) b.click(); return true; })()`);
  await until(`!!document.querySelector('.sidebar-new')`, 'list screen');
  await mx.evaluate(`document.querySelector('.sidebar-new').click()`);
  await until(`!!document.querySelector('.folder-pick')`, 'the card');
  await mx.evaluate(`document.querySelector('.folder-pick').click()`);
  await until(`MxStore.get('projects', 'kn-shop').then(function (p) { return !!p && !!MxStore.folderInfo('kn-shop'); })`, 'linked', 30000);
  t.ok(await until(`MxKnowledge.list('kn-shop').then(function (l) { return l.length === 2 && l.map(function (c) { return c.id; }).join() === 'SALES-90,SD-4711'; })`, 'cases taken', 15000),
    'picking the Mendix project takes the solved cases from mxscout/knowledge/ — the two notes that pass');
  await sleep(1500); await tick(); await sleep(1500); await tick(); await sleep(800);
  const after = await tree('ShopApp/mxscout');
  t.ok(stamps(after) === committed, 'and writes nothing shared: docs/ agent.js wrote is what MxScout would write, the note with personal data stays as it is');
  t.ok(after['knowledge/SD-9999-reported-with-a-name.md'].text === PRIVATE, 'the note with personal data is neither taken nor written over nor removed');
  const same = await mx.evaluate(`(async function () {
    var row = await MxStore.get('descriptions', 'kn-shop'), k = await MxStore.get('knowledge', 'kn-shop');
    var parts = MxRepoDocs.split(MxDescribe.toFile(row.value)).concat(MxKnowledge.toFiles(k.files));
    var h = await MxRepoDocs.descriptionsHash(parts, row.value.describedAt);
    var made = await MxDocs.repoDocs('kn-shop', h);
    var disk = await window.__tree('ShopApp/mxscout');
    return JSON.stringify(made.filter(function (f) { return !disk[f.path] || disk[f.path].text !== f.text; }).map(function (f) { return f.path; }));
  })()`);
  t.ok(same === '[]', 'made again in the browser from the same model, descriptions and cases: byte-identical to what agent.js wrote: ' + same);

  // ---- Solved cases: the list, the search, one case, may be out of date ----
  await goToSection(mx, 'Solved cases', '.dx-kn-list');
  const listInfo = JSON.parse(await mx.evaluate(`JSON.stringify({ rows: Array.from(document.querySelectorAll('.dx-kn-row')).map(function (r) { return [r.getAttribute('data-path'), r.getAttribute('data-stale')]; }),
    tabs: document.querySelectorAll('.dx-kn-index, .dx-kn-chip').length, opened: !!document.querySelector('.dx-kn-row.on') && !!document.querySelector('.dx-kn h2'),
    count: (function () { var s = Array.from(document.querySelectorAll('.tree-section')).find(function (n) { return /Solved cases/.test(n.textContent); }); return s ? s.textContent : ''; })() })`));
  t.ok(listInfo.rows.length === 2 && listInfo.tabs === 0 && listInfo.opened && listInfo.rows.find((r) => /SALES-90/.test(r[0]))[1] === 'true' && listInfo.rows.find((r) => /SD-4711/.test(r[0]))[1] === 'false',
    'Solved cases lists both in the one list beside the page, the first open beside it; the one whose flow changed since (its fingerprint moved) is marked "may be out of date", the other not: ' + JSON.stringify(listInfo.rows));
  t.ok(/Solved cases\s*2/.test(listInfo.count), 'the sidebar counts them: ' + listInfo.count);
  await mx.evaluate(`(function(){ var q = document.querySelector('.dx-kn-q'); q.value = 'nightly'; q.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const shown = await mx.evaluate(`Array.from(document.querySelectorAll('.dx-kn-row')).filter(function (r) { return !r.parentNode.hidden; }).map(function (r) { return r.getAttribute('data-path'); }).join()`);
  t.ok(shown === 'knowledge/SALES-90-sweep-removes-open-orders.md', 'the search finds a case by a word of its text: ' + shown);
  await mx.evaluate(`Array.from(document.querySelectorAll('.dx-kn-row')).find(function (r) { return /SALES-90/.test(r.getAttribute('data-path')); }).click()`);
  const one = JSON.parse(await until(`(function(){ var s = document.querySelectorAll('.dx-kn-sec'); if (s.length !== 5) return false; return JSON.stringify({
    secs: Array.from(s).map(function (x) { return x.getAttribute('data-section'); }), stale: (document.querySelector('.dx-kn-stale') || {}).textContent || '',
    list: document.querySelectorAll('.dx-kn-sec ul li').length, bold: !!document.querySelector('.dx-kn-sec b'), code: !!document.querySelector('.dx-kn-sec code'),
    related: !!Array.from(document.querySelectorAll('.dx-kn-related .link')).find(function (a) { return a.textContent === 'SD-4711'; }) }); })()`, 'one case'));
  t.ok(one.secs.join('|') === 'Problem|Cause|Solution|What did not work|How to recognise it next time', 'a case opens with its five sections, in order');
  t.ok(/May be out of date\. Sales\.SweepOrders changed since the case was solved/.test(one.stale), 'with the warning, naming the flow that changed: ' + one.stale);
  t.ok(one.list === 2 && one.bold && one.code, 'its simple Markdown drawn as elements: a list, bold, code');
  t.ok(one.related, 'and a related case linked by its id');
  t.ok(await mx.evaluate(`!document.querySelector('.dx-kn [style*="javascript"]') && !Array.from(document.querySelectorAll('.dx-kn *')).some(function (n) { return /<\\/?[a-z]/.test(n.textContent) && n.children.length === 0 && /<script/.test(n.textContent); })`), 'text only');

  // ---- an Assist item whose solution is a case: In the documentation ----
  await mx.evaluate(`MxAssist.apply('kn-shop', JSON.stringify({ format: 'mxscout-assist', version: 1, items: [{ id: 'SD-4711', kind: 'ticket', title: 'Orders created twice', status: 'done', verdict: 'bug', confidence: 'high', summary: 'Fixed.', knowledge: 'knowledge/SD-4711-orders-created-twice.md' }] })).then(function () { return true; })`);
  await goToSection(mx, 'Assist', '.dx-as');
  await until(`!!document.querySelector('.dx-as-li[data-id="SD-4711"]')`, 'the item');
  t.ok(await mx.evaluate(`(document.querySelector('.dx-as-li[data-id="SD-4711"] .dx-as-doc') || {}).textContent === 'in the docs'`), 'the Assist list says the item is in the documentation');
  await mx.evaluate(`document.querySelector('.dx-as-li[data-id="SD-4711"]').click()`);
  await until(`!!document.querySelector('.dx-as-case-link')`, 'the link');
  t.ok(/Solved case SD-4711 — Orders created twice/.test(await mx.evaluate(`document.querySelector('.dx-as-case').textContent`)), 'the item shows “In the documentation”, naming its case');
  await mx.evaluate(`document.querySelector('.dx-as-case-link').click()`);
  t.ok(await until(`(function(){ var a = Array.from(document.querySelectorAll('.tree-section.active')).map(function (n) { return n.textContent; }).join(); var p = document.querySelector('.dx-kn .dx-kn-path'); return /Solved cases/.test(a) && p && p.textContent === 'knowledge/SD-4711-orders-created-twice.md'; })()`, 'the case opened'),
    'and the link opens the case on the Solved cases screen');

  // ---- a note in the inbox: saved at once into knowledge/, with Undo ----
  const NEW = note({ id: 'SD-5000', kind: 'ticket', title: 'Totals round wrongly', flows: ['Sales.CreateOrder'], keywords: ['rounding'], problem: 'Order totals were a cent off.' });
  await write('ShopApp/mxscout/.local/inbox/case-SD-5000.md', NEW);
  await sleep(1100);
  await tick();
  const said = await until(`(function(){ var m = document.querySelector('.msg'); return m && /SD-5000/.test(m.textContent) && m.textContent; })()`, 'taken');
  t.ok(/Saved what the agent left in the folder’s inbox: the solved case SD-5000, written into ShopApp\/mxscout\/knowledge\/ — commit it with the fix\./.test(said), 'a case note left in the inbox is saved at once, and said: ' + said);
  t.ok(await until(`window.__read('ShopApp/mxscout/knowledge/SD-5000-totals-round-wrongly.md').then(function (x) { return x === ${JSON.stringify(NEW)}; })`, 'written'), 'written into knowledge/ under its id and title, as it came');
  t.ok(await until(`window.__read('ShopApp/mxscout/docs/index.md').then(function (x) { return /SD-5000 — Totals round wrongly/.test(x); })`, 'index follows', 15000), 'and docs/index.md lists it');
  await mx.evaluate(`Array.from(document.querySelector('.msg').querySelectorAll('button')).find(function (b) { return b.textContent === 'Undo'; }).click()`);
  t.ok(await until(`window.__read('ShopApp/mxscout/knowledge/SD-5000-totals-round-wrongly.md').then(function (x) { return x === null; })`, 'undone'), 'Undo takes it back — out of knowledge/ too');
  await until(`window.__read('ShopApp/mxscout/docs/index.md').then(function (x) { return !/SD-5000/.test(x); })`, 'index back', 15000);
  await write('ShopApp/mxscout/.local/inbox/case-private.md', PRIVATE.replace(/SD-9999/g, 'SD-9998'));
  await sleep(1100);
  await tick();
  const refused = await until(`(function(){ var m = document.querySelector('.msg'); return m && /case-private\\.md/.test(m.textContent) && m.textContent; })()`, 'refused');
  t.ok(/cannot use it/.test(refused) && /e-mail address/.test(refused), 'a note with personal data left in the inbox is refused, saying why: ' + refused);
  t.ok(await read('ShopApp/mxscout/knowledge/SD-9998-reported-with-a-name.md') === null && (await mx.evaluate(`MxKnowledge.list('kn-shop').then(function (l) { return l.length; })`)) === 2, 'and nothing of it is kept');

  // ---- through the agent channel ----
  await goToDocsTab(mx, 'agent', '.docs-agent button');
  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Share with an agent').click()`);
  const line = await until(`(function(){ var c = document.querySelector('.docs-agent .code-value'); return c && c.textContent; })()`, 'connection line');
  const token = (/token ([0-9a-f]{48})\./.exec(line) || [])[1];
  const CH = note({ id: 'other-question', kind: 'other', title: 'Who may sweep orders', flows: ['Sales.SweepOrders'], keywords: ['sweep', 'roles'], problem: 'Someone asked who may run the sweep.' });
  const res = await fetch(t.MX + '/api/agent/descriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: 'mxscout-knowledge', version: 1, cases: [{ text: CH }] }) });
  t.ok(res.status === 200 && (await res.json()).format === 'mxscout-knowledge', 'the channel accepts a solved case (format "mxscout-knowledge")');
  t.ok(await until(`window.__read('ShopApp/mxscout/knowledge/other-question-who-may-sweep-orders.md').then(function (x) { return !!x; })`, 'channel case written', 15000) &&
    /Saved at once: the solved case other-question/.test(await until(`(function(){ var s = document.querySelector('.docs-agent-saved'); return s && s.textContent; })()`, 'saved')),
    'saved at once and written into knowledge/, with Undo on the card');
  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Stop sharing').click()`);

  // ---- the export: without the cases unless asked ----
  await mx.evaluate(`(function(){ window.__got = []; var real = URL.createObjectURL; URL.createObjectURL = function (blob) { blob.text().then(function (x) { window.__got.push(x); }); return real.call(URL, blob); }; return true; })()`);
  await goToDocsTab(mx, 'export', '.docs-export');
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Export documentation…').click()`);
  await until(`!!document.querySelector('.export-cases')`, 'the tick');
  t.ok(await mx.evaluate(`!document.querySelector('.export-cases').checked && /Include solved cases \\(3\\)/.test(document.querySelector('.export-cases-choice').textContent)`), 'Export offers “Include solved cases (3)”, not ticked');
  const build = async (label) => {
    const n = await mx.evaluate('window.__got.length');
    await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === ${JSON.stringify(label)}).click()`);
    return until(`window.__got.length > ${n} && window.__got[window.__got.length - 1]`, label, 30000);
  };
  const md0 = await build('Build Markdown'), html0 = await build('Build file');
  t.ok(!/Solved cases|SD-4711|Orders created twice/.test(md0) && !/SD-4711|"cases":/.test(html0), 'by default neither the HTML file nor the Markdown file carries a case');
  await mx.evaluate(`(function(){ var b = document.querySelector('.export-cases'); b.click(); return true; })()`);
  await until(`document.querySelector('.export-cases').checked`, 'ticked');
  const md1 = await build('Build Markdown'), html1 = await build('Build file');
  t.ok(/^## Solved cases$/m.test(md1) && /^### SD-4711 — Orders created twice$/m.test(md1) && /^#### What did not work$/m.test(md1) && /May be out of date\.\*\* Sales\.SweepOrders changed since/.test(md1),
    'ticked, the Markdown file has a Solved cases section, each case with its sections and what changed since');
  t.ok(/"cases":\[/.test(html1) && /Orders created twice/.test(html1) && /MxDocsKnowledge/.test(html1) && !/anna\.nowak/.test(html1), 'and the HTML file carries them, with the page that draws them');
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Close').click()`);

  // ---- a package carries them; opening it writes them into the folder it is kept in ----
  await goToSection(mx, 'Overview');
  await sleep(300);
  await mx.evaluate(`(function(){ if (!Array.from(document.querySelectorAll('button')).find(b => /Package/.test(b.textContent))) document.querySelector('.xe-more .xe-icon-btn').click(); return true; })()`);
  await until(`!!Array.from(document.querySelectorAll('button')).find(b => /Package/.test(b.textContent))`, 'project menu');
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(b => /Package/.test(b.textContent)).click()`);
  await until(`!!Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Create package')`, 'package dialog');
  t.ok(/solved cases(, if any,)? travel inside the encrypted part/.test(await mx.evaluate(`document.querySelector('.modal').textContent`)), 'the package dialog says the solved cases travel');
  const before = await mx.evaluate('window.__got.length');
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Create package').click()`);
  const code = await until(`document.querySelector('.code-value') && document.querySelector('.code-value').textContent`, 'code', 20000);
  await until(`window.__got.length > ${before}`, 'package file', 15000);
  const pk = JSON.parse(await mx.evaluate(`(async function () {
    var env = JSON.parse(window.__got[window.__got.length - 1]);
    var p = await MxCrypto.open(env, ${JSON.stringify(code)});
    window.__payload = p;
    return JSON.stringify((p.knowledge || []).map(function (c) { return c.path; }));
  })()`));
  t.ok(pk.length === 3 && pk.indexOf('knowledge/SD-4711-orders-created-twice.md') !== -1 && pk.every((p) => !/SD-9999/.test(p)), 'the package carries the solved cases (not a note MxScout could not keep): ' + JSON.stringify(pk));
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Done').click()`);
  const took = await mx.evaluate(`(async function () {
    var now = new Date().toISOString();
    await MxStore.saveProjectWithModel({ id: 'kn-pkg', name: 'FromPackage', createdAt: now, updatedAt: now, source: { kind: 'test' }, bytes: 1, summary: null }, window.__payload.model);
    var n = await MxKnowledge.takeFromPackage('kn-pkg', window.__payload.knowledge);
    await MxStore.linkFolder('kn-pkg', await window.__dir('PkgFolder'));
    return n;
  })()`);
  t.ok(took === 3, 'opening it takes the cases into the project');
  t.ok(await until(`window.__read('PkgFolder/knowledge/SD-4711-orders-created-twice.md').then(function (x) { return x === ${JSON.stringify(SD)}; })`, 'in the folder', 15000),
    'and the folder it is kept in gets them in knowledge/, as they were written');

  // ---- what MxScout wrote, read by agent.js: docs/ current, the same bytes ----
  const shared = await tree('ShopApp/mxscout');
  const back = path.join(tmp, 'Back');
  fs.mkdirSync(back);
  fs.copyFileSync(path.join(repo, 'ShopApp.mpr'), path.join(back, 'ShopApp.mpr'));
  fs.cpSync(path.join(repo, '.git'), path.join(back, '.git'), { recursive: true });
  Object.keys(shared).forEach((k) => { const f = path.join(back, 'mxscout', k); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, shared[k].text); });
  t.ok(/docs\/ is current/.test(run([agent, 'update-docs', '--folder', back])), 'agent.js on what MxScout wrote (a case added through the channel): docs/ is current');
  fs.rmSync(path.join(back, 'mxscout', 'docs'), { recursive: true });
  run([agent, 'update-docs', '--folder', back]);
  const differ = Object.keys(shared).filter((k) => /^docs\//.test(k) && readText(path.join(back, 'mxscout', k)) !== shared[k].text);
  t.ok(!differ.length && /other-question — Who may sweep orders/.test(readText(path.join(back, 'mxscout', 'docs', 'index.md'))), 'and made again in Node, every file of docs/ is byte-identical to MxScout’s' + (differ.length ? ': ' + differ.join(', ') : ''));
  fs.rmSync(tmp, { recursive: true, force: true });
};
