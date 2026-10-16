#!/usr/bin/env node
/* MxScout — builds the team guide as one HTML page, English and Polish: public/guide-team.html.
 *
 *   node tools/build-guide.js            writes public/guide-team.html from public/guide-team.md
 *   node tools/build-guide.js --check    writes nothing; exits 1 when the committed page is not what it would write
 *
 * A tool run by hand after public/guide-team.md changes, not a build step: the page is committed, and
 * MxScout serves it as it is (GET /guide-team.html) and writes it into a Mendix project as
 * mxscout/GUIDE.html. The suite (test/94-guide-html.test.js) fails when the committed page is not what
 * this script makes from the Markdown now, so the two never drift apart.
 *
 * The page is self-contained: MxScout's two fonts are inside it as data: URIs, its one script and its
 * stylesheet are inline, and it loads nothing — it opens offline, from a file, a repository or this
 * server. Its output depends only on guide-team.md and the two font files (no version, no date), so it is
 * the same in every copy of MxScout and changes only when the guide does.
 *
 * It reads the subset of Markdown guide-team.md uses: ### sections, a bold-only line as a sub-heading,
 * paragraphs, nested lists, tables and blockquotes (the phrases to start with). Node's standard library
 * only (fs, path, crypto) — no dependencies.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'public', 'guide-team.md');
const OUT = path.join(ROOT, 'public', 'guide-team.html');
const FONTS = path.join(ROOT, 'public', 'fonts');

// Unicode-aware like a word character in the guide's two languages, so *ą* or a word in the middle of a
// Polish sentence is not read as emphasis.
const WORD = '\\p{L}\\p{N}_';

function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function inline(t) {
  t = esc(t);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(new RegExp('(?<![*' + WORD + '])\\*([^*\\n]+)\\*(?![*' + WORD + '])', 'gu'), '<em>$1</em>');
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
  return t;
}

function slug(s) {
  return String(s).replace(/<[^>]+>/g, '').toLowerCase().replace(/[^a-z0-9ąćęłńóśźż]+/g, '-').replace(/^-+|-+$/g, '');
}

// Strips any of `chars` from both ends, as Python's str.strip(chars) does.
function stripChars(s, chars) {
  let a = 0, b = s.length;
  while (a < b && chars.indexOf(s[a]) !== -1) a++;
  while (b > a && chars.indexOf(s[b - 1]) !== -1) b--;
  return s.slice(a, b);
}

// One language's half of the guide → { html, toc }.
function convert(md, lang) {
  const lines = md.split('\n');
  const out = [], toc = [], para = [];
  let i = 0;

  function flush() {
    if (!para.length) return;
    const text = para.map((x) => x.trim()).join(' ');
    const m = /^\*\*([^*]+)\*\*(.*)$/.exec(text);
    if (m && (!m[2].trim() || /^\s*\*\([^)]*\)\*$/.test(m[2]))) {
      const extra = m[2].trim();
      out.push('<h4>' + inline(m[1]) + (extra ? ' <span class="tag">' + inline(stripChars(extra, '*()')) + '</span>' : '') + '</h4>');
    } else {
      out.push('<p>' + inline(text) + '</p>');
    }
    para.length = 0;
  }

  // A list, with its continuation lines and nested items.
  function listBlock(start) {
    let j = start;
    const items = []; // [indent, ordered, text]
    while (j < lines.length) {
      const ln = lines[j];
      const m = /^(\s*)(-|\d+\.)\s+(.*)$/.exec(ln);
      if (m) items.push([m[1].length, m[2] !== '-', m[3]]);
      else if (ln.trim() && ln[0] === ' ' && items.length) items[items.length - 1][2] += ' ' + ln.trim();
      else break;
      j++;
    }
    function render(k, indent) {
      const ordered = items[k][1];
      const parts = [ordered ? '<ol>' : '<ul>'];
      while (k < items.length && items[k][0] >= indent) {
        if (items[k][0] > indent) {
          const r = render(k, items[k][0]);
          k = r[1];
          parts[parts.length - 1] = parts[parts.length - 1].slice(0, -5) + r[0] + '</li>';
          continue;
        }
        parts.push('<li>' + inline(items[k][2]) + '</li>');
        k++;
      }
      parts.push(ordered ? '</ol>' : '</ul>');
      return [parts.join(''), k];
    }
    return [render(0, items[0][0])[0], j];
  }

  while (i < lines.length) {
    const ln = lines[i];
    if (!ln.trim() || ln.trim() === '---' || ln.startsWith('<a id=')) { flush(); i++; continue; }
    if (ln.startsWith('## ')) { flush(); i++; continue; }
    if (ln.startsWith('### ')) {
      flush();
      const title = ln.slice(4).trim();
      const m = /^(\d+)\.\s+(.*)/.exec(title);
      const num = m ? m[1] : '', name = m ? m[2] : title;
      const sid = lang + '-' + (num || slug(name));
      toc.push([sid, num, name]);
      out.push('<h3 id="' + sid + '"><span class="num">' + num + '</span>' + inline(name) + '</h3>');
      i++; continue;
    }
    if (ln.startsWith('|')) {
      flush();
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        rows.push(stripChars(lines[i].trim(), '|').split('|').map((c) => c.trim()));
        i++;
      }
      const head = rows[0], body = rows.slice(1).filter((r) => !r.every((c) => /^:?-{3,}:?$/.test(c)));
      const t = ['<div class="table"><table><thead><tr>'].concat(head.map((c) => '<th>' + inline(c) + '</th>'), ['</tr></thead><tbody>']);
      body.forEach((r) => t.push('<tr>' + r.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>'));
      t.push('</tbody></table></div>');
      out.push(t.join(''));
      continue;
    }
    if (ln.startsWith('>')) {
      flush();
      const q = [];
      while (i < lines.length && lines[i].startsWith('>')) { q.push(lines[i].slice(1).trim()); i++; }
      const parts = q.join(' ').split(' · ').map((x) => inline(x.trim()));
      out.push('<div class="asks">' + parts.map((p) => '<span class="ask">' + p + '</span>').join('') + '</div>');
      continue;
    }
    if (/^\s*(-|\d+\.)\s+/.test(ln)) {
      flush();
      const r = listBlock(i);
      out.push(r[0]); i = r[1];
      continue;
    }
    para.push(ln); i++;
  }
  flush();
  return { html: out.join('\n'), toc: toc };
}

function font(file) { return 'data:font/woff2;base64,' + fs.readFileSync(path.join(FONTS, file)).toString('base64'); }

function tocHtml(toc, label) {
  return '<nav class="toc" aria-label="' + label + '"><p class="toc-h">' + label + '</p><ol>' +
    toc.map((x) => '<li><a href="#' + x[0] + '"><span class="num">' + x[1] + '</span>' + inline(x[2]) + '</a></li>').join('') + '</ol></nav>';
}

// The page, from the guide's Markdown and the two fonts' data: URIs.
function build(md, fonts) {
  md = String(md).replace(/\r\n/g, '\n');
  const en = convert(md.slice(md.indexOf('<a id="english"></a>'), md.indexOf('<a id="polski"></a>')), 'en');
  const pl = convert(md.slice(md.indexOf('<a id="polski"></a>')), 'pl');
  const css = CSS.replace('{{SANS}}', () => fonts.sans).replace('{{MONO}}', () => fonts.mono);
  const body = BODY.replace('{{EN}}', () => en.html).replace('{{PL}}', () => pl.html)
    .replace('{{EN_TOC}}', () => tocHtml(en.toc, 'Contents')).replace('{{PL_TOC}}', () => tocHtml(pl.toc, 'Spis treści'));
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
    '<title>MxScout Team Guide</title>\n<style>\n' + css + '</style>\n</head>\n<body>\n' + body + '\n<script>\n' + JS + '</script>\n</body>\n</html>\n';
}

// The page's one inline script, as a CSP source: server/index.js serves this page with exactly this hash.
// LF, whatever the checkout did: a clone with core.autocrlf=true and no .gitattributes (or one made before
// the repository had it) holds the guide and the page with CRLF. The page is made with LF, the server
// serves it with LF, and its script's hash is of the LF text — so a CRLF copy on disk changes none of them.
function lf(t) { return String(t).replace(/\r\n?/g, '\n'); }

function scriptHash(page) {
  const m = /<script>([\s\S]*?)<\/script>/.exec(lf(page));
  return m ? "'sha256-" + crypto.createHash('sha256').update(m[1], 'utf8').digest('base64') + "'" : null;
}

function make() {
  return build(lf(fs.readFileSync(SRC, 'utf8')), { sans: font('InstrumentSans.woff2'), mono: font('JetBrainsMono.woff2') });
}

const CSS = `
/* A reference page for a team: one reading column, the contents beside it on wide screens, one language at a time. */
/* Fonts, embedded below as data: URIs, unchanged: Instrument Sans, Copyright 2022 The Instrument Sans Project Authors
   (https://github.com/Instrument/instrument-sans), and JetBrains Mono, Copyright 2020 The JetBrains Mono Project Authors
   (https://github.com/JetBrains/JetBrainsMono), both under the SIL Open Font License 1.1 (https://openfontlicense.org);
   the licence texts are in MxScout's public/fonts/. */
