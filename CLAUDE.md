# CLAUDE.md

Guidance for working in this repo. Read this before making changes.

## What this is

**India's Got Latent · Funny or Not**, a public "hot or not / funnier?" voting
site for the panelists (and, when enabled, contestants) of India's Got Latent
Seasons 1 & 2. Users face two panelists off, pick the funnier one, and an Elo
ranking builds on a shared backend. There's also a gated leaderboard and a
(currently disabled) judge-mode for scoring contestants 0–10.

Live: **https://igl.loukik.dev** (frontend on GitHub Pages, backend runs locally
and is exposed via ngrok, see Deployment).

## Architecture

- **Production runs on Cloudflare:** frontend on GitHub Pages, backend a Cloudflare
  **Worker** (`worker/src/index.js`) on **D1**. `server.js` (Node + `node:sqlite`) is
  now a local-dev mirror of the same API off `data.js`; the Worker is a 1:1 port of it.
  Keep the two in sync when you change API logic.
- `worker/`, the production backend: `src/index.js` (the Worker, D1 + Web Crypto +
  CORS), `wrangler.toml` (D1 binding, `iglapi.loukik.dev` domain, vars), `schema.sql`,
  `src/photos.js` (build-time manifest of which photos exist), `build-manifest.mjs`.
- `server.js`, local-dev HTTP server: serves `public/` + `/api/*` off `node:sqlite`
  (`votes.sqlite`). Same logic as the Worker; handy for quick iteration.
- `data.js`, the roster: one array of people (`module.exports = [...]`). **The single
  source of truth for people**, `require`d by `server.js` and bundled into the Worker.
- `public/`, the deployed frontend:
  - `index.html`, face-off (swipe/click/arrow to vote, Tinder-style fling)
  - `leaderboard.html`, Elo rankings, search, per-person profile modal
  - `judge.html`, contestant scoring (gated off via `SHOW_CONTESTANTS`)
  - `stats.html`, analytics dashboard (`/api/stats`, protected by `STATS_KEY`)
  - `app.js`, shared: API client, theme, photo resolution, cards, modal,
    voter token, leaderboard-gate, analytics beacons
  - `app.css`, all styling, two themes via CSS variables (`data-theme` = black|white)
  - `config.js`, `window.API_BASE`; empty for local, injected at deploy time
  - `photos/<id>.jpg`, per-person images (committed)

## Run it

```bash
npm start        # http://localhost:3000, serves frontend + API same-origin
```
Env vars (all optional): `PORT`, `DB_PATH` (SQLite location), `ALLOWED_ORIGIN`
(enables CORS + cross-site cookies for a separate frontend origin), `STATS_KEY`
(protects the analytics endpoint/dashboard).

## Data model (`data.js`)

Each person: `{ id, name, type: 'panel'|'contestant', panels: [...], blurb,
joke?, wiki?, insta?, showScore? }`.
- `panels`, which episodes they were on, e.g. `['S1 E3', 'S2 E1']`. Also used
  as the season filter and shown as chips.
- `blurb`, what they did / who they sat with. Shown on the card and modal.
- `joke`, one memorable romanized-Hinglish line (optional). See "Jokes" below.
- `wiki`, Wikipedia page title (only used as a photo fallback source now).
- `insta`, Instagram handle (no @). Rendered as a link.
- `showScore`, the score a *contestant* actually got on the show (for the
  Audience Winners feature). Mostly null.

## Votes & identity (SQLite)

- Storage is SQLite (`votes.sqlite`, WAL mode) via `node:sqlite`. Tables:
  `players` (elo/wins/losses), `faceoffs` (one row per voter+pair, dedup by PK),
  `ratings` (0–10 scores), `events` (analytics). Snapshotted to `backups/` on boot.
- **Voter identity is a `localStorage` token sent as the `x-igl-voter` header**,
  NOT a cookie. This is deliberate: the frontend (igl.loukik.dev) and backend
  (ngrok domain) are cross-origin, and iOS Safari blocks third-party cookies , 
  a cookie made the vote counter stick at 1. Cookie is only a same-origin
  fallback. If you touch identity, keep the header path primary.
- One face-off vote per unordered pair per voter. Matchups are **fairness-first**:
  the least-voted person is shown first, against a random same-type opponent the
  voter hasn't judged. Contestants never face panelists.
- Leaderboard is **gated**: locked until a voter has 10 face-off votes
  (`LEADERBOARD_UNLOCK` in app.js). Enforced server-side via `/api/me`.

## The transcript → data pipeline

