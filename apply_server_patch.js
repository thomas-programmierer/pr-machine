const fs   = require('fs');
const path = require('path');

const SERVER = path.join(__dirname, 'server.js');

if (!fs.existsSync(SERVER)) {
  console.error('FEHLER: server.js nicht gefunden in ' + __dirname);
  process.exit(1);
}

let src = fs.readFileSync(SERVER, 'utf8');
let changed = false;

// ── BACKUP ───────────────────────────────────────────────────
const backup = SERVER + '.backup_' + Date.now();
fs.writeFileSync(backup, src);
console.log('Backup erstellt: ' + path.basename(backup));

// ── 1. REQUIRES ──────────────────────────────────────────────
const requireBlock = `
// === VHS UPDATE: Kursprogramm-Upload & Admin-Routen ===
const multer = require('multer');
const XLSX   = require('xlsx');
const KURSE_JSON_PATH = require('path').join(__dirname, 'data', 'kursprogramm_data.json');
let KURSE = require('fs').existsSync(KURSE_JSON_PATH)
  ? JSON.parse(require('fs').readFileSync(KURSE_JSON_PATH, 'utf8'))
  : [];
// === END VHS UPDATE REQUIRES ===
`;

if (!src.includes('VHS UPDATE: Kursprogramm-Upload')) {
  // Nach dem letzten require()-Block einfügen
  const lastRequire = src.lastIndexOf("require('");
  const insertAfter = src.indexOf('\n', lastRequire) + 1;
  src = src.slice(0, insertAfter) + requireBlock + src.slice(insertAfter);
  changed = true;
  console.log('✓ Requires eingefügt');
} else {
  console.log('→ Requires bereits vorhanden, übersprungen');
}

// ── 2. API-ROUTEN ────────────────────────────────────────────
const routesBlock = fs.readFileSync(
  path.join(__dirname, 'server_admin_routes.js'), 'utf8'
);

const routeMarker = '// === VHS UPDATE: Admin & Kurse API-Routen ===';

if (!src.includes(routeMarker)) {
  // Alle gängigen listen()-Varianten suchen
  const patterns = [
    /app\.listen\s*\(/,
    /server\.listen\s*\(/,
    /httpServer\.listen\s*\(/,
    /https\.listen\s*\(/
  ];

  let listenIdx = -1;
  for (const pat of patterns) {
    const m = pat.exec(src);
    if (m) { listenIdx = m.index; break; }
  }

  if (listenIdx === -1) {
    // Kein listen() gefunden → ans Ende anfügen (vor letzter Zeile)
    console.log('⚠ Kein listen() gefunden — Routen werden ans Ende angefügt');
    src = src + '\n' + routeMarker + '\n' + routesBlock + '\n// === END VHS UPDATE ROUTEN ===\n';
  } else {
    const insertBefore = src.lastIndexOf('\n', listenIdx) + 1;
    const routes = '\n' + routeMarker + '\n' + routesBlock + '\n// === END VHS UPDATE ROUTEN ===\n\n';
    src = src.slice(0, insertBefore) + routes + src.slice(insertBefore);
    console.log('✓ API-Routen eingefügt');
  }
  changed = true;
} else {
  console.log('→ API-Routen bereits vorhanden, übersprungen');
}

// ── 3. SPEICHERN ─────────────────────────────────────────────
if (changed) {
  fs.writeFileSync(SERVER, src, 'utf8');
  console.log('✓ server.js erfolgreich gepatcht');
} else {
  console.log('→ Keine Änderungen notwendig');
}
