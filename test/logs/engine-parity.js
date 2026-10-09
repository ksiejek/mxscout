// Log analysis engine — parity tests.
//
// These are the assertions from MxDevSwissTool's scripts/parser-test.js (MIT, Copyright (c) 2026 Mikołaj,
// https://github.com/RealMecowhy/MxDevSwissTool) for every part of the log analysis that MxScout carries
// over, pointed at the files in public/logs/engine/ instead of the originals. They are what says "this
// reads a log the way the original does" — if one of them fails, the port has drifted.
//
// Plain Node, no browser: the engine files attach to `self`, so it is pointed at the global first.
// Run directly:  node test/logs/engine-parity.js
//
// What the original asserts about code MxScout does not carry is not repeated here: the decoder's
// tool-button label map (its UI half), the Log Viewer's DOM-bound functions, and — since 2026-10-09, when
// the log section was cut down to the stream, Insights and slow queries — the Microflow Tracer, the Query
// Extractor, the REST & WS Extractor, the Nginx analyzer, the Anonymizer, the export builders and the Data Hub.

const fs = require('fs');
const path = require('path');
const ENGINE = path.join(__dirname, '..', '..', 'public', 'logs', 'engine') + path.sep;

global.self = global;
global.escHtml = global.escHtml || function (s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};
// The original's highlighter returned an HTML string; MxScout builds the spans from tokens. Its own tests are
// kept by rendering the tokens to that same string here (test-only — nothing in the app parses markup).
global.fvTokensToHtml = function (tokens) {
  let out = '';
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k];
    if (tk.t === 'ws') { out += global.escHtml(tk.v); continue; }
    const g = (tk.g != null) ? ' data-g="' + tk.g + '"' : '';
    out += '<span class="ftok fk-' + tk.t + '"' + g + '>' + global.escHtml(tk.v) + '</span>';
  }
  return out;
};
global.sqlHighlight = function (sql) { return global.fvTokensToHtml(global.sqlHighlightTokens(sql)); };

// Unit tests for the shared Mendix log parser (public/js/tools/mendix-log-parser.js).
//
// Runs in plain Node: the module attaches createMendixLogParser to `self`, so we point
// `self` at the global before requiring it. No browser, no build step.
//
// Covers the wave-2 completion criterion "identyczny wynik parsowania na dotychczasowych
// plikach referencyjnych": the new single-pass CSV state machine is compared, record for
// record, against the historical two-pass algorithm (reproduced verbatim below) on both
// synthetic inputs and — when present locally — the real reference export.


require(ENGINE + 'parser.js');
const parser = global.createMendixLogParser();

let passed = 0;
let failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')); }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

// ── Historical two-pass CSV algorithm (the pre-wave-2 LQE code) ──────────────
function oldParseCSVRow(row) {
  const fields = [];
  let i = 0;
  while (i < row.length) {
    if (row[i] === '"') {
      let field = '';
      i++;
      while (i < row.length) {
        if (row[i] === '"' && i + 1 < row.length && row[i + 1] === '"') { field += '"'; i += 2; }
        else if (row[i] === '"') { i++; break; }
        else { field += row[i]; i++; }
      }
      fields.push(field);
      if (i < row.length && row[i] === ',') i++;
    } else {
      let end = row.indexOf(',', i);
      if (end === -1) end = row.length;
      fields.push(row.substring(i, end));
      i = end + 1;
    }
  }
  return fields;
}
function oldParse(text) {
  const rawLines = text.split('\n');
  const csvRows = [];
  let currentLine = '';
  let insideQuotes = false;
  let skipped = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].replace(/\r$/, '');
    currentLine += (currentLine ? '\n' : '') + line;
    let quoteCount = 0;
    for (let j = 0; j < line.length; j++) if (line[j] === '"') quoteCount++;
    if (quoteCount % 2 !== 0) insideQuotes = !insideQuotes;
    if (!insideQuotes) { csvRows.push(currentLine); currentLine = ''; }
  }
  if (currentLine) csvRows.push(currentLine);
  const records = [];
  for (const row of csvRows) {
    if (row.startsWith('Type,TimeStamp,LogNode,Message')) continue;
    const fields = oldParseCSVRow(row);
    if (fields.length < 4) { if (row.trim()) skipped++; continue; }
    records.push({ timestamp: fields[1], logNode: fields[2], message: fields[3] });
  }
  return { records, skipped };
}

// Compare only the fields LQE's extraction consumes, trimmed on both sides.
function normRec(r) { return { timestamp: (r.timestamp || '').trim(), logNode: (r.logNode || '').trim(), message: r.message || '' }; }
function assertEquivalent(name, text) {
  const oldR = oldParse(text);
  const neu = parser.parse(text);
  const a = oldR.records.map(normRec);
  const b = neu.records.map(normRec);
  let same = a.length === b.length && oldR.skipped === neu.skipped;
  if (same) for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) { same = false; break; }
  }
  ok(name, same, 'old={records:' + a.length + ',skipped:' + oldR.skipped + '} new={records:' + b.length + ',skipped:' + neu.skipped + '}');
}

// ── CSV: format detection ───────────────────────────────────────────────────
console.log('\nFormat detection');
eq('CSV header → csv', parser.parse('Type,TimeStamp,LogNode,Message\nTrace,t,N,m').format, 'csv');
eq('cloud line → live', parser.parse('2026-07-14T00:00:01.4 [runtime-container/x]  INFO - Core: hi').format, 'live');
eq('empty → csv (default)', parser.parse('').format, 'csv');

// ── CSV: single-pass state machine ──────────────────────────────────────────
console.log('\nCSV parsing');
const csvMultiline = 'Type,TimeStamp,LogNode,Message\n' +
  'Trace,2026-07-15 10:00:00.100,ConnectionBus_Retrieve,"SELECT ""a$b"".""id""\nFROM ""a$b"" WHERE x = ?"\n' +
  'Trace,2026-07-15 10:00:00.200,DataStorage_QueryPlan,"[{""Plan"":{""Node Type"":""Seq Scan""}}]"';
let r = parser.parse(csvMultiline);
eq('two records parsed', r.records.length, 2);
ok('multiline quoted field preserved', r.records[0].message.indexOf('\nFROM') !== -1, JSON.stringify(r.records[0].message));
ok('escaped quotes unescaped', r.records[0].message.indexOf('"a$b"."id"') !== -1, JSON.stringify(r.records[0].message));
eq('logNode captured', r.records[1].logNode, 'DataStorage_QueryPlan');

const csvSkip = 'Type,TimeStamp,LogNode,Message\n' +
  'Trace,2026-07-15 10:00:00.100,Core,"ok"\n' +
  'this row is broken\n' +
  '\n' +
  'Info,2026-07-15 10:00:01.000,Core,"fine"';
r = parser.parse(csvSkip);
eq('valid records kept', r.records.length, 2);
eq('malformed row counted, blank ignored', r.skipped, 1);

const csvNodes = 'Type,TimeStamp,LogNode,Message\n' +
  'Trace,t1,NodeA,"m1"\nDebug,t2,NodeB,"m2"\nWarning,t3,NodeC,"m3"';
r = parser.parse(csvNodes);
eq('multiple nodes: 3 records', r.records.length, 3);
ok('distinct nodes', r.records[0].logNode === 'NodeA' && r.records[2].logNode === 'NodeC');

// ── CSV: equivalence old vs new ─────────────────────────────────────────────
console.log('\nCSV equivalence (old two-pass vs new single-pass)');
assertEquivalent('multiline + escaped quotes', csvMultiline);
assertEquivalent('malformed + blank rows', csvSkip);
assertEquivalent('multiple nodes', csvNodes);
assertEquivalent('CRLF line endings', csvNodes.replace(/\n/g, '\r\n'));
assertEquivalent('trailing newline', csvNodes + '\n');
assertEquivalent('embedded commas in quotes',
  'Type,TimeStamp,LogNode,Message\nTrace,t,Core,"a, b, c",extra-cause');

// ── Live log parsing ────────────────────────────────────────────────────────
console.log('\nLive log parsing');
const live =
  '2026-07-14T00:00:01.4 [runtime-container/x]  INFO - Email: hi\n' +
  '2026-07-14T00:06:27.1 [runtime-container/x]  WARNING - ConnectionBus_Queries: Query executed in 3 seconds and 171 milliseconds: SELECT "t"."id" FROM "t"\n' +
  ' INNER JOIN "u" ON 1=1 WHERE "u"."x" = 5\n' +
  '2026-07-14T00:08:00.0 [runtime-container/x]  ERROR - M2EE: boom\n' +
  '\tat com.mendix.Foo.run(Foo.java:42)\n' +
  'Caused by: java.io.EOFException\n' +
  '2026-07-14T00:09:00.0 [runtime-container/x]  DEBUG - ConnectionBus_Retrieve: SQL@abc123(T1-Cff0001): SELECT "t"."id" FROM "t" WHERE "t"."id" = ?';
r = parser.parse(live);
eq('live format detected', r.format, 'live');
eq('4 log records', r.records.length, 4);
const slow = r.records[1];
ok('slow-query logNode', slow.logNode === 'ConnectionBus_Queries');
ok('slow-query SQL continuation appended', slow.message.indexOf('INNER JOIN') !== -1, JSON.stringify(slow.message));
const m2ee = r.records[2];
ok('stack-trace continuation appended', m2ee.message.indexOf('at com.mendix.Foo') !== -1 && m2ee.message.indexOf('Caused by') !== -1);
ok('SQL@ line captured under ConnectionBus_Retrieve', r.records[3].message.indexOf('SQL@abc123') === 0);
const preamble = parser.parse('garbage before any log line\n' + live);
eq('preamble line counted as skipped', preamble.skipped, 1);

// Foreign log lines (opensaml/AWS SDK/Xerces writing to stdout without the Mendix prefix).
// Measured on the real corpus: 6 of 10 apps carry them, and in myOrder they contaminated
// ~19% of all records — including 130 of 556 extracted queries, whose "runnable SQL" ended
// with `ORDER BY … ASC [JettyServer-14065] INFO org.opensaml…`.
const foreign =
  '2026-08-11T02:06:59.5 [runtime-container/x]  WARNING - ConnectionBus_Queries: Query executed in 10 seconds and 259 milliseconds: SELECT "t"."id" FROM "t" ORDER BY "t"."id" ASC\n' +
  '[JettyServer-13962] INFO org.opensaml.xmlsec.algorithm.AlgorithmSupport - Mapping from algorithm URI http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p to key length not available\n' +
  'WARNING: Supplied DOM uses namespaces, but is not created as namespace-aware\n' +
  '2026-08-11T02:06:59.6 [runtime-container/x]  ERROR - Connector: 404 - file not found';
r = parser.parse(foreign);
eq('foreign lines become their own records', r.records.length, 4);
ok('slow-query SQL stops at the statement',
  r.records[0].message.indexOf('JettyServer') === -1 && r.records[0].message.indexOf('opensaml') === -1,
  JSON.stringify(r.records[0].message));
