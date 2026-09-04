#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Utilidad para obtener las credenciales actuales de los recursos Azure
# provisionados por azure-provision.sh.
#
# Casos de uso:
#   - Rotaste la storage key en el portal y necesitas el nuevo valor
#   - Cambió la IP pública de la VM y hay que actualizar el firewall de Postgres
#   - Perdiste el .env y quieres regenerarlo
#
# Uso:
#   bash deploy/azure-get-secrets.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROJECT="inio-bim"
RG="rg-${PROJECT}-prod"
VM_NAME="vm-${PROJECT}"
PG_SERVER="psql-${PROJECT}"
PG_ADMIN="inioadmin"
PG_DB="biminicadb"
MEDIA_CONTAINER="bim-media"

log() { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }

# ── Datos de red ──────────────────────────────────────────────────────────────
VM_IP="$(az vm show -d -g "$RG" -n "$VM_NAME" --query publicIps -o tsv)"
PG_HOST="$(az postgres flexible-server show -g "$RG" -n "$PG_SERVER" --query fullyQualifiedDomainName -o tsv)"

# ── Reafirma firewall Postgres a la IP actual de la VM ────────────────────────
log "Actualizando firewall Postgres para IP ${VM_IP}"
az postgres flexible-server firewall-rule create \
  --resource-group "$RG" --name "$PG_SERVER" \
  --rule-name "vm-${VM_NAME}" \
  --start-ip-address "$VM_IP" --end-ip-address "$VM_IP" \
  --output none 2>/dev/null || \
az postgres flexible-server firewall-rule update \
  --resource-group "$RG" --name "$PG_SERVER" \
  --rule-name "vm-${VM_NAME}" \
  --start-ip-address "$VM_IP" --end-ip-address "$VM_IP" \
  --output none

# ── Storage key actual ────────────────────────────────────────────────────────
STORAGE_ACCOUNT="$(az storage account list -g "$RG" --query "[?starts_with(name, 'stinioibim')].name | [0]" -o tsv)"
if [[ -z "$STORAGE_ACCOUNT" ]]; then
  echo "ERROR: no se encontró Storage Account con prefijo stinioibim en $RG" >&2
  exit 1
fi
STORAGE_KEY="$(az storage account keys list -g "$RG" -n "$STORAGE_ACCOUNT" --query '[0].value' -o tsv)"

# ── Postgres password (no se puede leer desde Azure; recordatorio) ────────────
cat <<EOF

╔══════════════════════════════════════════════════════════════════════════════╗
║  Credenciales actuales                                                       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  VM public IP:        $VM_IP
║  Postgres host:       $PG_HOST
║  Storage account:     $STORAGE_ACCOUNT
╚══════════════════════════════════════════════════════════════════════════════╝

.env sugerido (⚠ pega el PostgreSQL password manualmente donde dice PASSWORD):

──────────────────────────────────────────────────────────────────────────────
DJANGO_SETTINGS_MODULE=config.settings.production
SECRET_KEY=<no lo cambies si ya está en producción; genera uno nuevo solo si es el primer deploy>
ALLOWED_HOSTS=${VM_IP}
DATABASE_URL=postgres://${PG_ADMIN}:PASSWORD@${PG_HOST}:5432/${PG_DB}?sslmode=require
CORS_ALLOWED_ORIGINS=http://${VM_IP}
AZURE_ACCOUNT_NAME=${STORAGE_ACCOUNT}
AZURE_ACCOUNT_KEY=${STORAGE_KEY}
AZURE_MEDIA_CONTAINER=${MEDIA_CONTAINER}
──────────────────────────────────────────────────────────────────────────────

EOF
