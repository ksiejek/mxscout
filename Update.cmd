@echo off
rem MxScout - double-click this file to update this copy of MxScout from the git
rem repository it was cloned from.
rem
rem MxScout itself never does this: the app runs no program and connects nowhere
rem to look for a newer version (About & security). This file is the step you
rem take by hand: "git pull --ff-only" in this folder. A copy with changes of
rem your own, a branch that has moved apart, or a folder that is not a git clone
rem is left exactly as it is - it never stashes, resets or forces anything.
setlocal
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
  echo git is not installed, so this copy cannot update itself. Download the newest MxScout and replace this folder - your projects are in your browser and your MxScout folder, not here.
  goto :end
)
if not exist ".git" (
  echo This folder is not a git clone of MxScout, so there is nothing to pull. Replace it with a newer copy instead - your projects are not in it.
  goto :end
)
for /f %%s in ('git status --porcelain --untracked-files=no') do (
  echo This copy has changes of its own ^(git status lists them^), so it is left as it is. Commit or undo them, then run this again.
  goto :end
)

for /f "tokens=2 delims=:, " %%v in ('findstr /c:"\"version\"" package.json') do set "BEFORE=%%~v"
git pull --ff-only
if errorlevel 1 (
  echo Not updated: the pull could not fast-forward ^(this branch and the repository's have moved apart, or the repository could not be reached^). Nothing was changed.
  goto :end
)
for /f "tokens=2 delims=:, " %%v in ('findstr /c:"\"version\"" package.json') do set "AFTER=%%~v"
if "%BEFORE%"=="%AFTER%" (
  echo MxScout %AFTER% - already the newest version on this branch.
) else (
  echo MxScout updated: %BEFORE% -^> %AFTER%. Restart it if it is running; it shows what changed ^(What's new^).
)

:end
echo.
pause
