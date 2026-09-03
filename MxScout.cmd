@echo off
rem MxScout - double-click this file to start MxScout and open it in your
rem browser.
rem
rem Nothing is installed: this runs Node.js on the files already sitting in
rem this folder, and it stops the moment you close the window. If the machine
rem has no Node.js, it offers to put one in this folder (.\runtime\node.exe)
rem after you say yes - see "About & security" in the app.
setlocal
cd /d "%~dp0"

if "%MXSCOUT_PORT%"=="" set "MXSCOUT_PORT=4288"
set "URL=http://127.0.0.1:%MXSCOUT_PORT%"
set "CURL=%SystemRoot%\System32\curl.exe"
set "NODE_EXE=%~dp0runtime\node.exe"
rem The Node line to fetch. Bump it here, in one place, when it goes out of
rem support. This one URL always points at the current build of that line.
set "NODE_URL=https://nodejs.org/dist/latest-v22.x/win-x64/node.exe"

rem This file starts a second, hidden copy of itself with --open. That copy
rem waits until the server actually answers and then opens the browser, while
rem the copy you double-clicked stays in front running the server. One file
rem doing two jobs, so there is no helper script that can drift out of sync.
if /i "%~1"=="--open" goto :open_when_ready

title MxScout
echo.
echo   MxScout
echo   %URL%
echo.

rem Already running? Then do not start a second server that would only fail on
rem the port. Open the copy that is already there and get out of the way - the
rem common case being someone double-clicking this twice.
if exist "%CURL%" (
  "%CURL%" -s -m 2 -o NUL "%URL%/api/health" >nul 2>nul
  if not errorlevel 1 (
    echo   MxScout is already running - opening it in your browser.
    start "" "%URL%"
    exit /b 0
  )
)

rem A Node.js in this folder wins over the machine's own, so a copy of MxScout
rem that was handed a runtime works on a machine that has none installed.
set "NODE="
if exist "%NODE_EXE%" set "NODE=%NODE_EXE%"
rem Parenthesised on purpose: written as `if ... && set`, cmd runs the set
rem whenever the IF itself succeeds - which it does when the condition is
rem false - and the folder's own node.exe would be overwritten by PATH's.
if not defined NODE (
  where node >nul 2>nul
  if not errorlevel 1 set "NODE=node"
)
if not defined NODE goto :get_node

:run
echo   Starting... your browser will open by itself in a moment.
echo   Close this window when you are done - that is how you stop MxScout.
echo.
start "" /b cmd /c ""%~nx0" --open"
"%NODE%" server\index.js
echo.
echo   MxScout has stopped.
pause
exit /b

:get_node
echo   Node.js was not found on this machine.
echo.
echo   MxScout itself has no dependencies at all, but it is a Node program, so
echo   it needs one to run. Two ways out:
echo.
echo     1. Install Node.js LTS from https://nodejs.org - the normal way, and
echo        the right one if you may install software on this machine.
echo     2. Let MxScout put a copy in its own folder ^(.\runtime\node.exe,
echo        about 90 MB, downloaded from nodejs.org^). Nothing is installed,
echo        no administrator rights are needed, nothing outside this folder is
echo        touched, and deleting .\runtime removes it again.
echo.
if not exist "%CURL%" (
  echo   This Windows has no curl.exe, so option 2 is not available here.
  echo   Install Node.js yourself, or copy node.exe from another machine into
  echo   .\runtime\, and double-click this file again.
  echo.
  pause
  exit /b 1
)
set "ANSWER="
set /p "ANSWER=  Download Node.js into this folder now? [y/N] "
if /i not "%ANSWER%"=="y" if /i not "%ANSWER%"=="yes" (
  echo.
  echo   Nothing was downloaded.
  pause
  exit /b 1
)
echo.
echo   Downloading node.exe from nodejs.org...
if not exist "%~dp0runtime" mkdir "%~dp0runtime"
"%CURL%" -fL --progress-bar -o "%~dp0runtime\node.exe.part" "%NODE_URL%"
if errorlevel 1 (
  del "%~dp0runtime\node.exe.part" >nul 2>nul
  echo.
  echo   The download failed - a company proxy usually explains this.
  echo   Install Node.js yourself, or copy node.exe from another machine into
  echo   .\runtime\, and double-click this file again.
  echo.
  pause
  exit /b 1
)
move /y "%~dp0runtime\node.exe.part" "%NODE_EXE%" >nul
echo   Node.js is now in .\runtime - MxScout will use it from here on.
echo.
set "NODE=%NODE_EXE%"
goto :run

:open_when_ready
rem Poll instead of guessing a sleep, so the tab opens the moment the server is
rem listening: not before (a "connection refused" page) and not later than it
rem has to be. ping is the wait here, not timeout, because timeout refuses to
rem run in a background window with no console of its own.
if not exist "%CURL%" (
  ping -n 4 127.0.0.1 >nul
  start "" "%URL%"
  exit /b 0
)
set /a TRIES=0
:poll
"%CURL%" -s -m 1 -o NUL "%URL%/api/health" >nul 2>nul
if not errorlevel 1 (
  start "" "%URL%"
  exit /b 0
)
set /a TRIES+=1
if %TRIES% GEQ 40 exit /b 1
ping -n 2 127.0.0.1 >nul
goto :poll
