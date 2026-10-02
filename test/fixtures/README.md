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

For `test/11-mpr.test.js` (and read by `12-mpr-worker`, `13-mpr-import-ui`,
`14-mpr-replace` and `16-mpr-directory-pick`). Both encode the SAME tiny fake
Mendix app — one module ("Sales"), two entities ("Customer"/"Order") linked by
an association, a view entity ("OpenOrders") with its OQL in a separate
`DomainModels$ViewEntitySourceDocument` unit — shaped from the Mendix
metamodel's names, not copied from a real project — an access rule (including a marker-prefixed single-item
`AllowedModuleRoles` array), a folder tree (a folder inside a folder, a folder
whose name contains a slash, and an empty one), a microflow one folder down
and a page two folders down (exercises `locationOf`'s walk-up to the owning
module and the path it collects, `test/40-mpr-project-tree.test.js`), a microflow with a body —
drawn the way a real one is, with a middle point and a size on every object
and one flat `Flows` edge list carrying sides, branch values, an error outlet,
an annotation line and bezier control vectors (`test/38-mpr-flow-graph.test.js`) — a
page, an enumeration, a constant, a Java action, a published REST service, a
scheduled event, module roles, navigation home pages, and a project security
document carrying the whole Security screen — once in v1 shape (`mpr-v1.db`'s
`Unit` table has an inline `Contents` BLOB column) and once in v2 shape
(`mpr-v2.db`'s `Unit` table has no `Contents` column; each unit's BSON body
lives in `mpr-v2-contents.json`, keyed by the same `xx/yy/guid.mxunit`
relative path a real `mprcontents/` folder would use, base64-encoded — an
in-memory stand-in for real files, since the actual `File`-reading path is
exercised end to end by `test/13-mpr-import-ui.test.js` instead).

The one deliberate difference between the two: their `_MetaData` tables have
the two different column shapes that really exist — three columns and no
`_FormatVersion` for the Mendix 9 file, four columns for the Mendix 11 one —
and only the v2 file has a `_Transaction` table, because only a v2-era
project does. Both shapes then have to come out as the same model.

Regenerate with:

```sh
node test/fixtures/build-mpr-fixtures.js
```

That script (committed next to these files) uses nothing but Node's own
stdlib — `node:sqlite` for the databases, plus a ~60-line BSON encoder
mirroring `public/bson.js`'s decoder. It is never run by `npm test`.
