// import_kurse_lokal.js — Einmaliger Import der lokalen kursprogramm_data.json
// ins lokale Postgres. Aufruf (Git Bash, im pr-machine-Verzeichnis):
//   PGPASSWORD='DEIN_LOKALES_PRAPP_PW' node import_kurse_lokal.js

var fs = require('fs');
var path = require('path');
var { Pool } = require('pg');

var pool = new Pool({
  host: 'localhost', port: 5432,
  database: 'prmaschine', user: 'prapp',
  password: process.env.PGPASSWORD
});

function getKategorie(code) {
  if (!code) return 'Sonstiges';
  var m = String(code).match(/Sp(\d+)/);
  if (!m) return 'Sonstiges';
  var map = { 1:'Gesellschaft & Kultur', 2:'Kulturelle Bildung', 3:'Gesundheit',
              4:'Sprachen', 5:'Beruf & EDV', 6:'EDV & Medien', 7:'Grundbildung' };
  return map[parseInt(m[1])] || 'Sonstiges';
}

async function main() {
  var file = path.join(__dirname, 'data', 'kursprogramm_data.json');
  var kurse = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log('KURSE in JSON:', kurse.length);

  var client = await pool.connect();
  var imported = 0, skipped = 0;
  var seen = {};
  try {
    await client.query('BEGIN');
    for (var i = 0; i < kurse.length; i++) {
      var k = kurse[i];
      var code = k.id || k.kurscode;
      if (!code || seen[code]) { skipped++; continue; }
      seen[code] = true;
      var termin = (k.beginn && k.ende) ? (k.beginn + ' bis ' + k.ende)
                 : (k.beginn || k.ende || null);
      await client.query(
        `INSERT INTO kurse (kurscode, titel, beschreibung, termin, entgelt, kategorie)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (kurscode) DO UPDATE SET
           titel=EXCLUDED.titel, beschreibung=EXCLUDED.beschreibung,
           termin=EXCLUDED.termin, entgelt=EXCLUDED.entgelt,
           kategorie=EXCLUDED.kategorie, aktualisiert_am=now()`,
        [ code, k.titel || null, k.beschreibung || null, termin,
          k.entgelt || null, k.kategorie || getKategorie(code) ]
      );
      imported++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('FEHLER, Rollback:', err.message);
    process.exit(1);
  } finally {
    client.release();
  }
  console.log('Importiert (eindeutige Codes):', imported);
  console.log('Uebersprungen (Duplikate/leer):', skipped);
  await pool.end();
}

main();