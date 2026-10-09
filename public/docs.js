/* MxScout — documentation, the section of a project.
 *
 * The documentation is read in ONE place: the exported file. This section is
 * where it is made — what the file holds, a look at it, and one button that
 * builds it. A second reader in the app would be a second thing to keep true;
 * the previews here are the real reader, drawn small, from the same data.
 *
 * The exported file carries three things and nothing else: the documentation
 * data (encrypted with WebCrypto under a fresh access code, the same envelope
 * the review report uses), the reader's own source (docs-view.js, the very
 * function the previews run), and its stylesheet. It is built in this page and
 * handed to the browser's download; the server never sees it and nothing is
 * sent anywhere. It is rebuilt from the model every time a model is loaded or
 * replaced — there is nothing to keep in step by hand.
 */
(function () {
  'use strict';

  var app = null; // { el, state, render, store, setMessage, findProject, downloadText }
  var kept = null; // { model, desc, host, data } — the section, kept across redraws
  // projectId -> the imported descriptions record ({ projectId, importedAt,
  // fileName, value }), null when there is none, absent while loading.
  var descs = {};
  var dialog = null; // { busy, code, fileName, error }

  function init(api) { app = api; }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  // The flow a preview shows: an own module's microflow with a real shape —
  // enough steps to read as a workflow, few enough to fit, data on a step.
  function sampleFlow(data) {
    var own = {};
    data.modules.forEach(function (m) { if (!m.marketplace) own[m.name] = true; });
    var best = null, bestScore = -1;
    Object.keys(data.flows).forEach(function (k) {
      var f = data.flows[k];
      if (f.kind !== 'microflow' || !own[f.module] || !f.workflow || f.steps < 6 || f.steps > 22) return;
      var fields = JSON.stringify(f.workflow).indexOf('"fields":[') !== -1 ? 1 : 0;
      var score = fields * 100 + f.calledBy.length * 3 + f.steps + (f.exits && f.exits.length > 1 ? 5 : 0);
      if (score > bestScore) { best = k; bestScore = score; }
    });
    return best;
  }
  // The entity a preview shows: an own entity with the most to draw around it.
  function sampleEntity(data) {
    var degree = {};
    data.associations.forEach(function (a) { degree[a.from] = (degree[a.from] || 0) + 1; degree[a.to] = (degree[a.to] || 0) + 1; });
    var own = {};
    data.modules.forEach(function (m) { if (!m.marketplace) own[m.name] = true; });
    var best = null;
    Object.keys(data.entities).forEach(function (q) {
      var d = degree[q] || 0;
      if (!own[data.entities[q].module] || d > 14) return;
      if (!best || d > (degree[best] || 0)) best = q;
    });
    return best || Object.keys(data.entities)[0] || null;
  }

  function shot(data, state, caption, note) {
    var el = app.el;
    var frame = el('div', { class: 'docs-shot-frame' });
    var host = el('div', { class: 'docs-shot-host' });
    frame.appendChild(host);
    window.MxDocsView.mount(data, host, { theme: document.documentElement.getAttribute('data-mode') || 'dark', preview: true, state: state });
    // The reader is laid out at a desktop size and drawn small: scaled to
    // whatever width the frame gets, so it reads as a screenshot of the file.
    function fit() { if (frame.clientWidth) host.style.transform = 'scale(' + (frame.clientWidth / 1280) + ')'; }
    if (window.ResizeObserver) new ResizeObserver(fit).observe(frame);
    if (window.requestAnimationFrame) window.requestAnimationFrame(fit);
    return el('figure', { class: 'docs-shot' }, [frame, el('figcaption', {}, [el('strong', { text: caption }), el('span', { text: note })])]);
  }

  function loadDescriptions(projectId) {
    if (Object.prototype.hasOwnProperty.call(descs, projectId)) return;
    descs[projectId] = undefined;
    app.store.get('descriptions', projectId).then(function (row) {
      descs[projectId] = row || null; kept = null; app.render();
    }, function () { descs[projectId] = null; });
  }

  // The documentation's data, with the AI's descriptions on it when there are
  // any. Used for the previews AND the export, so the file says what the
  // section showed.
  function buildData(model, project) {
    var data = window.MxDocsData.build(model, project);
    var rec = project ? descs[project.id] : null;
    var status = window.MxDescribe.attach(data, rec ? rec.value : null);
    return { data: data, status: status, rec: rec || null };
  }

  function render(model, project) {
    if (project) loadDescriptions(project.id);
    var rec = project ? descs[project.id] : null;
    var mode = document.documentElement.getAttribute('data-mode') || 'dark';
    if (kept && kept.model === model && kept.desc === rec && kept.mode === mode) return kept.host;
    var el = app.el;
    var built = buildData(model, project);
    var data = built.data;
    var k = data.kpi;
    var flowKey = sampleFlow(data);
    var entity = sampleEntity(data);

    var inside = [
      ['Overview', 'The application at a glance: modules, how many microflows, nanoflows, pages and entities, roles, scheduled events and published services.'],
      ['Microflows & pages', plural(k.microflows, 'microflow', 'microflows') + ', ' + plural(k.nanoflows, 'nanoflow', 'nanoflows') + ' and ' + plural(k.pages, 'page', 'pages') + '. Each flow as a workflow from top to bottom: what it takes, where it can end, every step — and, on a click, the data a step creates or changes and the arguments a call passes.'],
      ['Domain model', plural(k.entities, 'entity', 'entities') + ', each as a map: the entity in the middle, the entities pointing to it on one side and the ones it points to on the other. A click moves another one to the middle.'],
      ['Model quality', 'Elements nothing reaches, and disabled steps.']
    ];

    var shots = el('div', { class: 'docs-shots' }, [
      shot(data, { view: 'start' }, 'Overview', 'Where the reader starts.'),
      flowKey ? shot(data, { view: 'refs', key: flowKey, module: data.flows[flowKey].module, seg: 'microflow' }, data.flows[flowKey].name, 'A microflow: entry, exit, and its workflow.') : null,
      entity ? shot(data, { view: 'domain', entity: entity }, data.entities[entity].name, 'An entity and the entities around it.') : null
    ]);

    var host = el('div', { class: 'docs-landing' }, [
      el('div', { class: 'card docs-intro' }, [
        el('div', { class: 'docs-intro-text' }, [
          el('h2', { text: 'Documentation' }),
          el('p', { class: 'docs-lead', text: 'One HTML file that documents ' + data.project + ' straight from its Mendix model — for the developers who maintain it, the testers who check it and the people who own it. It opens in any browser, on any machine, without MxScout.' }),
          el('p', { class: 'muted', text: 'It is encrypted: the file asks for an access code, and you get the code when you build it. Built in this browser from the model loaded here, and sent nowhere.' })
        ]),
        el('div', { class: 'docs-intro-act' }, [
          el('button', { class: 'btn btn-primary', text: 'Export documentation…', onclick: function () { openExport(); } }),
          el('span', { class: 'hint', text: plural(k.modules, 'module', 'modules') + ' · ' + plural(k.microflows + k.nanoflows, 'flow', 'flows') + ' · ' + plural(k.entities, 'entity', 'entities') })
        ])
      ]),
      el('h3', { class: 'docs-h', text: 'What is in it' }),
      el('div', { class: 'docs-inside' }, inside.map(function (x) {
        return el('div', { class: 'card docs-inside-item' }, [el('strong', { text: x[0] }), el('p', { class: 'muted', text: x[1] })]);
      })),
      aiCard(data, built, project),
      el('h3', { class: 'docs-h', text: 'What it looks like' }),
      el('p', { class: 'muted docs-shots-note', text: 'These are the file’s own pages, drawn small from this project. In the file they are dark or light — the reader picks, or it follows the system.' }),
      shots
    ]);
    kept = { model: model, desc: rec, host: host, data: data, mode: mode };
    return host;
  }

  // ---------- descriptions for the business, written by an AI agent ----------
  function aiCard(data, built, project) {
    var el = app.el;
    var rec = built.rec, st = built.status;
    var own = 0;
    data.modules.forEach(function (m) { if (!m.marketplace) own += m.microflows.length + m.nanoflows.length; });
    var status = rec
      ? el('p', { class: 'docs-ai-status' }, [
          el('strong', { text: st.described + ' of ' + own + ' flows described' }),
          document.createTextNode(st.stale ? ' · ' + st.stale + ' out of date (the flow changed after it was described)' : ''),
          document.createTextNode(rec.value.app ? ' · with an overview of the application' + (rec.value.app.processes.length ? ' and ' + rec.value.app.processes.length + ' main processes' : '') : ''),
          el('span', { class: 'hint', text: 'Imported ' + String(rec.importedAt || '').slice(0, 10) + (rec.fileName ? ' from ' + rec.fileName : '') + (rec.value.by ? ' · written by ' + rec.value.by : '') })
        ])
      : el('p', { class: 'muted', text: 'None yet. The documentation is complete without them; they add the sentences a business reader looks for.' });
    return el('div', { class: 'card docs-ai' }, [
      el('div', { class: 'docs-ai-text' }, [
        el('h3', { text: 'Descriptions for the business — written by AI' }),
        el('p', { class: 'muted', text: 'MxScout reads the model; it does not write prose about it. An AI agent on your own machine can: what the application is for, its main processes, a sentence on each microflow. Export the AI pack, give it to the agent with the mendix-describe skill, import the file it writes. In the documentation every such sentence is marked as written by AI.' }),
        status
      ]),
      el('div', { class: 'docs-ai-act' }, [
        el('button', { class: 'btn', text: 'Export AI pack', title: 'A text file: the model as the documentation reads it, one section per module', onclick: function () { exportPack(); } }),
        el('button', { class: 'btn', text: 'Import descriptions…', onclick: function () { importDescriptions(project); } }),
        rec ? el('button', { class: 'btn btn-ghost btn-sm', text: 'Remove descriptions', onclick: function () { removeDescriptions(project); } }) : null,
        el('span', { class: 'hint', text: 'The pack is not encrypted — it is meant for an agent on this machine. Keep it where you keep the project.' })
      ])
    ]);
  }

  function exportPack() {
    var data = current();
    if (!data) return;
    var p = window.MxDescribe.pack(data);
    var name = String(data.project).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') + '.mxscout-ai-pack.md';
    app.downloadText(p.text, name, 'text/markdown');
    app.setMessage('AI pack downloaded: ' + name + ' — ' + p.modules + ' modules, ' + p.flows + ' flows. Hand it to an agent with the mendix-describe skill.', 'ok');
    app.render();
  }

  function importDescriptions(project) {
    if (!project) return;
    var input = app.el('input', { type: 'file', accept: '.json,application/json' });
    input.style.display = 'none';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      document.body.removeChild(input);
      if (!file) return;
      file.text().then(function (text) {
        var parsed = window.MxDescribe.parse(text);
        if (parsed.error) { app.setMessage(parsed.error, 'error'); app.render(); return; }
        var row = { projectId: project.id, importedAt: new Date().toISOString(), fileName: file.name, value: parsed.value };
        return app.store.put('descriptions', row).then(function () {
          descs[project.id] = row; kept = null;
          app.setMessage('Descriptions imported from ' + file.name + '.', 'ok');
          app.render();
        });
      }).catch(function (err) { app.setMessage('Could not import the descriptions: ' + ((err && err.message) || err), 'error'); app.render(); });
    });
    document.body.appendChild(input);
    input.click();
  }

  function removeDescriptions(project) {
    if (!project) return;
    app.store.delete('descriptions', project.id).then(function () {
      descs[project.id] = null; kept = null;
      app.setMessage('Descriptions removed. The file you imported them from is untouched.', 'ok');
      app.render();
    });
  }

  function current() { return kept ? kept.data : null; }

  // ---------- the encrypted file ----------
  var CLOSE_SCRIPT = '</' + 'script>';
  function gateScript() {
    // The same decryption the review report carries (report.js), then the reader.
    return [
      '(function(){',
      '  var E = JSON.parse(document.getElementById("mxscout-payload").textContent);',
      '  var $ = function(id){ return document.getElementById(id); };',
      '  var mark = window.MxDocsView.logo(30); $("gate-mark").appendChild(mark);',
      '  function b64(s){ var b=atob(s), a=new Uint8Array(b.length); for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i); return a; }',
      '  var AL="0123456789ABCDEFGHJKMNPQRSTVWXYZ";',
      '  function norm(raw){ var u=String(raw||"").toUpperCase(), o=""; for(var i=0;i<u.length;i++){ var c=u.charAt(i);',
      '    if(c==="O")c="0"; else if(c==="I"||c==="L")c="1"; else if(c==="U")c="V";',
      '    if(AL.indexOf(c)!==-1)o+=c; } if(o.indexOf("MXS")===0)o=o.slice(3); return o; }',
      '  function open(code){',
      '    var enc=new TextEncoder();',
      '    return crypto.subtle.importKey("raw",enc.encode(norm(code)),"PBKDF2",false,["deriveKey"])',
      '      .then(function(base){ return crypto.subtle.deriveKey({name:"PBKDF2",salt:b64(E.kdf.salt),iterations:E.kdf.iterations,hash:"SHA-256"},base,{name:"AES-GCM",length:256},false,["decrypt"]); })',
      '      .then(function(key){ return crypto.subtle.decrypt({name:"AES-GCM",iv:b64(E.cipher.iv)},key,b64(E.payload)); })',
      '      .then(function(buf){',
      '        if(E.compression!=="gzip") return new Uint8Array(buf);',
      '        return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer().then(function(b){return new Uint8Array(b);});',
      '      })',
      '      .then(function(bytes){ return JSON.parse(new TextDecoder().decode(bytes)); });',
      '  }',
      '  $("unlock").addEventListener("click",function(){',
      '    $("err").textContent="";',
      '    if(!crypto.subtle){ $("err").textContent="This page must be opened from a file or an https address for the browser to allow decryption."; return; }',
      '    $("unlock").disabled=true; $("unlock").textContent="Opening\\u2026";',
      '    open($("code").value).then(function(d){',
      '      $("gate").style.display="none";',
      '      var root=$("doc"); root.style.display="block";',
      '      window.MxDocsView.mount(d, root, { hash:true, encrypted:true, theme:"auto" });',
      '    },function(){',
      '      $("err").textContent="That access code does not open this documentation.";',
      '      $("unlock").disabled=false; $("unlock").textContent="Open documentation";',
      '    });',
      '  });',
      '  $("code").addEventListener("keydown",function(e){ if(e.key==="Enter") $("unlock").click(); });',
      '})();'
    ].join('\n');
  }
  // MxScout's look before anything is decrypted: dark, as MxScout is by default, light
  // when the system asks for it — the same two themes the reader has.
  function gateStyle() {
    return [
      'html,body{margin:0;height:100%;background:#f6f5f2;color:#1c1a16;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
      '.gate{max-width:440px;margin:14vh auto;background:#fff;border:1px solid #e6e2da;border-radius:12px;padding:26px}',
      '.gate-brand{display:flex;align-items:center;gap:10px;margin-bottom:18px}.gate-brand b{font-size:15px}.gate-brand small{display:block;color:#716b61;font-size:11px}',
      '.gate .dx-mark line{stroke:#b8730f}.gate .dx-mark circle{fill:#b8730f}',
      '.gate h1{font-size:18px;margin:0 0 8px}.gate p{color:#716b61;margin:0 0 18px}',
      '.gate input{width:100%;font:inherit;font-family:ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em;text-transform:uppercase;padding:10px 12px;border:1px solid #d6d1c6;border-radius:8px;box-sizing:border-box;background:#f3f1ec;color:inherit}',
      '.gate input:focus{outline:none;border-color:#b8730f}',
      '.gate button{margin-top:14px;width:100%;font:inherit;font-weight:600;padding:10px;border:none;border-radius:8px;background:#b8730f;color:#fff;cursor:pointer}',
      '.gate button:disabled{opacity:.6;cursor:default}.err{color:#c9412f;margin-top:12px;min-height:20px}',
      '@media (prefers-color-scheme: dark){html,body{background:#121212;color:#ededed}.gate{background:#1a1a1a;border-color:#2e2e2e}.gate p,.gate-brand small{color:#9b9b9b}',
      '.gate input{background:#121212;border-color:#3a3a3a}.gate input:focus{border-color:#e8a33d}.gate button{background:#e8a33d;color:#1a1206}',
      '.gate .dx-mark line{stroke:#e8a33d}.gate .dx-mark circle{fill:#e8a33d}.err{color:#ff6b6b}}',
      '#doc{height:100vh}'
    ].join('\n');
  }

  function buildFile(envelope, css, title) {
    return [
      '<!doctype html>',
      '<html lang="en"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<meta name="generator" content="MxScout">',
      '<title>' + String(title).replace(/[<>&"]/g, '') + ' — documentation</title>',
      '<style>' + gateStyle() + '\n' + css.replace(/<\/style/gi, '') + '</style>',
      '</head><body>',
      '<div class="gate" id="gate">',
      '<div class="gate-brand"><span id="gate-mark"></span><div><b>MxScout</b><small>Documentation</small></div></div>',
      '<h1>This documentation is encrypted</h1>',
      '<p>It opens with the access code from whoever sent it. The code travels separately from this file — check your other messages if you do not have it.</p>',
      '<input id="code" type="text" placeholder="MXS-XXXXX-XXXXX-XXXXX-XXXXX" autocomplete="off" spellcheck="false">',
      '<button id="unlock">Open documentation</button>',
      '<div class="err" id="err"></div>',
      '</div>',
      '<div id="doc" style="display:none"></div>',
      // Base64 in a JSON block the browser never runs and never parses as markup.
      '<script type="application/json" id="mxscout-payload">' + JSON.stringify(envelope) + CLOSE_SCRIPT,
      '<script>window.MxDocsView=' + window.MxDocsView.source + ';' + CLOSE_SCRIPT,
      '<script>' + gateScript() + CLOSE_SCRIPT,
      '</body></html>'
    ].join('\n');
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

  function doExport() {
    var all = current();
    if (!all) return;
    var keep = dialog.keep || {};
    if (!all.modules.some(function (m) { return keep[m.name]; })) return;
    var data = subset(all, keep);
    var code = window.MxCrypto.generateCode();
    dialog.busy = true; dialog.error = null; app.render();
    // The stylesheet is this app's own file, read from this same server.
    fetch('/docs.css').then(function (r) { if (!r.ok) throw new Error('Could not read the stylesheet.'); return r.text(); })
      .then(function (css) {
        return window.MxCrypto.pack(data, code).then(function (envelope) {
          var html = buildFile(envelope, css, data.project);
          var fileName = String(data.project).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') + '-documentation-' + String(data.generatedAt).slice(0, 10) + '.html';
          app.downloadText(html, fileName, 'text/html');
          dialog.busy = false; dialog.code = code; dialog.fileName = fileName; app.render();
        });
      })
      .catch(function (err) { dialog.busy = false; dialog.error = (err && err.message) || 'Could not build the file.'; app.render(); });
  }

  // Which modules go into the file, chosen first: every module of the
  // project is offered, the Marketplace ones unticked — they are somebody
  // else's code, and in a real project they are half the model (Karol,
  // 2026-10-09).
  function openExport() {
    var keep = {};
    (current() || { modules: [] }).modules.forEach(function (m) { keep[m.name] = !m.marketplace; });
    dialog = { busy: false, code: null, fileName: null, error: null, note: null, keep: keep };
    app.render();
  }

  function moduleChooser(data) {
    var el = app.el;
    var keep = dialog.keep;
    function set(fn) { return function () { data.modules.forEach(function (m) { keep[m.name] = fn(m); }); dialog.code = null; app.render(); }; }
    var chosen = data.modules.filter(function (m) { return keep[m.name]; }).length;
    return el('div', { class: 'docs-mods-wrap' }, [
      el('div', { class: 'docs-mods-head' }, [
        el('strong', { text: 'Modules in the file' }),
        el('span', { class: 'muted', text: chosen + ' of ' + data.modules.length }),
        el('span', { class: 'docs-mods-quick' }, [
          el('button', { class: 'btn btn-sm btn-ghost', text: 'All', onclick: set(function () { return true; }) }),
          el('button', { class: 'btn btn-sm btn-ghost', text: 'Own modules', onclick: set(function (m) { return !m.marketplace; }) }),
          el('button', { class: 'btn btn-sm btn-ghost', text: 'None', onclick: set(function () { return false; }) })
        ])
      ]),
      el('div', { class: 'docs-mods' }, data.modules.map(function (m) {
        var box = el('input', { type: 'checkbox' });
        box.checked = !!keep[m.name];
        box.addEventListener('change', function () { keep[m.name] = box.checked; dialog.code = null; app.render(); });
        var n = m.microflows.length + m.nanoflows.length;
        return el('label', { class: 'docs-mod' + (keep[m.name] ? ' on' : '') + (m.marketplace ? ' mk' : '') }, [
          box,
          el('span', { class: 'docs-mod-t' }, [
            el('strong', { text: m.name }),
            el('span', { class: 'muted', text: (m.marketplace ? 'Marketplace · ' : '') + plural(n, 'flow', 'flows') + ' · ' + plural(m.entities.length, 'entity', 'entities') })
          ])
        ]);
      }))
    ]);
  }

  function renderExportModal() {
    if (!dialog) return null;
    var el = app.el;
    var close = function () { if (dialog.busy) return; dialog = null; app.render(); };
    var all = current() || { kpi: {}, modules: [] };
    var data = all.modules.length ? subset(all, dialog.keep || {}) : all;
    var none = all.modules.length && !data.modules.length;
    var kids = [
      el('h3', { text: 'Export the documentation' }),
      el('p', { class: 'muted', text: 'One HTML file with everything described on this page, for the modules you choose — now ' + (data.kpi.microflows || 0) + ' microflows, ' + (data.kpi.nanoflows || 0) + ' nanoflows, ' + (data.kpi.pages || 0) + ' pages, ' + (data.kpi.entities || 0) + ' entities, every workflow — encrypted. It opens in any browser and asks for an access code; nothing is sent anywhere.' }),
      all.modules.length ? moduleChooser(all) : null,
      el('div', { class: 'report-option' }, [
        el('div', { class: 'report-option-head' }, [
          el('strong', { text: 'Encrypted HTML file' }),
          el('button', { class: 'btn btn-sm btn-primary', text: dialog.busy ? 'Working…' : 'Build file', disabled: dialog.busy || none ? 'disabled' : null,
            title: none ? 'Choose at least one module' : null, onclick: doExport })
        ]),
        el('p', { class: 'muted', text: 'The documentation describes the application’s structure and its weak spots, so it is never written unencrypted. Send the code by a different channel than the file.' })
      ])
    ];
    if (dialog.code) {
      kids.push(el('div', { class: 'code-display' }, [
        el('code', { class: 'code-value', text: dialog.code }),
        el('button', { class: 'btn btn-sm', text: 'Copy code', onclick: function () {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(dialog.code);
          dialog.note = 'Code copied. Send it by a different channel than the file.'; app.render();
        } })
      ]));
      kids.push(el('p', { class: 'warn-text', text: dialog.fileName + ' downloaded. MxScout does not keep this code — a new export means a new code.' }));
    }
    if (dialog.note) kids.push(el('p', { class: 'ok-text', text: dialog.note }));
    if (dialog.error) kids.push(el('p', { class: 'warn-text', text: dialog.error }));
    kids.push(el('div', { class: 'modal-actions' }, [el('button', { class: 'btn', text: 'Close', onclick: close })]));
    var backdrop = el('div', { class: 'modal-backdrop', onclick: function (e) { if (e.target === backdrop) close(); } }, [el('div', { class: 'modal modal-wide' }, kids)]);
    return backdrop;
  }

  window.MxDocs = { init: init, render: render, current: current, renderExportModal: renderExportModal, buildFile: buildFile };
})();
