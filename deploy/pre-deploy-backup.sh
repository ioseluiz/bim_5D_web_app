#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Backup pre-deploy — corre antes de sincronizar código nuevo.
#
# Hace:
# - pg_dump de biminiodb  → /var/backups/inio-bim/db-YYYYMMDD-HHMMSS.sql.gz
# - tar de /opt/inio-bim/media → /var/backups/inio-bim/media-YYYYMMDD-HHMMSS.tar.gz
# - retiene solo los últimos 14 backups por tipo (~2 semanas si hay 1 deploy/día)
#
# Se invoca desde apply.sh, o manualmente en la VM con:
#   sudo bash /opt/inio-bim/deploy/pre-deploy-backup.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

log()  { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "pre-deploy-backup.sh debe correr como root" >&2
  exit 1
fi

BACKUP_DIR="/var/backups/inio-bim"
RETAIN=14
STAMP=$(date -u +%Y%m%d-%H%M%SZ)

mkdir -p "$BACKUP_DIR"
chmod 750 "$BACKUP_DIR"

DB_NAME="${DB_NAME:-biminiodb}"
DB_USER="${DB_USER:-inioadmin}"
MEDIA_DIR="/opt/inio-bim/media"

# ── 1. pg_dump ──────────────────────────────────────────────────────────────
DB_FILE="$BACKUP_DIR/db-$STAMP.sql.gz"
log "pg_dump $DB_NAME → $DB_FILE"

# `sudo -u postgres` no necesita password (peer auth para postgres user).
# Si la BD está en managed Postgres, cambiar a: PGPASSWORD=... pg_dump -h ...
if sudo -u postgres pg_dump --format=plain --no-owner --no-privileges "$DB_NAME" | gzip > "$DB_FILE"; then
  log "  OK ($(du -h "$DB_FILE" | cut -f1))"
else
  warn "pg_dump falló — revisa que $DB_NAME exista y que peer auth funcione"
  rm -f "$DB_FILE"
  exit 1
fi

# ── 2. media tar.gz ─────────────────────────────────────────────────────────
if [[ -d "$MEDIA_DIR" ]]; then
  MEDIA_FILE="$BACKUP_DIR/media-$STAMP.tar.gz"
  log "tar $MEDIA_DIR → $MEDIA_FILE"
  # `-P` para preservar paths absolutos; `--warning=no-file-changed` para
  # evitar fallo si un IFC se sube durante el tar.
  if tar --warning=no-file-changed -czf "$MEDIA_FILE" -C "$(dirname "$MEDIA_DIR")" "$(basename "$MEDIA_DIR")"; then
    log "  OK ($(du -h "$MEDIA_FILE" | cut -f1))"
  else
    warn "tar de media falló (no bloquea deploy)"
  fi
else
  warn "$MEDIA_DIR no existe (aún); skip media backup"
fi

# ── 3. Retención ────────────────────────────────────────────────────────────
prune() {
  local pattern="$1"
  # shellcheck disable=SC2010  # ls es más simple aquí
  ls -1t "$BACKUP_DIR"/$pattern 2>/dev/null | tail -n +$((RETAIN + 1)) | while read -r f; do
    rm -f "$f"
    log "  pruned $(basename "$f")"
  done
}
log "Retención: manteniendo últimos $RETAIN de cada tipo"
prune "db-*.sql.gz"
prune "media-*.tar.gz"

log "✅ Backup completado ($STAMP)"
