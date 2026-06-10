// Multer: Uploads im Memory
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

function getKategorie(code) {
  if (!code) return 'Sonstiges';
  const m = String(code).match(/Sp(\d+)/);
  if (!m) return 'Sonstiges';
  const map = { 1:'Gesellschaft & Kultur', 2:'Kulturelle Bildung', 3:'Gesundheit',
                4:'Sprachen', 5:'Beruf & EDV', 6:'EDV & Medien', 7:'Grundbildung' };
  return map[parseInt(m[1])] || 'Sonstiges';
}

function parseKursDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

// GET /api/kurse
app.get('/api/kurse', (req, res) => {
  const { q, kategorie, limit = 5000, offset = 0 } = req.query;
  let result = KURSE;
  if (kategorie && kategorie !== 'alle') result = result.filter(k => k.kategorie === kategorie);
  if (q && q.trim()) {
    const s = q.toLowerCase().trim();
    result = result.filter(k =>
      k.titel.toLowerCase().includes(s) ||
      k.id.toLowerCase().includes(s) ||
      (k.beschreibung && k.beschreibung.toLowerCase().includes(s))
    );
  }
  const total = result.length;
  res.json({ total, offset: Number(offset), limit: Number(limit), kurse: result.slice(Number(offset), Number(offset) + Number(limit)) });
});

// GET /api/kurse/:id
app.get('/api/kurse/:id', (req, res) => {
  const kurs = KURSE.find(k => k.id === req.params.id);
  if (!kurs) return res.status(404).json({ error: 'Kurs nicht gefunden' });
  res.json(kurs);
});

// GET /api/kurse-kategorien
app.get('/api/kurse-kategorien', (req, res) => {
  res.json([...new Set(KURSE.map(k => k.kategorie))].sort());
});

// POST /admin/upload-kursprogramm
app.post('/admin/upload-kursprogramm', upload.single('kursprogramm'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Keine Datei empfangen' });
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: null, raw: false });
    if (rows.length < 2) return res.status(400).json({ error: 'Keine Daten in der Datei' });
    const kurse = [];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r[1] || !r[2]) continue;
      const id = String(r[1]).trim();
      if (id.includes('\n') || id.includes('\t') || id.length > 30) continue;
      if (!/^Sp[\d.]/.test(id)) continue;
      kurse.push({ id, titel: String(r[2]).trim(), beginn: parseKursDate(r[3]), ende: parseKursDate(r[4]),
        beschreibung: r[5] ? String(r[5]).trim().slice(0, 1000) : '',
        angemeldet: parseInt(r[6]) || 0, maximum: parseInt(r[7]) || 0, kategorie: getKategorie(id) });
    }
    if (kurse.length === 0) return res.status(400).json({ error: 'Keine gültigen Kurse gefunden' });
    const dataDir = require('path').join(__dirname, 'data');
    if (!require('fs').existsSync(dataDir)) require('fs').mkdirSync(dataDir);
    require('fs').writeFileSync(KURSE_JSON_PATH, JSON.stringify(kurse, null, 2), 'utf8');
    KURSE.length = 0; KURSE.push(...kurse);
    const kategorien = [...new Set(kurse.map(k => k.kategorie))].sort();
    console.log(`[Admin] Kursprogramm: ${kurse.length} Kurse importiert`);
    res.json({ success: true, count: kurse.length, kategorien });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /admin/upload-redaktionsplan
app.post('/admin/upload-redaktionsplan', upload.single('redaktionsplan'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Keine Datei empfangen' });
    const dest = require('path').join(__dirname, 'data', 'redaktionsplan.xlsx');
    require('fs').writeFileSync(dest, req.file.buffer);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET + POST /admin/urls
const URLS_PATH = require('path').join(__dirname, 'data', 'externe_urls.json');
app.get('/admin/urls', (req, res) => {
  try {
    res.json(require('fs').existsSync(URLS_PATH) ? JSON.parse(require('fs').readFileSync(URLS_PATH, 'utf8')) : { urls: [] });
  } catch { res.json({ urls: [] }); }
});
app.post('/admin/urls', express.json(), (req, res) => {
  try {
    const { urls } = req.body;
    if (!Array.isArray(urls)) return res.status(400).json({ error: 'Ungültiges Format' });
    require('fs').writeFileSync(URLS_PATH, JSON.stringify({ urls }, null, 2), 'utf8');
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
