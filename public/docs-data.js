/* MxScout — documentation, the data.
 *
 * Turns the model MxScout has already read into the documentation a reader
 * opens: modules, every microflow, nanoflow and page with what it takes, what
 * it returns, who may run it, what it calls and what reaches it, the domain
 * model, and the places where the model looks unfinished. Nothing here is
 * written by a person or guessed by a machine — every line is read from the
 * project, which is why it can be rebuilt each time a model is loaded and why
 * it never goes stale.
 *
 * The one thing it computes rather than copies is the WORKFLOW of a flow: the
 * drawing Studio Pro keeps (flow.graph) folded into the shape a document reads
 * top to bottom — a sequence of steps, a decision whose branches sit side by
 * side and join again, a loop as a frame, an error handler to the side.
 *
 * The result is plain data (JSON-safe), because the same object is drawn in
 * the app and travels — encrypted — inside the exported file.
 */
(function () {
  'use strict';

  // ---------- one step, as a card ----------
  var FAMILY = {
    RetrieveAction: 'db', AggregateListAction: 'db',
    CreateObjectAction: 'obj', CreateChangeAction: 'obj', ChangeObjectAction: 'obj', ChangeAction: 'obj', CastAction: 'obj',
    CommitAction: 'save', DeleteAction: 'save', RollbackAction: 'save',
    MicroflowCallAction: 'call', NanoflowCallAction: 'call', JavaActionCallAction: 'ext', JavaScriptActionCallAction: 'ext',
    ShowFormAction: 'ui', ShowPageAction: 'ui', CloseFormAction: 'ui', ShowHomePageAction: 'ui', DownloadFileAction: 'ui',
    ShowMessageAction: 'msg', ValidationFeedbackAction: 'msg', LogMessageAction: 'msg',
    RestCallAction: 'ext', RestOperationCallAction: 'ext', WebServiceCallAction: 'ext', ImportXmlAction: 'ext', ExportXmlAction: 'ext',
    CallExternalAction: 'ext',
    CreateVariableAction: 'var', ChangeVariableAction: 'var', CreateListAction: 'var', ChangeListAction: 'var', ListOperationAction: 'var'
  };
  var KIND_NAME = {
    start: 'Start', end: 'End', errorEvent: 'Error end', break: 'Break', continue: 'Continue',
    decision: 'Decision', objectTypeDecision: 'Object type decision', merge: 'Merge', loop: 'Loop', activity: 'Activity'
  };
  function shortName(qn) { return String(qn || '').split('.').pop(); }
  function words(type) { return String(type || '').replace(/Action$/, '').replace(/([a-z])([A-Z])/g, '$1 $2'); }

  function card(n, ctx) {
    var fam = n.kind === 'activity' ? (FAMILY[n.action] || 'act') : 'act';
    var callKind = n.action === 'MicroflowCallAction' ? 'microflow' : n.action === 'NanoflowCallAction' ? 'nanoflow'
      : (n.action === 'ShowFormAction' || n.action === 'ShowPageAction') ? 'page' : null;
    var other = n.ref && n.ref.indexOf('.') > 0 && n.ref.split('.')[0] !== ctx.module ? n.ref.split('.')[0] : null;
    var rows = [];
    if (n.action) rows.push(['Action', words(n.action)]);
    if (n.meta) rows.push([n.kind === 'activity' ? 'Detail' : 'Value', n.meta]);
    if (n.ref) rows.push(['Refers to', n.ref]);
    if (n.caption && n.caption !== n.title) rows.push(['Caption', n.caption]);
    if (ctx.errorFrom[n.id]) rows.push(['On error', 'continues on its own error path']);
    if (n.disabled) rows.push(['State', 'disabled — Studio Pro skips this step']);
    return {
      fam: fam,
      kick: (n.kicker || KIND_NAME[n.kind] || n.kind) + (other && callKind ? ' · ' + other : ''),
      title: n.title || n.caption || n.kicker || KIND_NAME[n.kind] || n.kind,
      detail: n.meta || null,
      ref: callKind && n.ref ? { kind: callKind, qn: n.ref } : null,
      off: !!n.disabled,
      err: !!ctx.errorFrom[n.id],
      doc: n.documentation || null,
      rows: rows,
      // The data the step works with — members set, or arguments passed —
      // straight from the model (mpr.js activityFields). Null when the step
      // has none, or when the model came from a reader that did not keep it.
      fields: Array.isArray(n.fields) && n.fields.length ? n.fields : null,
      creates: n.action === 'CreateChangeAction' || n.action === 'CreateListAction'
    };
  }

  // ---------- the drawing, folded into a document ----------
  function workflow(flow) {
    var g = flow && flow.graph;
    if (!g || !g.nodes || !g.nodes.length) return null;
    var nodes = {}, out = {}, inn = {};
    g.nodes.forEach(function (n) {
      if (n.kind === 'annotation' || n.kind === 'parameter') return;
      nodes[n.id] = n;
    });
    (g.edges || []).forEach(function (e) {
      if (e.kind === 'annotation' || !nodes[e.from] || !nodes[e.to]) return;
      (out[e.from] = out[e.from] || []).push(e);
      (inn[e.to] = inn[e.to] || []).push(e);
    });
    var errorFrom = {};
    Object.keys(out).forEach(function (id) { if (out[id].some(function (e) { return e.isError; })) errorFrom[id] = true; });
    var cOf = function (id) { return (nodes[id] && nodes[id].parentId && nodes[nodes[id].parentId]) ? nodes[id].parentId : ''; };
    var ctx = { module: flow.module, errorFrom: errorFrom };

    // Flow order: a depth-first walk from the start, the order a reader meets the steps in.
    var pos = {}, k = 0;
    var start = g.nodes.filter(function (n) { return n.kind === 'start' && !n.parentId; })[0];
    (function walk(id) {
      if (!nodes[id] || pos[id] !== undefined) return;
      pos[id] = k++;
      if (nodes[id].kind === 'loop') {
        Object.keys(nodes).filter(function (c) { return nodes[c].parentId === id; }).forEach(walk);
      }
      (out[id] || []).forEach(function (e) { walk(e.to); });
    })(start ? start.id : g.nodes[0].id);
    Object.keys(nodes).forEach(function (id) { if (pos[id] === undefined) pos[id] = k++; });

    function reach(id, c) {
      var seen = {}, q = [id];
      while (q.length) {
        var n = q.shift();
        if (seen[n] || !nodes[n] || cOf(n) !== c) continue;
        seen[n] = 1;
        (out[n] || []).forEach(function (e) { q.push(e.to); });
      }
      return seen;
    }
    function joinOf(targets, c) {
      var sets = targets.map(function (t) { return reach(t, c); });
      var common = Object.keys(sets[0]).filter(function (id) { return sets.every(function (s) { return s[id]; }); });
      common.sort(function (a, b) { return pos[a] - pos[b]; });
      return common[0] || null;
    }
    function ends(list) {
      var last = list[list.length - 1];
      if (!last) return false;
      if (last.t === 'go' || last.t === 'end') return true;
      if (last.t === 'split') return !last.after && last.branches.every(function (b) { return b.ends; });
      return false;
    }
    var drawn = {}, number = {}, no = 0;
    function label(e) {
      if (e.isError) return 'error';
      if (e.caseValue === null || e.caseValue === undefined) return null;
      return e.caseKind === 'inheritance' ? shortName(e.caseValue) : String(e.caseValue);
    }
    function terminal(n) {
      var lab = n.kind === 'errorEvent' ? 'Error end' : n.kind === 'break' ? 'Break loop' : n.kind === 'continue' ? 'Next iteration' : 'End';
      return { t: 'end', kind: n.kind, label: lab, returns: n.kind === 'end' && n.returnValue ? String(n.returnValue).replace(/\s+/g, ' ') : null, id: n.id };
    }
    function seq(id, stop, c) {
      var list = [];
      while (id && id !== stop) {
        var n = nodes[id];
        if (!n || cOf(id) !== c) break;
        if (drawn[id]) { list.push({ t: 'go', no: number[id] || null }); break; }
        drawn[id] = true;
        var outs = out[id] || [];
        var normal = outs.filter(function (e) { return !e.isError; }), err = outs.filter(function (e) { return e.isError; });
        if (n.kind === 'merge') { id = normal.length ? normal[0].to : null; continue; }
        number[id] = ++no;
        if (n.kind === 'start') { list.push({ t: 'start' }); id = normal.length ? normal[0].to : null; continue; }
        if (n.kind === 'end' || n.kind === 'errorEvent' || n.kind === 'break' || n.kind === 'continue') { list.push(terminal(n)); break; }
        if (n.kind === 'loop') {
          var kids = Object.keys(nodes).filter(function (x) { return nodes[x].parentId === id; }).sort(function (a, b) { return pos[a] - pos[b]; });
          var first = kids.filter(function (x) { return !(inn[x] || []).some(function (e) { return nodes[e.from] && nodes[e.from].parentId === id; }); })[0] || kids[0];
          var lp = n.loop || {};
          list.push({ t: 'loop', no: no, each: lp.iteratorVariable ? '$' + lp.iteratorVariable : null, over: lp.listVariable ? '$' + lp.listVariable : null,
            cond: lp.mode === 'while' ? (lp.condition || '') : null, title: n.caption || null, body: first ? seq(first, null, id) : [] });
          id = normal.length ? normal[0].to : null;
          continue;
        }
        if (n.kind === 'decision' || n.kind === 'objectTypeDecision') {
          var targets = normal.map(function (e) { return e.to; });
          var join = targets.length > 1 ? joinOf(targets, c) : null;
          var dec = { t: 'split', no: no, kind: n.kind, title: n.title || n.caption || (n.kind === 'decision' ? 'Decision' : 'Which type?'),
            cond: n.expression || (n.rule ? 'rule ' + n.rule : null) || (n.variable ? '$' + n.variable : null), doc: n.documentation || null,
            branches: normal.map(function (e) { return { label: label(e), body: e.to === join ? [] : seq(e.to, join, c) }; }) };
          dec.branches.forEach(function (b) { b.ends = ends(b.body); });
          var going = dec.branches.filter(function (b) { return !b.ends; });
          list.push(dec);
          if (join && going.length === 1 && going[0].body.length) {
            // Only one branch goes on: the rest of the flow is drawn inside it.
            going[0].body = going[0].body.concat(seq(join, stop, c));
            going[0].ends = ends(going[0].body);
            return list;
          }
          if (join && going.length) dec.after = true;
          id = join;
          continue;
        }
        var step = { t: 'step', no: no, card: card(n, ctx) };
        if (err.length) step.error = seq(err[0].to, normal.length ? normal[0].to : null, c);
        list.push(step);
        id = normal.length ? normal[0].to : null;
      }
      return list;
    }
    var tree = seq(start ? start.id : g.nodes[0].id, null, '');
    // Steps nothing leads to are still part of the flow — kept at the end rather than lost.
    Object.keys(nodes).sort(function (a, b) { return pos[a] - pos[b]; }).forEach(function (id) {
      if (!drawn[id] && !nodes[id].parentId && nodes[id].kind !== 'merge') tree.push({ t: 'orphan', body: seq(id, null, '') });
    });
    return { steps: no, tree: tree };
  }


  // ---------- one microflow, nanoflow or page ----------
  // The same entry is drawn by the documentation and, on its own, by the flow
  // window in MxScout (objects.js) — one entry, one reader, so the two views
  // of a flow cannot drift apart.
  function flowEntry(f, kind) {
    var wf = workflow(f);
    var calls = [], exits = [];
    ((f.graph && f.graph.nodes) || []).forEach(function (n) {
      if (n.kind === 'end' || n.kind === 'errorEvent') {
        var value = n.kind === 'end' && n.returnValue ? String(n.returnValue).replace(/\s+/g, ' ').trim() : null;
        var label = n.kind === 'errorEvent' ? 'error' : (value || 'end');
        var known = exits.filter(function (x) { return x.label === label; })[0];
        if (known) known.count++; else exits.push({ label: label, error: n.kind === 'errorEvent', returns: value, count: 1 });
        return;
      }
      if (n.kind !== 'activity' || !n.ref) return;
      var k = n.action === 'MicroflowCallAction' ? 'microflow' : n.action === 'NanoflowCallAction' ? 'nanoflow'
        : (n.action === 'ShowFormAction' || n.action === 'ShowPageAction') ? 'page'
          : (n.action === 'JavaActionCallAction' || n.action === 'JavaScriptActionCallAction') ? 'action' : null;
      if (k && !calls.some(function (c) { return c.qn === n.ref && c.kind === k; })) calls.push({ kind: k, qn: n.ref });
    });
    var a = f.activity || {};
    return {
      key: kind + ':' + f.qualifiedName, kind: kind, module: f.module, name: f.name, qn: f.qualifiedName, path: f.path || [],
      roles: f.allowedModuleRoles || [], params: (f.parameters || []).map(function (p) {
        return { name: p.name, type: p.entityQualifiedName ? p.entityQualifiedName + (p.isList ? ' (list)' : '') : (p.type || 'value') };
      }),
      returns: f.returnType || null, doc: f.documentation || null,
      entityAccess: kind === 'microflow' ? f.applyEntityAccess !== false : true,
      reads: a.reads || [], writes: (a.creates || []).concat(a.changes || [], a.commits || [], a.deletes || []).filter(function (v, i, all) { return all.indexOf(v) === i; }),
      calls: calls, calledBy: (f.calledBy || []).map(function (c) { return { kind: c.kind, qn: c.name }; }),
      // Where it can end, and with what: one row per distinct ending.
      exits: exits,
      workflow: wf ? wf.tree : null, steps: wf ? wf.steps : 0, drawn: !!wf
    };
  }
  function pageEntry(p) {
    return { key: 'page:' + p.qualifiedName, kind: 'page', module: p.module, name: p.name, qn: p.qualifiedName, path: p.path || [],
      roles: p.allowedModuleRoles || [], params: (p.parameters || []).map(function (x) { return { name: x.name, type: x.entityQualifiedName || x.type || 'value' }; }),
      calledBy: (p.calledBy || []).map(function (c) { return { kind: c.kind, qn: c.name }; }), doc: p.documentation || null };
  }

  // ---------- the whole documentation ----------
  function build(model, project) {
    model = model || {};
    var own = (model.modules || []).filter(function (m) { return !m.fromAppStore; }).map(function (m) { return m.name; });
    var marketplace = (model.modules || []).filter(function (m) { return m.fromAppStore; }).map(function (m) { return m.name; });
    var modules = {};
    (model.modules || []).forEach(function (m) {
      modules[m.name] = { name: m.name, marketplace: !!m.fromAppStore, microflows: [], nanoflows: [], pages: [], entities: [] };
    });
    function mod(name) { return modules[name] || (modules[name] = { name: name, marketplace: false, microflows: [], nanoflows: [], pages: [], entities: [] }); }

    var flows = {};
    (model.microflows || []).forEach(function (f) { var e = flowEntry(f, 'microflow'); flows[e.key] = e; mod(f.module).microflows.push(e.key); });
    (model.nanoflows || []).forEach(function (f) { var e = flowEntry(f, 'nanoflow'); flows[e.key] = e; mod(f.module).nanoflows.push(e.key); });
    (model.pages || []).forEach(function (p) { var e = pageEntry(p); flows[e.key] = e; mod(p.module).pages.push(e.key); });

    var entities = {};
    (model.entities || []).forEach(function (en) {
      var rules = en.accessRules || [];
      entities[en.qualifiedName] = {
        qn: en.qualifiedName, module: en.module, name: en.name, persistable: en.persistable !== false,
        generalization: en.generalization || null, view: !!en.viewEntity, doc: en.documentation || null,
        attributes: (en.attributes || []).map(function (a) { return { name: a.name, type: a.enumerationQualifiedName ? 'Enumeration ' + a.enumerationQualifiedName : a.type + (a.length ? '(' + a.length + ')' : '') }; }),
        roles: rules.map(function (r) { return r.moduleRole; }).filter(function (v, i, all) { return v && all.indexOf(v) === i; }),
        rules: rules.length,
        // Who may do what with it, one entry per rule: the module role, the
        // user roles that carry it, how many members it reads and writes,
        // create and delete, and the XPath that limits the rows, kept exact.
        access: rules.map(function (r) {
          var members = [r.attrAccess || {}, r.assocAccess || {}];
          var read = 0, write = 0;
          members.forEach(function (m) { Object.keys(m).forEach(function (k) { if (m[k] === 'rw') write++; if (m[k] === 'r' || m[k] === 'rw') read++; }); });
          return {
            role: r.moduleRole,
            userRoles: (model.userRoles || []).filter(function (u) { return (u.moduleRoles || []).indexOf(r.moduleRole) !== -1; }).map(function (u) { return u.name; }),
            read: read, write: write, create: !!r.allowCreate, del: !!r.allowDelete,
            xpath: r.xpathConstraint || null
          };
        })
      };
      mod(en.module).entities.push(en.qualifiedName);
    });
    var associations = (model.associations || []).map(function (a) {
      return { name: a.name, module: a.module, from: a.owner, to: a.other, many: a.type === 'ReferenceSet' };
    });

    // ---------- where the model looks unfinished ----------
    var unreached = Object.keys(flows).filter(function (k) {
      var f = flows[k];
      // A microflow with roles is reachable from the client; a page or nanoflow with roles from navigation or a button.
      return !f.calledBy.length && !(f.roles && f.roles.length) && !(modules[f.module] && modules[f.module].marketplace);
    }).sort();
    var disabled = 0;
    function countOff(list) { (list || []).forEach(function (b) { if (b.card && b.card.off) disabled++; ['body', 'error'].forEach(function (k) { countOff(b[k]); }); (b.branches || []).forEach(function (x) { countOff(x.body); }); }); }
    Object.keys(flows).forEach(function (k) { countOff(flows[k].workflow); });

    var automation = (model.automation || []).filter(function (a) { return a.kind === 'scheduled event'; });
    return {
      v: 1,
      project: project ? project.name : (model.meta && model.meta.appName) || 'Mendix application',
      app: (model.meta && model.meta.appName) || null,
      mendix: (model.meta && model.meta.mendixVersion) || null,
      generatedAt: new Date().toISOString(),
      drawings: Object.keys(flows).some(function (k) { return flows[k].drawn; }),
      kpi: {
        modules: own.length, marketplace: marketplace.length,
        microflows: (model.microflows || []).length, nanoflows: (model.nanoflows || []).length, pages: (model.pages || []).length,
        entities: (model.entities || []).length, roles: (model.userRoles || []).length,
        scheduled: automation.length, scheduledOn: automation.filter(function (a) { return a.enabled; }).length,
        services: (model.publishedServices || []).length
      },
      modules: Object.keys(modules).sort(function (a, b) {
        return (modules[a].marketplace - modules[b].marketplace) || a.localeCompare(b);
      }).map(function (k) { return modules[k]; }),
      flows: flows, entities: entities, associations: associations,
      roles: (model.userRoles || []).map(function (r) { return { name: r.name, moduleRoles: r.moduleRoles || [] }; }),
      scheduled: automation.map(function (a) { return { name: a.qualifiedName, microflow: a.microflow, schedule: a.schedule || null, enabled: !!a.enabled }; }),
      services: (model.publishedServices || []).map(function (s) { return { name: s.qualifiedName || s.name, kind: s.kind || null }; }),
      quality: { unreached: unreached, disabled: disabled }
    };
  }

  window.MxDocsData = { build: build, workflow: workflow, flowEntry: flowEntry };
})();
