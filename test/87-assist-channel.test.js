/* Assist items on the agent channel, in an import, and NOT in the exported documentation.
 *
 * Karol, 2026-10-15: the items are a local base — never in the .mxscout package (test 7) and never in
 * the exported documentation, the HTML file or its Markdown copy. The one place they go is the
 * documentation the local agent reads, as a short list, so it knows what is open and what is closed.
 * What this holds:
 *  - POST /api/agent/descriptions takes an Assist envelope too, behind the same token and Host check;
 *  - the tab saves it at once, with Undo — and with "save at once" off, waits for Save them;
 *  - an update from the agent moves an item; the shared documentation follows every change;
 *  - Import descriptions… takes an Assist file the same way;
 *  - the exported HTML file, its Markdown copy and the data inside it carry no item. */
'use strict';
const { goToDocsTab } = require('./helpers');
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const B = t.MX;
  const AUTH = (token) => ({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' });
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxAssist && !!window.MxDocsData', 15000, 'MxScout loaded');
  await mx.viewport(1440, 900);
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const OLD = { id: 'OLD-9', title: 'A ticket an older descriptions file carried', verdict: 'bug', confidence: 'high', summary: 'It holds.', date: '2026-10-14' };
  const desc = { format: 'mxscout-descriptions', version: 1, app: { summary: 'Takes orders for an invented shop.' }, microflows: { 'Sales.CreateOrder': { text: 'Opens a fresh order.' } }, tickets: [OLD] };
  const T1 = { id: 'AS-1', kind: 'ticket', title: 'Invoices print the wrong date', verdict: 'data-config', confidence: 'medium', summary: 'The date comes from a setting.', reply: 'Please check the setting.' };
  await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    var now = new Date().toISOString();
    await MxStore.saveProjectWithModel({ id: 'pac', name: 'AssistChannelDemo', createdAt: now, updatedAt: now, source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, model);
    await MxStore.put('descriptions', { projectId: 'pac', importedAt: now, fileName: 'd.json', value: MxDescribe.parse(${JSON.stringify(JSON.stringify(desc))}).value });
    await MxAssist.apply('pac', JSON.stringify({ format: 'mxscout-assist', version: 1, items: [${JSON.stringify(T1)}] }));
    return true;
  })()`);

  // ---- share ----
  await mx.navigate(t.MX);
  const pick = `Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button')).find(n => n.textContent.trim() === 'AssistChannelDemo')`;
  await mx.waitFor(`!!${pick}`, 10000, 'project');
  await mx.evaluate(`${pick}.click()`);
  await goToDocsTab(mx, 'agent', '.docs-agent button');
  await mx.waitFor(`(MxAssist.peek('pac') || []).length === 2`, 8000, 'the older ticket moved to Assist');
  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Share with an agent').click()`);
  const line = await mx.waitFor(`(function(){ var c = document.querySelector('.docs-agent .code-value'); return c && c.textContent; })()`, 10000, 'connection line');
  const token = (/token ([0-9a-f]{48})\./.exec(line) || [])[1];
  t.ok(!!token, 'sharing gives a token');
  const docs = () => fetch(B + '/api/agent/docs', { headers: AUTH(token) }).then((r) => r.ok ? r.text() : '');
  const waitDocs = (re, what) => mx.waitFor(`fetch('/api/agent/docs', { headers: { Authorization: 'Bearer ${token}' } }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (x) { return ${re}.test(x) && x; })`, 10000, what);

  // ---- the documentation the agent reads lists them ----
  const first = await docs();
  const section = first.slice(first.indexOf('\n## Assist\n'));
  t.ok(first.indexOf('\n## Assist\n') !== -1 && /^2 items on the Assist page, 2 open\./m.test(section) && /^\| Id \| Kind \| Title \| Status \| Planned \|$/m.test(section),
    'the documentation the agent reads ends with an Assist section: how many items, how many open, and a table');
  t.ok(/^\| AS-1 \| ticket \| Invoices print the wrong date \| open \| {2}\|$/m.test(section) && /^\| OLD-9 \| ticket \| A ticket an older descriptions file carried \| open \| {2}\|$/m.test(section),
    'one row per item — id, kind, title, status, planned — the ticket an older file carried among them');
  t.ok(section.indexOf('Please check the setting.') === -1 && section.indexOf('The date comes from') === -1, 'only the list: what an item says stays in MxScout');

  // ---- the channel takes an envelope ----
  const T2 = { id: 'AS-2', kind: 'ticket', title: 'Search ignores accents', verdict: 'bug', confidence: 'high', summary: 'The search compares bytes.' };
  const env = (items) => JSON.stringify({ format: 'mxscout-assist', version: 1, items: items });
  const post = (body, tok) => fetch(B + '/api/agent/descriptions', { method: 'POST', headers: tok === null ? { 'Content-Type': 'application/json' } : AUTH(tok || token), body: body });
  t.ok((await post(env([T2]), null)).status === 403, 'an envelope without the token is refused');
  const wrong = await post(JSON.stringify({ format: 'mxscout-other', items: [] }));
  t.ok(wrong.status === 400 && /mxscout-assist/.test((await wrong.json()).error), 'a body of another format is refused, naming the two it takes');
  const okRes = await post(env([T2]));
  const okBody = await okRes.json();
  t.ok(okRes.status === 200 && okBody.accepted && okBody.format === 'mxscout-assist', 'an Assist envelope is accepted: ' + JSON.stringify(okBody));
  const saved = await mx.waitFor(`(function(){ var s = document.querySelector('.docs-agent-saved'); return (MxAssist.peek('pac') || []).some(function (x) { return x.id === 'AS-2'; }) && s && s.textContent; })()`, 10000, 'saved at once');
  t.ok(/^Saved at once: the ticket AS-2 on the Assist page\.Undo$/.test(saved), 'the tab saves it at once and says so, with Undo: ' + saved);
  t.ok(!!(await waitDocs('/^\\| AS-2 \\| ticket \\| Search ignores accents \\| open /m', 'docs with AS-2')), 'and the documentation the agent reads lists it');

  // ---- a move from the agent, then Undo ----
  await post(env([{ id: 'AS-1', kind: 'ticket', update: true, updated: '2026-10-30', status: 'done', planned: '2026-10-30', history: [{ date: '2026-10-30', what: 'Fixed in the setting.', by: 'person' }] }]));
  await mx.waitFor(`(MxAssist.peek('pac') || []).some(function (x) { return x.id === 'AS-1' && x.status === 'done'; })`, 10000, 'moved');
  t.ok(!!(await waitDocs('/^\\| AS-1 \\| ticket \\| Invoices print the wrong date \\| done \\| 2026-10-30 \\|$/m', 'docs with the move')), 'a move from the agent closes the item, and the list the agent reads follows');
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.docs-agent-saved button')).find(b => b.textContent === 'Undo')`, 5000, 'undo');
  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-agent-saved button')).find(b => b.textContent === 'Undo').click()`);
  await mx.waitFor(`(MxAssist.peek('pac') || []).some(function (x) { return x.id === 'AS-1' && x.status === 'open' && !x.planned; })`, 10000, 'undone');
  t.ok(!!(await waitDocs('/^\\| AS-1 \\| ticket \\| Invoices print the wrong date \\| open \\| {2}\\|$/m', 'docs after undo')) && (await mx.evaluate(`MxAssist.peek('pac').length`)) === 3,
    'Undo puts the item back as it was before the agent’s last answer, and the list follows; the earlier save stays');

  // ---- "save at once" off: it waits for the press ----
  await mx.evaluate(`(function(){ var c = document.querySelector('.docs-agent-auto input'); c.click(); return true; })()`);
  await mx.waitFor(`!document.querySelector('.docs-agent-auto input').checked`, 5000, 'save at once off');
  await post(env([{ id: 'reopen-order', kind: 'idea', title: 'Let a clerk reopen an order', proposal: { summary: 'A Reopen button.' } }]));
  const offer = await mx.waitFor(`(function(){ var b = Array.from(document.querySelectorAll('.docs-agent button')).find(function (x) { return x.textContent === 'Save them'; }); return b && document.querySelector('.docs-agent').textContent; })()`, 10000, 'offer');
  t.ok(/The agent sent 1 item for the Assist page\. Nothing is kept until you save them\./.test(offer) && (await mx.evaluate(`MxAssist.peek('pac').length`)) === 3,
    'with save at once off, an envelope waits for Save them, and nothing is kept before');
  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-agent button')).find(function (x) { return x.textContent === 'Save them'; }).click()`);
  await mx.waitFor(`(MxAssist.peek('pac') || []).some(function (x) { return x.id === 'reopen-order'; })`, 10000, 'saved by the press');
  t.ok(true, 'and the press saves it');
  await mx.evaluate(`(function(){ var c = document.querySelector('.docs-agent-auto input'); if (!c.checked) c.click(); return true; })()`);

  // ---- Import descriptions… takes an Assist file ----
  await goToDocsTab(mx, 'manual', '.docs-ai');
  await mx.evaluate(`(function () {
    var real = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type !== 'file') return real.call(this);
      HTMLInputElement.prototype.click = real;
      var dt = new DataTransfer();
      dt.items.add(new File([${JSON.stringify(env([{ id: 'invoice-date', kind: 'other', title: 'Where the invoice date comes from', summary: 'A setting.' }]))}], 'assist.json', { type: 'application/json' }));
      this.files = dt.files;
      this.dispatchEvent(new Event('change'));
    };
    Array.from(document.querySelectorAll('button')).find(function (b) { return b.textContent === 'Import descriptions…'; }).click();
    return true;
  })()`);
  const imported = await mx.waitFor(`(function(){ var ok = (MxAssist.peek('pac') || []).some(function (x) { return x.id === 'invoice-date'; }); return ok && (document.body.innerText.match(/From assist\\.json: [^\\n]*/) || [''])[0]; })()`, 10000, 'imported');
  t.ok(/^From assist\.json: the workbook item invoice-date on the Assist page\./.test(imported), 'Import descriptions… reads an Assist file by the same rules and saves it there: ' + imported);
  // ---- an update for an item this project does not keep is refused, on the card, and nothing is kept ----
  await goToDocsTab(mx, 'agent', '.docs-agent');
  await post(env([{ id: 'GONE-1', kind: 'ticket', update: true, status: 'done' }]));
  const refused = await mx.waitFor(`(function(){ var w = document.querySelector('.docs-agent .warn-text'); return w && /GONE-1/.test(w.textContent) && w.textContent; })()`, 10000, 'refused');
  t.ok(/Nothing was saved: an update is for ticket GONE-1, which MxScout does not keep for this project — send the whole item instead\./.test(refused), 'an update for an item MxScout does not keep is refused, and the card says why: ' + refused);
  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-agent button')).find(function (b) { return b.textContent === 'Dismiss'; }).click()`);

  // ---- setLanguage: the project's language, which the documentation the agent reads says ----
  await post(JSON.stringify({ format: 'mxscout-assist', version: 1, language: 'pl', setLanguage: true, items: [{ id: 'pl-note', kind: 'other', title: 'Skąd bierze się data faktury', summary: 'Z ustawienia.' }] }));
  await mx.waitFor(`(MxAssist.peek('pac') || []).some(function (x) { return x.id === 'pl-note' && x.language === 'pl'; })`, 10000, 'saved in Polish');
  const lang = await mx.evaluate(`MxStore.get('projects', 'pac').then(function (p) { return p.contentLanguage; })`);
  t.ok(lang === 'pl' && !!(await waitDocs('/^Write in: Polish \\(pl\\)$/m', 'docs with the language')), 'setLanguage sets the project’s language, and the documentation the agent reads says to write in it: ' + lang);

  const descAfter = await mx.evaluate(`MxStore.get('descriptions', 'pac').then(function (r) { return r.value.microflows['Sales.CreateOrder'].text; })`);
  t.ok(descAfter === 'Opens a fresh order.', 'the descriptions are left as they were');

  // ---- never in the exported documentation ----
  await mx.waitFor(`!!window.MxDocs.current()`, 8000, 'the documentation built');
  const out = JSON.parse(await mx.evaluate(`(async function () {
    var data = JSON.parse(JSON.stringify(window.MxDocs.current()));
    var html = window.MxDocs.buildFile(data, await window.MxDocs.stylesheet(), data.project, await window.MxDocs.flowScripts());
    var md = MxDocsView.markdown(MxDocs.current());
    var words = ['AS-1', 'AS-2', 'OLD-9', 'reopen-order', 'invoice-date', 'Invoices print the wrong date', 'Search ignores accents', 'A ticket an older descriptions file carried', 'Let a clerk reopen'];
    return JSON.stringify({ htmlHas: words.filter(function (w) { return html.indexOf(w) !== -1; }), mdHas: words.filter(function (w) { return md.indexOf(w) !== -1; }),
      drawer: ['window.MxDocsAssist =', 'window.MxDocsTickets =', 'window.MxDocsChanges =', 'window.MxAssist ='].some(function (w) { return html.indexOf(w) !== -1; }), keys: 'tickets' in data.ai || 'changes' in data.ai || 'assist' in data,
      mdAssist: /^## (Assist|Tickets|Changes)$/m.test(md), described: html.indexOf('Opens a fresh order.') !== -1 });
  })()`));
  t.ok(out.htmlHas.length === 0 && !out.drawer && !out.keys && out.described, 'the exported HTML file carries no Assist item, nor the files that draw one — and still the descriptions: ' + JSON.stringify(out.htmlHas));
  t.ok(out.mdHas.length === 0 && !out.mdAssist, 'its Markdown copy has no Assist, Tickets or Changes section and names no item: ' + JSON.stringify(out.mdHas));

  // ---- the address of the old pages opens the Overview in the file ----
  const file = await mx.evaluate(`(function () { var host = document.createElement('div'); var v = MxDocsView.mount(MxDocs.current(), host, { preview: true, state: { view: 'assist' } });
    return v.state().view + ':' + v.pages().indexOf('assist') + ':' + v.pages().indexOf('tickets'); })()`);
  t.ok(file === 'start:-1:-1', 'the documentation without MxScout has no Assist page, and asking for it opens the Overview: ' + file);

  await mx.evaluate(`Array.from(document.querySelectorAll('.docs-agent button')).find(b => b.textContent === 'Stop sharing').click()`);
  await mx.close();
};
