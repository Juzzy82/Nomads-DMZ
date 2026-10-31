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
    return json({ error: 'not_found' }, 404);
  } catch (e) { return json({ error: 'server_error' }, 500); }
}
