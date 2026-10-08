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
// Two things the original asserts are not repeated here because they test code MxScout does not carry:
// the decoder's tool-button label map (its UI half) and the Log Viewer's DOM-bound functions.

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

// ── Microflow Tracer extraction (public/js/tools/microflow-tracer.js) ────────
// The module is a plain script that attaches its pure parts to window/self,
// so pointing `window` at the global makes it requireable in Node too.
console.log('\nMicroflow Tracer extraction');
global.window = global;
// The browser gets this from utilities.js, which touches `document` at load and
// so cannot be required here; the one line is kept identical to the original.
global.mtFmtInt = n => (Number(n) || 0).toLocaleString('en-US');
require(ENGINE + 'tracer.js');
const mftExtract = global.mftExtractExecutions;
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

const P = '[runtime-container/x]';
const mfLog = [
  '2026-07-17T10:00:00.000000 ' + P + '  DEBUG - MicroflowEngine: [100-1] Starting execution of microflow \'ModA.Parent\'',
  '2026-07-17T10:00:00.100000 ' + P + '  TRACE - MicroflowEngine: [100-1] Executing activity: {"current_activity":{"type":"Start"},"name":"ModA.Parent","type":"Microflow"}',
  '2026-07-17T10:00:00.200000 ' + P + '  TRACE - MicroflowEngine: [100-1] Executing activity: {"current_activity":{"caption":"Call child","type":"SubMicroflow"},"name":"ModA.Parent","type":"Microflow"}',
  '2026-07-17T10:00:00.250000 ' + P + '  DEBUG - MicroflowEngine: [100-1] Starting execution of microflow \'ModA.Child\'',
  '2026-07-17T10:00:00.300000 ' + P + '  TRACE - MicroflowEngine: [100-1] Executing activity: {"current_activity":{"caption":"Retrieve X","type":"RetrieveByXPath"},"name":"ModA.Child","type":"Microflow"}',
  '2026-07-17T10:00:00.700000 ' + P + '  DEBUG - MicroflowEngine: [100-1] Finished execution of microflow \'ModA.Child\'',
  '2026-07-17T10:00:01.000000 ' + P + '  DEBUG - MicroflowEngine: [100-1] Finished execution of microflow \'ModA.Parent\'',
  // second correlation ID, interleaved and never finished (log window cut)
  '2026-07-17T10:00:00.500000 ' + P + '  DEBUG - MicroflowEngine: [200-2] Starting execution of microflow \'ModB.Solo\'',
  // recursion: the same flow starts again while already on the stack
  '2026-07-17T10:00:02.000000 ' + P + '  DEBUG - MicroflowEngine: [300-3] Starting execution of microflow \'ModC.Rec\'',
  '2026-07-17T10:00:02.100000 ' + P + '  DEBUG - MicroflowEngine: [300-3] Starting execution of microflow \'ModC.Rec\'',
  '2026-07-17T10:00:02.200000 ' + P + '  DEBUG - MicroflowEngine: [300-3] Finished execution of microflow \'ModC.Rec\'',
  '2026-07-17T10:00:02.300000 ' + P + '  DEBUG - MicroflowEngine: [300-3] Finished execution of microflow \'ModC.Rec\'',
  // nested (anonymous) flow name normalization
  '2026-07-17T10:00:03.000000 ' + P + '  DEBUG - MicroflowEngine: [400-4] Starting execution of microflow \'ModD.Flow.nested.0f305fb0-28f0-46f8-8c42-06e71e5c3097\'',
  '2026-07-17T10:00:03.500000 ' + P + '  DEBUG - MicroflowEngine: [400-4] Finished execution of microflow \'ModD.Flow.nested.0f305fb0-28f0-46f8-8c42-06e71e5c3097\''
].join('\n');

const mfRecords = parser.parse(mfLog).records;
const mfOut = mftExtract(mfRecords);
eq('6 executions extracted', mfOut.executions.length, 6);
const parent = mfOut.executions.find(e => e.name === 'ModA.Parent');
const child = mfOut.executions.find(e => e.name === 'ModA.Child');
const solo = mfOut.executions.find(e => e.name === 'ModB.Solo');
ok('parent duration 1000 ms', Math.abs(parent.durationMs - 1000) < 0.001, 'got ' + parent.durationMs);
ok('child duration 450 ms', Math.abs(child.durationMs - 450) < 0.001, 'got ' + child.durationMs);
eq('child nests under parent', child.parentId, parent.id);
eq('parent has one child', parent.children.length, 1);
eq('child depth is 1', child.depth, 1);
eq('parent has 2 steps', parent.steps.length, 2);
eq('child step type parsed', child.steps[0].type, 'RetrieveByXPath');
eq('child step caption parsed', child.steps[0].caption, 'Retrieve X');
ok('parent step 1 duration = 100 ms (to next activity)', Math.abs(parent.steps[0].durationMs - 100) < 0.001, 'got ' + parent.steps[0].durationMs);
ok('parent step 2 closes at child start (50 ms)', Math.abs(parent.steps[1].durationMs - 50) < 0.001, 'got ' + parent.steps[1].durationMs);
ok('interleaved corrId stays unfinished', solo.finished === false && solo.durationMs === null);
const recs = mfOut.executions.filter(e => e.name === 'ModC.Rec');
ok('inner recursive call flagged REC', recs.some(e => e.recursive) && !recs[0].recursive);
ok('outer recursive call resolves its own Finished', recs[0].finished && Math.abs(recs[0].durationMs - 300) < 0.001);
const nested = mfOut.executions.find(e => e.name.indexOf('.nested.') !== -1);
eq('nested flow display name normalized', nested.displayName, 'ModD.Flow (nested)');
eq('correlation IDs counted', mfOut.stats.corrIds, 4);
const parentFlow = mfOut.flows.find(f => f.name === 'ModA.Parent');
ok('flow aggregate: 1 call, 1000 ms total', parentFlow.count === 1 && Math.abs(parentFlow.totalMs - 1000) < 0.001);
const recFlow = mfOut.flows.find(f => f.name === 'ModC.Rec');
ok('flow aggregate: recursion counted', recFlow.count === 2 && recFlow.recursions === 1);

// ── MFT: correlation-ID segmentation (numeric requests vs UUID scheduled events) ──
// Both shapes appear in the wild and must key independent call stacks: the same
// microflow running concurrently under a request corrId and a scheduled-event corrId
// must NOT be mistaken for recursion, and each Finished must close its own frame.
console.log('\nMicroflow Tracer: corrId segmentation');
const REQ = '1784268324436-46';                          // numeric — request-driven
const SE  = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';      // UUID — scheduled event
const segLog = [
  '2026-07-17T11:00:00.000000 ' + P + '  DEBUG - MicroflowEngine: [' + REQ + '] Starting execution of microflow \'ModX.Shared\'',
  '2026-07-17T11:00:00.100000 ' + P + '  DEBUG - MicroflowEngine: [' + SE  + '] Starting execution of microflow \'ModX.Shared\'',
  '2026-07-17T11:00:00.300000 ' + P + '  DEBUG - MicroflowEngine: [' + REQ + '] Finished execution of microflow \'ModX.Shared\'',
  '2026-07-17T11:00:00.500000 ' + P + '  DEBUG - MicroflowEngine: [' + SE  + '] Finished execution of microflow \'ModX.Shared\''
].join('\n');
const segOut = mftExtract(parser.parse(segLog).records);
eq('two corrId shapes counted separately', segOut.stats.corrIds, 2);
eq('same flow on two corrIds → two executions', segOut.executions.length, 2);
ok('neither execution flagged recursive (separate stacks)', segOut.executions.every(e => !e.recursive));
const reqExec = segOut.executions.find(e => e.corrId === REQ);
const seExec = segOut.executions.find(e => e.corrId === SE);
ok('request execution closes its own frame (300 ms)', reqExec.finished && Math.abs(reqExec.durationMs - 300) < 0.001, reqExec && reqExec.durationMs);
ok('scheduled-event execution closes its own frame (400 ms)', seExec.finished && Math.abs(seExec.durationMs - 400) < 0.001, seExec && seExec.durationMs);
ok('both are depth-0 roots (no cross-corrId nesting)', reqExec.depth === 0 && seExec.depth === 0 && reqExec.parentId === null && seExec.parentId === null);

// ── MFT: N+1 detection (database retrieves inside a loop) ──
console.log('\nMicroflow Tracer: N+1 detection');
const mftDetectN1 = global.mftDetectNPlusOne;
const n1Log = [
  '2026-07-17T11:00:00.000000 ' + P + '  DEBUG - MicroflowEngine: [n1-1] Starting execution of microflow \'Mod.LoopFlow\'',
  // Loop setup
  '2026-07-17T11:00:00.100000 ' + P + '  TRACE - MicroflowEngine: [n1-1] Executing activity: {"current_activity":{"type":"RetrieveByXPath","caption":"Get List"},"name":"Mod.LoopFlow","type":"Microflow"}',
  // Iteration 1
  '2026-07-17T11:00:00.200000 ' + P + '  TRACE - MicroflowEngine: [n1-1] Executing activity: {"current_activity":{"type":"ListLoop","caption":""},"name":"Mod.LoopFlow","type":"Microflow"}',
  '2026-07-17T11:00:00.250000 ' + P + '  TRACE - MicroflowEngine: [n1-1] Executing activity: {"current_activity":{"type":"RetrieveByXPath","caption":"Get Details"},"name":"Mod.LoopFlow","type":"Microflow"}',
  // Iteration 2
  '2026-07-17T11:00:00.300000 ' + P + '  TRACE - MicroflowEngine: [n1-1] Executing activity: {"current_activity":{"type":"ListLoop","caption":""},"name":"Mod.LoopFlow","type":"Microflow"}',
  '2026-07-17T11:00:00.350000 ' + P + '  TRACE - MicroflowEngine: [n1-1] Executing activity: {"current_activity":{"type":"RetrieveByXPath","caption":"Get Details"},"name":"Mod.LoopFlow","type":"Microflow"}',
  // Iteration 3
  '2026-07-17T11:00:00.400000 ' + P + '  TRACE - MicroflowEngine: [n1-1] Executing activity: {"current_activity":{"type":"ListLoop","caption":""},"name":"Mod.LoopFlow","type":"Microflow"}',
  '2026-07-17T11:00:00.450000 ' + P + '  TRACE - MicroflowEngine: [n1-1] Executing activity: {"current_activity":{"type":"RetrieveByXPath","caption":"Get Details"},"name":"Mod.LoopFlow","type":"Microflow"}',
  // Consecutive DB calls without loop (e.g. poor man's unrolled loop) -> should trigger pass 2
  '2026-07-17T11:00:00.500000 ' + P + '  TRACE - MicroflowEngine: [n1-1] Executing activity: {"current_activity":{"type":"RetrieveByAssociation","caption":"Get Children"},"name":"Mod.LoopFlow","type":"Microflow"}',
  '2026-07-17T11:00:00.550000 ' + P + '  TRACE - MicroflowEngine: [n1-1] Executing activity: {"current_activity":{"type":"RetrieveByAssociation","caption":"Get Children"},"name":"Mod.LoopFlow","type":"Microflow"}',
  '2026-07-17T11:00:00.600000 ' + P + '  TRACE - MicroflowEngine: [n1-1] Executing activity: {"current_activity":{"type":"RetrieveByAssociation","caption":"Get Children"},"name":"Mod.LoopFlow","type":"Microflow"}',
  '2026-07-17T11:00:00.700000 ' + P + '  DEBUG - MicroflowEngine: [n1-1] Finished execution of microflow \'Mod.LoopFlow\''
].join('\n');
const n1Out = mftExtract(parser.parse(n1Log).records);
const n1Count = mftDetectN1(n1Out.executions);
eq('detector finds 2 patterns', n1Count, 2);
const n1Exec = n1Out.executions[0];
ok('execution has nPlusOne array', Array.isArray(n1Exec.nPlusOne) && n1Exec.nPlusOne.length === 2);
const loopN1 = n1Exec.nPlusOne.find(d => d.type === 'RetrieveByXPath' && d.caption === 'Get Details');
ok('loop-aware pass detects 3 iterations', loopN1 && loopN1.count === 3);
ok('loop-aware pass sums duration (150ms total)', loopN1 && Math.abs(loopN1.totalMs - 150) < 0.001);
const consecN1 = n1Exec.nPlusOne.find(d => d.type === 'RetrieveByAssociation' && d.caption === 'Get Children');
ok('consecutive pass detects 3 calls', consecN1 && consecN1.count === 3);

