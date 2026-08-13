@echo off
REM ============================================================
REM VHS Spandau PR-Maschine — Deploy-Skript (Windows)
REM ============================================================
setlocal enabledelayedexpansion
title VHS Spandau PR-Maschine · Deploy

echo.
echo  ==========================================
echo   VHS Spandau PR-Maschine ^| Deploy
echo  ==========================================
echo.

REM ── Git prüfen ──────────────────────────────────────────────
where git >nul 2>&1
if errorlevel 1 (
  echo  [FEHLER] Git nicht gefunden: https://git-scm.com
  pause & exit /b 1
)

REM ── ZIP-Pfad ────────────────────────────────────────────────
set "ZIP_FILE=%~1"
if "%ZIP_FILE%"=="" (
  echo  Keine ZIP angegeben.
  set /p ZIP_FILE="  Pfad zur ZIP-Datei eingeben: "
)

if not exist "%ZIP_FILE%" (
  echo  [FEHLER] Datei nicht gefunden: %ZIP_FILE%
  pause & exit /b 1
)

REM ── Repo-Verzeichnis ────────────────────────────────────────
set "REPO_DIR=%~dp0"
cd /d "%REPO_DIR%"

if not exist ".git" (
  echo  [FEHLER] Kein Git-Repository in: %REPO_DIR%
  pause & exit /b 1
)

echo  Repo : %REPO_DIR%
echo  ZIP  : %ZIP_FILE%
echo.

REM ── Alles per PowerShell erledigen ──────────────────────────
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$zip = '%ZIP_FILE%';" ^
  "$repo = '%REPO_DIR%'.TrimEnd('\');" ^
  "$tmp = Join-Path $env:TEMP ('vhs_' + [System.IO.Path]::GetRandomFileName());" ^
  "Write-Host '  Entpacke ZIP...';" ^
  "Expand-Archive -Path $zip -DestinationPath $tmp -Force;" ^
  "$src = $tmp;" ^
  "$sub = Get-ChildItem $tmp -Directory;" ^
  "if ($sub.Count -eq 1 -and (Test-Path (Join-Path $sub[0].FullName 'server.js'))) { $src = $sub[0].FullName };" ^
  "Write-Host ('  Quelle: ' + $src);" ^
  "$protect = @('.git','deploy.bat','deploy.sh','.env');" ^
  "Get-ChildItem $src | ForEach-Object {" ^
  "  if ($protect -notcontains $_.Name) {" ^
  "    $dest = Join-Path $repo $_.Name;" ^
  "    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force };" ^
  "    Copy-Item $_.FullName $dest -Recurse -Force;" ^
  "    Write-Host ('  + ' + $_.Name);" ^
  "  }" ^
  "};" ^
  "Remove-Item $tmp -Recurse -Force;" ^
  "Write-Host '  Dateien kopiert.'"

if errorlevel 1 (
  echo  [FEHLER] Kopieren fehlgeschlagen.
  pause & exit /b 1
)

REM ── Git commit & push ────────────────────────────────────────
echo.
echo  Git Status:
git add -A
git status --short

git diff --cached --quiet 2>nul
if not errorlevel 1 (
  echo.
  echo  Keine Aenderungen — nichts zu committen.
  pause & exit /b 0
)

echo.
set "DATUM=%DATE:~6,4%.%DATE:~3,2%.%DATE:~0,2%"
set "UHRZEIT=%TIME:~0,5%"
set "DEFAULT_MSG=Update %DATUM% %UHRZEIT%"
set /p COMMIT_MSG="  Commit-Nachricht [%DEFAULT_MSG%]: "
if "%COMMIT_MSG%"=="" set "COMMIT_MSG=%DEFAULT_MSG%"

git commit -m "%COMMIT_MSG%"

echo.
echo  Push nach GitHub...
git push origin main
if errorlevel 1 (
  echo  [FEHLER] Push fehlgeschlagen.
  pause & exit /b 1
)

echo.
echo  ==========================================
echo   Erfolgreich deployt!
echo   Railway startet automatisch neu.
echo  ==========================================
echo.
echo  Commit : %COMMIT_MSG%
echo  Zeit   : %DATUM% %UHRZEIT%
echo.
pause
