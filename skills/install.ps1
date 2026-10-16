# Installs MxScout's three skills, mendix-describe, mendix-assist and mxscout-project, for Claude Code on this machine - and, when
# asked, for Codex (Windows). For someone who works without a Mendix project that already carries them in
# .claude\skills\.
#
#   powershell -ExecutionPolicy Bypass -File skills\install.ps1              for Claude Code
#   powershell -ExecutionPolicy Bypass -File skills\install.ps1 -Codex       also for Codex
#   powershell -ExecutionPolicy Bypass -File skills\install.ps1 -CodexOnly   only for Codex
#
# (-ExecutionPolicy Bypass applies to that one run only; it changes no setting.) It copies both folders into
# $HOME\.claude\skills\ - with -Codex or -CodexOnly into Codex's skills folders too: $HOME\.agents\skills\ (where
# Codex looks now) and $env:CODEX_HOME\skills\ when CODEX_HOME is set (Codex's own variable), $HOME\.codex\skills\
# otherwise (the older place it still reads) - side by side, because mendix-assist uses ..\mendix-describe. To update: git pull in the MxScout
# folder, then run it again with the same option. In each skills folder it touches mendix-describe,
# mendix-assist and mxscout-project and nothing else: a link there is removed (the link only), a copy this script made is
# replaced, and any other folder there is moved to the skills-backup folder beside it
# ($HOME\.claude\skills-backup\<name>-<date>, $HOME\.agents\skills-backup\..., $HOME\.codex\skills-backup\...), never deleted.
# No dependencies, no administrator rights. MxScout itself never runs this.
param([switch]$Codex, [switch]$CodexOnly)
$ErrorActionPreference = 'Stop'

if ($Codex -and $CodexOnly) { throw 'Use -Codex or -CodexOnly, not both.' }
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$codexDir = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME '.codex' }
$mark = '.installed-by-mxscout'
$names = @('mendix-describe', 'mendix-assist', 'mxscout-project')

foreach ($name in $names) {
  if (-not (Test-Path (Join-Path (Join-Path $here $name) 'SKILL.md'))) {
    throw "No $here\$name\SKILL.md - run this script from the MxScout folder you cloned."
  }
}

function Install-Into($dest, $backup) {
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  foreach ($name in $names) {
    $src = Join-Path $here $name
    $target = Join-Path $dest $name
    if (Test-Path -LiteralPath $target) {
      $item = Get-Item -LiteralPath $target -Force
      if ($item.LinkType) {
        $item.Delete()   # a symbolic link or junction: removes the link, never what it points to
      } elseif (Test-Path -LiteralPath (Join-Path $target $mark)) {
        Remove-Item -LiteralPath $target -Recurse -Force
      } else {
        New-Item -ItemType Directory -Force -Path $backup | Out-Null
        $moved = Join-Path $backup ($name + '-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        Move-Item -LiteralPath $target -Destination $moved
        Write-Host "moved the old $name to $moved"
      }
    }
    Copy-Item -LiteralPath $src -Destination $target -Recurse
    Set-Content -LiteralPath (Join-Path $target $mark) -Value "Copied from $src by MxScout's skills\install.ps1. Run it again after git pull to update."
    Write-Host "copied $src -> $target"
  }
}

if (-not $CodexOnly) { Install-Into (Join-Path $HOME '.claude\skills') (Join-Path $HOME '.claude\skills-backup') }
if ($Codex -or $CodexOnly) {
  Install-Into (Join-Path $HOME '.agents\skills') (Join-Path $HOME '.agents\skills-backup')
  Install-Into (Join-Path $codexDir 'skills') (Join-Path $codexDir 'skills-backup')
}

$restart = if ($CodexOnly) { 'Codex' } elseif ($Codex) { 'Claude Code and Codex' } else { 'Claude Code' }
Write-Host ''
Write-Host "Done. Restart $restart. To update: git pull in the MxScout folder, then run this script again with the same option."
if (-not $CodexOnly) { Write-Host 'Check it: in Claude Code, type /mxscout-project or /mendix-assist, or ask "use mendix-describe on <folder>".' }
if ($Codex -or $CodexOnly) { Write-Host 'Check it: in Codex, ask "use the mendix-assist skill", or "use mendix-describe on <folder>".' }
