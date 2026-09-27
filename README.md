# GDrag Flip Board

A live Hypixel SkyBlock board, hosted free on GitHub Pages. It shows:

- **Golden Dragons worth levelling:** the cheapest clean Lvl 200, the top 5 by profit per level, and every Lvl 100–199 listing.
- **Bazaar prices:** buy order and sell order for the items in `config.json`.
- **Pet XP tracker:** XP and levels gained per day by the Golden Dragons in your pets menu.

Prices update live while someone has the page open. A GitHub Actions job runs **every hour, even when nobody has it open**, and saves:

- pet XP
- hourly bazaar prices
- hourly Golden Dragon prices

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

Your board is now at **`https://<your-github-username>.github.io/gdrag-board/`**. From here it collects on its own every hour.

## Good to know

- **API key expiry.** Development keys expire. When yours does, the board shows a red "Hypixel rejected the API key" message and the tracker pauses. Everything else keeps working. Update the `HYPIXEL_API_KEY` secret to fix it. For 24/7 use, apply for a **Personal API key** on the developer dashboard. Approval can take a couple of weeks.
- **Hypixel's rules.** Each player is checked at most once an hour. Visitors never use your key: only the hourly job does.
- **Who can see what.** The repo is public, so anyone can see the saved history in `data/`. Your key is never in the repo or the page.
- **Timing.** GitHub sometimes starts the hourly run a few minutes late. That's normal.
- **If GitHub pauses the schedule.** GitHub pauses scheduled jobs in public repos after 60 days with no activity. The hourly data commits should count as activity. If GitHub ever emails you that the workflow was disabled, re-enable it on the Actions tab.
- **If something goes wrong.** Hover the "Hourly job" chip at the top of the board to see the error. Each run also has a log on the Actions tab.

## Changing what it tracks

Edit `config.json` on GitHub. The site updates within a couple of minutes.

- `players`: whose pets menu to check. Each player costs one API request an hour.
- `petTypes`: which pet types to track, for example `"GOLDEN_DRAGON"` or `"ENDER_DRAGON"`.
- `petUuids`: specific pets to track regardless of type.
- `bazaar`: the bazaar items to show and record. Each needs its bazaar `id`, for example `ESSENCE_WITHER`.

## Files

| File | What it does |
|---|---|
| `index.html` | The board |
| `config.json` | What to track |
| `collector/collect.mjs` | The hourly job (Node, no dependencies) |
| `.github/workflows/collect.yml` | Runs the job every hour and publishes the site |
| `data/` | Saved history, written by the job. Don't edit by hand. |
