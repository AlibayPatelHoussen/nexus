#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
#  Nexus — automatic deployment
#
#  Immediate: GitHub calls Nexus (webhook /api/deploy/webhook) as soon as
#  the CI of main is green; Nexus writes logs/.deploy-request, the systemd
#  unit nexus-auto-deploy.path sees it and runs the deployment right away
#  (outside Nexus, since deploying restarts it).
#  Safety net: a check every 10 minutes (missed webhook, Wi-Fi down...).
#  Each run deploys only a NEW commit of main whose CI is green.
#
#  sudo bash scripts/auto-deploy.sh install     install + start
#  bash scripts/auto-deploy.sh status           state + last deployments
#  bash scripts/auto-deploy.sh run              check / deploy now
#  sudo bash scripts/auto-deploy.sh uninstall   remove
#
#  Options (/etc/default/nexus-auto-deploy):
#    REQUIRE_CI=1      wait for a green CI before deploying (0: deploy at once)
#    INTERVAL=10min    safety-net check interval (install-time)
#    GITHUB_TOKEN=…    only if the repository becomes private
# ══════════════════════════════════════════════════════════════════════
set -u

NAME=nexus-auto-deploy
DIR=$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)
CONF=/etc/default/$NAME
# shellcheck disable=SC1090
[ -r "$CONF" ] && . "$CONF"
REQUIRE_CI=${REQUIRE_CI:-1}
MAX_ATTEMPTS=3
NO_CI_WAIT=900          # no CI run seen for a commit after 15 min → deploy anyway
LOG="$DIR/logs/auto-deploy.log"
STATE="$DIR/logs/.auto-deploy-state"

log() { mkdir -p "$DIR/logs"; echo "$(date '+%F %T') $*" | tee -a "$LOG"; logger -t "$NAME" -- "$*" 2>/dev/null || true; }
# Log a message once per commit/situation (the timer runs every 2 min)
log_once() { local key=$1; shift; grep -qxF "said $key" "$STATE" 2>/dev/null && return; echo "said $key" >> "$STATE"; log "$@"; }

# "owner/repo" from the origin URL (https or ssh)
repo_slug() { git -C "$DIR" remote get-url origin 2>/dev/null | sed -E 's#(\.git)?/?$##; s#^.*github\.com[:/]##'; }

# CI state of a commit: success | pending | failure | none | unknown
ci_state() {
  local sha=$1 json
  json=$(curl -fsS --max-time 20 -H 'Accept: application/vnd.github+json' \
    ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} \
    "https://api.github.com/repos/$(repo_slug)/commits/$sha/check-runs?per_page=100" 2>/dev/null) || { echo unknown; return; }
  printf '%s' "$json" | node -e '
    let d = ""; process.stdin.on("data", (c) => (d += c)).on("end", () => {
      // The (disabled) "Deploy to Server" job of the CI is not a check
      const runs = (JSON.parse(d).check_runs || []).filter((r) => !/deploy/i.test(r.name))
      if (!runs.length) return console.log("none")
      if (runs.some((r) => r.status === "completed" && !["success", "skipped", "neutral"].includes(r.conclusion))) return console.log("failure")
      console.log(runs.every((r) => r.status === "completed") ? "success" : "pending")
    })' 2>/dev/null || echo unknown
}

do_run() {
  # Commits merged during a deployment are deployed right after it
  local i
  for i in 1 2 3; do
    run_once || return 0
  done
}

