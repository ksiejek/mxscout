/* The flow popup. Running used to live on the Live app tab, which meant
 * choosing a flow in one place, reading about it in another, and copying an
 * object id between them by hand. It is on the flow now.
 *
 * Two tabs, not four: what the flow wants, who may set it off and the run
 * itself are one continuous question and sit side by side; Comments is its
 * own tab. Each object input is a ROW with a Choose… button that opens a
 * picker over the popup — one picker per parameter, which is what lets a
 * flow taking several objects be run at all rather than refused. */
'use strict';
const { openSeededProject } = require('./helpers');

const runTabText = `document.querySelector('.flow-col-run').textContent`;
const pickerRows = `document.querySelectorAll('.modal-backdrop-over .data-table tbody tr.data-pickable')`;

module.exports = async function (t) {
  const mx = await openSeededProject(t, t.APP);

  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => /^Microflows/i.test(n.textContent.trim()))[0].click()`);
  await mx.waitFor(`!!document.querySelector('.flow-card')`, 8000, 'flow list');
  // Agent (the default role) sees only what it can actually run: four of the
  // five, since RecalculateTotals carries no allowed roles at all — same
  // rule the entity list already applies (hidden unless a role's own access
  // rule matches), rather than the old "no roles at all means visible to
  // everyone" exception.
  t.ok(await mx.evaluate(`document.querySelectorAll('.flow-card').length === 4`),
    'a specific role sees only the microflows it can run');
  t.ok(await mx.evaluate(`!Array.from(document.querySelectorAll('.flow-card')).some(n => /RecalculateTotals/.test(n.textContent))`),
    'RecalculateTotals is not one of them — no role can trigger it directly');
  await mx.evaluate(`(function(){ var r = Array.from(document.querySelectorAll('.flow-card')).find(n => /CancelOrder/.test(n.textContent)); r.click(); return true; })()`);

  const tabs = await mx.waitFor(`document.querySelectorAll('.popup-tab').length === 2 && Array.from(document.querySelectorAll('.popup-tab')).map(t => t.textContent).join(',')`, 8000, 'flow tabs');
  t.ok(tabs === 'Run,Comments', 'a microflow opens on Run, with Comments its own tab: ' + tabs);
  t.ok(/Sales\.CancelOrder/.test(await mx.evaluate(`document.querySelector('.modal .popup-head').textContent`)),
    'the popup names the flow it is about');

  // Access sits beside the run panel, not one tab behind it.
  const sideText = await mx.evaluate(`document.querySelector('.flow-col-side').textContent`);
  t.ok(/Sales\.Agent/.test(sideText), 'and who may set it off is beside it, not behind another tab');
  t.ok(/Agent can trigger this microflow/.test(sideText), 'saying plainly whether the chosen role is one of them');

  // The run gate: not acknowledged yet, so there must be no way to run.
  t.ok(await mx.evaluate(`!!Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Enable running flows')`),
    'the Run pane starts behind the acknowledgment, with no run button');
  t.ok(await mx.evaluate(`!Array.from(document.querySelectorAll('.modal button')).find(b => /^Run /.test(b.textContent))`),
    'nothing can be run before that is acknowledged');

  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Enable running flows').click()`);
  await mx.waitFor(`!!document.querySelector('.ack-row input[type=checkbox]')`, 5000, 'ack modal');
  await mx.evaluate(`(function(){ var c = document.querySelector('.ack-row input[type=checkbox]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Enable').click()`);

  // Now it asks to connect the app — the same one snippet, generated for the flow.
  const snippet = await mx.waitFor(`document.querySelector('.scan-script') && document.querySelector('.scan-script').value`, 8000, 'snippet');
  t.ok(snippet.indexOf('CancelOrder') !== -1, 'the connect snippet is generated for THIS flow, so the CSP fallback can run it');

  const app = await t.tab(t.APP);
  await app.waitFor('!!window.mx', 10000, 'app tab');
  await app.evaluate('(function(){ ' + snippet + ' return true; })()');
  await app.waitFor(`/Connected to MxScout/.test(document.body.textContent)`, 12000, 'connected');

  // ---- the parameter row, and its own picker ----
  // The Choose button only appears once MxScout's own poll has seen the
  // bridge connect, a beat after the app tab says it did.
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.param-row button')).find(b => /Choose/.test(b.textContent))`, 15000, 'param rows ready');
  const runText = await mx.evaluate(runTabText);
  t.ok(/Order/.test(runText) && /Sales\.Order/.test(runText), 'the inputs row names the object parameter and its entity');
  t.ok(/not set/.test(runText), 'an object input starts as "not set" rather than silently empty');
  t.ok(await mx.evaluate(`!!Array.from(document.querySelectorAll('.modal button')).find(b => /^Run /.test(b.textContent) && b.disabled)`),
    'and the run button is disabled while it is');
  t.ok(/Still to choose: Order/.test(await mx.evaluate(runTabText)),
    'with the reason named, not just a dead button');

  await mx.evaluate(`Array.from(document.querySelectorAll('.param-row button')).find(b => /Choose/.test(b.textContent)).click()`);
  await mx.waitFor(`!!document.querySelector('.modal-backdrop-over')`, 8000, 'picker open');
  t.ok(/for Order/.test(await mx.evaluate(`document.querySelector('.modal-backdrop-over').textContent`)),
    'the picker says which parameter it is choosing for');
  t.ok(await mx.evaluate(`!!document.querySelector('.popup-tabs')`),
    'and the flow popup is still there underneath, not replaced');

  let rows = 0;
  try { rows = await mx.waitFor(pickerRows + `.length === 10 && 10`, 20000, 'picker rows'); }
  catch (e) { console.log('    DIAG picker:', JSON.stringify((await mx.evaluate(`document.querySelector('.modal-backdrop-over').innerText`)).slice(0, 500))); }
  t.ok(rows === 10, 'the picker is the same ten-row pane the entity Data tab uses');
  t.ok(await mx.evaluate(`document.querySelector('.modal-backdrop-over .data-summary').textContent`) === '1–10 of 253',
    'with the same real count');

  await mx.evaluate(`(function(){ var i = document.querySelector('.modal-backdrop-over .data-search'); i.value = '1042'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await mx.waitFor(`document.querySelector('.modal-backdrop-over .data-table tbody tr td') && document.querySelector('.modal-backdrop-over .data-table tbody tr td').textContent === '1042'`, 15000, 'searched');
  await mx.evaluate(pickerRows + `[0].click()`);

  t.ok(await mx.waitFor(`!document.querySelector('.modal-backdrop-over')`, 5000, 'picker closed'),
    'picking one closes the picker — the choice was the whole point of opening it');
  t.ok(/id 1042/.test(await mx.waitFor(runTabText, 5000, 'chosen shown')),
    'and the chosen id is shown on the parameter row it belongs to');
  t.ok(await mx.evaluate(`!Array.from(document.querySelectorAll('.modal button')).find(b => /^Run /.test(b.textContent) && b.disabled)`),
    'the run button is enabled once every object input has one');

  // Running still asks a second time, naming the flow and the object.
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => /^Run /.test(b.textContent)).click()`);
  const confirmText = await mx.waitFor(`Array.from(document.querySelectorAll('.modal')).map(m => m.textContent).find(x => /Run this now\\?/.test(x))`, 6000, 'confirm');
  t.ok(/Sales\.CancelOrder/.test(confirmText) && /1042/.test(confirmText),
    'the confirmation names the exact flow and the exact object');

  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Run it').click()`);
  const ran = await app.waitFor(`window.__ranFlows.length && JSON.stringify(window.__ranFlows[0])`, 15000, 'flow ran');
  t.ok(/Sales\.CancelOrder/.test(ran), 'the app really ran it: ' + ran);
  t.ok(/"guids":\["1042"\]/.test(ran), 'and with the object that was picked');

  // A flow no role may trigger must say so rather than look ready to go —
  // but under a specific role it is hidden from the list entirely (asserted
  // above), so seeing it at all here means switching to "Everything" first.
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Close').click()`);
  await mx.waitFor(`!document.querySelector('.popup-tab')`, 5000, 'popup closed');
  await mx.evaluate(`(function(){ var s = document.querySelector('.role-select'); s.value = 'all'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await mx.waitFor(`Array.from(document.querySelectorAll('.flow-card')).some(n => /RecalculateTotals/.test(n.textContent))`, 5000, 'shows under Everything');
  await mx.evaluate(`(function(){ var r = Array.from(document.querySelectorAll('.flow-card')).find(n => /RecalculateTotals/.test(n.textContent)); r.click(); return true; })()`);
  await mx.waitFor(`document.querySelectorAll('.popup-tab').length === 2`, 5000, 'second popup');
  const noParams = await mx.waitFor(`document.querySelector('.modal').textContent`, 5000, 'no-param flow');
  t.ok(/Takes no input/.test(noParams), 'a flow with no parameters says so');
  t.ok(/called from other logic/.test(noParams), 'a flow no role may trigger says it is called from other logic');
  t.ok(/will most likely refuse it/.test(noParams),
    'and warns that the app will probably refuse it, rather than failing mysteriously');

  // ---- a List-typed parameter: the same picker, checkboxes, stays open ----
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Close').click()`);
  await mx.waitFor(`!document.querySelector('.popup-tab')`, 5000, 'popup closed 2');
  await mx.evaluate(`(function(){ var r = Array.from(document.querySelectorAll('.flow-card')).find(n => /BulkCancel/.test(n.textContent)); r.click(); return true; })()`);
  await mx.waitFor(`document.querySelectorAll('.popup-tab').length === 2`, 5000, 'bulk popup');
  await mx.waitFor(`!!document.querySelector('.param-row')`, 10000, 'bulk param row');
  t.ok(/Sales\.Order \(list\)/.test(await mx.evaluate(runTabText)),
    'a List parameter says it is a list on its own row');

  await mx.evaluate(`Array.from(document.querySelectorAll('.param-row button')).find(b => /Choose/.test(b.textContent)).click()`);
  await mx.waitFor(`!!document.querySelector('.modal-backdrop-over')`, 8000, 'bulk picker open');
  // dataState is keyed by entity qualifiedName, so this picker inherits the
  // search the CancelOrder step left behind. Clear it before counting.
  await mx.evaluate(`(function(){ var i = document.querySelector('.modal-backdrop-over .data-search'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  t.ok(await mx.waitFor(`document.querySelectorAll('.modal-backdrop-over .data-table tbody tr td input[type=checkbox]').length === 10`, 10000, 'checkbox picker'),
    'a List-typed parameter gets a checkbox per row, not a single-click picker');

  await mx.evaluate(pickerRows + `[0].click()`);
  await mx.evaluate(pickerRows + `[1].click()`);
  await mx.evaluate(pickerRows + `[2].click()`);
  t.ok(await mx.waitFor(`document.querySelectorAll('.modal-backdrop-over .data-table tbody tr.is-picked').length === 3`, 5000, 'three picked'),
    'three rows can be picked at once');
  t.ok(await mx.evaluate(`!!document.querySelector('.modal-backdrop-over')`),
    'and the picker stays open while picking a list, instead of closing on the first click');
  t.ok(/3 chosen/.test(await mx.evaluate(`document.querySelector('.picker-count').textContent`)),
    'counting them as they are picked');

  await mx.evaluate(`Array.from(document.querySelectorAll('.modal-backdrop-over button')).find(b => b.textContent === 'Done').click()`);
  await mx.waitFor(`!document.querySelector('.modal-backdrop-over')`, 5000, 'bulk picker closed');
  t.ok(/3 objects/.test(await mx.evaluate(runTabText)),
    'the row shows the count, not a single id');

  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => /^Run /.test(b.textContent)).click()`);
  const bulkConfirm = await mx.waitFor(`Array.from(document.querySelectorAll('.modal')).map(m => m.textContent).find(x => /Run this now\\?/.test(x))`, 6000, 'bulk confirm');
  t.ok(/3 objects \(ids 1001, 1002, 1003\)/.test(bulkConfirm),
    'the confirmation names every id, not just one: ' + bulkConfirm);

  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Run it').click()`);
  const bulkRan = await app.waitFor(`window.__ranFlows.length > 1 && JSON.stringify(window.__ranFlows[window.__ranFlows.length - 1])`, 15000, 'bulk flow ran');
  t.ok(/Sales\.BulkCancel/.test(bulkRan), 'the app ran the list-parameter flow: ' + bulkRan);
  t.ok(/"applyto":"selection"/.test(bulkRan) && /"guids":\["1001","1002","1003"\]/.test(bulkRan),
    'with all three selected objects, not just the first: ' + bulkRan);

  await mx.close(); await app.close();
};