eq('foreign slf4j logNode is the logger', r.records[1].logNode, 'org.opensaml.xmlsec.algorithm.AlgorithmSupport');
eq('foreign slf4j level', r.records[1].level, 'INFO');
ok('foreign slf4j keeps the thread name', r.records[1].message.indexOf('[JettyServer-13962]') === 0);
eq('foreign line inherits the interrupted record timestamp', r.records[1].timestamp, '2026-08-11T02:06:59.5');
eq('foreign JUL logNode', r.records[2].logNode, 'External');
eq('foreign JUL level is normalized', r.records[2].level, 'WARN');
eq('the Mendix record after them is unaffected', r.records[3].logNode, 'Connector');
// A PostgreSQL detail line inside a stack trace also starts with a level word — it stays a
// continuation, which is why ERROR/WARN/FATAL are absent from the JUL ladder.
const pgDetail = parser.parse(
  '2026-08-11T02:00:00.0 [runtime-container/x]  ERROR - M2EE: boom\n' +
  '\tat com.mendix.Foo.run(Foo.java:42)\n' +
  'ERROR: relation "shipments$order" does not exist');
eq('a PostgreSQL ERROR: detail line is not split off', pgDetail.records.length, 1);
ok('…and stays on the record it belongs to',
  pgDetail.records[0].message.indexOf('relation "shipments$order"') !== -1);

// ── Grafana exports ─────────────────────────────────────────────────────────
// A colleague's Grafana export rendered as ONE entry with 1581 "stack frames": every
// pattern in both parsers is anchored on a timestamp at the start of the line, and a
// Grafana row starts with Grafana's own columns instead.
//
// The fixtures below are built from Grafana's own source, not from a guess:
//   TXT  — inspector/utils/download.ts, downloadLogsModelAsTxt():
//          `row.timeEpochMs + '\t' + dateTime(row.timeEpochMs).toISOString() + '\t' + entry`
//          preceded by one line per meta item when the query reports any.
//   JSON — logs/utils.ts, logRowsToReadableJson(): { line, timestamp (epoch ns), date, fields }
//   CSV  — logs/utils.ts, DownloadFormat.CSV: the data frame with an ISO `Date` column
//          prepended and the labels columns dropped (Loki emits Date,Time,Line,tsNs,id).
console.log('\nGrafana exports');
const gTxt =
  'Total bytes processed: "1.2 GB"\n' +
  '\n\n' +
  '1787755857348\t2026-08-26T14:50:57.348Z\tINFO: MENDIX-LOGGING-HEARTBEAT: Heartbeat number 7\n' +
  '1787755556653\t2026-08-26T14:45:56.653Z\tWARNING - TaskQueue: Found 2 duplicated scheduled events \'CleanUp\'\n' +
  '1787755256937\t2026-08-26T14:40:56.937Z\tERROR - Connector: An error occurred while executing an action\n' +
  '1787755256938\t2026-08-26T14:40:56.938Z\tcom.mendix.systemwideinterfaces.MendixRuntimeException: boom\n' +
  '1787755256939\t2026-08-26T14:40:56.939Z\t\tat com.mendix.core.Core.execute(Core.java:12)\n' +
  '1787755256940\t2026-08-26T14:40:56.940Z\tCaused by: java.io.EOFException';
r = parser.parse(gTxt);
eq('grafana-txt detected', r.format, 'grafana-txt');
eq('one record per row, stack frames folded in', r.records.length, 3);
eq('meta preamble counted as skipped', r.skipped, 1);
eq('timestamp comes from the ISO column', r.records[0].timestamp, '2026-08-26T14:50:57.348Z');
eq('java.util.logging body: level', r.records[0].level, 'INFO');
eq('java.util.logging body: node', r.records[0].logNode, 'MENDIX-LOGGING-HEARTBEAT');
eq('java.util.logging body: message', r.records[0].message, 'Heartbeat number 7');
eq('Mendix body: level normalized', r.records[1].level, 'WARN');
eq('Mendix body: node', r.records[1].logNode, 'TaskQueue');
eq('Mendix body: message', r.records[1].message, 'Found 2 duplicated scheduled events \'CleanUp\'');
ok('a stack trace split across rows lands on its own record',
  r.records[2].message.indexOf('MendixRuntimeException') !== -1 &&
  r.records[2].message.indexOf('at com.mendix.core.Core') !== -1 &&
  r.records[2].message.indexOf('Caused by') !== -1, JSON.stringify(r.records[2].message));
eq('…and does not become extra records', r.records[2].logNode, 'Connector');

// An ordinary message with a colon in it must not be mistaken for a log node.
r = parser.parse('1787755857348\t2026-08-26T14:50:57.348Z\tERROR - Core: Could not connect: timeout after 30s');
eq('node stops at the first token', r.records[0].logNode, 'Core');
eq('the rest of the colons stay in the message', r.records[0].message, 'Could not connect: timeout after 30s');
r = parser.parse('1787755857348\t2026-08-26T14:50:57.348Z\tSomething broke: no level here');
eq('a body with no level gets no invented node', r.records[0].logNode, 'Runtime');
eq('…and keeps the whole text', r.records[0].message, 'Something broke: no level here');

// Some collectors ship the raw line untouched; then the body is a complete Mendix line.
r = parser.parse('1787755857348\t2026-08-26T14:50:57.348Z\t' +
  '2026-08-26T14:50:57.348 [runtime-container/x]  WARNING - ConnectionBus_Queries: Query executed in 300 milliseconds: SELECT 1');
eq('an unstripped Mendix prefix in the body still wins', r.records[0].logNode, 'ConnectionBus_Queries');
ok('…and the SQL survives', r.records[0].message.indexOf('SELECT 1') !== -1);

const gJson = JSON.stringify([
  { line: 'WARNING - TaskQueue: Found 2 duplicated scheduled events', timestamp: '1787755556653000000',
    date: '2026-08-26T14:45:56.653Z', fields: { app: 'myapp' } },
  { line: 'ERROR - Connector: boom', timestamp: '1787755256937000000', fields: { detected_level: 'error' } }
]);
r = parser.parse(gJson);
eq('grafana-json detected', r.format, 'grafana-json');
eq('json rows become records', r.records.length, 2);
eq('json uses the date field', r.records[0].timestamp, '2026-08-26T14:45:56.653Z');
eq('json falls back to epoch nanoseconds', r.records[1].timestamp, '2026-08-26T14:40:56.937Z');
eq('json node', r.records[1].logNode, 'Connector');

// The regression this closes: read positionally as a Studio Pro export, the Loki CSV put
// the entire log line in the LogNode column, the nanosecond count in Message, and the
// labels JSON in Type — and reported three clean records while doing it.
const gCsv =
  '"Date","Time","Line","tsNs","id"\n' +
  '"2026-08-26T14:50:57.348Z","2026-08-26 14:50:57.348","INFO: MENDIX-LOGGING-HEARTBEAT: Heartbeat number 7","1787755857348000000","17ab3c-1"\n' +
  '"2026-08-26T14:45:56.653Z","2026-08-26 14:45:56.653","WARNING - TaskQueue: Found 2 duplicated, quoted ""events""","1787755556653000000","17ab3c-2"';
r = parser.parse(gCsv);
eq('grafana-csv detected', r.format, 'grafana-csv');
eq('csv rows become records', r.records.length, 2);
eq('columns are mapped by name, not position', r.records[1].logNode, 'TaskQueue');
eq('…so the message is the message', r.records[1].message, 'Found 2 duplicated, quoted "events"');
eq('…and the level is a level', r.records[1].level, 'WARN');
eq('…and the time column is the timestamp', r.records[0].timestamp, '2026-08-26T14:50:57.348Z');
// Dataplane column names (severity carries the level when the body does not).
r = parser.parse('timestamp,body,severity\n2026-08-26T14:50:57.348Z,Application started,info');
eq('dataplane columns detected', r.format, 'grafana-csv');
eq('dataplane severity fills the level', r.records[0].level, 'INFO');
eq('dataplane body is the message', r.records[0].message, 'Application started');

// The Studio Pro export must keep winning its own header — it has a Message column, not a
// Line/body one, so the Grafana header check cannot claim it.
eq('Studio Pro CSV is still detected as csv',
  parser.detectFormat('Type,TimeStamp,LogNode,Message\nINFO,07/11/2026 21:21:29,Core,hi'), 'csv');

// ── Reference files (local only; skipped on a clean checkout) ────────────────
console.log('\nReference files (local only)');
function firstExisting(candidates) {
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}
const la = path.join(__dirname, '..', '_local_assets');
const refCsv = firstExisting([
  path.join(la, 'Console export 2026-07-11_21-30-52.csv'),
  path.join(la, 'FilesForTest', 'Console export 2026-07-11_21-30-52.csv')
]);
if (refCsv) {
  const text = fs.readFileSync(refCsv, 'utf8');
  const oldR = oldParse(text);
  const neu = parser.parse(text);
  eq('reference CSV: format', neu.format, 'csv');
  ok('reference CSV: record count matches old', oldR.records.length === neu.records.length,
    'old=' + oldR.records.length + ' new=' + neu.records.length);
  assertEquivalent('reference CSV: record-for-record equivalence', text);
} else {
  console.log('  – reference CSV absent, skipped (repo hygiene: not committed)');
}
const refLive = path.join(__dirname, '..', '_local_assets', 'FilesForTest',
  'logs_8d888530-51c3-4167-94f7-2d4c9a1b887e_2026-07-14.txt');
if (fs.existsSync(refLive)) {
  const text = fs.readFileSync(refLive, 'utf8');
  const t0 = Date.now();
  const neu = parser.parse(text);
  const ms = Date.now() - t0;
  eq('reference live: format', neu.format, 'live');
  const slowCount = neu.records.filter(function (x) { return x.logNode === 'ConnectionBus_Queries' && /^Query executed in/.test(x.message); }).length;
  ok('reference live: 1181 slow-query warnings found', slowCount === 1181, 'got ' + slowCount);
  console.log('    (' + (text.length / (1024 * 1024)).toFixed(0) + ' MB → ' + neu.records.length + ' records in ' + ms + ' ms)');
} else {
  console.log('  – reference live log absent, skipped (PII: never committed)');
}

// ── Timestamps (parser.js: mtTsToMs) ─────────────────────────────────────────
// In the original these head the Microflow Tracer's tests, which MxScout no longer carries (the tracer
// was taken out on 2026-10-09). The helper is the parser's and the stream's chart reads it, so they stay.
console.log('\nTimestamps');
global.window = global;
const mftTs = global.mtTsToMs;

ok('mtTsToMs parses live ISO with microseconds',
  Math.abs(mftTs('2026-07-17T10:00:00.500250') - mftTs('2026-07-17T10:00:00.000000') - 500.25) < 0.001);
ok('mtTsToMs parses the Studio Pro CSV timestamp, day first as the parser emits it',
  mftTs('11/07/2026 21:21:30') - mftTs('11/07/2026 21:21:29') === 1000);
eq('mtTsToMs reads 27/09/2026 as 27 September, not month 27',
  new Date(mftTs('27/09/2026 20:43:59')).toISOString(), '2026-09-27T20:43:59.000Z');
// Regression: the Nginx analyzer resolves its own access-log date and passes an
// epoch Number to lqeSetTimeWindow, whose filter routes both bounds through this
// helper. Before the type guard that hit `.match` on a Number and threw, which
// killed the "SQL in window" cross-link after the chip had already been drawn.
ok('mtTsToMs passes an epoch Number through unchanged (Nginx cross-link)',
  mftTs(1784268324436) === 1784268324436);
ok('mtTsToMs rejects a non-finite Number instead of throwing',
  isNaN(mftTs(NaN)) && isNaN(mftTs(Infinity)));

