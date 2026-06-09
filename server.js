// VHS Spandau PR-Maschine — Server mit Login, Rollen, Benutzerverwaltung
const http   = require("http");
const https  = require("https");
const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const USERS_FILE = path.join(__dirname, "users.json");

if (!API_KEY) { console.error("❌  ANTHROPIC_API_KEY fehlt."); process.exit(1); }

// ── Sessions ─────────────────────────────────────────────────────────────────
const sessions = {};
function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions[token] = { user, expires: Date.now() + 8*60*60*1000 };
  return token;
}
function getSession(token) {
  const s = sessions[token];
  if (!s) return null;
  if (Date.now() > s.expires) { delete sessions[token]; return null; }
  return s;
}
function destroySession(token) { delete sessions[token]; }
function getToken(req) {
  const m = (req.headers.cookie || "").match(/session=([a-f0-9]+)/);
  return m ? m[1] : null;
}

// ── Benutzer CRUD ─────────────────────────────────────────────────────────────
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, "utf8")).users; }
  catch { return []; }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2), "utf8");
}
function safeUser(u) { const { password: _, ...s } = u; return s; }

// ── MIME ──────────────────────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise(resolve => {
    let d = "";
    req.on("data", c => d += c);
    req.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
  });
}
function jsonRes(res, status, data, extra = {}) {
  res.writeHead(status, { "Content-Type":"application/json", "Access-Control-Allow-Origin":"*", ...extra });
  res.end(JSON.stringify(data));
}
function adminOnly(sess) {
  return sess && sess.user.role === "admin";
}

