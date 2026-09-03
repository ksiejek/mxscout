/* MxScout — reports: the two ways a review leaves MxScout for someone who is
 * not going to open MxScout.
 *
 *   Copy for Word  — a block per finding (heading, attributes, problem,
 *                    Recommendation) on the clipboard, pasted straight into
 *                    someone else's document. Authors stripped.
 *   Encrypted HTML — one self-contained .html file that asks for an access
 *                    code and shows the report. For a reader who has a
 *                    browser and nothing else.
 *
 * Both are built from whatever the comments list is currently showing, so the
 * filters are the report definition — there is no second place to choose what
 * goes in, and therefore no way for the two to disagree.
 */
(function () {
  'use strict';

  var SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
  var STATUS_LABEL = { open: 'Open', fixed: 'Fixed', wontfix: 'Won’t fix' };
  var KIND_LABEL = { entity: 'Entity', microflow: 'Microflow', nanoflow: 'Nanoflow', page: 'Page' };
  function kindLabel(k) { return KIND_LABEL[k] || (k ? (k.charAt(0).toUpperCase() + k.slice(1)) : 'Object'); }
  // The heading each finding leads with: "Microflow: Sales.CancelOrder".
  function findingHeading(row) { return kindLabel(row.kind) + ': ' + row.object; }

  // ---------- shaping ----------
  // Deliberately NOT the finding records: this drops the author, the history
  // and the internal ids, and keeps only what a reader outside the team needs.
  // The Word output asked for authors to be removed, and the safest way to
  // honour that is for the report data never to carry them at all.
  function buildReportData(project, findings, filterSummary) {
    var groups = [];
    SEVERITY_ORDER.forEach(function (severity) {
      var rows = findings.filter(function (f) { return f.severity === severity; }).map(function (f) {
        return {
          object: f.target.qualifiedName,
          kind: f.target.kind,
          attributes: (f.target.attributes || []).join(', '),
          problem: f.problem,
          change: f.change || '',
          status: STATUS_LABEL[f.status] || f.status
        };
      });
      if (rows.length) groups.push({ severity: severity, rows: rows });
    });

    return {
      project: project.name,
      generatedAt: new Date().toISOString(),
      filterSummary: filterSummary || 'all comments',
      total: findings.length,
      groups: groups
    };
  }

  // ---------- Word ----------
  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Word pastes HTML as real headings and paragraphs, so the markup stays
  // plain: no classes, no stylesheet, inline attributes only. Each finding is
  // a block, not a table row — the shape the reviewer asked for: a heading
  // naming the object, the attribute(s) it is about, what is wrong, and then
  // the recommendation.
  function toWordHtml(data) {
    var out = [];
    out.push('<h1>' + escapeHtml(data.project) + ' — review</h1>');
    out.push('<p><i>' + escapeHtml(new Date(data.generatedAt).toLocaleString()) +
      ' · ' + escapeHtml(data.total + ' comment' + (data.total === 1 ? '' : 's')) +
      ' · ' + escapeHtml(data.filterSummary) + '</i></p>');

    data.groups.forEach(function (group) {
      out.push('<h2>' + escapeHtml(group.severity.charAt(0).toUpperCase() + group.severity.slice(1)) +
        ' (' + group.rows.length + ')</h2>');
      group.rows.forEach(function (row) {
        out.push('<h3>' + escapeHtml(findingHeading(row)) + '</h3>');
        if (row.attributes) out.push('<p>' + escapeHtml('Attributes: ' + row.attributes) + '</p>');
        out.push('<p>' + escapeHtml(row.problem) + '</p>');
        if (row.change) out.push('<p><b>Recommendation:</b> ' + escapeHtml(row.change) + '</p>');
        out.push('<p><i>' + escapeHtml('Status: ' + row.status) + '</i></p>');
      });
    });

    out.push('<p><i>Internal — ' + escapeHtml(data.project) + ' — ' +
      escapeHtml(String(data.generatedAt).slice(0, 10)) + '</i></p>');
    return out.join('\n');
  }

  function toPlainText(data) {
    var lines = [data.project + ' — review', new Date(data.generatedAt).toLocaleString(), ''];
    data.groups.forEach(function (group) {
      lines.push(group.severity.toUpperCase() + ' (' + group.rows.length + ')');
      lines.push('');
      group.rows.forEach(function (row) {
        lines.push(findingHeading(row));
        if (row.attributes) lines.push('Attributes: ' + row.attributes);
        lines.push(row.problem);
        if (row.change) lines.push('Recommendation: ' + row.change);
        lines.push('Status: ' + row.status);
        lines.push('');
      });
    });
    lines.push('Internal — ' + data.project + ' — ' + String(data.generatedAt).slice(0, 10));
    return lines.join('\n');
  }

  // Two flavours on the clipboard: Word takes the HTML, a plain-text field
  // takes the text. The execCommand path is the fallback for browsers without
  // ClipboardItem — it also carries the HTML flavour, because it copies a real
  // selection out of the document.
  function copyForWord(data) {
    var html = toWordHtml(data);
    var text = toPlainText(data);

    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      var item = new window.ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      });
      return navigator.clipboard.write([item]).then(function () { return true; }, function () {
        return legacyCopy(html);
      });
    }
    return Promise.resolve(legacyCopy(html));
  }

  function legacyCopy(html) {
    var holder = document.createElement('div');
    holder.setAttribute('contenteditable', 'true');
    holder.style.position = 'fixed';
    holder.style.left = '-10000px';
    holder.style.top = '0';
    // Our own generated markup, every value escaped in toWordHtml above, in a
    // node that exists for one tick and is never displayed. This is the one
    // place in MxScout that assigns markup, and it is here because a clipboard
    // copy of rich text has no other mechanism in older browsers.
    holder.innerHTML = html;
    document.body.appendChild(holder);
    var range = document.createRange();
    range.selectNodeContents(holder);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    selection.removeAllRanges();
    document.body.removeChild(holder);
    return ok;
  }

  // ---------- the standalone encrypted report ----------
  // The viewer is a copy of what crypto.js does, embedded because the file has
  // to work on a machine that has never heard of MxScout. It builds its DOM
  // with textContent rather than innerHTML: this file goes to people outside
  // the team, and "it only renders text we generated" is a claim worth being
  // able to make without qualification.
  function viewerScript() {
    return [
      "(function(){",
      "  var E = JSON.parse(document.getElementById('mxscout-payload').textContent);",
      "  var $ = function(id){ return document.getElementById(id); };",
      "  function b64(s){ var b=atob(s), a=new Uint8Array(b.length); for(var i=0;i<b.length;i++)a[i]=b.charCodeAt(i); return a; }",
      "  var AL='0123456789ABCDEFGHJKMNPQRSTVWXYZ';",
      "  function norm(raw){ var u=String(raw||'').toUpperCase(), o=''; for(var i=0;i<u.length;i++){ var c=u.charAt(i);",
      "    if(c==='O')c='0'; else if(c==='I'||c==='L')c='1'; else if(c==='U')c='V';",
      "    if(AL.indexOf(c)!==-1)o+=c; } if(o.indexOf('MXS')===0)o=o.slice(3); return o; }",
      "  function open(code){",
      "    var enc=new TextEncoder();",
      "    return crypto.subtle.importKey('raw',enc.encode(norm(code)),'PBKDF2',false,['deriveKey'])",
      "      .then(function(base){ return crypto.subtle.deriveKey({name:'PBKDF2',salt:b64(E.kdf.salt),iterations:E.kdf.iterations,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['decrypt']); })",
      "      .then(function(key){ return crypto.subtle.decrypt({name:'AES-GCM',iv:b64(E.cipher.iv)},key,b64(E.payload)); })",
      "      .then(function(buf){",
      "        if(E.compression!=='gzip') return new Uint8Array(buf);",
      "        return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer().then(function(b){return new Uint8Array(b);});",
      "      })",
      "      .then(function(bytes){ return JSON.parse(new TextDecoder().decode(bytes)); });",
      "  }",
      "  function el(tag,text,cls){ var n=document.createElement(tag); if(text!=null)n.textContent=text; if(cls)n.className=cls; return n; }",
      "  function draw(d){",
      "    var root=$('report'); root.textContent='';",
      "    root.appendChild(el('h1',d.project+' \\u2014 review'));",
      "    root.appendChild(el('p',new Date(d.generatedAt).toLocaleString()+' \\u00b7 '+d.total+' comment'+(d.total===1?'':'s')+' \\u00b7 '+d.filterSummary,'meta'));",
      "    var KL={entity:'Entity',microflow:'Microflow',nanoflow:'Nanoflow',page:'Page'};",
      "    function kl(k){ return KL[k]||(k?k.charAt(0).toUpperCase()+k.slice(1):'Object'); }",
      "    d.groups.forEach(function(g){",
      "      root.appendChild(el('h2',g.severity.charAt(0).toUpperCase()+g.severity.slice(1)+' ('+g.rows.length+')'));",
      "      g.rows.forEach(function(r){",
      "        var card=el('div',null,'finding');",
      "        card.appendChild(el('h3',kl(r.kind)+': '+r.object));",
      "        if(r.attributes) card.appendChild(el('p','Attributes: '+r.attributes,'attrs'));",
      "        card.appendChild(el('p',r.problem,'problem'));",
      "        if(r.change){ var rec=el('p',null,'rec'); rec.appendChild(el('b','Recommendation: ')); rec.appendChild(document.createTextNode(r.change)); card.appendChild(rec); }",
      "        card.appendChild(el('p','Status: '+r.status,'status'));",
      "        root.appendChild(card);",
      "      });",
      "    });",
      "    root.appendChild(el('p','Internal \\u2014 '+d.project+' \\u2014 '+String(d.generatedAt).slice(0,10),'meta'));",
      "    $('gate').style.display='none';",
      "    $('report').style.display='block';",
      "  }",
      "  $('unlock').addEventListener('click',function(){",
      "    $('err').textContent='';",
      "    if(!crypto.subtle){ $('err').textContent='This page must be opened from a file or an https address for the browser to allow decryption.'; return; }",
      "    $('unlock').disabled=true; $('unlock').textContent='Opening\\u2026';",
      "    open($('code').value).then(draw,function(){",
      "      $('err').textContent='That access code does not open this report.';",
      "      $('unlock').disabled=false; $('unlock').textContent='Open report';",
      "    });",
      "  });",
      "  $('code').addEventListener('keydown',function(e){ if(e.key==='Enter') $('unlock').click(); });",
      "})();"
    ].join('\n');
  }

  function viewerStyle() {
    return [
      ':root{color-scheme:light}',
      'body{margin:0;background:#f4f4f5;color:#18181b;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}',
      '.wrap{max-width:940px;margin:0 auto;padding:40px 22px 60px}',
      '.gate{max-width:460px;margin:14vh auto;background:#fff;border:1px solid #e4e4e7;border-radius:14px;padding:26px}',
      '.gate h1{font-size:17px;margin:0 0 8px}',
      '.gate p{color:#52525b;margin:0 0 18px}',
      'input{width:100%;font:inherit;font-family:ui-monospace,Menlo,Consolas,monospace;letter-spacing:.06em;text-transform:uppercase;padding:11px 13px;border:1px solid #d4d4d8;border-radius:9px;box-sizing:border-box}',
      'button{margin-top:14px;width:100%;font:inherit;font-weight:600;padding:11px;border:none;border-radius:9px;background:#18181b;color:#fff;cursor:pointer}',
      'button:disabled{opacity:.6;cursor:default}',
      '.err{color:#b91c1c;margin-top:12px;min-height:20px}',
      'h1{font-size:22px;margin:0 0 6px}',
      'h2{font-size:14px;margin:30px 0 12px;text-transform:uppercase;letter-spacing:.05em;color:#52525b}',
      '.meta{color:#52525b;font-size:12.5px}',
      '.finding{border:1px solid #e4e4e7;border-left:3px solid #d4d4d8;border-radius:10px;padding:14px 16px;margin:0 0 12px;background:#fff}',
      '.finding h3{margin:0 0 8px;font-size:15px}',
      '.finding p{margin:6px 0}',
      '.finding .attrs{color:#52525b;font-size:13px}',
      '.finding .status{color:#71717a;font-size:12.5px;font-style:italic;margin-top:8px}',
      '@media print{.gate{display:none}body{background:#fff}h2{break-after:avoid}.finding{break-inside:avoid}}'
    ].join('\n');
  }

  // Split so this file can contain the closing tag without the HTML parser
  // that loads report.js treating it as the end of ITS script. Written as a
  // concatenation rather than an escape, because an escape here is one
  // backslash away from emitting a broken tag into every report — which is
  // exactly what happened the first time.
  var CLOSE_SCRIPT = '</' + 'script>';

  // The payload rides in a <script type="application/json"> block, which the
  // browser never executes and never parses as markup — so no amount of odd
  // text inside a comment can break out of it. It is base64 anyway.
  function buildStandaloneReport(envelope, projectName) {
    return [
      '<!doctype html>',
      '<html lang="en"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<title>MxScout report</title>',
      '<style>' + viewerStyle() + '</style>',
      '</head><body>',
      '<div class="gate" id="gate">',
      '<h1>This report is encrypted</h1>',
      '<p>It opens with the access code from whoever sent it. The code travels separately from this file — check your other messages if you do not have it.</p>',
      '<input id="code" type="text" placeholder="MXS-XXXXX-XXXXX-XXXXX-XXXXX" autocomplete="off" spellcheck="false">',
      '<button id="unlock">Open report</button>',
      '<div class="err" id="err"></div>',
      '</div>',
      '<div class="wrap" id="report" style="display:none"></div>',
      '<script type="application/json" id="mxscout-payload">' + JSON.stringify(envelope) + CLOSE_SCRIPT,
      '<script>' + viewerScript() + CLOSE_SCRIPT,
      '</body></html>'
    ].join('\n');
  }

  window.MxReport = {
    buildReportData: buildReportData,
    copyForWord: copyForWord,
    toWordHtml: toWordHtml,
    toPlainText: toPlainText,
    buildStandaloneReport: buildStandaloneReport
  };
})();
