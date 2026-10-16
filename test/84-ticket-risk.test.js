/* A ticket about a risk already known, and the risk that knows its tickets (Karol, 2026-10-14).
 *
 * A ticket may name, in `risk`, the known risk it reports — an agent's risk by its id, or one a person raised
 * in a comment by its "c-…" id, as the pack's risk triage lists them:
 *  - the checker takes an id the pack's triage or the file lists, and warns about one that is no id or that
 *    neither lists (and says nothing when the pack has no triage to check against);
 *  - MxScout keeps a well-formed id and leaves out anything else;
 *  - since 2026-10-15 a ticket is an item on the Assist page (tests 86 to 88), moved there from the
 *    descriptions, its risk with it: the ticket links to that risk on the Risks page; the risk lists the
 *    ticket with its verdict, "Ticket PROJ-12: Bug in the model", linking back to it on Assist — for an
 *    agent's risk and for one a person raised;
 *  - an id the documentation does not have stays text on the ticket;
 *  - the Markdown copy gives each risk its id, and no longer lists tickets: they stay in MxScout. */
'use strict';
const fs = require('fs');
const path = require('path');
const { goToSection } = require('./helpers');
const { check } = require(path.join(__dirname, '..', 'skills', 'mendix-describe', 'check-descriptions.js'));

