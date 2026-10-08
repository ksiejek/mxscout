/* MxScout — Log analysis module.
 *
 * Data Hub: describes the one loaded file and which tools can still take it.
 *
 * Derived from MxDevSwissTool by Mikołaj (RealMecowhy),
 * https://github.com/RealMecowhy/MxDevSwissTool — MIT License, Copyright (c) 2026 Mikołaj.
 * Source: public/js/components/data-hub.js (the pure builders mtHubSummary / mtHubTargets; the bar itself is rebuilt in public/logs/ui/)
 * The logic is carried over unchanged, so MxScout reads every log the way the original does;
 * only the packaging differs (no DOM, no network, no build step).
 * The licence text is in THIRD-PARTY-NOTICES.md at the root of this repository.
 */
(function (root) {
  'use strict';

  // Tools that can consume a raw Mendix log, in sidebar order. `fn` is the
  // global entry point each one already exposes for cross-tool hand-off.
  // `hasData` is an optional global predicate ("does this tool currently show
  // something?") used to warn before a hand-off silently replaces it.
  var HUB_TARGETS = [
    // undo: the tool offers its own Undo after a replace, so it is not asked first.
    { id: 'log-viewer',          label: 'Log Viewer',           fn: 'logLoadText', hasData: 'logHasData', undo: true },
    { id: 'log-query-extractor', label: 'Query Extractor',      fn: 'lqeLoadText', hasData: 'lqeHasData' },
    { id: 'microflow-tracer',    label: 'Microflow Tracer',     fn: 'mftLoadText', hasData: 'mftHasData' },
    { id: 'ws-rest-extractor',   label: 'REST & WS Extractor',  fn: 'wsreLoadText', hasData: 'wsreHasData' }
  ];

  var FORMAT_LABELS = {
    csv:  'Studio Pro CSV export',
    live: 'Mendix Cloud live log',
    'grafana-txt':  'Grafana export (TXT)',
    'grafana-json': 'Grafana export (JSON)',
    'grafana-csv':  'Grafana export (CSV)'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatBytes(n) {
    if (typeof n !== 'number' || !isFinite(n) || n < 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function formatCount(n) {
    if (typeof n !== 'number' || !isFinite(n) || n < 0) return '';
    return n.toLocaleString('en-US');
  }

  // Describes the active source for the bar. Returns null when there is nothing
  // to describe — callers render nothing rather than an empty shell.
  function mtHubSummary(source) {
    if (!source || !source.name) return null;
    var sizeText = formatBytes(source.size);
    var recordsText = typeof source.records === 'number' && source.records >= 0
      ? formatCount(source.records) + ' record' + (source.records === 1 ? '' : 's')
      : '';
    var formatText = FORMAT_LABELS[source.format] || '';
    // A batch of files (Log Viewer accepts several) is reported honestly: the
    // Hub carries one file, so the others are named as staying where they are.
    var siblings = typeof source.siblings === 'number' && source.siblings > 0
      ? source.siblings : 0;
    var parts = [source.name];
    if (sizeText) parts.push(sizeText);
    if (recordsText) parts.push(recordsText);
    if (formatText) parts.push(formatText);
    return {
      name: source.name,
      sizeText: sizeText,
      recordsText: recordsText,
      formatText: formatText,
      siblings: siblings,
      line: 'Loaded: ' + parts.join(' · ')
    };
  }

  // Which tools this source can still be pushed into. The tool that parsed it —
  // and any tool it was already pushed into — is reported as `loaded`, so the
  // bar can show "✓ here" instead of offering a pointless round trip.
  function mtHubTargets(source, currentToolId) {
    if (!source || !source.name) return [];
    var loadedIn = source.loadedIn || [];
    return HUB_TARGETS.map(function (t) {
      return {
        id: t.id,
        label: t.label,
        fn: t.fn,
        current: t.id === currentToolId,
        loaded: loadedIn.indexOf(t.id) !== -1
      };
    });
  }

  root.mtHubSummary = mtHubSummary;
  root.mtHubTargets = mtHubTargets;
  root.mtHubFormatBytes = formatBytes;

})(typeof window !== 'undefined' ? window : self);