// The log-node prefix the fixtures below share (defined with the tracer's fixtures in the original).
const P = '[runtime-container/x]';

// ── Log Insights aggregation (public/js/tools/log-viewer.js) ─────────────────
// log-viewer.js is imported by core.js as an ES module (it carries `export
// function init()`), so unlike the other tools it can't be require()d as-is.
// Strip the `export ` keyword and compile the rest in a CommonJS wrapper — the
// pure logExtractInsights + helpers attach to window (pointed at global above).
// The extractor honors the data-driven rule: only categories that occur produce
// a card, and a clean INFO-level log yields zero categories.
console.log('\nLog Insights aggregation');
require(ENGINE + 'insights.js');
const logInsights = global.logExtractInsights;

const insLog = [
  // Access denied — same microflow denied to two users, a third microflow to one
  '2026-07-18T09:00:00.000000 ' + P + '  WARNING - WebUI: User \'a@ex.com\' attempted to execute runtime operation \'OP1\' (microflow call \'Mod.ACT_Secret\') but does not have the required permission.',
  '2026-07-18T09:00:01.000000 ' + P + '  WARNING - WebUI: User \'b@ex.com\' attempted to execute runtime operation \'OP1\' (microflow call \'Mod.ACT_Secret\') but does not have the required permission.',
  '2026-07-18T09:00:02.000000 ' + P + '  WARNING - WebUI: User \'a@ex.com\' attempted to execute runtime operation \'OP9\' (microflow call \'Mod.ACT_Other\') but does not have the required permission.',
  // Missing parameters (WebUI, different problem)
  '2026-07-18T09:00:03.000000 ' + P + '  WARNING - WebUI: The runtime operation \'OP2\' is missing parameters: [CurrentObject]. This might lead to an unresolvable XPath.',
  // Session state bloat — two requests, peak 450
  '2026-07-18T09:00:04.000000 ' + P + '  WARNING - RequestStatistics: Request state size of 315 objects exceeds the threshold of 300 objects.',
  '2026-07-18T09:00:05.000000 ' + P + '  WARNING - RequestStatistics: Request state size of 450 objects exceeds the threshold of 300 objects.',
  // TaskQueue retry loop — MDM.UPD_UserData fails 6× from one queue, plus one other task
  '2026-07-18T09:00:06.000000 ' + P + '   ERROR - TaskQueue: Failed to execute task \'MDM.UPD_UserData(Account=X@1)\' from task queue \'Queues.Schedule\'.',
  '2026-07-18T09:00:07.000000 ' + P + '   ERROR - TaskQueue: Failed to execute task \'MDM.UPD_UserData(Account=X@1)\' from task queue \'Queues.Schedule\'.',
  '2026-07-18T09:00:08.000000 ' + P + '   ERROR - TaskQueue: Failed to execute task \'MDM.UPD_UserData(Account=X@1)\' from task queue \'Queues.Schedule\'.',
  '2026-07-18T09:00:09.000000 ' + P + '   ERROR - TaskQueue: Failed to execute task \'MDM.UPD_UserData(Account=X@1)\' from task queue \'Queues.Schedule\'.',
  '2026-07-18T09:00:10.000000 ' + P + '   ERROR - TaskQueue: Failed to execute task \'MDM.UPD_UserData(Account=X@1)\' from task queue \'Queues.Schedule\'.',
  '2026-07-18T09:00:11.000000 ' + P + '   ERROR - TaskQueue: Failed to execute task \'MDM.UPD_UserData(Account=X@1)\' from task queue \'Queues.Schedule\'.',
  '2026-07-18T09:00:12.000000 ' + P + '   ERROR - TaskQueue: Failed to execute task \'Parking.SmsNotification(Id=9)\' from task queue \'Queues.Sms\'.',
  // Generic per-node error hotspot (SAML_SSO)
  '2026-07-18T09:00:13.000000 ' + P + '   ERROR - SAML_SSO: null',
  '2026-07-18T09:00:14.000000 ' + P + '   ERROR - SAML_SSO: null',
  '2026-07-18T09:00:15.000000 ' + P + '   ERROR - SAML_SSO: null',
  // Below-threshold warnings (Core ×2) must NOT surface as a hotspot by default
  '2026-07-18T09:00:16.000000 ' + P + '  WARNING - Core: minor thing happened',
  '2026-07-18T09:00:17.000000 ' + P + '  WARNING - Core: minor thing happened again',
  // Noise that must be ignored entirely
  '2026-07-18T09:00:18.000000 ' + P + '    INFO - Core: business as usual',
  '2026-07-18T09:00:19.000000 ' + P + '   DEBUG - MicroflowEngine: [1-1] Starting execution of microflow \'Mod.Flow\''
].join('\n');

const insRecs = parser.parse(insLog).records;
const ins = logInsights(insRecs);
const catBy = {};
ins.categories.forEach(function (c) { catBy[c.key] = c; });

eq('insights: stats count errors', ins.stats.errors, 10);
// 3 perm-denied + 1 missing-params + 2 session-bloat + 2 sub-threshold Core = 8
eq('insights: stats count warnings', ins.stats.warnings, 8);

// Access denied
ok('insights: perm-denied category present', !!catBy['perm-denied']);
eq('perm-denied: total count', catBy['perm-denied'].count, 3);
eq('perm-denied: 2 microflows in breakdown', catBy['perm-denied'].items.length, 2);
eq('perm-denied: top microflow is ACT_Secret ×2', catBy['perm-denied'].items[0].label, 'Mod.ACT_Secret');
eq('perm-denied: top microflow count', catBy['perm-denied'].items[0].count, 2);
ok('perm-denied: subtitle names 2 users', /2 user/.test(catBy['perm-denied'].subtitle), catBy['perm-denied'].subtitle);
eq('perm-denied: item filter searches microflow', catBy['perm-denied'].items[0].filter.search, 'Mod.ACT_Secret');

// Missing params is a distinct category (not folded into perm-denied)
ok('insights: missing-params category present', !!catBy['missing-params']);
eq('missing-params: count', catBy['missing-params'].count, 1);

// Session bloat — peak size reported
ok('insights: session-bloat category present', !!catBy['session-bloat']);
eq('session-bloat: count', catBy['session-bloat'].count, 2);
ok('session-bloat: subtitle reports peak 450', /peak 450/.test(catBy['session-bloat'].subtitle), catBy['session-bloat'].subtitle);

// TaskQueue failures — retry loop surfaced
ok('insights: taskqueue-fail category present', !!catBy['taskqueue-fail']);
eq('taskqueue-fail: total failures', catBy['taskqueue-fail'].count, 7);
eq('taskqueue-fail: severity error', catBy['taskqueue-fail'].severity, 'error');
ok('taskqueue-fail: retry loop noted in subtitle', /retry-loop/.test(catBy['taskqueue-fail'].subtitle), catBy['taskqueue-fail'].subtitle);
eq('taskqueue-fail: top task is MDM.UPD_UserData', catBy['taskqueue-fail'].items[0].filter.search, 'MDM.UPD_UserData');
eq('taskqueue-fail: top task count', catBy['taskqueue-fail'].items[0].count, 6);

// Generic per-node hotspot
ok('insights: SAML_SSO error hotspot present', !!catBy['node-error-SAML_SSO']);
eq('SAML_SSO hotspot count', catBy['node-error-SAML_SSO'].count, 3);

// Below-threshold Core warnings must not produce a card by default...
ok('insights: sub-threshold Core warnings suppressed', !catBy['node-warning-Core']);
// ...but a lower threshold surfaces them (data-driven knob)
const insLow = logInsights(insRecs, { warnHotspotMin: 1 });
ok('insights: Core warnings appear at warnHotspotMin=1',
  insLow.categories.some(function (c) { return c.key === 'node-warning-Core' && c.count === 2; }));

// Sorting: error categories rank before warning categories
const firstWarnIdx = ins.categories.findIndex(function (c) { return c.severity === 'warning'; });
const lastErrIdx = ins.categories.map(function (c) { return c.severity; }).lastIndexOf('error');
ok('insights: all error cards sort before warning cards', lastErrIdx < firstWarnIdx, lastErrIdx + '/' + firstWarnIdx);

// ── Slow-query warnings + verbose nodes (wave 15) ────────────────────────────
// Two categories derived from data the tool already had. Their own fixture, so
// the counts asserted above stay untouched.
const insLog2 = [
  // Slow-query warnings: two executions of one statement (differing only in the
  // bound id, so they must group) plus a second statement.
  '2026-07-19T09:00:00.000000 ' + P + '  WARNING - ConnectionBus_Queries: Query executed in 4 seconds and 200 milliseconds: SELECT "sales$order"."id" FROM "sales$order" WHERE "id" = 42',
  '2026-07-19T09:00:01.000000 ' + P + '  WARNING - ConnectionBus_Queries: Query executed in 1100 milliseconds: SELECT "sales$order"."id" FROM "sales$order" WHERE "id" = 77',
  '2026-07-19T09:00:02.000000 ' + P + '  WARNING - ConnectionBus_Queries: Query executed in 900 milliseconds: SELECT "cust"."name" FROM "cust"',
  // A WARNING from the same node that is NOT a slow query must stay a warning,
  // not be swallowed by the slow-query card.
  '2026-07-19T09:00:03.000000 ' + P + '  WARNING - ConnectionBus_Queries: Connection pool is nearly exhausted'
]
  // A node left at TRACE: 30 entries, over the 25-entry floor.
  .concat(Array.from({ length: 30 }, (_, i) =>
    '2026-07-19T09:01:' + String(i % 60).padStart(2, '0') + '.000000 ' + P + '  TRACE - ConnectionBus_Retrieve: SQL@x' + i + '(T1-C1): SELECT 1'))
  // Incidental debug logging: 3 entries, below the floor — must not surface.
  .concat([
    '2026-07-19T09:02:00.000000 ' + P + '   DEBUG - Core: tick',
    '2026-07-19T09:02:01.000000 ' + P + '   DEBUG - Core: tick',
    '2026-07-19T09:02:02.000000 ' + P + '   DEBUG - Core: tick'
  ]).join('\n');

const ins2 = logInsights(parser.parse(insLog2).records);
const catBy2 = {};
ins2.categories.forEach(function (c) { catBy2[c.key] = c; });

ok('insights: slow-queries category present', !!catBy2['slow-queries']);
eq('slow-queries: counts every warning', catBy2['slow-queries'].count, 3);
eq('slow-queries: severity warning', catBy2['slow-queries'].severity, 'warning');
eq('slow-queries: two distinct statements', catBy2['slow-queries'].items.length, 2);
eq('slow-queries: the repeated statement ranks first', catBy2['slow-queries'].items[0].count, 2);
ok('slow-queries: worst duration reported in seconds', /worst 4\.2 s/.test(catBy2['slow-queries'].subtitle), catBy2['slow-queries'].subtitle);
ok('slow-queries: breakdown searches the raw statement, not the normalized label',
  catBy2['slow-queries'].items[0].filter.search.indexOf('SELECT "sales$order"') === 0,
  catBy2['slow-queries'].items[0].filter.search);
// The search has to match every execution the card counted, not just the first
// one logged — otherwise a card reading "2×" filters the stream down to one row.
ok('slow-queries: the search stops where the bound value varies',
  catBy2['slow-queries'].items[0].filter.search.indexOf('42') === -1 &&
  /WHERE "id" = $/.test(catBy2['slow-queries'].items[0].filter.search),
  catBy2['slow-queries'].items[0].filter.search);
