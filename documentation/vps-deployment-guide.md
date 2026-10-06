# VPS Deployment Guide — KBrisks Daily Business Operations MVP

This covers deploying **only** the MoneyManager Daily Business Operations
Agent (`scripts/mm-daily-report.ts` and everything under
`lib/moneymanager/`) to a fresh Ubuntu 24.04 VPS. It does not cover
deploying the rest of this repo's Next.js dashboard, and it does not cover
installing or configuring n8n (see section 17-18) — those are separate,
later steps.

Target environment: **Ubuntu 24.04 LTS, Node.js 24, a dedicated non-root
`kbrisks` user.**

A companion bootstrap script (`deploy/vps/setup.sh`) automates the
credential-free, system-level part of this guide (steps 1-4 below). It
contains no secrets and does not clone the repository or touch any `.env`
file - everything involving a real secret or your own git credentials stays
a manual, documented step (sections 5-9).

---

## 1. Ubuntu 24.04 requirements

Any standard Ubuntu 24.04 LTS VPS works — nothing in this codebase needs a
GPU, a specific kernel feature, or unusual packages. Minimum realistic
sizing: 1 vCPU / 1-2 GB RAM is enough for the CLI itself (it processes a
SQLite file in a single Node process; there is no server workload, no
concurrent-request handling). The real disk-space driver is `npm install`
pulling this repo's *entire* dependency tree (Next.js, React, Tailwind,
etc.) even though this MVP only runs one script — there is no separate
package for just the MoneyManager module (a known, accepted limitation, not
addressed by this deployment). Budget accordingly, plus space for however
many MoneyManager snapshot files (`.sqlite3`) you keep — the real production
snapshot this was tested against this session was ~260 MB.

You'll also need outbound HTTPS access from the VPS to `registry.npmjs.org`
**and** `cdn.sheetjs.com` — the `xlsx` dependency in `package.json` is
fetched from the latter, not the npm registry, so `npm install`/`npm ci`
will fail without it.

## 2. Node.js 24 installation

`package.json`'s `engines.node` field requires `>=22` (this application
uses Node's built-in `node:sqlite`, which does not exist before Node 22).
Node 24.x is what this application was actually developed and tested
against this session, and is what `deploy/vps/setup.sh` installs. Use
NodeSource's Ubuntu setup script, **not** `apt install nodejs`, which is
typically far too old:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
node --version   # confirm it reports a v24.x.x version
```

`deploy/vps/setup.sh` does this for you, and skips it if a Node ≥22 is
already present.

## 3. Creating the `kbrisks` non-root service user

```bash
adduser --system --group --no-create-home --shell /usr/sbin/nologin kbrisks
```

No login shell, no home directory, no sudo. Everything below runs as this
user (via `sudo -u kbrisks ...`, or a systemd unit's `User=kbrisks` once a
scheduler is set up — not covered by this guide, see "DO NOT DO YET"
below). `deploy/vps/setup.sh` creates this user if it doesn't already
exist.

## 4. Required directory structure

```
/opt/kbrisks/agent                     <- git clone of this repo (750, kbrisks:kbrisks)
/var/lib/kbrisks/snapshots             <- MoneyManager .sqlite3 files      (700, kbrisks:kbrisks)
/var/lib/kbrisks/mm-daily-report-state <- duplicate-run lock/marker files  (700, kbrisks:kbrisks)
/var/log/kbrisks                       <- log output, if not using journald (750, kbrisks:kbrisks)
/etc/kbrisks/agent.env                 <- the 5 env vars, file itself 640 root:kbrisks
```

The organizing principle: **`/opt/kbrisks/agent/` is the only path a
redeploy should ever touch or replace.** Everything else (secrets,
snapshots, duplicate-run state) lives outside it specifically so a
`git pull`/fresh clone can never destroy operational state or real
financial data. `deploy/vps/setup.sh` creates all of these (except the
`agent.env` file itself, which needs real secret values — see section 7).

## 5. Repository installation

Use a deploy key or a read-only personal access token, not your own
interactive git credentials:

```bash
sudo -u kbrisks git clone <your-repo-url> /opt/kbrisks/agent
cd /opt/kbrisks/agent
```

## 6. `npm ci`

```bash
sudo -u kbrisks npm ci
```

`npm ci` (not `npm install`) installs exactly what `package-lock.json`
pins, which is what you want on a server. `tsx` is a production dependency
as of this session's changes, so `npm ci` (which respects
`--omit=dev` semantics only if you pass that flag — by default `npm ci`
installs devDependencies too) works either way; if you ever add
`--omit=dev` to this command, `tsx` will still be present since it's no
longer a devDependency.

No build step is needed — `tsx` transpiles TypeScript on the fly. This
repo's `next build`/`next start` scripts are for the separate web
dashboard and are irrelevant to this deployment.

## 7. Required environment variables

Copy `deploy/vps/agent.env.example` to `/etc/kbrisks/agent.env` and fill in
real values:

| Variable | Required for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Every real run (persistence + Office Records config load) |
| `SUPABASE_SERVICE_ROLE_KEY` | Same |
| `N8N_WEBHOOK_BASE_URL` | Notification delivery only (see section 18) |
| `N8N_WEBHOOK_SECRET` | Same |
| `MM_DAILY_REPORT_STATE_DIR` | Recommended override — see section 4/13 |

**Important**: this CLI does **not** auto-load `.env.local`-style files —
that's a Next.js dev/build convenience this standalone script doesn't get.
On the VPS, env vars must be supplied to the process explicitly. The
simplest option with Node 24, no wrapper script needed:

```bash
node --env-file=/etc/kbrisks/agent.env node_modules/.bin/tsx scripts/mm-daily-report.ts ...
```

(A systemd unit's `EnvironmentFile=/etc/kbrisks/agent.env` directive is the
equivalent, once a scheduler is set up — not covered by this guide.)

## 8. Permissions for secrets and financial-data snapshots

```bash
chmod 640 /etc/kbrisks/agent.env
chown root:kbrisks /etc/kbrisks/agent.env

