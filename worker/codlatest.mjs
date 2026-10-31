// NOMADS DMZ HUB - newest official Modern Warfare 4 patch notes post for the home page card.
// Reads the public list at callofduty.com/patchnotes, takes the newest MW4 post, then reads that post's title, picture and date.
export const COD = { index: 'https://www.callofduty.com/patchnotes', base: 'https://www.callofduty.com', imgHost: 'imgs.callofduty.com' };
const UA = 'Mozilla/5.0 (compatible; NomadsDMZHub-PatchCard/1.0; +https://nomaddmzhub.com)';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const decode = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// the first (newest) Modern Warfare 4 post listed on the patch notes page -> absolute address, or null
export function parseIndex(html) {
  const re = /\/patchnotes\/(\d{4})\/(\d{2})\/([a-z0-9-]+)/g; let m; const s = String(html || '');
  while ((m = re.exec(s))) if (/modern-warfare-4|(^|-)mw4(-|$)/.test(m[3])) return `${COD.base}/patchnotes/${m[1]}/${m[2]}/${m[3]}`;
  return null;
}
const meta = (html, prop) => {
  const a = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html);
  const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i').exec(html);
  return decode((a || b || [])[1] || '');
};
// title, picture and the date shown at the top of the post (the date of its newest entry)
export function parsePost(html, url) {
  const s = String(html || ''); const title = meta(s, 'og:title') || decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(s) || [])[1]);
  if (!title) return null;
  let image = meta(s, 'og:image'); try { const u = new URL(image); if (u.protocol !== 'https:' || u.hostname !== COD.imgHost || !/\.(webp|jpe?g|png)$/i.test(u.pathname)) image = null; } catch (e) { image = null; }
  const h1 = /<h1[\s\S]*?<\/h1>/i.exec(s); const after = h1 ? s.slice(h1.index + h1[0].length, h1.index + h1[0].length + 3000) : s.slice(0, 6000);
  const d = new RegExp(`(${MONTHS.join('|')})\\s+(\\d{1,2}),\\s+(\\d{4})`, 'i').exec(after.replace(/<[^>]+>/g, ' '));
  let updated = null; if (d) { const mo = MONTHS.indexOf(d[1].toLowerCase()) + 1; updated = `${d[3]}-${String(mo).padStart(2, '0')}-${String(+d[2]).padStart(2, '0')}`; }
  const short = title.replace(/^Call of Duty:\s*/i, '').replace(/^Modern Warfare 4\s*/i, '').trim() || title;
  return { url, title: title.slice(0, 140), short: short.slice(0, 100), image, updated };
}

async function get(f, url, ms) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await f(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.text(); }
  finally { clearTimeout(t); }
}

export async function refreshCodLatest(env, deps = {}) {
  const f = deps.fetch || fetch, now = (deps.now ? deps.now() : new Date()).toISOString(), ms = deps.timeoutMs || 15000;
  if (!env || !env.PATCHES) return { ok: false, error: 'Storage (KV) is not connected yet.' };
  try {
    const idx = await get(f, COD.index, ms); const url = parseIndex(idx);
    if (!url) throw new Error('No Modern Warfare 4 post found on the patch notes page');
    const post = parsePost(await get(f, url, ms), url);
    if (!post) throw new Error('Could not read the post');
    const prev = await env.PATCHES.get('cod-latest', 'json');
    const changed = !prev || !prev.post || JSON.stringify(prev.post) !== JSON.stringify(post);
    if (changed) await env.PATCHES.put('cod-latest', JSON.stringify({ post, checked_at: now }));
    return { ok: true, changed, post };
  } catch (e) {
    const msg = e && (e.name === 'AbortError' || /aborted/i.test(String(e.message))) ? 'Timed out waiting for callofduty.com' : String((e && e.message) || e).replace(/https?:\/\/\S+/g, '[url]').slice(0, 160);
    return { ok: false, error: msg };   // the post saved last time is kept
  }
}

export async function codLatest(env) {
  const d = await env.PATCHES.get('cod-latest', 'json');
  return { post: d && d.post ? d.post : null, checked_at: d ? d.checked_at : null };
}
