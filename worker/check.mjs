// NOMADS DMZ HUB - patch notes checker. Runs from the Cron Trigger (every 6 hours) or the admin "Check now" button.
import { discoverDocs, parseDoc, buildEntries, reconcile, parseTrello, trelloEntries, reconcileTrello, slug, sortEntries } from './lib.mjs';

export const SOURCES = [
  { id: 'cod-patchnotes', name: 'Official Call of Duty Patch Notes', page: 'https://www.callofduty.com/patchnotes', kind: 'patchnotes' },
  { id: 'mw4-trello', name: 'Official Modern Warfare 4 Trello', page: 'https://trello.com/b/tocA5kKG', json: 'https://trello.com/b/tocA5kKG.json', kind: 'trello' }
];
// Not monitored: X (@CODUpdates) has no free official read access and scraping it is against its rules.
export const NOT_MONITORED = [{ name: 'X (@CODUpdates)', reason: 'No free official way to read posts, so it is not monitored.' }];

const UA = 'NomadsDMZHub-PatchTracker/1.0 (+https://nomaddmzhub.com)';
const MAX_DOCS = 8;          // newest Modern Warfare 4 patch note pages to read each run (keeps requests well under the free limit)
const MAX_INDEX = 1500;
const MAX_INDEX_BYTES = 900000;

async function fetchText(f, url, minLen = 200) {
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await f(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const txt = await r.text();
    if (!txt || txt.length < minLen) throw new Error('Empty or very short response');
    if (txt.length > 4000000) throw new Error('Response too large');
    return txt;
  } finally { clearTimeout(timer); }
}

const safeMsg = (e) => String((e && e.message) || e).replace(/https?:\/\/\S+/g, '[url]').slice(0, 200);
const jget = async (env, k) => { try { return await env.PATCHES.get(k, 'json'); } catch (e) { throw new Error('Storage read failed: ' + safeMsg(e)); } };
const jput = async (env, k, v) => { try { await env.PATCHES.put(k, JSON.stringify(v)); } catch (e) { throw new Error('Storage write failed: ' + safeMsg(e)); } };

