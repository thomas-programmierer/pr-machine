// migrate-passwords.js
// Einmaliges Script: wandelt Klartext-Passwörter in users.json in bcrypt-Hashes um.
// Ausführen mit:  node migrate-passwords.js
// Danach kann diese Datei gelöscht werden.

const fs     = require('fs');
const path   = require('path');
const bcrypt = require('bcrypt');

const USERS_FILE    = path.join(__dirname, 'users.json');
const OVERRIDE_FILE = path.join(__dirname, 'passwords_override.json');
const ROUNDS        = 10;

async function main() {
  // ── users.json ────────────────────────────────────────────────────────────
  const raw   = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const users = raw.users;

  let changed = 0;
  for (const u of users) {
    if (!u.password) { console.log(`  ⚠  ${u.username}: kein password-Feld, übersprungen`); continue; }

    // Schon ein Hash? bcrypt-Hashes beginnen mit $2b$ oder $2a$
    if (u.password.startsWith('$2b$') || u.password.startsWith('$2a$')) {
      console.log(`  ✓  ${u.username}: bereits gehasht`);
      continue;
    }

    const hash = await bcrypt.hash(u.password, ROUNDS);
    console.log(`  🔒 ${u.username}: "${u.password}" → Hash`);
    u.password = hash;
    changed++;
  }

  if (changed > 0) {
    // Backup anlegen
    const backup = USERS_FILE.replace('.json', '.backup.json');
    fs.copyFileSync(USERS_FILE, backup);
    console.log(`\n  💾 Backup gespeichert: ${backup}`);

    fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2), 'utf8');
    console.log(`  ✅ users.json aktualisiert (${changed} Passwörter gehasht)\n`);
  } else {
    console.log('\n  Keine Änderungen nötig.\n');
  }

  // ── passwords_override.json (falls vorhanden) ─────────────────────────────
  if (fs.existsSync(OVERRIDE_FILE)) {
    const ov   = JSON.parse(fs.readFileSync(OVERRIDE_FILE, 'utf8'));
    let ovChanged = 0;
    for (const [id, pw] of Object.entries(ov)) {
      if (pw.startsWith('$2b$') || pw.startsWith('$2a$')) {
        console.log(`  ✓  override[${id}]: bereits gehasht`);
        continue;
      }
      ov[id] = await bcrypt.hash(pw, ROUNDS);
      console.log(`  🔒 override[${id}]: gehasht`);
      ovChanged++;
    }
    if (ovChanged > 0) {
      fs.writeFileSync(OVERRIDE_FILE, JSON.stringify(ov, null, 2), 'utf8');
      console.log(`  ✅ passwords_override.json aktualisiert (${ovChanged} gehasht)\n`);
    }
  }

  console.log('Migration abgeschlossen. Bitte server.js neu starten.');
}

main().catch(err => { console.error('Fehler:', err); process.exit(1); });
