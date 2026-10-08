/* MxScout — Log analysis module.
 *
 * Nginx (Mendix Cloud rtr) access / error log analyzer and the Timeline Correlator that lines requests up with runtime activity.
 *
 * Derived from MxDevSwissTool by Mikołaj (RealMecowhy),
 * https://github.com/RealMecowhy/MxDevSwissTool — MIT License, Copyright (c) 2026 Mikołaj.
 * Source: public/js/tools/nginx.js and nginx-correlator.js (parsers, 404 classifier, correlation; the aggregation that was written inline with the DOM is lifted out as pure functions)
 * The logic is carried over unchanged, so MxScout reads every log the way the original does;
 * only the packaging differs (no DOM, no network, no build step).
 * The licence text is in THIRD-PARTY-NOTICES.md at the root of this repository.
 */
(function (root) {
'use strict';
// The original reads these through `window`; `root` is the page on the main thread and the
// worker/Node global elsewhere, so the same code runs in all three.
const window = root;

const NGINX_WORKER_THRESHOLD = 2 * 1024 * 1024;

// Per-line hourStr derivation, shared by every call site (was duplicated 3x
// inline before this fala). Pure.
function nginxDeriveHourStr(dateStr) {
  const timeMatch1 = dateStr.match(/^(\d{2}\/\w{3}\/\d{4}:\d{2})/);
  const timeMatch2 = dateStr.match(/^(\d{4}-\d{2}-\d{2}T\d{2})/);
  if (timeMatch1) return timeMatch1[1];
  if (timeMatch2) return timeMatch2[1].replace('T', ' ');
  return dateStr.substring(0, 13);
}

// Streams `file` (optionally gzip) through the given per-line parser,
// building the records array exactly like the old inline loop did. Runs
// directly on the main thread for small files, or is serialized via
// `.toString()` into a Worker for large ones (nginxParseInWorker below) — so
// it must stay self-contained: only its own parameters, `DecompressionStream`/
// `TextDecoder` (both available in a Worker), and nginxDeriveHourStr, which
// gets inlined alongside it when building the worker source.

// Streams `file` (optionally gzip) through the given per-line parser,
// building the records array exactly like the old inline loop did. Runs
// directly on the main thread for small files, or is serialized via
// `.toString()` into a Worker for large ones (nginxParseInWorker below) — so
// it must stay self-contained: only its own parameters, `DecompressionStream`/
// `TextDecoder` (both available in a Worker), and nginxDeriveHourStr, which
// gets inlined alongside it when building the worker source.
async function nginxStreamParseFile(file, isGz, type, parseLineFn, onProgress) {
  let stream = file.stream();
  if (isGz) stream = stream.pipeThrough(new DecompressionStream('gzip'));
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  const records = [];
  let scanned = 0, matched = 0, sample = '';
  let totalBytes = 0, chunkCount = 0;

  function handleLine(raw) {
    const line = raw.trim();
    if (!line) return;
    const parsed = parseLineFn(line);
    if (type === 'error') {
      scanned++;
      if (parsed) matched++;
      else if (!sample) sample = line;
    }
    if (parsed) {
      parsed.hourStr = nginxDeriveHourStr(parsed.date);
      records.push(parsed);
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      totalBytes += value.length;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (let i = 0; i < lines.length; i++) handleLine(lines[i]);
      chunkCount++;
      if (chunkCount % 20 === 0 && onProgress) {
        onProgress(totalBytes);
        await new Promise(r => setTimeout(r, 0)); // yield (no-op inside a Worker, harmless)
      }
    }
    if (done) {
      if (buffer.trim()) handleLine(buffer);
      break;
    }
  }
  return { records, scanned, matched, sample, totalBytes };
}


const NGINX_REGEX = /^(\S+)\s+\S+\s+(\S+)\s+\[([^\]]+)\]\s+"(?:(\S+)\s+(\S+)\s+(\S+)|([^"]+))"\s+(\d{3})\s+(\d+|-)\s+"([^"]*)"\s+"([^"]*)"(?:\s+"?([\d.]+)"?)?/;

