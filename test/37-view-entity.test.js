/* A view entity: an entity whose rows are what an OQL query returns, served
 * read-only by the running app. Karol asked 2026-09-18 whether MxScout shows
 * one as such; it did not — it read as an ordinary entity with a table of its
 * own behind it. So: it is marked wherever an entity is listed, its popup
 * carries its query, and the Data tab browses it the same way a stored entity
 * is browsed while saying what those rows are.
 *
 * Its own model rather than the shared one, so that adding an entity does not
 * move every count another test reads. */
'use strict';
const { openSeededProject } = require('./helpers');
const MODEL = require('./model');

const OQL = 'SELECT o.Number AS Number FROM Sales.Order AS o WHERE o.Total > 0';

module.exports = async function (t) {
  const model = JSON.parse(JSON.stringify(MODEL));
  model.entities.push({
    qualifiedName: 'Sales.OpenOrders', name: 'OpenOrders', module: 'Sales', persistable: true,
    attributes: [{ name: 'Number', type: 'String', length: 20 }],
    accessRules: [{
      moduleRole: 'Sales.Agent', attrAccess: { Number: 'r' }, assocAccess: {},
      allowCreate: false, allowDelete: false, xpathConstraint: null
    }],
    viewEntity: { sourceDocument: 'Sales.OpenOrders', oql: OQL }
  });
  // One whose query this model does not carry — the UI says so rather than
  // showing an empty box as if the query were empty.
  model.entities.push({
    qualifiedName: 'Sales.LostView', name: 'LostView', module: 'Sales', persistable: true,
    attributes: [],
    // A rule for the role the connected session switches the view to, or the
    // role filter would hide the entity before this could be asked of it.
    accessRules: [{ moduleRole: 'Sales.Agent', attrAccess: {}, assocAccess: {}, allowCreate: false, allowDelete: false, xpathConstraint: null }],
    viewEntity: { sourceDocument: 'Sales.LostView', oql: null }
  });

  const mx = await openSeededProject(t, t.APP, model);

  await mx.evaluate(`Array.from(document.querySelectorAll('button,a')).filter(n => /^Entities/i.test(n.textContent.trim()))[0].click()`);
  await mx.waitFor(`!!Array.from(document.querySelectorAll('.entity-card-name')).find(n => n.textContent === 'OpenOrders')`, 8000, 'entity list');

  const cards = await mx.evaluate(`(function(){
    function sub(name) {
      var card = Array.from(document.querySelectorAll('.entity-card')).find(function (c) { return c.querySelector('.entity-card-name').textContent === name; });
      return card ? card.querySelector('.entity-card-sub').textContent : null;
    }
    return { view: sub('OpenOrders'), order: sub('Order'), temp: sub('TempNote') };
  })()`);
  t.ok(/view entity/.test(cards.view) && !/view entity/.test(cards.order) && /non-persistable/.test(cards.temp),
    'a view entity is marked as one in the list, and only a view entity is: ' + JSON.stringify(cards));

  await mx.evaluate(`Array.from(document.querySelectorAll('.entity-card')).find(function (c) { return c.querySelector('.entity-card-name').textContent === 'OpenOrders'; }).click()`);
  await mx.waitFor(`document.querySelectorAll('.popup-tab').length === 3`, 8000, 'popup');
  const popup = await mx.evaluate(`(function(){
    var m = document.querySelector('.modal-detail');
    return {
      badges: Array.from(m.querySelectorAll('.popup-title-row .badge')).map(function (b) { return b.textContent; }),
      oql: (m.querySelector('pre.oql-source') || {}).textContent || null
    };
  })()`);
  t.ok(popup.badges.indexOf('View entity') !== -1 && popup.badges.indexOf('Create') === -1,
    'its popup says what it is beside its name: ' + JSON.stringify(popup.badges));
  t.ok(popup.oql === OQL, 'and shows the query that defines it, as written in the model: ' + popup.oql);

  // ---- Data: the same browsable table, with what those rows are said ----
  await mx.evaluate(`Array.from(document.querySelectorAll('.popup-tab')).filter(t => t.textContent === 'Data')[0].click()`);
  const snippet = await mx.waitFor(`document.querySelector('.scan-script') && document.querySelector('.scan-script').value`, 8000, 'snippet');
  const app = await t.tab(t.APP);
  await app.waitFor('!!window.mx', 10000, 'app tab');
  await app.evaluate('(function(){ ' + snippet + ' return true; })()');
  await app.waitFor(`/Connected to MxScout/.test(document.body.textContent)`, 12000, 'connected');

  const rows = await mx.waitFor(`document.querySelectorAll('.data-table tbody tr').length > 0 && document.querySelectorAll('.data-table tbody tr').length`, 20000, 'rows');
  t.ok(rows > 0, 'its rows are browsed through the same retrieve a stored entity’s are: ' + rows + ' rows');
  t.ok(/rows are what its OQL query returns/.test(await mx.evaluate(`(document.querySelector('.view-entity-note') || {}).textContent || ''`)),
    'and the tab says they are a query’s result, served read-only, not rows stored for it');
  t.ok(await mx.evaluate(`!document.querySelector('.modal input[placeholder="Object id"]')`),
    'it is never sent to the lookup-by-id pane a non-persistable entity gets');
  await app.close();

  // ---- a view entity whose query is not in this model ----
  await mx.evaluate(`document.querySelector('.modal-backdrop').click()`);
  await mx.waitFor(`!document.querySelector('.modal-detail')`, 5000, 'popup closed');
  await mx.evaluate(`Array.from(document.querySelectorAll('.entity-card')).find(function (c) { return c.querySelector('.entity-card-name').textContent === 'LostView'; }).click()`);
  await mx.waitFor(`document.querySelectorAll('.popup-tab').length === 3`, 8000, 'second popup');
  // The popup reopens on the tab last used, which was Data.
  await mx.evaluate(`Array.from(document.querySelectorAll('.popup-tab')).filter(t => t.textContent === 'Attributes & access')[0].click()`);
  await mx.waitFor(`!!document.querySelector('.modal-detail .popup-section')`, 5000, 'access tab');
  const lost = await mx.evaluate(`document.querySelector('.modal-detail').textContent`);
  t.ok(/Its query is in Sales\.LostView, which this model does not carry/.test(lost) && !(await mx.evaluate(`!!document.querySelector('pre.oql-source')`)),
    'a view entity whose query is missing says where it lives, instead of an empty box');

  await mx.close();
};
