/* MxScout — Log analysis module: the Worker that reads an Nginx log.
 *
 * Streams the file (gunzipping it first when it is a .gz) through the line parser in
 * engine/nginx.js, so a 100K+ line access log does not compete with the page for the whole read.
 * Logic from MxDevSwissTool (Mikołaj / RealMecowhy, MIT).
 *
 * Message in:  { file, isGz, type: 'access' | 'error' }
 * Messages out: { type: 'progress', totalBytes } · { type: 'complete', result } · { type: 'error', message }
 */
importScripts('/logs/engine/nginx.js');

self.onmessage = async function (e) {
  var parseLineFn = e.data.type === 'access' ? self.nginxParseLine : self.nginxParseErrorLine;
  try {
    var result = await self.nginxStreamParseFile(e.data.file, e.data.isGz, e.data.type, parseLineFn, function (totalBytes) {
      self.postMessage({ type: 'progress', totalBytes: totalBytes });
    });
    self.postMessage({ type: 'complete', result: result });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