function nginxParseLine(line) {
  if (line.includes('request="') && line.includes('status="')) {
    const timeMatch = line.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
    const date = timeMatch ? timeMatch[1] + 'T' + timeMatch[2] : line.split(' ')[0];
    const dateOnly = timeMatch ? timeMatch[1] : '';
    const timeOnly = timeMatch ? timeMatch[2] : '';
    
    const kv = {};
    const regex = /(\w+)="([^"]*)"/g;
    let m;
    while ((m = regex.exec(line)) !== null) {
      kv[m[1]] = m[2];
    }
    
    let method = 'UNKNOWN';
    let url = '-';
    if (kv.request) {
      const parts = kv.request.split(' ');
      method = parts[0] || 'UNKNOWN';
      url = parts[1] || '-';
    }
    
    let ip = kv.remote_addr || '-';
    if (kv.http_x_forwarded_for && kv.http_x_forwarded_for !== '-') {
      ip = kv.http_x_forwarded_for.split(',')[0].trim();
    }
    
    return {
      ip: ip,
      date: date,
      dateOnly: dateOnly,
      timeOnly: timeOnly,
      method: method,
      url: url,
      status: parseInt(kv.status, 10) || 0,
      bytes: parseInt(kv.response_size_in_bytes, 10) || 0,
      time: parseFloat(kv.response_time_in_seconds) || 0,
      referer: kv.http_referer || '-',
      userAgent: kv.http_user_agent || '-',
      rawLine: line
    };
  }

  const match = line.match(NGINX_REGEX);
  if (!match) return null;
  const dateFull = match[3];
  const dateOnly = dateFull ? dateFull.split(':')[0] : '';
  const timeOnly = dateFull && dateFull.includes(':') ? dateFull.substring(dateFull.indexOf(':') + 1).split(' ')[0] : '';
  return {
    ip: match[1],
    date: dateFull,
    dateOnly: dateOnly,
    timeOnly: timeOnly,
    method: match[4] || 'UNKNOWN',
    url: match[5] || match[7] || '-',
    status: parseInt(match[8], 10),
    bytes: match[9] === '-' ? 0 : parseInt(match[9], 10),
    time: match[12] ? parseFloat(match[12]) : 0,
    referer: match[10],
    userAgent: match[11],
    rawLine: line
  };
}

