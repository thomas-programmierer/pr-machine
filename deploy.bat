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

:: ZIP suchen: zuerst als Argument, dann im selben Ordner, dann in Downloads
set ZIPFILE=%~1
if "!ZIPFILE!"=="" (
    if exist "!PROJDIR!\vhs-update.zip" set ZIPFILE=!PROJDIR!\vhs-update.zip
)
if "!ZIPFILE!"=="" (
    if exist "%USERPROFILE%\Downloads\vhs-update.zip" set ZIPFILE=%USERPROFILE%\Downloads\vhs-update.zip
)
if "!ZIPFILE!"=="" (
    echo FEHLER: vhs-update.zip nicht gefunden.
    echo Bitte vhs-update.zip in den Projektordner legen:
    echo   !PROJDIR!
    echo.
    pause
    exit /b 1
)

echo Verwende ZIP: !ZIPFILE!
echo Projektordner: !PROJDIR!
echo.

:: Temp-Ordner
set TMPDIR=%TEMP%\vhs_deploy_%RANDOM%
mkdir "!TMPDIR!"

:: Entpacken
echo Entpacke ...
powershell -NoProfile -Command "Expand-Archive -Path '!ZIPFILE!' -DestinationPath '!TMPDIR!' -Force"
if errorlevel 1 ( echo FEHLER beim Entpacken. & pause & exit /b 1 )

:: Quellpfad ermitteln
set SRCDIR=
if exist "!TMPDIR!\server_admin_routes.js" ( set SRCDIR=!TMPDIR! )
if exist "!TMPDIR!\public\kursliste.html"  ( set SRCDIR=!TMPDIR! )
if "!SRCDIR!"=="" (
    for /d %%D in ("!TMPDIR!\*") do (
        if exist "%%D\public\kursliste.html"  set SRCDIR=%%D
        if exist "%%D\server_admin_routes.js" set SRCDIR=%%D
    )
)
if "!SRCDIR!"=="" ( echo FEHLER: Paketinhalt nicht erkannt. & rmdir /s /q "!TMPDIR!" & pause & exit /b 1 )

:: Dateien kopieren
echo Kopiere Dateien ...
robocopy "!SRCDIR!" "!PROJDIR!" /E /XF .env deploy.bat /XD .git /NFL /NDL /NJH /NJS

:: npm-Pakete
echo Pruefe npm-Pakete ...
cd /d "!PROJDIR!"
node -e "require('multer')" 2>nul
if errorlevel 1 ( echo Installiere multer ... & npm install multer --save --silent )
node -e "require('xlsx')" 2>nul
if errorlevel 1 ( echo Installiere xlsx ... & npm install xlsx --save --silent )
echo npm OK.

:: server.js patchen
echo.
echo Patche server.js ...
node "!PROJDIR!\apply_server_patch.js"
if errorlevel 1 ( echo FEHLER beim Patchen. & rmdir /s /q "!TMPDIR!" & pause & exit /b 1 )

:: Git
echo.
echo Git commit und push ...
cd /d "!PROJDIR!"
git add -A
git commit -m "Update Kursliste + Admin %DATE%"
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
