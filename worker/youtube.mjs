// NOMADS DMZ HUB - newest YouTube upload for the home page banner (public Atom feed, no key needed).
export const YT = {
  handle: '@Deckard.Pain.',
  channelId: 'UC-wo5TlBXUwLgeYg9NMNNLw',
  feed: 'https://www.youtube.com/feeds/videos.xml?channel_id=UC-wo5TlBXUwLgeYg9NMNNLw',
  shorts: 'https://www.youtube.com/@Deckard.Pain./shorts'
};
const UA = 'NomadsDMZHub-VideoBanner/1.0 (+https://nomaddmzhub.com)';
const decode = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').trim();

// first <entry> of the channel feed -> {id, title, published}
export function parseFeed(xml) {
  const m = /<entry>([\s\S]*?)<\/entry>/.exec(String(xml || ''));
  if (!m) return null;
  const e = m[1];
  const id = (/<yt:videoId>([\w-]{11})<\/yt:videoId>/.exec(e) || /<id>yt:video:([\w-]{11})<\/id>/.exec(e) || [])[1];
  const title = (/<title>([\s\S]*?)<\/title>/.exec(e) || [])[1];
  const published = (/<published>([^<]+)<\/published>/.exec(e) || [])[1] || null;
  if (!id || !title) return null;
  return { id, title: decode(title).slice(0, 140), published: published && !Number.isNaN(Date.parse(published)) ? published : null };
}

export async function refreshYoutube(env, deps = {}) {
  const f = deps.fetch || fetch, now = (deps.now ? deps.now() : new Date()).toISOString();
  if (!env || !env.PATCHES) return { ok: false, error: 'Storage (KV) is not connected yet.' };
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), deps.timeoutMs || 15000);
  try {
    const r = await f(YT.feed, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': UA, accept: 'application/atom+xml,text/xml' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const xml = await r.text();
    if (xml.length < 200) throw new Error('Empty or very short response');
    const v = parseFeed(xml);
    if (!v) throw new Error('No video found in the feed');
    const prev = await env.PATCHES.get('youtube', 'json');
    const changed = !prev || !prev.video || prev.video.id !== v.id || prev.video.title !== v.title;
    if (changed) await env.PATCHES.put('youtube', JSON.stringify({ video: v, checked_at: now }));
    return { ok: true, changed, video: v };
  } catch (e) {
    const msg = e && (e.name === 'AbortError' || /aborted/i.test(String(e.message))) ? 'Timed out waiting for YouTube' : String((e && e.message) || e).replace(/https?:\/\/\S+/g, '[url]').slice(0, 160);
    return { ok: false, error: msg };   // the previously saved video is kept
  } finally { clearTimeout(timer); }
}

export async function latestVideo(env) {
  const d = await env.PATCHES.get('youtube', 'json');
  return { video: d && d.video ? d.video : null, checked_at: d ? d.checked_at : null, fallback: YT.shorts };
}
