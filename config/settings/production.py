"""
Configuración de producción — Azure VM.

Variables de entorno requeridas (ver .env.example):
- SECRET_KEY
- ALLOWED_HOSTS (separado por comas, ej: "inio-bim.pancanal.com,20.1.2.3")
- DATABASE_URL (postgres://user:pass@host:5432/dbname)
- CORS_ALLOWED_ORIGINS (separado por comas, ej: "https://inio-bim.pancanal.com")

Opcionales:
- USE_HTTPS (True/False, default False) — activa SSL redirect, HSTS, secure cookies
- MEDIA_ROOT (path) — solo si NO usas Azure Blob; default BASE_DIR/media
- AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY + AZURE_MEDIA_CONTAINER
    — si están presentes, media va a Azure Blob. Si no, va a filesystem local.
"""
import os

import dj_database_url

from .base import *  # noqa: F401,F403
from .base import MIDDLEWARE, BASE_DIR

DEBUG = False

if not SECRET_KEY:  # noqa: F405
    raise RuntimeError("SECRET_KEY no está definida en el entorno de producción")

ALLOWED_HOSTS = [h.strip() for h in os.environ['ALLOWED_HOSTS'].split(',') if h.strip()]

# ── Database ─────────────────────────────────────────────────────────────────
# ssl_require solo cuando la URL no es a localhost/127.0.0.1 (Postgres en la
# misma VM no necesita TLS; managed Postgres sí).
_db_url = os.environ['DATABASE_URL']
_ssl_require = not any(h in _db_url for h in ('@localhost', '@127.0.0.1'))

DATABASES = {
    'default': dj_database_url.config(
        default=_db_url,
        conn_max_age=600,
        ssl_require=_ssl_require,
    ),
}

# ── Middleware ───────────────────────────────────────────────────────────────
# Whitenoise sirve staticfiles comprimidos directamente desde gunicorn.
# Debe ir inmediatamente después de SecurityMiddleware.
MIDDLEWARE.insert(
    MIDDLEWARE.index('django.middleware.security.SecurityMiddleware') + 1,
    'whitenoise.middleware.WhiteNoiseMiddleware',
)

# ── Storage ──────────────────────────────────────────────────────────────────
# Si AZURE_ACCOUNT_NAME está definido → media a Azure Blob.
# Si no → filesystem local (MEDIA_ROOT). Nginx sirve /media/ desde ahí.
_azure_enabled = bool(os.environ.get('AZURE_ACCOUNT_NAME'))

if _azure_enabled:
    STORAGES = {
        'default': {
            'BACKEND': 'storages.backends.azure_storage.AzureStorage',
            'OPTIONS': {
                'account_name': os.environ['AZURE_ACCOUNT_NAME'],
                'account_key': os.environ['AZURE_ACCOUNT_KEY'],
                'azure_container': os.environ.get('AZURE_MEDIA_CONTAINER', 'bim-media'),
                'expiration_secs': 3600,  # URLs firmadas válidas 1h
            },
        },
        'staticfiles': {
            'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage',
        },
    }
else:
    MEDIA_ROOT = os.environ.get('MEDIA_ROOT', str(BASE_DIR / 'media'))
    STORAGES = {
        'default': {
            'BACKEND': 'django.core.files.storage.FileSystemStorage',
        },
        'staticfiles': {
            'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage',
        },
    }

# ── CORS / CSRF ──────────────────────────────────────────────────────────────
CORS_ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get('CORS_ALLOWED_ORIGINS', '').split(',') if o.strip()
]
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = CORS_ALLOWED_ORIGINS

# ── Seguridad HTTP ───────────────────────────────────────────────────────────
# Toggle único: activar cuando Nginx + certbot ya sirvan HTTPS.
USE_HTTPS = os.environ.get('USE_HTTPS', 'False') == 'True'

SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SECURE_SSL_REDIRECT = USE_HTTPS
SESSION_COOKIE_SECURE = USE_HTTPS
CSRF_COOKIE_SECURE = USE_HTTPS
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'same-origin'
X_FRAME_OPTIONS = 'DENY'

if USE_HTTPS:
    SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30  # 30 días — subir a 1 año cuando esté estable
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = False

# ── Logging básico a stdout (systemd/journalctl los captura) ─────────────────
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'INFO',
    },
    'loggers': {
        'django': {
            'handlers': ['console'],
            'level': 'INFO',
            'propagate': False,
        },
    },
}
