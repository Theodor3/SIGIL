@echo off
cd /d "%~dp0"

echo ============================================
echo  SIGIL TRADING DASHBOARD LAUNCHER
echo ============================================
echo.
echo  [1] Run pipeline + open dashboard
echo      (fetches fresh data, takes ~5-10 min)
echo.
echo  [2] Just open dashboard
echo      (uses last run's data, opens instantly)
echo.
echo  [3] Just run pipeline, no browser
echo.
set /p choice="Enter 1, 2, or 3: "

if "%choice%"=="1" goto run_all
if "%choice%"=="2" goto open_only
if "%choice%"=="3" goto run_only
echo Invalid choice.
pause
exit /b 1

:: ─────────────────────────────────────────────
:run_all
echo.
echo Running pipeline... (watch progress below)
echo Tip: GDELT news skips are normal - it's a slow API.
echo.
node trading/pipeline/run_alpha_pipeline.mjs
echo.
if errorlevel 1 (
  echo [!] Pipeline finished with errors above.
) else (
  echo [+] Pipeline complete!
)
echo.
echo Starting dashboard server...
start "Sigil Dashboard Server" cmd /k "cd /d "%~dp0" && node trading/dashboard/server.mjs"
echo Waiting for server to start...
timeout /t 3 /nobreak >nul
echo Opening browser...
start http://localhost:5180
echo.
echo ============================================
echo  Dashboard open at http://localhost:5180
echo  Close the "Sigil Dashboard Server" window
echo  when you are done.
echo ============================================
echo.
pause
exit /b 0

:: ─────────────────────────────────────────────
:open_only
echo.
echo Starting dashboard server...
start "Sigil Dashboard Server" cmd /k "cd /d "%~dp0" && node trading/dashboard/server.mjs"
echo Waiting for server to start...
timeout /t 3 /nobreak >nul
echo Opening browser...
start http://localhost:5180
echo.
echo ============================================
echo  Dashboard open at http://localhost:5180
echo  Close the "Sigil Dashboard Server" window
echo  when you are done.
echo ============================================
echo.
pause
exit /b 0

:: ─────────────────────────────────────────────
:run_only
echo.
echo Running pipeline... (watch progress below)
echo.
node trading/pipeline/run_alpha_pipeline.mjs
echo.
if errorlevel 1 (
  echo [!] Pipeline finished with errors above.
) else (
  echo [+] Pipeline complete! Run option 2 to view the dashboard.
)
echo.
pause
exit /b 0
