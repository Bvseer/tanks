// The real server and two real games in one browser page: a whole duel from the challenge to the result.
import initSqlJs from 'sql.js'; import crypto from 'node:crypto'; import http from 'node:http'; import fs from 'node:fs'; import worker from './worker.js';
const SQL = await initSqlJs(); const db = new SQL.Database();
const stmt = (sql, args) => ({ bind: (...a) => stmt(sql, a),
  all: async () => { const s = db.prepare(sql); s.bind(args || []); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return { results: rows }; },
  first: async () => { const s = db.prepare(sql); s.bind(args || []); const r = s.step() ? s.getAsObject() : null; s.free(); return r; },
  run: async () => { db.run(sql, args || []); return { success: true, meta: { changes: db.getRowsModified() } }; } });
const env = { DB: { prepare: (sql) => stmt(sql), batch: async (l) => { for (const s of l) await s.run(); } }, BOT_TOKEN: '123456:TEST-token', HOOK_SECRET: 'hooksecret' };
const sent = []; const realFetch = globalThis.fetch; globalThis.fetch = async (u, o) => { const b = o && o.body ? JSON.parse(o.body) : null; sent.push(String(u).split('/').pop() + (b && b.chat_id ? ' to ' + b.chat_id + ': ' + String(b.text).slice(0, 40) : '')); return new Response(JSON.stringify({ ok: true, result: { id: 'PREP' } })); };
function init(user) { const p = { auth_date: String(Math.floor(Date.now()/1000)), query_id: 'AAE', user: JSON.stringify(user) }; const dcs = Object.keys(p).sort().map((k) => k + '=' + p[k]).join('\n'), secret = crypto.createHmac('sha256', 'WebAppData').update(env.BOT_TOKEN).digest(); p.hash = crypto.createHmac('sha256', secret).update(dcs).digest('hex'); return new URLSearchParams(p).toString(); }
const INITS = { a: init({ id: 11, first_name: 'Basir' }), b: init({ id: 22, first_name: 'Aziz' }), c: init({ id: 33, first_name: 'Third' }) };
const HOST = fs.readFileSync(new URL('./e2e_host.html', import.meta.url), 'utf8');
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'GET' && u.pathname === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(fs.readFileSync(process.env.GAME || '/home/claude/zalp/index.html', 'utf8').replace('<script src="https://telegram.org/js/telegram-web-app.js"></script>', '')); return; }
  if (req.method === 'GET' && u.pathname === '/host.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(HOST.replace('__INITS__', JSON.stringify(INITS))); return; }
  if (req.method === 'GET' && u.pathname === '/log') { res.end(JSON.stringify({ sent, stats: db.exec('SELECT uid, games, wins, pts FROM tusr ORDER BY uid')[0], duel: db.exec('SELECT st, n, sa, sb, length(snap) FROM duel')[0] })); return; }
  let body = ''; for await (const c of req) body += c;
  const r = await worker.fetch(new Request('http://w' + req.url, req.method === 'POST' ? { method: 'POST', body } : { method: req.method }), env);
  const h = {}; r.headers.forEach((v, k) => { h[k] = v; }); res.writeHead(r.status, h); res.end(await r.text());
}).listen(8787, () => console.log('up'));
