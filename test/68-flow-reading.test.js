/* Reading a flow: what Karol found hard on a real project, 2026-10-13 (public/flowview.js).
 *  - a member a Create or Change object sets is a row of the properties table, its long value laid
 *    out: each `then` body, `else if` and `else` on its own line;
 *  - a way out of a decision that runs through several steps says which, not "step N, then end";
 *  - who may start a flow names its module roles without the module in front of each. */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxDocsData && !!window.MxDocsView', 15000, 'MxScout loaded');
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  // ---- members, ways, roles ----
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const r = JSON.parse(await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    var data = MxDocsData.build(model, { name: 'ReadDemo' });
    var e = JSON.parse(JSON.stringify(data.flows['microflow:Sales.CreateOrder']));
    e.qn = 'Sales.ReadCase'; e.name = 'ReadCase'; e.key = 'microflow:Sales.ReadCase';
    e.roles = ['Sales.Clerk', 'Sales.Manager', 'Admin.Owner'];
    e.params = [{ name: 'Helper', type: 'Sales.Order' }];
    var expr = "if $Helper/Kind = 'A' then Sales.Kind.Solved else if $Helper/Kind = 'B, then else' then Sales.Kind.Waiting else Sales.Kind.Rejected";
    var create = { fam: 'obj', action: 'CreateChangeAction', kick: 'Create object', title: 'Order', detail: null, ref: null, off: false, err: false, doc: null, rows: [['Refers to', 'Sales.Order']],
      props: { entity: 'Sales.Order', out: 'NewOrder' }, fields: [{ name: 'Status', value: expr }, { name: 'Number', value: '$Helper/Number' }] };
    function step(no, title) { return { t: 'step', no: no, card: { fam: 'var', action: 'ChangeVariableAction', kick: 'Change variable', title: title, rows: [], fields: null } }; }
    e.workflow = [{ t: 'start' }, { t: 'step', no: 2, card: create },
      { t: 'split', no: 3, kind: 'decision', title: 'Ok?', cond: '$Helper != empty', branches: [
        { label: 'true', body: [step(4, '$A'), { t: 'split', no: 5, kind: 'decision', title: 'More?', cond: 'true', branches: [{ label: 'true', body: [{ t: 'end', kind: 'end', label: 'End' }], ends: true }, { label: 'false', body: [step(6, '$B'), { t: 'end', kind: 'end', label: 'End' }], ends: true }] }], ends: true },
        { label: 'false', body: [step(7, '$C'), { t: 'end', kind: 'end', label: 'End' }], ends: true }] }];
    e.steps = 7;
    data.flows[e.key] = e; data.modules[0].microflows.push(e.key);
    var host = document.createElement('div'); host.style.height = '900px'; host.style.width = '1440px'; document.body.appendChild(host);
    var v = MxDocsView.mount(data, host, { preview: true });
    v.go({ view: 'refs', mode: 'modeler', module: 'Sales', seg: 'microflow', key: e.key, step: 2 });
    var out = {};
    // the members: the properties dialog's table in the step's window, a member, its type, its value
    var rows = Array.from(host.querySelectorAll('.mf-step-win .sv-table tbody tr'));
    out.rows = rows.map(function (x) { return { first: x.children[0].textContent, value: x.children[2].textContent }; });
    out.arrow = !!host.querySelector('.mf-step-win .mf-arrow');
    v.go({ step: 3 });
    out.ways = Array.from(host.querySelectorAll('.mf-step .mf-kv, .mf-step [class*="kv"]')).map(function (x) { return x.textContent; }).join(' | ') || host.querySelector('.mf-step').textContent;
    // who may start it is part of the flow as a whole, behind About in the header
    var about = host.querySelector('.mf-about-open'); if (about) about.click();
    out.who = Array.from(host.querySelectorAll('.xi-note')).map(function (x) { return x.textContent; }).join(' | ');
    host.remove();
    return JSON.stringify(out);
  })()`));
  const status = r.rows.find((x) => /Status/.test(x.first)), number = r.rows.find((x) => /Number/.test(x.first));
  t.ok(status && number && !r.arrow, 'each member in its own row, its value beside it — no arrow: ' + JSON.stringify(r.rows.map((x) => x.first)));
  t.ok(status && status.value === "if $Helper/Kind = 'A' then\n  Sales.Kind.Solved\nelse if $Helper/Kind = 'B, then else' then\n  Sales.Kind.Waiting\nelse\n  Sales.Kind.Rejected",
    'a long value is laid out, each branch on its own line, a quoted "then else" left alone: ' + JSON.stringify(status && status.value));
  t.ok(number && number.value === '$Helper/Number', 'a short one stays as it is: ' + JSON.stringify(number));
  t.ok(/truesteps 4, 5 and 6/.test(r.ways) && /falsestep 7, then end/.test(r.ways), 'a way through several steps says which, one step and its end says so: ' + r.ways.slice(0, 200));
  t.ok(/Module roles that may start it: Clerk, Manager, Admin\.Owner\./.test(r.who), 'start roles of its own module without the module, another module’s with it: ' + r.who);
};
