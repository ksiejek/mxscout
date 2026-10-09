/* MxScout — turns a decoded .mpr `Unit` table into the same canonical model
 * shape MxScout already consumes from an MxSonar JSON export (see
 * public/app.js's parseModelText). Ported from MxSonar's mprDirectSource.js
 * — same on-disk format, same $Type-shaped BSON documents — but reading via
 * MxSqlite/MxBson instead of `sql.js`/`bson`, and trimmed to the fields
 * MxScout's UI actually renders.
 *
 * WHAT IS READ, and what is deliberately not. The original port cut every
 * field MxScout's UI did not render; most of those have since been earned
 * back, because a question was asked that needed them:
 *   - `calledBy` — what reaches a flow no role can trigger (collectReferences)
 *   - `activity`, `entityRefs`, `javaActionCalls` — what a flow DOES, read
 *     from its own body before anybody presses Run (readFlowActivity)
 *   - `enumerations` — the values an enumeration attribute may hold
 *   - `security`, `moduleRoles` — the project's whole Security screen
 *   - `publishedServices`, `automation` — what the app exposes, and what runs
 *     on a timer with no user behind it
 *   - `folders`, `documents` — the project TREE: Studio Pro's own App
 *     Explorer, modules and the folders a team made inside them, and every
 *     document in them by name and kind, including the two dozen kinds
 *     MxScout models nothing else about
 * Still empty, and still on the shape only so an MxSonar export loads
 * unmodified: `constantRefs`, `enumerationRefs`, `xpathReferencedEntities`,
 * and the `javaActions` / `constants` lists. Nothing renders them.
 *
 * Two on-disk .mpr formats (see mprDirectSource.js's own comment for the
 * full story): v1 has a `Contents` BSON blob inline in the `Unit` table;
 * v2 doesn't have that column at all — each unit's body lives in its own
 * `mprcontents/<xx>/<yy>/<guid>.mxunit` file, `guid` being the UnitID
 * formatted as a Microsoft/.NET GUID string (first three groups byte-swapped
 * little-endian, last two left as-is). Both are handled by the ONE walk
 * below; only how `readContents` fetches a unit's bytes differs.
 *
 * Runs in a Worker (see mprWorker.js) — no DOM, no globals beyond what
 * MxSqlite/MxBson already require.
 */
