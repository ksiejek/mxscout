/* MxScout — which version of the Mendix application a model is.
 *
 * Karol, 2026-10-15: a model, and the descriptions written for it, should say
 * which version of the app they describe — so one person can bring the
 * descriptions up to date and the others can tell a newer package from an
 * older one. The version comes from the Mendix project's OWN git, read as
 * plain files from the folder the person picked: no git program, no git
 * server, no network ("nie łączymy się z żadnym gitem").
 *
 * What is read, all of it inside the picked folder's .git:
 *   HEAD                 the branch (ref: refs/heads/<name>) or a detached commit
 *   refs/heads/<name>    the branch's commit — or, when it is packed, packed-refs
 *   objects/xx/yyyy…     the commit itself, when it is stored loose: inflated with
 *                        the browser's DecompressionStream, for its date and the
 *                        first line of its message. A packed object is not read.
 *   logs/HEAD            the reflog, its last lines only: where HEAD moved and
 *                        when — the date when the commit is packed, and the moves
 *                        since an earlier version ("3 commits since").
 * Nothing is written, and the author's name and e-mail are never kept: of a
 * reflog line only the commit, the time and the message stay.
 *
 * A .git that is a FILE ("gitdir: …", a worktree or a submodule) points outside
 * the folder the person picked, which the browser cannot follow: the version is
 * then unknown, said as such, and the import goes on. So it does with no .git
 * at all, and with a .mpr picked on its own.
 *
 * The stamp, kept with the model as model.version:
 *   { commit, short, branch, date, dateFrom: 'commit'|'reflog'|null, message,
 *     folder, readAt, log: [{ c, at, msg }] }        — newest move first
 *   { commit: null, why: 'no-git'|'worktree'|'single-file'|'no-commit'|'unreadable', folder, readAt }
 */