// Pure: distinct client IPs per URL (12.8) — separates "one client hammering
// an endpoint" from "many real users hitting it", which the existing per-URL
// hit COUNT alone can't distinguish. A second pass over filteredLogs (the
// same list nginxAggregateAndRender already builds referrersMap from in a
// separate pass below), not folded into the main stats loop, so it stays
// independently testable without the DOM-heavy render function around it.
// ── 404 classification (pure; window/self like edxDecode / logExtractInsights) ─
//
// Why this exists: in a real Mendix access log the 404s are not one population
// but three, and mixing them hides the only one the developer can act on. In
// 7 791 364 requests from ten production apps there were 48 499 404s, of which
// ~96% were internet scanners probing for software the app does not run. The
// handful that were genuinely broken references in the app itself — a REST
// endpoint, a theme image, a webfont, two widget source maps — sat invisibly
// underneath them.
//
// The classifier therefore answers "whose fault is this 404", not "is this a
// bot": SCANNER (a probe for software you do not run), CONVENTION (a browser or
// OS asking for something it always asks for), or APP (everything left — most
// likely your own reference, and the honest default when nothing is proven).
const NGINX_SCANNER_PATH = [
  [/\.(?:php|phtml|jsp|jspx|asp|aspx|cgi|pl|do|action)(?:[/?]|$)/i, 'requests a PHP/JSP/ASP/CGI file — a Mendix app serves none'],
  [/\/(?:wp-admin|wp-login|wp-json|wp-content|wp-includes|xmlrpc)/i, 'WordPress path'],
  [/\/(?:phpmyadmin|pma|adminer|myadmin)(?:[/?]|$)/i, 'database admin panel probe'],
  [/\/cgi-bin(?:[/?]|$)/i, 'CGI directory probe'],
  [/\/\.(?:env|git|svn|aws|ssh|hg|bzr|bak)(?:[/?]|$)/i, 'secrets/VCS/backup file probe'],
  [/\/(?:realms\/master|auth\/realms)/i, 'Keycloak probe'],
  [/\/\+CSCOT\+\//i, 'Cisco appliance probe'],
  [/\/(?:nagiosxi|CDGServer3|kylin|solr|jenkins|zabbix|grafana|_session|actuator|jmx-console|struts|_ignition|server-status)(?:[/?]|$)/i, 'probe for third-party software you do not run'],
  [/\/(?:manager\/html|host-manager)/i, 'Tomcat manager probe'],
  [/\/(?:nuclei|lander)(?:[./?]|$)/i, 'known scanner artefact'],
  [/\/(?:graphql|api\/graphql)(?:[/?]|$)/i, 'GraphQL probe — Mendix publishes REST/OData, not GraphQL'],
  [/(?:union\s+select|etc\/passwd|cmd\.exe|\/bin\/sh|%00|\.\.[/\\])/i, 'injection or path-traversal attempt'],
  [/\/(?:login|admin|signin|user\/login|session_login)(?:[/?]|$)/i, 'generic login-page probe'],
  [/\/(?:heapdump|\.DS_Store|web\.config|\.htaccess)(?:[/?]|$)/i, 'sensitive-file probe']
];
const NGINX_SCANNER_UA = [
  [/(?:nikto|nmap|sqlmap|zgrab|masscan|nuclei|wpscan|dirbuster|gobuster|feroxbuster|netsparker|acunetix|zmeu)/i, 'known scanner user agent']
];
// Requested automatically by browsers/OSes; a 404 here means "not configured",
// never "broken", so it must not be mixed into either of the other buckets.
const NGINX_CONVENTION_PATH = [
  [/^\/apple-touch-icon/i, 'iOS home-screen icon — Safari requests it unprompted'],
  [/^\/favicon\.ico$/i, 'browser favicon request'],
  [/^\/\.well-known\//i, 'well-known URI (app links, security.txt, change-password)'],
  [/^\/(?:robots\.txt|sitemap\.xml|browserconfig\.xml|ads\.txt|llms\.txt)$/i, 'crawler/OS convention file']
];
// An IP needs this many pattern-confirmed probes before its *other* 404s are
// attributed to the same sweep. Keeps one stray request from turning a real
// user's stale bookmark into a "scanner".
const NGINX_PROBE_MIN = 3;

function nginxMatchList(list, value) {
  for (let i = 0; i < list.length; i++) {
    if (list[i][0].test(value)) return list[i][1];
  }
  return null;
}

// records → { total404, scanner, convention, app, sources }
// Each bucket carries { requests, paths:[{path,hits,reason}] }; `sources` ranks
// the IPs behind the scanner traffic. Pure: no DOM, no globals, safe in Node.
function nginxClassifyTraffic(records) {
  const rows = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (Number(r.status) !== 404) continue;
    const url = String(r.url == null ? '' : r.url).replace(/\?.*/, '');
    const ua = String(r.userAgent == null ? '' : r.userAgent);
    let bucket = 'app';
    let reason = 'not a known probe or browser convention — most likely a reference in your own app';
    const uaHit = nginxMatchList(NGINX_SCANNER_UA, ua);
    const convHit = uaHit ? null : nginxMatchList(NGINX_CONVENTION_PATH, url);
    const pathHit = (uaHit || convHit) ? null : nginxMatchList(NGINX_SCANNER_PATH, url);
    if (uaHit) { bucket = 'scanner'; reason = uaHit; }
    else if (convHit) { bucket = 'convention'; reason = convHit; }
    else if (pathHit) { bucket = 'scanner'; reason = pathHit; }
    rows.push({ url: url, ip: r.ip || '-', bucket: bucket, reason: reason, byPattern: bucket === 'scanner' });
  }

  // Second pass — behaviour beats pattern matching. An IP that provably probed
  // for software you do not run is not a legitimate client, so the rest of its
  // 404s belong to the same sweep. This is what keeps the APP bucket small
  // without maintaining an ever-growing blocklist of probe paths.
  const confirmed = {};
  rows.forEach(function (r) { if (r.byPattern) confirmed[r.ip] = (confirmed[r.ip] || 0) + 1; });
  rows.forEach(function (r) {
    if (r.bucket === 'app' && (confirmed[r.ip] || 0) >= NGINX_PROBE_MIN) {
      r.bucket = 'scanner';
      r.reason = 'same source as ' + confirmed[r.ip] + ' confirmed probes from this IP';
    }
  });

  const buckets = { scanner: {}, convention: {}, app: {} };
  const counts = { scanner: 0, convention: 0, app: 0 };
  const sources = {};
  rows.forEach(function (r) {
    counts[r.bucket]++;
    const b = buckets[r.bucket];
    if (!b[r.url]) b[r.url] = { path: r.url, hits: 0, reason: r.reason };
    b[r.url].hits++;
    if (r.bucket !== 'scanner') return;
    if (!sources[r.ip]) sources[r.ip] = { ip: r.ip, hits: 0, reason: r.reason, paths: {} };
    sources[r.ip].hits++;
    sources[r.ip].paths[r.url] = true;
    // Prefer a concrete pattern reason over the derived "same source as…" one.
    if (r.byPattern && /^same source as/.test(sources[r.ip].reason)) sources[r.ip].reason = r.reason;
  });

  function rank(map) {
    return Object.keys(map).map(function (k) { return map[k]; })
      .sort(function (a, b) { return b.hits - a.hits; });
  }

  return {
    total404: rows.length,
    scanner: { requests: counts.scanner, paths: rank(buckets.scanner) },
    convention: { requests: counts.convention, paths: rank(buckets.convention) },
    app: { requests: counts.app, paths: rank(buckets.app) },
    sources: Object.keys(sources).map(function (k) {
      return { ip: sources[k].ip, hits: sources[k].hits, reason: sources[k].reason, distinctPaths: Object.keys(sources[k].paths).length };
    }).sort(function (a, b) { return b.hits - a.hits; })
  };
}

function nginxUniqueIpsPerUrl(records) {
  const sets = {};
  records.forEach(r => {
    if (!sets[r.url]) sets[r.url] = new Set();
    sets[r.url].add(r.ip);
  });
  const counts = {};
  Object.keys(sets).forEach(url => { counts[url] = sets[url].size; });
  return counts;
}

function nginxGetOS(ua) {
  if (!ua || ua === '-') return 'Unknown';
  if (/windows/i.test(ua)) return 'Windows';
  if (/mac os/i.test(ua)) return 'Mac OS';
  if (/linux/i.test(ua)) return 'Linux';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad/i.test(ua)) return 'iOS';
  if (/bot|crawl|spider/i.test(ua)) return 'Bot/Crawler';
  return 'Other';
}

function nginxFormatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}


function nginxParseErrorLine(line) {
  const regex = /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}) \[(\w+)\] \d+#\d+: (?:\*\d+ )?(.*)/;
  const match = line.match(regex);
  if (!match) return null;
  
  const dateStr = match[1];
  const dateOnly = dateStr.split(' ')[0];
  const timeOnly = dateStr.split(' ')[1];
  const level = match[2];
  const fullMessage = match[3];
  
  let ip = '-';
  const clientMatch = fullMessage.match(/client: ([^, ]+)/);
  if (clientMatch) ip = clientMatch[1];
  
  let request = '-';
  const requestMatch = fullMessage.match(/request: "([^"]+)"/);
  if (requestMatch) request = requestMatch[1];
  
  let cleanMessage = fullMessage;
  const clientIdx = fullMessage.indexOf(', client: ');
  if (clientIdx !== -1) {
    cleanMessage = fullMessage.substring(0, clientIdx);
  }
  
  const hourStr = dateStr.substring(0, 13);
  
  return {
    date: dateStr,
    dateOnly: dateOnly,
    timeOnly: timeOnly,
    hourStr: hourStr,
    level: level,
    message: cleanMessage,
    ip: ip,
    request: request,
    type: 'error',
    rawLine: line
  };
}


// Parses an Nginx access-log timestamp ("18/Jul/2026:09:14:22 +0000") to epoch ms.
const NGINX_MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function nginxDateToMs(d) {
  if (!d) return NaN;
  const m = String(d).match(/(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s*([+-]\d{4})?/);
  if (!m || NGINX_MONTHS[m[2]] === undefined) return NaN;
  const base = Date.UTC(+m[3], NGINX_MONTHS[m[2]], +m[1], +m[4], +m[5], +m[6]);
  if (m[7]) { const off = (m[7][0] === '-' ? -1 : 1) * (parseInt(m[7].slice(1, 3), 10) * 60 + parseInt(m[7].slice(3, 5), 10)); return base - off * 60000; }
  return base;
}


// ======== correlator ========
// NGINX (rtr) ↔ APPLICATION LOG TIMELINE CORRELATOR
// ============================================================
// Companion to nginx.js — Fala 25, "Timeline Correlator" tab in the Nginx panel.
//
// Ten real apps' rtr_* files were checked field by field before writing this:
// the Mendix Cloud rtr log carries request/status/timing/UA fields and NOTHING
// that identifies a request across logs (no x-request-id, no echoed [corrId]).
// So a request can only be linked to application runtime activity by TIME
// PROXIMITY, never by identity. Every label here says "matched within ±Nms",
// never "this is the request that triggered it" — do not silently upgrade
// that wording later; it is the whole trust argument for the feature.
//
// Runtime-side events come from TWO sources, not one:
//  1. Correlation-ID groups from window.logExtractCorrelations (log-viewer.js,
//     Fala 20) — spans with flow/node/error context, built from the runtime's
//     own [corrId] marker. Rich, but only present on TRACE/DEBUG records.
//  2. Bare ERROR/WARNING/CRITICAL log lines that carry no [corrId] at all.
// (2) is not a fallback for rare cases — it is the NORM: checked against all
// ten apps in the NewLogs corpus, and every single one runs INFO-and-above
// only, so none of them ever emits a [corrId] anywhere. Building the runtime
// lane from corrId groups alone would make this feature empty-state on every
// real log this tool has ever seen. The two real, verified matches that led
// to this design: an rtr 404 for /wp-login.php at 00:02:55.142369 paired with
// the app log's "404 - file not found for file: wp-login.php" ERROR at
// 00:02:55.139200 (3.2ms apart) — a plain ERROR line, no correlation ID.


// ── Pure ──────────────────────────────────────────────────────────────────

// Both the rtr log and the application log write ISO timestamps with
// microsecond fractions and no offset (2026-08-10T00:00:04.812837) — same
// clock, treated as UTC, matching mtTsToMs (mendix-log-parser.js).
function nxCorrTsToMs(ts) {
  if (!ts) return NaN;
  const m = String(ts).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d+))?/);
  if (!m) return NaN;
  const base = Date.parse(m[1] + 'T' + m[2] + 'Z');
  const frac = m[3] ? parseFloat('0.' + m[3]) * 1000 : 0;
  return base + frac;
}