eq('slow-queries: offers the Query Extractor cross-link', catBy2['slow-queries'].crossLink, 'log-query-extractor');

// The unrelated warning from the same node must survive as a generic hotspot —
// proving the slow-query card consumed only its own entries.
const ins2Low = logInsights(parser.parse(insLog2).records, { warnHotspotMin: 1 });
const genericCbq = ins2Low.categories.find(function (c) { return c.key === 'node-warning-ConnectionBus_Queries'; });
ok('slow-queries: the non-slow warning is left for the generic hotspot', !!genericCbq);
eq('slow-queries: exactly one warning left unconsumed', genericCbq && genericCbq.count, 1);

ok('insights: verbose-nodes category present', !!catBy2['verbose-nodes']);
eq('verbose-nodes: severity info (a fact, not a problem)', catBy2['verbose-nodes'].severity, 'info');
eq('verbose-nodes: counts only the nodes over the floor', catBy2['verbose-nodes'].count, 30);
eq('verbose-nodes: one qualifying node', catBy2['verbose-nodes'].items.length, 1);
ok('verbose-nodes: names the node and its share',
  /^ConnectionBus_Retrieve\b.*% of the log$/.test(catBy2['verbose-nodes'].items[0].label),
  catBy2['verbose-nodes'].items[0].label);
eq('verbose-nodes: breakdown filters to TRACE/DEBUG of that node', catBy2['verbose-nodes'].items[0].filter.levels, 'TRACE,DEBUG');
ok('verbose-nodes: incidental DEBUG stays below the floor',
  !catBy2['verbose-nodes'].items.some(function (it) { return /^Core\b/.test(it.label); }));

// ...and the floor is a knob, like warnHotspotMin
const ins2Verbose = logInsights(parser.parse(insLog2).records, { verboseMin: 1 });
const vb = ins2Verbose.categories.find(function (c) { return c.key === 'verbose-nodes'; });
eq('verbose-nodes: Core appears at verboseMin=1', vb.items.length, 2);
eq('verbose-nodes: count follows the lowered floor', vb.count, 33);

// Observations sort after problems, however many entries they count
eq('insights: the info card sorts last', ins2.categories[ins2.categories.length - 1].key, 'verbose-nodes');

// Data-driven rule: a clean INFO-level log yields no categories at all
const cleanLog = [
  '2026-07-18T10:00:00.000000 ' + P + '    INFO - Core: started',
  '2026-07-18T10:00:01.000000 ' + P + '    INFO - Jetty: listening',
  '2026-07-18T10:00:02.000000 ' + P + '   DEBUG - Core: tick'
].join('\n');
const cleanIns = logInsights(parser.parse(cleanLog).records);
eq('insights: clean INFO log → zero categories', cleanIns.categories.length, 0);
eq('insights: empty input → zero categories', logInsights([]).categories.length, 0);

// Reference: real INFO-level production log (local only, PII — never committed).
// This is the 14.07 log from the SE/Log-Insights analysis: it carries a genuine
// MDM.UPD_UserData retry loop, permission denials and request-state bloat.
const refInfo = path.join(__dirname, '..', '_local_assets', 'FilesForTest', 'logs_8d888530-51c3-4167-94f7-2d4c9a1b887e_2026-07-14.txt');
if (fs.existsSync(refInfo)) {
  const text = fs.readFileSync(refInfo, 'utf8');
  const recs4 = parser.parse(text).records;
  const t0 = Date.now();
  const out = logInsights(recs4);
  const ms = Date.now() - t0;
  const by = {};
  out.categories.forEach(function (c) { by[c.key] = c; });
  eq('reference INFO: TaskQueue failures = 118', by['taskqueue-fail'] && by['taskqueue-fail'].count, 118);
  eq('reference INFO: MDM.UPD_UserData is the top failing task', by['taskqueue-fail'].items[0].filter.search, 'MDM.UPD_UserData');
  eq('reference INFO: MDM.UPD_UserData failed 103×', by['taskqueue-fail'].items[0].count, 103);
  eq('reference INFO: permission denials = 14', by['perm-denied'] && by['perm-denied'].count, 14);
  eq('reference INFO: session-state bloat warnings = 5', by['session-bloat'] && by['session-bloat'].count, 5);
  eq('reference INFO: SAML_SSO error hotspot = 266', by['node-error-SAML_SSO'] && by['node-error-SAML_SSO'].count, 266);
  console.log('    (' + (text.length / (1024 * 1024)).toFixed(0) + ' MB → ' + out.stats.records + ' records, ' + out.categories.length + ' categories in ' + ms + ' ms)');
} else {
  console.log('  – reference INFO log absent, skipped (PII: never committed)');
}

// ── Correlation ID ranking (public/js/tools/log-viewer.js) ───────────────────
// logExtractCorrelations turns the loaded records into the discoverable ID list
// the Correlation Flow tab ranks. The trap it exists to avoid: a bare UUID match
// on the raw line, which on any log carrying SAML assertions picks up Azure
// tenant/object identifiers that are not correlation IDs at all.
console.log('\nCorrelation ID ranking');
const logCorr = global.logExtractCorrelations;

const corrLog = [
  // Client request (epochMs-counter) — microflow + the queries it triggered
  '2026-07-18T09:00:00.000000 ' + P + '   DEBUG - MicroflowEngine: [1784273164806-115] Starting execution of microflow \'Mod.ACT_Save\'',
  '2026-07-18T09:00:00.200000 ' + P + '   TRACE - OQL: [1784273164806-115] SELECT 1 FROM x',
  '2026-07-18T09:00:00.400000 ' + P + '   TRACE - Plan: [1784273164806-115] plan detail',
  '2026-07-18T09:00:02.000000 ' + P + '   DEBUG - MicroflowEngine: [1784273164806-115] Finished execution of microflow \'Mod.ACT_Save\'',
  // Scheduled event (UUID) — fewer records but it failed
  '2026-07-18T09:00:03.000000 ' + P + '   DEBUG - MicroflowEngine: [c0058190-9090-449e-9dde-cb253bf9826a] Starting execution of microflow \'Queues.FinishedWithErrors\'',
  '2026-07-18T09:00:04.000000 ' + P + '   ERROR - MicroflowEngine: [c0058190-9090-449e-9dde-cb253bf9826a] boom',
  // A SAML claim line: three UUIDs on the record, none of them a correlation ID
  '2026-07-18T09:00:05.000000 ' + P + '    INFO - SAML_SSO: claim tenantid:16d89ce6-c8fe-4ff6-a7b1-a8d9984c05ea objectidentifier:78e3a0e7-2a79-4356-9916-bd3134973c40',
  '2026-07-18T09:00:06.000000 ' + P + '    INFO - Core: no id here at all'
].join('\n');

const lvCorr = logCorr(parser.parse(corrLog).records);
eq('corr: only the runtime\'s bracketed marker counts as an ID', lvCorr.groups.length, 2);
eq('corr: records carrying an ID are counted, the rest are not', lvCorr.withId, 6);
eq('corr: the failing ID ranks first even though it has fewer records', lvCorr.groups[0].id, 'c0058190-9090-449e-9dde-cb253bf9826a');
eq('corr: errors are counted per ID', lvCorr.groups[0].errors, 1);
eq('corr: the microflow name labels the ID', lvCorr.groups[0].flow, 'Queues.FinishedWithErrors');
eq('corr: a client request keeps its epochMs-counter shape verbatim', lvCorr.groups[1].id, '1784273164806-115');
eq('corr: every record under one ID is grouped', lvCorr.groups[1].count, 4);
eq('corr: span is measured first → last', lvCorr.groups[1].spanMs, 2000);
ok('corr: one ID stitches the microflow to the queries it triggered',
  ['MicroflowEngine', 'OQL', 'Plan'].every(function (n) { return lvCorr.groups[1].nodes.indexOf(n) !== -1; }));
ok('corr: a SAML claim UUID is never listed as a correlation ID',
  lvCorr.groups.every(function (g) { return g.id.indexOf('16d89ce6') === -1 && g.id.indexOf('78e3a0e7') === -1; }));

// A production log at INFO carries no correlation IDs at all — the tab has to be
// able to say so rather than render an empty list with no explanation.
const corrNone = logCorr(parser.parse([
  '2026-07-18T09:00:00.000000 ' + P + '    INFO - Core: business as usual',
  '2026-07-18T09:00:01.000000 ' + P + '   ERROR - SAML_SSO: null'
].join('\n')).records);
eq('corr: INFO-level log yields no IDs', corrNone.groups.length, 0);
eq('corr: …and reports how much was scanned so the empty state can explain itself', corrNone.scanned, 2);
eq('corr: nothing loaded is not an error', logCorr([]).groups.length, 0);

// Timestamps are not guaranteed monotonic (multi-file load), and a log with no
// parseable stamp must report no span rather than a fabricated 0 ms.
const corrUnordered = logCorr([
  { ts: '2026-07-18T09:00:09.000000', level: 'INFO', node: 'A', msg: '[req-9001] late' },
  { ts: '2026-07-18T09:00:01.000000', level: 'INFO', node: 'A', msg: '[req-9001] early' }
]);
eq('corr: span is min→max, not first→last in file order', corrUnordered.groups[0].spanMs, 8000);
eq('corr: firstTs follows the earliest stamp, not the first row', corrUnordered.groups[0].firstTs, '2026-07-18T09:00:01.000000');
eq('corr: a group with no parseable timestamp reports no span at all',
  logCorr([{ ts: '', level: 'INFO', node: 'A', msg: '[req-9002] a' }, { ts: '', level: 'INFO', node: 'A', msg: '[req-9002] b' }]).groups[0].spanMs, null);

// ── Gantt time axis (public/js/tools/log-viewer.js) ──────────────────────────
// logGanttAxis resolves entries onto one monotonic epoch axis. It used to anchor
// every entry to a fixed 1970-01-01 from an HH:MM:SS match, which threw the date
// away: a log crossing midnight sorted backwards and the chart bailed out with
// "logs have same timestamp". Three timestamp shapes have to keep working.
console.log('\nGantt time axis');
const ganttAxis = global.logGanttAxis;

const isoAxis = ganttAxis([
  { ts: '2026-07-18T23:59:59.000000' },
  { ts: '2026-07-19T00:00:01.000000' }
]);
ok('gantt: full ISO log crossing midnight moves forward, not backwards',
  isoAxis[1].ms - isoAxis[0].ms === 2000);

const csvAxis = ganttAxis([
  { ts: '18/07/2026 23:59:59' },
  { ts: '19/07/2026 00:00:04' }
]);
ok('gantt: Studio Pro CSV export resolves through mtTsToMs',
  csvAxis.length === 2 && csvAxis[1].ms - csvAxis[0].ms === 5000);

// LOG_PAT_TIME produces date-less stamps; they must still plot, and must carry a
// day offset forward when the clock wraps instead of jumping back 24 hours.
const timeOnlyAxis = ganttAxis([
  { ts: '23:59:58' },
  { ts: '23:59:59' },
  { ts: '00:00:02' }
]);
eq('gantt: time-only log still plots every entry', timeOnlyAxis.length, 3);
ok('gantt: time-only log crossing midnight stays monotonic',
  timeOnlyAxis[2].ms - timeOnlyAxis[1].ms === 3000);