// Shape B (the dominant real-world case): the loop body calls a sub-microflow
// that retrieves. Each iteration's sub-microflow is a SEPARATE child execution
// holding one retrieve, so detection must aggregate over the loop owner's subtree.
const n1SubLog = [
  '2026-07-17T11:10:00.000000 ' + P + '  DEBUG - MicroflowEngine: [n1-2] Starting execution of microflow \'Mod.Parent\'',
  '2026-07-17T11:10:00.050000 ' + P + '  TRACE - MicroflowEngine: [n1-2] Executing activity: {"current_activity":{"type":"ListLoop","caption":""},"name":"Mod.Parent","type":"Microflow"}',
  // iteration 1 → sub-microflow retrieves once
  '2026-07-17T11:10:00.100000 ' + P + '  DEBUG - MicroflowEngine: [n1-2] Starting execution of microflow \'Mod.Child\'',
  '2026-07-17T11:10:00.150000 ' + P + '  TRACE - MicroflowEngine: [n1-2] Executing activity: {"current_activity":{"type":"RetrieveByXPath","caption":"Get One"},"name":"Mod.Child","type":"Microflow"}',
  '2026-07-17T11:10:00.180000 ' + P + '  DEBUG - MicroflowEngine: [n1-2] Finished execution of microflow \'Mod.Child\'',
  // iteration 2
  '2026-07-17T11:10:00.200000 ' + P + '  DEBUG - MicroflowEngine: [n1-2] Starting execution of microflow \'Mod.Child\'',
  '2026-07-17T11:10:00.250000 ' + P + '  TRACE - MicroflowEngine: [n1-2] Executing activity: {"current_activity":{"type":"RetrieveByXPath","caption":"Get One"},"name":"Mod.Child","type":"Microflow"}',
  '2026-07-17T11:10:00.280000 ' + P + '  DEBUG - MicroflowEngine: [n1-2] Finished execution of microflow \'Mod.Child\'',
  // iteration 3
  '2026-07-17T11:10:00.300000 ' + P + '  DEBUG - MicroflowEngine: [n1-2] Starting execution of microflow \'Mod.Child\'',
  '2026-07-17T11:10:00.350000 ' + P + '  TRACE - MicroflowEngine: [n1-2] Executing activity: {"current_activity":{"type":"RetrieveByXPath","caption":"Get One"},"name":"Mod.Child","type":"Microflow"}',
  '2026-07-17T11:10:00.380000 ' + P + '  DEBUG - MicroflowEngine: [n1-2] Finished execution of microflow \'Mod.Child\'',
  '2026-07-17T11:10:00.400000 ' + P + '  DEBUG - MicroflowEngine: [n1-2] Finished execution of microflow \'Mod.Parent\''
].join('\n');
const n1SubOut = mftExtract(parser.parse(n1SubLog).records);
mftDetectN1(n1SubOut.executions);
const parentExec = n1SubOut.executions.find(e => e.name === 'Mod.Parent');
const childExecs = n1SubOut.executions.filter(e => e.name === 'Mod.Child');
const subHit = parentExec && parentExec.nPlusOne.find(d => d.type === 'RetrieveByXPath' && d.caption === 'Get One');
ok('subtree pass flags loop owner (retrieve in sub-microflow ×3)', subHit && subHit.count === 3);
ok('sub-microflow children are not individually flagged', childExecs.length === 3 && childExecs.every(e => e.nPlusOne.length === 0));

// ── MFT: scheduled events & background monitor ──
// A "run" is a depth-0 execution on a UUID correlation ID. Request-driven work
// (numeric corrId) and sub-microflows must stay out of the aggregation.
console.log('\nMicroflow Tracer: background monitor');
const mftBackground = global.mftBuildBackgroundView;
const U = n => String(n).repeat(8) + '-' + String(n).repeat(4) + '-4' + String(n).repeat(3) + '-8' + String(n).repeat(3) + '-' + String(n).repeat(12);
const bgStart = (ts, id, flow) => '2026-07-17T' + ts + ' ' + P + '  DEBUG - MicroflowEngine: [' + id + '] Starting execution of microflow \'' + flow + '\'';
const bgEnd = (ts, id, flow) => '2026-07-17T' + ts + ' ' + P + '  DEBUG - MicroflowEngine: [' + id + '] Finished execution of microflow \'' + flow + '\'';
const bgLog = [
  // four nightly runs, five minutes apart, getting slower over time
  bgStart('10:00:00.000000', U(1), 'Ops.Nightly'),
  bgStart('10:00:00.020000', U(1), 'Ops.Sub'),          // sub-microflow — not a run
  bgEnd('10:00:00.060000', U(1), 'Ops.Sub'),
  bgEnd('10:00:00.100000', U(1), 'Ops.Nightly'),
  bgStart('10:05:00.000000', U(2), 'Ops.Nightly'),
  bgEnd('10:05:00.120000', U(2), 'Ops.Nightly'),
  bgStart('10:10:00.000000', U(3), 'Ops.Nightly'),
  bgEnd('10:10:00.400000', U(3), 'Ops.Nightly'),
  bgStart('10:15:00.000000', U(4), 'Ops.Nightly'),
  bgEnd('10:15:00.500000', U(4), 'Ops.Nightly'),
  // same microflow, request-driven — must not be counted as a background run
  bgStart('10:16:00.000000', '1784268324436-46', 'Ops.Nightly'),
  bgEnd('10:16:00.900000', '1784268324436-46', 'Ops.Nightly'),
  // two runs of the same event overlapping by 5 s
  bgStart('10:20:00.000000', U(5), 'Ops.Overlap'),
  bgStart('10:20:05.000000', U(6), 'Ops.Overlap'),
  bgEnd('10:20:10.000000', U(5), 'Ops.Overlap'),
  bgEnd('10:20:12.000000', U(6), 'Ops.Overlap'),
  // started, never finished (log window ends mid-run)
  bgStart('10:30:00.000000', U(7), 'Ops.Stuck')
].join('\n');
const bgOut = mftBackground(mftExtract(parser.parse(bgLog).records).executions, []);
eq('background: three events aggregated', bgOut.events.length, 3);
eq('background: request-driven runs excluded from events', bgOut.runs, 7);
eq('background: request-driven runs counted separately', bgOut.requestRuns, 1);
const bgNightly = bgOut.events.find(e => e.name === 'Ops.Nightly');
eq('background: four runs of the nightly event', bgNightly.runs, 4);
ok('background: sub-microflow is not an event of its own', !bgOut.events.some(e => e.name === 'Ops.Sub'));
ok('background: min/median/max durations', bgNightly.minMs === 100 && bgNightly.medianMs === 260 && bgNightly.maxMs === 500,
  bgNightly.minMs + '/' + bgNightly.medianMs + '/' + bgNightly.maxMs);
eq('background: median start-to-start interval is the schedule', bgNightly.medianIntervalMs, 300000);
eq('background: slowing runs trend up', bgNightly.trend.dir, 'up');
ok('background: trend compares half-medians (110 → 450)',
  bgNightly.trend.firstHalfMs === 110 && bgNightly.trend.secondHalfMs === 450,
  bgNightly.trend.firstHalfMs + ' → ' + bgNightly.trend.secondHalfMs);
const bgOverlap = bgOut.events.find(e => e.name === 'Ops.Overlap');
eq('background: overlapping runs detected', bgOverlap.overlapCount, 1);
eq('background: overlap duration measured', bgOverlap.overlaps[0].overlapMs, 5000);
eq('background: overlaps totalled across events', bgOut.overlapCount, 1);
const bgStuck = bgOut.events.find(e => e.name === 'Ops.Stuck');
ok('background: unfinished run has no duration stats', bgStuck.unfinished === 1 && bgStuck.medianMs === null);
eq('background: unfinished totalled across events', bgOut.unfinished, 1);
ok('background: events sorted by run count', bgOut.events[0].name === 'Ops.Nightly');
// A single run cannot trend and must not pretend to (data-driven rule).
ok('background: a single run yields no trend', bgStuck.trend === null);
ok('background: a single run yields no interval', bgStuck.medianIntervalMs === null);
// Empty input: no invented events, and the caller can tell there was no engine data.
const bgEmpty = mftBackground([], []);
ok('background: empty input yields no events and no engine data',
  bgEmpty.events.length === 0 && bgEmpty.hasEngineData === false && bgEmpty.errors.length === 0);

// Fallback for INFO-only logs: MicroflowEngine is silent, but background failures
// are not — those are worth surfacing instead of an empty view.
const bgErrLog = [
  '2026-07-17T12:00:00.000000 ' + P + '  ERROR - TaskQueue: Task MDM.UPD_UserData failed',
  '2026-07-17T12:00:01.000000 ' + P + '  ERROR - TaskQueue: Task MDM.UPD_UserData failed',
  '2026-07-17T12:00:02.000000 ' + P + '  WARNING - TaskQueue: Retrying task',
  '2026-07-17T12:00:03.000000 ' + P + '  ERROR - Core: Error executing scheduled event Ops.Nightly',
  '2026-07-17T12:00:04.000000 ' + P + '  ERROR - Jetty: Unrelated request failure'
].join('\n');
const bgErr = mftBackground([], parser.parse(bgErrLog).records);
eq('background fallback: two node groups (queue + scheduled event)', bgErr.errors.length, 2);
eq('background fallback: repeated task failures counted', bgErr.errors[0].count, 2);
eq('background fallback: node name kept', bgErr.errors[0].node, 'TaskQueue');
ok('background fallback: warnings are not failures', !bgErr.errors.some(e => e.count > 2));
ok('background fallback: unrelated ERROR nodes ignored', !bgErr.errors.some(e => e.node === 'Jetty'));
ok('background fallback: scheduled-event ERROR matched by message, not node',
  bgErr.errors.some(e => e.node === 'Core' && e.count === 1));
ok('background fallback: first/last timestamps kept',
  bgErr.errors[0].firstTs === '2026-07-17T12:00:00.000000' && bgErr.errors[0].lastTs === '2026-07-17T12:00:01.000000');

// Reference: real Mendix Cloud log with MicroflowEngine DEBUG+TRACE (local only)
const refTrace = path.join(__dirname, '..', '_local_assets', 'FilesForTest', 'MxCloudApp_RealLogsWithTrace.txt');
if (fs.existsSync(refTrace)) {
  const text = fs.readFileSync(refTrace, 'utf8');
  const recs2 = parser.parse(text).records;
  const t0 = Date.now();
  const out = mftExtract(recs2);
  const ms = Date.now() - t0;
  eq('reference trace: 11137 executions', out.executions.length, 11137);
  const baseNames = new Set(out.executions.map(e => e.name.replace(/\.nested\..*$/, '')));
  eq('reference trace: 254 unique microflows', baseNames.size, 254);
  // Both corrId shapes exist in the wild: numeric (1784268324436-46, request-driven)
  // and UUID (scheduled events / background jobs) — 669 total in this file
  eq('reference trace: 669 correlation IDs', out.stats.corrIds, 669);
  eq('reference trace: 76204 activity records', out.stats.activityRecords, 76204);
  const finished = out.executions.filter(e => e.finished).length;
  console.log('    (' + (text.length / (1024 * 1024)).toFixed(0) + ' MB → ' + out.executions.length + ' executions (' + finished + ' finished) in ' + ms + ' ms)');
  // N+1 detection must fire on the real log (regression guard: the split loop
  // owner delegates its retrieves to sub-microflows, so subtree aggregation is
  // required). This file contains a textbook 3040× RetrieveByXPath in a ListLoop.
  const realN1 = mftDetectN1(out.executions);
  ok('reference trace: N+1 detector fires on real data', realN1 > 0, 'got ' + realN1);
  const worst = out.executions
    .filter(e => e.nPlusOne && e.nPlusOne.length)
    .map(e => e.nPlusOne[0].count)
    .sort((a, b) => b - a)[0] || 0;
  ok('reference trace: worst offender is a large loop (≥1000×)', worst >= 1000, 'worst=' + worst);
  // Background monitor on real data: 312 background runs across 22 distinct
  // events, against 357 request-driven ones — the corrId split is what separates
  // them, and getting it wrong shows up immediately in these counts.
  const bgRef = global.mftBuildBackgroundView(out.executions, recs2);
  eq('reference trace: 312 background runs', bgRef.runs, 312);
  eq('reference trace: 357 request-driven runs', bgRef.requestRuns, 357);
  eq('reference trace: 22 background events', bgRef.events.length, 22);
  const qStats = bgRef.events.find(e => e.name === 'Queues.QueuesStats');
  eq('reference trace: Queues.QueuesStats ran 91 times', qStats.runs, 91);
  ok('reference trace: its median interval is the 5-minute schedule',
    Math.abs(qStats.medianIntervalMs - 300000) < 1000, 'got ' + qStats.medianIntervalMs);
  ok('reference trace: overlapping background runs found', bgRef.overlapCount === 4, 'got ' + bgRef.overlapCount);
} else {
  console.log('  – reference trace log absent, skipped (PII: never committed)');
}

// ── Log Query Extractor aggregation (public/js/tools/log-query-extractor.js) ──
// The module attaches its pure extractor to window; pointing `window` at the global
// (already done above for MFT) makes lqeExtractQueries requireable in Node.
console.log('\nLog Query Extractor aggregation');
require(ENGINE + 'queries.js');
const lqeExtract = global.lqeExtractQueries;

const TR = '  TRACE - ';
const lqeLog = [
  // Query A: XPath source + SQL + params + result (row count) + linked plan (via xpathId)
  '2026-07-17T10:00:00.000000 ' + P + TR + 'ConnectionBus_Retrieve: Incoming query of type XPath: [abc001] //Sales.Order[Status=\'Open\']',
  '2026-07-17T10:00:00.010000 ' + P + TR + 'ConnectionBus_Retrieve: SQL@aaa111(T1-Cff01): SELECT "sales$order"."id" FROM "sales$order" WHERE "status" = ?',
  '2026-07-17T10:00:00.020000 ' + P + TR + 'ConnectionBus_Retrieve: SQL@aaa111(T1-Cff01): Select params: \'Open\'',
  '2026-07-17T10:00:00.030000 ' + P + TR + 'ConnectionBus_Retrieve: SQL@aaa111(T1-Cff01): [abc001] Data table (3 row(s))',
  '2026-07-17T10:00:00.040000 ' + P + TR + 'DataStorage_QueryPlan: Query Plan: [abc001] [{"Plan":{"Node Type":"Seq Scan","Total Cost":12.5},"Execution Time":4.2,"Planning Time":0.3}]',
  // Query B: identical statement, different bound value → same signature as A (N+1 duplicate)
  '2026-07-17T10:00:00.050000 ' + P + TR + 'ConnectionBus_Retrieve: SQL@aaa222(T1-Cff01): SELECT "sales$order"."id" FROM "sales$order" WHERE "status" = ?',
  '2026-07-17T10:00:00.060000 ' + P + TR + 'ConnectionBus_Retrieve: SQL@aaa222(T1-Cff01): [def002] Data table (1 row(s))',
  // Query C: UPDATE with inline numeric literals → normalized to ? in the signature.
  // Its own result line carries an xpathId (no plan logged for it), so it is NOT
  // eligible for the unlinked plan below — that must flow to query D instead.
  '2026-07-17T10:00:00.070000 ' + P + TR + 'ConnectionBus_Update: SQL@ccc333(T1-Cff01): UPDATE "sales$order" SET "amount" = 5 WHERE "id" = 42',
  '2026-07-17T10:00:00.080000 ' + P + TR + 'ConnectionBus_Update: SQL@ccc333(T1-Cff01): [aa99bb] Data table (1 row(s))',
  // Slow-query WARNING — full SQL + duration at default log levels, no TRACE needed
  '2026-07-17T10:00:01.000000 ' + P + '  WARNING - ConnectionBus_Queries: Query executed in 3 seconds and 100 milliseconds: SELECT "big"."id" FROM "big"',
  // Query D: no xpathId — receives the unlinked plan below (FIFO, first eligible query wins)
  '2026-07-17T10:00:02.000000 ' + P + TR + 'ConnectionBus_Retrieve: SQL@ddd444(T1-Cff01): SELECT "cust"."name" FROM "cust"',
  '2026-07-17T10:00:02.010000 ' + P + TR + 'DataStorage_QueryPlan: Query Plan: [{"Plan":{"Node Type":"Index Scan","Total Cost":3.1},"Execution Time":1.1}]',
  // Query E: the two shapes real logs use for bound values, which the synthetic
  // fixtures above do not cover — a JSON document as a single parameter (its own
  // commas must not split it) and a third value spilled onto its own line, which
  // the runtime writes WITHOUT the colon after the (Tx-Cyy) part.
  '2026-07-17T10:00:03.000000 ' + P + TR + 'ConnectionBus_Update: SQL@eee555(T1-Cff01): UPDATE "system$backgroundjob" SET "endtime" = ?, "result" = ? WHERE "id" = ?',
  '2026-07-17T10:00:03.010000 ' + P + TR + 'ConnectionBus_Update: SQL@eee555(T1-Cff01): Update params 1-2: 2026-07-17 10:00:03.000, {"body":{"changes":{"1":{"Name":{"value":"a, b"}},"2":{"Name":{"value":"c"}}}}}',
  '2026-07-17T10:00:03.020000 ' + P + TR + 'ConnectionBus_Update: SQL@eee555(T1-Cff01) Update param 3: 7318349405133931'
].join('\n');

