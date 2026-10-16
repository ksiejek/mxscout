/* MxScout — what a flow does with its variables.
 *
 * Read off the workflow docs-data.js already builds (MxDocsData.flowEntry),
 * never off the model a second time: which variables a microflow or nanoflow
 * has, where each one is set, changed, committed, deleted, read and returned
 * (def-use — Studio Pro calls it "Item usages"), a sentence per variable and
 * per step, the members a Create or Change object sets grouped by where their
 * values come from, and which branch of a decision the drawing keeps on the
 * main path. Redesign spec 02 §4.2, §5, §6. Nothing here draws anything: the
 * Microflows screen (microflows.js), the graph (flowgraph.js) and the Studio
 * Pro view (studioview.js) all read the same answers, so they cannot disagree.
 *
 * Every rule that the design only showed by example is marked [PROPOSAL] in
 * the spec and kept exactly as proposed there; where it was silent, the
 * comment says what was decided here.
 */
(function () {
  'use strict';

  var TOKEN = /\$([A-Za-z_][A-Za-z0-9_]*)/g;
  function tokens(text) {
    var out = [], m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(String(text || '')))) if (out.indexOf(m[1]) === -1) out.push(m[1]);
    return out;
  }
  function varName(text) { var m = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(String(text || '').trim()); return m ? m[1] : null; }
  function shortName(qn) { return String(qn || '').split('.').pop(); }

  // ---------- walking the workflow ----------
  // Every step, decision and end, in the order a reader meets them, with the
  // path that leads to it: [{ no, b, path: [{ split: no, label }] }].
  function walk(list, path, out) {
    (list || []).forEach(function (b) {
      if (b.t === 'step' || b.t === 'split' || b.t === 'end' || b.t === 'loop') out.push({ b: b, path: path });
      if (b.t === 'step' && b.error) walk(b.error, path.concat([{ split: b.no, label: 'error' }]), out);
      if (b.t === 'split') b.branches.forEach(function (br) { walk(br.body, path.concat([{ split: b.no, label: br.label }]), out); });
      if (b.t === 'loop' || b.t === 'orphan') walk(b.body, path, out);
    });
    return out;
  }

  // ---------- def-use ----------
  var STRENGTH = { parameter: 5, defines: 5, changes: 4, commits: 3, deletes: 3, reads: 1, returns: 1 };
  var TEXT_KEYS = ['detail', 'title'];

  function analyse(entry, ctx) {
    ctx = ctx || {};
    var du = {};        // var -> key -> role
    var order = [];     // locals in the order they are first set
    var types = {};
    var items = walk(entry.workflow || [], [], []);
    var byNo = {};
    items.forEach(function (it) { if (it.b.no) byNo[it.b.no] = it; });

    function role(v, key, r) {
      if (!v) return;
      du[v] = du[v] || {};
      var had = du[v][key];
      if (!had || STRENGTH[r] > STRENGTH[had]) du[v][key] = r;
    }
    (entry.params || []).forEach(function (p) { role(p.name, 'start', 'parameter'); types[p.name] = p.type; });

    items.forEach(function (it) {
      var b = it.b;
      if (b.t === 'end') {
        tokens(b.returns).forEach(function (v) { role(v, 'end', 'returns'); });
        return;
      }
      if (b.t === 'split') {
        tokens(b.cond).forEach(function (v) { role(v, b.no, 'reads'); });
        return;
      }
      if (b.t === 'loop') {
        tokens(b.over).forEach(function (v) { role(v, b.no, 'reads'); });
        if (b.each) { var it2 = varName(b.each); role(it2, b.no, 'defines'); if (it2 && order.indexOf(it2) === -1) order.push(it2); }
        return;
      }
      var c = b.card || {};
      var props = c.props || {};
      var a = c.action || '';
      var own = null, kind = null;
      if (props.out) { own = props.out; kind = 'defines'; }
      else if (/^(CreateVariable|CreateChange|CreateList|Retrieve|Aggregate|ListOperations|Cast)Action$/.test(a)) {
        // A model read before activityProps existed: the made variable is the
        // card's title when the title is one.
        own = varName(c.title) || (a === 'CreateChangeAction' ? (tokens(c.detail)[0] || null) : null);
        kind = own ? 'defines' : null;
      }
      if (kind) {
        role(own, b.no, 'defines');
        if (order.indexOf(own) === -1 && !(entry.params || []).some(function (p) { return p.name === own; })) order.push(own);
        types[own] = types[own] || props.outType || props.dataType || callReturn(ctx, props.target) || null;
      }
      var target = props.object || varName(c.title);
      if (/^(ChangeVariable|Change|ChangeList|Rollback)Action$/.test(a)) role(target, b.no, 'changes');
      if (a === 'CommitAction') role(target, b.no, 'commits');
      if (a === 'DeleteAction') role(target, b.no, 'deletes');
      // Reads: every $X the step's own text and values mention.
      var texts = [];
      TEXT_KEYS.forEach(function (k) { if (c[k]) texts.push(c[k]); });
      (c.fields || []).forEach(function (f) { texts.push(f.value); });
      ['xpath', 'value', 'from'].forEach(function (k) { if (props[k]) texts.push(k === 'from' ? '$' + props[k] : props[k]); });
      (c.rows || []).forEach(function (r) { if (r[0] === 'Detail' || r[0] === 'Value') texts.push(r[1]); });
      texts.forEach(function (t) { tokens(t).forEach(function (v) { if (v !== own) role(v, b.no, 'reads'); }); });
    });

    var vars = (entry.params || []).map(function (p) { return { name: p.name, type: p.type, param: true }; })
      .concat(order.map(function (n) { return { name: n, type: types[n] || null, param: false }; }));
    var known = {};
    vars.forEach(function (v) { known[v.name] = true; });

    return {
      vars: vars, du: du, known: known, byNo: byNo, items: items, types: types,
      roleAt: function (v, key) { return v && du[v] ? du[v][key] || null : null; },
      summary: function (v) { return varSummary(du[v] || {}); },
      stepSummary: function (no) { return stepSummary(byNo[no], du, types, entry, ctx); }
    };
  }

  function callReturn(ctx, target) {
    if (!target || !ctx.flow) return null;
    var f = ctx.flow(target);
    return f && f.returnType && f.returnType !== 'Nothing' ? f.returnType : null;
  }

  // ---------- one sentence per variable (spec 02 §5.4) ----------
  function list(nos) { return nos.slice().sort(function (a, b) { return a - b; }).join(', '); }
  function keysWith(map, r) { return Object.keys(map).filter(function (k) { return map[k] === r && k !== 'start' && k !== 'end'; }).map(Number); }
  function varSummary(map) {
    var parts = [];
    if (map.start === 'parameter') parts.push('parameter of this microflow');
    var d = keysWith(map, 'defines'), ch = keysWith(map, 'changes'), rd = keysWith(map, 'reads'), cm = keysWith(map, 'commits'), dl = keysWith(map, 'deletes');
    if (d.length) parts.push('set in step ' + list(d));
    if (ch.length) parts.push('changed in ' + list(ch));
    if (rd.length) parts.push('read in ' + list(rd));
    if (cm.length) parts.push('committed in ' + list(cm));
    if (dl.length) parts.push('deleted in ' + list(dl));
    if (map.end === 'returns') parts.push('returned at the end');
    return parts.join(' · ');
  }

  // ---------- one sentence per step (spec 02 §6.1) ----------
  function steps(nos) { return nos.length === 1 ? 'step ' + nos[0] : 'steps ' + nos.slice(0, -1).join(', ') + ' and ' + nos[nos.length - 1]; }
  function sentence(parts) {
    if (!parts.length) return '';
    var s = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
    return s.charAt(0).toUpperCase() + s.slice(1) + '.';
  }
  function afterwards(map, self) {
    var out = [];
    var ch = keysWith(map, 'changes').filter(function (n) { return n !== self; });
    var rd = keysWith(map, 'reads').filter(function (n) { return n !== self; });
    if (ch.length) out.push('changed in ' + steps(ch.sort(function (a, b) { return a - b; })));
    if (rd.length) out.push('read in ' + steps(rd.sort(function (a, b) { return a - b; })));
    if (map.end === 'returns') out.push('returned at the end');
    return out;
  }
  function onlyOn(path) {
    var last = path[path.length - 1];
    if (!last) return '';
    return last.label === 'error' ? ' Runs only when step ' + last.split + ' fails.' : ' Runs only on the ' + (last.label === null || last.label === undefined ? 'other' : last.label) + ' path of step ' + last.split + '.';
  }
  function stepSummary(it, du, types, entry, ctx) {
    if (!it) return '';
    var b = it.b;
    if (b.t === 'split') {
      var on = tokens(b.cond);
      var s = on.length ? 'Branches on ' + on.map(function (v) { return '$' + v; }).join(' and ') + '.' : 'Branches on ' + (b.cond || 'a condition') + '.';
      if (b.branches.every(function (br) { return br.ends; })) s += ' Every path ends here.';
      else if (b.after) s += ' The paths join again after it.';
      return s + onlyOn(it.path);
    }
    if (b.t !== 'step') return '';
    var c = b.card || {}, p = c.props || {}, a = c.action || '';
    var own = p.out || null;
    var obj = p.object || varName(c.title);
    var text;
    if (a === 'CreateChangeAction' && own) {
      var n = (c.fields || []).length;
      var m = du[own] || {};
      var cm = keysWith(m, 'commits'), dl = keysWith(m, 'deletes');
      text = 'Sets $' + own + ' with ' + n + ' member' + (n === 1 ? '' : 's') + '.';
      if (p.commit && p.commit !== 'No') text += ' Committed here.';
      else if (cm.length || dl.length) text += ' Not committed here: ' + [cm.length ? 'committed in ' + steps(cm) : null, dl.length ? 'deleted in ' + steps(dl) : null].filter(Boolean).join(', ') + '.';
    } else if (own) {
      text = 'Sets $' + own + '.';
      var later = afterwards(du[own] || {}, b.no);
      if (later.length) text += ' ' + sentence(later);
    } else if (a === 'ChangeVariableAction' || a === 'ChangeAction') {
      text = 'Changes ' + (obj ? '$' + obj : 'an object') + '.';
    } else if (a === 'CommitAction') {
      text = 'Commits ' + (obj ? '$' + obj : 'an object') + (p.withEvents === 'Yes' ? ' with events.' : p.withEvents === 'No' ? ' without events.' : '.');
    } else if (a === 'DeleteAction') {
      text = 'Deletes ' + (obj ? '$' + obj : 'an object') + '.';
    } else if (c.ref && c.ref.qn) {
      text = 'Calls ' + c.ref.qn + '.';
    } else {
      text = (c.kick || 'A step') + '.';
    }
    return text + onlyOn(it.path);
  }

  // ---------- members, by where their values come from (spec 02 §6.3) ----------
  // fields: [{ name, value, association? }]; entity: the object's entity, for
  // the members' types; an = the analysis; risks: the flow's risks.
  function memberTypes(model, entityQn) {
    var out = {};
    var e = (model && model.entities || []).filter(function (x) { return x.qualifiedName === entityQn; })[0];
    if (e) (e.attributes || []).forEach(function (a) {
      out[a.name] = a.enumerationQualifiedName ? 'Enumeration' : (a.type || '') + (a.length ? ' (' + a.length + ')' : '');
    });
    (model && model.associations || []).forEach(function (as) {
      if (as.owner === entityQn) out[as.name] = as.type === 'ReferenceSet' ? 'Reference set' : 'Reference';
    });
    return out;
  }
  var SYSTEM = /\[%([A-Za-z]+)%\]/;
  var SYSTEM_WORDS = { CurrentDateTime: 'current date and time', CurrentUser: 'the signed-in user', CurrentObject: 'the current object' };
  function classify(value, an) {
    var vs = tokens(value).filter(function (v) { return an.known[v]; });
    if (vs.length) return { group: vs[0], multi: vs.length > 1 };
    var sys = SYSTEM.exec(String(value || ''));
    if (sys) return { group: 'System', token: sys[1] };
    return { group: 'Fixed values' };
  }
  function fromText(value, v, assoc, an) {
    var t = String(value || '').trim();
    if (t === '$' + v) return assoc ? { text: 'the object', mark: 'association' } : { text: 'its value', mark: null };
    var path = new RegExp('^\\$' + v + '((?:/[A-Za-z0-9_.]+)+)$').exec(t);
    if (path) {
      var segs = path[1].split('/').filter(Boolean).map(shortName);
      return { text: segs.join(' › '), mark: null, deep: segs.length > 1 };
    }
    return { text: t.replace(new RegExp('\\$' + v + '/', 'g'), ''), mark: 'computed' };
  }
  function flagged(name, risks) {
    var re = new RegExp('(^|[^A-Za-z0-9_])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-Za-z0-9_]|$)');
    var hit = (risks || []).filter(function (r) { return re.test([r.title, r.detail, r.fix].join(' ')); })[0];
    return hit ? { level: hit.level, title: hit.title } : null;
  }
  function members(fields, entityQn, an, ctx) {
    ctx = ctx || {};
    var types = memberTypes(ctx.model, entityQn);
    var rows = (fields || []).map(function (f) {
      return { name: f.name, type: types[f.name] || (f.association ? 'Reference' : null), value: f.value, association: !!f.association, flag: flagged(f.name, ctx.risks) };
    });
    var groups = {}, orderKeys = [];
    rows.forEach(function (r) {
      var cl = classify(r.value, an);
      var key = cl.group;
      if (!groups[key]) { groups[key] = { key: key, variable: an.known[key] ? key : null, token: cl.token || null, rows: [] }; orderKeys.push(key); }
      var from = groups[key].variable ? fromText(r.value, key, r.association, an) : { text: String(r.value || '').trim(), mark: null };
      if (cl.multi) from.mark = 'computed';
      var same = groups[key].rows.filter(function (x) { return x.from === from.text && x.mark === from.mark; })[0];
      if (same) same.targets.push(r);
      else groups[key].rows.push({ from: from.text, mark: from.mark, deep: !!from.deep, targets: [r] });
    });
    var out = orderKeys.map(function (k) { return groups[k]; });
    out.forEach(function (g) {
      // Plain attributes first, then paths through associations, then the
      // whole object and computed values; otherwise the model's order.
      g.rows.forEach(function (r, i) { r.i = i; r.rank = r.mark ? 2 : r.deep ? 1 : 0; });
      g.rows.sort(function (a, b) { return a.rank - b.rank || a.i - b.i; });
      g.count = g.rows.reduce(function (n, r) { return n + r.targets.length; }, 0);
      if (g.variable) {
        var v = an.vars.filter(function (x) { return x.name === g.variable; })[0];
        var m = an.du[g.variable] || {};
        var d = keysWith(m, 'defines'), ch = keysWith(m, 'changes');
        g.note = v && v.param ? 'parameter · ' + (v.type || 'type not read') : 'variable · set in ' + (list(d) || '?') + (ch.length ? ', changed in ' + list(ch) : '');
      } else if (g.key === 'System') {
        g.note = SYSTEM_WORDS[g.token] || g.token || 'system value';
      } else {
        g.note = 'written into the flow';
      }
    });
    // Parameters, then variables, by how many members each sets; System; Fixed values.
    var rankOf = function (g) { if (g.key === 'Fixed values') return 3; if (g.key === 'System') return 2; var v = an.vars.filter(function (x) { return x.name === g.variable; })[0]; return v && v.param ? 0 : 1; };
    out.sort(function (a, b) { return rankOf(a) - rankOf(b) || b.count - a.count; });
    return { groups: out, rows: rows };
  }

  // ---------- which way of a decision stays on the main path (spec 02 §4.2) ----------
  // The rule the spec writes down ("fewer steps goes to the side, a tie puts
  // `true` there") contradicts both of its own examples, so this is the rule
  // that draws them as the design does:
  //   1. one way ends in an End of its own and the other goes on: the ending
  //      one goes to the side;
  //   2. both go on and join again: the longer one is the detour, to the side;
  //   3. both end: the shorter one goes to the side;
  //   4. a tie puts `false` to the side.
  // More than two ways: one stays on the main path by the same rules, every
  // other goes to the side. Before all four, rule 0 in mainBranch.
  function count(list) {
    var n = 0;
    (list || []).forEach(function (b) { n++; if (b.t === 'split') b.branches.forEach(function (x) { n += count(x.body); }); if (b.body) n += count(b.body); });
    return n;
  }
  function mainBranch(split) {
    var bs = split.branches;
    if (bs.length < 2) return 0;
    // 0. A way that holds most of the flow stays on the main path, whether it
    //    ends or not: sent to the side, the rest of a 100-step flow nested
    //    side in side, each a column narrower, 40 000px tall (Karol,
    //    2026-10-13, a real project's ticket API flow). Most: 8 steps or more,
    //    and more than twice any other way.
    var sizes = bs.map(function (b) { return count(b.body); });
    var big = sizes.indexOf(Math.max.apply(null, sizes));
    if (sizes[big] >= 8 && sizes.every(function (n, i) { return i === big || sizes[big] > 2 * n; })) return big;
    var allEnd = bs.every(function (b) { return b.ends; });
    var idx = bs.map(function (b, i) { return i; });
    idx.sort(function (i, j) {
      var a = bs[i], b = bs[j];
      if (a.ends !== b.ends) return a.ends ? 1 : -1;
      var d = count(a.body) - count(b.body);
      if (d) return allEnd ? -d : d;
      return (a.label === 'false' ? 1 : 0) - (b.label === 'false' ? 1 : 0);
    });
    return idx[0];
  }

  window.MxFlowTrace = { analyse: analyse, members: members, mainBranch: mainBranch, tokens: tokens, walk: walk };
})();