// ── Anthropic Proxy ───────────────────────────────────────────────────────────
function callAnthropic(body, res) {
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
    if (!u) return jsonRes(res, 401, { error: "Benutzername oder Passwort falsch — oder Konto deaktiviert." });
    const token = createSession(u);
    return jsonRes(res, 200, { ok:true, user:safeUser(u) },
      { "Set-Cookie": `session=${token}; HttpOnly; Path=/; Max-Age=28800; SameSite=Lax` });
  }

  if (req.method === "POST" && url === "/api/logout") {
    if (sess) destroySession(getToken(req));
    return jsonRes(res, 200, { ok:true }, { "Set-Cookie":"session=; HttpOnly; Path=/; Max-Age=0" });
  }

  if (req.method === "GET" && url === "/api/me") {
    if (!sess) return jsonRes(res, 401, { error:"Nicht eingeloggt" });
    return jsonRes(res, 200, { user: safeUser(sess.user) });
  }

  // ── BENUTZER: LIST ────────────────────────────────────────────────────────
  if (req.method === "GET" && url === "/api/users") {
    if (!adminOnly(sess)) return jsonRes(res, 403, { error:"Kein Zugriff" });
    return jsonRes(res, 200, { users: loadUsers().map(safeUser) });
  }

  // ── BENUTZER: CREATE ──────────────────────────────────────────────────────
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

  // ── BENUTZER: UPDATE ──────────────────────────────────────────────────────
  if (req.method === "PUT" && url.startsWith("/api/users/")) {
    if (!adminOnly(sess)) return jsonRes(res, 403, { error:"Kein Zugriff" });
    const id = url.split("/").pop();
    const b  = await readBody(req);
    const users = loadUsers();
    const idx = users.findIndex(u => u.id === id);
    if (idx === -1) return jsonRes(res, 404, { error:"Benutzer nicht gefunden" });
    if (users[idx].username === sess.user.username && b.role && b.role !== "admin")
      return jsonRes(res, 400, { error:"Eigene Admin-Rolle kann nicht geändert werden" });
    if (users[idx].username === sess.user.username && b.aktiv === false)
      return jsonRes(res, 400, { error:"Eigenen Account kann man nicht deaktivieren" });
    users[idx] = {
      ...users[idx],
      ...(b.name     ? { name:b.name }         : {}),
      ...(b.role     ? { role:b.role }         : {}),
      ...(b.pb  !== undefined ? { pb:b.pb }    : {}),
      ...(b.aktiv !== undefined ? { aktiv:b.aktiv } : {}),
      ...(b.password ? { password:b.password } : {}),
    };
    saveUsers(users);
    return jsonRes(res, 200, { ok:true, user:safeUser(users[idx]) });
  }

  // ── BENUTZER: DELETE ──────────────────────────────────────────────────────
  if (req.method === "DELETE" && url.startsWith("/api/users/")) {
    if (!adminOnly(sess)) return jsonRes(res, 403, { error:"Kein Zugriff" });
    const id = url.split("/").pop();
    const users = loadUsers();
    const target = users.find(u => u.id === id);
    if (!target) return jsonRes(res, 404, { error:"Benutzer nicht gefunden" });
    if (target.username === sess.user.username)
      return jsonRes(res, 400, { error:"Eigenen Account kann man nicht löschen" });
    saveUsers(users.filter(u => u.id !== id));
    return jsonRes(res, 200, { ok:true });
  }


  // ── POSTS (Kalender) ─────────────────────────────────────────────────────
  const POSTS_FILE = path.join(__dirname, "posts.json");
  const PERF_FILE  = path.join(__dirname, "performance.json");
  function loadPosts()   { try { return JSON.parse(fs.readFileSync(POSTS_FILE,"utf8")).posts; } catch { return []; } }
  function savePosts(l)  { fs.writeFileSync(POSTS_FILE,  JSON.stringify({posts:l},null,2),"utf8"); }
  function loadPerf()    { try { return JSON.parse(fs.readFileSync(PERF_FILE,"utf8")).performance; } catch { return []; } }
  function savePerf(l)   { fs.writeFileSync(PERF_FILE,   JSON.stringify({performance:l},null,2),"utf8"); }

  // GET /api/posts
  if (req.method === "GET" && url === "/api/posts") {
    if (!sess) return jsonRes(res, 401, { error:"Nicht eingeloggt" });
    return jsonRes(res, 200, { posts: loadPosts() });
  }
  // POST /api/posts
  if (req.method === "POST" && url === "/api/posts") {
    if (!sess || !["admin","redakteur"].includes(sess.user.role))
      return jsonRes(res, 403, { error:"Kein Zugriff" });
    const b = await readBody(req);
    const list = loadPosts();
    const neu = { ...b, id: b.id || "post"+Date.now() };
    const idx = list.findIndex(p => p.id === neu.id);
    if (idx > -1) list[idx] = neu; else list.push(neu);
    savePosts(list);
    return jsonRes(res, 200, { ok:true, post:neu });
  }
  // DELETE /api/posts/:id
  if (req.method === "DELETE" && url.startsWith("/api/posts/")) {
    if (!sess || !["admin","redakteur"].includes(sess.user.role))
      return jsonRes(res, 403, { error:"Kein Zugriff" });
    const id = url.split("/").pop();
    savePosts(loadPosts().filter(p => p.id !== id));
    return jsonRes(res, 200, { ok:true });
  }

  // ── PERFORMANCE ───────────────────────────────────────────────────────────
  // GET /api/performance
  if (req.method === "GET" && url === "/api/performance") {
    if (!sess) return jsonRes(res, 401, { error:"Nicht eingeloggt" });
    return jsonRes(res, 200, { performance: loadPerf() });
  }
  // POST /api/performance
  if (req.method === "POST" && url === "/api/performance") {
    if (!sess || !["admin","redakteur"].includes(sess.user.role))
      return jsonRes(res, 403, { error:"Kein Zugriff" });
    const b = await readBody(req);
    const list = loadPerf();
    const neu = { ...b, id: b.id || "perf"+Date.now() };
    const idx = list.findIndex(p => p.id === neu.id);
    if (idx > -1) list[idx] = neu; else list.push(neu);
    savePerf(list);
    return jsonRes(res, 200, { ok:true, entry:neu });
  }
  // DELETE /api/performance/:id
  if (req.method === "DELETE" && url.startsWith("/api/performance/")) {
    if (!sess || !["admin","redakteur"].includes(sess.user.role))
      return jsonRes(res, 403, { error:"Kein Zugriff" });
    const id = url.split("/").pop();
    savePerf(loadPerf().filter(p => p.id !== id));
    return jsonRes(res, 200, { ok:true });
  }

  // ── KURSLISTE ─────────────────────────────────────────────────────────────
  if (req.method === "GET" && url === "/api/kurse") {
    if (!sess) return jsonRes(res, 401, { error:"Nicht eingeloggt" });
    try {
      const alleKurse = JSON.parse(fs.readFileSync(path.join(__dirname, "public", "kurse.json"), "utf8"));
      // PBL sieht nur Kurse des eigenen Programmbereichs
      const kurse = (sess.user.role === "admin" || sess.user.role === "redakteur" || sess.user.pb === "alle")
        ? alleKurse
        : alleKurse.filter(k => k.pb === sess.user.pb);
      res.writeHead(200, { "Content-Type":"application/json", "Access-Control-Allow-Origin":"*" });
      return res.end(JSON.stringify(kurse));
    } catch { return jsonRes(res, 500, { error:"Kursliste nicht gefunden" }); }
  }

  if (req.method === "GET" && url === "/performance") {
    fs.readFile(path.join(__dirname, "public", "performance.html"), (err, c) => {
      if (err) { res.writeHead(404); return res.end("404"); }
      res.writeHead(200, { "Content-Type":"text/html; charset=utf-8" }); res.end(c);
    });
    return;
  }

  if (req.method === "GET" && url === "/freigabe") {
    fs.readFile(path.join(__dirname, "public", "freigabe.html"), (err, c) => {
      if (err) { res.writeHead(404); return res.end("404"); }
      res.writeHead(200, { "Content-Type":"text/html; charset=utf-8" }); res.end(c);
    });
    return;
  }

  if (req.method === "GET" && url === "/editor") {
    fs.readFile(path.join(__dirname, "public", "editor.html"), (err, c) => {
      if (err) { res.writeHead(404); return res.end("404"); }
      res.writeHead(200, { "Content-Type":"text/html; charset=utf-8" }); res.end(c);
    });
    return;
  }

  if (req.method === "GET" && url === "/kalender") {
    fs.readFile(path.join(__dirname, "public", "kalender.html"), (err, c) => {
      if (err) { res.writeHead(404); return res.end("404"); }
      res.writeHead(200, { "Content-Type":"text/html; charset=utf-8" }); res.end(c);
    });
    return;
  }

  if (req.method === "GET" && url === "/kurse") {
    fs.readFile(path.join(__dirname, "public", "kurse.html"), (err, c) => {
      if (err) { res.writeHead(404); return res.end("404"); }
      res.writeHead(200, { "Content-Type":"text/html; charset=utf-8" }); res.end(c);
    });
    return;
  }


