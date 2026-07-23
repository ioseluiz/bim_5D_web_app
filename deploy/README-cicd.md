# Setup CI/CD — INIO BIM

Guía para conectar GitHub Actions con la VM Azure. Se corre **una sola vez**.

## 1. Generar clave SSH dedicada para CI

En tu **Windows local** (CMD o PowerShell):

```powershell
ssh-keygen -t ed25519 -f $HOME\.ssh\inio-bim-ci -C "github-actions-inio-bim" -N ""
```

Genera dos archivos:
- `~/.ssh/inio-bim-ci` — clave **privada** (irá a GitHub secrets)
- `~/.ssh/inio-bim-ci.pub` — clave **pública** (irá a la VM)

## 2. Autorizar la clave pública en la VM

```powershell
type $HOME\.ssh\inio-bim-ci.pub
```

Copia la línea completa (empieza con `ssh-ed25519 AAAA...` y termina con
`github-actions-inio-bim`).

En la **sesión SSH de la VM**:

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
cat >> ~/.ssh/authorized_keys <<'EOF'
<PEGAR-AQUI-LA-CLAVE-PUBLICA-COMPLETA>
EOF
chmod 600 ~/.ssh/authorized_keys
```

Verifica desde tu Windows que la nueva key funciona:

```powershell
ssh -i $HOME\.ssh\inio-bim-ci azureuser@<IP-VM> "whoami"
```

Debe imprimir `azureuser` sin pedir password.

## 3. Configurar sudoers para apply.sh

Debemos permitir que `azureuser` corra `apply.sh` sin password. En la VM:

```bash
sudo cp /opt/inio-bim/deploy/sudoers-inio-bim-deploy /etc/sudoers.d/inio-bim-deploy
sudo chmod 440 /etc/sudoers.d/inio-bim-deploy
sudo visudo -c    # debe imprimir "parsed OK"
```

Prueba desde la VM:

```bash
sudo -n /opt/inio-bim/deploy/apply.sh 2>&1 | head -3
```

Debe salir mensajes del script (probablemente error porque /tmp/deploy-* no existe todavía — eso está bien). **No debe pedir password.**

## 4. Añadir permisos ejecutables a apply.sh

```bash
sudo chmod +x /opt/inio-bim/deploy/apply.sh
ls -l /opt/inio-bim/deploy/apply.sh
```

Debe ser `-rwxr-xr-x`.

## 5. Añadir secrets en GitHub

Ve a **github.com/ioseluiz/bim_5D_web_app → Settings → Secrets and variables → Actions**.

Crea 3 secrets con **New repository secret**:

| Name | Value |
|---|---|
| `VM_HOST` | La IP pública de la VM (ej. `48.211.218.17`) |
| `VM_USER` | `azureuser` |
| `VM_SSH_KEY` | Contenido completo de `~/.ssh/inio-bim-ci` (la **privada**) |

Para el `VM_SSH_KEY`, en Windows:

```powershell
type $HOME\.ssh\inio-bim-ci
```

Copia **todo** — desde `-----BEGIN OPENSSH PRIVATE KEY-----` hasta `-----END OPENSSH PRIVATE KEY-----`, incluidas las líneas finales.

## 6. Primer test — disparo manual

En GitHub → tab **Actions** → workflow **Deploy** → **Run workflow** → branch `main` → **Run workflow**.

Debe pasar ambos jobs (`build-frontend` y `deploy`) en ~2 minutos. Al final,
`http://<IP-VM>/admin/` debe seguir cargando (smoke test lo verifica).

## 7. A partir de ahí

Cualquier push/merge a `main` dispara automáticamente el deploy.

Para desactivar temporalmente: en GitHub → Actions → Deploy → menú de los tres puntos → **Disable workflow**.

## Troubleshooting

**`Permission denied (publickey)` en el rsync**
- La pubkey no quedó bien en `~/.ssh/authorized_keys`. Revisa que esté en una sola línea.
- El `VM_SSH_KEY` en GitHub no tiene el newline final o le falta un pedazo.

**`sudo: a password is required`**
- El sudoers.d no está aplicado. Corre `sudo visudo -c` y revisa que `azureuser ALL=(root) NOPASSWD: /opt/inio-bim/deploy/apply.sh` esté sin syntax error.
- Confirma que la ruta en el sudoers matchea EXACTAMENTE la del script (`ls -l /opt/inio-bim/deploy/apply.sh`).

**Smoke test devuelve 500 tras el deploy**
- Revisa `sudo journalctl -u inio-bim -n 50 --no-pager` en la VM.
- Puede ser una migración que no fue idempotente. En emergencia: hacer `git revert` del commit malo y push.
