# CI/CD + HTTPS + OWASP hardening — INIO BIM

Guía paso a paso para conectar GitHub Actions con la VM Azure, activar HTTPS con Let's Encrypt vía `sslip.io` (mientras no haya dominio ACP), y aplicar el hardening OWASP.

Todos los pasos marcados con **VM** se corren dentro de la VM (por SSH). Los marcados con **local** en tu equipo.

## Fase 0 — Verificar acceso y hacer backup del estado actual (VM)

### 0.1 SSH ok

```bash
ssh azureuser@<IP-DE-LA-VM>
```

### 0.2 Estado actual de los servicios

```bash
sudo systemctl status inio-bim.service nginx postgresql --no-pager | head -30
```

Los tres deben estar `active (running)`. Si alguno está caído lo levantamos después.

### 0.3 Backup manual antes de tocar nada

Aunque el CI/CD hará backups automáticos, esto es un baseline seguro:

```bash
STAMP=$(date -u +%Y%m%d-%H%M%SZ)
sudo mkdir -p /var/backups/inio-bim
sudo -u postgres pg_dump --no-owner --no-privileges biminiodb \
  | sudo tee /var/backups/inio-bim/db-baseline-$STAMP.sql >/dev/null
sudo gzip /var/backups/inio-bim/db-baseline-$STAMP.sql
sudo tar -czf /var/backups/inio-bim/media-baseline-$STAMP.tar.gz \
  -C /opt/inio-bim media 2>/dev/null || echo "(sin media)"
ls -lh /var/backups/inio-bim/
```

### 0.4 Copiar backup a tu equipo (local)

```bash
scp azureuser@<IP-VM>:/var/backups/inio-bim/db-baseline-*.sql.gz ./
scp azureuser@<IP-VM>:/var/backups/inio-bim/media-baseline-*.tar.gz ./
```

Guárdalos en OneDrive o similar. Es tu red de seguridad.

### 0.5 Guardar el `.env` actual (VM)

```bash
sudo cat /opt/inio-bim/.env
```

Copia el contenido a tu password manager. Lo vamos a modificar en la fase de HTTPS.

---

## Fase 1 — Generar par SSH dedicado para GitHub Actions (local)

Nunca reutilices la key personal de `azureuser` para CI.

```powershell
# Windows PowerShell:
ssh-keygen -t ed25519 -f $HOME\.ssh\inio-bim-ci -C "github-actions-inio-bim" -N '""'
```

Genera:
- `~/.ssh/inio-bim-ci` — **privada** (irá a GitHub Secrets)
- `~/.ssh/inio-bim-ci.pub` — **pública** (irá a la VM)

### 1.1 Autorizar la pubkey en la VM

Copia la pubkey:

```powershell
type $HOME\.ssh\inio-bim-ci.pub
```

