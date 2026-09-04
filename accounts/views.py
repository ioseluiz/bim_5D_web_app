import hashlib
import logging

from django.contrib.auth import authenticate, get_user_model
from django.core.cache import cache
from rest_framework import status
from rest_framework.authentication import TokenAuthentication
from rest_framework.authtoken.models import Token
from rest_framework.decorators import (
    api_view,
    authentication_classes,
    permission_classes,
)
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response


security_log = logging.getLogger('accounts.security')

# OWASP A07 — límites de fuerza bruta sobre el login.
LOGIN_RATE_PER_IP = 10      # intentos por minuto y dirección IP
LOGIN_RATE_PER_EMAIL = 5    # intentos por minuto y cuenta
LOGIN_RATE_WINDOW = 60      # segundos


def _client_ip(request):
    """IP real del cliente.

    gunicorn escucha en un socket Unix, así que REMOTE_ADDR llega vacío;
    nginx pone la IP en X-Real-IP (ver deploy/nginx-inio-bim.conf). Se
    prefiere ese header porque nginx lo fija con $remote_addr y el cliente
    no puede falsearlo, a diferencia de X-Forwarded-For.
    """
    return (
        request.META.get('HTTP_X_REAL_IP')
        or request.META.get('REMOTE_ADDR')
        or ''
    )


def _rate_limited(request, email):
    """True si esta petición supera algún límite.

    Nunca propaga excepciones: si la caché falla o algo sale mal calculando
    los contadores, se registra y se DEJA PASAR la petición. Un guardarraíl
    roto no puede dejar a los usuarios fuera de la aplicación — que es
    exactamente lo que ocurrió cuando django-ratelimit abortaba con
    ImproperlyConfigured por el REMOTE_ADDR vacío del socket Unix.
    """
    try:
        buckets = []
        ip = _client_ip(request)
        if ip:
            buckets.append((f'login:ip:{ip}', LOGIN_RATE_PER_IP))
        if email:
            # Hash para no meter direcciones de correo en las claves de caché.
            digest = hashlib.sha256(email.lower().encode('utf-8')).hexdigest()[:32]
            buckets.append((f'login:email:{digest}', LOGIN_RATE_PER_EMAIL))

        for key, limit in buckets:
            # add() solo escribe si la clave no existe: arranca la ventana.
            cache.add(key, 0, LOGIN_RATE_WINDOW)
            try:
                count = cache.incr(key)
            except ValueError:
                # La clave expiró entre el add y el incr.
                cache.set(key, 1, LOGIN_RATE_WINDOW)
                count = 1
            if count > limit:
                return True
        return False
    except Exception:
        security_log.exception('rate limit check fallo; se permite la peticion')
        return False


@api_view(['POST'])
# Sin authentication_classes: si el usuario tiene una cookie de sesión activa
# (ej. logueado en Django admin), SessionAuthentication forzaría CSRF y el
# POST desde axios (sin CSRF token) fallaría con 403. Login no necesita
# identificar al usuario actual — solo valida credenciales.
@authentication_classes([])
@permission_classes([AllowAny])
def login_view(request):
    # El límite se calcula dentro de la vista, no con el decorador de
    # django-ratelimit: su key 'post:email' lee request.POST, que DRF deja
    # vacío cuando el body es JSON (lo que manda el SPA), colapsando el
    # bucket de todos los usuarios en una sola clave vacía.
    email = request.data.get('email', '').strip()
    password = request.data.get('password', '')

    if _rate_limited(request, email):
        security_log.warning(
            'login ratelimited ip=%s email=%s', _client_ip(request), email,
        )
        return Response(
            {'error': 'Demasiados intentos. Intenta de nuevo en un minuto.'},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    if not email or not password:
        return Response(
            {'error': 'Se requieren email y contraseña.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Lookup case-insensitive: el email puede estar guardado con distinto
    # case del que el usuario teclea. authenticate() usa exact match así que
    # primero resolvemos el email real de la DB.
    UserModel = get_user_model()
    try:
        stored_email = UserModel.objects.get(email__iexact=email).email
    except UserModel.DoesNotExist:
        security_log.info(
            'login failed unknown_email=%s ip=%s',
            email, _client_ip(request),
        )
        return Response(
            {'error': 'Credenciales incorrectas.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    user = authenticate(request, username=stored_email, password=password)
    if user is None:
        security_log.info(
            'login failed bad_password email=%s ip=%s',
            stored_email, _client_ip(request),
        )
        return Response(
            {'error': 'Credenciales incorrectas.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    security_log.info(
        'login ok email=%s ip=%s',
        stored_email, _client_ip(request),
    )
    token, _ = Token.objects.get_or_create(user=user)
    return Response({
        'token': token.key,
        'user': {
            'id': user.pk,
            'email': user.email,
            'username': user.username,
            'is_staff': user.is_staff,
        },
    })


@api_view(['POST'])
# Solo TokenAuthentication: evita que la cookie de sesión del admin dispare
# CSRF check innecesariamente.
@authentication_classes([TokenAuthentication])
@permission_classes([IsAuthenticated])
def logout_view(request):
    request.user.auth_token.delete()
    return Response({'detail': 'Sesión cerrada correctamente.'})


@api_view(['GET'])
@authentication_classes([TokenAuthentication])
@permission_classes([IsAuthenticated])
def me_view(request):
    user = request.user
    return Response({
        'id': user.pk,
        'email': user.email,
        'username': user.username,
        'is_staff': user.is_staff,
    })
