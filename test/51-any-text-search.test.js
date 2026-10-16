/* The "any text field" search, when one of the text fields cannot be
 * searched.
 *
 * Searching every text field at once is one XPath with an "or" per field. A
 * runtime refuses the whole retrieve when that XPath names a field the
 * session may not read, and no XPath can name a calculated attribute at all.
 * Either one made the search box useless unless a single field was picked
 * (Karol, 2026-10-09). The model's calculated attributes are now left out,
 * and when the search still fails the bridge tries each field on its own and
 * searches the ones that work. */
'use strict';
const { openSeededProject, openEntityPopup, clickTab } = require('./helpers');
const MODEL = require('./model');

module.exports = async function (t) {
  const model = JSON.parse(JSON.stringify(MODEL));
  const order = model.entities.find((e) => e.qualifiedName === 'Sales.Order');
  // One field this session may not read (the fake app refuses any XPath that
  // names it), and one the app computes.
  order.attributes.push({ name: 'Secret', type: 'String', length: 50 });
  order.attributes.push({ name: 'Label', type: 'String', length: 50, calculated: true });

  const mx = await openSeededProject(t, t.APP, model);
  await openEntityPopup(mx);
  await mx.evaluate(clickTab('Data'));
  const snippet = await mx.waitFor(`document.querySelector('.scan-script') && document.querySelector('.scan-script').value`, 8000, 'snippet');
  const app = await t.tab(t.APP);
  await app.waitFor('!!window.mx', 10000, 'app tab');
  await app.evaluate('(function(){ ' + snippet + ' return true; })()');
  await app.waitFor(`/Connected to MxScout/.test(document.body.textContent)`, 12000, 'connected');
  await mx.waitFor(`document.querySelectorAll('.data-table tbody tr').length === 10`, 20000, 'rows');

  // The search over every text field, with no field picked.
  t.ok(await mx.evaluate(`(function () { var s = document.querySelector('.data-search-field'); return !s || s.value === ''; })()`),
    'no single field is picked: this is the search over every text field');
  await mx.evaluate(`(function(){ var i = document.querySelector('.data-search'); i.value = 'Acme'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const found = await mx.waitFor(`(function () {
    var rows = Array.from(document.querySelectorAll('.data-table tbody tr'));
    return rows.length && rows.every(function (tr) { return /Acme/.test(tr.textContent); }) && rows.length;
  })()`, 20000, 'search');
  t.ok(found === 10, 'it finds the rows, though one text field may not be read here: ' + found);
  t.ok(await mx.evaluate(`!document.querySelector('.data-pane .warn-text, .data-error')`),
    'and shows no error: the field that cannot be searched was dropped, the others were searched');

  // A second search goes straight to the fields that work.
  await mx.evaluate(`(function(){ var i = document.querySelector('.data-search'); i.value = 'Globex'; i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  t.ok(await mx.waitFor(`(function () {
    var rows = Array.from(document.querySelectorAll('.data-table tbody tr'));
    return rows.length > 0 && rows.every(function (tr) { return /Globex/.test(tr.textContent); });
  })()`, 20000, 'second search'), 'and the next search works too');

  await app.close();
  await mx.close();
};
