/* The documentation as one Markdown file (public/docs-view.js markdown(), redesign spec 20).
 *
 * What has to hold:
 *  - the pages in the order of the menu, # for the project, ## for a page;
 *  - every number the HTML shows for the model is the same in the Markdown;
 *  - a flow with a risk, a description or a process behind it has its steps as a list, branches
 *    indented under "if …"; any other flow is one line (Karol, 2026-10-13);
 *  - qualified names in backticks, the agent's text marked, text escaped so a name with markup in it
 *    stays text and a | cannot break a table;
 *  - no tool is named;
 *  - the exported file carries a button that makes the same file. */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxDescribe && !!window.MxDocsData && !!window.MxDocsView && !!window.MxReportData', 15000, 'MxScout loaded');
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const desc = {
    format: 'mxscout-descriptions', version: 1,
    app: { summary: 'Takes orders. <img src=x onerror=alert(1)> stays text.', story: 'First.\n\nSecond.', audience: [{ who: 'Clerks', what: 'Take orders.' }],
      processes: [{ name: 'Taking an order', summary: 'A clerk records an order.', steps: ['Open', 'Save'], flows: ['Sales.CreateOrder'] }] },
    risks: [{ level: 'P1', theme: 'access', title: 'Anyone | everyone can sweep', detail: 'No check.', fix: 'Check.', where: ['Sales.SweepOrders'] }],
    context: { where: [{ topic: 'Where orders start', place: 'Sales.CreateOrder.' }], conventions: [{ pattern: 'Create*', meaning: 'Makes a record.' }], pitfalls: ['Mind the number.'] }
  };
  const r = JSON.parse(await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    var data = MxDocsData.build(model, { name: 'MdDemo' });
    // a third flow with no risk, no description and no process behind it
    var extra = JSON.parse(JSON.stringify(data.flows['microflow:Sales.CreateOrder'])); extra.qn = 'Sales.Extra'; extra.name = 'Extra'; extra.key = 'microflow:Sales.Extra';
    data.flows['microflow:Sales.Extra'] = extra; data.modules.filter(function (m) { return m.name === 'Sales'; })[0].microflows.push('microflow:Sales.Extra');
    MxDescribe.attach(data, MxDescribe.parse(${JSON.stringify(JSON.stringify(desc))}).value);
    var md = MxDocsView.markdown(data);
    // the same numbers the HTML shows, read off the page
    var host = document.createElement('div'); document.body.appendChild(host);
    var v = MxDocsView.mount(data, host, { preview: true });
    var glance = {};
    Array.from(host.querySelectorAll('.dx-glance dt')).forEach(function (dt) { glance[dt.textContent] = dt.nextSibling.textContent; });
    v.go({ view: 'quality' });
    var cards = Array.from(host.querySelectorAll('.dx-q-card')).map(function (c) { return [c.querySelector('b').textContent, c.querySelector('.dx-q-v').textContent.replace('of ', ' of ')]; });
    host.remove();
    return JSON.stringify({ md: md, glance: glance, cards: cards, kpi: data.kpi, flows: Object.keys(data.flows).filter(function (k) { return data.flows[k].kind !== 'page'; }).map(function (k) { return data.flows[k].qn; }) });
  })()`));
  const md = r.md;
  const heads = md.split('\n').filter((l) => /^#{1,2} /.test(l));
  t.ok(heads.join('|') === '# MdDemo — documentation|## Overview|## Processes|## Modules|## Microflows & pages|## Domain model|## Architecture|## Risks|## Model quality|## For developers',
    'the pages in the order of the menu: ' + heads.join('|'));
  const missing = Object.keys(r.glance).filter((k) => md.indexOf('| ' + k + ' | ' + r.glance[k] + ' |') === -1);
  t.ok(missing.length === 0, 'At a glance says in Markdown what it says in HTML: ' + JSON.stringify({ missing: missing, glance: r.glance }));
  const qMissing = r.cards.filter((c) => md.indexOf('### ' + c[0].replace(/^Switched-off step$/, 'Switched-off steps')) === -1 || md.indexOf('(' + c[1].replace(/\s+/g, ' ').trim() + ')') === -1);
  t.ok(qMissing.length === 0, 'every Model quality count is the same: ' + JSON.stringify({ missing: qMissing, cards: r.cards }));
  t.ok(/- P1 · fix first: 1\n- P2 · plan a fix: 0\n- P3 · worth knowing: 0/.test(md) && /1 finding: 1 P1, 0 P2, 0 P3\./.test(md), 'the risk counts are the same as the pages’');
  t.ok(/#### `Sales\.SweepOrders` — microflow/.test(md) && /#### `Sales\.CreateOrder` — microflow/.test(md),
    'a flow a risk names, and one a process carries, are written out in full');
  const full = md.slice(md.indexOf('#### `Sales.SweepOrders`'));
  t.ok(/Steps \(\d+\):\n\n(\d+\. .+\n)+/.test(full) && /\n {3}- if /.test(full) && /\. Loop for each /.test(full), 'with its steps as a numbered list, branches indented under “if …”, loops too');
  const others = r.flows.filter((q) => q !== 'Sales.SweepOrders' && q !== 'Sales.CreateOrder');
  t.ok(others.length === 1 && others.every((q) => new RegExp('^- `' + q.replace('.', '\\.') + '` · (microflow|nanoflow) · \\d+ steps? · calls \\d+ · called by \\d+$', 'm').test(md)), 'any other flow is one line: ' + others.join(', '));
  t.ok(md.indexOf('<img') === -1 && md.indexOf('&lt;img src=x onerror=alert(1)&gt; stays text.') !== -1, 'text with markup in it is escaped — it stays text in any Markdown viewer');
  t.ok(md.indexOf('Anyone \\| everyone') !== -1 || md.indexOf('#### R-001 · Anyone | everyone can sweep') !== -1, 'a | inside a table cell cannot break the table');
  t.ok(/> Written by an agent from the model\./.test(md) && /`Sales\.CreateOrder`/.test(md), 'the agent’s text is marked, qualified names are in backticks');
  t.ok(!/MxScout|mxscout/.test(md), 'and no tool is named');

  // ---- the button in the exported file ----
  const inFile = JSON.parse(await mx.evaluate(`(async function () {
    var host = document.createElement('div'); document.body.appendChild(host);
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    var data = MxDocsData.build(model, { name: 'MdDemo' });
    MxDocsView.mount(data, host, {});
    var got = null, orig = URL.createObjectURL;
    URL.createObjectURL = function (b) { got = b; return 'blob:test'; };
    var clicked = null, origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { clicked = this.getAttribute('download'); };
    var b = host.querySelector('.dx-side-foot .dx-md-dl');
    if (b) b.click();
    URL.createObjectURL = orig; HTMLAnchorElement.prototype.click = origClick;
    var text = got ? await got.text() : null;
    host.remove();
    return JSON.stringify({ button: !!b, label: b && b.textContent, name: clicked, starts: text && text.slice(0, 28), same: text === MxDocsView.markdown(data) });
  })()`));
  t.ok(inFile.button && inFile.label === 'Download as Markdown' && inFile.name === 'MdDemo-documentation-' + new Date().toISOString().slice(0, 10) + '.md',
    'the file has a Download as Markdown button, named like the HTML file: ' + JSON.stringify(inFile));
  t.ok(inFile.starts === '# MdDemo — documentation\nMen' && inFile.same, 'and it hands over exactly the same Markdown');
};