const lqeRecs = parser.parse(lqeLog).records;
eq('LQE fixture parsed as live', parser.parse(lqeLog).format, 'live');
const qs = lqeExtract(lqeRecs);
eq('six queries extracted', qs.length, 6);
const qById = id => qs.find(q => q.sqlId === id);
const qA = qById('aaa111'), qB = qById('aaa222'), qC = qById('ccc333'), qD = qById('ddd444');
const qSlow = qs.find(q => q.slowWarning);

// Statement-type classification
eq('SELECT classified', qA.type, 'SELECT');
eq('UPDATE classified', qC.type, 'UPDATE');

// Duplicate detection (N+1): normalized signature groups A and B
eq('duplicate SELECTs share a signature', qA.signature, qB.signature);
ok('both duplicates report dupCount 2', qA.dupCount === 2 && qB.dupCount === 2, 'A=' + qA.dupCount + ' B=' + qB.dupCount);
eq('non-duplicated query has dupCount 1', qC.dupCount, 1);
ok('numeric literals normalized to ? in signature', qC.signature.indexOf('5') === -1 && qC.signature.indexOf('42') === -1, qC.signature);

// Plan linking via xpathId — duration/cost/planning time lifted out of the plan JSON
ok('plan linked by xpathId', qA.xpathId === 'abc001' && qA.queryPlan.length > 0);
eq('execution time from linked plan', qA.duration, '4.200 ms');
eq('total cost from linked plan', qA.cost, 12.5);
eq('planning time from linked plan', qA.planningTime, '0.300 ms');
eq('row count captured from result line', qA.rows, '3');
ok('params parsed off the Select-params line', qA.params.length === 1 && qA.params[0] === '\'Open\'', JSON.stringify(qA.params));

// Bound values as real logs write them (see query E). Both shapes used to be
// mishandled: the JSON document was split on its internal commas into dozens of
// fragments, and the spilled third value was dropped with its whole line because
// that line has no colon after (Tx-Cyy) — leaving a bare `?` in the rebuilt SQL.
const qE = qById('eee555');
eq('spilled "param 3" line is not dropped', qE.params.length, 3);
eq('a JSON parameter survives its own commas whole', qE.params[1],
  '{"body":{"changes":{"1":{"Name":{"value":"a, b"}},"2":{"Name":{"value":"c"}}}}}');
eq('the value after the JSON one is still its own parameter', qE.params[2], '7318349405133931');
eq('every placeholder has a value', (qE.sql.match(/\?/g) || []).length, qE.params.length);

// Unlinked plan (no xpathId) assigned FIFO to the first eligible query; slow warnings never consume one
ok('unlinked plan assigned to first plan-less query', qD.duration === '1.100 ms' && qD.cost === 3.1, qD.duration + '/' + qD.cost);
ok('duplicate B without its own plan stays unlinked', qB.queryPlan === '' && qB.duration === null);

// Slow-query warning ingestion
ok('slow-query warning ingested', !!qSlow && qSlow.duration === '3100 ms', qSlow && qSlow.duration);
ok('slow-query warning did not swallow a plan', qSlow.queryPlan === '');

// ── "By statement" aggregate (wave 15) ───────────────────────────────────────
// Folds executions onto the signature the duplicate detector already computes,
// so the question "which statement costs the most in total" becomes answerable.
// The contract that matters: a total is only ever summed from the executions the
// log actually timed, and a group with none reports null — not 0 ms.
const lqeAgg = global.lqeAggregateByStatement;
const groups = lqeAgg(qs);
eq('by statement: 6 executions fold into 5 statements', groups.length, 5);

const gDup = groups.find(g => g.count === 2);
ok('by statement: A and B share one group', !!gDup);
eq('by statement: duplicate group counts both executions', gDup.count, 2);
eq('by statement: only the timed execution feeds the total', gDup.timedCount, 1);
ok('by statement: total is the measured 4.2 ms, not doubled', Math.abs(gDup.sumMs - 4.2) < 1e-9, gDup.sumMs);
ok('by statement: average is over timed executions only', Math.abs(gDup.avgMs - 4.2) < 1e-9, gDup.avgMs);
eq('by statement: worst execution is the timed one', gDup.worst.sqlId, 'aaa111');

const gUntimed = groups.find(g => g.sample.sqlId === 'ccc333');
eq('by statement: an untimed statement reports null total, not zero', gUntimed.sumMs, null);
eq('by statement: an untimed statement reports null average', gUntimed.avgMs, null);
eq('by statement: an untimed statement reports null max', gUntimed.maxMs, null);
eq('by statement: an untimed group is still represented by its first execution', gUntimed.worst.sqlId, 'ccc333');

eq('by statement: default order is total cost first', groups[0].sumMs, 3100);
eq('by statement: the slow warning is counted as one', groups[0].slowCount, 1);
eq('by statement: statements without a slow warning report zero', gDup.slowCount, 0);
eq('by statement: empty input yields no groups', lqeAgg([]).length, 0);

// ── REST & WS Extractor pairing (public/js/tools/ws-rest-extractor.js) ───────
// Written test-first (wave 4). The pairing contract: requests and responses are
// matched FIFO per (logNode + method + URL); overlapping in-flight requests with
// the same key get an `uncertain` flag because FIFO is an assumption, not a fact.
// The interleave fixture reproduces a REAL case from MxCloudApp_RealLogsWithTrace.txt
// (two POSTs to the same endpoint in flight at once, lines 105699/105704).
console.log('\nREST & WS Extractor pairing');
require(ENGINE + 'restws.js');
const wsreExtract = global.wsreExtractCalls;

const wsreLog = [
  // (1) Consume happy path — anchor gives corrId + microflow, timeout captured,
  // headers + JSON bodies parsed, duration from the request→response delta.
  '2026-07-17T12:00:00.000000 ' + P + TR + 'MicroflowEngine: [900-1] Executing activity: {"current_activity":{"caption":"Call REST (POST)","type":"CallRest"},"name":"Mod.SendData","type":"Microflow"}',
  '2026-07-17T12:00:00.001000 ' + P + TR + 'REST Consume: Creating http client for api.example.com with timeout = 10s',
  '2026-07-17T12:00:00.001500 ' + P + '  DEBUG - REST Consume: Using a timeout of 10 seconds',
  '2026-07-17T12:00:00.002000 ' + P + TR + 'REST Consume: Request content for POST request to https://api.example.com/rest/send/v1/data HTTP/1.1',
  'Content-Type: application/json',
  'Authorization: (omitted)',
  '{"RequestID":1,"Code":"A"}',
  '2026-07-17T12:00:00.502000 ' + P + TR + 'REST Consume: Response content for POST request to https://api.example.com/rest/send/v1/data',
  'HTTP/1.1 200 OK',
  'Content-Type: application/json;charset=utf-8',
  '{"ok":true}',

  // (2) REAL interleave case — two calls to the SAME method+URL in flight at once
  // (each with its own CallRest anchor), then both responses. FIFO must pair
  // req1→resp1 / req2→resp2 and BOTH calls must carry the uncertainty flag.
  '2026-07-17T12:01:00.000000 ' + P + TR + 'MicroflowEngine: [3769f9ea-dd81-4306-8f0e-121a8af66755] Executing activity: {"current_activity":{"caption":"Call REST (POST)","type":"CallRest"},"name":"MyTT.SendShipment","type":"Microflow"}',
  '2026-07-17T12:01:00.004000 ' + P + TR + 'MicroflowEngine: [a81f0323-947d-48c3-98ae-77a671cc8bbf] Executing activity: {"current_activity":{"caption":"Call REST (POST)","type":"CallRest"},"name":"MyTT.SendShipment","type":"Microflow"}',
  '2026-07-17T12:01:00.006000 ' + P + TR + 'REST Consume: Request content for POST request to https://api.example.com/rest/ship/v1/shipment HTTP/1.1',
  'Content-Type: application/json',
  '{"shipment":1}',
  '2026-07-17T12:01:00.007000 ' + P + TR + 'REST Consume: Request content for POST request to https://api.example.com/rest/ship/v1/shipment HTTP/1.1',
  'Content-Type: application/json',
  '{"shipment":2}',
  '2026-07-17T12:01:01.148000 ' + P + TR + 'REST Consume: Response content for POST request to https://api.example.com/rest/ship/v1/shipment',
  'HTTP/1.1 200 OK',
  '{"received":1}',
  '2026-07-17T12:01:01.149000 ' + P + TR + 'REST Consume: Response content for POST request to https://api.example.com/rest/ship/v1/shipment',
  'HTTP/1.1 500 Internal Server Error',
  '{"received":2}',

  // (3) Consume without a response (client timeout suspect — 10s timeout known)
  '2026-07-17T12:02:00.000000 ' + P + TR + 'REST Consume: Creating http client for dead.example.com with timeout = 10s',
  '2026-07-17T12:02:00.001000 ' + P + TR + 'REST Consume: Request content for GET request to https://dead.example.com/rest/ping HTTP/1.1',
  'Accept: application/json',

  // (4) SOAP consume (WebServices) — SOAPAction header, XML bodies, own FIFO key
  '2026-07-17T12:03:00.000000 ' + P + TR + 'MicroflowEngine: [900-2] Executing activity: {"current_activity":{"caption":"Call web service \'getHeader\'","type":"CallWebservice"},"name":"Integration.GetInvoiceData","type":"Microflow"}',
  '2026-07-17T12:03:00.050000 ' + P + TR + 'WebServices: Created soap request:',
  '<soapenv:Envelope><soapenv:Body><ns1:HeaderRequest><compCode>PL14</compCode></ns1:HeaderRequest></soapenv:Body></soapenv:Envelope>',
  '2026-07-17T12:03:00.060000 ' + P + TR + 'WebServices: Creating http client for soap.example.com with timeout = 10s',
  '2026-07-17T12:03:00.100000 ' + P + TR + 'WebServices: Request content for POST request to https://soap.example.com/Invoices/InvoiceService HTTP/1.1',
  'SOAPAction: "urn:getHeader"',
  'Content-Type: text/xml; charset=UTF-8',
  '<soapenv:Envelope><soapenv:Body><ns1:HeaderRequest><compCode>PL14</compCode></ns1:HeaderRequest></soapenv:Body></soapenv:Envelope>',
  '2026-07-17T12:03:00.433000 ' + P + TR + 'WebServices: Response content for POST request to https://soap.example.com/Invoices/InvoiceService',
  'HTTP/1.1 200 OK',
  'content-type: text/xml; charset=utf-8',
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<soapenv:Envelope><soapenv:Body><HeaderResponse/></soapenv:Body></soapenv:Envelope>',

  // (5) REST Publish matched operation — routing noise must be ignored, operation
  // captured, response 200 with body, duration = incoming→outgoing delta
  '2026-07-17T12:04:00.000000 ' + P + TR + 'REST Publish: Incoming request from 127.0.0.1: POST http://app.example.com/rest/calculator/v1/httpRequest?request=42&cost=0',
  'Accept: application/json',
  'traceparent: 00-68e15ede94f821a5b33f1cfd4433e811-d6de9389113ea824-00',
  'Content-Length: 0',
  '2026-07-17T12:04:00.001000 ' + P + TR + 'REST Publish: Path \'calculator/v1/httpRequest\' did not match \'getquotation/quotation\', continuing...',
  '2026-07-17T12:04:00.002000 ' + P + TR + 'REST Publish: Executing operation POST rest/calculator/v1/httpRequest',
  '2026-07-17T12:04:00.003000 ' + P + TR + 'REST Publish: Query parameter \'request\' (microflow parameter \'request\') has value \'42\'',
  '2026-07-17T12:04:00.356000 ' + P + TR + 'REST Publish: Outgoing response:',
  'HTTP/1.1 200',
  'Cache-Control: no-store',
  'Total cost error - Please check the information',

  // (6) REST Publish unmatched → 404 close with reason
  '2026-07-17T12:05:00.000000 ' + P + TR + 'REST Publish: Incoming request from 127.0.0.1: GET http://app.example.com/rest/default/V1/guest-carts',
  'Accept: */*',
  '2026-07-17T12:05:00.002000 ' + P + '  DEBUG - REST Publish: Responding with 404 Not Found, because no operation matches http://app.example.com/rest/default/V1/guest-carts',

  // (7) WS Publish (incoming SOAP) — service name, per-record headers, request data
  // continuation, chunked response, Finished closes the call
  '2026-07-17T12:06:00.000000 ' + P + '  DEBUG - WebServices: Incoming web service request from 127.0.0.1 for service \'AppUser_Create_Update\'',
  '2026-07-17T12:06:00.000500 ' + P + TR + 'WebServices: Incoming web service request data: ',
  '<soapenv:Envelope><soapenv:Body><ns1:Operation><User><Name>x@example.com</Name></User></ns1:Operation></soapenv:Body></soapenv:Envelope>',
  '2026-07-17T12:06:00.001000 ' + P + TR + 'WebServices: Header soapaction: "http://www.example.com/Operation"',
  '2026-07-17T12:06:00.001500 ' + P + TR + 'WebServices: Header Content-Type: text/xml; charset=UTF-8',
  '2026-07-17T12:06:00.363000 ' + P + TR + 'WebServices: [Operation chunk: 1] <?xml version=\'1.0\' encoding=\'UTF-8\'?><soap:Envelope><soap:Body><tns:OperationResponse><Error>false</Error></tns:OperationResponse></soap:Body></soap:Envelope>',
  '2026-07-17T12:06:00.364000 ' + P + '  DEBUG - WebServices: Finished handling web service request for service \'AppUser_Create_Update\'',
  '2026-07-17T12:06:00.368000 ' + P + '  DEBUG - WebServices: Web service request from 127.0.0.1 finished'
].join('\n');

