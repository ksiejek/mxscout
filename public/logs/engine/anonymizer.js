/* MxScout — Log analysis module.
 *
 * Log & Text Anonymizer: the masking logic, as it runs inside the Web Worker.
 *
 * Derived from MxDevSwissTool by Mikołaj (RealMecowhy),
 * https://github.com/RealMecowhy/MxDevSwissTool — MIT License, Copyright (c) 2026 Mikołaj.
 * Source: public/js/tools/log-anonymizer.js (workerLogic)
 * The logic is carried over unchanged, so MxScout reads every log the way the original does;
 * only the packaging differs (no DOM, no network, no build step).
 * The licence text is in THIRD-PARTY-NOTICES.md at the root of this repository.
 */
function workerLogic() {
  function escRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // Card ranges and the Mendix object-ID rule overlap by shape alone: an ID
  // like 4503599627370567 is 16 digits starting with 4, which is exactly a
  // Visa. The checksum is what actually separates them — a real card passes
  // Luhn, an arbitrary identifier does so only by chance.
  function luhnOk(s) {
    var sum = 0, alt = false;
    for (var i = s.length - 1; i >= 0; i--) {
      var d = s.charCodeAt(i) - 48;
      if (alt) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
      alt = !alt;
    }
    return sum % 10 === 0;
  }
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  self.onmessage = function(e) {
    var rawText = e.data.rawText;
    var opts = e.data.opts;
    var totalLength = rawText.length;

    if (totalLength === 0) {
      self.postMessage({ type: 'complete', result: '', stats: {}, totalLines: 0 });
      return;
    }

    var chunkByteSize = 256 * 1024; // 256 KB chunks
    var start = 0;
    var totalLines = 0;
    var processedRawChunks = [];
    var processedAnonChunks = [];
    var stats = { uuid: 0, ip: 0, email: 0, mendixId: 0, datetime: 0, number: 0, mac: 0, creditcard: 0, auth: 0, keywords: 0, custom: 0 };
    var totalSizeStr = formatSize(totalLength);

    var maskMap = {};
    var maskCounters = {};

    var uuidRegex = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
    var ipv4Regex = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
    var ipv6Regex = /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g;
    var emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    var mendixIdRegex = /\b\d{15,19}\b/g;
    var dateRegex1 = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?\b/gi;
    var dateRegex2 = /\b\d{2}:\d{2}:\d{2}(?:\.\d+)?\b/g;
    var numRegex = /\b\d+\b/g;
    var macRegex = /\b(?:[0-9A-Fa-f]{2}[:-]){5}(?:[0-9A-Fa-f]{2})\b/g;
    var creditCardRegex = /\b(?:4[0-9]{12}(?:[0-9]{3})?|(?:5[1-5][0-9]{2}|222[1-9]|22[3-9][0-9]|2[3-6][0-9]{2}|27[01][0-9]|2720)[0-9]{12}|3[47][0-9]{13})\b/g;
    var jwtRegex = /\beyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*\b/g;
    var bearerRegex = /\b(?:Bearer|Basic)\s+[a-zA-Z0-9\-\._~+\/]+=*/gi;
    // AWS access key IDs: a fixed 4-letter resource prefix plus 16 uppercase
    // alphanumerics. Shape alone identifies them, so no context is needed.
    // The 40-char secret key has no distinguishing shape and is caught by
    // secretAssignRegex instead (its name always contains "secret").
    var awsKeyRegex = /\b(?:AKIA|ASIA|ABIA|ACCA|AIDA|AGPA|AIPA|ANPA|ANVA|AROA)[A-Z0-9]{16}\b/g;
    // Credentials inside a URL: scheme://user:PASSWORD@host. Only the password
    // is masked (tail group) — the host and user still identify the endpoint,
    // which is usually the point of keeping the line at all.
    var urlPasswordRegex = /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s:/@]{1,128}:([^\s:/@]+)(?=@)/g;
    // Cookie/Set-Cookie: the whole value, to end of line — session cookies are
    // credentials, and attributes (Path, Domain) are not worth the leak risk.
    // Chunks are always cut on a newline, so a header never spans two chunks.
    var cookieRegex = /\b(?:Set-)?Cookie:[ \t]*(\S.*)$/gim;
    // The same headers as they appear in a HAR, where name and value are two
    // separate JSON fields — so neither the raw-header rule above nor the
    // label=value rule below can see them. A HAR is the densest secret-bearing
    // artefact a developer shares, and this toolkit has an analyzer for it,
    // so the "Cookie headers" promise has to hold in this shape too. The
    // lookahead keeps the captured value at the end of the match, which is
    // what addMatches' tail-group offset requires.
    var jsonHeaderSecretRegex = /"name"[ \t]*:[ \t]*"(?:set-cookie|cookie|authorization|proxy-authorization|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token)"[ \t]*,[ \t]*"value"[ \t]*:[ \t]*"([^"]+)(?=")/gi;
    // Generic secrets, matched by their LABEL rather than by value shape —
    // an API key has no universal shape, so anything shape-based would either
    // miss most of them or redact half the log. "authorization" is deliberately
    // absent: its value starts with "Bearer ", so this rule would mask the word
    // "Bearer" and leave the token itself exposed. bearerRegex owns that case.
    var secretAssignRegex = /\b(?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key|secret|aws[_-]?secret[_-]?access[_-]?key|private[_-]?key|password|passwd|pwd)["']?[ \t]*[:=][ \t]*["']?([^\s"',;&}]{4,})/gi;

    var keywordsList = opts.keywords && opts.keywords.trim()
      ? opts.keywords.split(',').map(function(k) { return k.trim(); }).filter(function(k) { return k.length > 0; }).sort(function(a, b) { return b.length - a.length; })
      : [];

    var customRegexList = [];
    if (opts.customRegex && opts.customRegex.trim()) {
      opts.customRegex.split('\n').forEach(function(line) {
        line = line.trim();
        if (!line) return;
        try { customRegexList.push(new RegExp(line, 'gi')); } catch (e) { /* invalid pattern — reported on main thread */ }
      });
    }

    self.postMessage({
      type: 'progress',
      progress: 0,
      phase: 'Anonymizing... 0 B / ' + totalSizeStr + ' (0%)'
    });

    function processNextChunk() {
      var end = Math.min(start + chunkByteSize, totalLength);
      if (end < totalLength) {
        var nl = rawText.indexOf('\n', end);
        end = nl !== -1 ? nl + 1 : totalLength;
      }

      var chunk = rawText.substring(start, end);

      for (var i = 0; i < chunk.length; i++) {
        if (chunk.charCodeAt(i) === 10) totalLines++;
      }

      var matches = [];

      // tailGroup: mask only that capture group instead of the whole match.
      // The secret-bearing patterns need it — `Cookie: <value>` and
      // `password=<value>` must keep their label visible, or the reader cannot
      // tell what was redacted and the log stops being readable. It is
      // deliberately restricted to a group that sits at the END of the match,
      // so the offset is a length subtraction rather than a re-search (which
      // would pick the wrong occurrence when the value repeats in the match).
      function addMatches(regex, anonLabel, statKey, accept, tailGroup) {
        var match;
        while ((match = regex.exec(chunk)) !== null) {
          var text = tailGroup ? match[tailGroup] : match[0];
          if (!text) continue;
          if (accept && !accept(text)) continue;
          var startAt = match.index + (tailGroup ? match[0].length - text.length : 0);
          matches.push({
            start: startAt,
            end: startAt + text.length,
            rawText: text,
            anonText: '[' + anonLabel + ']',
            statKey: statKey
          });
        }
      }

      // Registration order decides overlaps: matches are sorted by start
      // offset with a stable sort, then resolved first-wins, so a specific
      // pattern must be added before a generic one that also covers it.
      // The Mendix ID rule (\d{15,19}) matches every card number and any long
      // digit run inside a JWT, so it runs after those two.
      // Secrets are registered FIRST, ahead of every general-purpose rule.
      // Ties on the same start offset are settled by registration order, and
      // several secrets are shaped like something more innocent: the password
      // in `scheme://user:pass@host` parses as an e-mail address (pass@host),
      // so with e-mail masking on — the default — the e-mail rule would take
      // it, label a credential `[EMAIL]` and swallow the hostname the URL rule
      // deliberately preserves. Same class of collision for an IP or UUID
      // sitting in a `password=` value.
      if (opts.auth) {
        // Within this block the order is specific → generic for the same
        // reason: the context-anchored rules must outrank a bare JWT that
        // happens to sit inside their value.
        addMatches(awsKeyRegex, 'AWS_KEY', 'auth');
        addMatches(urlPasswordRegex, 'URL_PASSWORD', 'auth', null, 1);
        addMatches(cookieRegex, 'COOKIE', 'auth', null, 1);
        addMatches(jsonHeaderSecretRegex, 'HEADER_SECRET', 'auth', null, 1);
        addMatches(secretAssignRegex, 'SECRET', 'auth', null, 1);
        addMatches(jwtRegex, 'JWT_TOKEN', 'auth');
        addMatches(bearerRegex, 'AUTH_TOKEN', 'auth');
      }
      if (opts.uuid) addMatches(uuidRegex, 'UUID', 'uuid');
      if (opts.ip) {
        addMatches(ipv4Regex, 'IP', 'ip');
        addMatches(ipv6Regex, 'IP', 'ip');
      }
      if (opts.email) addMatches(emailRegex, 'EMAIL', 'email');
      if (opts.mac) addMatches(macRegex, 'MAC', 'mac');
      if (opts.creditcard) addMatches(creditCardRegex, 'CREDIT_CARD', 'creditcard', luhnOk);
      if (opts.mendixId) addMatches(mendixIdRegex, 'MENDIX_ID', 'mendixId');
      if (opts.datetime) {
        addMatches(dateRegex1, 'DATETIME', 'datetime');
        addMatches(dateRegex2, 'TIME', 'datetime');
      }
      if (opts.number) addMatches(numRegex, 'NUM', 'number');

      if (keywordsList.length > 0) {
        for (var ki = 0; ki < keywordsList.length; ki++) {
          var kwEscaped = escRegex(keywordsList[ki]);
          var kwRegex = new RegExp('\\b' + kwEscaped + '\\b', 'gi');
          addMatches(kwRegex, 'REDACTED', 'keywords');
        }
      }

      for (var cri = 0; cri < customRegexList.length; cri++) {
        customRegexList[cri].lastIndex = 0;
        addMatches(customRegexList[cri], 'CUSTOM', 'custom');
      }

      matches.sort(function(a, b) {
        return a.start - b.start;
      });

      var validMatches = [];
      var lastEnd = 0;
      for (var mi = 0; mi < matches.length; mi++) {
        var m = matches[mi];
        if (m.start >= lastEnd) {
          validMatches.push(m);
          lastEnd = m.end;
          stats[m.statKey]++;
        }
      }

      var rawChunk = '';
      var anonChunk = '';
      var cursor = 0;
      for (var vi = 0; vi < validMatches.length; vi++) {
        var vm = validMatches[vi];
        var prefix = chunk.substring(cursor, vm.start);
        rawChunk += prefix + '\x01' + vm.rawText + '\x02';

        var anonText = vm.anonText;
        if (opts.consistent && vm.statKey !== 'keywords' && vm.statKey !== 'datetime') {
          // Strip brackets for map key
          var label = vm.anonText.replace('[', '').replace(']', '');
          var key = label + ':' + vm.rawText;
          if (!maskMap[key]) {
            maskCounters[label] = (maskCounters[label] || 0) + 1;
            maskMap[key] = '[' + label + '-' + maskCounters[label] + ']';
          }
          anonText = maskMap[key];
        }

        anonChunk += prefix + '\x01' + anonText + '\x02';
        cursor = vm.end;
      }
      var suffix = chunk.substring(cursor);
      rawChunk += suffix;
      anonChunk += suffix;

      processedRawChunks.push(rawChunk);
      processedAnonChunks.push(anonChunk);
      start = end;

      if (start < totalLength) {
        var processedStr = formatSize(start);
        var pct = Math.round((start / totalLength) * 100);
        self.postMessage({
          type: 'progress',
          progress: pct,
          phase: 'Anonymizing... ' + processedStr + ' / ' + totalSizeStr + ' (' + pct + '%)'
        });
        setTimeout(processNextChunk, 0);
      } else {
        self.postMessage({ type: 'progress', progress: 99, phase: 'Joining results...' });
        setTimeout(function() {
          var result = processedAnonChunks.join('');
          var rawResult = processedRawChunks.join('');
          totalLines++;
          self.postMessage({ type: 'complete', result: result, rawResult: rawResult, stats: stats, totalLines: totalLines });
        }, 0);
      }
    }

    processNextChunk();
  };
}
