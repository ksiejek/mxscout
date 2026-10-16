/* The documentation's Overview and Processes pages (public/docs-view.js, redesign specs 11 and 12),
 * and the audience an agent writes as groups (public/describe.js, skills/mendix-describe).
 *
 * What has to hold, from the specs' acceptance lists:
 *  - the lead is exactly the first sentence of the application's summary, the rest of it under it;
 *  - "At a glance" says what the model's counts say, each figure a way to the page it counts;
 *  - the context diagram puts every node in exactly one group, the application in the middle, and
 *    places a group by the direction of its links (people and senders left, called right, both ways above);
 *  - the P1 list is every P1 risk with the module of its first place;
 *  - Processes lists the application and every process; a process's flows and steps are all there,
 *    and a risk is on it only when one of its places is one of the process's flows;
 *  - the application's item shows the whole description in paragraphs;
 *  - who uses it comes as groups { who, what }, and a file written before, one sentence, still reads. */
'use strict';
const fs = require('fs');
const path = require('path');
const { check } = require(path.join(__dirname, '..', 'skills', 'mendix-describe', 'check-descriptions.js'));

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore && !!window.MxDescribe && !!window.MxDocsData && !!window.MxDocsView', 15000, 'MxScout loaded');
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const flows = JSON.parse(await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    window.__model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    var d = MxDocsData.build(window.__model, { name: 'OvDemo' });
    return JSON.stringify(Object.keys(d.flows).filter(function (k) { return d.flows[k].kind === 'microflow'; }).map(function (k) { return d.flows[k].qn; }));
  })()`));
  t.ok(flows.length >= 2, 'the fixture has microflows to hang processes on: ' + flows.length);
  const [A, B] = flows;

  const STORY = 'The shop keeps its orders here, from the first click to the parcel.\n\nA clerk opens an order, adds lines and saves it.';
  const desc = {
    format: 'mxscout-descriptions', version: 1, by: 'test agent',
    app: {
      summary: 'Takes orders and keeps them tidy. It also numbers them. Customers get mail.',
      story: STORY,
      audience: [{ who: 'Clerks', what: 'Take the orders.' }, { who: 'Managers', what: 'Watch the totals.' }, { what: 'no who — dropped' }, { who: '<b>Auditors</b>' }],
      processes: [
        { name: 'Taking an order', summary: 'A clerk records an order.', story: STORY, steps: ['Open a new order', 'Save it'], flows: [A, 'Sales.NoSuchFlow'] },
        { name: 'Closing the day', summary: 'Totals are added up.', steps: ['Add up'], flows: [B] }
      ]
    },
    risks: [
      { level: 'P2', title: 'Saved twice', where: [A], fix: 'Disable the button.' },
      { level: 'P1', title: 'Anyone can delete', where: [A + '|mf', 'Sales.Order'], fix: 'Check the caller.' },
      { level: 'P3', title: 'Elsewhere', where: ['Sales.Order'] },
      { level: 'P1', title: 'Secret in a flow', where: ['Other.Thing'] }
    ],
    c4: { context: {
      nodes: [
        { id: 'clerks', name: 'Clerks', note: 'browser', kind: 'person', group: 'People' },
        { id: 'boss', name: 'Managers', kind: 'person', group: 'People' },
        { id: 'app', name: 'OvDemo', note: 'the shop', kind: 'app' },
        { id: 'erp', name: 'ERP', note: 'sends orders', kind: 'system', group: 'Senders' },
        { id: 'idp', name: 'Identity', kind: 'system', group: 'Identity' },
        { id: 'dir', name: 'Directory', kind: 'system', group: 'Identity' },
        { id: 'mail', name: 'Mail', kind: 'system', group: 'Called' },
        { id: 'sms', name: 'SMS', note: 'texts', kind: 'system' }
      ],
      links: [
        { from: 'clerks', to: 'app', label: 'browser' }, { from: 'boss', to: 'app' },
        { from: 'erp', to: 'app', label: 'orders' }, { from: 'idp', to: 'app', label: 'users' }, { from: 'app', to: 'dir', label: 'groups' },
        { from: 'app', to: 'mail', label: 'e-mail' }, { from: 'app', to: 'sms', label: 'texts' }
      ]
    } }
  };

  // ---- reading the audience ----
  const parsed = JSON.parse(await mx.evaluate(`JSON.stringify(MxDescribe.parse(${JSON.stringify(JSON.stringify(desc))}).value.app)`));
  t.ok(JSON.stringify(parsed.users) === JSON.stringify([{ who: 'Clerks', what: 'Take the orders.' }, { who: 'Managers', what: 'Watch the totals.' }, { who: '<b>Auditors</b>', what: null }]) && parsed.audience === null,
    'who uses it is read as groups, a group without "who" dropped, markup kept as text: ' + JSON.stringify(parsed.users));
  const oneLine = JSON.parse(await mx.evaluate(`JSON.stringify(MxDescribe.parse(JSON.stringify({ format: 'mxscout-descriptions', version: 1, app: { summary: 'S.', audience: 'Clerks and managers.' } })).value.app)`));
  t.ok(oneLine.audience === 'Clerks and managers.' && oneLine.users.length === 0, 'and a file written before, one sentence, is still read');
  const pack = { project: 'OvDemo', microflows: {}, nanoflows: {}, pages: {}, entities: {} };
  flows.forEach(function (qn) { pack.microflows[qn] = { hash: 'x' }; });
  const audWarn = (d) => check(pack, d).filter((p) => /audience/.test(p.text)).map((p) => p.level);
  const listy = JSON.parse(JSON.stringify(desc)); listy.app.audience = listy.app.audience.slice(0, 2);
  const single = JSON.parse(JSON.stringify(desc)); single.app.audience = 'Clerks.';
  t.ok(audWarn(listy).length === 0 && audWarn(single).join() === 'warning' && audWarn(desc).join() === 'error',
    'the checker takes groups, asks for groups instead of a sentence, and flags a group with no "who": ' + JSON.stringify([audWarn(listy), audWarn(single), audWarn(desc)]));
  const crowded = JSON.parse(JSON.stringify(desc));
  ['a', 'b', 'c', 'd'].forEach(function (g) { crowded.c4.context.nodes.push({ id: 'x' + g, name: g, kind: 'system', group: 'G' + g }); });
  t.ok(check(pack, crowded).some((p) => /five at most/.test(p.text)) && !check(pack, desc).some((p) => /five at most/.test(p.text)),
    'and warns when the context has more groups than the overview draws');

  // ---- the overview ----
  const ov = JSON.parse(await mx.evaluate(`JSON.stringify((function () {
    var data = MxDocsData.build(window.__model, { name: 'OvDemo' });
    MxDescribe.attach(data, MxDescribe.parse(${JSON.stringify(JSON.stringify(desc))}).value);
    window.__ov = data;
    var host = document.createElement('div'); document.body.appendChild(host);
    var v = MxDocsView.mount(data, host, { preview: true });
    window.__ovView = v; window.__ovHost = host;
    function txt(sel) { var n = host.querySelector(sel); return n ? n.textContent : null; }
    var glance = {};
    Array.from(host.querySelectorAll('.dx-glance dt')).forEach(function (dt) { glance[dt.textContent] = { v: dt.nextSibling.textContent, link: !!dt.nextSibling.querySelector('button'), cls: dt.nextSibling.className }; });
    function side(sel) { return Array.from(host.querySelectorAll(sel)).map(function (g) { return g.querySelector('.dx-ctx-gl').textContent + ':' + Array.from(g.querySelectorAll('.dx-ctx-chip b')).map(function (b) { return b.textContent; }).join('+'); }); }
    var left = Array.from(host.querySelectorAll('.dx-ctx > .dx-ctx-g')).filter(function (g) { return g.style.gridColumn === '1'; });
    var right = Array.from(host.querySelectorAll('.dx-ctx > .dx-ctx-g')).filter(function (g) { return g.style.gridColumn === '5'; });
    function names(list) { return list.map(function (g) { return g.querySelector('.dx-ctx-gl').textContent; }); }
    return {
      head: getComputedStyle(host.querySelector('.dx-page-head')).display, title: host.querySelector('.dx-page-head h1').textContent,
      h1: txt('.dx-ov-h1'), lead: txt('.dx-ov-lead'), rest: txt('.dx-ov-rest'), cta: txt('.dx-cta'), prov: txt('.dx-ov-prov'),
      kpi: data.kpi, glance: glance,
      users: Array.from(host.querySelectorAll('.dx-user b')).map(function (b) { return b.textContent; }), usersSub: txt('[data-sec="users"] .dx-ov-sec-t p'),
      chips: Array.from(host.querySelectorAll('.dx-ctx-chip b')).map(function (b) { return b.textContent; }),
      groups: host.querySelectorAll('.dx-ctx-g').length, top: side('.dx-ctx-top .dx-ctx-g'), left: names(left), right: names(right),
      verbs: Array.from(host.querySelectorAll('.dx-ctx-cl')).map(function (c) { return c.textContent; }),
      app: txt('.dx-ctx-app b'), ctxSub: txt('[data-sec="context"] .dx-ov-sec-t p'), smsVia: Array.from(host.querySelectorAll('.dx-ctx-chip')).filter(function (c) { return c.querySelector('b').textContent === 'SMS'; }).map(function (c) { return c.textContent; })[0],
      procs: Array.from(host.querySelectorAll('.dx-ov-proc')).map(function (p) { return p.textContent; }),
      lv: Array.from(host.querySelectorAll('.dx-lv3-t')).map(function (x) { return x.textContent; }),
      p1: Array.from(host.querySelectorAll('.dx-p1-row')).map(function (x) { return x.textContent; }), p1cap: txt('.dx-p1 .dx-cap'),
      facts: Array.from(host.querySelectorAll('.dx-fact')).map(function (x) { return x.textContent; }),
      next: Array.from(host.querySelectorAll('.dx-next-g li')).map(function (x) { return x.textContent; }),
      toc: Array.from(host.querySelectorAll('.dx-toc-a')).map(function (x) { return x.textContent; }),
      unreached: data.quality.unreached.length, disabled: data.quality.disabled
    };
  })())`));
  t.ok(ov.head !== 'none' && ov.title === 'Overview' && ov.h1 === 'OvDemo', 'the overview has MxScout’s header like every page, and the document under it its own title, the project’s');
  t.ok(ov.lead === 'Takes orders and keeps them tidy.' && ov.rest === 'It also numbers them. Customers get mail.',
    'the lead is exactly the summary’s first sentence, the rest under it: ' + JSON.stringify([ov.lead, ov.rest]));
  t.ok(ov.cta === 'Read the full description' && /by an agent \(test agent\)/.test(ov.prov), 'with the way to the full description, and who wrote the texts');
  const g = ov.glance, k = ov.kpi;
  t.ok(g.Modules.v === k.modules + ' · ' + (k.marketplace ? '+' + k.marketplace + ' Marketplace' : 'all own') && g.Microflows.v === String(k.microflows) && g.Nanoflows.v === String(k.nanoflows) &&
    g.Pages.v === String(k.pages) && g.Entities.v === String(k.entities) && g['User roles'].v === String(k.roles) && g['Published services'].v.indexOf(String(k.services)) === 0,
    'At a glance says what the model counts: ' + JSON.stringify(g));
  t.ok(g.Risks.v === '4 · 2 P1' && g.Risks.cls === 'p1' && g.Modules.link && g.Entities.link && !g['Model read'].link, 'the risks in the P1 colour, and each count is a way to its page');
  t.ok(ov.users.join('|') === 'Clerks|Managers|<b>Auditors</b>' && /^Three groups of people\. The model gives them \d+ user roles?\.$/.test(ov.usersSub),
    'who uses it, one group a line: ' + JSON.stringify([ov.users, ov.usersSub]));
  const others = ['Clerks', 'Managers', 'ERP', 'Identity', 'Directory', 'Mail', 'SMS'];
  t.ok(ov.chips.slice().sort().join() === others.slice().sort().join() && ov.app === 'OvDemo',
    'every node of the context is in exactly one group, the application in the middle: ' + ov.chips.join(','));
  t.ok(ov.groups === 5 && ov.top.join() === 'Identity:Identity+Directory' && ov.left.join() === 'People,Senders' && ov.right.join() === 'Called,It calls',
    'groups are placed by the direction of their links — people then senders left, called right, both ways above, an ungrouped node with its side: ' + JSON.stringify([ov.top, ov.left, ov.right]));
  t.ok(ov.verbs.join() === 'use it,send data,calls,calls' && /^5 systems in five groups\./.test(ov.ctxSub) && ov.smsVia === 'SMStexts',
    'each arrow says what goes along it, and a chip says what it exchanges: ' + JSON.stringify([ov.verbs, ov.ctxSub]));
  t.ok(ov.procs.length === 2 && /^01Taking an orderA clerk records an order\.2 steps · 2 flows$/.test(ov.procs[0]), 'what it does: every process, numbered, with its steps and flows: ' + ov.procs[0]);
  t.ok(ov.lv.join('|') === '2P1 · fix first|1P2 · plan a fix|1P3 · worth knowing', 'what needs attention counts the risks by level: ' + ov.lv.join('|'));
  t.ok(ov.p1cap === 'The two P1 risks' && ov.p1.join('|') === 'Anyone can delete' + A.split('.')[0] + '|Secret in a flowOther',
    'and lists every P1 risk with the module of its first place: ' + JSON.stringify(ov.p1));
  t.ok(ov.facts[0] === 'Elements nothing reaches' + ov.unreached && ov.facts[1] === 'Disabled steps' + ov.disabled, 'what the model shows by itself, read from it: ' + JSON.stringify(ov.facts));
  t.ok(ov.next.some((x) => x === 'Main processes2') && ov.next.some((x) => x === 'Risks4') && ov.toc.join('|') === 'About|Who uses it|What it talks to|What it does|What needs attention|Where to go next',
    'where to go next, and the contents of the page: ' + ov.toc.join('|'));

  // ---- processes ----
  const pr = JSON.parse(await mx.evaluate(`JSON.stringify((function () {
    var host = window.__ovHost, v = window.__ovView, out = {};
    function rows() { return Array.from(host.querySelectorAll('.dx-pl-item')).map(function (x) { return x.textContent; }); }
    v.go({ view: 'processes', proc: 0 });
    out.title = host.querySelector('.dx-title h1').textContent; out.sub = host.querySelector('.dx-sub').textContent;
    out.list = rows(); out.on = host.querySelector('.dx-pl-item.on').getAttribute('aria-current');
    out.app = { eye: host.querySelector('.dx-pd-eye').textContent, lead: host.querySelector('.dx-pd-lead').textContent, paras: host.querySelectorAll('.dx-pd-story p').length,
      who: Array.from(host.querySelectorAll('.dx-pd-who li')).map(function (x) { return x.textContent; }), index: host.querySelectorAll('.dx-pd-idx').length };
    v.go({ proc: 1 });
    out.p1 = { eye: host.querySelector('.dx-pd-eye').textContent, steps: Array.from(host.querySelectorAll('.dx-pd-steps li')).map(function (x) { return x.textContent; }),
      flows: Array.from(host.querySelectorAll('.dx-pd-flow')).map(function (x) { return x.tagName + ':' + x.textContent; }),
      risks: Array.from(host.querySelectorAll('.dx-pd-risk')).map(function (x) { return x.textContent; }), prov: host.querySelector('.dx-prov').textContent };
    host.querySelector('.dx-pd-flow').click();
    out.opened = v.state().view + ':' + v.state().key;
    v.go({ view: 'processes', proc: 2 });
    out.p2 = { story: host.querySelectorAll('.dx-pd-story').length, empty: host.querySelector('.dx-pd-side .dx-empty') && host.querySelector('.dx-pd-side .dx-empty').textContent };
    host.remove();
    return out;
  })())`));
  t.ok(pr.title === 'Processes' && pr.sub === 'What OvDemo does, told as two business processes. An agent wrote them from the model; each one lists the flows that carry it.',
    'Processes says what it is: ' + pr.sub);
  t.ok(pr.list.length === 3 && pr.list[0] === '—The applicationFull description · 2 paragraphs' && pr.list[1] === '01Taking an order2 steps · 2 flows · 2 risks' && pr.list[2] === '02Closing the day1 step · 1 flow' && pr.on === 'page',
    'the list: the application, then every process with its counts: ' + JSON.stringify(pr.list));
  t.ok(pr.app.eye === 'OvDemo · full description' && pr.app.lead === desc.app.summary && pr.app.paras === 2 && pr.app.who.join('|') === 'Clerks Take the orders.|Managers Watch the totals.|<b>Auditors</b>' && pr.app.index === 2,
    'the application’s item: its whole summary, who uses it, every paragraph of its description, and the processes: ' + JSON.stringify(pr.app));
  t.ok(pr.p1.eye === 'Process 01 of 2' && pr.p1.steps.join('|') === '1Open a new order|2Save it', 'a process’s steps, all of them, numbered from 1');
  t.ok(pr.p1.flows.length === 2 && pr.p1.flows[0].indexOf('BUTTON:MF' + A.split('.')[0] + '.') === 0 && pr.p1.flows[1] === 'DIV:··Sales.NoSuchFlow',
    'its flows, a name the model does not have kept as text, not a link: ' + JSON.stringify(pr.p1.flows));
  t.ok(pr.p1.risks.join('|') === 'P1Anyone can delete|P2Saved twice', 'only the risks on its flows, P1 first — a "|mf" place included, a risk elsewhere not: ' + JSON.stringify(pr.p1.risks));
  t.ok(/^Written by an agent from the model\./.test(pr.p1.prov) && pr.opened === 'refs:microflow:' + A, 'it says who wrote it, and a flow opens where the flows are');
  t.ok(pr.p2.story === 0 && pr.p2.empty === 'No risk touches these flows.', 'a process with no description and no risks says so rather than showing empty sections');
};
