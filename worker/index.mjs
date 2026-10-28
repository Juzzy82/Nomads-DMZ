// NOMADS DMZ HUB Worker: serves the website files (assets) and the patch notes API, and runs the scheduled checker.
import { runCheck } from './check.mjs';
import { latest, history, status } from './api.mjs';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' };
const json = (obj, status = 200, cache = 'no-store') => new Response(JSON.stringify(obj), { status, headers: { ...JSON_HEADERS, 'cache-control': cache } });

function tokenOk(request, env) {
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const want = env.ADMIN_TOKEN || '';
  if (!want || want.length < 12 || given.length !== want.length) return false;
  let diff = 0; for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

export async function handleApi(request, env, ctx) {
  const url = new URL(request.url); const path = url.pathname.replace(/\/+$/, '');
  if (!env.PATCHES) return json({ error: 'not_configured', message: 'The patch notes store has not been connected yet.' }, 503);
  try {
    if (request.method === 'GET' && path === '/api/dmz-patches/latest') return json(await latest(env, Math.min(+url.searchParams.get('n') || 10, 20)), 200, 'public, max-age=300, s-maxage=300');
    if (request.method === 'GET' && path === '/api/dmz-patches/history') return json(await history(env, { q: url.searchParams.get('q'), cat: url.searchParams.get('cat'), page: url.searchParams.get('page'), per: url.searchParams.get('per') }), 200, 'public, max-age=300, s-maxage=300');
    if (request.method === 'GET' && path === '/api/dmz-patches/status') return json(await status(env), 200, 'public, max-age=60, s-maxage=60');

    if (path.startsWith('/api/dmz-patches/admin/')) {
      if (!tokenOk(request, env)) return json({ error: 'forbidden' }, 403);
      if (request.method === 'POST' && path === '/api/dmz-patches/admin/refresh') {
        const last = await env.PATCHES.get('manual_last');
        if (last && Date.now() - Date.parse(last) < 300000) return json({ ok: false, error: 'A manual check finished less than 5 minutes ago. Please wait a few minutes.' }, 429);
        const result = await runCheck(env, 'manual');
        if (result && result.ok && !result.skipped) await env.PATCHES.put('manual_last', new Date().toISOString(), { expirationTtl: 600 });
        return json(result);
      }
      if (request.method === 'GET' && path === '/api/dmz-patches/admin/review') return json({ items: (await env.PATCHES.get('review', 'json')) || [] });
      if (request.method === 'GET' && path === '/api/dmz-patches/admin/diagnostics') return json({ meta: (await env.PATCHES.get('meta', 'json')) || null });
    }
    return json({ error: 'not_found' }, 404);
  } catch (e) { return json({ error: 'server_error' }, 500); }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/dmz-patches')) return handleApi(request, env, ctx);
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(runCheck(env, 'cron')); }
};
