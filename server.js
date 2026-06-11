// VHS Spandau PR-Maschine — Server mit Login, Rollen, Benutzerverwaltung, Admin-Input

// === VHS UPDATE: Kursprogramm-Upload & Admin-Routen ===
const multer = require('multer');
const XLSX   = require('xlsx');
const KURSE_JSON_PATH = require('path').join(__dirname, 'data', 'kursprogramm_data.json');
let KURSE = require('fs').existsSync(KURSE_JSON_PATH)
  ? JSON.parse(require('fs').readFileSync(KURSE_JSON_PATH, 'utf8'))
  : [];
// === END VHS UPDATE REQUIRES ===
const http   = require("http");
const https  = require("https");
const fs     = require("fs");
const path   = require("path");

const PORT     = process.env.PORT || 3000;
const API_KEY  = process.env.ANTHROPIC_API_KEY || "";
const SESSIONS = {};

const USERS_FILE       = path.join(__dirname, "users.json");
const POSTS_FILE       = path.join(__dirname, "posts.json");
const PERF_FILE        = path.join(__dirname, "performance.json");
const EINR_FILE        = path.join(__dirname, "einreichungen.json");
const KONTEXT_FILE     = path.join(__dirname, "kursprogramm_kontext.json");
const REDPLAN_FILE     = path.join(__dirname, "redaktionsplan_meta.json");

if (!API_KEY) { console.error("❌  ANTHROPIC_API_KEY fehlt."); process.exit(1); }

const MIME = {
  ".html":"text/html; charset=utf-8", ".css":"text/css", ".js":"application/javascript",
  ".json":"application/json", ".png":"image/png", ".jpg":"image/jpeg",
  ".svg":"image/svg+xml", ".ico":"image/x-icon", ".xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls":"application/vnd.ms-excel"
};

// ── Sessions ──────────────────────────────────────────────────────────────────
function createSession(user) {
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  SESSIONS[token] = { user, expires: Date.now() + 8*60*60*1000 };
  return token;
}
function getToken(req) {
  const c = req.headers.cookie || "";
  const m = c.match(/session=([^;]+)/);
  return m ? m[1] : null;
}
function getSession(token) {
  if (!token) return null;
  const s = SESSIONS[token];
  if (!s || s.expires < Date.now()) { delete SESSIONS[token]; return null; }
  return s;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function jsonRes(res, status, data, extra={}) {
  res.writeHead(status, { "Content-Type":"application/json", "Access-Control-Allow-Origin":"*", ...extra });
  res.end(JSON.stringify(data));
}
function adminOnly(sess) { return sess && sess.user.role === "admin"; }
function loadJSON(file, def) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return def; }
}
function saveJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8"); }
function loadUsers() { return loadJSON(USERS_FILE, { users:[] }).users; }
function saveUsers(u) { saveJSON(USERS_FILE, { users: u }); }
function safeUser(u) { const { password:_, ...s } = u; return s; }
async function readBody(req) {
  return new Promise((res, rej) => {
    let b = "";
    req.on("data", d => b += d);
    req.on("end", () => { try { res(JSON.parse(b)); } catch { res({}); } });
    req.on("error", rej);
  });
}
async function readBodyRaw(req) {
  return new Promise((res, rej) => {
    const chunks = [];
    req.on("data", d => chunks.push(d));
    req.on("end", () => res(Buffer.concat(chunks)));
    req.on("error", rej);
  });
}

// ── Anthropic Proxy ───────────────────────────────────────────────────────────
function callAnthropic(body, res) {
  // Kursprogramm-Kontext in System-Prompt einbetten
  const kontext = loadJSON(KONTEXT_FILE, { text: "" });
  if (kontext.text && body.system) {
    body.system = body.system + "\n\n--- KURSPROGRAMM-KONTEXT (aktuelle Kursbeschreibungen für Faktengenauigkeit) ---\n" + kontext.text.slice(0, 8000);
  } else if (kontext.text) {
    body.system = "--- KURSPROGRAMM-KONTEXT (aktuelle Kursbeschreibungen für Faktengenauigkeit) ---\n" + kontext.text.slice(0, 8000);
  }
  const payload = JSON.stringify(body);
  const opts = {
    hostname: "api.anthropic.com", path: "/v1/messages", method: "POST",
    headers: { "Content-Type":"application/json", "x-api-key":API_KEY,
               "anthropic-version":"2023-06-01", "Content-Length":Buffer.byteLength(payload) }
  };
  const r = https.request(opts, ar => {
    res.writeHead(ar.statusCode, { "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" });
    ar.pipe(res);
  });
  r.on("error", e => jsonRes(res, 500, { error: e.message }));
  r.write(payload); r.end();
}

