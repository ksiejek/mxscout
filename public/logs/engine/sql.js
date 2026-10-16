/* MxScout — Log analysis module.
 *
 * SQL formatting and highlighting engine used by the Query Extractor.
 *
 * Derived from MxDevSwissTool by Mikołaj (RealMecowhy),
 * https://github.com/RealMecowhy/MxDevSwissTool — MIT License, Copyright (c) 2026 Mikołaj.
 * Source: public/js/tools/sql-engine.js, sql.js (prettifySQL, highlight matchers) and format-view.js (tokenizer)
 * The logic is carried over unchanged, so MxScout reads every log the way the original does;
 * only the packaging differs (no DOM, no network, no build step).
 * The licence text is in THIRD-PARTY-NOTICES.md at the root of this repository.
 */
(function () {
'use strict';
// =========================================================================
// SQL / OQL FORMATTING ENGINE (shared, string/comment-safe) · prefix `sqe`
// =========================================================================
// The formatters this engine replaces — prettifySQL (sql.js) and formatOql
// (query-intelligence.js) — both ran a blind `text.replace(/\s+/g, ' ')` over the raw
// input, then matched keywords with `\bKEYWORD\b` across the WHOLE string.
// Neither step knows about string literals or comments, so `WHERE name =
// 'ORDER BY'` breaks the line inside the literal, and a keyword sitting in a
// `-- comment` gets uppercased and relocated as if it were code.
//
// The fix is the classic mask/unmask technique: pull every string literal and
// comment out into an opaque placeholder BEFORE any keyword or whitespace
// transform runs, so those transforms only ever see real code. Once formatting
// is done, the placeholders are swapped back for the original text (or a
// highlighted version of it, for callers that render HTML).
//
// Comma-splitting (SELECT / GROUP BY / ORDER BY column lists) needs the same
// protection PLUS paren-depth awareness — `numeric(10,2)` and a subquery's
// commas are not list separators. Depth is tracked on the MASKED text: real
// parentheses inside code are still visible there, only string/comment
// content has been replaced by an opaque, paren-free token.
//
// Pure: attaches to window/self so scripts/parser-test.js exercises it in
// plain Node.
// =========================================================================

const SQE_GLOBAL = (typeof window !== 'undefined' ? window : self);
// NUL -- built via fromCharCode rather than a literal escape so no raw control
// byte sits in this source file. Never appears in real SQL/OQL text.
const SQE_MARK = String.fromCharCode(0);

// ── mask / unmask ─────────────────────────────────────────────────────────

// Pulls every string literal ('...'/"...", doubled-quote escape honoured) and
// every comment (`--` to end of line, `/* ... */`) out of `text`, replacing
// each with an opaque a NUL-delimited placeholder. Returns the masked text and
// the list of extracted tokens (in order, index-addressable).
function sqeMask(text) {
  const s = String(text == null ? '' : text);
  const tokens = [];
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '"') {
      const q = c;
      let raw = c; i++;
      while (i < s.length) {
        if (s[i] === q && s[i + 1] === q) { raw += q + q; i += 2; continue; }
        raw += s[i];
        if (s[i] === q) { i++; break; }
        i++;
      }
      tokens.push({ type: 'string', raw: raw });
      out += SQE_MARK + (tokens.length - 1) + SQE_MARK;
      continue;
    }
    if (c === '-' && s[i + 1] === '-') {
      let j = i;
      while (j < s.length && s[j] !== '\n') j++;
      tokens.push({ type: 'comment', raw: s.slice(i, j) });
      out += SQE_MARK + (tokens.length - 1) + SQE_MARK;
      i = j;
      continue;
    }
    if (c === '/' && s[i + 1] === '*') {
      let j = i + 2;
      while (j < s.length && !(s[j] === '*' && s[j + 1] === '/')) j++;
      j = Math.min(j + 2, s.length);
      tokens.push({ type: 'comment', raw: s.slice(i, j) });
      out += SQE_MARK + (tokens.length - 1) + SQE_MARK;
      i = j;
      continue;
    }
    out += c; i++;
  }
  return { masked: out, tokens: tokens };
}

