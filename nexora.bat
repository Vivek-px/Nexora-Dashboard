@echo off
REM ===========================================================================
REM  Nexora Bhubaneswar - ONE file for everything (Windows).
REM  Double-click it and pick a number, or run it with a word from a terminal:
REM     Nexora.bat start | dev | install | test | keys | check | stop | reset
REM  It installs and updates whatever is needed by itself: when a new version
REM  adds Python or npm packages, the next start installs them automatically.
REM ===========================================================================
setlocal
title Nexora
cd /d "%~dp0"
set "VPY=.venv\Scripts\python.exe"
set "FROMMENU=0"
set "ACTION=%~1"

if not exist "package.json" goto wrong_folder
if not exist "backend\app.py" goto wrong_folder
if not "%ACTION%"=="" goto dispatch

:menu
set "FROMMENU=1"
set "ACTION="
set "CH="
cls
echo.
echo  ============================================================
echo    Nexora Bhubaneswar - control panel
echo  ============================================================
echo.
echo    1  Start the dashboard          - recommended, opens http://localhost:8000
echo    2  Developer mode               - live reload while editing code, port 5173
echo    3  Install / repair packages    - force a fresh install
echo    4  Run the tests
echo    5  Add or edit keys             - Groq (Indi), Google sign-in, WhatsApp, SMS, data.gov.in
echo    6  Check my setup               - versions and status, copy this if something fails
echo    7  Stop Nexora                - frees ports 8000 and 5173
echo    8  Reset all data               - keeps a backup copy
echo    9  Open the guide               - HOW_TO_RUN.md
echo   10  Head account on this PC      - create or repair the head (approves all access)
echo    0  Exit
echo.
set /p "CH=  Type a number and press Enter: "
if "%CH%"=="1" set "ACTION=start"
if "%CH%"=="2" set "ACTION=dev"
if "%CH%"=="3" set "ACTION=install"
if "%CH%"=="4" set "ACTION=test"
if "%CH%"=="5" set "ACTION=keys"
if "%CH%"=="6" set "ACTION=check"
if "%CH%"=="7" set "ACTION=stop"
if "%CH%"=="8" set "ACTION=reset"
if "%CH%"=="9" set "ACTION=guide"
if "%CH%"=="10" set "ACTION=head"
if "%CH%"=="0" exit /b 0
if "%ACTION%"=="" goto menu

:dispatch
if /i "%ACTION%"=="start"   goto do_start
if /i "%ACTION%"=="dev"     goto do_dev
if /i "%ACTION%"=="install" goto do_install
if /i "%ACTION%"=="test"    goto do_test
if /i "%ACTION%"=="keys"    goto do_keys
if /i "%ACTION%"=="check"   goto do_check
if /i "%ACTION%"=="stop"    goto do_stop
if /i "%ACTION%"=="reset"   goto do_reset
if /i "%ACTION%"=="guide"   goto do_guide
if /i "%ACTION%"=="head"    goto do_head
echo Unknown option "%ACTION%".
echo Use one of: start, dev, install, test, keys, check, stop, reset, guide, head
exit /b 1

REM ---------------------------------------------------------------- 1. start
:do_start
call :prepare
if errorlevel 1 goto failed
call :api_up
if not errorlevel 1 goto already_running
call :port_busy 8000
if not errorlevel 1 goto port_taken
echo.
echo Building the dashboard...
call npm run build
if errorlevel 1 goto failed
echo.
echo  ------------------------------------------------------------
echo   Nexora is running at http://localhost:8000
echo   Keep this window open. Close it, or press Ctrl+C, to stop.
echo   First start: you will be asked to create the admin account.
echo  ------------------------------------------------------------
call :open_when_ready 8000 http://localhost:8000
"%VPY%" -m uvicorn app:app --app-dir backend --host 127.0.0.1 --port 8000
goto done

REM ---------------------------------------------------------------- 2. dev
:do_dev
call :prepare
if errorlevel 1 goto failed
call :api_up
if not errorlevel 1 goto dev_ui
call :port_busy 8000
if not errorlevel 1 goto port_taken
echo Starting the Python server in its own window...
start "Nexora server - close this window to stop it" cmd /k %VPY% -m uvicorn app:app --app-dir backend --host 127.0.0.1 --port 8000 --reload
call :wait_port 8000
if errorlevel 1 goto server_failed
:dev_ui
call :port_busy 5173
if not errorlevel 1 goto dev_ui_taken
echo.
echo  ------------------------------------------------------------
echo   Developer mode: http://localhost:5173  - code changes reload live
echo   Press Ctrl+C here to stop the dashboard, and close the
echo   "Nexora server" window to stop the server.
echo  ------------------------------------------------------------
call npm run dev -- --open
goto done
:dev_ui_taken
echo Port 5173 is already in use - developer mode is probably already open.
start "" http://localhost:5173
goto done

REM ---------------------------------------------------------------- 3. install
:do_install
if exist ".venv\installed.txt" del ".venv\installed.txt"
if exist "node_modules\.nexora-lock.json" del "node_modules\.nexora-lock.json"
call :prepare
if errorlevel 1 goto failed
echo.
echo Everything is installed.
goto done

