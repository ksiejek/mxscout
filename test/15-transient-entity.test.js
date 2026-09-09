/* Sales.TempNote is non-persistable — the Data tab must not attempt an xpath
 * query against it (there is no store to query), and instead offers looking
 * up a known id or creating a new one. Both report through the same data
 * channel a normal query's rows do; creating one is gated exactly like
 * running a flow (the one-time acknowledgment, then a per-action confirm
 * naming the values). */
'use strict';
const { openSeededProject } = require('./helpers');

module.exports = async function (t) {
  const mx = await openSeededProject(t, t.APP);

  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => /^Entities/i.test(n.textContent.trim()))[0].click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('*')).find(n => n.textContent.trim() === 'TempNote')`, 8000, 'entity list');
  await mx.evaluate(`(function(){
    var n = Array.from(document.querySelectorAll('button,div,li,tr')).filter(e => e.textContent.indexOf('Sales.TempNote') !== -1 || e.textContent.trim() === 'TempNote');
    n[n.length-1].click(); return true; })()`);
  await mx.waitFor(`document.querySelectorAll('.popup-tab').length === 3`, 8000, 'popup');
  await mx.evaluate(`Array.from(document.querySelectorAll('.popup-tab')).filter(t => t.textContent === 'Data')[0].click()`);

  // Like the persistable Data tab, this still needs a connected bridge
  // first — the difference is what it offers once connected.
  const snippet = await mx.waitFor(`document.querySelector('.scan-script') && document.querySelector('.scan-script').value`, 8000, 'snippet');
  t.ok(snippet.indexOf('Sales.TempNote') !== -1, 'the snippet is generated for this entity');

  const app = await t.tab(t.APP);
  await app.waitFor('!!window.mx', 10000, 'app tab');
  // Record every request the app tab makes from here on — looking up or
  // creating a non-persistable object must never attempt the xpath/count
  // machinery a persistable entity's Data tab uses.
  await app.evaluate(`(function(){
    window.__reqs = [];
    var f = window.fetch;
    window.fetch = function (input) { window.__reqs.push(String(typeof input === 'string' ? input : input.url)); return f.apply(this, arguments); };
    return true; })()`);
  await app.evaluate('(function(){ ' + snippet + ' return true; })()');
  await app.waitFor(`/Connected to MxScout/.test(document.body.textContent)`, 12000, 'connected');

  t.ok(await mx.waitFor(`!!document.querySelector('.modal input[placeholder="Object id"]')`, 8000, 'lookup field'),
    'a "look up by id" field is offered once connected');
  t.ok(/non-persistable/.test(await mx.evaluate(`document.querySelector('.modal').textContent`)),
    'and the tab explains why there is no browsable table, instead of trying and failing');
  t.ok(!!(await mx.evaluate(`!!Array.from(document.querySelectorAll('.modal button')).find(b => /^\\+ Create a new TempNote/.test(b.textContent))`)),
    'creating a new one is offered, in its own window');

  // ---- create one: opens its own window, gated like a flow run ----
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => /^\\+ Create a new TempNote/.test(b.textContent)).click()`);
  t.ok(await mx.waitFor(`!!Array.from(document.querySelectorAll('.modal-backdrop-over button')).find(b => b.textContent === 'Enable creating objects')`, 6000, 'create window'),
    'the create window opens, behind the same acknowledgment gate a flow run uses');
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal-backdrop-over button')).find(b => b.textContent === 'Enable creating objects').click()`);
  await mx.waitFor(`!!document.querySelector('.ack-row input[type=checkbox]')`, 5000, 'ack modal');
  await mx.evaluate(`(function(){ var c = document.querySelector('.ack-row input[type=checkbox]'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Enable').click()`);

  const createBody = await mx.waitFor(`(function(){ var m = document.querySelector('.modal-backdrop-over .modal'); return m && /Create a new TempNote/.test(m.textContent) && m.textContent; })()`, 8000, 'create form');
  t.ok(/not settable here yet/.test(createBody), 'the Enum attribute is listed as not settable, not silently dropped: ' + createBody);

  // This window is a short form, not the entity popup. It used to borrow
  // `modal-detail` and so opened at 1200px, which gave a one-attribute form an
  // input the width of the screen — the reason for the width assertion rather
  // than only a class one.
  const createWidth = await mx.evaluate(`Math.round(document.querySelector('.modal-backdrop-over .modal').getBoundingClientRect().width)`);
  t.ok(createWidth <= 600, 'the create window stays a form width, not the entity popup\u2019s: ' + createWidth + 'px');
  t.ok(await mx.evaluate(`(function(){ var r = document.querySelector('.modal-backdrop-over .kv-row'); return getComputedStyle(r).display === 'grid'; })()`),
    'and its label sits in its own column beside the field, not across the row');

  await mx.evaluate(`(function(){
    var rows = Array.from(document.querySelectorAll('.kv-row'));
    var textRow = rows.find(function (r) { return r.textContent.indexOf('Text') === 0; });
    textRow.querySelector('input[type=text]').value = 'Follow up tomorrow';
    textRow.querySelector('input[type=text]').dispatchEvent(new Event('input', { bubbles: true }));
    var urgentRow = rows.find(function (r) { return r.textContent.indexOf('Urgent') === 0; });
    var box = urgentRow.querySelector('input[type=checkbox]');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    return true; })()`);

  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Create').click()`);
  const confirmText = await mx.waitFor(`Array.from(document.querySelectorAll('.modal')).map(m => m.textContent).find(x => /Create this object now/.test(x))`, 6000, 'create confirm');
  t.ok(/Sales\.TempNote/.test(confirmText) && /Follow up tomorrow/.test(confirmText) && /true/.test(confirmText),
    'the confirmation names the entity and the exact values about to be set: ' + confirmText);

  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Create it').click()`);
  const seenText = await mx.waitFor(`(function(){ var m = document.querySelector('.modal'); return m && /Seen this session/.test(m.textContent) && m.textContent; })()`, 8000, 'created row');
  t.ok(/Follow up tomorrow/.test(seenText), 'the created object appears with the values that were set: ' + seenText);

  const createdId = (await mx.evaluate(`document.querySelector('.data-table tbody tr td').textContent`));
  t.ok(/^\d+$/.test(createdId), 'it got a real object id: ' + createdId);

  const reqs = await app.evaluate(`JSON.stringify(window.__reqs)`);
  t.ok(!/fake\/rows|xas/.test(reqs), 'neither lookup nor create ever attempted an xpath/count query: ' + reqs);

  // ---- look it back up by that id, from a fresh popup ----
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Close').click()`);
  await mx.waitFor(`!document.querySelector('.popup-tab')`, 5000, 'closed');
  await mx.evaluate(`(function(){
    var n = Array.from(document.querySelectorAll('button,div,li,tr')).filter(e => e.textContent.indexOf('Sales.TempNote') !== -1 || e.textContent.trim() === 'TempNote');
    n[n.length-1].click(); return true; })()`);
  await mx.waitFor(`document.querySelectorAll('.popup-tab').length === 3`, 8000, 'popup 2');
  await mx.evaluate(`Array.from(document.querySelectorAll('.popup-tab')).filter(t => t.textContent === 'Data')[0].click()`);
  await mx.waitFor(`!!document.querySelector('.modal input[placeholder="Object id"]')`, 8000, 'lookup field 2');

  // "Seen this session" already shows the created row, so the thing worth
  // waiting for here is the lookup itself finishing — the button going idle
  // again — not that heading, which is already on screen.
  function lookupIdle() {
    return `!!Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Look up' && !b.disabled)`;
  }
  await mx.evaluate(`(function(){ var i = document.querySelector('.modal input[placeholder="Object id"]'); i.value = '${createdId}'; i.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Look up').click()`);
  await mx.waitFor(lookupIdle(), 8000, 'lookup finished');
  const lookedUp = await mx.evaluate(`document.querySelector('.modal').textContent`);
  t.ok(/Follow up tomorrow/.test(lookedUp), 'looking it up by the id it was given returns the same values: ' + lookedUp);

  // An id that was never created (or has since gone) fails loudly, not silently.
  await mx.evaluate(`(function(){ var i = document.querySelector('.modal input[placeholder="Object id"]'); i.value = '999999'; i.dispatchEvent(new Event('input', {bubbles:true})); return true; })()`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Look up').click()`);
  t.ok(await mx.waitFor(`/Could not find that object/.test(document.querySelector('.modal').textContent)`, 8000, 'not found'),
    'an id that does not exist says so, rather than showing nothing');

  // ---- create is gated on the selected role's Create access ----
  // Switch, in the popup, to a role with no Create rule on TempNote. Creating
  // runs under the tester's own rights and the app would refuse it, so the
  // create window says so and doesn't offer Create.
  await mx.evaluate(`(function(){ var s = document.querySelector('.popup-role-select'); s.value='Viewer'; s.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => /^\\+ Create a new TempNote/.test(b.textContent)).click()`);
  const blocked = await mx.waitFor(`(function(){ var m = document.querySelector('.modal-backdrop-over .modal'); return m && /has no Create rule/.test(m.textContent) && m.textContent; })()`, 6000, 'create blocked');
  t.ok(/Viewer has no Create rule/.test(blocked), 'a role without Create is told it cannot create, with the reason: ' + blocked.slice(0, 120));
  t.ok(!(await mx.evaluate(`!!Array.from(document.querySelectorAll('.modal-backdrop-over button')).find(b => b.textContent === 'Create' || b.textContent === 'Enable creating objects')`)),
    'and no Create (or enable) button is offered — only Close');

  await mx.close(); await app.close();
};
