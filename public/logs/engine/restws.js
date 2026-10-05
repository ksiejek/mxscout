/* MxScout — Log analysis module.
 *
 * REST & WS Extractor: rebuilds REST Consume / REST Publish / SOAP calls from TRACE logs and pairs requests with responses.
 *
 * Derived from MxDevSwissTool by Mikołaj (RealMecowhy),
 * https://github.com/RealMecowhy/MxDevSwissTool — MIT License, Copyright (c) 2026 Mikołaj.
 * Source: public/js/tools/ws-rest-extractor.js (extraction, pairing, per-endpoint aggregate; the lists and detail pane are rebuilt in public/logs/ui/)
 * The logic is carried over unchanged, so MxScout reads every log the way the original does;
 * only the packaging differs (no DOM, no network, no build step).
 * The licence text is in THIRD-PARTY-NOTICES.md at the root of this repository.
 */
(function (root) {
'use strict';
// The original reads these through `window`; `root` is the page on the main thread and the
// worker/Node global elsewhere, so the same code runs in all three.
const window = root;

// RFC 7230 token characters — a continuation line is a header only if it looks
// like `Name: value` with a space-free token name (JSON/XML/prose lines don't).
const WSRE_HEADER_RE = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+):\s?(.*)$/;
const WSRE_ANCHOR_WINDOW_MS = 10000; // CallRest fires ~2 ms before the block; 10 s drops stale anchors

// Continuation lines of a Request/Response record → { status, statusText, headers, body }.
// The live-log parser drops blank lines, so the header/body boundary is detected by
// shape: the first line that doesn't look like `Name: value` starts the body.
function wsreParseHttpBlock(lines, start, expectStatus) {
  let i = start;
  while (i < lines.length && !lines[i].trim()) i++;
  let status = null;
  let statusText = '';
  if (expectStatus && i < lines.length) {
    const sm = lines[i].match(/^HTTP\/[\d.]+\s+(\d{3})\s*(.*)$/);
    if (sm) { status = parseInt(sm[1], 10); statusText = sm[2].trim(); i++; }
  }
  const headers = [];
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; break; } // explicit separator (CSV export keeps blank lines)
    const hm = line.match(WSRE_HEADER_RE);
    if (!hm) break;
    headers.push({ name: hm[1], value: hm[2] });
    i++;
  }
  return { status: status, statusText: statusText, headers: headers, body: lines.slice(i).join('\n').trim() };
}

function wsreNewCall(rec, ri, node, direction, kind) {
  return {
    id: 0,
    node: node,
    direction: direction, // 'out' = app calls external service, 'in' = external client calls app
    kind: kind,           // 'rest' | 'soap'
    method: '',
    url: '',
    service: null,        // WS publish: published service name
    operation: null,      // publish: matched operation; SOAP: SOAPAction / response operation
    clientIp: null,
    status: null,
    statusText: '',
    requestHeaders: [],
    responseHeaders: [],
    requestBody: '',
    responseBody: '',
    timeoutSec: null,
    startTs: rec.timestamp,
    startMs: mtTsToMs(rec.timestamp),
    endTs: null,
    durationMs: null,
    uncertain: false,
    timeoutSuspect: false,
    corrId: null,
    microflow: null,
    _recIdx: ri
  };
}

