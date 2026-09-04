/* MxScout — performance recording, read from the Mendix Runtime Admin port.
 *
 * MxScout's server never makes an outbound connection, and this browser tab
 * cannot reach another origin's admin port with a custom auth header either
 * (CORS blocks it). So there is exactly one compliant shape for this: a
 * PowerShell script, generated here and downloaded, that YOU run on the
 * machine hosting the Mendix app. It reads that app's admin password out of
 * its own process (nobody types it in, nobody stores it), polls the admin
 * port while you use the app, and writes a plain JSON file. MxScout only
 * ever reads that finished file — the collector and the browser never talk
 * to each other, and the MxScout server is not involved in any of this.
 *
 * What the admin port gives that ordinary network traffic never could: the
 * INTERNAL action stack behind a request — nested microflow calls, the
 * activity currently running, the XPath behind a retrieve — not just "a
 * request happened and took N ms". See ROADMAP step 46 for the research
 * that ruled out every other shape (a server-side poll, TRACE log parsing).
 *
 * The recording also carries a second, unparsed block per sample (`stats`,
 * from the admin port's broader runtime-statistics action) alongside the
 * per-request data this file actually reads. Its real shape has not been
 * confirmed against a live Mendix runtime yet — unlike get_current_runtime_
 * requests, proven in Phase 0 — so nothing here parses or renders it. It
 * rides along in every recording so Phase 2 (Hotspots) has it to design a
 * parser against, the same way this project always builds a parser AFTER
 * seeing a real sample, never before.
 */
