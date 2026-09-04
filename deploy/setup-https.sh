#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Activa HTTPS con Let's Encrypt.
#
# Uso:
#   sudo DOMAIN=20-1-2-3.sslip.io EMAIL=jlmunoz@pancanal.com \
#        bash deploy/setup-https.sh
#
# Si omites DOMAIN, calcula uno con sslip.io a partir de la IP pública actual.
# Si omites EMAIL, usa admin@$DOMAIN (Let's Encrypt lo requiere para avisos
# de expiración).
#
# Requisitos previos:
# - Nginx corriendo con el sitio inio-bim configurado (aunque sea sin SSL).
# - Puertos 80 y 443 abiertos en el NSG.
# - certbot instalado (el script lo instala si falta).
# - El dominio (DOMAIN) resuelve a la IP pública de esta VM.
#
# Idempotente: si el cert ya existe y está vigente, no reemite.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

log()  { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }
err()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; }

if [[ $EUID -ne 0 ]]; then
  err "setup-https.sh debe correr como root (usar sudo)"
  exit 1
fi

# ── 1. Determinar DOMAIN si no vino por env ─────────────────────────────────
if [[ -z "${DOMAIN:-}" ]]; then
  log "DOMAIN no definido; calculando subdominio sslip.io desde la IP pública"
  PUBLIC_IP=$(curl -fsS --max-time 5 https://api.ipify.org)
  # sslip.io acepta la IP con guiones o con puntos; con guiones evita ambigüedad.
  DOMAIN="${PUBLIC_IP//./-}.sslip.io"
  log "DOMAIN calculado: $DOMAIN"
fi

EMAIL="${EMAIL:-admin@${DOMAIN}}"

# ── 2. Instalar certbot si falta ────────────────────────────────────────────
if ! command -v certbot >/dev/null 2>&1; then
  log "Instalando certbot + plugin nginx"
  apt-get update -qq
  apt-get install -y -qq certbot python3-certbot-nginx
fi

# ── 3. Directorio para ACME challenge (webroot fallback) ────────────────────
mkdir -p /var/www/certbot
chown www-data:www-data /var/www/certbot

# ── 4. Verificar que el sitio nginx template está instalado y renderizado ──
NGINX_TEMPLATE="/opt/inio-bim/deploy/nginx-inio-bim.conf"
NGINX_SITE="/etc/nginx/sites-available/inio-bim"

if [[ ! -f "$NGINX_TEMPLATE" ]]; then
  err "No existe $NGINX_TEMPLATE. Corre esto tras el primer deploy."
  exit 1
fi

log "Renderizando plantilla nginx con DOMAIN=$DOMAIN"
DOMAIN="$DOMAIN" envsubst '${DOMAIN}' < "$NGINX_TEMPLATE" > "$NGINX_SITE"
ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/inio-bim
rm -f /etc/nginx/sites-enabled/default

# ── 5. Pre-check: nginx debe poder cargar aunque falten los certs ──────────
# Si es el primer setup, los paths /etc/letsencrypt/live/... no existen todavía.
# Estrategia: dejar temporalmente un sitio HTTP-only para que certbot pueda
# hacer el challenge, luego renderizar el template completo.
if [[ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
  log "Primer setup: creando sitio temporal HTTP-only para el challenge"
  cat > "$NGINX_SITE" <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name $DOMAIN;
    root /var/www/inio-bim;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 200 "OK - awaiting cert\n"; add_header Content-Type text/plain; }
}
EOF
  nginx -t
  systemctl reload nginx

  log "Emitiendo cert Let's Encrypt para $DOMAIN (email: $EMAIL)"
  certbot certonly \
    --webroot -w /var/www/certbot \
    -d "$DOMAIN" \
    --email "$EMAIL" \
    --agree-tos --no-eff-email \
    --deploy-hook "systemctl reload nginx" \
    --non-interactive
else
  log "Cert existente detectado para $DOMAIN; se conserva"
fi

# -- Renewal hook global ----------------------------------------------------
# El --deploy-hook de arriba solo se graba en el renewal.conf al momento de
# emitir. Este hook cubre TODOS los certs, incluidos los emitidos antes de que
# existiera esa linea. Sin el, certbot.timer renueva pero nginx sigue sirviendo
# el cert viejo hasta un reload manual -- y expira en produccion.
log "Instalando renewal hook (reload de nginx tras cada renovacion)"
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh <<'HOOKEOF'
#!/usr/bin/env bash
# Instalado por deploy/setup-https.sh -- recarga nginx tras renovar un cert.
set -e
systemctl reload nginx
HOOKEOF
chmod 755 /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

# ── 6. Renderizar el template final con SSL activo ─────────────────────────
log "Aplicando configuración nginx final (con SSL)"
DOMAIN="$DOMAIN" envsubst '${DOMAIN}' < "$NGINX_TEMPLATE" > "$NGINX_SITE"

# Certbot genera estos archivos; si no existen, los creamos con defaults seguros.
if [[ ! -f /etc/letsencrypt/options-ssl-nginx.conf ]]; then
  log "Creando /etc/letsencrypt/options-ssl-nginx.conf (fallback Mozilla intermediate)"
  cat > /etc/letsencrypt/options-ssl-nginx.conf <<'EOF'
ssl_session_cache shared:le_nginx_SSL:10m;
ssl_session_timeout 1440m;
ssl_session_tickets off;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
ssl_ciphers "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384";
EOF
fi

if [[ ! -f /etc/letsencrypt/ssl-dhparams.pem ]]; then
  log "Generando dhparams (esto toma ~30s)"
  openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048
fi

nginx -t
systemctl reload nginx

# ── 7. Verificar y activar el timer de auto-renewal ────────────────────────
# El paquete certbot de Ubuntu instala systemd timer certbot.timer que
# corre 2x al día y renueva certs que expiran en <30 días.
log "Activando systemd timer de renewal"
systemctl enable --now certbot.timer

log "Estado del timer:"
systemctl list-timers certbot.timer --no-pager | head -5 || true

# ── 8. Test de renewal (dry-run) ───────────────────────────────────────────
log "Test dry-run de renewal (no toca nada real)"
certbot renew --dry-run --quiet

# ── 9. Verificación final ──────────────────────────────────────────────────
log "Verificando que HTTPS responde"
sleep 2
if curl -fsS --max-time 10 "https://$DOMAIN/admin/" >/dev/null; then
  log "✅ HTTPS activo en https://$DOMAIN/"
else
  warn "curl a https://$DOMAIN/admin/ no dio 200/302. Revisa journalctl -u nginx."
fi

cat <<EOF

═══════════════════════════════════════════════════════════════════
✅ HTTPS configurado para $DOMAIN

Siguiente:
1. Actualizar /opt/inio-bim/.env:
     ALLOWED_HOSTS=$DOMAIN,127.0.0.1,localhost
     CORS_ALLOWED_ORIGINS=https://$DOMAIN
     USE_HTTPS=True
2. Reiniciar gunicorn:
     sudo systemctl restart inio-bim.service
3. Verificar en el navegador: https://$DOMAIN/admin/
═══════════════════════════════════════════════════════════════════
EOF
