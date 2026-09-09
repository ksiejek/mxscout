/* Running a microflow that takes more than one object parameter. A flat guids
 * selection cannot carry them — Mendix maps at most one guid per entity type
 * and drops the rest, so the earlier "all guids in one selection" ran such a
 * flow with empty parameters. The objects have to travel through the MxContext
 * instead, one setContext per object, bound to the flow's parameters by entity
 * type. This drives a two-object flow end to end and confirms both objects
 * reach the context, and that no flat two-guid selection is sent. */
'use strict';
const { openSeededProject } = require('./helpers');

const pickerRows = `document.querySelectorAll('.modal-backdrop-over .data-table tbody tr.data-pickable')`;

async function pickForParam(t, mx, paramName, id) {
  // Click the Choose button in the row for this named parameter.
  await mx.evaluate(`(function(){
    var row = Array.from(document.querySelectorAll('.param-row')).find(function(r){
      var n = r.querySelector('.param-name'); return n && n.textContent.indexOf(${JSON.stringify(paramName)}) !== -1;
    });
    row.querySelector('button').click(); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.modal-backdrop-over')`, 8000, 'picker open for ' + paramName);
  await mx.evaluate(`(function(){ var i = document.querySelector('.modal-backdrop-over .data-search'); i.value = ${JSON.stringify(id)}; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await mx.waitFor(`document.querySelector('.modal-backdrop-over .data-table tbody tr td') && document.querySelector('.modal-backdrop-over .data-table tbody tr td').textContent === ${JSON.stringify(id)}`, 15000, 'searched ' + id);
  await mx.evaluate(pickerRows + `[0].click()`);
  await mx.waitFor(`!document.querySelector('.modal-backdrop-over')`, 5000, 'picker closed for ' + paramName);
}

module.exports = async function (t) {
  const mx = await openSeededProject(t, t.APP);

  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => /^Microflows/i.test(n.textContent.trim()))[0].click()`);
  await mx.waitFor(`!!document.querySelector('.flow-card')`, 8000, 'flow list');
  await mx.evaluate(`(function(){ var r = Array.from(document.querySelectorAll('.flow-card')).find(n => /MoveSetting/.test(n.textContent)); r.click(); return true; })()`);
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

  // Two object parameters, of two different entities.
  await mx.waitFor(`document.querySelectorAll('.param-row').length === 2 && !!Array.from(document.querySelectorAll('.param-row button')).find(b => /Choose/.test(b.textContent))`, 15000, 'two param rows ready');
  await pickForParam(t, mx, 'Order', '1042');
  await pickForParam(t, mx, 'Config', '9001');

  // Run it.
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button, .flow-card button, button')).find(b => /^Run /.test(b.textContent)).click()`);
  await mx.waitFor(`Array.from(document.querySelectorAll('.modal')).map(m => m.textContent).find(x => /Run this now\\?/.test(x))`, 6000, 'confirm');
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Run it').click()`);

  const ran = await app.waitFor(`window.__ranFlows.length && JSON.stringify(window.__ranFlows[window.__ranFlows.length - 1])`, 15000, 'flow ran');
  t.ok(/Sales\.MoveSetting/.test(ran), 'the app ran the two-object flow: ' + ran);

  // The regression: more than one object must NOT be flattened into one guids
  // selection (Mendix would drop all but one) — no applyto:selection, no guids.
  const params = JSON.parse(ran);
  t.ok(params.applyto !== 'selection' && !params.guids,
    'it is not sent as a flat guids selection, which could only carry one of the two: ' + ran);

  // Both objects reached the flow through the context, by their own entities.
  const ctx = await app.evaluate(`JSON.stringify(window.__ranContexts[window.__ranContexts.length - 1] || null)`);
  t.ok(ctx && JSON.parse(ctx).length === 2, 'both objects were handed to the flow through the MxContext: ' + ctx);
  t.ok(/"guid":"1042"/.test(ctx) && /Sales\.Order/.test(ctx), 'the Order object (1042, Sales.Order) is in the context');
  t.ok(/"guid":"9001"/.test(ctx) && /Admin\.Setting/.test(ctx), 'the Config object (9001, Admin.Setting) is in the context');

  await mx.close();
};
