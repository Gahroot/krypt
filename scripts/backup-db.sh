#!/usr/bin/env bash
# backup-db.sh — host-cron DB backup for the production stack.
#
# Alternative to the in-stack `backup` service: run this from the HOST's crontab.
# It produces a consistent snapshot inside the running server container (so it is
# safe while players are online), copies it OUT of the container onto the host,
# and — if BACKUP_REMOTE_CMD is set — ships it off-box. The snapshot path is
# substituted for the literal token {} in BACKUP_REMOTE_CMD.
#
# Example crontab (daily at 04:17, log to a file):
#   17 4 * * * cd /opt/cryptomaple && BACKUP_REMOTE_CMD='rclone copy {} remote:maple-backups' \
#     ./scripts/backup-db.sh >> /var/log/maple-backup.log 2>&1
#
# Env:
#   COMPOSE_FILE   compose file (default docker-compose.prod.yml)
#   ENV_FILE       env file passed to compose (default .env.production)
#   HOST_BACKUP_DIR  where snapshots are copied on the host (default ./backups)
#   BACKUP_REMOTE_CMD  off-box upload, e.g. 'aws s3 cp {} s3://my-bucket/maple/'
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
HOST_BACKUP_DIR="${HOST_BACKUP_DIR:-./backups}"

dc() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

mkdir -p "$HOST_BACKUP_DIR"

# 1) Consistent snapshot inside the live server container; capture its path.
snap_in_container="$(dc exec -T server node --import tsx packages/server/scripts/db-backup.ts | tail -n1)"
echo "[backup-db] container snapshot: $snap_in_container"

# 2) Copy it out onto the host.
base="$(basename "$snap_in_container")"
host_path="$HOST_BACKUP_DIR/$base"
dc cp "server:$snap_in_container" "$host_path"
echo "[backup-db] copied to host: $host_path"

# 3) Off-box (optional but STRONGLY recommended — the host disk is not a backup).
if [ -n "${BACKUP_REMOTE_CMD:-}" ]; then
  cmd="${BACKUP_REMOTE_CMD//\{\}/$host_path}"
  echo "[backup-db] off-box upload: $cmd"
  sh -c "$cmd"
  echo "[backup-db] off-box upload OK"
else
  echo "[backup-db] WARN BACKUP_REMOTE_CMD unset — snapshot is only on this host (NOT off-box)"
fi
