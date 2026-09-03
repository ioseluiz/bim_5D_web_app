import logging

from django.contrib.auth import authenticate, get_user_model
from django_ratelimit.decorators import ratelimit
from django_ratelimit.exceptions import Ratelimited
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


@api_view(['POST'])
# Sin authentication_classes: si el usuario tiene una cookie de sesión activa
# (ej. logueado en Django admin), SessionAuthentication forzaría CSRF y el
# POST desde axios (sin CSRF token) fallaría con 403. Login no necesita
# identificar al usuario actual — solo valida credenciales.
@authentication_classes([])
@permission_classes([AllowAny])
# OWASP A07: rate limit brute-force. 10 intentos/min por IP, y 5/min por email
# (aunque el email no exista, para no dar oráculo por timing/rate).
@ratelimit(key='ip', rate='10/m', method='POST', block=False)
@ratelimit(key='post:email', rate='5/m', method='POST', block=False)
def login_view(request):
    if getattr(request, 'limited', False):
        security_log.warning(
            'login ratelimited ip=%s email=%s',
            request.META.get('REMOTE_ADDR'),
            request.data.get('email', ''),
        )
        return Response(
            {'error': 'Demasiados intentos. Intenta de nuevo en un minuto.'},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )

    email = request.data.get('email', '').strip()
    password = request.data.get('password', '')

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
            email, request.META.get('REMOTE_ADDR'),
        )
        return Response(
            {'error': 'Credenciales incorrectas.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    user = authenticate(request, username=stored_email, password=password)
    if user is None:
        security_log.info(
            'login failed bad_password email=%s ip=%s',
            stored_email, request.META.get('REMOTE_ADDR'),
        )
        return Response(
            {'error': 'Credenciales incorrectas.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    security_log.info(
        'login ok email=%s ip=%s',
        stored_email, request.META.get('REMOTE_ADDR'),
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
