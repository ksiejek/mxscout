#!/usr/bin/env node
/* NOT part of `npm test` — deliberately not named *.test.js, so test/run.js
 * never picks it up. A real Mendix project isn't something to commit into
 * this repo (size, and it's someone's actual app), so this is the way to
 * point the real parser at one anyway: a developer runs it by hand against
 * their own local project.
 *
 * Two checks:
 *  1. MxMpr.buildModel() end to end — prints the same counts a person could
 *     cross-check against `sqlite3 ... GROUP BY ContainmentName` or what
 *     they already know about the project.
 *  2. A stricter pass buildModel() itself doesn't do: try to MxBson.decode
 *     EVERY row's content, not just the ones whose $Type this app
 *     recognizes — buildModel silently skips a unit it can't read, which is
 *     the right behavior for the app but hides exactly the failures this
 *     script exists to surface.
 *
 * Usage: node test/smoke-real-mpr.js /path/to/a/mendix/project/folder
 */
'use strict';
const fs = require('fs');
const path = require('path');

global.self = global;
function loadPublic(name) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8');
  // eslint-disable-next-line no-eval
  (0, eval)(src);
}
loadPublic('sqlite.js');
loadPublic('bson.js');
loadPublic('mpr.js');

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('Usage: node test/smoke-real-mpr.js /path/to/mendix/project');
    process.exit(1);
  }
  const mprFile = fs.readdirSync(dir).find((f) => f.toLowerCase().endsWith('.mpr'));
  if (!mprFile) { console.error('No .mpr file found in ' + dir); process.exit(1); }
  const mprPath = path.join(dir, mprFile);
  const contentsDir = path.join(dir, 'mprcontents');
  const mprBuffer = fs.readFileSync(mprPath);
  const mprBytes = mprBuffer.buffer.slice(mprBuffer.byteOffset, mprBuffer.byteOffset + mprBuffer.byteLength);

  async function readContentsFile(relPath) {
    try {
      const buf = await fs.promises.readFile(path.join(contentsDir, relPath));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch (e) {
      return null;
    }
  }

  console.log('Parsing', mprPath, '...');
  const t0 = Date.now();
  const model = await global.MxMpr.buildModel({ mprBytes, readContentsFile });
  const ms = Date.now() - t0;

  console.log('');
  console.log('modules:       ', model.modules.length);
  console.log('entities:      ', model.entities.length);
  console.log('attributes:    ', model.entities.reduce((n, e) => n + e.attributes.length, 0));
  console.log('accessRules:   ', model.entities.reduce((n, e) => n + e.accessRules.length, 0));
  console.log('associations:  ', model.associations.length);
  // Association access, per rule: an association is a member of the entity
  // like an attribute is, and a rule's default member access covers it (see
  // applyAssociationDefaults). A real project is the only place to see whether
  // that expansion actually lands — a rule count far above zero here, on an
  // app whose entities have references, is the check.
  let rulesWithAssoc = 0, assocGrants = 0;
  model.entities.forEach((e) => {
    (e.accessRules || []).forEach((r) => {
      const names = Object.keys(r.assocAccess || {});
      const granted = names.filter((n) => r.assocAccess[n] === 'r' || r.assocAccess[n] === 'rw');
      if (granted.length) rulesWithAssoc++;
      assocGrants += granted.length;
    });
  });
  console.log('rules granting association access:', rulesWithAssoc, '(' + assocGrants + ' associations in total)');
  console.log('userRoles:     ', model.userRoles.length);
  console.log('microflows:    ', model.microflows.length);
  console.log('nanoflows:     ', model.nanoflows.length);
  console.log('pages:         ', model.pages.length);
  console.log('time:          ', ms + 'ms');

  // ---- stricter pass: decode every single Unit row's content, not just the
  // ones buildModel recognizes ----
  const unitTable = global.MxSqlite.readTable(mprBytes, 'Unit');
  const col = {};
  unitTable.columns.forEach((name, i) => { col[name] = i; });
  const version = ('Contents' in col) ? 1 : 2;
  const byUnitId = new Map();
  unitTable.rows.forEach((row) => { byUnitId.set(global.MxMpr.idHex(row[col.UnitID]), row); });

  let decoded = 0, empty = 0, failed = 0;
  const failures = [];
  for (const row of unitTable.rows) {
    let bytes = null;
    if (version === 1) {
      const c = row[col.Contents];
      bytes = (c && c.length) ? c : null;
    } else {
      const guid = global.MxMpr.blobToGuid(row[col.UnitID]);
      const relPath = guid.slice(0, 2) + '/' + guid.slice(2, 4) + '/' + guid + '.mxunit';
      // eslint-disable-next-line no-await-in-loop
      const buf = await readContentsFile(relPath);
      bytes = buf ? new Uint8Array(buf) : null;
    }
    if (!bytes || !bytes.length) { empty++; continue; }
    try {
      global.MxBson.decode(bytes);
      decoded++;
    } catch (e) {
      failed++;
      if (failures.length < 10) failures.push({ containmentName: row[col.ContainmentName], message: e.message });
    }
  }
  console.log('');
  console.log('strict decode pass — every Unit row, not just recognized $Types:');
  console.log('  decoded:', decoded, ' empty:', empty, ' FAILED:', failed);
  failures.forEach((f) => console.log('    -', f.containmentName, ':', f.message));

  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