const wsreRecs = parser.parse(wsreLog).records;
const wsreOut = wsreExtract(wsreRecs);
const calls = wsreOut.calls;
eq('8 calls extracted', calls.length, 8);

// (1) Consume happy path
const c1 = calls.find(c => c.url && c.url.indexOf('/rest/send/v1/data') !== -1);
ok('consume call found', !!c1);
eq('consume node', c1.node, 'REST Consume');
eq('consume direction', c1.direction, 'out');
eq('consume method', c1.method, 'POST');
eq('consume status 200', c1.status, 200);
ok('consume duration 500 ms', Math.abs(c1.durationMs - 500) < 0.001, 'got ' + c1.durationMs);
eq('consume timeout captured', c1.timeoutSec, 10);
ok('consume request headers parsed', c1.requestHeaders.some(h => h.name === 'Content-Type' && h.value === 'application/json'), JSON.stringify(c1.requestHeaders));
ok('consume response headers parsed', c1.responseHeaders.some(h => h.name.toLowerCase() === 'content-type'), JSON.stringify(c1.responseHeaders));
eq('consume request body', c1.requestBody, '{"RequestID":1,"Code":"A"}');
eq('consume response body', c1.responseBody, '{"ok":true}');
ok('consume not flagged uncertain', !c1.uncertain);
eq('anchor corrId attached', c1.corrId, '900-1');
eq('anchor microflow attached', c1.microflow, 'Mod.SendData');

// (2) Interleave: FIFO per (method+URL) + uncertainty flag on both
const ship = calls.filter(c => c.url && c.url.indexOf('/rest/ship/v1/shipment') !== -1);
eq('two interleaved calls extracted', ship.length, 2);
eq('FIFO: first request gets first response', ship[0].responseBody, '{"received":1}');
eq('FIFO: second request gets second response', ship[1].responseBody, '{"received":2}');
eq('FIFO: first status 200', ship[0].status, 200);
eq('FIFO: second status 500', ship[1].status, 500);
ok('both interleaved calls flagged uncertain', ship[0].uncertain && ship[1].uncertain);
eq('interleave: first anchor corrId', ship[0].corrId, '3769f9ea-dd81-4306-8f0e-121a8af66755');
eq('interleave: second anchor corrId', ship[1].corrId, 'a81f0323-947d-48c3-98ae-77a671cc8bbf');
ok('durations from own pair (1142/1142 ms)', Math.abs(ship[0].durationMs - 1142) < 0.001 && Math.abs(ship[1].durationMs - 1142) < 0.001,
  ship[0].durationMs + '/' + ship[1].durationMs);

// (3) Unanswered request → no response, timeout suspect
const dead = calls.find(c => c.url && c.url.indexOf('dead.example.com') !== -1);
ok('unanswered call kept', !!dead && dead.status === null);
ok('unanswered call has no duration', dead.durationMs === null);
ok('unanswered call flagged as timeout suspect', dead.timeoutSuspect === true);

// (4) SOAP consume
const soap = calls.find(c => c.node === 'WebServices' && c.direction === 'out');
ok('SOAP consume found', !!soap);
eq('SOAP consume kind', soap.kind, 'soap');
eq('SOAP status 200', soap.status, 200);
ok('SOAP duration 333 ms', Math.abs(soap.durationMs - 333) < 0.001, 'got ' + soap.durationMs);
ok('SOAPAction header kept', soap.requestHeaders.some(h => h.name === 'SOAPAction'));
ok('SOAP request body is the envelope', soap.requestBody.indexOf('<soapenv:Envelope>') === 0);
ok('SOAP response body includes xml prolog line', soap.responseBody.indexOf('<?xml') === 0 && soap.responseBody.indexOf('HeaderResponse') !== -1);
eq('CallWebservice anchor corrId', soap.corrId, '900-2');
eq('CallWebservice anchor microflow', soap.microflow, 'Integration.GetInvoiceData');

// (5) REST Publish matched
const pub = calls.find(c => c.node === 'REST Publish' && c.status === 200);
ok('publish call found', !!pub);
eq('publish direction', pub.direction, 'in');
eq('publish method', pub.method, 'POST');
eq('publish operation captured', pub.operation, 'rest/calculator/v1/httpRequest');
ok('publish routing noise not in headers', !pub.requestHeaders.some(h => /did not match/.test(h.value)));
ok('publish request headers parsed', pub.requestHeaders.some(h => h.name === 'traceparent'));
eq('publish response body', pub.responseBody, 'Total cost error - Please check the information');
ok('publish duration 356 ms', Math.abs(pub.durationMs - 356) < 0.001, 'got ' + pub.durationMs);

// (6) REST Publish 404
const pub404 = calls.find(c => c.node === 'REST Publish' && c.status === 404);
ok('404 publish call found', !!pub404);
eq('404 status text', pub404.statusText, 'Not Found');
ok('404 reason kept', /no operation matches/.test(pub404.responseBody), JSON.stringify(pub404.responseBody));

// (7) WS Publish (incoming SOAP)
const wsIn = calls.find(c => c.node === 'WebServices' && c.direction === 'in');
ok('WS publish call found', !!wsIn);
eq('WS publish service', wsIn.service, 'AppUser_Create_Update');
ok('WS publish request body captured', wsIn.requestBody.indexOf('<soapenv:Envelope>') === 0);
ok('WS publish per-record headers collected', wsIn.requestHeaders.some(h => h.name === 'soapaction'));
ok('WS publish chunked response captured', wsIn.responseBody.indexOf('OperationResponse') !== -1);
eq('WS publish operation from chunk marker', wsIn.operation, 'Operation');
ok('WS publish duration 364 ms', Math.abs(wsIn.durationMs - 364) < 0.001, 'got ' + wsIn.durationMs);

// Stats
ok('stats: total matches', wsreOut.stats.total === 8);
eq('stats: uncertain count', wsreOut.stats.uncertain, 2);
eq('stats: unanswered count', wsreOut.stats.unanswered, 1);

// ── 9.8: per-endpoint "Total Transferred" (wsreEndpointTotals) ───────────────
// Byte size uses .length as a Node fallback (no Blob global) — fine for these
// ASCII fixtures where UTF-8 byte count equals character count.
console.log('\nWSRE — per-endpoint transferred bytes');
const wsreEndpointTotals = global.wsreEndpointTotals;
const wsreEndpointFn = global.wsreEndpoint;
const shipmentCalls = calls.filter(c => wsreEndpointFn(c) === 'https://api.example.com/rest/ship/v1/shipment');
eq('endpoint totals: two calls share the shipment endpoint', shipmentCalls.length, 2);
const totals = wsreEndpointTotals(calls);
const shipmentTotal = totals.get('https://api.example.com/rest/ship/v1/shipment');
ok('endpoint totals: shipment entry present', !!shipmentTotal);
eq('endpoint totals: call count aggregated per endpoint', shipmentTotal.count, 2);
const expectedShipmentBytes = shipmentCalls.reduce((sum, c) => sum + (c.requestBody || '').length + (c.responseBody || '').length, 0);
eq('endpoint totals: bytes summed across calls to the same endpoint', shipmentTotal.bytes, expectedShipmentBytes);
ok('endpoint totals: an endpoint with a single call is not conflated with others',
  totals.get('https://api.example.com/rest/send/v1/data').count === 1);

// ── "By endpoint" aggregate (wave 16) ────────────────────────────────────────
// An integration incident is "endpoint X fires 300× per page open", not
// "call #4172 took 900 ms". Same contract as the Query Extractor's statement
// view: totals are summed only over the calls the log actually timed, and an
// endpoint with no paired response reports null rather than 0 ms.
console.log('\nWSRE — by endpoint');
const wsreAgg = global.wsreAggregateByEndpoint;
const eps = wsreAgg(calls);
const epBy = {};
eps.forEach(function (g) { epBy[g.endpoint] = g; });

const epShip = epBy['https://api.example.com/rest/ship/v1/shipment'];
ok('by endpoint: the two shipment calls fold into one row', !!epShip);
eq('by endpoint: call count', epShip.count, 2);
eq('by endpoint: both calls were timed', epShip.timedCount, 2);
eq('by endpoint: the 500 response is counted as an error', epShip.errors, 1);
ok('by endpoint: total is the sum of both durations',
  Math.abs(epShip.sumMs - (ship[0].durationMs + ship[1].durationMs)) < 0.001, epShip.sumMs);
ok('by endpoint: average is the total over the timed calls',
  Math.abs(epShip.avgMs - epShip.sumMs / 2) < 0.001, epShip.avgMs);
eq('by endpoint: max is the slowest single call', epShip.maxMs, Math.max(ship[0].durationMs, ship[1].durationMs));
eq('by endpoint: uncertain pairings are carried through', epShip.uncertain, 2);

const epDead = epBy['https://dead.example.com/rest/ping'];
ok('by endpoint: the unanswered call still gets a row', !!epDead);
eq('by endpoint: it is counted as having no response', epDead.unanswered, 1);
eq('by endpoint: an endpoint the log never timed reports null total, not zero', epDead.sumMs, null);
eq('by endpoint: ...and null average', epDead.avgMs, null);
eq('by endpoint: ...and is still represented by its own call', epDead.worst.url, 'https://dead.example.com/rest/ping');

eq('by endpoint: every call lands in exactly one group',
  eps.reduce(function (n, g) { return n + g.count; }, 0), calls.length);
ok('by endpoint: default order is total time first',
  eps[0].sumMs === null || eps.every(function (g) { return g.sumMs === null || g.sumMs <= eps[0].sumMs; }),
  JSON.stringify(eps.map(function (g) { return g.sumMs; })));
eq('by endpoint: empty input yields no groups', wsreAgg([]).length, 0);
eq('endpoint totals: empty call list yields an empty map', wsreEndpointTotals([]).size, 0);

// Reference: the same real trace log used by MFT/LQE reference tests (local only)
if (fs.existsSync(refTrace)) {
  const text = fs.readFileSync(refTrace, 'utf8');
  const recs3 = parser.parse(text).records;
  const t0 = Date.now();
  const out = wsreExtract(recs3);
  const ms = Date.now() - t0;
  eq('reference trace: 31 calls', out.calls.length, 31);
  eq('reference trace: 11 REST Consume', out.calls.filter(c => c.node === 'REST Consume').length, 11);
  eq('reference trace: 4 REST Publish', out.calls.filter(c => c.node === 'REST Publish').length, 4);
  eq('reference trace: 6 SOAP consume', out.calls.filter(c => c.node === 'WebServices' && c.direction === 'out').length, 6);
  eq('reference trace: 10 SOAP publish', out.calls.filter(c => c.node === 'WebServices' && c.direction === 'in').length, 10);
  // Two REAL overlaps exist in this file: the interleaved shipment POST pair
  // (REST Consume) and two concurrent AppUser_Create_Update WS publish requests.
  const uncertain = out.calls.filter(c => c.uncertain);
  eq('reference trace: real interleaves flagged (4 uncertain)', uncertain.length, 4);
  eq('reference trace: interleaved consume pair is the shipment POST',
    uncertain.filter(c => /myorderintegration\/v1\/shipment$/.test(c.url)).length, 2);
  eq('reference trace: overlapping WS publish pair flagged',
    uncertain.filter(c => c.service === 'AppUser_Create_Update').length, 2);
  const withAnchor = out.calls.filter(c => c.corrId).length;
  ok('reference trace: anchors attached to consume calls (>= 15)', withAnchor >= 15, 'got ' + withAnchor);
  const answered = out.calls.filter(c => c.direction === 'out' && c.status !== null).length;
  eq('reference trace: every outgoing call got its response', answered, 17);
  console.log('    (' + (text.length / (1024 * 1024)).toFixed(0) + ' MB → ' + out.calls.length + ' calls in ' + ms + ' ms)');
} else {
  console.log('  – reference trace log absent, skipped (PII: never committed)');
}

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

// ── Log & Text Anonymizer — secret masking (public/js/tools/log-anonymizer.js) ─
// The masking logic lives inside workerLogic(), which ships to the browser as
// `'(' + workerLogic.toString() + ')();'`. The test extracts and runs that exact
// source, so what is asserted here is what actually executes — not a re-implementation.
// This tool decides whether a secret leaves the building, so the important
// assertions are the negative ones: the raw secret must NOT survive anywhere in
// the output.
console.log('\nLog & Text Anonymizer — secret masking');
const anonWorkerSrc = fs.readFileSync(ENGINE + 'anonymizer.js', 'utf8').replace(/\r\n/g, '\n');
const anonStart = anonWorkerSrc.indexOf('function workerLogic() {'), anonEnd = anonWorkerSrc.length;
ok('anon: workerLogic source located', anonStart !== -1);