(function () {
  'use strict';

  var HASH = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
  var LOG_KEEP = 40;          // reflog moves kept with the stamp
  var TAIL_BYTES = 256 * 1024; // the end of logs/HEAD is all that is read
  var MAX_OBJECT = 1024 * 1024;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function cut(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  // ---------- reading .git ----------
  // `src` is { kind: 'dir'|'file'|null, text(path, tail) → Promise<string|null>, bytes(path) → Promise<Uint8Array|null> },
  // paths relative to .git (for kind 'file', text('') is the .git file itself).
  function unknown(why, folder) { return { commit: null, why: why, folder: folder || null, readAt: new Date().toISOString() }; }

  function readGit(src, folder) {
    if (!src || !src.kind) return Promise.resolve(unknown('no-git', folder));
    if (src.kind === 'file') return Promise.resolve(unknown('worktree', folder));
    return src.text('HEAD').then(function (head) {
      head = String(head || '').trim();
      if (!head) return unknown('unreadable', folder);
      var ref = /^ref:\s*(refs\/\S+)$/.exec(head);
      var commitP = ref ? resolveRef(src, ref[1]) : Promise.resolve(HASH.test(head) ? head : null);
      return commitP.then(function (commit) {
        if (!commit) return unknown(ref ? 'no-commit' : 'unreadable', folder);
        var branch = ref ? ref[1].replace(/^refs\/heads\//, '') : null;
        return Promise.all([commitObject(src, commit), reflog(src)]).then(function (both) {
          var obj = both[0], log = both[1];
          var moved = log.filter(function (e) { return e.c === commit; })[0] || null;
          var fromLog = moved && /^commit/.test(moved.raw) ? moved.raw.replace(/^commit[^:]*:\s*/, '') : null;
          return {
            commit: commit, short: commit.slice(0, 7), branch: branch,
            date: obj && obj.date ? obj.date : moved ? moved.at : null,
            dateFrom: obj && obj.date ? 'commit' : moved ? 'reflog' : null,
            message: obj && obj.message ? obj.message : fromLog ? cut(fromLog, 200) : null,
            folder: folder || null, readAt: new Date().toISOString(),
            log: log.slice(0, LOG_KEEP).map(function (e) { return { c: e.c, at: e.at, msg: e.msg }; })
          };
        });
      });
    }).catch(function () { return unknown('unreadable', folder); });
  }

  function resolveRef(src, ref) {
    return src.text(ref).then(function (t) {
      t = String(t || '').trim();
      if (HASH.test(t)) return t;
      return src.text('packed-refs').then(function (packed) {
        var found = null;
        String(packed || '').split('\n').forEach(function (l) {
          var m = /^([0-9a-f]{40,64}) (\S+)$/.exec(l.trim());
          if (m && m[2] === ref && HASH.test(m[1])) found = m[1];
        });
        return found;
      });
    });
  }

  // The commit as git keeps it loose: zlib-deflated "commit <size>\0tree …\nparent …\nauthor …\ncommitter <who> <time> <tz>\n\n<message>".
  // Only the committer's time and the message's first line are kept. A packed commit: null, and the reflog says the date.
  function commitObject(src, commit) {
    if (typeof window.DecompressionStream !== 'function') return Promise.resolve(null);
    return src.bytes('objects/' + commit.slice(0, 2) + '/' + commit.slice(2)).then(function (bytes) {
      if (!bytes || !bytes.length || bytes.length > MAX_OBJECT) return null;
      var stream = new Blob([bytes]).stream().pipeThrough(new window.DecompressionStream('deflate'));
      return new Response(stream).arrayBuffer().then(function (buf) {
        var text = new TextDecoder().decode(new Uint8Array(buf));
        var nul = text.indexOf('\0');
        if (nul < 0 || !/^commit \d+$/.test(text.slice(0, nul))) return null;
        var body = text.slice(nul + 1);
        var split = body.indexOf('\n\n');
        var headers = split < 0 ? body : body.slice(0, split);
        var c = /^committer .* (\d+) [+-]\d{4}$/m.exec(headers);
        var msg = split < 0 ? '' : body.slice(split + 2).split('\n').filter(function (l) { return l.trim(); })[0] || '';
        return { date: c ? new Date(Number(c[1]) * 1000).toISOString() : null, message: msg ? cut(msg, 200) : null };
      });
    }).catch(function () { return null; });
  }

  // logs/HEAD, newest move first: "<old> <new> <name> <email> <time> <tz>\t<message>" — the name and the e-mail dropped.
  function reflog(src) {
    return src.text('logs/HEAD', TAIL_BYTES).then(function (t) {
      var lines = String(t || '').split('\n'), out = [];
      for (var i = lines.length - 1; i >= 0 && out.length < LOG_KEEP * 4; i--) {
        var m = /^[0-9a-f]{40,64} ([0-9a-f]{40,64}) .*? (\d+) [+-]\d{4}\t(.*)$/.exec(lines[i]);
        if (!m) continue;
        out.push({ c: m[1], at: new Date(Number(m[2]) * 1000).toISOString(), raw: m[3], msg: cut(m[3].replace(/^commit: /, ''), 160) });
      }
      return out;
    }).catch(function () { return []; });
  }

  // ---------- where .git comes from ----------
  // A FileSystemDirectoryHandle's '.git' entry, as found while listing the picked folder (null: none).
  function walk(dir, path) {
    var parts = String(path).split('/').filter(Boolean), name = parts.pop(), at = Promise.resolve(dir);
    parts.forEach(function (p) { at = at.then(function (d) { return d.getDirectoryHandle(p); }); });
    return at.then(function (d) { return d.getFileHandle(name); }).then(function (fh) { return fh.getFile(); });
  }
  function fileText(f, tail) {
    if (!f) return Promise.resolve(null);
    return (tail && f.size > tail ? f.slice(f.size - tail) : f).text();
  }
  function fromHandle(entry, folder) {
    if (!entry) return readGit(null, folder);
    if (entry.kind === 'file') return readGit({ kind: 'file' }, folder);
    if (typeof entry.getDirectoryHandle !== 'function') return Promise.resolve(unknown('unreadable', folder));
    return readGit({
      kind: 'dir',
      text: function (p, tail) { return walk(entry, p).then(function (f) { return fileText(f, tail); }, function () { return null; }); },
      bytes: function (p) { return walk(entry, p).then(function (f) { return f.arrayBuffer().then(function (b) { return new Uint8Array(b); }); }, function () { return null; }); }
    }, folder);
  }
  // A whole folder picked or dropped as files: [{ relativePath: '<root>/.git/HEAD', file }]; `root` is the
  // path of the folder that holds the .mpr ("OrderPortal", or "Projects/OrderPortal").
  function fromEntries(entries, root) {
    var files = {}, gitFile = false, lead = String(root || '').split('/').filter(Boolean);
    (entries || []).forEach(function (e) {
      var segs = String(e.relativePath || '').split('/').filter(Boolean);
      if (segs.length <= lead.length || segs.slice(0, lead.length).join('/') !== lead.join('/') || segs[lead.length] !== '.git') return;
      if (segs.length === lead.length + 1) gitFile = true;
      else files[segs.slice(lead.length + 1).join('/')] = e.file;
    });
    root = lead[lead.length - 1] || null;
    if (gitFile) return readGit({ kind: 'file' }, root);
    if (!Object.keys(files).length) return readGit(null, root);
    return readGit({
      kind: 'dir',
      text: function (p, tail) { return fileText(files[p] || null, tail); },
      bytes: function (p) { return files[p] ? files[p].arrayBuffer().then(function (b) { return new Uint8Array(b); }) : Promise.resolve(null); }
    }, root);
  }
  function none(why, folder) { return unknown(why, folder); }

  // ---------- what is kept, and shown ----------
  // The stamp without its reflog: what a project record, project.json and a description carry.
  function brief(v) {
    if (!v || typeof v !== 'object') return null;
    if (!v.commit) return { commit: null, why: v.why || null };
    return { commit: v.commit, short: v.short || String(v.commit).slice(0, 7), branch: v.branch || null, date: v.date || null, message: v.message || null };
  }
  // A stamp as read from a file someone else wrote (a package, a descriptions file, model.json): text, bounded.
  function clean(v, withLog) {
    if (!v || typeof v !== 'object') return null;
    var s = function (x, n) { return typeof x === 'string' && x.trim() ? cut(x, n) : null; };
    if (typeof v.commit !== 'string' || !HASH.test(v.commit)) return v.why ? { commit: null, why: s(v.why, 40) } : null;
    var out = { commit: v.commit, short: v.commit.slice(0, 7), branch: s(v.branch, 200), date: s(v.date, 40), message: s(v.message, 200) };
    if (withLog && Array.isArray(v.log)) out.log = v.log.slice(0, LOG_KEEP).filter(function (e) { return e && typeof e.c === 'string' && HASH.test(e.c); }).map(function (e) { return { c: e.c, at: s(e.at, 40), msg: s(e.msg, 160) }; });
    return out;
  }

  function day(iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return null;
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }
  var WHY = {
    'no-git': 'the Mendix project folder has no .git',
    worktree: 'the project is a git worktree, whose .git points outside the picked folder',
    'single-file': 'read from the .mpr file alone, not its folder',
    'no-commit': 'its git has no commit yet',
    unreadable: 'its .git could not be read'
  };
  function why(v) { return v && v.why && WHY[v.why] ? WHY[v.why] : 'read before MxScout recorded model versions, or from a JSON file'; }
  function known(v) { return !!(v && v.commit); }
  // "main @ a1b2c3d" — or "a1b2c3d" for a detached HEAD.
  function short(v) { return known(v) ? (v.branch ? v.branch + ' @ ' : '') + (v.short || v.commit.slice(0, 7)) : null; }
  // "main @ a1b2c3d · 14 Oct 2026 · “Fix order status”", or "version unknown — <why>".
  function label(v, opts) {
    if (!known(v)) return opts && opts.bare ? 'version unknown' : 'version unknown — ' + why(v);
    return [short(v), day(v.date), v.message && !(opts && opts.noMessage) ? '“' + v.message + '”' : null].filter(Boolean).join(' · ');
  }

  // Which of two models is the newer — a (a package's) against b (this browser's):
  // { rel: 'same'|'newer'|'older'|'unknown', by: 'commit'|'date'|'read' }. The same commit is the same version;
  // otherwise the dates decide: the commits' when both are known, else when each model was read.
  function compare(a, b, aRead, bRead) {
    if (known(a) && known(b) && a.commit === b.commit) return { rel: 'same', by: 'commit' };
    var ad = known(a) && known(b) ? Date.parse(a.date || '') : NaN, bd = known(a) && known(b) ? Date.parse(b.date || '') : NaN, by = 'date';
    if (isNaN(ad) || isNaN(bd)) { ad = Date.parse(aRead || ''); bd = Date.parse(bRead || ''); by = 'read'; }
    if (isNaN(ad) || isNaN(bd)) return { rel: 'unknown', by: null };
    if (ad === bd) return { rel: by === 'read' ? 'same' : 'unknown', by: by };
    return { rel: ad > bd ? 'newer' : 'older', by: by };
  }

  // What moved HEAD between an earlier stamp and `now`, from now's reflog: { same } when it is the same commit,
  // { commits: [{ c, short, at, msg }] } when the earlier commit is in the reflog, null when it cannot be told.
  // A checkout is not a commit, and is left out of the list.
  function since(from, now) {
    if (!known(from) || !known(now)) return null;
    if (from.commit === now.commit) return { same: true, commits: [] };
    var log = now.log || [], at = -1;
    for (var i = 0; i < log.length; i++) if (log[i].c === from.commit) { at = i; break; }
    if (at < 0) return null;
    var seen = {}, out = [];
    log.slice(0, at).forEach(function (e) {
      if (seen[e.c] || /^checkout:/.test(e.msg || '')) return;
      seen[e.c] = true;
      out.push({ c: e.c, short: e.c.slice(0, 7), at: e.at, msg: e.msg });
    });
    return { same: false, commits: out };
  }

  window.MxModelVersion = {
    fromHandle: fromHandle, fromEntries: fromEntries, none: none, readGit: readGit,
    brief: brief, clean: clean, known: known, short: short, label: label, day: day, why: why,
    compare: compare, since: since, LOG_KEEP: LOG_KEEP
  };
})();
