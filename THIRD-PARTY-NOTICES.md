# Third-party notices

MxScout is licensed under GPL-3.0-or-later (see `LICENSE`). It has **no npm
dependencies**. It does, however, contain one body of code that was written by
someone else and is used here under its own licence: the log analysis.

## MxDevSwissTool — log analysis

- **What it is:** MxDevSwissTool, a browser toolbox for Mendix developers.
- **Author:** Mikołaj (GitHub: [RealMecowhy](https://github.com/RealMecowhy))
- **Source:** <https://github.com/RealMecowhy/MxDevSwissTool>
- **Licence:** MIT, Copyright (c) 2026 Mikołaj — the full text is below, as the
  licence requires.
- **Compatibility:** the MIT licence is compatible with this project's
  GPL-3.0-or-later. The ported files keep their MIT notice; MxScout's own
  additions to them are under MxScout's licence.

The log analysis section of MxScout (**Log analysis** in the sidebar) is that
colleague's work, brought into MxScout as a module
and given MxScout's own interface. The analysis itself — every parser, rule,
heuristic and aggregation — is theirs and was carried over unchanged, so
MxScout reads a log the same way the original does.

Since 2026-10-09 MxScout carries only part of it: the Log Viewer — the stream,
Insights and the slow queries the runtime reports. The other tools that were
brought over at first (Query Extractor, Microflow Tracer, REST & WS Extractor,
Error Decoder screen, Nginx analyzer, Anonymizer, Incident Report and the Data
Hub that linked them) were taken out again; they are listed under "What was
deliberately left out" below. The Error Decoder's rules stay, because Insights
groups errors by them.

### What was carried over

| MxScout file | comes from (MxDevSwissTool `public/js/…`) | notes |
| --- | --- | --- |
| `public/logs/engine/parser.js` | `tools/mendix-log-parser.js` | verbatim — Studio Pro CSV, Mendix Cloud live logs, on-premises logs, Grafana exports |
| `public/logs/engine/sql.js` | `tools/sql-engine.js`, `tools/sql.js`, `tools/format-view.js` | SQL/OQL tokenizer and prettifier; the highlighter returns tokens instead of an HTML string |
| `public/logs/engine/insights.js` | `tools/log-viewer.js` | the pure functions: insights (slow queries among them), levels matrix, correlation, signatures, timing — the file is carried whole, though the screen no longer shows the matrix or the correlation view |
| `public/logs/engine/decoder.js` | `tools/error-decoder.js` | Error Decoder rules — read by Insights' error-mechanism card; the decoder's own screen is not carried |
| `public/logs/parse-worker.js` | the same tool's worker code | a thin same-origin worker that loads the parser |
| `test/logs/engine-parity.js` | `scripts/parser-test.js` | the original's assertions for the files above, pointed at the ported files — they are what says the port has not drifted |

### What is MxScout's own

- All of `public/logs/ui/` and `public/logs/logs.css`: the screen, tabs, lists,
  charts and dialogs, and the Slow queries tab, are written fresh in MxScout's
  interface, built with the DOM helpers (no markup strings, in line with the
  rule described on the About page).
- The integration in `public/app.js` (the Logs section of a project, and the link from a log line to the model object it names), `public/comments.js` (a comment started with a draft), `public/index.html`, `public/palette.js`.
- `test/44-logs.test.js`, `test/45-logs-project.test.js` and the fixture.

### What was deliberately left out

- Anything that contacts the network: MxScout sends nothing anywhere.
- The other log tools, carried over at first and taken out on 2026-10-09 to keep
  the section to the stream, Insights and the slow queries: the Query Extractor
  (`tools/log-query-extractor.js`), Microflow Tracer (`tools/microflow-tracer.js`),
  REST & WS Extractor (`tools/ws-rest-extractor.js`), the Error Decoder's screen,
  Nginx analyzer and Timeline Correlator (`tools/nginx.js`, `tools/nginx-correlator.js`),
  Anonymizer (`tools/log-anonymizer.js`), the export builders and Incident Report
  (`components/exporters.js`) and the Data Hub (`components/data-hub.js`). Their
  ports are in this repository's history.
- Charting and diagram libraries (Chart.js, Mermaid): the charts are drawn
  directly as SVG/DOM, so MxScout still ships with no third-party code beyond
  the above.
- Tools of MxDevSwissTool that are not log analysis (HAR analyzer, JVM health,
  telemetry, Query Intelligence, live EXPLAIN against a database, and the
  rest of the toolbox).

### Licence text

```text
MIT License

Copyright (c) 2026 Mikołaj

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