// Minimal worker host: onmessage/postMessage plus the setTimeout the chunk loop uses.
function anonRun(text, overrides) {
  const opts = Object.assign({
    uuid: false, ip: false, email: false, mendixId: false, datetime: false,
    number: false, mac: false, creditcard: false, auth: true,
    consistent: false, keywords: '', customRegex: ''
  }, overrides || {});
  let done = null;
  const fakeSelf = {
    postMessage: function (m) { if (m.type === 'complete') done = m; },
    setTimeout: setTimeout
  };
  const factory = new Function('self', 'setTimeout', anonWorkerSrc + '; return workerLogic;');
  factory(fakeSelf, setTimeout).call(fakeSelf);
  fakeSelf.onmessage({ data: { rawText: text, opts: opts } });
  // The loop defers through setTimeout(…, 0); drain the macrotask queue.
  return new Promise(function (resolve) {
    (function poll() {
      if (!done) return setTimeout(poll, 0);
      // \x01/\x02 wrap every replaced span so the viewer can <mark> it. They are
      // stripped by VirtualTextViewer.getText(), which is what Copy and Download
      // call — so `visible` is the text the user actually walks away with, and
      // that is what these assertions must judge.
      done.visible = done.result.replace(/\x01|\x02/g, '');
      resolve(done);
    })();
  });
}

async function runAnonTests() {
  // 1. AWS access key ID — identified by shape alone.
  let r = await anonRun('cfg loaded key=AKIAIOSFODNN7EXAMPLE region=eu-west-1');
  ok('anon: AWS access key is masked', r.visible.indexOf('AKIAIOSFODNN7EXAMPLE') === -1, r.visible);
  ok('anon: ...and labelled as an AWS key', /\[AWS_KEY\]/.test(r.visible), r.visible);
  ok('anon: surrounding context survives', /region=eu-west-1/.test(r.visible), r.visible);
  // A temporary-credentials prefix counts too.
  r = await anonRun('ASIAY34FZKBOKMUTVV7A');
  ok('anon: temporary (ASIA) key is masked too', /^\[AWS_KEY\]$/.test(r.visible.trim()), r.visible);

  // 2. Password embedded in a URL — only the password goes.
  r = await anonRun('jdbc:postgresql://svc_user:Hunter2Secret@db.internal:5432/app');
  ok('anon: URL password is masked', r.visible.indexOf('Hunter2Secret') === -1, r.visible);
  ok('anon: ...and the host is preserved for diagnosis', /db\.internal:5432\/app/.test(r.visible), r.visible);
  ok('anon: ...and so is the user', /svc_user/.test(r.visible), r.visible);
  // A URL with no credentials must not be touched.
  r = await anonRun('GET https://api.example.com:443/v1/orders');
  eq('anon: a plain URL with a port is left alone', r.visible, 'GET https://api.example.com:443/v1/orders');

  // 3. Cookie headers — value to end of line, header name kept.
  r = await anonRun('Cookie: JSESSIONID=9F8A2B; XSRF-TOKEN=abc123\nnext line');
  ok('anon: cookie value is masked', r.visible.indexOf('JSESSIONID=9F8A2B') === -1, r.visible);
  ok('anon: ...the header name stays readable', /Cookie: \[COOKIE\]/.test(r.visible), r.visible);
  ok('anon: ...and the following line is untouched', /\nnext line/.test(r.visible), r.visible);
  r = await anonRun('Set-Cookie: sid=xyz; HttpOnly');
  ok('anon: Set-Cookie is covered as well', r.visible.indexOf('sid=xyz') === -1 && /Set-Cookie: \[COOKIE\]/.test(r.visible), r.visible);

  // 4. Generic secrets, anchored on the label rather than the value's shape.
  for (const line of ['api_key=abcd1234efgh', 'apiKey: "abcd1234efgh"', 'client_secret=abcd1234efgh',
                      'password = abcd1234efgh', 'AWS_SECRET_ACCESS_KEY=abcd1234efgh']) {
    r = await anonRun(line);
    ok('anon: secret masked in `' + line + '`', r.visible.indexOf('abcd1234efgh') === -1, r.visible);
  }
  r = await anonRun('api_key=abcd1234efgh');
  ok('anon: the label survives so the line stays readable', /api_key=\[SECRET\]/.test(r.visible), r.visible);

  // Precision: a label-shaped word that is not an assignment must not trigger.
  r = await anonRun('Password validation failed for user bob');
  eq('anon: "Password validation failed" is not an assignment', r.visible, 'Password validation failed for user bob');
  r = await anonRun('passwordPolicy applies to all tenants');
  eq('anon: a longer word starting with the label is not an assignment', r.visible, 'passwordPolicy applies to all tenants');

  // 5. The trap that shaped the ruleset: `Authorization:` is deliberately NOT a
  // secret label, because its value starts with "Bearer " — a label-anchored
  // rule would mask the word "Bearer" and leave the token itself in the log.
  r = await anonRun('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig');
  ok('anon: the bearer token itself is masked', r.visible.indexOf('eyJhbGciOiJIUzI1NiJ9') === -1, r.visible);
  ok('anon: ...and not merely the word Bearer', !/Bearer eyJ/.test(r.visible), r.visible);

  // 6. A JWT inside a cookie must not survive because the cookie rule "won".
  r = await anonRun('Cookie: auth=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig; theme=dark');
  ok('anon: a JWT nested in a cookie is masked with the cookie', r.visible.indexOf('eyJhbGciOiJIUzI1NiJ9') === -1, r.visible);
  ok('anon: ...and nothing of the cookie value leaks', r.visible.indexOf('theme=dark') === -1, r.visible);

  // 7. HAR shape: name and value are separate JSON fields, so neither the
  // raw-header nor the label=value rule can see them. A HAR is the densest
  // secret-bearing file a developer shares, and this toolkit analyses HARs.
  r = await anonRun('{"name": "Cookie", "value": "JSESSIONID=9F8A2B; theme=dark"}');
  ok('anon: a Cookie header in HAR/JSON shape is masked', r.visible.indexOf('JSESSIONID=9F8A2B') === -1, r.visible);
  ok('anon: ...and the header name survives so the HAR stays readable',
    /"name": "Cookie", "value": "\[HEADER_SECRET\]"/.test(r.visible), r.visible);
  r = await anonRun('{"name":"x-api-key","value":"abcd1234efgh"}');
  ok('anon: x-api-key in HAR shape is masked', r.visible.indexOf('abcd1234efgh') === -1, r.visible);
  // An innocuous header of the same shape must be left completely alone.
  r = await anonRun('{"name": "User-Agent", "value": "Mozilla/5.0 (Windows NT 10.0)"}');
  eq('anon: a non-sensitive HAR header is untouched', r.visible, '{"name": "User-Agent", "value": "Mozilla/5.0 (Windows NT 10.0)"}');

  // 7b. Cross-category collisions under the REAL default checkboxes. The tests
  // above isolate one rule each, which is exactly why they could not catch this:
  // `scheme://user:pass@host` parses as an e-mail (pass@host), and e-mail masking
  // is on by default, so before the ordering fix the e-mail rule won the tie —
  // labelling a credential [EMAIL] and swallowing the hostname. Caught in a real
  // browser run, not by the unit tests.
  const UI_DEFAULTS = { uuid: true, ip: true, email: true, mendixId: true, mac: true, creditcard: true, auth: true };
  r = await anonRun('jdbc:postgresql://svc_user:Hunter2Secret@db.internal:5432/app', UI_DEFAULTS);
  ok('anon: URL password wins over the e-mail rule that also matches it',
    /\[URL_PASSWORD\]/.test(r.visible), r.visible);
  ok('anon: ...so the hostname is still preserved with e-mail masking on',
    /db\.internal:5432\/app/.test(r.visible), r.visible);
  ok('anon: ...and the password is gone either way', r.visible.indexOf('Hunter2Secret') === -1, r.visible);
  // A real e-mail must still be masked as an e-mail — the fix must not steal it.
  r = await anonRun('user bob@example.com signed in', UI_DEFAULTS);
  ok('anon: a genuine e-mail is still labelled EMAIL',
    /\[EMAIL\]/.test(r.visible) && r.visible.indexOf('bob@example.com') === -1, r.visible);
  // A secret value shaped like an IP/UUID belongs to the secret rule.
  r = await anonRun('password=10.1.2.3', UI_DEFAULTS);
  ok('anon: an IP-shaped secret is labelled SECRET, not IP', /password=\[SECRET\]/.test(r.visible), r.visible);

  // 8. Regression: the pre-existing categories still behave.
  r = await anonRun('user a@b.com from 10.1.2.3', { email: true, ip: true });
  ok('anon: emails still masked', r.visible.indexOf('a@b.com') === -1 && /\[EMAIL\]/.test(r.visible), r.visible);
  ok('anon: IPs still masked', r.visible.indexOf('10.1.2.3') === -1 && /\[IP\]/.test(r.visible), r.visible);
  // Credit cards still gate on Luhn (the `accept` callback, now fed the tail text).
  r = await anonRun('card 4111111111111111 id 4503599627370496', { creditcard: true });
  ok('anon: a Luhn-valid card is masked', r.visible.indexOf('4111111111111111') === -1, r.visible);
  ok('anon: a Luhn-invalid lookalike is left alone', /4503599627370496/.test(r.visible), r.visible);

  // 8. Consistent masking numbers each distinct secret.
  r = await anonRun('a api_key=SECRET_ONE\nb api_key=SECRET_TWO\nc api_key=SECRET_ONE', { consistent: true });
  ok('anon: consistent masking reuses one alias per distinct secret',
    /\[SECRET-1\][\s\S]*\[SECRET-2\][\s\S]*\[SECRET-1\]/.test(r.visible), r.visible);

  // 9. Counted under the auth statistic, so the summary reflects the work.
  r = await anonRun('AKIAIOSFODNN7EXAMPLE api_key=abcd1234efgh');
  eq('anon: both secrets are counted under `auth`', r.stats.auth, 2);
}

// ── Shared export helpers (public/js/components/exporters.js) ────────────────
// Pure builders attach to window/self; the browser-only download/copy wrappers
// are guarded by `typeof document`, so require() in Node loads just the builders.
console.log('\nExport helpers');
require(ENGINE + 'export.js');
const toCsv = global.mtExportToCsv;
const toMd = global.mtExportToMarkdown;
const toHtml = global.mtExportToHtml;

const expHeader = ['Type', 'SQL'];
const expRows = [['Retrieve', 'SELECT "a$b"."id" FROM "a$b"'], ['Slow', 'x, "quoted" value']];

const csv = toCsv(expHeader, expRows);
ok('csv: header quoted', csv.split('\r\n')[0] === '"Type","SQL"', csv.split('\r\n')[0]);
ok('csv: embedded quotes doubled', csv.indexOf('""quoted"" value') !== -1, csv);
eq('csv: row count = header + data', csv.split('\r\n').length, 3);
ok('csv: uses CRLF line endings', csv.indexOf('\r\n') !== -1);

const md = toMd(expHeader, expRows);
ok('md: has separator row', md.split('\n')[1] === '|---|---|', md.split('\n')[1]);
ok('md: pipes in cells escaped', toMd(['A'], [['x|y']]).indexOf('x\\|y') !== -1);
ok('md: newlines in cells flattened', toMd(['A'], [['x\ny']]).indexOf('x y') !== -1);

const html = toHtml({ title: 'Q & <Report>', subtitle: 'sub', meta: [{ label: 'Rows', value: 2 }], columns: expHeader, rows: expRows });
ok('html: is a self-contained document', /^<!doctype html>/i.test(html) && html.indexOf('</html>') !== -1);
ok('html: no external resource references', html.indexOf('http://') === -1 && html.indexOf('https://') === -1 && html.indexOf('src=') === -1);
ok('html: title HTML-escaped', html.indexOf('Q &amp; &lt;Report&gt;') !== -1);
ok('html: cell content escaped', html.indexOf('&quot;a$b&quot;') !== -1 || html.indexOf('&quot;quoted&quot;') !== -1);
ok('html: renders a data cell', html.indexOf('<td>Retrieve</td>') !== -1);
ok('html: sections mode renders multiple tables', (function () {
  const h = toHtml({ title: 'Incident', sections: [{ title: 'SQL', columns: ['A'], rows: [['1']] }, { title: 'Microflows', columns: ['B'], rows: [['2']] }] });
  return (h.match(/<h2>/g) || []).length === 2;
})());
ok('html: empty rows → "No rows." not a broken table', toHtml({ title: 'x', columns: ['A'], rows: [] }).indexOf('No rows.') !== -1);

// ── Incident Report model builder (mtBuildIncidentReport) ────────────────────
console.log('\nIncident Report builder');
const buildIncident = global.mtBuildIncidentReport;
const secA = { id: 'log-viewer', title: 'Log Viewer — errors', subtitle: '2 errors', columns: ['Time', 'Msg'], rows: [['t1', 'boom'], ['t2', 'bang']], total: 2, firstMs: 1000, lastMs: 5000 };
const secB = { id: 'nginx-log', title: 'Nginx', subtitle: '1 request', columns: ['Time', 'Status'], rows: [['t3', 500]], total: 1, firstMs: 2000, lastMs: 8000 };

const model = buildIncident([secA, null, secB], { title: 'Checkout incident', notes: 'prod, morning' });
eq('incident: null sections dropped', model.sections.length, 2);
eq('incident: title carried', model.title, 'Checkout incident');
ok('incident: subtitle is the auto-summary, starting with the period', /^Period: /.test(model.subtitle), model.subtitle);
eq('incident: notes carried as the separate top-level note (not the subtitle)', model.note, 'prod, morning');
ok('incident: meta lists both source ids', model.meta.some(function (m) { return m.label === 'Sources' && /log-viewer/.test(m.value) && /nginx-log/.test(m.value); }));
ok('incident: total rows summed across sections', model.meta.some(function (m) { return m.label === 'Total rows' && m.value === 3; }));
ok('incident: default window spans min→max of section data', model.meta.some(function (m) { return m.label === 'Time window' && /1970-01-01 00:00:01.*1970-01-01 00:00:08/.test(m.value); }), JSON.stringify(model.meta[0]));