Episode facts (winners, scores, contestants, jokes) come from transcribing the
episodes and analyzing them, because Wikipedia only lists winners.
- `transcripts/episode_ids.txt`, episode number → Dailymotion video id.
- `scripts/transcribe_s1.py`, downloads audio (yt-dlp) and transcribes with
  **mlx-whisper**. Run it with the transcribe project's venv:
  `/Users/loukiknaik/projects/transcribe/.venv/bin/python scripts/transcribe_s1.py`
  (that's `.venv`, not `venv`; model `whisper-large-v3-turbo`, language `hi`).
  It skips episodes already transcribed. Bonus 6 (ep18) has no working source.
- `transcripts/ep<N>.txt`, the outputs (Hindi/English, `[MM:SS]` lines,
  heavily garbled, NO speaker labels). Committed.
- Analysis is done by spawning subagents over the transcripts, which return
  structured findings that get merged into `data.js`.

### Jokes, the rule
Transcripts are garbled and unlabeled, so **never fabricate or guess a line**.
Only add a `joke` when it's confidently attributable to that person and would
be recognizable to someone who watched. If unsure, leave it blank. This was an
explicit user requirement.

## Photos

`public/photos/<id>.jpg`. The server reports which exist (`photo` field in the
API) so the client never guesses. Resolution when adding new ones:
1. The person's own verified Instagram profile pic (best, right person).
2. A web-search image, **vision-audited by an Opus agent** for right-person +
   card-worthiness (reject posters, collages, wrong people, group shots).
3. A frame extracted from the episode video at a transcript-derived timestamp
   (for contestants with no web presence), vision-cropped to a portrait.
4. Fallback: a styled initials tile (handled in `app.js`, no file needed).
Cards are ~4:4.4 portrait, top-anchored; crop faces accordingly.

## Copy / voice

- Roast-show wit, but **plain and human**, the user rejects "AI-generated"
  flourishes (e.g. "rocket up", "well, that one lingers", "somewhere an X just
  flinched", "dossier"). Say it straight; let the joke be the joke.
- **No em dashes** in any user-facing text (data blurbs, jokes, page copy). Use
  commas or periods. This was an explicit, repeated user preference.

## Deployment (all Cloudflare, always-on)

Frontend on GitHub Pages (`igl.loukik.dev`), backend a Cloudflare **Worker**
(`worker/`, at `iglapi.loukik.dev`) on **D1**. Full details in `DEPLOY.md`. Key points:
- Repo is **public** (free-tier Pages can't publish from a private repo).
- `.github/workflows/deploy-pages.yml` deploys `public/` on push, and **injects
  `config.js` from the `API_BASE` repo variable** at build time (a static site has
  no runtime env). `API_BASE = https://iglapi.loukik.dev`. To change:
  `gh variable set API_BASE --body "<url>"` then `gh workflow run deploy-pages.yml`.
- **Backend deploy:** `cd worker && npx wrangler deploy`. Redeploy after editing the
  Worker OR `data.js` (the roster is bundled in). After adding/removing photos, run
  `node worker/build-manifest.mjs` first (bakes the which-photos-exist list).
- Worker config in `worker/wrangler.toml`: D1 binding, `iglapi.loukik.dev` custom
  domain (wrangler provisions DNS + cert), `ALLOWED_ORIGIN`, `BLOCKED_IPS`.
  `STATS_KEY` is a wrangler secret.
- Custom domains: `igl.loukik.dev` via `public/CNAME` + Cloudflare DNS CNAME to
  `loukiknaik.github.io`; `iglapi.loukik.dev` auto-managed by wrangler. Cloudflare
  DNS token is at `~/.config/cloudflare/api-token` (never commit it).
- **Retired:** the old ngrok + `node server.js` + launchd supervisor. The LaunchAgent
  is disabled (`~/Library/LaunchAgents/dev.loukik.igl.plist.disabled`). `server.js`
  and `votes.sqlite` remain only for local dev.

## Gotchas

- **Editing `data.js` needs a Worker redeploy** now (`cd worker && npx wrangler deploy`),
  not a server restart. It's bundled into the Worker at build time.
- **Live votes are in D1, not `votes.sqlite`.** `votes.sqlite` is historical; query live
  data with `npx wrangler d1 execute igl-votes --remote --command "..."` or
  `node scripts/voters.js`.
- **Verify live Pages via `--resolve`**: this machine can't always DNS-resolve
  `igl.loukik.dev` from `curl`; use
  `curl --resolve igl.loukik.dev:443:185.199.108.153 https://igl.loukik.dev/...`.
- **Pages deploys fail intermittently** with a generic "try again later"; just re-run.
- **Headless Chrome floors at ~485px CSS width** on this Mac regardless of
  `--window-size`, and crops the screenshot; it looks like horizontal overflow but
  isn't. Measure real overflow in-page (getBoundingClientRect) instead.
- Never delete a votes DB to "reset"; use SQL `DELETE`. A DB was lost early this way.
