/* Passive observation of the app's own microflow calls.
 *
 * A non-persistable object has no store to list from — confirmed, there is
 * no enumerable client cache — so the only way MxScout can point at a live
 * temporary object is to notice its guid the moment the app's OWN logic runs
 * a microflow against it. The bridge wraps mx.data.action read-only and
 * buffers the guids it sees; MxScout asks for that buffer with the
 * `observed` command and offers each guid as a one-click lookup.
 *
 * This test drives the real thing: connect the bridge, have the app fire a
 * microflow of its own carrying a guid the tester never typed, then confirm
 * MxScout can surface that guid and look it up — without ever attempting an
 * xpath/query against the non-persistable entity. */
'use strict';
const { openSeededProject } = require('./helpers');

module.exports = async function (t) {
  const mx = await openSeededProject(t, t.APP);

  // Open the non-persistable entity's Data tab.
  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => /^Entities/i.test(n.textContent.trim()))[0].click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('*')).find(n => n.textContent.trim() === 'TempNote')`, 8000, 'entity list');
  await mx.evaluate(`(function(){
    var n = Array.from(document.querySelectorAll('button,div,li,tr')).filter(e => e.textContent.indexOf('Sales.TempNote') !== -1 || e.textContent.trim() === 'TempNote');
    n[n.length-1].click(); return true; })()`);
  await mx.waitFor(`document.querySelectorAll('.popup-tab').length === 3`, 8000, 'popup');
  await mx.evaluate(`Array.from(document.querySelectorAll('.popup-tab')).filter(t => t.textContent === 'Data')[0].click()`);

  const snippet = await mx.waitFor(`document.querySelector('.scan-script') && document.querySelector('.scan-script').value`, 8000, 'snippet');
  const app = await t.tab(t.APP);
  await app.waitFor('!!window.mx', 10000, 'app tab');

  // Seed a transient object at a KNOWN guid so a later lookup of the
  // observed id actually resolves — closing the loop the tester would.
  await app.evaluate(`(function(){
    window.__transient['7777'] = { entity: 'Sales.TempNote', fields: { Text: 'From the app itself', Urgent: true } };
    return true; })()`);

  await app.evaluate('(function(){ ' + snippet + ' return true; })()');
  await app.waitFor(`/Connected to MxScout/.test(document.body.textContent)`, 12000, 'connected');

  // Before the app does anything, the buffer is empty and says so.
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.modal button')).find(b => /what the app has touched/.test(b.textContent))`, 8000, 'observe button');
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => /what the app has touched/.test(b.textContent)).click()`);
  t.ok(await mx.waitFor(`/Nothing yet/.test(document.querySelector('.modal').textContent)`, 8000, 'empty observed'),
    'with the app idle, the observed list is honestly empty rather than inventing rows');

  // Now the APP ITSELF runs a microflow carrying a guid the tester never
  // typed anywhere in MxScout.
  await app.evaluate(`window.__appFireMicroflow('Sales.TouchNote', ['7777'])`);
  await new Promise((r) => setTimeout(r, 100));

  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Refresh').click()`);
  const seen = await mx.waitFor(`(function(){ var i = document.querySelector('.observed-item'); return i && i.textContent; })()`, 8000, 'observed guid');
  t.ok(/7777/.test(seen), 'the guid the app put through a microflow shows up, though nobody typed it: ' + seen);
  t.ok(/Sales\.TouchNote/.test(seen), 'and it names the microflow that carried it');

  // Clicking it looks it up — the whole point: reach a temporary object by
  // an id you could not otherwise have found.
  await mx.evaluate(`document.querySelector('.observed-item').click()`);
  const found = await mx.waitFor(`(function(){ var tb = document.querySelector('.modal table tbody'); return tb && /7777/.test(tb.textContent) && tb.textContent; })()`, 8000, 'looked up');
  t.ok(/From the app itself/.test(found), 'clicking the observed id looks it up and shows its real values: ' + found);

  // The whole feature is read-only observation: it must never have run an
  // xpath/query against the non-persistable entity.
  const reqs = await app.evaluate(`(function(){ return JSON.stringify(window.__ranFlows.map(function(f){ return f.actionname || f.page || 'query'; })); })()`);
  t.ok(!/\/fake\/rows/.test(await app.evaluate(`JSON.stringify(performance.getEntriesByType('resource').map(function(e){return e.name}).filter(function(u){return /fake\\/rows/.test(u)}))`)),
    'no xpath/rows query was ever attempted against the non-persistable entity: ' + reqs);

  await mx.close(); await app.close();
};
