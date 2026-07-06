#!/bin/bash
# Supervisor for the IGL backend + ngrok tunnel.
# Keeps both alive, and whenever ngrok's public URL changes it repoints the
# deployed frontend (updates the API_BASE repo variable + triggers a Pages deploy).
# Meant to be run by the launchd agent (wrapped in `caffeinate -s`); also runnable
# by hand: bash scripts/serve.sh
set -u

DIR="/Users/loukiknaik/projects/igt"
BIN="/opt/homebrew/bin"
export PATH="$BIN:/usr/bin:/bin:/usr/sbin:$PATH"
export ALLOWED_ORIGIN="https://igl.loukik.dev"
export STATS_KEY="$(cat "$HOME/.config/cloudflare/igl-stats-key" 2>/dev/null || echo devkey)"
REPO="LoukikNaik/igl-hot-or-not"

cd "$DIR" || exit 1
LOGS="$DIR/logs"; mkdir -p "$LOGS"
LAST_URL_FILE="$LOGS/last_url"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOGS/supervisor.log"; }

server_up() { curl -s -o /dev/null --max-time 3 http://localhost:3000/ ; }
ngrok_up()  { curl -s -o /dev/null --max-time 3 http://localhost:4040/api/tunnels ; }

start_server() {
  server_up && return
  log "starting node server"
  "$BIN/node" server.js >> "$LOGS/server.log" 2>&1 &
  echo $! > "$LOGS/server.pid"
  sleep 2
}

start_ngrok() {
  ngrok_up && return
  log "starting ngrok"
  "$BIN/ngrok" http 3000 --log=stdout >> "$LOGS/ngrok.log" 2>&1 &
  echo $! > "$LOGS/ngrok.pid"
  sleep 6
}

current_url() {
  curl -s --max-time 5 http://localhost:4040/api/tunnels 2>/dev/null | "$BIN/python3" -c '
import sys, json
try:
    d = json.load(sys.stdin)
    print(next(t["public_url"] for t in d["tunnels"] if t["public_url"].startswith("https")))
except Exception:
    print("")'
}

repoint_frontend() {
  local url="$1"
  [ -z "$url" ] && return
  local last=""; [ -f "$LAST_URL_FILE" ] && last="$(cat "$LAST_URL_FILE")"
  [ "$url" = "$last" ] && return
  log "ngrok url changed -> $url ; updating API_BASE + redeploying"
  if "$BIN/gh" variable set API_BASE -R "$REPO" --body "$url" >> "$LOGS/supervisor.log" 2>&1; then
    "$BIN/gh" workflow run deploy-pages.yml -R "$REPO" >> "$LOGS/supervisor.log" 2>&1
    echo "$url" > "$LAST_URL_FILE"
  else
    log "gh variable set failed (auth? network?) — will retry next loop"
  fi
}

log "supervisor started"
while true; do
  start_server
  start_ngrok
  repoint_frontend "$(current_url)"
  sleep 30
done
