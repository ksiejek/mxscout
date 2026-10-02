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
 * accesses and an XPath constraint, a folder tree (a folder in a folder, a
 * folder named with a slash in it, and an empty one), a microflow one folder
 * down and a page two (the walk-up to its owning module, and the path it
 * collects on the way), a microflow with a body (loop,
 * retrieve, change, commit, delete, call, Java call, page open) carrying the
 * geometry and the edge list a real flow has — a position and size on every
 * object, a decision with two enumeration cases, a merge, an error outlet, an
 * annotation and an inheritance split — an
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
  openOrdersSrc: id(0xae),
  // The project tree needs three folder shapes a real project always has and
  // one folder cannot show: a folder inside a folder, a folder whose name
  // contains a slash (so a path joined into one string would be ambiguous —
  // 2 to 12 such names in each of the four projects measured), and a folder
  // with nothing in it, which teams use to write down a Marketplace module's
  // version and which a tree built only from documents would silently drop.
  subFolder:     id(0xaf),
  emptyFolder:   id(0xb0)
};
const E = { customer: id(0xb1), order: id(0xb2), openOrders: id(0xb3) };
// Associations carry an $ID of their own; see the Order_Customer unit below.
const A = { orderCustomer: id(0xb4) };

// Ids of the objects INSIDE a microflow body. Every object in a real .mpr flow
// carries one, and the flow's single Flows array points at them — so a fixture
// without them cannot exercise the graph at all. The hex of id(0xc0) reads
// "c00102030405060708090a0b0c0d0e0f", which is what the test asserts against.
const N = {
  // CreateOrder: a straight line, plus the parameter chip Studio Pro draws
  // on the canvas (a flow can carry it here AND in MicroflowParameterCollection;
  // the collection is what extractParameters reads, this is what is drawn).
  coParam: id(0xc0), coStart: id(0xc1), coCreate: id(0xc2), coCall: id(0xc3),
  coJava: id(0xc4), coForm: id(0xc5), coEnd: id(0xc6),
  coAssocRetrieve: id(0xc7), coNanoCall: id(0xc8),
  // SweepOrders: the structural showcase — decision with two enumeration
  // cases, a loop with its own two activities, a merge, an error handler, an
  // annotation, and an inheritance split with an entity-named case.
  swStart: id(0xd0), swRetrieve: id(0xd1), swSplit: id(0xd2), swLoop: id(0xd3),
  swChange: id(0xd4), swCommit: id(0xd5), swMerge: id(0xd6), swDelete: id(0xd7),
  swRest: id(0xd8), swAggregate: id(0xd9), swListOp: id(0xda), swWebService: id(0xdb),
  swEnd: id(0xdc), swError: id(0xdd), swNote: id(0xde), swInherit: id(0xdf),
  swMessage: id(0xe0), swImport: id(0xe1), swExport: id(0xe2)
};

// A flow's geometry, in the two string shapes Mendix stores it in: the MIDDLE
// point of the object (relative to its container, so a child of a loop is
// relative to the loop) and the size, both "x;y".
function at(x, y) { return x + ';' + y; }
function size(w, h) { return w + ';' + h; }

