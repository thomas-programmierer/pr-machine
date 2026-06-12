@echo off
setlocal enabledelayedexpansion
echo.
echo ===================================================
echo   VHS PR-Maschine -- Direktes Update
echo ===================================================
echo.

set PROJDIR=%~dp0
if "!PROJDIR:~-1!"=="\" set PROJDIR=!PROJDIR:~0,-1!

echo Projektordner: !PROJDIR!
echo.

:: ZIP im selben Ordner suchen
set ZIPFILE=
for %%F in ("!PROJDIR!\vhs-pr-maschine-update.zip") do if exist "%%F" set ZIPFILE=%%F
if "!ZIPFILE!"=="" for %%F in ("%USERPROFILE%\Downloads\vhs-pr-maschine-update.zip") do if exist "%%F" set ZIPFILE=%%F
if "!ZIPFILE!"=="" ( set /p ZIPFILE=ZIP-Pfad angeben: )

echo Verwende: !ZIPFILE!
echo.

:: Temp entpacken
set TMPDIR=%TEMP%\vhs_direkt_%RANDOM%
mkdir "!TMPDIR!"
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '!ZIPFILE!' -DestinationPath '!TMPDIR!' -Force"
if errorlevel 1 ( echo FEHLER beim Entpacken & pause & exit /b 1 )

:: Quellordner finden (server.js als Anker)
set SRCDIR=
if exist "!TMPDIR!\server.js" set SRCDIR=!TMPDIR!
if "!SRCDIR!"=="" for /d %%D in ("!TMPDIR!\*") do if exist "%%D\server.js" set SRCDIR=%%D
if "!SRCDIR!"=="" ( echo FEHLER: server.js nicht gefunden & pause & exit /b 1 )

echo Quelle: !SRCDIR!
echo.

:: ALLE Dateien kopieren -- apply_server_patch.js EXPLIZIT AUSSCHLIESSEN
echo Kopiere alle Dateien ...
robocopy "!SRCDIR!" "!PROJDIR!" /E /XF .env apply_server_patch.js /XD .git node_modules uploads /NFL /NDL /NJH /NJS

echo.
echo Kopiert. Starte Git ...

:: Git push
cd /d "!PROJDIR!"
git add -A
git commit -m "Pipeline-Fix: Voransicht+PBL-Bild+Dashboard komplett %DATE%"
git push origin main
if errorlevel 1 ( echo Push fehlgeschlagen & pause & exit /b 1 )

rmdir /s /q "!TMPDIR!"

echo.
echo ===================================================
echo   Fertig! Railway deployt. Browser: Strg+Shift+R
echo ===================================================
pause
