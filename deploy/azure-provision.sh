#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Provisiona los recursos de Azure para INIO BIM 4D/5D.
#
# Idempotente: se puede volver a correr; los recursos que ya existen no se
# recrean. Se apoya en Azure CLI (`az`) y jq (opcional, para pretty-print).
#
# Prerequisitos:
#   - az login (Azure Cloud Shell ya viene autenticado)
#   - az account set --subscription "<tu-subscription-id>"
#
# Uso:
#   export POSTGRES_ADMIN_PASSWORD='...'        # obligatorio, ≥8 chars
#   export SSH_PUBLIC_KEY_PATH="$HOME/.ssh/id_rsa.pub"   # opcional
#   bash deploy/azure-provision.sh
#
# Al terminar imprime las variables que hay que copiar a /opt/inio-bim/.env
# en la VM.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Parámetros ────────────────────────────────────────────────────────────────
PROJECT="inio-bim"
LOCATION="eastus2"

RG="rg-${PROJECT}-prod"
VM_NAME="vm-${PROJECT}"
VM_SIZE="Standard_B2s"
VM_IMAGE="Ubuntu2204"
VM_ADMIN="azureuser"

PG_SERVER="psql-${PROJECT}"                     # DNS name, debe ser único global
PG_ADMIN="inioadmin"
PG_DB="biminicadb"
PG_VERSION="16"
PG_TIER="Burstable"
PG_SKU="Standard_B1ms"
PG_STORAGE_GB="32"

# Storage: nombre debe ser 3-24 chars, solo minúsculas + números, único global.
STORAGE_ACCOUNT="stinioibim$(printf '%04d' $((RANDOM % 10000)))"
# ↑ sufijo aleatorio para evitar colisión. Al re-correr, si ya existe uno,
#   se detecta abajo y se reutiliza.
MEDIA_CONTAINER="bim-media"

: "${POSTGRES_ADMIN_PASSWORD:?Debes exportar POSTGRES_ADMIN_PASSWORD}"
SSH_PUBLIC_KEY_PATH="${SSH_PUBLIC_KEY_PATH:-$HOME/.ssh/id_rsa.pub}"

# ── Helpers ───────────────────────────────────────────────────────────────────
log() { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }

# ── 1. Resource Group ─────────────────────────────────────────────────────────
log "Resource Group: $RG"
az group create --name "$RG" --location "$LOCATION" --output none

# ── 2. PostgreSQL Flexible Server ─────────────────────────────────────────────
if az postgres flexible-server show -g "$RG" -n "$PG_SERVER" &>/dev/null; then
  log "Postgres $PG_SERVER ya existe, saltando creación"
else
  log "Creando Postgres $PG_SERVER (esto tarda ~5 min)"
  az postgres flexible-server create \
    --resource-group "$RG" \
    --name "$PG_SERVER" \
    --location "$LOCATION" \
    --tier "$PG_TIER" \
    --sku-name "$PG_SKU" \
    --version "$PG_VERSION" \
    --storage-size "$PG_STORAGE_GB" \
    --admin-user "$PG_ADMIN" \
    --admin-password "$POSTGRES_ADMIN_PASSWORD" \
    --public-access Enabled \
    --yes \
    --output none
fi

# Base de datos
if ! az postgres flexible-server db show -g "$RG" -s "$PG_SERVER" -d "$PG_DB" &>/dev/null; then
  log "Creando database $PG_DB"
  az postgres flexible-server db create -g "$RG" -s "$PG_SERVER" -d "$PG_DB" --output none
fi

# ── 3. Storage Account + container ────────────────────────────────────────────
# Reutiliza el primer storage account existente que empiece con "stinioibim"
# en este RG. Si no hay ninguno, crea uno nuevo con sufijo aleatorio.
EXISTING_SA="$(az storage account list -g "$RG" --query "[?starts_with(name, 'stinioibim')].name | [0]" -o tsv 2>/dev/null || true)"
if [[ -n "$EXISTING_SA" ]]; then
  STORAGE_ACCOUNT="$EXISTING_SA"
  log "Reutilizando Storage Account existente: $STORAGE_ACCOUNT"
else
  log "Creando Storage Account: $STORAGE_ACCOUNT"
  az storage account create \
    --name "$STORAGE_ACCOUNT" \
    --resource-group "$RG" \
    --location "$LOCATION" \
    --sku Standard_LRS \
    --kind StorageV2 \
    --min-tls-version TLS1_2 \
    --allow-blob-public-access false \
    --output none
