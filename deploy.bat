@echo off
setlocal enabledelayedexpansion

echo.
echo ===================================================
echo   VHS Spandau PR-Maschine -- Deployment
echo ===================================================
echo.

:: Projektordner = Speicherort dieser .bat
set PROJDIR=%~dp0
if "!PROJDIR:~-1!"=="\" set PROJDIR=!PROJDIR:~0,-1!

:: ZIP suchen: zuerst als Argument, dann Downloads, dann Projektordner
set ZIPFILE=%~1
if "!ZIPFILE!"=="" (
    for %%F in ("%USERPROFILE%\Downloads\vhs-pr-maschine-update.zip" "%USERPROFILE%\Downloads\vhs-update.zip" "!PROJDIR!\vhs-pr-maschine-update.zip" "!PROJDIR!\vhs-update.zip") do (
        if "!ZIPFILE!"=="" if exist "%%~F" set ZIPFILE=%%~F
    )
)
if "!ZIPFILE!"=="" (
    set /p ZIPFILE=ZIP-Pfad eingeben: 
)
if "!ZIPFILE!"=="" (
    echo FEHLER: Kein ZIP gefunden.
    pause & exit /b 1
)

echo Verwende ZIP: !ZIPFILE!
echo Projektordner: !PROJDIR!
echo.

:: Temp-Ordner
set TMPDIR=%TEMP%\vhs_deploy_%RANDOM%
mkdir "!TMPDIR!"

:: Entpacken
echo Entpacke ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Path '!ZIPFILE!' -DestinationPath '!TMPDIR!' -Force"
if errorlevel 1 ( echo FEHLER beim Entpacken. & pause & exit /b 1 )

:: Quellpfad ermitteln (server.js als Anker)
set SRCDIR=
if exist "!TMPDIR!\server.js" ( set SRCDIR=!TMPDIR! )
if "!SRCDIR!"=="" (
    for /d %%D in ("!TMPDIR!\*") do (
        if exist "%%D\server.js" set SRCDIR=%%D
    )
)
if "!SRCDIR!"=="" ( echo FEHLER: server.js nicht im Paket gefunden. & rmdir /s /q "!TMPDIR!" & pause & exit /b 1 )

echo Quelle: !SRCDIR!
echo.

:: Dateien kopieren (ohne .env, deploy.bat, .git)
echo Kopiere Dateien ...
robocopy "!SRCDIR!" "!PROJDIR!" /E /XF .env deploy.bat apply_server_patch.js /XD .git node_modules uploads /NFL /NDL /NJH /NJS
echo Kopieren abgeschlossen.

:: npm-Pakete pruefen
echo Pruefe npm-Pakete ...
cd /d "!PROJDIR!"
node -e "require('multer')" 2>nul
if errorlevel 1 ( echo Installiere multer ... & npm install multer --save --silent )
node -e "require('xlsx')" 2>nul
if errorlevel 1 ( echo Installiere xlsx ... & npm install xlsx --save --silent )
echo npm OK.

:: Git
echo.
echo Git commit und push ...
cd /d "!PROJDIR!"
git add -A
git commit -m "Pipeline-Update: Voransicht + PBL-Bild + Dashboard %DATE%"
git push origin main
if errorlevel 1 ( echo FEHLER beim Push. & rmdir /s /q "!TMPDIR!" & pause & exit /b 1 )

:: Aufraeumen
rmdir /s /q "!TMPDIR!"

echo.
echo ===================================================
echo   Fertig! Railway deployt automatisch.
echo   Browser-Cache: Strg+Shift+R
echo ===================================================
echo.
pause
