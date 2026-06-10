@echo off
echo Installiere npm-Pakete (multer, xlsx) ...
call npm install multer xlsx --save
if errorlevel 1 (
    echo FEHLER bei npm install.
    exit /b 1
)
echo npm-Pakete OK.
