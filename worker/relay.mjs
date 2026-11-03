// NOMADS DMZ HUB - relay for callofduty.com. callofduty.com refuses requests from Cloudflare, so a small scheduled
// GitHub job (.github/workflows/cod-relay.yml) downloads the pages and posts them here (admin password needed).
// The pages are then fed to the normal COD card and patch-notes checkers in place of their own downloads.
import { discoverDocs } from './lib.mjs';
import { parseIndex, COD } from './codlatest.mjs';

export const RELAY_HOST = 'www.callofduty.com';
const MAX_DOCS = 8, MAX_PAGES = 12, MAX_PAGE_BYTES = 1500000, MAX_TOTAL_BYTES = 8000000;
const norm = (u) => { try { const x = new URL(String(u)); x.hash = ''; x.search = ''; return x.origin + x.pathname.replace(/\/+$/, ''); } catch (e) { return ''; } };

// which pages the job should download after it has the index page
export function relayPlan(indexHtml) {
  const s = String(indexHtml || '');
  const urls = [parseIndex(s), ...discoverDocs(s).slice(0, MAX_DOCS).map((p) => COD.base + p)].filter(Boolean).map(norm);
  return [...new Set(urls)];
}

// keep only callofduty.com patch note pages, within size limits -> { url: html }
export function cleanPages(pages) {
  const out = {}; let total = 0, n = 0;
  if (!pages || typeof pages !== 'object' || Array.isArray(pages)) return out;
  for (const [u, html] of Object.entries(pages)) {
    const key = norm(u);
    if (!key || typeof html !== 'string' || n >= MAX_PAGES) continue;
    const x = new URL(key);
    if (x.protocol !== 'https:' || x.hostname !== RELAY_HOST || !/^\/patchnotes(\/|$)/.test(x.pathname)) continue;
    if (html.length > MAX_PAGE_BYTES || total + html.length > MAX_TOTAL_BYTES) continue;
    out[key] = html; total += html.length; n++;
  }
  return out;
}

// a fetch that answers callofduty.com addresses from the relayed pages and sends everything else (Trello) to the real fetch
export function relayFetch(pages, realFetch = fetch) {
  return async (url, init) => {
    let host = ''; try { host = new URL(String(url)).hostname; } catch (e) { /* not a URL */ }
    if (host === RELAY_HOST) {
      const html = pages[norm(url)];
      return html === undefined ? new Response('Not in the relayed pages', { status: 404 }) : new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return realFetch(url, init);
  };
}