export async function runCheck(env, trigger, deps = {}) {
  const f = deps.fetch || fetch;
  const now = (deps.now ? deps.now() : new Date()).toISOString();
  if (!env || !env.PATCHES) return { ok: false, error: 'Storage (KV) is not connected yet.' };
  try {
    const lock = await env.PATCHES.get('lock');
    if (lock && Date.now() - Date.parse(lock) < 240000) return { ok: true, skipped: 'Another check is already running.' };
    await env.PATCHES.put('lock', now, { expirationTtl: 300 });
  } catch (e) { return { ok: false, error: 'Storage unavailable: ' + safeMsg(e) }; }
  const report = { ok: true, trigger, at: now, sources: {}, docs: {}, added: 0, updated: 0, removed: 0, held: 0, excluded: 0 };
  try {
    let meta = (await jget(env, 'meta')) || { baseline_done: false, runs: 0, sources: {}, errors: [] };
    const baseline = !meta.baseline_done;
    const index = (await jget(env, 'index')) || [];
    const oldReview = (await jget(env, 'review')) || [];
    let review = oldReview;
    const byId = new Map(index.map((e) => [e.id, e]));
    const writes = []; let anyOk = false; let changed = false;
    const logError = (source, e) => { meta.errors = [{ at: now, source, message: safeMsg(e) }, ...(meta.errors || [])].slice(0, 20); };

    const applyEntries = (prefix, entries) => {
      for (const id of [...byId.keys()]) if (id.startsWith(prefix)) byId.delete(id);
      for (const e of Object.values(entries)) byId.set(e.id, e);
    };

    // ---- source 1: official patch notes pages ----
    const s1 = SOURCES[0];
    try {
      const indexHtml = await fetchText(f, s1.page);
      const paths = discoverDocs(indexHtml);
      if (!paths.length) throw new Error('No Modern Warfare 4 patch note pages were found on the index page. The page layout may have changed.');
      let okDocs = 0; const docErrors = [];
      for (const path of paths.slice(0, MAX_DOCS)) {
        const url = 'https://www.callofduty.com' + path; const docId = slug(path.split('/').pop());
        try {
          const html = await fetchText(f, url);
          const parsed = parseDoc(html, url);
          if (parsed.blockCount < 5) throw new Error('Page content looked empty or malformed');
          const prev = await jget(env, 'doc:' + docId);
          const fresh = await buildEntries(docId, parsed, { name: s1.name, page: url });
          const prevActive = prev ? Object.values(prev.entries).filter((e) => !e.removed).length : 0;
          if (prevActive > 0 && fresh.length === 0) throw new Error('No DMZ content found where there was some before. Kept the previous version.');
          if (prev && prev.block_count && parsed.blockCount < prev.block_count * 0.4) throw new Error('Page shrank sharply. Kept the previous version.');
          const r = reconcile(prev, fresh, now, baseline);
          report.added += r.stats.added; report.updated += r.stats.updated; report.removed += r.stats.removed;
          report.excluded += parsed.excluded; report.held += parsed.held.length;
          report.docs[docId] = { entries: fresh.length, held: parsed.held.length, excluded: parsed.excluded, date_sections: parsed.dateSections, ...r.stats };
          if (r.changed || !prev) {
            writes.push(['doc:' + docId, { id: docId, url, title: parsed.meta.title, published_at: parsed.meta.published, block_count: parsed.blockCount, checked_at: now, entries: r.entries }]);
            changed = true;
          }
          applyEntries(docId + ':', r.entries);
          review = review.filter((x) => x.doc !== docId).concat(parsed.held.map((h) => { const old = oldReview.find((o) => o.doc === docId && o.text === h.text && o.date === h.date); return { doc: docId, url, ...h, seen_at: old ? old.seen_at : now }; }));
          okDocs++;
        } catch (e) { docErrors.push(`${path.split('/').pop()}: ${safeMsg(e)}`); logError(s1.id, e); }
      }
      if (!okDocs) throw new Error('None of the patch note pages could be read. ' + docErrors[0]);
      anyOk = true;
      meta.sources[s1.id] = { name: s1.name, ok: true, last_ok: now, last_error: docErrors.length ? docErrors.join(' | ').slice(0, 300) : null, docs_read: okDocs };
      report.sources[s1.id] = { ok: true, docs_read: okDocs, problems: docErrors };
    } catch (e) {
      logError(s1.id, e);
      meta.sources[s1.id] = { ...(meta.sources[s1.id] || { name: s1.name }), name: s1.name, ok: false, last_error: safeMsg(e), last_error_at: now };
      report.sources[s1.id] = { ok: false, error: safeMsg(e) };
    }

    // ---- source 2: official Modern Warfare 4 Trello board ----
    const s2 = SOURCES[1];
    try {
      const board = JSON.parse(await fetchText(f, s2.json, 20));
      const parsed = parseTrello(board);
      const prev = await jget(env, 'doc:trello');
      const fresh = await trelloEntries(parsed, s2);
      const r = reconcileTrello(prev, fresh, now, baseline);
      report.added += r.stats.added; report.updated += r.stats.updated; report.removed += r.stats.removed; report.excluded += parsed.excluded;
      report.docs.trello = { entries: fresh.length, excluded: parsed.excluded, ...r.stats };
      if (r.changed || !prev) { writes.push(['doc:trello', { id: 'trello', url: s2.page, title: s2.name, checked_at: now, entries: r.entries }]); changed = true; }
      applyEntries('trello:', r.entries);
      anyOk = true;
      meta.sources[s2.id] = { name: s2.name, ok: true, last_ok: now, last_error: null };
      report.sources[s2.id] = { ok: true, cards_dmz: fresh.length };
    } catch (e) {
      logError(s2.id, e);
      meta.sources[s2.id] = { ...(meta.sources[s2.id] || { name: s2.name }), name: s2.name, ok: false, last_error: safeMsg(e), last_error_at: now };
      report.sources[s2.id] = { ok: false, error: safeMsg(e) };
    }

    // ---- save: documents first, then the feed, then the status ----
    let all = [...byId.values()].sort(sortEntries).slice(0, MAX_INDEX);
    if (JSON.stringify(all).length > MAX_INDEX_BYTES) all = all.map((e, i) => (i > 150 ? { ...e, details: e.details.slice(0, 8) } : e));
    meta.last_attempt = now; meta.runs = (meta.runs || 0) + 1;
    if (anyOk) {
      meta.last_success = now;
      if (!meta.baseline_done) { meta.baseline_done = true; meta.baseline_at = now; }
    }
    try {
      for (const [k, v] of writes) await jput(env, k, v);
      if (changed || !index.length) await jput(env, 'index', all);
      if (JSON.stringify(review.slice(0, 200)) !== JSON.stringify(oldReview)) await jput(env, 'review', review.slice(0, 200));
      await jput(env, 'meta', meta);
    } catch (e) {
      report.ok = false; report.error = safeMsg(e);   // nothing half-saved is exposed: the feed is only replaced after the documents are written
    }
    report.baseline = baseline; report.entries = all.length; report.changed = changed;
    return report;
  } catch (e) {
    report.ok = false; report.error = safeMsg(e);
    return report;
  } finally { try { await env.PATCHES.delete('lock'); } catch (e) { /* lock expires on its own */ } }
}