REM ---------------------------------------------------------------- 4. test
:do_test
call :prepare
if errorlevel 1 goto failed
echo Installing test tools...
"%VPY%" -m pip install --disable-pip-version-check -q pytest pypdf
if errorlevel 1 goto failed
"%VPY%" -m pytest backend\tests -q
if errorlevel 1 goto tests_failed
echo.
echo All tests passed.
goto done
:tests_failed
echo.
echo Some tests failed - see above.
goto done

REM ---------------------------------------------------------------- 5. keys
:do_keys
if not exist "backend\.env" copy "backend\.env.example" "backend\.env" >nul
REM Add settings introduced by newer versions to an existing .env (values you already filled in are kept).
call :find_python
if exist "%VPY%" (set "BPY=%VPY%") else (set "BPY=%PY%")
if defined BPY %BPY% -c "import pathlib as p;e=p.Path('backend/.env');x=p.Path('backend/.env.example');key=lambda l:l.split('=',1)[0].strip();ok=lambda l:'=' in l and not l.lstrip().startswith('#');have={key(l) for l in e.read_text(encoding='utf-8-sig').splitlines() if ok(l)};new=[l.strip() for l in x.read_text(encoding='utf-8-sig').splitlines() if ok(l) and key(l) not in have];new and e.open('a',encoding='utf-8').write(chr(10)+chr(10).join(new)+chr(10));print('Added new settings to backend/.env:',', '.join(key(l) for l in new)) if new else None"
echo Opening backend\.env in Notepad. Fill in only what you use, save, close Notepad.
echo For Indi AI answers paste your Groq key after GROQ_API_KEY= - free at console.groq.com
echo Never share this file or put it on GitHub.
notepad "backend\.env"
echo.
echo Saved. Restart Nexora for the keys to take effect - choose 7 then 1.
goto done

REM ---------------------------------------------------------------- 6. check
:do_check
echo.
echo  --- Nexora setup check ---
echo Folder: %CD%
where node >nul 2>nul
if errorlevel 1 (echo Node.js: NOT INSTALLED) else (for /f "delims=" %%v in ('node -v') do echo Node.js: %%v)
where npm >nul 2>nul
if errorlevel 1 (echo npm: NOT FOUND) else (for /f "delims=" %%v in ('npm -v') do echo npm: %%v)
call :find_python
if errorlevel 1 (echo Python: NOT INSTALLED) else (for /f "delims=" %%v in ('%PY% --version') do echo Python: %%v)
if exist "%VPY%" (echo Python environment .venv: present) else (echo Python environment .venv: missing - choose 1 or 3)
if exist "node_modules" (echo Dashboard packages node_modules: present) else (echo Dashboard packages node_modules: missing - choose 1 or 3)
if not exist "%VPY%" goto check_env
"%VPY%" -c "import fastapi,uvicorn,pandas,openpyxl,httpx,reportlab,PIL,pillow_heif" >nul 2>nul
if errorlevel 1 (echo Server packages: incomplete - choose 3) else (echo Server packages: OK)
:check_env
if exist "backend\.env" (echo Keys file backend\.env: present) else (echo Keys file backend\.env: not created - optional, choose 5)
if exist "backend\.env" if exist "%VPY%" %VPY% -c "import pathlib;t=pathlib.Path('backend/.env').read_text(encoding='utf-8-sig').splitlines();[print('   ',l.split('=',1)[0].strip(),'is set' if l.split('=',1)[1].strip() else 'is empty') for l in t if '=' in l and not l.lstrip().startswith('#')]"
call :api_up
if errorlevel 1 (echo Server on port 8000: not running) else (echo Server on port 8000: running)
call :port_busy 5173
if errorlevel 1 (echo Developer dashboard on port 5173: not running) else (echo Developer dashboard on port 5173: running)
if exist "backend\data\nexora.db" (echo Database: backend\data\nexora.db) else (echo Database: not created yet - created on first start)
goto done

REM ---------------------------------------------------------------- 7. stop
:do_stop
call :kill_port 8000
call :kill_port 5173
echo Nexora stopped.
goto done

REM ---------------------------------------------------------------- 8. reset
:do_reset
if not exist "backend\data" (
  echo There is no saved data yet.
  goto done
)
echo This removes ALL users, uploads, alerts, actions, savings, profiles and complaints.
echo A backup copy is kept in backend\data_backup_DATE.
set "OK="
set /p "OK=Type RESET to continue, anything else to cancel: "
if not "%OK%"=="RESET" (
  echo Cancelled.
  goto done
)
call :kill_port 8000
call :find_python
if exist "%VPY%" (set "BPY=%VPY%") else (set "BPY=%PY%")
%BPY% -c "import shutil,time;d='backend/data_backup_'+time.strftime('%%Y%%m%%d-%%H%%M%%S');shutil.move('backend/data',d);print('Backup saved in',d)"
if errorlevel 1 goto failed
echo Data cleared. Choose 1 to start fresh.
goto done

REM ---------------------------------------------------------------- 10. head account
:do_head
call :prepare
if errorlevel 1 goto failed
"%VPY%" backend\make_head.py
goto done

