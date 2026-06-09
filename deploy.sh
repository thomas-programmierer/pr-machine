#!/bin/bash
# ============================================================
# VHS Spandau PR-Maschine — Deploy-Skript (Mac / Linux)
# Verwendung: ./deploy.sh pfad/zur/update.zip
# ============================================================

set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
ZIP_FILE="$1"
BRANCH="main"

# ── Farben ───────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   VHS Spandau PR-Maschine · Deploy       ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── Prüfungen ────────────────────────────────────────────────
if ! command -v git &> /dev/null; then
  echo -e "${RED}✗ Git nicht gefunden. Bitte installieren: https://git-scm.com${NC}"
  exit 1
fi

if ! command -v unzip &> /dev/null; then
  echo -e "${RED}✗ unzip nicht gefunden. Bitte installieren.${NC}"
  exit 1
fi

if [ -z "$ZIP_FILE" ]; then
  # Kein Argument — interaktiv nach ZIP fragen
  echo -e "${YELLOW}Keine ZIP angegeben.${NC}"
  read -rp "Pfad zur ZIP-Datei: " ZIP_FILE
fi

ZIP_FILE="${ZIP_FILE/#\~/$HOME}"  # ~ expandieren

if [ ! -f "$ZIP_FILE" ]; then
  echo -e "${RED}✗ Datei nicht gefunden: $ZIP_FILE${NC}"
  exit 1
fi

# ── Ins Repo-Verzeichnis wechseln ────────────────────────────
cd "$REPO_DIR"

if [ ! -d ".git" ]; then
  echo -e "${RED}✗ Kein Git-Repository in: $REPO_DIR${NC}"
  echo "  Bitte deploy.sh direkt im Repo-Ordner ablegen."
  exit 1
fi

echo -e "${GREEN}✓ Repo-Ordner:${NC} $REPO_DIR"
echo -e "${GREEN}✓ ZIP-Datei:${NC} $ZIP_FILE"
echo ""

# ── Backup aktueller Stand ───────────────────────────────────
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
echo -e "${YELLOW}→ Erstelle Backup...${NC}"
git stash -q 2>/dev/null || true

# ── ZIP entpacken in temporären Ordner ──────────────────────
TMP_DIR=$(mktemp -d)
echo -e "${YELLOW}→ Entpacke ZIP...${NC}"
unzip -q "$ZIP_FILE" -d "$TMP_DIR"

# Findet den Root-Ordner der ZIP (falls in Unterordner verpackt)
ZIP_ROOT="$TMP_DIR"
SUBDIRS=$(find "$TMP_DIR" -maxdepth 1 -mindepth 1 -type d)
SUBDIR_COUNT=$(echo "$SUBDIRS" | grep -c . 2>/dev/null || echo 0)
if [ "$SUBDIR_COUNT" -eq 1 ] && [ ! -f "$TMP_DIR/server.js" ]; then
  ZIP_ROOT="$SUBDIRS"
  echo "  (Unterordner erkannt: $(basename $ZIP_ROOT))"
fi

echo -e "${GREEN}✓ Entpackt nach:${NC} $ZIP_ROOT"

# ── Dateien kopieren (schütze .git und deploy.sh) ────────────
echo -e "${YELLOW}→ Kopiere Dateien ins Repo...${NC}"

# Schützte Dateien die NICHT überschrieben werden
PROTECTED=(".git" "deploy.sh" "deploy.bat" ".env")

rsync_exclude=""
for f in "${PROTECTED[@]}"; do
  rsync_exclude="$rsync_exclude --exclude=$f"
done

if command -v rsync &> /dev/null; then
  rsync -a --delete $rsync_exclude "$ZIP_ROOT/" "$REPO_DIR/"
else
  # Fallback ohne rsync
  find "$ZIP_ROOT" -maxdepth 1 -mindepth 1 | while read item; do
    name=$(basename "$item")
    skip=false
    for p in "${PROTECTED[@]}"; do
      [ "$name" = "$p" ] && skip=true && break
    done
    if [ "$skip" = false ]; then
      rm -rf "$REPO_DIR/$name"
      cp -r "$item" "$REPO_DIR/$name"
    fi
  done
fi

echo -e "${GREEN}✓ Dateien aktualisiert${NC}"

# ── Aufräumen ────────────────────────────────────────────────
rm -rf "$TMP_DIR"

# ── Git commit & push ────────────────────────────────────────
echo -e "${YELLOW}→ Git Status prüfen...${NC}"
git add -A

CHANGED=$(git diff --cached --name-only | wc -l | tr -d ' ')
if [ "$CHANGED" -eq 0 ]; then
  echo -e "${YELLOW}⚠ Keine Änderungen — nichts zu committen.${NC}"
  exit 0
fi

echo -e "${GREEN}✓ $CHANGED Dateien geändert${NC}"
echo ""
git diff --cached --name-only | sed 's/^/  → /'
echo ""

# Commit-Nachricht
read -rp "Commit-Nachricht [Update $(date +%d.%m.%Y)]: " COMMIT_MSG
COMMIT_MSG="${COMMIT_MSG:-Update $(date +%d.%m.%Y %H:%M)}"

git commit -m "$COMMIT_MSG"

echo -e "${YELLOW}→ Push nach GitHub ($BRANCH)...${NC}"
git push origin "$BRANCH"

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ✓ Erfolgreich deployt!                 ║${NC}"
echo -e "${GREEN}║   Railway startet automatisch neu.       ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "  Branch:  ${BLUE}$BRANCH${NC}"
echo -e "  Commit:  ${BLUE}$COMMIT_MSG${NC}"
echo -e "  Zeit:    ${BLUE}$(date '+%d.%m.%Y %H:%M:%S')${NC}"
echo ""
