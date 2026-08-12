// VHS Spandau PR-Maschine — Server mit Login, Rollen, Benutzerverwaltung, Admin-Input

const multer = require('multer');
const XLSX   = require('xlsx');
const bcrypt = require('bcrypt');
const db     = require('./db');   // Postgres-Anbindung (Einreichungen + Kurse)
const mailer = require('./mailer');

const http   = require("http");
const https  = require("https");
const fs     = require("fs");
const path   = require("path");

const PORT     = process.env.PORT || 3000;
const API_KEY  = process.env.ANTHROPIC_API_KEY || "";
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');
let SESSIONS = {};
try {
  const raw = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  const now = Date.now();
  Object.entries(raw).forEach(([k,v]) => { if (v.expires > now) SESSIONS[k] = v; });
} catch {}
function saveSessions() {
  try { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(SESSIONS), 'utf8'); } catch {} 
}

const USERS_FILE   = path.join(__dirname, "users.json");
const POSTS_FILE   = path.join(__dirname, "data", "posts.json");
const PERF_FILE    = path.join(__dirname, "data", "performance.json");
const DATA_DIR     = fs.existsSync(path.join(__dirname, "data"))
  ? path.join(__dirname, "data")
  : (fs.existsSync('/app/data') ? '/app/data' : __dirname);
const KONTEXT_FILE = path.join(__dirname, 'kursprogramm_kontext.json');
const PW_OVERRIDE_FILE = path.join(__dirname, 'passwords_override.json');

// Passwort-Lookup: passwords_override.json hat Vorrang vor users.json
function getPassword(userId) {
  try {
    const ov = JSON.parse(fs.readFileSync(PW_OVERRIDE_FILE, 'utf8'));
    if (ov[userId]) return ov[userId];
  } catch {}
  return null;
}
async function setPassword(userId, pw) {
  let ov = {};
  try { ov = JSON.parse(fs.readFileSync(PW_OVERRIDE_FILE, 'utf8')); } catch {}
  ov[userId] = await bcrypt.hash(pw, 10);
  fs.writeFileSync(PW_OVERRIDE_FILE, JSON.stringify(ov, null, 2), 'utf8');
}
const REDPLAN_FILE = path.join(DATA_DIR, "redaktionsplan_meta.json");

if (!API_KEY) { console.error("❌  ANTHROPIC_API_KEY fehlt."); process.exit(1); }

const MIME = {
  ".html":"text/html; charset=utf-8", ".css":"text/css", ".js":"application/javascript",
  ".json":"application/json", ".png":"image/png", ".jpg":"image/jpeg",
  ".svg":"image/svg+xml", ".ico":"image/x-icon",
  ".xlsx":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls":"application/vnd.ms-excel"
};

