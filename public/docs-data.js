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
 * the app and travels inside the exported file.
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

  // A REST call's address: a constant or a host, a path, and a query made of
  // expressions — too long to stand in a step (Karol, 2026-10-13). The step
  // says the method and the last part of the path; the inspector shows the rest.
  var HTTP = /^(get|post|put|patch|delete|head|options)\b\s*/i;
  function splitTop(s, sep) {
    var out = [], depth = 0, q = false, cur = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === "'") q = !q;
      else if (!q && ch === '(') depth++;
      else if (!q && ch === ')') depth--;
      if (!q && !depth && ch === sep) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  }
  function restParts(text) {
    var s = String(text || '').trim();
    var m = HTTP.exec(s);
    var method = m ? m[1].toUpperCase() : null;
    var url = m ? s.slice(m[0].length).trim() : s;
    if (!url) return null;
    var qi = url.indexOf('?');
    var path = qi === -1 ? url : url.slice(0, qi);
    var base = /^(@[\w.]+|[a-z][\w+.-]*:\/\/[^/?]+)/i.exec(path);
    var rest = base ? path.slice(base[1].length) : path;
    var plain = rest.split('/').filter(function (x) { return x && /^[\w.~-]+$/.test(x) && !/^v\d+$/i.test(x); });
    var params = qi === -1 ? [] : splitTop(url.slice(qi + 1), '&').filter(Boolean).map(function (x) {
      var e = x.indexOf('='); return e === -1 ? [x, ''] : [x.slice(0, e), x.slice(e + 1)];
    });
    var name = plain.length ? plain[plain.length - 1] : base ? base[1].replace(/^@.*\./, '') : url.length > 32 ? url.slice(0, 31) + '…' : url;
    return { method: method, url: url, base: base ? base[1] : null, path: rest || null, params: params, name: name };
  }

  function card(n, ctx) {
    var rest = n.action === 'RestCallAction' ? restParts(n.title) : null;
    var fam = n.kind === 'activity' ? (FAMILY[n.action] || 'act') : 'act';
    var callKind = n.action === 'MicroflowCallAction' ? 'microflow' : n.action === 'NanoflowCallAction' ? 'nanoflow'
      : (n.action === 'ShowFormAction' || n.action === 'ShowPageAction') ? 'page' : null;
    var other = n.ref && n.ref.indexOf('.') > 0 && n.ref.split('.')[0] !== ctx.module ? n.ref.split('.')[0] : null;
    var rows = [];
    if (n.action) rows.push(['Action', words(n.action)]);
    if (n.meta) rows.push([n.kind === 'activity' ? 'Detail' : 'Value', n.meta]);
    if (rest) rows.push(['Address', rest.url]);
    if (n.ref) rows.push(['Refers to', n.ref]);
    if (n.caption && n.caption !== n.title) rows.push(['Caption', n.caption]);
    if (ctx.errorFrom[n.id]) rows.push(['On error', 'continues on its own error path']);
    if (n.disabled) rows.push(['State', 'disabled — Studio Pro skips this step']);
    return {
      fam: fam,
      kick: (n.kicker || KIND_NAME[n.kind] || n.kind) + (other && callKind ? ' · ' + other : ''),
      title: rest ? (rest.method ? rest.method + ' ' : '') + rest.name : n.title || n.caption || n.kicker || KIND_NAME[n.kind] || n.kind,
      detail: rest ? rest.url : n.meta || null,
      rest: rest,
      ref: callKind && n.ref ? { kind: callKind, qn: n.ref } : null,
      off: !!n.disabled,
      err: !!ctx.errorFrom[n.id],
      doc: n.documentation || null,
      rows: rows,
      // The data the step works with — members set, or arguments passed —
      // straight from the model (mpr.js activityFields). Null when the step
      // has none, or when the model came from a reader that did not keep it.
      fields: Array.isArray(n.fields) && n.fields.length ? n.fields : null,
      // What the step is in the model, for the step inspector and the Studio
      // Pro view: the action type as the file names it, the caption a person
      // typed (null when Studio Pro generates it), and the properties dialog's
      // settings (mpr.js activityProps). Null from a reader that kept none.
      action: n.action || null,
      caption: n.caption || null,
      props: n.props || null,
      creates: n.action === 'CreateChangeAction' || n.action === 'CreateListAction'
    };
  }

  // ---------- the drawing as Studio Pro has it ----------
  // Studio Pro keeps where every object stands (mpr.js reads it: the middle
  // point and the size, relative to the loop an object sits in) and which side
  // each line leaves and enters by. Karol, 2026-10-13: a big flow laid out
  // again by MxScout came out unreadable — "Mendix has them drawn already".
  // So the Studio Pro view draws this, not a layout of its own. Compact, as it
  // travels in the documentation file: per object [kind, x, y, w, h, loop
  // index or -1, step number or null, text]; per line [from, to, side out,
  // side in, label, error]. x and y are the top-left corner on the canvas.
  // Sides are Mendix's connection index: 0 top, 1 right, 2 bottom, 3 left.
  function canvasOf(g, number) {
    var list = (g.nodes || []).filter(function (n) { return n.at && n.size; });
    if (!list.length || list.length !== (g.nodes || []).length) return null;
    var ix = {}, byId = {};
    list.forEach(function (n, i) { ix[n.id] = i; byId[n.id] = n; });
    var abs = {};
    function corner(n) {
      if (abs[n.id]) return abs[n.id];
      var x = n.at.x - n.size.width / 2, y = n.at.y - n.size.height / 2;
      // inside a loop, the point is from the loop's top-left corner
      var p = n.parentId && byId[n.parentId] ? corner(byId[n.parentId]) : null;
      if (p) { x = p.x + n.at.x - n.size.width / 2; y = p.y + n.at.y - n.size.height / 2; }
      abs[n.id] = { x: x, y: y };
      return abs[n.id];
    }
    var nodesOut = list.map(function (n) {
      var c = corner(n);
      var text = n.kind === 'end' ? (n.returnValue ? String(n.returnValue).replace(/\s+/g, ' ').trim() : null)
        : n.kind === 'parameter' || n.kind === 'annotation' ? (n.caption || n.title || null)
        : (n.title || n.caption || null);
      return [n.kind, Math.round(c.x), Math.round(c.y), Math.round(n.size.width), Math.round(n.size.height),
        n.parentId && ix[n.parentId] !== undefined ? ix[n.parentId] : -1, number[n.id] || null, text];
    });
    var edgesOut = (g.edges || []).filter(function (e) { return ix[e.from] !== undefined && ix[e.to] !== undefined; }).map(function (e) {
      var lab = e.isError ? 'error' : e.caseValue === null || e.caseValue === undefined ? null : e.caseKind === 'inheritance' ? shortName(e.caseValue) : String(e.caseValue);
      return [ix[e.from], ix[e.to], typeof e.fromSide === 'number' ? e.fromSide : 1, typeof e.toSide === 'number' ? e.toSide : 3, lab, e.isError ? 1 : 0, e.kind === 'annotation' ? 1 : 0];
    });
    return { n: nodesOut, e: edgesOut };
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
      for (var at = 0; at < q.length; at++) {
        var n = q[at];
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
    // A jump to something already drawn. Its target is often a merge, which has
    // no number of its own, so the number is filled in once the whole flow is
    // numbered (numberJumps): the first numbered step at or after the target.
    // `back` says the jump closes a cycle — the flow goes back up and repeats.
    var jumps = [];
    function seq(id, stop, c, from) {
      var list = [];
      while (id && id !== stop) {
        var n = nodes[id];
        if (!n || cOf(id) !== c) break;
        if (drawn[id]) { var go = { t: 'go', no: null, back: !!(from && reach(id, c)[from]) }; jumps.push([go, id]); list.push(go); break; }
        drawn[id] = true;
        from = id;
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
            branches: normal.map(function (e) { return { label: label(e), body: e.to === join ? [] : seq(e.to, join, c, id) }; }) };
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
        if (err.length) step.error = seq(err[0].to, normal.length ? normal[0].to : null, c, id);
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
    jumps.forEach(function (j) {
      var id = j[1], seen = {};
      while (id && number[id] === undefined && nodes[id] && nodes[id].kind === 'merge' && !seen[id]) {
        seen[id] = 1;
        var nx = (out[id] || []).filter(function (e) { return !e.isError; })[0];
        id = nx ? nx.to : null;
      }
      j[0].no = (id && number[id]) || null;
    });
    return { steps: no, tree: tree, canvas: canvasOf(g, number) };
  }


  // ---------- one microflow, nanoflow or page ----------
  // The same entry is drawn by the documentation and, on its own, by the flow
  // window in MxScout (objects.js) — one entry, one reader, so the two views
  // of a flow cannot drift apart.
  //
  // Worked out once per flow and handed out as a copy after that. The
  // documentation is built from two models that hold the same flows — the
  // screens read the model with the System module added, the Documentation
  // section and its AI pack the model as read — and on a large project the
  // flows are most of that build. A copy, because a build writes its
  // descriptions onto its own entries (describe.js attach); everything else in
  // an entry is only read, by every reader. `same` (not enumerable, so not in
  // the file) is the entry it is a copy of: what is worked out from an entry
  // alone — its fingerprint, its lines in the pack — is worked out once for
  // all its copies (describe.js).
  var entries = typeof WeakMap === 'function' ? new WeakMap() : null;
  function flowEntry(f, kind) {
    var was = entries && entries.get(f);
    // A flow is not changed once read; if one ever is, its graph is a new one, and it is worked out again.
    if (!was || was.graph !== f.graph) { was = { graph: f.graph }; if (entries) entries.set(f, was); }
    var made = was[kind] || (was[kind] = flowEntryNow(f, kind));
    var e = Object.assign({}, made);
    Object.defineProperty(e, 'same', { value: made });
    return e;
  }
  function flowEntryNow(f, kind) {
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
      workflow: wf ? wf.tree : null, steps: wf ? wf.steps : 0, drawn: !!wf,
      canvas: wf ? wf.canvas : null
    };
  }
  function pageEntry(p, model) {
    return { key: 'page:' + p.qualifiedName, kind: 'page', module: p.module, name: p.name, qn: p.qualifiedName, path: p.path || [],
      roles: p.allowedModuleRoles || [], params: (p.parameters || []).map(function (x) { return { name: x.name, type: x.entityQualifiedName || x.type || 'value' }; }),
      calledBy: (p.calledBy || []).map(function (c) { return { kind: c.kind, qn: c.name }; }), doc: p.documentation || null,
      preview: pagePreview(p, model) };
  }
  // What pagepreview.js needs to draw a page, carried on the page's own entry
  // so the app and the exported file draw it from the same thing: the widget
  // tree (mpr.js readPageStructure), the snippets it places — and the ones
  // those place — and, for each attribute and entity the page names, only
  // what a drawing shows: the attribute's type and an enumeration's captions,
  // and whether an entity is stored. Null for a model read before pages were
  // read down to their widgets.
  function pagePreview(p, model) {
    if (!p.structure) return null;
    model = model || {};
    var ix = indexOf(model);
    var read = pageNames(p, model, ix), snippets = read.snippets, named = ix.dotless ? namesIn(read.text, false) : read.named;
    var hit = [];
    Object.keys(named).forEach(function (n) {
      var at = ix.byName[n];
      if (at) at.forEach(function (i) { hit[i] = true; });
    });
    var attributes = {}, entities = {};
    hit.forEach(function (yes, i) {
      var e = ix.entities[i];
      if (named[e.qualifiedName]) entities[e.qualifiedName] = { stored: e.persistable !== false, view: !!e.viewEntity };
      (e.attributes || []).forEach(function (a) {
        var q = e.qualifiedName + '.' + a.name;
        if (!named[q]) return;
        var vals = a.enumerationQualifiedName && ix.enums[a.enumerationQualifiedName];
        attributes[q] = vals ? { type: 'Enumeration', values: vals.map(function (v) { return v.caption || v.name; }) } : { type: a.type || null };
      });
    });
    return { structure: p.structure, snippets: snippets, attributes: attributes, entities: entities };
  }
  // The snippets a page places and every name it and they mention — the
  // costly part of a preview, and the same for every model the page is in
  // while the model's snippets are the same list: the screens and the
  // Documentation section build from two models that share their pages.
  var pageReads = typeof WeakMap === 'function' ? new WeakMap() : null;
  function pageNames(p, model, ix) {
    var was = pageReads && pageReads.get(p);
    var many = (model.snippets || []).length;
    if (was && was.structure === p.structure && was.list === model.snippets && was.many === many) return was;
    var snippets = {};
    (function place(structure) {
      (function walk(nodes) {
        (nodes || []).forEach(function (n) {
          if (n.kind === 'snippet' && n.snippet && !snippets[n.snippet] && ix.snippets[n.snippet] && ix.snippets[n.snippet].structure) {
            var s = ix.snippets[n.snippet];
            snippets[n.snippet] = { parameters: (s.parameters || []).map(function (x) { return { name: x.name, type: x.entityQualifiedName || x.type || 'value' }; }), structure: s.structure };
            place(s.structure);
          }
          walk(n.widgets); walk(n.footer);
        });
      })((structure.regions || []).reduce(function (all, r) { return all.concat(r.widgets || []); }, []));
    })(p.structure);
    var text = JSON.stringify(p.structure) + JSON.stringify(snippets) + JSON.stringify(p.parameters || []);
    var out = { structure: p.structure, list: model.snippets, many: many, snippets: snippets, text: text, named: namesIn(text, true) };
    if (pageReads) pageReads.set(p, out);
    return out;
  }

  // Every name the page and its snippets mention, read once: each run of text
  // between two quotes of the JSON (a quote opens the next run as well as
  // closing this one), so a name counts exactly when '"' + name + '"' is in
  // the text. Looked up by name, not searched for once per entity and
  // attribute of the model — that made a large project's documentation take
  // seconds to build. A run holding a backslash is part of an escaped string,
  // never a whole one. With `dotted`, only runs with a dot are kept: the names
  // looked up are qualified ones (Module.Entity, Module.Entity.Attribute), and
  // a page's text is mostly other words; a model with an entity named without
  // a module is read with every run (indexOf, dotless).
  function namesIn(text, dotted) {
    var named = Object.create(null), runs = text.split('"');
    for (var i = 1; i < runs.length - 1; i++) {
      var r = runs[i];
      if (r && r.indexOf('\\') === -1 && (!dotted || r.indexOf('.') !== -1)) named[r] = true;
    }
    return named;
  }

  // A model's snippets and enumerations by name, and which entity each
  // entity and attribute name belongs to (its place in model.entities, so a
  // page's entries come out in the model's order): worked out once per model,
  // not once per page.
  var indexes = typeof WeakMap === 'function' ? new WeakMap() : null;
  function indexOf(model) {
    var ix = indexes && indexes.get(model);
    // A model is not changed once read; if one ever is, its lists are new or longer, and this is worked out again.
    if (ix && ix.entities === model.entities && ix.counts === count(model)) return ix;
    ix = { snippets: Object.create(null), enums: Object.create(null), byName: Object.create(null), entities: model.entities || [], counts: count(model) };
    (model.snippets || []).forEach(function (s) { ix.snippets[s.qualifiedName] = s; });
    (model.enumerations || []).forEach(function (e) { ix.enums[e.qualifiedName] = e.values || []; });
    function add(name, i) {
      var at = ix.byName[name] || (ix.byName[name] = []);
      if (at[at.length - 1] !== i) at.push(i);
    }
    ix.entities.forEach(function (e, i) {
      if (String(e.qualifiedName).indexOf('.') === -1) ix.dotless = true;
      add(e.qualifiedName, i);
      (e.attributes || []).forEach(function (a) { add(e.qualifiedName + '.' + a.name, i); });
    });
    if (indexes) indexes.set(model, ix);
    return ix;
  }
  function count(model) { return [model.entities, model.snippets, model.enumerations].map(function (l) { return l ? l.length : 0; }).join(','); }

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
    (model.pages || []).forEach(function (p) { var e = pageEntry(p, model); flows[e.key] = e; mod(p.module).pages.push(e.key); });

    var entities = {};
    (model.entities || []).forEach(function (en) {
      var rules = en.accessRules || [];
      entities[en.qualifiedName] = {
        qn: en.qualifiedName, module: en.module, name: en.name, persistable: en.persistable !== false,
        generalization: en.generalization || null, view: !!en.viewEntity, doc: en.documentation || null,
        attributes: (en.attributes || []).map(function (a) { return { name: a.name, type: a.enumerationQualifiedName ? 'Enumeration ' + a.enumerationQualifiedName : a.type + (a.length ? '(' + a.length + ')' : '') }; }),
        roles: rules.map(function (r) { return r.moduleRole; }).filter(function (v, i, all) { return v && all.indexOf(v) === i; }),
        rules: rules.length,
        // What refuses a save (mpr.js readValidationRules), for the AI pack; most entities have none.
        validations: en.validations || [],
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
            xpath: r.xpathConstraint || null,
            // Each member's own access, name -> 'rw' | 'r' | '' — what "read 10 of 19" is made of.
            members: (function () { var o = {}; members.forEach(function (m) { Object.keys(m).forEach(function (k) { o[k.slice(k.lastIndexOf('.') + 1)] = m[k] || ''; }); }); return o; })(),
            // Which of those members are associations, so the AI pack can tell them from attributes.
            assocs: Object.keys(r.assocAccess || {}).map(function (k) { return k.slice(k.lastIndexOf('.') + 1); })
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
      // Which version of the app the model is, from the Mendix project's git (modelversion.js) — without its reflog.
      version: versionOf(model.version),
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

  // The model's version stamp, as text fields only: { commit, short, branch, date, message } — or null.
  function versionOf(v) {
    if (!v || typeof v !== 'object' || typeof v.commit !== 'string' || !/^[0-9a-f]{40,64}$/.test(v.commit)) return null;
    function s(x, n) { return typeof x === 'string' && x.trim() ? x.replace(/\s+/g, ' ').trim().slice(0, n) : null; }
    return { commit: v.commit, short: v.commit.slice(0, 7), branch: s(v.branch, 200), date: s(v.date, 40), message: s(v.message, 200) };
  }
  // One line for a text header (the AI pack, documentation.md): "main @ a1b2c3d · 2026-10-14 · Fix order status".
  function versionText(v) {
    v = versionOf(v);
    if (!v) return null;
    return [(v.branch ? v.branch + ' @ ' : '') + v.short, v.date ? v.date.slice(0, 10) : null, v.message].filter(Boolean).join(' · ');
  }

  window.MxDocsData = { versionOf: versionOf, versionText: versionText, build: build, workflow: workflow, flowEntry: flowEntry, pageEntry: pageEntry };
})();
