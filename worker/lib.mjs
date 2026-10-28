// NOMADS DMZ HUB - patch notes helpers (pure functions, no network, no storage).
// Everything here is unit-tested in tests/ with sample pages.

export const CATEGORIES = [
  'Gameplay', 'Weapons and balancing', 'Gunsmith and attachments', 'AI and enemy behaviour',
  'Lieutenants and Commanders', 'Missions and objectives', 'Contracts and Dynamic Ops', 'Loot and economy',
  'Crafting and recipes', 'Upgrades', 'Operator Traits', 'Operator Prestige', 'Vehicles', 'Map and locations',
  'Extraction mechanics', 'Inventory and stash', 'Bug fixes', 'Known issues', 'Performance and stability', 'Server updates'
];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&ndash;|&mdash;/g, '-').replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)));
}

export const clean = (s) => decodeEntities(s).replace(/\s+/g, ' ').trim();
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ---------- HTML -> ordered blocks (headings and bullets) ----------
export function htmlToBlocks(html) {
  let h = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|template|button)\b[\s\S]*?<\/\1>/gi, '');
  h = h.replace(/<h([1-6])\b[^>]*>/gi, (m, l) => `\n@@H${l}@@`)
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n@@LI@@')
    .replace(/<p\b[^>]*>/gi, '\n@@P@@')
    .replace(/<\/(p|li|ul|ol|div|section|article|tr|table|main)>/gi, '\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<(td|th)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '');
  const blocks = [];
  for (const raw of h.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = /^@@H([1-6])@@(.*)$/.exec(line))) { const t = clean(m[2]); if (t) blocks.push({ t: 'h', l: +m[1], text: t }); }
    else if ((m = /^@@LI@@(.*)$/.exec(line))) blocks.push({ t: 'li', text: clean(m[1]) });
    else if ((m = /^@@P@@(.*)$/.exec(line))) {
      const t = clean(m[1]); const prev = blocks[blocks.length - 1];
      // a paragraph directly inside an otherwise empty list item is the bullet itself
      if (prev && prev.t === 'li' && !prev.text) prev.text = t; else if (t) blocks.push({ t: 'p', text: t });
    } else {
      const t = clean(line); const prev = blocks[blocks.length - 1];
      if (t && prev && prev.t === 'li') prev.text = (prev.text + ' ' + t).trim();
      else if (t && prev && prev.t === 'h' && false) prev.text += ' ' + t;
    }
  }
  return blocks.filter((b) => b.text);
}