// Reverses sqeMask. `wrap(token)` maps a token to its output text — defaults
// to the original raw text (used for prettify/minify); a caller that renders
// HTML passes a wrap function that escapes and highlights instead.
function sqeUnmask(text, tokens, wrap) {
  const fn = wrap || function (t) { return t.raw; };
  return String(text).replace(new RegExp(SQE_MARK + '(\\d+)' + SQE_MARK, 'g'), function (m, idx) {
    return fn(tokens[Number(idx)]);
  });
}

// ── top-level splitting (comma boundaries outside parens) ─────────────────

// Splits `text` on `sep` (default ',') only at paren depth 0. Call this on
// MASKED text — real string/comment content never reaches it, so a comma
// inside a literal can't be mistaken for a list separator.
function sqeSplitTopLevel(text, sep) {
  sep = sep || ',';
  const s = String(text == null ? '' : text);
  const parts = [];
  let depth = 0, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === sep && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts.map(function (p) { return p.trim(); }).filter(function (p) { return p.length; });
}

// ── keyword-driven line breaking (operates on masked text) ────────────────

function sqeKeywordRegex(list) {
  const alts = list.slice().sort(function (a, b) { return b.length - a.length; })
    .map(function (k) { return k.replace(/ /g, '\\s+'); });
  return new RegExp('\\b(' + alts.join('|') + ')\\b', 'gi');
}