// ── Multipart Parser (ohne externe Deps) ─────────────────────────────────────
function parseMultipart(buffer, boundary) {
  const sep = Buffer.from("--" + boundary);
  const parts = [];
  let start = 0;
  while (start < buffer.length) {
    const sepIdx = buffer.indexOf(sep, start);
    if (sepIdx === -1) break;
    const headerStart = sepIdx + sep.length + 2;
    const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"), headerStart);
    if (headerEnd === -1) break;
    const headerStr = buffer.slice(headerStart, headerEnd).toString("utf8");
    const bodyStart = headerEnd + 4;
    const nextSep = buffer.indexOf(sep, bodyStart);
    const bodyEnd = nextSep === -1 ? buffer.length : nextSep - 2;
    const body = buffer.slice(bodyStart, bodyEnd);
    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const fileMatch = headerStr.match(/filename="([^"]+)"/);
    if (nameMatch) {
      parts.push({
        name: nameMatch[1],
        filename: fileMatch ? fileMatch[1] : null,
        data: body,
        text: fileMatch ? null : body.toString("utf8").trim()
      });
    }
    start = nextSep === -1 ? buffer.length : nextSep;
  }
  return parts;
}

// ── SERVER ────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin":"*",
      "Access-Control-Allow-Methods":"GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers":"Content-Type" });
    return res.end();
  }

  const url  = req.url.split("?")[0];
  const sess = getSession(getToken(req));

  // ── AUTH ──────────────────────────────────────────────────────────────────
  if (req.method === "POST" && url === "/api/login") {
    const b = await readBody(req);
    const users = loadUsers();
    const u = users.find(x => x.username === b.username && x.password === b.password && x.aktiv !== false);
    if (!u) return jsonRes(res, 401, { error:"Ungültige Zugangsdaten" });
    const token = createSession(u);
    return jsonRes(res, 200, { ok:true, user:safeUser(u) },
      { "Set-Cookie":`session=${token}; HttpOnly; SameSite=Lax; Max-Age=28800` });
  }

  if (req.method === "POST" && url === "/api/logout") {
    const t = getToken(req);
    if (t) delete SESSIONS[t];
    return jsonRes(res, 200, { ok:true },
      { "Set-Cookie":"session=; HttpOnly; Max-Age=0" });
  }

  if (req.method === "GET" && url === "/api/me") {
    if (!sess) return jsonRes(res, 401, { error:"Nicht eingeloggt" });
    return jsonRes(res, 200, { user: safeUser(sess.user) });
  }

  // ── USERS ─────────────────────────────────────────────────────────────────
  if (req.method === "GET" && url === "/api/users") {
    if (!adminOnly(sess)) return jsonRes(res, 403, { error:"Kein Zugriff" });
    return jsonRes(res, 200, { users: loadUsers().map(safeUser) });
  }

  if (req.method === "POST" && url === "/api/users") {
    if (!adminOnly(sess)) return jsonRes(res, 403, { error:"Kein Zugriff" });
    const b = await readBody(req);
    if (!b.name || !b.username || !b.password || !b.role)
      return jsonRes(res, 400, { error:"Pflichtfelder fehlen: name, username, password, role" });
    const users = loadUsers();
    if (users.find(u => u.username === b.username))
      return jsonRes(res, 409, { error:"Benutzername bereits vergeben" });
    const neu = { id:String(Date.now()), name:b.name, username:b.username,
                  password:b.password, role:b.role, pb:b.pb||"alle", aktiv:true };
    users.push(neu);
    saveUsers(users);
    return jsonRes(res, 201, { ok:true, user:safeUser(neu) });
  }

  if (req.method === "PUT" && url.startsWith("/api/users/")) {
    if (!adminOnly(sess)) return jsonRes(res, 403, { error:"Kein Zugriff" });
    const id = url.split("/")[3];
    const b = await readBody(req);
    const users = loadUsers();
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) return jsonRes(res, 404, { error:"User nicht gefunden" });
    users[idx] = { ...users[idx], ...b, id };
    saveUsers(users);
    return jsonRes(res, 200, { ok:true, user:safeUser(users[idx]) });
  }

  if (req.method === "DELETE" && url.startsWith("/api/users/")) {
    if (!adminOnly(sess)) return jsonRes(res, 403, { error:"Kein Zugriff" });
    const id = url.split("/")[3];
    const users = loadUsers().filter(u => u.id !== id);
    saveUsers(users);
    return jsonRes(res, 200, { ok:true });
  }

  // ── POSTS ─────────────────────────────────────────────────────────────────
  if (req.method === "GET" && url === "/api/posts") {
    if (!sess) return jsonRes(res, 401, { error:"Nicht eingeloggt" });
    return jsonRes(res, 200, loadJSON(POSTS_FILE, []));
  }

  if (req.method === "POST" && url === "/api/posts") {
    if (!sess) return jsonRes(res, 401, { error:"Nicht eingeloggt" });
    const b = await readBody(req);
    const posts = loadJSON(POSTS_FILE, []);
    const neu = { id:String(Date.now()), ...b, erstellt:new Date().toISOString(), autor:sess.user.name, autorId:sess.user.id };
    posts.push(neu);
    saveJSON(POSTS_FILE, posts);
    return jsonRes(res, 201, { ok:true, post:neu });
  }

  if (req.method === "PUT" && url.startsWith("/api/posts/")) {
    if (!sess || !["admin","redakteur"].includes(sess.user.role))
      return jsonRes(res, 403, { error:"Kein Zugriff" });
    const id = url.split("/")[3];
    const b = await readBody(req);
    const posts = loadJSON(POSTS_FILE, []);
    const idx = posts.findIndex(p => p.id === id);
    if (idx === -1) return jsonRes(res, 404, { error:"Post nicht gefunden" });
    posts[idx] = { ...posts[idx], ...b };
    saveJSON(POSTS_FILE, posts);
    return jsonRes(res, 200, { ok:true, post: posts[idx] });
  }

  if (req.method === "DELETE" && url.startsWith("/api/posts/")) {
    if (!sess || !["admin","redakteur"].includes(sess.user.role))
      return jsonRes(res, 403, { error:"Kein Zugriff" });
    const id = url.split("/")[3];
    const posts = loadJSON(POSTS_FILE, []).filter(p => p.id !== id);
    saveJSON(POSTS_FILE, posts);
    return jsonRes(res, 200, { ok:true });
  }

  // ── PERFORMANCE ───────────────────────────────────────────────────────────
  if (req.method === "GET" && url === "/api/performance") {
    if (!sess) return jsonRes(res, 401, { error:"Nicht eingeloggt" });
    return jsonRes(res, 200, loadJSON(PERF_FILE, []));
  }

  if (req.method === "POST" && url === "/api/performance") {
    if (!sess) return jsonRes(res, 401, { error:"Nicht eingeloggt" });
    const b = await readBody(req);
    const perf = loadJSON(PERF_FILE, []);
    perf.push({ id:String(Date.now()), ...b, erfasst:new Date().toISOString() });
    saveJSON(PERF_FILE, perf);
    return jsonRes(res, 201, { ok:true });
  }

  // ── KURSE ─────────────────────────────────────────────────────────────────
  if (req.method === "GET" && url === "/api/kurse") {
    if (!sess) return jsonRes(res, 401, { error:"Nicht eingeloggt" });
    try {
      const alleKurse = JSON.parse(fs.readFileSync(path.join(__dirname, "public", "kurse.json"), "utf8"));
      const kurse = (sess.user.role === "admin" || sess.user.role === "redakteur" || sess.user.pb === "alle")
        ? alleKurse
        : alleKurse.filter(k => k.pb === sess.user.pb);
      return res.end(JSON.stringify(kurse));
    } catch { return jsonRes(res, 500, { error:"kurse.json nicht lesbar" }); }
  }

  // ── EINREICHUNGEN ─────────────────────────────────────────────────────────
  if (req.method === "GET" && url === "/api/einreichungen") {
    if (!sess) return jsonRes(res, 401, { error:"Nicht eingeloggt" });
    const alle = loadJSON(EINR_FILE, []);
    // Admins + Redakteure sehen alle; PBL nur eigene
    if (["admin","redakteur"].includes(sess.user.role)) {
      return jsonRes(res, 200, alle);
    }
    if (sess.user.role === "pbl") {
      return jsonRes(res, 200, alle.filter(e => e.autorId === sess.user.id));
    }
    return jsonRes(res, 403, { error:"Kein Zugriff" });
  }

  if (req.method === "POST" && url === "/api/einreichungen") {
    if (!sess) return jsonRes(res, 401, { error:"Nicht eingeloggt" });
    const b = await readBody(req);
    const einr = loadJSON(EINR_FILE, []);
    const neu = {
      id: String(Date.now()),
      ...b,
      status: "neu",               // neu | angenommen | abgelehnt
      eingereicht: new Date().toISOString(),
      autor: sess.user.name,
      autorId: sess.user.id,
      pb: sess.user.pb || "alle"
    };
    einr.push(neu);
    saveJSON(EINR_FILE, einr);
    return jsonRes(res, 201, { ok:true, einreichung: neu });
  }

  if (req.method === "PUT" && url.startsWith("/api/einreichungen/")) {
    if (!sess || !["admin","redakteur"].includes(sess.user.role))
      return jsonRes(res, 403, { error:"Kein Zugriff" });
    const id = url.split("/")[3];
    const b = await readBody(req);
    const einr = loadJSON(EINR_FILE, []);
    const idx = einr.findIndex(e => e.id === id);
    if (idx === -1) return jsonRes(res, 404, { error:"Nicht gefunden" });
    einr[idx] = { ...einr[idx], ...b };
    saveJSON(EINR_FILE, einr);
    return jsonRes(res, 200, { ok:true, einreichung: einr[idx] });
  }

  // ── ADMIN INPUT: Redaktionsplan-URLs ─────────────────────────────────────
  if (req.method === "GET" && url === "/api/admin/redaktionsplan-urls") {
    if (!adminOnly(sess)) return jsonRes(res, 403, { error:"Kein Zugriff" });
    const meta = loadJSON(REDPLAN_FILE, { urls: [], lastUpdate: null });
    return jsonRes(res, 200, meta);
  }

  if (req.method === "POST" && url === "/api/admin/redaktionsplan-urls") {
    if (!adminOnly(sess)) return jsonRes(res, 403, { error:"Kein Zugriff" });
    const b = await readBody(req);
    const meta = loadJSON(REDPLAN_FILE, { urls: [], lastUpdate: null });
    if (!Array.isArray(b.urls)) return jsonRes(res, 400, { error:"urls muss ein Array sein" });
    meta.urls = b.urls.filter(u => typeof u === "string" && u.startsWith("http"));
    meta.lastUpdate = new Date().toISOString();
    meta.updatedBy = sess.user.name;
    saveJSON(REDPLAN_FILE, meta);
    return jsonRes(res, 200, { ok:true, meta });
  }

  // ── ADMIN INPUT: Datei-Upload (Redaktionsplan XLS + Kursprogramm XLS) ────
  if (req.method === "POST" && url === "/api/admin/upload") {
    if (!adminOnly(sess)) return jsonRes(res, 403, { error:"Kein Zugriff" });
    const ct = req.headers["content-type"] || "";
    const boundaryMatch = ct.match(/boundary=([^\s;]+)/);
    if (!boundaryMatch) return jsonRes(res, 400, { error:"Kein multipart boundary" });
    const boundary = boundaryMatch[1];
    const rawBody = await readBodyRaw(req);
    const parts = parseMultipart(rawBody, boundary);
    const typePart = parts.find(p => p.name === "type");
    const filePart = parts.find(p => p.filename);
    if (!typePart || !filePart) return jsonRes(res, 400, { error:"Felder 'type' und Datei erforderlich" });
    const uploadType = typePart.text; // "redaktionsplan" | "kursprogramm"
    const allowedExt = [".xls", ".xlsx", ".csv"];
    const ext = path.extname(filePart.filename).toLowerCase();
    if (!allowedExt.includes(ext)) return jsonRes(res, 400, { error:"Nur .xls, .xlsx, .csv erlaubt" });
    const uploadDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    const ts = Date.now();
    const safeName = uploadType + "_" + ts + ext;
    const dest = path.join(uploadDir, safeName);
    fs.writeFileSync(dest, filePart.data);

    // Kursprogramm: Text-Extraktion für KI-Kontext (CSV sofort lesbar, XLS als Rohdaten)
    if (uploadType === "kursprogramm") {
      let textContent = "";
      if (ext === ".csv") {
        textContent = filePart.data.toString("utf8");
      } else {
        // XLS/XLSX: Rohdaten als base64 speichern, Text-Hinweis setzen
        textContent = filePart.data.toString("utf8", 0, Math.min(filePart.data.length, 50000));
      }
      const kontext = {
        filename: filePart.filename,
        uploaded: new Date().toISOString(),
        uploadedBy: sess.user.name,
        text: textContent.slice(0, 50000)
      };
      saveJSON(KONTEXT_FILE, kontext);
    }

    // Redaktionsplan: Metadaten speichern
    if (uploadType === "redaktionsplan") {
      const meta = loadJSON(REDPLAN_FILE, { urls: [], lastUpdate: null });
      meta.lastFileUpload = {
        filename: filePart.filename,
        savedAs: safeName,
        uploaded: new Date().toISOString(),
        uploadedBy: sess.user.name,
        size: filePart.data.length
      };
      meta.lastUpdate = new Date().toISOString();
      saveJSON(REDPLAN_FILE, meta);
    }

    return jsonRes(res, 200, {
      ok: true,
      type: uploadType,
      filename: filePart.filename,
      savedAs: safeName,
      size: filePart.data.length
    });
  }

  // ── ADMIN INPUT: Status-Übersicht ─────────────────────────────────────────
  if (req.method === "GET" && url === "/api/admin/status") {
    if (!adminOnly(sess)) return jsonRes(res, 403, { error:"Kein Zugriff" });
    const kontext = loadJSON(KONTEXT_FILE, null);
    const redplan = loadJSON(REDPLAN_FILE, null);
    return jsonRes(res, 200, {
      kursprogramm: kontext ? {
        filename: kontext.filename,
        uploaded: kontext.uploaded,
        uploadedBy: kontext.uploadedBy,
        chars: kontext.text ? kontext.text.length : 0
      } : null,
      redaktionsplan: redplan ? {
        lastFileUpload: redplan.lastFileUpload || null,
        urls: redplan.urls || [],
        lastUpdate: redplan.lastUpdate || null
      } : null
    });
  }

  // ── KI GENERATE (mit Kursprogramm-Kontext) ────────────────────────────────
  if (req.method === "POST" && url === "/api/generate") {
    if (!sess || !["admin","redakteur"].includes(sess.user.role))
      return jsonRes(res, 403, { error:"Kein Zugriff — nur für Redakteure" });
    return callAnthropic(await readBody(req), res);
  }

  // ── SEITEN ────────────────────────────────────────────────────────────────
  if (req.method === "GET" && url === "/performance")
    return fs.readFile(path.join(__dirname, "public", "performance.html"), (e,c) => { if(e){res.writeHead(404);return res.end("404");} res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(c); });
  if (req.method === "GET" && url === "/freigabe")
    return fs.readFile(path.join(__dirname, "public", "freigabe.html"), (e,c) => { if(e){res.writeHead(404);return res.end("404");} res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(c); });
  if (req.method === "GET" && url === "/editor")
    return fs.readFile(path.join(__dirname, "public", "editor.html"), (e,c) => { if(e){res.writeHead(404);return res.end("404");} res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(c); });
  if (req.method === "GET" && url === "/kalender")
    return fs.readFile(path.join(__dirname, "public", "kalender.html"), (e,c) => { if(e){res.writeHead(404);return res.end("404");} res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(c); });
  if (req.method === "GET" && url === "/kurse")
    return fs.readFile(path.join(__dirname, "public", "kurse.html"), (e,c) => { if(e){res.writeHead(404);return res.end("404");} res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(c); });
  if (req.method === "GET" && url === "/admin")
    return fs.readFile(path.join(__dirname, "public", "admin.html"), (e,c) => { if(e){res.writeHead(404);return res.end("404");} res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});res.end(c); });

  // ── KURSPROGRAMM API ──────────────────────────────────────────────────────
  if (req.method === "GET" && url.startsWith("/api/kurse")) {
    const urlObj = new URL("http://x" + req.url);
    const id = url.split("/")[3];
    if (id && id !== 'kategorien') {
      const kurs = KURSE.find(k => k.id === id);
      if (!kurs) return jsonRes(res, 404, { error: 'Kurs nicht gefunden' });
      return jsonRes(res, 200, kurs);
    }
    if (url === "/api/kurse-kategorien") {
      return jsonRes(res, 200, [...new Set(KURSE.map(k => k.kategorie))].sort());
    }
    const q = urlObj.searchParams.get('q');
    const kategorie = urlObj.searchParams.get('kategorie');
    const limit = parseInt(urlObj.searchParams.get('limit')) || 5000;
    const offset = parseInt(urlObj.searchParams.get('offset')) || 0;
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
    return jsonRes(res, 200, { total: result.length, offset, limit, kurse: result.slice(offset, offset + limit) });
  }

  if (req.method === "POST" && url === "/admin/upload-kursprogramm") {
    if (!adminOnly(sess)) return jsonRes(res, 403, { error: "Kein Zugriff" });
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        const boundary = req.headers['content-type']?.split('boundary=')[1];
        if (!boundary) return jsonRes(res, 400, { error: 'Kein Boundary' });
        // Einfacher multipart-Parser für xlsx
        const marker = Buffer.from('--' + boundary);
        const parts = [];
        let start = buf.indexOf(marker) + marker.length + 2;
        while (start < buf.length) {
          const end = buf.indexOf(marker, start);
          if (end === -1) break;
          const part = buf.slice(start, end - 2);
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd !== -1) parts.push(part.slice(headerEnd + 4));
          start = end + marker.length + 2;
        }
        if (!parts[0]) return jsonRes(res, 400, { error: 'Keine Datei' });
        const workbook = XLSX.read(parts[0], { type: 'buffer', cellDates: true });
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: null, raw: false });
        if (rows.length < 2) return jsonRes(res, 400, { error: 'Keine Daten' });
        const kurse = [];
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          if (!r[1] || !r[2]) continue;
          const id = String(r[1]).trim();
          if (id.includes('\n') || id.length > 30 || !/^Sp[\d.]/.test(id)) continue;
          kurse.push({ id, titel: String(r[2]).trim(), beginn: parseKursDate(r[3]), ende: parseKursDate(r[4]),
            beschreibung: r[5] ? String(r[5]).trim().slice(0, 1000) : '',
            angemeldet: parseInt(r[6]) || 0, maximum: parseInt(r[7]) || 0, kategorie: getKategorie(id) });
        }
        if (!kurse.length) return jsonRes(res, 400, { error: 'Keine gültigen Kurse' });
        const dataDir = path.join(__dirname, 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
        fs.writeFileSync(KURSE_JSON_PATH, JSON.stringify(kurse, null, 2), 'utf8');
        KURSE.length = 0; KURSE.push(...kurse);
        return jsonRes(res, 200, { success: true, count: kurse.length });
      } catch (err) { return jsonRes(res, 500, { error: err.message }); }
    });
    return;
  }

  if (req.method === "POST" && url === "/admin/upload-redaktionsplan") {
    if (!adminOnly(sess)) return jsonRes(res, 403, { error: "Kein Zugriff" });
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        const dest = path.join(__dirname, 'data', 'redaktionsplan.xlsx');
        fs.writeFileSync(dest, buf);
        return jsonRes(res, 200, { success: true });
      } catch (err) { return jsonRes(res, 500, { error: err.message }); }
    });
    return;
  }

  if (req.method === "GET" && url === "/admin/urls") {
    const URLS_PATH = path.join(__dirname, 'data', 'externe_urls.json');
    try {
      return jsonRes(res, 200, fs.existsSync(URLS_PATH) ? JSON.parse(fs.readFileSync(URLS_PATH, 'utf8')) : { urls: [] });
    } catch { return jsonRes(res, 200, { urls: [] }); }
  }

  if (req.method === "POST" && url === "/admin/urls") {
    if (!adminOnly(sess)) return jsonRes(res, 403, { error: "Kein Zugriff" });
    const URLS_PATH = path.join(__dirname, 'data', 'externe_urls.json');
    const b = await readBody(req);
    if (!Array.isArray(b.urls)) return jsonRes(res, 400, { error: 'Ungültiges Format' });
    fs.writeFileSync(URLS_PATH, JSON.stringify({ urls: b.urls }, null, 2), 'utf8');
    return jsonRes(res, 200, { success: true });
  }

  // ── STATISCHE DATEIEN ─────────────────────────────────────────────────────
  let fp = path.join(__dirname, "public", url === "/" || !url.includes(".") ? "index.html" : url);
  fs.readFile(fp, (err, c) => {
    if (err) {
      fs.readFile(path.join(__dirname, "public", "index.html"), (e2, c2) => {
        if (e2) { res.writeHead(404); return res.end("404"); }
        res.writeHead(200, { "Content-Type":"text/html; charset=utf-8" }); res.end(c2);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" });
    res.end(c);
  });
});


// === VHS UPDATE: Hilfsfunktionen ===
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

// === END VHS UPDATE ROUTEN ===

server.listen(PORT, () => {
  console.log("\n  ✅  VHS Spandau PR-Maschine läuft");
  console.log(`  🌐  http://localhost:${PORT}`);
  console.log("  🔑  API-Key: aktiv\n  Stoppen: Strg+C\n");
});
