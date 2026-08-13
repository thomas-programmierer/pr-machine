# VHS Spandau PR-Maschine — Deployment

## Kurzfassung

**Deployen = auf `main` pushen.** Sonst nichts.

```bash
git push origin main
```

GitHub Actions übernimmt den Rest. Es gibt keinen manuellen Schritt, kein ZIP,
keinen SSH-Login von Hand.

## Was dabei passiert

`.github/workflows/deploy.yml` läuft bei jedem Push auf `main`, verbindet sich
per SSH mit dem Hetzner-Server und führt dort aus:

```bash
cd /opt/pr-machine
git fetch origin
git reset --hard origin/main
npm install --production --silent
systemctl restart pr-machine
systemctl is-active pr-machine
```

Der Dienst läuft als systemd-Unit `pr-machine` unter `/opt/pr-machine`.
Ein Durchlauf dauert typischerweise rund 20 Sekunden.

## Deploy kontrollieren

Runs ansehen: **Actions → „Deploy to Hetzner"** im GitHub-Repo.

Oder auf der Kommandozeile (einmalig `gh auth login` nötig):

```bash
gh run list --workflow=deploy.yml --limit 5
gh run watch          # laufenden Deploy live verfolgen
gh run view --log     # Log des letzten Runs
```

Der letzte Schritt `systemctl is-active pr-machine` lässt den Run rot werden,
wenn der Dienst nach dem Neustart nicht hochkommt. Ein grüner Run heißt also:
Code ist auf dem Server **und** der Dienst läuft.

## Zugangsdaten

Die Verbindungsdaten liegen als GitHub-Secrets im Repo, nicht im Code:

| Secret             | Inhalt                        |
|--------------------|-------------------------------|
| `HETZNER_HOST`     | Hostname/IP des Servers       |
| `HETZNER_USER`     | SSH-Benutzer                  |
| `HETZNER_SSH_KEY`  | privater SSH-Schlüssel        |

Zu ändern unter **Settings → Secrets and variables → Actions**.

## Wichtig: Was NICHT ins Repo gehört

Das Deploy setzt den Server mit `git reset --hard` hart auf den Repo-Stand.
Jede Datei, die getrackt ist **und** zur Laufzeit vom Server geschrieben wird,
verliert dabei ihren Serverstand — still und bei jedem Deploy erneut.

Diese Dateien stehen deshalb in `.gitignore` und leben nur auf dem Server:

- `data/` — Posts, Performance-Daten
- `users.json`, `sessions.json`, `passwords_override.json`
- `kursprogramm_kontext.json` — hochgeladenes Kursprogramm, fließt in die
  KI-Generierung ein (`server.js`)
- `redaktionsplan_meta.json`
- `uploads/`, `downloads/`

**Vor dem Tracken einer neuen Datei prüfen:** Schreibt der Server sie zur
Laufzeit? Dann gehört sie in `.gitignore`.

Binärdateien (PDF, Bilder, ZIP, Fonts) sind in `.gitattributes` als `binary`
markiert. Ohne das wandelt `core.autocrlf` unter Windows die Zeilenenden um und
zerstört die Dateien.

## Rollback

```bash
git revert <commit>
git push origin main
```

Der Revert löst wie jeder Push ein Deploy aus. Kein `git reset` auf `main` und
kein Force-Push — der Server zieht immer den Stand von `origin/main`.

## Lokal starten

```bash
# API-Key setzen (PowerShell):
$env:ANTHROPIC_API_KEY = "sk-ant-..."

node server.js
# → http://localhost:3000
```

Datenbankzugang und Secrets kommen aus `.env` (nicht im Repo).

---

*Railway wird nicht mehr verwendet. Die frühere Anleitung beschrieb einen
ZIP-Upload mit anschließendem Railway-Deploy — dieser Weg samt `railway.json`,
`deploy.bat`, `deploy.sh` und `DEPLOY_JETZT.bat` wurde am 13.08.2026 entfernt.*
