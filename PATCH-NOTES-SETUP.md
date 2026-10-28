# DMZ Patch Notes: one-time setup

The site files and the patch notes checker are in this repo. The checker is a small Cloudflare Worker that runs by itself 4 times a day
(00:00, 06:00, 12:00 and 18:00 UTC; that is 11:00 am, 5:00 pm, 11:00 pm and 5:00 am in Melbourne while daylight saving is on, and one hour earlier when it is off).
Everything below is free.

## Step 1: upload and change the deploy command (about 3 minutes)
1. Upload the new files to GitHub, replacing the old ones. Make sure `wrangler.jsonc`, `.assetsignore` and the `worker` folder are in the repo at the top level.
   (If `.assetsignore` is missing because your computer hides dot-files, on GitHub use Add file > Create new file, name it `.assetsignore`, and paste in the lines from the copy of this file's list below.)
2. In Cloudflare open Workers & Pages > `nomads-dmz` > Settings > Build. Click Edit on **Deploy command** and change it to exactly:
   `npx wrangler deploy`
   Save. Leave Build command empty.
3. Let it build. The site works as before. The patch notes page will say tracking is being set up until step 2.

## Step 2: create the storage (KV) and connect it (about 5 minutes)
1. Cloudflare dashboard > Storage & databases > KV > Create a namespace. Name it `nomads-dmz-patches`. Copy its **ID**.
2. On GitHub open `wrangler.jsonc`, click the pencil, find the three commented lines at the bottom, remove the `//` at the start of those lines, and replace `PASTE-YOUR-KV-ID-HERE` with the ID. Commit. Cloudflare redeploys by itself.

## Step 3: set the admin password (optional, 2 minutes)
Workers & Pages > `nomads-dmz` > Settings > Variables and Secrets > Add. Type: **Secret**. Name: `ADMIN_TOKEN`. Value: a long password (12+ characters). Deploy.
Without this, the manual "Check now" button stays switched off, and the automatic checks still work.

## Step 4: first check
Open `https://nomaddmzhub.com/patch-admin/`, type the password, press **Check now**. The first check records the existing patch notes as the starting point (nothing is marked NEW). From then on, genuinely new or edited DMZ notes get NEW or UPDATED badges for 7 days.
In Workers & Pages > `nomads-dmz` > Settings > Trigger Events you should see the cron `0 0,6,12,18 * * *`.

## Lines for `.assetsignore`
worker/
tests/
wrangler.jsonc
.assetsignore
PATCH-NOTES-SETUP.md
