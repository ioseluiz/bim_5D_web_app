# GitHub Actions — INIO BIM

## Workflows

- **`ci.yml`** — corre en cada PR y en cada push a ramas ≠ main.
  Verifica que backend (Django check + pytest) y frontend (lint + build) pasen.
  Sin él, un merge a `main` con código roto dispararía un deploy fallido.

- **`deploy.yml`** — corre en push a `main` (o disparo manual).
  Compila frontend, sube backend y frontend a la VM vía rsync, ejecuta
  `deploy/apply.sh` remotamente vía sudo. Termina con smoke test a `/admin/`.

## Secrets requeridos

En **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Valor |
|---|---|
| `VM_HOST` | IP pública de la VM (ej. `48.211.218.17`) |
| `VM_USER` | `azureuser` |
| `VM_SSH_KEY` | Clave privada SSH dedicada para CI (contenido completo, incluye `-----BEGIN OPENSSH PRIVATE KEY-----`) |

## Setup inicial en la VM (una sola vez)

Ver `deploy/README-cicd.md` para el walkthrough completo.

## Cómo se dispara un deploy

**Automático:** cualquier push/merge a `main`.

**Manual:** en GitHub UI → tab **Actions** → workflow **Deploy** → **Run workflow** → elegir branch → **Run**.

## Rollback

No hay rollback automático. Para revertir:

```bash
git revert <SHA>
git push origin main
```

Eso genera un nuevo commit que deshace el cambio, y el workflow lo despliega.
