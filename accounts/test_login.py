"""Tests del endpoint de login.

El caso que motivó este archivo: `test_login_con_remote_addr_vacio`. En
producción gunicorn escucha en un socket Unix, así que `REMOTE_ADDR` llega
vacío y el rate limiting reventaba con `ImproperlyConfigured`, devolviendo
500 a todo el mundo. No había ningún test del login, así que el bug llegó a
producción sin que nada lo detectara.
"""
from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.cache.backends import locmem
from django.test import override_settings
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db
User = get_user_model()

LOGIN_URL = '/api/auth/login/'
PASSWORD = 'ClaveDePrueba#2026'

# Mismos valores que config/settings/production.py, para que los tests
# ejerciten la configuración real de la VM y no la de desarrollo.
PROD_CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'inio-bim-cache-test',
    },
}


@pytest.fixture(autouse=True)
def _clear_cache():
    """Los contadores de rate limit no deben filtrarse entre tests.

    No basta con `cache.clear()`: los tests con `@override_settings(CACHES=...)`
    activan un LocMemCache con otro LOCATION *después* de que este fixture
    corre, y LocMemCache guarda un dict global por LOCATION que sobrevive
    entre tests. Hay que vaciar ese registro global.
    """
    def _wipe():
        cache.clear()
        for store in locmem._caches.values():
            store.clear()
        locmem._expire_info.clear()

    _wipe()
    yield
    _wipe()


@pytest.fixture
def user():
    return User.objects.create_user(
        username='jlmunoz', email='jlmunoz@example.com', password=PASSWORD,
    )


@pytest.fixture
def client():
    return APIClient()


# ── Casos base ───────────────────────────────────────────────────────────────


def test_login_correcto_devuelve_token(client, user):
    resp = client.post(
        LOGIN_URL, {'email': user.email, 'password': PASSWORD}, format='json',
    )
    assert resp.status_code == 200, resp.content
    body = resp.json()
    assert body['token']
    assert body['user']['email'] == user.email
    assert body['user']['is_staff'] is False


def test_password_incorrecto_devuelve_401(client, user):
    resp = client.post(
        LOGIN_URL, {'email': user.email, 'password': 'incorrecta'}, format='json',
    )
    assert resp.status_code == 401
    assert resp.json()['error'] == 'Credenciales incorrectas.'


def test_email_inexistente_devuelve_401(client):
    resp = client.post(
        LOGIN_URL, {'email': 'nadie@example.com', 'password': 'x'}, format='json',
    )
    assert resp.status_code == 401
    # Mismo mensaje que password incorrecto: no dar oráculo de qué emails existen.
    assert resp.json()['error'] == 'Credenciales incorrectas.'


def test_body_vacio_devuelve_400_no_500(client):
    """Un body vacío debe dar 400. Que diera 500 fue el síntoma del bug."""
    resp = client.post(LOGIN_URL, {}, format='json')
    assert resp.status_code == 400, resp.content
    assert resp.json()['error'] == 'Se requieren email y contraseña.'


def test_email_con_distinto_case_funciona(client, user):
    resp = client.post(
        LOGIN_URL,
        {'email': 'JLMunoz@EXAMPLE.com', 'password': PASSWORD},
        format='json',
    )
    assert resp.status_code == 200, resp.content


def test_email_con_espacios_funciona(client, user):
    resp = client.post(
        LOGIN_URL,
        {'email': f'  {user.email}  ', 'password': PASSWORD},
        format='json',
    )
    assert resp.status_code == 200, resp.content


# ── Regresión: el bug de producción ──────────────────────────────────────────


@override_settings(CACHES=PROD_CACHES)
def test_login_con_remote_addr_vacio(client, user):
    """REGRESIÓN — reproduce el 500 de producción.

    Con gunicorn sobre socket Unix, REMOTE_ADDR llega vacío. El rate limiting
    debe tolerarlo (saltándose el bucket por IP) en vez de reventar.
    """
    resp = client.post(
        LOGIN_URL,
        {'email': user.email, 'password': PASSWORD},
        format='json',
        REMOTE_ADDR='',
    )
    assert resp.status_code == 200, (
        f'login roto con REMOTE_ADDR vacio: {resp.status_code} {resp.content[:200]}'
    )


@override_settings(CACHES=PROD_CACHES)
def test_login_usa_x_real_ip_cuando_remote_addr_vacio(client, user):
    """Con REMOTE_ADDR vacío, la IP debe salir de X-Real-IP (lo que pone nginx)."""
    resp = client.post(
        LOGIN_URL,
        {'email': user.email, 'password': PASSWORD},
        format='json',
        REMOTE_ADDR='',
        HTTP_X_REAL_IP='203.0.113.45',
    )
    assert resp.status_code == 200, resp.content


# ── Rate limiting ────────────────────────────────────────────────────────────


@override_settings(CACHES=PROD_CACHES)
def test_rate_limit_por_email_devuelve_429(client, user):
    """Al 6.º intento sobre el mismo email debe cortar (límite 5/min)."""
    for i in range(5):
        r = client.post(
            LOGIN_URL,
            {'email': user.email, 'password': 'mala'},
            format='json',
            HTTP_X_REAL_IP='198.51.100.10',
        )
        assert r.status_code == 401, f'intento {i + 1} dio {r.status_code}'

    r = client.post(
        LOGIN_URL,
        {'email': user.email, 'password': 'mala'},
        format='json',
        HTTP_X_REAL_IP='198.51.100.10',
    )
    assert r.status_code == 429
    assert 'Demasiados intentos' in r.json()['error']


@override_settings(CACHES=PROD_CACHES)
def test_rate_limit_no_se_comparte_entre_emails(client, user):
    """Cada cuenta tiene su propio bucket.

    Con el decorador `key='post:email'` de django-ratelimit y un body JSON,
    la clave era siempre '' y todos los usuarios compartían el mismo
    contador: bloquear una cuenta bloqueaba a todas.
    """
    otro = User.objects.create_user(
        username='otro', email='otro@example.com', password=PASSWORD,
    )

    # Agotar el bucket del primer email desde una IP.
    for _ in range(6):
        client.post(
            LOGIN_URL,
            {'email': user.email, 'password': 'mala'},
            format='json',
            HTTP_X_REAL_IP='198.51.100.20',
        )

    # El segundo usuario, desde OTRA IP, debe poder entrar sin problema.
    resp = client.post(
        LOGIN_URL,
        {'email': otro.email, 'password': PASSWORD},
        format='json',
        HTTP_X_REAL_IP='198.51.100.21',
    )
    assert resp.status_code == 200, (
        f'el bucket de {user.email} bloqueo a {otro.email}: {resp.content[:200]}'
    )


@override_settings(CACHES=PROD_CACHES)
def test_fallo_del_rate_limit_no_bloquea_el_login(client, user, monkeypatch):
    """Si la caché revienta, el login debe seguir funcionando.

    Es la lección del incidente: un guardarraíl roto no puede dejar fuera a
    todos los usuarios.
    """
    def _boom(*args, **kwargs):
        raise RuntimeError('cache caida')

    monkeypatch.setattr('accounts.views.cache.add', _boom)

    resp = client.post(
        LOGIN_URL, {'email': user.email, 'password': PASSWORD}, format='json',
    )
    assert resp.status_code == 200, (
        f'un fallo de cache tumbo el login: {resp.status_code} {resp.content[:200]}'
    )
