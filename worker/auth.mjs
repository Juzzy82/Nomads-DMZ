// NOMADS DMZ HUB accounts: "Log in with Discord" (identity only) and login sessions.
import { ensureSchema, nowSec } from './db.mjs';

export const COOKIE_SESSION = '__Host-ndh_session';
export const COOKIE_STATE = '__Host-ndh_state';
export const SESSION_DAYS = 30;
const DISCORD = { authorize: 'https://discord.com/oauth2/authorize', token: 'https://discord.com/api/oauth2/token', revoke: 'https://discord.com/api/oauth2/token/revoke', me: 'https://discord.com/api/users/@me' };
export const siteOrigin = (env) => String(env.SITE_ORIGIN || 'https://nomaddmzhub.com').replace(/\/+$/, '');
export const configured = (env) => !!(env && env.DB && env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET);

export const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
export async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  a = String(a || ''); b = String(b || ''); if (a.length !== b.length || !a) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0;
}
export function parseCookies(h) {
  const out = {}; String(h || '').split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }); return out;
}
export const setCookie = (name, value, maxAge) => `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;

const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 64) || 'Operator';
const cleanAvatar = (s) => (typeof s === 'string' && /^[a-zA-Z0-9_]{1,40}$/.test(s) ? s : null);

export function login(request, env) {
  if (!configured(env)) return new Response('Login is not set up yet.', { status: 503, headers: { 'cache-control': 'no-store' } });
  const origin = siteOrigin(env), here = new URL(request.url);
  if (here.origin !== origin) return Response.redirect(origin + '/auth/login', 302);           // the cookie must be set on the real site address
  const state = randomToken(24);
  const u = new URL(DISCORD.authorize);
  u.search = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, response_type: 'code', redirect_uri: origin + '/auth/callback', scope: 'identify', state, prompt: 'none' }).toString();
  const h = new Headers({ location: u.toString(), 'cache-control': 'no-store' }); h.append('set-cookie', setCookie(COOKIE_STATE, state, 600));
  return new Response(null, { status: 302, headers: h });
}

export async function callback(request, env, ctx, deps = {}) {
  const f = deps.fetch || fetch, origin = siteOrigin(env), url = new URL(request.url);
  const done = (to, clearState = true) => { const h = new Headers({ location: origin + to, 'cache-control': 'no-store' }); if (clearState) h.append('set-cookie', setCookie(COOKIE_STATE, '', 0)); return new Response(null, { status: 302, headers: h }); };
  if (!configured(env)) return done('/?login=error');
  if (url.searchParams.get('error')) return done('/?login=cancelled');
  const cookies = parseCookies(request.headers.get('cookie')); const state = url.searchParams.get('state'), code = url.searchParams.get('code');
  if (!code || !safeEqual(state, cookies[COOKIE_STATE])) return done('/?login=error');
  try {
    const tr = await f(DISCORD.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: origin + '/auth/callback' }).toString() });
    if (!tr.ok) return done('/?login=error');
    const tok = await tr.json(); if (!tok || typeof tok.access_token !== 'string') return done('/?login=error');
    const mr = await f(DISCORD.me, { headers: { authorization: 'Bearer ' + tok.access_token }, signal: AbortSignal.timeout(10000) });
    if (!mr.ok) return done('/?login=error');
    const me = await mr.json();
    // we only needed the name once: hand the Discord token back straight away
    const revoke = f(DISCORD.revoke, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, token: tok.access_token, token_type_hint: 'access_token' }).toString() }).catch(() => {});
    if (ctx && ctx.waitUntil) ctx.waitUntil(revoke);
    if (!me || !/^\d{5,25}$/.test(String(me.id))) return done('/?login=error');
    await ensureSchema(env.DB);
    const t = nowSec(), id = String(me.id), name = cleanName(me.global_name || me.username), avatar = cleanAvatar(me.avatar);
    const session = randomToken(32), hash = await sha256Hex(session);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (id, name, avatar, created_at, last_login) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, avatar = excluded.avatar, last_login = excluded.last_login').bind(id, name, avatar, t, t),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t),
      env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(hash, id, t, t + SESSION_DAYS * 86400)
    ]);
    const h = new Headers({ location: origin + '/?login=ok', 'cache-control': 'no-store' });
    h.append('set-cookie', setCookie(COOKIE_SESSION, session, SESSION_DAYS * 86400)); h.append('set-cookie', setCookie(COOKIE_STATE, '', 0));
    return new Response(null, { status: 302, headers: h });
  } catch (e) { return done('/?login=error'); }
}

export async function getSession(request, env) {
  if (!configured(env)) return null;
  const tok = parseCookies(request.headers.get('cookie'))[COOKIE_SESSION];
  if (!tok || !/^[A-Za-z0-9_-]{20,64}$/.test(tok)) return null;
  await ensureSchema(env.DB);
  const hash = await sha256Hex(tok), t = nowSec();
  const row = await env.DB.prepare('SELECT s.user_id AS user_id, s.expires_at AS expires_at, u.name AS name, u.avatar AS avatar FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').bind(hash).first();
  if (!row || row.expires_at <= t) return null;
  if (row.expires_at - t < (SESSION_DAYS - 1) * 86400) await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').bind(t + SESSION_DAYS * 86400, hash).run();   // keeps active people logged in, at most one write a day
  return { userId: String(row.user_id), name: row.name, avatar: row.avatar, hash };
}

export async function logout(request, env) {
  const s = await getSession(request, env);
  if (s) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(s.hash).run();
  return new Response(null, { status: 204, headers: { 'set-cookie': setCookie(COOKIE_SESSION, '', 0), 'cache-control': 'no-store' } });
}
