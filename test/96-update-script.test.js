/* Updating MxScout from git (update.sh, start.sh --update; Karol, 2026-10-16: "an update from git, without
 * breaking the rules"). The app never runs git; the script is the step a person takes. Run here against a
 * repository made for it:
 *  - behind the repository: it pulls, and says the version before and after;
 *  - up to date: it says so;
 *  - a copy with changes of its own: it refuses, says why, and changes nothing;
 *  - a folder that is not a git clone: it says so.
 * Windows has Update.cmd, which this cannot run; it is checked for what it says and does. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

module.exports = async function (t) {
  const root = path.join(__dirname, '..');
  const cmd = fs.readFileSync(path.join(root, 'Update.cmd'), 'utf8');
  t.ok(/git pull --ff-only/.test(cmd) && /--untracked-files=no/.test(cmd) && !/reset|stash|--force|-f\b/.test(cmd.replace(/^rem .*$/gm, '')), 'Update.cmd pulls fast-forward only, refuses local changes, never resets, stashes or forces');
  const sh = fs.readFileSync(path.join(root, 'update.sh'), 'utf8');
  t.ok(!/git (reset|stash|checkout|clean)|--force/.test(sh.replace(/^#.*$/gm, '')), 'update.sh never resets, stashes, checks out, cleans or forces');
  t.ok(/\.\/update\.sh/.test(fs.readFileSync(path.join(root, 'start.sh'), 'utf8')), 'start.sh --update runs it first');
  // Executable as git keeps it, so ./update.sh runs on a fresh clone (as test 95 checks install.sh).
  const mode = spawnSync('git', ['ls-files', '-s', 'update.sh'], { cwd: root, encoding: 'utf8' });
  if (mode.status === 0 && mode.stdout) t.ok(/^100755 /.test(mode.stdout), 'update.sh is executable in git: ' + mode.stdout.slice(0, 6));
  const git = spawnSync('git', ['--version']);
  if (process.platform === 'win32' || git.status !== 0) { t.ok(true, 'no sh or git here: the run is left to another machine'); return; }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mxscout-update-'));
  const g = (cwd, args) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@example.com', '-c', 'init.defaultBranch=main'].concat(args), { cwd, stdio: 'pipe' }).toString();
  const origin = path.join(tmp, 'origin'), copy = path.join(tmp, 'copy');
  fs.mkdirSync(origin);
  g(origin, ['init', '-q']);
  fs.copyFileSync(path.join(root, 'update.sh'), path.join(origin, 'update.sh'));
  fs.chmodSync(path.join(origin, 'update.sh'), 0o755);
  fs.writeFileSync(path.join(origin, 'package.json'), '{\n  "name": "mxscout",\n  "version": "1.0.0"\n}\n');
  g(origin, ['add', '.']); g(origin, ['commit', '-q', '-m', 'one']);
  g(tmp, ['clone', '-q', origin, copy]);
  fs.writeFileSync(path.join(origin, 'package.json'), '{\n  "name": "mxscout",\n  "version": "1.1.0"\n}\n');
  g(origin, ['commit', '-q', '-am', 'two']);
  const run = (cwd) => spawnSync('sh', [path.join(cwd, 'update.sh')], { cwd, encoding: 'utf8', env: Object.assign({}, process.env, { GIT_CONFIG_NOSYSTEM: '1' }) });

  const up = run(copy);
  t.ok(up.status === 0 && /MxScout updated: 1\.0\.0 → 1\.1\.0/.test(up.stdout), 'behind the repository: it pulls, and says the version before and after: ' + up.stdout.trim().split('\n').pop());
  const same = run(copy);
  t.ok(same.status === 0 && /MxScout 1\.1\.0 — already the newest version on this branch/.test(same.stdout), 'up to date: it says so');
  fs.writeFileSync(path.join(origin, 'package.json'), '{\n  "name": "mxscout",\n  "version": "1.2.0"\n}\n');
  g(origin, ['commit', '-q', '-am', 'three']);
  fs.writeFileSync(path.join(copy, 'package.json'), '{\n  "name": "mxscout",\n  "version": "1.1.0-mine"\n}\n');
  const mine = run(copy);
  t.ok(mine.status === 1 && /changes of its own/.test(mine.stderr) && /1\.1\.0-mine/.test(fs.readFileSync(path.join(copy, 'package.json'), 'utf8')), 'a copy with changes of its own: refused, said why, nothing changed');
  const plain = path.join(tmp, 'plain');
  fs.mkdirSync(plain);
  fs.copyFileSync(path.join(root, 'update.sh'), path.join(plain, 'update.sh'));
  const notGit = run(plain);
  t.ok(notGit.status === 1 && /not a git clone/.test(notGit.stderr), 'a folder that is not a git clone: it says so');
  fs.rmSync(tmp, { recursive: true, force: true });
};
