from django.contrib.auth import authenticate, get_user_model
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response


@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
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
        return Response(
            {'error': 'Credenciales incorrectas.'},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    user = authenticate(request, username=stored_email, password=password)
    if user is None:
        return Response(
            {'error': 'Credenciales incorrectas.'},
            status=status.HTTP_401_UNAUTHORIZED,
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
@permission_classes([IsAuthenticated])
def logout_view(request):
    request.user.auth_token.delete()
    return Response({'detail': 'Sesión cerrada correctamente.'})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me_view(request):
    user = request.user
    return Response({
        'id': user.pk,
        'email': user.email,
        'username': user.username,
        'is_staff': user.is_staff,
    })