fi

STORAGE_KEY="$(az storage account keys list -g "$RG" -n "$STORAGE_ACCOUNT" --query '[0].value' -o tsv)"

if ! az storage container show \
      --account-name "$STORAGE_ACCOUNT" \
      --account-key "$STORAGE_KEY" \
      --name "$MEDIA_CONTAINER" &>/dev/null; then
  log "Creando container $MEDIA_CONTAINER"
  az storage container create \
    --account-name "$STORAGE_ACCOUNT" \
    --account-key "$STORAGE_KEY" \
    --name "$MEDIA_CONTAINER" \
    --public-access off \
    --output none
fi

# ── 4. VM Ubuntu 22.04 ────────────────────────────────────────────────────────
if az vm show -g "$RG" -n "$VM_NAME" &>/dev/null; then
  log "VM $VM_NAME ya existe, saltando creación"
else
  log "Creando VM $VM_NAME ($VM_SIZE, $VM_IMAGE)"
  if [[ -f "$SSH_PUBLIC_KEY_PATH" ]]; then
    SSH_ARG=(--ssh-key-values "$SSH_PUBLIC_KEY_PATH")
  else
    warn "No se encontró $SSH_PUBLIC_KEY_PATH — az generará claves nuevas en ~/.ssh"
    SSH_ARG=(--generate-ssh-keys)
  fi

  az vm create \
    --resource-group "$RG" \
    --name "$VM_NAME" \
    --image "$VM_IMAGE" \
    --size "$VM_SIZE" \
    --admin-username "$VM_ADMIN" \
    --public-ip-sku Standard \
    --nsg-rule SSH \
    --storage-sku Standard_LRS \
    --os-disk-size-gb 64 \
    "${SSH_ARG[@]}" \
    --output none
fi

# Abrir 80 y 443 en el NSG
log "Abriendo puertos 80 y 443"
az vm open-port -g "$RG" -n "$VM_NAME" --port 80  --priority 1010 --output none 2>/dev/null || true
az vm open-port -g "$RG" -n "$VM_NAME" --port 443 --priority 1011 --output none 2>/dev/null || true

# ── 5. Recolectar datos de conexión ───────────────────────────────────────────
VM_IP="$(az vm show -d -g "$RG" -n "$VM_NAME" --query publicIps -o tsv)"
PG_HOST="$(az postgres flexible-server show -g "$RG" -n "$PG_SERVER" --query fullyQualifiedDomainName -o tsv)"

# Autorizar la IP pública de la VM en el firewall de Postgres
log "Autorizando IP de la VM ($VM_IP) en el firewall de Postgres"
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

# ── Output ────────────────────────────────────────────────────────────────────
cat <<EOF

╔══════════════════════════════════════════════════════════════════════════════╗
║  Provisionamiento completo                                                   ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Resource Group:      $RG
║  VM public IP:        $VM_IP
║  VM SSH:              ssh ${VM_ADMIN}@${VM_IP}
║  Postgres host:       $PG_HOST
║  Postgres database:   $PG_DB
║  Postgres user:       $PG_ADMIN
║  Storage account:     $STORAGE_ACCOUNT
║  Media container:     $MEDIA_CONTAINER
╚══════════════════════════════════════════════════════════════════════════════╝

Copia esto a /opt/inio-bim/.env en la VM (rellenando el SECRET_KEY):

──────────────────────────────────────────────────────────────────────────────
DJANGO_SETTINGS_MODULE=config.settings.production
SECRET_KEY=<generar con:  python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())">
ALLOWED_HOSTS=${VM_IP}
DATABASE_URL=postgres://${PG_ADMIN}:${POSTGRES_ADMIN_PASSWORD}@${PG_HOST}:5432/${PG_DB}?sslmode=require
CORS_ALLOWED_ORIGINS=http://${VM_IP}
AZURE_ACCOUNT_NAME=${STORAGE_ACCOUNT}
AZURE_ACCOUNT_KEY=${STORAGE_KEY}
AZURE_MEDIA_CONTAINER=${MEDIA_CONTAINER}
──────────────────────────────────────────────────────────────────────────────

Cuando configures un dominio propio (ej. inio-bim.pancanal.com):
  - Añádelo a ALLOWED_HOSTS
  - Cambia CORS_ALLOWED_ORIGINS a https://<dominio>
  - Corre certbot para HTTPS (Fase 3)

EOF
