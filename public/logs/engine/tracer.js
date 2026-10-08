/* MxScout — Log analysis module.
 *
 * Microflow Tracer: rebuilds microflow executions, call trees, N+1 patterns and background-run statistics from MicroflowEngine records.
 *
 * Derived from MxDevSwissTool by Mikołaj (RealMecowhy),
 * https://github.com/RealMecowhy/MxDevSwissTool — MIT License, Copyright (c) 2026 Mikołaj.
 * Source: public/js/tools/microflow-tracer.js (extraction, N+1 detector, background view; the lists and detail pane are rebuilt in public/logs/ui/)
 * The logic is carried over unchanged, so MxScout reads every log the way the original does;
 * only the packaging differs (no DOM, no network, no build step).
 * The licence text is in THIRD-PARTY-NOTICES.md at the root of this repository.
 */
(function (root) {
'use strict';
// The original reads these through `window`; `root` is the page on the main thread and the
// worker/Node global elsewhere, so the same code runs in all three.
const window = root;

// DEBUG: [corrId] Starting|Finished execution of microflow 'Module.Name'
const MFT_EXEC_RE = /^\[([^\]\s]+)\]\s+(Starting|Finished) execution of microflow '([^']+)'\s*$/;
// TRACE: [corrId] Executing activity: {"current_activity":{...},"name":"Module.Name",...}
const MFT_ACT_RE = /^\[([^\]\s]+)\]\s+Executing activity:\s*(\{[\s\S]*)$/;

// `Module.Flow.nested.<guid>` is how the engine names anonymous nested flows
function mftDisplayName(name) {
  const i = name.indexOf('.nested.');
  return i === -1 ? name : name.substring(0, i) + ' (nested)';
}

// Pure extraction over shared-parser records — no DOM, testable in Node.
// Executions nest via a per-correlation-ID stack: Starting pushes, Finished pops.
// Activities attach to the innermost open execution of their correlation ID; a
// step's duration is the delta to the next engine event on the same corrId.
function mftExtractExecutions(records) {
  const executions = [];
  const stacks = new Map();      // corrId -> array of open executions (call stack)
  const pendingStep = new Map(); // corrId -> last activity awaiting its duration
  let orphanFinished = 0;
  let activityRecords = 0;
  const corrIds = new Set();

  for (let ri = 0; ri < records.length; ri++) {
    const rec = records[ri];
    if (rec.logNode !== 'MicroflowEngine') continue;
    const msg = rec.message;

    let m = msg.match(MFT_EXEC_RE);
    if (m) {
      const corrId = m[1];
      const name = m[3];
      const ms = mtTsToMs(rec.timestamp);
      corrIds.add(corrId);
      let stack = stacks.get(corrId);
      if (!stack) { stack = []; stacks.set(corrId, stack); }

      // Any activity still open on this corrId ends at this boundary
      const pend = pendingStep.get(corrId);
      if (pend && !isNaN(ms) && !isNaN(pend.ms)) { pend.durationMs = ms - pend.ms; }
      pendingStep.delete(corrId);

      if (m[2] === 'Starting') {
        const exec = {
          id: executions.length,
          corrId: corrId,
          name: name,
          displayName: mftDisplayName(name),
          startTs: rec.timestamp,
          startMs: ms,
          endTs: null,
          durationMs: null,
          finished: false,
          steps: [],
          children: [],
          parentId: stack.length ? stack[stack.length - 1].id : null,
          depth: stack.length,
          recursive: stack.some(e => e.name === name),
          _idx: ri
        };
        if (stack.length) stack[stack.length - 1].children.push(exec);
        executions.push(exec);
        stack.push(exec);
      } else {
        // Finished — normally matches the top of the stack; on a name mismatch
        // (log window cut mid-execution) unwind to the matching frame, marking
        // everything above it as unfinished.
        let found = -1;
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].name === name) { found = i; break; }
        }
        if (found === -1) { orphanFinished++; continue; }
        stack.splice(found + 1);
        const exec = stack.pop();
        exec.endTs = rec.timestamp;
        exec.finished = true;
        if (!isNaN(ms) && !isNaN(exec.startMs)) exec.durationMs = ms - exec.startMs;
      }
      continue;
    }

    m = msg.match(MFT_ACT_RE);
    if (m) {
      const corrId = m[1];
      const ms = mtTsToMs(rec.timestamp);
      corrIds.add(corrId);
      activityRecords++;

      const pend = pendingStep.get(corrId);
      if (pend && !isNaN(ms) && !isNaN(pend.ms)) { pend.durationMs = ms - pend.ms; }

      const stack = stacks.get(corrId);
      if (!stack || stack.length === 0) { pendingStep.delete(corrId); continue; } // TRACE without DEBUG context

      let type = '?';
      let caption = '';
      try {
        const j = JSON.parse(m[2]);
        if (j.current_activity) {
          type = j.current_activity.type || '?';
          caption = j.current_activity.caption || '';
        }
      } catch (e) { /* truncated JSON — keep placeholders */ }

      const step = { ts: rec.timestamp, ms: ms, type: type, caption: caption, durationMs: null };
      stack[stack.length - 1].steps.push(step);
      pendingStep.set(corrId, step);
    }
  }

  // Aggregate per microflow (nested variants collapse into their parent flow name)
  const flowMap = new Map();
  for (const e of executions) {
    const key = e.displayName;
    let f = flowMap.get(key);
    if (!f) {
      f = { name: key, count: 0, finishedCount: 0, totalMs: 0, maxMs: -1, maxExecId: null, steps: 0, recursions: 0, unfinished: 0 };
      flowMap.set(key, f);
    }
    f.count++;
    f.steps += e.steps.length;
    if (e.recursive) f.recursions++;
    if (e.finished && e.durationMs !== null && !isNaN(e.durationMs)) {
      f.finishedCount++;
      f.totalMs += e.durationMs;
      if (e.durationMs > f.maxMs) { f.maxMs = e.durationMs; f.maxExecId = e.id; }
    } else if (!e.finished) {
      f.unfinished++;
    }
  }
  const flows = Array.from(flowMap.values());
  flows.sort((a, b) => b.totalMs - a.totalMs);

  return {
    executions: executions,
    flows: flows,
    stats: { orphanFinished: orphanFinished, activityRecords: activityRecords, corrIds: corrIds.size }
  };
}

