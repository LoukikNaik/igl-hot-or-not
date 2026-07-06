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
REPO="LoukikNaik/igl-funny-or-not"

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
  "$BIN/gh" variable set API_BASE -R "$REPO" --body "$url" >> "$LOGS/supervisor.log" 2>&1 \
    || { log "gh variable set failed - will retry next loop"; return; }
  # wait until the variable reflects the new value, else a fast dispatch reads the stale one
  local i cur
  for i in 1 2 3 4 5 6; do
    cur=$("$BIN/gh" api "/repos/$REPO/actions/variables/API_BASE" --jq .value 2>/dev/null)
    [ "$cur" = "$url" ] && break; sleep 3
  done
  "$BIN/gh" workflow run deploy-pages.yml -R "$REPO" >> "$LOGS/supervisor.log" 2>&1
  # verify the deploy actually succeeded (Pages fails intermittently); only then
  # record the url. On failure we leave last_url stale so the next loop retries.
  sleep 8
  local rid concl
  rid=$("$BIN/gh" run list -R "$REPO" -L 1 --json databaseId --jq '.[0].databaseId' 2>/dev/null)
  for i in $(seq 1 25); do
    concl=$("$BIN/gh" run view "$rid" -R "$REPO" --json status,conclusion --jq '.status+"/"+(.conclusion//"")' 2>/dev/null)
    case "$concl" in
      completed/success) echo "$url" > "$LAST_URL_FILE"; log "deploy ok -> $url"; return ;;
      completed/*)       log "deploy $concl; will retry next loop"; return ;;
    esac
    sleep 6
  done
  log "deploy still pending; will re-check next loop"
}

log "supervisor started"
while true; do
  start_server
  start_ngrok
  repoint_frontend "$(current_url)"
  sleep 30
done
