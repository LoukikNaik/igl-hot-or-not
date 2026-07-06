# Deploy: frontend on GitHub Pages (igl.loukik.dev), backend local via ngrok

The frontend is static (`public/`) and goes to GitHub Pages. The backend
(`server.js` + SQLite) runs on your machine and is exposed to the internet with
ngrok. The Pages frontend calls the ngrok URL for all `/api/*` requests.

## One-time setup

1. **Enable Pages via Actions**: repo Settings → Pages → Source = **GitHub Actions**.
   (Publishing Pages from a *private* repo needs a paid plan — Pro/Team. On the
   free tier, make the repo public or host the frontend elsewhere.)

2. **Custom domain `igl.loukik.dev`** (already wired via `public/CNAME`):
   - At your DNS provider for `loukik.dev`, add a **CNAME** record:
     `igl`  →  `loukiknaik.github.io`   (proxy/orange-cloud OFF if using Cloudflare)
   - Repo Settings → Pages → Custom domain → enter `igl.loukik.dev`, Save.
   - Tick **Enforce HTTPS** once the cert provisions (a few minutes).
   - DNS check: `dig +short igl.loukik.dev CNAME` should show `loukiknaik.github.io`.

3. **Backend env vars** (so cross-origin cookies + CORS work):
   ```bash
   export ALLOWED_ORIGIN="https://igl.loukik.dev"   # your Pages origin, no trailing slash, no path
   export STATS_KEY="pick-a-secret"                            # protects /stats and /api/stats
   ```

## Every session

1. **Start the backend:**
   ```bash
   ALLOWED_ORIGIN="https://igl.loukik.dev" STATS_KEY="..." npm start
   ```
2. **Expose it with ngrok:**
   ```bash
   ngrok http 3000
   ```
   Copy the `https://….ngrok-free.app` URL it prints.
3. **Point the frontend at it:** edit `public/config.js`:
   ```js
   window.API_BASE = 'https://<that-ngrok-subdomain>.ngrok-free.app';
   ```
   Commit + push. The Actions workflow redeploys Pages in ~1 min.

Your live site: `https://igl.loukik.dev`

## The ngrok free-tier catch

Free ngrok gives a **new random URL every restart**, so you'd edit `config.js`
and push each time. Fixes:
- A **reserved ngrok domain** (paid) — stable URL, set it once.
- Any stable tunnel (Cloudflare Tunnel, Tailscale Funnel) works the same way.

## Notes

- `ALLOWED_ORIGIN` is the origin only (`https://igl.loukik.dev`) — never include
  a path or a trailing slash, or the CORS check fails.
- Optional: put the backend behind `api.loukik.dev` with a reserved ngrok domain
  (CNAME `api` → your ngrok domain) so the API URL is stable and on-brand.
- Photos are committed to `public/photos/` and served by Pages directly (relative
  paths), so they don't go through ngrok.
- The backend still works fully standalone with no env vars: `npm start` serves
  frontend + API at `http://localhost:3000` (same-origin, no CORS needed).
- SQLite lives at `votes.sqlite` (override with `DB_PATH`); it's snapshotted to
  `backups/` on every boot.

## Keeping the backend running (macOS launchd)

A launchd agent keeps the backend + ngrok alive across terminal close, logout,
crashes, and reboots. It also auto-updates the deployed frontend whenever ngrok's
URL changes (sets the `API_BASE` repo variable + redeploys).

- Supervisor script: `scripts/serve.sh` (starts/monitors server + ngrok, repoints
  the frontend on URL change; logs to `logs/`).
- Agent: `~/Library/LaunchAgents/dev.loukik.igl.plist`, runs the script under
  `caffeinate -s`, `KeepAlive` + `RunAtLoad`.

Manage it:
```bash
launchctl kickstart -k gui/$(id -u)/dev.loukik.igl   # restart now
launchctl bootout    gui/$(id -u)/dev.loukik.igl     # stop + disable
launchctl bootstrap  gui/$(id -u) ~/Library/LaunchAgents/dev.loukik.igl.plist  # (re)load
tail -f logs/supervisor.log                          # watch it
```

### Lid-closed caveat (important)
`caffeinate -s` only holds off sleep **on AC power**. On battery, closing the lid
sleeps the Mac regardless, and everything pauses until it wakes. To run with the
lid closed:
- **Plug into AC power** (then `caffeinate -s` keeps it awake, lid closed), OR
- For guaranteed lid-closed operation, run once (needs sudo, system setting):
  `sudo pmset -c disablesleep 1`  (undo with `sudo pmset -c disablesleep 0`).
When the Mac does sleep, the launchd agent brings everything back on wake, and the
frontend auto-repoints if ngrok handed out a new URL.