// ── Sessions ──────────────────────────────────────────────────────────────────
function createSession(user) {
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  SESSIONS[token] = { user, expires: Date.now() + 8*60*60*1000 };
  saveSessions();
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
  if (!s || s.expires < Date.now()) { delete SESSIONS[token]; saveSessions(); return null; }
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
function loadUsers() {
  const data = loadJSON(USERS_FILE, { users:[] }).users;
  if (data.length === 0) {
    console.error('⚠  users.json ist leer — bitte users.json prüfen!');
  }
  return data;
}
function saveUsers(u) { saveJSON(USERS_FILE, { users: u }); }
function safeUser(u) { const { password:_, ...s } = u; return s; }
async function readBody(req) {
  return new Promise((res, rej) => {
    let b = "", size = 0;
    const MAX = 25 * 1024 * 1024;
    req.on("data", d => { size += d.length; if (size > MAX) { req.destroy(); return; } b += d; });
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
  const kontext = loadJSON(KONTEXT_FILE, { text: "" });
  if (kontext.text && body.system) {
    body.system = body.system + "\n\n--- KURSPROGRAMM-KONTEXT ---\n" + kontext.text.slice(0, 8000);
  } else if (kontext.text) {
    body.system = "--- KURSPROGRAMM-KONTEXT ---\n" + kontext.text.slice(0, 8000);
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

// ── Multipart Parser ─────────────────────────────────────────────────────────
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
      "Access-Control-Allow-Methods":"GET,POST,PUT,PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers":"Content-Type,x-hub-token" });
    return res.end();
  }

  // CORS-Header für alle Antworten setzen
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,x-hub-token");

  // url früh definieren (wird auch unten nochmal für sess gebraucht)
  const url = req.url.split("?")[0];

  // ── HUB-IMPORT (vor Session-Check – nur Token-Auth) ──────────────────────
  if (req.method === "POST" && url === "/api/hub-import") {
    const HUB_SECRET = process.env.HUB_SECRET || "vhs-hub-2026";
    const hubToken = req.headers["x-hub-token"];
    if (hubToken !== HUB_SECRET) {
      return jsonRes(res, 401, { error: "Unauthorized – Hub-Token ungültig" });
    }
    const b = await readBody(req);
    if (!b.titel || !b.text) {
      return jsonRes(res, 400, { error: "Pflichtfelder: titel, text" });
    }
    const neu = await db.addEinreichung({
      anlass:      b.anlass    || b.titel,
      anlassId:    b.anlassId  || ("hub-" + Date.now()),
      kurs:        b.titel,
      kursNr:      b.kurs_nr   || "",
      idee:        b.idee      || b.text.slice(0, 150),
      text:        b.text,
      hashtags:    b.hashtags  || "",
      kanal:       b.kanal     || "instagram",
      format:      b.format    || "sq",
      datum:       b.datum     || b.datum_vorschlag || null,
      pb:          "alle",
      status:      "neu",
      eingereicht: new Date().toISOString(),
      autor:       "thomas",
      autorId:     "1",
      quelle:      "hub"
    });
    console.log(`[Hub-Import] ✓ ${b.titel} (${b.kanal || "instagram"})`);
    return jsonRes(res, 201, { success: true, id: neu.id, message: "Im Redaktionsplan gespeichert" });
  }
  // ── ENDE HUB-IMPORT ───────────────────────────────────────────────────────

  // ── HUB-EINREICHUNG (kein Cookie nötig, nur Token) ───────────────────────
  if (req.method === "POST" && url === "/api/einreichungen/hub") {
    const HUB_SECRET = process.env.HUB_SECRET || "vhs-hub-2026";
    const hubToken = req.headers["x-hub-token"];
    if (hubToken !== HUB_SECRET) {
      return jsonRes(res, 401, { error: "Unauthorized" });
    }
    const b = await readBody(req);
    const neu = await db.addEinreichung({
      anlass:      b.anlass    || b.kurs || "Hub-Einreichung",
      anlassId:    "hub-" + Date.now(),
      kurs:        b.kurs      || b.anlass || "",
      kursNr:      b.kursNr   || "",
      idee:        b.idee      || "",
      text:        b.text      || "",
      hashtags:    b.hashtags  || "",
      kanal:       b.kanal     || "Instagram",
      datum:       b.datum     || null,
      pb:          "alle",
      bild:        null,
      status:      "neu",
      eingereicht: new Date().toISOString(),
      autor:       "thomas",
      autorId:     "1"
    });
    console.log("[Hub-Einreichung] ✓", neu.kurs);
    return jsonRes(res, 201, { ok: true, einreichung: neu });
  }
  // ── ENDE HUB-EINREICHUNG ─────────────────────────────────────────────────


  const sess = getSession(getToken(req));

  // ── AUTH ──────────────────────────────────────────────────────────────────
  if (req.method === "POST" && url === "/api/login") {
    const b = await readBody(req);
    const users = loadUsers();
    const candidate = users.find(x => x.username === b.username && x.aktiv !== false);
    let u = null;
    if (candidate) {
      const hash = getPassword(candidate.id) || candidate.password;
      if (hash && await bcrypt.compare(b.password, hash)) u = candidate;
    }
    if (!u) return jsonRes(res, 401, { error:"Ungültige Zugangsdaten" });
    const token = createSession(u);
    return jsonRes(res, 200, { ok:true, user:safeUser(u) },
      { "Set-Cookie":`session=${token}; HttpOnly; SameSite=Lax; Max-Age=28800` });
  }

  if (req.method === "POST" && url === "/api/logout") {
    const t = getToken(req);
    if (t) { delete SESSIONS[t]; saveSessions(); }
    return jsonRes(res, 200, { ok:true },
      { "Set-Cookie":"session=; HttpOnly; Max-Age=0" });
  }

  if (req.method === "POST" && url === "/api/change-password") {
    if (!sess) return jsonRes(res, 401, { error:"Nicht eingeloggt" });
    const b = await readBody(req);
    if (!b.altesPasswort || !b.neuesPasswort)
      return jsonRes(res, 400, { error:"Altes und neues Passwort erforderlich" });
    if (b.neuesPasswort.length < 8)
      return jsonRes(res, 400, { error:"Neues Passwort muss mindestens 8 Zeichen haben" });
    const users = loadUsers();
    const u = users.find(x => x.id === sess.user.id);
    if (!u) return jsonRes(res, 404, { error:"User nicht gefunden" });
    const hash = getPassword(u.id) || u.password;
    const ok = hash && await bcrypt.compare(b.altesPasswort, hash);
    if (!ok) return jsonRes(res, 403, { error:"Altes Passwort falsch" });
    await setPassword(u.id, b.neuesPasswort);
    return jsonRes(res, 200, { ok:true });
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
      return jsonRes(res, 400, { error:"Pflichtfelder fehlen" });
    const users = loadUsers();
    if (users.find(u => u.username === b.username))
      return jsonRes(res, 409, { error:"Benutzername bereits vergeben" });
    const neu = { id:String(Date.now()), name:b.name, username:b.username,
                  password: await bcrypt.hash(b.password, 10),
                  role:b.role, pb:b.pb||"alle", aktiv:true };
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
    if (b.password) {
      b.password = await bcrypt.hash(b.password, 10);
    }
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
    const posts = await db.getPosts();
    return jsonRes(res, 200, posts);
  }

  if (req.method === "POST" && url === "/api/posts") {
    if (!sess) return jsonRes(res, 401, { error:"Nicht eingeloggt" });
    const b = await readBody(req);
    const neu = await db.addPost({ ...b, autor: sess.user.name, autorId: sess.user.id });
    return jsonRes(res, 201, { ok:true, post:neu });
  }

  // PATCH /api/posts/:id/status — nur Status ändern, alle anderen Felder bleiben
  // Erlaubt für: admin, redakteur, direktion, pbl
  if (req.method === "PATCH" && /^\/api\/posts\/[^/]+\/status/.test(url)) {
    if (!sess || !["admin","redakteur","direktion","pbl"].includes(sess.user.role))
      return jsonRes(res, 403, { error:"Kein Zugriff" });
    const id = url.split("/")[3];
    const b = await readBody(req);
    const updated = await db.setPostStatus(id, b.status, b);
    if (!updated) return jsonRes(res, 404, { error:"Post nicht gefunden" });
    return jsonRes(res, 200, { ok:true, post: updated });
  }

  if (req.method === "PUT" && url.startsWith("/api/posts/")) {
    // Vollständiges Update — nur für Redaktion/Admin
    if (!sess || !["admin","redakteur","direktion"].includes(sess.user.role))
      return jsonRes(res, 403, { error:"Kein Zugriff" });
    const id = url.split("/")[3];
    const b = await readBody(req);
    const updated = await db.updatePost(id, b);
    if (!updated) return jsonRes(res, 404, { error:"Post nicht gefunden" });
    return jsonRes(res, 200, { ok:true, post: updated });
  }

  if (req.method === "DELETE" && url.startsWith("/api/posts/")) {
    if (!sess || !["admin","redakteur"].includes(sess.user.role))
      return jsonRes(res, 403, { error:"Kein Zugriff" });
    const id = url.split("/")[3];
    await db.deletePost(id);
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
    const alle = await db.getEinreichungen();
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
    try {
      const b = await readBody(req);
      const neu = await db.addEinreichung({
        ...b,
        status: "neu",
        eingereicht: new Date().toISOString(),
        autor: sess.user.name,
        autorId: sess.user.id,
        pb: sess.user.pb || "alle"
      });
      // E-Mail an alle Redakteure und Admins
      try {
        const alleUser = loadUsers();
        const empfaenger = alleUser
          .filter(u => u.aktiv && ['admin','redakteur'].includes(u.role) && u.email && u.emailBenachrichtigung)
          .map(u => ({ name: u.name, email: u.email }));
        mailer.sendeEinreichungsBenachrichtigung(neu, empfaenger).catch(e =>
          console.error('[Mailer] Hintergrundfehler:', e.message)
        );
      } catch(me) { console.error('[Mailer] Setup-Fehler:', me.message); }
      return jsonRes(res, 201, { ok:true, einreichung: neu });
    } catch(e) {
      console.error("Einreichung POST Fehler:", e.message);
      return jsonRes(res, 500, { error: e.message });
    }
  }

  if (req.method === "POST" && url === "/api/einreichungen/mit-bild") {
    if (!sess) return jsonRes(res, 401, { error:"Nicht eingeloggt" });
    try {
      const b = await readBody(req);
      const neu = await db.addEinreichung({
        anlass:   b.anlass   || "",
        anlassId: b.anlassId || "",
        datum:    b.datum    || null,
        kurs:     b.kurs     || "",
        kursNr:   b.kursNr   || "",
        idee:     b.idee     || "",
        pb:       sess.user.pb || "alle",
        bild:     b.bild     || null,
        status:   "neu",
        eingereicht: new Date().toISOString(),
        autor:    sess.user.name,
        autorId:  sess.user.id
      });
      // E-Mail an alle Redakteure und Admins
      try {
        const alleUser = loadUsers();
        const empfaenger = alleUser
          .filter(u => u.aktiv && ['admin','redakteur'].includes(u.role) && u.email && u.emailBenachrichtigung)
          .map(u => ({ name: u.name, email: u.email }));
        mailer.sendeEinreichungsBenachrichtigung(neu, empfaenger).catch(e =>
          console.error('[Mailer] Hintergrundfehler:', e.message)
        );
      } catch(me) { console.error('[Mailer] Setup-Fehler:', me.message); }
      return jsonRes(res, 201, { ok:true, einreichung: neu });
    } catch(e) {
      console.error("Einreichung mit-Bild POST Fehler:", e.message);
      return jsonRes(res, 500, { error: e.message });
    }
  }

  if (req.method === "PUT" && url.startsWith("/api/einreichungen/")) {
    if (!sess || !["admin","redakteur"].includes(sess.user.role))
      return jsonRes(res, 403, { error:"Kein Zugriff" });
    const id = url.split("/")[3];
    const b = await readBody(req);
    const alle = await db.getEinreichungen();
    const bestehend = alle.find(e => String(e.id) === String(id));
    if (!bestehend) return jsonRes(res, 404, { error:"Nicht gefunden" });
    const merged = { ...bestehend, ...b };
    const aktualisiert = await db.updateEinreichung(id, merged);
    return jsonRes(res, 200, { ok:true, einreichung: aktualisiert });
  }

  if (req.method === "DELETE" && url.startsWith("/api/einreichungen/")) {
    if (!sess || !["admin","redakteur"].includes(sess.user.role))
      return jsonRes(res, 403, { error:"Kein Zugriff" });
    const id = url.split("/")[3];
    await db.deleteEinreichung(id);
    return jsonRes(res, 200, { ok:true });
  }

  // ── ADMIN INPUT: Redaktionsplan-URLs ──────────────────────────────────────
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

  // ── ADMIN INPUT: Datei-Upload ─────────────────────────────────────────────
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
    const uploadType = typePart.text;
    const allowedExt = [".xls", ".xlsx", ".csv"];
    const ext = path.extname(filePart.filename).toLowerCase();
    if (!allowedExt.includes(ext)) return jsonRes(res, 400, { error:"Nur .xls, .xlsx, .csv erlaubt" });
    const uploadDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    const ts = Date.now();
    const safeName = uploadType + "_" + ts + ext;
    const dest = path.join(uploadDir, safeName);
    fs.writeFileSync(dest, filePart.data);

    if (uploadType === "kursprogramm") {
      let textContent = "";
      if (ext === ".csv") {
        textContent = filePart.data.toString("utf8");
      } else {
        textContent = filePart.data.toString("utf8", 0, Math.min(filePart.data.length, 50000));
      }
      const kontext = {
        filename: filePart.filename, uploaded: new Date().toISOString(),
        uploadedBy: sess.user.name, text: textContent.slice(0, 50000)
      };
      saveJSON(KONTEXT_FILE, kontext);
    }

    if (uploadType === "redaktionsplan") {
      const meta = loadJSON(REDPLAN_FILE, { urls: [], lastUpdate: null });
      meta.lastFileUpload = {
        filename: filePart.filename, savedAs: safeName,
        uploaded: new Date().toISOString(), uploadedBy: sess.user.name, size: filePart.data.length
      };
      meta.lastUpdate = new Date().toISOString();
      saveJSON(REDPLAN_FILE, meta);
    }

    return jsonRes(res, 200, {
      ok: true, type: uploadType, filename: filePart.filename,
      savedAs: safeName, size: filePart.data.length
    });
  }

  if (req.method === "GET" && url === "/api/admin/status") {
    if (!adminOnly(sess)) return jsonRes(res, 403, { error:"Kein Zugriff" });
    const kontext = loadJSON(KONTEXT_FILE, null);
    const redplan = loadJSON(REDPLAN_FILE, null);
    return jsonRes(res, 200, {
      kursprogramm: kontext ? {
        filename: kontext.filename, uploaded: kontext.uploaded,
        uploadedBy: kontext.uploadedBy, chars: kontext.text ? kontext.text.length : 0
      } : null,
      redaktionsplan: redplan ? {
        lastFileUpload: redplan.lastFileUpload || null,
        urls: redplan.urls || [], lastUpdate: redplan.lastUpdate || null
      } : null
    });
  }

  // ── KI GENERATE ───────────────────────────────────────────────────────────
  if (req.method === "POST" && url === "/api/generate") {
    if (!sess || !["admin","redakteur"].includes(sess.user.role))
      return jsonRes(res, 403, { error:"Kein Zugriff — nur für Redakteure" });
    return callAnthropic(await readBody(req), res);
  }



  // ── SEITEN ────────────────────────────────────────────────────────────────
  const PAGES = { "/performance":"performance.html", "/freigabe":"freigabe.html",
                  "/editor":"editor.html", "/kalender":"kalender.html",
                  "/kurse":"kurse.html", "/admin":"admin.html",
                  "/voransicht":"voransicht.html" };
  if (req.method === "GET" && PAGES[url]) {
    return fs.readFile(path.join(__dirname, "public", PAGES[url]), (e,c) => {
      if (e) { res.writeHead(404); return res.end("404"); }
      res.writeHead(200, {"Content-Type":"text/html; charset=utf-8"});
      res.end(c);
    });
  }

  // ── KURSE DEMNÄCHST (in 4 Wochen) ────────────────────────────────────────
  if (req.method === "GET" && url.startsWith("/api/kurse/bald")) {
    if (!sess?.user) return jsonRes(res, 401, { error: "Nicht eingeloggt" });
    const urlObj = new URL("http://x" + req.url);
    const prefix = urlObj.searchParams.get('prefix') || '';
    const heute = new Date(); heute.setHours(0,0,0,0);
    const in4wochen = new Date(heute.getTime() + 28*24*60*60*1000);
    try {
      let result = await db.getKurse();
      result = result.filter(k => {
        const terminBeginn = k.termin ? k.termin.split(' bis ')[0].trim() : null;
        if (!terminBeginn) return false;
        const d = new Date(terminBeginn);
        if (isNaN(d) || d < heute || d > in4wochen) return false;
        if (!prefix) return true;
        return prefix.split(',').some(p => k.id && k.id.startsWith(p.trim()));
      });
      result.sort((a,b) => {
        const aT = a.termin ? a.termin.split(' bis ')[0] : '';
        const bT = b.termin ? b.termin.split(' bis ')[0] : '';
        return aT.localeCompare(bT);
      });
      return jsonRes(res, 200, result.slice(0, 30));
    } catch(e) { return jsonRes(res, 500, { error: 'Fehler beim Laden' }); }
  }

  // ── KURSPROGRAMM API ──────────────────────────────────────────────────────
  if (req.method === "GET" && url.startsWith("/api/kurse")) {
    const urlObj = new URL("http://x" + req.url);
    const id = url.split("/")[3];
    if (id && id !== 'kategorien') {
      const kurs = await db.getKursByCode(id);
      if (!kurs) return jsonRes(res, 404, { error: 'Kurs nicht gefunden' });
      return jsonRes(res, 200, kurs);
    }
    if (url === "/api/kurse-kategorien") {
      return jsonRes(res, 200, await db.getKategorien());
    }
    const q = urlObj.searchParams.get('q');
    const kategorie = urlObj.searchParams.get('kategorie');
    const limit = parseInt(urlObj.searchParams.get('limit')) || 5000;
    const offset = parseInt(urlObj.searchParams.get('offset')) || 0;
    let result = await db.getKurse();
    if (kategorie && kategorie !== 'alle') result = result.filter(k => k.kategorie === kategorie);
    if (q && q.trim()) {
      const s = q.toLowerCase().trim();
      result = result.filter(k =>
        (k.titel && k.titel.toLowerCase().includes(s)) ||
        (k.id && k.id.toLowerCase().includes(s)) ||
        (k.beschreibung && k.beschreibung.toLowerCase().includes(s))
      );
    }
    return jsonRes(res, 200, { total: result.length, offset, limit, kurse: result.slice(offset, offset + limit) });
  }

  if (req.method === "POST" && url === "/admin/upload-kursprogramm") {
    if (!adminOnly(sess)) return jsonRes(res, 403, { error: "Kein Zugriff" });
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      try {
        const buf = Buffer.concat(chunks);
        const boundary = req.headers['content-type']?.split('boundary=')[1];
        if (!boundary) return jsonRes(res, 400, { error: 'Kein Boundary' });
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
          const beschrRaw = r[3] ? String(r[3]).trim() : '';
          const beschr = beschrRaw.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 800);
          kurse.push({ id, titel: String(r[2]).trim(),
            beginn: parseKursDate(r[4]),
            ende: parseKursDate(r[5]),
            beschreibung: beschr,
            angemeldet: parseInt(r[6]) || 0, maximum: parseInt(r[7]) || 0, kategorie: getKategorie(id) });
        }
        if (!kurse.length) return jsonRes(res, 400, { error: 'Keine gültigen Kurse' });
        await db.upsertKurse(kurse);
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

// ── Hilfsfunktionen ──────────────────────────────────────────────────────────
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

// ── Passwort-Migration beim Start ─────────────────────────────────────────────
// Erkennt Klartext-Passwörter in users.json und hasht sie automatisch.
// Läuft einmalig beim ersten Start nach dem Deploy — danach ein No-Op.
async function migratePasswordsOnStartup() {
  const users = loadUsers();
  let changed = 0;
  for (const u of users) {
    if (!u.password) continue;
    if (u.password.startsWith('$2b$') || u.password.startsWith('$2a$')) continue;
    u.password = await bcrypt.hash(u.password, 10);
    changed++;
  }
  if (changed > 0) {
    saveUsers(users);
    console.log(`  🔒  ${changed} Passwörter auf bcrypt migriert`);
  }

  // passwords_override.json ebenfalls prüfen
  if (fs.existsSync(PW_OVERRIDE_FILE)) {
    let ov = {}; try { ov = JSON.parse(fs.readFileSync(PW_OVERRIDE_FILE, 'utf8')); } catch {}
    let ovChanged = 0;
    for (const [id, pw] of Object.entries(ov)) {
      if (pw.startsWith('$2b$') || pw.startsWith('$2a$')) continue;
      ov[id] = await bcrypt.hash(pw, 10);
      ovChanged++;
    }
    if (ovChanged > 0) {
      fs.writeFileSync(PW_OVERRIDE_FILE, JSON.stringify(ov, null, 2), 'utf8');
      console.log(`  🔒  ${ovChanged} Override-Passwörter auf bcrypt migriert`);
    }
  }
}


server.listen(PORT, async () => {
  console.log("\n  ✅  VHS Spandau PR-Maschine läuft");
  console.log(`  🌐  http://localhost:${PORT}`);
  console.log("  🔑  API-Key: aktiv");
  await migratePasswordsOnStartup();
  try {
    const n = await db.testConnection();
    console.log(`  🗄️   Postgres verbunden — ${n} Kurse in der DB`);
    await db.ensureTables();
    console.log(`  📋  Tabellen geprüft/erstellt`);
  } catch (e) {
    console.error("  ❌  Postgres NICHT erreichbar:", e.message);
  }
  console.log("  Stoppen: Strg+C\n");
});
