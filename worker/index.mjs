// NOMADS DMZ HUB Worker: serves the website files (assets) and the patch notes API, and runs the scheduled checker.
import { runCheck } from './check.mjs';
import { latest, history, status } from './api.mjs';
import { refreshYoutube, latestVideo } from './youtube.mjs';
import { refreshCodLatest, codLatest } from './codlatest.mjs';
import { handleAccount } from './account.mjs';
import { relayPlan, cleanPages, relayFetch } from './relay.mjs';
import { patchPagesOn } from './check.mjs';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' };
const json = (obj, status = 200, cache = 'no-store') => new Response(JSON.stringify(obj), { status, headers: { ...JSON_HEADERS, 'cache-control': cache } });

function tokenOk(request, env) {
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const want = String(env.ADMIN_TOKEN || '').trim();   // stray spaces or a line break pasted into the secret no longer break it
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
    if (request.method === 'GET' && path === '/api/latest-video') return json(await latestVideo(env), 200, 'public, max-age=900, s-maxage=900');
    if (request.method === 'GET' && path === '/api/cod-latest') return json(await codLatest(env), 200, 'public, max-age=900, s-maxage=900');
    if (request.method === 'GET' && path === '/api/dmz-patches/status') return json(await status(env), 200, 'public, max-age=60, s-maxage=60');

    if (path.startsWith('/api/dmz-patches/admin/')) {
      if (!tokenOk(request, env)) return json({ error: 'forbidden' }, 403);
      if (request.method === 'POST' && path === '/api/dmz-patches/admin/refresh') {
        const last = await env.PATCHES.get('manual_last');
        if (last && Date.now() - Date.parse(last) < 300000) return json({ ok: false, error: 'A manual check finished less than 5 minutes ago. Please wait a few minutes.' }, 429);
        const result = await runCheck(env, 'manual'); result.youtube = await refreshYoutube(env); result.cod = await refreshCodLatest(env);
        if (result && result.ok && !result.skipped) await env.PATCHES.put('manual_last', new Date().toISOString(), { expirationTtl: 600 });
        return json(result);
      }
      // pages from the GitHub relay job (callofduty.com blocks Cloudflare)
      if (request.method === 'POST' && (path === '/api/dmz-patches/admin/relay-plan' || path === '/api/dmz-patches/admin/relay')) {
        const len = +(request.headers.get('content-length') || 0); if (len > 9000000) return json({ ok: false, error: 'too_large' }, 413);
        let body; try { body = JSON.parse(await request.text()); } catch (e) { return json({ ok: false, error: 'bad_json' }, 400); }
        if (path.endsWith('/relay-plan')) return json({ ok: true, urls: relayPlan(body && body.index) });
        const pages = cleanPages(body && body.pages); if (!Object.keys(pages).length) return json({ ok: false, error: 'no_pages' }, 400);
        const f = relayFetch(pages);
        const result = { ok: true, trigger: 'github', pages: Object.keys(pages).length };
        result.cod = await refreshCodLatest(env, { fetch: f });
        result.patchnotes = patchPagesOn(env) ? await runCheck(env, 'github', { fetch: f }) : { skipped: 'Patch notes check is switched off (ENABLE_PATCH_PAGES).' };
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
    const p = url.pathname;
    if (p.startsWith('/auth/') || p === '/api/me' || p === '/api/sync' || p.startsWith('/api/account') || p.startsWith('/api/pins')) return handleAccount(request, env, ctx);
    if (p.startsWith('/api/dmz-patches') || p === '/api/latest-video' || p === '/api/cod-latest') return handleApi(request, env, ctx);
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(Promise.allSettled([runCheck(env, 'cron'), refreshYoutube(env), refreshCodLatest(env)])); }
};