// ── N+1 detector ─────────────────────────────────────────────────────────────
// Scans executions for the classic Mendix N+1 anti-pattern: a database retrieve
// firing N times because it sits inside a list iteration (`ListLoop`) instead of
// one batch retrieve before the loop.
//
// Two shapes occur in real Mendix TRACE logs, and both must be caught:
//
//   A. Retrieve directly in the loop body — the repeated retrieves are steps of
//      the SAME execution, separated by the `ListLoop` marker.
//   B. Loop body calls a sub-microflow that retrieves — by far the most common
//      shape. Each iteration's sub-microflow is a SEPARATE child execution (same
//      correlation id) holding one retrieve, so the repetition is only visible
//      when you look at the loop owner's whole subtree, not its own steps.
//
// Detection — for every execution:
//
// 1. **Loop-aware subtree pass**: if this microflow contains a loop step, tally
//    DB retrieves by (type, caption) across its own steps AND every descendant
//    execution (covers shape B). ≥ threshold repetitions of the same retrieve → N+1.
//
// 2. **Consecutive-run pass** over this execution's own steps (covers shape A even
//    when the loop iterator is logged below TRACE). Loop markers don't break a run.
//
// Results are de-duplicated (same type+caption kept at the higher count) and
// attributed to the loop-owning execution. Threshold: MFT_N1_THRESHOLD (default 3).
//
// NB: real Mendix logs emit `ListLoop` (not `LoopedActivity`); both are accepted.

const MFT_N1_THRESHOLD = 3;
// The canonical N+1 is a per-row database retrieve. Aggregate-in-loop is a weaker,
// noisier signal (and often unavoidable), so it is deliberately excluded here.
const MFT_N1_DB_TYPES = new Set(['RetrieveByXPath', 'RetrieveByAssociation']);
const MFT_LOOP_TYPES = new Set(['ListLoop', 'LoopedActivity']);

