#!/usr/bin/env node
/* Rebuilds the .mpr fixtures: mpr-v1.db, mpr-v2.db, mpr-v2-contents.json.
 *
 * A ONE-OFF, DEV-MACHINE-ONLY step. `npm test` never runs this — it reads the
 * committed binaries. That is what keeps a binary fixture inside the
 * zero-dependency rule: the checked-in file is the fixture, this file is only
 * the recipe, and the recipe uses nothing but Node's own stdlib (`node:sqlite`,
 * Node 22+) plus a ~60-line BSON encoder that mirrors public/bson.js's decoder.
 *
 *   node test/fixtures/build-mpr-fixtures.js
 *
 * Both files encode the SAME tiny fake Mendix app, once in v1 shape (a
 * `Contents` BLOB column inline in the `Unit` table, no `_Transaction` table —
 * exactly how a real Mendix 9 project is laid out) and once in v2 shape (no
 * `Contents` column; each unit's body in its own mprcontents/xx/yy/<guid>.mxunit
 * file, here standing in as base64 in the sidecar JSON). The ONE deliberate
 * difference between them is `_MetaData`: v1 carries the three-column shape a
 * Mendix 9 project has, v2 the four-column shape a Mendix 11 project has, so
 * the reader's tolerance for both is exercised rather than assumed.
 *
 * The app is small but deliberately covers every shape the reader knows:
 * a module with two entities and an association, a view entity with its
 * OQL source document, an access rule with member
 * accesses and an XPath constraint, a microflow nested two levels under a
 * folder (the walk-up to its owning module), a microflow with a body (loop,
 * retrieve, change, commit, delete, call, Java call, page open), an
 * enumeration, a constant, a Java action, a page, a published REST service,
 * a scheduled event, module roles, navigation home pages, and a project
 * security document with the full Security-screen settings on it.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// ---------------- BSON encoder (mirror of public/bson.js's decoder) --------
function cstring(name) {
  return Buffer.concat([Buffer.from(String(name), 'utf8'), Buffer.from([0])]);
}
function int32(n) { const b = Buffer.alloc(4); b.writeInt32LE(n, 0); return b; }
function double(n) { const b = Buffer.alloc(8); b.writeDoubleLE(n, 0); return b; }

// A marker-prefixed model array: Mendix puts a small int in slot 0 of every
// array in a .mpr saying how the list is encoded, and consumers iterate from
// slot 1. Measured on two real projects: 1.17M arrays, every one of them
// marker-prefixed, values 1 (by-name/string lists), 2 and 3 only.
function marked(marker, items) { return { __array: [marker].concat(items) }; }
function bin(bytes) { return { __binary: Buffer.from(bytes) }; }

function encodeValue(v) {
  if (v === null || v === undefined) return [0x0A, Buffer.alloc(0)];
  if (typeof v === 'boolean') return [0x08, Buffer.from([v ? 1 : 0])];
  if (typeof v === 'number') {
    if (Number.isInteger(v) && v >= -2147483648 && v <= 2147483647) return [0x10, int32(v)];
    return [0x01, double(v)];
  }
  if (typeof v === 'string') {
    const s = Buffer.from(v, 'utf8');
    return [0x02, Buffer.concat([int32(s.length + 1), s, Buffer.from([0])])];
  }
  if (Array.isArray(v)) return [0x04, encodeDoc(arrayToDoc(v))];
  if (v && v.__array) return [0x04, encodeDoc(arrayToDoc(v.__array))];
  if (v && v.__binary) {
    return [0x05, Buffer.concat([int32(v.__binary.length), Buffer.from([0]), v.__binary])];
  }
  if (typeof v === 'object') return [0x03, encodeDoc(v)];
  throw new Error('cannot encode ' + typeof v);
}
function arrayToDoc(arr) {
  const doc = {};
  arr.forEach(function (item, i) { doc[String(i)] = item; });
  return doc;
}
function encodeDoc(obj) {
  const parts = [];
  Object.keys(obj).forEach(function (key) {
    const [type, payload] = encodeValue(obj[key]);
    parts.push(Buffer.from([type]), cstring(key), payload);
  });
  const body = Buffer.concat(parts);
  return Buffer.concat([int32(body.length + 5), body, Buffer.from([0])]);
}

// ---------------- unit ids -------------------------------------------------
// Unit ids are 16-byte blobs. The v2 file name for a unit is that blob
// formatted as a Microsoft/.NET GUID — first three groups byte-swapped — which
// is the one piece of this layout nobody would guess (see blobToGuid in
// public/mpr.js).
function id(firstByte) {
  const b = Buffer.alloc(16);
  b[0] = firstByte;
  for (let i = 1; i < 16; i++) b[i] = i; // 01 02 ... 0f, stable and readable in a hex dump
  return b;
}
function guidOf(b) {
  const h = (i) => b[i].toString(16).padStart(2, '0');
  return h(3) + h(2) + h(1) + h(0) + '-' + h(5) + h(4) + '-' + h(7) + h(6) + '-' +
    h(8) + h(9) + '-' + [10, 11, 12, 13, 14, 15].map(h).join('');
}
function unitPath(blob) {
  const g = guidOf(blob);
  return g.slice(0, 2) + '/' + g.slice(2, 4) + '/' + g + '.mxunit';
}

const ROOT = Buffer.alloc(16);            // the project root unit
const U = {
  module:        id(0xa0),
  domainModel:   id(0xa1),
  folder:        id(0xa2),
  createOrder:   id(0xa3),
  security:      id(0xa4),
  moduleSecurity:id(0xa5),
  statusEnum:    id(0xa6),
  constant:      id(0xa7),
  javaAction:    id(0xa8),
  scheduled:     id(0xa9),
  sweepOrders:   id(0xaa),
  restService:   id(0xab),
  page:          id(0xac),
  navigation:    id(0xad),
  openOrdersSrc: id(0xae)
};
const E = { customer: id(0xb1), order: id(0xb2), openOrders: id(0xb3) };

// ---------------- the fake app --------------------------------------------
function text(str) {
  return { $Type: 'Texts$Text', Items: marked(3, [{ $Type: 'Texts$Translation', LanguageCode: 'en_US', Text: str }]) };
}

const UNITS = [
  { unit: U.module, container: ROOT, containment: 'Modules', doc: {
    $Type: 'Projects$ModuleImpl', Name: 'Sales'
  } },

  { unit: U.domainModel, container: U.module, containment: 'DomainModel', doc: {
    $Type: 'DomainModels$DomainModel',
    Entities: marked(3, [
      {
        $Type: 'DomainModels$EntityImpl', Name: 'Customer', $ID: bin(E.customer),
        Attributes: marked(3, [
          { $Type: 'DomainModels$Attribute', Name: 'Name',
            NewType: { $Type: 'DomainModels$StringAttributeType', Length: 200 },
            Value: { DefaultValue: null } },
          { $Type: 'DomainModels$Attribute', Name: 'Age',
            NewType: { $Type: 'DomainModels$IntegerAttributeType' } },
          { $Type: 'DomainModels$Attribute', Name: 'Status',
            NewType: { $Type: 'DomainModels$EnumerationAttributeType', Enumeration: 'Sales.Status' } }
        ]),
        // Older files call this "Generalization", newer ones
        // "MaybeGeneralization"; measured on two real projects, only the
        // newer name ever appears, so that is the one the fixture uses.
        MaybeGeneralization: { $Type: 'DomainModels$NoGeneralization', Persistable: true },
        AccessRules: marked(3, [
          { $Type: 'DomainModels$AccessRule',
            // A marker-prefixed one-item list: the exact shape that a reader
            // slicing slot 0 unconditionally would be fine with, and that a
            // reader NOT slicing it would read as a role literally named "2".
            AllowedModuleRoles: marked(2, ['Sales.User']),
            DefaultMemberAccessRights: 'ReadOnly',
            MemberAccesses: marked(3, [
              { $Type: 'DomainModels$MemberAccess', Attribute: 'Sales.Customer.Name', AccessRights: 'ReadWrite' }
            ]),
            AllowCreate: true, AllowDelete: false, XPathConstraint: '[Age > 0]' }
        ])
      },
      {
        $Type: 'DomainModels$EntityImpl', Name: 'Order', $ID: bin(E.order),
        Attributes: marked(3, [
          { $Type: 'DomainModels$Attribute', Name: 'Number',
            NewType: { $Type: 'DomainModels$StringAttributeType', Length: 50 } }
        ]),
        MaybeGeneralization: { $Type: 'DomainModels$NoGeneralization', Persistable: true },
        AccessRules: marked(3, [])
      },
      // A view entity: rows are an OQL query's result, not a table. The
      // shape is the Mendix metamodel's own names, not read off a real
      // project — none on the machine this was written on has one. The query
      // itself lives in a separate source document (below), as in Mendix 11.
      {
        $Type: 'DomainModels$EntityImpl', Name: 'OpenOrders', $ID: bin(E.openOrders),
        Attributes: marked(3, [
          { $Type: 'DomainModels$Attribute', Name: 'Number',
            NewType: { $Type: 'DomainModels$StringAttributeType', Length: 50 } }
        ]),
        MaybeGeneralization: { $Type: 'DomainModels$NoGeneralization', Persistable: true },
        Source: { $Type: 'DomainModels$OqlViewEntitySource', SourceDocument: 'Sales.OpenOrders' },
        AccessRules: marked(3, [])
      }
    ]),
    Associations: marked(3, [
      { $Type: 'DomainModels$Association', Name: 'Order_Customer',
        ParentPointer: bin(E.order), ChildPointer: bin(E.customer), Type: 'Reference' }
    ]),
    CrossAssociations: marked(3, [])
  } },

  // Module roles live in their own unit, one per module — the only place a
  // role that no access rule happens to mention is written down at all.
  { unit: U.moduleSecurity, container: U.module, containment: 'ModuleSecurity', doc: {
    $Type: 'Security$ModuleSecurity',
    ModuleRoles: marked(3, [
      { $Type: 'Security$ModuleRole', Name: 'User', Description: 'Everyday use of the Sales module.' },
      { $Type: 'Security$ModuleRole', Name: 'Auditor', Description: 'Reads everything, changes nothing.' }
    ])
  } },

  { unit: U.folder, container: U.module, containment: 'Folders', doc: {
    $Type: 'Projects$Folder', Name: 'Orders'
  } },

  // Two levels deep under a folder, to exercise the walk up to the owning
  // module. Its body opens a page, calls the other microflow and a Java
  // action, and creates an object — all of it read for "what this does".
  { unit: U.createOrder, container: U.folder, containment: 'Documents', doc: {
    $Type: 'Microflows$Microflow', Name: 'CreateOrder',
    AllowedModuleRoles: marked(1, ['Sales.User']),
    ApplyEntityAccess: true,
    MicroflowParameterCollection: { Parameters: marked(2, [
      { $Type: 'Microflows$MicroflowParameter', Name: 'Customer',
        VariableType: { $Type: 'DataTypes$ObjectType', Entity: bin(E.customer) } }
    ]) },
    ObjectCollection: { Objects: marked(2, [
      { $Type: 'Microflows$StartEvent' },
      { $Type: 'Microflows$ActionActivity', Action: {
        $Type: 'Microflows$CreateChangeAction', Entity: 'Sales.Order', Commit: 'Yes',
        Items: marked(2, [
          { $Type: 'Microflows$ChangeActionItem', Attribute: 'Sales.Order.Number', Type: 'Set', Value: "'X'" }
        ]) } },
      { $Type: 'Microflows$ActionActivity', Action: {
        $Type: 'Microflows$MicroflowCallAction',
        MicroflowCall: { $Type: 'Microflows$MicroflowCall', Microflow: 'Sales.SweepOrders' } } },
      { $Type: 'Microflows$ActionActivity', Action: {
        $Type: 'Microflows$JavaActionCallAction', JavaAction: 'Sales.SendMail' } },
      { $Type: 'Microflows$ActionActivity', Action: {
        $Type: 'Microflows$ShowFormAction',
        FormSettings: { $Type: 'Forms$FormSettings', Form: 'Sales.Order_Overview' } } },
      { $Type: 'Microflows$EndEvent' }
    ]) }
  } },

  // No allowed roles at all: nothing in the client can set it off. What CAN
  // is the scheduled event below — which is the whole point of reading them.
  // Its retrieve-and-commit sit inside a loop, the shape that turns into one
  // database round trip per row at run time.
  { unit: U.sweepOrders, container: U.module, containment: 'Documents', doc: {
    $Type: 'Microflows$Microflow', Name: 'SweepOrders',
    AllowedModuleRoles: marked(1, []),
    ApplyEntityAccess: false,
    ObjectCollection: { Objects: marked(2, [
      { $Type: 'Microflows$StartEvent' },
      { $Type: 'Microflows$ActionActivity', Action: {
        $Type: 'Microflows$RetrieveAction', ResultVariableName: 'OrderList',
        RetrieveSource: { $Type: 'Microflows$DatabaseRetrieveSource', Entity: 'Sales.Order',
          XpathConstraint: '[Sales.Order_Customer/Sales.Customer/Age > 18]' } } },
      { $Type: 'Microflows$LoopedActivity',
        LoopSource: { $Type: 'Microflows$IterableList', ListVariableName: 'OrderList', VariableName: 'IteratorOrder' },
        ObjectCollection: { Objects: marked(2, [
          { $Type: 'Microflows$ActionActivity', Action: {
            $Type: 'Microflows$ChangeAction', ChangeVariableName: 'IteratorOrder', Commit: 'No',
            Items: marked(2, [
              { $Type: 'Microflows$ChangeActionItem', Attribute: 'Sales.Order.Number', Type: 'Set', Value: "''" }
            ]) } },
          { $Type: 'Microflows$ActionActivity', Action: {
            $Type: 'Microflows$CommitAction', CommitVariableName: 'IteratorOrder', WithEvents: true } }
        ]) } },
      { $Type: 'Microflows$ActionActivity', Action: {
        $Type: 'Microflows$DeleteAction', DeleteVariableName: 'OrderList' } },
      { $Type: 'Microflows$ActionActivity', Action: {
        $Type: 'Microflows$RestCallAction',
        HttpConfiguration: { $Type: 'Microflows$HttpConfiguration', CustomLocation: 'https://example.test/hook' } } },
      { $Type: 'Microflows$EndEvent' }
    ]) }
  } },

  { unit: U.page, container: U.module, containment: 'Documents', doc: {
    $Type: 'Forms$Page', Name: 'Order_Overview',
    AllowedModuleRoles: marked(1, ['Sales.User'])
  } },

  { unit: U.openOrdersSrc, container: U.module, containment: 'Documents', doc: {
    $Type: 'DomainModels$ViewEntitySourceDocument', Name: 'OpenOrders',
    Oql: 'SELECT o.Number AS Number FROM Sales.Order AS o'
  } },

  { unit: U.statusEnum, container: U.module, containment: 'Documents', doc: {
    $Type: 'Enumerations$Enumeration', Name: 'Status',
    Values: marked(3, [
      { $Type: 'Enumerations$EnumerationValue', Name: 'open', Caption: text('Open') },
      { $Type: 'Enumerations$EnumerationValue', Name: 'closed', Caption: text('Closed') }
    ])
  } },

  { unit: U.constant, container: U.module, containment: 'Documents', doc: {
    $Type: 'Constants$Constant', Name: 'MaxOrders', DefaultValue: '25',
    ExposedToClient: false, Type: { $Type: 'DataTypes$IntegerType' }
  } },

  { unit: U.javaAction, container: U.module, containment: 'Documents', doc: {
    $Type: 'JavaActions$JavaAction', Name: 'SendMail',
    Documentation: 'Sends one mail. Java, so nothing here can see what it does.',
    JavaReturnType: { $Type: 'CodeActions$BooleanType' },
    Parameters: marked(3, [
      { $Type: 'CodeActions$CodeActionParameter', Name: 'To',
        ActionParameterType: { $Type: 'CodeActions$StringType' } }
    ])
  } },

  // Runs SweepOrders with no user at all — outside every role in the model.
  // Note it carries BOTH the legacy Interval/IntervalType pair AND the
  // Schedule child, exactly as a real project does; only the child is current.
  { unit: U.scheduled, container: U.module, containment: 'Documents', doc: {
    $Type: 'ScheduledEvents$ScheduledEvent', Name: 'NightlySweep',
    Enabled: true, Microflow: 'Sales.SweepOrders', TimeZone: 'UTC',
    Interval: 99, IntervalType: 'Second',
    Schedule: { $Type: 'ScheduledEvents$DaySchedule', Multiplier: 1 }
  } },

  // Published with an empty role list: reachable by anyone who can reach the
  // app, which is a thing worth being able to see.
  { unit: U.restService, container: U.module, containment: 'Documents', doc: {
    $Type: 'Rest$PublishedRestService', Name: 'orders', Path: 'orders/', Version: '1.0.0',
    AllowedRoles: marked(1, []),
    AuthenticationTypes: marked(1, []),
    AuthenticationMicroflow: '',
    Resources: marked(3, [
      { $Type: 'Rest$PublishedRestServiceResource', Name: 'order',
        Operations: marked(2, [
          { $Type: 'Rest$PublishedRestServiceOperation', HttpMethod: 'Post',
            Microflow: 'Sales.CreateOrder', OperationPath: '' }
        ]) }
    ])
  } },

  { unit: U.security, container: ROOT, containment: 'ProjectDocuments', doc: {
    $Type: 'Security$ProjectSecurity',
    SecurityLevel: 'CheckEverything',
    CheckSecurity: true,
    StrictMode: false,
    StrictPageUrlCheck: true,
    EnableGuestAccess: true,
    GuestUserRole: 'Guest',
    EnableDemoUsers: true,
    AdminUserName: 'MxAdmin',
    AdminUserRole: 'User',
    // Passwords in the clear, which is where Mendix really keeps them. Three
    // of them, one per verdict the reader has to be able to reach: one that
    // fails the project's OWN policy and is a well-known password, one that
    // is well-known and also missing a required digit, and one that passes.
    // None of these strings may appear in the model that comes out.
    // Deliberately a string that appears nowhere else in this app, so the
    // test can assert it does not survive into the model. (A real project
    // measured for this work has literally "1" here.)
    AdminPassword: 'abc',
    PasswordPolicySettings: { $Type: 'Security$PasswordPolicySettings',
      MinimumLength: 6, RequireDigit: true, RequireMixedCase: false, RequireSymbol: false },
    DemoUsers: marked(2, [
      { $Type: 'Security$DemoUserImpl', UserName: 'demo_user', Password: 'letmein',
        UserRoles: marked(1, ['User']) },
      { $Type: 'Security$DemoUserImpl', UserName: 'demo_strong', Password: 'Xk7#pQ2mL9vT',
        UserRoles: marked(1, ['User']) }
    ]),
    UserRoles: marked(2, [
      { $Type: 'Security$UserRole', Name: 'User', ModuleRoles: marked(3, ['Sales.User']),
        ManageAllRoles: false, ManageableRoles: marked(1, []) },
      { $Type: 'Security$UserRole', Name: 'Guest', ModuleRoles: marked(3, []),
        ManageAllRoles: false, ManageableRoles: marked(1, []) },
      { $Type: 'Security$UserRole', Name: 'Owner', ModuleRoles: marked(3, ['Sales.User']),
        ManageAllRoles: true, ManageableRoles: marked(1, []) }
    ])
  } },

  { unit: U.navigation, container: ROOT, containment: 'ProjectDocuments', doc: {
    $Type: 'Navigation$NavigationDocument',
    Profiles: marked(2, [
      { $Type: 'Navigation$NavigationProfile', Name: 'Responsive',
        HomeItems: marked(2, [
          { $Type: 'Navigation$RoleBasedHomePage', UserRole: 'User', Page: 'Sales.Order_Overview', Microflow: '' },
          { $Type: 'Navigation$RoleBasedHomePage', UserRole: 'Guest', Page: '', Microflow: 'Sales.CreateOrder' }
        ]) }
    ])
  } }
];

// ---------------- writing the two databases --------------------------------
const here = __dirname;
function fresh(file) { const p = path.join(here, file); if (fs.existsSync(p)) fs.unlinkSync(p); return p; }

// v1: Mendix 9 shape — Contents inline, three-column _MetaData, no _Transaction.
const v1 = new DatabaseSync(fresh('mpr-v1.db'));
v1.exec(`CREATE TABLE Unit
        (
            UnitID BLOB PRIMARY KEY NOT NULL,
            ContainerID BLOB,
            ContainmentName TEXT,
            Contents BLOB
        )`);
v1.exec('CREATE TABLE _MetaData (_ProductVersion TEXT, _BuildVersion TEXT, _SchemaHash TEXT)');
v1.prepare('INSERT INTO _MetaData VALUES (?, ?, ?)')
  .run('9.24.33.59499', '9.24.33.59499', '{SHA256}AeQ6N74AiZz+/WuwfqGt/OECDCUuVyw6PdCKKTEk8sI=');
const insertV1 = v1.prepare('INSERT INTO Unit VALUES (?, ?, ?, ?)');
UNITS.forEach(function (u) {
  insertV1.run(u.unit, u.container, u.containment, encodeDoc(u.doc));
});
v1.close();

// v2: Mendix 11 shape — no Contents column, four-column _MetaData (the column
// a report claimed disappears after 11.6.2; a real 11.12 project still has it),
// and the _Transaction row Studio Pro uses to notice outside edits. MxScout
// reads neither that table nor ever writes one.
const v2 = new DatabaseSync(fresh('mpr-v2.db'));
v2.exec(`CREATE TABLE Unit
        (
            UnitID BLOB PRIMARY KEY NOT NULL,
            ContainerID BLOB,
            ContainmentName TEXT,
            TreeConflict LONG,
            ContentsHash TEXT,
            ContentsConflicts TEXT
        )`);
v2.exec('CREATE TABLE _MetaData (_FormatVersion INTEGER, _ProductVersion TEXT, _BuildVersion TEXT, _SchemaHash TEXT)');
v2.prepare('INSERT INTO _MetaData VALUES (?, ?, ?, ?)')
  .run(2, '11.12.0', '11.12.0', '{SHA256}ex8TFkjI5tikVWCC05OxODFVHlheQtT9XpJxPAwVGY0=');
v2.exec('CREATE TABLE _Transaction (LastTransactionID TEXT)');
v2.prepare('INSERT INTO _Transaction VALUES (?)').run('d9be0578-b3d9-4852-9814-5e7adb427b63');
const insertV2 = v2.prepare('INSERT INTO Unit VALUES (?, ?, ?, ?, ?, ?)');
const sidecar = {};
UNITS.forEach(function (u) {
  const body = encodeDoc(u.doc);
  insertV2.run(u.unit, u.container, u.containment, 0, 'hash-not-checked', null);
  sidecar[unitPath(u.unit)] = body.toString('base64');
});
v2.close();
fs.writeFileSync(path.join(here, 'mpr-v2-contents.json'), JSON.stringify(sidecar, null, 1) + '\n');

console.log('wrote mpr-v1.db, mpr-v2.db and mpr-v2-contents.json — ' + UNITS.length + ' units each');
