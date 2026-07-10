// migrate_posts.js — Einmalig: data/posts.json → PostgreSQL
// Aufruf: node migrate_posts.js

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const db   = require('./db');

async function run() {
  const file = path.join(__dirname, 'data', 'posts.json');
  if (!fs.existsSync(file)) {
    console.log('Keine data/posts.json gefunden — nichts zu migrieren.');
    process.exit(0);
  }

  let posts;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    posts = Array.isArray(raw) ? raw : (raw.posts || []);
  } catch (e) {
    console.error('Fehler beim Lesen der posts.json:', e.message);
    process.exit(1);
  }

  console.log(`Migriere ${posts.length} Posts...`);

  // Sicherstellen dass die Tabelle existiert
  await db.ensureTables();

  // Prüfen ob bereits Posts in der DB sind
  const existing = await db.getPosts();
  if (existing.length > 0) {
    console.log(`WARNUNG: posts-Tabelle enthält bereits ${existing.length} Einträge.`);
    console.log('Migration abgebrochen — bitte manuell prüfen.');
    process.exit(1);
  }

  let ok = 0, err = 0;
  for (const p of posts) {
    try {
      await db.addPost({
        datum:          p.datum || null,
        uhrzeit:        p.uhrzeit || null,
        kanal:          p.kanal || null,
        anlass:         p.anlass || null,
        text:           p.text || null,
        tags:           p.tags || null,
        status:         p.status || 'geplant',
        ziel:           p.ziel || null,
        freigabe:       p.freigabe || null,
        freigegeben_von: p.freigegeben_von || null,
        paid:           p.paid || 'nein',
        url:            p.url || null,
        erstellt:       p.erstellt || new Date().toISOString(),
        autor:          p.autor || null,
        autorId:        p.autorId || p.autor_id || null
      });
      console.log(`  ✓ ${p.id} — ${p.anlass}`);
      ok++;
    } catch (e) {
      console.error(`  ✗ ${p.id} — ${e.message}`);
      err++;
    }
  }

  console.log(`\nFertig: ${ok} migriert, ${err} Fehler.`);

  if (err === 0) {
    const backup = file + '.migrated-backup';
    fs.renameSync(file, backup);
    console.log(`data/posts.json → ${path.basename(backup)} (Sicherungskopie)`);
  }

  process.exit(err > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