// A [corrId] bracket at the start of the message — same shape log-viewer.js's
// LOG_CORRID_MSG reads. Used only to avoid double-counting: a record already
// summarized inside a corrId group (source 1 below) is not also added as its
// own bare point (source 2).
const NXC_CORRID_MSG = /^\[([^\]\s]{4,64})\]\s/;

// Pure. appLogRecords: window.createMendixLogParser().parse(text).records
// ({level, timestamp, logNode, message}). corrGroups: the .groups array from
// window.logExtractCorrelations(appLogRecords). Returns one flat list of
// runtime "events" to correlate rtr requests against — see the file header
// for why both sources are needed.
function nxCorrBuildRuntimeEvents(appLogRecords, corrGroups) {
  const events = [];

  (corrGroups || []).forEach(function (g) {
    if (isNaN(g.firstMs) || isNaN(g.lastMs)) return;
    events.push({
      kind: 'flow', ms: g.firstMs, msEnd: g.lastMs,
      id: g.id, flow: g.flow, nodes: g.nodes || [], errors: g.errors, warnings: g.warnings, count: g.count
    });
  });

  (appLogRecords || []).forEach(function (r) {
    const level = String(r.level || '').toUpperCase();
    if (level !== 'ERROR' && level !== 'WARN' && level !== 'CRITICAL') return;
    if (NXC_CORRID_MSG.test(String(r.message || ''))) return; // already represented by its group above
    const ms = nxCorrTsToMs(r.timestamp);
    if (isNaN(ms)) return;
    events.push({
      kind: 'entry', ms: ms, msEnd: ms,
      level: level, node: r.logNode || '', message: String(r.message || '').split('\n')[0]
    });
  });

  return events;
}

// Pure. rtrRecords: nginxParseLine() output — needs .rawLine for sub-second
// precision (only the Mendix Cloud KV branch sets it); records without it are
// skipped rather than guessed at. events: nxCorrBuildRuntimeEvents(...) output.
// windowMs: how close in time counts as a match. Each rtr request links to at
// most its nearest event within the window; an event may end up linked from
// more than one request, left visible rather than resolved — resolving it
// would be inventing certainty the data doesn't have.
function nxCorrelate(rtrRecords, events, windowMs) {
  windowMs = typeof windowMs === 'number' && windowMs > 0 ? windowMs : 3000;

  const requests = [];
  (rtrRecords || []).forEach(function (r, i) {
    const ms = nxCorrTsToMs(r.rawLine || r.date);
    if (isNaN(ms)) return;
    requests.push({ ms: ms, status: r.status, method: r.method, url: r.url, time: r.time, ip: r.ip, index: i });
  });
  requests.sort(function (a, b) { return a.ms - b.ms; });

  const evs = (events || []).filter(function (e) { return !isNaN(e.ms) && !isNaN(e.msEnd); });

  const links = [];
  requests.forEach(function (req) {
    let bestIdx = -1, bestDist = Infinity;
    evs.forEach(function (e, i) {
      const dist = (req.ms >= e.ms && req.ms <= e.msEnd) ? 0
        : Math.min(Math.abs(req.ms - e.ms), Math.abs(req.ms - e.msEnd));
      if (dist <= windowMs && dist < bestDist) { bestDist = dist; bestIdx = i; }
    });
    if (bestIdx !== -1) links.push({ reqIndex: req.index, eventIndex: bestIdx, distMs: bestDist });
  });

  return { requests: requests, events: evs, links: links, windowMs: windowMs };
}


// ============================================================================
// MxScout additions — the aggregation that nginxAggregateAndRender() did inline
// while it wrote the DOM, lifted into pure functions so the page can be drawn
// from plain data (and tested). The arithmetic is the original's, statement for
// statement; only the HTML around it is gone.
// ============================================================================

// The access stream's own filter (search, status classes, date, time-of-day) —
// _nginxApplyStreamFiltersSync for type 'access'.
function nginxFilterAccess(logs, f) {
  const search = (f.search || '').toLowerCase();
  const classes = f.statusClasses;
  return logs.filter(function (log) {
    if (!log) return false;
    const statusClass = Math.floor(log.status / 100);
    if (classes.indexOf(statusClass) === -1) return false;
    if (f.date && log.dateOnly && log.dateOnly !== f.date) return false;
    if (f.timeFrom && log.timeOnly && log.timeOnly < f.timeFrom) return false;
    if (f.timeTo && log.timeOnly && log.timeOnly > f.timeTo) return false;
    if (search) return !!(log.rawLine && log.rawLine.toLowerCase().indexOf(search) !== -1);
    return true;
  });
}

