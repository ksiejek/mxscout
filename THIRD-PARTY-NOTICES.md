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

### What was carried over

| MxScout file | comes from (MxDevSwissTool `public/js/…`) | notes |
| --- | --- | --- |
| `public/logs/engine/parser.js` | `tools/mendix-log-parser.js` | verbatim — Studio Pro CSV, Mendix Cloud live logs, on-premises logs, Grafana exports |
| `public/logs/engine/sql.js` | `tools/sql-engine.js`, `tools/sql.js`, `tools/format-view.js` | SQL/OQL tokenizer and prettifier; the highlighter returns tokens instead of an HTML string |
| `public/logs/engine/insights.js` | `tools/log-viewer.js` | the pure functions: insights, levels matrix, correlation, signatures, timing |
| `public/logs/engine/queries.js` | `tools/log-query-extractor.js` | Log Query Extractor |
| `public/logs/engine/tracer.js` | `tools/microflow-tracer.js` | Microflow Tracer, N+1 detector |
| `public/logs/engine/restws.js` | `tools/ws-rest-extractor.js` | REST & WS Extractor |
| `public/logs/engine/decoder.js` | `tools/error-decoder.js` | Error Decoder rules |
| `public/logs/engine/nginx.js` | `tools/nginx.js`, `tools/nginx-correlator.js` | parsers, 404 classifier, Timeline Correlator; aggregation written inline with the DOM was lifted out as functions |
| `public/logs/engine/anonymizer.js` | `tools/log-anonymizer.js` | the masking rules |
| `public/logs/engine/export.js` | `components/exporters.js` | CSV / Markdown / HTML builders and the incident-report model; branding changed to MxScout |
| `public/logs/engine/hub.js` | `components/data-hub.js` | the Data Hub summary and hand-off rules |
| `public/logs/parse-worker.js`, `anonymize-worker.js`, `nginx-worker.js` | the same tools' worker code | thin same-origin workers that load the engine files |
| `test/logs/engine-parity.js` | `scripts/parser-test.js` | the original's assertions, pointed at the ported files — they are what says the port has not drifted |

### What is MxScout's own

- All of `public/logs/ui/` and `public/logs/logs.css`: the screen, tabs, lists,
  charts, dialogs and the Data Hub bar are written fresh in MxScout's
  interface, built with the DOM helpers (no markup strings, in line with the
  rule described on the About page).
- The integration in `public/app.js`, `public/index.html`, `public/palette.js`.
- `test/44-logs.test.js` and its fixture.

### What was deliberately left out

- Anything that contacts the network. MxDevSwissTool's geolocation lookup in the
  Nginx analyzer (a request to a third-party service) is not carried: MxScout
  sends nothing anywhere.
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