eq('gantt: unparseable stamps are dropped rather than plotted at zero',
  ganttAxis([{ ts: 'not a time' }, { ts: '' }]).length, 0);

// ── Timeline axis (public/js/tools/log-viewer.js) ────────────────────────────
// logAssignMs writes e.ms once per loaded log and is now the single time source
// behind the timeline chart, its drag-selected range and the Gantt. Three things
// must hold: it mutates in place (the chart buckets the very objects the stream
// renders), an unreadable stamp becomes NaN rather than 0 (so it can be excluded
// and disclosed instead of piling up at the start of the axis), and the day carry
// still runs across the list for date-less logs.
console.log('\nTimeline axis');
const assignMs = global.logAssignMs;

const inPlace = [{ ts: '2026-07-18T09:00:00.000000' }, { ts: '2026-07-18T09:00:02.000000' }];
assignMs(inPlace);
ok('timeline: ms is written onto the entries themselves, not onto copies',
  inPlace[0].ms > 0 && inPlace[1].ms - inPlace[0].ms === 2000);

const withGaps = [{ ts: '2026-07-18T09:00:00.000000' }, { ts: 'no stamp at all' }, { ts: '2026-07-18T09:00:05.000000' }];
assignMs(withGaps);
ok('timeline: an unreadable stamp becomes NaN, never 0', Number.isNaN(withGaps[1].ms));
ok('timeline: …and its neighbours are unaffected', withGaps[2].ms - withGaps[0].ms === 5000);

const wrap = [{ ts: '23:59:58' }, { ts: '00:00:01' }];
assignMs(wrap);
ok('timeline: a date-less log crossing midnight still moves forward',
  wrap[1].ms - wrap[0].ms === 3000);

// Re-running must be idempotent: logShowLoaded calls it after every parse, and a
// second file appended to an open log re-runs it over entries that already have ms.
const rerun = [{ ts: '2026-07-18T09:00:00.000000' }, { ts: '2026-07-18T09:00:07.000000' }];
assignMs(rerun);
const firstPass = rerun[0].ms;
assignMs(rerun);
ok('timeline: assigning twice yields the same axis', rerun[0].ms === firstPass && rerun[1].ms - rerun[0].ms === 7000);

// ── Level matrix pivot (public/js/tools/log-viewer.js) ───────────────────────
// logBuildLevelMatrix attaches to window (pointed at global above) when the
// log-viewer module was compiled for the Insights tests. It pivots parsed records
// by log node × severity, honoring the data-driven rule: only levels/nodes that
// occur produce columns/rows. Reuses the insLog distribution asserted above.
console.log('\nLevel matrix pivot');
const logMatrix = global.logBuildLevelMatrix;

const mtx = logMatrix(insRecs);
// Present levels only, in canonical order (no TRACE/CRITICAL in this fixture)
eq('matrix: levels present in canonical order', mtx.levels.join(','), 'DEBUG,INFO,WARN,ERROR');
eq('matrix: grand total = 20 records', mtx.grandTotal, 20);
eq('matrix: node count = 6', mtx.nodeCount, 6);
// Nodes rank by ERROR+CRITICAL volume, then total
eq('matrix: TaskQueue is the top (noisiest-error) node', mtx.nodes[0].node, 'TaskQueue');
eq('matrix: TaskQueue error count = 7', mtx.nodes[0].counts.ERROR, 7);
eq('matrix: SAML_SSO ranks second', mtx.nodes[1].node, 'SAML_SSO');
eq('matrix: SAML_SSO error count = 3', mtx.nodes[1].counts.ERROR, 3);
// Column (level) totals
eq('matrix: WARN column total = 8', mtx.levelTotals.WARN, 8);
eq('matrix: ERROR column total = 10', mtx.levelTotals.ERROR, 10);
eq('matrix: INFO column total = 1', mtx.levelTotals.INFO, 1);
eq('matrix: DEBUG column total = 1', mtx.levelTotals.DEBUG, 1);
// A pure INFO/WARN node keeps its own row and per-level split
const webui = mtx.nodes.find(function (n) { return n.node === 'WebUI'; });
eq('matrix: WebUI WARN count = 4', webui.counts.WARN, 4);
eq('matrix: WebUI has no ERROR bucket', webui.counts.ERROR, undefined);
eq('matrix: WebUI total = 4', webui.total, 4);

// Data-driven rule: empty input → no rows, no columns, nothing to pivot
const emptyMtx = logMatrix([]);
eq('matrix: empty input → 0 grand total', emptyMtx.grandTotal, 0);
eq('matrix: empty input → 0 nodes', emptyMtx.nodes.length, 0);
eq('matrix: empty input → 0 levels', emptyMtx.levels.length, 0);

// Clean INFO/DEBUG log → only those two columns appear
const cleanMtx = logMatrix(parser.parse(cleanLog).records);
eq('matrix: clean log levels = DEBUG,INFO only', cleanMtx.levels.join(','), 'DEBUG,INFO');
eq('matrix: clean log node count = 2', cleanMtx.nodeCount, 2);

// Level normalization + unknown-level rejection + node|logNode fallback
const rawMtx = logMatrix([
  { level: 'WARNING', logNode: 'A' },  // → WARN
  { level: 'FATAL', logNode: 'A' },    // → ERROR
  { level: 'INFO', node: 'B' },        // node (not logNode) still resolves
  { level: 'SOMETHINGWEIRD', logNode: 'C' } // unknown level dropped, node C never appears
]);
eq('matrix: normalized/known levels only → grand total 3', rawMtx.grandTotal, 3);
eq('matrix: unknown-level node C dropped → 2 nodes', rawMtx.nodeCount, 2);
eq('matrix: FATAL normalized into ERROR total', rawMtx.levelTotals.ERROR, 1);
eq('matrix: WARNING normalized into WARN total', rawMtx.levelTotals.WARN, 1);
eq('matrix: present levels canonical-ordered', rawMtx.levels.join(','), 'INFO,WARN,ERROR');
ok('matrix: node field resolves when logNode absent', !!rawMtx.nodes.find(function (n) { return n.node === 'B'; }));

// ── Mendix Error Decoder ruleset (public/js/tools/error-decoder.js) ──────────
// The decoder is a plain script attaching edxDecode to window/self (window is
// already pointed at the global above), so it require()s directly like MFT/WSRE.
// Contract: decode mechanisms only, always expose the matched pattern, and — the
// data-driven rule — return NO match rather than a guess for unknown input.
console.log('\nError Decoder ruleset');
require(ENGINE + 'decoder.js');
const edxDecode = global.edxDecode;

function edxIds(text) { return edxDecode(text).matches.map(function (m) { return m.id; }); }
function edxTop(text) { return edxDecode(text).matches[0]; }

// Data-driven rule: unknown / empty input yields zero cards, never a guess.
eq('errdec: empty input → no matches', edxDecode('').matches.length, 0);
eq('errdec: whitespace input → no matches', edxDecode('   \n  ').matches.length, 0);
eq('errdec: unrecognized text → no matches',
  edxDecode('Everything is fine, nothing to see here.').matches.length, 0);

// Each headline signature is recognized.
ok('errdec: unique constraint', edxIds('ERROR: duplicate key value violates unique constraint "account_email_key"').indexOf('pg-unique-violation') !== -1);
ok('errdec: not-null constraint', edxIds('null value in column "name" violates not-null constraint').indexOf('pg-notnull-violation') !== -1);
ok('errdec: foreign key', edxIds('violates foreign key constraint "customer_order_fk"').indexOf('pg-fk-violation') !== -1);
ok('errdec: deadlock', edxIds('ERROR: deadlock detected').indexOf('pg-deadlock') !== -1);
ok('errdec: statement timeout', edxIds('ERROR: canceling statement due to statement timeout').indexOf('pg-statement-timeout') !== -1);
ok('errdec: pool exhausted', edxIds('Cannot get a connection, pool error Timeout waiting for idle object').indexOf('db-pool-exhausted') !== -1);
ok('errdec: nonexistent object', edxIds("Trying to retrieve nonexistent object with id 'Sales.Order_281474976710656'").indexOf('mendix-nonexistent-object') !== -1);
ok('errdec: heap OOM', edxIds('java.lang.OutOfMemoryError: Java heap space').indexOf('oom-heap') !== -1);
ok('errdec: metaspace OOM', edxIds('java.lang.OutOfMemoryError: Metaspace').indexOf('oom-metaspace') !== -1);
ok('errdec: gc overhead OOM', edxIds('java.lang.OutOfMemoryError: GC overhead limit exceeded').indexOf('oom-gc-overhead') !== -1);
ok('errdec: native thread OOM', edxIds('java.lang.OutOfMemoryError: unable to create new native thread').indexOf('oom-native-thread') !== -1);
ok('errdec: jetty EOF', edxIds('org.eclipse.jetty.io.EofException: Early EOF').indexOf('jetty-eof') !== -1);
ok('errdec: socket read timeout', edxIds('java.net.SocketTimeoutException: Read timed out').indexOf('socket-read-timeout') !== -1);
ok('errdec: TLS PKIX', edxIds('sun.security.validator.ValidatorException: PKIX path building failed').indexOf('ssl-pkix') !== -1);
ok('errdec: connection refused', edxIds('java.net.ConnectException: Connection refused').indexOf('connection-refused') !== -1);
ok('errdec: SAML audience', edxIds('SAML assertion invalid: Audience urn:acc:sp is not valid').indexOf('saml-audience') !== -1);
ok('errdec: SAML clock/NotOnOrAfter', edxIds('Assertion Conditions NotOnOrAfter 2026-07-18T09:00:00Z has passed').indexOf('saml-clock') !== -1);
ok('errdec: port in use', edxIds('java.net.BindException: Address already in use').indexOf('port-in-use') !== -1);
ok('errdec: NPE', edxIds('java.lang.NullPointerException').indexOf('npe') !== -1);

// The matched pattern is always exposed (owner contract: user judges the fit).
const uniqTop = edxTop('ERROR: duplicate key value violates unique constraint "account_email_key"');
ok('errdec: matchedText echoes the signature', /account_email_key/.test(uniqTop.matchedText), uniqTop.matchedText);
eq('errdec: card carries category', uniqTop.category, 'Database');
ok('errdec: mechanism is non-empty prose', uniqTop.mechanism.length > 40);
ok('errdec: causes is a non-empty list', Array.isArray(uniqTop.causes) && uniqTop.causes.length >= 2);
ok('errdec: checks is a non-empty list', Array.isArray(uniqTop.checks) && uniqTop.checks.length >= 1);
ok('errdec: at least one check references a tool', uniqTop.checks.some(function (c) { return !!c.tool; }));
ok('errdec: unique-violation check points at LQE', uniqTop.checks.some(function (c) { return c.tool === 'log-query-extractor'; }));

// A real wrapped stack: the specific root cause must outrank the generic wrapper.
const wrapped = [
  'com.mendix.modules.microflowengine.MicroflowException: Error in (sub)microflow call',
  '\tat com.mendix.modules.microflowengine.MicroflowEngine.execute(MicroflowEngine.java:120)',
  'Caused by: java.net.SocketTimeoutException: Read timed out',
  '\tat java.base/java.net.SocketInputStream.socketRead0(Native Method)'
].join('\n');
const wrappedIds = edxIds(wrapped);
ok('errdec: wrapped stack matches both wrapper and root', wrappedIds.indexOf('microflow-exception') !== -1 && wrappedIds.indexOf('socket-read-timeout') !== -1);
eq('errdec: specific root cause ranks first, not the wrapper', edxTop(wrapped).id, 'socket-read-timeout');
ok('errdec: stack trace detected in input', edxDecode(wrapped).input.hasStackTrace);

