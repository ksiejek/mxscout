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
 *    entity with its members and associations — in a dense text a model reads
 *    cheaply, one section per module, an index of line ranges at the top so
 *    an agent reads one module at a time, and a fingerprint per flow so the
 *    next run describes only what changed;
 *  - the descriptions file, which the agent writes and MxScout imports: JSON,
 *    checked here before anything of it is kept.
 *
 * MxScout opens no connection for any of this and runs no model. The pack is
 * a browser download; the descriptions arrive by a file the reader picks. In
 * the documentation every imported sentence is marked as written by AI,
 * because the rest of it is read from the model and says so.
 */
(function () {
  'use strict';

  var PACK_FORMAT = 'mxscout-ai-pack';
  var DESC_FORMAT = 'mxscout-descriptions';
  var MAX_VALUE = 200;

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
  function hashOf(f) {
    if (f.kind === 'page') return fnv(JSON.stringify([f.params, f.roles]));
    return fnv(JSON.stringify([f.params, f.returns, f.workflow]));
  }
  function entityHash(e, assoc) { return fnv(JSON.stringify([e.attributes, e.generalization, assoc])); }

  // ---------- the pack ----------
  function cut(v) {
    var s = String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim();
    return s.length > MAX_VALUE ? s.slice(0, MAX_VALUE - 1) + '…' : s;
  }
  function short(qn) { return String(qn || '').split('.').pop(); }

  function stepLines(list, depth, out) {
    var pad = new Array(depth + 1).join('  ');
    (list || []).forEach(function (b) {
      if (b.t === 'start') return;
      if (b.t === 'end') { out.push(pad + '- ' + (b.kind === 'errorEvent' ? 'error end' : b.kind === 'break' ? 'break' : b.kind === 'continue' ? 'next iteration' : 'end') + (b.returns ? ' returns ' + cut(b.returns) : '')); return; }
      if (b.t === 'go') { out.push(pad + '- ↪ step ' + (b.no || '?')); return; }
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

  // data is what MxDocsData.build returns.
  function pack(data) {
    var own = data.modules.filter(function (m) { return !m.marketplace && (m.microflows.length + m.nanoflows.length + m.pages.length + m.entities.length); });
    var market = data.modules.filter(function (m) { return m.marketplace; }).map(function (m) { return m.name; });
    var blocks = own.map(function (m) {
      var out = ['## module ' + m.name];
      if (m.entities.length) {
        out.push('### entities');
        m.entities.forEach(function (q) { out.push(entityLine(data.entities[q], data)); });
      }
      m.microflows.concat(m.nanoflows, m.pages).forEach(function (k) { out.push(''); flowBlock(data.flows[k], out); });
      out.push('');
      return { m: m, lines: out };
    });
    var head = [
      '# MxScout AI pack',
      'format: ' + PACK_FORMAT + ' 1',
      'project: ' + data.project,
      (data.mendix ? 'mendix: ' + data.mendix : null),
      'generated: ' + data.generatedAt,
      'read with: the mendix-describe skill (skills/mendix-describe in the MxScout repository); it says what to write and in what format',
      'roles: ' + data.roles.map(function (r) { return r.name; }).join(', '),
      data.scheduled.length ? 'scheduled events: ' + data.scheduled.map(function (s) { return short(s.name) + ' → ' + (s.microflow || '?') + (s.enabled ? '' : ' (off)'); }).join('; ') : null,
      data.services.length ? 'published services: ' + data.services.map(function (s) { return s.name + (s.kind ? ' (' + s.kind + ')' : ''); }).join('; ') : null,
      market.length ? 'not included: ' + market.length + ' Marketplace modules — ' + market.join(', ') : null,
      'legend: MF microflow, NF nanoflow, PG page, E entity; #xxxxxxxx is a fingerprint — copy it into the description; {member=value} is the data a step sets or passes; → owns an association to, ← is owned by',
      ''
    ].filter(function (l) { return l !== null; });
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
    return { text: text, id: fnv(text), modules: own.length, flows: own.reduce(function (n, m) { return n + m.microflows.length + m.nanoflows.length; }, 0) };
  }

  // ---------- the descriptions file ----------
  function str(v, max) { return typeof v === 'string' && v.trim() ? v.trim().slice(0, max || 4000) : null; }

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
    if (raw.app && typeof raw.app === 'object') {
      out.app = {
        summary: str(raw.app.summary, 6000), audience: str(raw.app.audience, 1000),
        processes: (Array.isArray(raw.app.processes) ? raw.app.processes : []).slice(0, 40).map(function (p) {
          return p && typeof p === 'object' ? {
            name: str(p.name, 200), summary: str(p.summary, 2000),
            steps: (Array.isArray(p.steps) ? p.steps : []).map(function (s) { return str(s, 600); }).filter(Boolean).slice(0, 30),
            flows: (Array.isArray(p.flows) ? p.flows : []).map(function (s) { return str(s, 300); }).filter(Boolean).slice(0, 60)
          } : null;
        }).filter(function (p) { return p && p.name; })
      };
    }
    function table(src, into) {
      if (!src || typeof src !== 'object') return;
      Object.keys(src).forEach(function (k) {
        var v = src[k];
        var text = typeof v === 'string' ? str(v) : (v && typeof v === 'object' ? str(v.text) : null);
        if (text) into[k] = { text: text, hash: v && typeof v === 'object' ? str(v.hash, 16) : null };
      });
    }
    // One table per kind: a microflow and a page may share a qualified name.
    ['modules', 'microflows', 'nanoflows', 'pages', 'entities'].forEach(function (k) { table(raw[k], out[k]); });
    if (!out.app && !['modules', 'microflows', 'nanoflows', 'pages', 'entities'].some(function (k) { return Object.keys(out[k]).length; })) {
      return { error: 'The file has the right format but no descriptions in it.' };
    }
    return { value: out };
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
      modules: Object.keys(d.modules).reduce(function (o, k) { o[k] = d.modules[k].text; return o; }, {})
    };
    return { described: described, stale: stale, missing: missing };
  }

  window.MxDescribe = { pack: pack, parse: parse, attach: attach, hashOf: hashOf, FORMAT: DESC_FORMAT, PACK_FORMAT: PACK_FORMAT };
})();