// Tally DB retrieves by (type, caption) across an execution's own steps plus all
// descendant executions (recursively). Mutates `tally` (Map key "type\tcaption").
function mftTallyRetrievesDeep(exec, tally) {
  for (const s of exec.steps) {
    if (MFT_N1_DB_TYPES.has(s.type)) {
      const key = s.type + '\t' + s.caption;
      let t = tally.get(key);
      if (!t) { t = { type: s.type, caption: s.caption, count: 0, totalMs: 0 }; tally.set(key, t); }
      t.count++;
      if (s.durationMs !== null && !isNaN(s.durationMs)) t.totalMs += s.durationMs;
    }
  }
  for (const child of exec.children) mftTallyRetrievesDeep(child, tally);
}

function mftDetectNPlusOne(executions) {
  let totalDetections = 0;
  for (const exec of executions) {
    exec.nPlusOne = [];

    const found = new Map(); // key "type\tcaption" → {type, caption, count, totalMs}
    const addHit = function(hit) {
      const key = hit.type + '\t' + hit.caption;
      const prev = found.get(key);
      if (!prev || hit.count > prev.count) {
        found.set(key, { type: hit.type, caption: hit.caption, count: hit.count, totalMs: hit.totalMs });
      }
    };

    // Pass 1: loop-aware subtree tally (shape B — retrieve in a called sub-microflow)
    const hasLoop = exec.steps.some(function(s) { return MFT_LOOP_TYPES.has(s.type); });
    if (hasLoop) {
      const tally = new Map();
      mftTallyRetrievesDeep(exec, tally);
      for (const t of tally.values()) {
        if (t.count >= MFT_N1_THRESHOLD) addHit(t);
      }
    }

    // Pass 2: consecutive-run within this execution's own steps (shape A).
    // Loop markers sit between iterations and must not break the run.
    let runType = null, runCaption = null, runCount = 0, runMs = 0;
    const flushRun = function() {
      if (runCount >= MFT_N1_THRESHOLD && runType) {
        addHit({ type: runType, caption: runCaption, count: runCount, totalMs: runMs });
      }
      runCount = 0; runMs = 0;
    };
    for (const s of exec.steps) {
      if (MFT_N1_DB_TYPES.has(s.type)) {
        if (s.type === runType && s.caption === runCaption) {
          runCount++;
          if (s.durationMs !== null && !isNaN(s.durationMs)) runMs += s.durationMs;
        } else {
          flushRun();
          runType = s.type; runCaption = s.caption; runCount = 1;
          runMs = (s.durationMs !== null && !isNaN(s.durationMs)) ? s.durationMs : 0;
        }
      } else if (MFT_LOOP_TYPES.has(s.type)) {
        continue; // loop marker doesn't break a run
      } else {
        flushRun();
        runType = null; runCaption = null;
      }
    }
    flushRun();

    exec.nPlusOne = Array.from(found.values());
    exec.nPlusOne.sort(function(a, b) { return b.count - a.count; }); // worst offender first
    totalDetections += exec.nPlusOne.length;
  }
  return totalDetections;
}

// ── Scheduled events & background work ───────────────────────────────────────
// The runtime keys its correlation IDs by origin: an HTTP request gets a numeric
// counter (`1784268324436-46`), while anything the runtime starts itself — a
// scheduled event, a task-queue worker, an after-startup flow — gets a UUID.
// That is the only marker in the log; there is no "scheduled event" label on the
// MicroflowEngine lines themselves (confirmed on a 69 MB production log where
// General.Clean_ScheduledEventLog runs under a UUID at 03:00 sharp).
//
// A "run" is a depth-0 execution on a background correlation ID; sub-microflows
// belong to their run, not next to it.

const MFT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Below this many timed runs a duration trend is noise, not a trend.
const MFT_TREND_MIN_RUNS = 4;
// Median has to move by more than this for the trend to be called at all.
const MFT_TREND_PCT = 20;
// Log nodes that carry background failures when MicroflowEngine is silent.
const MFT_BG_NODE_RE = /taskqueue|scheduler|scheduledevent|background|queue/i;
const MFT_BG_MSG_RE = /scheduled event/i;
const MFT_BG_ERROR_LEVELS = { ERROR: 1, CRITICAL: 1, FATAL: 1 };

