// set-passwords.js
// Passwörter für alle User setzen und users.json direkt mit Klartext speichern.
// Die Auto-Migration beim Server-Start hasht sie automatisch.
//
// Bearbeite NUR den Abschnitt "HIER PASSWÖRTER EINTRAGEN" unten,
// dann ausführen mit:  node set-passwords.js

const fs   = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'users.json');

// ══════════════════════════════════════════════════════════
//   HIER PASSWÖRTER EINTRAGEN
//   username → neues Passwort (Klartext)
//   Leer lassen ("") = Passwort bleibt unverändert
// ══════════════════════════════════════════════════════════
const NEUE_PASSWOERTER = {
  thomas:   "Spandau2030",
  katja:    "Spandau1",
  manuela:  "Spandau2",
  kristina: "Spandau8",
  vanessa:  "Spandau76",
  marion:   "Spandau76",
  silke:    "Spandau93",
};
// ══════════════════════════════════════════════════════════

const raw   = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
const users = raw.users;
let changed = 0;

for (const u of users) {
  const neuesPW = NEUE_PASSWOERTER[u.username];
  if (!neuesPW) continue;                        // leer → überspringen
  u.password = neuesPW;                          // Klartext — Migration hasht beim Start
  console.log(`  ✏️  ${u.username}: Passwort gesetzt`);
  changed++;
}

if (changed === 0) {
  console.log('  Keine Änderungen — trage Passwörter in NEUE_PASSWOERTER ein.');
} else {
  fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2), 'utf8');
  console.log(`\n  ✅ users.json aktualisiert (${changed} User)`);
  console.log('  → Jetzt committen und pushen:\n');
  console.log('     git add users.json server.js package.json package-lock.json set-passwords.js migrate-passwords.js');
  console.log('     git commit -m "Passwörter gesetzt"');
  console.log('     git push\n');
}
