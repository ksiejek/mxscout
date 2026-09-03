/* MxScout — a BSON decoder, for the `Contents` blob inside a .mpr.
 *
 * Mendix stores every model document as BSON. MxSonar reaches for the `bson`
 * package; we cannot, and do not need to: this decodes the subset Mendix
 * actually writes, in about a hundred and fifty lines you can read in one
 * sitting. That is the whole argument of this project applied to one more
 * dependency.
 *
 * DECODE ONLY. There is no encoder here and there should never be one —
 * MxScout does not write .mpr files, and an encoder would be the first step
 * towards something that could.
 *
 * Everything is little-endian. A document is a length, a run of elements, and
 * a zero byte; every element is a type byte, a NUL-terminated name, and a
 * value whose shape the type decides. Arrays are documents whose keys are
 * "0", "1", "2" — which is why they cost the same to read and why Mendix's
 * habit of putting a marker in slot 0 (see mpr.js) is invisible at this level.
 *
 * It runs in a Worker as well as on the page, so it touches no DOM and no
 * globals beyond TextDecoder.
 */
(function (root) {
  'use strict';

  var utf8 = new TextDecoder('utf-8');

  // BSON types Mendix writes. Anything else is a decoding error rather than a
  // guess: silently returning null for an unknown type would turn a format
  // change into missing model data that nobody notices.
  var DOUBLE = 0x01, STRING = 0x02, DOCUMENT = 0x03, ARRAY = 0x04, BINARY = 0x05,
      UNDEFINED = 0x06, OBJECT_ID = 0x07, BOOLEAN = 0x08, DATE = 0x09, NULL = 0x0A,
      REGEX = 0x0B, INT32 = 0x10, TIMESTAMP = 0x11, INT64 = 0x12, DECIMAL128 = 0x13,
      MIN_KEY = 0xFF, MAX_KEY = 0x7F;

  function Reader(bytes) {
    this.b = bytes;
    this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.at = 0;
  }
  Reader.prototype.need = function (n, what) {
    if (this.at + n > this.b.length) {
      throw new Error('BSON ended in the middle of ' + what + ' at byte ' + this.at + '.');
    }
  };
  Reader.prototype.int32 = function () {
    this.need(4, 'a 32-bit integer');
    var n = this.v.getInt32(this.at, true);
    this.at += 4;
    return n;
  };
  Reader.prototype.int64 = function () {
    this.need(8, 'a 64-bit integer');
    var n = this.v.getBigInt64(this.at, true);
    this.at += 8;
    // Model documents hold ids and small counts, never quantities that need
    // more than 53 bits — but say so rather than quietly losing precision.
    if (n > 9007199254740991n || n < -9007199254740991n) return n;
    return Number(n);
  };
  Reader.prototype.double = function () {
    this.need(8, 'a double');
    var n = this.v.getFloat64(this.at, true);
    this.at += 8;
    return n;
  };
  Reader.prototype.bytes = function (n, what) {
    this.need(n, what);
    var out = this.b.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  };
  // A C string: NUL-terminated, used for element names and regex parts.
  Reader.prototype.cstring = function () {
    var start = this.at;
    while (this.at < this.b.length && this.b[this.at] !== 0) this.at++;
    if (this.at >= this.b.length) throw new Error('BSON ended inside a name at byte ' + start + '.');
    var s = utf8.decode(this.b.subarray(start, this.at));
    this.at++; // the NUL
    return s;
  };
  // A BSON string: a length that INCLUDES its own trailing NUL.
  Reader.prototype.string = function () {
    var len = this.int32();
    if (len < 1) throw new Error('BSON string has a negative length at byte ' + (this.at - 4) + '.');
    var raw = this.bytes(len, 'a string');
    return utf8.decode(raw.subarray(0, len - 1));
  };

  // Real .mpr documents are only a handful of levels deep; nothing legitimate
  // approaches this. The cap is here so a malformed or pathological blob turns
  // into a clear error instead of a JS stack overflow — the one unbounded path
  // an otherwise byte-bounded decoder would still have.
  var MAX_DEPTH = 200;

  function readDocument(r, asArray, depth) {
    depth = depth || 0;
    if (depth > MAX_DEPTH) throw new Error('BSON document is nested deeper than ' + MAX_DEPTH + ' levels.');
    var start = r.at;
    var len = r.int32();
    if (len < 5) throw new Error('BSON document claims ' + len + ' bytes, which is too few.');
    var end = start + len;
    if (end > r.b.length) throw new Error('BSON document claims ' + len + ' bytes but only ' + (r.b.length - start) + ' remain.');

    var out = asArray ? [] : {};
    for (;;) {
      if (r.at >= end) throw new Error('BSON document is missing its terminator.');
      var type = r.b[r.at++];
      if (type === 0) break; // the document's own terminator
      var name = r.cstring();
      var value = readValue(r, type, name, depth);
      if (asArray) out.push(value);
      else out[name] = value;
    }
    if (r.at !== end) {
      // Trust the declared length over the walk: a mismatch means this reader
      // and the writer disagree about a type, and continuing from the wrong
      // offset would produce confident nonsense.
      throw new Error('BSON document ended at byte ' + r.at + ' but declared it would end at ' + end + '.');
    }
    return out;
  }

  function readValue(r, type, name, depth) {
    switch (type) {
      case DOUBLE: return r.double();
      case STRING: return r.string();
      case DOCUMENT: return readDocument(r, false, (depth || 0) + 1);
      case ARRAY: return readDocument(r, true, (depth || 0) + 1);
      case BINARY: {
        var len = r.int32();
        if (len < 0) throw new Error('BSON binary "' + name + '" has a negative length.');
        var subtype = r.bytes(1, 'a binary subtype')[0];
        // Subtype 2 wrapped the payload in a second length. Deprecated for
        // over a decade, but a .mpr written by an old Studio Pro may still
        // carry one, and reading it as raw bytes would be wrong by four.
        if (subtype === 0x02) {
          var inner = r.int32();
          return { $binary: r.bytes(inner, 'a binary payload').slice(), subtype: subtype };
        }
        return { $binary: r.bytes(len, 'a binary payload').slice(), subtype: subtype };
      }
      case UNDEFINED: return undefined;
      case OBJECT_ID: return { $oid: r.bytes(12, 'an ObjectId').slice() };
      case BOOLEAN: {
        var b = r.bytes(1, 'a boolean')[0];
        return b !== 0;
      }
      case DATE: {
        var ms = r.int64();
        return new Date(typeof ms === 'bigint' ? Number(ms) : ms);
      }
      case NULL: return null;
      case REGEX: return { $regex: r.cstring(), $options: r.cstring() };
      case INT32: return r.int32();
      case TIMESTAMP: { r.bytes(8, 'a timestamp'); return null; }
      case INT64: return r.int64();
      case DECIMAL128: return { $decimal128: r.bytes(16, 'a decimal128').slice() };
      case MIN_KEY: return { $minKey: 1 };
      case MAX_KEY: return { $maxKey: 1 };
      default:
        throw new Error('BSON type 0x' + type.toString(16) + ' on "' + name + '" is not one this reader knows.');
    }
  }

  function decode(bytes) {
    if (!bytes || !bytes.length) throw new Error('There is nothing to decode.');
    return readDocument(new Reader(bytes), false, 0);
  }

  root.MxBson = { decode: decode };
})(typeof self !== 'undefined' ? self : this);