function mftIsBackgroundCorrId(corrId) {
  return MFT_UUID_RE.test(String(corrId || ''));
}

function mftMedian(sortedNumbers) {
  const n = sortedNumbers.length;
  if (!n) return null;
  const mid = n >> 1;
  return n % 2 ? sortedNumbers[mid] : (sortedNumbers[mid - 1] + sortedNumbers[mid]) / 2;
}

// Duration trend across a run series: median of the first half vs the second.
// Halves (not first-vs-last run) so one cold start or one outlier cannot flip it.
function mftRunTrend(runsInOrder) {
  const timed = runsInOrder.filter(r => r.durationMs !== null && !isNaN(r.durationMs));
  if (timed.length < MFT_TREND_MIN_RUNS) return null;
  const half = Math.floor(timed.length / 2);
  const a = timed.slice(0, half).map(r => r.durationMs).sort((x, y) => x - y);
  const b = timed.slice(timed.length - half).map(r => r.durationMs).sort((x, y) => x - y);
  const m1 = mftMedian(a), m2 = mftMedian(b);
  if (m1 === null || m2 === null || m1 <= 0) return null;
  const pct = ((m2 - m1) / m1) * 100;
  return {
    firstHalfMs: m1,
    secondHalfMs: m2,
    pct: pct,
    dir: pct > MFT_TREND_PCT ? 'up' : (pct < -MFT_TREND_PCT ? 'down' : 'flat')
  };
}

// Background failures for logs that carry no MicroflowEngine records — the common
// case, since INFO+ is what production runs at. Grouped per log node; the full
// task × queue breakdown lives in Log Viewer → Insights and is not repeated here.
function mftExtractBackgroundErrors(records) {
  const byNode = new Map();
  for (const rec of (records || [])) {
    const level = String(rec.level || '').toUpperCase();
    if (!MFT_BG_ERROR_LEVELS[level]) continue;
    const node = rec.logNode || rec.node || '';
    if (!MFT_BG_NODE_RE.test(node) && !MFT_BG_MSG_RE.test(rec.message || '')) continue;
    let g = byNode.get(node);
    if (!g) { g = { node: node, count: 0, firstTs: rec.timestamp, lastTs: rec.timestamp, sample: (rec.message || '').split('\n')[0] }; byNode.set(node, g); }
    g.count++;
    g.lastTs = rec.timestamp;
  }
  return Array.from(byNode.values()).sort((a, b) => b.count - a.count);
}