const modelWin = buildIncident([secA], { fromMs: 1500, toMs: 4000 });
ok('incident: explicit window overrides the data span', modelWin.meta.some(function (m) { return m.label === 'Time window' && /00:00:01.*00:00:04/.test(m.value); }));
eq('incident: no sections → empty sections array', buildIncident([], {}).sections.length, 0);

// The built model round-trips through the HTML exporter into a real report.
const incidentHtml = toHtml(model);
ok('incident: renders both section headings', (incidentHtml.match(/<h2>/g) || []).length === 2);
ok('incident: self-contained, no external refs', /^<!doctype html>/i.test(incidentHtml) && !/https?:\/\//.test(incidentHtml));
ok('incident: notes render as a distinct context box in the HTML', incidentHtml.indexOf('class="context"') !== -1 && incidentHtml.indexOf('prod, morning') !== -1);
ok('incident: no notes → no context box', toHtml(buildIncident([secA], {})).indexOf('class="context"') === -1);

// ── Executive summary (mtIncidentSummary) — 9.7: data-driven, no invented metrics ──
console.log('\nIncident Report — executive summary');
const summarize = global.mtIncidentSummary;
const logSecWithLevels = {
  id: 'log-viewer', title: 'Log Viewer', subtitle: '3 entries',
  columns: ['Time', 'Level', 'Node', 'Message'],
  rows: [['t1', 'ERROR', 'Core', 'x'], ['t2', 'WARN', 'Core', 'y'], ['t3', 'CRITICAL', 'Core', 'z']]
};
const lqeSecWithDurations = {
  id: 'log-query-extractor', title: 'LQE', subtitle: '3 queries',
  columns: ['Type', 'Tx-Conn', 'Timestamp', 'Duration (ms)', 'Cost', 'Rows', 'Dup', 'SQL'],
  rows: [['SELECT', 'a', 't', 50, '', '', '', 'x'], ['SELECT', 'a', 't', 1500, '', '', '', 'y'], ['SELECT', 'a', 't', 3000, '', '', '', 'z']]
};
const wsreSecWithErrors = { id: 'ws-rest-extractor', title: 'WSRE', subtitle: '5 calls · 2 with error status', columns: [], rows: [] };
const jvmSecWithDeadlock = {
  id: 'thread-dump', title: 'JVM', subtitle: '',
  columns: ['Metric', 'Value'],
  rows: [['BLOCKED', 1], ['Deadlocks detected', 2]]
};

ok('summary: counts errors+critical from Log Viewer, not warnings',
  summarize([logSecWithLevels], 'W1 → W2').indexOf('2 errors') !== -1);
ok('summary: counts LQE queries over 1s as slow',
  summarize([lqeSecWithDurations], 'W').indexOf('2 slow queries (>1s)') !== -1);
ok('summary: pulls WSRE failed-call count from its own subtitle',
  summarize([wsreSecWithErrors], 'W').indexOf('2 failed calls') !== -1);
ok('summary: surfaces JVM deadlocks when present',
  summarize([jvmSecWithDeadlock], 'W').indexOf('2 deadlocks') !== -1);
eq('summary: always leads with the period', summarize([], 'X → Y'), 'Period: X → Y');
ok('summary: a source with no matching columns contributes no clause',
  summarize([{ id: 'nginx-log', title: 'n', subtitle: '', columns: ['Time', 'Status'], rows: [['t', 500]] }], 'W') === 'Period: W');

// ── Insights "Error mechanisms" card (wave 40) ───────────────────────────────
// Needs the decoder, so it lives here rather than with the other Insights tests
// (which run before error-decoder.js is loaded and therefore never see it).
(function () {
  const recs = parser.parse(insLog + '\n' +
    // Same text as the session-bloat card, but at ERROR: no card takes it, and
    // its mechanism owns a card — so it must not reach this one either.
    '2026-07-18T09:00:20.000000 ' + P + '   ERROR - RequestStatistics: Request state size of 999 objects exceeds the threshold of 300 objects.').records;
  const mc = logInsights(recs).categories.find(function (c) { return c.key === 'error-mechanisms'; });
  ok('mechanisms: card appears when the decoder recognizes a record', !!mc);
  if (!mc) return;
  const byMech = {};
  mc.items.forEach(function (it) { byMech[it.filter.mech] = it; });
  eq('mechanisms: SAML_SSO null grouped under its rule', byMech['saml-empty-error'] && byMech['saml-empty-error'].count, 3);
  eq('mechanisms: unmatched Core warnings kept as one row', byMech['(unrecognized)'] && byMech['(unrecognized)'].count, 2);
  ok('mechanisms: unrecognized row is pinned (always listed)', byMech['(unrecognized)'].pinned === true);
  eq('mechanisms: card counts mechanism + unrecognized only', mc.count, 5);
  eq('mechanisms: an ERROR among them → error severity', mc.severity, 'error');
  ok('mechanisms: records another card took are left out (Access denied, TaskQueue …)',
    recs.filter(function (r) { return /attempted to execute|Failed to execute task/.test(r.message || r.msg); })
      .every(function (r) { return r._edxMech === null; }));
  const own = ['mx-request-state-size', 'mx-widget-missing-parameter', 'mx-taskqueue-failed', 'mx-slow-query-warning'];
  ok('mechanisms: the four skipped ids still exist in the ruleset',
    own.every(function (id) { return global.EDX_RULES.some(function (r) { return r.id === id; }); }));
  ok('mechanisms: mechanisms with their own card never listed',
    own.every(function (id) { return !byMech[id]; }));
  // The stream filter reads the cached id: the card's filter must select
  // exactly the records the card counted — no more, no fewer.
  const set = new Set(mc.filter.mech.split(','));
  eq('mechanisms: card filter selects exactly the counted records',
    recs.filter(function (r) { return set.has(r._edxMech); }).length, mc.count);

  const plain = parser.parse([
    '2026-07-18T09:00:00.000000 ' + P + '   ERROR - Core: something nobody wrote a rule for',
    '2026-07-18T09:00:01.000000 ' + P + '   ERROR - Core: something nobody wrote a rule for'
  ].join('\n')).records;
  ok('mechanisms: no card when nothing is recognized (hotspot card already lists these)',
    !logInsights(plain).categories.some(function (c) { return c.key === 'error-mechanisms'; }));
})();


// ── Data Hub v0 — shared loaded-file summary and targets ────────────────────
// The component is an IIFE that skips every DOM branch when `document` is
// undefined, so requiring it in Node yields just the pure builders.
console.log('\nData Hub');
require(ENGINE + 'hub.js');
const hubSummary = global.mtHubSummary;
const hubTargets = global.mtHubTargets;

// -- summary line --
// Nothing loaded must produce nothing at all (data-driven principle): the bar
// renders an empty shell only if this returns a truthy object.
eq('hub: no source yields no summary', hubSummary(null), null);
eq('hub: a source without a name yields no summary', hubSummary({ text: 'x' }), null);

const hubSrc = {
  name: 'app.log', size: 3 * 1024 * 1024, format: 'live', records: 176986,
  text: 'raw', origin: 'log-viewer', loadedIn: ['log-viewer']
};
const hubS = hubSummary(hubSrc);
eq('hub: summary keeps the file name', hubS.name, 'app.log');
eq('hub: size rendered in MB', hubS.sizeText, '3.0 MB');
eq('hub: record count is thousands-separated', hubS.recordsText, '176,986 records');
eq('hub: live format gets a human label', hubS.formatText, 'Mendix Cloud live log');
eq('hub: summary line joins the parts',
  hubS.line, 'Loaded: app.log · 3.0 MB · 176,986 records · Mendix Cloud live log');
eq('hub: csv format gets its own label',
  hubSummary({ name: 'a.csv', text: 'x', format: 'csv' }).formatText, 'Studio Pro CSV export');
// An unknown/absent format must not invent a label.
eq('hub: unknown format contributes nothing',
  hubSummary({ name: 'a.log', text: 'x', format: 'zzz' }).formatText, '');
eq('hub: a source with only a name still yields a line',
  hubSummary({ name: 'a.log', text: 'x' }).line, 'Loaded: a.log');
// Singular/plural and size units are the kind of detail that silently looks wrong.
eq('hub: one record is singular', hubSummary({ name: 'a', text: 'x', records: 1 }).recordsText, '1 record');
eq('hub: zero records is still reported', hubSummary({ name: 'a', text: 'x', records: 0 }).recordsText, '0 records');
eq('hub: bytes below 1 KB stay bytes', global.mtHubFormatBytes(512), '512 B');
eq('hub: kilobytes rendered with one decimal', global.mtHubFormatBytes(2048), '2.0 KB');
eq('hub: a missing size contributes nothing', hubSummary({ name: 'a', text: 'x' }).sizeText, '');
// The Log Viewer accepts several files at once; the Hub carries one, and says so.
eq('hub: sibling files counted', hubSummary(Object.assign({ siblings: 2 }, hubSrc)).siblings, 2);
eq('hub: no siblings by default', hubS.siblings, 0);

// -- open-in targets --
eq('hub: no source offers no targets', hubTargets(null, 'log-viewer').length, 0);
const hubT = hubTargets(hubSrc, 'log-query-extractor');
eq('hub: all four log tools are offered', hubT.length, 4);
eq('hub: the active tool is flagged as current',
  hubT.filter(t => t.current).map(t => t.id).join(), 'log-query-extractor');
eq('hub: the tool that parsed the file is flagged as loaded',
  hubT.find(t => t.id === 'log-viewer').loaded, true);
eq('hub: an untouched tool is not flagged as loaded',
  hubT.find(t => t.id === 'microflow-tracer').loaded, false);
eq('hub: each target names the global it hands off to',
  hubT.find(t => t.id === 'ws-rest-extractor').fn, 'wsreLoadText');
// current and loaded are independent: the origin tool can also be the active one.
const hubT2 = hubTargets(hubSrc, 'log-viewer');
eq('hub: origin tool is both current and loaded',
  hubT2.find(t => t.id === 'log-viewer').current && hubT2.find(t => t.id === 'log-viewer').loaded, true);
eq('hub: a source with no loadedIn marks nothing as loaded',
  hubTargets({ name: 'a', text: 'x' }, 'log-viewer').filter(t => t.loaded).length, 0);


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


// =========================================================================
// NGINX LOG ANALYZER — unique IPs per endpoint + Worker-based streaming parse (12.8)
// =========================================================================
console.log('\nNginx Log Analyzer');
global.addEventListener = function () {}; // nginx.js registers a popstate handler at module load
require(ENGINE + 'nginx.js');

const nginxSampleRecords = [
  { url: '/api/orders', ip: '203.0.113.5' },
  { url: '/api/orders', ip: '198.51.100.9' },
  { url: '/api/orders', ip: '203.0.113.5' }, // repeat — not double-counted
  { url: '/api/customers', ip: '203.0.113.5' }
];
eq('unique IPs per URL: two different IPs on the same URL count as 2', JSON.stringify(global.nginxUniqueIpsPerUrl(nginxSampleRecords)), '{"/api/orders":2,"/api/customers":1}');
eq('unique IPs per URL: empty record list yields an empty object', JSON.stringify(global.nginxUniqueIpsPerUrl([])), '{}');

eq('hour derivation: nginx access-log timestamp format', global.nginxDeriveHourStr('24/Jul/2026:10:15:23 +0000'), '24/Jul/2026:10');
eq('hour derivation: ISO/Mendix-style timestamp format', global.nginxDeriveHourStr('2026-07-24T10:15:23'), '2026-07-24 10');
eq('hour derivation: unrecognized format falls back to a 13-char slice, not a crash', global.nginxDeriveHourStr('unrecognized-format-string'), 'unrecognized-'.slice(0, 13));

ok('worker threshold: matches the 2 MB convention shared with LQE/MFT/WSRE', global.NGINX_WORKER_THRESHOLD === 2 * 1024 * 1024);

// ── 404 classification (nginxClassifyTraffic) ────────────────────────────────
// Every path below is verbatim from the NewLogs corpus. The rule it encodes:
// a 404 belongs to a SCANNER, to a browser CONVENTION, or to your own APP —
// and only the last is actionable. In 48 499 real 404s the old inline detector
// flagged 2.9%; this classifier attributes ~96% to scanners and leaves 1.6% in
// the app bucket, which is where the four genuinely broken references sat.
const nxClassify = global.nginxClassifyTraffic;
const nx404 = (url, ip, ua) => ({ status: 404, url: url, ip: ip || '10.0.0.1', userAgent: ua || 'Mozilla/5.0' });

// Only 404s are classified — a 200 to the same path is normal traffic.
eq('classify: non-404 requests are ignored',
  nxClassify([{ status: 200, url: '/wp-login.php', ip: '1.2.3.4', userAgent: 'x' }]).total404, 0);
eq('classify: empty input is not an error', nxClassify([]).total404, 0);

// Scanner detection by path — a Mendix app serves no PHP/JSP/ASP/CGI at all,
// which is what makes this signal honest rather than a guess.
const nxScan = nxClassify([
  nx404('/wp-login.php', '9.9.9.1'), nx404('/cgi-bin/login.cgi', '9.9.9.2'),
  nx404('/realms/master/protocol/openid-connect/auth', '9.9.9.3'),
  nx404('/+CSCOT+/translation-table', '9.9.9.4'), nx404('/_ignition/execute-solution', '9.9.9.5'),
  nx404('/.env', '9.9.9.6'), nx404('/nuclei.svg', '9.9.9.7'), nx404('/graphql', '9.9.9.8')
]);
eq('classify: eight distinct real probe shapes all land in the scanner bucket', nxScan.scanner.requests, 8);
eq('classify: ...and none of them leak into the app bucket', nxScan.app.requests, 0);
ok('classify: the PHP reason explains why it is safe to dismiss',
  /serves none/i.test(nxScan.scanner.paths.filter(p => p.path === '/wp-login.php')[0].reason));

// Scanner detection by user agent, whatever the path.
eq('classify: a known scanner user agent is enough on its own',
  nxClassify([nx404('/', '9.9.9.9', 'Mozilla/5.0 (compatible; Nuclei - Open-source project)')]).scanner.requests, 1);

// Browser/OS conventions are their own bucket — neither a fault nor an attack.
const nxConv = nxClassify([
  nx404('/apple-touch-icon.png', '1.1.1.1'), nx404('/apple-touch-icon-precomposed.png', '1.1.1.2'),
  nx404('/favicon.ico', '1.1.1.3'), nx404('/.well-known/assetlinks.json', '1.1.1.4'),
  nx404('/robots.txt', '1.1.1.5')
]);
eq('classify: browser/OS convention requests are neither scanner nor app', nxConv.convention.requests, 5);
eq('classify: ...and they contribute no scanner sources', nxConv.sources.length, 0);

// The app bucket: the honest default when nothing is proven.
const nxApp = nxClassify([
  nx404('/rest/networkerforshuttleplan/v1/leadtime', '2.2.2.1'),
  nx404('/ui/theme-cape/images/myApp_logoRed.png', '2.2.2.2'),
  nx404('/fonts/KFOlCnqEu92Fr1MmEU9fABc4EsA.woff2', '2.2.2.3'),
  nx404('/widgets/AutoCompleteForMendix.js.map', '2.2.2.4')
]);
eq('classify: a real broken app reference stays in the app bucket', nxApp.app.requests, 4);
ok('classify: the app reason says it is most likely yours',
  /your own app/i.test(nxApp.app.paths[0].reason), nxApp.app.paths[0].reason);

// The behavioural pass — this is what shrank the app bucket from 45% to 1.6%
// without maintaining an endless blocklist of probe paths.
const nxSweepIp = '7.7.7.7';
const nxSweep = nxClassify([
  nx404('/wp-login.php', nxSweepIp), nx404('/index.php', nxSweepIp), nx404('/admin/index.php', nxSweepIp),
  nx404('/ZXv3sTuY.htm', nxSweepIp)  // random name, matches no pattern — but same sweep
]);
eq('classify: an unrecognised path from a proven scanner IP is attributed to the sweep', nxSweep.app.requests, 0);
ok('classify: ...and the reason says so explicitly',
  /same source as \d+ confirmed probes/.test(nxSweep.scanner.paths.filter(p => p.path === '/ZXv3sTuY.htm')[0].reason));
// The threshold protects a real user whose bookmark went stale.
const nxFewProbes = nxClassify([
  nx404('/wp-login.php', '8.8.8.8'),                 // 1 probe only — below NGINX_PROBE_MIN
  nx404('/my/old/bookmarked/page', '8.8.8.8')
]);
eq('classify: one stray probe does not condemn that IP\'s other 404s', nxFewProbes.app.requests, 1);

// Sources feed the "Scanner sources" table: ranked, with distinct-path breadth,
// and preferring a concrete pattern reason over the derived one.
const nxSrc = nxClassify([
  nx404('/wp-login.php', '5.5.5.5'), nx404('/index.php', '5.5.5.5'), nx404('/admin.php', '5.5.5.5'),
  nx404('/aaa.htm', '5.5.5.5'), nx404('/.env', '6.6.6.6')
]);
eq('classify: scanner sources are ranked by hits', nxSrc.sources[0].ip, '5.5.5.5');
eq('classify: a source reports how many distinct paths it swept', nxSrc.sources[0].distinctPaths, 4);
ok('classify: a source shows a concrete reason, not the derived "same source" text',
  !/^same source as/.test(nxSrc.sources[0].reason), nxSrc.sources[0].reason);

// A query string must not split one path into many rows.
eq('classify: the query string is stripped before grouping',
  nxClassify([nx404('/wp-login.php?a=1', '3.3.3.1'), nx404('/wp-login.php?a=2', '3.3.3.2')]).scanner.paths.length, 1);
// Missing/odd fields must not throw — real logs carry "-" and empty agents.
ok('classify: survives missing url/userAgent fields',
  nxClassify([{ status: 404, ip: '-' }, { status: '404', url: '/x', ip: '-', userAgent: null }]).total404 === 2);

// nginxStreamParseFile is async (it streams a Blob) — chained into the same
// async sequence as the other async suites below so its assertions land
// before the final pass/fail count is printed, not racing it.
async function runNginxAsyncTests() {
  const line1 = '203.0.113.5 - - [24/Jul/2026:10:15:23 +0000] "GET /api/orders HTTP/1.1" 200 1234 "-" "Mozilla/5.0"';
  const line2 = '198.51.100.9 - - [24/Jul/2026:10:16:00 +0000] "GET /api/orders HTTP/1.1" 200 999 "-" "curl/8.0"';
  const blob = new Blob([line1 + '\n' + line2 + '\n']);
  const result = await global.nginxStreamParseFile(blob, false, 'access', global.nginxParseLine, undefined);
  eq('stream parse: both lines parsed into records', result.records.length, 2);
  eq('stream parse: hourStr derived per record', result.records[0].hourStr, '24/Jul/2026:10');
  eq('stream parse: unique IPs on the shared URL', JSON.stringify(global.nginxUniqueIpsPerUrl(result.records)), '{"/api/orders":2}');

  const errBlob = new Blob(['not an nginx line at all\ngarbage\n']);
  const errResult = await global.nginxStreamParseFile(errBlob, false, 'error', global.nginxParseErrorLine, undefined);
  eq('stream parse (error type): unmatched lines are scanned but not matched', errResult.scanned, 2);
  eq('stream parse (error type): first unmatched line kept as the hint sample', errResult.matched, 0);
  ok('stream parse (error type): sample captured for the format-mismatch hint', errResult.sample.length > 0);
}

// =========================================================================
// NGINX (rtr) ↔ APPLICATION LOG TIMELINE CORRELATOR (Fala 25)
// =========================================================================
// log-viewer.js is required here (not elsewhere in this file) purely for
// window.logExtractCorrelations, which nxCorrBuildRuntimeEvents consumes.
console.log('\nNginx ↔ App Log Timeline Correlator');
require(ENGINE + 'insights.js');
require(ENGINE + 'nginx.js');

// ── nxCorrTsToMs ──
eq('ts→ms: parses microsecond fraction', global.nxCorrTsToMs('2026-08-10T00:00:04.812837'), Date.parse('2026-08-10T00:00:04Z') + 812.837);
eq('ts→ms: parses without a fraction', global.nxCorrTsToMs('2026-08-10T00:00:04'), Date.parse('2026-08-10T00:00:04Z'));
ok('ts→ms: garbage input is NaN, not a crash', isNaN(global.nxCorrTsToMs('not a timestamp')));
ok('ts→ms: empty input is NaN', isNaN(global.nxCorrTsToMs('')));

// ── nxCorrBuildRuntimeEvents ──
// The corpus this shipped against (ten real apps, NewLogs) runs INFO-and-above
// only — never TRACE/DEBUG — so it never emits a [corrId] bracket anywhere.
// These fixtures cover exactly the two sources that therefore matter in
// practice: bare ERROR/WARNING lines, and (separately) corrId groups when a
// richer log does have them.
const nxcBareRecords = [
  { level: 'ERROR', timestamp: '2026-08-10T00:02:55.139200', logNode: 'Connector', message: '404 - file not found for file: wp-login.php' },
  { level: 'INFO', timestamp: '2026-08-10T00:02:55.200000', logNode: 'Core', message: 'Nothing wrong here' },
  { level: 'WARN', timestamp: '2026-08-10T00:03:00.000000', logNode: 'Scheduler', message: 'Queue backing up' }
];
const nxcBareEvents = global.nxCorrBuildRuntimeEvents(nxcBareRecords, []);
eq('runtime events: INFO lines produce no event', nxcBareEvents.length, 2);
ok('runtime events: ERROR line becomes a point event', nxcBareEvents.some(e => e.kind === 'entry' && e.level === 'ERROR' && /wp-login/.test(e.message)));
ok('runtime events: WARN line becomes a point event too', nxcBareEvents.some(e => e.kind === 'entry' && e.level === 'WARN'));

const nxcGroupRecord = [
  { level: 'DEBUG', timestamp: '2026-08-10T00:05:00.000000', logNode: 'MicroflowEngine', message: '[abc123] Starting execution of microflow \'ACT_Order_Create\'' }
];
const nxcFlowGroups = [{ id: 'abc123', flow: 'ACT_Order_Create', nodes: ['MicroflowEngine'], errors: 0, warnings: 0, count: 1, firstMs: 1000, lastMs: 2000 }];
const nxcMixedEvents = global.nxCorrBuildRuntimeEvents(nxcGroupRecord, nxcFlowGroups);
eq('runtime events: a record already inside a corrId group is not also added as a bare point', nxcMixedEvents.length, 1);
eq('runtime events: the group itself becomes one flow event', nxcMixedEvents[0].kind, 'flow');
eq('runtime events: a group with an unparseable span is dropped rather than crashing', global.nxCorrBuildRuntimeEvents([], [{ id: 'x', firstMs: NaN, lastMs: NaN }]).length, 0);

// ── nxCorrelate ──
const nxcRtr = [
  { rawLine: '2026-08-10T00:02:55.142369 [nginx/x]   request="GET /wp-login.php HTTP/1.1" status="404"', status: 404, method: 'GET', url: '/wp-login.php', time: 0.001, ip: '1.2.3.4' },
  { rawLine: '2026-08-10T00:10:00.000000 [nginx/x]   request="GET /far-away HTTP/1.1" status="200"', status: 200, method: 'GET', url: '/far-away', time: 0.001, ip: '1.2.3.4' },
  { rawLine: 'not-a-timestamp', status: 200, method: 'GET', url: '/no-ts', time: 0, ip: '1.2.3.4' }
];
const nxcEvents = [
  { kind: 'entry', ms: global.nxCorrTsToMs('2026-08-10T00:02:55.139200'), msEnd: global.nxCorrTsToMs('2026-08-10T00:02:55.139200'), level: 'ERROR', node: 'Connector', message: '404 - file not found for file: wp-login.php' }
];
const nxcResult = global.nxCorrelate(nxcRtr, nxcEvents, 3000);
eq('correlate: a request with no parseable timestamp is dropped, not matched', nxcResult.requests.length, 2);
eq('correlate: the near-simultaneous request/event pair links', nxcResult.links.length, 1);
eq('correlate: the distant request does not link within a 3s window', nxcResult.links.some(l => nxcResult.requests[l.reqIndex].url === '/far-away'), false);
ok('correlate: the linked distance matches the real 3.2ms gap seen in the corpus', nxcResult.links[0].distMs > 3 && nxcResult.links[0].distMs < 4, nxcResult.links[0].distMs);
eq('correlate: default window applies when none is given', global.nxCorrelate(nxcRtr, nxcEvents, undefined).windowMs, 3000);
eq('correlate: empty inputs produce empty output, not a crash', global.nxCorrelate([], [], 1000).links.length, 0);

// ── Real corpus (when present locally) — the pair that led to this design ──
const nxcRtrFile = path.join(__dirname, '..', '_local_assets', 'FilesForTest', 'NewLogs', 'Bridge', 'rtr_logs_eb2b8f2f-501f-4856-a13b-9e9705118f0d_2026-08-10.txt');
const nxcAppFile = path.join(__dirname, '..', '_local_assets', 'FilesForTest', 'NewLogs', 'Bridge', 'logs_eb2b8f2f-501f-4856-a13b-9e9705118f0d_2026-08-10.txt');
if (fs.existsSync(nxcRtrFile) && fs.existsSync(nxcAppFile)) {
  const nxcRtrText = fs.readFileSync(nxcRtrFile, 'utf8');
  const nxcAppText = fs.readFileSync(nxcAppFile, 'utf8');
  const nxcRealRtr = nxcRtrText.split(/\r?\n/).filter(Boolean).map(global.nginxParseLine).filter(Boolean);
  const nxcRealParsed = global.createMendixLogParser().parse(nxcAppText);
  const nxcRealCorr = global.logExtractCorrelations(nxcRealParsed.records);
  const nxcRealEvents = global.nxCorrBuildRuntimeEvents(nxcRealParsed.records, nxcRealCorr.groups);
  const nxcRealResult = global.nxCorrelate(nxcRealRtr, nxcRealEvents, 3000);
  ok('real corpus: this app log runs INFO-and-above only, so every runtime event is a bare entry, none a corrId flow',
    nxcRealEvents.length > 0 && nxcRealEvents.every(e => e.kind === 'entry'));
  const nxcWpMatches = nxcRealResult.links.filter(l => nxcRealResult.requests[l.reqIndex].url === '/wp-login.php');
  ok('real corpus: rtr 404s for /wp-login.php pair up with the app log\'s "file not found" ERROR line', nxcWpMatches.length > 0);
  ok('real corpus: the match distance is a few milliseconds, not a coincidence across the window', nxcWpMatches.every(l => l.distMs < 50));
} else {
  console.log('  (skipped: real corpus not present locally — _local_assets/FilesForTest/NewLogs/Bridge)');
}

// ── One parser: the shared parser reads what the Log Viewer read (wave 36, BUG-20) ──
// Until v1.68.0 the Log Viewer carried its own parser. Measured on the NewLogs corpus
// the two agreed on 9 of 10 apps; on Intercom the Log Viewer made 266 records the
// shared parser glued onto the record above: container-supervisor lines with a
// timestamp but no level. The Log Viewer's reading is the right one, so its old
// algorithm — reproduced verbatim below — is the reference the shared parser must
// meet, record for record. The one deliberate difference: lines before the first
// record. The viewer made them a "Raw" record; the shared parser counts them as
// skipped, because a file that is not a log must not look parsed to the other tools.
console.log('\nOne parser (shared parser vs the pre-v1.69 Log Viewer parser)');
(function () {
  const OLD_PATTERNS = [
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+\[[^\]]+\]\s+(TRACE|DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL)\s+-\s+([^:\n]+?):\s*(.*)$/i,
    /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z)?)\s+(TRACE|DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL)\s+-\s+([^:\n]+?):\s*(.*)$/i,
    /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z)?)\s+(TRACE|DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL)\s+([^:\n]{1,80}):\s*(.*)$/i,
    /^\[?(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\]?\s+(TRACE|DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL)\s+([^:\n]{1,60}):\s*(.*)$/i
  ];
  function oldIsContinuation(line) {
    return /^\s/.test(line)
      || /^(at |java\.|scala\.|com\.|org\.|sun\.|javax\.|net\.)/i.test(line.trim())
      || /^Caused by:/i.test(line.trim())
      || /^\.\.\. \d+ more/.test(line.trim());
  }
  function oldLvParseLive(text) {
    const entries = [];
    let prev = null, lineNum = 0;
    for (const raw of text.split(/\r?\n/)) {
      lineNum++;
      const line = raw.trimEnd();
      if (!line.trim()) continue;
      if (prev && oldIsContinuation(line)) {
        prev.msg += '\n' + line.trim();
        prev.raw += '\n' + line;
        continue;
      }
      let matched = false;
      for (const pat of OLD_PATTERNS) {
        const m = line.match(pat);
        if (m) {
          let [, ts, level, node, msg] = m;
          level = level.toUpperCase();
          if (level === 'WARNING') level = 'WARN';
          prev = { line: lineNum, ts: ts.trim(), level, node: (node || 'Runtime').trim(), msg: (msg || '').trim(), raw: line };
          entries.push(prev);
          matched = true;
          break;
        }
      }
      if (!matched) {
        const m = line.match(/^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z)?)\s+(.*)$/);
        if (m) {
          let rest = m[2], level = 'INFO', node = 'Platform';
          const sourceMatch = rest.match(/^\[([^\]]+)\]\s+(.*)$/);
          if (sourceMatch) { node = sourceMatch[1]; rest = sourceMatch[2]; }
          const levelMatch = rest.match(/^(TRACE|DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL|ERR|FATAL)[\s:-]+(.*)$/i);
          if (levelMatch) {
            level = levelMatch[1].toUpperCase();
            if (level === 'WARNING') level = 'WARN';
            if (level === 'ERR' || level === 'FATAL') level = 'ERROR';
            rest = levelMatch[2].trim();
          } else if (/error|exception|fail|crashed|unhealthy|oom|out of memory/i.test(rest)) {
            level = 'ERROR';
          }
          prev = { line: lineNum, ts: m[1].trim(), level, node, msg: rest, raw: line };
          entries.push(prev);
          matched = true;
        }
      }
      if (!matched) {
        const foreign = parser.foreignRecord(line, prev ? prev.ts : '');
        if (foreign) {
          prev = { line: lineNum, ts: foreign.timestamp, level: foreign.level, node: foreign.logNode, msg: foreign.message, raw: raw };
          entries.push(prev);
        } else if (prev) {
          prev.msg += '\n' + line;
          prev.raw += '\n' + line;
        } else {
          prev = { line: lineNum, ts: '', level: 'INFO', node: 'Raw', msg: line.trim(), raw: line, preamble: true };
          entries.push(prev);
        }
      }
    }
    return entries;
  }

  // What the Log Viewer shows of the shared parser's records — its real mapping.
  function lvEntries(text) {
    const lf = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return global.logRecordsToEntries(parser.parse(lf).records, lf, 'f');
  }
  function lvView(r) { return global.logRecordsToEntries([r], '', 'f')[0]; }
  // Trailing blanks per line are not something anyone reads; everything else must match.
  function tidy(s) { return s.split('\n').map(x => x.trimEnd()).join('\n'); }
  function view(e) { return { line: e.line, ts: e.ts, level: e.level, node: e.node, msg: e.msg.split('\n').map(s => s.trim()).join('\n').trim(), raw: tidy(e.raw) }; }

  // Returns '' when both sides agree, else a description of the first mismatch.
  function diffParsers(text) {
    const oldE = oldLvParseLive(text).filter(e => !e.preamble);
    const newE = lvEntries(text);
    if (oldE.length !== newE.length) {
      for (let i = 0; i < Math.min(oldE.length, newE.length); i++) {
        if (oldE[i].ts !== newE[i].ts || oldE[i].level !== newE[i].level) {
          return 'count ' + newE.length + ' vs ' + oldE.length + '; first split at old line ' + oldE[i].line + ': ' + oldE[i].raw.slice(0, 120);
        }
      }
      return 'count ' + newE.length + ' vs ' + oldE.length;
    }
    for (let i = 0; i < oldE.length; i++) {
      const a = JSON.stringify(view(newE[i])), b = JSON.stringify(view(oldE[i]));
      if (a !== b) return 'record ' + i + ' (old line ' + oldE[i].line + '): ' + a.slice(0, 200) + ' vs ' + b.slice(0, 200);
    }
    return '';
  }
  function agree(name, text) {
    const d = diffParsers(text);
    ok(name, d === '', d);
  }

  const C = '[runtime-container/4772k]';
  agree('cloud log: records, stack traces, SQL continuation and blank lines', [
    '2026-08-10T13:29:40.100000 ' + C + '  INFO - Core: Mendix Runtime successfully started',
    '2026-08-10T13:29:40.200000 ' + C + '  ERROR - Connector: Something broke',
    '\tat com.mendix.core.Core.execute(Core.java:12)',
    'Caused by: java.lang.IllegalStateException: boom',
    '\t... 12 more',
    '',
    '2026-08-10T13:29:40.300000 ' + C + '  WARNING - ConnectionBus_Queries: (1/1) Query executed in 12 seconds and 3 milliseconds: SELECT "a"',
    'FROM "b"',
    'WHERE "c" = 1'
  ].join('\n'));
  agree('cloud log: container-supervisor lines without a level are records of their own (Intercom)', [
    '2026-08-10T13:29:40.900000 ' + C + '  INFO - Core: shutting down',
    '2026-08-10T13:29:40.933134 ' + C + '   "no auth required"',
    '2026-08-10T13:29:40.933268 ' + C + '   "Send signal to program" program=watchdog signal=terminated',
    '2026-08-10T13:29:41.505978 ' + C + '   "program stopped with status:exit status 0" program=runtime',
    '2026-08-10T13:30:21.778901 ' + C + '   Calculated JVM Memory Configuration: -Xss1M (Total Memory: 8G)',
    '2026-08-10T13:30:21.797864 ' + C + '   Enabling Java Native Memory Tracking',
    '2026-08-10T13:30:22.000000 ' + C + '  INFO - Core: starting'
  ].join('\n'));
  agree('supervisor lines: a pseudo-level (ERR:, WARNING -) is read as the level', [
    '2026-08-10T13:30:21.000000 ' + C + '   ERR: health check timed out',
    '2026-08-10T13:30:21.100000 ' + C + '   WARNING - disk almost full',
    '2026-08-10T13:30:21.200000 ' + C + '   FATAL out of memory'
  ].join('\n'));
  agree('supervisor lines: no level but an error word -> ERROR (the viewer heuristic, now shared)', [
    '2026-08-10T13:30:21.000000 ' + C + '   "program exited with failure" program=runtime',
    '2026-08-10T13:30:21.100000 ' + C + '   container unhealthy, restarting',
    '2026-08-10T13:30:21.200000 ' + C + '   "program exited" program=runtime'
  ].join('\n'));
  agree('a timestamped line without a [source] is a Platform record', [
    '2026-08-10 13:30:21.000 buildpack: staging complete',
    '2026-08-10T13:30:22Z Exception while staging'
  ].join('\n'));
  agree('Studio Pro console / on-premises lines: no [source], with and without " - "', [
    '2024-01-15 09:12:34.567  INFO - Core: Mendix Runtime starting',
    '2024-01-15 09:12:35.000  ERROR - Connector: failed',
    '\tat com.mendix.Foo.bar(Foo.java:1)',
    '2024-01-15T09:12:36+02:00 WARNING Core: plain shape without the dash',
    '09:12:37 ERROR Core: time-only shape',
    '[09:12:38] INFO Core: bracketed time-only shape'
  ].join('\n'));
  agree('foreign lines (opensaml, java.util.logging) are records; a PostgreSQL ERROR: detail is not', [
    '2026-08-10T13:29:40.100000 ' + C + '  INFO - Core: before',
    '[JettyServer-13962] INFO org.opensaml.xmlsec.algorithm.AlgorithmSupport - Mapping from x to y',
    'WARNING: Supplied DOM uses namespaces, but is not created as namespace-aware',
    '2026-08-10T13:29:40.200000 ' + C + '  ERROR - ConnectionBus: query failed',
    'org.postgresql.util.PSQLException: ERROR: relation "x" does not exist',
    'ERROR: relation "x" does not exist'
  ].join('\n'));
  agree('CRLF line endings read the same as LF', [
    '2026-08-10T13:29:40.100000 ' + C + '  INFO - Core: a',
    '2026-08-10T13:29:40.200000 ' + C + '   "no auth required"',
    '2026-08-10T13:29:40.300000 ' + C + '  ERROR - Core: b',
    '\tat com.x.Y.z(Y.java:1)'
  ].join('\r\n'));

  // Studio Pro CSV: a row is located by the physical line it starts on, so a quoted
  // multi-line message moves the next row's line number by its length — and CRLF inside
  // the quoted field reads the same as LF.
  const csvText = [
    'Type,TimeStamp,LogNode,Message',
    'Info,2024-01-15 09:00:00,Core,"first"',
    'Error,2024-01-15 09:00:01,Connector,"line one',
    'line two',
    'line three",java.lang.RuntimeException',
    '',
    'Warning,2024-01-15 09:00:02,Core,"third"'
  ].join('\r\n');
  const csvRes = parser.parse(csvText);
  eq('csv: format detected by content', csvRes.format, 'csv');
  eq('csv: record lines are physical lines (2, 3, 7)', csvRes.records.map(r => r.line).join(','), '2,3,7');
  const csvLf = csvText.replace(/\r\n/g, '\n');
  ok('csv: every offset points at its row in the LF-normalized text',
    csvRes.records.every(r => csvLf.substr(r.offset, 5) === ['Info,', 'Error', 'Warni'][csvRes.records.indexOf(r)]));
  eq('csv: CRLF inside a quoted field reads as LF', csvRes.records[1].message, 'line one\nline two\nline three');
  eq('csv: the viewer shows the cause under the message', lvView(csvRes.records[1]).msg, 'line one\nline two\nline three\njava.lang.RuntimeException');
  eq('csv: Warning is WARN, as the viewer always showed it', csvRes.records[2].level, 'WARN');

  // Studio Pro writes MM/dd/yyyy even on a machine whose regional settings say
  // dd.MM.yyyy (checked on pl-PL); every tool shows the date day first (wave 37).
  const spCsv = [
    'Type,TimeStamp,LogNode,Message,Cause',
    'Trace,09/27/2026 20:44:00,MicroflowEngine,[a1b2c3d4] Starting execution of microflow \'Mod.Checkout\',',
    'Trace,09/27/2026 20:44:03,MicroflowEngine,[a1b2c3d4] Finished execution of microflow \'Mod.Checkout\',',
    'Info,2026-09-27 20:44:04,Core,an ISO stamp is left as it is,'
  ].join('\n');
  const spRes = parser.parse(spCsv);
  eq('csv: the timestamp is shown day first', spRes.records[0].timestamp, '27/09/2026 20:44:00');
  eq('csv: a timestamp that is not month-first is left alone', spRes.records[2].timestamp, '2026-09-27 20:44:04');
  eq('csv: the day-first stamp reads as the right instant',
    new Date(global.mtTsToMs(spRes.records[0].timestamp)).toISOString(), '2026-09-27T20:44:00.000Z');
  // The Log Viewer read no CSV date at all until wave 37, so a Studio Pro log had no
  // request durations in Correlation Flow and no window in the Incident Report.
  const spCorr = global.logExtractCorrelations(spRes.records).groups.filter(g => g.id === 'a1b2c3d4')[0];
  eq('csv: Correlation Flow measures a request from a Studio Pro export', spCorr && spCorr.spanMs, 3000);
  const spEntries = global.logRecordsToEntries(spRes.records, spCsv, 'sp.csv');
  ok('csv: the raw line the viewer searches carries the same day-first date',
    spEntries[0].raw.indexOf('Trace,27/09/2026 20:44:00,') === 0, spEntries[0].raw);

  const plSample = path.join(__dirname, '..', '_local_assets', 'FilesForTest', 'Studio Pro Console export pl-PL 2026-09-27.csv');
  if (fs.existsSync(plSample)) {
    const plRes = parser.parse(fs.readFileSync(plSample, 'utf8'));
    eq('pl-PL export: first stamp day first', plRes.records[0].timestamp, '27/09/2026 20:43:59');
    ok('pl-PL export: every stamp reads as a time on 27 September',
      plRes.records.length > 50 && plRes.records.every(r => new Date(global.mtTsToMs(r.timestamp)).toISOString().slice(0, 10) === '2026-09-27'));
  } else {
    console.log('  (skipped: pl-PL Studio Pro sample not present locally)');
  }

  const pre = parser.parse('garbage before the log\n2026-08-10T13:29:40.100000 ' + C + '  INFO - Core: a');
  eq('preamble before the first record: skipped, not turned into a record', pre.records.length, 1);
  eq('preamble before the first record: counted as skipped', pre.skipped, 1);

  // The corpus where the two parsers disagreed. Local only — it holds real user data.
  const icDir = path.join(__dirname, '..', '_local_assets', 'FilesForTest', 'NewLogs', 'Intercom');
  if (fs.existsSync(icDir)) {
    fs.readdirSync(icDir).filter(f => /^logs_/.test(f)).forEach(f => {
      agree('NewLogs Intercom ' + f.slice(-14, -4) + ': shared parser == old Log Viewer', fs.readFileSync(path.join(icDir, f), 'utf8'));
    });
  } else {
    console.log('  (skipped: real corpus not present locally — _local_assets/FilesForTest/NewLogs/Intercom)');
  }
})();

// ── Summary ─────────────────────────────────────────────────────────────────
runNginxAsyncTests().then(runAnonTests).then(function () {
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
}, function (err) {
  console.log('  ✗ async suite crashed — ' + (err && err.stack || err));
  console.log('\n' + passed + ' passed, ' + (failed + 1) + ' failed');
  process.exit(1);
});
