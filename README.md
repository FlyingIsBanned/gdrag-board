# GDrag Flip Board

A live Hypixel SkyBlock board, hosted free on GitHub Pages. It shows:

- **Golden Dragons worth levelling:** the cheapest clean Lvl 200, the top 5 by profit per level, and every Lvl 100–199 listing.
- **Bazaar prices:** buy order and sell order for the items in `config.json`.
- **Pet XP tracker:** XP and levels gained per day by the Golden Dragons in your pets menu, per player. Lvl 200 Golden Dragons are skipped since they can't gain more.

Prices update live while someone has the page open. A GitHub Actions job runs **every 15 minutes, even when nobody has it open**, and saves:

- pet XP
- bazaar prices
- Golden Dragon prices

The page uses that saved data for the tracker and the 7-day price lines.

## Setup (about 15 minutes)

You need a GitHub account and a Hypixel API key from <https://developer.hypixel.net>.

1. **Create the repo.** Go to <https://github.com/new>.
   - Repository name: `gdrag-board`
   - Visibility: **Public**. Free GitHub Pages needs a public repo. Your API key stays secret either way.
   - Tick **Add a README file**, then click **Create repository**.
2. **Turn on Pages.** In the repo, open **Settings → Pages**. Under **Build and deployment → Source**, pick **GitHub Actions**.
3. **Add your API key.** Open **Settings → Secrets and variables → Actions → New repository secret**.
   - Name: `HYPIXEL_API_KEY`
   - Secret: your key
4. **Upload the files.** On the **Code** tab, click **Add file → Upload files**. Drag in `index.html`, `config.json`, `README.md` and the `collector` folder. Click **Commit changes**.
5. **Add the workflow file.** Folders starting with a dot often don't upload by drag and drop, so create this one by hand:
   1. Click **Add file → Create new file**.
   2. For the file name, type `.github/workflows/collect.yml`.
   3. Paste in everything from `.github/workflows/collect.yml` in the zip, then click **Commit changes**.
6. **Add your username.** Open `config.json`, click the pencil icon, and change `YOUR_MINECRAFT_USERNAME` to your Minecraft username. Click **Commit changes**.
7. **Run it once.** Open the **Actions** tab and click **Collect SkyBlock data**, then **Run workflow**. After a minute or two it shows a green tick.

Your board is now at **`https://<your-github-username>.github.io/gdrag-board/`**. From here it collects on its own. To make it run reliably every 15 minutes, do the next section too.

## Reliable 15-minute runs (cron-job.org)

GitHub's own schedule is unreliable: on new or quiet repos it can skip runs for hours. So an outside service, [cron-job.org](https://cron-job.org) (free), starts the job every 15 minutes instead. The workflow's own schedule stays as an hourly backup.

1. **Make a GitHub token.** Go to <https://github.com/settings/personal-access-tokens/new> (fine-grained token).
   - Token name: `gdrag-board cron`
   - Expiration: the longest it offers. Put a reminder in your calendar to renew it.
   - Repository access: **Only select repositories** → `gdrag-board`
   - Permissions → Repository permissions → **Actions: Read and write**. Leave everything else as it is.
   - Click **Generate token** and copy it. It starts with `github_pat_`.
2. **Make the cron job.** Sign up at <https://cron-job.org>, then **Create cronjob**:
   - URL: `https://api.github.com/repos/<your-github-username>/gdrag-board/actions/workflows/collect.yml/dispatches`
   - Execution schedule: **Every 15 minutes**
   - Open the **Advanced** tab:
     - Request method: **POST**
     - Headers (add each one):
       - `Authorization`: `Bearer <your token>`
       - `Accept`: `application/vnd.github+json`
       - `X-GitHub-Api-Version`: `2022-11-28`
       - `Content-Type`: `application/json`
       - `User-Agent`: `gdrag-board-cron`
     - Request body: `{"ref":"main"}`
   - Click **Create**.
3. **Test it.** Click **Test run** on the cron job. A good response is **204 No Content**, and a new run appears on the Actions tab, marked *workflow_dispatch*. A 401 means the token is wrong, a 403 means it's missing the Actions permission, and a 404 means the URL has a typo.

If the token expires, the cron job starts failing (cron-job.org can email you) and the board falls back to the hourly backup until you paste in a new token.

## Good to know

- **API key expiry.** Development keys expire. When yours does, the board shows a red "Hypixel rejected the API key" message and the tracker pauses. Everything else keeps working. Update the `HYPIXEL_API_KEY` secret to fix it. For 24/7 use, apply for a **Personal API key** on the developer dashboard. Approval can take a couple of weeks.
- **Hypixel's rules.** Each player is checked at most once every ~12 minutes. Visitors never use your key: only the background job does.
- **Who can see what.** The repo is public, so anyone can see the saved history in `data/`. Your key is never in the repo or the page.
- **If GitHub pauses the schedule.** GitHub pauses scheduled jobs in public repos after 60 days with no activity. The data commits should count as activity. If GitHub ever emails you that the workflow was disabled, re-enable it on the Actions tab.
- **If something goes wrong.** Hover the "Background job" chip at the top of the board to see the error. Each run also has a log on the Actions tab.

## Changing what it tracks

Edit `config.json` on GitHub. The site updates within a couple of minutes.

- `players`: whose pets menu to check. Put each name in its own quotes, for example `["FlyingIsntBanned", "icey_vibes"]`, not `["FlyingIsntBanned, icey_vibes"]`. Each player is tracked and shown separately and costs one API request per check.
- `petTypes`: which pet types to track, for example `"GOLDEN_DRAGON"` or `"ENDER_DRAGON"`.
- `petUuids`: specific pets to track regardless of type.
- `bazaar`: the bazaar items to show and record. Each needs its bazaar `id`, for example `ESSENCE_WITHER`.

## Files

| File | What it does |
|---|---|
| `index.html` | The board |
| `config.json` | What to track |
| `collector/collect.mjs` | The background job (Node, no dependencies) |
| `.github/workflows/collect.yml` | Runs the job and publishes the site |
| `data/` | Saved history, written by the job. Don't edit by hand. |
