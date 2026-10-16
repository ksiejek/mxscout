/* MxScout — the documentation as one file.
 *
 * MxScout's "Export documentation" (docs.js) writes it in the browser; a
 * tool that reads a .mpr itself can write the same file in Node, loading
 * these same files (Karol, 2026-10-14: "exactly the report MxScout builds").
 * So how the file is put together lives here, once, and each program only
 * says where the stylesheets and scripts come from: fetched from this
 * server, or read from disk.
 *
 * The file: the documentation's data as JSON in a block the browser never
 * runs, the reader (docs-view.js) and the flow screen it shows microflows
 * with (flowview.js and what it draws with), and one stylesheet with its
 * fonts inlined. Nothing in it loads anything from anywhere. */
(function () {
  'use strict';

  // In this order: tokens.css first (its fonts are inlined by the caller, see fontsIn), docs.css last.
  var SHEETS = ['tokens.css', 'explorer.css', 'flowgraph.css', 'studioview.css', 'pagepreview.css', 'microflows.css', 'docs.css'];
  // "Microflows & pages" in the file is MxScout's own Microflows screen (flowview.js, redesign spec
  // 14), so the file carries it and what it draws with — a page with pagepreview.js — as the files themselves, unchanged.
  // The risk triage's labels on the Risks page (docs-triage.js) are drawn by a file of its own as well, carried the same way.
  // Not the Assist page's files (docs-assist.js, docs-tickets.js, docs-changes.js): the file carries no Assist item.
  // The Solved cases page (docs-knowledge.js) is drawn by a file of its own; the file carries the cases themselves only when the export was asked for them.
  var SCRIPTS = ['flowtrace.js', 'flowgraph.js', 'studioview.js', 'pagepreview.js', 'flowview.js', 'docs-triage.js', 'docs-knowledge.js'];

  // The fonts tokens.css names, as they are written in it: url("fonts/X.woff2").
  function fontsIn(tokens) { return tokens.match(/url\("fonts\/[A-Za-z0-9_-]+\.woff2"\)/g) || []; }
  function fontPath(u) { return u.slice(5, -2); }

  // What the report's pages work out from the data (reportdata.js), put on it once.
  function withDerived(data) {
    data.derived = window.MxReportData.derive(data);
    data.derived.domain = {};
    data.modules.forEach(function (m) { if (m.entities.length) data.derived.domain[m.name] = window.MxReportData.domain(data, m.name); });
    return data;
  }

  // The documentation of the chosen modules only. Flows and entities of the
  // others are left out; a call or an association that leads to one of them
  // stays named, as a reference this file does not follow.
  function subset(data, keep) {
    var out = Object.assign({}, data);
    out.modules = data.modules.filter(function (m) { return keep[m.name]; });
    out.flows = {};
    Object.keys(data.flows).forEach(function (k) { if (keep[data.flows[k].module]) out.flows[k] = data.flows[k]; });
    out.entities = {};
    Object.keys(data.entities).forEach(function (q) { if (keep[data.entities[q].module]) out.entities[q] = data.entities[q]; });
    out.associations = data.associations.filter(function (a) { return out.entities[a.from] || out.entities[a.to]; });
    var disabled = 0;
    function countOff(list) {
      (list || []).forEach(function (b) {
        if (b.card && b.card.off) disabled++;
        countOff(b.body); countOff(b.error);
        (b.branches || []).forEach(function (x) { countOff(x.body); });
      });
    }
    var kinds = { microflow: 0, nanoflow: 0, page: 0 };
    Object.keys(out.flows).forEach(function (k) { kinds[out.flows[k].kind]++; countOff(out.flows[k].workflow); });
    out.quality = Object.assign({}, data.quality, {
      unreached: data.quality.unreached.filter(function (k) { return out.flows[k]; }), disabled: disabled
    });
    out.kpi = Object.assign({}, data.kpi, {
      modules: out.modules.filter(function (m) { return !m.marketplace; }).length,
      marketplace: out.modules.filter(function (m) { return m.marketplace; }).length,
      microflows: kinds.microflow, nanoflows: kinds.nanoflow, pages: kinds.page,
      entities: Object.keys(out.entities).length
    });
    return out;
  }

  var CLOSE_SCRIPT = '</' + 'script>';
  // The data rides as JSON in a block the browser never runs, with every "<"
  // escaped, so no text from the model can end that block or become markup.
  function payload(data) { return JSON.stringify(data).replace(/</g, '\\u003c'); }
  function mountScript() {
    return [
      '(function(){',
      '  var d = JSON.parse(document.getElementById("mxscout-data").textContent);',
      '  window.MxDocsView.mount(d, document.getElementById("doc"), { hash:true, theme:"light" });',
      '})();'
    ].join('\n');
  }

  // The page's language: the one given, or the one the descriptions were written in, when it is a
  // language tag ("pl", "en-GB"); otherwise English, the language of the reader's own labels.
  function langOf(data, lang) {
    var l = typeof lang === 'string' ? lang : data && data.ai && data.ai.language;
    return typeof l === 'string' && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(l.trim()) ? l.trim() : 'en';
  }

  // css: the sheets of SHEETS joined, fonts inlined; scripts: the sources of SCRIPTS, in order;
  // lang (optional): the page's language, by default the descriptions'.
  function build(data, css, title, scripts, lang) {
    return [
      '<!doctype html>',
      '<html lang="' + langOf(data, lang) + '"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      // The project's documentation, not the tool's (redesign spec 10 §1): no tool is named in it.
      '<title>' + String(title).replace(/[<>&"]/g, '') + ' – documentation</title>',
      '<style>html,body{margin:0;height:100%}#doc{height:100vh}\n' + css.replace(/<\/style/gi, '') + '</style>',
      '</head><body>',
      '<div id="doc"></div>',
      '<script type="application/json" id="mxscout-data">' + payload(data) + CLOSE_SCRIPT,
      (scripts || []).map(function (src) { return '<script>' + src.replace(/<\/(script)/gi, '<\\/$1') + CLOSE_SCRIPT; }).join('\n'),
      '<script>window.MxDocsView=' + window.MxDocsView.source + ';' + CLOSE_SCRIPT,
      '<script>' + mountScript() + CLOSE_SCRIPT,
      '</body></html>'
    ].join('\n');
  }

  // The documentation as an agent reads it — the agent channel's GET /api/agent/docs, and the
  // mendix-docs skill's `docs` command, which builds it from a .mpr in Node. It is the Markdown
  // copy the export writes (MxDocsView.markdown), of the own modules, after a short header that
  // says what it is: what an agent understood earlier, to be read as a map and checked against the
  // pack. A description whose flow changed since it was written is marked out of date in it.
  // data: the documentation's data with the descriptions attached (MxDescribe.attach); null when
  // there are none and no Assist item — there is nothing an agent understood yet, and the pack says the rest.
  // assist: the project's Assist items (assist.js), listed at the end in a short "## Assist" section —
  // id, kind, title, status, planned date — so the agent knows what is open and what is closed. This
  // text is given only to the local agent; the exported file and its Markdown copy never list them.
  var AGENT_DOCS_HEAD = '# MxScout documentation';
  function assistSection(items) {
    function cell(t) { return String(t === null || t === undefined ? '' : t).replace(/\s+/g, ' ').replace(/\|/g, '\\|'); }
    var open = items.filter(function (x) { return x.status === 'open' || x.status === 'in-progress' || x.status === 'waiting'; }).length;
    var out = ['', '## Assist', '',
      items.length + (items.length === 1 ? ' item' : ' items') + ' on the Assist page, ' + open + ' open. Send one again with its id and kind to replace it (its history and conversation are kept), or an update ("update": true) with only what changed.', '',
      '| Id | Kind | Title | Status | Planned |', '|---|---|---|---|---|'];
    items.forEach(function (x) { out.push('| ' + [x.id, x.kind, x.title, x.status, x.planned || ''].map(cell).join(' | ') + ' |'); });
    return out.join('\n') + '\n';
  }
  // opts.language: the project's language of written content, as "Polish (pl)", for the header's
  // "Write in:" line — what an agent writes in, so it neither asks again nor switches.
  // opts.assist: the project's Assist items (assist.js), listed at the end in a short "## Assist" section.
  function forAgent(data, opts) {
    opts = opts || {};
    var items = Array.isArray(opts.assist) ? opts.assist : [];
    if (!data || (!data.ai && !items.length)) return null;
    var own = {};
    data.modules.forEach(function (m) { own[m.name] = !m.marketplace; });
    var mine = withDerived(subset(data, own));
    var flows = 0, described = 0, stale = 0;
    Object.keys(mine.flows).forEach(function (k) {
      var f = mine.flows[k];
      if (f.kind === 'page') return;
      flows++;
      if (f.desc) { described++; if (f.descStale) stale++; }
    });
    var market = data.modules.length - mine.modules.length;
    var ai = data.ai || {}, now = new Date().toISOString();
    function one(t) { return String(t).replace(/\s*\n\s*/g, ' '); }
    var V = window.MxDocsData, ver = data.version || null, at = ai.describedAt || null;
    var head = [
      AGENT_DOCS_HEAD + ' — ' + one(data.project),
      '',
      'project: ' + one(data.project),
      'mendix: ' + one(data.mendix || 'unknown'),
      // Which version of the app the model is, and which one the descriptions were written for (docs.js stamps it).
      'model: ' + one((V && V.versionText(ver)) || 'version unknown (no git commit was read with this model)'),
      ver ? 'model commit: ' + ver.commit : null,
      'generated: ' + now,
      'modules: the own modules (' + mine.modules.length + ')' + (market ? '; ' + market + ' Marketplace ' + (market === 1 ? 'module' : 'modules') + ' left out' : ''),
      'flows described: ' + described + ' of ' + flows,
      'out of date: ' + stale + (stale ? ' — each marked "(out of date …)" after its description: the flow changed since it was written' : ''),
      ai.written || ai.by ? 'descriptions: ' + ['written ' + one(ai.written || 'at an unknown date'), ai.by ? 'by ' + one(ai.by) : null].filter(Boolean).join(' ') : null,
      at ? 'described at: ' + one((V && V.versionText(at)) || at.short) + (ver && ver.commit === at.commit ? ' — the same version as the model' : '') : null,
      at ? 'described commit: ' + at.commit : null,
      at && ver && ver.commit !== at.commit ? 'since then: ' + (opts.since ? opts.since.length + (opts.since.length === 1 ? ' commit' : ' commits') + ' in the Mendix project’s local git' +
        (opts.since.length ? ' — ' + opts.since.slice(0, 20).map(function (c) { return c.short + ' ' + one(c.msg || ''); }).join('; ') : '') : 'not known from here — in the Mendix project, git log --oneline ' + at.short + '..' + ver.short + ' lists the commits') : null,
      opts.language !== undefined ? 'Write in: ' + (opts.language ? one(opts.language) : 'not set yet — ask the person once (English by default); the answer is kept for the project') : null,
      '',
      '> This is what an agent understood earlier; verify against the AI pack before concluding.',
      '',
      '---',
      '',
      ''
    ].filter(function (l) { return l !== null; });
    return { text: head.join('\n') + window.MxDocsView.markdown(mine) + (items.length ? assistSection(items) : ''), generatedAt: now, flows: flows, described: described, stale: stale, assist: items.length };
  }

  function fileName(data) {
    return String(data.project).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') + '-documentation-' + String(data.generatedAt).slice(0, 10) + '.html';
  }

  window.MxDocsFile = { SHEETS: SHEETS, SCRIPTS: SCRIPTS, fontsIn: fontsIn, fontPath: fontPath, withDerived: withDerived, subset: subset, build: build, fileName: fileName, forAgent: forAgent, AGENT_DOCS_HEAD: AGENT_DOCS_HEAD };
})();
