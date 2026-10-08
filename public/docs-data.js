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
      rows: rows
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

  // ---------- the whole documentation ----------
  // opts.modules — when given, only these module names go in (the export always
  // names which modules to carry; the app passes nothing and shows them all).
  // opts.comments — the project's findings (comments.js), carried into the
  // documentation with their severity and whether they are fixed; they always
  // travel with the export.
  function build(model, project, opts) {
    model = model || {};
    opts = opts || {};
    var modSet = null;
    if (opts.modules) { modSet = {}; opts.modules.forEach(function (n) { modSet[n] = true; }); }
    function inc(name) { return !modSet || !!modSet[name]; }
    var own = (model.modules || []).filter(function (m) { return !m.fromAppStore && inc(m.name); }).map(function (m) { return m.name; });
    var marketplace = (model.modules || []).filter(function (m) { return m.fromAppStore && inc(m.name); }).map(function (m) { return m.name; });
    var modules = {};
    (model.modules || []).forEach(function (m) {
      if (!inc(m.name)) return;
      modules[m.name] = { name: m.name, marketplace: !!m.fromAppStore, microflows: [], nanoflows: [], pages: [], entities: [] };
    });
    function mod(name) { return modules[name] || (modules[name] = { name: name, marketplace: false, microflows: [], nanoflows: [], pages: [], entities: [] }); }

    var flows = {};
    function flowEntry(f, kind) {
      var wf = workflow(f);
      var calls = [];
      ((f.graph && f.graph.nodes) || []).forEach(function (n) {
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
        workflow: wf ? wf.tree : null, steps: wf ? wf.steps : 0, drawn: !!wf, comments: []
      };
    }
    (model.microflows || []).forEach(function (f) { if (!inc(f.module)) return; var e = flowEntry(f, 'microflow'); flows[e.key] = e; mod(f.module).microflows.push(e.key); });
    (model.nanoflows || []).forEach(function (f) { if (!inc(f.module)) return; var e = flowEntry(f, 'nanoflow'); flows[e.key] = e; mod(f.module).nanoflows.push(e.key); });
    (model.pages || []).forEach(function (p) {
      if (!inc(p.module)) return;
      var e = { key: 'page:' + p.qualifiedName, kind: 'page', module: p.module, name: p.name, qn: p.qualifiedName, path: p.path || [],
        roles: p.allowedModuleRoles || [], params: (p.parameters || []).map(function (x) { return { name: x.name, type: x.entityQualifiedName || x.type || 'value' }; }),
        calledBy: (p.calledBy || []).map(function (c) { return { kind: c.kind, qn: c.name }; }), comments: [] };
      flows[e.key] = e; mod(p.module).pages.push(e.key);
    });

    var entities = {};
    (model.entities || []).forEach(function (en) {
      if (!inc(en.module)) return;
      var rules = en.accessRules || [];
      entities[en.qualifiedName] = {
        qn: en.qualifiedName, module: en.module, name: en.name, persistable: en.persistable !== false,
        generalization: en.generalization || null, view: !!en.viewEntity,
        attributes: (en.attributes || []).map(function (a) { return { name: a.name, type: a.enumerationQualifiedName ? 'Enumeration ' + a.enumerationQualifiedName : a.type + (a.length ? '(' + a.length + ')' : '') }; }),
        roles: rules.map(function (r) { return r.moduleRole; }).filter(function (v, i, all) { return v && all.indexOf(v) === i; }),
        rules: rules.length, comments: []
      };
      mod(en.module).entities.push(en.qualifiedName);
    });
    var associations = (model.associations || []).filter(function (a) { return inc(a.module); }).map(function (a) {
      return { name: a.name, module: a.module, from: a.owner, to: a.other, many: a.type === 'ReferenceSet' };
    });

    // ---------- findings (comments.js), carried with their colour and state ----------
    var SEVRANK = { critical: 0, high: 1, medium: 2, low: 3 };
    var STRANK = { open: 0, wontfix: 1, fixed: 2 };
    var comments = [];
    (opts.comments || []).forEach(function (f) {
      if (!f || !f.target) return;
      var t = f.target;
      var cmod = t.module || (t.qualifiedName ? t.qualifiedName.split('.')[0] : null);
      if (!inc(cmod)) return;
      comments.push({
        severity: SEVRANK[f.severity] !== undefined ? f.severity : 'medium',
        status: STRANK[f.status] !== undefined ? f.status : 'open',
        kind: t.kind || null, module: cmod, qn: t.qualifiedName || null,
        name: t.name || (t.qualifiedName ? shortName(t.qualifiedName) : null),
        problem: f.problem || '', change: f.change || null, role: f.role || null,
        author: f.author || null, createdAt: f.createdAt || null,
        attributes: (t.attributes || []).slice()
      });
    });
    comments.sort(function (a, b) {
      return (STRANK[a.status] - STRANK[b.status]) || (SEVRANK[a.severity] - SEVRANK[b.severity]) || String(a.qn).localeCompare(String(b.qn));
    });
    comments.forEach(function (c) {
      if (!c.qn) return;
      if (c.kind === 'entity') { if (entities[c.qn]) entities[c.qn].comments.push(c); }
      else { var key = (c.kind || '') + ':' + c.qn; if (flows[key]) flows[key].comments.push(c); }
    });

    // ---------- where the model looks unfinished ----------
    var unreached = Object.keys(flows).filter(function (k) {
      var f = flows[k];
      // A microflow with roles is reachable from the client; a page or nanoflow with roles from navigation or a button.
      return !f.calledBy.length && !(f.roles && f.roles.length) && !(modules[f.module] && modules[f.module].marketplace);
    }).sort();
    var noAccess = Object.keys(entities).filter(function (q) {
      var e = entities[q];
      return e.persistable && !e.rules && !(modules[e.module] && modules[e.module].marketplace);
    }).sort();
    var pastAccess = Object.keys(flows).filter(function (k) {
      var f = flows[k];
      return f.kind === 'microflow' && f.entityAccess === false && f.roles.length && !(modules[f.module] && modules[f.module].marketplace);
    }).sort();
    var disabled = 0;
    function countOff(list) { (list || []).forEach(function (b) { if (b.card && b.card.off) disabled++; ['body', 'error'].forEach(function (k) { countOff(b[k]); }); (b.branches || []).forEach(function (x) { countOff(x.body); }); }); }
    Object.keys(flows).forEach(function (k) { countOff(flows[k].workflow); });

    var moduleOf = function (qn) { return qn ? String(qn).split('.')[0] : null; };
    var automation = (model.automation || []).filter(function (a) { return a.kind === 'scheduled event' && inc(moduleOf(a.microflow || a.qualifiedName)); });
    var services = (model.publishedServices || []).filter(function (s) { return inc(moduleOf(s.qualifiedName || s.name)); });
    // Counts are of what actually went in, so a filtered export reports itself, not the whole app.
    var nMF = 0, nNF = 0, nPG = 0;
    Object.keys(flows).forEach(function (k) { var kind = flows[k].kind; if (kind === 'microflow') nMF++; else if (kind === 'nanoflow') nNF++; else if (kind === 'page') nPG++; });
    return {
      v: 1,
      project: project ? project.name : (model.meta && model.meta.appName) || 'Mendix application',
      app: (model.meta && model.meta.appName) || null,
      mendix: (model.meta && model.meta.mendixVersion) || null,
      generatedAt: new Date().toISOString(),
      partial: !!modSet,
      drawings: Object.keys(flows).some(function (k) { return flows[k].drawn; }),
      kpi: {
        modules: own.length, marketplace: marketplace.length,
        microflows: nMF, nanoflows: nNF, pages: nPG,
        entities: Object.keys(entities).length, roles: (model.userRoles || []).length,
        scheduled: automation.length, scheduledOn: automation.filter(function (a) { return a.enabled; }).length,
        services: services.length,
        findings: comments.length, findingsOpen: comments.filter(function (c) { return c.status === 'open'; }).length
      },
      modules: Object.keys(modules).sort(function (a, b) {
        return (modules[a].marketplace - modules[b].marketplace) || a.localeCompare(b);
      }).map(function (k) { return modules[k]; }),
      flows: flows, entities: entities, associations: associations,
      roles: (model.userRoles || []).map(function (r) { return { name: r.name, moduleRoles: r.moduleRoles || [] }; }),
      scheduled: automation.map(function (a) { return { name: a.qualifiedName, microflow: a.microflow, schedule: a.schedule || null, enabled: !!a.enabled }; }),
      services: services.map(function (s) { return { name: s.qualifiedName || s.name, kind: s.kind || null }; }),
      comments: comments,
      quality: { unreached: unreached, noAccess: noAccess, pastAccess: pastAccess, disabled: disabled }
    };
  }

  window.MxDocsData = { build: build, workflow: workflow };
})();