// Specificity: a specific DB signature outranks a bare NPE when both appear.
const mixed = 'java.lang.NullPointerException\nCaused by: ERROR: deadlock detected';
eq('errdec: DB deadlock outranks NPE', edxTop(mixed).id, 'pg-deadlock');

// ── Rules mined from real production logs (wave 19) ─────────────────────────
// Every signature below was taken verbatim from ERROR/CRITICAL records in the
// reference logs, not from documentation. Before them the decoder recognised
// 10% of that corpus by volume; the four rules that fired were mostly scanner
// 404s — it knew the rare tail and missed everything common.
ok('errdec: runtime request wrapper',
  edxIds("Connector: An error has occurred while handling the request. [User 'a@b.c' with session id 'ff08e210-0000-0000-0000-000000001d27' and roles 'User']")
    .indexOf('mx-request-handler-error') !== -1);
ok('errdec: published REST failure',
  edxIds('REST Publish: An unexpected error occurred while handling REST request').indexOf('mx-rest-publish-failed') !== -1);
ok('errdec: published web service failure',
  edxIds('WebServices: An error occurred processing the webservice request').indexOf('mx-ws-publish-failed') !== -1);
ok('errdec: web service input parameters',
  edxIds("WebServices: Couldn't handle input parameters").indexOf('mx-ws-input-parameters') !== -1);
ok('errdec: task queue failure',
  edxIds("TaskQueue: Failed to execute task 'MDM.UPD_UserData(Account=X@1)' from task queue 'Queues.Schedule'.")
    .indexOf('mx-taskqueue-failed') !== -1);
ok('errdec: request state size',
  edxIds('RequestStatistics: Request state size of 450 objects exceeds the threshold of 300 objects.')
    .indexOf('mx-request-state-size') !== -1);
ok('errdec: FileDocument without a file',
  edxIds('Connector: The Comments.Attachment file could not be found.').indexOf('mx-file-not-found') !== -1);
ok('errdec: blocked file cleanup',
  edxIds('Core: Prevented deletion of one or more files that are still in use').indexOf('mx-file-in-use') !== -1);
ok('errdec: SAML duplicate response',
  edxIds('SAML_SSO: Unable to validate Response. Error: Request has already received a response')
    .indexOf('saml-duplicate-response') !== -1);

// The most frequent line in the whole corpus (4 023×) carries no message at all.
// It is only decodable *with* its log node — a bare "null" must stay unmatched,
// which is what keeps this rule from firing on every NullPointerException.
ok('errdec: SAML null message needs its log node',
  edxIds('SAML_SSO: null').indexOf('saml-empty-error') !== -1);
eq('errdec: a bare "null" is not a SAML error', edxIds('null').length, 0);
ok('errdec: a null-message NPE does not become a SAML error',
  edxIds('java.lang.NullPointerException: null').indexOf('saml-empty-error') === -1);
ok('errdec: the outbound SAML variant is the same family',
  edxIds('SAML_SSO: Error occurred while making request: null').indexOf('saml-empty-error') !== -1);
ok('errdec: ...and it says which leg failed',
  /making a request/i.test(edxTop('SAML_SSO: Error occurred while making request: null').mechanism));

// Ranking: the wrappers must never outrank the cause underneath them.
const handlerWithCause = [
  "Connector: An error has occurred while handling the request. [User 'a@b.c' with roles 'User']",
  'com.mendix.modules.microflowengine.MicroflowException: Error in (sub)microflow call',
  'Caused by: ERROR: deadlock detected'
].join('\n');
eq('errdec: the root cause outranks the request wrapper', edxTop(handlerWithCause).id, 'pg-deadlock');
ok('errdec: ...and the wrapper is still reported alongside it',
  edxIds(handlerWithCause).indexOf('mx-request-handler-error') !== -1);
const samlAndReal = 'SAML_SSO: null\nCaused by: sun.security.validator.ValidatorException: PKIX path building failed';
eq('errdec: an information-free SAML line never outranks a real signature', edxTop(samlAndReal).id, 'ssl-pkix');

// Contract: every new rule carries all three sections and at least one tool link.
['mx-request-handler-error', 'mx-rest-publish-failed', 'mx-ws-publish-failed', 'mx-ws-input-parameters',
 'mx-taskqueue-failed', 'mx-request-state-size', 'mx-file-not-found', 'mx-file-in-use',
 'saml-duplicate-response', 'saml-empty-error'].forEach(function (id) {
  const rule = global.EDX_RULES.filter(function (r) { return r.id === id; })[0];
  ok('errdec: ' + id + ' is registered', !!rule);
  if (!rule) return;
  const m = ['x'];
  ok('errdec: ' + id + ' explains a mechanism', rule.mechanism(m).length > 60);
  ok('errdec: ' + id + ' lists causes as hypotheses', rule.causes(m).length >= 2);
  ok('errdec: ' + id + ' offers checks', rule.checks(m).length >= 1);
  // The decoder is not a fix advisor — no rule may instruct.
  const prose = rule.mechanism(m) + ' ' + rule.causes(m).join(' ') + ' ' + rule.checks(m).map(function (c) { return c.text; }).join(' ');
  ok('errdec: ' + id + ' does not prescribe a fix',
    !/\b(you should|you must|simply add|just add|fix it by)\b/i.test(prose));
});

// A single-line message with no stack still decodes and reports no stack trace.
ok('errdec: single-line message → no stack flag', !edxDecode('java.lang.OutOfMemoryError: Java heap space').input.hasStackTrace);

// ── Wave 9 ruleset expansion (30+ patterns) ──────────────────────────────────
ok('errdec: too many clients', edxIds('FATAL: sorry, too many clients already').indexOf('pg-too-many-clients') !== -1);
ok('errdec: transaction aborted', edxIds('ERROR: current transaction is aborted, commands ignored until end of transaction block').indexOf('pg-transaction-aborted') !== -1);
ok('errdec: value too long', edxIds('ERROR: value too long for type character varying(50)').indexOf('pg-value-too-long') !== -1);
ok('errdec: out of shared memory', edxIds('ERROR: out of shared memory\nHINT: You might need to increase max_locks_per_transaction').indexOf('pg-out-of-shared-memory') !== -1);
ok('errdec: disk full', edxIds('ERROR: could not extend file "base/16400/16490": No space left on device').indexOf('pg-disk-full') !== -1);
ok('errdec: Mendix optimistic lock conflict', edxIds('com.mendix.systemwideinterfaces.connectionbus.data.ConcurrentModificationRuntimeException').indexOf('mendix-concurrent-modification') !== -1);
ok('errdec: StackOverflowError', edxIds('java.lang.StackOverflowError').indexOf('stack-overflow') !== -1);
ok('errdec: plain-Java ConcurrentModificationException', edxIds('java.util.ConcurrentModificationException').indexOf('java-concurrent-modification') !== -1);
ok('errdec: NoClassDefFoundError', edxIds('java.lang.NoClassDefFoundError: com/foo/Bar').indexOf('no-class-def-found') !== -1);
ok('errdec: NoSuchMethodError', edxIds("java.lang.NoSuchMethodError: 'void com.foo.Bar.baz()'").indexOf('no-such-method-error') !== -1);
ok('errdec: UnknownHostException', edxIds('java.net.UnknownHostException: api.example.internal').indexOf('unknown-host') !== -1);
ok('errdec: ruleset has at least 30 patterns', global.EDX_RULES.length >= 30, global.EDX_RULES.length);

// ── 404 static-file / scanner-probe rule (real MxCloud runtime log lines) ─────
ok('errdec: 404 file not found matches',
  edxIds('2026-07-17T00:10:57.791076 [runtime-container/27mj7]  ERROR - Connector: 404 - file not found for file: magento_version').indexOf('http-404-file-not-found') !== -1);
const edx404 = edxTop('ERROR - Connector: 404 - file not found for file: magento_version');
eq('errdec: 404 rule is categorized Platform', edx404.category, 'Platform');
ok('errdec: 404 mechanism names the requested file', /magento_version/.test(edx404.mechanism), edx404.mechanism);
ok('errdec: 404 flags a known probe name', /classic probe target/.test(edx404.causes[0]), edx404.causes[0]);
ok('errdec: 404 check points at the Nginx analyzer', edx404.checks.some(function (c) { return c.tool === 'nginx-log'; }));
// A URL-encoded scanner path is decoded for display (wp-content%2F... → wp-content/...).
ok('errdec: 404 decodes a %-encoded probe path',
  /wp-content\/plugins/.test(edxTop('ERROR - Connector: 404 - file not found for file: wp-content%2Fplugins%2Fadvanced-text-widget%2Freadme.txt').mechanism));
// Malformed %-encoding must not throw — it falls back to the raw captured name.
ok('errdec: 404 survives malformed %-encoding',
  edxIds('ERROR - Connector: 404 - file not found for file: bad%2').indexOf('http-404-file-not-found') !== -1);
// A non-probe file name still matches the rule but carries no "probe" emphasis.
ok('errdec: 404 without a known probe name omits the emphasis',
  !/classic probe target/.test(edxTop('ERROR - Connector: 404 - file not found for file: brochure2024').causes[0]));
// The attacker-controlled path is HTML-escaped where the card embeds it
// (a no-space payload is captured whole by \S+, so this really exercises escaping).
ok('errdec: 404 escapes an HTML-bearing probe path in the mechanism',
  !/<script>/.test(edxTop('ERROR - Connector: 404 - file not found for file: <script>alert(1)</script>').mechanism));

// ── REST-publish 404 "no operation matches" (real MxCloud DEBUG log line) ─────
const rest404line = '2026-07-17T00:10:59.251887 [runtime-container/27mj7]  DEBUG - REST Publish: Responding with 404 Not Found, because no operation matches http://weborderentry100-accp.mendixcloud.com/rest/default/V1/guest-carts';
ok('errdec: REST-publish 404 matches',
  edxIds(rest404line).indexOf('http-404-rest-no-operation') !== -1);
const edxRest404 = edxTop(rest404line);
eq('errdec: REST-publish 404 is categorized Platform', edxRest404.category, 'Platform');
ok('errdec: REST-publish 404 mechanism names the requested URL', /guest-carts/.test(edxRest404.mechanism), edxRest404.mechanism);
ok('errdec: REST-publish 404 flags a known probe path', /classic probe target/.test(edxRest404.causes[0]), edxRest404.causes[0]);
ok('errdec: REST-publish 404 check points at the Nginx analyzer', edxRest404.checks.some(function (c) { return c.tool === 'nginx-log'; }));
// It must NOT be confused with the static-file 404 (distinct signature/rule).
ok('errdec: REST-publish 404 is not the static-file 404 rule', edxIds(rest404line).indexOf('http-404-file-not-found') === -1);
// A genuine own-API mismatch still matches but carries no probe emphasis.
ok('errdec: REST-publish 404 without a probe path omits the emphasis',
  !/classic probe target/.test(edxTop('REST Publish: Responding with 404 Not Found, because no operation matches https://app.example.com/rest/orders/v2/list').causes[0]));