export function extractMeta(html, url) {
  const get = (re) => { const m = re.exec(html); return m ? clean(m[1]) : null; };
  const title = get(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || get(/<title[^>]*>([\s\S]*?)<\/title>/i) || get(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || url;
  let published = get(/property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i)
    || get(/"datePublished"\s*:\s*"([^"]+)"/i);
  if (published && Number.isNaN(Date.parse(published))) published = null;
  const um = /\/patchnotes\/(\d{4})\//.exec(url || '');
  return { title: title.replace(/\s*\|.*$/, ''), published, year: um ? um[1] : null };
}

// "October 21", "Oct 21st, 2026" -> "2026-10-21"
export function parseHeadingDate(text, fallbackYear) {
  const m = /^\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\s*(?:[-:(].*)?$/i.exec(text || '');
  if (!m) return null;
  const mon = MONTHS.indexOf(m[1].toLowerCase()) + 1; const day = +m[2]; const year = m[3] || fallbackYear;
  if (!year || day < 1 || day > 31) return null;
  return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ---------- DMZ relevance ----------
const MODE_DMZ = /\bDMZ\b/i;
const MODE_OTHER = /\b(multiplayer|warzone|zombies|campaign|ranked|search\s*(&|and)\s*destroy|core\s*6v6|create[- ]a[- ]class|killstreaks?|scorestreaks?|perks?)\b/i;
const DMZ_ONLY_HINT = /\b(hajin|exclusion zone|exfil|extraction|lieutenants?|dynamic ops?|3d printer|fob|weapon manual|stash|operator traits?|prestige master|dog tags?)\b/i;

// returns 'yes' (confirmed DMZ), 'review' (maybe) or 'no'
export function dmzScope(path, text) {
  const heads = path || [];
  let nearest = null;
  for (let i = heads.length - 1; i >= 0; i--) {
    if (MODE_DMZ.test(heads[i])) { nearest = 'dmz'; break; }
    if (MODE_OTHER.test(heads[i]) && !/\b(bug fixes?|general|ui)\b/i.test(heads[i])) { nearest = 'other'; break; }
  }
  if (nearest === 'dmz') return 'yes';
  if (MODE_DMZ.test(text)) return 'yes';             // the note itself says it applies to DMZ
  if (nearest === 'other') return 'no';
  return DMZ_ONLY_HINT.test(text) ? 'review' : 'no';  // shared section: only flag what looks DMZ-specific
}

// ---------- categories ----------
const TOPIC_RULES = [
  ['Lieutenants and Commanders', /\b(lieutenants?|commanders?|boss(es)?)\b/i],
  ['Gunsmith and attachments', /\b(gunsmith|attachments?|apex|optic|muzzle|barrel|underbarrel|magazine|rear grip)\b/i],
  ['Crafting and recipes', /\b(3d printer|crafting|recipes?|ingredients?|printing)\b/i],
  ['Upgrades', /\b(fob|upgrades?)\b/i],
  ['Operator Prestige', /\bprestige\b/i],
  ['Operator Traits', /\b(operator traits?|traits?)\b/i],
  ['Contracts and Dynamic Ops', /\b(dynamic ops?|contracts?|bounties|bounty|hunts?)\b/i],
  ['Missions and objectives', /\b(missions?|objectives?|story|quests?)\b/i],
  ['Extraction mechanics', /\b(exfils?|extraction|extract)\b/i],
  ['Inventory and stash', /\b(stash|inventory|backpack|vendors?|bank)\b/i],
  ['Loot and economy', /\b(loot|economy|dmz cash|prices?|rewards?|xp)\b/i],
  ['Vehicles', /\b(vehicles?|helicopters?|boats?|trucks?|atv)\b/i],
  ['Map and locations', /\b(map|hajin|location|strongholds?|safe house|spawn)\b/i],
  ['AI and enemy behaviour', /\b(ai|enemies|enemy|combatants?|guards?)\b/i],
  ['Weapons and balancing', /\b(weapons?|damage|recoil|rate of fire|balanc|ttk|ammo|rifle|smg|shotgun|sniper|pistol|lmg)\b/i]
];

export function categorize(path, text) {
  const heads = (path || []).join(' > ');
  if (/known issues?/i.test(heads)) return 'Known issues';
  if (/\bservers?\b/i.test(heads)) return 'Server updates';
  if (/\b(stability|performance)\b/i.test(heads) || /\b(crash(es|ed|ing)?|stability|frame ?rate|memory leak|performance|latency|disconnect)\b/i.test(text)) return 'Performance and stability';
  for (const [cat, re] of TOPIC_RULES) if (re.test(text)) return cat;
  for (const [cat, re] of TOPIC_RULES) if (re.test(heads) && cat !== 'Map and locations') return cat;
  if (/\b(bug|fix)/i.test(heads) || /^\s*(fixed|resolved|addressed)\b/i.test(text)) return 'Bug fixes';
  return 'Gameplay';
}

// ---------- hashing ----------
export async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}
export const normText = (s) => String(s).toLowerCase().replace(/[^a-z0-9%.+ -]+/g, ' ').replace(/\s+/g, ' ').trim();

// ---------- parse one official patch notes page ----------
export function parseDoc(html, url) {
  const meta = extractMeta(html, url);
  const blocks = htmlToBlocks(html);
  const items = []; const held = []; let excluded = 0; let dateSections = 0;
  let stack = []; let dateKey = meta.published ? meta.published.slice(0, 10) : null;
  for (const b of blocks) {
    if (b.t === 'h') {
      const d = parseHeadingDate(b.text, meta.year);
      if (d) { dateKey = d; stack = []; dateSections++; continue; }
      while (stack.length && stack[stack.length - 1].l >= b.l) stack.pop();
      stack.push({ l: b.l, text: b.text });
      continue;
    }
    if (b.t !== 'li' || b.text.length < 8) continue;
    const path = stack.map((s) => s.text);
    const scope = dmzScope(path, b.text);
    const rec = { date: dateKey, path, text: b.text.slice(0, 600), category: categorize(path, b.text) };
    if (scope === 'yes') items.push(rec);
    else if (scope === 'review') held.push({ ...rec, reason: 'Looks DMZ-related but the note does not say so' });
    else excluded++;
  }
  return { meta, items, held, excluded, dateSections, blockCount: blocks.length };
}

const shortSummary = (details) => {
  const first = details[0] || '';
  const s = first.length > 200 ? first.slice(0, 197).replace(/\s+\S*$/, '') + '...' : first;
  return details.length > 1 ? `${s} (+${details.length - 1} more)` : s;
};

export async function buildEntries(docId, parsed, source) {
  const groups = new Map();
  for (const it of parsed.items) {
    const key = `${it.date || 'undated'}|${it.category}`;
    if (!groups.has(key)) groups.set(key, { date: it.date, category: it.category, details: [] });
    const g = groups.get(key); if (!g.details.includes(it.text)) g.details.push(it.text);
  }
  const out = [];
  for (const g of groups.values()) {
    const details = g.details.slice(0, 60);
    const nice = g.date ? new Date(g.date + 'T00:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'long', timeZone: 'UTC' }) : null;
    out.push({
      id: `${docId}:${g.date || 'undated'}:${slug(g.category)}`,
      title: nice ? `${parsed.meta.title} (${nice})` : parsed.meta.title,
      game: 'MW4 DMZ', category: g.category, summary: shortSummary(details), details,
      source_name: source.name, source_url: source.page || source.url,
      published_at: g.date ? `${g.date}T00:00:00Z` : null,
      date_key: g.date, hash: await sha(details.map(normText).join('\n')), verification: 'OFFICIAL'
    });
  }
  return out;
}

// ---------- compare against what is stored ----------
// prev: stored doc ({entries:{id:entry}}) or null. baseline: true on the very first run.
export function reconcile(prev, fresh, now, baseline) {
  const entries = {}; const stats = { added: 0, updated: 0, removed: 0, unchanged: 0 };
  const prevEntries = prev ? prev.entries : {};
  const knownDates = new Set(Object.values(prevEntries).map((e) => e.date_key));
  const seen = new Set();
  for (const f of fresh) {
    seen.add(f.id);
    const p = prevEntries[f.id];
    if (!p) {
      const newDate = !knownDates.has(f.date_key);
      const status = baseline ? null : (prev && !newDate ? 'UPDATED' : 'NEW');
      entries[f.id] = { ...f, status, revision: 1, first_detected_at: now, last_modified_at: now, revisions: [] };
      stats.added++;
    } else if (p.hash !== f.hash || p.removed) {
      const before = new Set(p.details), after = new Set(f.details);
      const rev = { revision: p.revision + 1, at: now, added: f.details.filter((d) => !before.has(d)).slice(0, 10).map((d) => d.slice(0, 200)), removed: p.details.filter((d) => !after.has(d)).slice(0, 10).map((d) => d.slice(0, 200)) };
      entries[f.id] = { ...p, ...f, status: baseline ? p.status : 'UPDATED', revision: p.revision + 1, first_detected_at: p.first_detected_at, last_modified_at: now, removed: false, removed_at: null, revisions: [rev, ...(p.revisions || [])].slice(0, 5) };
      stats.updated++;
    } else { entries[f.id] = p; stats.unchanged++; }
  }
  for (const [id, p] of Object.entries(prevEntries)) {
    if (seen.has(id)) continue;
    entries[id] = p.removed ? p : { ...p, removed: true, removed_at: now, last_modified_at: now };
    if (!p.removed) stats.removed++;
  }
  return { entries, stats, changed: stats.added + stats.updated + stats.removed > 0 };
}

// ---------- Trello (official live issues board) ----------
const RESOLVED_LIST = /\b(fixed|resolved|completed|complete|done|released|live)\b/i;
export function parseTrello(board) {
  if (!board || !Array.isArray(board.cards) || !Array.isArray(board.lists)) throw new Error('Unexpected Trello data');
  const lists = Object.fromEntries(board.lists.map((l) => [l.id, l.name]));
  const labels = (c) => (c.labels || []).map((l) => l.name || l.color || '').filter(Boolean);
  const out = []; let excluded = 0;
  for (const c of board.cards) {
    if (c.closed) continue;
    const listName = lists[c.idList] || '';
    const hay = `${c.name} ${c.desc || ''} ${labels(c).join(' ')} ${listName}`;
    if (!/\bDMZ\b/i.test(hay)) { excluded++; continue; }
    const resolved = RESOLVED_LIST.test(listName);
    const created = /^[0-9a-f]{8}/i.test(c.id) ? new Date(parseInt(c.id.slice(0, 8), 16) * 1000).toISOString() : null;
    const details = [c.name, ...String(c.desc || '').split(/\n+/).map(clean).filter(Boolean)].slice(0, 8).map((d) => d.slice(0, 300));
    out.push({ card: c.id, title: clean(c.name).slice(0, 160), listName, resolved, created, modified: c.dateLastActivity || null, details });
  }
  return { cards: out, excluded };
}

export async function trelloEntries(parsed, source) {
  const out = [];
  for (const c of parsed.cards) {
    out.push({
      id: `trello:${c.card}`, title: c.title, game: 'MW4 DMZ', category: c.resolved ? 'Bug fixes' : 'Known issues',
      summary: shortSummary(c.details.slice(1).length ? c.details.slice(1) : c.details), details: c.details,
      source_name: source.name, source_url: source.page, published_at: c.created, date_key: c.created ? c.created.slice(0, 10) : null,
      hash: await sha(c.title + '|' + c.listName + '|' + c.details.join('\n')), verification: 'OFFICIAL', tracker_state: c.resolved ? 'RESOLVED' : 'OPEN'
    });
  }
  return out;
}

// like reconcile(), but a card moving to a fixed/resolved list becomes RESOLVED
export function reconcileTrello(prev, fresh, now, baseline) {
  const r = reconcile(prev, fresh, now, baseline);
  const prevEntries = prev ? prev.entries : {};
  for (const f of fresh) {
    const e = r.entries[f.id]; const p = prevEntries[f.id];
    if (!e) continue;
    if (f.tracker_state === 'RESOLVED') {
      if (p && p.tracker_state !== 'RESOLVED') { e.status = baseline ? null : 'RESOLVED'; e.last_modified_at = now; }
      else if (!p) e.status = baseline ? null : 'RESOLVED';
      else e.status = p.status;
    } else if (!p) e.status = baseline ? null : 'NEW';
    e.tracker_state = f.tracker_state;
  }
  return r;
}

// find the Modern Warfare 4 patch note pages listed on the official index page
export function discoverDocs(indexHtml) {
  const seen = new Map();
  const re = /\/patchnotes\/(\d{4})\/(\d{2})\/([a-z0-9-]*modern-warfare-4[a-z0-9-]*)/gi;
  let m;
  while ((m = re.exec(indexHtml))) { const path = `/patchnotes/${m[1]}/${m[2]}/${m[3]}`; if (!seen.has(path)) seen.set(path, `${m[1]}${m[2]}`); }
  return [...seen.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([p]) => p);
}

// badge shows only while an update is fresh
export const BADGE_DAYS = 7;
export function visibleBadge(entry, nowMs) {
  if (!entry.status) return null;
  const t = Date.parse(entry.last_modified_at || entry.first_detected_at || '');
  return Number.isNaN(t) || nowMs - t > BADGE_DAYS * 86400000 ? null : entry.status;
}

export const sortEntries = (a, b) =>
  String(b.published_at || b.first_detected_at).localeCompare(String(a.published_at || a.first_detected_at))
  || String(b.last_modified_at).localeCompare(String(a.last_modified_at));
