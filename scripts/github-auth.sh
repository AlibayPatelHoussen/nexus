# shellcheck shell=bash
# ══════════════════════════════════════════════════════════════════════
#  Nexus — GitHub access for a private repository
#
#  Sourced by deploy.sh and auto-deploy.sh. A public repository needs
#  nothing. A private one needs a read-only token, saved once with
#    sudo bash scripts/auto-deploy.sh set-token
#  (GITHUB_TOKEN=… in /etc/default/nexus-auto-deploy, readable by root and
#  the user that runs Nexus only).
#
#  The token goes to git through environment variables (GIT_CONFIG_*,
#  git ≥ 2.31), never on a command line (ps would show it to every user)
#  and never in .git/config.
# ══════════════════════════════════════════════════════════════════════

NEXUS_GITHUB_CONF=${NEXUS_GITHUB_CONF:-/etc/default/nexus-auto-deploy}

if [ -z "${GITHUB_TOKEN:-}" ] && [ -r "$NEXUS_GITHUB_CONF" ]; then
  GITHUB_TOKEN=$(sed -n 's/^GITHUB_TOKEN=//p' "$NEXUS_GITHUB_CONF" | tail -1 | tr -d "\"' \r")
fi

if [ -n "${GITHUB_TOKEN:-}" ]; then
  export GITHUB_TOKEN
  export GIT_CONFIG_COUNT=1
  export GIT_CONFIG_KEY_0='http.https://github.com/.extraheader'
  GIT_CONFIG_VALUE_0="Authorization: Basic $(printf 'x-access-token:%s' "$GITHUB_TOKEN" | base64 | tr -d '\n')"
  export GIT_CONFIG_VALUE_0
fi