// Like `text.replace(regex, replacer)`, but `replacer` only runs on a match
// that sits at paren depth 0 in `text` — a match inside `(...)` (a subquery,
// a grouped condition) is left untouched. Depth is tracked cumulatively as
// matches are found left-to-right, so this stays O(n) rather than rescanning
// from the start for every match.
function sqeReplaceAtDepth0(text, regex, replacer) {
  const re = new RegExp(regex.source, regex.flags.indexOf('g') === -1 ? regex.flags + 'g' : regex.flags);
  let out = '', last = 0, depth = 0, m;
  while ((m = re.exec(text)) !== null) {
    for (let i = last; i < m.index; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
    }
    out += text.slice(last, m.index) + (depth === 0 ? replacer(m[0]) : m[0]);
    last = re.lastIndex;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return out + text.slice(last);
}

// Placeholder marker for an extracted subquery. String.fromCharCode(2) — never
// appears in real SQL/OQL — kept distinct from SQE_MARK (\0, used for
// string/comment literals) so the two masking layers never collide.
const SQE_SUBMARK = String.fromCharCode(2);

// The FLAT pass (the original algorithm): formats masked text WITHOUT recursing
// into subqueries. `breakKeywords` each start a new line, `indentKeywords` a
// new indented continuation line, `listKeywords` (SELECT/GROUP BY/ORDER BY)
// additionally split their clause on top-level commas. All matching is
// depth-0 only, so a parenthesized group — function args (SUM(x)), a type param
// (VARCHAR(10)), an IN value-list, a grouped AND/OR condition — stays on one
// line and never has its closing paren misplaced.
function sqeFlatFormat(masked, opts) {
  const indent = ' '.repeat(opts.indentSize > 0 ? opts.indentSize : 2);
  const kwCase = opts.keywordCase || 'upper';
  function applyCase(m) {
    if (kwCase === 'lower') return m.toLowerCase();
    if (kwCase === 'preserve') return m;
    return m.toUpperCase();
  }
  let res = String(masked).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
  if (opts.inlineKeywords && opts.inlineKeywords.length) {
    res = res.replace(sqeKeywordRegex(opts.inlineKeywords), applyCase);
  }
  if (opts.breakKeywords && opts.breakKeywords.length) {
    res = sqeReplaceAtDepth0(res, sqeKeywordRegex(opts.breakKeywords), function (m) { return '\n' + applyCase(m); });
  }
  if (opts.indentKeywords && opts.indentKeywords.length) {
    res = sqeReplaceAtDepth0(res, sqeKeywordRegex(opts.indentKeywords), function (m) { return '\n' + indent + applyCase(m); });
  }
  if (opts.listKeywords && opts.listKeywords.length) {
    res = res.split('\n').map(function (line) {
      for (let k = 0; k < opts.listKeywords.length; k++) {
        const re = new RegExp('^(' + opts.listKeywords[k].replace(/ /g, '\\s+') + ')\\s+', 'i');
        const m = line.match(re);
        if (m) {
          const items = sqeSplitTopLevel(line.slice(m[0].length), ',');
          return m[1] + '\n' + indent + items.join(',\n' + indent);
        }
      }
      return line;
    }).join('\n');
  }
  // A break keyword at position 0 (a leading SELECT) prefixes a spurious empty
  // line; sqePrettify's final trim hid it for the outer query, but an indented
  // subquery body would keep it, so strip it here.
  res = res.replace(/^\n+/, '');
  return res.split('\n').map(function (l) { return l.replace(/[ \t]+$/, ''); }).join('\n');
}

// Pulls each SUBQUERY — a parenthesized group whose content begins with SELECT
// — out to an opaque placeholder before the flat pass runs, so the surrounding
// query formats without it, and it can be formatted on its own and re-indented
// to the column its `(` lands at. Function-arg parens, type params, IN
// value-lists and grouped AND/OR conditions do NOT start with SELECT, so they
// are left inline exactly as the flat pass always handled them.
function sqeExtractSubqueries(s) {
  let out = '', i = 0;
  const subs = [];
  while (i < s.length) {
    if (s[i] === '(') {
      let depth = 0, j = i;
      for (; j < s.length; j++) {
        if (s[j] === '(') depth++;
        else if (s[j] === ')') { depth--; if (depth === 0) break; }
      }
      const content = s.slice(i + 1, j);
      if (depth === 0 && /^\s*select\b/i.test(content)) {
        subs.push(content);
        out += SQE_SUBMARK + (subs.length - 1) + SQE_SUBMARK;
        i = j + 1;
        continue;
      }
    }
    out += s[i]; i++;
  }
  return { text: out, subs: subs };
}

// Recursively formats masked text: extract subqueries → flat-format the rest →
// expand each subquery placeholder into a `(` … `)` block, its body formatted
// the same way and indented one level past the line the call sits on. So
// `AND c.ID IN (SELECT …)` opens the paren on its clause line, lays the inner
// SELECT/FROM/WHERE out below it, and closes the paren back at the clause indent.
function sqeFormatRec(masked, opts) {
  const extracted = sqeExtractSubqueries(masked);
  const flat = sqeFlatFormat(extracted.text, opts);
  if (!extracted.subs.length) return flat;
  const indent = ' '.repeat(opts.indentSize > 0 ? opts.indentSize : 2);
  const phRe = new RegExp(SQE_SUBMARK + '(\\d+)' + SQE_SUBMARK);
  const outLines = [];
  flat.split('\n').forEach(function (line) {
    const m = line.match(phRe);
    if (!m) { outLines.push(line); return; }
    const lineIndent = (line.match(/^\s*/) || [''])[0];
    const before = line.slice(0, m.index).replace(/\s+$/, '');
    const after = line.slice(m.index + m[0].length);
    const innerIndent = lineIndent + indent;
    const inner = sqeFormatRec(extracted.subs[Number(m[1])], opts).split('\n')
      .map(function (l) { return innerIndent + l; });
    outLines.push(before.length ? before + ' (' : lineIndent + '(');
    Array.prototype.push.apply(outLines, inner);
    outLines.push(lineIndent + ')' + after);
  });
  return outLines.join('\n');
}

// Formats SQL/OQL: `keywordCase` — 'upper' (default), 'lower', or 'preserve' —
// and `indentSize` (default 2) are opt-in so existing callers see no change.
// Subqueries are formatted recursively (see sqeFormatRec); every other
// parenthesized group stays inline (see sqeFlatFormat).
function sqePrettify(text, opts) {
  opts = opts || {};
  const masked = sqeMask(text);
  const formatted = sqeFormatRec(masked.masked, opts);
  return sqeUnmask(formatted, masked.tokens).trim();
}

SQE_GLOBAL.sqeMask = sqeMask;
SQE_GLOBAL.sqeUnmask = sqeUnmask;
SQE_GLOBAL.sqeSplitTopLevel = sqeSplitTopLevel;
SQE_GLOBAL.sqePrettify = sqePrettify;
// Exposed so a caller's own highlight regexes (sql.js, query-intelligence.js) can
// build the same lookbehind/lookahead guard against matching a placeholder's
// digit run, without hardcoding the marker character themselves.
SQE_GLOBAL.sqeMark = SQE_MARK;


// ---- from format-view.js: the tokenizer (the DOM half of that file is not carried over) ----
// ── tokenizer ─────────────────────────────────────────────────────────────
// A matcher is `fn(text, i) -> {t, len} | null`: given the position `i`, it
// either claims a run of characters (returning its token type and length) or
// declines. fvTokenize tries them in order at every position; the first to
// claim wins, so more specific matchers (strings, comments, keywords) must be
// listed before the catch-alls (identifiers, single-char punctuation).
function fvTokenize(text, matchers) {
  const s = String(text == null ? '' : text);
  const toks = [];
  let i = 0;
  while (i < s.length) {
    let hit = null;
    for (let k = 0; k < matchers.length; k++) {
      const r = matchers[k](s, i);
      if (r && r.len > 0) { hit = r; break; }
    }
    if (!hit) { toks.push({ t: 'punct', v: s[i] }); i++; continue; }
    toks.push({ t: hit.t, v: s.slice(i, i + hit.len) });
    i += hit.len;
  }
  return toks;
}

// A sticky-regex matcher: claims text[i..] matching `src` anchored at `i`.
function fvRe(t, src, flags) {
  const re = new RegExp(src, 'y' + (flags || ''));
  return function (text, i) {
    re.lastIndex = i;
    const m = re.exec(text);
    return m ? { t: t, len: m[0].length } : null;
  };
}

// A word/keyword matcher: case-insensitive, honours word boundaries on both
// sides, and supports multi-word keywords (`GROUP BY`) by allowing any run of
// whitespace between the words. Longest alternatives are tried first so
// `INNER JOIN` wins over `JOIN`, `IS NOT NULL` over `IS`/`NOT`/`NULL`.
function fvWords(t, list) {
  const alts = list.slice()
    .sort(function (a, b) { return b.length - a.length; })
    .map(function (w) { return w.replace(/ /g, '\\s+'); });
  const re = new RegExp('(?:' + alts.join('|') + ')(?![\\w])', 'iy');
  return function (text, i) {
    // Block a match only when the char before is identifier-ish (letter/_/$) —
    // then `fooand` stays one identifier. A digit or `.` before is still a
    // boundary (a number can't contain letters), so pasted glued input like
    // `1000.0then` correctly splits into the number and the keyword.
    if (i > 0 && /[A-Za-z_$]/.test(text[i - 1])) return null;
    re.lastIndex = i;
    const m = re.exec(text);
    return m ? { t: t, len: m[0].length } : null;
  };
}

// An identifier-followed-by-`(` matcher — a function call. Whitespace between
// the name and the paren is tolerated (`count (*)`). Must be listed AFTER the
// keyword matcher so reserved words that take parens (`not(`, `in (`) stay
// keywords rather than being mis-tagged as functions.
function fvFnCall(t) {
  const re = /[A-Za-z_][A-Za-z0-9_]*/y;
  return function (text, i) {
    if (i > 0 && /[A-Za-z_$]/.test(text[i - 1])) return null;
    re.lastIndex = i;
    const m = re.exec(text);
    if (!m) return null;
    let j = i + m[0].length;
    while (text[j] === ' ' || text[j] === '\t') j++;
    return text[j] === '(' ? { t: t, len: m[0].length } : null;
  };
}

// ── bracket / keyword grouping ──────────────────────────────────────────────
// Assigns a shared `g` id to each pair of matching brackets: `(`↔`)` and
// `[`↔`]` are tracked on independent stacks so an unbalanced mix never crosses
// the streams. Returns the next free group id, so callers can keep numbering
// (e.g. if/then/else groups) from there without collisions.
function fvAssignBrackets(tokens, gStart) {
  let g = gStart || 0;
  const stackP = [], stackB = [];
  for (let k = 0; k < tokens.length; k++) {
    const tk = tokens[k];
    if (tk.t !== 'paren' && tk.t !== 'bracket') continue;
    const isRound = tk.v === '(' || tk.v === ')';
    const stack = isRound ? stackP : stackB;
    if (tk.v === '(' || tk.v === '[') { g++; tk.g = g; stack.push(g); }
    else { const id = stack.pop(); if (id != null) tk.g = id; }
  }
  return g;
}


// ---- from sql.js: the SQL formatter settings and highlight matchers ----
const SQL_BREAK_KEYWORDS = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING',
  'LIMIT', 'OFFSET', 'LEFT OUTER JOIN', 'RIGHT OUTER JOIN', 'FULL OUTER JOIN',
  'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'CROSS JOIN', 'OUTER JOIN', 'JOIN',
  'UNION ALL', 'UNION', 'RETURNING', 'SET', 'VALUES', 'INSERT INTO'];
