/* Microflows, Nanoflows and Pages in the documentation (public/docs-view.js on public/flowview.js, redesign spec 14).
 *
 * The report runs MxScout's own Microflows screen. What has to hold here, beyond what test 55 holds
 * for the app's shell and test 47 for the exported file:
 *  - a way to a flow from another page of the report — Processes, Modules, Risks, Model quality —
 *    lands on that flow, in the list of its own kind, its module chosen;
 *  - the kinds: the sidebar picks one, which lists only its own, untagged; every kind together (an
 *    address only) tags each row;
 *  - a risk placed "Module.Name|pg" is on the page of that name and not on the flow, "|mf" the other
 *    way round, and a bare name on both;
 *  - a page has no flow drawing (its own, pagepreview.js, is test 75's): its details, what opens it, and the risks on it;
 *  - the agent's description, said to be out of date when the flow changed since. */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxDescribe && !!window.MxDocsData && !!window.MxDocsView && !!window.MxFlowView', 15000, 'MxScout loaded');
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const desc = {
    format: 'mxscout-descriptions', version: 1,
    microflows: { 'Sales.CreateOrder': { hash: '00000000', text: 'Opens a fresh order.' } },
    app: { summary: 'Orders.', processes: [{ name: 'Taking an order', steps: ['Save it'], flows: ['Sales.CreateOrder'] }] },
    risks: [
      { level: 'P2', title: 'On the flow only', where: ['Sales.CreateOrder|mf'] },
      { level: 'P1', title: 'On the page only', where: ['Sales.CreateOrder|pg'] },
      { level: 'P3', title: 'On both', where: ['Sales.CreateOrder'] }
    ]
  };
  const r = JSON.parse(await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    var data = MxDocsData.build(model, { name: 'FlowsDemo' });
    MxDescribe.attach(data, MxDescribe.parse(${JSON.stringify(JSON.stringify(desc))}).value);
    var host = document.createElement('div'); host.style.height = '800px'; document.body.appendChild(host);
    var v = MxDocsView.mount(data, host, { preview: true });
    function rows() { return Array.from(host.querySelectorAll('.mf-row')).map(function (x) { return x.textContent; }); }
    function here() { var s = v.state(); return s.view + ':' + s.key + ':' + s.seg + ':' + (host.querySelector('.mf-row.on .mf-row-name') || {}).textContent; }
    function risks() { return Array.from(host.querySelectorAll('.xi-risk-title')).map(function (x) { return x.textContent; }); }
    var out = { kinds: Object.keys(data.flows).map(function (k) { return data.flows[k].kind; }) };

    // from Processes
    v.go({ view: 'processes', proc: 1 });
    host.querySelector('.dx-pd-flow').click();
    out.fromProcess = here();
    out.flowRows = rows();
    // the flow's risks and description are part of the flow as a whole, behind About
    var ab = host.querySelector('.mf-about-open'); if (ab) ab.click();
    out.flowRisks = risks();
    out.desc = (host.querySelector('.xi-prov') || {}).textContent;
    // the kinds: the sidebar picks one (as MxScout's); every kind together is still an address
    v.go({ view: 'refs', seg: 'all', key: null });
    out.allRows = rows();
    out.allState = here();
    Array.from(host.querySelectorAll('.dx-nav-item')).filter(function (b) { return /^Pages/.test(b.textContent); })[0].click();
    // a drawn page has what it is behind About this page, in a window over the drawing
    var pab = host.querySelector('.mf-detail .mf-about-open'); if (pab) pab.click();
    out.page = { rows: rows(), label: host.querySelector('.mf-detail').getAttribute('aria-label'), graph: !!host.querySelector('.fg'), risks: risks(),
      caps: Array.from(host.querySelectorAll('.mf-page .xe-caps, .pp-win-body .xe-caps')).map(function (x) { return x.firstChild.textContent; }), actions: host.querySelectorAll('.mf-actions button:not(.mf-about-open)').length };
    // from Modules, Risks and Model quality
    v.go({ view: 'modules', module: 'Sales' });
    v.go({ view: 'modules', module: 'Sales', mtab: 'contents' });
    var chip = Array.from(host.querySelectorAll('.dx-mc-item')).filter(function (b) { return /SweepOrders/.test(b.textContent); })[0];
    if (chip) chip.click();
    out.fromModules = here();
    v.go({ view: 'risks' });
    Array.from(host.querySelectorAll('.dx-rk-row')).filter(function (b) { return /On the flow only/.test(b.textContent); })[0].click();
    Array.from(host.querySelectorAll('.dx-rk-where')).filter(function (b) { return /CreateOrder/.test(b.textContent); })[0].click();
    out.fromRisks = here();
    v.go({ view: 'quality' });
    var q = host.querySelector('.dx-q-table button.dx-q-row');
    out.unreached = data.quality.unreached[0] || null;
    if (q) { q.click(); out.fromQuality = here(); }
    host.remove();
    return JSON.stringify(out);
  })()`));
  t.ok(r.fromProcess === 'refs:microflow:Sales.CreateOrder:microflow:CreateOrder', 'a flow on Processes opens that flow, in the microflows, chosen in the list: ' + r.fromProcess);
  t.ok(r.flowRows.every((x) => !/^(MF|NF|PG)/.test(x)), 'a list of one kind has names only: ' + r.flowRows.join(','));
  t.ok(r.flowRisks.join('|') === 'On the flow only|On both', 'the flow carries the risks placed on it and on its bare name, not the page’s: ' + r.flowRisks.join('|'));
  t.ok(/changed after it was written/.test(r.desc), 'and its description says it was written before the flow changed: ' + r.desc);
  t.ok(r.allRows.length === r.kinds.length && r.allRows.every((x) => /^(MF|NF|PG)/.test(x)) && /^refs:null:all:/.test(r.allState),
    'All lists every flow and page, each with its kind: ' + r.allRows.join(','));
  t.ok(r.page.rows.every((x) => /^CreateOrder|^[A-Z]/.test(x)) && /^Selected page: /.test(r.page.label) && !r.page.graph,
    'a page shows no flow drawing: ' + JSON.stringify(r.page));
  t.ok(r.page.caps.join('|') === 'Details|Opened from|Risks' && r.page.actions === 0, 'its details, what opens it and its risks — and in the app’s preview no Copy link: ' + r.page.caps.join('|'));
  if (r.page.label === 'Selected page: CreateOrder') t.ok(r.page.risks.join('|') === 'On the page only|On both', 'a page carries the risks placed on it, not the flow’s: ' + r.page.risks.join('|'));
  t.ok(r.fromModules === 'refs:microflow:Sales.SweepOrders:microflow:SweepOrders', 'a flow on a module’s page opens that flow: ' + r.fromModules);
  t.ok(r.fromRisks === 'refs:microflow:Sales.CreateOrder:microflow:CreateOrder', 'a place in a risk opens that flow: ' + r.fromRisks);
  if (r.unreached) t.ok(r.fromQuality && r.fromQuality.indexOf('refs:' + r.unreached + ':') === 0, 'an element on Model quality opens that element: ' + r.fromQuality);
};
