/* The case that decides whether any of this is usable inside a company: the
 * app's Content-Security-Policy forbids talking to MxScout. Served with a real
 * CSP header, so the browser does the blocking — not a mock. */
'use strict';
const { openSeededProject, openEntityPopup, clickTab } = require('./helpers');

module.exports = async function (t) {
  const locked = t.APP + '/?csp=1';
  const mx = await openSeededProject(t, locked);
  await openEntityPopup(mx);
  await mx.evaluate(clickTab('Data'));
  const snippet = await mx.waitFor(`document.querySelector('.scan-script') && document.querySelector('.scan-script').value`, 8000, 'snippet');

  const app = await t.tab(locked);
  await app.waitFor('!!window.mx', 10000, 'app tab');
  await app.evaluate('(function(){ ' + snippet + ' return true; })()');

  t.ok(await app.waitFor(`/blocks the connection to MxScout/.test(document.body.textContent)`, 12000, 'diagnosis'),
    'the panel diagnoses the CSP block in words rather than failing silently');
  t.ok(await app.evaluate(`!!Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Open Order here')`),
    'it offers to open the selected entity right there');

  await app.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Open Order here').click()`);
  t.ok(await app.waitFor(`Array.from(document.querySelectorAll('button')).filter(b => ['Attributes','Constraints','Data'].indexOf(b.textContent) !== -1).length === 3`, 8000, 'tabs'),
    'the standalone panel shows the same three tabs');
  const text = await app.evaluate(`document.body.textContent`);
  t.ok(/Number/.test(text) && /String \(20\)/.test(text), 'Attributes render from the metadata baked into the snippet');

  await app.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Constraints').click()`);
  t.ok(/CurrentUser/.test(await app.evaluate(`document.body.textContent`)), 'Constraints render, XPath included');

  await app.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Data').click()`);
  t.ok(await app.waitFor(`document.querySelectorAll('table tbody tr').length === 10`, 15000, 'rows'),
    'ten rows load with MxScout unreachable');
  t.ok(await app.evaluate(`Array.from(document.querySelectorAll('span')).some(s => /1–10 of 253/.test(s.textContent))`),
    'the count still works, because /xas/ is same-origin');

  await app.evaluate(`(function(){ var i = document.querySelector('input[type=search]'); i.value = 'Acme'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  t.ok(await app.waitFor(`Array.from(document.querySelectorAll('span')).some(s => /of 84/.test(s.textContent))`, 12000, 'search'),
    'live search works in the standalone panel');

  t.ok(await app.evaluate(`document.querySelectorAll('a[href]').length`) === 0,
    'the standalone panel has no links — it is a dead end, not a second MxScout');
  t.ok(await mx.evaluate(`!!document.querySelector('.scan-script')`),
    'MxScout never showed a false "connected" while the app tab was cut off');

  await mx.close(); await app.close();
};
