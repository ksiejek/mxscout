/* MxScout — descriptions written by an AI agent, and the pack it writes them from.
 *
 * MxScout reads a model; it does not write prose about it. What a business
 * reader wants — what the application is for, its main processes, a sentence
 * on what each microflow does — takes a language model. That model runs
 * OUTSIDE MxScout, on the reader's own terms (a local agent with the
 * mendix-describe skill), and the two meet through two files:
 *
 *  - the AI pack, which MxScout writes: the model as the documentation
 *    already reads it — every flow as its steps with the data they set, every
 *    entity with its members and associations, who may read, write, create
 *    and delete it, and the validation rules that refuse a save, every page
 *    and snippet widget shown or editable only on a condition — in a
 *    dense text a model reads cheaply, one section per module, an index of
 *    line ranges at the top so an agent reads one module at a time, and a
 *    fingerprint per flow so the next run describes only what changed;
 *  - the descriptions file, which the agent writes and MxScout imports: JSON,
 *    checked here before anything of it is kept.
 *
 * MxScout opens no connection for any of this and runs no model. The pack is
 * a browser download, or — when the person presses Share with an agent — held in
 * the server's memory for an agent on this machine to read (docs.js, and
 * server/routes/agent.js); the descriptions arrive by a file the reader picks, or
 * from that agent, kept only when the person presses Import. In
 * the documentation every imported sentence is marked as written by AI,
 * because the rest of it is read from the model and says so.
 */