const SQL_INDENT_KEYWORDS = ['AND', 'OR'];
const SQL_LIST_KEYWORDS = ['SELECT', 'GROUP BY', 'ORDER BY'];

// Format settings (7.6) — session-only (not persisted; toolState persistence
// is Fala 8.1's job), default to the engine's own defaults so a fresh load
// formats exactly as before this setting existed.
let sqlIndentSize = 2;
let sqlKeywordCase = 'upper';

function prettifySQL(sql) {
  return sqePrettify(sql, {
    breakKeywords: SQL_BREAK_KEYWORDS,
    indentKeywords: SQL_INDENT_KEYWORDS,
    listKeywords: SQL_LIST_KEYWORDS,
    indentSize: sqlIndentSize,
    keywordCase: sqlKeywordCase
  });
}


const SQL_HL_KEYWORDS = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING',
  'LIMIT', 'OFFSET', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'FULL OUTER JOIN',
  'OUTER JOIN', 'CROSS JOIN', 'JOIN', 'ON', 'AND', 'OR', 'NOT', 'IN', 'EXISTS',
  'BETWEEN', 'LIKE', 'ILIKE', 'IS NOT NULL', 'IS NULL', 'IS', 'NULL', 'TRUE',
  'FALSE', 'AS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'UNION ALL', 'UNION',
  'INTERSECT', 'EXCEPT', 'DISTINCT', 'ALL', 'ASC', 'DESC', 'WITH', 'RETURNING',
  'INSERT INTO', 'INSERT', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE TABLE',
  'CREATE', 'DROP', 'ALTER', 'TRUNCATE', 'BEGIN', 'COMMIT', 'ROLLBACK', 'USING',
  'INTO', 'LEFT', 'RIGHT', 'INNER', 'FULL', 'OUTER', 'CROSS'];
