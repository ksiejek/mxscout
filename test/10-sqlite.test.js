/* MxSqlite — the pure-JS SQLite reader that will feed step 10 (import from a
 * Mendix project folder). Exercised against a small, committed fixture built
 * once with the system `sqlite3` CLI (see test/fixtures/README.md) — a
 * dev-time-only tool, never invoked while this test runs. The fixture forces
 * every shape the reader has to handle: multiple leaf pages plus an interior
 * page (1200+ rows), a BLOB big enough to need an overflow-page chain,
 * unicode TEXT, NULLs, a negative INTEGER, and a second table declared the
 * same multi-line way with an inline "PRIMARY KEY NOT NULL" that a real
 * .mpr's own `Unit` table uses — the column-name parser has to survive that,
 * not just the simple one-line CREATE TABLE the first table uses. */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const fixturePath = path.join(__dirname, 'fixtures', 'sqlite-basic.db');
  const base64 = fs.readFileSync(fixturePath).toString('base64');

  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'app loaded');

  // sqlite.js isn't wired into index.html (it's only ever loaded by the
  // import Worker) — inject it the same way the Worker eventually will,
  // rather than adding a permanent <script> tag before anything uses it.
  await mx.evaluate(`new Promise(function (resolve, reject) {
    var s = document.createElement('script');
    s.src = '/sqlite.js';
    s.onload = function () { resolve(true); };
    s.onerror = function () { reject(new Error('failed to load /sqlite.js')); };
    document.head.appendChild(s);
  })`);
  t.ok(await mx.evaluate('!!window.MxSqlite'), 'MxSqlite loaded onto the page');

  await mx.evaluate(`(function () {
    window.__fx = Uint8Array.from(atob("${base64}"), function (c) { return c.charCodeAt(0); }).buffer;
    return true;
  })()`);

  const widget = await mx.evaluate(`(function () {
    var t = window.MxSqlite.readTable(window.__fx, 'Widget');
    function idx(name) { return t.columns.indexOf(name); }
    function findRow(id) {
      var i = idx('Id');
      for (var r = 0; r < t.rows.length; r++) if (t.rows[r][i] === id) return t.rows[r];
      return null;
    }
    function hex(u8) {
      var s = '';
      for (var i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, '0');
      return s;
    }
    var r9002 = findRow(9002), r9003 = findRow(9003), r9001 = findRow(9001), rNeg = findRow(-42), r1 = findRow(1);
    var data = r9003[idx('Data')];
    return {
      columns: t.columns,
      rowCount: t.rows.length,
      r1Name: r1[idx('Name')],
      r9002Name: r9002[idx('Name')],
      r9002Note: r9002[idx('Note')],
      r9003DataLen: data.length,
      r9003DataFirst8: hex(data.slice(0, 8)),
      r9003DataLast8: hex(data.slice(-8)),
      r9001Name: r9001[idx('Name')],
      r9001Note: r9001[idx('Note')],
      r9001Data: r9001[idx('Data')],
      rNegName: rNeg[idx('Name')],
      rNegNote: rNeg[idx('Note')]
    };
  })()`);

  t.ok(JSON.stringify(widget.columns) === JSON.stringify(['Id', 'Name', 'Note', 'Data']),
    'column order is read from CREATE TABLE, in declaration order: ' + JSON.stringify(widget.columns));
  t.ok(widget.rowCount === 1204, 'every row is found across the multi-page b-tree: ' + widget.rowCount);
  t.ok(widget.r1Name === 'Widget-1', 'a plain row round-trips: ' + widget.r1Name);
  t.ok(widget.r9002Name === 'Zażółć gęślą jaźń — 你好' && widget.r9002Note === 'emoji: 🎉🚀',
    'unicode TEXT decodes correctly: ' + widget.r9002Name);
  t.ok(widget.r9003DataLen === 20000, 'an overflowing BLOB comes back at its full length: ' + widget.r9003DataLen);
  t.ok(widget.r9003DataFirst8 === '030a11181f262d34' && widget.r9003DataLast8 === 'abb2b9c0c7ced5dc',
    'the overflow chain is followed in order, start to end: ' + widget.r9003DataFirst8 + '/' + widget.r9003DataLast8);
  t.ok(widget.r9001Name === null && widget.r9001Note === null && widget.r9001Data === null,
    'NULL cells decode to null, not to an empty string or zero');
  t.ok(widget.rNegName === 'Neg' && widget.rNegNote === 'x', 'a negative INTEGER row is still found: ' + widget.rNegName);

  // Second table: same file, a multi-line CREATE TABLE with an inline
  // "BLOB PRIMARY KEY NOT NULL" column — the exact shape a real .mpr's own
  // Unit table uses, confirmed against a real one.
  const unitLike = await mx.evaluate(`(function () {
    var t = window.MxSqlite.readTable(window.__fx, 'UnitLike');
    function hex(u8) {
      var s = '';
      for (var i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, '0');
      return s;
    }
    var row = t.rows[0];
    return {
      columns: t.columns,
      rowCount: t.rows.length,
      unitId: hex(row[t.columns.indexOf('UnitID')]),
      containerId: hex(row[t.columns.indexOf('ContainerID')]),
      containmentName: row[t.columns.indexOf('ContainmentName')],
      treeConflict: row[t.columns.indexOf('TreeConflict')],
      contentsHash: row[t.columns.indexOf('ContentsHash')],
      contentsConflicts: row[t.columns.indexOf('ContentsConflicts')]
    };
  })()`);
  t.ok(JSON.stringify(unitLike.columns) === JSON.stringify(
    ['UnitID', 'ContainerID', 'ContainmentName', 'TreeConflict', 'ContentsHash', 'ContentsConflicts']),
    'a column-level "PRIMARY KEY NOT NULL" does not corrupt the column list: ' + JSON.stringify(unitLike.columns));
  t.ok(unitLike.rowCount === 1, 'the second table is found independently of the first: ' + unitLike.rowCount);
  t.ok(unitLike.unitId === '0102030405060708090a0b0c0d0e0f10', 'its BLOB primary key round-trips: ' + unitLike.unitId);
  t.ok(unitLike.containerId === '1112131415161718191a1b1c1d1e1f20', 'its second BLOB column round-trips: ' + unitLike.containerId);
  t.ok(unitLike.containmentName === 'DomainModel' && unitLike.treeConflict === 0 && unitLike.contentsHash === 'abc123' && unitLike.contentsConflicts === null,
    'the remaining scalar columns round-trip, including a trailing NULL: ' + JSON.stringify(unitLike));

  // ---- errors are loud, not silent ----
  const missing = await mx.evaluate(`(function () {
    try { window.MxSqlite.readTable(window.__fx, 'NoSuchTable'); return null; }
    catch (e) { return e.message; }
  })()`);
  t.ok(/No table named "NoSuchTable"/.test(missing), 'asking for a table that does not exist fails loudly: ' + missing);

  const badHeader = await mx.evaluate(`(function () {
    try { window.MxSqlite.readTable(new Uint8Array(32).buffer, 'Widget'); return null; }
    catch (e) { return e.message; }
  })()`);
  t.ok(/does not look like a SQLite file/.test(badHeader), 'a non-SQLite buffer fails loudly, not with a decode crash: ' + badHeader);

  await mx.close();
};