// … and for type 'error'.
function nginxFilterErrors(logs, f) {
  const search = (f.search || '').toLowerCase();
  return logs.filter(function (log) {
    if (!log) return false;
    if (f.levels.indexOf(log.level) === -1) return false;
    if (f.date && log.dateOnly && log.dateOnly !== f.date) return false;
    if (f.timeFrom && log.timeOnly && log.timeOnly < f.timeFrom) return false;
    if (f.timeTo && log.timeOnly && log.timeOnly > f.timeTo) return false;
    if (search) return !!(log.rawLine && log.rawLine.toLowerCase().indexOf(search) !== -1);
    return true;
  });
}

// Everything the Analyzer view shows, for the (already stream-filtered) records.
// `drill` is the hour / IP / URL the reader clicked to narrow further; `totalParsed`
// is every access record that was read, for the "share of the file" figure.
function nginxAggregate(streamFiltered, drill, totalParsed) {
  drill = drill || {};
  let filteredLogs = streamFiltered;
  if (drill.hour) filteredLogs = filteredLogs.filter(function (l) { return l.hourStr === drill.hour; });
  if (drill.ip) filteredLogs = filteredLogs.filter(function (l) { return l.ip === drill.ip; });
  if (drill.url) filteredLogs = filteredLogs.filter(function (l) { return l.url === drill.url; });

  const stats = { total: 0, bytes: 0, errors: 0, ips: {}, urls: {}, statuses: {}, os: {}, hours: {}, urlTimes: {} };
  filteredLogs.forEach(function (parsed) {
    stats.total++;
    stats.bytes += parsed.bytes;
    if (parsed.status >= 400) stats.errors++;

    stats.ips[parsed.ip] = (stats.ips[parsed.ip] || 0) + 1;
    stats.urls[parsed.url] = (stats.urls[parsed.url] || 0) + 1;
    stats.statuses[parsed.status] = (stats.statuses[parsed.status] || 0) + 1;
    stats.hours[parsed.hourStr] = (stats.hours[parsed.hourStr] || 0) + 1;

    const os = nginxGetOS(parsed.userAgent);
    stats.os[os] = (stats.os[os] || 0) + 1;

    if (!stats.urlTimes[parsed.url]) stats.urlTimes[parsed.url] = { count: 0, totalBytes: 0, totalTime: 0, times: [] };
    stats.urlTimes[parsed.url].count++;
    stats.urlTimes[parsed.url].totalBytes += parsed.bytes;
    stats.urlTimes[parsed.url].totalTime += parsed.time || 0;
    if (parsed.time != null) stats.urlTimes[parsed.url].times.push(parsed.time);
  });

  // Who the 404s belong to — scanners, browser conventions, or your own app.
  const traffic = nginxClassifyTraffic(filteredLogs);

  const sortedHours = Object.entries(stats.hours).sort(function (a, b) { return a[0].localeCompare(b[0]); });
  let activeHour = '-';
  if (sortedHours.length > 0) {
    let maxHour = sortedHours[0];
    sortedHours.forEach(function (h) { if (h[1] > maxHour[1]) maxHour = h; });
    activeHour = maxHour[0];
  }

  const byCount = function (obj) { return Object.entries(obj).sort(function (a, b) { return b[1] - a[1]; }); };
  const topUrls = byCount(stats.urls).slice(0, 10);
  const topOs = byCount(stats.os).slice(0, 10);
  const topIps = byCount(stats.ips).slice(0, 10);

  const slowestUrls = Object.entries(stats.urlTimes)
    .filter(function (e) { return e[1].count > 0; })
    .map(function (e) {
      const url = e[0], d = e[1];
      d.times.sort(function (a, b) { return a - b; });
      const avg = d.totalTime / d.count;
      const p95 = d.times.length > 0 ? d.times[Math.floor(d.times.length * 0.95)] : 0;
      const p99 = d.times.length > 0 ? d.times[Math.floor(d.times.length * 0.99)] : 0;
      return [url, avg, p95, p99, d.count];
    })
    .sort(function (a, b) { return b[1] - a[1]; })
    .slice(0, 10);

  const bwHogs = Object.entries(stats.urlTimes)
    .sort(function (a, b) { return b[1].totalBytes - a[1].totalBytes; })
    .slice(0, 10)
    .map(function (e) { return [e[0], e[1].totalBytes, e[1].count]; });

  const referrersMap = {};
  filteredLogs.forEach(function (l) {
    if (l.referer && l.referer !== '-') referrersMap[l.referer] = (referrersMap[l.referer] || 0) + 1;
  });

  const appPaths = traffic.app.paths.slice(0, 10);
  const fillPaths = traffic.scanner.paths.slice(0, Math.max(0, 10 - appPaths.length));

  return {
    total: stats.total,
    uniqueIps: Object.keys(stats.ips).length,
    bytes: stats.bytes,
    errors: stats.errors,
    shareOfParsed: totalParsed > 0 ? Math.round((stats.total / totalParsed) * 100) + '%' : '0%',
    activeHour: activeHour,
    statuses: byCount(stats.statuses),
    hours: sortedHours,
    topUrls: topUrls,
    topOs: topOs,
    topIps: topIps,
    topReferrers: byCount(referrersMap).slice(0, 10),
    slowestUrls: slowestUrls,
    bwHogs: bwHogs,
    urlUniqueIps: nginxUniqueIpsPerUrl(filteredLogs),
    traffic: traffic,
    topBots: traffic.sources.slice(0, 10),
    appPaths: appPaths,
    fillPaths: fillPaths,
    filtered: filteredLogs
  };
}

