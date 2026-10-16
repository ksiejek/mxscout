/* MxScout — the encrypted package: how a project travels.
 *
 * A developer packs a project for a tester; the tester needs an access code
 * that came by a different channel to open it. What is protected here is the
 * file IN TRANSIT — mail, Teams, a network share. Once imported, the model and
 * the comments sit unencrypted in the browser's own database, which is a
 * deliberate choice recorded in the ROADMAP and stated on the About page: the
 * threat is a file travelling, not the tester's own browser profile.
 *
 * Everything below is WebCrypto. No cryptography is implemented here and no
 * library is pulled in — the browser does the work, and the only thing this
 * file decides is how the pieces are arranged (format 2, since 2026-10-15):
 *
 *   payload JSON -> gzip -> AES-256-GCM with the PROJECT KEY -> base64 -> a JSON envelope
 *   access code  -> PBKDF2-HMAC-SHA256 (600k) -> an AES-KW key that wraps the project key
 *
 * The project key is a random 256-bit AES-GCM key, one per project, made by
 * whoever packs the project first and kept in that browser (store.js, never in
 * the project folder). The envelope carries it wrapped by the code, and a
 * random key id beside it, in the clear. Whoever opens a package with the code
 * keeps the key too — so the next package of the same project, whoever packed
 * it, opens in that browser without the code: its key id matches a key kept
 * there, and the key decrypts it (Karol, 2026-10-15: one person updates the
 * descriptions, the others import, and nobody types a code twice). The first
 * package of a project into a browser always needs the code; a kept key that
 * does not open a package falls back to asking for it. The key id is the
 * payload's additional authenticated data, so it cannot be swapped onto
 * another package. Format 1 — the code-derived key encrypting the payload
 * directly — still opens, with the code.
 *
 * The envelope is JSON rather than an opaque binary blob ON PURPOSE, and the
 * reason is the security review: a reviewer opens the file in a text editor
 * and sees the algorithm names and no plaintext, which they can check in
 * seconds. An unreadable container looks worse to that audience, not better.
 * The plaintext half carries no application name and no project name — the
 * filename is the only thing about the contents that travels in the clear.
 *
 * WebCrypto exists only in a secure context. http://127.0.0.1 counts, which is
 * to say this works because MxScout is on loopback.
 */
