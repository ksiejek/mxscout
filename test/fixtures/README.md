# Fixtures

Binary test fixtures, committed once. Built with a system tool as a one-time,
dev-machine-only step — never invoked while `npm test` runs, so this stays
inside the zero-dependency rule (same role as a hand-crafted PNG fixture for
an image decoder).

## `sqlite-basic.db`

A small SQLite database for `test/10-sqlite.test.js`, built with Python's
stdlib `sqlite3` module (equally reproducible with the `sqlite3` CLI). Two
tables:

- **`Widget`** (`Id INTEGER, Name TEXT, Note TEXT, Data BLOB`) — 1204 rows,
  forcing multiple leaf pages plus an interior page, a NULL row (`Id=9001`),
  a unicode row (`Id=9002`), a ~20000-byte BLOB that overflows onto a chain
  of overflow pages (`Id=9003`), and a negative INTEGER (`Id=-42`).
- **`UnitLike`** — declared the same multi-line way, with the same inline
  `BLOB PRIMARY KEY NOT NULL`, that a real `.mpr`'s own `Unit` table uses
  (confirmed against a real project's `sqlite_master.sql`) — the
  column-name parser has to survive that shape, not just a simple one-line
  `CREATE TABLE`.

Regenerate with:

```python
import sqlite3, os
path = "sqlite-basic.db"
if os.path.exists(path): os.remove(path)
con = sqlite3.connect(path)
con.execute("PRAGMA page_size=4096")
cur = con.cursor()
cur.execute("CREATE TABLE Widget (Id INTEGER, Name TEXT, Note TEXT, Data BLOB)")
for i in range(1, 1201):
    name = "Widget-%d" % i
    note = ("row number %d with some padding text to bulk up the record a bit " % i) * 2
    cur.execute("INSERT INTO Widget (Id, Name, Note, Data) VALUES (?, ?, ?, ?)", (i, name, note, None))
cur.execute("INSERT INTO Widget (Id, Name, Note, Data) VALUES (?, ?, ?, ?)", (9001, None, None, None))
cur.execute("INSERT INTO Widget (Id, Name, Note, Data) VALUES (?, ?, ?, ?)", (9002, "Zażółć gęślą jaźń — 你好", "emoji: 🎉🚀", None))
big = bytes([(i * 7 + 3) % 256 for i in range(20000)])
cur.execute("INSERT INTO Widget (Id, Name, Note, Data) VALUES (?, ?, ?, ?)", (9003, "BigBlob", "has an overflow chain", big))
cur.execute("INSERT INTO Widget (Id, Name, Note, Data) VALUES (?, ?, ?, ?)", (-42, "Neg", "x", None))
cur.execute("""CREATE TABLE UnitLike
            (
                UnitID BLOB PRIMARY KEY NOT NULL,
                ContainerID BLOB,
                ContainmentName TEXT,
                TreeConflict LONG,
                ContentsHash TEXT,
                ContentsConflicts TEXT
            )""")
cur.execute("INSERT INTO UnitLike VALUES (?, ?, ?, ?, ?, ?)",
    (bytes(range(0x01, 0x11)), bytes(range(0x11, 0x21)), 'DomainModel', 0, 'abc123', None))
con.commit()
con.close()
```

## `mpr-v1.db` / `mpr-v2.db` / `mpr-v2-contents.json`

For `test/11-mpr.test.js`. Both encode the SAME tiny fake Mendix app — one
module ("Sales"), two entities ("Customer"/"Order") linked by an association,
an access rule (including a marker-prefixed single-item `AllowedModuleRoles`
array — the exact shape that once silently emptied a one-role list, see
`payload()` in `public/mpr.js`), a microflow nested two levels deep under a
Folder unit (exercises `resolveOwningModule`'s walk-up), and one user role —
once in v1 shape (`mpr-v1.db`'s `Unit` table has an inline `Contents` BLOB
column) and once in v2 shape (`mpr-v2.db`'s `Unit` table has no `Contents`
column; the four units' BSON bodies live in `mpr-v2-contents.json`, keyed by
the same `xx/yy/guid.mxunit` relative path a real `mprcontents/` folder would
use, base64-encoded — an in-memory stand-in for real files, since the actual
`File`-reading path is exercised end to end by
`test/12-mpr-import-ui.test.js` instead).

Regenerated with a small one-off Python script that hand-encodes each BSON
document (a ~40-line encoder mirroring `public/bson.js`'s decoder) and writes
both `Unit` tables via the stdlib `sqlite3` module — see the git history of
this file for the exact script if it ever needs regenerating.