// ── Einreichungen CRUD ────────────────────────────────────────────────────────
const EINR_FILE = path.join(__dirname, "einreichungen.json");

function loadEinreichungen() {
  try { return JSON.parse(fs.readFileSync(EINR_FILE, "utf8")).einreichungen; }
  catch { return []; }
}
function saveEinreichungen(list) {
  fs.writeFileSync(EINR_FILE, JSON.stringify({ einreichungen: list }, null, 2), "utf8");
}

// GET /api/einreichungen
if (req.method === "GET" && url === "/api/einreichungen") {
  if (!sess) return jsonRes(res, 401, { error:"Nicht eingeloggt" });
  const list = loadEinreichungen();
  // PBL sieht nur eigene, Admin/Redakteur sieht alle
  const filtered = (sess.user.role === "admin" || sess.user.role === "redakteur")
    ? list
    : list.filter(e => e.vonUsername === sess.user.username);
  return jsonRes(res, 200, { einreichungen: filtered });
}

// POST /api/einreichungen — neue Einreichung
if (req.method === "POST" && url === "/api/einreichungen") {
  if (!sess) return jsonRes(res, 401, { error:"Nicht eingeloggt" });
  const b = await readBody(req);
  const neu = {
    id:          "e" + Date.now(),
    datum:       new Date().toISOString(),
    vonName:     sess.user.name,
    vonUsername: sess.user.username,
    pb:          sess.user.pb || "alle",
    anlass:      b.anlass || "",
    anlassDatum: b.anlassDatum || "",
    kurs:        b.kurs || "",
    kursNr:      b.kursNr || "",
    idee:        b.idee || "",
    hashtags:    b.hashtags || "",
    status:      "neu",
    kommentar:   "",
  };
  const list = loadEinreichungen();
  list.push(neu);
  saveEinreichungen(list);
  return jsonRes(res, 201, { ok:true, einreichung: neu });
}

// PUT /api/einreichungen/:id — Status ändern (Admin/Redakteur)
if (req.method === "PUT" && url.startsWith("/api/einreichungen/")) {
  if (!sess || !["admin","redakteur"].includes(sess.user.role))
    return jsonRes(res, 403, { error:"Kein Zugriff" });
  const id  = url.split("/").pop();
  const b   = await readBody(req);
  const list = loadEinreichungen();
  const idx = list.findIndex(e => e.id === id);
  if (idx === -1) return jsonRes(res, 404, { error:"Nicht gefunden" });
  list[idx] = {
    ...list[idx],
    status:    b.status    || list[idx].status,
    kommentar: b.kommentar !== undefined ? b.kommentar : list[idx].kommentar,
    bearbeitetVon:  sess.user.name,
    bearbeitetAm:   new Date().toISOString(),
  };
  saveEinreichungen(list);
  return jsonRes(res, 200, { ok:true, einreichung: list[idx] });
}

// DELETE /api/einreichungen/:id (Admin)
if (req.method === "DELETE" && url.startsWith("/api/einreichungen/")) {
  if (!sess || sess.user.role !== "admin")
    return jsonRes(res, 403, { error:"Kein Zugriff" });
  const id = url.split("/").pop();
  saveEinreichungen(loadEinreichungen().filter(e => e.id !== id));
  return jsonRes(res, 200, { ok:true });
}

  // ── KI-GENERATOR ─────────────────────────────────────────────────────────
  if (req.method === "POST" && url === "/api/generate") {
    if (!sess || !["admin","redakteur"].includes(sess.user.role))
      return jsonRes(res, 403, { error:"Kein Zugriff — nur für Redakteure" });
    return callAnthropic(await readBody(req), res);
  }

  // ── STATISCHE DATEIEN ────────────────────────────────────────────────────
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

server.listen(PORT, () => {
  console.log("\n  ✅  VHS Spandau PR-Maschine läuft");
  console.log(`  🌐  http://localhost:${PORT}`);
  console.log("  🔑  API-Key: aktiv\n  Stoppen: Strg+C\n");
});
