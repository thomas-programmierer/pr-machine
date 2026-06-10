# VHS Spandau — PR-Maschine v2
### Stand Mai 2026 · mit Foto-Editor

## Start

```bash
# API-Key setzen — Mac/Linux:
export ANTHROPIC_API_KEY="sk-ant-DEIN-KEY-HIER"

# Windows PowerShell:
# $env:ANTHROPIC_API_KEY = "sk-ant-DEIN-KEY-HIER"

# Server starten:
node server.js
# → http://localhost:3000
```

## Zugänge

| Benutzername | Passwort   | Rolle      |
|--------------|------------|------------|
| thomas       | vhs2026!   | Admin      |
| katja        | vhs2026!   | Redakteur  |
| marion       | vhs2026!   | Direktion  |
| manuela      | vhs2026!   | PBL        |
| kristina     | vhs2026!   | PBL        |
| vanessa      | vhs2026!   | PBL        |
| silke        | vhs2026!   | PBL        |

## Seiten

| URL               | Beschreibung                                |
|-------------------|---------------------------------------------|
| /                 | Login + Redaktion (war: KI-Generator)        |
| /editor           | Foto-Editor NEU                             |
| /kalender         | Redaktionsplan (mit Feiertage/Ferien-Layer) |
| /freigabe         | Freigabe-Workflow                           |
| /performance      | Performance-Dashboard                       |
| /kurse            | Kursliste                                   |

## Foto-Editor — Features

- 4 DVV-Template-Vorlagen (Zitat, Vollfarbe, Recruiting, Frage)
- Foto-Upload: Datei + Kamera-Zugriff (mobil, capture="environment")
- 3 Formate: Story 9:16, Feed 1:1, Quer 16:9
- 10 DVV CI-Farben für Farbüberlagerung
- 4 Echtzeit-Slider: Deckkraft, Helligkeit, Sättigung, Kontrast
- Schnell-Presets: 25% / 72% Vigdís / 85% / 100%
- Text-Editor: Headline, Sub, Autor, Footer, Badge
- PNG-Export via html2canvas (1080×1920 / 1080×1080 / 1920×1080)
- Direkt in Redaktionsplan speichern

## Änderungen gegenüber v1

- "KI-Generator" → "Redaktion" umbenannt
- Neuer Tab "🖼 Foto-Editor" in der Navigation
- Neue Route /editor im Server
- Kalender: Berliner Feiertage + Schulferien 2026/2027
 
 
update 