(function () {
  'use strict';

  // Bound once, in init(). Named exactly as they were in app.js.
  var el, state, store, render, setMessage, downloadText, pickModelFile, readFileText, jumpToObject, objectsOfSection;

  function init(deps) {
    el = deps.el;
    state = deps.state;
    store = deps.store;
    render = deps.render;
    setMessage = deps.setMessage;
    downloadText = deps.downloadText;
    pickModelFile = deps.pickModelFile;
    readFileText = deps.readFileText;
    jumpToObject = deps.jumpToObject;
    objectsOfSection = deps.objectsOfSection;
  }

  // ---------- the file format ----------
  // A single canonical copy of both values: used to sniff and validate an
  // imported file below, AND substituted into the generated collector script
  // (see buildCollectorScript) so the two never drift apart by hand.
  var TOOL = 'mxscout-perf-collector';
  var FORMAT_VERSION = 1;
  var DEFAULT_ADMIN_PORT = 8090;
  var DEFAULT_INTERVAL_MS = 50;

  function looksLikeRecording(text) {
    // Same trick as crypto.js's looksLikePackage: cheap enough to run on the
    // first few hundred characters of a dropped file, before parsing it.
    return String(text).slice(0, 400).indexOf('"tool":"' + TOOL + '"') !== -1;
  }

  function parseRecording(text) {
    var parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { return { ok: false, error: 'That file is not valid JSON.' }; }
    if (!parsed || parsed.tool !== TOOL) {
      return { ok: false, error: 'That file is not an MxScout performance recording.' };
    }
    if (typeof parsed.version !== 'number' || parsed.version > FORMAT_VERSION) {
      return { ok: false, error: 'That recording was written by a newer MxScout (format version ' + parsed.version + '). Update MxScout and try again.' };
    }
    if (!Array.isArray(parsed.samples)) {
      return { ok: false, error: 'That recording has no samples in it — it may be damaged.' };
    }
    return { ok: true, recording: parsed };
  }

  // ---------- storage ----------
  // One recording per project, overwritten by the next import — a history of
  // named recordings is a Phase 2+ question, not this one.
  function loadRecording(projectId) {
    return store.get('recordings', projectId).then(function (row) { return row ? row.recording : null; });
  }

  function saveRecording(projectId, recording) {
    return store.put('recordings', {
      projectId: projectId,
      recording: recording,
      importedAt: new Date().toISOString()
    }).then(function () { return recording; });
  }

  // ---------- the collector script ----------
  // Real, readable PowerShell — not assembled from fragments — the same
  // argument the rest of MxScout makes for its own source: read it, there is
  // nothing hidden in it. {{PLACEHOLDER}} values are substituted in
  // buildCollectorScript below.
  //
  // The password-read technique (PEB -> ProcessParameters -> Environment
  // block, via NtQueryInformationProcess + ReadProcessMemory) is the one
  // proven working against a real Mendix runtime in ROADMAP step 46's Phase
  // 0 — Studio Pro mints M2EE_ADMIN_PASS fresh per run and hands it to the
  // runtime process as an environment variable, not a config file, not a
  // command-line argument. The x64 struct offsets below are the ones public
  // process-environment-reading tools commonly use; if a Windows update ever
  // moves them, this script fails to find the password and says so, rather
  // than reading whatever garbage happens to be at that address.
  var COLLECTOR_TEMPLATE = [
    '# MxScout performance collector — generated by MxScout, run by you.',
    '#',
    '# What this does: finds the Mendix Runtime process listening on the admin',
    '# port, reads its own M2EE_ADMIN_PASS out of its process environment (the',
    '# value Studio Pro generates fresh per run — MxScout never sees it, and it',
    '# is never written to the file this script produces), then polls the admin',
    '# port while you use the app and writes a JSON file for MxScout to import.',
    '#',
    '# Windows only. Run it on the machine hosting the Mendix app, as the same',
    '# user running that app (or an administrator) — reading another process\'s',
    '# environment needs PROCESS_VM_READ on it, which only that account (or an',
    '# admin) has by default.',
    '',
    'param(',
    '  [int]$Port = {{ADMIN_PORT}},',
    '  [int]$IntervalMs = {{INTERVAL_MS}}',
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
    'Write-Host "Admin password read from the runtime process\'s own memory. It will not be written to the output file."',
    '',
    '$AuthHeader = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($AdminPass))',
    '$Headers = @{ \'X-M2EE-Authentication\' = $AuthHeader; \'Content-Type\' = \'application/json\' }',
    '$Url = "http://localhost:$Port/"',
    '',
    'function Invoke-Admin($action) {',
    '  $body = @{ action = $action; params = @{} } | ConvertTo-Json -Compress',
    '  try { return Invoke-RestMethod -Uri $Url -Method Post -Headers $Headers -Body $body -ErrorAction Stop }',
    '  catch { return $null }',
    '}',
    '',
    '# ---------- record ----------',
    '# Both admin actions are polled every tick, on the same auth, so a',
    '# recording carries as much of what the admin port can say as possible:',
    '# get_current_runtime_requests (the action stack this view reads) and',
    '# runtime_statistics (thread pool / cache / connection pool / sessions —',
    '# stored as-is, MxScout does not parse it yet).',
    '$Samples = New-Object System.Collections.Generic.List[object]',
    '$Started = Get-Date',
    'Write-Host ""',
    'Write-Host "Recording... use the app now. Press Q in this window to stop."',
    'Write-Host ""',
    '',
    'while ($true) {',
    '  if ([Console]::KeyAvailable) {',
    '    $key = [Console]::ReadKey($true)',
    '    if ($key.Key -eq \'Q\') { break }',
    '  }',
    '',
    '  $requests = Invoke-Admin \'get_current_runtime_requests\'',
    '  $stats = Invoke-Admin \'runtime_statistics\'',
    '',
    '  $hasRequests = $requests -and (($requests.PSObject.Properties | Measure-Object).Count -gt 0)',
    '  if ($hasRequests -or $stats) {',
    '    $elapsed = [int](((Get-Date) - $Started).TotalMilliseconds)',
    '    $Samples.Add(@{ t = $elapsed; requests = $(if ($hasRequests) { $requests } else { @{} }); stats = $stats })',
    '  }',
    '',
    '  Start-Sleep -Milliseconds $IntervalMs',
    '}',
    '',
    '$Stopped = Get-Date',
    '$Out = @{',
    '  tool = \'{{TOOL}}\'',
    '  version = {{FORMAT_VERSION}}',
    '  intervalMs = $IntervalMs',
    '  adminPort = $Port',
    '  started = $Started.ToString(\'o\')',
    '  stopped = $Stopped.ToString(\'o\')',
    '  samples = $Samples',
    '}',
    '',
    '$FileName = "mxscout-perf-$($Started.ToString(\'yyyyMMdd-HHmmss\')).json"',
    '$Out | ConvertTo-Json -Depth 20 -Compress | Set-Content -Path $FileName -Encoding utf8',
    '',
    'Write-Host ""',
    'Write-Host "Wrote $FileName — $($Samples.Count) samples. Drop it into MxScout\'s Performance tab."'
  ].join('\n');

  function buildCollectorScript(cfg) {
    cfg = cfg || {};
    var port = cfg.adminPort || DEFAULT_ADMIN_PORT;
    var interval = cfg.intervalMs || DEFAULT_INTERVAL_MS;
    return COLLECTOR_TEMPLATE
      .replace(/\{\{ADMIN_PORT\}\}/g, String(port))
      .replace(/\{\{INTERVAL_MS\}\}/g, String(interval))
      .replace(/\{\{TOOL\}\}/g, TOOL)
      .replace(/\{\{FORMAT_VERSION\}\}/g, String(FORMAT_VERSION));
  }

  // One button, no form: sensible defaults (the admin port Mendix always
  // uses locally, a 50ms sample rate) rather than asking the user to fill in
  // fields before they can start. Nothing here is uploaded — it is a plain
  // browser download, same as any other file MxScout hands out.
  function startRecording() {
    downloadText(buildCollectorScript({}), 'mxscout-perf-collector.ps1', 'text/plain');
  }

  // ---------- bringing a finished recording in ----------
  // Called from this module's own drop zone — never from the New Project /
  // Replace Model flow. A recording always augments an ALREADY OPEN project;
  // it never creates or replaces one, so it has no business in that dialog.
  function handlePickedFile(fileName, text, projectId) {
    var result = parseRecording(text);
    if (!result.ok) { setMessage(result.error, 'error'); render(); return; }
    saveRecording(projectId, result.recording).then(function () {
      if (state.detail && state.activeId === projectId) {
        state.detail.recording = result.recording;
        selectedFor = projectId;
        selectedRequestId = null;
      }
      setMessage('Performance recording imported.', 'ok');
      render();
    }, function (err) {
      setMessage((err && err.message) || 'Could not save that recording.', 'error');
      render();
    });
  }

  // ---------- aggregation ----------
  // One row per request id seen across the whole recording — the id is the
  // admin port's own concurrency key, so this needs no work beyond grouping
  // by it. Frame shapes are read defensively throughout: the one real sample
  // seen so far (ROADMAP step 46, Phase 0) is not treated as a frozen schema.
  function frameLabel(frame) {
    if (!frame || typeof frame !== 'object') return null;
    if (typeof frame.current_activity === 'string' && frame.current_activity) return frame.current_activity;
    var qn = frameQualifiedName(frame);
    if (qn) return qn;
    if (typeof frame.xpath === 'string' && frame.xpath) return frame.xpath;
    return null;
  }

  function frameQualifiedName(frame) {
    var v = frame['Module.Flow'];
    return (typeof v === 'string' && v) ? v : null;
  }

  function entryLabel(stack) {
    for (var i = 0; i < stack.length; i++) {
      var label = frameLabel(stack[i]);
      if (label) return label;
    }
    return null;
  }

  function buildRequestRows(recording) {
    var byId = {};
    var order = [];
    (recording.samples || []).forEach(function (sample) {
      var t = typeof sample.t === 'number' ? sample.t : 0;
      var reqs = sample.requests || {};
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

  function findByQualifiedName(list, qn) {
    return (list || []).filter(function (x) { return x.qualifiedName === qn; })[0] || null;
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
      var m = /\/\/([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*)/.exec(frame.xpath);
      if (m) {
        var entity = findByQualifiedName(objectsOfSection(model, 'entities'), m[1]);
        if (entity) return { sectionKey: 'entities', item: { name: entity.name, qualifiedName: entity.qualifiedName } };
      }
    }
    return null;
  }

  // Greedy interval packing: place each request in the first lane whose last
  // bar already ends before this one starts, else open a new lane. Rows
  // arrive in the order buildRequestRows saw their ids, which is already
  // roughly chronological.
  function packLanes(rows) {
    var laneEnds = [];
    var placed = rows.map(function (row) {
      var lane = -1;
      for (var i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i] <= row.firstT) { lane = i; break; }
      }
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = row.lastT;
      return { row: row, lane: lane };
    });
    return { placed: placed, laneCount: laneEnds.length };
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

  // ---------- rendering: the timeline ----------
  // Which request is open in the detail panel below the bars. Kept per
  // project (not per recording) so switching projects — or replacing a
  // recording — never shows a detail panel for a request that no longer
  // exists in what is on screen.
  var selectedFor = null;
  var selectedRequestId = null;
  function ensureSelectionScope(projectId) {
    if (selectedFor !== projectId) { selectedFor = projectId; selectedRequestId = null; }
  }

  function renderBar(row, total) {
    var left = total > 0 ? Math.max(0, (row.firstT / total) * 100) : 0;
    var width = total > 0 ? Math.max(0.6, ((row.lastT - row.firstT) / total) * 100) : 100;
    var bar = el('button', {
      class: 'perf-bar perf-bar-' + typeClass(row.type) + (selectedRequestId === row.id ? ' is-selected' : ''),
      style: 'left:' + left.toFixed(2) + '%;width:' + width.toFixed(2) + '%',
      title: (row.entry || row.id) + ' \u2014 ' + formatMs(row.maxDuration),
      onclick: function () { selectedRequestId = row.id; render(); }
    });
    return bar;
  }

  function renderDetail(model, rows) {
    if (!selectedRequestId) {
      return el('p', { class: 'muted perf-hint', text: 'Click a bar to see what it was doing.' });
    }
    var row = rows.filter(function (r) { return r.id === selectedRequestId; })[0];
    if (!row) return null;
    var stack = row.lastStack || [];
    var frameEls = stack.length
      ? stack.map(function (frame) {
          var label = frameLabel(frame) || 'activity';
          var target = resolveFrame(model, frame);
          if (!target) return el('div', { class: 'perf-frame', text: label });
          return el('button', {
            class: 'perf-frame perf-frame-link', text: label,
            title: 'Open in the model',
            onclick: function () { jumpToObject(target.sectionKey, target.item); }
          });
        })
      : [el('p', { class: 'muted', text: 'No activity recorded for this request.' })];

    return el('div', { class: 'perf-detail' }, [
      el('div', { class: 'perf-detail-head' }, [
        el('span', { class: 'perf-detail-title', text: row.entry || row.id }),
        el('span', { class: 'muted', text: [row.type, row.user, formatMs(row.maxDuration)].filter(Boolean).join(' \u00b7 ') })
      ]),
      el('div', { class: 'perf-frames' }, frameEls)
    ]);
  }

  function renderTimeline(model, recording) {
    var rows = buildRequestRows(recording);
    if (!rows.length) {
      return el('p', { class: 'muted', text: 'This recording has no in-flight requests in it \u2014 the admin port answered, but nothing was running while it was polled.' });
    }
    var total = totalDurationMs(recording);
    var packed = packLanes(rows);
    var lanes = [];
    for (var i = 0; i < packed.laneCount; i++) lanes.push([]);
    packed.placed.forEach(function (p) { lanes[p.lane].push(p.row); });

    var laneEls = lanes.map(function (laneRows) {
      return el('div', { class: 'perf-lane' }, laneRows.map(function (row) { return renderBar(row, total); }));
    });

    return el('div', { class: 'perf-timeline' }, [
      el('div', { class: 'perf-lanes' }, laneEls),
      renderDetail(model, rows)
    ]);
  }

  function renderVerdict(recording) {
    var interval = recording.intervalMs || DEFAULT_INTERVAL_MS;
    return el('p', { class: 'perf-verdict', text:
      'Sampling profiler \u2014 it looked at what was running roughly every ' + interval + ' ms, ' +
      'not a tracer. Durations are approximate, and an action shorter than the sampling interval may not get a row here at all.' });
  }

  function recordingSummary(recording) {
    var samples = (recording.samples || []).length;
    var parts = [samples + ' sample' + (samples === 1 ? '' : 's') + ' over ' + formatMs(totalDurationMs(recording))];
    if (recording.adminPort) parts.push('admin port ' + recording.adminPort);
    return parts.join(' \u00b7 ');
  }

  // ---------- rendering: bringing a recording in ----------
  function dropZone(project) {
    var drop = el('div', { class: 'file-drop' }, [
      el('div', {}, [
        el('div', {}, [el('strong', { text: 'Drop the recording JSON here' })]),
        el('div', { class: 'muted', text: 'Or click to choose the file it wrote \u2014 nothing here is uploaded.' })
      ])
    ]);
    function onFile(file) {
      readFileText(file, function (fileName, text) { handlePickedFile(fileName, text, project.id); });
    }
    drop.addEventListener('click', function () { pickModelFile(onFile, '.json,application/json'); });
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('dragover'); });
    drop.addEventListener('drop', function (e) {
      e.preventDefault();
      drop.classList.remove('dragover');
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) onFile(file);
    });
    return drop;
  }

  function renderEmptyState(project) {
    return el('div', { class: 'card' }, [
      el('h3', { class: 'live-h', text: 'Performance recording' }),
      el('p', { class: 'muted', text: 'MxScout\u2019s server makes no outbound connections, and this browser tab cannot reach the app\u2019s admin port either \u2014 so this is a script YOU run. It finds the app\u2019s admin password itself, records while you use the app, and writes a file you drop back here.' }),
      el('div', { class: 'scan-copy-row' }, [
        el('button', { class: 'btn btn-primary', text: 'Start recording', onclick: startRecording })
      ]),
      el('ol', { class: 'scan-steps' }, [
        el('li', { text: 'Click \u201cStart recording\u201d \u2014 a PowerShell script downloads.' }),
        el('li', { text: 'Run it on the machine hosting your Mendix app, as the user running the app (or an administrator).' }),
        el('li', { text: 'Use the app: click around, run the flows you want measured.' }),
        el('li', { text: 'Press Q in that window to stop \u2014 it writes a JSON file next to itself.' }),
        el('li', { text: 'Drop that file below.' })
      ]),
      dropZone(project)
    ]);
  }

  function renderPanel(model, project) {
    ensureSelectionScope(project.id);
    var recording = state.detail.recording;
    if (!recording) return renderEmptyState(project);

    return el('div', {}, [
      el('div', { class: 'card' }, [
        el('div', { class: 'scan-head-row' }, [
          el('h3', { class: 'live-h', text: 'Performance recording' }),
          el('button', {
            class: 'btn btn-sm', text: 'New recording\u2026',
            onclick: function () { state.detail.recording = null; selectedRequestId = null; render(); }
          })
        ]),
        el('p', { class: 'muted', text: recordingSummary(recording) }),
        renderVerdict(recording)
      ]),
      el('div', { class: 'card perf-timeline-card' }, [renderTimeline(model, recording)])
    ]);
  }

  window.MxPerf = {
    init: init,
    looksLikeRecording: looksLikeRecording,
    parseRecording: parseRecording,
    loadRecording: loadRecording,
    saveRecording: saveRecording,
    buildCollectorScript: buildCollectorScript,
    handlePickedFile: handlePickedFile,
    resolveFrame: resolveFrame,
    buildRequestRows: buildRequestRows,
    renderPanel: renderPanel
  };
})();
