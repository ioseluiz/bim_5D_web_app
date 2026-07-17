"""
Configuración de desarrollo local.

- SQLite en disco
- DEBUG=True
- CORS abierto (frontend Vite en :5173 → backend en :8000)
- Media guardado en filesystem local (./media)
"""
from .base import *  # noqa: F401,F403
from .base import BASE_DIR

DEBUG = True

ALLOWED_HOSTS = ['*']

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}

MEDIA_ROOT = BASE_DIR / 'media'

CORS_ALLOW_ALL_ORIGINS = True
