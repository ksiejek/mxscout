/* A flow that jumps to a step already drawn (public/docs-data.js workflow, numberJumps).
 *
 * Most jumps in a real model land on a merge, and a merge has no number of its own: the flow
 * used to say only "continues", and a way that went back up to repeat a decision was described
 * as "step 5, then end" — which is false, the flow goes on. What has to hold:
 *  - a jump to a merge is numbered by the first step after it;
 *  - a jump that closes a cycle says it goes back, one that rejoins says it continues;
 *  - the step's window and the Markdown say the same;
 *  - a way that jumps is not called an end. */
'use strict';
const fs = require('fs');
const path = require('path');

// Start → 2 Create variable → merge → 3 "Same month?" — true: End; false: 4 Change variable → back to the merge.
const BACK = {
  qualifiedName: 'Sales.Jumps_Back', module: 'Sales', name: 'Jumps_Back',
  graph: {
    nodes: [
      { id: 's', kind: 'start' },
      { id: 'a', kind: 'activity', action: 'CreateVariableAction', title: '$Next' },
      { id: 'm', kind: 'merge' },
      { id: 'd', kind: 'decision', title: 'Same month?', expression: '$Next = $Now' },
      { id: 'e', kind: 'end' },
      { id: 'b', kind: 'activity', action: 'ChangeVariableAction', title: '$Next' }
    ],
    edges: [
      { from: 's', to: 'a' }, { from: 'a', to: 'm' }, { from: 'm', to: 'd' },
      { from: 'd', to: 'e', caseValue: 'true' }, { from: 'd', to: 'b', caseValue: 'false' }, { from: 'b', to: 'm' }
    ]
  }
};
// Start → 2 "Kind?" with three ways: A: 3 step → merge → 4 step → 5 End; B: straight to the merge; C: 6 End.
const FORWARD = {
  qualifiedName: 'Sales.Jumps_Forward', module: 'Sales', name: 'Jumps_Forward',
  graph: {
    nodes: [
      { id: 's', kind: 'start' },
      { id: 'd', kind: 'decision', title: 'Kind?', expression: '$Kind' },
      { id: 'x', kind: 'activity', action: 'LogMessageAction', title: 'A' },
      { id: 'm', kind: 'merge' },
      { id: 'y', kind: 'activity', action: 'LogMessageAction', title: 'After' },
      { id: 'e', kind: 'end' },
      { id: 'e2', kind: 'end' }
    ],
    edges: [
      { from: 's', to: 'd' }, { from: 'd', to: 'x', caseValue: 'A' }, { from: 'd', to: 'm', caseValue: 'B' }, { from: 'd', to: 'e2', caseValue: 'C' },
      { from: 'x', to: 'm' }, { from: 'm', to: 'y' }, { from: 'y', to: 'e' }
    ]
  }
};

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxDocsData && !!window.MxDescribe && !!window.MxDocsView && !!window.MxFlowView', 15000, 'MxScout loaded');
  for (const src of ['/sqlite.js', '/bson.js', '/mpr.js']) {
    await mx.evaluate(`new Promise(function (res, rej) { var x = document.createElement('script'); x.src = '${src}'; x.onload = function () { res(true); }; x.onerror = rej; document.head.appendChild(x); })`);
  }
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const r = JSON.parse(await mx.evaluate(`(async function () {
    function strip(x) { return JSON.parse(JSON.stringify(x, function (k, v) { return k === 'card' ? undefined : v; })); }
    var B = ${JSON.stringify(BACK)}, F = ${JSON.stringify(FORWARD)};
    var out = { back: strip(MxDocsData.workflow(B).tree), fwd: strip(MxDocsData.workflow(F).tree) };
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1'); } });
    var data = MxDocsData.build(model, { name: 'JumpDemo' });
    [B, F].forEach(function (f) { var e = MxDocsData.flowEntry(f, 'microflow'); data.flows[e.key] = e; data.modules[0].microflows.push(e.key); });
    var host = document.createElement('div'); host.style.height = '900px'; host.style.width = '1440px'; document.body.appendChild(host);
    // a risk names both, so the Markdown writes their steps out in full
    MxDescribe.attach(data, MxDescribe.parse(JSON.stringify({ format: 'mxscout-descriptions', version: 1,
      risks: [{ level: 'P3', title: 'Jumps', detail: 'x', fix: 'y', where: ['Sales.Jumps_Back', 'Sales.Jumps_Forward'] }] })).value);
    var v = MxDocsView.mount(data, host, { preview: true });
    function look(qn, step) {
      v.go({ view: 'refs', mode: 'modeler', module: 'Sales', seg: 'microflow', key: 'microflow:' + qn, step: step });
      return { lines: host.querySelectorAll('.sv-edge, .sv-line').length, win: !!host.querySelector('.mf-step-win'), text: host.textContent };
    }
    out.backView = look('Sales.Jumps_Back', 3);
    out.fwdView = look('Sales.Jumps_Forward', 2);
    host.remove();
    out.md = MxDocsView.markdown(data);
    return JSON.stringify(out);
  })()`));
  const goIn = (tree) => { const got = []; (function w(l) { (l || []).forEach((x) => { if (x.t === 'go') got.push(x); (x.branches || []).forEach((b) => w(b.body)); w(x.body); w(x.error); }); })(tree); return got; };
  const back = goIn(r.back), fwd = goIn(r.fwd);
  t.ok(back.length === 1 && back[0].no === 3 && back[0].back === true, 'a jump back to a merge is numbered by the decision after it, and marked as going back: ' + JSON.stringify(back));
  t.ok(fwd.length === 1 && fwd[0].no === 4 && fwd[0].back === false, 'a jump forward to a merge is numbered by the step after it, and not marked back: ' + JSON.stringify(fwd));
  // The drawing is the flow as Studio Pro keeps it (Karol, 2026-10-14), its lines where the model has them;
  // what a jump means is said where the step is read: in its window, which an address with a step opens.
  t.ok(r.backView.lines > 0 && r.fwdView.lines > 0 && r.backView.win && r.fwdView.win, 'the flow is drawn, and an address with a step opens that step’s window: ' + JSON.stringify([r.backView.lines, r.fwdView.lines]));
  t.ok(/falsestep 4, then back to step 3/.test(r.backView.text) && !/step 4, then end/.test(r.backView.text), 'the step inspector no longer calls a way that goes back an end');
  t.ok(/Bstep 4(?!,)/.test(r.fwdView.text) && !/Bend/.test(r.fwdView.text), 'a way that jumps forward goes to the step it jumps to');
  t.ok(/- goes back to step 3/.test(r.md) && /- continues at step 4/.test(r.md), 'the Markdown says the same');
};
