#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Script de aplicación de deploy — corrido por GitHub Actions vía sudo.
#
# Precondición: los directorios /tmp/deploy-backend y /tmp/deploy-frontend
# existen y contienen los últimos artefactos (rsync desde el workflow).
#
# Este script debe correr como root. Se configura via /etc/sudoers.d/ para
# que azureuser pueda invocarlo sin password.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

log()  { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }
err()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; }

if [[ $EUID -ne 0 ]]; then
  err "apply.sh debe correr como root (usar sudo)"
  exit 1
fi

BACKEND_SRC="/tmp/deploy-backend"
FRONTEND_SRC="/tmp/deploy-frontend"
BACKEND_DST="/opt/inio-bim"
FRONTEND_DST="/var/www/inio-bim"
APP_USER="inio"

if [[ ! -d "$BACKEND_SRC" ]]; then
  err "Falta $BACKEND_SRC — el workflow no hizo rsync del backend"
  exit 1
fi

if [[ ! -d "$FRONTEND_SRC" ]]; then
  err "Falta $FRONTEND_SRC — el workflow no hizo rsync del frontend"
  exit 1
fi

# ── 0. Backup pre-deploy (BD + media) ─────────────────────────────────────────
# Aborta el deploy si el backup falla; es cheap insurance.
BACKUP_SCRIPT="$BACKEND_SRC/deploy/pre-deploy-backup.sh"
if [[ -x "$BACKUP_SCRIPT" ]]; then
  log "Corriendo backup pre-deploy"
  bash "$BACKUP_SCRIPT"
else
  warn "$BACKUP_SCRIPT no existe o no es ejecutable; skip backup"
fi

# ── 1. Sincronizar backend ────────────────────────────────────────────────────
log "Sincronizando código backend a $BACKEND_DST"
rsync -a --delete \
  --exclude 'venv/' \
  --exclude '__pycache__/' \
  --exclude '*.pyc' \
  --exclude '.env' \
  --exclude 'db.sqlite3' \
  --exclude 'media/' \
  --exclude 'staticfiles/' \
  "$BACKEND_SRC/" "$BACKEND_DST/"
chown -R "$APP_USER:$APP_USER" "$BACKEND_DST"

# ── 2. Sincronizar frontend ───────────────────────────────────────────────────
log "Sincronizando frontend a $FRONTEND_DST"
rsync -a --delete "$FRONTEND_SRC/" "$FRONTEND_DST/"
chown -R www-data:www-data "$FRONTEND_DST"

# ── 3. Dependencias Python ────────────────────────────────────────────────────
log "Instalando dependencias Python (si hay cambios)"
sudo -u "$APP_USER" "$BACKEND_DST/venv/bin/pip" install \
  --quiet --disable-pip-version-check \
  -r "$BACKEND_DST/requirements.txt"

# ── 4. Migrate ────────────────────────────────────────────────────────────────
log "Aplicando migraciones"
sudo -u "$APP_USER" bash -c "cd $BACKEND_DST && venv/bin/python manage.py migrate --noinput"

# ── 5. Collectstatic ──────────────────────────────────────────────────────────
log "Collectstatic"
sudo -u "$APP_USER" bash -c "cd $BACKEND_DST && venv/bin/python manage.py collectstatic --noinput --clear"

# ── 6. Reiniciar gunicorn ─────────────────────────────────────────────────────
log "Reiniciando servicio inio-bim"
systemctl restart inio-bim.service

# ── 7. Verificar que el servicio quedó activo ─────────────────────────────────
sleep 2
if systemctl is-active --quiet inio-bim.service; then
  log "✅ inio-bim.service está corriendo"
else
  err "gunicorn no quedó activo tras el restart"
  systemctl status inio-bim.service --no-pager || true
  exit 1
fi

# ── 8. Limpieza ───────────────────────────────────────────────────────────────
rm -rf "$BACKEND_SRC" "$FRONTEND_SRC"

log "Deploy completado en $(date '+%Y-%m-%d %H:%M:%S')"
