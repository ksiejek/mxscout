/* A microflow whose inputs are plain values (String/Integer/Boolean), not
 * objects. MxScout used to only DESCRIBE these — "MxScout can supply object
 * inputs but not plain values, they will take whatever default the microflow
 * has" — so a flow like Sales.SendNotice(Subject, Copies, Urgent) could be
 * opened and read but never actually run with the values a tester wanted.
 * They are typed in the Run tab now, confirmed by name and value in the same
 * gate a flow run always passes through, and carried to mx.data.action. */
'use strict';
const { openSeededProject } = require('./helpers');

module.exports = async function (t) {
  const mx = await openSeededProject(t, t.APP);

  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => /^Microflows/i.test(n.textContent.trim()))[0].click()`);
  await mx.waitFor(`!!document.querySelector('.flow-card')`, 8000, 'flow list');

  // ---- the run panel no longer claims values cannot be supplied ----
  await mx.evaluate(`(function(){ var r = Array.from(document.querySelectorAll('.flow-card')).find(n => /SendNotice/.test(n.textContent)); r.click(); return true; })()`);
  await mx.waitFor(`document.querySelectorAll('.popup-tab').length === 2`, 8000, 'popup');
  const inputs = await mx.evaluate(`document.querySelector('.modal').textContent`);
  t.ok(!/can supply object inputs but not plain values/.test(inputs),
    'the run panel no longer says plain values cannot be supplied');

  // ---- connect the bridge, then type the values ----
  await mx.evaluate(`(function(){ var b = Array.from(document.querySelectorAll('.modal button')).find(b => /Enable running flows/.test(b.textContent)); if (b) b.click(); return true; })()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Enable')`, 5000, 'ack gate');
  await mx.evaluate(`(function(){ document.querySelector('.modal input[type=checkbox]').click(); Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Enable').click(); return true; })()`);

  const snippet = await mx.waitFor(`document.querySelector('.scan-script') && document.querySelector('.scan-script').value`, 8000, 'snippet');
  const app = await t.tab(t.APP);
  await app.waitFor('!!window.mx', 10000, 'app tab');
  await app.evaluate('(function(){ ' + snippet + ' return true; })()');
  await app.waitFor(`/Connected to MxScout/.test(document.body.textContent)`, 12000, 'connected');

  // The run button only appears once MxScout's own poll has seen the bridge
  // connect, a beat after the app tab itself says it did.
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.modal button')).find(b => /^Run /.test(b.textContent))`, 15000, 'run button ready');
  const boxes = await mx.waitFor(`document.querySelectorAll('.param-row').length === 3 && Array.from(document.querySelectorAll('.param-row')).map(r => r.querySelector('.param-name').textContent + ' \u00b7 ' + r.querySelector('.param-type').textContent).join('|')`, 12000, 'value rows');
  t.ok(/Subject · String/.test(boxes) && /Copies · Integer/.test(boxes) && /Urgent · Boolean/.test(boxes),
    'one row per value parameter, each naming its type: ' + boxes);
  t.ok(await mx.evaluate(`document.querySelectorAll('.param-control input[type=number]').length === 1`),
    'an Integer parameter gets a number box, not a plain text box');
  t.ok(await mx.evaluate(`document.querySelectorAll('.param-control select').length === 1`),
    'and a Boolean parameter gets true/false rather than free text');

  await mx.evaluate(`(function(){
    function fire(node, value) { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); }
    var rows = Array.from(document.querySelectorAll('.param-row'));
    fire(rows[0].querySelector('input'), 'Order delayed');
    fire(rows[1].querySelector('input'), '3');
    fire(rows[2].querySelector('select'), 'true');
    return true; })()`);

  // ---- the confirm gate names every value before anything runs ----
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => /^Run /.test(b.textContent)).click()`);
  const confirmText = await mx.waitFor(`Array.from(document.querySelectorAll('.modal')).map(m => m.textContent).find(x => /Run this now\\?/.test(x))`, 6000, 'confirm');
  t.ok(/Subject:\s*Order delayed/.test(confirmText) && /Copies:\s*3/.test(confirmText) && /Urgent:\s*true/.test(confirmText),
    'the confirmation names every value that will be sent, not just the flow: ' + confirmText);

  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Run it').click()`);
  const ran = await app.waitFor(`window.__ranFlows.length && JSON.stringify(window.__ranFlows[window.__ranFlows.length - 1])`, 15000, 'flow ran');
  t.ok(/Sales\.SendNotice/.test(ran), 'the app really ran it: ' + ran);
  const params = JSON.parse(ran);
  t.ok(params.arguments && params.arguments.Subject === 'Order delayed',
    'the String value arrived as a string: ' + ran);
  t.ok(params.arguments && params.arguments.Copies === 3,
    'the Integer value arrived as a number, not the text "3": ' + ran);
  t.ok(params.arguments && params.arguments.Urgent === true,
    'and the Boolean arrived as a real boolean: ' + ran);

  await mx.close(); await app.close();
};
