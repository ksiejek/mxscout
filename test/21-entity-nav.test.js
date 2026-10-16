/* Walking the domain model (Karol, from real use of the older tool): a
 * relationship's other end in an entity's window is a link to that entity, and
 * the Entities screen — the Domain model (public/domain.js) — draws the
 * association between the two. The old map, with its pan, zoom and per-role
 * attribute dots, is gone (Karol, 2026-10-13: the documentation's Domain model
 * instead); the entity's panel there says who may access what. This seeds its
 * own tiny two-entity model with an association. */
'use strict';
const { openEntity } = require('./helpers');

const MODEL = {
  meta: { source: 'test' },
  modules: [{ name: 'Sales' }],
  entities: [
    { module: 'Sales', name: 'Order', qualifiedName: 'Sales.Order', persistable: true,
      attributes: [{ name: 'Number', type: 'String', length: 50 }], accessRules: [] },
    { module: 'Sales', name: 'Customer', qualifiedName: 'Sales.Customer', persistable: true,
      attributes: [{ name: 'Name', type: 'String', length: 200 }, { name: 'Age', type: 'Integer' }],
      accessRules: [{ moduleRole: 'Sales.User', attrAccess: { Name: 'rw', Age: 'r' }, xpathConstraint: "[Sales.Order_Customer/Sales.Order/Number = '1']", allowCreate: true, allowDelete: false }] }
  ],
  associations: [{ name: 'Order_Customer', module: 'Sales', owner: 'Sales.Order', other: 'Sales.Customer', type: 'Reference' }],
  userRoles: [{ name: 'User', moduleRoles: ['Sales.User'] }],
  microflows: [], nanoflows: [], pages: [], javaActions: [], constants: [], enumerations: []
};

module.exports = async function (t) {
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'MxScout loaded');
  await mx.evaluate(`(async () => {
    await MxStore.saveProjectWithModel(
      { id: 'n1', name: 'NavProj', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        source: { kind: 'test' }, bytes: 1, summary: null, appUrl: null },
      ${JSON.stringify(MODEL)});
    return true; })()`);
  await mx.navigate(t.MX);
  await mx.waitFor(`!!Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button,a')).find(n => n.textContent.trim() === 'NavProj')`, 10000, 'project');
  await mx.evaluate(`(function(){ var e = Array.from((function(q){var s=document.querySelector('.switcher[aria-expanded="false"]'); if (s) s.click(); return document.querySelectorAll(q);})('button,a')).filter(n => n.textContent.trim() === 'NavProj'); e[e.length-1].click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 500));
  // ---- the Domain model draws both, and the association between them ----
  await openEntity(mx, 'Customer');
  await mx.waitFor(`!!document.querySelector('.modal-detail')`, 6000, 'customer popup');
  const link = await mx.waitFor(`(function(){ var b = Array.from(document.querySelectorAll('.assoc-link')).find(x => x.textContent === 'Sales.Order'); return b && b.textContent; })()`, 6000, 'relationship link');
  t.ok(link === 'Sales.Order', 'the other end of a relationship is a link in the entity popup');

  // ---- a constraint that walks associations renders as entity chips ----
  // Customer's rule is [Sales.Order_Customer/Sales.Order/Number = '1'] — the
  // row-level rule shows the entity it walks to (Sales.Order) as a chip, not
  // raw XPath, and keeps the exact expression on the cell.
  t.ok(await mx.evaluate(`(function(){ var c = document.querySelector('.con-line'); return c && !!Array.from(c.querySelectorAll('.con-chip')).find(x => x.textContent === 'Sales.Order'); })()`),
    'the association-walking constraint renders Sales.Order as an entity chip');
  t.ok(await mx.evaluate(`(function(){ var c = document.querySelector('.con-line'); return c && /Order_Customer/.test(c.getAttribute('title')||''); })()`),
    'and keeps the exact XPath on the cell');
  await mx.evaluate(`Array.from(document.querySelectorAll('.assoc-link')).find(x => x.textContent === 'Sales.Order').click()`);
  const head = await mx.waitFor(`(function(){ var h = document.querySelector('.modal-detail .popup-head h3'); return h && h.textContent; })()`, 6000, 'navigated');
  t.ok(head === 'Order', 'clicking it opens that entity’s popup, so you can walk the model: now on ' + head);

  // ---- back on the screen: both drawn, joined by one line ----
  await mx.evaluate(`document.querySelector('.modal-detail .popup-head button').click()`);
  await mx.evaluate(`(function(){ var b = Array.from(document.querySelectorAll('.modal button')).find(x => x.textContent === 'Close'); if (b) b.click(); return true; })()`);
  await mx.waitFor(`!document.querySelector('.modal-detail')`, 4000, 'closed');
  // View as starts on everything (Karol, 2026-10-15); choosing User narrows it to Customer (Order has no rule for it).
  t.ok(await mx.evaluate(`document.querySelector('.dm-screen .role-select').value`) === 'all', 'View as starts on everything, not on the first role');
  await mx.evaluate(`(function(){ var s = document.querySelector('.dm-screen .role-select'); s.value = 'User'; s.dispatchEvent(new Event('change')); return true; })()`);
  await mx.waitFor(`document.querySelectorAll('.dx-dm-box').length === 1`, 5000, 'as User');
  t.ok(await mx.evaluate(`Array.from(document.querySelectorAll('.dx-dm-box b')).map(b => b.textContent).join(',')`) === 'Customer', 'View as User draws only Customer: Order has no access rule for that role');
  await mx.evaluate(`(function(){ var s = document.querySelector('.dm-screen .role-select'); s.value = 'all'; s.dispatchEvent(new Event('change')); return true; })()`);
  await mx.waitFor(`document.querySelectorAll('.dx-dm-box').length === 2`, 5000, 'everything');
  const drawn = JSON.parse(await mx.evaluate(`JSON.stringify({ boxes: Array.from(document.querySelectorAll('.dx-dm-box b')).map(b => b.textContent).sort().join(','), lines: document.querySelectorAll('.dx-dm-edge').length })`));
  t.ok(drawn.boxes === 'Customer,Order' && drawn.lines === 1, 'the Domain model draws both entities and the association between them: ' + JSON.stringify(drawn));
  const rule = await mx.evaluate(`(function(){ var b = Array.from(document.querySelectorAll('.dx-dm-box')).find(x => x.querySelector('b').textContent === 'Customer'); b.click(); return true; })()`);
  const insp = await mx.waitFor(`document.querySelector('.dx-dm-box.on') && document.querySelector('.dx-dm-insp').textContent`, 4000, 'access');
  t.ok(/Who can access it · 1/.test(insp) && /User/.test(insp), 'and Customer’s panel says who may access it: ' + insp.slice(0, 300));

  await mx.close();
};
