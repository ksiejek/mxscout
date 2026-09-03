'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const pkg = require('../package.json');
const { sendJson, sendError } = require('./http-util');
const sessionRoutes = require('./routes/session');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const HOST = '127.0.0.1'; // never bind wider than loopback — same rule as MxSonar
const PORT = Number(process.env.MXSCOUT_PORT) || 4288;

// MxScout has no database, no filesystem browsing and no outbound network
// calls of its own — the model lives in the browser's own storage. The one
// piece of server state is the current live session (see state.js): the
// browser mints a token, the snippet pasted into the TARGET app answers
// requests cross-origin, and the browser collects the answers.
//
// The Origin gate below is why that is safe. Binding to loopback stops the
// rest of the network, but NOT another browser tab on the same machine — any
// site the user has open can still send requests here. So every route is
// same-origin only UNLESS it carries crossOrigin:true, and the only routes
// that do are the ones the bridge itself must reach — each gated by the
// session token instead (see routes/session.js). A new route must never be
// added to the crossOrigin list as a shortcut around same-origin.
const ALLOWED_ORIGINS = new Set([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
function originAllowed(req) {
  const origin = req.headers.origin;
  return !origin || ALLOWED_ORIGINS.has(origin);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  const relPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = path.normalize(relPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  // Guard against path traversal escaping PUBLIC_DIR entirely.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// The changelog ships INSIDE the application, which is the whole point: the
// copy you are running is the copy that tells you what is in it. MxScout never
// asks anyone whether a newer version exists — see the About page — so this
// file is the only thing it has to say on the subject, and it must therefore
// come from disk rather than from a constant that could go stale.
//
// One fixed path, read fresh on each request so `git pull` is reflected
// without a restart, and bounded so a mistake in the repository cannot turn
// into an unbounded response.
const CHANGELOG_PATH = path.join(__dirname, '..', 'CHANGELOG.md');
const CHANGELOG_MAX_BYTES = 256 * 1024;

const routes = [
  {
    method: 'GET', pattern: /^\/api\/health$/,
    handler: (req, res) => sendJson(res, 200, { ok: true, name: pkg.name, version: pkg.version })
  },
  {
    method: 'GET', pattern: /^\/api\/changelog$/,
    handler: (req, res) => new Promise((resolve) => {
      fs.readFile(CHANGELOG_PATH, 'utf8', (err, text) => {
        if (err) { sendJson(res, 200, { version: pkg.version, text: null }); resolve(); return; }
        sendJson(res, 200, { version: pkg.version, text: text.slice(0, CHANGELOG_MAX_BYTES) });
        resolve();
      });
    })
  },
  // The live session. Minting the token is same-origin only (the MxScout UI
  // itself).
  { method: 'POST', pattern: /^\/api\/session\/start$/, handler: sessionRoutes.handleStartSession },
  // Arming / cancelling / checking is same-origin only (the MxScout UI). Only
  // the bridge's poll and result are cross-origin — the bridge runs on the
  // TARGET app's tab — and both are token-gated.
  { method: 'POST', pattern: /^\/api\/session\/exec$/, handler: sessionRoutes.handleSetCommand },
  { method: 'DELETE', pattern: /^\/api\/session\/exec$/, handler: sessionRoutes.handleClearCommand },
  { method: 'GET', pattern: /^\/api\/session\/exec$/, handler: sessionRoutes.handleGetCommandStatus },
  { method: 'OPTIONS', pattern: /^\/api\/session\/exec\/poll$/, handler: sessionRoutes.handlePreflight, crossOrigin: true },
  { method: 'GET', pattern: /^\/api\/session\/exec\/poll$/, handler: sessionRoutes.handleCommandPoll, crossOrigin: true },
  { method: 'OPTIONS', pattern: /^\/api\/session\/exec\/result$/, handler: sessionRoutes.handlePreflight, crossOrigin: true },
  { method: 'POST', pattern: /^\/api\/session\/exec\/result$/, handler: sessionRoutes.handleReportCommandResult, crossOrigin: true },
  // The bridge's reachability probe. Cross-origin and token-gated: a failure
  // here is what tells the pasted snippet the app's CSP blocks us, so it can
  // fall back to rendering its panel inside the app page.
  { method: 'OPTIONS', pattern: /^\/api\/session\/ping$/, handler: sessionRoutes.handlePreflight, crossOrigin: true },
  { method: 'GET', pattern: /^\/api\/session\/ping$/, handler: sessionRoutes.handleBridgePing, crossOrigin: true },
  // One page of rows read out of the live app. The POST comes from the bridge
  // (cross-origin, token-gated); the GET is the MxScout UI collecting the
  // answer to the query it armed, same-origin like every other UI route.
  { method: 'OPTIONS', pattern: /^\/api\/session\/data$/, handler: sessionRoutes.handlePreflight, crossOrigin: true },
  { method: 'POST', pattern: /^\/api\/session\/data$/, handler: sessionRoutes.handleReportQueryResult, crossOrigin: true },
  { method: 'GET', pattern: /^\/api\/session\/data$/, handler: sessionRoutes.handleGetQueryResult }
];

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${HOST}`);

    res.setHeader('Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');

    const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));

    if (route && !route.crossOrigin && !originAllowed(req)) {
      console.log('✗ blocked cross-origin request from', req.headers.origin, '—', req.method, url.pathname);
      sendJson(res, 403, { error: 'Cross-origin requests are not allowed on this endpoint.' });
      return;
    }

    if (route) {
      req.query = url.searchParams;
      Promise.resolve(route.handler(req, res)).catch((err) => {
        // sendError honours err.statusCode, so a 415 (wrong Content-Type) or
        // 413 (body too large) from readJsonBody surfaces correctly instead of
        // being flattened to a 500.
        if (err && err.statusCode && err.statusCode !== 500) console.log('✗', req.method, url.pathname, '→', err.statusCode, err.message);
        else console.error('✗ handler error for', req.method, url.pathname, err);
        sendError(res, err);
      });
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    if (req.method === 'GET') {
      serveStatic(req, res, url.pathname);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('✗ FATAL — request handler crashed synchronously:', err);
    try { sendJson(res, 500, { error: 'Internal error' }); } catch (e2) { /* response already gone */ }
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`✗ Port ${PORT} is already in use — another copy of MxScout is probably still running.`);
  } else {
    console.error('✗ Server failed to start:', err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`MxScout running at http://${HOST}:${PORT}`);
});
