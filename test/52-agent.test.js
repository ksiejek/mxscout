/* The agent channel: an agent on this machine reads the AI pack from MxScout and sends descriptions back
 * (server/routes/agent.js, "Share with an agent" in Documentation, skills/mendix-describe/agent.js).
 *
 * What this has to get right is who can read the pack and what happens to it:
 *  - nothing is served until the person shares, and then only to the token the browser was given;
 *  - a module comes back as the lines the pack's own index gives, no more;
 *  - what an agent sends back is NOT kept: it waits for the person, and MxScout checks it first;
 *  - sharing ends with the person's say-so, and a different pack never keeps the old token. */
'use strict';
const { goToSection, goToDocsTab } = require('./helpers');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

module.exports = async function (t) {
  const B = t.MX;
  const AUTH = (token) => ({ Authorization: 'Bearer ' + token });
  const JSONH = { 'Content-Type': 'application/json' };

  // ---- before anything is shared ----
  t.ok((await fetch(B + '/api/agent/status')).status === 404, 'nothing is served while nothing is shared');

  // ---- the pack, from the real exporter, in the real UI ----
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxDescribe && !!window.MxDocsData', 15000, 'MxScout loaded');
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const pack = await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    await MxStore.saveProjectWithModel({ id: 'pag', name: 'AgentDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, model);
    return MxDescribe.pack(MxDocsData.build(model, { name: 'AgentDemo' })).text;
  })()`);
  const lines = pack.split('\n');

  // The server refuses what is not a pack, and a wrong Host before it looks at anything.
  const bad = await fetch(B + '/api/agent/share', { method: 'POST', headers: JSONH, body: JSON.stringify({ text: 'hello' }) });
  t.ok(bad.status === 400, 'something that is not an AI pack is refused');
  const rebound = await new Promise((resolve) => {
    const u = new URL(B);
    const req = http.request({ host: u.hostname, port: u.port, path: '/api/agent/share', method: 'POST', headers: Object.assign({ Host: 'attacker.example:' + u.port }, JSONH) },
      (res) => { res.resume(); resolve(res.statusCode); });
    req.end(JSON.stringify({ text: pack }));
  });
  t.ok(rebound === 403, 'a request that arrives under another name — a rebinding page — is refused before anything else');
  const foreign = await fetch(B + '/api/agent/share', { method: 'POST', headers: Object.assign({ Origin: 'https://evil.example' }, JSONH), body: JSON.stringify({ text: pack }) });
  t.ok(foreign.status === 403, 'a page on another origin cannot start sharing');

  // ---- sharing, through the button ----
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button')).find(n => n.textContent.trim() === 'AgentDemo')`, 10000, 'project');
  await mx.evaluate(`Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button')).find(n => n.textContent.trim() === 'AgentDemo').click()`);
  await goToDocsTab(mx, 'agent', '.docs-agent button');
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Share with an agent')`, 10000, 'share button');
  t.ok((await fetch(B + '/api/agent/status')).status === 404, 'opening the section shares nothing: it takes a press');
  // Karol, 2026-10-14: the press drew the page again at its top, away from the card the line appears in.
  // The Agent channel tab alone is shorter than the screen: room below it, so there is a place to scroll to.
  await mx.viewport(1280, 600);
  const before = await mx.evaluate(`(function(){ document.querySelector('.docs-landing').style.paddingBottom = '900px'; var m = document.querySelector('main.main'); m.scrollTop = 400; return m.scrollTop; })()`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Share with an agent').click()`);
  const line = await mx.waitFor(`(function(){ var c = document.querySelector('.docs-agent .code-value'); return c && c.textContent; })()`, 10000, 'connection line');
  await new Promise((r) => setTimeout(r, 100));
  const after = await mx.evaluate(`document.querySelector('main.main').scrollTop`);
  // What must not happen is the jump back to the top. The line makes the card taller, and the browser keeps
  // what was on screen in view (scroll anchoring), so the offset may grow by the line's height.
  t.ok(before > 0 && after >= before - 2 && after - before < 300, 'the page stays where it was when the line appears, not back at its top: ' + before + ' → ' + after);
  const token = (/token ([0-9a-f]{48})\./.exec(line) || [])[1];
  t.ok(token && line.indexOf(B) !== -1, 'sharing gives a line to paste to the agent: the address and a token');

  // ---- the agent's side ----
  t.ok((await fetch(B + '/api/agent/status')).status === 403, 'without the token the pack is not served');
  t.ok((await fetch(B + '/api/agent/status', { headers: AUTH('0'.repeat(48)) })).status === 403, 'nor with a wrong one');
  const status = await (await fetch(B + '/api/agent/status', { headers: AUTH(token) })).json();
  const index = pack.slice(pack.indexOf('## index')).split('\n').slice(2).filter((l) => /^\S+ \| \d+-\d+ \| /.test(l));
  t.ok(status.project === 'AgentDemo' && status.modules.length === index.length && status.modules[0].name === index[0].split(' | ')[0],
    'the token reads what is shared: the project and its modules, as the pack’s own index lists them: ' + status.modules.map((m) => m.name).join(', '));
  const first = status.modules[0];
  const [from, to] = first.lines.split('-').map(Number);
  const mod = await (await fetch(B + '/api/agent/module?name=' + encodeURIComponent(first.name), { headers: AUTH(token) })).text();
  t.ok(mod === lines.slice(from - 1, to).join('\n') + '\n' && mod.startsWith('## module ' + first.name), 'one module comes back as exactly its lines, no more');
  t.ok((await fetch(B + '/api/agent/module?name=Nope', { headers: AUTH(token) })).status === 404, 'a module that is not in it is not found');
  // The pack the tab shared was built a moment after this one: only the "generated" line may differ.
  const noStamp = (s) => s.replace(/^generated: .*$/m, '');
  t.ok(noStamp(await (await fetch(B + '/api/agent/pack', { headers: AUTH(token) })).text()) === noStamp(pack), 'the whole pack is there for the checker, line for line');

  // The skill's own client reads the same thing.
  const client = path.join(__dirname, '..', 'skills', 'mendix-describe', 'agent.js');
  const run = (a, env) => spawnSync(process.execPath, [client].concat(a), { encoding: 'utf8', env: Object.assign({}, process.env, { MXSCOUT_URL: B, MXSCOUT_TOKEN: token }, env) });
  const viaClient = run(['module', first.name]);
  t.ok(viaClient.status === 0 && viaClient.stdout === mod, 'agent.js, the skill’s client, reads a module the same way');
  t.ok(run(['status']).stdout.indexOf('project: AgentDemo') !== -1, 'and lists the modules');
  const elsewhere = run(['status'], { MXSCOUT_URL: 'http://example.com:4288' });
  t.ok(elsewhere.status !== 0 && /Refusing/.test(elsewhere.stderr), 'and refuses an address that is not this machine — the token goes nowhere else');

  // ---- what an agent sends back is saved at once, with Undo (Karol, 2026-10-14: no Import step) ----
  const desc = { format: 'mxscout-descriptions', version: 1, by: 'test agent', microflows: { 'Sales.CreateOrder': { text: 'Opens a fresh order.' } }, risks: [{ level: 'P2', title: 'Saved twice', fix: 'Disable the button.' }] };
  t.ok((await fetch(B + '/api/agent/descriptions', { method: 'POST', headers: JSONH, body: JSON.stringify(desc) })).status === 403, 'descriptions need the token too');
  t.ok((await fetch(B + '/api/agent/descriptions', { method: 'POST', headers: Object.assign({}, JSONH, AUTH(token)), body: JSON.stringify({ format: 'other' }) })).status === 400, 'a file that is not a descriptions file is refused');
  t.ok(await mx.evaluate(`!!document.querySelector('.docs-agent-auto input') && document.querySelector('.docs-agent-auto input').checked`), 'saving at once is on unless turned off');
  const sent = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mxagent-'));
  const send = (value) => { fs.writeFileSync(path.join(sent, 'd.json'), JSON.stringify(value)); return run(['send', path.join(sent, 'd.json')]); };
  t.ok(send(desc).status === 0, 'agent.js sends the finished file');
  await mx.waitFor(`MxDocs.current() && MxDocs.current().ai && MxDocs.current().ai.risks.length === 1`, 10000, 'saved');
  t.ok(await mx.evaluate(`MxDocs.current().flows['microflow:Sales.CreateOrder'].desc === 'Opens a fresh order.'`), 'the first descriptions of a project are saved at once, with no press');
  t.ok(await mx.waitFor(`!!Array.from(document.querySelectorAll('.docs-agent-saved button')).find(b => b.textContent === 'Undo') && !Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Import them')`, 5000, 'undo'),
    'the card says what was saved and offers Undo, not Import them');
  t.ok((await (await fetch(B + '/api/agent/status', { headers: AUTH(token) })).json()).descriptions === null, 'and the inbox is empty again');
  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-agent-saved button')).find(b => b.textContent === 'Undo').click()`);
  t.ok(await mx.waitFor(`MxStore.get('descriptions', 'pag').then(function (r) { return !r; })`, 5000, 'undone'), 'Undo puts the descriptions back as they were — here, none');

  // ---- an "add" part is saved at once; a whole file over kept descriptions waits, and says it replaces them ----
  send(desc);
  await mx.waitFor(`MxDocs.current() && MxDocs.current().ai && MxDocs.current().ai.risks.length === 1`, 10000, 'saved again');
  send(Object.assign({ add: true }, desc, { microflows: { 'Sales.CreateOrder': { text: 'Opens an order and numbers it.' } } }));
  t.ok(await mx.waitFor(`MxDocs.current() && MxDocs.current().flows['microflow:Sales.CreateOrder'].desc === 'Opens an order and numbers it.'`, 10000, 'add saved'), 'a part that adds is saved at once over what is kept');
  send(desc);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Import them')`, 10000, 'whole file waits');
  t.ok(/replaces the descriptions this project has now/.test(await mx.evaluate(`(document.querySelector('.docs-agent .warn-text') || {}).textContent || ''`)),
    'a whole file over kept descriptions is not saved at once: it waits for Import them and says it replaces them');
  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Not now').click()`);

  // ---- with saving at once off, everything waits for the press ----
  await mx.evaluate(`(function(){ var c = document.querySelector('.docs-agent-auto input'); c.click(); return true; })()`);
  await mx.waitFor(`MxStore.get('projects', 'pag').then(function (p) { return p && p.agentAutoSave === false; })`, 5000, 'switched off');
  send(Object.assign({ add: true }, desc, { microflows: { 'Sales.CreateOrder': { text: 'Third text.' } } }));
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Import them')`, 10000, 'add offer');
  t.ok(await mx.evaluate(`MxDocs.current().flows['microflow:Sales.CreateOrder'].desc === 'Opens an order and numbers it.' && !document.querySelector('.docs-agent .warn-text')`),
    'switched off, even a part that adds waits for Import them, with no replace warning');
  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Import them').click()`);
  t.ok(await mx.waitFor(`MxDocs.current().flows['microflow:Sales.CreateOrder'].desc === 'Third text.'`, 10000, 'imported'), 'and pressing it saves it, like any import');
  await mx.evaluate(`(function(){ var c = document.querySelector('.docs-agent-auto input'); if (!c.checked) c.click(); return true; })()`);
  fs.rmSync(sent, { recursive: true, force: true });

  // ---- stopping ----
  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Stop sharing').click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Share with an agent')`, 8000, 'stopped');
  t.ok((await fetch(B + '/api/agent/status', { headers: AUTH(token) })).status === 404, 'stopped, the server holds nothing and the token is worth nothing');

  // A fresh share is a new token; without the old one a pack never inherits it.
  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Share with an agent').click()`);
  const line2 = await mx.waitFor(`(function(){ var c = document.querySelector('.docs-agent .code-value'); return c && c.textContent; })()`, 10000, 'second line');
  const token2 = (/token ([0-9a-f]{48})\./.exec(line2) || [])[1];
  t.ok(token2 && token2 !== token && (await fetch(B + '/api/agent/status', { headers: AUTH(token) })).status === 403, 'sharing again mints a new token; the old one stays dead');
  const strange = await fetch(B + '/api/agent/share', { method: 'POST', headers: JSONH, body: JSON.stringify({ text: pack }) });
  const strangeToken = (await strange.json()).token;
  t.ok(strangeToken !== token2 && (await fetch(B + '/api/agent/status', { headers: AUTH(token2) })).status === 403,
    'a process that starts its own share does not get this one’s token — and it replaces what was shared, so the tab’s token stops working');

  // Whoever holds the token can end it.
  await fetch(B + '/api/agent/share', { method: 'DELETE', headers: AUTH(strangeToken) });
  t.ok((await fetch(B + '/api/agent/status', { headers: AUTH(strangeToken) })).status === 404, 'and the whole thing is gone when sharing stops');
  await mx.close();
};
