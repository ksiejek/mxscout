/* MxMpr.buildModel — turning a decoded .mpr Unit table into MxScout's
 * canonical model shape. Exercised against two small, committed synthetic
 * fixtures (see test/fixtures/README.md) encoding the SAME tiny fake app —
 * one module ("Sales"), two entities ("Customer"/"Order") linked by an
 * association, an access rule (including the marker-prefixed array shape
 * that once silently emptied a one-role AllowedModuleRoles list), a
 * microflow nested two levels deep under a Folder (exercising
 * resolveOwningModule's walk-up), and one user role — once in v1 shape
 * (Contents inline in the Unit table) and once in v2 shape (Contents in
 * separate mprcontents-style files, read here through an in-memory map
 * instead of real files — the real-file path is exercised end-to-end by
 * test/12-mpr-import-ui.test.js). Both must produce the identical model. */
'use strict';
const fs = require('fs');
const path = require('path');

module.exports = async function (t) {
  const v1b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v1.db')).toString('base64');
  const v2b64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v2.db')).toString('base64');
  const sidecar = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'mpr-v2-contents.json'), 'utf8'));

  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxStore', 15000, 'app loaded');

  async function loadScript(src) {
    await mx.evaluate(`new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '${src}';
      s.onload = function () { resolve(true); };
      s.onerror = function () { reject(new Error('failed to load ${src}')); };
      document.head.appendChild(s);
    })`);
  }
  await loadScript('/sqlite.js');
  await loadScript('/bson.js');
  await loadScript('/mpr.js');
  t.ok(await mx.evaluate('!!window.MxMpr && !!window.MxMpr.buildModel'), 'MxMpr loaded onto the page');

  // ---- v1: Contents inline, no readContentsFile needed at all ----
  const v1 = await mx.evaluate(`(async function () {
    var bytes = Uint8Array.from(atob("${v1b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, readContentsFile: function () { throw new Error('v1 must not read content files'); } });
    delete model.meta.generatedAt;
    return model;
  })()`);

  // ---- v2: no Contents column, bytes come from a relativePath -> bytes map ----
  const v2 = await mx.evaluate(`(async function () {
    var sidecar = ${JSON.stringify(sidecar)};
    function b64ToBuffer(b64) {
      var bin = atob(b64);
      var u8 = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return u8.buffer;
    }
    var bytes = Uint8Array.from(atob("${v2b64}"), function (c) { return c.charCodeAt(0); }).buffer;
    var seen = [];
    var model = await window.MxMpr.buildModel({
      mprBytes: bytes,
      readContentsFile: function (relPath) {
        seen.push(relPath);
        return Promise.resolve(Object.prototype.hasOwnProperty.call(sidecar, relPath) ? b64ToBuffer(sidecar[relPath]) : null);
      }
    });
    delete model.meta.generatedAt;
    return { model: model, filesRead: seen.length };
  })()`);

  t.ok(v2.filesRead === 4, 'v2 reads exactly the four unit files a real project would need for this fixture: ' + v2.filesRead);

  const expected = {
    meta: { source: 'mpr', appName: null, mendixVersion: null },
    modules: [{ name: 'Sales', fromAppStore: false }],
    entities: [
      {
        module: 'Sales', name: 'Customer', qualifiedName: 'Sales.Customer',
        tableName: null, generalization: null, persistable: true,
        attributes: [
          { name: 'Name', type: 'String', length: 200, defaultValue: null, enumerationQualifiedName: null },
          { name: 'Age', type: 'Integer', length: null, defaultValue: null, enumerationQualifiedName: null }
        ],
        accessRules: [
          {
            moduleRole: 'Sales.User', defaultAccess: 'r', attrAccess: { Name: 'rw', Age: 'r' }, assocAccess: {},
            xpathConstraint: '[Age > 0]', xpathReferencedEntities: [], allowCreate: true, allowDelete: false
          }
        ]
      },
      {
        module: 'Sales', name: 'Order', qualifiedName: 'Sales.Order',
        tableName: null, generalization: null, persistable: true,
        attributes: [{ name: 'Number', type: 'String', length: 50, defaultValue: null, enumerationQualifiedName: null }],
        accessRules: []
      }
    ],
    associations: [
      { name: 'Order_Customer', module: 'Sales', owner: 'Sales.Order', ownerMultiplicity: null, other: 'Sales.Customer', otherMultiplicity: null, type: 'Reference' }
    ],
    userRoles: [{ name: 'User', moduleRoles: ['Sales.User'] }],
    microflows: [
      {
        module: 'Sales', name: 'CreateOrder', qualifiedName: 'Sales.CreateOrder',
        allowedModuleRoles: ['Sales.User'], applyEntityAccess: true,
        parameters: [{ name: 'Customer', type: 'Object', entityQualifiedName: 'Sales.Customer', enumerationQualifiedName: null, isList: false }],
        calledBy: [], javaActionCalls: [], entityRefs: [], constantRefs: [], enumerationRefs: []
      }
    ],
    nanoflows: [], pages: [], javaActions: [], constants: [], enumerations: []
  };

  function withoutMeta(m) {
    var copy = JSON.parse(JSON.stringify(m));
    copy.meta = { source: copy.meta.source, appName: copy.meta.appName, mendixVersion: copy.meta.mendixVersion };
    return copy;
  }

  const v1Actual = JSON.stringify(withoutMeta(v1));
  const v2Actual = JSON.stringify(withoutMeta(v2.model));
  const expectedStr = JSON.stringify(expected);

  t.ok(v1Actual === expectedStr, 'v1 (Contents inline) builds exactly the expected canonical model:\n  got:      ' + v1Actual + '\n  expected: ' + expectedStr);
  t.ok(v2Actual === expectedStr, 'v2 (Contents via mprcontents-style files) builds the SAME model as v1:\n  got:      ' + v2Actual + '\n  expected: ' + expectedStr);

  // ---- errors are loud, not silent ----
  const noUnitTable = await mx.evaluate(`(async function () {
    try {
      // A well-formed but empty SQLite file has no Unit table at all: an
      // empty sqlite_master leaf page (page 1) and nothing else.
      var empty = new Uint8Array(512);
      empty.set([0x53,0x51,0x4c,0x69,0x74,0x65,0x20,0x66,0x6f,0x72,0x6d,0x61,0x74,0x20,0x33,0x00]); // 'SQLite format 3\\0'
      empty[16] = 0x02; empty[17] = 0x00; // page size 512
      empty[20] = 0; // reserved space
      empty[100] = 0x0d; // leaf table b-tree page, 0 cells (rest already zero)
      await window.MxMpr.buildModel({ mprBytes: empty.buffer, readContentsFile: function () { return Promise.resolve(null); } });
      return null;
    } catch (e) { return e.message; }
  })()`);
  t.ok(/No table named "Unit"/.test(noUnitTable), 'a .mpr-shaped file with no Unit table fails loudly, not silently: ' + noUnitTable);

  // ---- a rule's default member access covers its ASSOCIATIONS too ----
  // In Studio Pro an association is a member of the entity like an attribute
  // is, so a rule whose DefaultMemberAccessRights is Read grants read on every
  // association the entity OWNS unless it says otherwise. That expansion runs
  // over the finished model (an association is only known once every module is
  // read), which is why it is its own exported step — and why it can be tested
  // here on a plain model instead of on another binary fixture.
  const defaults = await mx.evaluate(`(function () {
    var model = {
      entities: [
        { qualifiedName: 'Sales.Order', accessRules: [
          { moduleRole: 'Sales.User', defaultAccess: 'r', attrAccess: {}, assocAccess: { Order_Note: 'none', Order_Line: 'rw' } },
          { moduleRole: 'Sales.Admin', defaultAccess: null, attrAccess: {}, assocAccess: {} }
        ] },
        { qualifiedName: 'Sales.Customer', accessRules: [
          { moduleRole: 'Sales.User', defaultAccess: 'rw', attrAccess: {}, assocAccess: {} }
        ] }
      ],
      associations: [
        { name: 'Order_Setting', owner: 'Sales.Order', other: 'Admin.Setting' },
        { name: 'Order_Note', owner: 'Sales.Order', other: 'Sales.Note' },
        { name: 'Order_Line', owner: 'Sales.Order', other: 'Sales.Line' },
        { name: 'Order_Customer', owner: 'Sales.Order', other: 'Sales.Customer' }
      ]
    };
    window.MxMpr.applyAssociationDefaults(model);
    return JSON.stringify({
      user: model.entities[0].accessRules[0].assocAccess,
      admin: model.entities[0].accessRules[1].assocAccess,
      customer: model.entities[1].accessRules[0].assocAccess
    });
  })()`);
  const d = JSON.parse(defaults);
  t.ok(d.user.Order_Setting === 'r' && d.user.Order_Customer === 'r',
    'the rule’s default reaches the associations it said nothing about: ' + defaults);
  t.ok(d.user.Order_Note === 'none', 'an explicit denial is not overwritten by the default');
  t.ok(d.user.Order_Line === 'rw', 'and neither is an explicit grant');
  t.ok(Object.keys(d.admin).length === 0, 'a rule with no default gains nothing');
  t.ok(Object.keys(d.customer).length === 0,
    'and the default only reaches associations the entity OWNS — Sales.Customer owns none');

  await mx.close();
};