chmod 700 /var/lib/kbrisks/snapshots
chown kbrisks:kbrisks /var/lib/kbrisks/snapshots
# each snapshot file, once transferred:
chmod 600 /var/lib/kbrisks/snapshots/*.sqlite3
```

`/var/lib/kbrisks/snapshots/` holds real customer financial data — treat it
like the secret it effectively is. `agent.env` is `640` (root-owned,
group-readable by `kbrisks`) rather than `600` owned by `kbrisks` directly,
so root retains write access for rotation/updates without needing to `su`
to the service account; adjust to `600 kbrisks:kbrisks` instead if you
prefer the service account to own it outright — either is fine as long as
it's never world- or group-other-readable.

## 9. Placing a MoneyManager SQLite snapshot on the VPS

There is **no automated transfer** — see section 19. Manually copy a
`.sqlite3` file (e.g. via `scp`/`rsync` from wherever MoneyManager exports
it) into `/var/lib/kbrisks/snapshots/`, then `chmod 600` it (section 8).

```bash
scp your-export.sqlite3 you@vps-host:/tmp/
sudo -u kbrisks mv /tmp/your-export.sqlite3 /var/lib/kbrisks/snapshots/
sudo chmod 600 /var/lib/kbrisks/snapshots/your-export.sqlite3
```

## 10. Performing the first `--dry-run`

Touches nothing (no Supabase, no n8n) — the safest possible first test:

```bash
cd /opt/kbrisks/agent
sudo -u kbrisks node --env-file=/etc/kbrisks/agent.env node_modules/.bin/tsx scripts/mm-daily-report.ts \
  --snapshot /var/lib/kbrisks/snapshots/your-export.sqlite3 \
  --dry-run
```

Expect the full report printed to stdout, ending with
`(--dry-run: nothing was written to Supabase and nothing was sent.)`, and
exit code `0` if the snapshot was internally consistent (`echo $?`
immediately after to check).

## 11. Performing a real `--no-send` run

Exercises real Supabase persistence without risking a real notification
send:

```bash
sudo -u kbrisks node --env-file=/etc/kbrisks/agent.env node_modules/.bin/tsx scripts/mm-daily-report.ts \
  --snapshot /var/lib/kbrisks/snapshots/your-export.sqlite3 \
  --user-id <a real Supabase user UUID> \
  --no-send
```

## 12. Verifying Supabase persistence

After the run in section 11, in the Supabase SQL editor (or table
browser), confirm a new row appeared in `mm_monitoring_runs` for that
`user_id` with today's `business_date`, and that `mm_findings` has rows
whose `first_seen_run_id`/`last_seen_run_id` match that run's `id`. If the
snapshot had any HIGH/CRITICAL findings, confirm corresponding rows in
`mm_alerts` too.

## 13. Verifying duplicate-run protection

Two checks, both from this session's work, neither needs Supabase:

**Concurrent-run block** — pre-create a lock file for a test key, then try
a real run with matching `--user-id`/`--business-date`:

```bash
touch /var/lib/kbrisks/mm-daily-report-state/run-testuser-2099-01-01.lock
sudo -u kbrisks node --env-file=/etc/kbrisks/agent.env node_modules/.bin/tsx scripts/mm-daily-report.ts \
  --snapshot /var/lib/kbrisks/snapshots/your-export.sqlite3 \
  --user-id testuser --business-date 2099-01-01
echo $?   # expect 5, and "Another run ... is already in progress" printed
rm /var/lib/kbrisks/mm-daily-report-state/run-testuser-2099-01-01.lock
```

**"Already sent" idempotency** — pre-create a sent-marker for a test key:

```bash
echo '{"runId":"test","sentAt":"2099-01-01T00:00:00.000Z"}' > \
  /var/lib/kbrisks/mm-daily-report-state/sent-testuser-2099-01-01.json
sudo -u kbrisks node --env-file=/etc/kbrisks/agent.env node_modules/.bin/tsx scripts/mm-daily-report.ts \
  --snapshot /var/lib/kbrisks/snapshots/your-export.sqlite3 \
  --user-id testuser --business-date 2099-01-01
echo $?   # expect 0, and "was already sent ... not re-sending" printed
rm /var/lib/kbrisks/mm-daily-report-state/sent-testuser-2099-01-01.json
```

Both commands exit before ever touching Supabase, so they're safe to run
even before `agent.env` has real values filled in.

## 14. Inspecting exit codes

`echo $?` immediately after any invocation. Meanings (`scripts/mm-daily-report.ts`'s
`EXIT_CODES`):

| Code | Meaning |
|---|---|
| `0` | Success — monitoring completed, and (no send required, or it succeeded) |
| `1` | Invalid usage (missing `--snapshot` or `--user-id`) |
| `2` | Snapshot couldn't be opened (`--dry-run` only) |
| `3` | Monitoring completed but the required notification send failed |
| `4` | The monitoring run itself was `incomplete` or `failed` |
| `5` | Blocked — another run for the same user/business-date was already in progress |

## 15. Configuring logging

This CLI deliberately has no logging framework — it only writes to
stdout/stderr. Two options, neither implemented by this guide (no scheduler
is set up yet — see "DO NOT DO YET"):

- **systemd timer + oneshot service** (recommended, when you get there):
  stdout/stderr go to `journald` automatically, rotated by journald's own
  retention policy — nothing extra to configure.
- **cron**: redirect manually, e.g.
  `>> /var/log/kbrisks/mm-daily-report.log 2>&1` in the crontab line, plus
  a `logrotate` config under `/etc/logrotate.d/kbrisks` (daily, keep ~30,
  compress) since this would otherwise grow forever.

Either way, `mm_monitoring_runs`/`mm_findings` in Supabase remain the
durable, structured audit trail — the log file is for debugging the
*process*, not the primary record.

## 16. Basic UFW/SSH security

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp     # SSH - ideally key-only auth, consider fail2ban too
ufw enable
```

This MVP opens **no ports at all** — it's a batch script, not a server —
so no other inbound rule is needed yet. Revisit this once n8n is installed
(section 17).

## 17. How the future n8n installation will coexist with the KBrisks Agent

`deploy/n8n/docker-compose.yml` (already in this repo, unmodified) runs n8n
in its own Docker container — fully isolated from this Agent: separate
process, separate filesystem, separate runtime/`node_modules` entirely (a
container image, not anything under `/opt/kbrisks/agent`). The two systems
only ever meet over HTTP, at the point where `N8nWebhookNotificationSender`
calls n8n's webhook. When you're ready for that step: run n8n bound to
`127.0.0.1:5678` (not the public interface), with its own data volume under
e.g. `/var/lib/kbrisks/n8n/`. No port conflict is possible since the Agent
never listens on any port. **Not installed by this deployment** — see
"DO NOT DO YET".

## 18. n8n and notification delivery — explicit statement

**n8n is NOT required for report generation.** A real run with
`N8N_WEBHOOK_BASE_URL`/`N8N_WEBHOOK_SECRET` unset or unreachable still
completes the full pipeline — MoneyManager snapshot read, all 11 rules,
classification, report building, and persistence to
`mm_monitoring_runs`/`mm_findings`/`mm_alerts` — it only fails at the very
last step (the notification send itself, exit code `3`). **n8n IS
currently required** for the one thing this MVP can't do without it:
actually notifying the manager by email/Telegram, since
`N8nWebhookNotificationSender` is the only `NotificationSender`
implementation that exists today.

## 19. Live MoneyManager extraction — explicit statement

**Not implemented.** This deployment only supports the manually-supplied
offline snapshot path (`SnapshotReader` / `--snapshot <path>`). The live
LAN API adapter (`LanApiSource`) exists in the codebase and is unit-tested,
but nothing wires it into this CLI, and this deployment does not change
that.

## 20. Automatic snapshot transfer — explicit statement

**Not implemented.** Getting a fresh `.sqlite3` file from MoneyManager onto
this VPS (section 9) is a manual step you perform yourself, on whatever
cadence you choose, using whatever transfer method you prefer (`scp`,
`rsync`, etc.). Nothing in this repo automates that transfer.

---

## DO NOT DO YET

The following are explicitly out of scope for this deployment and are not
implemented anywhere in this guide or its accompanying scripts:

- Live MoneyManager extraction (the LAN API adapter exists in code but is
  not wired into the CLI).
- Automatic snapshot transfer onto the VPS.
- n8n installation/configuration on this VPS.
- Any scheduler for the daily job (cron/systemd timer) — this guide only
  covers manual invocation for verification; running it automatically every
  day is a separate, later step.
- Office Records settings UI (the six Google Sheets URLs are still only
  configurable by hand, directly in Supabase).
- Any full autonomous financial action of any kind — this system is, and
  remains, read-only and advisory. Nothing it does writes to MoneyManager,
  approves anything, or moves money.

---

## Summary: exact deployment procedure

```bash
# --- as root, on the fresh Ubuntu 24.04 VPS ---
sudo bash deploy/vps/setup.sh          # (after copying this repo there some way, or pasting the script)

# --- as yourself, with git access to the repo ---
sudo -u kbrisks git clone <repo-url> /opt/kbrisks/agent
cd /opt/kbrisks/agent
sudo -u kbrisks npm ci

# --- secrets (you provide the real values) ---
cp deploy/vps/agent.env.example /etc/kbrisks/agent.env
# edit /etc/kbrisks/agent.env with real values
chmod 640 /etc/kbrisks/agent.env && chown root:kbrisks /etc/kbrisks/agent.env

# --- snapshot (you transfer this yourself, see section 9) ---
# scp/rsync a .sqlite3 file into /var/lib/kbrisks/snapshots/, then chmod 600 it

# --- verify, in this order ---
# 1. --dry-run (section 10)
# 2. real --no-send run (section 11), then check Supabase (section 12)
# 3. duplicate-run protection checks (section 13) - safe, no Supabase needed
```

## What you must provide manually

- SSH access to the VPS.
- Git repository URL + a deploy key or read-only access token.
- Real `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.
- The real Supabase user UUID to run reports as.
- A MoneyManager `.sqlite3` snapshot file, transferred by you.
- `N8N_WEBHOOK_BASE_URL`/`N8N_WEBHOOK_SECRET` — only once you're ready to
  install n8n and test real delivery; can stay blank until then.
