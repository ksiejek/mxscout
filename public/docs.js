/* MxScout — documentation, the section of a project.
 *
 * The project's Documentation section: what docs-data.js reads out of the
 * model, drawn by docs-view.js, and one button that hands it to someone else
 * as a single encrypted HTML file. It is rebuilt from the model every time a
 * model is loaded or replaced — there is nothing to keep in step by hand.
 *
 * The exported file carries three things and nothing else: the documentation
 * data (encrypted with WebCrypto under a fresh access code, the same envelope
 * the review report uses), the reader's own source (the very function the app
 * runs, so the file shows what the app showed), and its stylesheet. It is
 * built in this page and handed to the browser's download; the server never
 * sees it and nothing is sent anywhere.
 */
(function () {
  'use strict';

  var app = null; // { el, state, render, peekObject, findProject, downloadText }
  var kept = null; // { model, project, host, data, view, sig } — the mounted documentation, kept across redraws
  var dialog = null; // { busy, code, fileName, error, modules }

  function init(api) { app = api; }

  var SECTION = { microflow: 'microflows', nanoflow: 'nanoflows', page: 'pages' };

  // The findings that matter to the view, as a cheap string: rebuild the
  // documentation when one is added, resolved or re-rated, not on every redraw.
  function findingsSig(list) {
    return (list || []).map(function (f) { return f.id + ':' + f.severity + ':' + f.status; }).join('|');
  }

  function render(model, project) {
    var findings = app.state.findings || [];
    var sig = findingsSig(findings);
    if (kept && kept.model === model && kept.sig === sig) return kept.host;
    var data = window.MxDocsData.build(model, project, { comments: findings });
    var host = app.el('div', { class: 'dx-host' });
    var exportBtn = app.el('button', { class: 'dx-btn primary', type: 'button', text: '🔒 Export', title: 'One encrypted HTML file with this documentation — it opens in any browser with an access code', onclick: function () { openExport(); } });
    var view = window.MxDocsView.mount(data, host, {
      theme: 'dark',
      state: kept && kept.view ? kept.view.state() : null,
      actions: [exportBtn],
      openInModel: function (kind, qn) {
        var section = SECTION[kind];
        if (section) app.peekObject(section, { name: qn.split('.').pop(), qualifiedName: qn });
      }
    });
    kept = { model: model, project: project, host: host, data: data, view: view, sig: sig };
    return host;
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
  function gateStyle() {
    return [
      'html,body{margin:0;height:100%;background:#f5f6f8;color:#19202e;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}',
      '@media (prefers-color-scheme: dark){html,body{background:#121212;color:#ededea}.gate{background:#1a1a1a!important;border-color:#2b2b2b!important}.gate p{color:#8f8f8a!important}.gate input{background:#121212;color:#ededea;border-color:#3a3a3a!important}}',
      '.gate{max-width:470px;margin:14vh auto;background:#fff;border:1px solid #eceef2;border-radius:16px;padding:26px}',
      '.gate h1{font-size:18px;margin:0 0 8px}.gate p{color:#626a78;margin:0 0 18px}',
      '.gate input{width:100%;font:inherit;font-family:ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em;text-transform:uppercase;padding:11px 13px;border:1px solid #dce1e8;border-radius:10px;box-sizing:border-box}',
      '.gate button{margin-top:14px;width:100%;font:inherit;font-weight:650;padding:11px;border:none;border-radius:10px;background:#2f8fd1;color:#fff;cursor:pointer}',
      '.gate button:disabled{opacity:.6;cursor:default}.err{color:#e04a3f;margin-top:12px;min-height:20px}',
      '#doc{height:100vh}#doc .dx{border:0;border-radius:0}'
    ].join('\n');
  }

  function buildFile(envelope, css, title) {
    return [
      '<!doctype html>',
      '<html lang="en"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>' + String(title).replace(/[<>&"]/g, '') + ' — documentation</title>',
      '<style>' + gateStyle() + '\n' + css.replace(/<\/style/gi, '') + '</style>',
      '</head><body>',
      '<div class="gate" id="gate">',
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

  function doExport() {
    if (!kept || !kept.model) return;
    var chosen = Object.keys(dialog.modules).filter(function (n) { return dialog.modules[n]; });
    if (!chosen.length) { dialog.error = 'Choose at least one module to export.'; app.render(); return; }
    // Rebuilt for the export: only the chosen modules, and the findings as they
    // stand right now — the in-app view keeps showing everything.
    var data = window.MxDocsData.build(kept.model, kept.project, { modules: chosen, comments: app.state.findings || [] });
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

  function openExport() {
    // Default to the own modules: the Marketplace ones are rarely what a
    // reader of this documentation is after, but they are there to tick.
    var data = current();
    var modules = {};
    ((data && data.modules) || []).forEach(function (m) { if (!m.marketplace) modules[m.name] = true; });
    dialog = { busy: false, code: null, fileName: null, error: null, note: null, modules: modules };
    app.render();
  }

  function renderExportModal() {
    if (!dialog) return null;
    var el = app.el;
    var close = function () { if (dialog.busy) return; dialog = null; app.render(); };
    var data = current() || { kpi: {}, modules: [], comments: [] };
    var allMods = data.modules || [];
    var own = allMods.filter(function (m) { return !m.marketplace; });
    var market = allMods.filter(function (m) { return m.marketplace; });
    var chosen = Object.keys(dialog.modules).filter(function (n) { return dialog.modules[n]; });
    var findings = (data.comments || []).length;

    function setMods(fn) { allMods.forEach(function (m) { dialog.modules[m.name] = fn(m); }); app.render(); }
    function moduleBox(m) {
      var n = m.microflows.length + m.nanoflows.length + m.pages.length + m.entities.length;
      return el('label', { class: 'docs-mod' + (dialog.modules[m.name] ? ' on' : '') }, [
        el('input', { type: 'checkbox', checked: dialog.modules[m.name] ? 'checked' : null, disabled: dialog.busy ? 'disabled' : null,
          onchange: function (e) { dialog.modules[m.name] = e.target.checked; app.render(); } }),
        el('span', { class: 'docs-mod-badge' + (m.marketplace ? ' mk' : ''), text: m.marketplace ? 'MP' : 'MOD' }),
        el('span', { class: 'docs-mod-t' }, [el('b', { text: m.name }), el('small', { text: n + ' document' + (n === 1 ? '' : 's') })])
      ]);
    }
    function group(title, mods) {
      if (!mods.length) return null;
      return el('div', { class: 'docs-mod-group' }, [el('div', { class: 'docs-mod-group-h', text: title })].concat(mods.map(moduleBox)));
    }

    var kids = [
      el('h3', { text: 'Export the documentation' }),
      el('p', { class: 'muted', text: 'One encrypted HTML file, for the modules you choose below. It opens in any browser and asks for an access code; nothing is sent anywhere.' }),
      el('div', { class: 'docs-export-mods' }, [
        el('div', { class: 'docs-mod-head' }, [
          el('strong', { text: 'Modules to export' }),
          el('span', { class: 'docs-mod-count', text: chosen.length + ' of ' + allMods.length + ' selected' }),
          el('span', { class: 'docs-mod-acts' }, [
            el('button', { class: 'btn btn-xs', text: 'Own only', onclick: function () { setMods(function (m) { return !m.marketplace; }); } }),
            el('button', { class: 'btn btn-xs', text: 'All', onclick: function () { setMods(function () { return true; }); } }),
            el('button', { class: 'btn btn-xs', text: 'None', onclick: function () { setMods(function () { return false; }); } })
          ])
        ]),
        group('Own modules', own),
        group('Marketplace', market)
      ]),
      el('div', { class: 'report-option' }, [
        el('div', { class: 'report-option-head' }, [
          el('strong', { text: 'Encrypted HTML file' }),
          el('button', { class: 'btn btn-sm btn-primary', text: dialog.busy ? 'Working…' : 'Build file', disabled: (dialog.busy || !chosen.length) ? 'disabled' : null, onclick: doExport })
        ]),
        el('p', { class: 'muted', text: 'Carries the chosen modules and, always, the findings recorded against them — with their severity and whether they are fixed. The documentation describes the application’s structure and its weak spots, so it is never written unencrypted. Send the code by a different channel than the file.' + (findings ? '' : ' (No findings are recorded yet.)') })
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
