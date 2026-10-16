/* MxScout — Log analysis module: the Worker that parses a log.
 *
 * Same job and same protocol as the original (MxDevSwissTool, Mikołaj / RealMecowhy, MIT) — the parser
 * is self-contained, so a 100 MB+ TRACE log is read off the page's main thread and the page keeps
 * answering while it goes. It is a file rather than a Blob built at runtime because MxScout's
 * Content-Security-Policy allows scripts from its own origin and nothing else.
 *
 * Message in:  { text }
 * Messages out: { type: 'progress', progress, phase } — zero or more
 *               { type: 'complete', format, records, skipped } — exactly one
 */
importScripts('/logs/engine/parser.js');

self.onmessage = function (e) {
  var parser = self.createMendixLogParser();
  var res = parser.parse(e.data.text, function (pct, phase) {
    self.postMessage({ type: 'progress', progress: pct, phase: phase });
  });
  self.postMessage({ type: 'complete', format: res.format, records: res.records, skipped: res.skipped });
};
