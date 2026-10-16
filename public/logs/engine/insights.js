/* MxScout — Log analysis module.
 *
 * Log Viewer analysis: records → rows, Insights cards, Levels Matrix, Correlation IDs, error signatures, time axis.
 *
 * Derived from MxDevSwissTool by Mikołaj (RealMecowhy),
 * https://github.com/RealMecowhy/MxDevSwissTool — MIT License, Copyright (c) 2026 Mikołaj.
 * Source: public/js/tools/log-viewer.js (the pure functions; the stream, chart and tab UI are rebuilt in public/logs/ui/)
 * The logic is carried over unchanged, so MxScout reads every log the way the original does;
 * only the packaging differs (no DOM, no network, no build step).
 * The licence text is in THIRD-PARTY-NOTICES.md at the root of this repository.
 */
// `window` is the page on the main thread and the worker/Node global elsewhere; the code below
// was written against `window`, so it is passed in under that name and left as it was.
(function (window) {
'use strict';

// Line endings as the shared parser counts them. Its record offsets point into this
// text, so the viewer has to hold the same string it cut the rows from.
function logLf(text) {
  return text.indexOf('\r') === -1 ? text : text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}


// One parser for every log tool (wave 36): the shared parser reads the file, this only
// maps its records onto viewer rows. `raw` — what search, export and the correlation-id
// lookup read — is cut out of the text between one record's offset and the next.
// Grafana exports carry no offsets: one export row is one record, so the record number
// is the only position there is, and the true raw line is Grafana's envelope, which is
// noise to a reader — the row is rebuilt in the shape the rest of the app speaks.
function logRecordsToEntries(records, text, filename) {
  const entries = new Array(records.length);
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    let msg = r.cause ? r.message + '\n' + r.cause : r.message;
    // Continuation lines lose their indentation, as they always did in the viewer.
    msg = msg.indexOf('\n') === -1 ? msg.trim() : msg.split('\n').map(s => s.trim()).join('\n').trim();
    const level = r.level || 'INFO';
    const node = r.logNode || 'Runtime';
    let raw;
    if (r.offset === undefined) {
      raw = (r.timestamp ? r.timestamp + '  ' : '') + level + ' - ' + node + ': ' + r.message;
    } else {
      raw = text.slice(r.offset, i + 1 < records.length && records[i + 1].offset !== undefined ? records[i + 1].offset : text.length).trimEnd();
      // Blank lines inside a record are dropped by the parser; drop them from raw too.
      if (raw.indexOf('\n') !== -1) raw = raw.replace(/\n[ \t]*(?=\n)/g, '');
      // A Studio Pro CSV row carries its date month first; the row shows it day first,
      // so the line that search and export read says the same (09/27 -> 27/09).
      raw = raw.replace(/^([A-Za-z]+,)(\d{2})\/(\d{2})\/(\d{4}) /, '$1$3/$2/$4 ');
    }
    entries[i] = {
      line: r.line === undefined ? i + 1 : r.line,
      ts: r.timestamp || '', level: level, node: node, msg: msg, raw: raw, file: filename,
      stackLines: (msg.match(/\n/g) || []).length
    };
  }
  return entries;
}

// What the decoder gets from a log row. The log node travels with the message
// because it is part of the signature for several rules — `SAML_SSO: null` says
// which subsystem failed, while a bare `null` says nothing at all. The parser
// keeps the two apart, so they are rejoined here, in the shape a user pasting
// the line would produce. One helper, used by both the Explain chip's
// recognition test and the hand-off, so the chip never promises a decode the
// decoder will not deliver.
function logDecoderText(e) {
  return e.node ? e.node + ': ' + e.msg : e.msg;
}


const LOG_CORRID_PAT = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

function logGetSignature(entry) {
  const msg = entry.msg || '';
  const lines = msg.split('\n');
  let header = lines[0] || '';
  
  header = normalizeString(header);
  
  const stack = [];
  for (let i = 1; i < lines.length; i++) {
    let line = lines[i].trim();
    if (line.startsWith('at ') || line.includes('.java:') || line.includes('.scala:')) {
      line = line.replace(/\.java:\d+/g, '.java:[LINE]')
                 .replace(/\.scala:\d+/g, '.scala:[LINE]')
                 .replace(/:c?\d+\b/g, ':[LINE]')
                 .replace(/\b\d+\b/g, '[NUM]');
      stack.push(line);
    }
    if (stack.length >= 4) break;
  }
  
  if (stack.length > 0) {
    return {
      type: 'exception',
      key: header + '\n' + stack.join('\n'),
      header: header,
      stack: stack
    };
  } else {
    return {
      type: 'message',
      key: header,
      header: header,
      stack: []
    };
  }
}

function normalizeString(str) {
  if (!str) return '';
  return str
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '[UUID]')
    .replace(/\b0x[0-9a-fA-F]+\b/g, '[HEX]')
    .replace(/\b\d{15,19}\b/g, '[MENDIX_ID]')
    .replace(/\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?\b/g, '[DATETIME]')
    .replace(/\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g, '[TIME]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]')
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP]')
    .replace(/\b\d+\b/g, '[NUM]');
}


