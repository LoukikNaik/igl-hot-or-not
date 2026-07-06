# Deploy: frontend on GitHub Pages, backend local via ngrok

The frontend is static (`public/`) and goes to GitHub Pages. The backend
(`server.js` + SQLite) runs on your machine and is exposed to the internet with
ngrok. The Pages frontend calls the ngrok URL for all `/api/*` requests.

## One-time setup

1. **Enable Pages via Actions**: repo Settings → Pages → Source = **GitHub Actions**.
   (Publishing Pages from a *private* repo needs a paid plan — Pro/Team. On the
   free tier, make the repo public or host the frontend elsewhere.)

2. **Backend env vars** (so cross-origin cookies + CORS work):
   ```bash
   export ALLOWED_ORIGIN="https://<your-username>.github.io"   # your Pages origin, no trailing slash, no repo path
   export STATS_KEY="pick-a-secret"                            # protects /stats and /api/stats
   ```

## Every session

1. **Start the backend:**
   ```bash
   ALLOWED_ORIGIN="https://<username>.github.io" STATS_KEY="..." npm start
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

Your live site: `https://<username>.github.io/<repo>/`

## The ngrok free-tier catch

Free ngrok gives a **new random URL every restart**, so you'd edit `config.js`
and push each time. Fixes:
- A **reserved ngrok domain** (paid) — stable URL, set it once.
- Any stable tunnel (Cloudflare Tunnel, Tailscale Funnel) works the same way.

## Notes

- `ALLOWED_ORIGIN` is the origin only (`https://user.github.io`) — never include
  the `/repo` path or a trailing slash, or the CORS check fails.
- Photos are committed to `public/photos/` and served by Pages directly (relative
  paths), so they don't go through ngrok.
- The backend still works fully standalone with no env vars: `npm start` serves
  frontend + API at `http://localhost:3000` (same-origin, no CORS needed).
- SQLite lives at `votes.sqlite` (override with `DB_PATH`); it's snapshotted to
  `backups/` on every boot.