// Clean stack trace: strips per-line Mendix Cloud log prefixes, leaves raw
// "at ..."/"Caused by:" continuation lines (which never carry one) untouched,
// and drops blank lines — never touches matching (edxDecode doesn't anchor to
// line starts), only readability.
const edxCleanStackTrace = global.edxCleanStackTrace;
const dirtyTrace = [
  "2026-07-18T09:14:22.517 [runtime-container/abc]  ERROR - Connector: com.mendix.systemwideinterfaces.core.UserException: boom",
  "",
  "\tat com.mendix.modules.microflowengine.MicroflowEngine.executeMicroflow(MicroflowEngine.java:120)",
  "Caused by: java.lang.NullPointerException"
].join('\n');
const cleaned = edxCleanStackTrace(dirtyTrace);
ok('errdec: clean strips the cloud log prefix', cleaned.indexOf('com.mendix.systemwideinterfaces.core.UserException: boom') === 0, cleaned);
ok('errdec: clean keeps unprefixed stack frames verbatim', cleaned.indexOf('\tat com.mendix.modules.microflowengine.MicroflowEngine.executeMicroflow(MicroflowEngine.java:120)') !== -1);
ok('errdec: clean drops blank lines', cleaned.split('\n').every(function (l) { return l.trim() !== ''; }));
eq('errdec: clean is a no-op on already-plain text', edxCleanStackTrace('Caused by: java.lang.NullPointerException'), 'Caused by: java.lang.NullPointerException');

// ── Wave 20: platform rules from the second mining pass ──────────────────────
// Every line below is verbatim from the NewLogs corpus (10 production apps,
// 3.1 GB, 10–13.08.2026). The ruleset recognised 75.7% of its 340 863
// ERROR/WARNING records before these rules and 89.7% after.
ok('errdec: autocommitted objects on logout',
  edxIds("Core: Some autocommitted objects still existed on logout for session 'Anonymous_8c483d2b-9242-4b10-9ef1-36e495d960d7'.")
    .indexOf('mx-autocommitted-on-logout') !== -1);
ok('errdec: slow query warning',
  edxIds('ConnectionBus_Queries: Query executed in 6 seconds and 794 milliseconds: SELECT "myconnect$ticketmc"."id" FROM "myconnect$ticketmc"')
    .indexOf('mx-slow-query-warning') !== -1);
ok('errdec: slow query states the measured duration',
  /6 s 794 ms/.test(edxTop('ConnectionBus_Queries: Query executed in 6 seconds and 794 milliseconds: SELECT 1').mechanism));
// "1 second"/"1 millisecond" singular must match too.
ok('errdec: slow query handles singular units',
  edxIds('Query executed in 1 second and 1 millisecond: SELECT 1').indexOf('mx-slow-query-warning') !== -1);
ok('errdec: widget missing XPath parameter',
  edxIds("WebUI: The runtime operation 'XCLCU1T9sVGRCPbmKhEJNA' is missing parameters: [Search]. This might lead to an unresolvable XPath: '//myConnect.TeamMC[contains(Name,$Search)]'.")
    .indexOf('mx-widget-missing-parameter') !== -1);
ok('errdec: widget rule names the missing parameter',
  /Search/.test(edxTop("WebUI: The runtime operation 'X' is missing parameters: [Search]. This might lead to an unresolvable XPath: '//A[1]'.").mechanism));
// Both runtime phrasings of the permission refusal are the same family.
ok('errdec: permission refusal (runtime-operation phrasing)',
  edxIds("WebUI: User 'user1@example.com' attempted to execute runtime operation 'nFjwXyMA4F6N8suJZAXz4A' (microflow call 'TicketsAndTeams.ACT_ShowDetailsPageOperator') but does not have the required permissions")
    .indexOf('mx-microflow-not-permitted') !== -1);
ok('errdec: permission refusal (action-name phrasing)',
  edxIds("WebUI: User 'user2@example.com' attempted to execute the microflow with action name 'TimeWindows_DeliveryShow', but does not have the required permissions.")
    .indexOf('mx-microflow-not-permitted') !== -1);
ok('errdec: permission refusal names the microflow',
  /TimeWindows_DeliveryShow/.test(edxTop("WebUI: User 'a@b.c' attempted to execute the microflow with action name 'TimeWindows_DeliveryShow', but does not have the required permissions.").mechanism));
ok('errdec: TokenReplacer null ID list',
  edxIds('TokenReplacer: requirement failed: Ids should not be null\njava.lang.IllegalArgumentException: requirement failed: Ids should not be null')
    .indexOf('mx-tokenreplacer-null-ids') !== -1);
ok('errdec: malformed email address',
  edxIds("Email: Sending email caused an error: Illegal address\nCaused by: javax.mail.internet.AddressException: Illegal address in string ``''")
    .indexOf('mail-illegal-address') !== -1);
// The real defect behind 147 of these: two addresses concatenated with no separator.
ok('errdec: glued-together addresses are called out',
  /two addresses run together/.test(edxTop("javax.mail.internet.AddressException: Domain contains illegal character in string ``jan.kowalski@example.comanna.nowak@example.com''").causes[0]));
ok('errdec: an empty address string is reported as empty',
  /empty<\/strong>/.test(edxTop("javax.mail.internet.AddressException: Illegal address in string ``''").mechanism));
ok('errdec: import mapping attribute parse failure',
  edxIds("JSON Import: A problem occurred parsing attribute 'Loading_Country' of object of type 'Integration.ShipmentTemp'. The value was ''. This isn't allowed by the schema.")
    .indexOf('mx-import-attribute-parse') !== -1);
ok('errdec: import parse failure names attribute and entity',
  /Loading_Country[\s\S]*Integration\.ShipmentTemp/.test(edxTop("XML Import: A problem occurred parsing attribute 'Loading_Country' of object of type 'Integration.ShipmentTemp'. The value was 'x'.").mechanism));
ok('errdec: XSD validation failure',
  edxIds("XML Import: Error occurred while parsing xml: cvc-complex-type.2.4.a: Invalid content was found starting with element '{\"http://schemas.xmlsoap.org/soap/envelope/\":Header}'.")
    .indexOf('mx-xsd-validation-failed') !== -1);
ok('errdec: XSD complex-type failure suggests the envelope/body mix-up',
  /Header<\/code>/.test(edxTop('cvc-complex-type.2.4.a: Invalid content was found starting with element X.').causes[0]));
ok('errdec: XSD facet failure suggests a facet mismatch',
  /facet/i.test(edxTop("cvc-fractionDigits-valid: Value '1201.9901' has 4 fraction digits, but the number of fraction digits has been limited to 2.").causes[0]));
ok('errdec: SAML artifact resolved to nothing',
  edxIds('SAML_SSO: Error occurred while making request: Nothing was returned for the requested ID.')
    .indexOf('saml-nothing-returned-for-id') !== -1);
ok('errdec: POI missing summary metadata',
  edxIds('org.apache.poi.POIDocument: SummaryInformation property set came back as null')
    .indexOf('poi-summaryinformation-null') !== -1);
ok('errdec: POI variant with the Document prefix',
  edxIds('org.apache.poi.POIDocument: DocumentSummaryInformation property set came back as null')
    .indexOf('poi-summaryinformation-null') !== -1);
// It is noise: it must never outrank a real failure pasted alongside it.
eq('errdec: POI noise never outranks a real error',
  edxTop('org.apache.poi.POIDocument: SummaryInformation property set came back as null\nERROR: deadlock detected').id, 'pg-deadlock');
ok('errdec: POI card says nothing actually failed',
  /Nothing failed/i.test(edxTop('SummaryInformation property set came back as null').mechanism));
ok('errdec: SSO user creation disabled',
  edxIds("UserCommons: User creation is currently disabled due to the inactive status of the 'Allow module to Create users' setting in the Configuration.")
    .indexOf('mx-user-creation-disabled') !== -1);
ok('errdec: missing cachebust token',
  edxIds("Connector: Invalid request for 'manifest.webmanifest': no cachebust query string found.")
    .indexOf('mx-cachebust-missing') !== -1);
ok('errdec: delete-after-download contradiction',
  edxIds("Connector: Deleting files after download, which are also shown in the browser without caching them, will prevent files from being saved after it's been shown in the browser.")
    .indexOf('mx-delete-after-download') !== -1);

const EDX_LABELLED_TOOLS = ['log-query-extractor', 'microflow-tracer', 'ws-rest-extractor', 'thread-dump', 'log-viewer', 'nginx-log', 'saml-debugger', 'query-intelligence', 'xpath-builder', 'char-sanitizer'];

// The wave-20 rules must satisfy the same contract as every rule before them.
['mx-autocommitted-on-logout', 'mx-slow-query-warning', 'mx-widget-missing-parameter',
 'mx-microflow-not-permitted', 'mx-tokenreplacer-null-ids', 'mail-illegal-address',
 'mx-import-attribute-parse', 'mx-xsd-validation-failed', 'saml-nothing-returned-for-id',
 'poi-summaryinformation-null', 'mx-user-creation-disabled', 'mx-cachebust-missing',
 'mx-delete-after-download'].forEach(function (id) {
  const rule = global.EDX_RULES.filter(function (r) { return r.id === id; })[0];
  ok('errdec: ' + id + ' is registered', !!rule);
  if (!rule) return;
  const m = ['x', 'x', 'x'];
  ok('errdec: ' + id + ' explains a mechanism', rule.mechanism(m).length > 60);
  ok('errdec: ' + id + ' lists causes as hypotheses', rule.causes(m).length >= 2);
  ok('errdec: ' + id + ' offers checks', rule.checks(m).length >= 1);
  const prose = rule.mechanism(m) + ' ' + rule.causes(m).join(' ') + ' ' + rule.checks(m).map(function (c) { return c.text; }).join(' ');
  ok('errdec: ' + id + ' does not prescribe a fix',
    !/\b(you should|you must|simply add|just add|fix it by)\b/i.test(prose));
  // A check may only point at a tool the decoder can actually label — an
  // unlabelled id silently renders no button, so the link would just vanish.
  rule.checks(m).forEach(function (c) {
    if (!c.tool) return;
    ok('errdec: ' + id + ' links only labelled tools (' + c.tool + ')',
      EDX_LABELLED_TOOLS.indexOf(c.tool) !== -1, c.tool);
  });
});

// =========================================================================
// SQL / OQL FORMATTING ENGINE
// =========================================================================
// The old prettifySQL/formatOql both ran a blind `\s+` collapse and `\bKW\b`
// match over the WHOLE input, so a keyword sitting inside a string literal or
// a comment got uppercased and relocated as if it were code. These tests
// pin the failure cases the audit called out by name.
console.log('\nSQL/OQL formatting engine');
require(ENGINE + 'sql.js');

const sqeMasked1 = global.sqeMask("WHERE name = 'ORDER BY' AND x = 1");
eq('mask: one string token extracted', sqeMasked1.tokens.length, 1);
eq('mask: token keeps the keyword verbatim', sqeMasked1.tokens[0].raw, "'ORDER BY'");
ok('mask: masked text has no literal ORDER BY left', sqeMasked1.masked.indexOf('ORDER BY') === -1);
eq('unmask: round-trips to the original string', global.sqeUnmask(sqeMasked1.masked, sqeMasked1.tokens), "WHERE name = 'ORDER BY' AND x = 1");