function logInsightsLevel(l) {
  l = (l || '').toUpperCase();
  if (l === 'WARNING') return 'WARN';
  if (l === 'ERR' || l === 'FATAL') return 'ERROR';
  return l;
}

// Collapse a message to a signature so distinct variants can be counted:
// UUIDs, Mendix ids, numbers and quoted literals become '#'.
function logInsightsSignature(msg) {
  return String(msg || '').split('\n')[0]
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '#')
    .replace(/'[^']*'/g, "'#'")
    .replace(/\b\d+\b/g, '#')
    .trim().slice(0, 200);
}

// Slow-query warning shape, mirroring LQE_SLOW_QUERY in the Log Query Extractor.
// Duplicated rather than shared because the two tools are independent modules;
// if the runtime ever changes the wording, both need the same edit.
const LOG_SLOW_QUERY = /^Query executed in (?:(\d+) seconds? and )?(\d+) milliseconds?:\s*([\s\S]+)/i;

// Statement identity for grouping slow-query warnings: the same normalization
// the Query Extractor uses for its duplicate detection — identical statements
// differ only in their bound values.
function logSlowQuerySig(sql) {
  return String(sql).replace(/\s+/g, ' ').replace(/\b\d+\b/g, '?').trim().slice(0, 120);
}

function logFmtDurMs(ms) {
  return ms >= 1000 ? +(ms / 1000).toFixed(1) + ' s' : ms + ' ms';
}

// Longest prefix two statements share. Members of one signature group differ
// only in their bound values, so this cuts off exactly where the first value
// varies — long enough to identify the statement, short enough to match them all.
function logCommonPrefix(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return a.slice(0, i);
}

// Error mechanisms (Insights card 7). A mechanism is the id of the Error
// Decoder's first — most specific — match for a record, given the same text the
// Explain chip hands over (logDecoderText). These four already have a card of
// their own above, with detail the mechanism card could not show.
const LOG_MECH_UNRECOGNIZED = '(unrecognized)';
const LOG_MECH_OWN_CARD = new Set([
  'mx-request-state-size',       // Request state bloat
  'mx-widget-missing-parameter', // Runtime operation missing parameters
  'mx-taskqueue-failed',         // TaskQueue — failed background tasks
  'mx-slow-query-warning'        // Slow queries
]);
const logMechTitles = new Map();

// Mechanism id of one WARN/ERROR/CRITICAL record, LOG_MECH_UNRECOGNIZED when no
// rule explains it, null for other levels, for records another Insights card
// took, or when the decoder is not loaded.
// Cached on the record like _edxHasMatch, so the stream's mechanism filter reads
// what the card counted. The decoder runs every rule over message and stack, and
// a log repeats a few hundred signatures tens of thousands of times — so within
// one pass it runs once per node + Aggregate Errors signature (`memo`).
function logMechanismOf(rec, row, memo) {
  if (rec._edxMech !== undefined) return rec._edxMech;
  row = row || rec;
  const level = logInsightsLevel(row.level);
  if (level !== 'WARN' && level !== 'ERROR' && level !== 'CRITICAL') return null;
  if (typeof window === 'undefined' || typeof window.edxDecode !== 'function') return null;
  const key = memo ? row.node + '|' + logGetSignature(row).key : null;
  let id = key != null ? memo.get(key) : undefined;
  if (id === undefined) {
    const top = window.edxDecode(logDecoderText(row)).matches[0];
    id = top ? top.id : LOG_MECH_UNRECOGNIZED;
    if (top) logMechTitles.set(top.id, top.title);
    if (key != null) memo.set(key, id);
  }
  rec._edxMech = id;
  return id;
}