(function () {
  'use strict';

  var FORMAT = 'mxscout-package';
  // 2: the payload is encrypted with the project key, which travels wrapped by the code. 1: by the code itself.
  var VERSION = 2;
  // OWASP's current figure for PBKDF2-HMAC-SHA256. Measured at ~270ms in
  // Chromium here, which is a fine price for an import. With a generated
  // 100-bit code the iteration count is not what stands between an attacker
  // and the payload — it is insurance against the day someone decides users
  // may type their own code.
  var ITERATIONS = 600000;
  // A ceiling on the iteration count MxScout will honour from an OPENED
  // package. The key is derived locally, so a corrupt or hostile envelope that
  // asked for a billion rounds would freeze the tab on import rather than cost
  // whoever wrote it anything. Generous headroom over ITERATIONS (a few
  // seconds of work at most), refusing anything absurd above it.
  var MAX_ITERATIONS = 10000000;

  // Crockford base32: no I, L, O or U, so nothing can be misheard over a
  // phone or mistyped from a sticky note. 256 is divisible by 32, so taking
  // a random byte modulo 32 is uniform — no modulo bias to correct for.
  var ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  var CODE_GROUPS = 4;
  var CODE_GROUP_LEN = 5; // 20 chars x 5 bits = exactly 100 bits

  function available() {
    return !!(window.crypto && window.crypto.subtle && window.TextEncoder);
  }

  // ---------- the access code ----------
  function generateCode() {
    var bytes = new Uint8Array(CODE_GROUPS * CODE_GROUP_LEN);
    window.crypto.getRandomValues(bytes);
    var chars = [];
    for (var i = 0; i < bytes.length; i++) chars.push(ALPHABET.charAt(bytes[i] % 32));
    var groups = [];
    for (var g = 0; g < CODE_GROUPS; g++) {
      groups.push(chars.slice(g * CODE_GROUP_LEN, (g + 1) * CODE_GROUP_LEN).join(''));
    }
    return 'MXS-' + groups.join('-');
  }

  // Someone retyping a code from a chat window will paste it with spaces, in
  // lower case, or having read 0 as O. Normalising here means they get a
  // "wrong code" message only when the code is actually wrong.
  function normalizeCode(raw) {
    var upper = String(raw || '').toUpperCase();
    var out = '';
    for (var i = 0; i < upper.length; i++) {
      var c = upper.charAt(i);
      if (c === 'O') c = '0';
      else if (c === 'I' || c === 'L') c = '1';
      else if (c === 'U') c = 'V';
      if (ALPHABET.indexOf(c) !== -1) out += c;
    }
    // "MXS" itself normalises into the alphabet, so strip the prefix after
    // normalising rather than before.
    if (out.indexOf('MXS') === 0) out = out.slice(3);
    return out;
  }

  function codeLooksComplete(raw) {
    return normalizeCode(raw).length === CODE_GROUPS * CODE_GROUP_LEN;
  }

  // ---------- bytes and base64 ----------
  // fromCharCode.apply blows the call stack on a multi-megabyte array, so
  // this walks the buffer in chunks.
  function bytesToBase64(bytes) {
    var chunk = 0x8000;
    var parts = [];
    for (var i = 0; i < bytes.length; i += chunk) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunk)));
    }
    return window.btoa(parts.join(''));
  }

  function base64ToBytes(b64) {
    var binary = window.atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // ---------- compression ----------
  // Baseline since 2023, but a browser without it is not a reason to refuse
  // to pack: the envelope records which of the two happened, so an older
  // reader still knows what it is holding.
  function canCompress() {
    return typeof window.CompressionStream === 'function' && typeof window.DecompressionStream === 'function';
  }

  function gzip(bytes) {
    if (!canCompress()) return Promise.resolve({ bytes: bytes, compression: 'none' });
    var stream = new Blob([bytes]).stream().pipeThrough(new window.CompressionStream('gzip'));
    return new Response(stream).arrayBuffer().then(function (buf) {
      return { bytes: new Uint8Array(buf), compression: 'gzip' };
    });
  }

  function gunzip(bytes, compression) {
    if (compression !== 'gzip') return Promise.resolve(bytes);
    if (!canCompress()) {
      return Promise.reject(new Error('This package is compressed and this browser cannot decompress it. Open it in a current browser.'));
    }
    var stream = new Blob([bytes]).stream().pipeThrough(new window.DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
  }

  // ---------- key derivation ----------
  // alg 'AES-GCM': the key that encrypts a format-1 payload. 'AES-KW': the key that wraps the project key (format 2).
  function deriveKey(code, salt, iterations, alg) {
    var normalized = normalizeCode(code);
    var material = new TextEncoder().encode(normalized);
    var kw = alg === 'AES-KW';
    return window.crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return window.crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
          base,
          { name: kw ? 'AES-KW' : 'AES-GCM', length: 256 },
          false,
          kw ? ['wrapKey', 'unwrapKey'] : ['encrypt', 'decrypt']
        );
      });
  }

  // ---------- the project key ----------
  // { id, key }: a random id (128 bits, base64url — it names no project) and a random AES-256-GCM key.
  // Extractable, and only so that each new package can wrap it again under a new code (wrapKey needs it).
  function base64url(bytes) { return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function newProjectKey() {
    if (!available()) return Promise.reject(new Error('This browser has no WebCrypto, so MxScout cannot make a package here.'));
    return window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']).then(function (key) {
      return { id: base64url(window.crypto.getRandomValues(new Uint8Array(16))), key: key };
    });
  }
  var KEY_ID = /^[A-Za-z0-9_-]{16,64}$/;
  // The key id a package names (format 2), or null — for a format-1 package, or anything else.
  function keyIdOf(envelope) {
    var k = envelope && envelope.version === 2 && envelope.key;
    return k && typeof k.id === 'string' && KEY_ID.test(k.id) ? k.id : null;
  }
  function aad(id) { return new TextEncoder().encode(FORMAT + ' 2 ' + id); }

  // ---------- pack / open ----------
  // projectKey: { id, key } — the project's own (transfer.js keeps it); without one, a key made for this package alone.
  function pack(payload, code, projectKey) {
    if (!available()) return Promise.reject(new Error('This browser has no WebCrypto, so MxScout cannot encrypt a package here.'));
    var salt = window.crypto.getRandomValues(new Uint8Array(16));
    var iv = window.crypto.getRandomValues(new Uint8Array(12));
    var plain = new TextEncoder().encode(JSON.stringify(payload));

    return Promise.all([gzip(plain), projectKey ? Promise.resolve(projectKey) : newProjectKey(), deriveKey(code, salt, ITERATIONS, 'AES-KW')]).then(function (got) {
      var compressed = got[0], pk = got[1], kek = got[2];
      return Promise.all([
        window.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv, additionalData: aad(pk.id) }, pk.key, compressed.bytes),
        window.crypto.subtle.wrapKey('raw', pk.key, kek, 'AES-KW')
      ]).then(function (out) {
        return {
          format: FORMAT,
          version: VERSION,
          note: 'Encrypted MxScout project. It needs MxScout and the access code from whoever sent it — or, in a browser that opened a package of this project before, the key it kept then. There is no way to recover the contents without one of the two.',
          createdAt: new Date().toISOString(),
          // The code derives the key that unwraps the project key; the project key decrypts the payload.
          kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: bytesToBase64(salt) },
          key: { id: pk.id, wrap: 'AES-KW', wrapped: bytesToBase64(new Uint8Array(out[1])) },
          cipher: { name: 'AES-GCM', iv: bytesToBase64(iv), aad: 'key id' },
          compression: compressed.compression,
          payload: bytesToBase64(new Uint8Array(out[0]))
        };
      });
    });
  }

  // Format 1 — the payload encrypted with the code-derived key itself, no project key. Not what a package
  // is made with any more; kept for a file that must open with its code alone and nothing else, such as
  // Developer tools' encrypted HTML report, whose page decrypts it by itself.
  function packCodeOnly(payload, code) {
    if (!available()) return Promise.reject(new Error('This browser has no WebCrypto, so MxScout cannot encrypt here.'));
    var salt = window.crypto.getRandomValues(new Uint8Array(16));
    var iv = window.crypto.getRandomValues(new Uint8Array(12));
    var plain = new TextEncoder().encode(JSON.stringify(payload));
    return Promise.all([gzip(plain), deriveKey(code, salt, ITERATIONS, 'AES-GCM')]).then(function (got) {
      return window.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, got[1], got[0].bytes).then(function (cipherBuf) {
        return {
          format: FORMAT,
          version: 1,
          note: 'Encrypted MxScout file. It needs the access code from whoever sent it. There is no way to recover the contents without that code.',
          createdAt: new Date().toISOString(),
          kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: bytesToBase64(salt) },
          cipher: { name: 'AES-GCM', iv: bytesToBase64(iv) },
          compression: got[0].compression,
          payload: bytesToBase64(new Uint8Array(cipherBuf))
        };
      });
    });
  }

  function looksLikePackage(text) {
    // Cheap enough to run on the first few hundred characters of a dropped
    // file, before committing to parsing megabytes of it.
    return String(text).slice(0, 400).indexOf('"' + FORMAT + '"') !== -1;
  }

  // What every open checks first, whichever way it opens: the format, the version, the algorithms, the bytes.
  // Returns { salt, iv, payload, wrapped, iterations } or throws a sentence.
  function checked(envelope) {
    if (!available()) throw new Error('This browser has no WebCrypto, so MxScout cannot open a package here.');
    if (!envelope || envelope.format !== FORMAT) throw new Error('That file is not an MxScout package.');
    if (typeof envelope.version !== 'number' || envelope.version > VERSION) {
      throw new Error('That package was written by a newer MxScout (format version ' + envelope.version + '). Update MxScout and try again.');
    }
    if (envelope.version !== 1 && envelope.version !== 2) throw new Error('That package uses an encryption scheme this version does not know.');
    var kdf = envelope.kdf || {};
    var cipher = envelope.cipher || {};
    var key = envelope.key || {};
    if (kdf.name !== 'PBKDF2' || cipher.name !== 'AES-GCM' || (envelope.version === 2 && (key.wrap !== 'AES-KW' || !keyIdOf(envelope)))) {
      throw new Error('That package uses an encryption scheme this version does not know.');
    }
    var out = {};
    try {
      out.salt = base64ToBytes(kdf.salt);
      out.iv = base64ToBytes(cipher.iv);
      out.payload = base64ToBytes(envelope.payload);
      if (envelope.version === 2) out.wrapped = base64ToBytes(key.wrapped);
    } catch (e) {
      throw new Error('That package is damaged — its contents could not be read.');
    }
    // The envelope names its own iteration count, but the key is still derived
    // HERE — so an absurd value is a way to freeze this tab, not a cost to
    // whoever wrote the package. Absent or malformed falls back to our own
    // figure; a present-but-unreasonable value is refused outright rather than
    // handed to a KDF that would run for minutes.
    out.iterations = ITERATIONS;
    if (typeof kdf.iterations === 'number' && Number.isFinite(kdf.iterations)) {
      if (kdf.iterations < 1 || kdf.iterations > MAX_ITERATIONS) throw new Error('That package asks for an unreasonable amount of work to open and was refused.');
      out.iterations = kdf.iterations;
    }
    return out;
  }

  function readPayload(plainBuf, envelope) {
    // Reaching here means the GCM tag verified, so the key was right and the
    // bytes are intact. A wrong key cannot get this far — there is no path
    // where MxScout shows a half-decrypted model.
    return gunzip(new Uint8Array(plainBuf), envelope.compression).then(function (plainBytes) {
      try {
        return JSON.parse(new TextDecoder().decode(plainBytes));
      } catch (e) {
        throw new Error('That package opened but its contents could not be read.');
      }
    });
  }
  var DAMAGED = 'That package was changed or damaged after it was made — it does not open.';
  var WRONG_CODE = 'That access code does not open this package. Check it with whoever sent you the file — a package cannot be opened without it.';

  // With the access code: { payload, projectKey } — projectKey ({ id, key }, the key unwrapped) for a format-2
  // package, for the browser to keep; null for format 1, which has none.
  function openWithCode(envelope, code) {
    var c;
    try { c = checked(envelope); } catch (e) { return Promise.reject(e); }
    if (envelope.version === 1) {
      return deriveKey(code, c.salt, c.iterations, 'AES-GCM').then(function (key) {
        return window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: c.iv }, key, c.payload);
      }).then(function (plainBuf) { return readPayload(plainBuf, envelope); }, function () { throw new Error(WRONG_CODE); })
        .then(function (payload) { return { payload: payload, projectKey: null }; });
    }
    var id = keyIdOf(envelope);
    // AES-KW checks its own integrity: a wrong code fails here, before the payload is touched.
    return deriveKey(code, c.salt, c.iterations, 'AES-KW').then(function (kek) {
      return window.crypto.subtle.unwrapKey('raw', c.wrapped, kek, 'AES-KW', { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    }).then(function (key) {
      return window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: c.iv, additionalData: aad(id) }, key, c.payload).then(function (plainBuf) {
        return readPayload(plainBuf, envelope).then(function (payload) { return { payload: payload, projectKey: { id: id, key: key } }; });
      }, function () { throw new Error(DAMAGED); });
    }, function () { throw new Error(WRONG_CODE); });
  }

  // With a project key this browser kept ({ id, key }): the payload — or a rejection with .wrongKey when that key
  // does not open it (another package, or a key forgotten and made again), and the caller asks for the code instead.
  function openWithKey(envelope, projectKey) {
    var c;
    try { c = checked(envelope); } catch (e) { return Promise.reject(e); }
    var id = keyIdOf(envelope);
    if (!id || !projectKey || projectKey.id !== id) { var e0 = new Error('This browser keeps no key for that package.'); e0.wrongKey = true; return Promise.reject(e0); }
    return window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: c.iv, additionalData: aad(id) }, projectKey.key, c.payload).then(function (plainBuf) {
      return readPayload(plainBuf, envelope);
    }, function () {
      var e = new Error('The key this browser keeps for this project does not open that package.');
      e.wrongKey = true;
      throw e;
    });
  }

  // The payload alone, with the code — as before format 2 (and what the suite's refusals check).
  function open(envelope, code) {
    return openWithCode(envelope, code).then(function (r) { return r.payload; });
  }
  window.MxCrypto = {
    available: available,
    generateCode: generateCode,
    normalizeCode: normalizeCode,
    codeLooksComplete: codeLooksComplete,
    pack: pack,
    packCodeOnly: packCodeOnly,
    open: open,
    openWithCode: openWithCode,
    openWithKey: openWithKey,
    newProjectKey: newProjectKey,
    keyIdOf: keyIdOf,
    looksLikePackage: looksLikePackage,
    FORMAT: FORMAT,
    VERSION: VERSION,
    ITERATIONS: ITERATIONS
  };
})();
