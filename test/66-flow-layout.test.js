/* A step of a flow, in its window over the drawing (public/flowview.js stepWindow, studioview.js).
 * Karol, 2026-10-14: the flow is drawn as Studio Pro keeps it, and nothing else; a click on a step
 * opens its details in a window — what the step does beside Studio Pro's properties dialog — with a
 * button to what the step works on (the flow it calls, the entity it creates), and no button where
 * that is not something the model holds (an association). An address with a step opens it. */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStudioView && !!window.MxDocsData && !!window.MxDocsView', 15000, 'MxScout loaded');
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  // ---- the Studio Pro view: the inspector, and a button to what a step works on ----
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const s = JSON.parse(await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    var data = MxDocsData.build(model, { name: 'StudioDemo' });
    var ent = Object.keys(data.entities)[0];
    var e = JSON.parse(JSON.stringify(data.flows['microflow:Sales.CreateOrder']));
    e.qn = 'Sales.StudioCase'; e.name = 'StudioCase'; e.key = 'microflow:Sales.StudioCase';
    function card(fam, action, kick, title, rows, ref) { return { fam: fam, action: action, kick: kick, title: title, detail: null, ref: ref || null, off: false, err: false, doc: null, rows: rows, fields: null }; }
    e.workflow = [{ t: 'start' },
      { t: 'step', no: 2, card: card('call', 'MicroflowCallAction', 'Call microflow', 'SweepOrders', [['Refers to', 'Sales.SweepOrders']], { kind: 'microflow', qn: 'Sales.SweepOrders' }) },
      { t: 'step', no: 3, card: card('obj', 'CreateChangeAction', 'Create object', ent.split('.')[1], [['Refers to', ent]]) },
      { t: 'step', no: 4, card: card('db', 'RetrieveAction', 'Retrieve by association', 'Order_Customer', [['Refers to', 'Sales.Order_Customer']]) },
      { t: 'end', kind: 'end', label: 'End' }];
    e.steps = 4;
    data.flows[e.key] = e; data.modules[0].microflows.push(e.key);
    var host = document.createElement('div'); host.style.height = '900px'; host.style.width = '1440px'; document.body.appendChild(host);
    var v = MxDocsView.mount(data, host, { preview: true });
    var out = {};
    function at(no) {
      v.go({ view: 'refs', mode: 'modeler', module: 'Sales', seg: 'microflow', key: e.key, step: no });
      var go = host.querySelector('.mf-step-win .sv-go');
      return { insp: !!host.querySelector('.mf-step-win-insp .mf-step'), noLoop: !host.querySelector('.mf-step-win .mf-studio-link'), go: go ? go.textContent : null,
        props: (host.querySelector('.mf-step-win-head .xe-caps') || {}).textContent, groups: host.querySelectorAll('.mf-step-win-props .sv-groups > *').length };
    }
    out.call = at(2);
    // In the documentation's frame (.dx button { color: inherit }) the Open button took the heading's blue on blue.
    var gs = getComputedStyle(host.querySelector('.mf-step-win .sv-go'));
    out.goLook = gs.color + ' on ' + gs.backgroundColor;
    host.querySelector('.mf-step-win .sv-go').click();
    out.afterCall = { key: v.state().key, studio: !!host.querySelector('.mf-step-win') };
    out.create = at(3);
    host.querySelector('.mf-step-win .sv-go').click();
    out.afterCreate = { view: v.state().view, entity: v.state().entity };
    out.assoc = at(4);
    out.ent = ent;
    host.remove();
    return JSON.stringify(out);
  })()`));
  t.ok(s.call.insp && s.call.noLoop && s.call.props === 'Step 2 · Call Microflow' && s.call.groups > 0, 'a step opens in a window: what it does beside Studio Pro’s properties, without a link back to itself: ' + JSON.stringify(s.call));
  t.ok(/^rgb\(255, 255, 255\) on rgb\(\d+, \d+, 2\d\d\)/.test(s.goLook), 'in the documentation too the Open button is white on blue, readable: ' + s.goLook);
  t.ok(s.call.go === 'Open SweepOrders →' && s.afterCall.key === 'microflow:Sales.SweepOrders' && !s.afterCall.studio, 'a call has a button to the flow it calls, which goes there: ' + JSON.stringify([s.call.go, s.afterCall]));
  t.ok(s.create.go === 'Open ' + s.ent.split('.')[1] + ' →' && s.afterCreate.view === 'domain' && s.afterCreate.entity === s.ent, 'a step on an entity has a button to the entity: ' + JSON.stringify([s.create.go, s.afterCreate]));
  t.ok(s.assoc.insp && s.assoc.go === null, 'a retrieve by association names an association, not an entity: no button to nothing');
};