// The error-log Analyzer view's numbers (nginxAggregateAndRenderErrorLog).
function nginxAggregateErrors(logs) {
  const levelsMap = {}, ipsMap = {}, messagesMap = {}, requestsMap = {}, hoursMap = {};
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    levelsMap[log.level] = (levelsMap[log.level] || 0) + 1;
    hoursMap[log.hourStr] = (hoursMap[log.hourStr] || 0) + 1;
    if (log.ip !== '-') ipsMap[log.ip] = (ipsMap[log.ip] || 0) + 1;
    messagesMap[log.message] = (messagesMap[log.message] || 0) + 1;
    if (log.request !== '-') requestsMap[log.request] = (requestsMap[log.request] || 0) + 1;
  }
  let maxHour = '-', maxHourCount = 0;
  for (const h in hoursMap) {
    if (hoursMap[h] > maxHourCount) { maxHourCount = hoursMap[h]; maxHour = h; }
  }
  const levels = Object.entries(levelsMap).sort(function (a, b) { return b[1] - a[1]; }).map(function (entry) {
    return { level: entry[0], count: entry[1], pct: ((entry[1] / logs.length) * 100).toFixed(1) };
  });

  const sortedHours = Object.keys(hoursMap).sort();
  let maxHCount = 0;
  sortedHours.forEach(function (h) { if (hoursMap[h] > maxHCount) maxHCount = hoursMap[h]; });
  const bars = [];
  const barCount = Math.min(sortedHours.length, 50);
  const step = Math.ceil(sortedHours.length / barCount);
  for (let i = 0; i < sortedHours.length; i += step) {
    let sum = 0;
    for (let j = 0; j < step && i + j < sortedHours.length; j++) sum += hoursMap[sortedHours[i + j]];
    const pct = maxHCount > 0 ? (sum / (maxHCount * step)) * 100 : 0;
    bars.push({ label: sortedHours[i], sum: sum, pct: pct });
  }

  const top = function (map) { return Object.entries(map).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 10); };
  return {
    total: logs.length,
    levelCount: Object.keys(levelsMap).length,
    clientCount: Object.keys(ipsMap).length,
    activeHour: maxHour,
    levels: levels,
    bars: bars,
    topIps: top(ipsMap),
    topMessages: top(messagesMap),
    topRequests: top(requestsMap)
  };
}

// Banner for text that does not look like an nginx error log — nginxUpdateErrorHint's
// decision, without the markup. Returns null when nothing needs saying; otherwise
// { kind: 'none'|'some', skipped, scanned, looksLikeAccess }.
function nginxErrorHint(matched, scanned, sample) {
  const skipped = scanned - matched;
  if (!scanned || matched >= scanned * 0.5 || skipped < 3) return null;
  const looksLikeAccess = !!(sample && (/request="|status="/.test(sample) || /"\s+\d{3}\s+(?:\d+|-)\s+"/.test(sample)));
  return { kind: matched === 0 ? 'none' : 'some', skipped: skipped, scanned: scanned, looksLikeAccess: looksLikeAccess };
}

