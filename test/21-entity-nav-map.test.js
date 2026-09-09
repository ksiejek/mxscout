/* Two things the map and the entity popup gained (Karol, from real use of the
 * older tool): you can walk the domain model by clicking a relationship's other
 * end in an entity's popup, and the map is a canvas you drag to pan. This seeds
 * its own tiny two-entity model with an association so both are exercisable. */
'use strict';

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
  await mx.waitFor(`!!Array.from(document.querySelectorAll('button,a')).find(n => n.textContent.trim() === 'NavProj')`, 10000, 'project');
  await mx.evaluate(`(function(){ var e = Array.from(document.querySelectorAll('button,a')).filter(n => n.textContent.trim() === 'NavProj'); e[e.length-1].click(); return true; })()`);
  await new Promise((r) => setTimeout(r, 500));
  await mx.evaluate(`Array.from(document.querySelectorAll('.sidebar button, .sidebar a')).filter(n => /^Entities/.test(n.textContent.trim()))[0].click()`);
  // View as everything, so both entities show and the popup's relationship
  // links resolve.
  await mx.evaluate(`(function(){ var s = document.querySelector('select'); s.value='all'; s.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.map-entity, [class*=card]')).find(n => /Customer/.test(n.textContent))`, 8000, 'entity list');

  // ---- relationship navigation from the popup ----
  await mx.evaluate(`(function(){
    var c = Array.from(document.querySelectorAll('[class*=card]')).filter(n => /Customer/.test(n.textContent) && /attributes/i.test(n.textContent));
    (c[0] || Array.from(document.querySelectorAll('.map-entity')).filter(n=>/Customer/.test(n.textContent))[0]).click();
    return true; })()`);
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

  // ---- the map is a drag-to-pan canvas ----
  await mx.evaluate(`document.querySelector('.modal-detail .popup-head button').click()`);
  await new Promise((r) => setTimeout(r, 150));
  await mx.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Map').click()`);
  await mx.waitFor(`!!document.querySelector('.map-viewport')`, 6000, 'map viewport');
  t.ok(await mx.evaluate(`getComputedStyle(document.querySelector('.map-viewport')).cursor === 'grab'`),
    'the map viewport shows a grab cursor, inviting a drag');
  // A press on empty canvas grabs (adds is-panning); release lets go.
  const panning = await mx.evaluate(`(function(){
    var vp = document.querySelector('.map-viewport');
    var r = vp.getBoundingClientRect();
    vp.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, button:0, pointerId:1, clientX:r.right-15, clientY:r.top+15 }));
    var on = vp.classList.contains('is-panning');
    vp.dispatchEvent(new PointerEvent('pointerup', { bubbles:true, button:0, pointerId:1, clientX:r.right-15, clientY:r.top+15 }));
    return on && !vp.classList.contains('is-panning');
  })()`);
  t.ok(panning, 'dragging the empty canvas pans it (grabs on press, releases on lift)');

  // ---- scroll zooms the map ----
  await mx.evaluate(`(function(){
    var vp = document.querySelector('.map-viewport');
    var r = vp.getBoundingClientRect();
    vp.dispatchEvent(new WheelEvent('wheel', { bubbles:true, cancelable:true, deltaY:-240, clientX:r.left+80, clientY:r.top+80 }));
    return true; })()`);
  t.ok(await mx.waitFor(`(function(){ var g = document.querySelector('.map-grid'); return g && /scale\\(/.test(g.style.transform) && parseFloat(g.style.transform.replace(/[^0-9.]/g,'')) > 1; })()`, 4000, 'zoomed in'),
    'scrolling up zooms the map in (the grid is scaled past 1)');

  // ---- access is a coloured dot per ATTRIBUTE, in a role view ----
  await mx.evaluate(`(function(){ var s = document.querySelector('select'); s.value='User'; s.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  await mx.waitFor(`!!document.querySelector('.map-attr-dot')`, 5000, 'attribute dots');
  t.ok(await mx.evaluate(`(function(){ var c = Array.from(document.querySelectorAll('.map-entity')).find(x => /Customer/.test(x.textContent)); return c && !!c.querySelector('.map-attr-dot-rw') && !!c.querySelector('.map-attr-dot-r'); })()`),
    'Customer’s attributes carry dots: Name is read+write (green), Age is read (yellow)');
  t.ok(await mx.evaluate(`!Array.from(document.querySelectorAll('.map-entity')).some(x => /^Order/.test(x.textContent.trim()))`),
    'Order, which the User role has no rule on, is hidden from the map (like the list)');
  // Back to everything: no per-role dots there, and both entities show plainly.
  await mx.evaluate(`(function(){ var s = document.querySelector('select'); s.value='all'; s.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.map-entity')).find(n => /Order/.test(n.textContent))`, 5000, 'map back');
  t.ok(await mx.evaluate(`!document.querySelector('.map-attr-dot')`),
    'the everything-view has no per-attribute dots — there is no single role to colour by');

  // But a press that lands on a card opens it, not a pan.
  await mx.evaluate(`Array.from(document.querySelectorAll('.map-entity')).find(n => /Order/.test(n.textContent)).click()`);
  t.ok(await mx.waitFor(`(function(){ var h = document.querySelector('.modal-detail .popup-head h3'); return h && h.textContent === 'Order'; })()`, 6000, 'card opens'),
    'clicking a card in the map still opens the entity, not a pan');

  await mx.close();
};