(function () {
  'use strict';

  var PACK_FORMAT = 'mxscout-ai-pack';
  var DESC_FORMAT = 'mxscout-descriptions';
  var MAX_VALUE = 200;
  var STORY_MAX = 16000;   // a long description: several paragraphs, ~1,200 words at the most the brief asks for

  // ---------- fingerprints ----------
  // FNV-1a over what a description is ABOUT: the flow's inputs, result and
  // steps. Not who calls it — a new caller does not change what a flow does.
  function fnv(text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }
  // A flow's entry is not changed once docs-data.js has built it, so its
  // fingerprint and its text are worked out once: attaching descriptions,
  // the pack and the chat assistant's parts all ask for them, on every flow.
  // The chat assistant's card works out every flow's text when the
  // Documentation section is drawn; the pack, made when it is asked for,
  // takes the same lines from here instead of writing them again.
  var memo = typeof WeakMap === 'function' ? { hash: new WeakMap(), text: new WeakMap(), lines: new WeakMap() } : null;
  // A copy of an entry (docs-data.js flowEntry) shares what is worked out with the entry it copies.
  function remembered(kind, f, make) {
    if (!memo || !f || typeof f !== 'object') return make(f);
    var key = f.same || f;
    var v = memo[kind].get(key);
    if (v === undefined) { v = make(f); memo[kind].set(key, v); }
    return v;
  }
  function hashOf(f) { return remembered('hash', f, hashOfNow); }
  function hashOfNow(f) {
    if (f.kind === 'page') return fnv(JSON.stringify([f.params, f.roles]));
    return fnv(JSON.stringify([f.params, f.returns, f.workflow]));
  }
  // An entity's fingerprint is its members and associations only — not its access rules or its
  // validation rules, which the pack lists under it (accessLines, validationLines). A description of
  // an entity says what it holds; a role gaining write access does not make that out of date, and
  // adding those lines to the pack did not mark every entity's description out of date.
  function entityHash(e, assoc) { return fnv(JSON.stringify([e.attributes, e.generalization, assoc])); }

  // ---------- the pack ----------
  function cut(v, max) {
    max = max || MAX_VALUE;
    var s = String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }
  function short(qn) { return String(qn || '').split('.').pop(); }

  function stepLines(list, depth, out) {
    var pad = new Array(depth + 1).join('  ');
    (list || []).forEach(function (b) {
      if (b.t === 'start') return;
      if (b.t === 'end') { out.push(pad + '- ' + (b.kind === 'errorEvent' ? 'error end' : b.kind === 'break' ? 'break' : b.kind === 'continue' ? 'next iteration' : 'end') + (b.returns ? ' returns ' + cut(b.returns) : '')); return; }
      if (b.t === 'go') { out.push(pad + (b.back ? '- ↩ back to step ' : '- ↪ step ') + (b.no || '?')); return; }
      if (b.t === 'orphan') { out.push(pad + '- (separate path)'); stepLines(b.body, depth + 1, out); return; }
      if (b.t === 'loop') {
        out.push(pad + '- ' + b.no + ' ' + (b.cond !== null && b.cond !== undefined ? 'while ' + cut(b.cond || 'condition') : 'for each ' + (b.each || 'item') + ' in ' + (b.over || 'list')) + ':');
        stepLines(b.body, depth + 1, out);
        return;
      }
      if (b.t === 'split') {
        out.push(pad + '- ' + b.no + ' if ' + JSON.stringify(cut(b.title)) + (b.cond ? ' ' + cut(b.cond) : '') + ':');
        b.branches.forEach(function (x) {
          out.push(pad + '  - ' + (x.label === null || x.label === undefined ? '(other)' : cut(x.label)) + ':');
          if (x.body.length) stepLines(x.body, depth + 2, out); else out.push(pad + '    - (continues)');
        });
        return;
      }
      if (b.t === 'step') {
        var c = b.card;
        var kick = String(c.kick || '');
        if (c.ref && c.fam === 'call') kick = kick.split(' · ')[0]; // the module is in the qualified name
        var line = pad + '- ' + b.no + ' ' + kick.charAt(0).toLowerCase() + kick.slice(1) + ' ' + cut(c.ref && c.fam === 'call' ? c.ref.qn : c.title);
        // A change's detail is the list of members it sets; with the values
        // below, the names alone would be said twice.
        var detail = c.detail;
        if (detail && c.fields) {
          var named = {};
          c.fields.forEach(function (x) { named[x.name] = true; });
          detail = detail.split(', ').filter(function (t) { return !named[t]; }).join(', ');
        }
        if (detail && detail !== c.title) line += ' · ' + cut(detail);
        if (c.fields) line += ' {' + c.fields.map(function (x) { return x.name + (x.op && x.op !== 'Set' ? ' ' + x.op.toLowerCase() + ' ' : '=') + cut(x.value); }).join('; ') + '}';
        if (c.off) line += ' (disabled)';
        out.push(line);
        if (b.error) { out.push(pad + '  on error:'); stepLines(b.error, depth + 2, out); }
      }
    });
  }

  function flowBlock(f, out) {
    var tag = f.kind === 'page' ? 'PG' : f.kind === 'nanoflow' ? 'NF' : 'MF';
    out.push('### ' + tag + ' ' + f.qn + ' #' + hashOf(f));
    if (f.roles.length) out.push('roles: ' + f.roles.map(short).join(', '));
    if (f.params.length) out.push('in: ' + f.params.map(function (p) { return p.name + ': ' + p.type; }).join('; '));
    if (f.calledBy.length) {
      var by = {};
      f.calledBy.forEach(function (c) { (by[c.kind] = by[c.kind] || []).push(short(c.qn)); });
      out.push('from: ' + Object.keys(by).map(function (k) { return k + ' ' + by[k].slice(0, 6).join(', ') + (by[k].length > 6 ? ' +' + (by[k].length - 6) : ''); }).join('; '));
    }
    if (f.kind !== 'page' && f.returns) out.push('returns: ' + f.returns);
    if (f.doc) out.push('doc: ' + cut(f.doc));
    if (f.kind !== 'page' && f.workflow) { out.push('steps:'); stepLines(f.workflow, 0, out); }
    if (f.kind === 'page') widgetLines(f.preview, out);
  }

  // A page's widgets that are shown or editable only under a condition — the answer to "why can't
  // the clerk see the Cancel button?" and "why is this field read-only?". One line per condition,
  // under the page's own lines, from the widget tree mpr.js reads (readPageTree): "shows" for a
  // widget visible only on an expression, an attribute's value or for some module roles, "editable"
  // for an input (or a data view) editable never or only on a condition, and "read-only" for an input
  // that is editable itself but sits in a data view or list view that is not. A widget with no
  // condition gets no line; a conditional widget that holds others names the buttons and fields in
  // it, since they are hidden with it. A snippet's widgets are listed once, in a "### SN" block of
  // its own (snippetBlocks) — on a large project, written out on every page that places the snippet
  // they were most of these lines — and a page that places one says so in a "places" line. None of it
  // is part of a page's fingerprint (hashOf), so no page description went out of date when these
  // lines were added. skills/mendix-describe/reference/pack-format.md.
  var WIDGET_LINES_MAX = 200, COND_MAX = 300, HOLDS_MAX = 8;
  var WIDGET_KINDS = { dataview: 'data view', listview: 'list view', tab: 'tab', row: 'row', grid: 'layout grid', snippet: 'snippet', text: 'text', image: 'image' };
  var WIDGET_TYPES = { DivContainer: 'container', GroupBox: 'group box', DataGrid: 'data grid', TemplateGrid: 'template grid', TabControl: 'tab container' };
  function widgetKind(n) {
    if (n.kind === 'button') return n.link ? 'link' : 'button';
    if (WIDGET_KINDS[n.kind]) return WIDGET_KINDS[n.kind];
    var t = String(n.type || n.kind || 'widget');
    return WIDGET_TYPES[t] || t.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  }
  function widgetLabel(n) {
    if (n.kind === 'snippet' && n.snippet && !n.caption) return n.snippet;
    return cut(n.caption || (n.kind === 'input' && n.attribute ? short(n.attribute) : null) || n.name || widgetKind(n), 80);
  }
  function condWords(c) {
    var parts = [];
    if (c.expression) parts.push('when ' + cut(c.expression, COND_MAX));
    else if (c.attribute) {
      var vals = c.values || [];
      parts.push('when ' + (c.of ? c.of + '/' : '') + c.attribute + ' is ' + (vals.length ? vals.map(function (v) { return cut(v, 60); }).join(' or ') : 'none of its values (no value ticked)'));
    }
    if (c.roles && c.roles.length) parts.push('for roles ' + c.roles.join(', '));
    return parts.join('; ') || 'on a condition the model leaves empty';
  }
  function widgetLines(preview, out) {
    if (!preview || !preview.structure) return;
    var lines = conditionLines(preview.structure, preview.snippets || {}, []);
    lines.slice(0, WIDGET_LINES_MAX).forEach(function (l) { out.push(l); });
    if (lines.length > WIDGET_LINES_MAX) out.push('  … ' + (lines.length - WIDGET_LINES_MAX) + ' more widgets shown or editable on a condition');
  }
  // The lines of one page's or snippet's widget tree, uncapped. A snippet's are the same on every page
  // that places it, so they are worked out once per tree (`chain`, the snippets being read, only
  // stops a snippet that places itself).
  var treeLines = typeof WeakMap === 'function' ? new WeakMap() : null;
  function conditionLines(structure, snippets, chain) {
    var was = treeLines && treeLines.get(structure);
    if (was) return was;
    var found = [];
    function kids(n) { return (n.widgets || []).concat(n.footer || []); }
    // A snippet with lines of its own, and not one being read already.
    function placed(n) {
      var sn = n.kind === 'snippet' && n.snippet && chain.indexOf(n.snippet) === -1 ? snippets[n.snippet] : null;
      return sn && sn.structure && conditionLines(sn.structure, snippets, chain.concat(n.snippet)).length ? sn : null;
    }
    // The buttons and fields under a widget, by label — a snippet's too: what is hidden with it.
    function holds(n) {
      var names = [];
      (function inside(k, ch) {
        var sn = k.kind === 'snippet' && k.snippet && ch.indexOf(k.snippet) === -1 ? snippets[k.snippet] : null;
        var list = kids(k);
        if (sn && sn.structure) { ch = ch.concat(k.snippet); (sn.structure.regions || []).forEach(function (r) { list = list.concat(r.widgets || []); }); }
        list.forEach(function (w) {
          if (!w || typeof w !== 'object') return;
          if (w.kind === 'button' || w.kind === 'input') { var l = widgetLabel(w); if (names.indexOf(l) === -1) names.push(l); }
          inside(w, ch);
        });
      })(n, chain);
      if (!names.length) return '';
      return ' · holds ' + names.slice(0, HOLDS_MAX).join(', ') + (names.length > HOLDS_MAX ? ' +' + (names.length - HOLDS_MAX) : '');
    }
    // ctx: where a widget is (the nearest data widget or tab, to tell two widgets of one label apart),
    // and the nearest data view or list view whose editability is not the default.
    function walk(list, ctx) {
      var rowNo = 0;
      list.forEach(function (n) {
        if (!n || typeof n !== 'object') return;
        if (n.kind === 'row') rowNo++;
        var label = n.kind === 'row' ? 'row ' + rowNo + (ctx.grid ? ' of ' + ctx.grid : '') : widgetLabel(n);
        var kind = widgetKind(n), locked = ctx.locked;
        function add(verb, rest) { found.push({ verb: verb, rest: rest, label: label, kind: kind, name: n.name, place: ctx.place }); }
        if (n.visible) add('shows', condWords(n.visible) + holds(n));
        if (n.kind === 'input') {
          if (locked && locked.never && !n.readOnly) add('read-only', 'inside ' + locked.label + ' (' + locked.kind + '), which is not editable' + (n.editableIf ? ' (its own condition: ' + condWords(n.editableIf) + ')' : ''));
          else if (n.readOnly) add('editable', 'never');
          else if (n.editableIf) add('editable', condWords(n.editableIf));
          else if (locked && locked.cond) add('editable', condWords(locked.cond) + ' (from ' + locked.label + ' (' + locked.kind + '))');
        } else if (n.kind === 'dataview' && n.editableIf) add('editable', condWords(n.editableIf) + ' (and the inputs inside it)');
        if (placed(n)) {
          add('places', 'see SN ' + n.snippet +
            (locked && locked.never ? '; inside ' + locked.label + ' (' + locked.kind + '), which is not editable, so neither are its inputs'
              : locked && locked.cond ? '; inside ' + locked.label + ' (' + locked.kind + '), so its inputs are editable only ' + condWords(locked.cond) : ''));
        }
        var data = n.kind === 'dataview' || n.kind === 'listview';
        var inner = { place: ctx.place, locked: locked, grid: n.kind === 'grid' ? label : ctx.grid };
        if (data || n.kind === 'datagrid' || n.kind === 'gallery' || n.kind === 'datalist' || n.kind === 'tab') inner.place = label + ' (' + kind + ')';
        // A data view or list view that is not editable makes every input in it read-only, and one editable
        // on a condition, editable on that condition; one with the default leaves it as the one around it.
        if (data && n.readOnly) inner.locked = { never: true, label: label, kind: kind };
        else if (n.kind === 'dataview' && n.editableIf) inner.locked = { cond: n.editableIf, label: label, kind: kind };
        walk(kids(n), inner);
      });
    }
    walk((structure.regions || []).reduce(function (all, r) { return all.concat(r.widgets || []); }, []), {});
    // Two lines about two different widgets of one label say where each is.
    var seen = {}, lines = [], had = {};
    found.forEach(function (x) { var k = x.verb + ' ' + x.label + ' (' + x.kind + ')'; seen[k] = (seen[k] || 0) + 1; });
    found.forEach(function (x) {
      var subject = x.label + ' (' + x.kind + ')';
      if (seen[x.verb + ' ' + subject] > 1) subject += x.place ? ' in ' + x.place : x.name && x.name !== x.label ? ' [' + x.name + ']' : '';
      var line = '  ' + x.verb + ' ' + subject + ' — ' + x.rest;
      if (!had[line]) { had[line] = true; lines.push(line); }
    });
    if (treeLines) treeLines.set(structure, lines);
    return lines;
  }
  // The snippets the pages of `own` modules place whose widgets have lines, each once, in its own
  // module's section — or, when that module has no section of its own, in the first page's that
  // places it: { module name: [lines] }.
  function snippetBlocks(data, own) {
    var found = {}, order = [], all = {};
    own.forEach(function (m) {
      m.pages.forEach(function (k) {
        var f = data.flows[k], sn = (f && f.preview && f.preview.snippets) || {};
        Object.keys(sn).forEach(function (q) {
          all[q] = sn[q];
          if (!found[q]) { found[q] = { pages: [], home: m.name }; order.push(q); }
          found[q].pages.push(short(f.qn));
        });
      });
    });
    var names = {};
    own.forEach(function (m) { names[m.name] = true; });
    var blocks = {};
    order.sort().forEach(function (q) {
      var s = all[q], lines = s && s.structure ? conditionLines(s.structure, all, [q]) : [];
      if (!lines.length) return;
      var mod = q.split('.')[0], at = names[mod] ? mod : found[q].home, pages = found[q].pages;
      var out = blocks[at] = blocks[at] || [];
      out.push('', '### SN ' + q);
      out.push('on pages: ' + pages.slice(0, 6).join(', ') + (pages.length > 6 ? ' +' + (pages.length - 6) : ''));
      lines.slice(0, WIDGET_LINES_MAX).forEach(function (l) { out.push(l); });
      if (lines.length > WIDGET_LINES_MAX) out.push('  … ' + (lines.length - WIDGET_LINES_MAX) + ' more widgets shown or editable on a condition');
    });
    return blocks;
  }

  function entityLine(e, data) {
    var refs = [];
    data.associations.forEach(function (a) {
      if (a.from === e.qn) refs.push('→ ' + a.to + (a.many ? ' (*-*)' : ' (*-1)') + ' via ' + a.name);
      else if (a.to === e.qn) refs.push('← ' + a.from + (a.many ? ' (*-*)' : ' (*-1)') + ' via ' + a.name);
    });
    var parts = ['E ' + e.name + ' #' + entityHash(e, refs) + (e.persistable ? '' : ' (not persistable)') + (e.generalization ? ' extends ' + e.generalization : '')];
    if (e.attributes.length) parts.push('attrs: ' + e.attributes.map(function (a) { return a.name + ':' + a.type; }).join(', '));
    if (refs.length) parts.push('refs: ' + refs.join(', '));
    if (e.doc) parts.push('doc: ' + cut(e.doc));
    return parts.join(' | ');
  }

  // Who may do what with an entity: one line per module role an access rule names, under the
  // entity's line. "read" lists the members it may read, "write" those it may change too; a member
  // left out is one it may not touch. "assoc" is the same for the associations the entity owns, said
  // only when it owns some. Then create and delete, and the rows: all of them, or only those the
  // XPath lets through, kept as the model has it. An entity no rule names gets "access none".
  // skills/mendix-describe/reference/pack-format.md.
  var XPATH_MAX = 300;
  function memberSet(names, ok) {
    var yes = names.filter(ok), no = names.filter(function (n) { return !ok(n); });
    if (!yes.length) return 'none';
    if (!no.length) return 'all';
    return no.length < yes.length ? 'all except ' + no.join(', ') : yes.join(', ');
  }
  function accessLines(e, data, out) {
    // No rule: no module role reaches it from the client; only a flow can.
    if (!(e.access || []).length) { out.push('  access none'); return; }
    var owned = data.associations.filter(function (a) { return a.from === e.qn; }).map(function (a) { return a.name; });
    (e.access || []).forEach(function (r) {
      var m = r.members || {};
      // The associations the entity owns and those the rule names; every other member it names is an
      // attribute — the entity's own, or one it inherits, which a rule on a specialisation names too.
      var assocs = owned.slice(), isAssoc = {};
      owned.concat(r.assocs || []).forEach(function (k) { isAssoc[k] = true; if (assocs.indexOf(k) === -1) assocs.push(k); });
      var attrs = e.attributes.map(function (a) { return a.name; });
      Object.keys(m).forEach(function (k) { if (!isAssoc[k] && attrs.indexOf(k) === -1) attrs.push(k); });
      function reads(k) { return m[k] === 'r' || m[k] === 'rw'; }
      function writes(k) { return m[k] === 'rw'; }
      var parts = [];
      if (attrs.length) parts.push('read ' + memberSet(attrs, reads), 'write ' + memberSet(attrs, writes));
      parts.push(r.create ? 'create' : 'no create', r.del ? 'delete' : 'no delete');
      if (assocs.length) parts.push('assoc read ' + memberSet(assocs, reads), 'assoc write ' + memberSet(assocs, writes));
      out.push('  access ' + r.role + ': ' + parts.join(' · ') + ' — ' + (r.xpath ? 'only ' + cut(r.xpath, XPATH_MAX) : 'all rows'));
    });
  }

  // What refuses a save before any flow runs: one line per validation rule, under the access lines.
  function bound(b) { return !b ? '?' : b.attribute ? 'attribute ' + b.attribute : cut(b.value); }
  function validationLines(e, out) {
    (e.validations || []).forEach(function (v) {
      var what = v.kind;
      if (v.kind === 'range') what = v.min && v.max ? 'range ' + bound(v.min) + '..' + bound(v.max) : v.min ? 'range ≥ ' + bound(v.min) : v.max ? 'range ≤ ' + bound(v.max) : 'range';
      else if (v.kind === 'regex') what = 'regex ' + (v.regex || '?');
      else if (v.kind === 'maxLength') what = 'max length ' + (v.max === null || v.max === undefined ? '?' : v.max);
      else if (v.kind === 'equals') what = 'equals ' + bound(v.to);
      out.push('  valid ' + v.attribute + ': ' + what + (v.message ? ' — ' + JSON.stringify(cut(v.message)) : ''));
    });
  }

  // What a person has already decided about the risks (triage.js puts it on data.ai): the risks marked
  // fixed, false positive, reopened or verified, and every risk a person raised in a comment. Before the
  // index, so the agent reads it with the header; the skill says what to do with each status.
  var TRIAGE_SAYS = { fixed: 'fixed', 'false-positive': 'false-positive', reopened: 'reopened', verified: 'verified', open: 'open', gone: 'gone' };
  function triageLines(data) {
    var ai = data.ai || {};
    var rows = (ai.risks || []).concat(ai.triaged || []).filter(function (r) {
      return r.origin === 'person' || (r.status && r.status !== 'open' && r.status !== 'gone');
    });
    if (!rows.length) return [];
    var out = ['## risk triage',
      'What a person decided about risks; read it before you write risks. Keep every id. "fixed": check it against the model and report it again, with the same id, only if it is still there. "false-positive": do not report it again unless the model changed so that the reason no longer holds — then report it with the same id and say why in its detail. "raised by" a person: not yours to report; when it is "fixed", say in "verify" whether the model still shows it.'];
    rows.forEach(function (r) {
      var id = r.origin === 'person' ? r.pid : (r.id || '(no id: give it one)');
      out.push('- ' + id + ' | ' + r.level + ' | ' + (TRIAGE_SAYS[r.status] || 'open') + ' | ' + (r.origin === 'person' ? 'raised by ' + cut(r.by || 'a person') : 'ai') + ' | ' + cut(r.title) +
        ((r.where || []).length ? ' | where: ' + r.where.slice(0, 6).map(function (w) { return String(w).split('|')[0]; }).join(', ') : '') +
        (r.note ? ' | note: ' + cut(r.note) : ''));
    });
    out.push('');
    return out;
  }

  // data is what MxDocsData.build returns.
  function pack(data) {
    var own = data.modules.filter(function (m) { return !m.marketplace && (m.microflows.length + m.nanoflows.length + m.pages.length + m.entities.length); });
    var market = data.modules.filter(function (m) { return m.marketplace; }).map(function (m) { return m.name; });
    var snippetLines = snippetBlocks(data, own);
    var blocks = own.map(function (m) {
      var out = ['## module ' + m.name];
      if (m.entities.length) {
        out.push('### entities');
        m.entities.forEach(function (q) {
          var e = data.entities[q];
          out.push(entityLine(e, data));
          accessLines(e, data, out);
          validationLines(e, out);
        });
      }
      m.microflows.concat(m.nanoflows, m.pages).forEach(function (k) {
        out.push('');
        var lines = flowLines(data.flows[k]);
        for (var i = 0; i < lines.length; i++) out.push(lines[i]);
      });
      (snippetLines[m.name] || []).forEach(function (l) { out.push(l); });
      out.push('');
      return { m: m, lines: out };
    });
    var head = [
      '# MxScout AI pack',
      'format: ' + PACK_FORMAT + ' 1',
      'project: ' + data.project,
      (data.mendix ? 'mendix: ' + data.mendix : null),
      // Which version of the app this is, from the Mendix project's git — what descriptions written from it describe.
      'model: ' + ((window.MxDocsData && window.MxDocsData.versionText && window.MxDocsData.versionText(data.version)) || 'version unknown (no git commit was read with this model)'),
      data.version && data.version.commit ? 'model commit: ' + data.version.commit : null,
      'generated: ' + data.generatedAt,
      'read with: the mendix-describe skill (skills/mendix-describe in the MxScout repository); it says what to write and in what format',
      // Each user role with the module roles it carries: an entity's access lines name module roles.
      'roles: ' + data.roles.map(function (r) { return r.name + (r.moduleRoles && r.moduleRoles.length ? ' (' + r.moduleRoles.join(', ') + ')' : ''); }).join('; '),
      data.scheduled.length ? 'scheduled events: ' + data.scheduled.map(function (s) { return short(s.name) + ' → ' + (s.microflow || '?') + (s.enabled ? '' : ' (off)'); }).join('; ') : null,
      data.services.length ? 'published services: ' + data.services.map(function (s) { return s.name + (s.kind ? ' (' + s.kind + ')' : ''); }).join('; ') : null,
      market.length ? 'not included: ' + market.length + ' Marketplace modules — ' + market.join(', ') : null,
      'legend: MF microflow, NF nanoflow, PG page, SN snippet, E entity; #xxxxxxxx is a fingerprint — copy it into the description; {member=value} is the data a step sets or passes; → owns an association to, ← is owned by; under an entity, "access <module role>:" is what that role may read, write, create and delete, and on which rows, and "valid <attribute>:" a validation rule that refuses a save; under a page or a snippet, "shows <widget>" is a widget visible only on a condition, "editable <widget>" one editable never or only on a condition, "read-only <widget>" an input inside a data view or list view that is not editable, and "places <snippet>" a snippet whose widgets have such lines under its SN block',
      ''
    ].filter(function (l) { return l !== null; }).concat(triageLines(data));
    var indexHead = ['## index', 'module | lines | microflows | nanoflows | pages | entities'];
    var line = head.length + indexHead.length + own.length + 2; // +1 blank, then the first module heading
    var index = blocks.map(function (b) {
      var from = line, to = line + b.lines.length - 1;
      line = to + 1;
      return b.m.name + ' | ' + from + '-' + to + ' | ' + b.m.microflows.length + ' | ' + b.m.nanoflows.length + ' | ' + b.m.pages.length + ' | ' + b.m.entities.length;
    });
    var all = head.concat(indexHead, index, ['']);
    blocks.forEach(function (b) { all = all.concat(b.lines); });
    var text = all.join('\n') + '\n';
    var out = { text: text, modules: own.length, flows: own.reduce(function (n, m) { return n + m.microflows.length + m.nanoflows.length; }, 0) };
    // Its fingerprint, worked out when something asks for it: on a large project it is a read of
    // every character of the pack, and sharing it with an agent has no use for it.
    var id = null;
    Object.defineProperty(out, 'id', { enumerable: true, get: function () { return id || (id = fnv(text)); } });
    return out;
  }

  // ---------- the descriptions file ----------
  function str(v, max) { return typeof v === 'string' && v.trim() ? v.trim().slice(0, max || 4000) : null; }

  // A module's notes for developers (skills/mendix-describe/reference/module-notes.md): sections of
  // text, bullet lines and one small table. Every part is kept as text; nothing is markup.
  function notesOf(list) {
    if (!Array.isArray(list)) return null;
    var out = list.slice(0, 16).map(function (s) {
      if (!s || typeof s !== 'object' || !str(s.title, 160)) return null;
      var t = s.table && typeof s.table === 'object' ? s.table : null;
      var cols = t && Array.isArray(t.columns) ? t.columns.slice(0, 6).map(function (c) { return str(c, 60); }).filter(Boolean) : [];
      var rows = t && cols.length && Array.isArray(t.rows) ? t.rows.slice(0, 80).map(function (r) {
        return Array.isArray(r) ? r.slice(0, cols.length).map(function (c) { return String(c === null || c === undefined ? '' : c).replace(/\s+/g, ' ').trim().slice(0, 500); }) : null;
      }).filter(function (r) { return r && r.some(Boolean); }) : [];
      var sec = {
        title: str(s.title, 160), text: str(s.text, 6000),
        items: (Array.isArray(s.items) ? s.items : []).slice(0, 60).map(function (x) { return str(x, 800); }).filter(Boolean),
        table: rows.length ? { columns: cols, rows: rows } : null
      };
      return sec.text || sec.items.length || sec.table ? sec : null;
    }).filter(Boolean);
    return out.length ? out : null;
  }

  // The architecture the agent drew (skills/mendix-describe/reference/c4.md): nodes and the links between
  // them. A link to a node that is not there is dropped; a kind it does not know becomes a system.
  var C4_KINDS = { person: true, system: true, app: true, store: true, part: true };
  function diagramOf(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.nodes)) return null;
    var ids = Object.create(null);
    var nodes = raw.nodes.slice(0, 100).map(function (n) {
      if (!n || typeof n !== 'object') return null;
      var id = str(n.id, 40), name = str(n.name, 80);
      if (!id || !name || !/^[A-Za-z0-9_-]+$/.test(id) || ids[id]) return null;
      ids[id] = true;
      return { id: id, name: name, note: str(n.note, 140), kind: typeof n.kind === 'string' && C4_KINDS[n.kind] === true ? n.kind : 'system', group: str(n.group, 60) };
    }).filter(Boolean);
    if (!nodes.length) return null;
    var links = (Array.isArray(raw.links) ? raw.links : []).slice(0, 250).map(function (l) {
      return l && typeof l.from === 'string' && typeof l.to === 'string' && ids[l.from] && ids[l.to] && l.from !== l.to ? { from: l.from, to: l.to, label: str(l.label, 60) } : null;
    }).filter(Boolean);
    return { nodes: nodes, links: links, note: str(raw.note, 600) };
  }

  // A process's simplified diagram (skills/mendix-describe/reference/descriptions-format.md, "diagram"),
  // drawn on the Processes page by the flow drawing (flowgraph.js): business steps, decisions with their
  // ways, ends. Karol, 2026-10-14: a process that branches — how an order finds its warehouse — reads better
  // drawn. Text only, bounded in size and depth; anything else in it is dropped.
  function diagramItems(list, depth) {
    if (!Array.isArray(list) || depth > 6) return [];
    return list.slice(0, 60).map(function (x) {
      if (!x || typeof x !== 'object') return null;
      if (str(x.decision, 200)) {
        var ways = (Array.isArray(x.ways) ? x.ways : []).slice(0, 6).map(function (w) {
          if (!w || typeof w !== 'object') return null;
          return { label: str(w.label, 60) || '', items: diagramItems(w.then, depth + 1), end: str(w.end, 160), join: str(w.join, 200) };
        }).filter(Boolean);
        return ways.length ? { t: 'decision', text: str(x.decision, 200), ways: ways } : null;
      }
      if (str(x.step, 200)) return { t: 'step', text: str(x.step, 200), who: str(x.who, 60), by: x.by === 'app' ? 'app' : 'person' };
      if (str(x.end, 160)) return { t: 'end', text: str(x.end, 160) };
      return null;
    }).filter(Boolean);
  }

  // A change the person asked an agent to work out (skills/mendix-describe/SKILL.md, "A change, when the
  // person asks"; Karol, 2026-10-14: "I have a change I want to make — how does it work now, and what
  // would the solution be"): the process as it works today, the proposed solution, the concrete changes to
  // the model, and what they touch. A proposal: MxScout shows it, and nothing of it is applied anywhere.
  // Text only, bounded; an entry without an id or a title is dropped, and so is a model change with an
  // action it does not know. The fields and their bounds: migration.md, "Changes (older files only)".
  var CHANGE_STATUS = { proposed: true, accepted: true, done: true, dropped: true };
  var CHANGE_KINDS = { microflow: true, nanoflow: true, page: true, entity: true, attribute: true, association: true, enumeration: true, security: true, 'scheduled event': true, integration: true, other: true };
  var CHANGE_ACTIONS = { add: true, change: true, remove: true };
  function texts(list, max, n) { return (Array.isArray(list) ? list : []).map(function (s) { return str(s, max); }).filter(Boolean).slice(0, n); }
  // The parts a change is made of, each bounded and text only — read here and, for the items on the
  // Assist page, by assist.js, so a proposal, a risk or a piece of evidence is read the same way in both.
  function kindOf(k) { k = typeof k === 'string' ? k.trim().toLowerCase() : ''; return CHANGE_KINDS[k] === true ? k : 'other'; }
  function modelChanges(list) {
    return (Array.isArray(list) ? list : []).slice(0, 60).map(function (x) {
      if (!x || typeof x !== 'object' || !str(x.target, 300) || CHANGE_ACTIONS[x.action] !== true) return null;
      return { kind: kindOf(x.kind), target: str(x.target, 300), action: x.action, what: str(x.what, 1000) };
    }).filter(Boolean);
  }
  function proposalOf(pr) {
    pr = pr && typeof pr === 'object' ? pr : {};
    return { summary: str(pr.summary, 2000), story: str(pr.story, STORY_MAX), steps: texts(pr.steps, 600, 100), diagram: diagramItems(pr.diagram, 0), changes: modelChanges(pr.changes) };
  }
  function nowOf(now) {
    now = now && typeof now === 'object' ? now : {};
    return { summary: str(now.summary, 2000), story: str(now.story, STORY_MAX), steps: texts(now.steps, 600, 100), flows: texts(now.flows, 300, 60), diagram: diagramItems(now.diagram, 0) };
  }
  // What a change touches: the flows, the roles and the data — or, written as one sentence, the data alone.
  function impactOf(im) {
    if (typeof im === 'string') return { flows: [], roles: [], data: str(im, 3000) };
    im = im && typeof im === 'object' ? im : {};
    return { flows: texts(im.flows, 300, 60), roles: texts(im.roles, 120, 30), data: str(im.data, 3000) };
  }
  function riskList(list) {
    return (Array.isArray(list) ? list : []).slice(0, 30).map(function (x) {
      return x && typeof x === 'object' && /^P[123]$/.test(x.level) && str(x.title, 300) ? { level: x.level, title: str(x.title, 300), detail: str(x.detail, 3000), fix: str(x.fix, 1000) } : null;
    }).filter(Boolean);
  }
  function evidenceOf(list) {
    return (Array.isArray(list) ? list : []).slice(0, 60).map(function (x) {
      if (!x || typeof x !== 'object' || !str(x.target, 300)) return null;
      return { kind: kindOf(x.kind), target: str(x.target, 300), what: str(x.what, 1000) };
    }).filter(Boolean);
  }
  function tracedOf(tr) {
    tr = tr && typeof tr === 'object' ? tr : {};
    return { steps: texts(tr.steps, 600, 100), flows: texts(tr.flows, 300, 60), diagram: diagramItems(tr.diagram, 0) };
  }
  // The known risk a ticket is about: an agent's risk by its id, or one a person raised by "c-" and its comment's id.
  function riskRef(v) { return typeof v === 'string' && (RISK_ID.test(v) && v.length <= 80 || /^c-[A-Za-z0-9_-]{1,80}$/.test(v)) ? v : null; }
  function changeOf(c) {
    if (!c || typeof c !== 'object') return null;
    var id = str(c.id, 80), title = str(c.title, 200);
    if (!id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !title) return null;
    return {
      id: id, title: title, asked: str(c.asked, 2000), date: str(c.date, 40), status: CHANGE_STATUS[c.status] === true ? c.status : 'proposed',
      now: nowOf(c.now), proposal: proposalOf(c.proposal), impact: impactOf(c.impact), risks: riskList(c.risks),
      open: texts(c.open, 1000, 30), effort: str(c.effort, 300)
    };
  }

  // A ticket checked against the model (Karol, 2026-10-14; since 2026-10-15 the mendix-assist skill writes Assist items instead, and a ticket an older file carries moves there — "I paste a ticket
  // reported on the application, it checks whether the ticket is right and keeps the result in the
  // documentation"): the ticket as it was pasted, a verdict — a bug in the model, works as designed, data
  // or configuration, or cannot tell from the model — with the reasoning, the behaviour as the model has
  // it, the places in the model that show it, what would settle it, a reply to paste back, and for a bug
  // the change that would fix it (an id among the Assist page's Ideas). An agent's judgement: MxScout shows it and
  // acts on none of it; a source address is kept as text and never opened. An entry without an id, a
  // title, a verdict or a summary is dropped. The fields and their bounds: migration.md, "Tickets (older files only)".
  var TICKET_VERDICTS = { bug: true, 'as-designed': true, 'data-config': true, 'cannot-tell': true };
  var CONFIDENCE = { high: true, medium: true, low: true };
  function ticketOf(t) {
    if (!t || typeof t !== 'object') return null;
    var id = str(t.id, 80), title = str(t.title, 200), summary = str(t.summary, 2000);
    if (!id || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || !title || TICKET_VERDICTS[t.verdict] !== true || !summary) return null;
    var change = str(t.change, 80);
    return {
      id: id, title: title, reported: str(t.reported, 8000), source: str(t.source, 300), date: str(t.date, 40),
      verdict: t.verdict, confidence: CONFIDENCE[t.confidence] === true ? t.confidence : 'low', summary: summary, story: str(t.story, STORY_MAX),
      traced: tracedOf(t.traced), evidence: evidenceOf(t.evidence),
      needs: texts(t.needs, 1000, 30), reply: str(t.reply, 4000),
      change: change && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(change) ? change : null,
      risk: riskRef(t.risk),
      risks: riskList(t.risks)
    };
  }

  // Checks the shape and keeps only what it understands, as text. Whatever
  // the file says is data to show, never markup and never instructions.
  function parse(text) {
    var raw;
    try { raw = JSON.parse(text); } catch (e) { return { error: 'That file is not JSON.' }; }
    if (!raw || raw.format !== DESC_FORMAT) return { error: 'That is not a descriptions file — it should say "format": "' + DESC_FORMAT + '".' };
    if (raw.version !== 1) return { error: 'This descriptions file is version ' + raw.version + '; this MxScout reads version 1.' };
    var out = {
      project: str(raw.project, 200), language: str(raw.language, 20), by: str(raw.by, 200), written: str(raw.written, 40),
      app: null, modules: {}, microflows: {}, nanoflows: {}, pages: {}, entities: {}
    };
    // "add": true — this file adds to what is kept rather than replacing it (see merge below).
    if (raw.add === true) out.add = true;
    // "describedAt": the version of the model the descriptions were saved against — MxScout writes it
    // (docs.js stamp), from the model's git commit; read back from a descriptions.json or a package.
    var dv = describedOf(raw.describedAt);
    if (dv) out.describedAt = dv;
    // "setLanguage": true — the person asked for another language: "language" becomes the project's
    // language of written content (docs.js noteLanguage). Not kept with the descriptions.
    if (raw.setLanguage === true) out.setLanguage = true;
    // ...and "replace": ["app"] — its application overview (summary, story, who uses it, the processes)
    // is the whole of it, in place of the one kept: an agent that wrote the overview again from the start.
    if (out.add && Array.isArray(raw.replace) && raw.replace.indexOf('app') !== -1) out.replace = ['app'];
    // The application, its processes and its modules come in two layers (skills/mendix-describe/reference/
    // business-narrative.md): a summary that is always shown and a story folded under it. Both are text.
    if (raw.app && typeof raw.app === 'object') {
      // Who uses it: a list of groups, each { who, what } (redesign spec 11), or — in a file written before — one sentence.
      var aud = raw.app.audience;
      out.app = {
        summary: str(raw.app.summary, 6000), story: str(raw.app.story, STORY_MAX), audience: str(aud, 1000),
        users: (Array.isArray(aud) ? aud : []).slice(0, 30).map(function (u) {
          return u && typeof u === 'object' && str(u.who, 120) ? { who: str(u.who, 120), what: str(u.what, 600) } : null;
        }).filter(Boolean),
        processes: (Array.isArray(raw.app.processes) ? raw.app.processes : []).slice(0, 200).map(function (p) {
          return p && typeof p === 'object' ? {
            name: str(p.name, 200), summary: str(p.summary, 2000), story: str(p.story, STORY_MAX),
            steps: (Array.isArray(p.steps) ? p.steps : []).map(function (s) { return str(s, 600); }).filter(Boolean).slice(0, 100),
            flows: (Array.isArray(p.flows) ? p.flows : []).map(function (s) { return str(s, 300); }).filter(Boolean).slice(0, 60),
            diagram: diagramItems(p.diagram, 0)
          } : null;
        }).filter(function (p) { return p && p.name; })
      };
    }
    function table(src, into, withNotes) {
      if (!src || typeof src !== 'object') return;
      Object.keys(src).forEach(function (k) {
        var v = src[k];
        var text = typeof v === 'string' ? str(v) : (v && typeof v === 'object' ? str(v.text) || str(v.summary) : null);
        var notes = withNotes && v && typeof v === 'object' ? notesOf(v.notes) : null;
        if (text || notes) into[k] = { text: text, hash: v && typeof v === 'object' ? str(v.hash, 16) : null, story: v && typeof v === 'object' ? str(v.story, STORY_MAX) : null, notes: notes };
      });
    }
    // One table per kind: a microflow and a page may share a qualified name.
    ['modules', 'microflows', 'nanoflows', 'pages', 'entities'].forEach(function (k) { table(raw[k], out[k], k === 'modules'); });
    // The architecture, if the agent drew it: the context and the containers, and what the model could not settle.
    var a4 = raw.c4 && typeof raw.c4 === 'object' ? raw.c4 : null;
    out.c4 = a4 ? { context: diagramOf(a4.context), containers: diagramOf(a4.containers), open: (Array.isArray(a4.open) ? a4.open : []).slice(0, 30).map(function (x) { return str(x, 500); }).filter(Boolean) } : null;
    if (out.c4 && !out.c4.context && !out.c4.containers) out.c4 = null;
    // Risks, ranked by the shared definition (skills/mendix-describe/reference/risk-levels.md), and what a
    // developer should know before changing the model. Text again; a level outside P1–P3 drops the risk.
    // A risk may carry an id (a short slug the agent keeps the same from one update to the next), which
    // is how MxScout knows it again: to merge it, and to keep what a person decided about it (triage.js).
    // A malformed id, one over 80 characters, or one used twice in the file, is dropped, and the risk is known by its level and title.
    var ids = Object.create(null);
    out.risks = (Array.isArray(raw.risks) ? raw.risks : []).slice(0, 2000).map(function (x) {
      if (!x || typeof x !== 'object' || !/^P[123]$/.test(x.level) || !str(x.title, 300)) return null;
      var id = typeof x.id === 'string' && x.id.length <= 80 && RISK_ID.test(x.id) && !ids[x.id] ? x.id : null;
      if (id) ids[id] = true;
      return {
        id: id, level: x.level, title: str(x.title, 300), detail: str(x.detail, 3000), fix: str(x.fix, 1000),
        // One of the report's ten themes (reportdata.js THEMES), when the agent names one; anything else is dropped.
        theme: /^(access|secrets|schedule|delete|loops|silent|hardcoded|dead|naming|logic)$/.test(x.theme) ? x.theme : null,
        where: (Array.isArray(x.where) ? x.where : []).map(function (s) { return str(s, 300); }).filter(Boolean).slice(0, 40)
      };
    }).filter(Boolean);
    // Whether the file carries a risks list at all — an empty one says "no risks any more", a missing
    // one says nothing about them; only the first may settle a risk marked fixed (triage.js).
    if (Array.isArray(raw.risks)) out.risksListed = true;
    // What the agent says about risks a PERSON raised and marked fixed (triage.js): still there or not,
    // and why. The id is the one the pack gave it, "c-" and the comment's id.
    out.verify = (Array.isArray(raw.verify) ? raw.verify : []).slice(0, 500).map(function (x) {
      return x && typeof x === 'object' && typeof x.id === 'string' && /^c-[A-Za-z0-9_-]{1,80}$/.test(x.id) && typeof x.still === 'boolean'
        ? { id: x.id, still: x.still, why: str(x.why, 1000) } : null;
    }).filter(Boolean);
    if (!out.verify.length) delete out.verify;
    var c = raw.context && typeof raw.context === 'object' ? raw.context : {};
    function pairs(list, a, b) {
      return (Array.isArray(list) ? list : []).slice(0, 80).map(function (x) {
        return x && typeof x === 'object' && str(x[a], 300) && str(x[b], 1000) ? [str(x[a], 300), str(x[b], 1000)] : null;
      }).filter(Boolean);
    }
    out.context = {
      where: pairs(c.where, 'topic', 'place'),
      conventions: pairs(c.conventions, 'pattern', 'meaning'),
      pitfalls: (Array.isArray(c.pitfalls) ? c.pitfalls : []).map(function (s) { return str(s, 1000); }).filter(Boolean).slice(0, 80)
    };
    if (!out.context.where.length && !out.context.conventions.length && !out.context.pitfalls.length) out.context = null;
    // Changes, each once: a second entry with an id already read is dropped.
    var ids = {};
    out.changes = (Array.isArray(raw.changes) ? raw.changes : []).slice(0, 100).map(changeOf).filter(function (x) {
      if (!x || ids[x.id]) return false;
      ids[x.id] = true;
      return true;
    });
    // Tickets, each once by its id, the same way.
    var tids = {};
    out.tickets = (Array.isArray(raw.tickets) ? raw.tickets : []).slice(0, 200).map(ticketOf).filter(function (x) {
      if (!x || tids[x.id]) return false;
      tids[x.id] = true;
      return true;
    });
    if (!out.app && !out.c4 && !out.risks.length && !out.verify && !out.context && !out.changes.length && !out.tickets.length && !['modules', 'microflows', 'nanoflows', 'pages', 'entities'].some(function (k) { return Object.keys(out[k]).length; })) {
      return { error: 'The file has the right format but no descriptions in it.' };
    }
    return { value: out };
  }

  // ---------- a risk's identity ----------
  // A risk is known by its id when the agent gave it one, and otherwise by its level and its title,
  // case and spacing aside — so files written before ids existed still match up.
  var RISK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  function titleKey(r) { return 't:' + r.level + ':' + String(r.title || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function riskKey(r) { return r.id ? 'id:' + r.id : titleKey(r); }
  // The risks of `more` laid over `base`: one that is already there — the same id, or the same level
  // and title — is replaced in its place by the newer copy; a new one is added at the end.
  function mergeRisks(base, more) {
    var out = (base || []).slice();
    (more || []).forEach(function (r) {
      var k = riskKey(r), t = titleKey(r), at = -1;
      out.forEach(function (x, i) { if (at < 0 && (riskKey(x) === k || titleKey(x) === t)) at = i; });
      if (at < 0) out.push(r); else out[at] = r;
    });
    return out;
  }

  // A model version as a descriptions file names it: the commit and what is shown beside it, as text.
  function describedOf(v) {
    if (!v || typeof v !== 'object' || typeof v.commit !== 'string' || !/^[0-9a-f]{40,64}$/.test(v.commit)) return null;
    return { commit: v.commit, short: v.commit.slice(0, 7), branch: str(v.branch, 200), date: str(v.date, 40), message: str(v.message, 200) };
  }

  // A file that says "add": true is laid over the descriptions already kept, not put in their place
  // (Karol, 2026-10-14: after reading the documentation, "describe this process too" — the agent sends
  // the one process, and the flows it described for it, and nothing else is lost). A process of the same
  // name is replaced, a new one is added at the end; a flow, page, entity or module described again is
  // replaced; a risk already kept (the same id, or the same level and title) is replaced by the newer
  // copy rather than added twice; a change with an id already kept is replaced, a new one added at the
  // end, and so is a ticket; the rest is kept as it was. The skill's
  // checker merges parts by the same rules (check-descriptions.js merge; test 48 runs both on the same files).
  function merge(base, more) {
    var out = JSON.parse(JSON.stringify(base || {
      project: null, language: null, by: null, written: null, app: null,
      modules: {}, microflows: {}, nanoflows: {}, pages: {}, entities: {}, risks: [], context: null, c4: null
    }));
    delete out.add; delete out.replace; delete out.risksListed; delete out.verify;
    ['modules', 'microflows', 'nanoflows', 'pages', 'entities'].forEach(function (k) {
      out[k] = out[k] || {};
      Object.keys(more[k] || {}).forEach(function (q) { out[k][q] = more[k][q]; });
    });
    if (more.app && more.replace && more.replace.indexOf('app') !== -1) out.app = JSON.parse(JSON.stringify(more.app));
    else if (more.app) {
      var a = out.app || (out.app = { summary: null, story: null, audience: null, users: [], processes: [] });
      if (more.app.summary) a.summary = more.app.summary;
      if (more.app.story) a.story = more.app.story;
      // Who uses it, when the part says — as groups or, in a file written before, as one sentence — replaces
      // what was kept (the checker's merge does the same: skills/mendix-describe/check-descriptions.js).
      if ((more.app.users && more.app.users.length) || more.app.audience) { a.users = more.app.users || []; a.audience = more.app.audience || null; }
      a.processes = a.processes || [];
      (more.app.processes || []).forEach(function (p) {
        var at = -1;
        a.processes.forEach(function (q, i) { if (at < 0 && q.name.toLowerCase() === p.name.toLowerCase()) at = i; });
        if (at < 0) a.processes.push(p); else a.processes[at] = p;
      });
    }
    out.risks = mergeRisks(out.risks, more.risks);
    // The developers' context adds up, an entry already kept not repeated.
    if (more.context) {
      var c = out.context || (out.context = { where: [], conventions: [], pitfalls: [] });
      ['where', 'conventions', 'pitfalls'].forEach(function (k) {
        var seen = {};
        c[k] = c[k] || [];
        c[k].forEach(function (x) { seen[JSON.stringify(x)] = true; });
        (more.context[k] || []).forEach(function (x) { var key = JSON.stringify(x); if (!seen[key]) { seen[key] = true; c[k].push(x); } });
      });
    }
    if (more.c4) out.c4 = more.c4;
    out.changes = out.changes || [];
    (more.changes || []).forEach(function (c) {
      var at = -1;
      out.changes.forEach(function (x, i) { if (at < 0 && x.id === c.id) at = i; });
      if (at < 0) out.changes.push(c); else out.changes[at] = c;
    });
    // A ticket the same way, by its id: checked again, it replaces the one kept.
    out.tickets = out.tickets || [];
    (more.tickets || []).forEach(function (t) {
      var at = -1;
      out.tickets.forEach(function (x, i) { if (at < 0 && x.id === t.id) at = i; });
      if (at < 0) out.tickets.push(t); else out.tickets[at] = t;
    });
    ['project', 'language', 'by'].forEach(function (k) { if (!out[k] && more[k]) out[k] = more[k]; });
    if (more.written) out.written = more.written;
    return out;
  }

  // A diagram as kept, written back the way a file writes it (diagramItems reads it again).
  function items(list) {
    return (list || []).map(function (x) {
      if (x.t === 'step') return { step: x.text, who: x.who, by: x.by };
      if (x.t === 'decision') return { decision: x.text, ways: x.ways.map(function (w) { return { label: w.label, then: items(w.items), end: w.end, join: w.join }; }) };
      return { end: x.text };
    });
  }

  // The descriptions as kept, written back as a descriptions file — for the .mxscout package
  // (transfer.js), whose receiving side reads them with parse() like any other file, so nothing
  // reaches its database that an import would not have let through. The tickets and changes an older
  // file carried are not written: they moved to the Assist page (assist.js), a local base that never
  // travels in a package (Karol, 2026-10-15).
  function toFile(v) {
    if (!v) return null;
    var f = { format: DESC_FORMAT, version: 1, project: v.project, language: v.language, by: v.by, written: v.written };
    if (v.describedAt) f.describedAt = v.describedAt;
    if (v.app) f.app = {
      summary: v.app.summary, story: v.app.story, audience: v.app.users && v.app.users.length ? v.app.users : v.app.audience,
      processes: (v.app.processes || []).map(function (p) { return { name: p.name, summary: p.summary, story: p.story, steps: p.steps, flows: p.flows, diagram: items(p.diagram) }; })
    };
    ['modules', 'microflows', 'nanoflows', 'pages', 'entities'].forEach(function (k) {
      f[k] = {};
      Object.keys(v[k] || {}).forEach(function (q) { var x = v[k][q]; f[k][q] = { text: x.text, hash: x.hash, story: x.story, notes: x.notes }; });
    });
    if (v.c4) f.c4 = v.c4;
    f.risks = v.risks || [];
    if (v.context) f.context = {
      where: v.context.where.map(function (x) { return { topic: x[0], place: x[1] }; }),
      conventions: v.context.conventions.map(function (x) { return { pattern: x[0], meaning: x[1] }; }),
      pitfalls: v.context.pitfalls
    };
    return f;
  }

  // Puts the descriptions on the documentation data, in place. A flow whose
  // fingerprint moved since it was described is marked, not hidden: an old
  // sentence is still a lead, as long as it says it may be out of date.
  function attach(data, d) {
    if (!d) return { described: 0, stale: 0, missing: 0 };
    var own = {};
    data.modules.forEach(function (m) { if (!m.marketplace) own[m.name] = true; });
    var described = 0, stale = 0, missing = 0;
    Object.keys(data.flows).forEach(function (k) {
      var f = data.flows[k];
      var x = (d[f.kind + 's'] || {})[f.qn];
      if (x) {
        f.desc = x.text;
        f.descStale = !!(x.hash && x.hash !== hashOf(f));
        if (f.kind !== 'page' && own[f.module]) { described++; if (f.descStale) stale++; }
      } else if (f.kind !== 'page' && own[f.module]) missing++;
    });
    Object.keys(data.entities).forEach(function (q) { if (d.entities[q]) data.entities[q].desc = d.entities[q].text; });
    data.ai = {
      app: d.app, by: d.by, written: d.written, language: d.language,
      // The model version the descriptions were saved against (parse: describedAt), or null.
      describedAt: d.describedAt || null,
      // A file imported before risks and context existed has neither.
      risks: d.risks || [], context: d.context || null,
      c4: d.c4 || null,
      // Not the tickets and changes an older file carries: they are items on the Assist page now
      // (assist.js migrate), kept apart from the documentation and never in the file it exports.
      modules: Object.keys(d.modules).reduce(function (o, k) { o[k] = { summary: d.modules[k].text, story: d.modules[k].story || null, notes: d.modules[k].notes || null }; return o; }, {})
    };
    return { described: described, stale: stale, missing: missing };
  }

  // One flow as the pack writes it — for a route that sends the model in pieces (copilot.js).
  // One element as the pack writes it, on its own: a flow or a page as flowText has it, an entity as its
  // line, its access and its validation rules, under a heading that names it in full. For the context put
  // aside for a chat assistant (basket.js) and the model's part of a workbook item's HTML (docs-assist.js).
  function elementText(data, kind, qn) {
    if (kind === 'entity') {
      var e = data.entities[qn];
      if (!e) return null;
      var out = ['### E ' + qn, entityLine(e, data)];
      accessLines(e, data, out);
      validationLines(e, out);
      return out.join('\n');
    }
    var f = data.flows[kind + ':' + qn];
    return f ? flowText(f) : null;
  }
  function flowText(f) { return remembered('text', f, function () { return flowLines(f).join('\n'); }); }
  // Its lines as the pack writes them, one entry a line — the pack's index counts them.
  function flowLines(f) { return remembered('lines', f, function () { var out = []; flowBlock(f, out); return out; }); }

  // The imported risks by the documents they name, for the screens that show
  // them beside a document (the App Explorer, Microflows). A risk names its
  // documents by qualified name; when two documents share one (a page and a
  // microflow both called Order_Edit) it is on both — unless the name says
  // which, as "Module.Name|mf" (mf, nf, pg, or en for an entity).
  var LEVELS = ['P1', 'P2', 'P3'];
  function riskIndex(d) {
    var all = (d && d.risks) || [], byDoc = {}, byModule = {};
    all.forEach(function (r, i) {
      var modulesHit = {};
      (r.where || []).forEach(function (w) {
        var m = /^([^|]+?)(?:\|(mf|nf|pg|dm|en))?$/.exec(String(w).trim());
        if (!m) return;
        var key = (m[2] === 'en' ? 'dm' : m[2] || '*') + ':' + m[1];
        (byDoc[key] = byDoc[key] || []).push(i);
        var dot = m[1].indexOf('.');
        if (dot > 0) modulesHit[m[1].slice(0, dot)] = true;
      });
      Object.keys(modulesHit).forEach(function (mod) { (byModule[mod] = byModule[mod] || []).push(i); });
    });
    return {
      all: all, byModule: byModule,
      // kindKey: mf, nf, pg or dm. Highest level first.
      of: function (kindKey, qn) {
        var seen = {}, out = [];
        (byDoc[kindKey + ':' + qn] || []).concat(byDoc['*:' + qn] || []).forEach(function (i) { if (!seen[i]) { seen[i] = true; out.push(all[i]); } });
        return out.sort(function (a, b) { return LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level); });
      },
      levels: function (risks) { return LEVELS.filter(function (l) { return risks.some(function (r) { return r.level === l; }); }); }
    };
  }

  // ---------- the language of written content ----------
  // A project's descriptions are written in ONE language, kept with the project (contentLanguage, an
  // ISO code; English when it is not set) so an agent does not switch between runs (Karol, 2026-10-15).
  // Headings, labels and field names stay English whatever it is: only the written content follows it.
  var LANGUAGES = [['en', 'English', 'english'], ['pl', 'Polish', 'polski'], ['de', 'German', 'deutsch'], ['nl', 'Dutch', 'nederlands'],
    ['fr', 'French', 'français'], ['es', 'Spanish', 'español'], ['it', 'Italian', 'italiano'], ['pt', 'Portuguese', 'português'],
    ['cs', 'Czech', 'čeština'], ['sk', 'Slovak', 'slovenčina'], ['sv', 'Swedish', 'svenska'], ['da', 'Danish', 'dansk'],
    ['nb', 'Norwegian', 'norsk'], ['fi', 'Finnish', 'suomi'], ['hu', 'Hungarian', 'magyar'], ['ro', 'Romanian', 'română'],
    ['uk', 'Ukrainian', 'українська'], ['lt', 'Lithuanian', 'lietuvių']];
  // "pl", "PL", "pl-PL", "Polish", "polski" → "pl"; another well-formed tag is kept as it is; anything else → null.
  function languageCode(x) {
    if (typeof x !== 'string' || !x.trim()) return null;
    var s = x.trim(), low = s.toLowerCase();
    for (var i = 0; i < LANGUAGES.length; i++) {
      var l = LANGUAGES[i];
      if (low === l[0] || low === l[1].toLowerCase() || low === l[2] || low.indexOf(l[0] + '-') === 0 || low.indexOf(l[0] + '_') === 0) return l[0];
    }
    return /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(s) ? low : null;
  }
  // "Polish (pl)".
  function languageName(code) {
    var c = languageCode(code) || 'en';
    for (var i = 0; i < LANGUAGES.length; i++) if (LANGUAGES[i][0] === c) return LANGUAGES[i][1] + ' (' + c + ')';
    return c + ' (' + c + ')';
  }

  // parts: how a change, a ticket and their pieces are read, for the Assist page's items (assist.js).
  var parts = { str: str, texts: texts, diagram: diagramItems, diagramFile: items, now: nowOf, proposal: proposalOf, impact: impactOf, risks: riskList, evidence: evidenceOf, traced: tracedOf,
    riskRef: riskRef, ticket: ticketOf, change: changeOf, VERDICTS: TICKET_VERDICTS, CONFIDENCE: CONFIDENCE, STORY_MAX: STORY_MAX };
  window.MxDescribe = { LANGUAGES: LANGUAGES, languageCode: languageCode, languageName: languageName, pack: pack, parse: parse, attach: attach, merge: merge, mergeRisks: mergeRisks, riskKey: riskKey, titleKey: titleKey, toFile: toFile, hashOf: hashOf, flowText: flowText, elementText: elementText, riskIndex: riskIndex, parts: parts, FORMAT: DESC_FORMAT, PACK_FORMAT: PACK_FORMAT };
})();