const sqeMasked2 = global.sqeMask("SELECT 1 -- FROM legacy\nFROM real_table");
eq('mask: line comment extracted as its own token', sqeMasked2.tokens[0].raw, '-- FROM legacy');
ok('mask: FROM inside the comment is not visible to a keyword scan', sqeMasked2.masked.indexOf('FROM legacy') === -1);
ok('mask: FROM in real code still visible', /FROM real_table/.test(sqeMasked2.masked));

const sqeMasked3 = global.sqeMask("/* multi\nline */ SELECT 1");
eq('mask: block comment spans newlines as one token', sqeMasked3.tokens[0].raw, '/* multi\nline */');

const sqeMasked4 = global.sqeMask("SET x = ''''"); // '''' = an escaped single quote inside the literal
eq('mask: doubled-quote escape stays inside the string token', sqeMasked4.tokens[0].raw, "''''");

// ── top-level split ──────────────────────────────────────────────────────
const sqeSplit1 = global.sqeSplitTopLevel('a, b, c');
eq('split: three plain items', sqeSplit1.length, 3);
eq('split: items trimmed', sqeSplit1[1], 'b');

const sqeSplit2 = global.sqeSplitTopLevel("price numeric(10,2), name text");
eq('split: a comma inside parens is not a boundary', sqeSplit2.length, 2);
eq('split: the paren-bearing column stays whole', sqeSplit2[0], 'price numeric(10,2)');

const sqeSplit3 = global.sqeSplitTopLevel('(SELECT a, b FROM t), c');
eq('split: a comma inside a subquery is not a boundary', sqeSplit3.length, 2);

// ── prettify (the real regression target: a keyword hiding in a literal) ──
const sqePrettyOpts = {
  breakKeywords: ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'JOIN'],
  indentKeywords: ['AND', 'OR'],
  listKeywords: ['SELECT', 'GROUP BY', 'ORDER BY']
};
const sqePretty1 = global.sqePrettify("SELECT a, b FROM t WHERE name = 'ORDER BY' AND x = 1", sqePrettyOpts);
ok('prettify: the literal ORDER BY is not treated as the keyword',
  sqePretty1.indexOf("'ORDER BY'") !== -1 && sqePretty1.split('\n').filter(function (l) { return /^ORDER BY/.test(l.trim()); }).length === 0);
ok('prettify: SELECT columns split one per line', /SELECT\n\s+a,\n\s+b/.test(sqePretty1));
ok('prettify: WHERE starts its own line', /\nWHERE /.test(sqePretty1));

const sqePretty2 = global.sqePrettify('numeric(10,2)', { breakKeywords: [], indentKeywords: [], listKeywords: [] });
eq('prettify: passthrough with no keyword lists configured', sqePretty2, 'numeric(10,2)');

const sqePretty3 = global.sqePrettify("SELECT 1 -- pick the columns\nFROM t", sqePrettyOpts);
ok('prettify: a comment survives formatting unchanged', sqePretty3.indexOf('-- pick the columns') !== -1);

// ── 7.6: configurable indent width + keyword case (SQL Formatter settings) ──
const sqePretty4Space = global.sqePrettify('select a, b from t', Object.assign({}, sqePrettyOpts, { indentSize: 4 }));
ok('prettify: indentSize=4 uses 4-space list indent', /SELECT\n {4}a,\n {4}b/.test(sqePretty4Space));

const sqePrettyLower = global.sqePrettify('SELECT a FROM t WHERE a > 1', Object.assign({}, sqePrettyOpts, { keywordCase: 'lower' }));
ok('prettify: keywordCase=lower lowercases keywords', /^select\n {2}a\nfrom t\nwhere a > 1$/.test(sqePrettyLower));

const sqePrettyPreserve = global.sqePrettify('Select a From t Where a > 1', Object.assign({}, sqePrettyOpts, { keywordCase: 'preserve' }));
ok('prettify: keywordCase=preserve keeps the original casing', sqePrettyPreserve.indexOf('Select') !== -1 && sqePrettyPreserve.indexOf('From') !== -1 && sqePrettyPreserve.indexOf('Where') !== -1);
ok('prettify: keywordCase=preserve still recognizes mixed-case SELECT for list-splitting', /Select\n {2}a/.test(sqePrettyPreserve));

// ── subqueries format recursively; other parens stay inline ──
// A parenthesized group whose content begins with SELECT is a subquery: it is
// pretty-printed on its own, one indent level deeper, with the opening paren on
// the clause line and the closing paren back at the clause indent. Every other
// paren group (function args, an IN value-list, a grouped AND/OR) stays inline,
// its closing paren never misplaced — the original depth-0 guarantee.
const sqePrettySubquery = global.sqePrettify(
  "SELECT id, (SELECT count(*) FROM orders o WHERE o.customer_id = c.id) AS order_count FROM customers c",
  sqePrettyOpts);
ok('prettify: outer SELECT list splits into id + the subquery column',
  /SELECT\n\s+id,\n\s+\(/.test(sqePrettySubquery));
ok('prettify: the subquery body is formatted and indented deeper than its call',
  /\n {2}\(\n {4}SELECT\n {6}count\(\*\)\n {4}FROM orders o\n {4}WHERE o\.customer_id = c\.id\n {2}\) AS order_count/.test(sqePrettySubquery));
ok('prettify: no subquery keyword leaks to the outer (depth-0) column split',
  sqePrettySubquery.split('\n').filter(function (l) { return /^\s*FROM orders/.test(l); }).length === 1);

// A nested IN (SELECT …) opens its paren on the AND line and lays the inner
// query out below — the real readability win over the old one-line behaviour.
const sqePrettyInSub = global.sqePrettify(
  "SELECT a FROM t WHERE a = 1 AND b IN (SELECT x FROM u WHERE u.k = 2)",
  sqePrettyOpts);
ok('prettify: IN-subquery opens its paren on the clause line',
  /\n\s+AND b IN \(\n/.test(sqePrettyInSub));
ok('prettify: IN-subquery inner SELECT/FROM are formatted and indented',
  /\(\n\s+SELECT\n\s+x\n\s+FROM u\n\s+WHERE u\.k = 2\n\s+\)/.test(sqePrettyInSub));

const sqePrettyGrouped = global.sqePrettify("SELECT a FROM t WHERE a = 1 AND (b = 2 OR c = 3)", sqePrettyOpts);
ok('prettify: OR inside a grouped condition does not start its own line',
  sqePrettyGrouped.split('\n').filter(function (l) { return /^\s*OR /.test(l); }).length === 0);
ok('prettify: the grouped condition stays intact on the AND line',
  sqePrettyGrouped.indexOf('AND (b = 2 OR c = 3)') !== -1);

// =========================================================================
// FORMAT VIEW — shared tokenizer / grouping (format-view.js)
// =========================================================================
console.log('\nFormat view — shared tokenizer');
// escHtml touches `document` at load in the browser; a minimal stub matching
// its real behaviour is enough to exercise the rendering here.
if (!global.escHtml) {
  global.escHtml = function (s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  };
}
require(ENGINE + 'sql.js');

const fvKw = global.fvWords('kw', ['and', 'or', 'not']);
const fvNum = global.fvRe('num', '\\d+(?:\\.\\d+)?');
const fvId = global.fvRe('id', '[A-Za-z_]\\w*');
const fvParen = global.fvRe('paren', '[()]');
const fvMatchers = [global.fvRe('ws', '[ \\t]+'), fvNum, fvKw, fvId, fvParen];

const fvT1 = global.fvTokenize('a and 12', fvMatchers).filter(function (t) { return t.t !== 'ws'; });
eq('fvTokenize: three non-ws tokens', fvT1.length, 3);
eq('fvTokenize: keyword recognised', fvT1[1].t, 'kw');
eq('fvTokenize: number recognised', fvT1[2].t, 'num');

// The word-boundary relaxation: a keyword glued to a DIGIT still splits (a
// number cannot contain letters), but glued to a LETTER stays one identifier.
const fvGlued = global.fvTokenize('1000and', fvMatchers);
eq('fvTokenize: keyword after a digit splits off', fvGlued.length, 2);
eq('fvTokenize: the number half is a number', fvGlued[0].t, 'num');
eq('fvTokenize: the keyword half is a keyword', fvGlued[1].t, 'kw');
const fvLetterGlue = global.fvTokenize('fooand', fvMatchers);
eq('fvTokenize: keyword glued after a letter stays one identifier', fvLetterGlue.length, 1);
eq('fvTokenize: …and is tagged as an identifier, not a keyword', fvLetterGlue[0].t, 'id');

const fvGrp = global.fvTokenize('(a(b))', fvMatchers);
global.fvAssignBrackets(fvGrp);
const fvOpens = fvGrp.filter(function (t) { return t.v === '('; });
const fvCloses = fvGrp.filter(function (t) { return t.v === ')'; });
eq('fvAssignBrackets: outer ( pairs with the last )', fvOpens[0].g, fvCloses[fvCloses.length - 1].g);
eq('fvAssignBrackets: inner ( pairs with the inner )', fvOpens[1].g, fvCloses[0].g);
ok('fvAssignBrackets: the two pairs have distinct group ids', fvOpens[0].g !== fvOpens[1].g);

const fvHtml = global.fvTokensToHtml([{ t: 'kw', v: 'and', g: 3 }, { t: 'ws', v: ' ' }, { t: 'num', v: '1' }]);
ok('fvTokensToHtml: grouped token carries data-g', /<span class="ftok fk-kw" data-g="3">and<\/span>/.test(fvHtml));
ok('fvTokensToHtml: whitespace is emitted raw, no span', fvHtml.indexOf('> <') !== -1);


// =========================================================================
// SQL FORMATTER — tokenizer highlighting (sql.js)
// =========================================================================
console.log('\nSQL Formatter highlighting');
require(ENGINE + 'sql.js');

const sqlHl = global.sqlHighlight("SELECT SUM(a * b) AS total FROM Sales.Customer WHERE Status = 'Active'");
ok('sql highlight: keywords coloured', /<span class="ftok fk-kw">SELECT<\/span>/.test(sqlHl));
ok('sql highlight: functions get their own colour', /<span class="ftok fk-fn">SUM<\/span>/.test(sqlHl));
ok('sql highlight: operators get their own colour', /<span class="ftok fk-op">\*<\/span>/.test(sqlHl));
ok('sql highlight: a column path is one variable token', /<span class="ftok fk-var">Sales\.Customer<\/span>/.test(sqlHl));
ok('sql highlight: string literal coloured, keyword inside it untouched', /<span class="ftok fk-str">'Active'<\/span>/.test(sqlHl));
const sqlParens = (sqlHl.match(/<span class="ftok fk-paren" data-g="\d+">/g) || []);
ok('sql highlight: matching parens grouped for hover', sqlParens.length === 2);

// A keyword hiding inside a literal must not be recoloured as a keyword.
const sqlLitKw = global.sqlHighlight("WHERE name = 'ORDER BY'");
ok('sql highlight: ORDER BY inside a string stays a string, not a keyword',
  /<span class="ftok fk-str">'ORDER BY'<\/span>/.test(sqlLitKw) && sqlLitKw.indexOf('fk-kw">ORDER') === -1);


// ── Summary ─────────────────────────────────────────────────────────────────
Promise.resolve().then(function () {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
}, function (err) {
  console.log('  ✗ async suite crashed — ' + (err && err.stack || err));
  console.log('\n' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
