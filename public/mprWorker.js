/* MxScout — the Worker that parses a Mendix project folder.
 *
 * This is the "parsing happens in the browser, in a Web Worker" half of the
 * promise on the About page: the main thread never sees project content
 * while this runs, only the finished model (or an error) at the end. Cancel
 * is the main thread calling worker.terminate() — nothing here needs to know
 * about that, a terminated worker just stops mid-postMessage.
 *
 * Message in:  { mprBuffer: ArrayBuffer, contentsFiles: Map<relativePath, File> }
 * Messages out:
 *   { type: 'progress', phase, done, total }  — zero or more
 *   { type: 'done', model }                   — exactly one, on success
 *   { type: 'error', message }                — exactly one, on failure
 * contentsFiles is only ever read from for a v2-format project; a v1 file's
 * Contents are already inline in the Unit table scan.
 */
importScripts('/sqlite.js', '/bson.js', '/mpr.js');

self.onmessage = function (ev) {
  var mprBuffer = ev.data.mprBuffer;
  var contentsFiles = ev.data.contentsFiles;

  function readContentsFile(relativePath) {
    var file = contentsFiles.get(relativePath);
    if (!file) return Promise.resolve(null);
    return file.arrayBuffer();
  }

  function onProgress(phase, done, total) {
    self.postMessage({ type: 'progress', phase: phase, done: done, total: total });
  }

  MxMpr.buildModel({ mprBytes: mprBuffer, readContentsFile: readContentsFile, onProgress: onProgress })
    .then(function (model) { self.postMessage({ type: 'done', model: model }); })
    .catch(function (err) { self.postMessage({ type: 'error', message: (err && err.message) || String(err) }); });
};