(function (root) {
  'use strict';

  // ---------------- small byte/id helpers ----------------
  function hexOf(u8) {
    var s = '';
    for (var i = 0; i < u8.length; i++) s += u8[i].toString(16).padStart(2, '0');
    return s;
  }

  // A $ID / UnitID / ContainerID shows up in two different shapes here: a raw
  // Uint8Array straight off a SQLite BLOB column (UnitID, ContainerID), or a
  // BSON Binary value decoded by bson.js as {$binary, subtype} (an entity's
  // own $ID, an association's ParentPointer/ChildPointer, ...). Either way,
  // the hex string is what everything below keys its maps by.
  function idHex(v) {
    if (!v) return null;
    if (v instanceof Uint8Array) return hexOf(v);
    if (v.$binary instanceof Uint8Array) return hexOf(v.$binary);
    if (v.$oid instanceof Uint8Array) return hexOf(v.$oid);
    return null;
  }

  // Formats a 16-byte unit ID as the Microsoft/.NET-style GUID string a v2
  // mprcontents/ file name uses. NOT a plain big-endian hex dump: the first
  // three groups (Data1/Data2/Data3) are stored little-endian on disk and
  // must be byte-swapped; the last two groups (Data4) are stored as-is.
  // Verified against the reference Go implementation (mendixlabs/mxcli).
  function blobToGuid(bytes) {
    if (!bytes || bytes.length !== 16) return hexOf(bytes || new Uint8Array(0));
    var h = function (i) { return bytes[i].toString(16).padStart(2, '0'); };
    return h(3) + h(2) + h(1) + h(0) + '-' +
      h(5) + h(4) + '-' +
      h(7) + h(6) + '-' +
      h(8) + h(9) + '-' +
      h(10) + h(11) + h(12) + h(13) + h(14) + h(15);
  }

  // Mendix encodes most BSON arrays in a .mpr as [marker, item1, item2, ...],
  // where the leading element is a small integer (1-3) naming the array's
  // encoding kind — NOT a literal item count. Only strip it when arr[0]
  // really is one of those markers: unconditionally slicing the first
  // element silently emptied any array short enough that its one real item
  // wasn't preceded by a marker at all (a single-role AllowedModuleRoles
  // array, `["SomeRole"]`, used to come out as `[]`).
  function payload(arr) {
    if (!Array.isArray(arr)) return [];
    if (arr.length > 0 && typeof arr[0] === 'number' && Number.isInteger(arr[0]) && arr[0] >= 1 && arr[0] <= 3) {
      return arr.slice(1);
    }
    return arr;
  }

  function shortName(qualifiedName) {
    if (!qualifiedName) return qualifiedName;
    var idx = qualifiedName.lastIndexOf('.');
    return idx === -1 ? qualifiedName : qualifiedName.slice(idx + 1);
  }

  // A rule's DefaultMemberAccessRights covers its ASSOCIATIONS as much as its
  // attributes — in Studio Pro an association is a member of the entity like
  // any attribute is, and an access rule grants read or read+write on it the
  // same way. The attributes are expanded against the default while the rule
  // is read; the associations cannot be, because an association is only known
  // once every module has been read (a cross-module one is declared by the
  // module at the other end). So it happens here, over the finished model, and
  // only where the rule said nothing explicit about that association — an
  // explicit 'none' from MemberAccesses stands. Exported so it can be tested
  // on a plain model, without a .mpr.
  function applyAssociationDefaults(model) {
    var owned = new Map(); // owner qn -> [association name]
    (model.associations || []).forEach(function (a) {
      if (!a || !a.owner) return;
      var list = owned.get(a.owner);
      if (!list) { list = []; owned.set(a.owner, list); }
      list.push(a.name);
    });
    (model.entities || []).forEach(function (e) {
      var names = owned.get(e.qualifiedName);
      if (!names) return;
      (e.accessRules || []).forEach(function (rule) {
        if (!rule || !rule.defaultAccess) return;
        if (!rule.assocAccess) rule.assocAccess = {};
        names.forEach(function (n) {
          if (!Object.prototype.hasOwnProperty.call(rule.assocAccess, n)) rule.assocAccess[n] = rule.defaultAccess;
        });
      });
    });
    return model;
  }

  function accessRightsToLetter(rights) {
    if (rights === 'ReadWrite') return 'rw';
    if (rights === 'ReadOnly') return 'r';
    return null;
  }

  var TYPE_ALIASES = {
    autonumber: 'AutoNumber', boolean: 'Boolean', datetime: 'DateTime', decimal: 'Decimal',
    enum: 'Enum', float: 'Float', hashedstring: 'HashedString', integer: 'Integer',
    long: 'Long', string: 'String', binary: 'Binary'
  };
  function normalizeType(rawType) {
    if (!rawType) return 'Unknown';
    var key = String(rawType).replace(/^.*\$/, '').replace(/^.*\./, '').toLowerCase();
    return TYPE_ALIASES[key] || rawType;
  }

  function attributeTypeOf(raw) {
    var typeObj = raw && raw.NewType;
    if (!typeObj || !typeObj['$Type']) return { type: 'Unknown', length: null, enumerationQualifiedName: null };
    var short = String(typeObj['$Type']).replace(/^.*\$/, '').replace(/AttributeType$/, '');
    var length = typeof typeObj.Length === 'number' ? typeObj.Length : null;
    var enumRef = typeof typeObj.Enumeration === 'string' ? typeObj.Enumeration
      : (typeof typeObj.EnumerationQualifiedName === 'string' ? typeObj.EnumerationQualifiedName : null);
    return { type: normalizeType(short), length: length, enumerationQualifiedName: enumRef };
  }

  function resolveEntityRef(entityById, ref) {
    if (typeof ref === 'string' && ref) return ref;
    var hex = idHex(ref);
    if (hex && entityById.has(hex)) return entityById.get(hex).qn;
    return null;
  }

  function parameterTypeOf(entityById, typeObj) {
    if (!typeObj || typeof typeObj !== 'object') return { type: 'Unknown', entityQualifiedName: null, enumerationQualifiedName: null, isList: false };
    if (typeObj['$Type'] === 'DataTypes$ObjectType') {
      return { type: 'Object', entityQualifiedName: resolveEntityRef(entityById, typeObj.Entity), enumerationQualifiedName: null, isList: false };
    }
    // A "List of <Entity>" parameter — same .Entity reference convention as
    // ObjectType above, just carrying more than one object at run time.
    // mx.data.action's own applyto:'selection'/guids:[...] mechanism already
    // accepts more than one guid, so this only needs to be told apart from a
    // single Object parameter, not handled differently at the wire level.
    if (typeObj['$Type'] === 'DataTypes$ListType') {
      return { type: 'List', entityQualifiedName: resolveEntityRef(entityById, typeObj.Entity), enumerationQualifiedName: null, isList: true };
    }
    var short = String(typeObj['$Type'] || 'Unknown').replace(/^.*\$/, '').replace(/Type$/, '');
    var enumRef = typeObj['$Type'] === 'DataTypes$EnumerationType'
      ? (typeof typeObj.Enumeration === 'string' ? typeObj.Enumeration
        : (typeof typeObj.EnumerationQualifiedName === 'string' ? typeObj.EnumerationQualifiedName : null))
      : null;
    return { type: short || 'Unknown', entityQualifiedName: null, enumerationQualifiedName: enumRef, isList: false };
  }

  function parseOneParameter(entityById, p) {
    if (!p || typeof p.Name !== 'string') return null;
    if (typeof p.Entity !== 'undefined' && !p.VariableType && !p.ParameterType) {
      return { name: p.Name, type: 'Object', entityQualifiedName: resolveEntityRef(entityById, p.Entity), enumerationQualifiedName: null, isList: false };
    }
    var described = parameterTypeOf(entityById, p.VariableType || p.ParameterType);
    return { name: p.Name, type: described.type, entityQualifiedName: described.entityQualifiedName, enumerationQualifiedName: described.enumerationQualifiedName, isList: described.isList };
  }

  function extractParameters(entityById, raw) {
    var list = null;
    if (raw.MicroflowParameterCollection && payload(raw.MicroflowParameterCollection.Parameters).length) {
      list = payload(raw.MicroflowParameterCollection.Parameters);
    } else if (Array.isArray(raw.MicroflowParameters) && payload(raw.MicroflowParameters).length) {
      list = payload(raw.MicroflowParameters);
    } else if (Array.isArray(raw.Parameters) && payload(raw.Parameters).length) {
      list = payload(raw.Parameters);
    } else if (raw.ObjectCollection) {
      var objs = payload(raw.ObjectCollection.Objects);
      var params = Array.isArray(objs) ? objs.filter(function (o) { return o && o['$Type'] === 'Microflows$MicroflowParameter'; }) : [];
      if (params.length) list = params;
    }
    if (!list) return [];
    return list.map(function (p) { return parseOneParameter(entityById, p); }).filter(Boolean);
  }

  // ---------------- empty model shape ----------------
  // Same shape as MxSonar's canonicalModel.js — the javaActions/constants/
  // enumerations/*Refs/calledBy fields stay present but always empty here
  // (see the file header comment for why).
  function emptyModel() {
    return {
      meta: { source: 'mpr', generatedAt: new Date().toISOString(), appName: null, mendixVersion: null },
      modules: [], entities: [], associations: [], userRoles: [], moduleRoles: [],
      microflows: [], nanoflows: [], pages: [],
      // What a snippet's widgets read, so a page that places one reads it
      // too (see readPageData). Nothing else about a snippet is modelled.
      snippets: [],
      javaActions: [], constants: [], enumerations: [],
      publishedServices: [], automation: [],
      // The project tree. `folders` carries the empty ones too, which is not
      // pedantry: in four measured projects 14 to 34 folders hold no document
      // at all, and they are named `#v1.0.0`, `_Version 11.1.0`,
      // `__Excel Importer 11.1.0` — a team's way of writing down which
      // version of a Marketplace module it took. Dropping them would delete
      // the only note somebody left.
      folders: [], documents: [],
      security: null
    };
  }

  // A Mendix property left at its default value is NOT written to the .mpr at
  // all, so an absent field says "nobody touched this", not "false". Reading
  // it as the default Mendix itself applies gives the same answer the running
  // app does; reading it as `!!doc.Thing` silently turns every unset default
  // into false. Only used where the Mendix default is actually known.
  function bool(doc, key, mendixDefault) {
    var v = doc ? doc[key] : undefined;
    return typeof v === 'boolean' ? v : mendixDefault;
  }
  function str(doc, key) {
    var v = doc ? doc[key] : undefined;
    return typeof v === 'string' && v ? v : null;
  }

  // A view entity is an entity whose rows are whatever an OQL query returns,
  // computed when they are asked for and never stored — so the runtime serves
  // it read-only. Karol asked 2026-09-18 whether MxScout tells one apart; it
  // did not, and read it as an ordinary entity with a table behind it.
  //
  // The shape is from the Mendix metamodel's own names, NOT from a real
  // project: none of the five on this machine has a view entity (checked).
  // The entity carries `Source: { $Type: 'DomainModels$OqlViewEntitySource',
  // SourceDocument: '<Module.Name>' }`, and the query lives in that separate
  // document, a DomainModels$ViewEntitySourceDocument. Mendix 10 also kept a
  // copy inline on the source as `Oql`; Mendix 11 dropped it. Both are read,
  // and the match is on "ViewEntitySource" in the type rather than on the
  // whole name, so a renamed variant is still recognised as a view rather
  // than silently read as a table. Anything this cannot find stays null and
  // the UI says so instead of guessing.
  function viewEntitySourceOf(raw) {
    var src = raw && raw.Source;
    if (!src || typeof src !== 'object' || !/ViewEntitySource/.test(String(src['$Type'] || ''))) return null;
    return { sourceDocument: str(src, 'SourceDocument'), oql: oqlOf(src) };
  }
  function oqlOf(doc) {
    var direct = str(doc, 'Oql');
    if (direct) return direct;
    var key = Object.keys(doc || {}).filter(function (k) { return /^oql$/i.test(k) && typeof doc[k] === 'string' && doc[k]; })[0];
    return key ? doc[key] : null;
  }

  // A short list of passwords that need no cracking. Not a dictionary — the
  // point is not coverage, it is that "the administrator password is one of
  // these" is a different finding from "the administrator password is short".
  var COMMON_PASSWORDS = [
    '1', '12', '123', '1234', '12345', '123456', '1234567', '12345678', '123456789',
    'password', 'password1', 'passw0rd', 'welcome', 'welcome1', 'admin', 'admin1',
    'administrator', 'letmein', 'qwerty', 'test', 'test123', 'demo', 'mendix',
    'changeme', 'secret', 'root', 'abc123', 'iloveyou', 'monkey', 'dragon'
  ];

  // What MxScout concluded about a password — never the password.
  //
  // It is read here, in the Worker, and judged here, and only the judgement
  // travels on: whether it is set, what it fails, and its LENGTH but only
  // when something already failed, because at that point the length is the
  // finding ("one character") rather than a hint about a password worth
  // keeping quiet. A password that passes leaves nothing behind but "set".
  //
  // The policy it is judged against is the project's OWN, off the same
  // document. That comparison is the useful one: an app that demands twelve
  // characters of its users and gives its administrator account one is
  // saying something about itself that no external standard would catch.
  function judgePassword(value, policy, userName) {
    if (typeof value !== 'string' || value === '') return null; // not set at all
    var fails = [];
    if (policy) {
      if (typeof policy.minimumLength === 'number' && value.length < policy.minimumLength) {
        fails.push('shorter than the ' + policy.minimumLength + ' characters this project requires');
      }
      if (policy.requireDigit && !/[0-9]/.test(value)) fails.push('no digit, which this project requires');
      if (policy.requireMixedCase && !(/[a-z]/.test(value) && /[A-Z]/.test(value))) fails.push('not mixed case, which this project requires');
      if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(value)) fails.push('no symbol, which this project requires');
    }
    var common = COMMON_PASSWORDS.indexOf(value.toLowerCase()) !== -1;
    var sameAsUserName = !!userName && value.toLowerCase() === String(userName).toLowerCase();
    var anyProblem = fails.length > 0 || common || sameAsUserName;
    return {
      set: true,
      // Only alongside a problem, where the number IS the finding.
      length: anyProblem ? value.length : null,
      failsPolicy: fails,
      common: common,
      sameAsUserName: sameAsUserName
    };
  }

  // The rest of the project's Security screen, the part that decides whether
  // everything else MxScout shows about roles is enforced at run time at all.
  //
  // SECRETS ARE JUDGED, NEVER CARRIED. The admin password and every demo
  // user's password sit in this document in plain text. MxScout reads them
  // here, in the Worker, long enough to work out whether they are weak — and
  // then keeps the verdict and drops the value. Nothing downstream ever holds
  // one: not this browser's database, not a .mxscout package, not a printed
  // report. What survives is the part worth having, which is that the
  // administrator account of an app demanding twelve characters has one.
  // Deliberate, Karol's call, and the About page says it in these terms.
  function readProjectSecurity(doc) {
    var policyDoc = doc.PasswordPolicySettings;
    // Read first, so every password below is judged against this project's
    // own rules rather than against nothing.
    var policy = policyDoc && typeof policyDoc === 'object' ? {
      minimumLength: typeof policyDoc.MinimumLength === 'number' ? policyDoc.MinimumLength : null,
      requireDigit: bool(policyDoc, 'RequireDigit', false),
      requireMixedCase: bool(policyDoc, 'RequireMixedCase', false),
      requireSymbol: bool(policyDoc, 'RequireSymbol', false)
    } : null;
    return {
      // Off / Prototype / Production on the Security screen. Absent means the
      // project did not record one rather than "none" — every real project
      // measured writes it, but guessing a default here would be guessing
      // about the one field that governs the truth of everything else.
      level: str(doc, 'SecurityLevel'),
      checkSecurity: bool(doc, 'CheckSecurity', null),
      strictMode: bool(doc, 'StrictMode', null),
      strictPageUrlCheck: bool(doc, 'StrictPageUrlCheck', null),
      guestAccess: bool(doc, 'EnableGuestAccess', false),
      guestUserRole: str(doc, 'GuestUserRole'),
      demoUsersEnabled: bool(doc, 'EnableDemoUsers', false),
      demoUsers: payload(doc.DemoUsers).filter(function (u) { return u && u.UserName; }).map(function (u) {
        return {
          userName: String(u.UserName),
          userRoles: payload(u.UserRoles).filter(function (r) { return typeof r === 'string'; }),
          password: judgePassword(u.Password, policy, u.UserName)
        };
      }),
      adminUserName: str(doc, 'AdminUserName'),
      adminUserRole: str(doc, 'AdminUserRole'),
      adminPassword: judgePassword(doc.AdminPassword, policy, doc.AdminUserName),
      passwordPolicy: policy
    };
  }

  // ---------------- what a flow DOES ----------------
  // MxScout is the one tool here that actually SETS A FLOW OFF — in the
  // tester's own session, against a real test environment, with their real
  // rights. Until this existed the Run tab could say who may trigger a flow
  // and what it takes, and nothing at all about what happens when you press
  // the button. "This one deletes objects" belongs in front of somebody
  // BEFORE they press it, not in the log afterwards.
  //
  // Every fact below comes out of the flow document MxScout already decodes,
  // in one more walk over an object it already holds: Objects[] is the flow's
  // activities, an ActionActivity wraps one Action, and a LoopedActivity
  // carries an Objects[] of its own — which is why this recurses, and why it
  // counts what happens INSIDE a loop separately. A retrieve or a commit in a
  // loop is one database round trip per row at run time, and that is the
  // cheapest performance problem in Mendix to spot and the most common.
  //
  // References are by NAME: a microflow call names "Module.Flow", a Java
  // action call names "Module.Action", a page open names "Module.Page". Only
  // an association-based retrieve uses an id, which is why buildModel passes
  // in a lookup for those.
  function emptyActivity() {
    return {
      count: 0, loops: 0,
      reads: [], creates: [], changes: [], deletes: [], commits: [],
      // One entry per retrieve, in order: what it reads, and HOW — over an
      // association from an object already in hand, or from the database with
      // or without an XPath. `reads` above answers "what does this touch";
      // this answers "how much of it could this ask for", which is what an
      // access rule has to be measured against (see accessuse.js).
      retrieves: [],
      commitCount: 0, deleteCount: 0, rollbackCount: 0,
      calls: [], javaActions: [], jsActions: [],
      restCalls: 0, opensPages: [], messages: 0, validations: 0, logs: 0,
      inLoop: { reads: 0, creates: 0, changes: 0, deletes: 0, commits: 0 }
    };
  }

  function entityOfChangeItems(items) {
    // A change item names its target as "Module.Entity.Member", which makes
    // the entity readable straight off the item even though the action itself
    // only knows the variable it is changing.
    var found = null;
    payload(items).forEach(function (item) {
      if (found || !item) return;
      var name = typeof item.Attribute === 'string' && item.Attribute ? item.Attribute
        : (typeof item.Association === 'string' ? item.Association : '');
      var parts = String(name).split('.');
      if (parts.length >= 3) found = parts[0] + '.' + parts[1];
    });
    return found;
  }

  function readFlowActivity(raw, ctx) {
    var out = emptyActivity();
    var collection = raw && raw.ObjectCollection;
    if (!collection) return null; // a document with no body to read, not an empty one

    // variable name -> entity qualified name, so a delete or a commit that
    // only names a variable can still say WHAT it deletes or commits.
    var varEntity = {};
    (ctx.parameters || []).forEach(function (p) {
      if (p && p.name && p.entityQualifiedName) varEntity[p.name] = p.entityQualifiedName;
    });

    function add(list, value) {
      if (value && list.indexOf(value) === -1) list.push(value);
    }
    function entityOfVar(name) {
      return (typeof name === 'string' && varEntity[name]) || null;
    }

    function walk(objects, inLoop) {
      payload(objects).forEach(function (obj) {
        if (!obj || typeof obj !== 'object') return;

        if (obj['$Type'] === 'Microflows$LoopedActivity') {
          out.loops++;
          if (obj.ObjectCollection) walk(obj.ObjectCollection.Objects, true);
          return;
        }
        var action = obj.Action;
        if (!action || typeof action !== 'object') return;
        out.count++;
        var type = action['$Type'];

        if (type === 'Microflows$RetrieveAction') {
          var source = action.RetrieveSource || {};
          var entity = null;
          if (typeof source.Entity === 'string') {
            entity = source.Entity;
          } else if (typeof source.AssociationId === 'string' && source.AssociationId) {
            // `AssociationId` is a misleading name: it holds the association's
            // QUALIFIED NAME, not an id. Measured on every project here —
            // 3109 association retrieves across a Mendix 9 project and two
            // Mendix 11 ones, every single one a string like
            // "Sales.Order_Customer". Until 2026-10-01 this looked the
            // association up by id and so never found one: on Helpdesk, 310
            // flows retrieve ONLY over associations and 309 of them reported
            // reading nothing at all. The fixture hid it, because its
            // association carried no $ID and an id-keyed map therefore had a
            // null key that a lookup with a null key found.
            //
            // Which END the retrieve lands on depends on where it started, so
            // it resolves through the association and picks the end that is
            // not where it came from, when that is known.
            var assoc = ctx.associationByName.get(source.AssociationId);
            if (assoc) {
              var from = entityOfVar(source.StartVariableName);
              entity = (from && assoc.owner === from) ? assoc.other
                : (from && assoc.other === from) ? assoc.owner
                : assoc.other;
            }
          }
          if (entity) {
            add(out.reads, entity);
            if (action.ResultVariableName) varEntity[action.ResultVariableName] = entity;
            // A flow body spells it "XpathConstraint", a page "XPathConstraint".
            var flowXpath = typeof source.XpathConstraint === 'string' ? source.XpathConstraint.trim() : '';
            out.retrieves.push({
              entity: entity,
              over: typeof source.Entity === 'string' ? 'database' : 'association',
              xpath: flowXpath || null
            });
          }
          if (inLoop) out.inLoop.reads++;
          return;
        }

        if (type === 'Microflows$CreateChangeAction' || type === 'Microflows$CreateListAction') {
          var created = typeof action.Entity === 'string' ? action.Entity : null;
          if (created) {
            add(out.creates, created);
            if (action.VariableName) varEntity[action.VariableName] = created;
          }
          if (inLoop) out.inLoop.creates++;
          // "Create object … commit: Yes" is a write to the database in one
          // activity. Counting only the separate Commit activity would miss
          // the most common way a Mendix flow writes anything at all.
          if (action.Commit && action.Commit !== 'No') {
            out.commitCount++;
            add(out.commits, created);
            if (inLoop) out.inLoop.commits++;
          }
          return;
        }

        if (type === 'Microflows$ChangeAction') {
          var changed = entityOfChangeItems(action.Items) || entityOfVar(action.ChangeVariableName);
          add(out.changes, changed);
          if (changed && action.ChangeVariableName) varEntity[action.ChangeVariableName] = changed;
          if (inLoop) out.inLoop.changes++;
          // Committing straight from the change action is the same write as a
          // separate commit activity and has to count as one.
          if (action.Commit && action.Commit !== 'No') {
            out.commitCount++;
            add(out.commits, changed);
            if (inLoop) out.inLoop.commits++;
          }
          return;
        }

        if (type === 'Microflows$CommitAction') {
          out.commitCount++;
          add(out.commits, entityOfVar(action.CommitVariableName));
          if (inLoop) out.inLoop.commits++;
          return;
        }
        if (type === 'Microflows$DeleteAction') {
          out.deleteCount++;
          add(out.deletes, entityOfVar(action.DeleteVariableName));
          if (inLoop) out.inLoop.deletes++;
          return;
        }
        if (type === 'Microflows$RollbackAction') { out.rollbackCount++; return; }

        if (type === 'Microflows$MicroflowCallAction') {
          var call = action.MicroflowCall || {};
          add(out.calls, typeof call.Microflow === 'string' ? call.Microflow : null);
          return;
        }
        if (type === 'Microflows$NanoflowCallAction') {
          // One level down, inside NanoflowCall — exactly like a microflow
          // call above it, and NOT on the action itself. Read from the action
          // until 2026-10-01, which meant every nanoflow call was missed:
          // 212 of them on Helpdesk, none in any flow's call list.
          var nanoCall = action.NanoflowCall || {};
          add(out.calls, typeof nanoCall.Nanoflow === 'string' ? nanoCall.Nanoflow : null);
          return;
        }
        if (type === 'Microflows$JavaActionCallAction') {
          add(out.javaActions, typeof action.JavaAction === 'string' ? action.JavaAction : null);
          return;
        }
        if (type === 'Microflows$JavaScriptActionCallAction') {
          add(out.jsActions, typeof action.JavaScriptAction === 'string' ? action.JavaScriptAction : null);
          return;
        }
        if (type === 'Microflows$RestCallAction') { out.restCalls++; return; }
        if (type === 'Microflows$ShowFormAction') {
          var settings = action.FormSettings || {};
          add(out.opensPages, typeof settings.Form === 'string' ? settings.Form : null);
          return;
        }
        if (type === 'Microflows$ShowMessageAction') { out.messages++; return; }
        if (type === 'Microflows$ValidationFeedbackAction') { out.validations++; return; }
        if (type === 'Microflows$LogMessageAction') { out.logs++; return; }
      });
    }

    walk(collection.Objects, false);
    [out.reads, out.creates, out.changes, out.deletes, out.commits,
      out.calls, out.javaActions, out.jsActions, out.opensPages].forEach(function (list) { list.sort(); });
    return out;
  }

  // ---------------- what a page READS ----------------
  // Every widget that shows data names where the data comes from, and that is
  // the whole question an access rule has to be measured against: a list that
  // reads every row of an entity straight from the database needs a rule that
  // allows every row, while a list over an association, with an XPath, or
  // handed over by a microflow sees only part of the table, whatever the
  // rule allows. The page is not what enforces that (the rule is), which is
  // exactly why the difference is worth seeing.
  //
  // MEASURED on Helpdesk (Mendix 11), pages and snippets together: 555 data
  // views, 481 pluggable widgets with an XPath source (Data grid 2 and its
  // kin), 98 microflow sources, 89 association sources, 70 list views with an
  // XPath source, 46 listen-to-widget sources, 29 image viewers, 15 nanoflow
  // sources. A Mendix 9 data grid's source ends in "XPathSource" or
  // "DatabaseSource" as well, which is why the test is the suffix.
  //
  // Read in one walk over the document, so it costs what reading the page
  // already cost. References are by NAME everywhere on a page, never by id.
  var PAGE_DATABASE_SOURCE = /(XPathSource|DatabaseSource)$/;
  var PAGE_CONTEXT_SOURCE = {
    'Forms$AssociationSource': true, 'Forms$DataViewSource': true, 'Forms$ImageViewerSource': true
  };
  // An entity reference is either the entity itself, or a path of
  // association steps from the object in context, ending on the entity.
  function pageEntityRef(ref) {
    if (!ref || typeof ref !== 'object') return null;
    if (typeof ref.Entity === 'string' && ref.Entity) return { entity: ref.Entity, path: [] };
    var steps = payload(ref.Steps).filter(function (st) { return st && typeof st.DestinationEntity === 'string'; });
    if (!steps.length) return null;
    return {
      entity: steps[steps.length - 1].DestinationEntity,
      path: steps.map(function (st) { return typeof st.Association === 'string' ? st.Association : null; }).filter(Boolean)
    };
  }
  function readPageData(raw, ctx) {
    var out = { dataSources: [], snippets: [], flowRefs: [], mentions: [] };
    function add(list, value) {
      if (value && list.indexOf(value) === -1) list.push(value);
    }
    function mention(name) {
      if (typeof name === 'string' && ctx.entityNames.has(name)) add(out.mentions, name);
    }
    // An XPath names entities as Module.Entity tokens among association and
    // attribute names; only the ones that ARE entities are kept.
    function mentionText(text) {
      if (typeof text !== 'string' || text.indexOf('.') === -1) return;
      var re = /([A-Za-z_]\w*)\.([A-Za-z_]\w*)/g, m;
      while ((m = re.exec(text))) mention(m[1] + '.' + m[2]);
    }
    function xpathOf(node) {
      var x = typeof node.XPathConstraint === 'string' ? node.XPathConstraint.trim() : '';
      return x || null;
    }
    function walk(node, widget, depth) {
      if (!node || typeof node !== 'object' || depth > 400) return;
      if (Array.isArray(node)) {
        for (var i = 0; i < node.length; i++) walk(node[i], widget, depth + 1);
        return;
      }
      var type = node['$Type'];
      // The nearest named widget, so a finding can say WHICH list it means.
      if (node !== raw && typeof node.Name === 'string' && node.Name) widget = node.Name;
      var source = null;
      if (typeof type === 'string') {
        if (PAGE_DATABASE_SOURCE.test(type)) {
          var dbRef = pageEntityRef(node.EntityRef);
          // A database source with a path is constrained by the object in
          // context: it reads that object's rows, not the table.
          if (dbRef) source = { kind: dbRef.path.length ? 'association' : 'database', entity: dbRef.entity, path: dbRef.path, xpath: xpathOf(node) };
        } else if (PAGE_CONTEXT_SOURCE[type]) {
          var ctxRef = pageEntityRef(node.EntityRef);
          if (ctxRef) source = { kind: ctxRef.path.length ? 'association' : 'context', entity: ctxRef.entity, path: ctxRef.path, xpath: null };
        } else if (type === 'Forms$MicroflowSource') {
          var settings = node.MicroflowSettings || {};
          if (typeof settings.Microflow === 'string' && settings.Microflow) source = { kind: 'microflow', flow: settings.Microflow };
        } else if (type === 'Forms$NanoflowSource') {
          if (typeof node.Nanoflow === 'string' && node.Nanoflow) source = { kind: 'nanoflow', flow: node.Nanoflow };
        } else if (type === 'Forms$SnippetCall') {
          add(out.snippets, typeof node.Form === 'string' ? node.Form : null);
        }
      }
      if (source) {
        source.widget = widget || null;
        out.dataSources.push(source);
        if (source.entity) mention(source.entity);
      }
      for (var key in node) {
        var value = node[key];
        if (typeof value === 'string') {
          // A button, an event or a data source naming a flow: what this page
          // can set off, for whoever may open it.
          if ((key === 'Microflow' || key === 'Nanoflow') && value) add(out.flowRefs, value);
          else if (key === 'Entity' || key === 'DestinationEntity') mention(value);
          else if (key === 'Attribute') mention(value.split('.').slice(0, 2).join('.'));
          else if (key === 'XPathConstraint') mentionText(value);
        } else if (value && typeof value === 'object') {
          walk(value, widget, depth + 1);
        }
      }
    }
    walk(raw, null, 0);
    out.snippets.sort(); out.flowRefs.sort(); out.mentions.sort();
    return out;
  }

  // ---------------- what a flow LOOKS LIKE ----------------
  // Studio Pro keeps the drawing in the .mpr, so this reads a picture rather
  // than making one. Measured on a real Mendix 11 project (Helpdesk, 1844
  // flows): every one of 22 562 objects carries `RelativeMiddlePoint` and
  // `Size` — 100 %, no exceptions — and all 18 462 edges carry both endpoints,
  // the sides they leave and enter by, their branch value and their bezier
  // control vectors. Nothing here needs laying out.
  //
  // Deliberately a SEPARATE reader from readFlowActivity above. That one
  // answers "what will this do if I press Run": a summary, with an allowlist
  // of the action types it understands, feeding a verdict a person reads
  // before pressing a button. This one answers "what does this look like" and
  // has NO allowlist — an activity node carries whatever action type the file
  // names. That is why the thirteen action types the summary has never
  // recognised (Aggregate, ListOperations, CallWebService, Cast, …) need no
  // entry here, and why a Mendix release that adds a fourteenth will draw it
  // without a code change. Keeping both is the point: a drawing may show
  // something it cannot judge, a verdict may not.
  //
  // Three things measured rather than assumed, because each one would have
  // been guessed wrong:
  //   - A point is the MIDDLE of the object, and inside a loop it is relative
  //     to the loop, not to the canvas. Hence `parentId` and no shifting.
  //   - A LoopedActivity has no edge list of its own: the edges BETWEEN
  //     objects inside it live in the flow's single top-level `Flows` array
  //     (407 loops checked, not one with its own). So this keeps one flat
  //     node list and one flat edge list, exactly as the file does.
  //   - An edge carries 0 or exactly 1 case value, never more (18 462
  //     checked), so `caseValue` is singular.
  var NODE_KINDS = {
    'Microflows$StartEvent': 'start',
    'Microflows$EndEvent': 'end',
    'Microflows$ErrorEvent': 'errorEvent',
    'Microflows$BreakEvent': 'break',
    'Microflows$ContinueEvent': 'continue',
    'Microflows$ActionActivity': 'activity',
    'Microflows$ExclusiveSplit': 'decision',
    'Microflows$InheritanceSplit': 'objectTypeDecision',
    'Microflows$ExclusiveMerge': 'merge',
    'Microflows$LoopedActivity': 'loop',
    'Microflows$Annotation': 'annotation',
    'Microflows$MicroflowParameter': 'parameter'
  };

  // An object type with no entry above keeps its own short name (PascalCase,
  // where every known kind is lowerCamel, so the two can never be confused).
  // A node MxScout cannot name is still a node that was there; dropping it
  // would silently cut a hole in somebody's diagram.
  function nodeKindOf(type) {
    return NODE_KINDS[type] || String(type || '').replace(/^.*\$/, '') || 'unknown';
  }

  // Mendix writes a point and a size as "x;y". Both are plain numbers and both
  // can be negative — a flow's own start sits left of zero often enough.
  function point(s) {
    if (typeof s !== 'string') return null;
    var parts = s.split(';');
    if (parts.length !== 2) return null;
    var x = Number(parts[0]), y = Number(parts[1]);
    return (isFinite(x) && isFinite(y)) ? { x: x, y: y } : null;
  }
  // A flow's return type as a person reads it. The type names are Mendix's own
  // (DataTypes$BooleanType → "Boolean"); only the ones that carry a target say more.
  function dataTypeText(t) {
    if (!t || typeof t !== 'object') return null;
    var k = String(t['$Type'] || '').replace(/^.*\$/, '').replace(/Type$/, '');
    if (!k) return null;
    if (k === 'Void') return 'Nothing';
    if (k === 'Object') return str(t, 'Entity') || 'Object';
    if (k === 'List') return 'List of ' + (str(t, 'Entity') || 'objects');
    if (k === 'Enumeration') return str(t, 'Enumeration') ? 'Enumeration ' + str(t, 'Enumeration') : 'Enumeration';
    return k;
  }
  function sizeFrom(s) {
    var p = point(s);
    return p ? { width: p.x, height: p.y } : null;
  }

  // The caption a person TYPED, and never the one Studio Pro generates. On a
  // real project 9988 of 10 332 activities leave `AutoGenerateCaption` at
  // true, and the `Caption` stored beside it is a dead placeholder — the word
  // "Activity" 9895 times. Passing that through would label 96 % of the cards
  // in a drawing with a word that means nothing. Generating the caption Studio
  // Pro shows is a job of its own (step 70b); until it exists, a node with no
  // authored caption says so with null, which is the truth.
  //
  // The flag only ever appears on an ActionActivity (checked: 10 332 of 10 332
  // carry it, nothing else does). Every other shape's `Caption` is authored —
  // a decision's label, an annotation's whole text — so it is kept as read.
  function nodeCaptionOf(obj, kind) {
    if (kind === 'parameter') return typeof obj.Name === 'string' && obj.Name ? obj.Name : null;
    if (kind === 'activity') {
      return obj.AutoGenerateCaption === false && typeof obj.Caption === 'string' && obj.Caption
        ? obj.Caption : null;
    }
    return typeof obj.Caption === 'string' && obj.Caption ? obj.Caption : null;
  }

  // A loop runs over a list or until a condition stops being true. Both shapes
  // name their parts differently, and a drawing needs the names: an empty box
  // says "loop" and nothing about what it loops over.
  function loopSourceOf(obj) {
    var src = obj.LoopSource;
    if (!src || typeof src !== 'object') return null;
    if (src['$Type'] === 'Microflows$WhileLoopCondition') {
      return {
        mode: 'while', listVariable: null, iteratorVariable: null,
        condition: str(src, 'WhileExpression')
      };
    }
    return {
      mode: 'list',
      listVariable: str(src, 'ListVariableName'),
      iteratorVariable: str(src, 'VariableName'),
      condition: null
    };
  }

  // ---------------- the readable label on a node ----------------
  // The .mpr does NOT store the text a drawing needs. 9988 of 10 332
  // activities in a real project leave AutoGenerateCaption at true, and the
  // Caption beside it is a dead placeholder — the word "Activity" 9895 times.
  // So the words have to be built out of the action's own fields.
  //
  // This is MxScout's rendering of an activity, in the VOCABULARY of Studio
  // Pro's toolbox. It is NOT a byte-for-byte copy of what Studio Pro draws:
  // that generator is not published and there is no Studio Pro here to check
  // against, so claiming to reproduce it would be a claim nothing backs.
  //
  // Three slots, the shape a card has room for:
  //   kicker — what kind of activity this is ("Retrieve from database")
  //   title  — WHAT it acts on or points at (an entity, a variable, a called
  //            document), or the caption a person typed, which always wins
  //   meta   — HOW: the XPath, the expression, the value, where the answer goes
  // plus `ref`, the one qualified name the activity names, so a drawing can
  // link through to it instead of re-parsing the title.
  //
  // The table below is per action type and therefore IS an allowlist — the
  // only one in the graph reader, and unavoidable: a label needs to know what
  // the fields mean. The fallback keeps 70a's property anyway: an action type
  // with no entry is split into words from its own name, so a Mendix release
  // that adds one is drawn with readable text rather than blank.
  var ACTIVITY_KICKERS = {
    CreateChangeAction: 'Create object',
    CreateListAction: 'Create list',
    ChangeAction: 'Change object',
    ChangeListAction: 'Change list',
    ChangeVariableAction: 'Change variable',
    CreateVariableAction: 'Create variable',
    CommitAction: 'Commit object(s)',
    DeleteAction: 'Delete object(s)',
    RollbackAction: 'Rollback object',
    CastAction: 'Cast object',
    AggregateAction: 'Aggregate list',
    ListOperationsAction: 'List operation',
    MicroflowCallAction: 'Call microflow',
    NanoflowCallAction: 'Call nanoflow',
    JavaActionCallAction: 'Call Java action',
    JavaScriptActionCallAction: 'Call JavaScript action',
    ShowFormAction: 'Show page',
    CloseFormAction: 'Close page',
    ShowHomePageAction: 'Show home page',
    ShowMessageAction: 'Show message',
    ValidationFeedbackAction: 'Validation feedback',
    LogMessageAction: 'Log message',
    RestCallAction: 'Call REST service',
    CallWebServiceAction: 'Call web service',
    CallExternalAction: 'Call external action',
    DownloadFileAction: 'Download file',
    ImportXmlAction: 'Import with mapping',
    ExportXmlAction: 'Export with mapping',
    IncrementCounterMeterAction: 'Increment counter',
    SynchronizeAction: 'Synchronize',
    SendEmailAction: 'Send email'
  };

  // "CallMlModelAction" -> "Call ml model". Not clever about acronyms on
  // purpose: a wrong expansion reads worse than a plain one.
  function activityKicker(actionType) {
    var name = String(actionType || '').replace(/^.*\$/, '').replace(/Action$/, '');
    if (!name) return null;
    if (ACTIVITY_KICKERS[name + 'Action']) return ACTIVITY_KICKERS[name + 'Action'];
    var words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
  }

  // A variable as Mendix writes it everywhere a person reads it.
  function varRef(name) {
    return typeof name === 'string' && name ? '$' + name : null;
  }
  // Anything long enough to hold a newline goes in a slot one line high, so
  // runs of whitespace collapse. The text is never cut: what it says is the
  // author's, how wide it is belongs to whoever draws it.
  function oneLine(value) {
    if (typeof value !== 'string' || !value) return null;
    var flat = value.replace(/\s+/g, ' ').trim();
    return flat || null;
  }
  function joinMeta(parts) {
    var kept = parts.filter(function (p) { return typeof p === 'string' && p; });
    return kept.length ? kept.join(', ') : null;
  }

  // The words in a Template / MessageTemplate / FeedbackTemplate. Two shapes:
  // a TextTemplate keeps a Texts$Text (one string per language, so captionOf
  // picks one), a StringTemplate keeps a plain string with {1}-style slots.
  // The slots are filled from the template's OWN parameter expressions: a
  // card reading "{1}" or "{1}\n{2}" says nothing, and the expression that
  // goes there is one field away. Measured shapes: a log message really is
  // stored as "{1}\n{2}", and a REST address as "{1}/rest/getshipment/{2}".
  function templateText(template) {
    if (!template || typeof template !== 'object') return null;
    var text = template.Text;
    var flat = typeof text === 'string' ? oneLine(text)
      : (text && typeof text === 'object' ? oneLine(captionOf(text)) : null);
    if (!flat) return null;
    var params = payload(template.Parameters);
    if (!params.length) return flat;
    return flat.replace(/\{(\d+)\}/g, function (whole, digits) {
      var param = params[Number(digits) - 1];
      var expression = param && typeof param.Expression === 'string' ? oneLine(param.Expression) : null;
      return expression || whole;
    });
  }

  // A mapping-based activity is identified by its MAPPING — the document
  // variable it reads or writes is a detail beside it.
  // Two real shapes, one per direction: an export keeps MappingId one level
  // down, an import keeps ReturnValueMapping two levels down inside
  // ImportMappingCall. Both measured; neither can stand in for the other.
  function mappingOf(handling) {
    if (!handling || typeof handling !== 'object') return null;
    var direct = str(handling, 'MappingId');
    if (direct) return direct;
    var call = handling.ImportMappingCall;
    return call && typeof call === 'object' ? str(call, 'ReturnValueMapping') : null;
  }

  // What a Change activity touches, by member name: "Number" rather than
  // "Sales.Order.Number", because the entity is already the title's business.
  function changedMembers(items) {
    var names = [];
    payload(items).forEach(function (item) {
      if (!item) return;
      var ref = typeof item.Attribute === 'string' && item.Attribute ? item.Attribute
        : (typeof item.Association === 'string' ? item.Association : '');
      var name = shortName(String(ref));
      if (name && names.indexOf(name) === -1) names.push(name);
    });
    return names.length ? names.join(', ') : null;
  }

  // WHAT DATA an activity works with, row by row: the members a create or
  // change sets and the value each one gets, or the arguments a call passes.
  // The card's `meta` can only say which members; a reader asking "how was
  // this object made" needs the values too, and they are one field away.
  // Measured shapes: a member is a Microflows$ChangeActionItem with Attribute
  // OR Association (the other empty), Type Set/Add/Remove and Value; a call's
  // argument is a ...ParameterMapping with Parameter (qualified, ending in the
  // parameter's name) and Argument — except a Java action's, which keeps it
  // one level down in Value.Argument.
  function memberRows(items) {
    var rows = [];
    payload(items).forEach(function (item) {
      if (!item || typeof item !== 'object') return;
      var member = str(item, 'Attribute') || str(item, 'Association');
      if (!member) return;
      rows.push({
        name: shortName(member),
        value: oneLine(item.Value) || '',
        op: str(item, 'Type') || 'Set',
        association: !str(item, 'Attribute')
      });
    });
    return rows.length ? rows : null;
  }
  function argumentRows(mappings) {
    var rows = [];
    payload(mappings).forEach(function (m) {
      if (!m || typeof m !== 'object') return;
      var param = str(m, 'Parameter');
      if (!param) return;
      var value = typeof m.Argument === 'string' ? m.Argument
        : (m.Value && typeof m.Value === 'object' && typeof m.Value.Argument === 'string' ? m.Value.Argument : '');
      rows.push({ name: shortName(param), value: oneLine(value) || '' });
    });
    return rows.length ? rows : null;
  }
  function activityFields(action) {
    var type = String(action['$Type'] || '').replace(/^.*\$/, '');
    if (type === 'CreateChangeAction' || type === 'ChangeAction') return memberRows(action.Items);
    if (type === 'MicroflowCallAction') return argumentRows((action.MicroflowCall || {}).ParameterMappings);
    if (type === 'NanoflowCallAction') return argumentRows((action.NanoflowCall || {}).ParameterMappings);
    if (type === 'JavaActionCallAction' || type === 'JavaScriptActionCallAction') return argumentRows(action.ParameterMappings);
    if (type === 'ShowFormAction') return argumentRows((action.FormSettings || {}).ParameterMappings);
    return null;
  }

  // Everything an activity's three slots need, per action type. Returns
  // { title, meta, ref }; the kicker is activityKicker's job.
  function activityLabel(action) {
    var type = String(action['$Type'] || '').replace(/^.*\$/, '');
    var commit = action.Commit && action.Commit !== 'No' ? 'commit' : null;

    if (type === 'RetrieveAction') {
      var source = action.RetrieveSource || {};
      // The kicker depends on WHERE it retrieves from, which is the single
      // most useful thing to know about a retrieve: one goes to the database,
      // the other walks an association on an object already in memory.
      if (typeof source.Entity === 'string' && source.Entity) {
        return { kicker: 'Retrieve from database', title: shortName(source.Entity),
          meta: oneLine(source.XpathConstraint), ref: source.Entity };
      }
      if (typeof source.AssociationId === 'string' && source.AssociationId) {
        var from = varRef(source.StartVariableName);
        return {
          kicker: 'Retrieve by association',
          title: shortName(source.AssociationId),
          meta: from ? 'from ' + from : null,
          ref: source.AssociationId
        };
      }
      return { title: null, meta: null, ref: null };
    }
    if (type === 'CreateChangeAction' || type === 'CreateListAction') {
      return {
        title: typeof action.Entity === 'string' ? shortName(action.Entity) : null,
        meta: joinMeta([varRef(action.VariableName), commit]),
        ref: typeof action.Entity === 'string' ? action.Entity : null
      };
    }
    if (type === 'ChangeAction') {
      return {
        title: varRef(action.ChangeVariableName),
        meta: joinMeta([changedMembers(action.Items), commit]),
        ref: null
      };
    }
    if (type === 'ChangeListAction') {
      return {
        title: varRef(action.ChangeVariableName),
        meta: joinMeta([str(action, 'Type'), oneLine(action.Value)]),
        ref: null
      };
    }
    if (type === 'ChangeVariableAction') {
      return { title: varRef(action.ChangeVariableName), meta: oneLine(action.Value), ref: null };
    }
    if (type === 'CreateVariableAction') {
      return { title: varRef(action.VariableName), meta: oneLine(action.InitialValue), ref: null };
    }
    if (type === 'CommitAction') {
      return {
        title: varRef(action.CommitVariableName),
        // Studio Pro's own wording, and the difference that bites: committing
        // with events runs before/after-commit microflows, without does not.
        meta: action.WithEvents === false ? 'without events' : 'with events',
        ref: null
      };
    }
    if (type === 'DeleteAction') return { title: varRef(action.DeleteVariableName), meta: null, ref: null };
    if (type === 'RollbackAction') return { title: varRef(action.RollbackVariableName), meta: null, ref: null };
    if (type === 'CastAction') return { title: varRef(action.VariableName), meta: null, ref: null };
    if (type === 'DownloadFileAction') {
      return { title: varRef(action.FileDocumentVariableName), meta: null, ref: null };
    }
    if (type === 'ImportXmlAction' || type === 'ExportXmlAction') {
      var mapping = mappingOf(action.ResultHandling);
      var document = type === 'ImportXmlAction'
        ? varRef(action.XmlDocumentVariableName)
        : varRef(action.OutputMethod && action.OutputMethod.TargetDocumentVariableName);
      return {
        title: mapping ? shortName(mapping) : document,
        meta: mapping ? document : null,
        ref: mapping
      };
    }
    if (type === 'AggregateAction') {
      // Count over a list needs no attribute; Sum/Average/Min/Max name one,
      // or an expression when UseExpression is on.
      var over = action.UseExpression ? oneLine(action.Expression) : shortName(str(action, 'Attribute') || '');
      return {
        title: varRef(action.AggregateVariableName),
        meta: (str(action, 'AggregateFunction') || 'Aggregate') +
          (over ? ' of ' + over : '') +
          (action.VariableName ? ' → ' + varRef(action.VariableName) : ''),
        ref: null
      };
    }
    if (type === 'ListOperationsAction') {
      var op = action.NewOperation && typeof action.NewOperation === 'object' ? action.NewOperation : {};
      // WHICH operation is the operation object's own type, not a field on the
      // action — "List operation" on its own says nothing. Measured: eleven
      // different ones in a real project (Head, Sort, Filter, Union, …).
      var opName = activityKicker(op['$Type']) || 'Operation';
      var detail = oneLine(op.Expression) || shortName(str(op, 'Attribute') || '') ||
        varRef(op.SecondListOrObjectName);
      return {
        title: varRef(op.ListName),
        meta: opName + (detail ? ' ' + detail : '') +
          (action.ResultVariableName ? ' → ' + varRef(action.ResultVariableName) : ''),
        ref: null
      };
    }
    if (type === 'MicroflowCallAction') {
      var call = action.MicroflowCall || {};
      return {
        title: typeof call.Microflow === 'string' ? shortName(call.Microflow) : null,
        meta: action.UseReturnVariable && action.ResultVariableName ? '→ ' + varRef(action.ResultVariableName) : null,
        ref: typeof call.Microflow === 'string' ? call.Microflow : null
      };
    }
    if (type === 'NanoflowCallAction') {
      var nano = action.NanoflowCall || {};
      return {
        title: typeof nano.Nanoflow === 'string' ? shortName(nano.Nanoflow) : null,
        meta: action.UseReturnVariable && action.OutputVariableName ? '→ ' + varRef(action.OutputVariableName) : null,
        ref: typeof nano.Nanoflow === 'string' ? nano.Nanoflow : null
      };
    }
    if (type === 'JavaActionCallAction' || type === 'JavaScriptActionCallAction') {
      var named = str(action, 'JavaAction') || str(action, 'JavaScriptAction');
      var out = action.ResultVariableName || action.OutputVariableName;
      return {
        title: named ? shortName(named) : null,
        meta: action.UseReturnVariable && out ? '→ ' + varRef(out) : null,
        ref: named
      };
    }
    if (type === 'ShowFormAction') {
      var settings = action.FormSettings || {};
      return {
        title: typeof settings.Form === 'string' ? shortName(settings.Form) : null,
        meta: null,
        ref: typeof settings.Form === 'string' ? settings.Form : null
      };
    }
    if (type === 'CloseFormAction') return { title: null, meta: null, ref: null };
    if (type === 'ShowMessageAction') {
      return {
        title: templateText(action.Template),
        meta: joinMeta([str(action, 'Type'), action.Blocking === true ? 'blocking' : null]),
        ref: null
      };
    }
    if (type === 'ValidationFeedbackAction') {
      var member = shortName(str(action, 'Attribute') || str(action, 'Association') || '');
      return {
        title: varRef(action.ValidationVariableName),
        meta: joinMeta([member || null, templateText(action.FeedbackTemplate)]),
        ref: null
      };
    }
    if (type === 'LogMessageAction') {
      return {
        title: templateText(action.MessageTemplate),
        meta: joinMeta([str(action, 'Level'), oneLine(action.Node)]),
        ref: null
      };
    }
    if (type === 'RestCallAction') {
      // The address is in CustomLocationTemplate, not in CustomLocation:
      // measured on 44 real REST calls, CustomLocation was empty on every
      // one and the URL was a template of a constant plus expressions.
      var http = action.HttpConfiguration || {};
      var where = oneLine(http.CustomLocation) || templateText(http.CustomLocationTemplate);
      var method = str(http, 'HttpMethod');
      return {
        title: where ? (method ? method + ' ' + where : where) : method,
        meta: null, ref: null
      };
    }
    if (type === 'CallWebServiceAction') {
      var service = str(action, 'ServiceName');
      var operation = str(action, 'OperationName');
      return {
        title: service && operation ? service + '.' + operation : (service || operation),
        meta: null,
        ref: str(action, 'ImportedService')
      };
    }
    if (type === 'IncrementCounterMeterAction') {
      return { title: oneLine(action.Name), meta: null, ref: null };
    }
    if (type === 'SynchronizeAction') {
      return { title: str(action, 'Type'), meta: null, ref: null };
    }
    return { title: null, meta: null, ref: null };
  }

  // The same three slots for the shapes that are not activities. Events —
  // start, end, merge, break, continue, error — get nothing: Studio Pro draws
  // no text on them, and inventing some would be text the file does not have.
  function nodeLabel(obj, kind, caption, loop) {
    if (kind === 'activity') {
      var action = obj.Action;
      var built = activityLabel(action);
      return {
        // An action may name its own kicker when the table cannot: a retrieve
        // reads differently depending on its source.
        kicker: built.kicker || activityKicker(action['$Type']),
        // An authored caption always wins: it is what a person chose to call
        // this step, and Studio Pro shows it instead of a generated one.
        title: caption || built.title,
        meta: built.meta,
        ref: built.ref
      };
    }
    if (kind === 'decision' || kind === 'objectTypeDecision') {
      var condition = obj.SplitCondition && typeof obj.SplitCondition === 'object' ? obj.SplitCondition : null;
      var ruleCall = condition && condition.RuleCall && typeof condition.RuleCall === 'object' ? condition.RuleCall : null;
      var rule = ruleCall ? str(ruleCall, 'Microflow') : null;
      return {
        kicker: kind === 'decision' ? 'Decision' : 'Object type decision',
        title: caption || varRef(obj.SplitVariableName),
        meta: condition ? (oneLine(condition.Expression) || (rule ? shortName(rule) : null)) : null,
        ref: rule
      };
    }
    if (kind === 'loop') {
      return {
        kicker: 'Loop',
        title: caption || (loop ? (varRef(loop.iteratorVariable) || oneLine(loop.condition)) : null),
        meta: loop ? varRef(loop.listVariable) : null,
        ref: null
      };
    }
    if (kind === 'parameter') return { kicker: 'Parameter', title: caption, meta: null, ref: null };
    if (kind === 'annotation') return { kicker: null, title: caption, meta: null, ref: null };
    return { kicker: null, title: null, meta: null, ref: null };
  }

  function readFlowGraph(raw) {
    var collection = raw && raw.ObjectCollection;
    if (!collection) return null; // no body to read, which is not an empty one

    var nodes = [];
    function walk(objects, parentId) {
      payload(objects).forEach(function (obj) {
        if (!obj || typeof obj !== 'object') return;
        var kind = nodeKindOf(obj['$Type']);
        var action = obj.Action && typeof obj.Action === 'object' ? obj.Action : null;
        var condition = obj.SplitCondition && typeof obj.SplitCondition === 'object' ? obj.SplitCondition : null;
        var ruleCall = condition && condition.RuleCall && typeof condition.RuleCall === 'object' ? condition.RuleCall : null;
        var caption = nodeCaptionOf(obj, kind);
        var loop = kind === 'loop' ? loopSourceOf(obj) : null;
        var label = nodeLabel(obj, action ? kind : (kind === 'activity' ? 'other' : kind), caption, loop);
        nodes.push({
          id: idHex(obj['$ID']),
          kind: kind,
          // The action type exactly as the file names it, minus the module
          // prefix. Translating it into somebody else's vocabulary is the
          // exporter's job, not the reader's.
          action: action ? String(action['$Type'] || '').replace(/^.*\$/, '') || null : null,
          caption: caption,
          // The readable text, built because the file does not carry it.
          kicker: label.kicker,
          title: label.title,
          meta: label.meta,
          ref: label.ref,
          // [{ name, value, op?, association? }] — see activityFields.
          fields: action ? activityFields(action) : null,
          documentation: str(obj, 'Documentation'),
          at: point(obj.RelativeMiddlePoint),
          size: sizeFrom(obj.Size),
          parentId: parentId,
          // A decision holds either an expression or a call to a rule, and
          // the two are different things: putting a rule's name in
          // `expression` would make the diamond claim it holds an expression.
          expression: condition ? str(condition, 'Expression') : null,
          rule: ruleCall ? str(ruleCall, 'Microflow') : null,
          variable: str(obj, 'SplitVariableName'),
          returnValue: str(obj, 'ReturnValue'),
          loop: loop,
          disabled: obj.Disabled === true
        });
        if (obj.ObjectCollection) walk(obj.ObjectCollection.Objects, idHex(obj['$ID']));
      });
    }
    walk(collection.Objects, null);

    var edges = payload(raw.Flows).filter(function (f) {
      return f && typeof f === 'object' && f['$Type'];
    }).map(function (f) {
      var kind = f['$Type'] === 'Microflows$AnnotationFlow' ? 'annotation'
        : f['$Type'] === 'Microflows$SequenceFlow' ? 'sequence'
          : String(f['$Type']).replace(/^.*\$/, '');
      var one = payload(f.CaseValues)[0];
      var caseType = one && one['$Type'] ? String(one['$Type']) : null;
      var line = f.Line && typeof f.Line === 'object' ? f.Line : null;
      return {
        from: idHex(f.OriginPointer),
        to: idHex(f.DestinationPointer),
        // The raw connection index Mendix writes. It is the side of the box,
        // and 1 -> 3 is by far the commonest pair (13 921 of 18 395 origins
        // are 1), which is left-to-right — but WHICH number is the top is not
        // established yet, so it is passed through rather than renamed into a
        // compass direction this cannot yet prove.
        fromSide: typeof f.OriginConnectionIndex === 'number' ? f.OriginConnectionIndex : null,
        toSide: typeof f.DestinationConnectionIndex === 'number' ? f.DestinationConnectionIndex : null,
        kind: kind,
        caseKind: caseType === 'Microflows$EnumerationCase' ? 'enumeration'
          : caseType === 'Microflows$InheritanceCase' ? 'inheritance' : null,
        caseValue: one && typeof one.Value === 'string' && one.Value ? one.Value : null,
        isError: f.IsErrorHandler === true,
        fromVector: line ? point(line.OriginControlVector) : null,
        toVector: line ? point(line.DestinationControlVector) : null
      };
    });

    return { nodes: nodes, edges: edges };
  }

  // A Texts$Text is how Mendix stores anything a person reads: a list of
  // translations, one per language. MxScout shows one string, so it takes the
  // English one when there is one and the first otherwise — never the
  // language code, and never an empty string in preference to a real one.
  function captionOf(text) {
    var items = text && text.Items ? payload(text.Items) : [];
    var first = null, english = null;
    items.forEach(function (item) {
      if (!item || typeof item.Text !== 'string' || !item.Text) return;
      if (!first) first = item.Text;
      if (!english && /^en/i.test(String(item.LanguageCode || ''))) english = item.Text;
    });
    return english || first || null;
  }

  // ---------------- what the app exposes, and what runs with no user ------
  // Two questions the role filter cannot answer, because neither has a user
  // behind it. A published REST or OData service is reachable by whoever can
  // reach the app at all, gated by its own role list and its own
  // authentication; a scheduled event runs a microflow on a timer, in no
  // session, as nobody. Both are in the file, and MxScout read neither.

  // A schedule is stored as a child object whose TYPE is the unit — Minute,
  // Day, Week — and whose Multiplier is the count. The legacy Interval /
  // IntervalType pair sits in the same document and is NOT kept in step by
  // Studio Pro, so reading it would give a number that was true once.
  function scheduleText(doc) {
    var schedule = doc && doc.Schedule;
    if (!schedule || typeof schedule !== 'object') return null;
    var unit = String(schedule['$Type'] || '').replace(/^.*\$/, '').replace(/Schedule$/, '').toLowerCase();
    if (!unit) return null;
    var every = typeof schedule.Multiplier === 'number' ? schedule.Multiplier : 1;
    return every === 1 ? 'every ' + unit : 'every ' + every + ' ' + unit + 's';
  }

  function readPublishedRest(doc) {
    var exposes = [];
    payload(doc.Resources).forEach(function (resource) {
      if (!resource) return;
      payload(resource.Operations).forEach(function (op) {
        if (!op) return;
        var method = typeof op.HttpMethod === 'string' ? op.HttpMethod.toUpperCase() : '';
        var where = [resource.Name, op.OperationPath].filter(Boolean).join('/');
        exposes.push((method ? method + ' ' : '') + (where || op.Name || '') +
          (typeof op.Microflow === 'string' && op.Microflow ? ' → ' + op.Microflow : ''));
      });
    });
    return {
      kind: 'REST',
      path: str(doc, 'Path'), version: str(doc, 'Version'),
      allowedModuleRoles: payload(doc.AllowedRoles).filter(function (r) { return typeof r === 'string'; }),
      authentication: payload(doc.AuthenticationTypes).filter(function (a) { return typeof a === 'string'; }),
      authenticationMicroflow: str(doc, 'AuthenticationMicroflow'),
      exposes: exposes
    };
  }

  function readPublishedOData(doc) {
    return {
      kind: 'OData',
      path: str(doc, 'Path'), version: str(doc, 'Version'),
      allowedModuleRoles: payload(doc.AllowedModuleRoles).filter(function (r) { return typeof r === 'string'; }),
      authentication: payload(doc.AuthenticationTypes).filter(function (a) { return typeof a === 'string'; }),
      authenticationMicroflow: str(doc, 'AuthenticationMicroflow'),
      exposes: payload(doc.EntitySets).filter(function (s) { return s && s.ExposedName; })
        .map(function (s) { return String(s.ExposedName); })
    };
  }

  // A published web service authenticates per version, with a header rather
  // than a role list — so there is no role list to report, and saying "no
  // roles" would read as "open to everyone", which is a different claim.
  function readPublishedWebService(doc) {
    var versions = payload(doc.VersionedWebServices).filter(function (v) { return v && typeof v === 'object'; });
    var auth = [];
    versions.forEach(function (v) {
      if (typeof v.HeaderAuthentication === 'string' && v.HeaderAuthentication && auth.indexOf(v.HeaderAuthentication) === -1) {
        auth.push(v.HeaderAuthentication);
      }
    });
    var exposes = [];
    versions.forEach(function (v) {
      payload(v.Operations).forEach(function (op) {
        if (op && op.Name) exposes.push(String(op.Name));
      });
    });
    return {
      kind: 'web service',
      path: null, version: null,
      allowedModuleRoles: null, // not how a SOAP service is gated
      authentication: auth,
      authenticationMicroflow: null,
      exposes: exposes
    };
  }

  // ---------------- what can reach a flow ----------------
  // Nearly half the microflows in a real project have no allowed roles at all
  // (339 of 713 in one measured here). MxScout used to say "no user role can
  // trigger this directly", which is true about the client and says nothing
  // about the application: those flows run from a scheduled event, from a
  // published REST operation, from an entity event, or from another flow.
  //
  // Every one of those references is a plain qualified-name STRING in the
  // BSON, under a property called Microflow, Nanoflow, Form or Page — which
  // is what makes one rule enough: walk any decoded document, collect every
  // string under one of those four names, and keep the ones that match
  // something in the finished model. Nothing has to know which $Type holds
  // which reference, so a shape this has never seen still resolves, and a
  // name that matches nothing is simply dropped. Measured across two real
  // projects the rule finds calls, page actions, snippet and layout uses,
  // scheduled events, REST and OData operations, entity events, calculated
  // attributes, mapping calls, rule calls and navigation home pages.
  //
  // Deliberately NOT matched: ConcurrencyErrorMicroflow and friends, because
  // they are different property names. AuthenticationMicroflow is listed
  // explicitly — a service's authentication microflow really does run.
  //
  // The property name also says WHICH KIND of thing is being named, and that
  // matters because a qualified name does not identify a document on its own:
  // in Helpdesk 10 names belong to both a microflow and a page, in Avalon 39.
  // `SpecialForms.EditForm` is a microflow AND a page there; the microflow
  // `NewForm` names it under `Microflow` (it calls the flow) while the
  // microflow `EditForm` names it under `Form` (it opens the page). Collecting
  // both as the same bare string put every one of those references on
  // whichever of the two was inserted into the lookup last — giving the page
  // a caller it does not have and leaving the microflow saying nothing reaches
  // it. Flow versus page is the only split needed: across four real projects
  // there is not one name shared by a microflow and a nanoflow.
  var REFERENCE_KEYS = {
    Microflow: 'flow', Nanoflow: 'flow', AuthenticationMicroflow: 'flow',
    Form: 'page', Page: 'page'
  };

  // into: { "Module.Name": 'flow' | 'page' | 'both' }. One document really can
  // name the same string both ways — a snippet with a button that calls the
  // nanoflow and a link that opens the page of the same name — so the two
  // answers are kept rather than one overwriting the other.
  function collectReferences(doc, into) {
    if (!doc || typeof doc !== 'object' || doc instanceof Uint8Array) return into;
    if (Array.isArray(doc)) {
      for (var i = 0; i < doc.length; i++) collectReferences(doc[i], into);
      return into;
    }
    var keys = Object.keys(doc);
    for (var k = 0; k < keys.length; k++) {
      var value = doc[keys[k]];
      if (typeof value === 'string') {
        var wants = REFERENCE_KEYS[keys[k]];
        if (wants && value) into[value] = (into[value] && into[value] !== wants) ? 'both' : wants;
      } else {
        collectReferences(value, into);
      }
    }
    return into;
  }

  // What a document IS, in the words a tester would use for it. Anything not
  // listed falls back to the type's own name rather than being dropped — a
  // reference from a shape this does not recognise is still a reference, and
  // a document of a kind nobody here has heard of is still in the project.
  // Two callers, deliberately the same map: the "called by" line on a flow,
  // and the label on a row of the project tree. A document named one way in
  // one place and another way in the other would be two answers to one
  // question.
  var SOURCE_KIND = {
    'Microflows$Microflow': 'microflow',
    'Microflows$Nanoflow': 'nanoflow',
    'Microflows$Rule': 'rule',
    'Forms$Page': 'page',
    'Forms$Snippet': 'snippet',
    'Forms$Layout': 'layout',
    'Forms$BuildingBlock': 'building block',
    'Forms$PageTemplate': 'page template',
    'DomainModels$DomainModel': 'domain model',
    'ScheduledEvents$ScheduledEvent': 'scheduled event',
    'Rest$PublishedRestService': 'published REST service',
    'Rest$ConsumedODataService': 'consumed OData service',
    'ODataPublish$PublishedODataService2': 'published OData service',
    'WebServices$PublishedService': 'published web service',
    'Navigation$NavigationDocument': 'navigation',
    'Menus$MenuDocument': 'menu',
    'Workflows$Workflow': 'workflow',
    'ImportMappings$ImportMapping': 'import mapping',
    'ExportMappings$ExportMapping': 'export mapping',
    'Queues$Queue': 'queue',
    // Listed only because the fallback's de-CamelCasing lowercases a name
    // that is a proper noun: "java script action" reads as a typo, and the
    // older OData type (Mendix's own spelling, Odata) would otherwise sit in
    // a tree next to its newer sibling under a differently-cased name for the
    // same thing. 32 document types measured across four projects; these five
    // are the only ones the fallback got cosmetically wrong.
    'JavaActions$JavaAction': 'Java action',
    'JavaScriptActions$JavaScriptAction': 'JavaScript action',
    'JsonStructures$JsonStructure': 'JSON structure',
    'XmlSchemas$XmlSchema': 'XML schema',
    'Rest$PublishedOdataServiceImpl': 'published OData service'
  };
  function sourceKindOf(type) {
    if (SOURCE_KIND[type]) return SOURCE_KIND[type];
    return String(type || 'document').replace(/^.*\$/, '').replace(/Impl$/, '')
      .replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  }

  // The .mpr's own _MetaData table: which Studio Pro wrote this project.
  //
  // Three shapes exist and a reader has to survive all of them — MEASURED,
  // not assumed: a Mendix 9 project's table has three columns and no
  // _FormatVersion at all, an 11.12 project's has four INCLUDING it (a
  // published account of this format claims that column disappears after
  // 11.6.2; a real 11.12 file still has it, which is exactly why nothing
  // here is read by position), and a file with no _MetaData at all is not an
  // error — just a project that cannot say. Read by column name, every field
  // optional, never throw: the version is a label on a screen, and no part of
  // reading the model depends on it. Which on-disk format this is stays
  // decided by the Unit table's own columns, not by this number.
  //
  // The table MxScout deliberately does NOT read is the other one in here:
  // _Transaction, whose single UUID is how Studio Pro notices that something
  // outside it changed the project. Nothing in MxScout writes to a .mpr, so
  // nothing in MxScout has any business touching the row that would tell
  // Studio Pro a write happened.
  function readMetaData(mprBytes) {
    var table;
    try { table = root.MxSqlite.readTable(mprBytes, '_MetaData'); } catch (e) { return {}; }
    if (!table.rows.length) return {};
    var col = {};
    table.columns.forEach(function (name, i) { col[name] = i; });
    var row = table.rows[0];
    function str(name) {
      var v = col[name] === undefined ? null : row[col[name]];
      return typeof v === 'string' && v ? v : null;
    }
    return { productVersion: str('_ProductVersion'), buildVersion: str('_BuildVersion'), schemaHash: str('_SchemaHash') };
  }
  // fromAppStore mirrors the Module document's own FromAppStore flag — the
  // same bit Studio Pro's App Explorer uses to bucket a module under its
  // "Marketplace modules" folder rather than listing it as one of the
  // project's own. Unverified against a real .mpr sample (this codebase's
  // fixtures are hand-built, not extracted from one); if a real project's
  // marketplace modules don't get flagged, this is the field name to
  // re-check first — everything downstream (app.js's marketplace filter)
  // only reads this one boolean, so a wrong name fails safe (nothing gets
  // hidden) rather than hiding the wrong things.
  function addModule(model, name, fromAppStore) {
    if (!model.modules.some(function (m) { return m.name === name; })) {
      model.modules.push({ name: name, fromAppStore: !!fromAppStore });
    }
  }
  function sortModel(model) {
    model.modules.sort(function (a, b) { return a.name.localeCompare(b.name); });
    model.entities.sort(function (a, b) { return a.qualifiedName.localeCompare(b.qualifiedName); });
    model.associations.sort(function (a, b) { return a.name.localeCompare(b.name); });
    model.microflows.sort(function (a, b) { return a.qualifiedName.localeCompare(b.qualifiedName); });
    model.nanoflows.sort(function (a, b) { return a.qualifiedName.localeCompare(b.qualifiedName); });
    model.pages.sort(function (a, b) { return a.qualifiedName.localeCompare(b.qualifiedName); });
    model.moduleRoles.sort(function (a, b) { return a.qualifiedName.localeCompare(b.qualifiedName); });
    model.enumerations.sort(function (a, b) { return a.qualifiedName.localeCompare(b.qualifiedName); });
    model.publishedServices.sort(function (a, b) { return a.qualifiedName.localeCompare(b.qualifiedName); });
    model.automation.sort(function (a, b) { return a.qualifiedName.localeCompare(b.qualifiedName); });
    model.folders.sort(treeOrder);
    model.documents.sort(treeOrder);
    return model;
  }

  // Tree order: module, then the folder path, then the name. The path is
  // compared NAME BY NAME rather than as a joined string, because a folder
  // name may contain a slash — `Endpoint/Service mapping`,
  // `Private - String en/de-cryption`, 2 to 12 of them in each of the four
  // projects measured — so there is no separator available that could not
  // also be part of a name. The type breaks a last tie: one folder really can
  // hold two documents of the same name (24 such pairs in Helpdesk, e.g. a
  // scheduled event named after the microflow it runs).
  function treeOrder(a, b) {
    if (a.module !== b.module) return String(a.module).localeCompare(String(b.module));
    var ap = a.path || [], bp = b.path || [];
    for (var i = 0; i < Math.min(ap.length, bp.length); i++) {
      if (ap[i] !== bp[i]) return String(ap[i]).localeCompare(String(bp[i]));
    }
    if (ap.length !== bp.length) return ap.length - bp.length;
    if (a.name !== b.name) return String(a.name).localeCompare(String(b.name));
    return String(a.type || '').localeCompare(String(b.type || ''));
  }

  // ---------------- the model builder ----------------
  // input: { mprBytes: Uint8Array|ArrayBuffer,
  //          readContentsFile: (relativePath) => Promise<ArrayBuffer|null>,
  //          appName?: string,
  //          onProgress?: (phase, done, total) => void }
  // readContentsFile is only ever called for v2 projects; v1's Contents are
  // already sitting in the one Unit-table scan. Always async so both formats
  // share one call shape.
  async function buildModel(input) {
    var unitTable = root.MxSqlite.readTable(input.mprBytes, 'Unit');
    var col = {};
    unitTable.columns.forEach(function (name, i) { col[name] = i; });
    if (!('UnitID' in col) || !('ContainerID' in col) || !('ContainmentName' in col)) {
      throw new Error('This .mpr file’s Unit table is missing a column MxScout needs — is this really a Mendix project file?');
    }
    var version = ('Contents' in col) ? 1 : 2;

    var byUnitId = new Map();       // hex(UnitID) -> row
    var byContainment = new Map();  // ContainmentName -> row[]
    unitTable.rows.forEach(function (row) {
      var hex = idHex(row[col.UnitID]);
      if (hex) byUnitId.set(hex, row);
      var cn = row[col.ContainmentName];
      if (cn) {
        if (!byContainment.has(cn)) byContainment.set(cn, []);
        byContainment.get(cn).push(row);
      }
    });

    function getContainerId(unitIdBytes) {
      var row = byUnitId.get(idHex(unitIdBytes));
      return row ? row[col.ContainerID] : null;
    }

    async function readContents(unitIdBytes) {
      if (!unitIdBytes) return null;
      if (version === 1) {
        var row = byUnitId.get(idHex(unitIdBytes));
        var c = row ? row[col.Contents] : null;
        return (c && c.length) ? c : null;
      }
      var guid = blobToGuid(unitIdBytes);
      var relPath = guid.slice(0, 2) + '/' + guid.slice(2, 4) + '/' + guid + '.mxunit';
      try {
        var buf = await input.readContentsFile(relPath);
        return buf ? new Uint8Array(buf) : null;
      } catch (e) {
        return null;
      }
    }

    async function decodeUnit(unitIdBytes) {
      var bytes = await readContents(unitIdBytes);
      if (!bytes || !bytes.length) return null;
      try { return root.MxBson.decode(bytes); } catch (e) { return null; }
    }

    function report(phase, done, total) {
      if (input.onProgress) input.onProgress(phase, done, total);
    }

    var result = emptyModel();
    var meta = readMetaData(input.mprBytes);
    result.meta.mendixVersion = meta.productVersion;
    result.meta.schemaHash = meta.schemaHash;
    result.meta.mprFormat = version;
    // A Mendix project's .mpr is named after the app, so the file name IS the
    // app name — there is no other place in the file that carries it.
    if (typeof input.appName === 'string' && input.appName) result.meta.appName = input.appName;

    var entityById = new Map();      // hex($ID) -> { qn, entity }
    var associationByName = new Map(); // "Module.Assoc" -> the association it names
    // One entry per document that names anything:
    // { kind, name, refs: [{ name, wants: 'flow'|'page'|'both' }] }. The names
    // cannot be resolved while this is being collected — the document doing
    // the naming is often read before the one being named — so they are
    // resolved in one pass at the end.
    var referenceSources = [];
    function noteReferences(kindType, name, doc) {
      var refs = collectReferences(doc, {});
      var names = Object.keys(refs);
      if (names.length) {
        referenceSources.push({
          kind: sourceKindOf(kindType), name: name,
          refs: names.map(function (n) { return { name: n, wants: refs[n] }; })
        });
      }
    }
    var parsedModules = [];
    var moduleUnitIndex = new Map(); // hex(module unit's own UnitID) -> moduleName

    // Pass 1: register every module + entity, so pass 2 can resolve
    // cross-entity references regardless of which module declares them.
    var domainModelRows = byContainment.get('DomainModel') || [];
    report('Reading domain models', 0, domainModelRows.length);
    for (var i = 0; i < domainModelRows.length; i++) {
      var dmRow = domainModelRows[i];
      var moduleDoc = await decodeUnit(dmRow[col.ContainerID]);
      var moduleName = moduleDoc && typeof moduleDoc.Name === 'string' ? moduleDoc.Name : null;
      if (moduleName) {
        var doc = await decodeUnit(dmRow[col.UnitID]);
        if (doc) {
          parsedModules.push({ moduleName: moduleName, doc: doc });
          // A domain model names microflows too: entity event handlers and
          // calculated attributes both run one.
          noteReferences(doc['$Type'], moduleName, doc);
          addModule(result, moduleName, moduleDoc.FromAppStore);
          moduleUnitIndex.set(idHex(dmRow[col.ContainerID]), moduleName);
          payload(doc.Entities).forEach(function (raw) {
            if (!raw || raw['$Type'] !== 'DomainModels$EntityImpl') return;
            var qn = moduleName + '.' + raw.Name;
            var entity = {
              module: moduleName, name: raw.Name, qualifiedName: qn,
              tableName: null, generalization: null, persistable: true,
              attributes: [], accessRules: []
            };
            var view = viewEntitySourceOf(raw);
            if (view) entity.viewEntity = view;
            result.entities.push(entity);
            entityById.set(idHex(raw['$ID']), { qn: qn, entity: entity });
          });
        }
      }
      report('Reading domain models', i + 1, domainModelRows.length);
    }

    // Pass 2: attributes, generalization, access rules, associations.
    parsedModules.forEach(function (pm) {
      payload(pm.doc.Entities).forEach(function (raw) {
        if (!raw || raw['$Type'] !== 'DomainModels$EntityImpl') return;
        var ref = entityById.get(idHex(raw['$ID']));
        if (!ref) return;
        var entity = ref.entity;

        payload(raw.Attributes).forEach(function (a) {
          if (!a || a['$Type'] !== 'DomainModels$Attribute') return;
          var described = attributeTypeOf(a);
          entity.attributes.push({
            name: a.Name, type: described.type, length: described.length,
            defaultValue: a.Value && typeof a.Value.DefaultValue === 'string' ? a.Value.DefaultValue : null,
            enumerationQualifiedName: described.enumerationQualifiedName
          });
        });

        // Older files carry this as "Generalization", newer as
        // "MaybeGeneralization". A real superclass is a qualified-name
        // STRING directly on the generalization object — never an $ID
        // pointer, which is why System.User etc. always resolve even though
        // they're never one of this project's own parsed entities. When
        // there's no superclass, that same object carries Persistable.
        var gen = raw.Generalization || raw.MaybeGeneralization;
        if (gen && typeof gen === 'object') {
          if (gen['$Type'] === 'DomainModels$NoGeneralization') {
            if (typeof gen.Persistable === 'boolean') entity.persistable = gen.Persistable;
          } else if (typeof gen.Generalization === 'string') {
            entity.generalization = gen.Generalization;
          }
        }

        payload(raw.AccessRules).forEach(function (rule) {
          if (!rule || rule['$Type'] !== 'DomainModels$AccessRule') return;
          var roles = payload(rule.AllowedModuleRoles).filter(function (r) { return typeof r === 'string'; });
          if (!roles.length) return;

          var defaultAccess = accessRightsToLetter(rule.DefaultMemberAccessRights);
          var attrAccess = {};
          var assocAccess = {};
          if (defaultAccess) entity.attributes.forEach(function (a) { attrAccess[a.name] = defaultAccess; });
          payload(rule.MemberAccesses).forEach(function (m) {
            if (!m) return;
            var letter = accessRightsToLetter(m.AccessRights);
            if (m.Attribute) {
              var attrName = shortName(m.Attribute);
              if (letter) attrAccess[attrName] = letter; else delete attrAccess[attrName];
            } else if (m.Association) {
              // Recorded as an explicit 'none' rather than dropped: the
              // default below is applied to associations in a later pass, and
              // that pass has to be able to tell "this rule says no" from
              // "this rule says nothing".
              var assocName = shortName(m.Association);
              assocAccess[assocName] = letter || 'none';
            }
          });

          var xpathConstraint = typeof rule.XPathConstraint === 'string' && rule.XPathConstraint ? rule.XPathConstraint : null;
          roles.forEach(function (role) {
            entity.accessRules.push({
              moduleRole: role,
              defaultAccess: defaultAccess || null,
              attrAccess: Object.assign({}, attrAccess),
              assocAccess: Object.assign({}, assocAccess),
              xpathConstraint: xpathConstraint,
              xpathReferencedEntities: [],
              allowCreate: !!rule.AllowCreate,
              allowDelete: !!rule.AllowDelete
            });
          });
        });
      });

      payload(pm.doc.Associations).forEach(function (a) {
        if (!a || a['$Type'] !== 'DomainModels$Association') return;
        var owner = entityById.get(idHex(a.ParentPointer));
        var other = entityById.get(idHex(a.ChildPointer));
        if (!owner || !other) return;
        var assoc = {
          name: a.Name, module: pm.moduleName,
          owner: owner.qn, ownerMultiplicity: null,
          other: other.qn, otherMultiplicity: null,
          type: a.Type || null
        };
        result.associations.push(assoc);
        // Indexed by qualified name, which is how a flow body's
        // association-based retrieve names it (see readFlowActivity).
        associationByName.set(pm.moduleName + '.' + a.Name, assoc);
      });

      payload(pm.doc.CrossAssociations).forEach(function (a) {
        if (!a || a['$Type'] !== 'DomainModels$CrossAssociation') return;
        var owner = entityById.get(idHex(a.ParentPointer));
        if (!owner || !a.Child) return;
        var cross = {
          name: a.Name, module: pm.moduleName,
          owner: owner.qn, ownerMultiplicity: null,
          other: a.Child, otherMultiplicity: null,
          type: a.Type || null
        };
        result.associations.push(cross);
        associationByName.set(pm.moduleName + '.' + a.Name, cross);
      });
    });

    applyAssociationDefaults(result);

    // An entity that EXTENDS another local entity never gets its own
    // Persistable flag (only a DomainModels$NoGeneralization carries one) —
    // it stays at the emptyModel default (true) regardless of what its root
    // ancestor actually is. Resolve that here, once every entity's
    // generalization is known: walk each entity's chain up to its root and
    // copy that root's own persistable flag. A generalization pointing
    // outside this project (e.g. "System.User") is left at the default,
    // which is correct — the built-in base entities really are persistable.
    var entityByQn = {};
    result.entities.forEach(function (e) { entityByQn[e.qualifiedName] = e; });
    result.entities.forEach(function (entity) {
      var current = entity;
      var guard = 0;
      while (current.generalization && entityByQn[current.generalization] && guard++ < 20) {
        current = entityByQn[current.generalization];
      }
      if (current !== entity) entity.persistable = current.persistable;
    });

    // Pass 2a: the folders. The `Unit` table IS the project tree — a document
    // sits in a folder, that folder in another, and the outermost in a module
    // — and this walk has always climbed it; it just used to keep only the
    // module it landed on and drop every folder name it passed. A folder unit
    // carries nothing but its Name, so this is the whole of what there is to
    // read, and it is read before the documents because a document needs to
    // name the folder it is in.
    var folderByUnit = new Map(); // hex(folder's UnitID) -> { name, container }
    var folderRows = byContainment.get('Folders') || [];
    report('Reading folders', 0, folderRows.length);
    for (var f = 0; f < folderRows.length; f++) {
      var fDoc = await decodeUnit(folderRows[f][col.UnitID]);
      if (fDoc && typeof fDoc.Name === 'string' && fDoc.Name) {
        folderByUnit.set(idHex(folderRows[f][col.UnitID]),
          { name: fDoc.Name, container: folderRows[f][col.ContainerID] });
      }
      report('Reading folders', f + 1, folderRows.length);
    }

    // Where a unit sits: which module, and through which folders. Documents
    // can be nested in Folder units rather than put directly under the module
    // (3307 of 3377 are, in Helpdesk), so the owning module is not the
    // immediate ContainerID — climb until a unit ID IS a module's, collecting
    // the folders passed through on the way.
    //
    // The bound is not decoration. The project's own root unit is its OWN
    // container — measured in all four projects to hand — so a climb that
    // overshoots the module never reaches a top and would spin until the
    // guard stops it. Deepest real nesting measured is 4 folders.
    function locationOf(containerIdBytes) {
      var current = containerIdBytes;
      var path = [];
      for (var depth = 0; current && depth < 20; depth++) {
        var hex = idHex(current);
        if (hex && moduleUnitIndex.has(hex)) return { module: moduleUnitIndex.get(hex), path: path };
        var folder = hex ? folderByUnit.get(hex) : null;
        if (folder) path.unshift(folder.name);
        current = getContainerId(current);
      }
      return { module: null, path: [] };
    }

    folderByUnit.forEach(function (folder) {
      var at = locationOf(folder.container);
      if (!at.module) return;
      result.folders.push({ module: at.module, name: folder.name, path: at.path });
    });

    var viewSources = {}; // "Module.Doc" -> the OQL of a view entity's source document
    var documentRows = byContainment.get('Documents') || [];
    var pageCtx = { entityNames: new Set(result.entities.map(function (e) { return e.qualifiedName; })) };
    report('Reading microflows, nanoflows and pages', 0, documentRows.length);
    for (var d = 0; d < documentRows.length; d++) {
      var docRow = documentRows[d];
      var raw = await decodeUnit(docRow[col.UnitID]);
      if (raw && typeof raw.Name === 'string' && raw.Name) {
        var type = raw['$Type'];
        var at = locationOf(docRow[col.ContainerID]);
        var ownerModule = at.module;
        // EVERY document is a possible source of a reference, not only the
        // three kinds MxScout models: a scheduled event, a published REST
        // operation, a snippet's button and a menu item all name a flow, and
        // a flow nothing else names is the whole point of reading them.
        noteReferences(type, (ownerModule ? ownerModule + '.' : '') + raw.Name, raw);
        // And every document gets a line in the tree, whether or not MxScout
        // models what is inside it. 29 kinds in Helpdesk, of which 3 are
        // modelled: without this, a person looking for the snippet, the Java
        // action or the constant they were told about finds nothing and has
        // no way to tell "not in this project" from "not read by this tool".
        // `kind` is the same readable word the call-site list already uses,
        // from the same map, so the two can never disagree.
        if (ownerModule) {
          result.documents.push({
            module: ownerModule, name: raw.Name, qualifiedName: ownerModule + '.' + raw.Name,
            type: type, kind: sourceKindOf(type), path: at.path
          });
        }
        if (type === 'Microflows$Microflow' || type === 'Microflows$Nanoflow' || type === 'Forms$Page') {
          var moduleName = ownerModule;
          if (moduleName) {
            var qn = moduleName + '.' + raw.Name;
            var allowedModuleRoles = payload(raw.AllowedModuleRoles).filter(function (r) { return typeof r === 'string'; });
            var parameters = extractParameters(entityById, raw);
            if (type === 'Microflows$Microflow' || type === 'Microflows$Nanoflow') {
              // What the flow DOES, read out of the body of the same document
              // — the one thing a tester about to press Run most needs and
              // could not see. entityRefs and javaActionCalls have sat empty
              // on this shape since it was ported from MxSonar; they are what
              // this walk produces, so they get filled rather than duplicated.
              var activity = readFlowActivity(raw, { parameters: parameters, associationByName: associationByName });
              var entityRefs = activity
                ? activity.reads.concat(activity.creates, activity.changes, activity.deletes, activity.commits)
                  .filter(function (v, i, all) { return v && all.indexOf(v) === i; }).sort()
                : [];
              var flow = {
                module: moduleName, name: raw.Name, qualifiedName: qn,
                // Where it lives, outermost folder first; empty when it sits
                // directly in the module. Carried on the flow itself, not
                // looked up in `documents` by name, because a qualified name
                // is NOT unique across kinds: 10 names in Helpdesk, 39 in
                // Avalon, belong to both a microflow and a page.
                path: at.path,
                allowedModuleRoles: allowedModuleRoles,
                parameters: parameters, activity: activity,
                // What the flow LOOKS LIKE, from the same document again.
                // Separate from `activity` on purpose — see readFlowGraph.
                graph: readFlowGraph(raw),
                calledBy: [], javaActionCalls: activity ? activity.javaActions : [],
                entityRefs: entityRefs, constantRefs: [], enumerationRefs: [],
                // What it hands back, in words ("Boolean", "List of Sales.Order");
                // null when the file does not say, which is not "Nothing".
                returnType: dataTypeText(raw.MicroflowReturnType || raw.ReturnType),
                documentation: str(raw, 'Documentation')
              };
              if (type === 'Microflows$Microflow') {
                // Only a microflow has it; a nanoflow runs in the client and
                // always applies entity access.
                flow.applyEntityAccess = !!raw.ApplyEntityAccess;
                result.microflows.push(flow);
              } else {
                result.nanoflows.push(flow);
              }
            } else {
              var pageData = readPageData(raw, pageCtx);
              result.pages.push({
                module: moduleName, name: raw.Name, qualifiedName: qn, path: at.path,
                allowedModuleRoles: allowedModuleRoles, parameters: parameters, calledBy: [],
                dataSources: pageData.dataSources, snippets: pageData.snippets,
                flowRefs: pageData.flowRefs, mentions: pageData.mentions
              });
            }
          }
        } else if (ownerModule && type === 'Forms$Snippet') {
          var snippetData = readPageData(raw, pageCtx);
          result.snippets.push({
            module: ownerModule, name: raw.Name, qualifiedName: ownerModule + '.' + raw.Name,
            dataSources: snippetData.dataSources, snippets: snippetData.snippets,
            flowRefs: snippetData.flowRefs, mentions: snippetData.mentions
          });
        } else if (ownerModule && (type === 'Rest$PublishedRestService' ||
            type === 'WebServices$PublishedService' || /PublishedODataService/.test(type))) {
          var service = type === 'Rest$PublishedRestService' ? readPublishedRest(raw)
            : type === 'WebServices$PublishedService' ? readPublishedWebService(raw)
            : readPublishedOData(raw);
          service.module = ownerModule;
          service.name = raw.Name;
          service.qualifiedName = ownerModule + '.' + raw.Name;
          result.publishedServices.push(service);
        } else if (ownerModule && (type === 'ScheduledEvents$ScheduledEvent' || type === 'Queues$Queue')) {
          var config = raw.Config && typeof raw.Config === 'object' ? raw.Config : null;
          result.automation.push({
            kind: type === 'Queues$Queue' ? 'queue' : 'scheduled event',
            module: ownerModule, name: raw.Name, qualifiedName: ownerModule + '.' + raw.Name,
            // A scheduled event that is switched off still exists, and the
            // difference matters more than the event does.
            enabled: bool(raw, 'Enabled', true),
            microflow: str(raw, 'Microflow'),
            schedule: scheduleText(raw),
            timeZone: str(raw, 'TimeZone'),
            // Stored as an expression, not a number — it can be a constant.
            // An expression, so it can be a constant reference; and it can
            // arrive with the newline somebody typed after it.
            parallelism: config && str(config, 'ParallelismExpression') ? String(config.ParallelismExpression).trim() : null
          });
        } else if (ownerModule && /ViewEntitySourceDocument/.test(type)) {
          viewSources[ownerModule + '.' + raw.Name] = oqlOf(raw);
        } else if (type === 'Enumerations$Enumeration' && ownerModule) {
          // An entity's enumeration attribute has only ever carried the
          // enumeration's NAME. What a person needs is the values it can
          // hold, and those are one document away — captions included, so a
          // raw key like "wf_in_progress" can be shown as "In progress".
          result.enumerations.push({
            module: ownerModule, name: raw.Name, qualifiedName: ownerModule + '.' + raw.Name,
            values: payload(raw.Values).filter(function (v) {
              return v && v['$Type'] === 'Enumerations$EnumerationValue' && v.Name;
            }).map(function (v) {
              return { name: String(v.Name), caption: captionOf(v.Caption) };
            })
          });
        }
      }
      report('Reading microflows, nanoflows and pages', d + 1, documentRows.length);
    }

    // A view entity's query is in its source document (Mendix 11), which is
    // read above; a Mendix 10 copy already found on the entity is kept only
    // when there is no document to read, since the document is the one Studio
    // Pro edits.
    result.entities.forEach(function (entity) {
      var view = entity.viewEntity;
      if (!view || !view.sourceDocument) return;
      if (viewSources[view.sourceDocument]) view.oql = viewSources[view.sourceDocument];
    });

    // Pass 3: the project's Security screen. Two things live here.
    //
    // The one MxScout always had: user roles, which bundle per-module Module
    // Roles (e.g. "Sales.Manager") into the app-level role a user is actually
    // assigned (e.g. "Manager"). The rest of this document is the OTHER half
    // of the same screen, and MxScout used to drop it on the floor — which
    // mattered, because whether the running app enforces any of what the role
    // filter shows is decided right here, by SecurityLevel. A project set to
    // CheckNothing has an access matrix that means nothing at run time, and
    // saying so is the difference between a true picture and a plausible one.
    //
    // Lives alongside Navigation/Settings/Texts under the small
    // 'ProjectDocuments' containment slot.
    var projectDocRows = byContainment.get('ProjectDocuments') || [];
    for (var p = 0; p < projectDocRows.length; p++) {
      var pdoc = await decodeUnit(projectDocRows[p][col.UnitID]);
      if (!pdoc) continue;
      // Navigation sits in this same slot, and a role's home page is the one
      // way into an application that no flow or page names.
      noteReferences(pdoc['$Type'], typeof pdoc.Name === 'string' && pdoc.Name ? pdoc.Name : null, pdoc);
      if (pdoc['$Type'] !== 'Security$ProjectSecurity') continue;
      payload(pdoc.UserRoles).forEach(function (ur) {
        if (!ur || ur['$Type'] !== 'Security$UserRole' || !ur.Name) return;
        result.userRoles.push({
          name: ur.Name,
          moduleRoles: payload(ur.ModuleRoles).filter(function (r) { return typeof r === 'string'; }),
          // A role that can hand out roles can hand out its own superiors'.
          manageAllRoles: !!ur.ManageAllRoles,
          manageableRoles: payload(ur.ManageableRoles).filter(function (r) { return typeof r === 'string'; })
        });
      });
      result.security = readProjectSecurity(pdoc);
    }
    result.userRoles.sort(function (a, b) { return a.name.localeCompare(b.name); });

    // Pass 4: module roles. Every role a module declares lives in its own
    // one-per-module unit — which is the ONLY place a role that no access
    // rule happens to mention is written down at all. Without this a role
    // granted to a user but never used in a rule is invisible, and so is the
    // one line of text in which somebody explained what the role is for.
    var moduleSecurityRows = byContainment.get('ModuleSecurity') || [];
    for (var ms = 0; ms < moduleSecurityRows.length; ms++) {
      var msRow = moduleSecurityRows[ms];
      var owner = locationOf(msRow[col.ContainerID]).module;
      if (!owner) continue;
      var msDoc = await decodeUnit(msRow[col.UnitID]);
      if (!msDoc || msDoc['$Type'] !== 'Security$ModuleSecurity') continue;
      payload(msDoc.ModuleRoles).forEach(function (mr) {
        if (!mr || mr['$Type'] !== 'Security$ModuleRole' || !mr.Name) return;
        result.moduleRoles.push({
          module: owner, name: mr.Name, qualifiedName: owner + '.' + mr.Name,
          description: typeof mr.Description === 'string' && mr.Description ? mr.Description : null
        });
      });
    }
    result.moduleRoles.sort(function (a, b) { return a.qualifiedName.localeCompare(b.qualifiedName); });

    // Pass 5: resolve every collected reference onto the thing it names.
    // A name that matches nothing in the model is dropped without ceremony:
    // it is a layout, a snippet, a page template or a document type MxScout
    // does not model, and none of those are things this can be wrong about.
    //
    // Two lookups, not one, and each holds a LIST: a qualified name does not
    // identify a document (see REFERENCE_KEYS). The property that carried the
    // name says whether a flow or a page was meant, so that is where it goes —
    // and because a list cannot be overwritten, two documents of one kind
    // sharing a name both get the reference rather than one of them silently
    // taking it. No such pair exists in the four projects measured; this is
    // simply the shape that cannot have the bug.
    var flowByName = new Map();
    var pageByName = new Map();
    function index(map, item, kind) {
      if (!map.has(item.qualifiedName)) map.set(item.qualifiedName, []);
      map.get(item.qualifiedName).push({ item: item, kind: kind });
    }
    result.microflows.forEach(function (item) { index(flowByName, item, 'microflow'); });
    result.nanoflows.forEach(function (item) { index(flowByName, item, 'nanoflow'); });
    result.pages.forEach(function (item) { index(pageByName, item, 'page'); });

    referenceSources.forEach(function (source) {
      source.refs.forEach(function (ref) {
        var targets = [];
        if (ref.wants !== 'page') targets = targets.concat(flowByName.get(ref.name) || []);
        if (ref.wants !== 'flow') targets = targets.concat(pageByName.get(ref.name) || []);
        targets.forEach(function (found) {
          var target = found.item;
          // Itself means the same name AND the same kind — a flow that calls
          // itself. The microflow `SpecialForms.EditForm` opening the PAGE of
          // that name is not a self-reference, and a check on the name alone
          // would drop exactly the references this split exists to get right.
          if (target.qualifiedName === source.name && found.kind === source.kind) return;
          if (target.calledBy.some(function (c) { return c.name === source.name && c.kind === source.kind; })) return;
          target.calledBy.push({ kind: source.kind, name: source.name });
        });
      });
    });
    ['microflows', 'nanoflows', 'pages'].forEach(function (key) {
      result[key].forEach(function (target) {
        // A source with no name of its own — the project's navigation document
        // is the one that matters — sorts by what it IS instead.
        target.calledBy.sort(function (a, b) {
          return (a.name || a.kind).localeCompare(b.name || b.kind);
        });
      });
    });
    // Says that this model was built by a reader that looked. Without it, an
    // empty calledBy on an older model would read as "nothing reaches this",
    // which is a very different claim from "nobody checked".
    result.meta.knowsCallSites = true;

    return sortModel(result);
  }

  root.MxMpr = { blobToGuid: blobToGuid, payload: payload, idHex: idHex, buildModel: buildModel,
    applyAssociationDefaults: applyAssociationDefaults, activityKicker: activityKicker };
})(typeof self !== 'undefined' ? self : this);