// Pure aggregation for the Background view. `records` is optional — without it the
// view still works off executions, it just cannot show the no-engine-data fallback.
function mftBuildBackgroundView(executions, records) {
  const byName = new Map();
  let requestRuns = 0;

  for (const e of (executions || [])) {
    if (e.depth !== 0) continue;
    if (!mftIsBackgroundCorrId(e.corrId)) { requestRuns++; continue; }
    let ev = byName.get(e.displayName);
    if (!ev) {
      ev = { name: e.displayName, runs: [], count: 0, unfinished: 0, execIds: [] };
      byName.set(e.displayName, ev);
    }
    ev.count++;
    ev.execIds.push(e.id);
    if (!e.finished) ev.unfinished++;
    ev.runs.push({
      execId: e.id, corrId: e.corrId, startTs: e.startTs, startMs: e.startMs,
      endMs: (e.finished && !isNaN(e.startMs) && e.durationMs !== null && !isNaN(e.durationMs)) ? e.startMs + e.durationMs : null,
      durationMs: (e.durationMs !== null && !isNaN(e.durationMs)) ? e.durationMs : null,
      finished: e.finished
    });
  }

  const events = [];
  let overlapCount = 0, unfinished = 0, runTotal = 0;

  for (const ev of byName.values()) {
    ev.runs.sort((a, b) => (a.startMs || 0) - (b.startMs || 0));
    const durations = ev.runs.map(r => r.durationMs).filter(d => d !== null).sort((a, b) => a - b);

    // Start-to-start intervals: a scheduled event every 5 minutes shows up here as
    // a stable median, which is what makes a missed or drifting run visible.
    const intervals = [];
    for (let i = 1; i < ev.runs.length; i++) {
      const d = ev.runs[i].startMs - ev.runs[i - 1].startMs;
      if (!isNaN(d) && d >= 0) intervals.push(d);
    }
    intervals.sort((a, b) => a - b);

    // Overlap sweep: a run that starts while an earlier run of the same event is
    // still open. For a scheduled event that means the previous run overran its
    // interval; for a task-queue worker it is ordinary parallelism, so the finding
    // is reported neutrally and left for the user to judge.
    const overlaps = [];
    let openUntil = -Infinity, openRun = null;
    for (const r of ev.runs) {
      if (!isNaN(r.startMs) && r.startMs < openUntil && openRun) {
        overlaps.push({ startTs: r.startTs, withStartTs: openRun.startTs, overlapMs: openUntil - r.startMs });
      }
      if (r.endMs !== null && r.endMs > openUntil) { openUntil = r.endMs; openRun = r; }
    }

    const first = ev.runs[0], last = ev.runs[ev.runs.length - 1];
    events.push({
      name: ev.name,
      runs: ev.count,
      unfinished: ev.unfinished,
      execIds: ev.execIds,
      minMs: durations.length ? durations[0] : null,
      medianMs: mftMedian(durations),
      maxMs: durations.length ? durations[durations.length - 1] : null,
      totalMs: durations.reduce((s, d) => s + d, 0),
      firstTs: first ? first.startTs : null,
      lastTs: last ? last.startTs : null,
      medianIntervalMs: mftMedian(intervals),
      trend: mftRunTrend(ev.runs),
      overlaps: overlaps,
      overlapCount: overlaps.length
    });
    overlapCount += overlaps.length;
    unfinished += ev.unfinished;
    runTotal += ev.count;
  }

  events.sort((a, b) => b.runs - a.runs || (b.totalMs - a.totalMs));

  return {
    events: events,
    runs: runTotal,
    requestRuns: requestRuns,
    unfinished: unfinished,
    overlapCount: overlapCount,
    hasEngineData: !!(executions && executions.length),
    errors: mftExtractBackgroundErrors(records)
  };
}


function mftFmtMs(ms) {
  if (ms === null || isNaN(ms)) return '-';
  if (ms >= 10000) return (ms / 1000).toFixed(1) + ' s';
  if (ms >= 100) return Math.round(ms) + ' ms';
  return ms.toFixed(2) + ' ms';
}


// Schedules read better in their own unit than in milliseconds: an event every
// five minutes should say "5m", not "300054 ms".
function mftFmtInterval(ms) {
  if (ms === null || isNaN(ms)) return '–';
  // One decimal below 10 units, but not a bare ".0" — a five-minute schedule
  // should read "5m", while a drifting one still shows "5.4m".
  const fmt = (v, unit) => (v < 10 ? String(+v.toFixed(1)) : String(Math.round(v))) + unit;
  const s = ms / 1000;
  if (s < 90) return fmt(s, 's');
  const m = s / 60;
  return m < 90 ? fmt(m, 'm') : fmt(m / 60, 'h');
}


  root.MFT_EXEC_RE = MFT_EXEC_RE;
  root.MFT_ACT_RE = MFT_ACT_RE;
  root.mftDisplayName = mftDisplayName;
  root.mftExtractExecutions = mftExtractExecutions;
  root.MFT_N1_THRESHOLD = MFT_N1_THRESHOLD;
  root.mftDetectNPlusOne = mftDetectNPlusOne;
  root.mftIsBackgroundCorrId = mftIsBackgroundCorrId;
  root.mftMedian = mftMedian;
  root.mftRunTrend = mftRunTrend;
  root.mftExtractBackgroundErrors = mftExtractBackgroundErrors;
  root.mftBuildBackgroundView = mftBuildBackgroundView;
  root.mftFmtMs = mftFmtMs;
  root.mftFmtInterval = mftFmtInterval;
})(typeof window !== 'undefined' ? window : self);
