/* Log analysis — the module brought over from MxDevSwissTool (see THIRD-PARTY-NOTICES.md).
 *
 * Two layers. The ENGINE is the original's code, so it is checked with the original's own assertions
 * (test/logs/engine-parity.js, plain Node): if one fails, MxScout no longer reads a log the way the original
 * does. The SCREEN is MxScout's own, so it is driven in a real browser: one log loaded once, handed to the
 * other tools, nothing leaving the tab, nothing thrown. */
'use strict';
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

module.exports = async function (t) {
  // ---- the engine, against the original's assertions ----
  const parity = spawnSync(process.execPath, [path.join(__dirname, 'logs', 'engine-parity.js')], { encoding: 'utf8' });
  const summary = /(\d+) passed, (\d+) failed/.exec(parity.stdout || '') || [];
  t.ok(parity.status === 0 && summary[2] === '0' && Number(summary[1]) > 800,
    'the log engine passes the original\'s assertions: ' + (summary[0] || (parity.stdout + parity.stderr).slice(-300)));

  // ---- the credit is where a reader of the repository looks for it ----
  const root = path.join(__dirname, '..');
  const notices = fs.readFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), 'utf8');
  t.ok(/MxDevSwissTool/.test(notices) && /Permission is hereby granted, free of charge/.test(notices) && /RealMecowhy/.test(notices),
    'THIRD-PARTY-NOTICES.md names the original, its author, and carries the MIT licence text');
  t.ok(/MxDevSwissTool/.test(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')), 'the changelog credits it');
  const engineFiles = fs.readdirSync(path.join(root, 'public', 'logs', 'engine'));
  const uncredited = engineFiles.filter((f) => !/RealMecowhy/.test(fs.readFileSync(path.join(root, 'public', 'logs', 'engine', f), 'utf8').slice(0, 1500)));
  t.ok(uncredited.length === 0, 'every ported engine file carries the attribution header: ' + JSON.stringify(uncredited));

  // ---- the screen ----
  const sample = require('./logs/sample-log.js');
  const mx = await t.tab(t.MX);
  await mx.waitFor('!!window.MxLogs', 15000, 'MxScout loaded');
  await mx.evaluate(`window.__errs = []; window.addEventListener('error', function (e) { window.__errs.push(e.message); });
    window.addEventListener('unhandledrejection', function (e) { window.__errs.push(String(e.reason && e.reason.message || e.reason)); });
    window.__requests = [];
    var rf = window.fetch; window.fetch = function (i) { window.__requests.push(String(typeof i === 'string' ? i : i.url)); return rf.apply(this, arguments); };`);
  const click = (re) => mx.evaluate(`Array.from(document.querySelectorAll('button')).find(b => ${re}.test(b.textContent)).click()`);
  const tab = (re) => mx.evaluate(`Array.from(document.querySelectorAll('.lg-tab')).find(b => ${re}.test(b.textContent)).click()`);
  const count = (sel) => mx.evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`);

  await click(/^Log analysis$/);
  await mx.waitFor(`!!document.querySelector('.lg')`, 8000, 'log analysis screen');
  const tabs = await mx.evaluate(`Array.from(document.querySelectorAll('.lg-tabs-main .lg-tab')).map(b => b.textContent)`);
  t.ok(tabs.length === 8 && tabs[0] === 'Log Viewer' && tabs.indexOf('Incident Report') === 7, 'all eight tools are there: ' + tabs.join(' | '));
  t.ok(/MxDevSwissTool/.test(await mx.evaluate(`document.querySelector('.lg-credit').textContent`)), 'the screen says where it comes from');
  t.ok(await mx.evaluate(`!document.querySelector('.lg-hub') || document.querySelector('.lg-hub').hidden`), 'nothing loaded, so no data bar');

  await mx.evaluate(`MxLogs.tools['log-viewer'].loadFiles([new File([${JSON.stringify(sample)}], 'sample.log')])`);
  await mx.waitFor(`document.querySelectorAll('.lg-row').length > 5`, 10000, 'rows');
  t.ok(/40 records/.test(await mx.evaluate(`document.querySelector('.lg-hub').textContent`)), 'the data bar says what is loaded');

  await tab(/^Insights/);
  t.ok(await count('.lg-insights-card') >= 5, 'insights found the patterns in the sample');
  await tab(/Levels Matrix/);
  t.ok(await count('.lg-matrix tbody tr') > 3, 'the levels matrix has rows');
  await tab(/Sequence Diagram/);
  await click(/Generate from current filter/);
  t.ok(await count('.lg-seq-row') > 5, 'the sequence diagram draws');
  await tab(/Gantt Chart/);
  await click(/Generate timeline/);
  t.ok(await count('.lg-gantt-row') > 5, 'the Gantt chart draws');
  await tab(/Log Stream/);
  await mx.evaluate(`document.querySelector('.lg-lvlchip-error').click()`);
  t.ok(await count('.lg-row') > 0 && await count('.lg-row') < 40, 'filtering to errors narrows the stream');
  await click(/Aggregate errors/);
  await mx.waitFor(`document.querySelectorAll('.lg-sig-card').length > 0`, 4000, 'signatures');
  t.ok(await count('.lg-sig-card') >= 3, 'errors are grouped by signature');
  await mx.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);

  // The same file, handed to the other tools without reading it again.
  for (const [id, probe] of [['log-query-extractor', /Queries: 2/], ['microflow-tracer', /Executions: 1/], ['ws-rest-extractor', /Calls: 1/]]) {
    await mx.evaluate(`MxLogs.hub.openIn(${JSON.stringify(id)})`);
    await new Promise((r) => setTimeout(r, 900));
    const text = await mx.evaluate(`document.querySelector('.lg-toolhost[data-tool="${id}"]').textContent`);
    t.ok(probe.test(text), id + ' read the shared file: ' + probe);
  }

  await mx.evaluate(`MxLogs.goto('error-decoder')`);
  await mx.evaluate(`MxLogs.tools['error-decoder'].decodeText('org.postgresql.util.PSQLException: ERROR: duplicate key value violates unique constraint "a_pkey"')`);
  await new Promise((r) => setTimeout(r, 400));
  t.ok(/Unique constraint violation/.test(await mx.evaluate(`document.querySelector('.lg-toolhost[data-tool="error-decoder"]').textContent`)), 'the decoder explains a duplicate-key error');

  await mx.evaluate(`MxLogs.goto('log-anonymizer')`);
  await mx.evaluate(`MxLogs.tools['log-anonymizer'].setInput('mail bob@example.com from 10.1.2.3')`);
  await new Promise((r) => setTimeout(r, 600));
  await click(/^Anonymize$/);
  await new Promise((r) => setTimeout(r, 600));
  t.ok(await mx.evaluate(`Array.from(document.querySelectorAll('.lg-toolhost[data-tool="log-anonymizer"] textarea, .lg-toolhost[data-tool="log-anonymizer"] pre, .lg-toolhost[data-tool="log-anonymizer"] .lg-tv-line')).some(e => /\\[EMAIL/.test(e.value || e.textContent))`),
    'the anonymizer masks an address in its output');

  await mx.evaluate(`MxLogs.goto('incident-report')`);
  await new Promise((r) => setTimeout(r, 400));
  t.ok(/4 sources with data ready/.test(await mx.evaluate(`document.querySelector('.lg-toolhost[data-tool="incident-report"]').textContent`)), 'the incident report sees what the tools hold');

  // Leaving and coming back keeps the work.
  await click(/Getting started/);
  await click(/^Log analysis$/);
  await mx.waitFor(`!!document.querySelector('.lg-hub') && !document.querySelector('.lg-hub').hidden`, 4000, 'state kept');
  t.ok(true, 'the screen keeps its state while the rest of the app redraws');

  const errs = await mx.evaluate('window.__errs');
  t.ok(errs.length === 0, 'nothing was thrown: ' + JSON.stringify(errs));
  const reqs = await mx.evaluate('window.__requests');
  t.ok(reqs.every((r) => r.startsWith('/') || r.startsWith(t.MX)), 'and nothing was requested beyond this server: ' + JSON.stringify(reqs));
  await mx.close();
};
