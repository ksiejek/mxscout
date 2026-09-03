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
 * file decides is how the pieces are arranged:
 *
 *   payload JSON -> gzip -> AES-256-GCM -> base64 -> a JSON envelope
 *   access code  -> PBKDF2-HMAC-SHA256 (600k) -> the AES key
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
  var VERSION = 1;
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
  function deriveKey(code, salt, iterations) {
    var normalized = normalizeCode(code);
    var material = new TextEncoder().encode(normalized);
    return window.crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return window.crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      });
  }

  // ---------- pack / open ----------
  function pack(payload, code) {
    if (!available()) return Promise.reject(new Error('This browser has no WebCrypto, so MxScout cannot encrypt a package here.'));
    var salt = window.crypto.getRandomValues(new Uint8Array(16));
    var iv = window.crypto.getRandomValues(new Uint8Array(12));
    var plain = new TextEncoder().encode(JSON.stringify(payload));

    return gzip(plain).then(function (compressed) {
      return deriveKey(code, salt, ITERATIONS).then(function (key) {
        return window.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, compressed.bytes)
          .then(function (cipherBuf) {
            return {
              format: FORMAT,
              version: VERSION,
              note: 'Encrypted MxScout project. It needs MxScout and the access code from whoever sent it. There is no way to recover the contents without that code.',
              createdAt: new Date().toISOString(),
              kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: bytesToBase64(salt) },
              cipher: { name: 'AES-GCM', iv: bytesToBase64(iv) },
              compression: compressed.compression,
              payload: bytesToBase64(new Uint8Array(cipherBuf))
            };
          });
      });
    });
  }

  function looksLikePackage(text) {
    // Cheap enough to run on the first few hundred characters of a dropped
    // file, before committing to parsing megabytes of it.
    return String(text).slice(0, 400).indexOf('"' + FORMAT + '"') !== -1;
  }

  function open(envelope, code) {
    if (!available()) return Promise.reject(new Error('This browser has no WebCrypto, so MxScout cannot open a package here.'));
    if (!envelope || envelope.format !== FORMAT) {
      return Promise.reject(new Error('That file is not an MxScout package.'));
    }
    if (envelope.version > VERSION) {
      return Promise.reject(new Error('That package was written by a newer MxScout (format version ' + envelope.version + '). Update MxScout and try again.'));
    }
    var kdf = envelope.kdf || {};
    var cipher = envelope.cipher || {};
    if (kdf.name !== 'PBKDF2' || cipher.name !== 'AES-GCM') {
      return Promise.reject(new Error('That package uses an encryption scheme this version does not know.'));
    }

    var salt, iv, payload;
    try {
      salt = base64ToBytes(kdf.salt);
      iv = base64ToBytes(cipher.iv);
      payload = base64ToBytes(envelope.payload);
    } catch (e) {
      return Promise.reject(new Error('That package is damaged — its contents could not be read.'));
    }

    // The envelope names its own iteration count, but the key is still derived
    // HERE — so an absurd value is a way to freeze this tab, not a cost to
    // whoever wrote the package. Absent or malformed falls back to our own
    // figure; a present-but-unreasonable value is refused outright rather than
    // handed to a KDF that would run for minutes.
    var iterations = ITERATIONS;
    if (typeof kdf.iterations === 'number' && Number.isFinite(kdf.iterations)) {
      if (kdf.iterations < 1 || kdf.iterations > MAX_ITERATIONS) {
        return Promise.reject(new Error('That package asks for an unreasonable amount of work to open and was refused.'));
      }
      iterations = kdf.iterations;
    }
    return deriveKey(code, salt, iterations).then(function (key) {
      return window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, payload);
    }).then(function (plainBuf) {
      // Reaching here means the GCM tag verified, so the code was right and
      // the bytes are intact. A wrong code cannot get this far — there is no
      // path where MxScout shows a half-decrypted model.
      return gunzip(new Uint8Array(plainBuf), envelope.compression);
    }, function () {
      throw new Error('That access code does not open this package. Check it with whoever sent you the file — a package cannot be opened without it.');
    }).then(function (plainBytes) {
      try {
        return JSON.parse(new TextDecoder().decode(plainBytes));
      } catch (e) {
        throw new Error('That package opened but its contents could not be read.');
      }
    });
  }

  window.MxCrypto = {
    available: available,
    generateCode: generateCode,
    normalizeCode: normalizeCode,
    codeLooksComplete: codeLooksComplete,
    pack: pack,
    open: open,
    looksLikePackage: looksLikePackage,
    FORMAT: FORMAT,
    VERSION: VERSION,
    ITERATIONS: ITERATIONS
  };
})();
