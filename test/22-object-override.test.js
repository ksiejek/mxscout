/* Running a microflow against an object whose attribute values you set first.
 * A flow takes an entity; you pick an object for it, then override some of its
 * attributes for this run. The bridge applies those as uncommitted changes to
 * the loaded object before calling the flow — the flow sees them, nothing is
 * written to the database. This drives it end to end and confirms the values
 * actually reach the object the flow is handed. */
'use strict';
const { openSeededProject } = require('./helpers');

const pickerRows = `document.querySelectorAll('.modal-backdrop-over .data-table tbody tr.data-pickable')`;

module.exports = async function (t) {
  const mx = await openSeededProject(t, t.APP);

  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => /^Microflows/i.test(n.textContent.trim()))[0].click()`);
  await mx.waitFor(`!!document.querySelector('.flow-card')`, 8000, 'flow list');
  await mx.evaluate(`(function(){ var r = Array.from(document.querySelectorAll('.flow-card')).find(n => /CancelOrder/.test(n.textContent)); r.click(); return true; })()`);
  await mx.waitFor(`document.querySelectorAll('.popup-tab').length === 2`, 8000, 'flow popup');

  // Acknowledge, connect the bridge.
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Enable running flows').click()`);
  await mx.waitFor(`!!document.querySelector('.ack-row input[type=checkbox]')`, 5000, 'ack modal');
  await mx.evaluate(`(function(){ var c = document.querySelector('.ack-row input[type=checkbox]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Enable').click()`);
  const snippet = await mx.waitFor(`document.querySelector('.scan-script') && document.querySelector('.scan-script').value`, 8000, 'snippet');
  const app = await t.tab(t.APP);
  await app.waitFor('!!window.mx', 10000, 'app tab');
  await app.evaluate('(function(){ ' + snippet + ' return true; })()');
  await app.waitFor(`/Connected to MxScout/.test(document.body.textContent)`, 12000, 'connected');

  // Pick object 1042 for the Order parameter.
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.param-row button')).find(b => /Choose/.test(b.textContent))`, 15000, 'param row ready');
  // No override editor until an object is chosen.
  t.ok(await mx.evaluate(`!document.querySelector('.override-editor')`),
    'the override editor only appears once an object is chosen');
  await mx.evaluate(`Array.from(document.querySelectorAll('.param-row button')).find(b => /Choose/.test(b.textContent)).click()`);
  await mx.waitFor(`!!document.querySelector('.modal-backdrop-over')`, 8000, 'picker open');
  await mx.evaluate(`(function(){ var i = document.querySelector('.modal-backdrop-over .data-search'); i.value = '1042'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await mx.waitFor(`document.querySelector('.modal-backdrop-over .data-table tbody tr td') && document.querySelector('.modal-backdrop-over .data-table tbody tr td').textContent === '1042'`, 15000, 'searched');
  await mx.evaluate(pickerRows + `[0].click()`);
  await mx.waitFor(`!document.querySelector('.modal-backdrop-over')`, 5000, 'picker closed');

  // The override editor is now offered on the chosen object's row.
  const det = await mx.waitFor(`(function(){ var d = document.querySelector('.override-editor'); return d && d.textContent; })()`, 6000, 'override editor');
  t.ok(/Override attribute values/.test(det), 'a chosen object offers an "Override attribute values" editor');
  t.ok(/Customer \(String\)/.test(det) && /Total \(Decimal\)/.test(det), 'with a field per settable attribute, typed');

  // Set Customer to a new value for this run.
  await mx.evaluate(`(function(){
    var det = document.querySelector('.override-editor'); det.open = true;
    var row = Array.from(det.querySelectorAll('.kv-row')).find(r => /^Customer/.test(r.querySelector('.kv-key').textContent));
    var inp = row.querySelector('input');
    inp.value = 'OVERRIDDEN'; inp.dispatchEvent(new Event('input', { bubbles: true }));
    return true; })()`);

  // The confirm names the override, not just the object.
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => /^Run /.test(b.textContent)).click()`);
  const confirmText = await mx.waitFor(`Array.from(document.querySelectorAll('.modal')).map(m => m.textContent).find(x => /Run this now\\?/.test(x))`, 6000, 'confirm');
  t.ok(/id 1042/.test(confirmText), 'the confirm names the chosen object');
  t.ok(/set Customer = OVERRIDDEN/.test(confirmText), 'and the attribute value it will set before running: ' + confirmText);

  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Run it').click()`);
  const ran = await app.waitFor(`window.__ranFlows.length && JSON.stringify(window.__ranFlows[window.__ranFlows.length - 1])`, 15000, 'flow ran');
  t.ok(/Sales\.CancelOrder/.test(ran) && /"guids":\["1042"\]/.test(ran), 'the app ran the flow with the chosen object: ' + ran);

  // The override actually reached the object the flow was handed.
  const sets = await app.evaluate(`JSON.stringify(window.__objectSets['1042'] || null)`);
  t.ok(sets && /"Customer":"OVERRIDDEN"/.test(sets),
    'the overridden value was set on the object before the run, so the flow sees it: ' + sets);

  await mx.close(); await app.close();
};
