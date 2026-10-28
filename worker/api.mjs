// Read-only data for the website, built from what the checker saved in KV.
import { visibleBadge, sortEntries } from './lib.mjs';
import { SOURCES, NOT_MONITORED } from './check.mjs';

export const SCHEDULE = 'Every 6 hours (00:00, 06:00, 12:00 and 18:00 UTC)';

export function publicEntry(e, nowMs) {
  return {
    id: e.id, title: e.title, game: e.game, category: e.category, summary: e.summary, details: e.details,
    source_name: e.source_name, source_url: e.source_url, published_at: e.published_at,
    first_detected_at: e.first_detected_at, last_modified_at: e.last_modified_at,
    status: visibleBadge(e, nowMs), verification: e.verification, revision: e.revision,
    revisions: (e.revisions || []).map((r) => ({ revision: r.revision, at: r.at, added: (r.added || []).length, removed: (r.removed || []).length }))
  };
}

const load = async (env, k) => { const v = await env.PATCHES.get(k, 'json'); return v; };

export async function latest(env, n = 10, nowMs = Date.now()) {
  const meta = (await load(env, 'meta')) || {};
  const index = ((await load(env, 'index')) || []).filter((e) => !e.removed).sort(sortEntries);
  return { last_success: meta.last_success || null, last_attempt: meta.last_attempt || null, items: index.slice(0, n).map((e) => publicEntry(e, nowMs)) };
}

export async function history(env, { q = '', cat = '', page = 1, per = 20 } = {}, nowMs = Date.now()) {
  const all = ((await load(env, 'index')) || []).filter((e) => !e.removed).sort(sortEntries);
  const needle = String(q || '').trim().toLowerCase().slice(0, 80);
  const rows = all.filter((e) => (!cat || e.category === cat) &&
    (!needle || `${e.title} ${e.category} ${e.summary} ${(e.details || []).join(' ')}`.toLowerCase().includes(needle)));
  per = Math.min(Math.max(+per || 20, 1), 50); page = Math.max(+page || 1, 1);
  const pages = Math.max(Math.ceil(rows.length / per), 1);
  const categories = [...new Set(all.map((e) => e.category))].sort();
  return { total: rows.length, page, pages, categories, items: rows.slice((page - 1) * per, page * per).map((e) => publicEntry(e, nowMs)) };
}

export async function status(env) {
  const meta = (await load(env, 'meta')) || null;
  const index = ((await load(env, 'index')) || []);
  return {
    configured: true, schedule: SCHEDULE, baseline_done: !!(meta && meta.baseline_done),
    last_attempt: meta ? meta.last_attempt || null : null, last_success: meta ? meta.last_success || null : null,
    entries: index.filter((e) => !e.removed).length,
    sources: SOURCES.map((s) => ({ id: s.id, name: s.name, ok: meta && meta.sources && meta.sources[s.id] ? meta.sources[s.id].ok : null, last_ok: meta && meta.sources && meta.sources[s.id] ? meta.sources[s.id].last_ok || null : null })),
    not_monitored: NOT_MONITORED
  };
}
