#!/bin/sh
# backup-loop.sh — periodic DB backup scheduler for the production stack.
#
# Used as the command of the `backup` service in docker-compose.prod.yml. Every
# BACKUP_INTERVAL_SECONDS it produces a consistent snapshot via db:backup, then —
# if BACKUP_REMOTE_CMD is set — ships that snapshot OFF-BOX. The snapshot path is
# substituted for the literal token {} in BACKUP_REMOTE_CMD.
#
#   BACKUP_INTERVAL_SECONDS  seconds between backups (default 86400 = daily)
#   BACKUP_DIR               where snapshots land    (default /app/data/backups)
#   BACKUP_RETENTION         local snapshots to keep (default 14)
#   BACKUP_REMOTE_CMD        off-box upload, e.g. 'rclone copy {} remote:maple-backups'
#                            or 'aws s3 cp {} s3://my-bucket/maple/'
set -eu

INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
echo "[backup-loop] starting — interval=${INTERVAL}s dir=${BACKUP_DIR:-/app/data/backups} retention=${BACKUP_RETENTION:-14}"

while true; do
  if snap="$(node --import tsx packages/server/scripts/db-backup.ts | tail -n1)"; then
    echo "[backup-loop] snapshot: $snap"
    if [ -n "${BACKUP_REMOTE_CMD:-}" ]; then
      cmd="$(printf '%s' "$BACKUP_REMOTE_CMD" | sed "s#{}#${snap}#g")"
      echo "[backup-loop] off-box upload: $cmd"
      if sh -c "$cmd"; then
        echo "[backup-loop] off-box upload OK"
      else
        echo "[backup-loop] WARN off-box upload failed — will retry next cycle"
      fi
    else
      echo "[backup-loop] WARN BACKUP_REMOTE_CMD unset — snapshot kept only in the local volume (NOT off-box)"
    fi
  else
    echo "[backup-loop] ERROR db:backup failed"
  fi
  sleep "$INTERVAL"
done