# Returns 0 when it deployed successfully (then check again), 1 otherwise
run_once() {
  cd "$DIR" || exit 1
  mkdir -p "$DIR/logs"
  # One run at a time (a deployment takes longer than the timer interval)
  exec 9>"$DIR/logs/.auto-deploy.lock"
  flock -n 9 || return 1

  if ! git fetch -q origin main 2>/dev/null; then
    log_once "fetch-$(date +%F-%H)" "⚠️  git fetch failed (no Internet?) — retrying later"
    return 1
  fi
  local head remote
  head=$(git rev-parse HEAD); remote=$(git rev-parse origin/main)
  [ "$head" = "$remote" ] && return 1
  if ! git merge-base --is-ancestor "$head" "$remote"; then
    log_once "diverged-$remote" "❌ Local commits in $DIR are not on GitHub main: automatic deployment stopped (git status / git log to check)"
    return 1
  fi

  local short=${remote:0:7}
  if [ "$REQUIRE_CI" = 1 ]; then
    case $(ci_state "$remote") in
      success) ;;
      pending) log_once "pending-$remote" "⏳ $short: waiting for the CI to finish"; return 1 ;;
      failure) log_once "failure-$remote" "❌ $short: CI failed — not deployed (the current version keeps running)"; return 1 ;;
      none|unknown)
        # No CI result (API unreachable / CI not run): deploy after a delay
        grep -q "^seen $remote " "$STATE" 2>/dev/null || echo "seen $remote $(date +%s)" >> "$STATE"
        local seen; seen=$(awk -v s="$remote" '$1=="seen" && $2==s {print $3; exit}' "$STATE")
        if [ $(( $(date +%s) - seen )) -lt "$NO_CI_WAIT" ]; then
          log_once "noci-$remote" "⏳ $short: no CI result yet, deploying in 15 min at the latest"; return 1
        fi ;;
    esac
  fi

  local tries; tries=$(grep -c "^try $remote" "$STATE" 2>/dev/null || true)
  if [ "${tries:-0}" -ge "$MAX_ATTEMPTS" ]; then
    log_once "gaveup-$remote" "❌ $short: deployment failed $MAX_ATTEMPTS times — stopped, run 'bash scripts/deploy.sh' by hand to see why"
    return 1
  fi
  echo "try $remote" >> "$STATE"

  log "🚀 Deploying $short ($(git log -1 --format=%s "$remote" | cut -c1-80))"
  if bash "$DIR/scripts/deploy.sh" >> "$LOG" 2>&1; then
    log "✅ $short deployed"
    # Keep the state file small
    grep -v -e "$remote" "$STATE" > "$STATE.tmp" 2>/dev/null; mv -f "$STATE.tmp" "$STATE" 2>/dev/null || true
    flock -u 9
    return 0
  fi
  log "❌ $short: deploy.sh failed (attempt $((tries + 1))/$MAX_ATTEMPTS) — see $LOG"
  return 1
}

need_root() { [ "$(id -u)" = 0 ] || { echo "À lancer avec sudo : sudo bash $0 $1"; exit 1; }; }

