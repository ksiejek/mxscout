/* The happy path: one snippet, pasted once into the app tab, and the entity
 * popup's Data tab fills with real rows — count, paging and live search
 * included. */
'use strict';
const { openSeededProject, openEntityPopup, clickTab } = require('./helpers');

module.exports = async function (t) {
  const mx = await openSeededProject(t, t.APP);
  await openEntityPopup(mx);

  const tabs = await mx.evaluate(`Array.from(document.querySelectorAll('.popup-tab')).map(t => t.textContent).join(',')`);
  t.ok(tabs === 'Attributes & access,Data,Comments', 'the popup opens on the merged Attributes & access tab, then Data and Comments: ' + tabs);

  // Attributes and constraints are one tab now: the row-level rule sits above
  // the attribute list, rendered readably (the CurrentUser token becomes a
  // "current user" pill), with the exact XPath kept on the rule for reference.
  const con = await mx.waitFor(`(function(){ var c = document.querySelector('.con-line'); return c && c.textContent; })()`, 5000, 'constraint');
  t.ok(/current user/.test(con), 'the row-level rule reads in plain words — the runtime token becomes a "current user" pill: ' + con);
  t.ok(await mx.evaluate(`(function(){ var c = document.querySelector('.con-line'); return c && /CurrentUser/.test(c.getAttribute('title')||''); })()`),
    'and the exact XPath is kept on the rule, so nothing is paraphrased away');
  t.ok(await mx.evaluate(`!!document.querySelector('.con-line .con-op')`),
    'the comparison operator is set apart (accent), the way the arrow is');

  // The same matrix carries the per-attribute access: one row per attribute,
  // a "read"/"read + write" cell under each applicable rule's column.
  t.ok(await mx.evaluate(`(function(){
    var body = document.querySelectorAll('.access-matrix tbody tr').length;
    var lvls = Array.from(document.querySelectorAll('.access-matrix .am-lvl')).map(function(c){return c.textContent.trim();});
    return body > 0 && lvls.some(function(v){ return /read/.test(v); });
  })()`), 'and, in the same table, each attribute’s read / read + write access under that rule');

  // Associations are members of the entity like attributes are, so they are
  // rows of the SAME matrix — under their own labelled break, with the far end
  // in the Type column and a level per rule. Only the ones this entity OWNS:
  // Admin.Setting's Setting_Order points AT Sales.Order and is a member of the
  // other entity, so it must not appear here.
  const members = await mx.evaluate(`(function(){
    var rows = Array.from(document.querySelectorAll('.access-matrix tbody tr'));
    return rows.map(function (tr) { return Array.from(tr.children).map(function (td) { return td.textContent.trim(); }).join('|'); }).join(' /// ');
  })()`);
  t.ok(/Associations/.test(members), 'the matrix breaks out an Associations section: ' + JSON.stringify(members));
  t.ok(/Order_Setting\|→ Admin\.Setting\|read \+ write/.test(members),
    'an owned association is a row with its far end and its access under the rule');
  t.ok(/Order_Note\|→ Sales\.TempNote\|—/.test(members),
    'one the rule denies reads as no access rather than being left out');
  t.ok(members.indexOf('Setting_Order') === -1,
    'an association owned by the OTHER entity stays out — this entity’s rules say nothing about it');
  t.ok(await mx.evaluate(`document.querySelector('.access-matrix .am-h-attr').textContent === 'Member'`),
    'so the column is Member, not Attribute');

  await mx.evaluate(clickTab('Data'));
  const snippet = await mx.waitFor(`document.querySelector('.scan-script') && document.querySelector('.scan-script').value`, 8000, 'snippet');
  t.ok(snippet.length > 5000, 'the Data tab offers the one connect snippet');
  t.ok(snippet.indexOf('Sales.Order') !== -1, 'the snippet carries the selected entity, for the fallback case');

  // Paste it exactly as a user would.
  const app = await t.tab(t.APP);
  await app.waitFor('!!window.mx', 10000, 'app tab');
  await app.evaluate('(function(){ ' + snippet + ' return true; })()');
  let connected = false;
  try { connected = !!(await app.waitFor(`/Connected to MxScout/.test(document.body.textContent)`, 12000, 'connected')); }
  catch (e) {
    console.log('    DIAG app panel:', JSON.stringify((await app.evaluate(`document.body.innerText`)).slice(0, 700)));
    console.log('    DIAG snippet token:', (/"token":"([a-f0-9]+)"/.exec(snippet) || [])[1]);
    console.log('    DIAG server exec:', await mx.evaluate(`fetch('/api/session/exec').then(function (r) { return r.text(); })`));
    console.log('    DIAG ping from app tab:', await app.evaluate(
      'fetch(' + JSON.stringify(t.MX + '/api/session/ping?token=') + ' + ' +
      JSON.stringify((/"token":"([a-f0-9]+)"/.exec(snippet) || [])[1] || '') +
      ').then(function (r) { return r.status + " " + r.statusText; }, function (e) { return "threw: " + e.message; })'));
  }
  t.ok(connected, 'the pasted code reports it connected');
  t.ok(await app.evaluate(`/Signed in as tester/.test(document.body.textContent)`),
    'the centred panel names the signed-in user');
  t.ok(await app.evaluate(`/Environment allowed/.test(document.body.textContent)`),
    'the panel reports each step and its outcome, not just a spinner');

  const rows = await mx.waitFor(`document.querySelectorAll('.data-table tbody tr').length === 10 && 10`, 20000, 'rows');
  t.ok(rows === 10, 'ten rows appear in MxScout');
  t.ok(await mx.evaluate(`document.querySelector('.data-summary').textContent`) === '1–10 of 253',
    'a real count came back — /xas/ retrieve_by_xpath with count:true');
  t.ok(await mx.evaluate(`document.querySelector('.data-table tbody tr td').textContent`) === '1001',
    'the id column shows the object id');

  // Write access is marked per CELL, from what the app itself says about each
  // object it returned (isReadonlyAttr) — not per column. The fake app answers
  // the way a real rule would: Total never writable, Customer always, Number
  // only on the Acme rows. So one column must contain both.
  const write = await mx.waitFor(`(function(){
    var head = Array.from(document.querySelectorAll('.data-table th')).map(function (h) { return h.textContent; });
    var rows = Array.from(document.querySelectorAll('.data-table tbody tr'));
    if (!rows.length) return null;
    function col(name) {
      var i = head.indexOf(name);
      return rows.map(function (tr) { return tr.children[i].classList.contains('data-write'); });
    }
    return JSON.stringify({ number: col('Number'), customer: col('Customer'), total: col('Total') });
  })()`, 15000, 'write marks');
  const marks = JSON.parse(write);
  t.ok(marks.customer.every(Boolean), 'a value this session may write is marked on every row that has it');
  t.ok(marks.total.every(function (v) { return v === false; }), 'a read-only value is marked on none');
  t.ok(marks.number.some(Boolean) && marks.number.some(function (v) { return v === false; }),
    'and one column carries both: write depends on the ROW, because the rule’s XPath decides which rows it covers');
  t.ok(await mx.evaluate(`!!document.querySelector('.data-write-legend')`),
    'a legend says what the green means');

  await mx.evaluate(`Array.from(document.querySelectorAll('.data-pager button')).filter(b => /Next/.test(b.textContent))[0].click()`);
  const p2 = await mx.waitFor(`document.querySelector('.data-summary').textContent === '11–20 of 253' && document.querySelector('.data-table tbody tr td').textContent`, 15000, 'page 2');
  t.ok(p2 === '1011', 'Next pages forward');
  await mx.evaluate(`Array.from(document.querySelectorAll('.data-pager button')).filter(b => /Previous/.test(b.textContent))[0].click()`);
  t.ok(await mx.waitFor(`document.querySelector('.data-summary').textContent === '1–10 of 253'`, 15000, 'page 1'),
    'Previous pages back');

  async function search(term) {
    await mx.evaluate('(function(){ var i = document.querySelector(".data-search"); i.value = ' + JSON.stringify(term) + '; i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()');
  }
  await search('Acme');
  const found = await mx.waitFor(`/of 84$/.test(document.querySelector('.data-summary').textContent) && document.querySelector('.data-summary').textContent`, 15000, 'search');
  t.ok(!!found, 'live search re-counts against the database: ' + found);
  t.ok(await mx.evaluate(`Array.from(document.querySelectorAll('.data-table tbody tr')).every(tr => /Acme/.test(tr.textContent))`),
    'every row on the page matches the term');

  await search('1042');
  t.ok(await mx.waitFor(`document.querySelector('.data-summary').textContent === '1–1 of 1' && document.querySelector('.data-table tbody tr td').textContent === '1042'`, 15000, 'by id'),
    'a bare number finds that one object by id');

  await search('zzzznothing');
  t.ok(await mx.waitFor(`/Nothing matches/.test(document.querySelector('.data-body').textContent)`, 15000, 'empty'),
    'no matches says so instead of showing an empty grid');

  // A second entity, read through the SAME bridge: the snippet was generated
  // for Sales.Order, so if the columns were taken from the snippet's own
  // target rather than from the query, this page would show Order's fields.
  await mx.evaluate(`Array.from(document.querySelectorAll('.modal button')).find(b => b.textContent === 'Close').click()`);
  await mx.waitFor(`!document.querySelector('.popup-tab')`, 5000, 'closed');
  // Admin.Setting has no access rule for Sales.Agent (the default role) —
  // correctly invisible under it. Switch to "Everything" first: this step is
  // about a second entity's own columns, not about role-based visibility.
  await mx.evaluate(`(function(){ var s = document.querySelector('.role-select'); s.value = 'all'; s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await mx.evaluate(`(function(){ var n = Array.from(document.querySelectorAll('button,div,li,tr')).filter(e => e.textContent.indexOf('Admin.Setting') !== -1 || e.textContent.trim() === 'Setting'); n[n.length-1].click(); return true; })()`);
  await mx.waitFor(`document.querySelectorAll('.popup-tab').length === 3`, 8000, 'second popup');
  await mx.evaluate(`Array.from(document.querySelectorAll('.popup-tab')).filter(t => t.textContent === 'Data')[0].click()`);
  const headers = await mx.waitFor(`document.querySelectorAll('.data-table th').length && Array.from(document.querySelectorAll('.data-table th')).map(h => h.textContent).join(',')`, 20000, 'second entity headers');
  t.ok(headers === 'id,Key,Value', 'a second entity comes back with ITS columns, not the snippet target\u2019s: ' + headers);
  t.ok(/retention\.days/.test(await mx.evaluate(`document.querySelector('.data-table tbody').textContent`)),
    'and with its own rows');

  await mx.close(); await app.close();
};
