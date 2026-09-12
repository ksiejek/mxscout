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
      javaActions: [], constants: [], enumerations: [],
      publishedServices: [], automation: [],
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

  // The rest of the project's Security screen, the part that decides whether
  // everything else MxScout shows about roles is enforced at run time at all.
  //
  // SECRETS ARE READ AS FACTS, NEVER AS VALUES. The admin password and every
  // demo user's password sit in this document in plain text — that they are
  // set is worth knowing and worth saying; the values themselves are not
  // MxScout's to carry, because carrying them would put somebody else's
  // passwords into this browser's database and into every .mxscout package
  // made from it. So: a boolean, and the user names and roles that go with
  // them. Deliberate, and the About page says it in these terms.
  function readProjectSecurity(doc) {
    var policy = doc.PasswordPolicySettings;
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
          passwordSet: typeof u.Password === 'string' && u.Password !== ''
        };
      }),
      adminUserName: str(doc, 'AdminUserName'),
      adminUserRole: str(doc, 'AdminUserRole'),
      adminPasswordSet: typeof doc.AdminPassword === 'string' && doc.AdminPassword !== '',
      passwordPolicy: policy && typeof policy === 'object' ? {
        minimumLength: typeof policy.MinimumLength === 'number' ? policy.MinimumLength : null,
        requireDigit: bool(policy, 'RequireDigit', false),
        requireMixedCase: bool(policy, 'RequireMixedCase', false),
        requireSymbol: bool(policy, 'RequireSymbol', false)
      } : null
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
          } else if (source.AssociationId) {
            // An association retrieve names the association by id, not by
            // name, and which END it lands on depends on where it started —
            // so it resolves through the association and then picks the end
            // that is not where it came from, when that is known.
            var assoc = ctx.associationById.get(idHex(source.AssociationId));
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
          add(out.calls, typeof action.Nanoflow === 'string' ? action.Nanoflow : null);
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
  var REFERENCE_KEYS = { Microflow: 1, Nanoflow: 1, Form: 1, Page: 1, AuthenticationMicroflow: 1 };

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
        if (REFERENCE_KEYS[keys[k]] === 1 && value) into[value] = true;
      } else {
        collectReferences(value, into);
      }
    }
    return into;
  }

  // What a source IS, in the words a tester would use for it. Anything not
  // listed falls back to the type's own name rather than being dropped — a
  // reference from a shape this does not recognise is still a reference.
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
    'Queues$Queue': 'queue'
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
    return model;
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
    var associationById = new Map(); // hex($ID) -> the association it names
    // One entry per document that names anything: { kind, name, refs }. The
    // names cannot be resolved while this is being collected — the document
    // doing the naming is often read before the one being named — so they are
    // resolved in one pass at the end.
    var referenceSources = [];
    function noteReferences(kindType, name, doc) {
      var refs = collectReferences(doc, {});
      var names = Object.keys(refs);
      if (names.length) referenceSources.push({ kind: sourceKindOf(kindType), name: name, refs: names });
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
        // Indexed by its own id because a microflow's association-based
        // retrieve is the one reference in a flow body that is NOT by name.
        associationById.set(idHex(a['$ID']), assoc);
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
        associationById.set(idHex(a['$ID']), cross);
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

    // Pass 2b: Documents — microflows, nanoflows and pages only (see the
    // file header for what MxSonar computes here that MxScout doesn't need).
    // v2 projects can nest documents inside Folder units rather than putting
    // them directly under the module, so the owning module isn't always the
    // immediate ContainerID — walk upward until a unit ID IS a module's.
    function resolveOwningModule(containerIdBytes) {
      var current = containerIdBytes;
      for (var depth = 0; current && depth < 20; depth++) {
        var hex = idHex(current);
        if (hex && moduleUnitIndex.has(hex)) return moduleUnitIndex.get(hex);
        current = getContainerId(current);
      }
      return null;
    }

    var documentRows = byContainment.get('Documents') || [];
    report('Reading microflows, nanoflows and pages', 0, documentRows.length);
    for (var d = 0; d < documentRows.length; d++) {
      var docRow = documentRows[d];
      var raw = await decodeUnit(docRow[col.UnitID]);
      if (raw && typeof raw.Name === 'string' && raw.Name) {
        var type = raw['$Type'];
        var ownerModule = resolveOwningModule(docRow[col.ContainerID]);
        // EVERY document is a possible source of a reference, not only the
        // three kinds MxScout models: a scheduled event, a published REST
        // operation, a snippet's button and a menu item all name a flow, and
        // a flow nothing else names is the whole point of reading them.
        noteReferences(type, (ownerModule ? ownerModule + '.' : '') + raw.Name, raw);
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
              var activity = readFlowActivity(raw, { parameters: parameters, associationById: associationById });
              var entityRefs = activity
                ? activity.reads.concat(activity.creates, activity.changes, activity.deletes, activity.commits)
                  .filter(function (v, i, all) { return v && all.indexOf(v) === i; }).sort()
                : [];
              var flow = {
                module: moduleName, name: raw.Name, qualifiedName: qn,
                allowedModuleRoles: allowedModuleRoles,
                parameters: parameters, activity: activity,
                calledBy: [], javaActionCalls: activity ? activity.javaActions : [],
                entityRefs: entityRefs, constantRefs: [], enumerationRefs: []
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
              result.pages.push({
                module: moduleName, name: raw.Name, qualifiedName: qn,
                allowedModuleRoles: allowedModuleRoles, parameters: parameters, calledBy: []
              });
            }
          }
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
      var owner = resolveOwningModule(msRow[col.ContainerID]);
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
    var targetByName = new Map();
    ['microflows', 'nanoflows', 'pages'].forEach(function (key) {
      result[key].forEach(function (item) { targetByName.set(item.qualifiedName, item); });
    });
    referenceSources.forEach(function (source) {
      source.refs.forEach(function (name) {
        var target = targetByName.get(name);
        if (!target || target.qualifiedName === source.name) return;
        if (target.calledBy.some(function (c) { return c.name === source.name && c.kind === source.kind; })) return;
        target.calledBy.push({ kind: source.kind, name: source.name });
      });
    });
    targetByName.forEach(function (target) {
      // A source with no name of its own — the project's navigation document
      // is the one that matters — sorts by what it IS instead.
      target.calledBy.sort(function (a, b) {
        return (a.name || a.kind).localeCompare(b.name || b.kind);
      });
    });
    // Says that this model was built by a reader that looked. Without it, an
    // empty calledBy on an older model would read as "nothing reaches this",
    // which is a very different claim from "nobody checked".
    result.meta.knowsCallSites = true;

    return sortModel(result);
  }

  root.MxMpr = { blobToGuid: blobToGuid, payload: payload, idHex: idHex, buildModel: buildModel,
    applyAssociationDefaults: applyAssociationDefaults };
})(typeof self !== 'undefined' ? self : this);
