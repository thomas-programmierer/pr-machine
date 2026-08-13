// test_db.js — schneller Verbindungstest fuer db.js
var db = require('./db');

async function run() {
  try {
    var anzahl = await db.testConnection();
    console.log('Verbindung OK. Kurse in DB:', anzahl);

    var kats = await db.getKategorien();
    console.log('Kategorien:', kats);

    var kurse = await db.getKurse();
    console.log('Erster Kurs:', kurse[0] ? kurse[0].id + ' - ' + kurse[0].titel : '(keiner)');

    var einr = await db.getEinreichungen();
    console.log('Einreichungen in DB:', einr.length);

    process.exit(0);
  } catch (err) {
    console.error('FEHLER:', err.message);
    process.exit(1);
  }
}

run();