// One Microflows$SequenceFlow. Ports are the raw connection indexes Mendix
// writes; 1 -> 3 is the overwhelmingly common pair in real projects (left to
// right). `opts.case` is an enumeration case value, `opts.inherit` an entity
// name, `opts.error` marks the error-handler outlet.
function edge(from, to, opts) {
  const o = opts || {};
  const cases = o.case !== undefined
    ? [{ $Type: 'Microflows$EnumerationCase', Value: o.case }]
    : o.inherit !== undefined
      ? [{ $Type: 'Microflows$InheritanceCase', Value: o.inherit }]
      : [{ $Type: 'Microflows$NoCase' }];
  return {
    $Type: 'Microflows$SequenceFlow',
    OriginPointer: bin(from), DestinationPointer: bin(to),
    OriginConnectionIndex: o.fromSide === undefined ? 1 : o.fromSide,
    DestinationConnectionIndex: o.toSide === undefined ? 3 : o.toSide,
    IsErrorHandler: !!o.error,
    CaseValues: marked(2, cases),
    Line: { $Type: 'Microflows$BezierCurve', OriginControlVector: at(30, 0), DestinationControlVector: at(-30, 0) }
  };
}
function annotationEdge(from, to) {
  return {
    $Type: 'Microflows$AnnotationFlow',
    OriginPointer: bin(from), DestinationPointer: bin(to),
    OriginConnectionIndex: 2, DestinationConnectionIndex: 0,
    Line: { $Type: 'Microflows$BezierCurve', OriginControlVector: at(0, -10), DestinationControlVector: at(0, 10) }
  };
}

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
      // The $ID matters: a real association has one, and without it every
      // id-keyed index of associations ends up keyed by null — which made a
      // lookup by the WRONG key succeed here while failing on every real
      // project. A fixture missing a field a real file always carries does
      // not simplify the test, it disables it.
      { $Type: 'DomainModels$Association', Name: 'Order_Customer', $ID: bin(A.orderCustomer),
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

  { unit: U.subFolder, container: U.folder, containment: 'Folders', doc: {
    $Type: 'Projects$Folder', Name: 'Export/Import'
  } },

  { unit: U.emptyFolder, container: U.module, containment: 'Folders', doc: {
    $Type: 'Projects$Folder', Name: '#v1.0.0'
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
      { $Type: 'Microflows$MicroflowParameter', $ID: bin(N.coParam), Name: 'Customer',
        IsRequired: true, RelativeMiddlePoint: at(-180, 10), Size: size(30, 30),
        VariableType: { $Type: 'DataTypes$ObjectType', Entity: bin(E.customer) } },
      { $Type: 'Microflows$StartEvent', $ID: bin(N.coStart),
        RelativeMiddlePoint: at(0, 100), Size: size(20, 20) },
      { $Type: 'Microflows$ActionActivity', $ID: bin(N.coCreate),
        RelativeMiddlePoint: at(160, 100), Size: size(120, 60),
        // The caption a person typed, so it must survive untouched; every
        // other activity here leaves AutoGenerateCaption at its default and
        // has no readable caption at all.
        AutoGenerateCaption: false, Caption: 'Open a fresh order',
        Documentation: 'Numbered X until the real number is known.',
        Action: {
          $Type: 'Microflows$CreateChangeAction', Entity: 'Sales.Order', Commit: 'Yes',
          VariableName: 'Order',
          Items: marked(2, [
            { $Type: 'Microflows$ChangeActionItem', Attribute: 'Sales.Order.Number', Type: 'Set', Value: "'X'" }
          ]) } },
      { $Type: 'Microflows$ActionActivity', $ID: bin(N.coCall),
        RelativeMiddlePoint: at(360, 100), Size: size(120, 60),
        AutoGenerateCaption: true, Caption: 'Activity', Action: {
          $Type: 'Microflows$MicroflowCallAction',
          MicroflowCall: { $Type: 'Microflows$MicroflowCall', Microflow: 'Sales.SweepOrders' } } },
      { $Type: 'Microflows$ActionActivity', $ID: bin(N.coJava),
        RelativeMiddlePoint: at(560, 100), Size: size(120, 60), Action: {
          $Type: 'Microflows$JavaActionCallAction', JavaAction: 'Sales.SendMail' } },
      // A retrieve over an association, which names the association by its
      // QUALIFIED NAME — never by an id, in any Mendix version measured
      // (3109 of them across a Mendix 9 and two Mendix 11 projects, all
      // strings). Starting at the Customer parameter, so it must land on
      // Sales.Order: the end that is not where it came from.
      { $Type: 'Microflows$ActionActivity', $ID: bin(N.coAssocRetrieve),
        RelativeMiddlePoint: at(660, 220), Size: size(120, 60), Action: {
          $Type: 'Microflows$RetrieveAction', ResultVariableName: 'CustomerOrders',
          RetrieveSource: { $Type: 'Microflows$AssociationRetrieveSource',
            AssociationId: 'Sales.Order_Customer', StartVariableName: 'Customer' } } },
      // A nanoflow call keeps the called nanoflow one level down, inside
      // NanoflowCall — not on the action itself.
      { $Type: 'Microflows$ActionActivity', $ID: bin(N.coNanoCall),
        RelativeMiddlePoint: at(660, 320), Size: size(120, 60), Action: {
          $Type: 'Microflows$NanoflowCallAction',
          NanoflowCall: { $Type: 'Microflows$NanoflowCall', Nanoflow: 'Sales.RefreshOrders' } } },
      { $Type: 'Microflows$ActionActivity', $ID: bin(N.coForm),
        RelativeMiddlePoint: at(760, 100), Size: size(120, 60), Disabled: true, Action: {
          $Type: 'Microflows$ShowFormAction',
          FormSettings: { $Type: 'Forms$FormSettings', Form: 'Sales.Order_Overview' } } },
      { $Type: 'Microflows$EndEvent', $ID: bin(N.coEnd),
        RelativeMiddlePoint: at(940, 100), Size: size(20, 20), ReturnValue: '$Order' }
    ]) },
    Flows: marked(2, [
      edge(N.coStart, N.coCreate),
      edge(N.coCreate, N.coCall),
      edge(N.coCall, N.coJava),
      edge(N.coJava, N.coForm),
      edge(N.coForm, N.coEnd),
      edge(N.coAssocRetrieve, N.coNanoCall)
    ])
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
      { $Type: 'Microflows$StartEvent', $ID: bin(N.swStart),
        RelativeMiddlePoint: at(0, 100), Size: size(20, 20) },
      { $Type: 'Microflows$ActionActivity', $ID: bin(N.swRetrieve),
        RelativeMiddlePoint: at(160, 100), Size: size(120, 60), Action: {
          $Type: 'Microflows$RetrieveAction', ResultVariableName: 'OrderList',
          RetrieveSource: { $Type: 'Microflows$DatabaseRetrieveSource', Entity: 'Sales.Order',
            XpathConstraint: '[Sales.Order_Customer/Sales.Customer/Age > 18]' } } },
      { $Type: 'Microflows$ExclusiveSplit', $ID: bin(N.swSplit),
        RelativeMiddlePoint: at(340, 100), Size: size(90, 60), Caption: 'Any orders?',
        SplitCondition: { $Type: 'Microflows$ExpressionSplitCondition', Expression: '$OrderList != empty' } },
      // The children's points are relative to the LOOP, not to the canvas —
      // which is what `parentId` on the node is for.
      { $Type: 'Microflows$LoopedActivity', $ID: bin(N.swLoop),
        RelativeMiddlePoint: at(520, 60), Size: size(320, 160),
        LoopSource: { $Type: 'Microflows$IterableList', ListVariableName: 'OrderList', VariableName: 'IteratorOrder' },
        ObjectCollection: { Objects: marked(2, [
          { $Type: 'Microflows$ActionActivity', $ID: bin(N.swChange),
            RelativeMiddlePoint: at(90, 80), Size: size(120, 60), Action: {
              $Type: 'Microflows$ChangeAction', ChangeVariableName: 'IteratorOrder', Commit: 'No',
              Items: marked(2, [
                { $Type: 'Microflows$ChangeActionItem', Attribute: 'Sales.Order.Number', Type: 'Set', Value: "''" }
              ]) } },
          { $Type: 'Microflows$ActionActivity', $ID: bin(N.swCommit),
            RelativeMiddlePoint: at(230, 80), Size: size(120, 60), Action: {
              $Type: 'Microflows$CommitAction', CommitVariableName: 'IteratorOrder', WithEvents: true } }
        ]) } },
      { $Type: 'Microflows$ExclusiveMerge', $ID: bin(N.swMerge),
        RelativeMiddlePoint: at(900, 100), Size: size(20, 20) },
      { $Type: 'Microflows$ActionActivity', $ID: bin(N.swDelete),
        RelativeMiddlePoint: at(1000, 100), Size: size(120, 60), Action: {
          $Type: 'Microflows$DeleteAction', DeleteVariableName: 'OrderList' } },
      { $Type: 'Microflows$ActionActivity', $ID: bin(N.swRest),
        RelativeMiddlePoint: at(1160, 100), Size: size(120, 60), Action: {
          $Type: 'Microflows$RestCallAction',
          // As a real one is shaped: CustomLocation empty (all 44 measured
          // were), the address in a template whose {1} slots are filled from
          // its own parameter expressions.
          HttpConfiguration: { $Type: 'Microflows$HttpConfiguration', CustomLocation: '',
            HttpMethod: 'Post',
            CustomLocationTemplate: { $Type: 'Microflows$StringTemplate', Text: '{1}/orders',
              Parameters: marked(2, [
                { $Type: 'Microflows$TemplateParameter', Expression: '@Sales.ApiUrl' }
              ]) } } } },
      // Three activities the "what it does" summary has never recognised and
      // still does not: here they are only drawn, by the action they carry.
      // Field names here are the ones a real .mpr uses, not plausible
      // inventions: the input list is AggregateVariableName and the output is
      // VariableName (checked against 156 of these in a real project), and a
      // list operation keeps WHICH operation in NewOperation's own $Type.
      { $Type: 'Microflows$ActionActivity', $ID: bin(N.swAggregate),
        RelativeMiddlePoint: at(1320, 100), Size: size(120, 60), Action: {
          $Type: 'Microflows$AggregateAction', AggregateFunction: 'Count',
          AggregateVariableName: 'OrderList', VariableName: 'OrderCount',
          Attribute: '', Expression: '', UseExpression: false } },
      { $Type: 'Microflows$ActionActivity', $ID: bin(N.swListOp),
        RelativeMiddlePoint: at(1480, 100), Size: size(120, 60), Action: {
          $Type: 'Microflows$ListOperationsAction', ResultVariableName: 'FirstOrder',
          NewOperation: { $Type: 'Microflows$Head', ListName: 'OrderList' } } },
      { $Type: 'Microflows$ActionActivity', $ID: bin(N.swWebService),
        RelativeMiddlePoint: at(1640, 100), Size: size(120, 60), Action: {
          $Type: 'Microflows$CallWebServiceAction', ServiceName: 'CustomerService',
          OperationName: 'getCustomer', ImportedService: 'Sales.CustomerService' } },
      // A message whose text is a TextTemplate: the words live in a
      // Texts$Text one level further down, per language.
      { $Type: 'Microflows$ActionActivity', $ID: bin(N.swMessage),
        RelativeMiddlePoint: at(1480, 260), Size: size(120, 60), Action: {
          $Type: 'Microflows$ShowMessageAction', Type: 'Warning', Blocking: true,
          Template: { $Type: 'Microflows$TextTemplate',
            Parameters: marked(2, [
              { $Type: 'Microflows$TemplateParameter', Expression: '$OrderCount' }
            ]),
            Text: text('Nothing was swept: {1}.') } } },
      { $Type: 'Microflows$EndEvent', $ID: bin(N.swEnd),
        RelativeMiddlePoint: at(1800, 100), Size: size(20, 20), ReturnValue: '' },
      // An error outlet, the note beside the decision, and a split on the
      // specialization of a variable — three shapes with no Action at all.
      // An import names its MAPPING, which is what identifies it; the
      // document variable is a detail.
      { $Type: 'Microflows$ActionActivity', $ID: bin(N.swImport),
        RelativeMiddlePoint: at(1320, 260), Size: size(120, 60), Action: {
          $Type: 'Microflows$ImportXmlAction', XmlDocumentVariableName: 'OrderXml',
          // An import keeps its mapping TWO levels down, under
          // ImportMappingCall.ReturnValueMapping; an export keeps it as
          // MappingId one level down. Both shapes are real and they differ.
          ResultHandling: { $Type: 'Microflows$ResultHandling', Bind: true,
            ImportMappingCall: { $Type: 'Microflows$ImportMappingCall', ContentType: 'Xml',
              Commit: 'YesWithoutEvents', ReturnValueMapping: 'Sales.ImportOrders' } } } },
      { $Type: 'Microflows$ActionActivity', $ID: bin(N.swExport),
        RelativeMiddlePoint: at(1160, 400), Size: size(120, 60), Action: {
          $Type: 'Microflows$ExportXmlAction',
          ResultHandling: { $Type: 'Microflows$MappingRequestHandling', ContentType: 'Xml',
            MappingId: 'Sales.ExportOrders', MappingVariableName: 'OrderList' },
          OutputMethod: { $Type: 'ExportXmlAction$FileDocumentExport',
            TargetDocumentVariableName: 'OrderFile' } } },
      { $Type: 'Microflows$ErrorEvent', $ID: bin(N.swError),
        RelativeMiddlePoint: at(1160, 260), Size: size(20, 20) },
      { $Type: 'Microflows$Annotation', $ID: bin(N.swNote),
        RelativeMiddlePoint: at(340, 260), Size: size(130, 40),
        Caption: 'Nothing to sweep is not an error.' },
      { $Type: 'Microflows$InheritanceSplit', $ID: bin(N.swInherit),
        RelativeMiddlePoint: at(1000, 400), Size: size(90, 60),
        SplitVariableName: 'IteratorOrder' }
    ]) },
    // One flat edge list for the whole flow: a real .mpr keeps the edges
    // BETWEEN objects inside a loop here too, never on the loop itself
    // (measured: 407 loops in a real project, not one with its own Flows).
    Flows: marked(2, [
      edge(N.swStart, N.swRetrieve),
      edge(N.swRetrieve, N.swSplit),
      edge(N.swSplit, N.swLoop, { case: 'true' }),
      edge(N.swSplit, N.swMerge, { case: 'false', fromSide: 2, toSide: 0 }),
      edge(N.swChange, N.swCommit),
      edge(N.swLoop, N.swMerge),
      edge(N.swMerge, N.swDelete),
      edge(N.swDelete, N.swRest),
      edge(N.swRest, N.swAggregate),
      edge(N.swRest, N.swError, { error: true, fromSide: 2, toSide: 0 }),
      edge(N.swAggregate, N.swListOp),
      edge(N.swListOp, N.swWebService),
      edge(N.swWebService, N.swEnd),
      edge(N.swListOp, N.swMessage, { fromSide: 2, toSide: 0 }),
      edge(N.swAggregate, N.swImport, { fromSide: 2, toSide: 0 }),
      edge(N.swImport, N.swExport, { fromSide: 2, toSide: 0 }),
      edge(N.swInherit, N.swEnd, { inherit: 'Sales.Order' }),
      annotationEdge(N.swNote, N.swSplit)
    ])
  } },

  // Two folders deep, so a document's own path is more than one name long and
  // the slash inside the second folder's name is inside a real path.
  { unit: U.page, container: U.subFolder, containment: 'Documents', doc: {
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
