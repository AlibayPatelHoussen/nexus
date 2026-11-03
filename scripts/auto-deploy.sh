#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════
#  Nexus — automatic deployment
#
#  Every 2 minutes (systemd timer) the server checks whether main changed
#  on GitHub. If so, and once the CI of that commit is green, it runs
#  scripts/deploy.sh by itself. Nothing to open on the router, no secret
#  on GitHub: the server only reads (git fetch + public CI status).
#
#  sudo bash scripts/auto-deploy.sh install     install + start
#  bash scripts/auto-deploy.sh status           state + last deployments
#  bash scripts/auto-deploy.sh run              check / deploy now
#  sudo bash scripts/auto-deploy.sh uninstall   remove
#
#  Options (/etc/default/nexus-auto-deploy):
#    REQUIRE_CI=1      wait for a green CI before deploying (0: deploy at once)
#    INTERVAL=2min     how often to check (install-time)
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
  cd "$DIR" || exit 1
  mkdir -p "$DIR/logs"
  # One run at a time (a deployment takes longer than the timer interval)
  exec 9>"$DIR/logs/.auto-deploy.lock"
  flock -n 9 || exit 0

  if ! git fetch -q origin main 2>/dev/null; then
    log_once "fetch-$(date +%F-%H)" "⚠️  git fetch failed (no Internet?) — retrying later"
    exit 0
  fi
  local head remote
  head=$(git rev-parse HEAD); remote=$(git rev-parse origin/main)
  [ "$head" = "$remote" ] && exit 0
  if ! git merge-base --is-ancestor "$head" "$remote"; then
    log_once "diverged-$remote" "❌ Local commits in $DIR are not on GitHub main: automatic deployment stopped (git status / git log to check)"
    exit 0
  fi

  local short=${remote:0:7}
  if [ "$REQUIRE_CI" = 1 ]; then
    case $(ci_state "$remote") in
      success) ;;
      pending) log_once "pending-$remote" "⏳ $short: waiting for the CI to finish"; exit 0 ;;
      failure) log_once "failure-$remote" "❌ $short: CI failed — not deployed (the current version keeps running)"; exit 0 ;;
      none|unknown)
        # No CI result (API unreachable / CI not run): deploy after a delay
        grep -q "^seen $remote " "$STATE" 2>/dev/null || echo "seen $remote $(date +%s)" >> "$STATE"
        local seen; seen=$(awk -v s="$remote" '$1=="seen" && $2==s {print $3; exit}' "$STATE")
        if [ $(( $(date +%s) - seen )) -lt "$NO_CI_WAIT" ]; then
          log_once "noci-$remote" "⏳ $short: no CI result yet, deploying in 15 min at the latest"; exit 0
        fi ;;
    esac
  fi

  local tries; tries=$(grep -c "^try $remote" "$STATE" 2>/dev/null || true)
  if [ "${tries:-0}" -ge "$MAX_ATTEMPTS" ]; then
    log_once "gaveup-$remote" "❌ $short: deployment failed $MAX_ATTEMPTS times — stopped, run 'bash scripts/deploy.sh' by hand to see why"
    exit 0
  fi
  echo "try $remote" >> "$STATE"

  log "🚀 Deploying $short ($(git log -1 --format=%s "$remote" | cut -c1-80))"
  if bash "$DIR/scripts/deploy.sh" >> "$LOG" 2>&1; then
    log "✅ $short deployed"
    # Keep the state file small
    grep -v -e "$remote" "$STATE" > "$STATE.tmp" 2>/dev/null; mv -f "$STATE.tmp" "$STATE" 2>/dev/null || true
  else
    log "❌ $short: deploy.sh failed (attempt $((tries + 1))/$MAX_ATTEMPTS) — see $LOG"
  fi
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
Description=Nexus automatic deployment, every ${INTERVAL:-2min}

[Timer]
OnBootSec=3min
OnUnitActiveSec=${INTERVAL:-2min}
AccuracySec=15s

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now $NAME.timer >/dev/null
  echo "✅ Automatic deployment installed"
  echo "   Every ${INTERVAL:-2min}, as $user: new commit on main + green CI → scripts/deploy.sh"
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
  echo ""; echo "Last events:"
  grep -E '🚀|✅|❌|⏳|⚠️' "$LOG" 2>/dev/null | tail -10 || echo "(none yet)"
}

do_uninstall() {
  need_root uninstall
  systemctl disable --now $NAME.timer 2>/dev/null
  rm -f /etc/systemd/system/$NAME.service /etc/systemd/system/$NAME.timer
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
