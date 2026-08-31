"""Permisos para recursos maestros vs. de proyecto.

Regla general:
- Lectura (GET/HEAD/OPTIONS): cualquier usuario autenticado.
- Escritura sobre un recurso MAESTRO (proyecto=NULL): sólo `is_staff`.
- Escritura sobre un recurso DE PROYECTO: sólo el owner del proyecto (o
  `is_staff`, para dar salida a operaciones administrativas puntuales).
"""
from __future__ import annotations

from rest_framework.permissions import BasePermission, SAFE_METHODS


class IsStaffOrReadOnly(BasePermission):
    """Lectura para autenticados; escritura sólo para `is_staff`.

    Usar en ViewSets que exponen exclusivamente recursos globales/maestros
    (por ejemplo MasterFormat, que es un catálogo compartido).
    """

    message = "Sólo un administrador puede modificar este recurso compartido."

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        if request.method in SAFE_METHODS:
            return True
        return bool(request.user.is_staff)


class KitObjectPermission(BasePermission):
    """Permission por objeto para `ActivityKit` / `KitCronograma`.

    - Lectura siempre permitida a autenticados.
    - Escritura sobre un kit maestro (`proyecto` es None): `is_staff`.
    - Escritura sobre un kit de proyecto: owner del proyecto o `is_staff`.
    """

    message = "No tiene permisos para modificar este kit."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        if request.user.is_staff:
            return True
        proyecto = getattr(obj, "proyecto", None)
        if proyecto is None:
            return False
        return getattr(proyecto, "owner_id", None) == request.user.id


class ActivityObjectPermission(BasePermission):
    """Permission por objeto para `Activity` / `ActividadCronograma`.

    Escritura sobre una actividad DE proyecto → owner o staff.
    Escritura sobre una actividad DE kit maestro → staff.
    Escritura sobre una actividad maestra suelta → staff.
    """

    message = "No tiene permisos para modificar esta actividad."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        if request.user.is_staff:
            return True
        proyecto = getattr(obj, "proyecto", None)
        if proyecto is not None:
            return getattr(proyecto, "owner_id", None) == request.user.id
        # Actividad en un kit → seguir el owner del kit (o staff si es maestro).
        kit = getattr(obj, "activity_kit", None) or getattr(obj, "kit_cronograma", None)
        if kit is not None:
            kit_proyecto = getattr(kit, "proyecto", None)
            if kit_proyecto is not None:
                return getattr(kit_proyecto, "owner_id", None) == request.user.id
        return False


class IsStaff(BasePermission):
    """Sólo `is_staff` (para acciones que siempre tocan la biblioteca)."""

    message = "Sólo un administrador puede realizar esta operación."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_staff)
