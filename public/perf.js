/* MxScout — performance recording, read from the Mendix Runtime Admin port.
 *
 * What the admin port gives that ordinary network traffic never could: the
 * INTERNAL action stack behind a request — nested microflow calls, the
 * activity currently running, the XPath behind a retrieve — not just "a
 * request happened and took N ms". See ROADMAP step 46 for the research that
 * ruled out every other shape (TRACE log parsing, the network layer).
 *
 * This module owns the UI side only. It does not talk to the admin port and
 * could not if it wanted to: that API needs a custom auth header, which makes
 * it a preflighted cross-origin request, and the admin port answers no CORS
 * at all. Two earlier shapes worked around that — a PowerShell script that
 * did the whole recording and wrote a JSON file, then a bridge script pasted
 * into a browser tab open ON the admin port. Karol's call, 2026-09-07: both
 * paste steps go. MxScout's own server connects to the admin port now, and
 * this page drives it through /api/session/perf/* — see server/admin-port.js
 * for what that break of an old invariant is bounded by, and public/about.js
 * for how it is declared. Starting and finishing a recording also happens on
 * the app tab's own badge (public/bridge.js), because that is where the
 * tester is standing while they record.
 *
 * PowerShell survives for exactly one job it alone can do: reading
 * M2EE_ADMIN_PASS out of the runtime process's own memory (proven in Phase 0).
 * Run it once per app run, paste what it prints once, and Start/Finish as
 * many recordings as you like after that.
 *
 * The recording also carries a second, unparsed block per sample (`stats`,
 * from the admin port's broader runtime-statistics action) alongside the
 * per-request data this file actually reads. Its real shape has not been
 * confirmed against a live Mendix runtime yet — unlike get_current_runtime_
 * requests, proven in Phase 0 — so nothing here parses or renders it. It
 * rides along in every recording so a later step has it to design a parser
 * against, the same way this project always builds a parser AFTER seeing a
 * real sample, never before.
 */
