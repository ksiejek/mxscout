/* Risk triage (Karol, 2026-10-14): the risks in the documentation are something to work through.
 *
 *  - a risk has an id the agent keeps from one update to the next (describe.js); merging two files
 *    keeps one copy of a risk, the newer, matched by id or by level and title;
 *  - the skill's checker asks for ids, and refuses one that is malformed or used twice;
 *  - on the Risks screen a risk is marked a false positive (a reason required) or fixed, and leaves the
 *    count; it stays under its own filter with the reason; Reopen undoes it;
 *  - a comment can be a risk: it shows on the Risks page marked as raised by its author, is triaged
 *    the same way, and an agent's descriptions do not touch it — unless the agent answers for it;
 *  - new descriptions are reconciled: a fixed risk still reported is reopened, one no longer reported
 *    verified, a false positive reported again stays one, an open risk no longer reported is "gone";
 *    a file that adds without a risks list touches nothing; the decisions outlive the import;
 *  - the AI pack carries a "## risk triage" section; the exported documentation shows the statuses
 *    read-only, and its Markdown lists what is no longer counted. */
'use strict';
const { goToSection, goToDocsTab } = require('./helpers');
const fs = require('fs');
const path = require('path');
const { check, merge, readPack, todo } = require(path.join(__dirname, '..', 'skills', 'mendix-describe', 'check-descriptions.js'));

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxDescribe', 15000, 'MxScout loaded');

  // ---- identity and merge ----
  const R = (o) => Object.assign({ level: 'P1', title: 'Anyone can delete a ticket', detail: 'Old detail.', fix: 'Check the caller.', where: ['Sales.CreateOrder'] }, o);
  const base = { format: 'mxscout-descriptions', version: 1, risks: [R({ id: 'p1-anon-delete' }), R({ level: 'P2', title: 'Saved twice' }), R({ id: 'bad id!', title: 'Odd id' }), R({ id: 'p1-anon-delete', title: 'Same id again' })] };
  const more = { format: 'mxscout-descriptions', version: 1, add: true, risks: [R({ id: 'p1-anon-delete', title: 'Anyone can delete any ticket', detail: 'New detail.' }), R({ level: 'P2', title: '  saved   TWICE ', detail: 'Reworded.' }), R({ id: 'p3-new', level: 'P3', title: 'New one' })] };
  const m = JSON.parse(await mx.evaluate(`(function () {
    var a = MxDescribe.parse(${JSON.stringify(JSON.stringify(base))}).value, b = MxDescribe.parse(${JSON.stringify(JSON.stringify(more))}).value;
    var out = MxDescribe.merge(a, b);
    return JSON.stringify({ ids: a.risks.map(function (r) { return r.id; }), listed: !!a.risksListed,
      merged: out.risks.map(function (r) { return (r.id || '-') + ':' + r.level + ':' + r.title + ':' + r.detail; }),
      keys: a.risks.map(MxDescribe.riskKey), flags: 'risksListed' in out || 'verify' in out,
      again: MxDescribe.parse(JSON.stringify(MxDescribe.toFile(out))).value.risks.map(function (r) { return r.id; }) });
  })()`));
  t.ok(m.ids.join() === 'p1-anon-delete,,,', 'a risk keeps a slug id; a malformed one, or one the file already used, is dropped: ' + JSON.stringify(m.ids));
  t.ok(m.keys[0] === 'id:p1-anon-delete' && m.keys[1] === 't:P2:saved twice', 'a risk is known by its id, and without one by its level and title: ' + JSON.stringify(m.keys));
  t.ok(m.listed, 'the parser remembers that the file carried a risks list');
  t.ok(m.merged.length === 5 && m.merged[0] === 'p1-anon-delete:P1:Anyone can delete any ticket:New detail.' && m.merged[1] === '-:P2:saved   TWICE:Reworded.' && m.merged[4] === 'p3-new:P3:New one:Old detail.',
    'merging replaces a risk with the same id, or the same level and title, in its place, and adds a new one at the end — old risks do not pile up: ' + JSON.stringify(m.merged));
  t.ok(!m.flags, 'what the parser noted about one file does not stay on what is kept');
  t.ok(m.again.join() === 'p1-anon-delete,,,,p3-new', 'the ids survive being written back as a file (the package): ' + JSON.stringify(m.again));

  // ---- the skill's checker ----
  const pack = { project: 'P', microflows: { 'Sales.CreateOrder': { hash: 'x' } }, nanoflows: {}, pages: {}, entities: {} };
  const said = (risks) => check(pack, { format: 'mxscout-descriptions', version: 1, risks: risks }).filter((p) => /"id"|id "/.test(p.text)).map((p) => p.level + ':' + p.text);
  t.ok(said([R({ id: 'p1-a', theme: 'access' })]).length === 0, 'the checker takes a slug id');
  t.ok(/^warning:.*no "id"/.test(said([R({ theme: 'access' })]).join()), 'and warns when a risk has none: ' + said([R({})]).join());
  t.ok(/^error:.*must be a slug/.test(said([R({ id: 'P1 Anon' })]).join()), 'and refuses one that is not a slug');
  t.ok(/^error:.*used by risks\[0\]/.test(said([R({ id: 'p1-a' }), R({ id: 'p1-a', title: 'Other' })]).join()), 'and one used twice');
  const cm = merge([{ risks: [R({ id: 'p1-a', title: 'Old title' })] }, { risks: [R({ id: 'p1-a', title: 'New title' })] }]);
  t.ok(cm.risks.length === 1 && cm.risks[0].title === 'New title', 'the checker\'s merge keeps one copy of a risk by its id, the later part winning');

  // ================================================================ in the app
  await mx.viewport(1440, 900);
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const X = (id, level, title, where) => ({ id: id, level: level, theme: 'logic', title: title, detail: 'About ' + title + '.', fix: 'Fix ' + title + '.', where: where || ['Sales.CreateOrder'] });
  const first = { format: 'mxscout-descriptions', version: 1,
    microflows: { 'Sales.CreateOrder': { text: 'Opens a fresh order.' } },
    risks: [X('p1-anyone-sweeps', 'P1', 'Anyone can sweep orders', ['Sales.SweepOrders']), X('p2-saved-twice', 'P2', 'The order is saved twice'), X('p3-odd-name', 'P3', 'An odd name'), X('p2-number-fixed', 'P2', 'The order number is a fixed letter')] };
  await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    await MxStore.saveProjectWithModel({ id: 'ptri', name: 'TriageDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null, devTools: true }, model);
    await MxStore.put('descriptions', { projectId: 'ptri', importedAt: new Date().toISOString(), fileName: 'd.json', value: MxDescribe.parse(${JSON.stringify(JSON.stringify(first))}).value });
  })()`);
  const SW = "(function(q){var s=document.querySelector('.switcher[aria-expanded=\"false\"]'); if (s) s.click(); return document.querySelectorAll(q);})";
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(${SW}('.tree-project')).find(b => b.textContent.indexOf('TriageDemo') !== -1)`, 10000, 'project');
  await mx.evaluate(`Array.from(${SW}('.tree-project')).find(b => b.textContent.indexOf('TriageDemo') !== -1).click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.tree-section')).find(b => /^Risks/.test(b.textContent.trim()))`, 8000, 'sections');
  const go = (name) => goToSection(mx, name);
  const look = () => mx.evaluate(`JSON.stringify((function () {
    var s = document.querySelector('.doc-screen'); if (!s) return null;
    var on = s.querySelector('.dx-rk-st.on');
    return { sub: (document.querySelector('.xe-head .xe-sub') || {}).textContent, rows: Array.from(s.querySelectorAll('.dx-rk-row')).map(function (r) { return r.querySelector('.dx-rk-t b').textContent + (r.querySelector('.dx-rs') ? ' [' + r.querySelector('.dx-rs').textContent + ']' : ''); }),
      small: Array.from(s.querySelectorAll('.dx-rk-row small')).map(function (x) { return x.textContent; }),
      chips: Array.from(s.querySelectorAll('.dx-rk-st')).map(function (b) { return b.textContent + (b.classList.contains('on') ? '*' : ''); }),
      title: (s.querySelector('.dx-rk-head h2') || {}).textContent, pills: Array.from(s.querySelectorAll('.dx-rk-pills > *')).map(function (x) { return x.textContent; }),
      acts: Array.from(s.querySelectorAll('.dx-rk-acts button')).map(function (b) { return b.textContent; }), tri: (s.querySelector('.dx-rk-tri') || {}).textContent || null,
      foot: (s.querySelector('.dx-rk-foot') || {}).textContent };
  })())`).then(JSON.parse);
  const pick = (title) => mx.evaluate(`(function(){ var r = Array.from(document.querySelectorAll('.doc-screen .dx-rk-row')).find(function (x) { return x.querySelector('.dx-rk-t b').textContent === ${JSON.stringify(title)}; }); if (r) r.click(); return !!r; })()`);
  const act = (label) => mx.evaluate(`(function(){ var b = Array.from(document.querySelectorAll('.doc-screen .dx-rk-acts button')).find(function (x) { return x.textContent === ${JSON.stringify(label)}; }); if (b) b.click(); return !!b; })()`);
  const chip = (label) => mx.evaluate(`(function(){ var b = Array.from(document.querySelectorAll('.doc-screen .dx-rk-st')).find(function (x) { return x.textContent.indexOf(${JSON.stringify(label)}) === 0; }); if (b) b.click(); return !!b; })()`);
  const dialogSave = (note) => mx.evaluate(`(function(){
    var m = document.querySelector('.triage-modal'); if (!m) return 'no dialog';
    var a = m.querySelector('textarea'); a.value = ${JSON.stringify(note)}; a.dispatchEvent(new Event('input', { bubbles: true }));
    Array.from(m.querySelectorAll('button')).find(function (b) { return /^Mark/.test(b.textContent); }).click(); return 'saved'; })()`);
  const rec = () => mx.evaluate(`MxStore.get('triage', 'ptri').then(function (r) { return JSON.stringify(r); })`).then(JSON.parse);

  // ---- a comment that is a risk ----
  await mx.evaluate(`(function(){ MxComments.openEditor({ kind: 'microflow', qualifiedName: 'Sales.CreateOrder', module: 'Sales', name: 'CreateOrder' }, null); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.editor .comment-risk')`, 5000, 'comment editor with its risk choice');
  t.ok(await mx.evaluate(`document.querySelector('.editor .comment-risk').value === ''`), 'a new comment is an ordinary comment until it is marked a risk');
  await mx.evaluate(`(function(){
    var e = document.querySelector('.editor'), sel = e.querySelector('.comment-risk'); sel.value = 'P2';
    e.querySelectorAll('textarea')[0].value = 'The discount is applied twice\\nOnce in the flow, once in the before-commit event.';
    e.querySelectorAll('textarea')[1].value = 'Apply it in one place.';
    Array.from(e.querySelectorAll('button')).find(function (b) { return b.textContent === 'Save comment'; }).click(); return true; })()`);
  await mx.waitFor(`!document.querySelector('.editor')`, 5000, 'comment saved');
  const comment = JSON.parse(await mx.evaluate(`MxStore.byIndex('findings', 'byProject', 'ptri').then(function (r) { return JSON.stringify(r); })`))[0];
  t.ok(comment && comment.risk === 'P2', 'the comment is kept as a P2 risk: ' + (comment && comment.risk));

  await go('Risks');
  await mx.waitFor(`!!document.querySelector('.doc-screen .dx-rk-row')`, 8000, 'risks screen');
  let L = await look();
  t.ok(L.rows.length === 5 && L.rows.indexOf('The discount is applied twice') !== -1, 'the Risks screen lists the agent’s four risks and the one raised in a comment: ' + JSON.stringify(L.rows));
  t.ok(L.small.some((x) => /raised by you$/.test(x)), 'the comment’s risk says who raised it — its author, here you: ' + JSON.stringify(L.small));
  t.ok(/^5 findings/.test(L.sub) && /people raised the rest/.test(L.sub), 'and the page says some were raised by people: ' + L.sub);
  await pick('The discount is applied twice');
  L = await look();
  t.ok(L.pills.indexOf('raised by you') !== -1 && /^Raised by you on .*a person’s finding/i.test(L.foot.replace('A person’s', 'a person’s')), 'its detail is marked as a person’s, not ✦ AI: ' + JSON.stringify(L.pills) + ' ' + L.foot);
  await pick('Anyone can sweep orders');
  L = await look();
  t.ok(L.pills.indexOf('✦ AI') !== -1 && L.acts.join() === 'False positive…,Mark fixed…', 'an agent’s risk is marked ✦ AI, with False positive… and Mark fixed…: ' + JSON.stringify(L.pills) + ' ' + JSON.stringify(L.acts));

  // ---- false positive, a reason required ----
  await act('False positive…');
  await mx.waitFor(`!!document.querySelector('.triage-modal')`, 5000, 'dialog');
  await mx.evaluate(`Array.from(document.querySelectorAll('.triage-modal button')).find(function (b) { return /^Mark/.test(b.textContent); }).click()`);
  t.ok(await mx.waitFor(`/Say why/.test((document.querySelector('.triage-modal') || {}).textContent || '')`, 3000, 'reason asked'), 'a false positive without a reason is refused, and the dialog says why');
  await dialogSave('Sweeping is guarded by the page’s role; the flow is not exposed.');
  await mx.waitFor(`!document.querySelector('.triage-modal') && !Array.from(document.querySelectorAll('.doc-screen .dx-rk-row b')).some(function (b) { return b.textContent === 'Anyone can sweep orders'; })`, 5000, 'gone from the open list');
  L = await look();
  t.ok(L.rows.length === 4 && /^4 findings/.test(L.sub), 'the false positive leaves the open list and the count: ' + L.sub);
  t.ok(L.chips.indexOf('Open4*') === 0 && L.chips.indexOf('False positive1') !== -1, 'the filters count it under False positive: ' + JSON.stringify(L.chips));
  await chip('False positive');
  L = await look();
  t.ok(L.rows.join() === 'Anyone can sweep orders [False positive]' && /guarded by the page’s role/.test(L.tri || '') && L.acts.join() === 'Reopen',
    'under False positive it is listed with its badge and its reason, and Reopen: ' + JSON.stringify(L));
  t.ok(/History · 1/.test(L.tri), 'and its history has the change: ' + L.tri);
  let TR = await rec();
  t.ok(TR.risks['id:p1-anyone-sweeps'].status === 'false-positive' && /guarded/.test(TR.risks['id:p1-anyone-sweeps'].note), 'it is kept in the triage store, by the risk’s id');
  // the documentation's data (what the Documentation section builds the file and the pack from) counts only open risks
  const toDocs = async () => { await go('Documentation'); await mx.waitFor(`!!document.querySelector('.docs-landing') && !!MxDocs.current()`, 8000, 'documentation'); };
  const toRisks = async () => { await go('Risks'); await mx.waitFor(`!!document.querySelector('.doc-screen .dx-rk')`, 8000, 'risks screen'); };
  await toDocs();
  const ov = await mx.evaluate(`MxDocs.current() ? JSON.stringify({ risks: MxDocs.current().ai.risks.length, triaged: MxDocs.current().ai.triaged.length, sweep: MxDocs.current().ai.risks.some(function (r) { return r.title === 'Anyone can sweep orders'; }) }) : 'null'`);
  t.ok(/"risks":4,"triaged":1,"sweep":false/.test(ov), 'the documentation’s data counts only open risks; the false positive is kept apart: ' + ov);

  await toRisks();
  // ---- Reopen undoes it ----
  await act('Reopen');
  await mx.waitFor(`(function(){ var b = document.querySelector('.doc-screen .dx-rk-st.on'); return b && /^False positive/.test(b.textContent) && !document.querySelector('.doc-screen .dx-rk-row'); })() || (function(){ var s = document.querySelector('.doc-screen .xe-sub, .xe-head .xe-sub'); return s && /5 open risks/.test(s.textContent); })()`, 5000, 'reopened');
  await chip('Open');
  L = await look();
  t.ok(L.rows.length === 5, 'Reopen puts it back among the open risks: ' + JSON.stringify(L.rows));
  await pick('Anyone can sweep orders'); await act('False positive…');
  await dialogSave('Sweeping is guarded by the page’s role.');
  await mx.waitFor(`!document.querySelector('.triage-modal')`, 5000, 'saved');

  // ---- mark fixed: two of the agent's and the person's ----
  for (const title of ['The order is saved twice', 'An odd name', 'The discount is applied twice']) {
    await mx.waitFor(`!!Array.from(document.querySelectorAll('.doc-screen .dx-rk-row b')).find(function (b) { return b.textContent === ${JSON.stringify(title)}; })`, 5000, title);
    await pick(title); await act('Mark fixed…');
    await mx.waitFor(`!!document.querySelector('.triage-modal')`, 5000, 'dialog');
    await dialogSave('Changed in this release.');
    await mx.waitFor(`!document.querySelector('.triage-modal') && !Array.from(document.querySelectorAll('.doc-screen .dx-rk-row b')).some(function (b) { return b.textContent === ${JSON.stringify(title)}; })`, 5000, 'fixed ' + title);
  }
  L = await look();
  t.ok(L.rows.join() === 'The order number is a fixed letter' && L.chips.indexOf('Fixed — to verify3') !== -1, 'three marked fixed wait under Fixed — to verify; one is open: ' + JSON.stringify(L.chips));
  const cst = JSON.parse(await mx.evaluate(`MxStore.byIndex('findings', 'byProject', 'ptri').then(function (r) { return JSON.stringify(r[0]); })`));
  t.ok(cst.status === 'fixed', 'the comment that is the risk is marked fixed on the Comments page too: ' + cst.status);

  // ---- the AI pack says what was decided ----
  await toDocs();
  const pk = await mx.evaluate(`(function(){ var d = MxDocs.current(); return d ? MxDescribe.pack(d).text : ''; })()`);
  const tri = (pk.split('## risk triage')[1] || '').split('## index')[0];
  t.ok(/- p1-anyone-sweeps \| P1 \| false-positive \| ai \| Anyone can sweep orders .*note: Sweeping is guarded/.test(tri), 'the pack has a risk-triage section: a false positive with its reason');
  t.ok(/- p2-saved-twice \| P2 \| fixed \| ai \|/.test(tri) && new RegExp('- c-' + comment.id + ' \\| P2 \\| fixed \\| raised by you \\| The discount is applied twice').test(tri),
    'a fixed one, and the person’s risk with its comment id, marked as raised by a person');
  t.ok(pk.indexOf('## risk triage') < pk.indexOf('## index'), 'before the index, so the module ranges still hold');
  // and the skill's checker reads it
  const pp = readPack(pk), td = todo(pp, null);
  t.ok(td.recheck.join() === 'p2-saved-twice,p3-odd-name' && td.falsePositives.join() === 'p1-anyone-sweeps' && td.verify.join() === 'c-' + comment.id,
    'the checker’s todo lists the fixed risks to check again, the false positives, and the person’s risk to answer in verify: ' + JSON.stringify([td.recheck, td.falsePositives, td.verify]));
  const back = check(pp, { format: 'mxscout-descriptions', version: 1, risks: [X('p1-anyone-sweeps', 'P1', 'Anyone can sweep orders'), X('c-' + comment.id, 'P2', 'Mine now')], verify: [{ id: 'c-' + comment.id, still: true }, { id: 'nope', still: 1 }] });
  t.ok(back.some((p) => p.level === 'warning' && /was marked a false positive \(Sweeping is guarded/.test(p.text)) && back.some((p) => p.level === 'error' && /a person raised — answer for it in "verify"/.test(p.text)) &&
    back.filter((p) => /^verify/.test(p.text)).length === 1,
    'and its check warns about a false positive raised again, refuses a person’s risk in "risks", and a malformed verify: ' + JSON.stringify(back.filter((p) => /false positive|person|verify/.test(p.text)).map((p) => p.level)));

  // ---- an update: reconcile ----
  const second = { format: 'mxscout-descriptions', version: 1,
    microflows: { 'Sales.CreateOrder': { text: 'Opens a fresh order.' } },
    risks: [X('p1-anyone-sweeps', 'P1', 'Anyone can sweep orders', ['Sales.SweepOrders']), X('p2-saved-twice', 'P2', 'The order is saved twice'), X('p1-new-one', 'P1', 'A new hole')] };
  async function importFile(obj, name) {
    await goToDocsTab(mx, 'manual', '.docs-ai');
    await mx.waitFor(`!!Array.from(document.querySelectorAll('button')).find(function (b) { return b.textContent === 'Import descriptions…'; })`, 8000, 'Import descriptions');
    await mx.evaluate(`(function(){
      var text = ${JSON.stringify(JSON.stringify(obj))};
      var orig = HTMLInputElement.prototype.click;
      HTMLInputElement.prototype.click = function () {
        if (this.type !== 'file') return orig.call(this);
        HTMLInputElement.prototype.click = orig;
        var dt = new DataTransfer(); dt.items.add(new File([text], ${JSON.stringify(name)}, { type: 'application/json' }));
        this.files = dt.files; this.dispatchEvent(new Event('change'));
      };
      Array.from(document.querySelectorAll('button')).find(function (b) { return b.textContent === 'Import descriptions…'; }).click(); return true; })()`);
    return mx.waitFor(`(function(){ var m = Array.from(document.querySelectorAll('.msg, .message, [class*="msg"]')).map(function (x) { return x.textContent; }).join(' '); return m.indexOf(${JSON.stringify(name)}) !== -1 && m; })()`, 8000, 'imported ' + name);
  }
  const saidNow = await importFile(second, 'second.json');
  t.ok(/1 fixed risk verified/.test(saidNow) && /1 reopened/.test(saidNow) && /1 false positive reported again/.test(saidNow) && /1 no longer reported/.test(saidNow),
    'importing new descriptions says what it found about the risks: ' + saidNow);
  TR = await rec();
  const S = (k) => TR.risks[k] && TR.risks[k].status;
  t.ok(S('id:p2-saved-twice') === 'reopened' && /still found after the fix/.test(TR.risks['id:p2-saved-twice'].history.slice(-1)[0].note), 'a risk marked fixed that the agent still reports is reopened, the history says why');
  t.ok(S('id:p3-odd-name') === 'verified' && /not found any more/.test(TR.risks['id:p3-odd-name'].history.slice(-1)[0].note), 'one it no longer reports is verified');
  t.ok(S('id:p1-anyone-sweeps') === 'false-positive' && /reported again, kept as false positive/.test(TR.risks['id:p1-anyone-sweeps'].history.slice(-1)[0].note) && /guarded/.test(TR.risks['id:p1-anyone-sweeps'].note),
    'a false positive reported again stays one, with its reason — the decision outlived the import');
  t.ok(S('id:p2-number-fixed') === 'gone' && /no longer reported/.test(TR.risks['id:p2-number-fixed'].history[0].note), 'an open risk the new file no longer lists is kept as no longer reported');
  t.ok(S('c:' + comment.id) === 'fixed', 'the risk a person raised is left alone by the agent’s import');
  t.ok(!TR.risks['id:p1-new-one'], 'a new risk is simply open — nothing to record');

  await go('Risks');
  await mx.waitFor(`!!document.querySelector('.doc-screen .dx-rk-row')`, 8000, 'risks again');
  L = await look();
  t.ok(L.rows.sort().join() === 'A new hole,The order is saved twice [Reopened]', 'the open list: the new risk and the reopened one: ' + JSON.stringify(L.rows));
  t.ok(['Verified1', 'False positive1', 'No longer reported1', 'Fixed — to verify1'].every((c) => L.chips.indexOf(c) !== -1), 'and the others under their filters: ' + JSON.stringify(L.chips));
  await chip('Verified');
  L = await look();
  t.ok(L.rows.join() === 'An odd name [Verified]' && /not found any more/.test(L.tri), 'a verified risk is still shown, from what was kept of it, with its history: ' + L.tri);

  // ---- an add-part without risks touches no risk; the agent answers for the person's ----
  const before = JSON.stringify((await rec()).risks['id:p2-saved-twice']);
  await importFile({ format: 'mxscout-descriptions', version: 1, add: true, microflows: { 'Sales.CreateOrder': { text: 'Opens an order.' } } }, 'part.json');
  t.ok(JSON.stringify((await rec()).risks['id:p2-saved-twice']) === before, 'a file that adds, with no risks list, changes no risk’s status');
  await importFile({ format: 'mxscout-descriptions', version: 1, add: true, verify: [{ id: 'c-' + comment.id, still: true, why: 'The before-commit event still applies it.' }] }, 'verify.json');
  TR = await rec();
  t.ok(S('c:' + comment.id) === 'reopened' && /the agent still finds it after the fix: The before-commit event/.test(TR.risks['c:' + comment.id].history.slice(-1)[0].note),
    'when the agent says a person’s fixed risk is still there, it is reopened, with the agent’s reason');

  // ---- the exported documentation: statuses read-only ----
  const ex = JSON.parse(await mx.evaluate(`(function(){
    var data = JSON.parse(JSON.stringify(MxDocs.current()));
    var host = document.createElement('div'); host.style.cssText = 'width:1300px;height:800px'; document.body.appendChild(host);
    var v = MxDocsView.mount(data, host, { preview: true, state: { view: 'risks' }, riskFilter: { st: 'all' } });
    var out = { rows: Array.from(host.querySelectorAll('.dx-rk-row')).map(function (r) { return r.querySelector('.dx-rk-t b').textContent + (r.querySelector('.dx-rs') ? ' [' + r.querySelector('.dx-rs').textContent + ']' : ''); }),
      buttons: host.querySelectorAll('.dx-rk-acts').length };
    var fp = Array.from(host.querySelectorAll('.dx-rk-row')).find(function (r) { return /Anyone can sweep/.test(r.textContent); }); fp.click();
    out.reason = (host.querySelector('.dx-rk-tri') || {}).textContent || '';
    out.md = MxDocsView.markdown(data);
    out.file = MxDocsFile.build(data, '', 'x', []).indexOf('"triaged":[') !== -1;
    host.remove();
    return JSON.stringify(out);
  })()`));
  t.ok(ex.rows.indexOf('Anyone can sweep orders [False positive]') !== -1 && ex.rows.indexOf('An odd name [Verified]') !== -1 && ex.rows.some((r) => /^The discount is applied twice \[Reopened\]/.test(r)),
    'the exported reader shows every risk with its status: ' + JSON.stringify(ex.rows));
  t.ok(ex.buttons === 0 && /guarded by the page’s role/.test(ex.reason), 'read-only — no buttons — and a false positive with its reason');
  t.ok(/### Not counted as risks \(3\)/.test(ex.md) && /False positive: Sweeping is guarded/.test(ex.md) && /raised by you/.test(ex.md), 'its Markdown lists what is no longer counted, with the reason, and who raised a person’s risk');
  t.ok(ex.file, 'and the file carries the triaged risks in its data');
};
