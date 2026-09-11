/* MxMpr.buildModel — turning a decoded .mpr Unit table into MxScout's
 * canonical model shape. Exercised against two small, committed synthetic
 * fixtures (see test/fixtures/README.md and the generator next to them)
 * encoding the SAME tiny fake app — one module ("Sales"), two entities
 * ("Customer"/"Order") linked by an association, an access rule (including
 * the marker-prefixed array shape that once silently emptied a one-role
 * AllowedModuleRoles list), a microflow nested two levels deep under a
 * Folder (exercising resolveOwningModule's walk-up) — once in v1 shape
 * (Contents inline in the Unit table) and once in v2 shape (Contents in
 * separate mprcontents-style files, read here through an in-memory map
 * instead of real files — the real-file path is exercised end-to-end by
 * test/13-mpr-import-ui.test.js).
 *
 * Both must produce the identical model, with ONE deliberate exception:
 * their _MetaData tables have the two different column shapes a Mendix 9 and
 * a Mendix 11 project really have, so the reader's tolerance for both is
 * tested rather than assumed. */
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
    var model = await window.MxMpr.buildModel({ mprBytes: bytes, appName: 'Sales', readContentsFile: function () { throw new Error('v1 must not read content files'); } });
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
      appName: 'Sales',
      readContentsFile: function (relPath) {
        seen.push(relPath);
        return Promise.resolve(Object.prototype.hasOwnProperty.call(sidecar, relPath) ? b64ToBuffer(sidecar[relPath]) : null);
      }
    });
    delete model.meta.generatedAt;
    return { model: model, filesRead: seen.length };
  })()`);

  // Thirteen of the fourteen units: the Folder is never opened, because
  // nothing the walk needs is inside one.
  t.ok(v2.filesRead === 13, 'v2 opens only the units the walk actually needs: ' + v2.filesRead);

  // ---- the two formats are the same app, and say so in the same words ----
  // Everything except meta must come out byte-identical from both shapes.
  // Meta is the ONE deliberate difference: the v1 fixture carries the
  // three-column _MetaData a Mendix 9 project has, the v2 fixture the
  // four-column one an 11.12 project has, so both shapes get exercised.
  function withoutMeta(m) {
    var copy = JSON.parse(JSON.stringify(m));
    delete copy.meta;
    return copy;
  }
  t.ok(JSON.stringify(withoutMeta(v1)) === JSON.stringify(withoutMeta(v2.model)),
    'v1 (Contents inline) and v2 (Contents in per-unit files) build the identical model');

  // ---- project metadata off the _MetaData table ----
  t.ok(v1.meta.mendixVersion === '9.24.33.59499',
    'the Mendix 9 shape of _MetaData — three columns, no _FormatVersion — is read: ' + v1.meta.mendixVersion);
  t.ok(v2.model.meta.mendixVersion === '11.12.0',
    'and so is the four-column Mendix 11 shape: ' + v2.model.meta.mendixVersion);
  t.ok(v1.meta.mprFormat === 1 && v2.model.meta.mprFormat === 2,
    'the on-disk format is decided by the Unit table’s own columns, not by that version number: ' +
    v1.meta.mprFormat + ' / ' + v2.model.meta.mprFormat);
  t.ok(/^\{SHA256\}/.test(v1.meta.schemaHash) && /^\{SHA256\}/.test(v2.model.meta.schemaHash),
    'the schema hash comes through as written, prefix and all');
  t.ok(v1.meta.appName === 'Sales' && v2.model.meta.appName === 'Sales',
    'the app name is the .mpr’s own file name — nothing inside the file carries it');

  const expected = {
    modules: [{ name: 'Sales', fromAppStore: false }],
    entities: [
      {
        module: 'Sales', name: 'Customer', qualifiedName: 'Sales.Customer',
        tableName: null, generalization: null, persistable: true,
        attributes: [
          { name: 'Name', type: 'String', length: 200, defaultValue: null, enumerationQualifiedName: null },
          { name: 'Age', type: 'Integer', length: null, defaultValue: null, enumerationQualifiedName: null },
          { name: 'Status', type: 'Enumeration', length: null, defaultValue: null, enumerationQualifiedName: 'Sales.Status' }
        ],
        accessRules: [
          {
            moduleRole: 'Sales.User', defaultAccess: 'r', attrAccess: { Name: 'rw', Age: 'r', Status: 'r' }, assocAccess: {},
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
    ]
  };

  // The domain model is the part of this shape everything else in MxScout
  // renders, so it is pinned exactly rather than sampled.
  const core = JSON.stringify({
    modules: v1.modules, entities: v1.entities, associations: v1.associations
  });
  const expectedCore = JSON.stringify({
    modules: expected.modules, entities: expected.entities, associations: expected.associations
  });
  t.ok(core === expectedCore,
    'modules, entities and associations come out exactly as expected:\n  got:      ' + core + '\n  expected: ' + expectedCore);

  const flow = v1.microflows.filter(function (f) { return f.qualifiedName === 'Sales.CreateOrder'; })[0];
  t.ok(!!flow && flow.applyEntityAccess === true &&
    JSON.stringify(flow.allowedModuleRoles) === JSON.stringify(['Sales.User']),
    'a microflow two folders deep is found, attributed to its module, and carries its roles: ' + JSON.stringify(flow && flow.allowedModuleRoles));
  t.ok(!!flow && JSON.stringify(flow.parameters) === JSON.stringify(
    [{ name: 'Customer', type: 'Object', entityQualifiedName: 'Sales.Customer', enumerationQualifiedName: null, isList: false }]),
    'and its object parameter resolves to the entity it points at: ' + JSON.stringify(flow && flow.parameters));
  t.ok(v1.pages.length === 1 && v1.pages[0].qualifiedName === 'Sales.Order_Overview',
    'pages are read the same way: ' + JSON.stringify(v1.pages.map(function (p) { return p.qualifiedName; })));

  // ---- the project's Security screen ----
  const sec = v1.security;
  t.ok(!!sec && sec.level === 'CheckEverything',
    'the security level is read — it decides whether everything else MxScout shows about roles is enforced at all: ' + (sec && sec.level));
  t.ok(sec.guestAccess === true && sec.guestUserRole === 'Guest',
    'anonymous access, and which role a visitor who has not signed in gets: ' + JSON.stringify([sec.guestAccess, sec.guestUserRole]));
  t.ok(sec.strictMode === false && sec.strictPageUrlCheck === true,
    'strict mode and the page URL check come through as the two separate settings they are');
  t.ok(!!sec.passwordPolicy && sec.passwordPolicy.minimumLength === 6 &&
    sec.passwordPolicy.requireDigit === true && sec.passwordPolicy.requireSymbol === false,
    'the password policy is read field by field: ' + JSON.stringify(sec.passwordPolicy));
  t.ok(sec.adminUserName === 'MxAdmin' && sec.adminUserRole === 'User',
    'the administrator account is named: ' + JSON.stringify([sec.adminUserName, sec.adminUserRole]));

  // Secrets are read as facts, never as values — the fixture's admin password
  // is "hunter2" and its demo user's is "letmein", and neither string may
  // appear anywhere in the model that gets stored, packaged and reported on.
  t.ok(sec.adminPasswordSet === true, 'that the admin password is set in the model IS recorded');
  t.ok(sec.demoUsersEnabled === true && sec.demoUsers.length === 1 &&
    sec.demoUsers[0].userName === 'demo_user' && sec.demoUsers[0].passwordSet === true &&
    JSON.stringify(sec.demoUsers[0].userRoles) === JSON.stringify(['User']),
    'and so is each demo account, by name and role: ' + JSON.stringify(sec.demoUsers));
  const serialized = JSON.stringify(v1);
  t.ok(serialized.indexOf('hunter2') === -1 && serialized.indexOf('letmein') === -1,
    'but NO password value reaches the model — nothing to leak into the browser’s database, a package or a report');

  // ---- user roles carry what they can hand out ----
  const owner = v1.userRoles.filter(function (r) { return r.name === 'Owner'; })[0];
  const guest = v1.userRoles.filter(function (r) { return r.name === 'Guest'; })[0];
  t.ok(!!owner && owner.manageAllRoles === true, 'a role that can assign every other role says so');
  t.ok(!!guest && guest.manageAllRoles === false && guest.moduleRoles.length === 0,
    'and a role that unlocks nothing comes through as unlocking nothing, not as missing');

  // ---- module roles, from the module rather than from the rules ----
  t.ok(v1.moduleRoles.length === 2 &&
    JSON.stringify(v1.moduleRoles.map(function (r) { return r.qualifiedName; })) ===
    JSON.stringify(['Sales.Auditor', 'Sales.User']),
    'every role a module declares is read, including one no access rule mentions: ' +
    JSON.stringify(v1.moduleRoles.map(function (r) { return r.qualifiedName; })));
  t.ok(v1.moduleRoles[0].description === 'Reads everything, changes nothing.',
    'with the one line of text in which somebody said what the role is for: ' + v1.moduleRoles[0].description);

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
