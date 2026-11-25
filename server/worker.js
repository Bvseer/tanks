// Залп — duels between players, and the bot.
// Cloudflare Worker. Needs: a D1 database bound as DB, secrets BOT_TOKEN and HOOK_SECRET.
// Optional plain variables: GAME_URL (where the game is hosted), BOT_NAME.
//
// A duel is kept as a list of moves: twenty picks of weapons, then twenty shots. The server checks whose turn it is and that a pick is free;
// the outcome of a shot is worked out by the game of the player who fired and comes with the move as a picture of the field (the hills, the
// tanks, the score). The other player's game plays the shot for the eye and then takes that picture over, so the two never drift apart.

const FRESH = 7*24*3600, PICKS = 10, POOL = 20, OPEN_FOR = 3*24*3600, SNAP_MAX = 14000;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };
const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, CORS) });
const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();
async function hmac(key, msg) { const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return crypto.subtle.sign('HMAC', k, enc.encode(msg)); }
function same(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
const now = () => Math.floor(Date.now()/1000);
const botName = (env) => env.BOT_NAME || 'tankDuelBot';
const link = (env, id) => 'https://t.me/' + botName(env) + '?startapp=g_' + id;

// Who is asking: Telegram signs the data it hands to a Mini App with the bot's token, so a name cannot be made up.
async function whoIs(init, env) {
  if (!init || typeof init !== 'string' || init.length > 4096 || !env.BOT_TOKEN) return null;
  const p = new URLSearchParams(init), hash = p.get('hash'); if (!hash) return null;
  const lines = []; for (const [k, v] of p) if (k !== 'hash') lines.push(k + '=' + v); lines.sort();
  const secret = await hmac('WebAppData', env.BOT_TOKEN), sign = hex(await hmac(secret, lines.join('\n')));
  if (!same(sign, hash)) return null;
  const at = parseInt(p.get('auth_date') || '0', 10); if (!(at > 0) || Date.now()/1000 - at > FRESH) return null;
  let u = null; try { u = JSON.parse(p.get('user') || 'null'); } catch (e) {}
  if (!u || !Number.isSafeInteger(u.id)) return null;
  const name = String(u.first_name || u.username || 'Игрок').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Игрок';
  return { id: u.id, name: name, uz: String(u.language_code || '').toLowerCase().indexOf('uz') === 0 };
}
async function tables(env) {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS duel (id TEXT PRIMARY KEY, a INTEGER NOT NULL, an TEXT NOT NULL, b INTEGER, bn TEXT, seed INTEGER NOT NULL, st TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, moves TEXT NOT NULL DEFAULT '[]', snap TEXT, psnap TEXT, sa INTEGER NOT NULL DEFAULT 0, sb INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, made INTEGER NOT NULL, pa INTEGER NOT NULL DEFAULT 0, pb INTEGER NOT NULL DEFAULT 0)"),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS duel_a ON duel (a, at)'), env.DB.prepare('CREATE INDEX IF NOT EXISTS duel_b ON duel (b, at)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS tusr (uid INTEGER PRIMARY KEY, name TEXT, games INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, pts INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL)'),
  ]);
}
async function withTables(env, work) { try { return await work(); } catch (e) { if (!/no such table/i.test(String(e && e.message || e))) throw e; await tables(env); return await work(); } }
async function tg(env, method, body) { try { return await (await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json(); } catch (e) { return null; } }

// Whose move it is, from the count of moves alone: the picks go a, b, a, b…; then the shots the same way.
const turnOf = (n) => n < POOL ? n % 2 : n < POOL*2 ? (n - POOL) % 2 : -1;
function view(d, me, since) {                // what a player's game is told about a duel
  const moves = JSON.parse(d.moves || '[]'), side = d.a === me ? 0 : d.b === me ? 1 : -1, from = Math.max(0, Math.min(since | 0, moves.length));
  return { ok: true, id: d.id, st: d.st, seed: d.seed, n: d.n, me: side, names: [d.an, d.bn || ''], score: [d.sa, d.sb], turn: d.st === 'open' || d.st === 'over' ? -1 : turnOf(d.n), moves: moves.slice(from), from: from, snap: d.snap || null, psnap: d.psnap || null };
}
async function note(env, uid, text, id) { if (!uid) return; await tg(env, 'sendMessage', { chat_id: uid, text: text, reply_markup: { inline_keyboard: [[{ text: '▶ Открыть дуэль', url: link(env, id) }]] } }); }

async function duel(env, path, q) {
  const me = await whoIs(q.init, env); if (!me) return json({ ok: false, err: 'auth' }, 401);
  const t = now();
  if (path === '/new') {                     // a challenge: open until somebody else comes in by its link
    let id = ''; const abc = 'abcdefghjkmnpqrstuvwxyz23456789'; const rnd = crypto.getRandomValues(new Uint8Array(8)); for (let i = 0; i < 8; i++) id += abc[rnd[i] % abc.length];
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] | 0;
    await withTables(env, () => env.DB.prepare("INSERT INTO duel (id, a, an, seed, st, at, made) VALUES (?1, ?2, ?3, ?4, 'open', ?5, ?5)").bind(id, me.id, me.name, seed, t).run());
    await env.DB.prepare('INSERT INTO tusr (uid, name, at) VALUES (?1, ?2, ?3) ON CONFLICT (uid) DO UPDATE SET name = excluded.name, at = excluded.at').bind(me.id, me.name, t).run();
    return json({ ok: true, id: id, link: link(env, id) });
  }
  if (path === '/mine') {                    // the duels a player is in, the latest first
    const r = await withTables(env, () => env.DB.prepare("SELECT id, a, b, an, bn, st, n, sa, sb, at FROM duel WHERE (a = ?1 OR b = ?1) AND (st != 'over' OR at > ?2) AND (st != 'open' OR made > ?3) ORDER BY at DESC LIMIT 12").bind(me.id, t - 2*86400, t - OPEN_FOR).all());
    return json({ ok: true, list: (r.results || []).map((d) => { const side = d.a === me.id ? 0 : 1; return { id: d.id, st: d.st, foe: side ? d.an : (d.bn || ''), mine: d.st !== 'open' && d.st !== 'over' && turnOf(d.n) === side, score: side ? [d.sb, d.sa] : [d.sa, d.sb], at: d.at }; }) });
  }
  const id = String(q.id || ''); if (!/^[a-z0-9]{6,12}$/.test(id)) return json({ ok: false, err: 'range' }, 400);
  let d = await withTables(env, () => env.DB.prepare('SELECT * FROM duel WHERE id = ?').bind(id).first()); if (!d) return json({ ok: false, err: 'none' }, 404);
  if (path === '/join') {
    if (d.st === 'open' && d.a !== me.id) {
      if (t - d.made > OPEN_FOR) return json({ ok: false, err: 'old' });
      const up = await env.DB.prepare("UPDATE duel SET b = ?1, bn = ?2, st = 'draft', at = ?3 WHERE id = ?4 AND st = 'open'").bind(me.id, me.name, t, id).run();
      if (up && up.meta && up.meta.changes) { await env.DB.prepare('INSERT INTO tusr (uid, name, at) VALUES (?1, ?2, ?3) ON CONFLICT (uid) DO UPDATE SET name = excluded.name, at = excluded.at').bind(me.id, me.name, t).run(); await note(env, d.a, '⚔️ ' + me.name + ' принял твой вызов. Выбирай оружие — твой ход.', id); }
      d = await env.DB.prepare('SELECT * FROM duel WHERE id = ?').bind(id).first();
    }
    if (d.a !== me.id && d.b !== me.id) return json({ ok: false, err: 'full', names: [d.an, d.bn || ''] });
    return json(view(d, me.id, 0));
  }
  if (d.a !== me.id && d.b !== me.id) return json({ ok: false, err: 'full' }, 403);
  if (path === '/get') { const col = d.a === me.id ? 'pa' : 'pb'; if (t - (d[col] | 0) > 20) await env.DB.prepare('UPDATE duel SET ' + col + ' = ? WHERE id = ?').bind(t, id).run();          // when this player's game was last seen asking: noted at most every twenty seconds
    return json(view(d, me.id, q.n)); }
  if (path === '/move') {
    const side = d.a === me.id ? 0 : 1, mv = q.mv || {}, moves = JSON.parse(d.moves || '[]'), n = moves.length;
    if (d.st !== 'draft' && d.st !== 'play') return json({ ok: false, err: 'state', st: d.st });
    if ((q.n | 0) !== n) return json(Object.assign(view(d, me.id, q.n), { ok: false, err: 'stale' }));          // the game was behind: here is what it missed
    if (turnOf(n) !== side) return json({ ok: false, err: 'turn' });
    const snap = typeof q.snap === 'string' && q.snap.length <= SNAP_MAX ? q.snap : null; let rec, st = d.st, sa = d.sa, sb = d.sb;
    if (n < POOL) { const i = mv.i | 0; if (!(i >= 0 && i < POOL) || moves.some((m) => m.i === i)) return json({ ok: false, err: 'pick' }); rec = { t: 'p', i: i }; if (n + 1 === POOL) { if (!snap) return json({ ok: false, err: 'snap' }); st = 'play'; } }
    else { const wi = mv.wi | 0, ang = +mv.ang, pow = +mv.pow, x = mv.x | 0; if (!(wi >= 0 && wi < PICKS) || !(ang >= 0 && ang <= 180) || !(pow >= 5 && pow <= 100) || !(x >= 0 && x <= 4000) || !snap) return json({ ok: false, err: 'shot' });
      rec = { t: 's', wi: wi, ang: Math.round(ang*100)/100, pow: Math.round(pow*100)/100, x: x }; const sc = Array.isArray(q.score) ? q.score : []; sa = Math.max(0, Math.min(99999, sc[0] | 0)); sb = Math.max(0, Math.min(99999, sc[1] | 0)); if (n + 1 === POOL*2) st = 'over'; }
    moves.push(rec);
    const up = await env.DB.prepare('UPDATE duel SET moves = ?1, n = ?2, st = ?3, sa = ?4, sb = ?5, at = ?6, psnap = CASE WHEN ?7 IS NULL THEN psnap ELSE snap END, snap = COALESCE(?7, snap) WHERE id = ?8 AND n = ?9').bind(JSON.stringify(moves), n + 1, st, sa, sb, t, snap, id, n).run();
    if (!(up && up.meta && up.meta.changes)) return json({ ok: false, err: 'stale' });
    const foe = side ? d.a : d.b, foeName = side ? d.an : d.bn;
    if (st === 'over') { const win = sa === sb ? -1 : sa > sb ? 0 : 1; for (const [uid, s, w] of [[d.a, sa, win === 0], [d.b, sb, win === 1]]) await env.DB.prepare('UPDATE tusr SET games = games + 1, wins = wins + ?1, pts = pts + ?2 WHERE uid = ?3').bind(w ? 1 : 0, s, uid).run();
      await note(env, foe, '🏁 Дуэль с ' + me.name + ' окончена: ' + (side ? sb + ' : ' + sa : sa + ' : ' + sb) + '. ' + (win < 0 ? 'Ничья.' : (win === side ? 'Победил ' + me.name + '.' : 'Ты победил!')), id); }
    else if (t - ((side ? d.pa : d.pb) | 0) > 45) await note(env, foe, (n + 1 === POOL ? '🎯 Оружие разобрано. ' : n < POOL ? '🧰 ' + me.name + ' выбрал оружие. ' : '💥 ' + me.name + ' выстрелил. ') + 'Твой ход, ' + foeName + '.', id);          // a message from the bot only when the other player's game has not been seen asking lately
    return json({ ok: true, n: n + 1, st: st });
  }
  if (path === '/share') {                   // the challenge as a card the player sends into a chat of his choice
    const uz = q.lang === 'uz', text = uz ? '⚔️ ' + me.name + ' sizni tank dueliga chaqirmoqda!\nQurol tanlang va navbat bilan o‘q uzing. Kim aniqroq?' : '⚔️ ' + me.name + ' вызывает на танковую дуэль!\nРазбираете оружие и стреляете по очереди. Кто точнее?';
    const kb = { inline_keyboard: [[{ text: uz ? '🎯 Qabul qilish' : '🎯 Принять вызов', url: link(env, id) }]] }, rid = 'd' + Date.now().toString(36), img = (env.GAME_URL || 'https://bvseer.github.io/tanks/') + 'share.jpg'; let why = '';
    for (const result of [{ type: 'photo', id: rid, photo_url: img, thumbnail_url: img, photo_width: 1280, photo_height: 720, caption: text, reply_markup: kb }, { type: 'article', id: rid, title: 'Залп', description: uz ? 'Tank dueli' : 'Танковая дуэль', input_message_content: { message_text: text }, reply_markup: kb }]) {
      const r = await tg(env, 'savePreparedInlineMessage', { user_id: me.id, result: result, allow_user_chats: true, allow_group_chats: true, allow_channel_chats: true }); if (r && r.ok && r.result && r.result.id) return json({ ok: true, id: String(r.result.id), kind: result.type, link: link(env, id) }); why = String(r && r.description || 'net'); }
    return json({ ok: false, err: 'tg', why: why.slice(0, 120), link: link(env, id) });
  }
  return json({ ok: false, err: 'path' }, 404);
}

