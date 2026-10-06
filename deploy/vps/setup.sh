#!/usr/bin/env bash
# KBrisks Daily Business Operations Agent - VPS system-level bootstrap
# (Ubuntu 24.04). Idempotent: safe to re-run without side effects if
# already applied. Contains NO secrets and does NOT accept or store any -
# see deploy/vps/agent.env.example / documentation/vps-deployment-guide.md
# for the (manual) steps this script deliberately does NOT do:
#   - cloning the application repository (needs your own git credentials)
#   - running `npm ci` (needs the repo already cloned)
#   - creating /etc/kbrisks/agent.env (needs real secret values)
#   - transferring a MoneyManager snapshot
#   - installing/configuring n8n (a separate, later step)
#   - setting up any scheduler (cron/systemd timer) - not built yet
#
# This script only does system-level, credential-free prep:
#   1. Creates the non-root 'kbrisks' system service user.
#   2. Installs Node.js 24.x via NodeSource, if a Node >=22 isn't already
#      present (package.json's engines.node requirement; 24.x is what this
#      application was actually developed and tested against).
#   3. Creates the directory structure documentation/vps-deployment-guide.md
#      describes, with ownership/permissions matching it.
#
# Usage: sudo bash deploy/vps/setup.sh
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "This script must be run as root, e.g.: sudo bash deploy/vps/setup.sh" >&2
  exit 1
fi

SERVICE_USER="kbrisks"
REQUIRED_NODE_MAJOR=22

echo "== 1/3: service user =="
if id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  echo "User '${SERVICE_USER}' already exists - skipping."
else
  adduser --system --group --no-create-home --shell /usr/sbin/nologin "${SERVICE_USER}"
  echo "Created system user '${SERVICE_USER}'."
fi

echo "== 2/3: Node.js >=${REQUIRED_NODE_MAJOR} (targeting 24.x) =="
CURRENT_NODE_MAJOR=0
if command -v node >/dev/null 2>&1; then
  CURRENT_NODE_MAJOR="$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))' 2>/dev/null || echo 0)"
fi

if [[ "${CURRENT_NODE_MAJOR}" -ge "${REQUIRED_NODE_MAJOR}" ]]; then
  echo "Node.js already installed (major version ${CURRENT_NODE_MAJOR} >= ${REQUIRED_NODE_MAJOR}) - skipping install."
else
  echo "Installing Node.js 24.x via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
echo "node: $(node --version 2>/dev/null || echo 'not found - install failed, check above output')"

echo "== 3/3: directory structure =="
install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 750 /opt/kbrisks
install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 750 /opt/kbrisks/agent
install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 700 /var/lib/kbrisks
install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 700 /var/lib/kbrisks/snapshots
install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 700 /var/lib/kbrisks/mm-daily-report-state
install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 750 /var/log/kbrisks
install -d -o root -g root -m 750 /etc/kbrisks

cat <<EOF

System-level setup complete. Remaining steps are manual - see
documentation/vps-deployment-guide.md for exact commands:
  1. Clone the application repository into /opt/kbrisks/agent as ${SERVICE_USER}.
  2. Run 'npm ci' there as ${SERVICE_USER}.
  3. Copy deploy/vps/agent.env.example to /etc/kbrisks/agent.env, fill in
     real values, then: chmod 640 /etc/kbrisks/agent.env &&
     chown root:${SERVICE_USER} /etc/kbrisks/agent.env
  4. Transfer a MoneyManager .sqlite3 snapshot into /var/lib/kbrisks/snapshots/.
  5. Run a --dry-run, then a real --no-send run, to verify end to end.
EOF