// Pure extraction over shared-parser records — no DOM, testable in Node.
function wsreExtractCalls(records) {
  const calls = [];
  const pendingOut = new Map();    // node|method|url -> FIFO of consume calls awaiting a response
  const openPublish = [];          // REST Publish incoming awaiting Outgoing response / 404 (FIFO)
  const openWsIn = [];             // WebServices incoming awaiting Finished (FIFO)
  const anchors = { rest: [], soap: [] }; // CallRest / CallWebservice activities not yet claimed
  const clientTimeouts = new Map();       // node|host -> timeout seconds from "Creating http client"

  for (let ri = 0; ri < records.length; ri++) {
    const rec = records[ri];
    const node = rec.logNode;
    const msg = rec.message;

    if (node === 'MicroflowEngine') {
      const isRest = msg.indexOf('"type":"CallRest"') !== -1;
      if (!isRest && msg.indexOf('"type":"CallWebservice"') === -1) continue;
      const am = msg.match(/^\[([^\]\s]+)\]\s+Executing activity:\s*(\{[\s\S]*)$/);
      if (!am) continue;
      let name = null;
      try { name = JSON.parse(am[2]).name || null; } catch (e) { /* truncated JSON */ }
      anchors[isRest ? 'rest' : 'soap'].push({ corrId: am[1], microflow: name, ms: mtTsToMs(rec.timestamp) });
      continue;
    }

    if (node !== 'REST Consume' && node !== 'REST Publish' && node !== 'WebServices') continue;

    const lines = msg.split('\n');
    const first = lines[0];
    let m;

    // ── Outgoing (consume) side: REST Consume + WebServices client calls ──────
    m = first.match(/^Creating http client for (\S+) with timeout = (\d+)s/);
    if (m) {
      clientTimeouts.set(node + '|' + m[1], parseInt(m[2], 10));
      continue;
    }

    m = first.match(/^Request content for (\S+) request to (\S+?)(?:\s+HTTP\/[\d.]+)?$/);
    if (m) {
      const call = wsreNewCall(rec, ri, node, 'out', node === 'WebServices' ? 'soap' : 'rest');
      call.method = m[1];
      call.url = m[2];
      const parsed = wsreParseHttpBlock(lines, 1, false);
      call.requestHeaders = parsed.headers;
      call.requestBody = parsed.body;
      const soapAction = parsed.headers.find(h => h.name.toLowerCase() === 'soapaction');
      if (soapAction) call.operation = soapAction.value.replace(/^"|"$/g, '').replace(/^urn:/, '');
      const hostMatch = call.url.match(/^[a-z][a-z0-9+.-]*:\/\/([^\/:?#]+)/i);
      if (hostMatch && clientTimeouts.has(node + '|' + hostMatch[1])) {
        call.timeoutSec = clientTimeouts.get(node + '|' + hostMatch[1]);
      }
      // Claim the oldest fresh CallRest/CallWebservice anchor (FIFO — one anchor, one call)
      const aq = anchors[call.kind];
      while (aq.length && !isNaN(call.startMs) && call.startMs - aq[0].ms > WSRE_ANCHOR_WINDOW_MS) aq.shift();
      if (aq.length && aq[0].ms <= call.startMs) {
        const a = aq.shift();
        call.corrId = a.corrId;
        call.microflow = a.microflow;
      }
      const qk = node + '|' + call.method + '|' + call.url;
      let q = pendingOut.get(qk);
      if (!q) { q = []; pendingOut.set(qk, q); }
      if (q.length) { call.uncertain = true; q.forEach(c => { c.uncertain = true; }); }
      q.push(call);
      calls.push(call);
      continue;
    }

    m = first.match(/^Response content for (\S+) request to (\S+)$/);
    if (m) {
      const q = pendingOut.get(node + '|' + m[1] + '|' + m[2]);
      if (q && q.length) {
        const call = q.shift();
        const parsed = wsreParseHttpBlock(lines, 1, true);
        call.status = parsed.status;
        call.statusText = parsed.statusText;
        call.responseHeaders = parsed.headers;
        call.responseBody = parsed.body;
        call.endTs = rec.timestamp;
        const endMs = mtTsToMs(rec.timestamp);
        if (!isNaN(endMs) && !isNaN(call.startMs)) call.durationMs = endMs - call.startMs;
      }
      continue;
    }

    // ── Incoming (publish) side: REST Publish ─────────────────────────────────
    if (node === 'REST Publish') {
      m = first.match(/^Incoming request from (\S+): (\S+) (\S+)$/);
      if (m) {
        const call = wsreNewCall(rec, ri, node, 'in', 'rest');
        call.clientIp = m[1];
        call.method = m[2];
        call.url = m[3];
        const parsed = wsreParseHttpBlock(lines, 1, false);
        call.requestHeaders = parsed.headers;
        call.requestBody = parsed.body;
        if (openPublish.length) { call.uncertain = true; openPublish.forEach(c => { c.uncertain = true; }); }
        openPublish.push(call);
        calls.push(call);
        continue;
      }
      m = first.match(/^Executing operation (\S+)\s+(\S+)$/);
      if (m) {
        const call = openPublish.find(c => !c.operation);
        if (call) call.operation = m[2];
        continue;
      }
      m = first.match(/^Responding with (\d{3})\s*([^,]*), because no operation matches (\S+)/);
      if (m) {
        const idx = openPublish.findIndex(c => c.url === m[3]);
        if (idx !== -1) {
          const call = openPublish.splice(idx, 1)[0];
          call.status = parseInt(m[1], 10);
          call.statusText = m[2].trim();
          call.responseBody = first;
          call.endTs = rec.timestamp;
          const endMs = mtTsToMs(rec.timestamp);
          if (!isNaN(endMs) && !isNaN(call.startMs)) call.durationMs = endMs - call.startMs;
        }
        continue;
      }
      if (/^Outgoing response:/.test(first)) {
        const call = openPublish.shift();
        if (call) {
          const parsed = wsreParseHttpBlock(lines, 1, true);
          call.status = parsed.status;
          call.statusText = parsed.statusText;
          call.responseHeaders = parsed.headers;
          call.responseBody = parsed.body;
          call.endTs = rec.timestamp;
          const endMs = mtTsToMs(rec.timestamp);
          if (!isNaN(endMs) && !isNaN(call.startMs)) call.durationMs = endMs - call.startMs;
        }
        continue;
      }
      continue; // routing/query-parameter noise
    }

    // ── Incoming (publish) side: WebServices (SOAP) ───────────────────────────
    if (node === 'WebServices') {
      m = first.match(/^Incoming web service request from (\S+) for service '([^']+)'/);
      if (m) {
        const call = wsreNewCall(rec, ri, node, 'in', 'soap');
        call.clientIp = m[1];
        call.method = 'POST';
        call.service = m[2];
        if (openWsIn.length) { call.uncertain = true; openWsIn.forEach(c => { c.uncertain = true; }); }
        openWsIn.push(call);
        calls.push(call);
        continue;
      }
      m = msg.match(/^Incoming web service request data:\s*([\s\S]*)$/);
      if (m) {
        const call = openWsIn[openWsIn.length - 1]; // data record immediately follows its Incoming record
        if (call && !call.requestBody) call.requestBody = m[1].trim();
        continue;
      }
      m = msg.match(/^Header ([!#$%&'*+.^_`|~0-9A-Za-z-]+):\s?([\s\S]*)$/);
      if (m) {
        const call = openWsIn[openWsIn.length - 1];
        if (call) call.requestHeaders.push({ name: m[1], value: m[2] });
        continue;
      }
      m = msg.match(/^\[(\S+) chunk: \d+\]\s*([\s\S]*)$/);
      if (m) {
        const call = openWsIn[0]; // responses stream for the oldest in-flight request
        if (call) {
          if (!call.operation) call.operation = m[1];
          call.responseBody += m[2];
        }
        continue;
      }
      m = first.match(/^Finished handling web service request for service '([^']+)'/);
      if (m) {
        const idx = openWsIn.findIndex(c => c.service === m[1]);
        if (idx !== -1) {
          const call = openWsIn.splice(idx, 1)[0];
          call.endTs = rec.timestamp;
          const endMs = mtTsToMs(rec.timestamp);
          if (!isNaN(endMs) && !isNaN(call.startMs)) call.durationMs = endMs - call.startMs;
          call.statusText = /:Fault>|<Fault>/i.test(call.responseBody) ? 'SOAP Fault' : 'OK';
        }
        continue;
      }
      continue;
    }
  }

  // Post-pass: unanswered calls — an outgoing request with a known client timeout
  // and no logged response is the classic client-timeout signature.
  let uncertain = 0;
  let unanswered = 0;
  let errors = 0;
  for (const call of calls) {
    if (call.uncertain) uncertain++;
    if (call.endTs === null) {
      unanswered++;
      if (call.direction === 'out' && call.timeoutSec !== null) call.timeoutSuspect = true;
    }
    if ((call.status !== null && call.status >= 400) || call.statusText === 'SOAP Fault') errors++;
  }

  let sum = 0, timed = 0, maxMs = -1, maxId = null;
  for (const call of calls) {
    if (call.durationMs !== null && !isNaN(call.durationMs)) {
      sum += call.durationMs;
      timed++;
      if (call.durationMs > maxMs) { maxMs = call.durationMs; maxId = call.id; }
    }
  }

  calls.forEach((c, i) => { c.id = i; });
  if (maxId !== null) maxId = calls.findIndex(c => c.durationMs === maxMs);

  return {
    calls: calls,
    stats: {
      total: calls.length,
      uncertain: uncertain,
      unanswered: unanswered,
      errors: errors,
      timedCount: timed,
      totalMs: sum,
      maxMs: maxMs,
      maxId: maxId
    }
  };
}


function wsreIsError(c) {
  return (c.status !== null && c.status >= 400) || c.statusText === 'SOAP Fault';
}

// Human label for the endpoint cell: URL for HTTP calls, service (operation) for WS publish
function wsreEndpoint(c) {
  if (c.service) return c.service + (c.operation ? ' → ' + c.operation : '');
  return c.url || '';
}


function wsreFmtMs(ms) {
  if (ms >= 10000) return (ms / 1000).toFixed(1) + ' s';
  if (ms >= 100) return Math.round(ms) + ' ms';
  return ms.toFixed(2) + ' ms';
}


// Cumulative request+response payload bytes per endpoint — spots over-fetching
// endpoints at a glance. Pure aggregation over already-extracted calls, so it is
// unit-testable like wsreExtractCalls. UTF-8 byte size via Blob; falls back to
// character count in environments without Blob (Node tests).
function wsreByteLength(str) {
  if (!str) return 0;
  if (typeof Blob !== 'undefined') return new Blob([str]).size;
  return str.length;
}

function wsreEndpointTotals(calls) {
  const map = new Map(); // endpoint label -> { bytes, count }
  (calls || []).forEach(function (c) {
    const key = wsreEndpoint(c);
    if (!key) return;
    if (!map.has(key)) map.set(key, { bytes: 0, count: 0 });
    const e = map.get(key);
    e.bytes += wsreByteLength(c.requestBody) + wsreByteLength(c.responseBody);
    e.count += 1;
  });
  return map;
}

// ── "By endpoint" aggregate ──────────────────────────────────────────────────
// An integration incident is "endpoint X fires 300× on page open, averaging
// 700 ms", not "call #4172 took 900 ms". The per-call list cannot say that, and
// wsreEndpointTotals — which already existed — only fed a single line in the
// detail pane. This is the same fold, surfaced as a view.
//
// Durations exist only for calls whose response was found in the log, so the
// timed count travels with each group: an endpoint whose responses were never
// logged reports null, not 0 ms, and its call count still tells the story.
function wsreAggregateByEndpoint(calls) {
  const map = new Map();
  (calls || []).forEach(function (c) {
    const key = wsreEndpoint(c) || '(unknown endpoint)';
    let g = map.get(key);
    if (!g) {
      g = { endpoint: key, sample: c, worst: null, count: 0, timedCount: 0, sumMs: 0,
            avgMs: null, maxMs: null, errors: 0, unanswered: 0, uncertain: 0, methods: new Set() };
      map.set(key, g);
    }
    g.count++;
    if (c.method) g.methods.add(c.method);
    if (wsreIsError(c)) g.errors++;
    if (c.endTs === null) g.unanswered++;
    if (c.uncertain) g.uncertain++;
    const d = (c.durationMs !== null && !isNaN(c.durationMs)) ? c.durationMs : NaN;
    if (!isNaN(d)) {
      g.timedCount++;
      g.sumMs += d;
      if (g.maxMs === null || d > g.maxMs) { g.maxMs = d; g.worst = c; }
    }
  });

  const groups = Array.from(map.values());
  groups.forEach(function (g) {
    g.avgMs = g.timedCount ? g.sumMs / g.timedCount : null;
    if (!g.timedCount) g.sumMs = null;
    if (!g.worst) g.worst = g.sample;
  });
  // Total time first, then call volume for the endpoints the log never timed.
  groups.sort(function (a, b) {
    const d = (b.sumMs || 0) - (a.sumMs || 0);
    return d !== 0 ? d : b.count - a.count;
  });
  return groups;
}

function wsreFmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}


const WSRE_EXPORT_HEADER = ['Time', 'Node', 'Direction', 'Method', 'Status', 'Duration (ms)', 'Endpoint', 'Microflow', 'Corr ID', 'Flags'];
// Endpoints are a different shape from calls, so the export follows the active
// view. "Timed" travels with the totals for the same reason it does on screen.
const WSRE_ENDPOINT_EXPORT_HEADER = ['Calls', 'Total (ms)', 'Avg (ms)', 'Max (ms)', 'Timed', 'Errors', 'No response', 'Methods', 'Endpoint'];


function wsreEndpointExportRows(groups) {
  return groups.map(g => [
    g.count,
    g.sumMs === null ? '' : +g.sumMs.toFixed(3),
    g.avgMs === null ? '' : +g.avgMs.toFixed(3),
    g.maxMs === null ? '' : +g.maxMs.toFixed(3),
    g.timedCount,
    g.errors || '',
    g.unanswered || '',
    Array.from(g.methods).join(' '),
    g.endpoint
  ]);
}


  root.WSRE_HEADER_RE = WSRE_HEADER_RE;
  root.wsreParseHttpBlock = wsreParseHttpBlock;
  root.wsreNewCall = wsreNewCall;
  root.wsreExtractCalls = wsreExtractCalls;
  root.wsreIsError = wsreIsError;
  root.wsreEndpoint = wsreEndpoint;
  root.wsreFmtMs = wsreFmtMs;
  root.wsreByteLength = wsreByteLength;
  root.wsreEndpointTotals = wsreEndpointTotals;
  root.wsreAggregateByEndpoint = wsreAggregateByEndpoint;
  root.wsreFmtBytes = wsreFmtBytes;
  root.WSRE_EXPORT_HEADER = WSRE_EXPORT_HEADER;
  root.WSRE_ENDPOINT_EXPORT_HEADER = WSRE_ENDPOINT_EXPORT_HEADER;
  root.wsreEndpointExportRows = wsreEndpointExportRows;
})(typeof window !== 'undefined' ? window : self);
