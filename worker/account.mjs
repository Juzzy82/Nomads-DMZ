// NOMADS DMZ HUB accounts: who am I, saved progress, export and delete.
import { ensureSchema, nowSec } from './db.mjs';
import { login, callback, logout, getSession, configured, setCookie, COOKIE_SESSION } from './auth.mjs';

const JSON_H = { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' };
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { ...JSON_H, ...extra } });
export const NAMESPACES = ['upgrades', 'camos'];
const MAX_BODY = 100 * 1024, MAX_STORED = 64 * 1024;

/* ---------- checks and cleaning: only the exact shapes the trackers use are ever stored ---------- */
const BAD = new Set(['__proto__', 'constructor', 'prototype']);
const textKey = (k) => typeof k === 'string' && k.length >= 1 && k.length <= 60 && !BAD.has(k) && /^[A-Za-z0-9 .'\u2019&()+,:\/\-]+$/.test(k);
const idKey = (k) => typeof k === 'string' && /^[a-z0-9][a-z0-9-]{0,40}$/.test(k) && !BAD.has(k);
const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
const idx = (s, hi) => (/^\d{1,3}$/.test(String(s)) && +s <= hi ? +s : null);
const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
export function cleanUpgrades(d) {
  const out = { done: {}, have: {} }; if (!isObj(d)) return out;
  if (isObj(d.done)) for (const [k, v] of Object.entries(d.done).slice(0, 40)) { const n = int(v, 0, 10); if (textKey(k) && n !== null) out.done[k] = n; }
  if (isObj(d.have)) for (const [tier, mats] of Object.entries(d.have).slice(0, 200)) {
    if (!textKey(tier) || !isObj(mats)) continue; const o = {};
    for (const [m, v] of Object.entries(mats).slice(0, 16)) { const n = int(v, 0, 1e9); if (textKey(m) && n !== null) o[m] = n; }
    if (Object.keys(o).length) out.have[tier] = o;
  }
  return out;
}
export function cleanCamos(d) {
  const out = { w: {}, g: {}, lvl: {} }; if (!isObj(d)) return out;
  if (isObj(d.w)) for (const [id, marks] of Object.entries(d.w).slice(0, 60)) {
    if (!idKey(id) || !isObj(marks)) continue; const o = {};
    for (const [i, v] of Object.entries(marks).slice(0, 60)) { const n = idx(i, 39); if (n !== null && v) o[n] = 1; }
    if (Object.keys(o).length) out.w[id] = o;
  }
  if (isObj(d.g)) for (const [i, v] of Object.entries(d.g).slice(0, 20)) { const n = idx(i, 9); if (n !== null && v) out.g[n] = 1; }
  if (isObj(d.lvl)) for (const [id, v] of Object.entries(d.lvl).slice(0, 60)) { const n = int(v, 0, 500); if (idKey(id) && n !== null) out.lvl[id] = n; }
  return out;
}
export const clean = { upgrades: cleanUpgrades, camos: cleanCamos };


/* ---------- private map pins ---------- */
export const PIN_COLORS = ['gold', 'red', 'green', 'blue', 'purple', 'white', 'orange', 'cyan'];
export const PIN_ICONS = ['pin', 'star', 'flag', 'skull', 'loot', 'key', 'door', 'target'];
export const MAX_PINS = 200, MAP_SIZE = 4096;
const tidy = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const pinRow = (r) => ({ id: r.id, x: r.x, y: r.y, name: r.name, note: r.note || '', color: r.color || 'gold', icon: r.icon || 'pin', created_at: r.created_at, updated_at: r.updated_at });
export function cleanPin(b, partial) {
  if (!isObj(b)) return { error: 'bad_request' };
  const out = {};
  for (const k of ['x', 'y']) if (!partial || k in b) { const n = b[k]; if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > MAP_SIZE) return { error: 'bad_position' }; out[k] = Math.round(n * 10) / 10; }
  if (!partial || 'name' in b) { out.name = tidy(b.name, 40); if (!out.name) return { error: 'name_required' }; }
  if (!partial || 'note' in b) out.note = tidy(b.note, 200);
  if (!partial || 'color' in b) { const c = b.color === undefined ? 'gold' : b.color; if (!PIN_COLORS.includes(c)) return { error: 'bad_color' }; out.color = c; }
  if (!partial || 'icon' in b) { const c = b.icon === undefined ? 'pin' : b.icon; if (!PIN_ICONS.includes(c)) return { error: 'bad_icon' }; out.icon = c; }
  return { pin: out };
}
async function listPins(env, s) {
  const { results } = await env.DB.prepare('SELECT id, x, y, name, note, color, icon, created_at, updated_at FROM pins WHERE user_id = ? ORDER BY created_at, id').bind(s.userId).all();
  return json({ pins: (results || []).map(pinRow), max: MAX_PINS });
}
async function createPin(request, env, s) {
  const c = cleanPin(await readJson(request), false); if (c.error) return json({ error: c.error }, 400);
  const t = nowSec();
  const n = await env.DB.prepare('SELECT COUNT(*) AS n, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS recent FROM pins WHERE user_id = ?').bind(t - 60, s.userId).first();
  if (n.n >= MAX_PINS) return json({ error: 'limit', max: MAX_PINS }, 409);
  if ((n.recent || 0) >= 30) return json({ error: 'slow_down' }, 429, { 'retry-after': '30' });
  const id = randomId(), p = c.pin;
  await env.DB.prepare('INSERT INTO pins (id, user_id, x, y, name, note, color, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, s.userId, p.x, p.y, p.name, p.note, p.color, p.icon, t, t).run();
  return json({ pin: pinRow({ id, ...p, created_at: t, updated_at: t }) }, 201);
}
async function updatePin(request, env, s, id) {
  const c = cleanPin(await readJson(request), true); if (c.error) return json({ error: c.error }, 400);
  const keys = Object.keys(c.pin); if (!keys.length) return json({ error: 'bad_request' }, 400);
  const t = nowSec();
  const r = await env.DB.prepare(`UPDATE pins SET ${keys.map((k) => k + ' = ?').join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`).bind(...keys.map((k) => c.pin[k]), t, id, s.userId).run();
  if (!r.meta || r.meta.changes !== 1) return json({ error: 'not_found' }, 404);
  const row = await env.DB.prepare('SELECT id, x, y, name, note, color, icon, created_at, updated_at FROM pins WHERE id = ? AND user_id = ?').bind(id, s.userId).first();
  return json({ pin: pinRow(row) });
}
async function deletePin(env, s, id) {
  const r = await env.DB.prepare('DELETE FROM pins WHERE id = ? AND user_id = ?').bind(id, s.userId).run();
  return (r.meta && r.meta.changes === 1) ? json({ ok: true }) : json({ error: 'not_found' }, 404);
}
const randomId = () => { const b = crypto.getRandomValues(new Uint8Array(9)); return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_'); };
const PIN_ID = /^\/api\/pins\/([A-Za-z0-9_-]{8,24})$/;

export function csrfOk(request) {
  if (request.headers.get('x-ndh') !== '1') return false;
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

async function readJson(request) {
  if (!/json/i.test(request.headers.get('content-type') || '')) return null;
  const len = +request.headers.get('content-length') || 0; if (len > MAX_BODY) return null;
  const text = await request.text(); if (text.length > MAX_BODY) return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}

async function getSync(env, session) {
  const { results } = await env.DB.prepare('SELECT ns, data, rev, updated_at FROM progress WHERE user_id = ?').bind(session.userId).all();
  const out = { upgrades: null, camos: null };
  for (const r of results || []) if (NAMESPACES.includes(r.ns)) { try { out[r.ns] = { data: JSON.parse(r.data), rev: r.rev, updated_at: r.updated_at }; } catch (e) { /* skip a damaged row */ } }
  return out;
}

async function putSync(request, env, session) {
  const body = await readJson(request); if (!isObj(body)) return json({ error: 'bad_request' }, 400);
  const ns = body.ns; if (!NAMESPACES.includes(ns)) return json({ error: 'bad_request' }, 400);
  const baseRev = int(body.baseRev, 0, 1e9); if (baseRev === null) return json({ error: 'bad_request' }, 400);
  const data = clean[ns](body.data), text = JSON.stringify(data); if (text.length > MAX_STORED) return json({ error: 'too_large' }, 413);
  const t = nowSec(); const cur = await env.DB.prepare('SELECT data, rev, updated_at FROM progress WHERE user_id = ? AND ns = ?').bind(session.userId, ns).first();
  if (cur && baseRev !== cur.rev) return json({ error: 'conflict', current: { data: JSON.parse(cur.data), rev: cur.rev, updated_at: cur.updated_at } }, 409);
  if (!cur && baseRev !== 0) return json({ error: 'conflict', current: null }, 409);
  if (cur && t - cur.updated_at < 1) return json({ error: 'slow_down' }, 429, { 'retry-after': '2' });
  const r = cur
    ? await env.DB.prepare('UPDATE progress SET data = ?, rev = rev + 1, updated_at = ? WHERE user_id = ? AND ns = ? AND rev = ?').bind(text, t, session.userId, ns, baseRev).run()
    : await env.DB.prepare('INSERT INTO progress (user_id, ns, data, rev, updated_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(user_id, ns) DO NOTHING').bind(session.userId, ns, text, t).run();
  if (!r.meta || r.meta.changes !== 1) { const now = await env.DB.prepare('SELECT data, rev, updated_at FROM progress WHERE user_id = ? AND ns = ?').bind(session.userId, ns).first(); return json({ error: 'conflict', current: now ? { data: JSON.parse(now.data), rev: now.rev, updated_at: now.updated_at } : null }, 409); }
  return json({ ok: true, rev: baseRev + 1, updated_at: t });
}

async function exportAll(env, session) {
  const u = await env.DB.prepare('SELECT id, name, avatar, created_at FROM users WHERE id = ?').bind(session.userId).first();
  const sync = await getSync(env, session);
  const { results: pins } = await env.DB.prepare('SELECT id, x, y, name, note, color, icon, created_at, updated_at FROM pins WHERE user_id = ?').bind(session.userId).all();
  const body = { exported_at: new Date().toISOString(), site: 'nomaddmzhub.com', user: u ? { id: u.id, name: u.name, avatar: u.avatar, created_at: u.created_at } : null,
    progress: { upgrades: sync.upgrades ? sync.upgrades.data : null, camos: sync.camos ? sync.camos.data : null }, pins: pins || [] };
  return new Response(JSON.stringify(body, null, 2), { status: 200, headers: { ...JSON_H, 'content-disposition': 'attachment; filename="nomads-dmz-hub-my-data.json"' } });
}

async function deleteAccount(request, env, session) {
  const body = await readJson(request); if (!isObj(body) || body.confirm !== 'DELETE') return json({ error: 'confirm_required' }, 400);
  const id = session.userId;
  await env.DB.batch([env.DB.prepare('DELETE FROM pins WHERE user_id = ?').bind(id), env.DB.prepare('DELETE FROM progress WHERE user_id = ?').bind(id), env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id), env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id)]);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ...JSON_H, 'set-cookie': setCookie(COOKIE_SESSION, '', 0) } });
}

