// India's Got Latent — Hot or Not backend. Zero dependencies, Node 18+.
// Run: node server.js  (PORT env var optional, default 3000)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PEOPLE = require('./data.js');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'db.json');
const PUBLIC = path.join(__dirname, 'public');
const PEOPLE_BY_ID = new Map(PEOPLE.map(p => [p.id, p]));

// ---------- persistence ----------
let db = { elo: {}, records: {}, faceoffs: {}, ratings: {} };
// elo:      personId -> number (start 1000)
// records:  personId -> {w, l}
// faceoffs: voterId|idA|idB (sorted pair) -> winnerId   (one vote per pair per voter)
// ratings:  personId -> { voterId -> score 0..10 }      (latest score wins)
try { db = Object.assign(db, JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); } catch {}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DB_FILE, JSON.stringify(db), err => { if (err) console.error('save failed:', err); });
  }, 300);
}

// ---------- voter identity: IP + cookie ----------
function getIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? fwd.split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
}
function getVoter(req, res) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';')
    .map(c => c.trim().split('=')).filter(kv => kv.length === 2));
  let uid = cookies['igl_voter'];
  if (!uid || !/^[a-f0-9]{32}$/.test(uid)) {
    uid = crypto.randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie',
      `igl_voter=${uid}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`);
  }
  return crypto.createHash('sha256').update(getIp(req) + '|' + uid).digest('hex').slice(0, 24);
}

// ---------- stats ----------
function elo(id) { return db.elo[id] ?? 1000; }
function record(id) { return db.records[id] || { w: 0, l: 0 }; }
function applyFaceoff(winnerId, loserId) {
  const K = 32, ra = elo(winnerId), rb = elo(loserId);
  const expA = 1 / (1 + 10 ** ((rb - ra) / 400));
  db.elo[winnerId] = ra + K * (1 - expA);
  db.elo[loserId] = rb - K * (1 - expA);
  db.records[winnerId] = record(winnerId); db.records[winnerId].w++;
  db.records[loserId] = record(loserId); db.records[loserId].l++;
}
function ratingStats(id) {
  const r = db.ratings[id];
  if (!r) return { avg: null, count: 0 };
  const scores = Object.values(r);
  if (!scores.length) return { avg: null, count: 0 };
  return { avg: scores.reduce((a, b) => a + b, 0) / scores.length, count: scores.length };
}
function personOut(p, voterId) {
  const rs = ratingStats(p.id);
  return {
    id: p.id, name: p.name, type: p.type, panels: p.panels, blurb: p.blurb,
    photo: fs.existsSync(path.join(PUBLIC, 'photos', p.id + '.jpg')) ? `/photos/${p.id}.jpg` : null,
    wiki: p.wiki || null, insta: p.insta || null, joke: p.joke || null,
    showScore: p.showScore ?? null,
    elo: Math.round(elo(p.id)), wins: record(p.id).w, losses: record(p.id).l,
    avgScore: rs.avg === null ? null : Math.round(rs.avg * 100) / 100,
    scoreCount: rs.count,
    myScore: voterId && db.ratings[p.id] ? (db.ratings[p.id][voterId] ?? null) : null,
  };
}

function inPool(p, pool) {
  switch (pool) {
    case 'panel': return p.type === 'panel';
    case 'contestant': return p.type === 'contestant';
    case 's1': return p.panels.some(x => x.startsWith('S1'));
    case 's2': return p.panels.some(x => x.startsWith('S2'));
    case 'panel-s1': return p.type === 'panel' && p.panels.some(x => x.startsWith('S1'));
    case 'panel-s2': return p.type === 'panel' && p.panels.some(x => x.startsWith('S2'));
    default: return true;
  }
}
function pairKey(voterId, a, b) { return voterId + '|' + [a, b].sort().join('|'); }