// A line cut into coloured runs: the same spots nginxColorizeLine() wrapped in <span>s,
// returned as data so the page builds the spans itself. [{ t: 'plain'|'ts'|'method'|'path'|
// 'proto'|'ip'|'s2'|'s3'|'s4'|'lvl-bad'|'lvl-warn'|'lvl-info', v }]
function nginxColorizeTokens(type, rawLine) {
  const line = String(rawLine || '');
  const marks = [];
  function add(re, fn) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      fn(m);
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  if (type === 'access') {
    add(/\[([^\]]+)\]/g, function (m) { marks.push([m.index + 1, m.index + 1 + m[1].length, 'ts']); });
    add(/"(GET|POST|PUT|DELETE|OPTIONS|HEAD|PATCH)\s+([^"]+?)(?:\s+(HTTP\/\d\.\d))?"/g, function (m) {
      let p = m.index + 1;
      marks.push([p, p + m[1].length, 'method']);
      p = line.indexOf(m[2], p + m[1].length);
      marks.push([p, p + m[2].length, 'path']);
      if (m[3]) { const q = line.indexOf(m[3], p + m[2].length); marks.push([q, q + m[3].length, 'proto']); }
    });
    add(/^((?:\d{1,3}\.){3}\d{1,3})/g, function (m) { marks.push([0, m[1].length, 'ip']); });
    add(/\s(2\d{2})\s/g, function (m) { marks.push([m.index + 1, m.index + 4, 's2']); });
    add(/\s(3\d{2})\s/g, function (m) { marks.push([m.index + 1, m.index + 4, 's3']); });
    add(/\s([45]\d{2})\s/g, function (m) { marks.push([m.index + 1, m.index + 4, 's4']); });
  } else {
    add(/\[(error|emerg|alert|crit)\]/gi, function (m) { marks.push([m.index + 1, m.index + 1 + m[1].length, 'lvl-bad']); });
    add(/\[(warn)\]/gi, function (m) { marks.push([m.index + 1, m.index + 1 + m[1].length, 'lvl-warn']); });
    add(/\[(info|notice)\]/gi, function (m) { marks.push([m.index + 1, m.index + 1 + m[1].length, 'lvl-info']); });
  }
  // First registered wins an overlap, which is the order the original replaced in.
  const taken = [];
  marks.forEach(function (mk) {
    if (mk[0] < 0 || mk[1] <= mk[0]) return;
    for (let i = 0; i < taken.length; i++) if (mk[0] < taken[i][1] && mk[1] > taken[i][0]) return;
    taken.push(mk);
  });
  taken.sort(function (a, b) { return a[0] - b[0]; });
  const out = [];
  let cur = 0;
  taken.forEach(function (mk) {
    if (mk[0] > cur) out.push({ t: 'plain', v: line.slice(cur, mk[0]) });
    out.push({ t: mk[2], v: line.slice(mk[0], mk[1]) });
    cur = mk[1];
  });
  if (cur < line.length) out.push({ t: 'plain', v: line.slice(cur) });
  return out;
}

// Incident Report source (nginxReportSection): the access stream's records, narrowed
// to [fromMs, toMs]; error responses lead, and if there are none the busiest window
// still shows traffic for context. null when empty.
function nginxBuildReportSection(logs, fromMs, toMs) {
  if (!logs || !logs.length) return null;
  let firstMs = Infinity, lastMs = -Infinity;
  const inWin = logs.filter(function (e) {
    const ms = nginxDateToMs(e.date);
    if (fromMs != null && !isNaN(ms) && ms < fromMs) return false;
    if (toMs != null && !isNaN(ms) && ms > toMs) return false;
    if (!isNaN(ms)) { if (ms < firstMs) firstMs = ms; if (ms > lastMs) lastMs = ms; }
    return true;
  });
  if (!inWin.length) return null;
  const errs = inWin.filter(function (e) { return e.status >= 400; });
  const pick = (errs.length ? errs : inWin).slice(0, 1000);
  const rows = pick.map(function (e) {
    return [e.timeOnly || e.date, e.ip, e.method, e.status, e.time ? e.time.toFixed(3) : '', e.url];
  });
  return {
    id: 'nginx-log', title: 'Nginx — HTTP requests',
    subtitle: inWin.length + ' request' + (inWin.length === 1 ? '' : 's') + ' · ' + errs.length + ' error response' + (errs.length === 1 ? '' : 's') + (errs.length ? ' (4xx/5xx shown)' : ' (sample shown)'),
    columns: ['Time', 'IP', 'Method', 'Status', 'Resp (s)', 'URL'], rows: rows, total: inWin.length,
    firstMs: firstMs === Infinity ? null : firstMs, lastMs: lastMs === -Infinity ? null : lastMs
  };
}

  root.nginxDeriveHourStr = nginxDeriveHourStr;
  root.nginxStreamParseFile = nginxStreamParseFile;
  root.NGINX_REGEX = NGINX_REGEX;
  root.nginxParseLine = nginxParseLine;
  root.nginxMatchList = nginxMatchList;
  root.nginxClassifyTraffic = nginxClassifyTraffic;
  root.nginxUniqueIpsPerUrl = nginxUniqueIpsPerUrl;
  root.nginxGetOS = nginxGetOS;
  root.nginxFormatBytes = nginxFormatBytes;
  root.nginxParseErrorLine = nginxParseErrorLine;
  root.nginxDateToMs = nginxDateToMs;
  root.nxCorrTsToMs = nxCorrTsToMs;
  root.nxCorrBuildRuntimeEvents = nxCorrBuildRuntimeEvents;
  root.nxCorrelate = nxCorrelate;
  root.nginxFilterAccess = nginxFilterAccess;
  root.nginxFilterErrors = nginxFilterErrors;
  root.nginxAggregate = nginxAggregate;
  root.nginxAggregateErrors = nginxAggregateErrors;
  root.nginxErrorHint = nginxErrorHint;
  root.nginxColorizeTokens = nginxColorizeTokens;
  root.nginxBuildReportSection = nginxBuildReportSection;
  root.NGINX_WORKER_THRESHOLD = NGINX_WORKER_THRESHOLD;
})(typeof window !== 'undefined' ? window : self);