export async function handleAccount(request, env, ctx, deps = {}) {
  const url = new URL(request.url), path = url.pathname.replace(/\/+$/, ''), m = request.method;
  try {
    if (path === '/auth/login' && m === 'GET') return login(request, env);
    if (path === '/auth/callback' && m === 'GET') return callback(request, env, ctx, deps);
    if (path === '/api/me' && m === 'GET') {
      if (!configured(env)) return json({ configured: false, loggedIn: false });
      const s = await getSession(request, env);
      return json(s ? { configured: true, loggedIn: true, user: { id: s.userId, name: s.name, avatar: s.avatar } } : { configured: true, loggedIn: false });
    }
    if (!configured(env)) return json({ error: 'not_configured' }, 503);
    if (['POST', 'PUT', 'DELETE'].includes(m) && !csrfOk(request)) return json({ error: 'forbidden' }, 403);
    if (path === '/auth/logout' && m === 'POST') return logout(request, env);
    const s = await getSession(request, env); if (!s) return json({ error: 'not_logged_in' }, 401);
    if (path === '/api/sync' && m === 'GET') return json(await getSync(env, s));
    if (path === '/api/sync' && m === 'PUT') return putSync(request, env, s);
    if (path === '/api/account/export' && m === 'GET') return exportAll(env, s);
    if (path === '/api/account' && m === 'DELETE') return deleteAccount(request, env, s);
    if (path === '/api/pins' && m === 'GET') return listPins(env, s);
    if (path === '/api/pins' && m === 'POST') return createPin(request, env, s);
    const pm = PIN_ID.exec(path);
    if (pm && m === 'PUT') return updatePin(request, env, s, pm[1]);
    if (pm && m === 'DELETE') return deletePin(env, s, pm[1]);
    return json({ error: 'not_found' }, 404);
  } catch (e) { return json({ error: 'server_error' }, 500); }
}
