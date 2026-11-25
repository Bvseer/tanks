import initSqlJs from 'sql.js'; import crypto from 'node:crypto'; import worker from './worker.js';
const SQL = await initSqlJs(); const db = new SQL.Database();
const stmt = (sql, args) => ({ bind: (...a) => stmt(sql, a),
  all: async () => { const s = db.prepare(sql); s.bind(args || []); const rows = []; while (s.step()) rows.push(s.getAsObject()); s.free(); return { results: rows }; },
  first: async () => { const s = db.prepare(sql); s.bind(args || []); const r = s.step() ? s.getAsObject() : null; s.free(); return r; },
  run: async () => { db.run(sql, args || []); return { success: true, meta: { changes: db.getRowsModified() } }; } });
const DB = { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); } };
const env = { DB, BOT_TOKEN: '123456:TEST-token', HOOK_SECRET: 'hooksecret' };
const sent = []; globalThis.fetch = async (u, o) => { const b = o && o.body ? JSON.parse(o.body) : null; sent.push(String(u).split('/').pop() + (b && b.chat_id ? ' to ' + b.chat_id + ': ' + String(b.text).slice(0, 46) : '')); return new Response(JSON.stringify({ ok: true, result: { id: 'PREP' } })); };
function init(user) { const p = { auth_date: String(Math.floor(Date.now()/1000)), query_id: 'AAE', user: JSON.stringify(user) }; const dcs = Object.keys(p).sort().map((k) => k + '=' + p[k]).join('\n'), secret = crypto.createHmac('sha256', 'WebAppData').update(env.BOT_TOKEN).digest(); p.hash = crypto.createHmac('sha256', secret).update(dcs).digest('hex'); return new URLSearchParams(p).toString(); }
const call = async (path, body, headers) => { const r = await worker.fetch(new Request('https://w.example' + path, body === undefined ? { headers } : { method: 'POST', body: JSON.stringify(body), headers }), env); let j = null; const t = await r.text(); try { j = JSON.parse(t); } catch (e) { j = t; } return { s: r.status, j }; };
const T0 = Date.now; let SK = 0; Date.now = () => T0() + SK*1000;
const o = {}, A = init({ id: 11, first_name: 'Basir' }), B = init({ id: 22, first_name: 'Aziz', language_code: 'uz' }), C = init({ id: 33, first_name: 'Third' });
o.noauth = (await call('/new', { init: 'x' })).s; const g = (await call('/new', { init: A })).j; o.made = g.ok + ' ' + /^[a-z0-9]{8}$/.test(g.id) + ' ' + g.link.replace(g.id, 'ID');
o.own = JSON.stringify((({ st, me, turn, names }) => ({ st, me, turn, names }))((await call('/join', { init: A, id: g.id })).j));
o.early = (await call('/move', { init: A, id: g.id, n: 0, mv: { i: 3 } })).j.err;
const jb = (await call('/join', { init: B, id: g.id })).j; o.joined = jb.st + ' me ' + jb.me + ' turn ' + jb.turn + ' ' + jb.names.join('/') + ' | ' + sent.join(' ; '); sent.length = 0;
o.third = (await call('/join', { init: C, id: g.id })).j.err + ' get ' + (await call('/get', { init: C, id: g.id, n: 0 })).s;
o.wrongTurn = (await call('/move', { init: B, id: g.id, n: 0, mv: { i: 3 } })).j.err;
o.p0 = JSON.stringify((await call('/move', { init: A, id: g.id, n: 0, mv: { i: 3 } })).j); o.taken = (await call('/move', { init: B, id: g.id, n: 1, mv: { i: 3 } })).j.err; o.range = (await call('/move', { init: B, id: g.id, n: 1, mv: { i: 20 } })).j.err;
{ const r = (await call('/move', { init: B, id: g.id, n: 0, mv: { i: 5 } })).j; o.stale = r.err + ' sees ' + JSON.stringify(r.moves); }
let n = 1; const free = []; for (let i = 0; i < 20; i++) if (i !== 3) free.push(i);
for (; n < 19; n++) await call('/move', { init: n % 2 ? B : A, id: g.id, n, mv: { i: free.shift() } });
o.lastPickNoSnap = (await call('/move', { init: B, id: g.id, n: 19, mv: { i: free[0] } })).j.err; o.lastPick = JSON.stringify((await call('/move', { init: B, id: g.id, n: 19, mv: { i: free[0] }, snap: 'S0' })).j);
{ const v = (await call('/get', { init: A, id: g.id, n: 18 })).j; o.afterDraft = v.st + ' turn ' + v.turn + ' from ' + v.from + ' moves ' + v.moves.length + ' snap ' + v.snap; }
o.badShot = (await call('/move', { init: A, id: g.id, n: 20, mv: { wi: 0, ang: 200, pow: 50, x: 300 }, snap: 'S1', score: [5, 0] })).j.err + ',' + (await call('/move', { init: A, id: g.id, n: 20, mv: { wi: 0, ang: 60, pow: 50, x: 300 } })).j.err;
sent.length = 0; SK += 100; o.shot = JSON.stringify((await call('/move', { init: A, id: g.id, n: 20, mv: { wi: 2, ang: 61.237, pow: 70.5, x: 300 }, snap: 'S1', score: [35, 0] })).j) + ' | ' + sent.join(' ; ');
{ const v = (await call('/get', { init: B, id: g.id, n: 20 })).j; o.seen = JSON.stringify(v.moves) + ' snap ' + v.snap + ' prev ' + v.psnap + ' score ' + v.score + ' turn ' + v.turn; }
sent.length = 0; o.noNote = (await call('/move', { init: B, id: g.id, n: 21, mv: { wi: 0, ang: 120, pow: 60, x: 1500 }, snap: 'S2', score: [35, 12] })).j.ok + ' sent ' + sent.length + ' (соперник не опрашивал давно: ' + ((await call('/get', { init: A, id: g.id, n: 22 })).j.n) + ')';
for (n = 22; n < 39; n++) { await call('/get', { init: n % 2 ? A : B, id: g.id, n }); await call('/move', { init: n % 2 ? B : A, id: g.id, n, mv: { wi: 0, ang: 60, pow: 60, x: 300 }, snap: 'S' + n, score: [35 + n, 12] }); }
sent.length = 0; o.end = JSON.stringify((await call('/move', { init: B, id: g.id, n: 39, mv: { wi: 0, ang: 60, pow: 60, x: 300 }, snap: 'SE', score: [80, 95] })).j) + ' | ' + sent.join(' ; '); o.after = (await call('/move', { init: A, id: g.id, n: 40, mv: { wi: 0, ang: 60, pow: 60, x: 300 }, snap: 'X', score: [999, 0] })).j.err;
o.stats = JSON.stringify(db.exec('SELECT uid, games, wins, pts FROM tusr ORDER BY uid')[0].values);
const g2 = (await call('/new', { init: B })).j; o.mine = JSON.stringify((await call('/mine', { init: B })).j.list.map((d) => d.st + ':' + d.foe + ':' + d.mine + ':' + d.score));
sent.length = 0; { const r = (await call('/share', { init: B, id: g2.id, lang: 'uz' })).j; o.share = r.ok + ' ' + r.kind + ' ' + r.id + ' | ' + sent.join(); }
o.tg = (await call('/tg', { message: { chat: { id: 5 }, text: '/start' } })).s + ' ' + (await call('/tg', { message: { chat: { id: 5 }, text: '/start' } }, { 'X-Telegram-Bot-Api-Secret-Token': 'hooksecret' })).s; o.setup = JSON.stringify((await call('/setup?key=hooksecret')).j) + ' bad ' + (await call('/setup?key=x')).s + ' root ' + JSON.stringify((await call('/')).j);
{ sent.length = 0; const H = { 'X-Telegram-Bot-Api-Secret-Token': 'hooksecret' }, msg = (text, from) => ({ message: { chat: { id: -100500 }, from, text } });
  await call('/tg', msg('/duel@tankDuelBot', { id: 44, first_name: 'Sardor<b>' }), H); const n1 = db.exec("SELECT count(*) FROM duel WHERE a = 44")[0].values[0][0]; await call('/tg', msg('/duel', { id: 44, first_name: 'Sardor' }), H); const n2 = db.exec("SELECT count(*) FROM duel WHERE a = 44")[0].values[0][0];
  const gid = db.exec("SELECT id, an FROM duel WHERE a = 44")[0].values[0]; const jj = (await call('/join', { init: A, id: gid[0] })).j; await call('/tg', msg('/duel', { id: 44, first_name: 'Sardor' }), H); const n3 = db.exec("SELECT count(*) FROM duel WHERE a = 44")[0].values[0][0];
  o.groupDuel = 'rows ' + n1 + ',' + n2 + ',' + n3 + ' name ' + gid[1] + ' joined ' + jj.st + ' me ' + jj.me + ' | ' + sent.join(' ; '); }
db.run('DROP TABLE duel'); db.run('DROP TABLE tusr'); o.fresh = (await call('/new', { init: A })).j.ok;
console.log(JSON.stringify(o, null, 1));