do_install() {
  need_root install
  local user=${SUDO_USER:-}
  if [ -z "$user" ] || [ "$user" = root ]; then
    user=$(stat -c %U "$DIR"); fi
  # Same PATH as the user's shell: node / npm / pm2 may come from nvm
  local upath home
  upath=$(sudo -u "$user" -i bash -c 'echo $PATH' 2>/dev/null | tail -1)
  home=$(getent passwd "$user" | cut -d: -f6)
  for c in git node npm pm2 curl flock; do
    sudo -u "$user" env PATH="$upath" bash -c "command -v $c" >/dev/null || { echo "❌ '$c' not found for $user (PATH=$upath)"; exit 1; }
  done

  cat > /etc/systemd/system/$NAME.service <<EOF
[Unit]
Description=Nexus automatic deployment (deploys main when it changes)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$user
Environment=HOME=$home
Environment=PATH=$upath
WorkingDirectory=$DIR
ExecStart=/bin/bash $DIR/scripts/auto-deploy.sh run
TimeoutStartSec=30min
Nice=5
EOF
  cat > /etc/systemd/system/$NAME.timer <<EOF
[Unit]
Description=Nexus automatic deployment, safety-net check every ${INTERVAL:-10min}

[Timer]
OnBootSec=3min
OnUnitActiveSec=${INTERVAL:-10min}
AccuracySec=30s

[Install]
WantedBy=timers.target
EOF
  # Immediate trigger: the webhook writes this file, systemd starts the deployment
  local req="$DIR/logs/.deploy-request"
  sudo -u "$user" mkdir -p "$DIR/logs"
  sudo -u "$user" touch "$req"
  cat > /etc/systemd/system/$NAME.path <<EOF
[Unit]
Description=Nexus automatic deployment, triggered by the GitHub webhook

[Path]
PathChanged=$req
Unit=$NAME.service

[Install]
WantedBy=paths.target
EOF
  systemctl daemon-reload
  systemctl enable --now $NAME.timer $NAME.path >/dev/null

  # Webhook secret shared with GitHub, created once in backend/.env
  local envf="$DIR/backend/.env" secret site
  secret=$(grep -E '^DEPLOY_WEBHOOK_SECRET=' "$envf" 2>/dev/null | tail -1 | cut -d= -f2-)
  if [ -z "$secret" ]; then
    secret=$(openssl rand -hex 32 2>/dev/null || od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
    printf '\n# GitHub webhook -> immediate deployment (scripts/auto-deploy.sh)\nDEPLOY_WEBHOOK_SECRET=%s\n' "$secret" >> "$envf"
    if sudo -u "$user" env PATH="$upath" HOME="$home" pm2 restart nexus-backend >/dev/null 2>&1; then
      echo "   (Nexus restarted to load the webhook secret)"
    fi
  fi
  site=$(grep -E '^FRONTEND_URL=' "$envf" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"' ")
  case $site in ""|*localhost*|*127.0.0.1*) site="https://<ton-domaine-nexus>" ;; esac

  echo "✅ Automatic deployment installed (as $user)"
  echo ""
  echo "   Last step, once, on GitHub: repository → Settings → Webhooks → Add webhook"
  echo "     Payload URL  : ${site%/}/api/deploy/webhook"
  echo "     Content type : application/json"
  echo "     Secret       : $secret"
  echo "     Events       : « Let me select individual events » → only « Workflow runs »"
  echo "   GitHub then shows a green ✓ next to the webhook."
  echo ""
  echo "   Safety net: also checks every ${INTERVAL:-10min}."
  echo "   State / last deployments : bash scripts/auto-deploy.sh status"
  echo "   Full log                 : $LOG"
}

do_status() {
  cd "$DIR" || exit 1
  echo "Running version : $(git log -1 --format='%h %s' | cut -c1-90)"
  if git fetch -q origin main 2>/dev/null; then
    local r; r=$(git rev-parse origin/main)
    if [ "$r" = "$(git rev-parse HEAD)" ]; then echo "GitHub main     : same ✅"
    else echo "GitHub main     : $(git log -1 --format='%h %s' "$r" | cut -c1-90)  (CI: $(ci_state "$r"))"; fi
  else echo "GitHub main     : unreachable (no Internet?)"; fi
  systemctl list-timers $NAME.timer --no-pager 2>/dev/null | head -2
  if [ -s "$DIR/logs/.deploy-request" ]; then echo "Last webhook    : $(cat "$DIR/logs/.deploy-request")"
  else echo "Last webhook    : none received yet (check the webhook on GitHub)"; fi
  echo ""; echo "Last events:"
  grep -E '🚀|✅|❌|⏳|⚠️' "$LOG" 2>/dev/null | tail -10 || echo "(none yet)"
}

do_uninstall() {
  need_root uninstall
  systemctl disable --now $NAME.timer $NAME.path 2>/dev/null
  rm -f /etc/systemd/system/$NAME.service /etc/systemd/system/$NAME.timer /etc/systemd/system/$NAME.path
  systemctl daemon-reload
  echo "Automatic deployment removed (deploy by hand with: bash scripts/deploy.sh)"
}

case "${1:-}" in
  install)   do_install ;;
  uninstall) do_uninstall ;;
  run)       do_run ;;
  status)    do_status ;;
  *) sed -n '3,19p' "$0" | sed 's/^# \{0,2\}//'; exit 1 ;;
esac
