/* A REST call's step and a step that sets members from a variable (public/docs-data.js restParts,
 * public/flowtrace.js members).
 *
 * Karol, 2026-10-13: the whole address of a REST call stood in its step — a constant, a path and a
 * query of expressions, wrapped over five lines. The step now says the method and the last part
 * of the path; the inspector takes the address apart. And picking a step that creates an object
 * from a variable that is set and then changed drew "list is not a function" instead of the screen:
 * a local variable hid the helper that writes the step numbers. */
'use strict';

const FLOW = {
  qualifiedName: 'Sales.Rest_Demo', module: 'Sales', name: 'Rest_Demo',
  graph: {
    nodes: [
      { id: 's', kind: 'start' },
      { id: 'v', kind: 'activity', action: 'CreateVariableAction', title: '$Next', props: { out: 'Next', dataType: 'String', value: "'a'" } },
      { id: 'w', kind: 'activity', action: 'ChangeVariableAction', title: '$Next', props: { object: 'Next', value: "'b'" } },
      { id: 'r', kind: 'activity', action: 'RestCallAction', kicker: 'Call REST service', title: "Post @Sales.ApiUrl/rest/orders/v1/order?Number=trim($Next)&Kind='x&y'" },
      { id: 'c', kind: 'activity', action: 'CreateChangeAction', title: '$Order', props: { out: 'Order', entity: 'Sales.Order' },
        fields: [{ name: 'Number', value: '$Next' }, { name: 'Customer', value: "'c'" }] },
      { id: 'e', kind: 'end' }
    ],
    edges: [{ from: 's', to: 'v' }, { from: 'v', to: 'w' }, { from: 'w', to: 'r' }, { from: 'r', to: 'c' }, { from: 'c', to: 'e' }]
  }
};

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxDocsData && !!window.MxDocsView && !!window.MxFlowView && !!window.MxFlowTrace && !!window.MxDescribe', 15000, 'MxScout loaded');
  const r = JSON.parse(await mx.evaluate(`(function () {
    var F = ${JSON.stringify(FLOW)};
    var e = MxDocsData.flowEntry(F, 'microflow');
    var data = MxDocsData.build({ modules: [{ name: 'Sales' }], entities: [{ qualifiedName: 'Sales.Order', name: 'Order', module: 'Sales', attributes: [{ name: 'Number', type: 'String' }, { name: 'Customer', type: 'String' }] }], microflows: [], nanoflows: [], pages: [] }, { name: 'RestDemo' });
    data.flows[e.key] = e; data.modules[0].microflows.push(e.key);
    var host = document.createElement('div'); host.style.height = '900px'; host.style.width = '1440px'; document.body.appendChild(host);
    MxDescribe.attach(data, MxDescribe.parse(JSON.stringify({ format: 'mxscout-descriptions', version: 1,
      risks: [{ level: 'P3', title: 'Rest', detail: 'x', fix: 'y', where: ['Sales.Rest_Demo'] }] })).value);
    var v = MxDocsView.mount(data, host, { preview: true });
    var out = {};
    function look(step) {
      try { v.go({ view: 'refs', mode: 'modeler', module: 'Sales', seg: 'microflow', key: e.key, step: step }); return { ok: true }; }
      catch (x) { return { ok: false, err: String(x && x.message) }; }
    }
    out.rest = look(4);
    out.cards = Array.from(host.querySelectorAll('.sv-act-cap')).map(function (x) { return x.textContent; });
    out.text = host.textContent;
    out.caps = Array.from(host.querySelectorAll('.xi-sec h3')).map(function (x) { return x.textContent; });
    out.member = look(5);
    out.memberText = Array.from(host.querySelectorAll('.mf-step-win .sv-table tbody tr')).map(function (tr) { return tr.children[0].textContent + '=' + tr.children[2].textContent; }).join('|');
    host.remove();
    out.md = MxDocsView.markdown(data);
    return JSON.stringify(out);
  })()`));
  t.ok(r.rest.ok, 'the REST step can be picked: ' + JSON.stringify(r.rest));
  t.ok(r.cards.indexOf('POST order') !== -1 && !r.cards.some((c) => /@Sales\.ApiUrl/.test(c)), 'the step says the method and the last part of the path, not the address: ' + JSON.stringify(r.cards));
  t.ok(['Request', 'Query parameters 2', 'Address'].every((c) => r.caps.indexOf(c) !== -1), 'the inspector takes the address apart: ' + JSON.stringify(r.caps));
  t.ok(/Location@Sales\.ApiUrl/.test(r.text) && /Path\/rest\/orders\/v1\/order/.test(r.text) && /Numbertrim\(\$Next\)/.test(r.text) && /Kind'x&y'/.test(r.text),
    'with its location, its path and each query parameter, an & inside a string kept');
  t.ok(r.member.ok, 'a step that sets members from a variable set and then changed is drawn: ' + JSON.stringify(r.member));
  t.ok(/Number=\$Next/.test(r.memberText), 'and lists its members with their values: ' + r.memberText);
  t.ok(/POST order/.test(r.md) && /@Sales\.ApiUrl\/rest\/orders/.test(r.md), 'the Markdown keeps the whole address beside the short name');
};