// ---------- api ----------
function api(req, res, url, body) {
  const voterId = getVoter(req, res);
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (req.method === 'GET' && url.pathname === '/api/people') {
    return send(200, { voterId, people: PEOPLE.map(p => personOut(p, voterId)) });
  }

  if (req.method === 'GET' && url.pathname === '/api/matchup') {
    const pool = url.searchParams.get('pool') || 'all';
    const cands = PEOPLE.filter(p => inPool(p, pool));
    if (cands.length < 2) return send(400, { error: 'pool too small' });
    // contestants never face panelists — pairs always share a type;
    // try to find a pair this voter hasn't judged yet
    let a, b;
    for (let i = 0; i < 60; i++) {
      a = cands[Math.floor(Math.random() * cands.length)];
      const sameType = cands.filter(p => p.type === a.type && p.id !== a.id);
      if (!sameType.length) continue;
      b = sameType[Math.floor(Math.random() * sameType.length)];
      if (!(pairKey(voterId, a.id, b.id) in db.faceoffs)) break;
    }
    if (!b || a.id === b.id) b = cands.find(p => p.type === a.type && p.id !== a.id);
    if (!b) return send(400, { error: 'pool too small' });
    return send(200, { a: personOut(a, voterId), b: personOut(b, voterId) });
  }

  if (req.method === 'POST' && url.pathname === '/api/faceoff') {
    const { winnerId, loserId } = body || {};
    if (!PEOPLE_BY_ID.has(winnerId) || !PEOPLE_BY_ID.has(loserId) || winnerId === loserId)
      return send(400, { error: 'bad ids' });
    if (PEOPLE_BY_ID.get(winnerId).type !== PEOPLE_BY_ID.get(loserId).type)
      return send(400, { error: 'contestants and panelists never face off' });
    const key = pairKey(voterId, winnerId, loserId);
    if (key in db.faceoffs) return send(200, { ok: true, duplicate: true });
    db.faceoffs[key] = winnerId;
    applyFaceoff(winnerId, loserId);
    save();
    return send(200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/score') {
    const { personId } = body || {};
    const score = Number(body && body.score);
    if (!PEOPLE_BY_ID.has(personId)) return send(400, { error: 'bad id' });
    if (!Number.isInteger(score) || score < 0 || score > 10)
      return send(400, { error: 'score must be an integer 0-10' });
    (db.ratings[personId] = db.ratings[personId] || {})[voterId] = score;
    save();
    const p = personOut(PEOPLE_BY_ID.get(personId), voterId);
    return send(200, { ok: true, avgScore: p.avgScore, scoreCount: p.scoreCount });
  }

  if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
    const people = PEOPLE.map(p => personOut(p, voterId));
    const hot = [...people].sort((x, y) => y.elo - x.elo);
    const judged = people.filter(p => p.type === 'contestant')
      .sort((x, y) => (y.avgScore ?? -1) - (x.avgScore ?? -1));
    // Audience Winners: contestants whose real show score matches the app audience average
    const audienceWinners = judged.filter(p =>
      p.showScore !== null && p.avgScore !== null && Math.abs(p.avgScore - p.showScore) <= 0.5);
    return send(200, { hot, judged, audienceWinners });
  }

  send(404, { error: 'not found' });
}

// ---------- static ----------
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const ROUTES = { '/': 'index.html', '/judge': 'judge.html', '/leaderboard': 'leaderboard.html' };

function serveStatic(req, res, url) {
  let rel = ROUTES[url.pathname] || url.pathname.slice(1);
  const file = path.join(PUBLIC, path.normalize(rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    if (req.method === 'POST') {
      let raw = '';
      req.on('data', c => { raw += c; if (raw.length > 1e4) req.destroy(); });
      req.on('end', () => {
        let body = null;
        try { body = JSON.parse(raw || '{}'); } catch {}
        try { api(req, res, url, body); } catch (e) { console.error(e); res.writeHead(500); res.end(); }
      });
    } else {
      try { api(req, res, url, null); } catch (e) { console.error(e); res.writeHead(500); res.end(); }
    }
  } else {
    serveStatic(req, res, url);
  }
}).listen(PORT, () => console.log(`India's Got Latent: Hot or Not → http://localhost:${PORT}`));
