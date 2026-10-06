/* MxScout — Log analysis module.
 *
 * Shared export helpers (CSV, Markdown, self-contained HTML) and the Incident Report model builder.
 *
 * Derived from MxDevSwissTool by Mikołaj (RealMecowhy),
 * https://github.com/RealMecowhy/MxDevSwissTool — MIT License, Copyright (c) 2026 Mikołaj.
 * Source: public/js/components/exporters.js (the pure builders; downloads go through MxScout's own download helper)
 * The logic is carried over unchanged, so MxScout reads every log the way the original does;
 * only the packaging differs (no DOM, no network, no build step).
 * The licence text is in THIRD-PARTY-NOTICES.md at the root of this repository.
 */
(function (root) {
  'use strict';

  function esc(v) { return String(v == null ? '' : v); }
  function htmlEscape(s) {
    return esc(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // RFC 4180: quote every field, double embedded quotes. CRLF line endings keep
  // Excel happy. header is an array of column names; rows an array of arrays.
  //
  // opts (all optional, defaults reproduce the original behaviour exactly so
  // every existing caller is unaffected):
  //   delimiter — ',' by default; ';' is what a Polish/German Excel expects,
  //               since those locales read ',' as the decimal separator.
  //   quote     — 'all' (default) or 'minimal', which quotes only fields that
  //               contain the delimiter, a quote or a newline.
  //   eol       — '\r\n' by default.
  // Added in wave 6 for the Excel Converter rather than giving that tool its
  // own CSV writer — one place still owns quoting and escaping.
  function mtExportToCsv(header, rows, opts) {
    opts = opts || {};
    const delimiter = opts.delimiter || ',';
    const eol = opts.eol || '\r\n';
    const minimal = opts.quote === 'minimal';
    const needsQuote = new RegExp('["\\r\\n' + delimiter.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + ']');
    const q = function (v) {
      const s = esc(v);
      if (minimal && !needsQuote.test(s)) return s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const lines = [header.map(q).join(delimiter)];
    for (let i = 0; i < rows.length; i++) lines.push(rows[i].map(q).join(delimiter));
    return lines.join(eol);
  }

  // GitHub-flavoured Markdown table. Pipes and newlines in cells are neutralized
  // so the table can't break out of its row.
  function mtExportToMarkdown(header, rows) {
    const cell = function (v) { return esc(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); };
    const lines = [
      '| ' + header.map(cell).join(' | ') + ' |',
      '|' + header.map(function () { return '---'; }).join('|') + '|'
    ];
    for (let i = 0; i < rows.length; i++) lines.push('| ' + rows[i].map(cell).join(' | ') + ' |');
    return lines.join('\n');
  }

  // Self-contained HTML report: a single file with inline CSS, no external
  // requests — safe to email or archive. opts:
  //   { title, subtitle?, meta?: [{label,value}], columns, rows, note?,
  //     sections?: [{ title, subtitle?, columns, rows, note? }] }
  // A report is either one table (columns/rows) or several (sections) — the
  // Incident Report uses sections; a single tool export uses columns/rows.
  function mtExportToHtml(opts) {
    opts = opts || {};
    const generated = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');

    function tableHtml(cols, rows) {
      const head = '<tr>' + (cols || []).map(function (c) { return '<th>' + htmlEscape(c) + '</th>'; }).join('') + '</tr>';
      const body = (rows || []).map(function (r) {
        return '<tr>' + r.map(function (v) { return '<td>' + htmlEscape(v) + '</td>'; }).join('') + '</tr>';
      }).join('');
      if (!rows || !rows.length) {
        return '<p class="empty">No rows.</p>';
      }
      return '<div class="tw"><table><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
    }

    function sectionHtml(s) {
      return '<section>'
        + '<h2>' + htmlEscape(s.title) + '</h2>'
        + (s.subtitle ? '<p class="sub">' + htmlEscape(s.subtitle) + '</p>' : '')
        + tableHtml(s.columns, s.rows)
        + (s.note ? '<p class="note">' + htmlEscape(s.note) + '</p>' : '')
        + '</section>';
    }

    const metaHtml = (opts.meta && opts.meta.length)
      ? '<div class="meta">' + opts.meta.map(function (m) {
          return '<span class="chip"><b>' + htmlEscape(m.label) + '</b> ' + htmlEscape(m.value) + '</span>';
        }).join('') + '</div>'
      : '';

    // Report-level free-text context (e.g. Incident Report's "Notes" field) —
    // distinct from the per-section note, shown once near the top.
    const noteHtml = opts.note ? '<div class="context">' + htmlEscape(opts.note) + '</div>' : '';

    const bodyInner = (opts.sections && opts.sections.length)
      ? opts.sections.map(sectionHtml).join('')
      : (opts.title || opts.columns
          ? sectionHtml({ title: opts.sectionTitle || 'Data', columns: opts.columns, rows: opts.rows, note: opts.note })
          : '');

    return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width, initial-scale=1">'
      + '<title>' + htmlEscape(opts.title || 'MxScout log report') + '</title>'
      + '<style>'
      + ':root{color-scheme:light dark;--bg:#0f1115;--panel:#171a21;--border:#2a2f3a;--text:#e6e8ec;--muted:#9aa1ad;--accent:#e8862e;--th:#1e222b;}'
      + '@media (prefers-color-scheme: light){:root{--bg:#f6f7f9;--panel:#fff;--border:#e2e5ea;--text:#1c1f26;--muted:#5c6470;--accent:#c86a12;--th:#f0f2f5;}}'
      + '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;padding:32px;}'
      + '.wrap{max-width:1200px;margin:0 auto}h1{font-size:1.5rem;margin:0 0 4px}h2{font-size:1.05rem;margin:28px 0 6px}'
      + '.subtitle{color:var(--muted);margin:0 0 16px}.sub{color:var(--muted);margin:0 0 10px;font-size:0.85rem}'
      + '.meta{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 20px}.chip{background:var(--panel);border:1px solid var(--border);border-radius:999px;padding:4px 12px;font-size:0.8rem;color:var(--muted)}.chip b{color:var(--text);font-weight:600}'
      + '.context{background:var(--panel);border:1px solid var(--border);border-left:3px solid var(--accent);border-radius:6px;padding:10px 14px;margin:0 0 20px;font-size:0.85rem;white-space:pre-wrap;word-break:break-word}'
      + '.tw{overflow-x:auto;border:1px solid var(--border);border-radius:8px;background:var(--panel)}'
      + 'table{border-collapse:collapse;width:100%;font-size:0.82rem}th,td{text-align:left;padding:7px 12px;border-bottom:1px solid var(--border);vertical-align:top;white-space:pre-wrap;word-break:break-word;max-width:520px}'
      + 'th{background:var(--th);position:sticky;top:0;font-weight:600}tbody tr:last-child td{border-bottom:none}tbody tr:hover td{background:color-mix(in srgb,var(--accent) 6%,transparent)}'
      + '.empty{color:var(--muted);padding:16px;margin:0}.note{color:var(--muted);font-size:0.8rem;margin:8px 0 0}'
      + 'footer{margin-top:32px;padding-top:16px;border-top:1px solid var(--border);color:var(--muted);font-size:0.78rem}'
      + 'footer a{color:var(--accent)}'
      + '</style></head><body><div class="wrap">'
      + '<h1>' + htmlEscape(opts.title || 'MxScout log report') + '</h1>'
      + (opts.subtitle ? '<p class="subtitle">' + htmlEscape(opts.subtitle) + '</p>' : '')
      + metaHtml
      + noteHtml
      + bodyInner
      + '<footer>Generated ' + htmlEscape(generated) + ' by MxScout (log analysis from MxDevSwissTool by Mikołaj / RealMecowhy). Fully self-contained — no external resources. '
      + 'Review for sensitive data before sharing; the Log &amp; Text Anonymizer can scrub logs first.</footer>'
      + '</div></body></html>';
  }

  // epoch ms → "YYYY-MM-DD HH:MM:SS UTC" for report metadata (UTC to match the
  // ms basis every tool's tsToMs helper produces).
  function mtFmtTs(ms) {
    if (ms == null || isNaN(ms)) return '';
    const d = new Date(ms);
    const p = function (n) { return String(n).length < 2 ? '0' + n : '' + n; };
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' +
      p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + ' UTC';
  }

  // One-line executive summary built ONLY from numbers already present in the
  // collected sections — no invented metrics (e.g. no heap % when no included
  // source actually carries one). A source that isn't included, or whose data
  // doesn't support a given count, simply contributes no clause (data-driven rule).
  function mtIncidentSummary(sections, windowLabel) {
    const bits = [];
    const byId = {};
    sections.forEach(function (s) { byId[s.id] = s; });

    const logSec = byId['log-viewer'];
    if (logSec && logSec.columns) {
      const lvlIdx = logSec.columns.indexOf('Level');
      if (lvlIdx !== -1) {
        let errs = 0;
        logSec.rows.forEach(function (r) { if (r[lvlIdx] === 'ERROR' || r[lvlIdx] === 'CRITICAL') errs++; });
        bits.push(errs + ' error' + (errs === 1 ? '' : 's'));
      }
    }

    // The Query Extractor contributes one of two shapes depending on the view it
    // was left in: one row per execution, or one row per distinct statement.
    // Count the right thing for each rather than dropping the headline entirely.
    const lqeSec = byId['log-query-extractor'];
    if (lqeSec && lqeSec.columns) {
      const durIdx = lqeSec.columns.indexOf('Duration (ms)');
      const totalIdx = lqeSec.columns.indexOf('Total (ms)');
      if (durIdx !== -1) {
        let slow = 0;
        lqeSec.rows.forEach(function (r) { const d = parseFloat(r[durIdx]); if (!isNaN(d) && d > 1000) slow++; });
        bits.push(slow + ' slow quer' + (slow === 1 ? 'y' : 'ies') + ' (>1s)');
      } else if (totalIdx !== -1) {
        let slow = 0;
        lqeSec.rows.forEach(function (r) { const d = parseFloat(r[totalIdx]); if (!isNaN(d) && d > 1000) slow++; });
        bits.push(slow + ' statement' + (slow === 1 ? '' : 's') + ' over 1s total');
      }
    }

    const wsreSec = byId['ws-rest-extractor'];
    if (wsreSec) {
      const m = /(\d+) with error status/.exec(wsreSec.subtitle || '');
      if (m) bits.push(m[1] + ' failed call' + (m[1] === '1' ? '' : 's'));
    }

    const jvmSec = byId['thread-dump'];
    if (jvmSec && jvmSec.columns) {
      const metricIdx = jvmSec.columns.indexOf('Metric');
      const valueIdx = jvmSec.columns.indexOf('Value');
      if (metricIdx !== -1 && valueIdx !== -1) {
        const dl = jvmSec.rows.find(function (r) { return r[metricIdx] === 'Deadlocks detected'; });
        const dlCount = dl ? parseInt(dl[valueIdx], 10) : 0;
        if (dlCount > 0) bits.push(dlCount + ' deadlock' + (dlCount === 1 ? '' : 's'));
      }
    }

    return 'Period: ' + windowLabel + (bits.length ? '  ·  ' + bits.join('  ·  ') : '');
  }

  // Assembles the Incident Report model from the per-tool report sections the
  // Incident Report tool collected (each already filtered to the window). Pure:
  // returns an options object ready for mtExportToHtml. sections is an array of
  // { id, title, subtitle, columns, rows, total, firstMs, lastMs }; opts carries
  // { title, fromMs, toMs, notes }.
  function mtBuildIncidentReport(sections, opts) {
    opts = opts || {};
    sections = (sections || []).filter(Boolean);
    let minMs = Infinity, maxMs = -Infinity, totalRows = 0;
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      if (s.firstMs != null && !isNaN(s.firstMs)) minMs = Math.min(minMs, s.firstMs);
      if (s.lastMs != null && !isNaN(s.lastMs)) maxMs = Math.max(maxMs, s.lastMs);
      totalRows += (s.total != null ? s.total : (s.rows ? s.rows.length : 0));
    }
    const windowLabel = (opts.fromMs != null || opts.toMs != null)
      ? ((opts.fromMs != null ? mtFmtTs(opts.fromMs) : 'start') + '  →  ' + (opts.toMs != null ? mtFmtTs(opts.toMs) : 'end'))
      : (minMs !== Infinity ? mtFmtTs(minMs) + '  →  ' + mtFmtTs(maxMs) : 'all loaded data');
    const meta = [
      { label: 'Time window', value: windowLabel },
      { label: 'Sources', value: sections.length ? sections.map(function (s) { return s.id; }).join(', ') : 'none' },
      { label: 'Total rows', value: totalRows }
    ];
    return {
      title: opts.title || 'Mendix Incident Report',
      subtitle: mtIncidentSummary(sections, windowLabel),
      note: opts.notes ? opts.notes : '',
      meta: meta,
      sections: sections.map(function (s) { return { title: s.title, subtitle: s.subtitle, columns: s.columns, rows: s.rows }; })
    };
  }

  root.mtExportToCsv = mtExportToCsv;
  root.mtExportToMarkdown = mtExportToMarkdown;
  root.mtExportToHtml = mtExportToHtml;
  root.mtFmtTs = mtFmtTs;
  root.mtBuildIncidentReport = mtBuildIncidentReport;
  root.mtIncidentSummary = mtIncidentSummary;

})(typeof window !== 'undefined' ? window : self);