@font-face { font-family: "Instrument Sans"; src: url({{SANS}}) format("woff2"); font-weight: 400 700; font-stretch: 75% 100%; font-display: swap; }
@font-face { font-family: "JetBrains Mono"; src: url({{MONO}}) format("woff2"); font-weight: 100 800; font-display: swap; }
:root {
  --bg: #F7F8FA; --panel: #FFFFFF; --line: #E4E6EA; --line2: #D3D7DD;
  --ink: #121417; --ink2: #3B4048; --muted: #646A74;
  --acc: #3461F5; --acc-text: #2448C8; --acc-soft: #E8EEFF; --ok: #15803D; --okbg: #E7F6EC;
  --sans: "Instrument Sans", "Segoe UI", system-ui, -apple-system, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, "SF Mono", Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0D0E11; --panel: #111215; --line: #22252B; --line2: #30333A;
  --ink: #EDEEF0; --ink2: #BCC1C9; --muted: #8B919B;
  --acc: #3461F5; --acc-text: #8EA8FF; --acc-soft: #172038; --ok: #4ADE80; --okbg: #112417; color-scheme: dark; } }
:root[data-theme="dark"] {
  --bg: #0D0E11; --panel: #111215; --line: #22252B; --line2: #30333A;
  --ink: #EDEEF0; --ink2: #BCC1C9; --muted: #8B919B;
  --acc: #3461F5; --acc-text: #8EA8FF; --acc-soft: #172038; --ok: #4ADE80; --okbg: #112417; color-scheme: dark; }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 72px; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
body { margin: 0; background: var(--bg); color: var(--ink); font: 400 16px/1.6 var(--sans); -webkit-font-smoothing: antialiased; }
a { color: var(--acc-text); text-underline-offset: 2px; }
a:focus-visible, button:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; border-radius: 4px; }
.bar { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(8px); border-bottom: 1px solid var(--line); }
.bar-in { max-width: 1120px; margin: 0 auto; padding: 10px 16px; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.mark { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.mark b { font-weight: 700; font-stretch: 85%; font-size: 18px; letter-spacing: -0.01em; }
.mark span { color: var(--muted); font-size: 13px; }
.langs { margin-left: auto; display: inline-flex; border: 1px solid var(--line2); border-radius: 8px; padding: 2px; background: var(--panel); }
.langs button { font: 600 13px var(--sans); color: var(--muted); background: none; border: 0; padding: 5px 12px; border-radius: 6px; cursor: pointer; letter-spacing: 0.04em; }
.langs button[aria-pressed="true"] { background: var(--acc); color: #fff; }
.wrap { max-width: 1120px; margin: 0 auto; padding-inline: 16px; padding-block: 40px 80px; display: grid; grid-template-columns: 230px minmax(0, 1fr); gap: 56px; }
@media (max-width: 860px) { .wrap { grid-template-columns: minmax(0, 1fr); gap: 24px; padding-block: 24px 64px; } .toc { position: static !important; } }
.toc { position: sticky; top: 76px; align-self: start; font-size: 14px; }
.toc-h { margin: 0 0 8px; font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); }
.toc ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.toc a { display: flex; gap: 10px; padding: 5px 8px; border-radius: 6px; color: var(--ink2); text-decoration: none; line-height: 1.35; }
.toc a:hover { background: var(--acc-soft); color: var(--ink); }
.toc .num { font: 500 12px/1.6 var(--mono); color: var(--muted); min-width: 18px; }
main { min-width: 0; max-width: 70ch; }
.hero { padding-bottom: 28px; margin-bottom: 8px; border-bottom: 1px solid var(--line); }
.eyebrow { font: 500 12px var(--mono); color: var(--acc-text); letter-spacing: 0.06em; text-transform: uppercase; margin: 0 0 10px; }
h1 { margin: 0 0 12px; font-size: clamp(30px, 5vw, 44px); line-height: 1.08; font-weight: 700; font-stretch: 80%; letter-spacing: -0.02em; text-wrap: balance; }
.lede { margin: 0; color: var(--ink2); font-size: 18px; line-height: 1.55; }
.ways { margin-top: 20px; display: flex; flex-wrap: wrap; gap: 8px; }
.ways span { font-size: 13px; border: 1px solid var(--line2); border-radius: 999px; padding: 4px 12px; color: var(--ink2); background: var(--panel); }
h3 { margin: 48px 0 12px; font-size: 24px; line-height: 1.2; font-weight: 700; font-stretch: 85%; letter-spacing: -0.01em; text-wrap: balance; display: flex; gap: 14px; align-items: baseline; }
h3 .num { font: 500 14px var(--mono); color: var(--acc-text); background: var(--acc-soft); border-radius: 6px; padding: 2px 8px; flex: none; }
h3 .num:empty { display: none; }
h4 { margin: 28px 0 8px; font-size: 17px; font-weight: 650; }
h4 .tag { font: 500 11px var(--mono); color: var(--ok); background: var(--okbg); border-radius: 4px; padding: 2px 6px; margin-left: 6px; vertical-align: 2px; }
p { margin: 10px 0; }
ul, ol { margin: 10px 0; padding-left: 22px; }
li { margin: 5px 0; }
li > ul, li > ol { margin: 4px 0; }
main > ol > li::marker { font: 600 14px var(--mono); color: var(--acc-text); }
code { font: 0.88em var(--mono); background: var(--panel); border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; overflow-wrap: anywhere; }
strong { font-weight: 650; }
em { color: var(--ink2); }
.asks { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 16px; }
.ask { background: var(--panel); border: 1px solid var(--line2); border-left: 3px solid var(--acc); border-radius: 6px; padding: 8px 12px; font-size: 15px; color: var(--ink2); }
.table { overflow-x: auto; margin: 14px 0; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
table { border-collapse: collapse; width: 100%; font-size: 14.5px; }
th { text-align: left; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); padding: 10px 14px; border-bottom: 1px solid var(--line2); }
td { padding: 10px 14px; border-top: 1px solid var(--line); vertical-align: top; }
td em { color: var(--ink); font-style: normal; }
tbody tr:first-child td { border-top: 0; }
.foot { margin-top: 56px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; }
body > div[lang]:not(.show) { display: none; }
@media print { .bar, .toc { display: none; } .wrap { display: block; padding: 0; } body { background: #fff; color: #000; } }
`;

const BODY = `
<header class="bar"><div class="bar-in">
  <div class="mark"><b>MxScout &amp; Claude</b><span data-en="Team guide" data-pl="Przewodnik dla zespołu">Team guide</span></div>
  <div class="langs" role="group" aria-label="Language / Język">
    <button type="button" id="b-en" data-lang="en" aria-pressed="true">EN</button>
    <button type="button" id="b-pl" data-lang="pl" aria-pressed="false">PL</button>
  </div>
</div></header>
<div lang="en" class="show"><div class="wrap">
  {{EN_TOC}}
  <main>
    <div class="hero">
      <p class="eyebrow">MxScout · team guide</p>
      <h1>Document a Mendix app once. Let the whole team, and Claude, use it.</h1>
      <p class="lede">How to set up the documentation of an application, keep it current, and get help with tickets, Jira issues and ideas — with Claude alone, with MxScout, or without the repository.</p>
      <div class="ways"><span>Claude only</span><span>Claude + MxScout</span><span>A package, without the repository</span></div>
    </div>
    {{EN}}
    <p class="foot">Made from public/guide-team.md in the MxScout repository, which also writes it into each project as mxscout/GUIDE.html and mxscout/GUIDE.md. This page loads nothing and stores nothing. Fonts: Instrument Sans and JetBrains Mono, SIL Open Font License 1.1.</p>
  </main>
</div></div>
<div lang="pl"><div class="wrap">
  {{PL_TOC}}
  <main>
    <div class="hero">
      <p class="eyebrow">MxScout · przewodnik dla zespołu</p>
      <h1>Opisz aplikację Mendix raz. Niech korzysta z tego cały zespół i Claude.</h1>
      <p class="lede">Jak założyć dokumentację aplikacji, utrzymywać ją aktualną i dostawać pomoc przy ticketach, Jirach i pomysłach — z samym Claude'em, z MxScoutem albo bez repozytorium.</p>
      <div class="ways"><span>Tylko Claude</span><span>Claude + MxScout</span><span>Paczka, bez repozytorium</span></div>
    </div>
    {{PL}}
    <p class="foot">Zrobione z public/guide-team.md w repozytorium MxScout, który zapisuje go też w każdym projekcie jako mxscout/GUIDE.html i mxscout/GUIDE.md. Ta strona niczego nie pobiera i niczego nie zapisuje. Fonty: Instrument Sans i JetBrains Mono, SIL Open Font License 1.1.</p>
  </main>
</div></div>
`;

const JS = `
(function () {
  // One language at a time. The choice is kept in the address (#en, #pl), not in storage: the page stores nothing.
  var blocks = document.querySelectorAll('div[lang]');
  function set(lang) {
    blocks.forEach(function (b) { b.classList.toggle('show', b.getAttribute('lang') === lang); });
    document.querySelectorAll('.langs button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.lang === lang)); });
    document.querySelectorAll('[data-en]').forEach(function (n) { n.textContent = n.dataset[lang]; });
    document.documentElement.lang = lang;
  }
  document.querySelectorAll('.langs button').forEach(function (b) {
    b.addEventListener('click', function () {
      set(b.dataset.lang);
      try { history.replaceState(null, '', '#' + b.dataset.lang); } catch (e) { /* a page opened from a file may refuse */ }
      window.scrollTo(0, 0);
    });
  });
  var h = (location.hash || '').slice(1);
  set(/^pl/.test(h) || h === 'polski' ? 'pl' : /^en/.test(h) || h === 'english' ? 'en' : /^pl/i.test(navigator.language || '') ? 'pl' : 'en');
})();
`;

module.exports = { build: build, make: make, scriptHash: scriptHash, convert: convert, inline: inline, lf: lf, OUT: OUT };

if (require.main === module) {
  const page = make();
  const now = fs.existsSync(OUT) ? lf(fs.readFileSync(OUT, 'utf8')) : null;
  if (process.argv.indexOf('--check') !== -1) {
    console.log(now === page ? 'public/guide-team.html is up to date.' : 'public/guide-team.html is NOT what public/guide-team.md makes — run node tools/build-guide.js');
    process.exit(now === page ? 0 : 1);
  }
  if (now === page) console.log('public/guide-team.html is up to date; nothing written.');
  else { fs.writeFileSync(OUT, page); console.log('wrote public/guide-team.html, ' + Math.round(Buffer.byteLength(page) / 1024) + ' KB'); }
  console.log('script hash (server/index.js serves the page with it): ' + scriptHash(page));
}