const SQL_MATCHERS = [
  fvRe('ws', '[ \\t\\r\\n]+'),
  fvRe('comment', '--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/'),
  fvRe('str', "'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\""),
  fvRe('num', '\\d+(?:\\.\\d+)?'),
  fvWords('kw', SQL_HL_KEYWORDS),
  fvFnCall('fn'),
  fvRe('var', '[A-Za-z_]\\w*(?:[.\\/][A-Za-z_]\\w*)*'),
  fvRe('op', '<>|!=|>=|<=|=|<|>|\\|\\||\\+|\\-|\\*|\\/|%'),
  fvRe('paren', '[()]'),
  fvRe('comma', ',')
];

// MxScout: sqlHighlight() produced an HTML string; the UI builds spans from tokens instead, so no markup is ever parsed.
function sqlHighlightTokens(sql) {
  const tokens = fvTokenize(sql, SQL_MATCHERS);
  fvAssignBrackets(tokens);
  return tokens;
}

SQE_GLOBAL.prettifySQL = prettifySQL;
SQE_GLOBAL.sqlHighlightTokens = sqlHighlightTokens;
SQE_GLOBAL.fvTokenize = fvTokenize;
SQE_GLOBAL.fvRe = fvRe;
SQE_GLOBAL.fvWords = fvWords;
SQE_GLOBAL.fvFnCall = fvFnCall;
SQE_GLOBAL.fvAssignBrackets = fvAssignBrackets;
SQE_GLOBAL.sqlSetOptions = function (o) { if (o && (o.indentSize === 2 || o.indentSize === 4)) sqlIndentSize = o.indentSize; if (o && (o.keywordCase === 'upper' || o.keywordCase === 'lower' || o.keywordCase === 'preserve')) sqlKeywordCase = o.keywordCase; };
})();
