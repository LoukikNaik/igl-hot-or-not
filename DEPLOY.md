# Deploy

Everything runs on **Cloudflare**, always-on and free. No laptop, no ngrok.

```
  Browser
    |
    |  https://igl.loukik.dev        (frontend: GitHub Pages)
    |  static HTML/CSS/JS + /photos
    v
  igl.loukik.dev  --- /api/* fetch --->  https://iglapi.loukik.dev
                                          (backend: Cloudflare Worker)
                                                |
                                                v
                                          D1 database  (votes)
```

- **Frontend:** static `public/`, served by **GitHub Pages** at `igl.loukik.dev`.
- **Backend:** a **Cloudflare Worker** (`worker/`) at `iglapi.loukik.dev`, a 1:1 port of `server.js`.
- **Votes:** **Cloudflare D1** (SQLite) database `igl-votes`.

## Frontend (GitHub Pages)

Auto-deploys `public/` on push to `main` (`.github/workflows/deploy-pages.yml`).
The workflow injects `public/config.js` from the **`API_BASE` repo variable** at build
time (a static site has no runtime env), so the backend URL lives in GitHub settings.

- Current value: `API_BASE = https://iglapi.loukik.dev`
- To repoint the frontend at a different backend:
  ```bash
  gh variable set API_BASE -R LoukikNaik/igl-funny-or-not --body "https://NEW_URL"
  gh workflow run deploy-pages.yml -R LoukikNaik/igl-funny-or-not
  ```
- Custom domain via `public/CNAME` (`igl.loukik.dev`) plus a Cloudflare DNS CNAME to
  `loukiknaik.github.io` (DNS-only).

## Backend (Cloudflare Worker + D1)

Lives in `worker/`. Deploy after any change to the Worker **or `data.js`** (the roster
is bundled into the Worker):

```bash
cd worker
npx wrangler deploy
```

- **`wrangler.toml`**: D1 binding, the `iglapi.loukik.dev` custom domain (wrangler
  provisions DNS + cert), `ALLOWED_ORIGIN` and `BLOCKED_IPS` vars.
- **Secret:** `STATS_KEY` (protects `/api/stats`): `npx wrangler secret put STATS_KEY`.
- **Photos:** the Worker can't read the filesystem, so which-photos-exist is baked at
  build. After adding/removing files in `public/photos/`:
  ```bash
  node worker/build-manifest.mjs   # regenerates worker/src/photos.js
  cd worker && npx wrangler deploy
  ```

### Editing the roster
`data.js` is the single source of truth, bundled into the Worker. After editing it,
**redeploy the Worker** (`cd worker && npx wrangler deploy`) for the change to go live.
There is no server to restart anymore.

### D1 (votes) operations
The live votes are in D1, not the local `votes.sqlite` (that is now just history).

```bash
cd worker
# ad-hoc query
npx wrangler d1 execute igl-votes --remote --command "SELECT COUNT(*) FROM faceoffs"
# voter breakdown helper (reads D1)
node ../scripts/voters.js         # or -w to watch
# backup: export the DB
npx wrangler d1 export igl-votes --remote --output ../backups/d1-$(date +%Y%m%d).sql
```

## Local development

`server.js` + `votes.sqlite` still work off the same `data.js` for quick local iteration:

```bash
npm start        # http://localhost:3000, serves frontend + API same-origin
```

This is dev-only; production is the Worker. The old ngrok/launchd supervisor is retired
(the LaunchAgent is disabled at `~/Library/LaunchAgents/dev.loukik.igl.plist.disabled`).

## Abuse / hardening

- IP denylist: the `BLOCKED_IPS` var in `wrangler.toml` (comma-separated). The Worker
  reads the client IP from Cloudflare's `CF-Connecting-IP`. Redeploy to apply.
- Ballot-stuffing (random voter tokens) is still possible in principle. The strong fix
  is **Cloudflare Turnstile** on the vote path, which is easy now that we are on Workers.
