/* The Studio Pro view draws the flow where Studio Pro keeps it (public/docs-data.js canvasOf,
 * public/studioview.js drawn).
 *
 * Karol, 2026-10-13: a big flow laid out again by MxScout came out unreadable — "Mendix has them
 * drawn already, show them as they are drawn". What has to hold:
 *  - every object stands where the model keeps it, inside a loop counted from the loop's corner;
 *  - each line leaves and enters by the side the model records (0 top, 1 right, 2 bottom, 3 left)
 *    and carries its case value;
 *  - Ctrl and the wheel zoom it; a model without positions still gets the old layout. */
'use strict';

function flow(withPositions) {
  const at = (x, y, w, h) => withPositions ? { at: { x: x, y: y }, size: { width: w, height: h } } : {};
  return {
    qualifiedName: 'Sales.Drawn', module: 'Sales', name: 'Drawn', parameters: [{ name: 'Order', entityQualifiedName: 'Sales.Order' }],
    graph: {
      nodes: [
        Object.assign({ id: 's', kind: 'start' }, at(100, 200, 20, 20)),
        Object.assign({ id: 'd', kind: 'decision', title: 'Paid?', expression: '$Order/Paid' }, at(250, 200, 90, 60)),
        Object.assign({ id: 'a', kind: 'activity', action: 'ChangeObjectAction', title: '$Order', props: { object: 'Order' } }, at(450, 200, 120, 60)),
        Object.assign({ id: 'l', kind: 'loop', loop: { iteratorVariable: 'Line', listVariable: 'Lines' } }, at(450, 400, 300, 120)),
        Object.assign({ id: 'b', kind: 'activity', action: 'LogMessageAction', title: 'Line', parentId: 'l' }, at(150, 60, 120, 60)),
        Object.assign({ id: 'e', kind: 'end' }, at(650, 200, 20, 20)),
        Object.assign({ id: 'e2', kind: 'end' }, at(650, 400, 20, 20))
      ],
      edges: [
        { from: 's', to: 'd', fromSide: 1, toSide: 3 },
        { from: 'd', to: 'a', fromSide: 1, toSide: 3, caseValue: 'true' },
        { from: 'd', to: 'l', fromSide: 2, toSide: 3, caseValue: 'false' },
        { from: 'a', to: 'e', fromSide: 1, toSide: 3 },
        { from: 'l', to: 'e2', fromSide: 1, toSide: 3 }
      ]
    }
  };
}

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStudioView && !!window.MxDocsData && !!window.MxFlowTrace', 15000, 'loaded');
  await mx.viewport(1440, 900);
  const r = JSON.parse(await mx.evaluate(`(function () {
    function open(f) {
      var e = MxDocsData.flowEntry(f, 'microflow');
      var an = MxFlowTrace.analyse(e, { model: { microflows: [f] }, flow: function () { return null; } });
      var ov = MxStudioView.render(e, an, { qn: f.qualifiedName, name: f.name, selected: null, onPick: function () {}, onClose: function () {} });
      document.body.appendChild(ov);
      return ov;
    }
    var ov = open(${JSON.stringify(flow(true))});
    var c = ov.querySelector('.sv-canvas');
    function boxOf(label) { var b = Array.from(ov.querySelectorAll('.sv-act')).find(function (x) { return x.getAttribute('aria-label').indexOf(label) !== -1; }); return b ? [parseFloat(b.style.left), parseFloat(b.style.top), parseFloat(b.style.width)] : null; }
    var out = { drawn: c.classList.contains('drawn'), change: boxOf('$Order'), inLoop: boxOf('Line'), acts: Array.from(ov.querySelectorAll('.sv-act')).map(function (x) { return x.getAttribute('aria-label'); }),
      frame: (function () { var f = ov.querySelector('.sv-frame'); return [parseFloat(f.style.left), parseFloat(f.style.top), f.textContent]; })(),
      lines: Array.from(ov.querySelectorAll('.sv-edge')).map(function (p) { return p.getAttribute('points'); }),
      labels: Array.from(ov.querySelectorAll('.sv-seg-label')).map(function (x) { return x.textContent; }).sort().join(','),
      dec: (ov.querySelector('.sv-dec-cap') || {}).textContent, foot: ov.querySelector('.sv-foot').textContent };
    var strip = ov.querySelector('.sv-strip');
    strip.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, ctrlKey: true, bubbles: true, cancelable: true }));
    out.zoom = ov.querySelector('.sv-zoom .sv-mono').textContent;
    ov.remove();
    var old = open(${JSON.stringify(flow(false))});
    out.fallback = !old.querySelector('.sv-canvas').classList.contains('drawn') && old.querySelectorAll('.sv-act').length === 2;
    old.remove();
    return JSON.stringify(out);
  })()`));
  // the canvas starts 40px left of the leftmost object (the start's corner, x 90) and above the topmost (the decision's, y 170)
  t.ok(r.drawn && JSON.stringify(r.change) === JSON.stringify([340, 40, 120]),
    'an activity stands where the model keeps it, at its own size: ' + JSON.stringify(r));
  t.ok(JSON.stringify(r.inLoop) === JSON.stringify([340, 240, 120]) && r.frame[0] === 250 && r.frame[1] === 210 && /For each \$Line in \$Lines/.test(r.frame[2]),
    'inside a loop it is placed from the loop’s corner, and the loop is a frame around it: ' + JSON.stringify([r.inLoop, r.frame]));
  t.ok(r.lines.length === 5 && r.lines.some(function (p) { return /^200,100 200,112/.test(p); }),
    'each line leaves by the side the model records — the false way out of the bottom of the decision: ' + JSON.stringify(r.lines));
  // Karol, 2026-10-14: the lines stopped short of a diamond and a circle. A line meets the shape
  // drawn, not the box kept for it: out of the start's 22px circle (centre 50) at 61, into the
  // decision's diamond (a 90 by 60 box from 155, so a 60px diamond, centre 200) at its tip, 170 — not at 155.
  t.ok(r.lines.some(function (p) { return /^61,70 .*170,70$/.test(p); }),
    'a line runs from the edge of the circle to the tip of the diamond, not to the boxes around them: ' + JSON.stringify(r.lines));
  t.ok(r.labels === 'false,true' && r.dec === 'Paid?', 'lines carry their case values, and the decision its caption');
  t.ok(/Drawn as it is in Studio Pro/.test(r.foot) && r.zoom !== '100%', 'and Ctrl with the wheel zooms it: ' + r.zoom);
  t.ok(r.fallback, 'a model without positions is still laid out as before');

  // The cards drawing, on the same complaint: a way that holds most of a flow stays on the main
  // path even when it ends (flowtrace.js mainBranch, rule 0). Sent to the side, the rest of a
  // 100-step flow nested side in side, 40 000px tall (a real project's ticket API flow).
  const mb = JSON.parse(await mx.evaluate(`(function () {
    function steps(n) { var l = []; for (var i = 0; i < n; i++) l.push({ t: 'step', no: i + 10 }); l.push({ t: 'end' }); return l; }
    return JSON.stringify({
      bulk: MxFlowTrace.mainBranch({ branches: [{ label: 'true', ends: true, body: steps(12) }, { label: 'false', ends: false, body: [] }] }),
      exit: MxFlowTrace.mainBranch({ branches: [{ label: 'false', ends: true, body: steps(1) }, { label: 'true', ends: false, body: [{ t: 'step', no: 3 }, { t: 'step', no: 4 }] }] })
    });
  })()`));
  t.ok(mb.bulk === 0 && mb.exit === 1, 'the bulk of a flow stays on the main path; a short way out still goes to the side: ' + JSON.stringify(mb));
};