module.exports = async function (t) {
  const STORY = Array.from({ length: 30 }, () => 'The queue lists every order that has not shipped, cancelled ones among them.').join(' ');
  const T = (id, verdict, risk) => Object.assign({ id: id, title: 'Ticket ' + id, reported: 'Something is wrong.', verdict: verdict, confidence: 'high', summary: 'The answer for ' + id + '.', story: STORY,
    traced: { steps: ['A step'], flows: ['Sales.CreateOrder'] }, evidence: [{ kind: 'microflow', target: 'Sales.CreateOrder', what: 'Shows it.' }], reply: 'Thanks.' },
    verdict === 'bug' ? { change: 'fix-it' } : {}, risk === undefined ? {} : { risk: risk });

  // ---- the checker ----
  const pack = { project: 'TR', microflows: { 'Sales.CreateOrder': { hash: 'x' } }, nanoflows: {}, pages: {}, entities: {},
    triage: [{ id: 'p2-saved-twice', level: 'P2', status: 'fixed', person: false, title: 'Saved twice' }, { id: 'c-7d3f2a9e', level: 'P2', status: 'open', person: true, title: 'The discount is applied twice' }] };
  const said = (p, ticket, risks) => check(p, { format: 'mxscout-descriptions', version: 1, add: true, risks: risks, tickets: [ticket],
    changes: [{ id: 'fix-it', title: 'Fix it', asked: 'Fix it.', now: { summary: 'Now.' }, proposal: { summary: 'Then.' } }] })
    .filter((x) => /"risk"/.test(x.text)).map((x) => x.level + ' ' + x.text);
  t.ok(said(pack, T('PROJ-12', 'bug', 'p2-saved-twice')).length === 0 && said(pack, T('PROJ-15', 'as-designed', 'c-7d3f2a9e')).length === 0 &&
    said(pack, T('PROJ-16', 'as-designed', 'p3-in-this-file'), [{ id: 'p3-in-this-file', level: 'P3', title: 'In this file', fix: 'Fix.', where: ['Sales.CreateOrder'], theme: 'naming' }]).length === 0 &&
    said(pack, T('PROJ-17', 'as-designed')).length === 0,
    'the checker takes a risk the pack’s triage lists (an agent’s or a person’s), one the file itself writes, and a ticket with none');
  const unknown = said(pack, T('PROJ-20', 'as-designed', 'p3-not-here')), bad = said(pack, T('PROJ-21', 'as-designed', 'Not A Slug'));
  t.ok(unknown.length === 1 && /^warning ticket "PROJ-20": "risk" is "p3-not-here", which neither the pack's risk triage nor this file lists/.test(unknown[0]) &&
    bad.length === 1 && /^warning ticket "PROJ-21": "risk" must be the id of a known risk/.test(bad[0]),
    'and warns about an id neither lists, and one that is no id: ' + JSON.stringify(unknown.concat(bad)));
  t.ok(said(Object.assign({}, pack, { triage: [] }), T('PROJ-20', 'as-designed', 'p3-not-here')).length === 0,
    'with no risk triage in the pack there is nothing to check an id against, and it says nothing');

  // ---- MxScout's reading of it, and the screens ----
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxDescribe && !!window.MxDocsTickets && !!window.MxDocsView', 15000, 'MxScout loaded');
  await mx.viewport(1440, 900);
  const kept = JSON.parse(await mx.evaluate(`JSON.stringify(MxDescribe.parse(JSON.stringify({ format: 'mxscout-descriptions', version: 1, tickets: [
    { id: 'A-1', title: 'a', verdict: 'bug', summary: 's', risk: 'p2-saved-twice' }, { id: 'A-2', title: 'b', verdict: 'bug', summary: 's', risk: 'c-7d3f2a9e' },
    { id: 'A-3', title: 'c', verdict: 'bug', summary: 's', risk: 'Not A Slug' }, { id: 'A-4', title: 'd', verdict: 'bug', summary: 's', risk: 12 }, { id: 'A-5', title: 'e', verdict: 'bug', summary: 's' }] })).value.tickets.map(function (x) { return x.risk; }))`));
  t.ok(JSON.stringify(kept) === JSON.stringify(['p2-saved-twice', 'c-7d3f2a9e', null, null, null]), 'MxScout keeps an agent’s risk id and a person’s c-… id, and leaves anything else out: ' + JSON.stringify(kept));

  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const desc = { format: 'mxscout-descriptions', version: 1,
    risks: [{ id: 'p1-anyone-can-sweep', level: 'P1', theme: 'access', title: 'Anyone can sweep', detail: 'd', fix: 'f', where: ['Sales.SweepOrders'] },
      { id: 'p2-saved-twice', level: 'P2', theme: 'logic', title: 'Saved twice', detail: 'The order is committed twice.', fix: 'Commit once.', where: ['Sales.CreateOrder'] }],
    tickets: [T('PROJ-12', 'bug', 'p2-saved-twice'), T('PROJ-15', 'as-designed', 'c-7d3f2a9e'), T('PROJ-20', 'cannot-tell', 'p3-not-here')],
    changes: [{ id: 'fix-it', title: 'Fix it', asked: 'Fix it.', now: { summary: 'Now.' }, proposal: { summary: 'Then.' } }] };
  desc.tickets[2].needs = ['The logs'];
  await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    await MxStore.saveProjectWithModel({ id: 'ptr', name: 'TicketRiskDemo', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null }, model);
    await MxStore.put('descriptions', { projectId: 'ptr', importedAt: new Date().toISOString(), fileName: 'd.json', value: MxDescribe.parse(${JSON.stringify(JSON.stringify(desc))}).value });
    // A comment a person marked as a risk: its id in the risk triage is "c-" and the comment's id.
    await MxStore.put('findings', { id: '7d3f2a9e', projectId: 'ptr', status: 'open', author: 'Ola', history: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      target: { kind: 'microflow', qualifiedName: 'Sales.CreateOrder', module: 'Sales', name: 'CreateOrder', attributes: [] }, role: null, severity: 'medium', risk: 'P2',
      problem: 'The discount is applied twice\\nOnce on create, once on confirm.', change: '' });
    return true;
  })()`);
  await mx.navigate(t.MX);
  const SW = "(function(q){var s=document.querySelector('.switcher[aria-expanded=\"false\"]'); if (s) s.click(); return document.querySelectorAll(q);})";
  await mx.waitFor(`!!Array.from(${SW}('.tree-project')).find(b => b.textContent.indexOf('TicketRiskDemo') !== -1)`, 10000, 'project');
  await mx.evaluate(`Array.from(${SW}('.tree-project')).find(b => b.textContent.indexOf('TicketRiskDemo') !== -1).click()`);
  await mx.waitFor(`!!document.querySelector('.tree-section')`, 10000, 'project open');

  const openTicket = async (id) => {
    await goToSection(mx, 'Assist', '.doc-screen .dx-as');
    await mx.waitFor(`(function(){ var a = Array.from(document.querySelectorAll('.doc-screen .dx-pl-item')).find(function (x) { return x.textContent.indexOf(${JSON.stringify(id)}) !== -1; });
      if (a && !a.classList.contains('on')) a.click(); var h = document.querySelector('.doc-screen .dx-tk h2'); return !!h && h.textContent === 'Ticket ' + ${JSON.stringify(id)}; })()`, 8000, 'ticket ' + id);
  };
  const onRisk = () => mx.evaluate(`JSON.stringify({ h1: document.querySelector('.xe-head h1').textContent, title: (document.querySelector('.doc-screen .dx-rk-head h2') || {}).textContent,
    tickets: Array.from(document.querySelectorAll('.doc-screen .dx-rk-tickets .dx-tk-onrisk > span')).map(function (x) { return x.textContent; }) })`).then(JSON.parse);

  // an agent's risk: the ticket links to it, the risk lists the ticket, and back
  await openTicket('PROJ-12');
  const link = await mx.evaluate(`(function(){ var r = document.querySelector('.doc-screen .dx-tk-risk'); return r ? r.textContent : null; })()`);
  t.ok(/Saved twice/.test(link) && /^P2Saved twiceR-002 on the Risks page$/.test(link), 'a ticket about a known risk names it, a link to it on the Risks page: ' + link);
  await mx.evaluate(`document.querySelector('.doc-screen .dx-tk-risk').click()`);
  await mx.waitFor(`(function(){ var h = document.querySelector('.xe-head h1'), r = document.querySelector('.doc-screen .dx-rk-head h2'); return h && h.textContent === 'Risks' && r && r.textContent === 'Saved twice'; })()`, 8000, 'the risk');
  const risk = await onRisk();
  t.ok(risk.tickets.join('|') === 'Ticket PROJ-12: Bug in the model', 'the risk lists the ticket that is about it, with its verdict: ' + JSON.stringify(risk));
  await mx.evaluate(`document.querySelector('.doc-screen .dx-rk-tickets .dx-tk-onrisk').click()`);
  t.ok(!!(await mx.waitFor(`(function(){ var h = document.querySelector('.xe-head h1'), x = document.querySelector('.doc-screen .dx-tk h2'); return h && h.textContent === 'Assist' && x && x.textContent === 'Ticket PROJ-12'; })()`, 8000, 'back')),
    'and the line on the risk leads back to the ticket, on the Assist page');

  // a risk a person raised in a comment, by its c-… id
  await openTicket('PROJ-15');
  const personLink = await mx.evaluate(`(document.querySelector('.doc-screen .dx-tk-risk') || {}).textContent || null`);
  t.ok(/The discount is applied twice/.test(personLink) && /raised by Ola/.test(personLink), 'a ticket can name a risk a person raised, by its c- id: ' + personLink);
  await mx.evaluate(`document.querySelector('.doc-screen .dx-tk-risk').click()`);
  await mx.waitFor(`(function(){ var r = document.querySelector('.doc-screen .dx-rk-head h2'); return r && r.textContent === 'The discount is applied twice'; })()`, 8000, 'the person’s risk');
  t.ok((await onRisk()).tickets.join('|') === 'Ticket PROJ-15: Works as designed', 'and that risk lists it back');

  // an id the documentation does not have
  await openTicket('PROJ-20');
  const none = await mx.evaluate(`(function(){ var s = Array.from(document.querySelectorAll('.doc-screen .dx-ch-sub')).find(function (x) { return /The risk it is about/.test(x.textContent); }); return s ? s.textContent + '|' + !!s.querySelector('a, .dx-tk-risk') : null; })()`);
  t.ok(/The risk p3-not-here is not in this documentation\.\|false$/.test(none), 'a risk the documentation does not have stays text, not a link: ' + none);

  // ---- the Markdown copy ----
  await goToSection(mx, 'Documentation');
  await mx.waitFor(`!!window.MxDocs.current()`, 8000, 'the documentation built');
  const md = await mx.evaluate(`MxDocsView.markdown(MxDocs.current())`);
  t.ok(/· id `p2-saved-twice`/.test(md) && /· id `c-7d3f2a9e`/.test(md) && md.indexOf('PROJ-12') === -1,
    'the Markdown copy gives each risk its id — where an agent checking a ticket reads it — and lists no ticket');
  await mx.close();
};
