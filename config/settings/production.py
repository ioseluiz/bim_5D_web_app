"""
Configuración de producción — Azure VM.

Variables de entorno requeridas (ver .env.example):
- SECRET_KEY
- ALLOWED_HOSTS (separado por comas, ej: "inio-bim.pancanal.com,www.inio-bim.pancanal.com")
- DATABASE_URL (postgres://user:pass@host:5432/dbname)
- CORS_ALLOWED_ORIGINS (separado por comas, ej: "https://inio-bim.pancanal.com")
- AZURE_ACCOUNT_NAME
- AZURE_ACCOUNT_KEY
- AZURE_MEDIA_CONTAINER (ej: bim-media)
"""
import os

import dj_database_url

from .base import *  # noqa: F401,F403
from .base import MIDDLEWARE

DEBUG = False

if not SECRET_KEY:  # noqa: F405
    raise RuntimeError("SECRET_KEY no está definida en el entorno de producción")

ALLOWED_HOSTS = [h.strip() for h in os.environ['ALLOWED_HOSTS'].split(',') if h.strip()]

DATABASES = {
    'default': dj_database_url.config(
        default=os.environ['DATABASE_URL'],
        conn_max_age=600,
        ssl_require=True,
    ),
}

# Whitenoise sirve staticfiles comprimidos directamente desde gunicorn.
# Debe ir inmediatamente después de SecurityMiddleware.
MIDDLEWARE.insert(
    MIDDLEWARE.index('django.middleware.security.SecurityMiddleware') + 1,
    'whitenoise.middleware.WhiteNoiseMiddleware',
)

# Media va a Azure Blob Storage; static va comprimido con whitenoise.
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

CORS_ALLOWED_ORIGINS = [
    o.strip() for o in os.environ.get('CORS_ALLOWED_ORIGINS', '').split(',') if o.strip()
]
CORS_ALLOW_CREDENTIALS = True

CSRF_TRUSTED_ORIGINS = CORS_ALLOWED_ORIGINS

# ── Seguridad HTTP ────────────────────────────────────────────────────────────
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 30  # 30 días — subir a 1 año cuando esté estable
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = False
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = 'same-origin'
X_FRAME_OPTIONS = 'DENY'

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
