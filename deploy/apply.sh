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

# ── 2b. Configuración de nginx (plantilla + hardening) ────────────────────────
# Sin este paso la config de nginx del repo nunca llegaba a /etc/nginx/ y había
# que aplicar cada cambio por SSH a mano.
log "Instalando configuración de nginx"

NGINX_SITE="/etc/nginx/sites-available/inio-bim"
NGINX_BAK="/tmp/nginx-inio-bim.bak.$$"
NGINX_SNIPPETS="/etc/nginx/snippets"

# El dominio es el primer valor de ALLOWED_HOSTS en el .env — única fuente de
# verdad, así no hay que mantenerlo en dos sitios.
DOMAIN=$(grep -E '^ALLOWED_HOSTS=' "$BACKEND_DST/.env" 2>/dev/null | cut -d= -f2- | cut -d, -f1 | tr -d '[:space:]')

if [[ -z "$DOMAIN" ]]; then
  err "No pude leer el dominio de ALLOWED_HOSTS en $BACKEND_DST/.env"
  exit 1
fi
log "  dominio: $DOMAIN"

# Backup de la config viva para poder revertir si nginx -t falla.
if [[ -f "$NGINX_SITE" ]]; then
  cp -a "$NGINX_SITE" "$NGINX_BAK"
fi

mkdir -p "$NGINX_SNIPPETS"
install -m 644 "$BACKEND_DST/deploy/nginx-security-headers.conf" "$NGINX_SNIPPETS/inio-bim-security-headers.conf"
install -m 644 "$BACKEND_DST/deploy/nginx-hardening.conf" /etc/nginx/conf.d/inio-bim-hardening.conf

DOMAIN="$DOMAIN" envsubst '${DOMAIN}' < "$BACKEND_DST/deploy/nginx-inio-bim.conf" > "$NGINX_SITE"
ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/inio-bim
rm -f /etc/nginx/sites-enabled/default

# Validar ANTES de recargar. Si la config nueva no parsea, restaurar la
# anterior y abortar sin tocar el nginx que está sirviendo.
if ! nginx -t 2>/tmp/nginx-test.err; then
  err "nginx -t falló con la configuración nueva:"
  cat /tmp/nginx-test.err >&2
  if [[ -f "$NGINX_BAK" ]]; then
    warn "Restaurando configuración anterior"
    cp -a "$NGINX_BAK" "$NGINX_SITE"
    nginx -t && log "Config anterior restaurada; nginx sigue sirviendo la versión previa"
  fi
  exit 1
fi

systemctl reload nginx
log "  nginx recargado"
rm -f "$NGINX_BAK"

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
