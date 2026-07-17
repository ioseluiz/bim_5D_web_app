# Deploy — INIO BIM en Azure

Guía para provisionar y desplegar la aplicación en Azure. Fase 2: infraestructura.

## Arquitectura

```
Internet ──► VM Ubuntu (Nginx + Gunicorn + Django)
                │
                ├── PostgreSQL Flexible Server (managed)
                └── Storage Account (Blob container "bim-media")
```

Todo dentro de un solo Resource Group: `rg-inio-bim-prod` en la región `eastus2`.

## Prerrequisitos

1. **Azure CLI** instalado o usar Azure Cloud Shell (https://shell.azure.com).
   ```bash
   az --version
   ```
2. **Login** y suscripción correcta:
   ```bash
   az login
   az account list -o table
   az account set --subscription "<tu-subscription-id>"
   ```
3. **Clave SSH** local (para conectarte a la VM después). Si no tienes:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/id_rsa
   ```

## Paso 1: Provisionar recursos

Desde la raíz del repo:

```bash
export POSTGRES_ADMIN_PASSWORD='PonUnPasswordFuerte#2026'
bash deploy/azure-provision.sh
```

El script crea (en este orden):
- Resource Group `rg-inio-bim-prod`
- PostgreSQL Flexible Server `psql-inio-bim` (Burstable B1ms, 32 GB, versión 16)
- Database `biminicadb`
- Storage Account `stinioibimXXXX` (sufijo aleatorio por unicidad global)
- Container privado `bim-media`
- VM `vm-inio-bim` (Ubuntu 22.04, Standard_B2s, IP pública Standard)
- NSG rules para 22, 80 y 443
- Firewall rule en Postgres para la IP pública de la VM

Es **idempotente**: correrlo dos veces no rompe nada — detecta recursos existentes.

**Duración típica:** 5–7 minutos (Postgres es el más lento).

Al terminar imprime:
- IP pública de la VM
- Host de Postgres
- Nombre del Storage Account
- Un bloque `.env` listo para copiar a la VM

## Paso 2: Guardar las credenciales

Guarda de forma segura (password manager, Azure Key Vault):
- `POSTGRES_ADMIN_PASSWORD` (el que exportaste)
- `AZURE_ACCOUNT_KEY` (impreso por el script)
- `SECRET_KEY` (lo generas en el siguiente paso)

Genera un `SECRET_KEY` de Django:
```bash
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

## Paso 3: Verificar acceso a la VM

```bash
VM_IP="<ip-impresa-por-el-script>"
ssh azureuser@$VM_IP
```

Si funciona, ya tienes conectividad. La VM viene "pelada" — la configuración
(Python, Nginx, Gunicorn, ffmpeg, código de la app) es la Fase 3.

## Paso 4: (Opcional) Refrescar credenciales después

Si la IP de la VM cambia, rotas la storage key, o pierdes el `.env`:

```bash
bash deploy/azure-get-secrets.sh
```

Reimprime el bloque `.env` con los valores actuales y reautoriza la IP de la VM
en el firewall de Postgres.

## Costos estimados (USD/mes, East US 2, precios de referencia)

| Recurso | SKU | Costo aproximado |
|---|---|---|
| VM `Standard_B2s` (24×7) | 2 vCPU / 4 GB | ~30 |
| Postgres Flexible `B1ms` + 32 GB | Burstable | ~15 |
| Storage Account | Standard LRS, uso bajo | ~1–5 |
| IP pública Standard | Estática | ~4 |
| **Total inicial** | | **~50–55 USD/mes** |

Bandwidth de salida (100 GB) añade ~8 USD extra.

## Troubleshooting

- **"Storage account name already taken"**: el sufijo aleatorio no fue suficiente.
  Vuelve a correr el script; genera otro sufijo.
- **"az login" en Cloud Shell no aparece requerido**: correcto, Cloud Shell ya
  está autenticado.
- **Postgres da timeout desde la VM**: verifica que la IP de la VM esté en el
  firewall con `az postgres flexible-server firewall-rule list -g rg-inio-bim-prod -n psql-inio-bim -o table`.
  Corre `azure-get-secrets.sh` para reautorizarla.
- **SSH pide password en vez de usar la clave**: revisa que subiste la clave
  pública correcta (`SSH_PUBLIC_KEY_PATH`) y que estás usando la privada
  correspondiente.

## Destruir todo

Cuando ya no lo necesites (⚠ pierdes datos y la IP pública):

```bash
az group delete --name rg-inio-bim-prod --yes --no-wait
```