function logExtractInsights(records, opts) {
  opts = opts || {};
  const warnMin = opts.warnHotspotMin != null ? opts.warnHotspotMin : 10;
  // A handful of DEBUG lines is normal; a node left at TRACE is what this looks
  // for, so the per-node floor is deliberately well above incidental logging.
  const verboseMin = opts.verboseMin != null ? opts.verboseMin : 25;
  records = records || [];

  const rows = records.map(function (r) {
    return {
      level: logInsightsLevel(r.level),
      node:  (r.logNode != null ? r.logNode : r.node) || '',
      msg:   String(r.message != null ? r.message : r.msg || ''),
      ts:    (r.timestamp != null ? r.timestamp : r.ts) || ''
    };
  });

  const consumed = new Array(rows.length).fill(false);
  const categories = [];

  let warnings = 0, errors = 0;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].level === 'WARN') warnings++;
    else if (rows[i].level === 'ERROR' || rows[i].level === 'CRITICAL') errors++;
  }

  function agg() { return { count: 0, firstTs: '', lastTs: '', sample: '', sigs: new Set() }; }
  function bump(a, r) {
    a.count++;
    if (!a.firstTs) a.firstTs = r.ts;
    a.lastTs = r.ts;
    if (!a.sample) a.sample = r.msg.split('\n')[0];
    a.sigs.add(logInsightsSignature(r.msg));
  }
  function finishCat(key, title, severity, a, filter, items, subtitle) {
    return {
      key: key, title: title, severity: severity,
      count: a.count, distinct: a.sigs.size,
      firstTs: a.firstTs, lastTs: a.lastTs, sample: a.sample,
      subtitle: subtitle || '', filter: filter, items: items || []
    };
  }
  function itemsFromMap(map, parentFilter, searchIsLabel) {
    return Array.from(map.entries()).map(function (e) {
      const label = e[0], a = e[1];
      return {
        label: label, count: a.count, sample: a.sample, distinct: a.sigs.size,
        filter: {
          node: parentFilter.node, levels: parentFilter.levels,
          search: searchIsLabel === false ? '' : label
        }
      };
    }).sort(function (x, y) { return y.count - x.count; });
  }

  // ── 1. Access denied — user lacks microflow/entity rights (WebUI WARNING) ──
  {
    const byMf = new Map(); const users = new Set(); const cat = agg();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.node !== 'WebUI' || r.level !== 'WARN') continue;
      const m = r.msg.match(/User '([^']*)' attempted to execute .*?\(microflow call '([^']+)'\)/);
      if (!m) continue;
      consumed[i] = true; bump(cat, r); users.add(m[1]);
      if (!byMf.has(m[2])) byMf.set(m[2], agg());
      bump(byMf.get(m[2]), r);
    }
    if (cat.count > 0) {
      categories.push(finishCat('perm-denied', 'Access denied — user lacks rights', 'warning', cat,
        { node: 'WebUI', levels: 'WARN', search: 'attempted to execute' },
        itemsFromMap(byMf, { node: 'WebUI', levels: 'WARN' }),
        cat.count + ' denied call(s) · ' + users.size + ' user(s) · ' + byMf.size + ' microflow(s)'));
    }
  }

  // ── 2. Runtime operation missing parameters (WebUI WARNING) ──
  {
    const byOp = new Map(); const cat = agg();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (consumed[i] || r.node !== 'WebUI' || r.level !== 'WARN') continue;
      if (!/is missing parameters/.test(r.msg)) continue;
      consumed[i] = true; bump(cat, r);
      const m = r.msg.match(/is missing parameters: \[([^\]]*)\]/);
      const key = m ? m[1] : '(unknown)';
      if (!byOp.has(key)) byOp.set(key, agg());
      bump(byOp.get(key), r);
    }
    if (cat.count > 0) {
      categories.push(finishCat('missing-params', 'Runtime operation missing parameters', 'warning', cat,
        { node: 'WebUI', levels: 'WARN', search: 'is missing parameters' },
        itemsFromMap(byOp, { node: 'WebUI', levels: 'WARN' }, false),
        cat.count + ' occurrence(s) · ' + byOp.size + ' distinct parameter set(s)'));
    }
  }

  // ── 3. Request state bloat — session memory (RequestStatistics WARNING) ──
  {
    const cat = agg(); let maxSize = 0, threshold = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.node !== 'RequestStatistics' || r.level !== 'WARN') continue;
      const m = r.msg.match(/Request state size of (\d+) objects exceeds the threshold of (\d+)/);
      if (!m) continue;
      consumed[i] = true; bump(cat, r);
      maxSize = Math.max(maxSize, parseInt(m[1], 10));
      threshold = parseInt(m[2], 10);
    }
    if (cat.count > 0) {
      categories.push(finishCat('session-bloat', 'Request state bloat (session memory)', 'warning', cat,
        { node: 'RequestStatistics', levels: 'WARN', search: 'Request state size' }, [],
        cat.count + ' request(s) over limit · peak ' + maxSize + ' objects (threshold ' + threshold + ')'));
    }
  }

  // ── 4. TaskQueue — failed background tasks (ERROR); retry loops surface here ──
  {
    const byTask = new Map(); const cat = agg();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.node !== 'TaskQueue' || (r.level !== 'ERROR' && r.level !== 'CRITICAL')) continue;
      // Task args can contain single quotes (e.g. MailTo='...'), so capture the
      // task name (up to '(' or quote) and the queue name independently rather
      // than with one brittle regex that would drop those failures.
      const tm = r.msg.match(/Failed to execute task '([^'(]+)/);
      if (!tm) continue;
      consumed[i] = true; bump(cat, r);
      const task = tm[1].trim();
      const qm = r.msg.match(/from task queue '([^']+)'/);
      const queue = qm ? qm[1] : '(unknown)';
      const key = task + '  ·  queue ' + queue;
      if (!byTask.has(key)) byTask.set(key, { agg: agg(), task: task });
      bump(byTask.get(key).agg, r);
    }
    if (cat.count > 0) {
      const items = Array.from(byTask.entries()).map(function (e) {
        const a = e[1].agg;
        return { label: e[0], count: a.count, sample: a.sample, distinct: a.sigs.size,
          filter: { node: 'TaskQueue', levels: 'ERROR,CRITICAL', search: e[1].task } };
      }).sort(function (x, y) { return y.count - x.count; });
      const loops = items.filter(function (it) { return it.count >= 5; }).length;
      categories.push(finishCat('taskqueue-fail', 'TaskQueue — failed background tasks', 'error', cat,
        { node: 'TaskQueue', levels: 'ERROR,CRITICAL', search: 'Failed to execute task' }, items,
        cat.count + ' failure(s) · ' + byTask.size + ' task(s)' + (loops ? ' · ' + loops + ' retry-loop(s)' : '')));
    }
  }

  // ── 5. Slow-query warnings (ConnectionBus_Queries WARNING) ──
  // The only database signal available at default production log levels — the
  // Log Query Extractor already treats it as first class, while Insights used to
  // drop it into an anonymous per-node bucket that said nothing about duration.
  {
    const byStmt = new Map(); const cat = agg(); let worstMs = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (consumed[i] || r.node !== 'ConnectionBus_Queries' || r.level !== 'WARN') continue;
      const m = r.msg.match(LOG_SLOW_QUERY);
      if (!m) continue;
      consumed[i] = true; bump(cat, r);
      const ms = (m[1] ? parseInt(m[1], 10) * 1000 : 0) + parseInt(m[2], 10);
      if (ms > worstMs) worstMs = ms;
      const sql = String(m[3]).replace(/\s+/g, ' ').trim();
      const key = logSlowQuerySig(sql);
      if (!byStmt.has(key)) byStmt.set(key, { a: agg(), worst: 0, search: sql.slice(0, 80) });
      const e = byStmt.get(key);
      bump(e.a, r);
      if (ms > e.worst) e.worst = ms;
      // The stream filter matches raw log text, where the bound values are still
      // in place — so the search has to be what every execution in this group
      // shares, not the first one's text. A card that counts 2 must not filter
      // down to the 1 that happened to be logged first.
      e.search = logCommonPrefix(e.search, sql);
    }
    if (cat.count > 0) {
      const items = Array.from(byStmt.entries()).map(function (e) {
        return {
          label: e[0] + '  ·  worst ' + logFmtDurMs(e[1].worst),
          count: e[1].a.count, sample: e[1].a.sample, distinct: e[1].a.sigs.size,
          // Search on the raw statement, not the normalized label: the stream
          // filter matches the log text, where the bound values are still there.
          filter: { node: 'ConnectionBus_Queries', levels: 'WARN', search: e[1].search }
        };
      }).sort(function (x, y) { return y.count - x.count; });
      const c = finishCat('slow-queries', 'Slow queries (runtime warnings)', 'warning', cat,
        { node: 'ConnectionBus_Queries', levels: 'WARN', search: '' }, items,
        cat.count + ' slow quer' + (cat.count === 1 ? 'y' : 'ies') + ' · ' + byStmt.size +
        ' distinct statement(s) · worst ' + logFmtDurMs(worstMs));
      c.crossLink = 'log-query-extractor';
      categories.push(c);
    }
  }

  // ── 6. Nodes logging at TRACE/DEBUG — a fact about the log, not a problem ──
  // "Why is my log 60 MB and my app slow" is most often answered by a log node
  // left at TRACE on production. The Levels matrix already counts this; nobody
  // ever stated it as a finding. Phrased as an observation (severity 'info'),
  // because verbose logging in a development environment is intentional.
  {
    const counts = new Map();
    for (let i = 0; i < rows.length; i++) {
      const lv = rows[i].level;
      if (lv !== 'TRACE' && lv !== 'DEBUG') continue;
      const key = rows[i].node || '(unknown)';
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const loud = new Set();
    counts.forEach(function (n, node) { if (n >= verboseMin) loud.add(node); });
    if (loud.size) {
      // Second pass so the card's own span and sample come from the qualifying
      // nodes only — summing the per-node aggregates would report the first
      // node's last timestamp as the category's.
      const byNode = new Map(); const cat = agg();
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.level !== 'TRACE' && r.level !== 'DEBUG') continue;
        const key = r.node || '(unknown)';
        if (!loud.has(key)) continue;
        bump(cat, r);
        if (!byNode.has(key)) byNode.set(key, agg());
        bump(byNode.get(key), r);
      }
      const share = function (n) { return rows.length ? Math.round(n / rows.length * 100) : 0; };
      const items = Array.from(byNode.entries()).map(function (e) {
        return {
          label: e[0] + '  ·  ' + share(e[1].count) + '% of the log',
          count: e[1].count, sample: e[1].sample, distinct: e[1].sigs.size,
          filter: { node: e[0], levels: 'TRACE,DEBUG', search: '' }
        };
      }).sort(function (x, y) { return y.count - x.count; });
      categories.push(finishCat('verbose-nodes', 'Nodes logging at TRACE/DEBUG', 'info', cat,
        { node: '', levels: 'TRACE,DEBUG', search: '' }, items,
        cat.count + ' entr' + (cat.count === 1 ? 'y' : 'ies') + ' · ' + share(cat.count) +
        '% of the log · ' + loud.size + ' node(s) at ' + verboseMin + '+ entries'));
    }
  }

  // ── 7. Error mechanisms — WARN/ERROR grouped by what the Error Decoder says ──
  // Text signatures split one mechanism into hundreds of variants (a 404 per
  // file name, a null-id per object); the decoder's rule is the cause they
  // share. Measured on NewLogs: median 44% fewer rows than Insights signatures.
  // Records a card above already took, and mechanisms that own a card above,
  // are left out, so nothing is shown twice (Access denied has no decoder rule
  // and would otherwise sit under "unrecognized"). Records no rule explains
  // stay in, as one visible "unrecognized" row.
  // Only offered when the decoder is loaded and recognizes at least one record.
  {
    const byMech = new Map(); const cat = agg();
    const memo = new Map(); let hasErr = false;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (r.level !== 'WARN' && r.level !== 'ERROR' && r.level !== 'CRITICAL') continue;
      // Marked, not just skipped: the stream's mechanism filter reads this
      // cache, and a record left undecided would be decoded there and land
      // under "unrecognized" — more rows than the card counted.
      if (consumed[i]) { records[i]._edxMech = null; continue; }
      const id = logMechanismOf(records[i], r, memo);
      if (id == null || LOG_MECH_OWN_CARD.has(id)) continue;
      bump(cat, r);
      if (r.level !== 'WARN') hasErr = true;
      if (!byMech.has(id)) byMech.set(id, agg());
      bump(byMech.get(id), r);
    }
    const unrec = byMech.get(LOG_MECH_UNRECOGNIZED);
    const known = byMech.size - (unrec ? 1 : 0);
    if (known > 0) {
      const items = Array.from(byMech.entries())
        .filter(function (e) { return e[0] !== LOG_MECH_UNRECOGNIZED; })
        .map(function (e) {
          return { label: logMechTitles.get(e[0]) || e[0], count: e[1].count, sample: e[1].sample,
            distinct: e[1].sigs.size, mechanism: e[0],
            filter: { node: '', levels: 'WARN,ERROR,CRITICAL', search: '', mech: e[0] } };
        }).sort(function (x, y) { return y.count - x.count; });
      if (unrec) {
        items.push({ label: 'unrecognized', count: unrec.count, sample: unrec.sample,
          distinct: unrec.sigs.size, pinned: true,
          filter: { node: '', levels: 'WARN,ERROR,CRITICAL', search: '', mech: LOG_MECH_UNRECOGNIZED } });
      }
      categories.push(finishCat('error-mechanisms', 'Error mechanisms', hasErr ? 'error' : 'warning', cat,
        { node: '', levels: 'WARN,ERROR,CRITICAL', search: '', mech: Array.from(byMech.keys()).join(',') }, items,
        cat.count + ' entr' + (cat.count === 1 ? 'y' : 'ies') + ' · ' + known + ' mechanism(s) · ' +
        (unrec ? unrec.count : 0) + ' unrecognized'));
    }
  }

  // ── 8. Generic per-node hotspots for everything not captured above ──
  const buckets = new Map();
  for (let i = 0; i < rows.length; i++) {
    if (consumed[i]) continue;
    const r = rows[i];
    const isErr = r.level === 'ERROR' || r.level === 'CRITICAL';
    const isWarn = r.level === 'WARN';
    if (!isErr && !isWarn) continue;
    const bkey = (isErr ? 'E|' : 'W|') + r.node;
    if (!buckets.has(bkey)) buckets.set(bkey, { node: r.node, severity: isErr ? 'error' : 'warning', a: agg(), sigMap: new Map() });
    const b = buckets.get(bkey);
    bump(b.a, r);
    const sig = logInsightsSignature(r.msg);
    if (!b.sigMap.has(sig)) b.sigMap.set(sig, agg());
    bump(b.sigMap.get(sig), r);
  }
  buckets.forEach(function (b) {
    if (b.severity === 'warning' && b.a.count < warnMin) return;
    const levels = b.severity === 'error' ? 'ERROR,CRITICAL' : 'WARN';
    const items = Array.from(b.sigMap.entries()).map(function (e) {
      return { label: e[0], count: e[1].count, sample: e[1].sample, distinct: 1,
        filter: { node: b.node, levels: levels, search: '' } };
    }).sort(function (x, y) { return y.count - x.count; }).slice(0, 8);
    categories.push(finishCat('node-' + b.severity + '-' + b.node,
      b.node + (b.severity === 'error' ? ' — errors' : ' — warnings'), b.severity, b.a,
      { node: b.node, levels: levels, search: '' }, items,
      b.a.count + ' entr' + (b.a.count === 1 ? 'y' : 'ies') + ' · ' + b.sigMap.size + ' distinct message(s)'));
  });

  // Problems first, observations last: an 'info' card states a fact about the
  // log and must never outrank an error, however many entries it counts.
  const sevRank = { error: 0, warning: 1, info: 2 };
  categories.sort(function (x, y) {
    const sr = (sevRank[x.severity] || 0) - (sevRank[y.severity] || 0);
    if (sr) return sr;
    return y.count - x.count;
  });

  return { categories: categories, stats: { records: rows.length, warnings: warnings, errors: errors, categories: categories.length } };
}

