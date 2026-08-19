// db.js — Zentrale Postgres-Anbindung fuer die VHS PR-Maschine
// Kapselt alle Datenbank-Zugriffe fuer Einreichungen und Kurse.
// Nach aussen: camelCase (wie Frontend/Code es erwartet). Intern in der DB: snake_case.

require('dotenv').config();
const { Pool } = require('pg');

var pool = new Pool({
  host:     process.env.PGHOST     || 'localhost',
  port:     process.env.PGPORT     || 5432,
  database: process.env.PGDATABASE || 'prmaschine',
  user:     process.env.PGUSER     || 'prapp',
  password: process.env.PGPASSWORD
});

function rowToEinreichung(r) {
  return {
    id:          r.id,
    anlass:      r.anlass,
    anlassId:    r.anlass_id,
    kurs:        r.kurs,
    kursNr:      r.kurs_nr,
    idee:        r.idee,
    text:        r.text,
    hashtags:    r.hashtags,
    kanal:       r.kanal,
    format:      r.format,
    datum:       r.datum,
    pb:          r.pb,
    status:      r.status,
    eingereicht: r.eingereicht_am || r.eingereicht,
    autor:       r.autor,
    autorId:     r.autor_id,
    quelle:      r.quelle,
    bild:        r.bild
  };
}

function rowToKurs(r) {
  return {
    id:           r.kurscode,
    titel:        r.titel,
    beschreibung: r.beschreibung,
    termin:       r.termin,
    entgelt:      r.entgelt,
    kategorie:    r.kategorie
  };
}

async function getEinreichungen() {
  var res = await pool.query('SELECT * FROM einreichungen ORDER BY id');
  return res.rows.map(rowToEinreichung);
}

async function addEinreichung(e) {
  var ts = e.eingereicht || null;
  var res = await pool.query(
    `INSERT INTO einreichungen
       (anlass, anlass_id, kurs, kurs_nr, idee, text, hashtags, kanal,
        format, datum, pb, status, eingereicht, autor, autor_id, quelle,
        bild, eingereicht_am)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [ e.anlass, e.anlassId, e.kurs, e.kursNr, e.idee, e.text, e.hashtags,
      e.kanal, e.format, e.datum || null, e.pb, e.status, !!ts, e.autor,
      e.autorId, e.quelle, e.bild || null, ts ]
  );
  return rowToEinreichung(res.rows[0]);
}

async function updateEinreichung(id, e) {
  var ts = e.eingereicht || null;
  var res = await pool.query(
    `UPDATE einreichungen SET
       anlass=$2, anlass_id=$3, kurs=$4, kurs_nr=$5, idee=$6, text=$7,
       hashtags=$8, kanal=$9, format=$10, datum=$11, pb=$12, status=$13,
       eingereicht=$14, autor=$15, autor_id=$16, quelle=$17, bild=$18,
       eingereicht_am=$19
     WHERE id=$1
     RETURNING *`,
    [ id, e.anlass, e.anlassId, e.kurs, e.kursNr, e.idee, e.text, e.hashtags,
      e.kanal, e.format, e.datum || null, e.pb, e.status, !!ts, e.autor,
      e.autorId, e.quelle, e.bild || null, ts ]
  );
  return res.rows[0] ? rowToEinreichung(res.rows[0]) : null;
}

async function deleteEinreichung(id) {
  await pool.query('DELETE FROM einreichungen WHERE id=$1', [id]);
}

async function setEinreichungStatus(id, status) {
  var res = await pool.query(
    'UPDATE einreichungen SET status=$2 WHERE id=$1 RETURNING *',
    [id, status]
  );
  return res.rows[0] ? rowToEinreichung(res.rows[0]) : null;
}

async function getKurse() {
  var res = await pool.query('SELECT * FROM kurse ORDER BY kurscode');
  return res.rows.map(rowToKurs);
}

async function getKursByCode(code) {
  var res = await pool.query('SELECT * FROM kurse WHERE kurscode=$1', [code]);
  return res.rows[0] ? rowToKurs(res.rows[0]) : null;
}

async function getKategorien() {
  var res = await pool.query(
    "SELECT DISTINCT kategorie FROM kurse WHERE kategorie IS NOT NULL ORDER BY kategorie"
  );
  return res.rows.map(function(r){ return r.kategorie; });
}

async function upsertKurse(kurse) {
  var client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (var i = 0; i < kurse.length; i++) {
      var k = kurse[i];
      var code = k.id || k.kurscode;
      if (!code) continue;
      var termin = k.termin ||
        ((k.beginn && k.ende) ? (k.beginn + ' bis ' + k.ende)
                              : (k.beginn || k.ende || null));
      await client.query(
        `INSERT INTO kurse (kurscode, titel, beschreibung, termin, entgelt, kategorie)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (kurscode) DO UPDATE SET
           titel=EXCLUDED.titel, beschreibung=EXCLUDED.beschreibung,
           termin=EXCLUDED.termin, entgelt=EXCLUDED.entgelt,
           kategorie=EXCLUDED.kategorie, aktualisiert_am=now()`,
        [ code, k.titel || null, k.beschreibung || null, termin,
          k.entgelt || null, k.kategorie || null ]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Posts ──────────────────────────────────────────────────────────────────────

function rowToPost(r) {
  return {
    id:             String(r.id),
    datum:          r.datum ? r.datum.toISOString().slice(0,10) : null,
    uhrzeit:        r.uhrzeit,
    kanal:          r.kanal,
    anlass:         r.anlass,
    text:           r.text,
    tags:           r.tags,
    status:         r.status,
    ziel:           r.ziel,
    freigabe:       r.freigabe,
    freigegebenVon: r.freigegeben_von,
    paid:           r.paid,
    url:            r.url,
    erstellt:       r.erstellt ? r.erstellt.toISOString() : null,
    autor:          r.autor,
    autorId:        r.autor_id,
    bild:           r.bild || null,
    pb:             r.pb || null,
    kiKennzeichnung: r.ki_kennzeichnung || ''
  };
}

async function getPosts() {
  var res = await pool.query('SELECT * FROM posts ORDER BY datum, uhrzeit');
  return res.rows.map(rowToPost);
}

async function addPost(p) {
  var res = await pool.query(
    `INSERT INTO posts
       (datum, uhrzeit, kanal, anlass, text, tags, status, ziel,
        freigabe, freigegeben_von, paid, url, erstellt, autor, autor_id, bild, pb,
        ki_kennzeichnung)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [ p.datum || null, p.uhrzeit || null, p.kanal || null, p.anlass || null,
      p.text || null, p.tags || null, p.status || 'geplant', p.ziel || null,
      p.freigabe || null, p.freigegebenVon || p.freigegeben_von || null,
      p.paid || 'nein', p.url || null,
      p.erstellt || new Date().toISOString(), p.autor || null, p.autorId || p.autor_id || null,
      p.bild || null, p.pb || null,
      p.kiKennzeichnung || p.ki_kennzeichnung || '' ]
  );
  return rowToPost(res.rows[0]);
}

