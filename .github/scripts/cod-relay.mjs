// NOMADS DMZ HUB - GitHub relay for callofduty.com (see .github/workflows/cod-relay.yml).
// 1. download callofduty.com/patchnotes  2. ask the site which posts it needs  3. download them  4. send them to the site.
// Needs Node 18+ (built-in fetch). The ADMIN_TOKEN secret must match the Worker's ADMIN_TOKEN.
const SITE = (process.env.SITE_URL || 'https://nomaddmzhub.com').replace(/\/+$/, '');
const TOKEN = (process.env.ADMIN_TOKEN || '').trim();
const INDEX = 'https://www.callofduty.com/patchnotes';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

async function get(url) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000), headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const t = await r.text(); if (t.length < 500) throw new Error('page too short (' + t.length + ' characters)');
      return t;
    } catch (e) { if (attempt === 2) throw new Error(url + ': ' + e.message); await new Promise((res) => setTimeout(res, 3000)); }
  }
}
async function post(path, body) {
  const r = await fetch(SITE + path, { method: 'POST', signal: AbortSignal.timeout(60000), headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json', 'user-agent': 'NomadsDMZHub-GitHubRelay/1.0' }, body: JSON.stringify(body) });
  const text = await r.text();
  if (r.status === 403) throw new Error('The site said the password is wrong. The ADMIN_TOKEN secret in GitHub must match the one in Cloudflare.');
  if (!r.ok) throw new Error(path + ' answered HTTP ' + r.status + ': ' + text.slice(0, 300));
  return JSON.parse(text);
}
async function main() {
  if (!TOKEN) throw new Error('The ADMIN_TOKEN secret is not set in GitHub (Settings > Secrets and variables > Actions).');
  const index = await get(INDEX);
  console.log('Read callofduty.com/patchnotes (' + index.length + ' characters).');
  const plan = await post('/api/dmz-patches/admin/relay-plan', { index });
  if (!plan.urls || !plan.urls.length) throw new Error('No Modern Warfare 4 posts were found on the patch notes page. The page layout may have changed.');
  const pages = { [INDEX]: index };
  for (const url of plan.urls) {
    try { pages[url] = await get(url); console.log('Read ' + url); }
    catch (e) { console.log('Could not read ' + e.message); }
  }
  const res = await post('/api/dmz-patches/admin/relay', { pages });
  const cod = res.cod || {};
  console.log('COD patch notes card: ' + (cod.ok ? (cod.changed ? 'updated to "' + (cod.post && cod.post.title) + '"' : 'no change') : 'FAILED - ' + cod.error));
  const pn = res.patchnotes || {};
  const src = pn.sources && pn.sources['cod-patchnotes'];
  console.log('DMZ patch notes check: ' + (pn.skipped ? pn.skipped : src ? (src.ok ? 'ok, ' + src.docs_read + ' pages read, ' + (pn.added || 0) + ' added, ' + (pn.updated || 0) + ' updated' : 'FAILED - ' + src.error) : (pn.error || 'no report')));
  if (!cod.ok) process.exitCode = 1;
}
main().catch((e) => { console.error('Relay failed: ' + e.message); process.exitCode = 1; });