// ============================================================
// LEVEL MATRIX — LogNode × level pivot (data-driven)
// ============================================================
// Pure function, attached to window/self so Node tests require it like the
// other extractors. Consumes parser records ({level, logNode|node}) and returns
// only the levels and nodes that actually occur — no empty rows/columns
// (data-driven rule). Zero new parsing: it counts records the log parser already
// produced. Nodes rank by ERROR+CRITICAL volume so the noisiest logger floats up.

const LOG_LEVEL_ORDER = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'CRITICAL'];

function logMatrixLevel(l) {
  l = (l || '').toUpperCase();
  if (l === 'WARNING') return 'WARN';
  if (l === 'ERR' || l === 'FATAL') return 'ERROR';
  return l;
}

function logBuildLevelMatrix(records) {
  records = records || [];
  const nodeMap = new Map();       // node → { node, counts:{level:n}, total }
  const levelTotals = {};
  const present = new Set();
  let grandTotal = 0;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    const level = logMatrixLevel(r.level);
    if (LOG_LEVEL_ORDER.indexOf(level) === -1) continue; // ignore unknown levels
    const node = ((r.logNode != null ? r.logNode : r.node) || 'Runtime') || 'Runtime';
    if (!nodeMap.has(node)) nodeMap.set(node, { node: node, counts: {}, total: 0 });
    const row = nodeMap.get(node);
    row.counts[level] = (row.counts[level] || 0) + 1;
    row.total++;
    levelTotals[level] = (levelTotals[level] || 0) + 1;
    present.add(level);
    grandTotal++;
  }

  const levels = LOG_LEVEL_ORDER.filter(l => present.has(l));
  const nodes = Array.from(nodeMap.values());
  nodes.sort(function (a, b) {
    const ae = (a.counts.ERROR || 0) + (a.counts.CRITICAL || 0);
    const be = (b.counts.ERROR || 0) + (b.counts.CRITICAL || 0);
    if (be !== ae) return be - ae;
    if (b.total !== a.total) return b.total - a.total;
    return a.node.localeCompare(b.node);
  });

  return { levels: levels, nodes: nodes, levelTotals: levelTotals, grandTotal: grandTotal, nodeCount: nodes.length };
}


