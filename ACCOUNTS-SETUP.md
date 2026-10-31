# Accounts setup (Log in with Discord)

Until you finish these steps the site works exactly as before: the "Log in with Discord" button simply does not appear.
You do these once. Nothing here costs money.

## 1. Make a Discord application
1. Go to https://discord.com/developers/applications and press **New Application**. Name it, for example, `NOMADS DMZ HUB`.
2. Open **OAuth2** in the left menu.
3. Copy the **Client ID** and keep it somewhere safe.
4. Press **Reset Secret** and copy the **Client Secret**. Discord only shows it once.
5. Under **Redirects** press **Add Redirect** and type exactly: `https://nomaddmzhub.com/auth/callback`, then **Save Changes**.
You do not need a bot. The site only asks Discord who the person is (their name, picture and Discord number).

## 2. Make the database
1. In Cloudflare open **Storage & databases**, then **D1 SQL database**, then **Create database**.
2. Name it `nomads-dmz` and create it.
3. Copy its **Database ID**.

## 3. Connect the database
1. On GitHub open `wrangler.jsonc` and press the pencil icon.
2. At the bottom remove the two slashes at the start of the three lines under `ACCOUNTS`, and paste your Database ID over `PASTE-YOUR-D1-ID-HERE`.
3. Commit the change.

## 4. Add the two secrets
1. In Cloudflare open **Workers & Pages**, then `nomads-dmz`, then **Settings**, then **Variables and secrets** (the one for the running Worker, not the Build section).
2. Add a **Secret** named `DISCORD_CLIENT_ID` with the Client ID.
3. Add a **Secret** named `DISCORD_CLIENT_SECRET` with the Client Secret.
4. Deploy.

## 5. Check it
Open the home page. A **Log in with Discord** button now sits next to the Join the Discord button.
The tables are created automatically on the first login.

## What is stored
Discord number, name and picture, when the account was made and last used, the saved Upgrades and Camo Tracker progress, and (later) private map pins.
The Discord access token is used once to read the name, then handed back to Discord. It is never stored.
People can download or delete everything from the account menu.