(function () {
  'use strict';

  // Bound once, in init(). Named exactly as they were in app.js.
  var el, state, store, render, setMessage, api, jumpToObject, objectsOfSection, newId, formatDate, withMod, moduleColor, downloadText, pickFile, readFileText;

  function init(deps) {
    el = deps.el;
    state = deps.state;
    store = deps.store;
    render = deps.render;
    setMessage = deps.setMessage;
    api = deps.api;
    jumpToObject = deps.jumpToObject;
    objectsOfSection = deps.objectsOfSection;
    newId = deps.newId;
    formatDate = deps.formatDate;
    withMod = deps.withMod;
    moduleColor = deps.moduleColor;
    downloadText = deps.downloadText;
    pickFile = deps.pickFile;
    readFileText = deps.readFileText;

    // The Timeline is this file's view layer, not a peer of it: it draws what
    // this file reads and computes, and app.js has no business knowing that
    // `poolSeries` exists. So the wiring runs from here rather than from
    // app.js — one more explicit init() handing over exactly what the far side
    // needs, which is the same rule, applied one level down. Everything below
    // is a function this file owns; nothing reaches the other way.
    window.MxTimeline.init({
      el: el, withMod: withMod, jumpToObject: jumpToObject,
      buildRequestRows: buildRequestRows, buildSpans: buildSpans,
      observedIntervalMs: observedIntervalMs, totalDurationMs: totalDurationMs,
      concurrencySeries: concurrencySeries, poolSeries: poolSeries, gcMarks: gcMarks,
      connectionbusSeries: connectionbusSeries, sparklineSvg: sparklineSvg,
      formatMs: formatMs, formatBytes: formatBytes, typeClass: typeClass,
      moduleOf: moduleOf, xpathEntityQualifiedName: xpathEntityQualifiedName,
      resolveFrame: resolveFrame, findingButton: findingButton, CB_OPS: CB_OPS
    });
  }

  // Hands the whole recording back as the JSON it already is. This exists for
  // one reason above the obvious: when the analyzer shows something that looks
  // wrong against a REAL Mendix runtime, the recording is the only evidence,
  // and no parser in this project gets written or fixed against a guess —
  // see the note about `stats` in this file's header, and ROADMAP step 46.
  function exportRecording(r) {
    var when = String(r.started || '').replace(/[:.]/g, '-').slice(0, 19) || 'recording';
    downloadText(JSON.stringify(r, null, 2), 'mxscout-perf-' + when + '.json', 'application/json');
  }

  // The other direction: a recording exported from any MxScout, read back into
  // this project. Karol asked for it 2026-09-09 with two exports in hand, and
  // the reason it matters is not convenience — it is that a recording is the
  // evidence. A tester records on the machine that has the running app and the
  // admin port; whoever looks at it may have neither, and until now had a JSON
  // file and no way to open it. Import needs no admin port, no bridge and no
  // server round trip: it is a file read in this tab and a row written to this
  // browser's IndexedDB, exactly like every other thing MxScout stores.
  //
  // Deliberately tolerant about `version` and silent about `id`/`projectId`:
  // both are rewritten on the way in, so importing the same file twice gives
  // two rows rather than overwriting one, and a recording from another
  // project lands in the one that is open.
  function importRecording(project) {
    if (!project) return;
    pickFile(function (file) {
      readFileText(file, function (fileName, text) {
        var parsed;
        try { parsed = JSON.parse(text); }
        catch (e) { setMessage('That file is not JSON — pick a recording exported with the Export button.', 'error'); render(); return; }
        if (!parsed || parsed.tool !== 'mxscout-perf-recording' || !Array.isArray(parsed.samples)) {
          setMessage('That is not an MxScout performance recording.', 'error');
          render();
          return;
        }
        var recording = {
          id: newId(),
          projectId: project.id,
          tool: 'mxscout-perf-recording',
          version: typeof parsed.version === 'number' ? parsed.version : FORMAT_VERSION,
          intervalMs: parsed.intervalMs || DEFAULT_INTERVAL_MS,
          adminUrl: parsed.adminUrl || null,
          started: parsed.started || new Date().toISOString(),
          stopped: parsed.stopped || null,
          importedFrom: fileName || null,
          samples: parsed.samples
        };
        saveRecording(recording)
          .then(function () { return loadRecordings(project.id); })
          .then(function (rows) {
            if (!state.detail || !state.detail.perf) return;
            state.detail.perf.recordings = rows;
            state.detail.perf.selectedId = recording.id;
            state.detail.perf.tab = 'overview';
            collapsedTreeKeys = null;
            window.MxTimeline.reset();
            setMessage('Imported ' + recording.samples.length + ' sample' + (recording.samples.length === 1 ? '' : 's') + ' from ' + (fileName || 'the file') + '.', 'ok');
            render();
          })
          .catch(function (err) { setMessage((err && err.message) || 'Could not save that recording.', 'error'); render(); });
      });
    }, '.json,application/json');
  }

  var FORMAT_VERSION = 1;
  var DEFAULT_ADMIN_PORT = 8090;
  // What the recorder ASKED for, kept on the recording so the analyzer can
  // say how far the achieved cadence fell short of it (renderVerdict). The
  // number itself belongs to the server — this is the fallback for a
  // recording that arrived without one, and it has to match
  // routes/session.js's DEFAULT_INTERVAL_MS.
  var DEFAULT_INTERVAL_MS = 20;
  var STATUS_POLL_MS = 1000;

  // ---------- storage: one row per recording, many per project ----------
  // Same shape as findings/exports: keyPath 'id', an index to list a
  // project's rows and one to sort them by when they were captured.
  function loadRecordings(projectId) {
    return store.byIndex('recordings', 'byProject', projectId).then(function (rows) {
      return rows.sort(function (a, b) { return String(b.started).localeCompare(String(a.started)); });
    });
  }
  function saveRecording(recording) { return store.put('recordings', recording); }
  function deleteRecording(id) { return store.delete('recordings', id); }

  // ---------- the password-reveal script ----------
  // Real, readable PowerShell — not assembled from fragments. This is now the
  // script's ONLY job: find the runtime process, read M2EE_ADMIN_PASS out of
  // its own environment (the PEB -> ProcessParameters -> Environment technique
  // proven against a real Mendix runtime in ROADMAP step 46's Phase 0), print
  // it, exit. It never polls the admin port and never writes a file — the
  // password is typed into MxScout once, by hand, and from there lives only in
  // the server's memory for this session (see server/state.js), used only to
  // build the auth header for the two read-only admin calls.
  var PASSWORD_SCRIPT_TEMPLATE = [
    '# MxScout admin-password reveal — generated by MxScout, run by you.',
    '#',
    '# What this does: finds the Mendix Runtime process listening on the admin',
    '# port, reads its own M2EE_ADMIN_PASS out of its process environment (the',
    '# value Studio Pro generates fresh per run), prints it, and exits. It never',
    '# polls the admin port and never writes anything to disk — paste the',
    '# printed password into MxScout, which keeps it in memory for this session',
    '# and uses it only to read performance data from this same machine.',
    '#',
    '# Windows only. Run it on the machine hosting the Mendix app, as the same',
    '# user running that app (or an administrator) — reading another process\'s',
    '# environment needs PROCESS_VM_READ on it, which only that account (or an',
    '# admin) has by default.',
    '',
    'param(',
    '  [int]$Port = {{ADMIN_PORT}}',
    ')',
    '',
    '$ErrorActionPreference = \'Stop\'',
    '',
    '# ---------- find the runtime process on this port ----------',
    '$conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1',
    'if (-not $conn) {',
    '  Write-Host "Nothing is listening on port $Port. Is the Mendix app running, with its admin port at $Port?" -ForegroundColor Red',
    '  exit 1',
    '}',
    '$mxPid = $conn.OwningProcess',
    'Write-Host "Found the Mendix runtime: PID $mxPid on port $Port."',
    '',
    '# ---------- read M2EE_ADMIN_PASS out of that process\'s own environment ----------',
    'Add-Type -Language CSharp -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    '',
    'public static class MxAdminPass {',
    '    [DllImport("ntdll.dll")]',
    '    public static extern int NtQueryInformationProcess(IntPtr hProcess, int pic, byte[] pi, int piLen, out int ret);',
    '',
    '    [DllImport("kernel32.dll", SetLastError = true)]',
    '    public static extern IntPtr OpenProcess(int access, bool inherit, int pid);',
    '',
    '    [DllImport("kernel32.dll", SetLastError = true)]',
    '    public static extern bool ReadProcessMemory(IntPtr hProcess, IntPtr addr, byte[] buffer, int size, out int read);',
    '',
    '    [DllImport("kernel32.dll")]',
    '    public static extern bool CloseHandle(IntPtr h);',
    '',
    '    const int PROCESS_QUERY_INFORMATION = 0x0400;',
    '    const int PROCESS_VM_READ = 0x0010;',
    '',
    '    public static string Read(int pid) {',
    '        IntPtr h = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid);',
    '        if (h == IntPtr.Zero) throw new Exception("Could not open the runtime process (PID " + pid + ") — run this as the same user, or as an administrator.");',
    '        try {',
    '            // PROCESS_BASIC_INFORMATION: PebBaseAddress sits at offset 8 on x64.',
    '            byte[] pbi = new byte[48];',
    '            int ret;',
    '            int status = NtQueryInformationProcess(h, 0, pbi, pbi.Length, out ret);',
    '            if (status != 0) throw new Exception("NtQueryInformationProcess failed (0x" + status.ToString("X") + ").");',
    '            long pebAddr = BitConverter.ToInt64(pbi, 8);',
    '',
    '            // PEB.ProcessParameters sits at offset 0x20 on x64.',
    '            byte[] pebBuf = new byte[8];',
    '            int read;',
    '            if (!ReadProcessMemory(h, (IntPtr)(pebAddr + 0x20), pebBuf, 8, out read)) throw new Exception("Could not read the PEB — its layout may differ on this Windows build.");',
    '            long paramsAddr = BitConverter.ToInt64(pebBuf, 0);',
    '',
    '            // RTL_USER_PROCESS_PARAMETERS.Environment sits at offset 0x80 on x64.',
    '            byte[] envPtrBuf = new byte[8];',
    '            if (!ReadProcessMemory(h, (IntPtr)(paramsAddr + 0x80), envPtrBuf, 8, out read)) throw new Exception("Could not read ProcessParameters.");',
    '            long envAddr = BitConverter.ToInt64(envPtrBuf, 0);',
    '',
    '            // The environment block is a double-NUL-terminated run of NUL-',
    '            // separated "NAME=value" UTF-16LE strings. A generous fixed-size',
    '            // read stands in for computing its exact length — reading past',
    '            // the block\'s real end, inside the target\'s own committed pages,',
    '            // just returns bytes ReadProcessMemory truncates, not an error.',
    '            int chunk = 65536;',
    '            byte[] envBuf = new byte[chunk];',
    '            ReadProcessMemory(h, (IntPtr)envAddr, envBuf, chunk, out read);',
    '            string block = System.Text.Encoding.Unicode.GetString(envBuf, 0, read);',
    '            foreach (string entry in block.Split(\'\\0\')) {',
    '                if (entry.StartsWith("M2EE_ADMIN_PASS=")) return entry.Substring("M2EE_ADMIN_PASS=".Length);',
    '            }',
    '            throw new Exception("M2EE_ADMIN_PASS was not in that process\'s environment — is this really the Mendix runtime, started by Studio Pro?");',
    '        } finally {',
    '            CloseHandle(h);',
    '        }',
    '    }',
    '}',
    '"@',
    '',
    'try {',
    '  $AdminPass = [MxAdminPass]::Read($mxPid)',
    '} catch {',
    '  Write-Host "Could not read the admin password: $($_.Exception.Message)" -ForegroundColor Red',
    '  exit 1',
    '}',
    '',
    'Write-Host ""',
    'Write-Host "Admin password — paste this into MxScout:"',
    'Write-Host $AdminPass',
    'Write-Host ""'
  ].join('\n');

  function buildPasswordScript(cfg) {
    cfg = cfg || {};
    var port = cfg.adminPort || DEFAULT_ADMIN_PORT;
    return PASSWORD_SCRIPT_TEMPLATE.replace(/\{\{ADMIN_PORT\}\}/g, String(port));
  }

  // ---------- status polling (is the admin port connected, is it recording) ----------
  var _statusPoll = null;
  function stopStatusPolling() { if (_statusPoll) { clearInterval(_statusPoll); _statusPoll = null; } }
  function startStatusPolling() { stopStatusPolling(); _statusPoll = setInterval(fetchStatus, STATUS_POLL_MS); fetchStatus(); }
  function fetchStatus() {
    if (!state.detail || !state.detail.perf) { stopStatusPolling(); return; }
    fetch('/api/session/perf/status')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (s) {
        if (!state.detail || !state.detail.perf || !s) return;
        var p = state.detail.perf;
        // A stop already being turned into a recording makes every answer
        // still in flight stale — one of them can easily still say `active:
        // true`, having been asked for before the stop happened, and letting
        // that land would put the `true` back and make the NEXT answer read as
        // a second stop of the same recording. The finish calls fetchStatus()
        // itself when it is done, so nothing is lost by dropping these.
        if (p._finishing) return;
        var wasConnected = !!p.status.connected;
        var wasActive = !!p.status.active;
        var wasKnown = !!p.statusKnown;
        p.status = s;
        p.statusKnown = true;
        // The record button on the app tab's badge can stop a recording
        // without either button here being clicked — and only THIS page can
        // turn the samples into a saved recording, since they land in its
        // IndexedDB. So notice the drop and finish it exactly as if Finish had
        // been pressed. The _finishing guard is what stops this from firing a
        // second time while that call is in flight.
        if (wasActive && !s.active && !p._finishing) {
          finishRecordingSession(_currentProject);
          return;
        }
        // Connecting or dropping changes what the whole card should show — the
        // setup steps have to become the ready strip by themselves, same
        // reasoning as live.js's exec status. The first answer counts as a
        // change too: until it lands, this page does not yet know whether the
        // server is already connected from before a reload.
        if (!wasKnown || !!s.connected !== wasConnected) { render(); return; }
        updateStatusInPlace();
      })
      .catch(function () {});
  }
  function updateStatusInPlace() {
    var host = document.getElementById('perf-status-area');
    if (!host || !state.detail || !_currentProject) return;
    while (host.firstChild) host.removeChild(host.firstChild);
    var node = renderStatusArea(_currentProject);
    if (node) host.appendChild(node);
  }

  // ---------- Start / Finish ----------
  // The start time comes back from the SERVER's own status/stop responses
  // (state.js stamps it the moment the recording actually begins), not from a
  // timestamp taken here — the server runs the sampling loop, so its clock is
  // the one that matches the samples.
  function startRecordingSession() {
    api('/api/session/perf/start', { method: 'POST' }).then(function () {
      if (!_statusPoll) startStatusPolling();
      fetchStatus();
    }).catch(function (err) { setMessage((err && err.message) || 'Could not start recording.', 'error'); render(); });
  }

  function finishRecordingSession(project) {
    if (!project) return;
    var p = state.detail.perf;
    p._finishing = true;
    api('/api/session/perf/stop', { method: 'POST' }).then(function (resp) {
      // This stop already happened, server-side, by the time this runs — mark
      // it here too, or fetchStatus()'s own trailing call below reads the
      // stale cached `active: true` from before, sees a false "external"
      // true-to-false transition, and finishes THIS SAME stop a second time
      // (an extra, empty recording right after the real one).
      if (state.detail && state.detail.perf) state.detail.perf.status.active = false;
      var samples = resp.samples || [];
      var recording = {
        id: newId(),
        projectId: project.id,
        tool: 'mxscout-perf-recording',
        version: FORMAT_VERSION,
        intervalMs: DEFAULT_INTERVAL_MS,
        adminUrl: adminLabel(p) || null,
        started: (p.status && p.status.startedAt) || new Date().toISOString(),
        stopped: new Date().toISOString(),
        samples: samples
      };
      return saveRecording(recording).then(function () { return loadRecordings(project.id); })
        .then(function (rows) {
          p._finishing = false;
          if (!state.detail || !state.detail.perf) return;
          state.detail.perf.recordings = rows;
          state.detail.perf.selectedId = recording.id;
          state.detail.perf.tab = 'overview';
          window.MxTimeline.reset();
          setMessage('Recording saved — ' + samples.length + ' sample' + (samples.length === 1 ? '' : 's') + '.', 'ok');
          render();
          fetchStatus();
        });
    }).catch(function (err) {
      p._finishing = false;
      setMessage((err && err.message) || 'Could not stop recording.', 'error');
      render();
    });
  }

  // ---------- aggregation ----------
  // One row per request id seen across the whole recording — the id is the
  // admin port's own concurrency key, so this needs no work beyond grouping
  // by it. Frame shapes are read defensively throughout: the one real sample
  // seen so far (ROADMAP step 46, Phase 0) is not treated as a frozen schema.
  // Field names confirmed against a real Mendix runtime (2026-09-08, ROADMAP
  // step 46's open question): a Microflow/Nanoflow frame's qualified name is
  // `name`, and `current_activity` is an object with a human `caption` — not
  // the string this guessed at before any real sample was seen.
  function frameLabel(frame) {
    if (!frame || typeof frame !== 'object') return null;
    var activity = frame.current_activity;
    if (activity && typeof activity === 'object' && typeof activity.caption === 'string' && activity.caption) return activity.caption;
    if (typeof activity === 'string' && activity) return activity;
    var qn = frameQualifiedName(frame);
    if (qn) return qn;
    if (typeof frame.xpath === 'string' && frame.xpath) return frame.xpath;
    if (typeof frame.entityName === 'string' && frame.entityName) return frame.entityName;
    if (typeof frame.name === 'string' && frame.name) return frame.name;
    if (typeof frame.type === 'string' && frame.type) return frame.type;
    return null;
  }

  function frameQualifiedName(frame) {
    if (frame.type !== 'Microflow' && frame.type !== 'Nanoflow') return null;
    var v = frame.name;
    return (typeof v === 'string' && v) ? v : null;
  }

  // What a span shows on the flame chart. A qualified name over a caption,
  // where both exist — a flow's OWN current_activity is useful in the detail
  // panel below, but as the bar's label it would read as a sentence next to
  // every other bar's dotted Module.Flow name, and it does not group or
  // colour by module the way a qualified name does (see entryLabel above,
  // same reasoning). Everything that is not a flow has no qualified name to
  // prefer, so this is just frameLabel() for those.
  function spanLabel(frame) {
    var qn = frameQualifiedName(frame);
    return qn || frameLabel(frame);
  }

  // 'flow' draws with module colour and links to the model; 'xpath' draws
  // monospaced and links to the entity behind the query; everything else
  // ('activity') is a step the runtime reported that MxScout has no model
  // object for — CreateAction, JavaAction, RetrieveIdAction, CommitAction,
  // EventExtendedAction, and an outright empty frame, all seen in real
  // samples (ROADMAP step 46).
  function frameKind(frame) {
    if (frameQualifiedName(frame)) return 'flow';
    if (frame && typeof frame.xpath === 'string' && frame.xpath) return 'xpath';
    return 'activity';
  }

  // A stable key for "is this the same call, continued into the next
  // sample" — deliberately NOT frameLabel(): a flow's own current_activity
  // caption moves as its execution advances without that meaning a
  // different call, so a flow's identity is its qualified name alone. Every
  // other kind is keyed by whatever field actually distinguishes one
  // instance of that action from another, falling back to the action's
  // `type` alone, then to the frame's own JSON so two frames that carry
  // nothing recognisable still end up distinguishable rather than fused.
  function frameIdentity(frame) {
    if (!frame || typeof frame !== 'object') return 'frame:empty';
    var qn = frameQualifiedName(frame);
    if (qn) return 'flow:' + qn;
    if (typeof frame.xpath === 'string' && frame.xpath) return 'xpath:' + frame.xpath;
    if (typeof frame.entityName === 'string' && frame.entityName) return 'create:' + frame.entityName;
    if (typeof frame.name === 'string' && frame.name) return (frame.type || 'action') + ':' + frame.name;
    if (typeof frame.id === 'string' && frame.id) return (frame.type || 'action') + ':' + frame.id;
    if (Array.isArray(frame.ids)) return (frame.type || 'action') + ':' + frame.ids.join(',');
    if (typeof frame.type === 'string' && frame.type) return frame.type;
    return 'frame:' + JSON.stringify(frame);
  }

  // Reconstructs one request's call tree from the action_stack carried in
  // every sample it appears in — the whole point of Phase 2b (ROADMAP step
  // 46). Confirmed 2026-09-08 against a real nested sample:
  // `action_stack[0]` is the frame CURRENTLY EXECUTING, and the array runs
  // inward-to-outward from there, so depth 0 (the root, drawn at the bottom
  // of the flame) is the LAST index, not the first.
  //
  // A span is one frame identity staying at the same depth across ADJACENT
  // samples: `[t0, tLast + interval)`. A different identity showing up at a
  // depth closes whatever was open there and opens a new span; a depth that
  // stops appearing at all (the call returned) closes it the same way. Self
  // time counts the samples where a span was the DEEPEST frame present —
  // exactly what a sampling profiler can honestly claim, no different a
  // definition than any other one.
  // How far apart the samples ACTUALLY landed, as the median gap between
  // adjacent ones — not the interval the recorder asked for.
  //
  // Measured on two real 2026-09-09 recordings off a live runtime: the loop
  // asks for 50 ms and lands 62–63 ms apart, because each round is two HTTP
  // round trips to the admin port (get_current_runtime_requests and
  // runtime_statistics) and those cost what they cost. Every duration this
  // file computes is samples × interval, so using the requested 50 understated
  // every self and total by about 20 %, and sampleCoverage() reported "80 %"
  // as if a fifth of the samples had been lost when in fact none had — the
  // sampler was simply going as fast as it can.
  //
  // The median, not the mean: one stalled round (a GC pause, a slow query on
  // the admin thread) should not stretch every duration in the recording.
  function observedIntervalMs(recording) {
    var samples = recording.samples || [];
    if (samples.length < 3) return recording.intervalMs || DEFAULT_INTERVAL_MS;
    var gaps = [];
    for (var i = 1; i < samples.length; i++) {
      var g = samples[i].t - samples[i - 1].t;
      if (g > 0) gaps.push(g);
    }
    if (!gaps.length) return recording.intervalMs || DEFAULT_INTERVAL_MS;
    gaps.sort(function (a, b) { return a - b; });
    return gaps[Math.floor(gaps.length / 2)];
  }

  function buildSpans(recording, requestId) {
    var interval = observedIntervalMs(recording);
    var open = [];
    var closed = [];

    function finishSpan(o) {
      var frame = o.frame;
      closed.push({
        depth: o.depth,
        kind: frameKind(frame),
        name: spanLabel(frame) || 'activity',
        qualifiedName: frameQualifiedName(frame),
        xpath: typeof frame.xpath === 'string' ? frame.xpath : null,
        amount: typeof frame.amount === 'number' ? frame.amount : null,
        returnsCount: frame.returnsCount === true,
        // The runtime says which pass of a loop it is on. Real recordings are
        // full of these — one reported iteration 4312 of 6889 — and it is the
        // difference between "this microflow is slow" and "this microflow ran
        // six thousand times".
        iteration: typeof frame.iteration === 'number' ? frame.iteration : null,
        iterations: typeof frame.iterations === 'number' ? frame.iterations : null,
        activity: (frame.current_activity && typeof frame.current_activity === 'object' && typeof frame.current_activity.caption === 'string')
          ? frame.current_activity.caption : null,
        frame: frame,
        t0: o.t0,
        t1: o.tLast + interval,
        self: o.selfSamples * interval,
        // The chain of identities from the root down to this span, and that
        // joined into one string — buildCallTree()'s merge key, and how a
        // span finds its parent row there. Not used by the flame chart.
        path: o.path,
        pathKey: o.path.join(' → ')
      });
    }

    (recording.samples || []).forEach(function (sample) {
      var t = typeof sample.t === 'number' ? sample.t : 0;
      var req = requestsOf(sample)[requestId];
      var stack = (req && Array.isArray(req.action_stack)) ? req.action_stack : [];
      var maxDepth = stack.length - 1;

      // The call unwound past this depth since the last sample — close
      // whatever was open there before possibly reopening shallower depths.
      for (var d = open.length - 1; d > maxDepth; d--) {
        if (open[d]) { finishSpan(open[d]); open[d] = null; }
      }
      if (open.length > maxDepth + 1) open.length = maxDepth + 1;

      for (var depth = 0; depth <= maxDepth; depth++) {
        var frame = stack[maxDepth - depth];
        var id = frameIdentity(frame);
        var o = open[depth];
        if (!o || o.identity !== id) {
          if (o) finishSpan(o);
          // The invariant that makes this safe: `open` is always contiguous
          // from 0 up to the current maxDepth (the loop above never leaves a
          // gap), so open[depth - 1] is guaranteed to exist whenever depth >
          // 0 — the parent is always already open before a child can be.
          var parentPath = depth > 0 ? open[depth - 1].path : [];
          o = open[depth] = { identity: id, frame: frame, depth: depth, t0: t, tLast: t, selfSamples: 0, path: parentPath.concat(id) };
        } else {
          o.tLast = t;
          o.frame = frame; // the freshest copy — a flow's current_activity may have moved on
        }
        if (depth === maxDepth) o.selfSamples++;
      }
    });
    open.forEach(function (o) { if (o) finishSpan(o); });

    closed.sort(function (a, b) { return a.t0 - b.t0 || a.depth - b.depth; });
    return closed;
  }

  // One call tree for the WHOLE recording, not one request: every request's
  // spans (buildSpans, above) are folded in by `pathKey` — the same call at
  // the same position under the same parent, however many requests or loop
  // iterations produced it, becomes one row with a `calls` count. A path can
  // only be seen after its parent's, within one request's own spans (sorted
  // parent-first — see buildSpans), and a parent from an EARLIER request is
  // already in `byPath` by the time a later request's matching path shows
  // up, so a child is never processed before the row it attaches to exists.
  function buildCallTree(recording) {
    var byPath = {};
    var roots = [];
    var all = [];

    buildRequestRows(recording).forEach(function (row) {
      buildSpans(recording, row.id).forEach(function (s) {
        var node = byPath[s.pathKey];
        if (!node) {
          node = byPath[s.pathKey] = {
            key: s.pathKey, depth: s.depth, kind: s.kind, name: s.name,
            qualifiedName: s.qualifiedName, xpath: s.xpath, frame: s.frame,
            calls: 0, self: 0, total: 0, children: []
          };
          all.push(node);
          if (s.path.length > 1) byPath[s.path.slice(0, -1).join(' → ')].children.push(node);
          else roots.push(node);
        }
        node.calls++;
        node.self += s.self;
        node.total += (s.t1 - s.t0);
      });
    });
    function byTotalDesc(a, b) { return b.total - a.total; }
    all.forEach(function (n) { n.children.sort(byTotalDesc); });
    roots.sort(byTotalDesc);
    return { roots: roots, all: all };
  }

  // The request's entry point, for grouping ("Where the time went", module
  // colour, the dashboard card's "Heaviest") — the OUTERMOST frame's own
  // name, not the innermost. Confirmed 2026-09-08 against a real nested
  // sample (ROADMAP step 46's open question): action_stack[0] is the frame
  // CURRENTLY EXECUTING, and the array runs inward-to-outward from there, so
  // scanning from the front (the old code did) picks up whatever granular
  // retrieve or commit happened to be running at the last sample — which is
  // why raw XPath queries and bare request ids, not microflow names, were
  // showing up as the heaviest entries. The entry point sits at the other
  // end. A qualified flow name is preferred over a frame's own free-text
  // label here specifically because this value feeds moduleOf() grouping and
  // colour, which need a "Module.Flow"-shaped string, not a sentence.
  function entryLabel(stack) {
    for (var i = stack.length - 1; i >= 0; i--) {
      var qn = frameQualifiedName(stack[i]);
      if (qn) return qn;
    }
    for (var j = stack.length - 1; j >= 0; j--) {
      var label = frameLabel(stack[j]);
      if (label) return label;
    }
    return null;
  }

  // The requests in one sample. Recordings made before 2026-09-07 stored the
  // m2ee admin API's ENVELOPE — { feedback: <the answer>, result: 0 } — rather
  // than the answer, because nothing had checked the shape against a real
  // runtime. The server unwraps it now (see server/admin-port.js), but a
  // recording already saved cannot be re-recorded, so it is unwrapped here on
  // the way out too: those recordings are a tester's real afternoon, and
  // silently drawing them as two nonsense bars called "feedback" and "result"
  // is worse than either fixing them or refusing them.
  function requestsOf(sample) {
    var reqs = sample && sample.requests;
    if (!reqs || typeof reqs !== 'object') return {};
    if ('feedback' in reqs || 'result' in reqs) {
      if ('result' in reqs && reqs.result !== 0) return {};
      return (reqs.feedback && typeof reqs.feedback === 'object') ? reqs.feedback : {};
    }
    return reqs;
  }

  // The `stats` block (`runtime_statistics`) rides along in every sample but
  // went unread until Phase 2d — its real shape (sessions, memory,
  // connectionbus, entities, per-handler requests) was confirmed against a
  // real runtime before this was written (ROADMAP step 46), the same
  // discipline as everything else here. Same envelope tolerance as
  // requestsOf(), for the same reason: a recording saved before the server
  // started unwrapping at the source still has the raw `{feedback, result}`.
  function statsOf(sample) {
    var s = sample && sample.stats;
    if (!s || typeof s !== 'object') return null;
    if ('feedback' in s || 'result' in s) {
      if ('result' in s && s.result !== 0) return null;
      return (s.feedback && typeof s.feedback === 'object') ? s.feedback : null;
    }
    return s;
  }

  // One point per sample that actually carried a heap reading — a sample
  // where the admin port did not answer that round (see admin-port.js's
  // failStreak) has none, and is skipped rather than drawn as zero.
  function memorySeries(recording) {
    var out = [];
    (recording.samples || []).forEach(function (sample) {
      var s = statsOf(sample);
      var mem = s && s.memory;
      if (mem && typeof mem.used_heap === 'number') {
        out.push({ t: sample.t, used: mem.used_heap, max: typeof mem.max_heap === 'number' ? mem.max_heap : null });
      }
    });
    return out;
  }

  // connectionbus counters are CUMULATIVE for the life of the runtime, not
  // per-sample — so "how much database activity happened around this
  // moment" is the delta from the previous stats-bearing sample, the same
  // way a network monitor turns a byte counter into a throughput graph. The
  // first point has nothing before it to subtract, so it is skipped, not
  // shown as a spike.
  // The five counters, and the weights they are drawn with. One hue, five
  // strengths — a breakdown of one quantity, not five identities, so it stays
  // inside the accent family instead of opening a sixth colour language on a
  // screen that already carries a module hue on every bar. Karol's call,
  // 2026-09-09. Delete is the exception: it is the one that should catch the
  // eye, so it borrows the alarm hue rather than a weight of the accent.
  var CB_OPS = ['select', 'insert', 'update', 'delete', 'transaction'];

  function connectionbusSeries(recording) {
    var out = [];
    var prev = null;
    (recording.samples || []).forEach(function (sample) {
      var s = statsOf(sample);
      var cb = s && s.connectionbus;
      if (!cb) return;
      if (prev) {
        // Per operation as well as summed. "4007 database operations" says
        // nothing; "3900 of them selects, across 7 requests" is the N+1
        // verdict, and it cannot be read off a total.
        var point = { t: sample.t, total: 0 };
        CB_OPS.forEach(function (key) {
          var d = (typeof cb[key] === 'number' && typeof prev[key] === 'number') ? (cb[key] - prev[key]) : 0;
          d = Math.max(0, d); // a restarted runtime would show as a drop, not a negative spike
          point[key] = d;
          point.total += d;
        });
        out.push(point);
      }
      prev = cb;
    });
    return out;
  }

  // Heap split by pool, which is the difference between "memory went up" and
  // "memory went up and stayed up". `memorypools` carries NON-heap pools too —
  // Metaspace and three CodeHeaps, 160 MB of them in a real 2026-09-09
  // sample — so `is_heap` has to be honoured or the heap line is drawn from a
  // number that is not the heap. Eden's sawtooth is the allocation rate; Old
  // Gen creeping up across collections is the only leak signal this admin API
  // gives at all.
  //
  // `committed_heap` (400 MB in that sample) is the ceiling worth drawing.
  // `max_heap` was 16 GB, which is why a chart scaled to it drew a flat line
  // along the bottom and said nothing.
  function poolSeries(recording) {
    var out = [];
    (recording.samples || []).forEach(function (sample) {
      var s = statsOf(sample);
      var mem = s && s.memory;
      if (!mem || typeof mem.used_heap !== 'number') return;
      var pools = Array.isArray(mem.memorypools) ? mem.memorypools : [];
      var by = { eden: 0, old: 0, survivor: 0 };
      pools.forEach(function (p) {
        if (!p || p.is_heap !== true || typeof p.usage !== 'number') return;
        var name = String(p.name || '').toLowerCase();
        if (name.indexOf('eden') !== -1) by.eden += p.usage;
        else if (name.indexOf('survivor') !== -1) by.survivor += p.usage;
        else by.old += p.usage;
      });
      out.push({
        t: sample.t, used: mem.used_heap,
        committed: typeof mem.committed_heap === 'number' ? mem.committed_heap : null,
        max: typeof mem.max_heap === 'number' ? mem.max_heap : null,
        eden: by.eden, old: by.old, survivor: by.survivor,
        hasPools: pools.length > 0
      });
    });
    return out;
  }

  // Where used heap DROPPED between two samples. The admin API reports no
  // garbage-collection events, so this is an inference and is labelled as one
  // everywhere it is shown — a drop is the only evidence of a collection this
  // data can carry.
  function gcMarks(recording) {
    var series = memorySeries(recording);
    var out = [];
    for (var i = 1; i < series.length; i++) {
      if (series[i].used < series[i - 1].used * 0.92) out.push(series[i].t);
    }
    return out;
  }

  // The runtime's session counts as of the LAST sample that reported
  // them — the current picture, not a history; nothing here changes fast
  // enough within one recording to need a series.
  function sessionsNow(recording) {
    var samples = recording.samples || [];
    for (var i = samples.length - 1; i >= 0; i--) {
      var s = statsOf(samples[i]);
      if (s && s.sessions && typeof s.sessions === 'object') return s.sessions;
    }
    return null;
  }

  function buildRequestRows(recording) {
    var byId = {};
    var order = [];
    (recording.samples || []).forEach(function (sample) {
      var t = typeof sample.t === 'number' ? sample.t : 0;
      var reqs = requestsOf(sample);
      Object.keys(reqs).forEach(function (id) {
        var req = reqs[id] || {};
        var row = byId[id];
        if (!row) {
          row = byId[id] = { id: id, firstT: t, lastT: t, maxDuration: 0, type: null, user: null, entry: null, lastStack: [] };
          order.push(id);
        }
        row.lastT = t;
        if (typeof req.request_duration === 'number' && req.request_duration > row.maxDuration) row.maxDuration = req.request_duration;
        if (typeof req.type === 'string' && req.type) row.type = req.type;
        if (typeof req.user === 'string' && req.user) row.user = req.user;
        var stack = Array.isArray(req.action_stack) ? req.action_stack : [];
        if (stack.length) row.lastStack = stack;
        var label = entryLabel(stack);
        if (label) row.entry = label;
      });
    });
    return order.map(function (id) { return byId[id]; });
  }

  function totalDurationMs(recording) {
    var samples = recording.samples || [];
    if (!samples.length) return 0;
    var last = samples[samples.length - 1];
    return typeof last.t === 'number' ? last.t : 0;
  }

  // The module a qualified name belongs to ("Sales" for "Sales.CancelOrder"),
  // or null for a name with no dot (a raw request id standing in for one).
  function moduleOf(qualifiedName) {
    if (typeof qualifiedName !== 'string') return null;
    var i = qualifiedName.indexOf('.');
    return i > 0 ? qualifiedName.slice(0, i) : null;
  }

  // How many requests were in flight at each sample — the admin port already
  // hands over exactly this per sample (`requests`), so this is a count, not
  // new parsing. Doubles as the dashboard sparkline's data and the Overview
  // tab's peak-parallelism tile.
  function concurrencySeries(recording) {
    return (recording.samples || []).map(function (s) { return Object.keys(requestsOf(s)).length; });
  }

  function peakParallel(recording) {
    var best = 0, atMs = 0;
    (recording.samples || []).forEach(function (s) {
      var n = Object.keys(requestsOf(s)).length;
      if (n > best) { best = n; atMs = typeof s.t === 'number' ? s.t : atMs; }
    });
    return { count: best, atMs: atMs };
  }

  // Fraction of samples where the runtime had anything at all in flight.
  function busyFraction(recording) {
    var samples = recording.samples || [];
    if (!samples.length) return 0;
    var busy = samples.filter(function (s) { return Object.keys(requestsOf(s)).length > 0; }).length;
    return busy / samples.length;
  }

  // Real samples vs. how many the interval implies over the recording's
  // length — after the Phase 1c "always 0 samples" bug, this is shown on
  // every recording rather than assumed.
  // Against the cadence the sampler ACHIEVED, not the one it asked for — see
  // observedIntervalMs. A recording where every round landed is 100 % here and
  // says so; a real gap (the admin port stopped answering for a stretch) still
  // shows up, which is the only thing this number was ever for.
  function sampleCoverage(recording) {
    var samples = (recording.samples || []).length;
    var interval = observedIntervalMs(recording);
    var total = totalDurationMs(recording);
    var expected = interval > 0 ? Math.max(1, Math.round(total / interval) + 1) : samples;
    return { samples: samples, expected: expected, ratio: expected > 0 ? Math.min(1, samples / expected) : 0, interval: interval };
  }

  function requestTypeCounts(rows) {
    var counts = { client: 0, async: 0, custom: 0, other: 0 };
    rows.forEach(function (row) { counts[typeClass(row.type)]++; });
    return counts;
  }

  // Where the time went, by entry point — the same per-request rows the
  // Timeline already builds, just grouped by `entry` and summed instead of
  // laid out on a ruler. Sorted heaviest first; `share` is that entry's
  // fraction of the summed duration across every request in the recording.
  function entryTotals(recording) {
    var rows = buildRequestRows(recording);
    var interval = observedIntervalMs(recording);
    var byEntry = {};
    var order = [];
    var grandTotal = 0;
    rows.forEach(function (row) {
      var key = row.entry || row.id;
      // Time this request was VISIBLE in the recording, not `request_duration`.
      // That field is the runtime's own counter since the request began, and a
      // real 2026-09-09 recording had a CUSTOM request reporting 321 747 ms
      // inside a 7 810 ms recording — it had been running for five minutes
      // before Start was ever pressed. Summing those made "Where the time
      // went" total 323 s over a recording that lasted eight, and every share
      // in it meaningless.
      var seen = (row.lastT - row.firstT) + interval;
      if (!(key in byEntry)) { byEntry[key] = 0; order.push(key); }
      byEntry[key] += seen;
      grandTotal += seen;
    });
    var list = order.map(function (key) { return { name: key, ms: byEntry[key] }; });
    list.sort(function (a, b) { return b.ms - a.ms; });
    list.forEach(function (item) { item.share = grandTotal > 0 ? Math.round((item.ms / grandTotal) * 100) : 0; });
    return { list: list, total: grandTotal };
  }

  // ---------- Hotspots: three rankings over the WHOLE recording ----------
  // Each merges every occurrence of the same flow, or the same query,
  // ANYWHERE in the tree into one row — unlike buildCallTree, which keeps
  // the same flow as separate rows when different parents call it, because
  // "which microflow is expensive" does not care who called it.
  function forEachSpan(recording, fn) {
    buildRequestRows(recording).forEach(function (row) {
      buildSpans(recording, row.id).forEach(fn);
    });
  }

  function hotFlows(recording) {
    var byQn = {};
    var order = [];
    forEachSpan(recording, function (s) {
      if (s.kind !== 'flow' || !s.qualifiedName) return;
      var dur = s.t1 - s.t0;
      var row = byQn[s.qualifiedName];
      if (!row) { row = byQn[s.qualifiedName] = { name: s.qualifiedName, frame: s.frame, calls: 0, self: 0, total: 0, max: 0 }; order.push(row); }
      row.calls++;
      row.self += s.self;
      row.total += dur;
      row.frame = s.frame; // the freshest copy, for resolveFrame
      if (dur > row.max) row.max = dur;
    });
    var recordingMs = totalDurationMs(recording);
    order.forEach(function (row) { row.share = recordingMs > 0 ? Math.round((row.total / recordingMs) * 100) : 0; });
    order.sort(function (a, b) { return b.total - a.total; });
    return order;
  }

  // Grouped by the query's own literal text — the same grouping the runtime
  // itself already did, since a schema-level retrieve carries placeholders
  // rather than the actual argument values (real samples, ROADMAP step 46).
  function hotXpaths(recording) {
    var byXpath = {};
    var order = [];
    forEachSpan(recording, function (s) {
      if (s.kind !== 'xpath' || !s.xpath) return;
      var dur = s.t1 - s.t0;
      var row = byXpath[s.xpath];
      if (!row) {
        row = byXpath[s.xpath] = {
          xpath: s.xpath, frame: s.frame, calls: 0, totalMs: 0, max: 0,
          amount: typeof s.amount === 'number' ? s.amount : null
        };
        order.push(row);
      }
      row.calls++;
      row.totalMs += dur;
      if (dur > row.max) row.max = dur;
    });
    order.forEach(function (row) { row.avg = row.calls > 0 ? row.totalMs / row.calls : 0; });
    order.sort(function (a, b) { return b.max - a.max; });
    return order;
  }

  function slowestRequests(recording) {
    return buildRequestRows(recording).slice().sort(function (a, b) { return b.maxDuration - a.maxDuration; });
  }

  function findByQualifiedName(list, qn) {
    return (list || []).filter(function (x) { return x.qualifiedName === qn; })[0] || null;
  }

  // The entity an XPath opens with — "//Sales.Order[...]" -> "Sales.Order" —
  // or null for a query this simple pattern doesn't match. Shared by
  // resolveFrame() (does the model have that entity?) and the flame chart
  // (which module colour does this retrieve get?).
  function xpathEntityQualifiedName(xpath) {
    var m = /\/\/([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*)/.exec(xpath || '');
    return m ? m[1] : null;
  }

  // A stack frame -> the object it names in the CURRENTLY OPEN model, or null
  // when it can't be resolved (a recording made against a different or older
  // project than the one open right now). Null is a normal, tested outcome —
  // the caller renders plain text instead of a dead link, never an exception.
  function resolveFrame(model, frame) {
    if (!frame || typeof frame !== 'object') return null;
    var qn = frameQualifiedName(frame);
    if (qn) {
      var flow = findByQualifiedName(objectsOfSection(model, 'microflows'), qn);
      if (flow) return { sectionKey: 'microflows', item: { name: flow.name, qualifiedName: flow.qualifiedName } };
      flow = findByQualifiedName(objectsOfSection(model, 'nanoflows'), qn);
      if (flow) return { sectionKey: 'nanoflows', item: { name: flow.name, qualifiedName: flow.qualifiedName } };
      return null;
    }
    if (typeof frame.xpath === 'string' && frame.xpath) {
      var entityQn = xpathEntityQualifiedName(frame.xpath);
      if (entityQn) {
        var entity = findByQualifiedName(objectsOfSection(model, 'entities'), entityQn);
        if (entity) return { sectionKey: 'entities', item: { name: entity.name, qualifiedName: entity.qualifiedName } };
      }
    }
    return null;
  }

  function typeClass(type) {
    if (type === 'CLIENT') return 'client';
    if (type === 'CLIENT_ASYNC_MONITORED') return 'async';
    if (type === 'CUSTOM') return 'custom';
    return 'other';
  }

  function formatMs(ms) {
    if (!(ms >= 0)) return '0 ms';
    if (ms < 1000) return Math.round(ms) + ' ms';
    return (ms / 1000).toFixed(1) + ' s';
  }

  // How long the running recording has been going, as a clock rather than a
  // duration — "2:14" reads as elapsed time the way a stopwatch does, where
  // "134 s" reads as a measurement of something already finished. The stamp
  // comes from the server (state.js), which owns the sampling loop's clock.
  function elapsedLabel(startedAt) {
    var t0 = startedAt ? Date.parse(startedAt) : NaN;
    if (!(t0 > 0)) return '0:00';
    var secs = Math.max(0, Math.round((Date.now() - t0) / 1000));
    var mins = Math.floor(secs / 60);
    return mins + ':' + String(secs % 60).padStart(2, '0');
  }

  var BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];
  function formatBytes(n) {
    if (!(n >= 0)) return '0 B';
    var i = 0;
    while (n >= 1024 && i < BYTE_UNITS.length - 1) { n /= 1024; i++; }
    return (i === 0 ? Math.round(n) : n.toFixed(1)) + ' ' + BYTE_UNITS[i];
  }

  // ---------- rendering: the timeline ----------
  // Which request is open below the bars, and which span within its flame is
  // picked. Kept per project (not per recording) so switching projects never
  // shows a detail panel for a request that no longer exists in what is on
  // screen; opening a DIFFERENT recording in the same project also resets it
  // (see the list's Open handler below), and picking a different request bar
  // resets the span \u2014 a picked index from one request's flame means nothing
  // in another's.
  var selectedFor = null;
  function ensureSelectionScope(projectId) {
    if (selectedFor !== projectId) {
      selectedFor = projectId;
      collapsedTreeKeys = null;
      window.MxTimeline.reset();
    }
  }


  // The interval quoted here is the one the samples actually landed at, not
  // the one the recorder asked for \u2014 quoting the request would understate the
  // error bar on every duration on the page by the same 20 % it understated
  // the durations themselves.
  function renderVerdict(recording) {
    var asked = recording.intervalMs || DEFAULT_INTERVAL_MS;
    var got = observedIntervalMs(recording);
    var note = got > asked + 5
      ? ' It asked for ' + asked + ' ms and the admin port could not answer faster than this, which is the real limit on how fine this can get.'
      : '';
    return el('p', { class: 'perf-verdict', text:
      'Sampling profiler \u2014 it looked at what was running every ' + got + ' ms on average, ' +
      'not a tracer. Durations are approximate to within that; an action shorter than it may not get a row here at all, ' +
      'and every count of microflows or retrieves below is how often something was CAUGHT running, never how often it ran. ' +
      'The database counters are the exception: the runtime counts those itself.' + note });
  }

  function recordingSummary(recording) {
    var samples = (recording.samples || []).length;
    var parts = [samples + ' sample' + (samples === 1 ? '' : 's') + ' over ' + formatMs(totalDurationMs(recording))];
    if (recording.adminUrl) parts.push(recording.adminUrl);
    return parts.join(' \u00b7 ');
  }


  // ---------- rendering: setting up a recording ----------
  // Three steps, done once per app run, and all three stay on screen the whole
  // time. The earlier version swapped one card's contents for the next step,
  // which read as three unrelated screens: Karol, seeing it — "user musi
  // dokładnie wiedzieć, jakie kroki ma zrobić, co gdzie i kiedy". So a finished
  // step collapses to a single line carrying the value it produced, the
  // current one is the only one expanded, and each says plainly WHERE its work
  // happens — in PowerShell, in MxScout, or in the app's own console.
  //
  // Which step is current is derived from real state, never from a counter
  // this page increments: the admin connection is the server's (it survives a
  // reload), and whether the app tab is connected is the live bridge's. So
  // reopening this tab lands on the step actually left to do.

  // A browser cannot honestly scan for open ports — the only source of truth
  // is the Mendix convention itself: the admin API listens on the app's own
  // port + 10. Reusing the app URL already on file (persisted from the Live
  // app tab) turns that convention into a filled-in suggestion instead of a
  // rule the user has to remember and apply by hand.
  function suggestedAdminUrl(project) {
    var raw = (project && project.appUrl) || (state.detail.live && state.detail.live.url) || '';
    if (!raw) return 'http://localhost:' + DEFAULT_ADMIN_PORT;
    try {
      var withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : ('http://' + raw);
      var u = new URL(withScheme);
      var appPort = u.port ? parseInt(u.port, 10) : (u.protocol === 'https:' ? 443 : 80);
      return u.protocol + '//' + u.host.replace(/:\d+$/, '') + ':' + (appPort + 10);
    } catch (e) { return 'http://localhost:' + DEFAULT_ADMIN_PORT; }
  }

  // What the strip shows as the address: what the server actually connected
  // to, not what was typed at it.
  function adminLabel(p) {
    var s = p.status || {};
    if (!s.port) return '';
    var host = s.host === '::1' ? '[::1]' : (s.host || 'localhost');
    return 'http://' + host + ':' + s.port;
  }

  // One row of the checklist. `state` is 'done' | 'current' | 'todo'; only a
  // current row gets a body.
  function stepRow(index, opts) {
    var kids = [
      el('div', { class: 'perf-step-head' }, [
        el('span', { class: 'perf-step-mark', text: opts.state === 'done' ? '✓' : String(index) }),
        el('span', { class: 'perf-step-title', text: opts.title }),
        el('span', { class: 'perf-step-value', text: opts.value || '' }),
        opts.action || null
      ].filter(Boolean))
    ];
    if (opts.state === 'current' && opts.body) kids.push(el('div', { class: 'perf-step-body' }, [opts.body]));
    return el('div', { class: 'perf-step is-' + opts.state }, kids);
  }

  // ---------- step 1: where the admin port is ----------
  function adminAddressBody(project) {
    var p = state.detail.perf;
    var suggestion = suggestedAdminUrl(project);
    // Filled in, not just hinted at. In practice the only part that ever
    // differs is the port on the end, so an empty box with grey placeholder
    // text made the user retype an address MxScout already knew — Karol,
    // seeing it: "będziemy zmieniać tylko i wyłącznie końcówkę".
    if (!p.adminUrl) p.adminUrl = suggestion;
    var input = el('input', { type: 'text', class: 'live-url-input', placeholder: suggestion, value: p.adminUrl });
    input.addEventListener('input', function () { p.adminUrl = input.value; });
    var problem = el('p', { class: 'muted' });
    function doCheck() {
      var url = (p.adminUrl || '').trim() || suggestion;
      var res = window.MxLive.classifyAppUrl(url);
      if (res.verdict !== 'allow') {
        problem.textContent = res.verdict === 'block'
          ? 'MxScout connects only to local, test and acceptance environments.'
          : 'Enter an address like ' + suggestion + '.';
        return;
      }
      p.adminUrl = res.origin;
      p.urlOk = true;
      render();
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doCheck(); });
    return el('div', {}, [
      el('p', { class: 'muted', text: 'MxScout reads nested microflow calls, retrieves and the activity actually running through the Mendix Runtime’s admin port. That is a different address than the app itself — commonly the app’s own port + 10.' }),
      el('label', { class: 'field' }, [
        el('span', { text: 'Admin port address' }),
        el('div', { class: 'live-url-row' }, [input, el('button', { class: 'btn btn-primary', text: 'Continue', onclick: doCheck })])
      ]),
      problem,
      el('p', { class: 'muted', text: 'Filled in from the Mendix convention — the admin API listens on the app’s own port + 10. Nothing can scan for it, so change the port on the end if yours is elsewhere.' })
    ]);
  }

  // ---------- step 2: the password, and the only place one is typed ----------
  // It goes straight to /api/session/perf/connect, which checks it against the
  // admin port before keeping it — so a green step 2 always means the runtime
  // really answered, never that a field was filled in.
  function adminPasswordBody() {
    var p = state.detail.perf;
    var script = buildPasswordScript({ adminPort: portOf(p.adminUrl) });
    var input = el('input', { type: 'password', class: 'live-url-input', placeholder: 'Paste what the script printed', value: p.password || '' });
    input.addEventListener('input', function () { p.password = input.value; });
    var copyStatus = el('span', { class: 'muted' });
    var problem = el('p', { class: 'muted' });
    var copyBtn = el('button', {
      class: 'btn', text: 'Copy the code',
      onclick: function () {
        navigator.clipboard.writeText(script).then(
          function () { copyStatus.textContent = 'Copied.'; },
          function () { copyStatus.textContent = 'Could not copy automatically — select the text and copy it.'; }
        );
      }
    });
    var connectBtn = el('button', { class: 'btn btn-primary', text: 'Connect' });
    function doConnect() {
      if (!input.value) { problem.textContent = 'Paste the password the script printed first.'; return; }
      connectBtn.disabled = true;
      problem.textContent = 'Checking the admin port…';
      api('/api/session/perf/connect', {
        method: 'POST', body: JSON.stringify({ url: p.adminUrl, password: input.value })
      }).then(function () {
        // The password has done its job — the server holds the one copy that
        // matters now, so this page stops holding its own.
        p.password = '';
        p.statusKnown = false;
        fetchStatus();
      }).catch(function (err) {
        connectBtn.disabled = false;
        problem.textContent = (err && err.message) || 'Could not reach the admin port.';
      });
    }
    connectBtn.addEventListener('click', doConnect);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doConnect(); });
    return el('div', {}, [
      el('p', { class: 'muted', text: 'The admin password is minted fresh every time the app starts, and lives only in that runtime process’s own memory — nothing can read it but the machine running it.' }),
      el('ol', { class: 'scan-steps' }, [
        el('li', { text: 'Run this in PowerShell, on the machine hosting the app. It only prints the password — it never sends or saves it anywhere.' }),
        el('li', { text: 'Paste what it printed below, and press Connect.' })
      ]),
      el('textarea', { class: 'scan-script', readonly: 'readonly', spellcheck: 'false', text: script || '' }),
      el('div', { class: 'scan-copy-row' }, [copyBtn, copyStatus]),
      el('label', { class: 'field' }, [el('span', { text: 'Admin password' }), input]),
      el('div', { class: 'scan-copy-row' }, [
        connectBtn,
        el('button', { class: 'btn btn-sm btn-ghost', text: 'Back', onclick: function () { p.urlOk = false; p.password = ''; render(); } })
      ]),
      problem
    ]);
  }

  function portOf(url) {
    try { var u = new URL(url); return u.port ? parseInt(u.port, 10) : DEFAULT_ADMIN_PORT; }
    catch (e) { return DEFAULT_ADMIN_PORT; }
  }

  // ---------- step 3: the app tab ----------
  // The SAME snippet the Live app tab hands out — not a second one. Pasting it
  // connects the app for reading data AND puts the record button on its badge
  // (see public/bridge.js), which is the point: the tester is in the app while
  // they record, so that is where Start and Finish belong. A project already
  // connected through Live app has nothing to do here at all.
  function appTabBody(project) {
    if (!state.detail.live.token) {
      window.MxLive.ensureSessionToken(function () { render(); });
      return el('div', { class: 'scan-section' }, [el('span', { class: 'spinner' })]);
    }
    var script = window.MxLive.appBridgeScript(state.detail.live.token, null);
    var appUrl = (project && project.appUrl) || (state.detail.live && state.detail.live.url) || 'the app';
    var copyStatus = el('span', { class: 'muted' });
    var copyBtn = el('button', {
      class: 'btn btn-primary', text: 'Copy the code',
      onclick: function () {
        navigator.clipboard.writeText(script).then(
          function () { copyStatus.textContent = 'Copied.'; },
          function () { copyStatus.textContent = 'Could not copy automatically — select the text and copy it.'; }
        );
      }
    });
    return el('div', {}, [
      el('p', { class: 'muted', text: 'This is the same code the Live app tab uses — one snippet, not a second one. Pasting it also puts a record button on the badge in that tab, so you can start and finish a recording without coming back here.' }),
      el('ol', { class: 'scan-steps' }, [
        el('li', { text: 'Open ' + appUrl + ' in another browser tab, signed in as the user you want to record.' }),
        el('li', { text: 'Press F12 there, and open the Console.' }),
        el('li', { text: 'Paste the code below and press Enter — a badge appears in that tab’s bottom-right corner, with a ⏺ on it.' })
      ]),
      el('textarea', { class: 'scan-script', readonly: 'readonly', spellcheck: 'false', text: script || '' }),
      el('div', { class: 'scan-copy-row' }, [copyBtn, copyStatus]),
      el('div', { class: 'scan-waiting' }, [
        el('span', { class: 'spinner' }),
        el('span', { text: 'Waiting for the code to run in that tab…' })
      ])
    ]);
  }

  // Makes the server forget the password and drops back to step 1. Only
  // offered while idle: mid-recording, Finish is the one way out, so the
  // buffer always gets drained into a saved recording rather than abandoned.
  // This is also the only way the password leaves memory before the process
  // does, which is why it is a button and not just a navigation step.
  function disconnectAdminPort() {
    var p = state.detail.perf;
    p.adminUrl = ''; p.urlOk = false; p.password = '';
    p.status = {}; p.statusKnown = false;
    api('/api/session/perf/disconnect', { method: 'POST' })
      .catch(function () {})
      .then(function () { fetchStatus(); render(); });
  }

  // The ready state, once all three steps are green: one line that says what
  // the recorder is doing and offers the same Start/Finish the app tab's badge
  // does. Kept as its own function because fetchStatus() repaints just this
  // node in place on most polls, via #perf-status-area, instead of a full
  // render() firing once a second while recording.
  function renderStatusArea(project) {
    var p = state.detail.perf;
    var active = !!(p.status && p.status.active);
    var trouble = p.status && p.status.trouble;
    // Elapsed time, not a sample count. Karol, 2026-09-09: while a recording
    // runs the only question is "how long have I been at this" — a sample
    // count answers a question about the sampler, not about the run.
    var label = active
      ? ('Recording… ' + elapsedLabel(p.status && p.status.startedAt))
      : 'Ready — record from the app’s badge, or here.';
    return el('div', {}, [
      el('div', { class: 'perf-connect-strip' }, [
        el('div', { class: 'live-status ' + (active ? 'live-status-recording' : 'live-status-ok') }, [
          el('span', { class: 'live-dot' }),
          el('span', { text: label })
        ]),
        el('span', { class: 'muted perf-connect-addr', text: adminLabel(p) }),
        active ? null : el('button', { class: 'btn btn-sm btn-ghost', text: 'Disconnect', onclick: disconnectAdminPort }),
        // A record control carries a red dot, the way every recorder anyone
        // has used does — the glyph says "record", the colour says which
        // glyph it is, and neither depends on reading the label.
        active
          ? el('button', { class: 'btn btn-danger btn-rec', onclick: function () { finishRecordingSession(project); } }, [
              el('span', { class: 'rec-glyph is-stop' }), el('span', { text: 'Finish recording' })
            ])
          : el('button', { class: 'btn btn-rec', onclick: startRecordingSession }, [
              el('span', { class: 'rec-glyph' }), el('span', { text: 'Start recording' })
            ])
      ].filter(Boolean)),
      // The recorder's own diagnosis when the port has gone quiet for a run of
      // rounds. Without it the only symptom is a recording that saves with
      // nothing in it, which is what the "always 0 samples" bug looked like.
      trouble ? el('p', { class: 'perf-trouble', text: trouble }) : null
    ].filter(Boolean));
  }

  function renderConnectArea(project) {
    var p = state.detail.perf;
    if (!_statusPoll) startStatusPolling();
    if (!p.statusKnown) {
      return el('div', { class: 'card scan-section' }, [
        el('span', { class: 'spinner' }),
        el('span', { class: 'muted', text: 'Checking the admin port…' })
      ]);
    }
    var adminDone = !!(p.status && p.status.connected);
    var appDone = window.MxLive.connected();
    if (adminDone && appDone) {
      return el('div', { class: 'card', id: 'perf-status-area' }, [renderStatusArea(project)]);
    }

    // Which step is open: the first one not yet done. Step 1 counts as done
    // once the admin port is connected — the server knows the address then,
    // and re-asking for it would be theatre.
    var current = !p.urlOk && !adminDone ? 1 : (!adminDone ? 2 : 3);
    function stateOf(n) { return current === n ? 'current' : (n < current ? 'done' : 'todo'); }

    return el('div', { class: 'card' }, [
      el('h3', { class: 'live-h', text: 'Set up performance recording' }),
      el('p', { class: 'muted', text: 'Three steps, once per app run. After that, record as often as you like.' }),
      el('div', { class: 'perf-steps' }, [
        stepRow(1, {
          state: stateOf(1), title: 'Admin port address',
          value: adminDone ? adminLabel(p) : (p.urlOk ? p.adminUrl : ''),
          action: (stateOf(1) === 'done' && !adminDone)
            ? el('button', { class: 'btn btn-sm btn-ghost', text: 'Change', onclick: function () { p.urlOk = false; render(); } })
            : null,
          body: adminAddressBody(project)
        }),
        stepRow(2, {
          state: stateOf(2), title: 'Admin password',
          value: adminDone ? 'connected' : '',
          action: adminDone ? el('button', { class: 'btn btn-sm btn-ghost', text: 'Disconnect', onclick: disconnectAdminPort }) : null,
          body: stateOf(2) === 'current' ? adminPasswordBody() : null
        }),
        stepRow(3, {
          state: stateOf(3), title: 'The app tab',
          value: appDone ? 'connected' : '',
          body: stateOf(3) === 'current' ? appTabBody(project) : null
        })
      ])
    ]);
  }

  // ---------- rendering: the recordings dashboard ----------
  function sparklineSvg(values, colour) {
    var svgNs = 'http://www.w3.org/2000/svg';
    var w = 260, h = 34;
    var svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('preserveAspectRatio', 'none');
    if (values.length < 2) return svg;
    var max = Math.max.apply(null, values.concat([1]));
    var step = w / (values.length - 1);
    var pts = values.map(function (v, i) { return [i * step, h - 3 - (v / max) * (h - 8)]; });
    var d = pts.map(function (pt, i) { return (i ? 'L' : 'M') + pt[0].toFixed(1) + ' ' + pt[1].toFixed(1); }).join(' ');
    var area = document.createElementNS(svgNs, 'path');
    area.setAttribute('d', d + ' L' + w + ' ' + h + ' L0 ' + h + ' Z');
    area.setAttribute('fill', colour);
    area.setAttribute('fill-opacity', '.18');
    var line = document.createElementNS(svgNs, 'path');
    line.setAttribute('d', d);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', colour);
    line.setAttribute('stroke-width', '1.6');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(area);
    svg.appendChild(line);
    return svg;
  }

  function openRecording(id) {
    var p = state.detail.perf;
    p.selectedId = id;
    p.tab = 'overview';
    collapsedTreeKeys = null;
    window.MxTimeline.reset();
    render();
  }

  // Exporting is deliberately on the card rather than buried in the analyzer:
  // the moment it is wanted is the moment something looks wrong, and that is
  // the moment the raw JSON has to be one click away.
  function renderExportButton(r) {
    return el('button', {
      class: 'btn btn-sm', text: 'Export',
      title: 'Save this recording as JSON',
      onclick: function (e) { e.stopPropagation(); exportRecording(r); }
    });
  }

  function renderDeleteButton(r) {
    return el('button', {
      class: 'btn btn-sm btn-danger-outline', text: 'Delete',
      onclick: function (e) {
        if (e) e.stopPropagation();
        if (!confirm('Delete this recording? This cannot be undone.')) return;
        deleteRecording(r.id).then(function () {
          if (!state.detail || !state.detail.perf) return;
          state.detail.perf.recordings = (state.detail.perf.recordings || []).filter(function (x) { return x.id !== r.id; });
          if (state.detail.perf.selectedId === r.id) state.detail.perf.selectedId = null;
          render();
        }, function (err) { setMessage((err && err.message) || 'Could not delete that recording.', 'error'); render(); });
      }
    });
  }

  // A recording that never got a single sample (the admin port didn't
  // answer — ROADMAP step 46 Phase 1c) gets its own state, not an empty
  // list row that reads as "nothing happened".
  function renderEmptyRecordingCard(r) {
    return el('div', { class: 'card rec-card is-empty' }, [
      el('div', { class: 'rec-card-head' }, [ el('span', { class: 'rec-when', text: formatDate(r.started) || 'unknown time' }) ]),
      el('div', { class: 'rec-figs' }, [
        el('div', { class: 'rec-fig' }, [el('span', { class: 'v', text: formatMs(totalDurationMs(r)) }), el('span', { class: 'k', text: 'length' })]),
        el('div', { class: 'rec-fig' }, [el('span', { class: 'v', text: '0' }), el('span', { class: 'k', text: 'samples' })])
      ]),
      el('p', { class: 'rec-warn', text: 'The admin port never answered — check the password and record again.' }),
      el('div', { class: 'rec-actions' }, [renderExportButton(r), renderDeleteButton(r)])
    ]);
  }

  function renderRecordingCard(r) {
    if (!(r.samples || []).length) return renderEmptyRecordingCard(r);
    var rows = buildRequestRows(r);
    var spark = concurrencySeries(r);
    // The card used to carry a "Heaviest: <flow> N%" line. Karol, 2026-09-09,
    // on two real recordings: it gives nothing at this view — the name is
    // usually a framework flow you did not go looking for, and the percentage
    // was a share of request_duration, which is the runtime's own counter
    // since the request began and can be far longer than the recording. The
    // sparkline is what actually identifies a recording in a list.
    var colour = moduleColor(rows.length ? (moduleOf(rows[0].entry || '') || 'System') : 'System');
    return el('div', { class: 'card rec-card', onclick: function () { openRecording(r.id); } }, [
      el('div', { class: 'rec-card-head' }, [ el('span', { class: 'rec-when', text: formatDate(r.started) || 'unknown time' }) ]),
      el('div', { class: 'rec-figs' }, [
        el('div', { class: 'rec-fig' }, [el('span', { class: 'v', text: formatMs(totalDurationMs(r)) }), el('span', { class: 'k', text: 'length' })]),
        el('div', { class: 'rec-fig' }, [el('span', { class: 'v', text: String(rows.length) }), el('span', { class: 'k', text: 'requests' })]),
        el('div', { class: 'rec-fig' }, [el('span', { class: 'v', text: String(r.samples.length) }), el('span', { class: 'k', text: 'samples' })])
      ]),
      el('div', { class: 'rec-spark' }, [sparklineSvg(spark, colour)]),
      rows.length ? null : el('p', { class: 'rec-top muted', text: 'No in-flight requests were caught.' }),
      el('div', { class: 'rec-actions' }, [
        el('button', {
          class: 'btn btn-sm btn-primary', text: 'Open',
          onclick: function (e) { e.stopPropagation(); openRecording(r.id); }
        }),
        renderExportButton(r),
        renderDeleteButton(r)
      ])
    ]);
  }

  function renderDashboard(project) {
    var p = state.detail.perf;
    var count = (p.recordings || []).length;
    // The header carries Import whether or not there is anything to list —
    // "I was sent a recording and have no admin port here" is exactly the
    // case where the grid is empty, so hiding the button behind having
    // recordings already would hide it from the person who needs it.
    var kids = [
      renderConnectArea(project),
      el('div', { class: 'rec-head' }, [
        el('h3', { class: 'live-h', text: count ? ('Recordings (' + count + ')') : 'Recordings' }),
        el('button', {
          class: 'btn btn-sm', text: 'Import…',
          title: 'Open a recording exported from MxScout (.json)',
          onclick: function () { importRecording(project); }
        })
      ])
    ];
    if (count) kids.push(el('div', { class: 'rec-grid' }, p.recordings.map(renderRecordingCard)));
    else kids.push(el('p', { class: 'muted', text: 'No recordings yet — start one above, or import a recording someone exported.' }));
    return el('div', {}, kids.filter(Boolean));
  }

  // ---------- rendering: the single-recording analyzer ----------
  var ANALYZER_TABS = [['overview', 'Overview'], ['timeline', 'Timeline'], ['calltree', 'Call tree'], ['hotspots', 'Hotspots']];

  function renderOverviewTab(recording) {
    var samples = (recording.samples || []).length;
    if (!samples) {
      return el('div', { class: 'card' }, [
        el('h3', { class: 'live-h', text: 'What this recording caught' }),
        el('p', { class: 'muted', text: 'The admin port never answered while this recording ran — there is nothing to analyze.' })
      ]);
    }
    var rows = buildRequestRows(recording);
    var counts = requestTypeCounts(rows);
    var peak = peakParallel(recording);
    var coverage = sampleCoverage(recording);
    var busy = busyFraction(recording);
    var totals = entryTotals(recording);

    var tiles = [
      { v: formatMs(totalDurationMs(recording)), k: 'length', n: formatDate(recording.started) || '' },
      { v: String(rows.length), k: 'requests', n: [
          counts.client ? (counts.client + ' client') : null,
          counts.async ? (counts.async + ' async') : null,
          counts.custom ? (counts.custom + ' custom') : null,
          counts.other ? (counts.other + ' other') : null
        ].filter(Boolean).join(' · ') },
      { v: String(peak.count), k: 'peak parallel', n: peak.count ? ('at ' + formatMs(peak.atMs)) : '' },
      { v: Math.round(coverage.ratio * 100) + '%', k: 'sample coverage', n: samples + ' of ' + coverage.expected + ' expected' },
      { v: Math.round(busy * 100) + '%', k: 'runtime busy', n: Math.round(busy * samples) + ' of ' + samples + ' samples had work in flight' }
    ];

    var shareRows = totals.list.slice(0, 5).map(function (item) {
      return withMod(el('div', { class: 'share' }, [
        el('div', {}, [
          el('div', { class: 'share-name', text: item.name }),
          el('div', { class: 'share-track' }, [el('div', { class: 'share-fill', style: 'width:' + item.share + '%' })])
        ]),
        el('span', { class: 'share-val', text: formatMs(item.ms) + ' · ' + item.share + '%' })
      ]), moduleOf(item.name) || item.name);
    });

    return el('div', {}, [
      el('div', { class: 'card' }, [
        el('h3', { class: 'live-h', text: 'What this recording caught' }),
        el('p', { class: 'muted', text: 'Everything below is derived from the ' + samples + ' samples — nothing was measured twice.' }),
        statTiles(tiles)
      ]),
      renderWorkCard(recording),
      shareRows.length ? el('div', { class: 'card' }, [
        el('h3', { class: 'live-h', text: 'Where the time went' }),
        el('p', { class: 'muted', text: 'Share of the time requests were visible in this recording, grouped by the microflow that started each one. A request that was already running when Start was pressed counts only from there.' }),
        el('div', { class: 'share-list' }, shareRows),
        renderVerdict(recording)
      ]) : null,
      renderRuntimeCard(recording)
    ].filter(Boolean));
  }

  // ---------- how much work the scenario did ----------
  // The one card built to be read TWICE: record the scenario, change
  // something, record it again, put the two side by side. Karol's ask,
  // 2026-09-10 — "nagramy proces zrobiony błędnie i pokażemy: miałeś 2000
  // selectów, pobrałeś 10 tysięcy obiektów, odpaliłeś 500 microflowów, a
  // teraz zobacz" — and the comparison is his to make, between two recordings
  // he opens himself. What this card owes him is that the numbers mean the
  // same thing in both.
  //
  // Which is why they are split by HOW THEY WERE GOT, not by what they count.
  // The database counters are the runtime's own; it increments them itself and
  // MxScout only subtracts the first reading from the last, so 2 000 selects
  // means two thousand selects. Everything about microflows and retrieves
  // comes from looking at the stack every ~20 ms, so it is a FLOOR: what was
  // caught, never what happened. Putting those two kinds of number in one row
  // of tiles is what would make this card a lie.
  function workTotals(recording) {
    var flows = hotFlows(recording);
    var queries = hotXpaths(recording);
    var db = { total: 0 };
    CB_OPS.forEach(function (op) { db[op] = 0; });
    connectionbusSeries(recording).forEach(function (p) {
      CB_OPS.forEach(function (op) { db[op] += p[op] || 0; });
      db.total += p.total;
    });
    function sumCalls(list) { return list.reduce(function (n, r) { return n + r.calls; }, 0); }
    return {
      requests: buildRequestRows(recording).length,
      flowRuns: sumCalls(flows), flowNames: flows.length,
      retrieveRuns: sumCalls(queries), retrieveQueries: queries.length,
      db: db, hasDb: connectionbusSeries(recording).length > 0
    };
  }

  function statTiles(tiles) {
    return el('div', { class: 'stat-row' }, tiles.map(function (t) {
      return el('div', { class: 'stat' }, [
        el('div', { class: 'v', text: t.v }),
        el('div', { class: 'k', text: t.k }),
        t.n ? el('div', { class: 'n', text: t.n }) : null
      ].filter(Boolean));
    }));
  }

  function renderWorkCard(recording) {
    var w = workTotals(recording);
    if (!w.flowRuns && !w.retrieveRuns && !w.hasDb) return null;
    var kids = [
      el('h3', { class: 'live-h', text: 'How much work this took' }),
      el('p', { class: 'muted', text: 'The numbers to put beside another recording of the same scenario. Record it once, change something, record it again — these are what should move.' })
    ];

    if (w.hasDb) {
      var rest = w.db.total - w.db.select;
      kids.push(el('h4', { class: 'perf-sub-h', text: 'Counted by the runtime' }));
      kids.push(statTiles([
        { v: String(w.db.select), k: 'selects', n: w.requests ? (Math.round(w.db.select / w.requests) + ' per request') : '' },
        { v: String(w.db.total), k: 'database operations', n: rest + ' of them not selects' },
        { v: String(w.db.insert + w.db.update + w.db.delete), k: 'writes',
          n: w.db.insert + ' insert · ' + w.db.update + ' update · ' + w.db.delete + ' delete' },
        { v: String(w.db.transaction), k: 'transactions', n: 'as the runtime counts them' }
      ]));
    }

    kids.push(el('h4', { class: 'perf-sub-h', text: 'Caught by the sampler — at least this many' }));
    kids.push(statTiles([
      { v: String(w.flowRuns), k: 'microflow runs seen',
        n: w.flowNames + ' different microflow' + (w.flowNames === 1 ? '' : 's') },
      { v: String(w.retrieveRuns), k: 'retrieves seen',
        n: w.retrieveQueries + ' different quer' + (w.retrieveQueries === 1 ? 'y' : 'ies') },
      { v: String(w.requests), k: 'requests', n: 'entry points into the runtime' }
    ]));

    kids.push(el('p', { class: 'muted', style: 'margin:14px 0 0;font-size:12px', text:
      'How many ROWS those retrieves returned is not in this data at all — the admin port reports the query and the range it asked for, never the answer. The count of selects is the closest thing to it, and it is exact. The microflow and retrieve counts are not: a call that started and finished between two looks was never there to be seen, so treat them as a floor that moves the right way, not as a tally.' }));

    return el('div', { class: 'card' }, kids);
  }

  // ---------- rendering: Runtime (Phase 2d) ----------
  // `stats` — the admin port's `runtime_statistics` — rides along in every
  // sample but was left unparsed until a real one had been seen (ROADMAP
  // step 46). It describes the RUNTIME, not this recording specifically:
  // heap and the database counters belong to the whole Mendix process, so
  // this card sits under the request numbers above rather than mixed into
  // them.
  function renderRuntimeCard(recording) {
    var mem = memorySeries(recording);
    var cb = connectionbusSeries(recording);
    var sessions = sessionsNow(recording);
    if (!mem.length && !cb.length && !sessions) return null;

    var pools = poolSeries(recording);

    // Every tile carries what the number is measured AGAINST. "447 MB" is not
    // a fact anyone can act on; "447 MB of the 400 MB this runtime has
    // committed" is. The time series these tiles used to sit beside moved to
    // the Timeline's own tracks, where they share its ruler.
    var tiles = [];
    if (pools.length) {
      var peakUsed = pools.reduce(function (m, p) { return Math.max(m, p.used); }, 0);
      var committed = pools[pools.length - 1].committed;
      var max = pools[pools.length - 1].max;
      tiles.push({
        v: formatBytes(peakUsed), k: 'peak heap',
        n: committed ? ('of ' + formatBytes(committed) + ' committed' + (max ? ', ' + formatBytes(max) + ' max' : '')) : (max ? 'of ' + formatBytes(max) + ' max' : '')
      });
      // Old Gen across the whole recording. Young-generation churn is normal
      // and says nothing; the old generation ending higher than it started,
      // after collections have run, is the one leak signal this data carries.
      var withPools = pools.filter(function (p) { return p.hasPools; });
      if (withPools.length > 1) {
        var grew = withPools[withPools.length - 1].old - withPools[0].old;
        tiles.push({
          v: (grew >= 0 ? '+' : '−') + formatBytes(Math.abs(grew)), k: 'old gen moved',
          n: gcMarks(recording).length + ' inferred collection' + (gcMarks(recording).length === 1 ? '' : 's')
        });
      }
    }
    // The database counters used to be two tiles here as well. They belong to
    // the WORK the scenario did, not to the state of the runtime it ran in,
    // and they are the first thing anyone comparing two recordings looks at —
    // so they moved up to "How much work this took", including selects per
    // request, and are deliberately not repeated here. What is left on this
    // card is what the process was like while that work happened.
    if (sessions) {
      // `named_users` is how many user ACCOUNTS exist, not how many sessions
      // are open — a real recording reported 3 736 named_users with exactly
      // one browser actually connected, and this tile called that "3736 named
      // sessions". Sessions are the entries in `user_sessions`; the account
      // count is a fact about the database and belongs in the sub-line.
      var open = sessions.user_sessions && typeof sessions.user_sessions === 'object'
        ? Object.keys(sessions.user_sessions).length : null;
      var anon = typeof sessions.anonymous_sessions === 'number' ? sessions.anonymous_sessions : 0;
      var accounts = typeof sessions.named_users === 'number' ? sessions.named_users : null;
      var note = [anon ? (anon + ' anonymous') : null, accounts != null ? (accounts + ' user accounts exist') : null].filter(Boolean).join(' · ');
      tiles.push({ v: open != null ? String(open + anon) : '—', k: 'open sessions', n: note });
    }

    return el('div', { class: 'card' }, [
      el('h3', { class: 'live-h', text: 'Runtime, while this ran' }),
      el('p', { class: 'muted', text: 'From the same admin port, alongside the requests above — heap and the database counters belong to the whole Mendix process, not only to this recording’s own requests. How they moved over time is on the Timeline tab, on the same ruler as the requests that moved them.' }),
      tiles.length ? statTiles(tiles) : null,
      renderHandlerTable(recording),
      el('p', { class: 'muted', style: 'margin:14px 0 0;font-size:12px', text:
        'Not in this data, and no chart will invent it: CPU, thread counts, how long a collection paused for, and how many rows a retrieve returned. A collection is inferred from used heap dropping between two samples — the admin port reports no such event.' })
    ].filter(Boolean));
  }

  // The per-handler request counters. They are cumulative for the runtime's
  // whole life, like connectionbus, so the number worth showing is how far
  // each moved while this recording ran — and a handler that did not move at
  // all is left out rather than listed as a row of dashes. `debugger/` moving
  // is worth seeing on its own: a debugger attached during a measurement
  // changes what is being measured.
  function renderHandlerTable(recording) {
    var samples = recording.samples || [];
    var first = null, last = null;
    for (var i = 0; i < samples.length; i++) {
      var s = statsOf(samples[i]);
      if (s && Array.isArray(s.requests)) { if (!first) first = s.requests; last = s.requests; }
    }
    if (!first || !last || first === last) return null;
    var was = {};
    first.forEach(function (h) { if (h && typeof h.name === 'string') was[h.name] = h.value; });
    var moved = last.filter(function (h) {
      return h && typeof h.name === 'string' && typeof h.value === 'number' && (h.value - (was[h.name] || 0)) > 0;
    });
    if (!moved.length) return null;
    var secs = Math.max(0.001, totalDurationMs(recording) / 1000);
    return el('div', { style: 'margin-top:16px' }, [
      el('h4', { class: 'perf-sub-h', text: 'Requests the runtime answered' }),
      el('div', { style: 'overflow-x:auto' }, [
        el('table', { class: 'data-table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'Handler' }),
            el('th', { class: 'n', text: 'While recording' }),
            el('th', { class: 'n', text: 'Per second' })
          ])]),
          el('tbody', {}, moved.map(function (h) {
            var d = h.value - (was[h.name] || 0);
            return el('tr', {}, [
              el('td', { text: h.name || '(root)' }),
              el('td', { class: 'n', text: '+' + d }),
              el('td', { class: 'n', text: (d / secs).toFixed(1) })
            ]);
          }))
        ])
      ])
    ]);
  }

  // ---------- rendering: Call tree (Phase 2c) ----------
  // Which rows are collapsed, keyed by the same pathKey buildCallTree()
  // merges on. Reset alongside the Timeline's own selection (see
  // ensureSelectionScope and openRecording) — a collapsed path from one
  // recording names nothing in another.
  var collapsedTreeKeys = null;
  function toggleTreeKey(key) {
    if (!collapsedTreeKeys) collapsedTreeKeys = {};
    if (collapsedTreeKeys[key]) delete collapsedTreeKeys[key];
    else collapsedTreeKeys[key] = true;
    render();
  }
  function flattenTree(roots) {
    var out = [];
    function walk(node) {
      out.push(node);
      if (!(collapsedTreeKeys && collapsedTreeKeys[node.key])) node.children.forEach(walk);
    }
    roots.forEach(walk);
    return out;
  }

  function renderCallTreeRow(node, maxTotal) {
    var hasChildren = node.children.length > 0;
    var collapsed = !!(collapsedTreeKeys && collapsedTreeKeys[node.key]);
    var twist = hasChildren
      ? el('button', { class: 'twist', text: collapsed ? '▸' : '▾', title: collapsed ? 'Expand' : 'Collapse', onclick: function () { toggleTreeKey(node.key); } })
      : el('span', { class: 'twist', text: '·' });
    var nameCell = el('span', { class: 'tw', style: 'padding-left:' + (node.depth * 16) + 'px' }, [
      twist,
      el('span', { class: 'tname' + (node.kind === 'xpath' ? ' xpath' : ''), text: node.name })
    ]);
    var modName = node.kind === 'flow' ? node.qualifiedName : (node.kind === 'xpath' ? xpathEntityQualifiedName(node.xpath) : null);
    var barCell = el('td', { class: 'bar-cell' }, [
      el('div', { class: 'minibar' }, [
        el('div', { class: 'minibar-fill', style: 'width:' + (maxTotal > 0 ? Math.round((node.total / maxTotal) * 100) : 0) + '%' })
      ])
    ]);
    if (modName) withMod(barCell, moduleOf(modName) || modName);
    return el('tr', {}, [
      el('td', {}, [nameCell]),
      el('td', { class: 'n', text: String(node.calls) }),
      el('td', { class: 'n', text: formatMs(node.self) }),
      el('td', { class: 'n', text: formatMs(node.total) }),
      barCell
    ]);
  }

  function renderCallTreeTab(recording) {
    var samples = (recording.samples || []).length;
    if (!samples) {
      return el('div', { class: 'card' }, [
        el('h3', { class: 'live-h', text: 'Call tree' }),
        el('p', { class: 'muted', text: 'The admin port never answered while this recording ran — there is nothing to build a tree from.' })
      ]);
    }
    var tree = buildCallTree(recording);
    if (!tree.roots.length) {
      return el('div', { class: 'card' }, [
        el('h3', { class: 'live-h', text: 'Call tree' }),
        el('p', { class: 'muted', text: 'This recording has no in-flight requests in it — there is nothing to build a tree from.' })
      ]);
    }
    var maxTotal = 0;
    tree.all.forEach(function (n) { if (n.total > maxTotal) maxTotal = n.total; });
    var rows = flattenTree(tree.roots);

    return el('div', { class: 'card' }, [
      el('div', { class: 'table-h' }, [
        el('h4', { text: 'Call tree — the whole recording' }),
        el('span', { class: 'muted', text: 'identical paths merged · sorted by total' })
      ]),
      // "Calls" read as a count of calls, and it never was one: it is how many
      // separate times that path was CAUGHT on the stack. Karol, 2026-09-10,
      // on a real recording: "widzę 4, a wiem że odpalił się kilkadziesiąt
      // razy" — and he was right, the flow just kept finishing between two
      // looks. The column says what it counts now, and says it in the header
      // rather than in a note under the table nobody reads twice.
      el('p', { class: 'muted', style: 'margin-bottom:12px', text: 'Every call of the same microflow under the same parent is folded into one row, so a loop that ran many times reads as one line. "Times seen" is how often that row was caught on the stack, not how often it ran — anything that finished between two looks was never there to count.' }),
      el('div', { style: 'overflow-x:auto' }, [
        el('table', { class: 'data-table' }, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'Microflow / retrieve' }),
            el('th', { class: 'n', title: 'How many separate times this was caught running — a sampling profiler cannot count calls', text: 'Times seen' }),
            el('th', { class: 'n', text: 'Self' }),
            el('th', { class: 'n', text: 'Total' }),
            el('th', { text: '' })
          ])]),
          el('tbody', {}, rows.map(function (node) { return renderCallTreeRow(node, maxTotal); }))
        ])
      ]),
      renderVerdict(recording)
    ]);
  }

  // ---------- rendering: Hotspots (Phase 2c) ----------
  // Sort state for the three tables — a plain module var (not per-recording)
  // is enough: it is a display preference, not data, and the defaults
  // already match what each table is naturally read by.
  var hotspotSort = {
    flows: { key: 'total', dir: -1 },
    xpath: { key: 'max', dir: -1 },
    slowest: { key: 'maxDuration', dir: -1 }
  };

  function sortRows(rows, sort) {
    var key = sort.key, dir = sort.dir;
    return rows.slice().sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (typeof av === 'string' || typeof bv === 'string') return dir * String(av || '').localeCompare(String(bv || ''));
      return dir * ((av || 0) - (bv || 0));
    });
  }

  function sortableHeader(text, sort, key, alignRight) {
    var active = sort.key === key;
    var cls = 'th-sort' + (alignRight ? ' n' : '') + (active ? (sort.dir < 0 ? ' sorted-desc' : ' sorted-asc') : '');
    return el('th', {
      class: cls, text: text,
      onclick: function () {
        if (sort.key === key) sort.dir = -sort.dir; else { sort.key = key; sort.dir = -1; }
        render();
      }
    });
  }

  // A resolved model target -> the "Add as a finding" button comments.js
  // needs. `attributes: []` because a finding about a microflow or an entity
  // reached from here never carries the entity's own attribute checklist —
  // that only applies to a finding opened from the entity popup itself.
  function findingButton(resolved) {
    var kind = resolved.sectionKey === 'microflows' ? 'microflow' : resolved.sectionKey === 'nanoflows' ? 'nanoflow' : 'entity';
    var target = { kind: kind, qualifiedName: resolved.item.qualifiedName, module: moduleOf(resolved.item.qualifiedName), name: resolved.item.name, attributes: [] };
    return window.MxComments.addButton(target, 'Add as a finding');
  }

  function renderHotFlowsTable(model, recording) {
    var rows = sortRows(hotFlows(recording), hotspotSort.flows);
    if (!rows.length) return null;
    return el('div', { class: 'table-block' }, [
      el('div', { class: 'table-h' }, [
        el('h4', { text: 'Microflows' }),
        el('span', { class: 'muted', text: 'self = time it was the deepest frame · times seen = how often it was caught running' })
      ]),
      el('div', { style: 'overflow-x:auto' }, [
        el('table', { class: 'data-table' }, [
          el('thead', {}, [el('tr', {}, [
            sortableHeader('Microflow', hotspotSort.flows, 'name'),
            sortableHeader('Times seen', hotspotSort.flows, 'calls', true),
            sortableHeader('Self', hotspotSort.flows, 'self', true),
            sortableHeader('Total', hotspotSort.flows, 'total', true),
            sortableHeader('Max call', hotspotSort.flows, 'max', true),
            el('th', { text: '' })
          ])]),
          el('tbody', {}, rows.map(function (row) {
            var target = resolveFrame(model, row.frame);
            var nameCell = target
              ? el('button', { class: 'link-btn', text: row.name, onclick: function () { jumpToObject(target.sectionKey, target.item); } })
              : el('span', { text: row.name });
            return el('tr', {}, [
              el('td', { class: 'wide' }, [nameCell]),
              el('td', { class: 'n', text: String(row.calls) }),
              el('td', { class: 'n', text: formatMs(row.self) }),
              el('td', { class: 'n', text: formatMs(row.total) + '  (' + row.share + '%)' }),
              el('td', { class: 'n', text: formatMs(row.max) }),
              el('td', {}, [target ? el('span', { class: 'row-act' }, [findingButton(target)]) : null])
            ]);
          }))
        ])
      ])
    ]);
  }

  function renderHotXpathsTable(model, recording) {
    var rows = sortRows(hotXpaths(recording), hotspotSort.xpath);
    if (!rows.length) return null;
    return el('div', { class: 'table-block' }, [
      el('div', { class: 'table-h' }, [
        el('h4', { text: 'Retrieves' }),
        el('span', { class: 'muted', text: 'grouped by the query itself · row limit = the range the retrieve asked the database for' })
      ]),
      el('div', { style: 'overflow-x:auto' }, [
        el('table', { class: 'data-table' }, [
          el('thead', {}, [el('tr', {}, [
            sortableHeader('XPath', hotspotSort.xpath, 'xpath'),
            sortableHeader('Times seen', hotspotSort.xpath, 'calls', true),
            sortableHeader('Avg', hotspotSort.xpath, 'avg', true),
            sortableHeader('Max', hotspotSort.xpath, 'max', true),
            sortableHeader('Row limit', hotspotSort.xpath, 'amount', true),
            el('th', { text: 'Entity' })
          ])]),
          el('tbody', {}, rows.map(function (row) {
            var entityQn = xpathEntityQualifiedName(row.xpath);
            var entity = entityQn ? findByQualifiedName(objectsOfSection(model, 'entities'), entityQn) : null;
            var target = entity ? { sectionKey: 'entities', item: { name: entity.name, qualifiedName: entity.qualifiedName } } : null;
            var entityCell = target
              ? el('button', { class: 'link-btn', text: entity.name, onclick: function () { jumpToObject('entities', target.item); } })
              : el('span', { class: 'muted', text: entityQn || '—' });
            return el('tr', {}, [
              el('td', { class: 'wide', title: row.xpath, text: row.xpath }),
              el('td', { class: 'n', text: String(row.calls) }),
              el('td', { class: 'n', text: formatMs(row.avg) }),
              el('td', { class: 'n', text: formatMs(row.max) }),
              el('td', { class: 'n', title: 'The range this retrieve asked the database for — not how many rows came back, which the admin port never reports', text: row.amount == null ? '—' : (row.amount === -1 ? 'no limit' : String(row.amount)) }),
              el('td', {}, [entityCell, target ? el('span', { class: 'row-act', style: 'margin-left:8px' }, [findingButton(target)]) : null].filter(Boolean))
            ]);
          }))
        ])
      ])
    ]);
  }

  function renderSlowestTable(recording) {
    var rows = sortRows(slowestRequests(recording), hotspotSort.slowest).slice(0, 10);
    if (!rows.length) return null;
    return el('div', { class: 'table-block' }, [
      el('div', { class: 'table-h' }, [
        el('h4', { text: 'Slowest requests' }),
        el('span', { class: 'muted', text: 'as the runtime reported them' })
      ]),
      el('div', { style: 'overflow-x:auto' }, [
        el('table', { class: 'data-table' }, [
          el('thead', {}, [el('tr', {}, [
            sortableHeader('Entry point', hotspotSort.slowest, 'entry'),
            el('th', { text: 'Type' }), el('th', { text: 'User' }),
            sortableHeader('Started', hotspotSort.slowest, 'firstT', true),
            sortableHeader('Duration', hotspotSort.slowest, 'maxDuration', true)
          ])]),
          el('tbody', {}, rows.map(function (row) {
            return el('tr', {}, [
              el('td', { class: 'wide', text: row.entry || row.id }),
              el('td', { text: typeClass(row.type) }),
              el('td', { text: row.user || '' }),
              el('td', { class: 'n', text: '+' + formatMs(row.firstT) }),
              el('td', { class: 'n', text: formatMs(row.maxDuration) })
            ]);
          }))
        ])
      ])
    ]);
  }

  function renderHotspotsTab(model, recording) {
    var samples = (recording.samples || []).length;
    if (!samples) {
      return el('div', { class: 'card' }, [
        el('h3', { class: 'live-h', text: 'Hotspots' }),
        el('p', { class: 'muted', text: 'The admin port never answered while this recording ran — there is nothing to rank.' })
      ]);
    }
    var blocks = [renderHotFlowsTable(model, recording), renderHotXpathsTable(model, recording), renderSlowestTable(recording)].filter(Boolean);
    if (!blocks.length) {
      return el('div', { class: 'card' }, [
        el('h3', { class: 'live-h', text: 'Hotspots' }),
        el('p', { class: 'muted', text: 'This recording has no in-flight requests in it — there is nothing to rank.' })
      ]);
    }
    return el('div', { class: 'card' }, [
      el('h3', { class: 'live-h', text: 'Hotspots' }),
      el('p', { class: 'muted', style: 'margin-bottom:16px', text: 'Three rankings over the same samples. Any row can become a finding, and every name opens the object it points at.' }),
      el('div', {}, blocks),
      renderVerdict(recording)
    ]);
  }

  function renderAnalyzer(model, project, recording) {
    var p = state.detail.perf;
    var body = p.tab === 'timeline'
      ? el('div', { class: 'card perf-timeline-card' }, [window.MxTimeline.render(model, recording), renderVerdict(recording)])
      : p.tab === 'calltree'
      ? renderCallTreeTab(recording)
      : p.tab === 'hotspots'
      ? renderHotspotsTab(model, recording)
      : renderOverviewTab(recording);
    return el('div', {}, [
      el('div', { class: 'perf-back-row' }, [
        el('button', {
          class: 'btn btn-sm btn-ghost', text: '← Recordings',
          onclick: function () { p.selectedId = null; render(); }
        })
      ]),
      el('div', { class: 'perf-analyzer-head' }, [
        el('h3', { class: 'live-h', text: formatDate(recording.started) || 'Recording' }),
        el('p', { class: 'muted', text: recordingSummary(recording) })
      ]),
      el('div', { class: 'popup-tabs' }, ANALYZER_TABS.map(function (t) {
        return el('button', {
          class: 'popup-tab' + (p.tab === t[0] ? ' is-active' : ''), text: t[1],
          onclick: function () { p.tab = t[0]; render(); }
        });
      })),
      body
    ]);
  }

  // ---------- top level ----------
  var _currentProject = null;

  function renderPanel(model, project) {
    ensureSelectionScope(project.id);
    _currentProject = project;
    var p = state.detail.perf;
    // Step 3 asks whether the APP tab is connected, and that fact belongs to
    // the live bridge's own poller — which otherwise only runs while the Live
    // app panel is open. Start it here too, or this tab would show "waiting
    // for the code" forever next to a bridge that connected a second ago.
    window.MxLive.startPolling();
    if (p.recordings === null && !p.recordingsLoading) {
      p.recordingsLoading = true;
      loadRecordings(project.id).then(function (rows) {
        if (state.detail && state.detail.perf) { state.detail.perf.recordings = rows; state.detail.perf.recordingsLoading = false; render(); }
      });
    }

    var selected = (p.recordings || []).filter(function (r) { return r.id === p.selectedId; })[0] || null;
    if (selected) return renderAnalyzer(model, project, selected);
    return renderDashboard(project);
  }

  window.MxPerf = {
    init: init,
    buildPasswordScript: buildPasswordScript,
    resolveFrame: resolveFrame,
    buildRequestRows: buildRequestRows,
    buildSpans: buildSpans,
    buildCallTree: buildCallTree,
    hotFlows: hotFlows,
    hotXpaths: hotXpaths,
    slowestRequests: slowestRequests,
    memorySeries: memorySeries,
    connectionbusSeries: connectionbusSeries,
    sessionsNow: sessionsNow,
    observedIntervalMs: observedIntervalMs,
    entryTotals: entryTotals,
    poolSeries: poolSeries,
    gcMarks: gcMarks,
    renderPanel: renderPanel
  };
})();