const LOG_CORRID_MSG = /^\[([^\]\s]{4,64})\]\s/;

// The DEBUG record that names the microflow behind an ID. An ID on its own is
// unreadable; the microflow name is what makes the list scannable.
const LOG_CORR_MF = /^\[[^\]\s]+\]\s+(?:Starting|Finished) execution of microflow '([^']+)'/;


// Pure: group loaded entries by correlation ID. Returns the ranking plus the two
// numbers the empty state needs — how much was scanned and how much carried an ID.
function logExtractCorrelations(entries) {
  const list = entries || [];
  const map = new Map();
  let withId = 0;

  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    // Accepts both shapes, like logExtractInsights: the viewer's own entries
    // (ts/node/msg) and raw parser records (timestamp/logNode/message).
    const e = {
      level: logInsightsLevel(r.level),
      node: (r.logNode != null ? r.logNode : r.node) || '',
      msg: String(r.message != null ? r.message : r.msg || ''),
      ts: (r.timestamp != null ? r.timestamp : r.ts) || ''
    };
    const m = e.msg.match(LOG_CORRID_MSG);
    if (!m) continue;
    withId++;

    let g = map.get(m[1]);
    if (!g) {
      g = { id: m[1], count: 0, errors: 0, warnings: 0, nodes: [], flow: null,
            firstTs: e.ts, lastTs: e.ts, spanMs: null, firstMs: NaN, lastMs: NaN };
      map.set(m[1], g);
    }
    g.count++;
    g.lastSeenTs = e.ts;

    if (e.level === 'ERROR' || e.level === 'CRITICAL') g.errors++;
    else if (e.level === 'WARN') g.warnings++;

    if (e.node && g.nodes.indexOf(e.node) === -1) g.nodes.push(e.node);
    if (!g.flow) {
      const mf = e.msg.match(LOG_CORR_MF);
      if (mf) g.flow = mf[1];
    }

    const ms = mtTsToMs(e.ts);
    if (!isNaN(ms)) {
      if (isNaN(g.firstMs) || ms < g.firstMs) { g.firstMs = ms; g.firstTs = e.ts; }
      if (isNaN(g.lastMs) || ms > g.lastMs) { g.lastMs = ms; g.lastTs = e.ts; }
    }
  }

  const groups = Array.from(map.values());
  groups.forEach(function (g) {
    // No parseable timestamp anywhere in the group: fall back to file order for
    // the endpoints and report no span at all rather than a fabricated 0 ms.
    if (isNaN(g.firstMs)) { g.lastTs = g.lastSeenTs; g.spanMs = null; }
    else g.spanMs = g.lastMs - g.firstMs;
    delete g.lastSeenTs;
  });

  // Errors first — the ID worth opening is the one that failed — then volume,
  // then the ID itself so the order is stable across runs.
  groups.sort(function (a, b) {
    return (b.errors - a.errors) || (b.count - a.count) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });

  return { groups: groups, scanned: list.length, withId: withId };
}


