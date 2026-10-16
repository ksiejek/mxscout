/* Installing the two Claude skills on a person's own machine (skills/install.sh · skills/install.ps1).
 *
 * Karol, 2026-10-15: someone with neither a Mendix project that carries the skills in .claude/skills/ nor
 * Karol's private Skills repository installs them from a clone of this one, step by step. What is checked:
 * both scripts are here and the README and the team guide point to them; install.sh, run against a
 * temporary home, links both folders side by side, backs up a folder that was already there instead of
 * deleting it, copies with --copy and replaces its own copy without another backup, and touches nothing
 * else in ~/.claude. install.ps1 is not run here (no PowerShell assumed): it must exist and name the same
 * two folders and the same backup rule.
 *
 * Karol, 2026-10-15: people may use Codex instead of Claude Code. --codex installs both skills into Codex's
 * skills folder as well ($CODEX_HOME/skills, ~/.codex/skills when it is not set), by the same rules, with
 * its own backup folder beside it; --codex-only installs them there alone; with neither, nothing of Codex's
 * is touched. HOME and CODEX_HOME both point at temporary folders here, so no real one is ever written.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { readText, gitMode } = require('./helpers');

module.exports = async function (t) {
  const root = path.join(__dirname, '..');
  const skills = path.join(root, 'skills');
  const sh = path.join(skills, 'install.sh'), ps1 = path.join(skills, 'install.ps1');
  // Executable as git records it — mode 100755 in the index, which is what a clone gets — and, on a file
  // system that keeps the bit (not Windows), on disk too. The audit's Windows run failed here on the disk
  // check alone, with the index saying 100755 all along.
  const mode = gitMode(sh), onDisk = process.platform === 'win32' ? null : (fs.statSync(sh).mode & 0o111) !== 0;
  t.ok(fs.existsSync(sh) && fs.existsSync(ps1) && mode !== '100644' && onDisk !== false && (mode === '100755' || onDisk === true || (mode === null && onDisk === null)),
    'skills/install.sh (executable: ' + (mode ? 'mode ' + mode + ' in git' : 'no git to ask' + (onDisk === null ? ', and no bit on this file system: not checked' : '')) + (onDisk === null ? '' : ', the bit on disk ' + (onDisk ? 'set' : 'NOT set')) + ') and skills/install.ps1 are in the repository');
  const readme = readText(path.join(root, 'README.md'));
  const guide = readText(path.join(root, 'public', 'guide-team.md'));
  t.ok(/skills\/install\.sh/.test(readme) && /skills\\install\.ps1/.test(readme), 'the README says how to run them');
  t.ok(/### \d+\. Installing the skills/.test(guide) && /### \d+\. Instalacja skilli/.test(guide) && (guide.match(/skills\/install\.sh/g) || []).length >= 2 && (guide.match(/skills\\install\.ps1/g) || []).length >= 2 &&
    (guide.match(/git clone https:\/\/github\.com\/ksiejek\/mxscout\.git/g) || []).length === 2, 'the team guide has the steps, in English and in Polish');
  const ps = readText(ps1);
  t.ok(/'mendix-describe', 'mendix-assist'/.test(ps) && /\.claude\\skills-backup/.test(ps) && /\.Delete\(\)/.test(ps) && !/Remove-Item[^\n]*\$item/.test(ps),
    'install.ps1 names the same two folders, moves an old one to skills-backup, and removes a link without following it');
  t.ok(/param\(\[switch\]\$Codex, \[switch\]\$CodexOnly\)/.test(ps) && /\$env:CODEX_HOME/.test(ps) && /Join-Path \$HOME '\.codex'/.test(ps) && /Join-Path \$codexDir 'skills-backup'/.test(ps) && /Join-Path \$HOME '\.agents\\skills'/.test(ps) && /if \(-not \$CodexOnly\)/.test(ps),
    'install.ps1 takes -Codex and -CodexOnly, into ~/.agents/skills and Codex\u2019s folder from CODEX_HOME or ~/.codex, each with its own skills-backup beside it');
  t.ok(/skills\/install\.sh --codex/.test(readme) && /install\.ps1 -Codex/.test(readme) && /CODEX_HOME/.test(readme), 'the README says how to install them for Codex');
  t.ok(/\*\*Using Codex\*\*/.test(guide) && /\*\*Z Codexem\*\*/.test(guide) && (guide.match(/skills\/install\.sh --codex/g) || []).length >= 2 && (guide.match(/install\.ps1 -Codex/g) || []).length >= 2 &&
    (guide.match(/how\s+to\s+work\s+with\s+it:\s+see\s+mxscout\/AGENTS\.md/g) || []).length >= 2 && (guide.match(/Read\s+\.claude\/skills\/mendix-assist\/SKILL\.md\s+and\s+follow\s+it/g) || []).length >= 2,
    'and the team guide has Using Codex, in English and in Polish: the line for the root AGENTS.md, the sentence to tell Codex, the --codex install');

  if (process.platform === 'win32') { t.ok(true, 'install.sh is not run on Windows'); return; }
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mxscout-install-'));
  const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mxscout-codex-'));
  fs.rmdirSync(codexHome);   // its name only: the script makes it when it is asked to
  try {
    const run = (args) => spawnSync('bash', [sh].concat(args || []), { env: Object.assign({}, process.env, { HOME: home, CODEX_HOME: codexHome }), encoding: 'utf8' });
    const dest = path.join(home, '.claude', 'skills');
    // A folder of the same name already there, made by hand — and another skill, which must stay as it is.
    fs.mkdirSync(path.join(dest, 'mendix-assist'), { recursive: true });
    fs.writeFileSync(path.join(dest, 'mendix-assist', 'SKILL.md'), '# mine\n');
    fs.mkdirSync(path.join(dest, 'someone-elses'));
    fs.writeFileSync(path.join(dest, 'someone-elses', 'SKILL.md'), '# theirs\n');

    const r1 = run();
    const backups = () => fs.existsSync(path.join(home, '.claude', 'skills-backup')) ? fs.readdirSync(path.join(home, '.claude', 'skills-backup')) : [];
    const linked = ['mendix-describe', 'mendix-assist'].every((n) => fs.lstatSync(path.join(dest, n)).isSymbolicLink() && fs.realpathSync(path.join(dest, n)) === fs.realpathSync(path.join(skills, n)));
    t.ok(r1.status === 0 && linked, 'install.sh links both skills into ~/.claude/skills/, side by side: ' + (r1.stderr || '').trim());
    const b1 = backups();
    t.ok(b1.length === 1 && /^mendix-assist-\d{8}-\d{6}$/.test(b1[0]) && fs.readFileSync(path.join(home, '.claude', 'skills-backup', b1[0], 'SKILL.md'), 'utf8') === '# mine\n',
      'the folder that was there is moved to ~/.claude/skills-backup/, not deleted: ' + JSON.stringify(b1));
    t.ok(fs.readFileSync(path.join(dest, 'someone-elses', 'SKILL.md'), 'utf8') === '# theirs\n' && JSON.stringify(fs.readdirSync(path.join(home, '.claude')).sort()) === JSON.stringify(['skills', 'skills-backup']),
      'and nothing else is touched — another skill stays, nothing else in ~/.claude');
    t.ok(fs.readFileSync(path.join(dest, 'mendix-assist', 'SKILL.md'), 'utf8') === fs.readFileSync(path.join(skills, 'mendix-assist', 'SKILL.md'), 'utf8') && fs.existsSync(path.join(dest, 'mendix-assist', '..', 'mendix-describe', 'agent.js')),
      'mendix-assist finds ../mendix-describe beside it');

    const r2 = run(['--copy']);
    const copied = ['mendix-describe', 'mendix-assist'].every((n) => !fs.lstatSync(path.join(dest, n)).isSymbolicLink() && fs.existsSync(path.join(dest, n, '.installed-by-mxscout')) &&
      fs.readFileSync(path.join(dest, n, 'SKILL.md'), 'utf8') === fs.readFileSync(path.join(skills, n, 'SKILL.md'), 'utf8'));
    t.ok(r2.status === 0 && copied && backups().length === 1, '--copy replaces the links with copies — a link is not backed up');
    const r3 = run(['--copy']);
    t.ok(r3.status === 0 && backups().length === 1 && fs.existsSync(path.join(dest, 'mendix-describe', '.installed-by-mxscout')), 'run again, it replaces its own copy without another backup');
    const r4 = run();
    t.ok(r4.status === 0 && fs.lstatSync(path.join(dest, 'mendix-describe')).isSymbolicLink() && backups().length === 1, 'and back to links the same way');
    t.ok(run(['--bogus']).status === 2, 'an unknown option changes nothing and says how to call it');
    t.ok(!fs.existsSync(codexHome) && !fs.existsSync(path.join(home, '.codex')) && !fs.existsSync(path.join(home, '.agents')), 'with no --codex, nothing of Codex\u2019s is made or touched — neither ~/.codex nor ~/.agents');

    // ---- Codex: $CODEX_HOME/skills, by the same rules ----
    const cdest = path.join(codexHome, 'skills');
    const cbackups = () => fs.existsSync(path.join(codexHome, 'skills-backup')) ? fs.readdirSync(path.join(codexHome, 'skills-backup')) : [];
    fs.mkdirSync(path.join(cdest, 'mendix-describe'), { recursive: true });
    fs.writeFileSync(path.join(cdest, 'mendix-describe', 'SKILL.md'), '# mine for codex\n');
    fs.mkdirSync(path.join(cdest, 'another'));
    fs.writeFileSync(path.join(cdest, 'another', 'SKILL.md'), '# theirs\n');
    fs.writeFileSync(path.join(codexHome, 'config.toml'), 'model = "x"\n');
    const claudeBefore = fs.readdirSync(dest).sort().map((n) => n + ':' + fs.lstatSync(path.join(dest, n)).isSymbolicLink()).join();
    const r5 = run(['--codex']);
    const clinked = ['mendix-describe', 'mendix-assist'].every((n) => fs.lstatSync(path.join(cdest, n)).isSymbolicLink() && fs.realpathSync(path.join(cdest, n)) === fs.realpathSync(path.join(skills, n)));
    t.ok(r5.status === 0 && clinked && fs.lstatSync(path.join(dest, 'mendix-assist')).isSymbolicLink() && backups().length === 1,
      '--codex links both skills into $CODEX_HOME/skills/ and still into ~/.claude/skills/: ' + (r5.stderr || '').trim());
    const adest = path.join(home, '.agents', 'skills');
    t.ok(['mendix-describe', 'mendix-assist'].every((n) => fs.lstatSync(path.join(adest, n)).isSymbolicLink() && fs.realpathSync(path.join(adest, n)) === fs.realpathSync(path.join(skills, n))) &&
      JSON.stringify(fs.readdirSync(path.join(home, '.agents'))) === JSON.stringify(['skills']),
      'and into ~/.agents/skills/, where newer Codex versions look — its skills/ and nothing else there');
    const cb = cbackups();
    t.ok(cb.length === 1 && /^mendix-describe-\d{8}-\d{6}$/.test(cb[0]) && fs.readFileSync(path.join(codexHome, 'skills-backup', cb[0], 'SKILL.md'), 'utf8') === '# mine for codex\n',
      'a folder of that name already in Codex\u2019s skills is moved to its own skills-backup/, not deleted: ' + JSON.stringify(cb));
    t.ok(fs.readFileSync(path.join(cdest, 'another', 'SKILL.md'), 'utf8') === '# theirs\n' && fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8') === 'model = "x"\n' &&
      JSON.stringify(fs.readdirSync(codexHome).sort()) === JSON.stringify(['config.toml', 'skills', 'skills-backup']) && /in Codex, ask "use the mendix-assist skill"/.test(r5.stdout),
      'nothing else of Codex\u2019s is touched — another skill, its config — and it says how to check it in Codex');
    const r6 = run(['--codex-only', '--copy']);
    const ccopied = ['mendix-describe', 'mendix-assist'].every((n) => !fs.lstatSync(path.join(cdest, n)).isSymbolicLink() && fs.existsSync(path.join(cdest, n, '.installed-by-mxscout')) &&
      fs.readFileSync(path.join(cdest, n, 'SKILL.md'), 'utf8') === fs.readFileSync(path.join(skills, n, 'SKILL.md'), 'utf8'));
    const claudeAfter = fs.readdirSync(dest).sort().map((n) => n + ':' + fs.lstatSync(path.join(dest, n)).isSymbolicLink()).join();
    t.ok(r6.status === 0 && ccopied && cbackups().length === 1 && claudeAfter === claudeBefore && !/Claude Code/.test(r6.stdout),
      '--codex-only --copy copies them into Codex\u2019s folder alone — ~/.claude/skills/ as it was, no new backup: ' + claudeAfter);
    t.ok(run(['--codex-only', '--copy']).status === 0 && cbackups().length === 1, 'run again, it replaces its own copy there without another backup');
    t.ok(run(['--codex', '--codex-only']).status === 2, '--codex and --codex-only together change nothing and say how to call it');

    // ---- with no CODEX_HOME: ~/.codex ----
    const env = Object.assign({}, process.env, { HOME: home });
    delete env.CODEX_HOME;
    const r7 = spawnSync('bash', [sh, '--codex-only'], { env: env, encoding: 'utf8' });
    t.ok(r7.status === 0 && ['mendix-describe', 'mendix-assist'].every((n) => fs.lstatSync(path.join(home, '.codex', 'skills', n)).isSymbolicLink()) &&
      JSON.stringify(fs.readdirSync(path.join(home, '.codex'))) === JSON.stringify(['skills']),
      'with CODEX_HOME not set, Codex\u2019s folder is ~/.codex — its skills/ and nothing else');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(codexHome, { recursive: true, force: true });
  }
};