En la VM (por SSH con tu password nueva):

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
cat >> ~/.ssh/authorized_keys <<'EOF'
<PEGAR-AQUI-LA-PUBKEY-COMPLETA-EN-UNA-SOLA-LINEA>
EOF
chmod 600 ~/.ssh/authorized_keys
```

Verifica desde tu equipo:

```powershell
ssh -i $HOME\.ssh\inio-bim-ci azureuser@<IP-VM> "whoami"
```

Debe imprimir `azureuser` sin pedir password.

---

## Fase 2 — Sincronizar el nuevo código a la VM (VM)

Antes de continuar con secrets y HTTPS necesitamos que la VM tenga los scripts nuevos (`setup-https.sh`, `pre-deploy-backup.sh`, `apply.sh` actualizado). Primer deploy manual:

### 2.1 Traer el código (VM, como `inio`)

```bash
sudo -u inio bash <<'EOF'
cd /opt/inio-bim
git fetch --all
git checkout main
git pull --ff-only
EOF
```

### 2.2 Instalar deps y aplicar

```bash
sudo -u inio /opt/inio-bim/venv/bin/pip install -r /opt/inio-bim/requirements.txt --quiet
sudo -u inio /opt/inio-bim/venv/bin/python /opt/inio-bim/manage.py migrate --noinput
sudo -u inio /opt/inio-bim/venv/bin/python /opt/inio-bim/manage.py collectstatic --noinput --clear
sudo systemctl restart inio-bim.service
```

### 2.3 Sudoers para GitHub Actions (VM)

```bash
sudo cp /opt/inio-bim/deploy/sudoers-inio-bim-deploy /etc/sudoers.d/inio-bim-deploy
sudo chmod 440 /etc/sudoers.d/inio-bim-deploy
sudo visudo -c   # debe imprimir "parsed OK"
sudo chmod +x /opt/inio-bim/deploy/apply.sh /opt/inio-bim/deploy/setup-https.sh /opt/inio-bim/deploy/pre-deploy-backup.sh
```

Test:

```bash
sudo -n /opt/inio-bim/deploy/apply.sh 2>&1 | head -3
```

Debe emitir el error de "Falta /tmp/deploy-backend" (correcto — no debe pedir password).

---

## Fase 3 — Configurar Environment `production_inio` en GitHub (local, en el navegador)

1. Ve a **github.com/ioseluiz/bim_5D_web_app → Settings → Environments → New environment**.
2. Nombre: `production_inio` → Configure environment.
   (usamos `production_inio` en vez de `production` porque este último puede
   estar reservado por otro workflow o feature del repo.)
3. Marca **Required reviewers** y agrégate a ti mismo (y a otros admins si aplica).
4. **Save protection rules**.

Cada vez que push a `main` dispare deploy, GitHub esperará tu aprobación antes de ejecutar el job `deploy`.

### 3.1 Añadir secrets del environment

Todavía en Environment → production_inio → **Environment secrets → Add secret**. Crea:

| Name | Value |
|---|---|
| `VM_HOST` | IP pública de la VM (ej. `20.1.2.3`) |
| `VM_USER` | `azureuser` |
| `VM_SSH_KEY` | Contenido completo de `~/.ssh/inio-bim-ci` (la **privada**), incluidas las líneas BEGIN/END |

Además, en la misma pantalla del environment, sección **Environment variables** (no secrets) → **Add variable**:

| Name | Value |
|---|---|
| `VM_DOMAIN` | Se llena en la Fase 4 (deja vacío por ahora) |

> `VM_DOMAIN` es una **variable**, no un secret, porque `environment.url` en workflows solo acepta los contextos `github`, `inputs`, `vars`, `needs` — no `secrets`. Un dominio público no necesita cifrado de todos modos.

Para `VM_SSH_KEY`, en PowerShell:

```powershell
type $HOME\.ssh\inio-bim-ci
```

Copia **desde `-----BEGIN OPENSSH PRIVATE KEY-----` hasta `-----END OPENSSH PRIVATE KEY-----`** (incluye la línea final).

---

## Fase 4 — HTTPS con sslip.io + Let's Encrypt (VM)

Mientras no tengas el dominio ACP, `sslip.io` te da un dominio real derivado de la IP.

### 4.1 Verificar que la IP resuelve por sslip.io (local)

Si tu IP es `20.1.2.3`, el subdominio es `20-1-2-3.sslip.io`. Confirma:

```bash
nslookup 20-1-2-3.sslip.io   # debe resolver a 20.1.2.3
```

### 4.2 Abrir 443 en el NSG (Azure Portal)

Portal → VM → **Networking / Network settings** → **Add inbound port rule** → `Destination port: 443`, Protocol TCP, Action Allow, Priority 310. Guarda.

### 4.3 Correr setup-https.sh (VM)

```bash
export EMAIL="jlmunoz@pancanal.com"
sudo -E DOMAIN=$(curl -sS https://api.ipify.org | tr '.' '-').sslip.io \
  bash /opt/inio-bim/deploy/setup-https.sh
```

El script:
1. Instala `certbot` + plugin nginx si faltan.
2. Emite el certificado para tu subdominio sslip.io.
3. Renderiza `deploy/nginx-inio-bim.conf` reemplazando `${DOMAIN}`.
4. Reinicia nginx.
5. Activa `certbot.timer` (renewal automático cada 12h).
6. Corre un `certbot renew --dry-run` para validar.

Al final imprime el DOMAIN emitido.

### 4.4 Actualizar el `.env` (VM)

```bash
DOMAIN=<el-que-imprimió-el-script>   # ej. 20-1-2-3.sslip.io
sudo -u inio bash -c "cat > /opt/inio-bim/.env <<EOF
SECRET_KEY=$(sudo grep '^SECRET_KEY=' /opt/inio-bim/.env | cut -d= -f2-)
ALLOWED_HOSTS=$DOMAIN,127.0.0.1,localhost
DATABASE_URL=$(sudo grep '^DATABASE_URL=' /opt/inio-bim/.env | cut -d= -f2-)
CORS_ALLOWED_ORIGINS=https://$DOMAIN
USE_HTTPS=True
DJANGO_SETTINGS_MODULE=config.settings.production
EOF"
sudo chmod 600 /opt/inio-bim/.env
sudo chown inio:inio /opt/inio-bim/.env
sudo systemctl restart inio-bim.service
```

### 4.5 Verificación desde el navegador (local)

Abre `https://<tu-dominio-sslip>/admin/` — debe cargar sin advertencia de certificado, y el candado del navegador debe ser verde.

También:

```powershell
curl.exe -sI https://<tu-dominio-sslip>/admin/ | Select-String "strict-transport-security"
```

Debe devolver `strict-transport-security: max-age=31536000; includeSubDomains`.

### 4.6 Añadir `VM_DOMAIN` como Environment variable

Vuelve a **Settings → Environments → production_inio → Environment variables** (no secrets) → **Add variable**:

| `VM_DOMAIN` | `20-1-2-3.sslip.io` (el que emitiste) |

Con esto `environment.url` y el smoke test HTTPS apuntan al dominio en vez de a la IP.

---

## Fase 5 — Primer deploy real vía GitHub Actions (local, navegador)

1. Ve a **Actions → Deploy → Run workflow**.
2. En "Escribe deploy para confirmar" pon: `deploy`.
3. Branch: `main`.
4. **Run workflow**.

Verás:
- Job `build-frontend` corre sin approval.
- Job `deploy` queda en **Waiting** hasta que apruebes en la pestaña Environments.

Apruebas → deploy corre en ~1 min. El smoke test verifica `https://$VM_DOMAIN/admin/` y el header HSTS.

De aquí en adelante, cada push a `main` dispara la misma secuencia: build automático, deploy esperando tu aprobación.

---

## Fase 6 — Hardening extra en Azure (Portal)

### 6.1 NSG restrictivo

Portal → VM → Networking. Reglas de entrada recomendadas:

| Prio | Puerto | Origen | Acción | Justificación |
|---|---|---|---|---|
| 300 | 22 | *IP de tu oficina* | Allow | SSH solo desde red de trabajo |
| 310 | 80 | * | Allow | Redirige a 443 |
| 320 | 443 | * | Allow | HTTPS público |
| 4096 | * | * | Deny | Cierra el resto |

Si necesitas acceso móvil, usa Azure Bastion o VPN antes que abrir 22 al mundo.

### 6.2 Habilitar Azure Backup para la VM

Portal → VM → Backup → configura una política diaria con retención 30 días. Independiente del backup de app.

---

## Cheatsheet OWASP Top 10 → dónde está resuelto

| # | Riesgo | Mitigación en el repo |
|---|---|---|
| A01 | Broken Access Control | `costs/permissions.py` (staff-only en biblioteca), `bim.Project.owner` scoping |
| A02 | Cryptographic Failures | HTTPS TLS 1.2+, HSTS 1 año, secure cookies |
| A03 | Injection | DRF serializers + ORM (nunca SQL raw); CSP restringe eval |
| A04 | Insecure Design | Environment `production_inio` con approval, PR reviews obligatorios |
| A05 | Security Misconfiguration | `manage.py check --deploy` en CI, DEBUG=False forzado, headers via nginx + Django |
| A06 | Vulnerable Components | `.github/workflows/security-scan.yml` (pip-audit + npm audit, semanal) |
| A07 | Auth Failures | `django-ratelimit` en login, logging de intentos, token rotation via management command |
| A08 | Data Integrity | Backups pre-deploy (BD + media), retención 14; Azure Backup diario |
| A09 | Security Logging | Logger `accounts.security` + `django.security`, captura por journalctl |
| A10 | SSRF | Sin llamadas outbound a URLs de usuario (no aplica) |

---

## Troubleshooting

**El SSH desde GitHub Actions da `Permission denied (publickey)`**
- La pubkey no quedó en una sola línea en `~/.ssh/authorized_keys` de la VM.
- El secret `VM_SSH_KEY` no tiene el newline final o le falta un pedazo.

**Certbot dice "unable to resolve host"**
- Confirma que `nslookup <tu-dominio-sslip>` devuelve tu IP.
- El puerto 80 debe estar abierto en el NSG durante la emisión (challenge http-01).

**El smoke test dice 502 Bad Gateway**
- Gunicorn no arrancó. `sudo journalctl -u inio-bim -n 50 --no-pager` te dice por qué.
- Suele ser un `.env` mal formateado o falta una variable requerida.

**Después de activar HTTPS los assets del frontend dan mixed-content**
- El `VITE_API_URL` en `frontend/.env.production` debe ser `/api` (relativo). Ya está bien; el workflow no lo cambia.
