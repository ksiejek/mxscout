/* A flow under a blocking CSP. This is the case Karol described directly:
 * the code goes into the console, the same panel appears in the app tab, you
 * pick a row, and the microflow runs — with MxScout unreachable throughout. */
'use strict';
const { openSeededProject } = require('./helpers');

module.exports = async function (t) {
  const locked = t.APP + '/?csp=1';
  const mx = await openSeededProject(t, locked);

  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => /^Microflows/i.test(n.textContent.trim()))[0].click()`);
  await mx.waitFor(`!!document.querySelector('.flow-card')`, 8000, 'flow list');
  await mx.evaluate(`(function(){ Array.from(document.querySelectorAll('.flow-card')).find(n => /CancelOrder/.test(n.textContent)).click(); return true; })()`);
  await mx.waitFor(`document.querySelectorAll('.popup-tab').length === 2`, 8000, 'popup');
  await mx.evaluate(`Array.from(document.querySelectorAll('.popup-tab')).filter(t => t.textContent === 'Run')[0].click()`);

  await mx.waitFor(`!!Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Enable running flows')`, 5000, 'gate');
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Enable running flows').click()`);
  await mx.waitFor(`!!document.querySelector('.ack-row input[type=checkbox]')`, 5000, 'ack');
  await mx.evaluate(`(function(){ var c = document.querySelector('.ack-row input[type=checkbox]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Enable').click()`);

  const snippet = await mx.waitFor(`document.querySelector('.scan-script') && document.querySelector('.scan-script').value`, 8000, 'snippet');
  t.ok(snippet.indexOf('CancelOrder') !== -1 && snippet.indexOf('Sales.Order') !== -1,
    'the snippet carries both the flow and the entity its object comes from');

  const app = await t.tab(locked);
  await app.waitFor('!!window.mx', 10000, 'app tab');
  await app.evaluate('(function(){ ' + snippet + ' return true; })()');
  t.ok(await app.waitFor(`/blocks the connection to MxScout/.test(document.body.textContent)`, 12000, 'diagnosis'),
    'the panel says the app is blocking MxScout');

  await app.evaluate(`Array.from(document.querySelectorAll('button')).find(b => /^Open CancelOrder here$/.test(b.textContent)).click()`);
  t.ok(await app.waitFor(`/Pick a Order for Order/.test(document.body.textContent)`, 8000, 'picker'),
    'it offers the object picker for the flow, in the app tab');
  const rows = await app.waitFor(`document.body.textContent.match(/1001/) && true`, 15000, 'rows');
  t.ok(!!rows, 'rows load there through the app’s own client API');

  // Pick one, then run it.
  await app.evaluate(`(function(){ var n = Array.from(document.querySelectorAll('div')).filter(d => /^1003/.test(d.textContent) && d.children.length === 2); n[n.length-1].click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 200));
  t.ok(await app.evaluate(`!Array.from(document.querySelectorAll('button')).find(b => /^Run CancelOrder$/.test(b.textContent)).disabled`),
    'picking a row enables the run button');

  // The panel confirms before it runs; accept it.
  await app.evaluate(`window.confirm = function(){ return true; };`);
  await app.evaluate(`Array.from(document.querySelectorAll('button')).find(b => /^Run CancelOrder$/.test(b.textContent)).click()`);
  const ran = await app.waitFor(`window.__ranFlows.length && JSON.stringify(window.__ranFlows[0])`, 15000, 'ran');
  t.ok(/Sales\.CancelOrder/.test(ran) && /1003/.test(ran),
    'the microflow really ran, with the picked object, MxScout never involved: ' + ran);
  t.ok(await app.evaluate(`/✓ Done/.test(document.body.textContent)`), 'and the panel reports the result');

  t.ok(await mx.evaluate(`!!document.querySelector('.scan-script')`),
    'MxScout still shows the connect step throughout — it was never reachable');

  await mx.close(); await app.close();
};