REM ---------------------------------------------------------------- 9. guide
:do_guide
start "" "HOW_TO_RUN.md"
goto done

REM ======================================================== shared steps
:prepare
REM Checks Node and Python, creates .venv, and installs packages when they are missing or have changed.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org, then run this file again.
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit((a===20&&b>=19)||(a===22&&b>=12)||a>22?0:1)"
if errorlevel 1 (
  echo Your Node.js is too old. Install Node 22 LTS from https://nodejs.org, then run this file again.
  exit /b 1
)
call :find_python
if errorlevel 1 (
  echo Python 3.10 or newer is not installed. Install Python 3.13 from https://www.python.org
  echo and tick "Add python.exe to PATH" during setup, then run this file again.
  exit /b 1
)
REM A .venv copied from another computer or folder does not work - rebuild it.
if exist "%VPY%" (
  "%VPY%" -c "import sys" >nul 2>nul
  if errorlevel 1 rmdir /s /q .venv
)
if not exist "%VPY%" (
  echo Creating the Python environment - first run only...
  %PY% -m venv .venv
  if errorlevel 1 (
    echo Could not create the Python environment.
    exit /b 1
  )
  if exist ".venv\installed.txt" del ".venv\installed.txt"
)
set "NEED=1"
if exist ".venv\installed.txt" (
  fc /b "backend\requirements.txt" ".venv\installed.txt" >nul 2>nul
  if not errorlevel 1 set "NEED=0"
)
if "%NEED%"=="1" (
  echo Installing server packages - takes a minute...
  "%VPY%" -m pip install --disable-pip-version-check -q -r backend\requirements.txt
  if errorlevel 1 (
    echo Server package install failed. Check your internet connection and try again.
    exit /b 1
  )
  copy /y "backend\requirements.txt" ".venv\installed.txt" >nul
)
set "NEED=1"
if exist "node_modules\.nexora-lock.json" (
  fc /b "package-lock.json" "node_modules\.nexora-lock.json" >nul 2>nul
  if not errorlevel 1 set "NEED=0"
)
if "%NEED%"=="1" (
  echo Installing dashboard packages - takes a minute...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Dashboard package install failed. Check your internet connection and try again.
    exit /b 1
  )
  copy /y "package-lock.json" "node_modules\.nexora-lock.json" >nul
)
exit /b 0

:find_python
REM sets PY to a Python 3.10+ launcher; errorlevel 1 when none is found
set "PY="
where py >nul 2>nul
if errorlevel 1 goto fp_python
py -3 -c "import sys;sys.exit(0 if sys.version_info>=(3,10) else 1)" >nul 2>nul
if errorlevel 1 goto fp_python
set "PY=py -3"
exit /b 0
:fp_python
where python >nul 2>nul
if errorlevel 1 exit /b 1
python -c "import sys;sys.exit(0 if sys.version_info>=(3,10) else 1)" >nul 2>nul
if errorlevel 1 exit /b 1
set "PY=python"
exit /b 0

:api_up
REM errorlevel 0 when the Nexora server answers on port 8000
if not exist "%VPY%" exit /b 1
"%VPY%" -c "import urllib.request as u;u.urlopen('http://127.0.0.1:8000/api/setup/status',timeout=2)" >nul 2>nul
exit /b %errorlevel%

:port_busy
REM errorlevel 0 when something is listening on port %1
netstat -ano | findstr /r /c:":%1 .*LISTENING" >nul
exit /b %errorlevel%

:kill_port
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":%1 .*LISTENING"') do taskkill /PID %%p /T /F >nul 2>nul
exit /b 0

:wait_port
REM waits up to 60 s for port %1 to open
"%VPY%" -c "import socket,time,sys;sys.exit(0 if any(socket.socket().connect_ex(('127.0.0.1',%1))==0 or time.sleep(1) for _ in range(60)) else 1)"
exit /b %errorlevel%

:open_when_ready
REM opens the browser in the background once port %1 answers
start "" /b "%VPY%" -c "import socket,time,webbrowser;any(socket.socket().connect_ex(('127.0.0.1',%1))==0 or time.sleep(1) for _ in range(90)) and webbrowser.open('%2')"
exit /b 0

REM ======================================================== messages
:already_running
echo Nexora is already running - opening http://localhost:8000
start "" http://localhost:8000
goto done

:port_taken
echo.
echo Port 8000 is used by another program, so Nexora cannot start.
echo Choose 7 - Stop Nexora - and then 1 again, or close the other program.
goto done

:server_failed
echo.
echo The server did not start. Look at the "Nexora server" window for the error,
echo or choose 6 - Check my setup - and send me what it shows.
goto done

:wrong_folder
echo.
echo This file must sit inside the Nexora_Dashboard folder, next to package.json.
echo If you opened it from inside the zip, unzip the whole folder first.
pause
exit /b 1

:failed
echo.
echo Something went wrong - see the messages above.
echo Choose 6 - Check my setup - and send me the result if you need help.
goto done

:done
echo.
if "%FROMMENU%"=="1" (
  pause
  goto menu
)
exit /b 0
