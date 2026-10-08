/* The spacing and type scales, and the one surface migrated onto them
 * (ROADMAP step 62).
 *
 * Phase 4 of the UX audit measured this stylesheet and found 571 spacing
 * declarations using 23 different values, 75% of them off any scale, plus 17
 * font sizes including half-pixels. The fix is not a sweep — a blind rewrite
 * of 571 declarations is the shape of change that has broken this app before.
 * It is scales in :root, and one surface at a time moved onto them.
 *
 * So this file guards two things. That the scales themselves keep their
 * values, because a token quietly set to 15px is worse than no token at all.
 * And that the performance setup and recordings list still resolve to them —
 * including the rule that made the steps read as one block: the gap BETWEEN
 * two steps must beat the padding INSIDE one, or grouping says the opposite
 * of what the layout means. */
'use strict';
const MODEL = require('./model');

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'MxScout loaded');

  await mx.evaluate(`(async () => {
    await MxStore.saveProjectWithModel(
      { id: 'scale-p', name: 'ScaleProj', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        source: { kind: 'test' }, bytes: 100, summary: null, appUrl: null },
      ${JSON.stringify(MODEL)});
    const db = await new Promise((res, rej) => { const q = indexedDB.open('mxscout'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
    const rec = { id: 'scale-r', projectId: 'scale-p', tool: 'mxscout-perf-recording', version: 1, intervalMs: 50,
      adminUrl: 'http://127.0.0.1:1', started: new Date(Date.now() - 60000).toISOString(),
      stopped: new Date().toISOString(), samples: [{ at: 0, requests: {} }] };
    await new Promise((res, rej) => { const tx = db.transaction(['recordings'], 'readwrite'); tx.objectStore('recordings').put(rec); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    return true;
  })()`);
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'ScaleProj')`, 10000, 'project in sidebar');
  await mx.evaluate(`(function(){ var e = Array.from(document.querySelectorAll('button,a')).filter(n => n.textContent.trim() === 'ScaleProj'); e[e.length - 1].click(); return true; })()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'Performance')`, 8000, 'project open');
  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => n.textContent.trim() === 'Performance')[0].click()`);
  await mx.waitFor(`!!document.querySelector('.perf-steps')`, 10000, 'the setup steps are on screen');

  const tokens = await mx.evaluate(`(function(){
    var r = getComputedStyle(document.documentElement);
    return ['--space-1','--space-2','--space-3','--space-4','--space-5','--space-6','--space-7',
            '--text-xs','--text-sm','--text-base','--text-lg','--text-xl','--text-2xl']
      .map(function(n){ return n + '=' + r.getPropertyValue(n).trim(); }).join(' ');
  })()`);
  t.ok(/--space-1=4px/.test(tokens) && /--space-2=8px/.test(tokens) && /--space-3=16px/.test(tokens) &&
       /--space-4=24px/.test(tokens) && /--space-5=32px/.test(tokens) && /--space-6=48px/.test(tokens) &&
       /--space-7=64px/.test(tokens),
    'the spacing scale is 4/8/16/24/32/48/64 and nothing else: ' + tokens);
  t.ok(/--text-xs=12px/.test(tokens) && /--text-sm=14px/.test(tokens) && /--text-base=16px/.test(tokens) &&
       /--text-lg=18px/.test(tokens) && /--text-xl=20px/.test(tokens) && /--text-2xl=24px/.test(tokens),
    'the type scale carries no half-pixels and no 13px');

  const layout = await mx.evaluate(`(function(){
    var steps = Array.from(document.querySelectorAll('.perf-step'));
    var gap = steps.length > 1 ? Math.round(steps[1].getBoundingClientRect().top - steps[0].getBoundingClientRect().bottom) : -1;
    var pad = parseFloat(getComputedStyle(steps[1]).paddingTop);
    return JSON.stringify({ gap: gap, pad: pad, stepsGap: getComputedStyle(document.querySelector('.perf-steps')).gap });
  })()`);
  const L = JSON.parse(layout);
  t.ok(L.stepsGap === '16px', 'the steps are spaced on the scale, not on 2px: ' + L.stepsGap);
  t.ok(L.gap > L.pad,
    'the gap between two steps beats the padding inside one, so three steps read as three: ' + L.gap + ' vs ' + L.pad);

  const typeAndGaps = await mx.evaluate(`(function(){
    var out = {};
    var k = document.querySelector('.rec-fig .k');
    if (k) out.figLabel = getComputedStyle(k).fontSize;
    var v = document.querySelector('.rec-fig .v');
    if (v) out.figValue = getComputedStyle(v).fontSize;
    var a = document.querySelector('.rec-actions');
    if (a) out.actionsGap = getComputedStyle(a).gap;
    var title = document.querySelector('.perf-step-title');
    if (title) out.stepTitle = getComputedStyle(title).fontSize;
    return JSON.stringify(out);
  })()`);
  const T = JSON.parse(typeAndGaps);
  const TYPE = ['12px', '14px', '16px', '18px', '20px', '24px'];
  t.ok(TYPE.indexOf(T.figLabel) >= 0 && TYPE.indexOf(T.figValue) >= 0 && TYPE.indexOf(T.stepTitle) >= 0,
    'the recordings list and step titles sit on the type scale: ' + JSON.stringify(T));
  t.ok(T.actionsGap === '8px',
    'the recording card actions are spaced on the scale: ' + T.actionsGap);

  // The label still has to lose to the number it labels — a scale that
  // flattened that would have traded one problem for a worse one.
  t.ok(parseFloat(T.figValue) > parseFloat(T.figLabel),
    'and the value still outweighs its label: ' + T.figValue + ' over ' + T.figLabel);
};
