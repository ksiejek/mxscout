/* The documentation as Markdown on the agent channel (GET /api/agent/docs, `node agent.js docs`).
 *
 * An agent connecting to a shared project reads the documentation first — what an agent understood
 * earlier — and checks it against the pack. What this has to get right:
 *  - it is behind the same press and the same token as the pack, and goes when sharing stops;
 *  - with no descriptions there is none, and the answer says so plainly;
 *  - it is the Markdown copy the export writes, of the own modules, after a header that says what it
 *    is, and a description whose flow changed since it was written is marked out of date;
 *  - it follows the descriptions the tab keeps: an agent's save, and Undo;
 *  - the pack itself does not change because of it. */
'use strict';
const { goToSection, goToDocsTab, readText } = require('./helpers');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

module.exports = async function (t) {
  const B = t.MX;
  const AUTH = (token) => ({ Authorization: 'Bearer ' + token });

  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxDescribe && !!window.MxDocsData', 15000, 'MxScout loaded');
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const other = await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    await MxStore.saveProjectWithModel({ id: 'pdocsmd', name: 'DocsMdDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, model);
    var d = MxDocsData.build(model, { name: 'DocsMdDemo' });
    return Object.keys(d.flows).map(function (k) { return d.flows[k]; }).filter(function (f) { return f.kind === 'microflow' && f.qn !== 'Sales.CreateOrder'; })[0].qn;
  })()`);

  // ---- share, through the button ----
  await mx.navigate(t.MX);
  const pick = `Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button')).find(n => n.textContent.trim() === 'DocsMdDemo')`;
  await mx.waitFor(`!!${pick}`, 10000, 'project');
  await mx.evaluate(`${pick}.click()`);
  await goToDocsTab(mx, 'agent', '.docs-agent button');
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Share with an agent')`, 10000, 'share button');
  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Share with an agent').click()`);
  const line = await mx.waitFor(`(function(){ var c = document.querySelector('.docs-agent .code-value'); return c && c.textContent; })()`, 10000, 'connection line');
  const token = (/token ([0-9a-f]{48})\./.exec(line) || [])[1];
  t.ok(!!token, 'sharing gives a token');

  const client = path.join(__dirname, '..', 'skills', 'mendix-describe', 'agent.js');
  const run = (a) => spawnSync(process.execPath, [client].concat(a), { encoding: 'utf8', env: Object.assign({}, process.env, { MXSCOUT_URL: B, MXSCOUT_TOKEN: token }) });
  const docs = () => fetch(B + '/api/agent/docs', { headers: AUTH(token) });
  const status = async () => (await fetch(B + '/api/agent/status', { headers: AUTH(token) })).json();

  // ---- no descriptions: no documentation, said plainly ----
  t.ok((await fetch(B + '/api/agent/docs')).status === 403, 'the documentation needs the token, like the pack');
  const none = await docs();
  const noneBody = await none.json();
  t.ok(none.status === 404 && noneBody.documentation === false && /no descriptions/.test(noneBody.error), 'with no descriptions there is no documentation, and the answer says why: ' + noneBody.error);
  t.ok((await status()).documentation === null, 'and the status says there is none');
  const cliNone = run(['docs']);
  t.ok(cliNone.status === 0 && /^No documentation yet/.test(cliNone.stdout), 'agent.js docs says plainly that there is none yet: ' + cliNone.stdout.trim());
  t.ok(/documentation: none yet/.test(run(['status']).stdout), 'and agent.js status says so too');
  const noStamp = (s) => s.replace(/^generated: .*$/m, '');
  const packBefore = await (await fetch(B + '/api/agent/pack', { headers: AUTH(token) })).text();

  // ---- an agent's descriptions are saved: the documentation is there, with the out-of-date mark ----
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mxdocsmd-'));
  const send = (value) => { fs.writeFileSync(path.join(dir, 'd.json'), JSON.stringify(value)); return run(['send', path.join(dir, 'd.json')]); };
  // A fingerprint that is not the flow's: written before the flow changed.
  const first = { format: 'mxscout-descriptions', version: 1, by: 'test agent', app: { summary: 'Takes orders for an invented shop.' },
    microflows: { 'Sales.CreateOrder': { text: 'Opens a fresh order.', hash: '00000000' } } };
  t.ok(send(first).status === 0, 'agent.js sends descriptions');
  await mx.waitFor(`MxDocs.current() && MxDocs.current().ai && MxDocs.current().flows['microflow:Sales.CreateOrder'].desc === 'Opens a fresh order.'`, 10000, 'saved');
  const got = await mx.waitFor(`fetch('/api/agent/docs', { headers: { Authorization: 'Bearer ${token}' } }).then(function (r) { return r.ok ? r.text() : null; })`, 10000, 'documentation shared');
  const res = await docs();
  t.ok(/^text\/markdown/.test(res.headers.get('content-type') || ''), 'it comes as Markdown');
  const head = got.split('\n').slice(0, 14).join('\n');
  t.ok(got.startsWith('# MxScout documentation — DocsMdDemo\n') && /^project: DocsMdDemo$/m.test(head) && /^mendix: /m.test(head) && /^generated: \d{4}-/m.test(head),
    'it starts with a header: the project, the Mendix version, when it was generated');
  t.ok(/^modules: the own modules \(\d+\)/m.test(head), 'which says it is the own modules');
  t.ok(/^flows described: 1 of \d+$/m.test(head) && /^out of date: 1 /m.test(head), 'how many flows are described and how many of them are out of date');
  t.ok(head.indexOf('> This is what an agent understood earlier; verify against the AI pack before concluding.') !== -1, 'and that it is a map to verify against the pack');
  t.ok(got.indexOf('Opens a fresh order. (out of date — the microflow changed since this was written)') !== -1, 'the flow that changed since its description was written is marked out of date');
  const sameAsExport = await mx.evaluate(`(function(){ var d = MxDocs.current(), own = {}; d.modules.forEach(function (m) { own[m.name] = !m.marketplace; });
    return MxDocsView.markdown(MxDocsFile.withDerived(MxDocsFile.subset(d, own))); })()`);
  t.ok(got.endsWith(sameAsExport), 'after the header it is the Markdown copy the export writes, of the own modules');
  const st = await status();
  t.ok(st.documentation && st.documentation.described === 1 && st.documentation.stale === 1 && st.documentation.bytes === Buffer.byteLength(got), 'the status says there is documentation, and how much is out of date');
  t.ok(/documentation: yes — 1 of \d+ flows described, 1 out of date/.test(run(['status']).stdout), 'and agent.js status says it too');
  const cli = run(['docs']);
  t.ok(cli.status === 0 && cli.stdout === got, 'agent.js docs prints it');
  const outFile = path.join(dir, 'docs.md');
  t.ok(run(['docs', '--out', outFile]).status === 0 && readText(outFile) === got, 'and writes it to a file with --out');

  const packAfter = await (await fetch(B + '/api/agent/pack', { headers: AUTH(token) })).text();
  t.ok(noStamp(packAfter) === noStamp(packBefore) && packAfter.indexOf('MxScout documentation') === -1, 'the pack is the same pack: the documentation is beside it, not in it');

  // ---- it follows what the tab keeps: another save, then Undo ----
  send({ format: 'mxscout-descriptions', version: 1, add: true, microflows: { [other]: { text: 'Another invented flow.' } } });
  const after = await mx.waitFor(`fetch('/api/agent/docs', { headers: { Authorization: 'Bearer ${token}' } }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (x) { return /^flows described: 2 of/m.test(x) && x; })`, 10000, 'documentation after the save');
  t.ok(after && after.indexOf('Another invented flow.') !== -1, 'after an agent’s save the documentation carries what was added');
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.docs-agent-saved button')).find(b => b.textContent === 'Undo')`, 5000, 'undo');
  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-agent-saved button')).find(b => b.textContent === 'Undo').click()`);
  const undone = await mx.waitFor(`fetch('/api/agent/docs', { headers: { Authorization: 'Bearer ${token}' } }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (x) { return /^flows described: 1 of/m.test(x) && x; })`, 10000, 'documentation after Undo');
  t.ok(undone && undone.indexOf('Another invented flow.') === -1, 'and after Undo it is back to what is kept');

  // ---- an update, connected: the checker reads what is described, and what is out of date, from it ----
  const checker = path.join(__dirname, '..', 'skills', 'mendix-describe', 'check-descriptions.js');
  const packFile = path.join(dir, 'pack.md'), docsFile = path.join(dir, 'docs-now.md');
  run(['pack', packFile]); run(['docs', '--out', docsFile]);
  const todoAll = spawnSync(process.execPath, [checker, 'todo', packFile, '--list'], { encoding: 'utf8' }).stdout;
  const todoDocs = spawnSync(process.execPath, [checker, 'todo', packFile, docsFile, '--list'], { encoding: 'utf8' }).stdout;
  const count = (s) => Number((/^(\d+) flows to describe/.exec(s) || [])[1]);
  t.ok(/^ {4}Sales\.CreateOrder$/m.test(todoDocs) && /Sales \(pack line \d+\): \d+ new, 1 changed/.test(todoDocs) && /^ {4}/m.test(todoAll),
    'check-descriptions todo, given the documentation, lists the described flow marked out of date as changed: ' + todoDocs.split('\n')[0]);
  t.ok(count(todoAll) > 0 && count(todoDocs) === count(todoAll) && !/overview is missing/.test(todoDocs) && /overview is missing/.test(todoAll),
    'and knows the overview is there — an update starts from what is described, not from nothing');

  // ---- stopping drops it ----
  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Stop sharing').click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Share with an agent')`, 8000, 'stopped');
  const gone = await docs();
  t.ok(gone.status === 404 && (await gone.json()).documentation === undefined, 'stopped, the documentation is gone with the pack');
  fs.rmSync(dir, { recursive: true, force: true });
  await mx.close();
};
