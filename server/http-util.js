'use strict';

// A live-session scan report (counts + a small capped sample per entity) is
// the largest body this server ever receives, and it is bounded by the scan
// script itself. 64MB is comfortable headroom without inviting an unbounded
// upload; a genuinely larger body is refused rather than buffered.
const MAX_BODY_BYTES = 64 * 1024 * 1024;

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  // Requiring the real application/json content type closes the classic CSRF
  // technique where an HTML <form enctype="text/plain"> body happens to parse
  // as JSON and skips the browser's CORS preflight — same defense MxSonar
  // uses, on top of the Origin check in index.js.
  const contentType = req.headers['content-type'] || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw Object.assign(new Error('Expected Content-Type: application/json'), { statusCode: 415 });
  }
  const raw = await readRawBody(req);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch (e) {
    throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 });
  }
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, err) {
  const statusCode = err && err.statusCode ? err.statusCode : 500;
  const message = err && err.message ? err.message : 'Internal error';
  if (statusCode === 500) console.error(err);
  sendJson(res, statusCode, { error: message });
}

module.exports = { readRawBody, readJsonBody, sendJson, sendError, MAX_BODY_BYTES };
