/* MxScout — Log analysis module.
 *
 * Log Query Extractor: SQL / OQL / XPath / query plans out of TRACE logs, plus slow-query warnings.
 *
 * Derived from MxDevSwissTool by Mikołaj (RealMecowhy),
 * https://github.com/RealMecowhy/MxDevSwissTool — MIT License, Copyright (c) 2026 Mikołaj.
 * Source: public/js/tools/log-query-extractor.js (extraction, aggregation, statement helpers; the list, filters and detail pane are rebuilt in public/logs/ui/)
 * The logic is carried over unchanged, so MxScout reads every log the way the original does;
 * only the packaging differs (no DOM, no network, no build step).
 * The licence text is in THIRD-PARTY-NOTICES.md at the root of this repository.
 */
(function (root) {
'use strict';
// The original reads these through `window`; `root` is the page on the main thread and the
// worker/Node global elsewhere, so the same code runs in all three.
const window = root;

// ConnectionBus_Queries WARNING — logged at default log levels when a query exceeds
// the runtime slow-query threshold, so it works on production without TRACE.
const LQE_SLOW_QUERY = /^Query executed in (?:(\d+) seconds? and )?(\d+) milliseconds?:\s*([\s\S]+)/i;


// Detects the statement type from the leading SQL keyword
function lqeSqlType(sql) {
  const upper = sql.toUpperCase();
  if (upper.startsWith('SELECT') || upper.startsWith('COUNT')) return 'SELECT';
  if (upper.startsWith('UPDATE')) return 'UPDATE';
  if (upper.startsWith('INSERT')) return 'INSERT';
  if (upper.startsWith('DELETE')) return 'DELETE';
  return 'OTHER';
}

// Pure extraction + aggregation: records -> array of query objects (with signatures,
// duplicate counts, linked plans and parsed params). No DOM, no module state, so it's
// unit-testable in Node (attached to window/self at the bottom of this file, like MFT).
function lqeExtractQueries(records) {
  const queryMap = new Map();    // sqlId -> query object
  const xpathMap = new Map();    // xpathId -> { xpath, oql }
  const planMap = new Map();     // xpathId -> plan JSON string
  const unlinkedPlans = [];      // plans without xpathId, in order
  const slowQueries = [];        // ConnectionBus_Queries WARNING entries (slow query log)

  // First pass: collect XPath sources, OQL translations, Query Plans and slow-query warnings
  for (let ri = 0; ri < records.length; ri++) {
    const rec = records[ri];
    const msg = rec.message;

    // Slow query warning: full SQL + duration at default log levels (no TRACE needed)
    if (rec.logNode === 'ConnectionBus_Queries') {
      const sm = msg.match(LQE_SLOW_QUERY);
      if (sm) {
        const durationMs = (sm[1] ? parseInt(sm[1], 10) * 1000 : 0) + parseInt(sm[2], 10);
        const sql = sm[3].trim();
        slowQueries.push({
          sqlId: 'slow-' + ri,
          txConn: '-',
          timestamp: rec.timestamp,
          sql: sql,
          type: lqeSqlType(sql),
          params: [],
          paramsString: '',
          status: 'SLOW (warning)',
          rows: '-',
          xpathId: null,
          xpathContent: '',
          resultData: '',
          queryPlan: '',
          duration: durationMs + ' ms',
          cost: null,
          slowWarning: true,
          _recIdx: ri
        });
      }
      continue;
    }

    // XPath incoming
    let xpathMatch = msg.match(/^Incoming query of type (XPath|OQL):\s*\[([a-f0-9-]+)\]\s*(.*)/is); // jshint ignore:line
    if (xpathMatch) {
      const id = xpathMatch[2];
      if (!xpathMap.has(id)) xpathMap.set(id, { xpath: '', oql: '' });
      xpathMap.get(id).xpath = xpathMatch[1] + ': ' + xpathMatch[3].trim();
      continue;
    }
    
    // OQL QueryParseResult
    let oqlMatch = msg.match(/^OQL:\s*\[([a-f0-9-]+)\]\s*QueryParseResult\((.*)\)/is); // jshint ignore:line
    if (oqlMatch) {
      const id = oqlMatch[1];
      let oqlContent = oqlMatch[2].trim();
      // Remove trailing Mendix metadata
      oqlContent = oqlContent.replace(/,com\.mendix\.connectionbus\..*$/s, ''); // jshint ignore:line
      if (!xpathMap.has(id)) xpathMap.set(id, { xpath: '', oql: '' });
      xpathMap.get(id).oql = oqlContent;
      continue;
    }
    
    // Query Plan from DataStorage_QueryPlan
    if (rec.logNode === 'DataStorage_QueryPlan') {
      let planMatch = msg.match(/^Query Plan:\s*(?:\[([a-f0-9-]+)\]\s*)?([\s\S]*)/i);
      if (planMatch) {
        const xpathId = planMatch[1] || null;
        const planJson = planMatch[2].trim();
        if (xpathId) {
          planMap.set(xpathId, planJson);
        } else {
          unlinkedPlans.push(planJson);
        }
      }
      continue;
    }
  }
  
  // Second pass: extract SQL queries and correlate everything
  let lastSqlId = null;
  let unlinkedPlanIdx = 0;

  for (let ri = 0; ri < records.length; ri++) {
    const rec = records[ri];
    const msg = rec.message;

    // SQL line: SQL@SQLID(TX-CONN): content
    // The colon is optional: when the runtime spills the remaining bound values
    // onto their own line it writes `SQL@id(TX-Cxx) Update param 3: …` without
    // one, and requiring it dropped that line — and with it a parameter, so the
    // rebuilt statement kept a bare `?`.
    let sqlMatch = msg.match(/^SQL@([a-f0-9]+)\((T\d+-C[a-f0-9]+)\):?\s*(.*)/is); // jshint ignore:line
    if (!sqlMatch) continue;

    const sqlId = sqlMatch[1];
    const txConn = sqlMatch[2];
    const content = sqlMatch[3].trim();

    if (!queryMap.has(sqlId)) {
      queryMap.set(sqlId, {
        sqlId: sqlId,
        txConn: txConn,
        timestamp: rec.timestamp,
        sql: '',
        type: 'OTHER',
        params: [],
        paramsString: '',
        status: 'Pending',
        rows: '-',
        xpathId: null,
        xpathContent: '',
        resultData: '',
        queryPlan: '',
        duration: null,
        cost: null,
        _recIdx: ri
      });
    }

    const q = queryMap.get(sqlId);
    lastSqlId = sqlId;
    
    // Determine content type
    // IMPORTANT: Check params BEFORE SQL keywords because "Select params..." starts with "SELECT"
    // `params 1-2:` for a batch, `param 3:` for a value spilled onto its own line.
    if (content.match(/^(Select|Update|Insert|Delete) params?\b/i)) {
      const paramStr = content.substring(content.indexOf(':') + 1).trim();
      q.paramsString = (q.paramsString ? q.paramsString + ', ' : '') + paramStr;
    }
    else if (content.startsWith('Success:')) {
      q.status = 'Success';
    }
    else if (content.match(/^\[([a-f0-9-]+)\]\s*Data table/)) {
      // Result line with xpathId link — this is the KEY correlation!
      let m = content.match(/^\[([a-f0-9-]+)\]\s*(.*)/is); // jshint ignore:line
      q.xpathId = m[1];
      
      // Link XPath/OQL source
      if (xpathMap.has(q.xpathId)) {
        const src = xpathMap.get(q.xpathId);
        let parts = [];
        if (src.xpath) parts.push(src.xpath);
        if (src.oql) parts.push('\nTranslated OQL:\n' + src.oql);
        q.xpathContent = parts.join('\n');
      }
      
      // Link Query Plan
      if (planMap.has(q.xpathId)) {
        q.queryPlan = planMap.get(q.xpathId);
      }
      
      let rowMatch = m[2].match(/\((\d+)\s*row\(s\)\)/);
      if (rowMatch) q.rows = rowMatch[1];
      
      q.resultData += m[2] + '\n';
    }
    else if (content.startsWith('Data table')) {
      let rowMatch = content.match(/\((\d+)\s*row\(s\)\)/);
      if (rowMatch) q.rows = rowMatch[1];
      q.resultData += content + '\n';
    }
    else if (content.startsWith('Row ')) {
      q.resultData += content + '\n';
    }
    else {
      // SQL statement detection (must be last because all other patterns start with known prefixes)
      const upperContent = content.toUpperCase();
      if (upperContent.startsWith('SELECT ') || upperContent.startsWith('UPDATE ') || 
          upperContent.startsWith('INSERT ') || upperContent.startsWith('DELETE ') || 
          upperContent.startsWith('COUNT(')) {
        q.sql = content;
        if (upperContent.startsWith('SELECT')) q.type = 'SELECT';
        else if (upperContent.startsWith('UPDATE')) q.type = 'UPDATE';
        else if (upperContent.startsWith('INSERT')) q.type = 'INSERT';
        else if (upperContent.startsWith('DELETE')) q.type = 'DELETE';
        else if (upperContent.startsWith('COUNT')) q.type = 'SELECT';
      }
    }
  }
  
  // Build final list; slow-query warnings are merged in chronological (record) order
  const queries = Array.from(queryMap.values()).filter(q => q.sql.length > 0)
    .concat(slowQueries)
    .sort((a, b) => a._recIdx - b._recIdx);

  // Duplicate detection (N+1): identical statements differ only in bound values,
  // so a normalized signature groups them together.
  const sigCounts = new Map();
  queries.forEach((q, i) => {
    q._idx = i;
    q.signature = q.sql.replace(/\s+/g, ' ').replace(/\b\d+\b/g, '?').trim().toLowerCase();
    sigCounts.set(q.signature, (sigCounts.get(q.signature) || 0) + 1);
  });
  queries.forEach(q => { q.dupCount = sigCounts.get(q.signature) || 1; });

  // Post-process: parse params, extract duration/cost from query plans
  for (let q of queries) {
    // For queries without an xpathId, try to assign an unlinked plan
    // (slow-query warnings never have a logged plan — don't consume one)
    if (!q.queryPlan && unlinkedPlanIdx < unlinkedPlans.length && !q.xpathId && !q.slowWarning) {
      q.queryPlan = unlinkedPlans[unlinkedPlanIdx++];
    }
    
    // Parse query plan JSON to extract duration and cost
    if (q.queryPlan) {
      try {
        const p = JSON.parse(q.queryPlan);
        if (p && p.length > 0 && p[0]) {
          // Execution Time is at the top level of the plan array element
          if (p[0]['Execution Time'] !== undefined) {
            q.duration = parseFloat(p[0]['Execution Time']).toFixed(3) + ' ms';
          } else if (p[0].Plan && p[0].Plan['Actual Total Time'] !== undefined) {
            q.duration = parseFloat(p[0].Plan['Actual Total Time']).toFixed(3) + ' ms';
          }
          if (p[0].Plan && p[0].Plan['Total Cost'] !== undefined) {
            q.cost = p[0].Plan['Total Cost'];
          }
          // Also extract Planning Time
          if (p[0]['Planning Time'] !== undefined) {
            q.planningTime = parseFloat(p[0]['Planning Time']).toFixed(3) + ' ms';
          }
        }
      } catch(e) {
        // Plan JSON wasn't valid — keep raw text
      }
    }
    
    // Parse params string
    if (q.paramsString) {
      if (q.paramsString.endsWith(',')) q.paramsString = q.paramsString.slice(0, -1);
      q.params = splitParams(q.paramsString);
    }
  }

  return queries;
}

// ── "By statement" aggregate ─────────────────────────────────────────────────
// Every other view here is per-execution, which answers "which single query was
// slowest" — and the Slowest stat already answers that. On a real TRACE log the
// expensive statement is usually the cheap one executed thousands of times:
// 4 000 × 3 ms outweighs one 400 ms query by an order of magnitude and is
// invisible when every row is one execution. This folds the executions onto the
// signature the duplicate detector already computes, so no new parsing.
//
// Durations exist only where the log carries them (a logged query plan, or a
// slow-query warning that states its own duration), so timedCount travels with
// every group: a total summed from 3 of 400 executions must not be presented as
// the cost of all 400. Groups with nothing timed report null, not 0.
function lqeAggregateByStatement(queries) {
  const map = new Map();
  (queries || []).forEach(function (q) {
    const key = q.signature || String(q.sql || '').replace(/\s+/g, ' ').trim().toLowerCase();
    let g = map.get(key);
    if (!g) {
      g = { signature: key, sample: q, worst: null, count: 0, timedCount: 0,
            sumMs: 0, avgMs: null, maxMs: null, slowCount: 0 };
      map.set(key, g);
    }
    g.count++;
    if (q.slowWarning) g.slowCount++;
    const d = q.duration ? parseFloat(q.duration) : NaN;
    if (!isNaN(d)) {
      g.timedCount++;
      g.sumMs += d;
      if (g.maxMs === null || d > g.maxMs) { g.maxMs = d; g.worst = q; }
    }
  });

  const groups = Array.from(map.values());
  groups.forEach(function (g) {
    g.avgMs = g.timedCount ? g.sumMs / g.timedCount : null;
    if (!g.timedCount) g.sumMs = null;
    if (!g.worst) g.worst = g.sample; // nothing timed — the first execution represents the group
  });
  // Default order is the question this view exists to answer: total cost first,
  // then sheer volume for the groups the log never timed.
  groups.sort(function (a, b) {
    const d = (b.sumMs || 0) - (a.sumMs || 0);
    return d !== 0 ? d : b.count - a.count;
  });
  return groups;
}


// Splits the logged parameter list on its top-level commas. Besides double
// quotes it tracks {} / [] nesting, because a single bound value is regularly a
// whole JSON document whose internal commas must not end it — a real log line
// reads `Update params 1-2: 2026-07-14 18:37:11.793, {"body":{"changes":{…}}}`,
// and splitting that naively turned two parameters into dozens of fragments.
function splitParams(str) {
  const result = [];
  let current = '';
  let inQuotes = false;
  let depth = 0;

  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inQuotes && c === '\\') {
      // \" inside a JSON string is content, not the end of the string
      current += c;
      i++;
      if (i < str.length) current += str[i];
    } else if (c === '"') {
      inQuotes = !inQuotes;
      current += c;
    } else if (!inQuotes && (c === '{' || c === '[')) {
      depth++;
      current += c;
    } else if (!inQuotes && (c === '}' || c === ']')) {
      if (depth > 0) depth--;
      current += c;
    } else if (c === ',' && !inQuotes && depth === 0) {
      result.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  if (current) result.push(current.trim());
  return result;
}


// Best-effort "table + operation" label so a long SQL blob scans in one glance
// (e.g. "SELECT customers$order"). Falls back to just the operation when the
// statement doesn't match a plain single-table shape (subselects, no FROM, etc.)
// rather than guessing — an unlabeled row is honest, a wrong label isn't.
// The single-table shape the label and the attribution both need. Null when the
// statement isn't one (subselects, no FROM) rather than a guess.
function lqeTableOf(q) {
  const sql = q.sql || '';
  let m = null;
  if (q.type === 'UPDATE') m = sql.match(/^UPDATE\s+"?([A-Za-z0-9_.$]+)"?/i);
  else if (q.type === 'INSERT') m = sql.match(/^INSERT\s+INTO\s+"?([A-Za-z0-9_.$]+)"?/i);
  else m = sql.match(/\bFROM\s+"?([A-Za-z0-9_.$]+)"?/i); // SELECT and DELETE both use FROM
  return m ? m[1].replace(/^public\./i, '') : null;
}

function lqeSmartLabel(q) {
  const table = lqeTableOf(q);
  if (!table) return q.type;
  // With a domain model loaded, say `SELECT eShop.Order` instead of
  // `SELECT eshop$order` — same label, in the names the developer works in.
  const entity = window.mxEntityForTable ? window.mxEntityForTable(table) : null;
  return q.type + ' ' + (entity || table);
}


// Duration heat-map: fixed bands (not relative to the visible set, so the same
// number always means the same color as filters change) — <100ms fine, <1s
// worth a look, otherwise slow.
function lqeDurationColor(duration) {
  if (!duration) return null;
  const ms = parseFloat(duration);
  if (isNaN(ms)) return null;
  if (ms < 100) return 'var(--success)';
  if (ms < 1000) return 'var(--warning)';
  return 'var(--danger)';
}


// Substitutes bound params into the logged SQL, then lays it out with the SQL
// Formatter's own engine — same clause breaks, indentation and keyword case the
// user gets in that tool. It replaces a private chain of regex replacements that
// knew about nine keywords and applied them blindly, so ` FROM ` inside a string
// literal was broken onto a new line too.
// Shared by the SQL tab, Copy, Copy for EXPLAIN and Compare, so all four agree.
function lqeBuildRunnableSql(q) {
  let runnableSql = q.sql;
  if (q.params && q.params.length > 0) {
    let paramIndex = 0;
    runnableSql = runnableSql.replace(/\?/g, function() {
      if (paramIndex < q.params.length) {
        let val = q.params[paramIndex++];
        if (val === 'true' || val === 'false' || val === 'null' || (!isNaN(Number(val)) && val.trim() !== '')) {
           return val;
        } else {
           return "'" + val.replace(/'/g, "''") + "'";
        }
      }
      return '?';
    });
  }

  return window.prettifySQL(runnableSql);
}


// Converts a PostgreSQL JSON plan node into the text EXPLAIN format
// understood by the Query Intelligence Explain visualizer.
function lqePlanNodeToText(node, depth) {
  const indent = '  '.repeat(depth);
  const arrow = depth > 0 ? '->  ' : '';
  let head = node['Node Type'] || 'Node';
  if (node['Relation Name']) head += ' on ' + node['Relation Name'];
  if (node['Index Name']) head += ' using ' + node['Index Name'];
  let metrics = '';
  if (node['Startup Cost'] !== undefined) {
    metrics += 'cost=' + node['Startup Cost'] + '..' + node['Total Cost'] + ' rows=' + (node['Plan Rows'] !== undefined ? node['Plan Rows'] : '?');
  }
  if (node['Actual Total Time'] !== undefined) {
    metrics += (metrics ? ' ' : '') + 'actual time=' + node['Actual Startup Time'] + '..' + node['Actual Total Time'] + ' rows=' + (node['Actual Rows'] !== undefined ? node['Actual Rows'] : '?');
  }
  let text = indent + arrow + head + (metrics ? '  (' + metrics + ')' : '') + '\n';
  if (node.Filter) text += indent + '      Filter: (' + node.Filter + ')\n';
  if (node['Index Cond']) text += indent + '      Index Cond: (' + node['Index Cond'] + ')\n';
  if (node['Sort Key']) text += indent + '      Sort Key: ' + [].concat(node['Sort Key']).join(', ') + '\n';
  (node.Plans || []).forEach(child => { text += lqePlanNodeToText(child, depth + 1); });
  return text;
}


// ── Export of the currently filtered list ──────────────────
// Columns: Type, Tx-Conn, Timestamp, Duration, Cost, Rows, Dup, SQL (truncated)
// Statements are a different shape from executions, so the export follows the
// active view instead of forcing an aggregate into the execution columns —
// the same rule the Microflow Tracer applies to its background-run view.
function lqeStmtExportRows(groups, sqlMaxLen) {
  return groups.map(g => {
    let sql = g.sample.sql.replace(/\s+/g, ' ').trim();
    if (sql.length > sqlMaxLen) sql = sql.substring(0, sqlMaxLen) + '…';
    return [
      g.count,
      g.sumMs === null ? '' : +g.sumMs.toFixed(3),
      g.avgMs === null ? '' : +g.avgMs.toFixed(3),
      g.maxMs === null ? '' : +g.maxMs.toFixed(3),
      g.timedCount,
      g.slowCount || '',
      sql
    ];
  });
}

function lqeExportRows(sqlMaxLen) {
  if (lqeView === 'stmt') return lqeStmtExportRows(lqeLastStatements, sqlMaxLen);
  return lqeLastFiltered.map(q => {
    let sql = q.sql.replace(/\s+/g, ' ').trim();
    if (sql.length > sqlMaxLen) sql = sql.substring(0, sqlMaxLen) + '…';
    return [
      q.type + (q.slowWarning ? ' (SLOW warning)' : ''),
      q.txConn,
      q.timestamp,
      q.duration ? parseFloat(q.duration) : '',
      (q.cost !== null && q.cost !== undefined) ? q.cost : '',
      q.rows !== '-' ? q.rows : '',
      q.dupCount > 1 ? '×' + q.dupCount : '',
      sql
    ];
  });
}

const LQE_EXPORT_HEADER = ['Type', 'Tx-Conn', 'Timestamp', 'Duration (ms)', 'Cost', 'Rows', 'Dup', 'SQL'];
// "Timed" is carried into the export on purpose: a total summed from 3 of 400
// executions is a different number from one summed from all 400, and outside the
// UI there is no tooltip to say so.
const LQE_STMT_EXPORT_HEADER = ['Executions', 'Total (ms)', 'Avg (ms)', 'Max (ms)', 'Timed', 'Slow warnings', 'SQL'];

function lqeExportHeader() { return lqeView === 'stmt' ? LQE_STMT_EXPORT_HEADER : LQE_EXPORT_HEADER; }

// Exports go through the shared helper (window.mtExport) so quoting/escaping and
// the self-contained HTML template live in one place across tools.

function lqeFmtMs(ms) {
  if (ms >= 10000) return (ms / 1000).toFixed(1) + ' s';
  if (ms >= 100) return Math.round(ms) + ' ms';
  return ms.toFixed(2) + ' ms';
}

  root.LQE_SLOW_QUERY = LQE_SLOW_QUERY;
  root.lqeSqlType = lqeSqlType;
  root.lqeExtractQueries = lqeExtractQueries;
  root.lqeAggregateByStatement = lqeAggregateByStatement;
  root.splitParams = splitParams;
  root.lqeTableOf = lqeTableOf;
  root.lqeSmartLabel = lqeSmartLabel;
  root.lqeDurationColor = lqeDurationColor;
  root.lqeBuildRunnableSql = lqeBuildRunnableSql;
  root.lqePlanNodeToText = lqePlanNodeToText;
  root.lqeStmtExportRows = lqeStmtExportRows;
  root.LQE_EXPORT_HEADER = LQE_EXPORT_HEADER;
  root.LQE_STMT_EXPORT_HEADER = LQE_STMT_EXPORT_HEADER;
  root.lqeFmtMs = lqeFmtMs;
})(typeof window !== 'undefined' ? window : self);