async function updatePost(id, p) {
  var res = await pool.query(
    `UPDATE posts SET
       datum=$2, uhrzeit=$3, kanal=$4, anlass=$5, text=$6, tags=$7,
       status=$8, ziel=$9, freigabe=$10, freigegeben_von=$11,
       paid=$12, url=$13, autor=$14, autor_id=$15,
       ki_kennzeichnung=COALESCE($16, ki_kennzeichnung)
     WHERE id=$1
     RETURNING *`,
    [ id, p.datum || null, p.uhrzeit || null, p.kanal || null, p.anlass || null,
      p.text || null, p.tags || null, p.status || 'geplant', p.ziel || null,
      p.freigabe || null, p.freigegebenVon || p.freigegeben_von || null,
      p.paid || 'nein', p.url || null, p.autor || null, p.autorId || p.autor_id || null,
      // undefined laesst den Bestand stehen, '' setzt bewusst zurueck
      (p.kiKennzeichnung !== undefined ? p.kiKennzeichnung
        : (p.ki_kennzeichnung !== undefined ? p.ki_kennzeichnung : null)) ]
  );
  return res.rows[0] ? rowToPost(res.rows[0]) : null;
}

async function deletePost(id) {
  await pool.query('DELETE FROM posts WHERE id=$1', [id]);
}

async function setPostStatus(id, status, extra) {
  // Nur Status (und optionale Felder) aendern — alle anderen Felder bleiben
  var sets = ['status=$2'];
  var vals = [id, status];
  var idx  = 3;
  if (extra && extra.freigegeben_von) { sets.push('freigegeben_von=$' + idx++); vals.push(extra.freigegeben_von); }
  if (extra && extra.freigegebenVon)  { sets.push('freigegeben_von=$' + idx++); vals.push(extra.freigegebenVon); }
  var res = await pool.query(
    'UPDATE posts SET ' + sets.join(',') + ' WHERE id=$1 RETURNING *',
    vals
  );
  return res.rows[0] ? rowToPost(res.rows[0]) : null;
}

// ── ensureTables ───────────────────────────────────────────────────────────────

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS einreichungen (
      id              SERIAL PRIMARY KEY,
      anlass          TEXT,
      anlass_id       TEXT,
      kurs            TEXT,
      kurs_nr         TEXT,
      idee            TEXT,
      text            TEXT,
      hashtags        TEXT,
      kanal           TEXT,
      format          TEXT,
      datum           DATE,
      pb              TEXT,
      status          TEXT DEFAULT 'neu',
      eingereicht     BOOLEAN DEFAULT FALSE,
      eingereicht_am  TIMESTAMPTZ,
      autor           TEXT,
      autor_id        TEXT,
      quelle          TEXT,
      bild            TEXT
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id              SERIAL PRIMARY KEY,
      datum           DATE,
      uhrzeit         TEXT,
      kanal           TEXT,
      anlass          TEXT,
      text            TEXT,
      tags            TEXT,
      status          TEXT DEFAULT 'geplant',
      ziel            TEXT,
      freigabe        TEXT,
      freigegeben_von TEXT,
      paid            TEXT DEFAULT 'nein',
      url             TEXT,
      erstellt        TIMESTAMPTZ DEFAULT now(),
      autor           TEXT,
      autor_id        TEXT
    )
  `);
  await pool.query(`
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS bild TEXT
  `);
  await pool.query(`
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS pb TEXT
  `);
  // Kennzeichnung nach EU AI Act Art. 50 Abs. 4:
  // '' = noch nicht entschieden | 'keine' | 'ai' | 'ai-generated' | 'ai-modified'
  await pool.query(`
    ALTER TABLE posts ADD COLUMN IF NOT EXISTS ki_kennzeichnung TEXT
  `);
}

async function testConnection() {
  var res = await pool.query('SELECT count(*)::int AS n FROM kurse');
  return res.rows[0].n;
}

module.exports = {
  pool,
  getEinreichungen, addEinreichung, updateEinreichung, deleteEinreichung,
  setEinreichungStatus,
  getKurse, getKursByCode, getKategorien, upsertKurse,
  getPosts, addPost, updatePost, deletePost, setPostStatus,
  testConnection, ensureTables
};