function logCorrSpanLabel(g) {
  if (g.spanMs == null) return '';
  if (g.spanMs < 1) return 'instant';
  return logFmtDurMs(Math.round(g.spanMs));
}


// Resolves the entries onto one monotonic epoch axis for the Gantt. Entries can
// carry three timestamp shapes: full ISO (cloud, Studio Pro console, on-premises), the Studio
// Pro CSV export the shared parser emits, or a time-only stamp from a time-only line.
// Only the last one has to be synthesised — and it is the one that used to break
// the chart: anchoring every entry to a fixed 1970-01-01 threw the date away, so a
// log crossing midnight sorted backwards and reported "logs have same timestamp".
// Carrying a day offset forward when the clock jumps back keeps the axis monotonic.
// Writes e.ms onto every entry, in place, once per loaded log. The day-offset
// carry is why this has to run over the whole list in order rather than per
// entry: a time-only log has no date to anchor to, so midnight is only visible
// as the clock jumping backwards. An unreadable timestamp gets NaN — never 0 —
// so time-based views can leave it out instead of parking it at the epoch.
function logAssignMs(entries) {
  let dayOffset = 0;
  let prevTimeOnly = -1;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    let ms = mtTsToMs(e.ts);
    if (isNaN(ms)) {
      const m = String(e.ts).match(/^\[?(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
      if (m) {
        const hh = parseInt(m[1], 10), mm = parseInt(m[2], 10), ss = parseInt(m[3], 10);
        const t = ((hh * 60 + mm) * 60 + ss) * 1000 +
                  (m[4] ? parseInt(m[4].padEnd(3, '0').slice(0, 3), 10) : 0);
        if (prevTimeOnly >= 0 && t < prevTimeOnly) dayOffset += 86400000;
        prevTimeOnly = t;
        ms = t + dayOffset;
      } else {
        ms = NaN;
      }
    }
    e.ms = ms;
  }
  return entries;
}

// The Gantt's own view of the axis: the entries whose time could be read.
// In the app ms is already assigned for the whole log (logShowLoaded), and this
// leaves it alone — re-deriving it for a 500-entry slice would restart the
// day-offset carry and could disagree with the timeline and the stream. Entries
// that arrive without ms get it here, so the function still stands on its own.
function logGanttAxis(entries) {
  if (entries.length && typeof entries[0].ms !== 'number') logAssignMs(entries);
  return entries.filter(e => typeof e.ms === 'number' && !isNaN(e.ms));
}


function logInsightsShortTs(ts) {
  const m = String(ts).match(/(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : ts;
}

// A count badge is a label, not a figure to read digit by digit. "176908×" was
// four times wider than its neighbours and broke the row's rhythm — and it sat
// on the one card that is an observation rather than a problem, so the widest,
// loudest element on the tab was also the least actionable. The exact number is
// still one hover away.
function logInsightsCount(n) {
  if (!isFinite(n)) return String(n);
  if (n >= 1000000) return (n / 1000000).toFixed(n < 10000000 ? 1 : 0).replace(/\.0$/, '') + 'M';
  if (n >= 10000) return Math.round(n / 1000) + 'k';
  return String(n);
}


  window.logLf = logLf;
  window.logRecordsToEntries = logRecordsToEntries;
  window.logDecoderText = logDecoderText;
  window.LOG_CORRID_PAT = LOG_CORRID_PAT;
  window.logGetSignature = logGetSignature;
  window.normalizeString = normalizeString;
  window.logInsightsLevel = logInsightsLevel;
  window.logInsightsSignature = logInsightsSignature;
  window.LOG_SLOW_QUERY = LOG_SLOW_QUERY;
  window.logSlowQuerySig = logSlowQuerySig;
  window.logFmtDurMs = logFmtDurMs;
  window.logCommonPrefix = logCommonPrefix;
  window.LOG_MECH_UNRECOGNIZED = LOG_MECH_UNRECOGNIZED;
  window.LOG_MECH_OWN_CARD = LOG_MECH_OWN_CARD;
  window.logMechTitles = logMechTitles;
  window.logMechanismOf = logMechanismOf;
  window.logExtractInsights = logExtractInsights;
  window.LOG_LEVEL_ORDER = LOG_LEVEL_ORDER;
  window.logMatrixLevel = logMatrixLevel;
  window.logBuildLevelMatrix = logBuildLevelMatrix;
  window.LOG_CORRID_MSG = LOG_CORRID_MSG;
  window.LOG_CORR_MF = LOG_CORR_MF;
  window.logExtractCorrelations = logExtractCorrelations;
  window.logCorrSpanLabel = logCorrSpanLabel;
  window.logAssignMs = logAssignMs;
  window.logGanttAxis = logGanttAxis;
  window.logInsightsShortTs = logInsightsShortTs;
  window.logInsightsCount = logInsightsCount;
})(typeof window !== 'undefined' ? window : self);
