# VHS Spandau PR-Maschine — Deploy-Skripte

## Einmalige Einrichtung

1. `deploy.sh` (Mac/Linux) oder `deploy.bat` (Windows) in den **Repo-Ordner** kopieren
2. Mac/Linux: einmalig ausführbar machen:
   ```bash
   chmod +x deploy.sh
   ```

## Verwendung ab sofort

### Mac / Linux
```bash
./deploy.sh ~/Downloads/vhs-update.zip
```
Oder einfach:
```bash
./deploy.sh
```
→ fragt dann interaktiv nach der ZIP

### Windows
Doppelklick auf `deploy.bat` → ZIP-Pfad eingeben → Enter

## Was passiert automatisch

1. ZIP wird entpackt
2. Dateien werden ins Repo kopiert (.git und deploy-Skripte bleiben erhalten)
3. `git add -A` → Änderungen werden angezeigt
4. Commit-Nachricht eingeben (oder Enter für Datum/Uhrzeit)
5. `git push` → Railway deployt automatisch
