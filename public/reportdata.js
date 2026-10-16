/* MxScout — the values the documentation report works out from its data.
 *
 * A port of the redesign handoff's reference implementation
 * (private/redesign-handoff/data/derive_report_data.py), function for
 * function, so the report shows the numbers the design was drawn on: the
 * risks with a theme each, which module uses which (and the order the
 * dependency matrix lists them in), the role matrix, the model-quality
 * checks, the developers' context with the modules each line names, the
 * processes with the risks that touch them, and each module's contents.
 *
 * Input is the documentation's own data (docs-data.js, with the agent's
 * descriptions attached by describe.js), the same object the exported file
 * carries; output is plain data. Where Python and JavaScript differ, the port
 * keeps Python's answer: \w matches any letter (Polish ones included), sorts
 * are stable, Counter.most_common keeps first-seen order on a tie.
 * test/56-report-data.test.js holds it to the reference's own output.
 */
(function () {
  'use strict';

  var KIND = { microflow: 'mf', nanoflow: 'nf', page: 'pg' };
  function moduleOf(qn) { return String(qn).split('.')[0]; }
  // Python's \w, for the patterns below: any letter, digit or underscore.
  function re(src, flags) { return new RegExp(src.replace(/\\w/g, '[\\p{L}\\p{N}_]'), 'u' + (flags || '')); }
  function sortBy(list, key) {
    // Stable, comparing key arrays the way Python compares tuples.
    return list.map(function (x, i) { return { x: x, k: key(x), i: i }; }).sort(function (a, b) {
      for (var j = 0; j < a.k.length; j++) {
        if (a.k[j] < b.k[j]) return -1;
        if (a.k[j] > b.k[j]) return 1;
      }
      return a.i - b.i;
    }).map(function (e) { return e.x; });
  }
  function counter(list) {
    var order = [], counts = {};
    list.forEach(function (k) { if (!(k in counts)) { counts[k] = 0; order.push(k); } counts[k]++; });
    return { counts: counts, mostCommon: function () { return sortBy(order, function (k) { return [-counts[k]]; }).map(function (k) { return [k, counts[k]]; }); }, get: function (k) { return counts[k] || 0; } };
  }

  // ---------- risks ----------
  // TEMPORARY in the reference too: a theme from keywords in the (Polish)
  // title, until the agent writes `theme` itself. First match wins.
  var THEMES = [
    ['access', 'Missing access checks', ['sprawdzeni[ae] wywołującego', 'rola User', 'roli User', 'ufaj', 'ufa ', 'dowoln', 'właściciela', '[Zz]wykli użytkownicy', 'bez kontroli', 'sprawdzenia dostępu', 'uwierzytel', 'kto może', 'kto wywołuje', 'powiązania wywołującego', 'nie sprawdza, kto', 'odbiera dostęp', 'administratorem zespołu', 'Operator może']],
    ['secrets', 'Secrets in the model', ['[Kk]lucz szyfrowania', '[Hh]asło', 'jawnym tekstem', '[Pp]oświadczenia', '[Tt]oken', 'sekret']],
    ['schedule', 'Relies on switched-off events', ['harmonogram\\w* wyłączon', 'wyłączon\\w* w modelu', 'są wyłączone', 'wyłączonych harmonogram']],
    ['delete', 'Deletes too much', ['usuwa', '[Uu]sunięcie', 'usuwane', 'psuje', 'usunąć']],
    ['loops', 'Commits in loops', ['pojedynczo', '[Cc]ommit', 'w pętl', 'jednej transakcji', 'dla każdego rekordu', 'wszystkich zgłoszeniach naraz', 'rekord po rekordzie', 'wiersz po wierszu']],
    ['silent', 'Errors that vanish', ['obsługi błędów', 'cicho', 'bez śladu', 'przepadają', 'giną', 'zawodzi', 'kończy się błędem', 'kończą się błędem', 'zatrzymuje', 'nie dociera', 'ignorowane', 'nie działa', 'ścieżki błędów']],
    ['hardcoded', 'Values written into flows', ['zapisane w przepływach', 'wpisane w przepływ', 'na sztywno', 'na stałe', 'w wyrażeniu', '[Ss]tałe wartości', '[Ss]tałe nazwy', '[Ww]artości wpisane', 'zapisan\\w* w przepływ', 'wpisan\\w* w ogólny', '[Ww]artości zastępcze', '[Ww]artości biznesowe']],
    ['dead', 'Unused or duplicated', ['[Nn]ieosiągaln', '[Nn]ieużywan', '[Zz]dublowan', '[Zz]duplikowan', 'bez wywołujących', 'bez widocznego', '[Pp]usty', '[Mm]artwy', '[Pp]ozostałości', '[Nn]iepodłączone', 'skopiowany', 'kopiowane', '[Nn]iedokończone', 'pozostawione w aplikacji', 'jednorazowy', '[Ww]yłączony krok']],
    ['naming', 'Names and messages', ['[Ll]iterówk', 'komunikat', '[Nn]azwy', '[Nn]azwach']]
  ].map(function (t) { return [t[0], t[1], t[2].map(function (p) { return re(p); })]; });
  var THEME_FALLBACK = ['logic', 'Logic and data errors'];
  var THEME_LABELS = {};
  THEMES.forEach(function (t) { THEME_LABELS[t[0]] = t[1]; });
  THEME_LABELS[THEME_FALLBACK[0]] = THEME_FALLBACK[1];

  function riskTheme(title) {
    for (var i = 0; i < THEMES.length; i++) {
      if (THEMES[i][2].some(function (r) { return r.test(title); })) return THEMES[i][0];
    }
    return THEME_FALLBACK[0];
  }
  function elementKinds(d) {
    var kind = {};
    d.modules.forEach(function (m) {
      ['microflows', 'nanoflows', 'pages'].forEach(function (key) {
        (m[key] || []).forEach(function (x) { var i = x.indexOf(':'); kind[x.slice(i + 1)] = KIND[x.slice(0, i)]; });
      });
    });
    Object.keys(d.entities).forEach(function (q) { if (!(q in kind)) kind[q] = 'en'; });
    return kind;
  }
  // [level, theme, title, detail, fix, ["Qualified.Name|kind", …]]
  function deriveRisks(d) {
    var kind = elementKinds(d);
    return ((d.ai && d.ai.risks) || []).map(function (r) {
      return [r.level, r.theme || riskTheme(r.title), r.title, r.detail, r.fix, (r.where || []).map(function (w) { return w + '|' + (kind[w] || 'x'); })];
    });
  }

  // ---------- module dependencies ----------
  // uses[a][b] = [calls, associations]
  function moduleLinks(d) {
    var M = {};
    d.modules.forEach(function (m) { M[m.name] = true; });
    var uses = {}, order = [];
    function cell(a, b) {
      if (!uses[a]) { uses[a] = { _order: [] }; order.push(a); }
      if (!uses[a][b]) { uses[a][b] = [0, 0]; uses[a]._order.push(b); }
      return uses[a][b];
    }
    Object.keys(d.flows).forEach(function (k) {
      var f = d.flows[k];
      (f.calls || []).forEach(function (c) {
        var cm = moduleOf(c.qn);
        if (cm !== f.module && M[cm]) cell(f.module, cm)[0] += 1;
      });
    });
    (d.associations || []).forEach(function (a) {
      var fm = moduleOf(a.from), tm = moduleOf(a.to);
      if (fm !== tm && M[fm] && M[tm]) cell(fm, tm)[1] += 1;
    });
    var out = {};
    order.forEach(function (a) { out[a] = {}; uses[a]._order.forEach(function (b) { out[a][b] = uses[a][b]; }); });
    return out;
  }
  function dsmOrder(d, uses) {
    var usedBy = counter([].concat.apply([], Object.keys(uses).map(function (a) { return Object.keys(uses[a]); })));
    return sortBy(d.modules.map(function (m) { return m.name; }), function (m) { return [usedBy.get(m), -Object.keys(uses[m] || {}).length, m.toLowerCase()]; });
  }
  function lowerSort(names) { return sortBy(names, function (n) { return [n.toLowerCase()]; }); }

  // ---------- architecture ----------
  function deriveArch(d) {
    var uses = moduleLinks(d);
    var M = {};
    d.modules.forEach(function (m) { M[m.name] = true; });
    var roles = (d.roles || []).map(function (r) {
      var own = {}, ownOrder = [], other = [];
      (r.moduleRoles || []).forEach(function (x) {
        var i = x.indexOf('.'), mod = x.slice(0, i), rn = x.slice(i + 1);
        if (M[mod]) { if (!own[mod]) { own[mod] = []; ownOrder.push(mod); } own[mod].push(rn); } else other.push(x);
      });
      var o = {};
      ownOrder.forEach(function (k) { o[k] = own[k]; });
      return { n: r.name, own: o, other: other };
    });
    var c4 = (d.ai && d.ai.c4) || null;
    return {
      ctx: c4 ? c4.context : null, cont: c4 ? c4.containers : null, open: c4 ? c4.open : null,
      serv: (d.services || []).map(function (s) { return [s.name, s.kind]; }),
      sched: (d.scheduled || []).map(function (s) { return [s.name, s.schedule, s.enabled]; }),
      order: dsmOrder(d, uses), mat: uses, roles: roles,
      mods: lowerSort(Object.keys(M))
    };
  }

  // ---------- model quality ----------
  var MENDIX_PREFIXES = {};
  'BCO ACO BCR ACR BDE ADE BRO ARO CAL OEN OCH OLE DS ACT IVK WFA WFS WFC VAL SCE ASU BSD HCH SUB TEST UT CWS CRS PWS PRS POS DCM'.split(' ').forEach(function (p) { MENDIX_PREFIXES[p] = true; });
  var PREFIX_ADVICE = {
    GET: 'no prefix, or SUB_ when called from other flows', Get: 'no prefix, or SUB_', UPD: 'no prefix, or SUB_',
    DEL: 'no prefix, or SUB_', SHOW: 'ACT_ when started from a page', BCo: 'BCO_ (before commit)',
    BDe: 'BDE_ (before delete)', SCH: 'SCE_ (scheduled event)', Schedule: 'SCE_ (scheduled event)',
    AAATODELETE: 'remove the flow once unused'
  };
  var MAX_ELEMENTS = 25; // Mendix general best practices: a microflow should not exceed 25 elements
  function isUpper(s) { return s === s.toUpperCase() && s !== s.toLowerCase(); }

  function disabledSteps(d) {
    var found = [];
    function walk(items, flow) {
      (items || []).forEach(function (it) {
        if (it.t === 'step' && it.card && it.card.off) {
          var c = it.card;
          found.push({ flow: flow, no: it.no === undefined ? null : it.no, kick: c.kick === undefined ? null : c.kick, title: c.title === undefined ? null : c.title });
        }
        (it.branches || []).forEach(function (b) { walk(b.body, flow); });
        if (it.body && it.body.length) walk(it.body, flow);
      });
    }
    Object.keys(d.flows).forEach(function (k) { walk(d.flows[k].workflow, d.flows[k].qn); });
    return found;
  }

  function deriveQuality(d) {
    var F = d.flows;
    var flows = Object.keys(F).map(function (k) { return F[k]; }).filter(function (f) { return f.kind !== 'page'; });
    var unreached = d.quality.unreached.map(function (k) {
      var i = k.indexOf(':'), kind = k.slice(0, i), qn = k.slice(i + 1), f = F[k] || {};
      return [KIND[kind], qn, f.steps || 0, (f.path || []).join('/'), f.desc || ''];
    });
    var biggest = sortBy(flows, function (f) { return [-(f.steps || 0)]; });
    var over = flows.filter(function (f) { return (f.steps || 0) > MAX_ELEMENTS; });
    var pref = {}, prefOrder = [];
    flows.forEach(function (f) {
      var m = /^([A-Za-z]+)_/.exec(f.name);
      if (!m || MENDIX_PREFIXES[m[1]]) return;
      var p = m[1];
      if (isUpper(p) || MENDIX_PREFIXES[p.toUpperCase()] || p === 'Get' || p === 'Schedule') {
        if (!pref[p]) { pref[p] = []; prefOrder.push(p); }
        pref[p].push(f.qn);
      }
    });
    var mfs = Object.keys(F).map(function (k) { return F[k]; }).filter(function (f) { return f.kind === 'microflow'; });
    var ea = {}, eaOrder = [];
    mfs.forEach(function (f) {
      if (!ea[f.module]) { ea[f.module] = [0, 0, 0]; eaOrder.push(f.module); }
      var x = ea[f.module];
      x[0] += 1; x[1] += f.roles && f.roles.length ? 1 : 0; x[2] += f.entityAccess ? 1 : 0;
    });
    var off = disabledSteps(d);
    return {
      unr: unreached,
      large: biggest.slice(0, 24).map(function (f) { return [KIND[f.kind], f.qn, f.steps]; }),
      over: over.length, overMod: counter(over.map(function (f) { return f.module; })).mostCommon(),
      pref: sortBy(prefOrder, function (p) { return [-pref[p].length]; }).map(function (p) { return [p, pref[p].length, PREFIX_ADVICE[p] || '', pref[p].slice(0, 3)]; }),
      prefN: prefOrder.reduce(function (n, p) { return n + pref[p].length; }, 0),
      ea: sortBy(eaOrder.map(function (m) { return [m].concat(ea[m]); }), function (r) { return [-r[2]]; }),
      eaApplied: mfs.filter(function (f) { return f.entityAccess; }).length, eaTotal: mfs.length,
      eaRoleNo: mfs.filter(function (f) { return f.roles && f.roles.length && !f.entityAccess; }).length,
      eaRole: mfs.filter(function (f) { return f.roles && f.roles.length; }).length,
      sched: (d.scheduled || []).map(function (s) { return [s.name, s.schedule, s.enabled]; }),
      off: off.length ? off[0] : null, offAll: off,
      flowsN: flows.length
    };
  }

  // ---------- for developers ----------
  function mentionedModules(text, modules) {
    var out = [], m, r = re('\\b([A-Za-z_][A-Za-z0-9_]*)\\.(?=[A-Za-z_])', 'g');
    while ((m = r.exec(text))) if (modules[m[1]] && out.indexOf(m[1]) === -1) out.push(m[1]);
    return out;
  }
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&'); }
  function patternCount(pattern, names) {
    var p = pattern.replace(/\(.*?\)/g, '').trim();
    var regs = [];
    var parts = p.split('/').map(function (x) { return x.trim(); });
    for (var i = 0; i < parts.length; i++) {
      var a = parts[i];
      if (!a || !/^[A-Za-z0-9_<>…*.]+$/.test(a)) return null;
      a = a.indexOf('.') !== -1 ? a.split('.').pop() : a;
      a = a.replace(/<[^>]+>/g, '\u0000').replace(/…/g, '\u0000').replace(/\*/g, '\u0000');
      var src = escapeRe(a).replace(/\u0000/g, '.+');
      regs.push(new RegExp('^' + src + (a.slice(-1) === '_' ? '.*' : '$')));
    }
    return names.filter(function (n) { return regs.some(function (rg) { return rg.test(n); }); }).length;
  }
  function deriveDev(d) {
    var ctx = (d.ai && d.ai.context) || { where: [], conventions: [], pitfalls: [] };
    var M = {};
    d.modules.forEach(function (m) { M[m.name] = true; });
    var names = Object.keys(d.flows).map(function (k) { return d.flows[k].name; });
    return {
      where: ctx.where.map(function (x) { return [x[0], x[1], mentionedModules(x[0] + ' ' + x[1], M)]; }),
      conv: ctx.conventions.map(function (x) { return [x[0], x[1], patternCount(x[0], names), mentionedModules(x[0] + ' ' + x[1], M)]; }),
      pit: ctx.pitfalls.map(function (p) { return [p, mentionedModules(p, M)]; })
    };
  }

  // ---------- processes ----------
  function deriveProcesses(d, risks) {
    var byQn = {};
    Object.keys(d.flows).forEach(function (k) { byQn[d.flows[k].qn] = d.flows[k]; });
    var app = (d.ai && d.ai.app) || null;
    if (!app) return { app: null, procs: [] };
    var procs = (app.processes || []).map(function (p) {
      var flows = p.flows.map(function (q) { var f = byQn[q]; return [q, f ? (KIND[f.kind] || 'x') : 'x', f ? (f.steps || 0) : 0]; });
      var fs = {};
      p.flows.forEach(function (q) { fs[q] = true; });
      var rk = [];
      risks.forEach(function (r, i) { if (r[5].some(function (w) { return fs[w.split('|')[0]]; })) rk.push([r[0], r[2], i]); });
      rk = sortBy(rk, function (x) { return [x[0]]; });
      return { name: p.name, sum: p.summary, story: p.story, steps: p.steps, flows: flows, risks: rk };
    });
    return { app: { sum: app.summary, aud: app.audience, story: app.story }, procs: procs };
  }

  // ---------- modules ----------
  function deriveModules(d, risks) {
    var F = d.flows;
    var uses = moduleLinks(d);
    var sched = {}, serv = {};
    (d.scheduled || []).forEach(function (s) { var i = s.name.indexOf('.'); (sched[s.name.slice(0, i)] = sched[s.name.slice(0, i)] || []).push([s.name.slice(i + 1), s.schedule, s.enabled]); });
    (d.services || []).forEach(function (s) { var i = s.name.indexOf('.'); (serv[s.name.slice(0, i)] = serv[s.name.slice(0, i)] || []).push([s.name.slice(i + 1), s.kind]); });
    var aiMods = (d.ai && d.ai.modules) || {};
    return d.modules.map(function (m) {
      var n = m.name, items = [];
      [['microflows', 'mf'], ['nanoflows', 'nf'], ['pages', 'pg']].forEach(function (kk) {
        (m[kk[0]] || []).forEach(function (x) { var f = F[x]; items.push([kk[1], f.name, f.steps || 0, f.calledBy.length, f.roles.length]); });
      });
      var ai = aiMods[n] || {};
      var rl = counter(risks.filter(function (r) { return r[5].length && moduleOf(r[5][0].split('|')[0]) === n; }).map(function (r) { return r[0]; }));
      return {
        n: n, mp: m.marketplace, sum: ai.summary === undefined ? null : ai.summary, story: ai.story === undefined ? null : ai.story,
        notes: (ai.notes || []).map(function (x) { return { title: x.title === undefined ? null : x.title, text: x.text === undefined ? null : x.text, items: x.items || [], table: x.table === undefined ? null : x.table }; }),
        items: items, ent: (m.entities || []).map(function (q) { return q.slice(q.indexOf('.') + 1); }),
        uses: uses[n] || {}, risk: [rl.get('P1'), rl.get('P2'), rl.get('P3')],
        sched: sched[n] || [], serv: serv[n] || []
      };
    });
  }

  // ---------- one module's domain model ----------
  function typeLabel(t) {
    if (t.indexOf('String') === 0) {
      var m = /^String\((\d+)\)/.exec(t);
      return ['String', m ? 'String · ' + m[1] : 'String · unlimited'];
    }
    if (t.indexOf('Enumeration') === 0) return ['Enum', 'Enumeration · ' + t.slice(t.indexOf(' ') + 1)];
    var known = { Boolean: ['Bool', 'Boolean'], Integer: ['Int', 'Integer'], Long: ['Long', 'Long'], AutoNumber: ['Auto', 'AutoNumber'], DateTime: ['Date', 'Date and time'], Decimal: ['Dec', 'Decimal'] };
    return known[t] || [t, t];
  }
  function prettyXpath(x) {
    if (!x) return null;
    var s = x.replace(/\s+/g, ' ').trim();
    s = s.replace(re('\\b[A-Za-z_]\\w*\\.(?=[A-Za-z_]\\w*)', 'g'), '');
    // A space either side of an operator, without splitting != <= >= in two.
    s = s.split(' or ').join(' or\n').replace(/\s*(!=|<=|>=|=)\s*/g, ' $1 ');
    return s.replace(/ +/g, ' ');
  }
  function deriveDomain(d, module) {
    var E = d.entities, ents = {};
    Object.keys(E).forEach(function (q) {
      var e = E[q];
      if (e.module !== module) return;
      ents[e.name] = {
        pers: e.persistable, view: e.view, gen: e.generalization, desc: e.desc || e.doc || null,
        attrs: e.attributes.map(function (a) { return [a.name].concat(typeLabel(a.type)); }),
        access: e.access.map(function (ac) { return [ac.role.slice(ac.role.indexOf('.') + 1), ac.userRoles, ac.read, ac.write, ac.create, ac.del, prettyXpath(ac.xpath)].concat(ac.members ? [ac.members] : []); })
      };
    });
    var assoc = (d.associations || []).filter(function (a) { return a.from.indexOf(module + '.') === 0 || a.to.indexOf(module + '.') === 0; })
      .map(function (a) { return [a.name, a.from, a.to, a.many]; });
    var mods = sortBy(counter(Object.keys(E).map(function (q) { return E[q].module; })).mostCommon(), function (x) { return [x[0].toLowerCase()]; });
    return { ents: ents, assoc: assoc, mods: mods };
  }

  // Everything at once, as the report needs it. The domain model is per
  // module, so it is a function rather than data.
  function derive(d) {
    var risks = deriveRisks(d);
    return {
      risks: risks, arch: deriveArch(d), quality: deriveQuality(d), dev: deriveDev(d),
      proc: deriveProcesses(d, risks), modules: deriveModules(d, risks),
      // The pattern of each risk that no longer counts (the risk triage (Developer tools)), for the Risks page's filters.
      triaged: ((d.ai && d.ai.triaged) || []).map(function (r) { return r.theme || riskTheme(r.title); })
    };
  }

  window.MxReportData = {
    derive: derive, domain: deriveDomain, risks: deriveRisks, arch: deriveArch, quality: deriveQuality, dev: deriveDev,
    processes: deriveProcesses, modules: deriveModules, moduleLinks: moduleLinks, theme: riskTheme, THEME_LABELS: THEME_LABELS
  };
})();