// The bot in a chat: a word of welcome and a button into the game.
async function telegram(env, request) {
  if (!env.HOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.HOOK_SECRET) return new Response('no', { status: 403 });
  let u = null; try { u = await request.json(); } catch (e) {} const m = u && u.message; if (!m || !m.chat || typeof m.text !== 'string') return new Response('ok');
  const cmd = m.text.trim().split(/[\s@]/)[0].toLowerCase(), url = 'https://t.me/' + botName(env) + '?startapp=home';
  if (cmd === '/start' || cmd === '/play' || cmd === '/duel' || cmd === '/help') await tg(env, 'sendMessage', { chat_id: m.chat.id, text: '💥 Залп — танковая дуэль.\n\nРазбираете оружие по очереди, потом стреляете: угол, сила, огонь. Земля разрушается, у кого больше очков — тот победил.\n\nБрось вызов другу или сыграй против компьютера.', reply_markup: { inline_keyboard: [[{ text: '🎯 Играть', url: url }]] } });
  return new Response('ok');
}
async function setup(env, origin) {
  await tables(env);
  const hook = await tg(env, 'setWebhook', { url: origin + '/tg', secret_token: env.HOOK_SECRET, allowed_updates: ['message'] });
  const cmds = await tg(env, 'setMyCommands', { commands: [{ command: 'play', description: 'Играть' }, { command: 'help', description: 'Как играть' }] });
  return { webhook: hook && hook.ok, commands: cmds && cmds.ok };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (path === '/tg' && request.method === 'POST') return await telegram(env, request);
      if (path === '/new' || path === '/join' || path === '/get' || path === '/move' || path === '/mine' || path === '/share') {
        if (request.method !== 'POST') return json({ ok: false, err: 'method' }, 405);
        const t = await request.text(); if (t.length > 24000) return json({ ok: false, err: 'big' }, 413); let q = {}; try { q = JSON.parse(t) || {}; } catch (e) { return json({ ok: false, err: 'json' }, 400); }
        return await duel(env, path, q);
      }
      if (path === '/setup') { if (!env.HOOK_SECRET || url.searchParams.get('key') !== env.HOOK_SECRET) return json({ ok: false, err: 'key' }, 403); return json(Object.assign({ ok: true }, await setup(env, url.origin))); }
      if (path === '/') return json({ ok: true, name: 'Zalp', db: !!env.DB, token: !!env.BOT_TOKEN, key: !!env.HOOK_SECRET });
      return json({ ok: false, err: 'path' }, 404);
    } catch (e) { return json({ ok: false, err: 'server', msg: String(e && e.message || e).slice(0, 200) }, 500); }
  },
};
