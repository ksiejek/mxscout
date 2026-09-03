/* MxScout — turns a decoded .mpr `Unit` table into the same canonical model
 * shape MxScout already consumes from an MxSonar JSON export (see
 * public/app.js's parseModelText). Ported from MxSonar's mprDirectSource.js
 * — same on-disk format, same $Type-shaped BSON documents — but reading via
 * MxSqlite/MxBson instead of `sql.js`/`bson`, and trimmed to the fields
 * MxScout's UI actually renders.
 *
 * SCOPE CUT, checked by grep across public/*.js before writing this: MxScout
 * never reads `calledBy`, `javaActionCalls`, `entityRefs`, `constantRefs`,
 * `enumerationRefs`, `xpathReferencedEntities`, or the `javaActions` /
 * `constants` / `enumerations` lists — that is MxSonar's architecture-graph
 * feature, which MxScout doesn't have. Those fields stay on the model shape
 * (empty), so a real MxSonar export still loads unmodified, but nothing here
 * computes them — no deepFindByType call-graph scanning.
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
      modules: [], entities: [], associations: [], userRoles: [],
      microflows: [], nanoflows: [], pages: [],
      javaActions: [], constants: [], enumerations: []
    };
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
    return model;
  }

  // ---------------- the model builder ----------------
  // input: { mprBytes: Uint8Array|ArrayBuffer,
  //          readContentsFile: (relativePath) => Promise<ArrayBuffer|null>,
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
    var entityById = new Map(); // hex($ID) -> { qn, entity }
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
              var assocName = shortName(m.Association);
              if (letter) assocAccess[assocName] = letter; else delete assocAccess[assocName];
            }
          });

          var xpathConstraint = typeof rule.XPathConstraint === 'string' && rule.XPathConstraint ? rule.XPathConstraint : null;
          roles.forEach(function (role) {
            entity.accessRules.push({
              moduleRole: role,
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
        result.associations.push({
          name: a.Name, module: pm.moduleName,
          owner: owner.qn, ownerMultiplicity: null,
          other: other.qn, otherMultiplicity: null,
          type: a.Type || null
        });
      });

      payload(pm.doc.CrossAssociations).forEach(function (a) {
        if (!a || a['$Type'] !== 'DomainModels$CrossAssociation') return;
        var owner = entityById.get(idHex(a.ParentPointer));
        if (!owner || !a.Child) return;
        result.associations.push({
          name: a.Name, module: pm.moduleName,
          owner: owner.qn, ownerMultiplicity: null,
          other: a.Child, otherMultiplicity: null,
          type: a.Type || null
        });
      });
    });

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
        if (type === 'Microflows$Microflow' || type === 'Microflows$Nanoflow' || type === 'Forms$Page') {
          var moduleName = resolveOwningModule(docRow[col.ContainerID]);
          if (moduleName) {
            var qn = moduleName + '.' + raw.Name;
            var allowedModuleRoles = payload(raw.AllowedModuleRoles).filter(function (r) { return typeof r === 'string'; });
            var parameters = extractParameters(entityById, raw);
            if (type === 'Microflows$Microflow') {
              result.microflows.push({
                module: moduleName, name: raw.Name, qualifiedName: qn,
                allowedModuleRoles: allowedModuleRoles, applyEntityAccess: !!raw.ApplyEntityAccess,
                parameters: parameters, calledBy: [], javaActionCalls: [], entityRefs: [], constantRefs: [], enumerationRefs: []
              });
            } else if (type === 'Microflows$Nanoflow') {
              result.nanoflows.push({
                module: moduleName, name: raw.Name, qualifiedName: qn,
                allowedModuleRoles: allowedModuleRoles,
                parameters: parameters, calledBy: [], javaActionCalls: [], entityRefs: [], constantRefs: [], enumerationRefs: []
              });
            } else {
              result.pages.push({
                module: moduleName, name: raw.Name, qualifiedName: qn,
                allowedModuleRoles: allowedModuleRoles, parameters: parameters, calledBy: []
              });
            }
          }
        }
      }
      report('Reading microflows, nanoflows and pages', d + 1, documentRows.length);
    }

    // Pass 3: the project's Security screen — bundles per-module Module
    // Roles (e.g. "Sales.Manager") into the app-level roles a user is
    // actually assigned (e.g. "Manager"). Lives alongside Navigation/
    // Settings/Texts under the small 'ProjectDocuments' containment slot.
    var projectDocRows = byContainment.get('ProjectDocuments') || [];
    for (var p = 0; p < projectDocRows.length; p++) {
      var pdoc = await decodeUnit(projectDocRows[p][col.UnitID]);
      if (!pdoc || pdoc['$Type'] !== 'Security$ProjectSecurity') continue;
      payload(pdoc.UserRoles).forEach(function (ur) {
        if (!ur || ur['$Type'] !== 'Security$UserRole' || !ur.Name) return;
        result.userRoles.push({
          name: ur.Name,
          moduleRoles: payload(ur.ModuleRoles).filter(function (r) { return typeof r === 'string'; })
        });
      });
    }
    result.userRoles.sort(function (a, b) { return a.name.localeCompare(b.name); });

    return sortModel(result);
  }

  root.MxMpr = { blobToGuid: blobToGuid, payload: payload, idHex: idHex, buildModel: buildModel };
})(typeof self !== 'undefined' ? self : this);
