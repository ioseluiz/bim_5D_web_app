from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from costs.permissions import ActivityObjectPermission, KitObjectPermission
from .models import KitCronograma, ActividadCronograma
from .serializers import (
    KitCronogramaSerializer,
    KitActividadCronogramaSerializer,
    ActividadCronogramaSerializer,
)


class ActividadCronogramaViewSet(viewsets.ModelViewSet):
    serializer_class = ActividadCronogramaSerializer
    permission_classes = [ActivityObjectPermission]

    def perform_create(self, serializer):
        proyecto = serializer.validated_data.get('proyecto')
        kit = serializer.validated_data.get('kit_cronograma')
        user = self.request.user
        if proyecto is not None:
            if not user.is_staff and getattr(proyecto, 'owner_id', None) != user.id:
                raise PermissionDenied("No puede crear actividades en este proyecto.")
        elif kit is not None:
            kit_proyecto = getattr(kit, 'proyecto', None)
            if kit_proyecto is None:
                if not user.is_staff:
                    raise PermissionDenied(
                        "Sólo un administrador puede modificar la biblioteca."
                    )
            elif not user.is_staff and getattr(kit_proyecto, 'owner_id', None) != user.id:
                raise PermissionDenied("No puede crear actividades en este proyecto.")
        else:
            if not user.is_staff:
                raise PermissionDenied(
                    "Sólo un administrador puede crear actividades maestras."
                )
        serializer.save()

    def get_queryset(self):
        if self.action not in ('list',):
            return (
                ActividadCronograma.objects.filter(proyecto__owner=self.request.user) |
                ActividadCronograma.objects.filter(proyecto__isnull=True)
            ).select_related('division')

        proyecto_id = self.request.query_params.get('proyecto')
        include_master = self.request.query_params.get('include_master', 'false').lower() == 'true'

        if proyecto_id:
            qs = ActividadCronograma.objects.filter(
                proyecto_id=proyecto_id,
                proyecto__owner=self.request.user,
            )
            if include_master:
                qs = (
                    ActividadCronograma.objects.filter(
                        proyecto__isnull=True, kit_cronograma__isnull=True
                    ) | ActividadCronograma.objects.filter(
                        proyecto_id=proyecto_id,
                        proyecto__owner=self.request.user,
                    )
                )
            return qs.select_related('division')

        return ActividadCronograma.objects.filter(
            proyecto__isnull=True, kit_cronograma__isnull=True
        ).select_related('division')


class KitCronogramaViewSet(viewsets.ModelViewSet):
    serializer_class = KitCronogramaSerializer
    permission_classes = [KitObjectPermission]

    def perform_create(self, serializer):
        proyecto = serializer.validated_data.get('proyecto')
        user = self.request.user
        if proyecto is None:
            if not user.is_staff:
                raise PermissionDenied(
                    "Sólo un administrador puede crear kits en la biblioteca."
                )
        elif not user.is_staff and getattr(proyecto, 'owner_id', None) != user.id:
            raise PermissionDenied("No puede crear kits en este proyecto.")
        serializer.save()

    def _require_staff_for_master(self, kit):
        if kit.proyecto_id is None and not self.request.user.is_staff:
            raise PermissionDenied(
                "Sólo un administrador puede modificar la biblioteca."
            )

    def get_queryset(self):
        if self.action not in ('list',):
            return (
                KitCronograma.objects.filter(proyecto__owner=self.request.user) |
                KitCronograma.objects.filter(proyecto__isnull=True)
            ).prefetch_related('kit_actividades__division')

        proyecto_id = self.request.query_params.get('proyecto')
        if proyecto_id:
            return KitCronograma.objects.filter(
                proyecto_id=proyecto_id,
                proyecto__owner=self.request.user,
            ).prefetch_related('kit_actividades__division')

        # Master kits (no project) — visible to all authenticated users
        return KitCronograma.objects.filter(
            proyecto__isnull=True
        ).prefetch_related('kit_actividades__division')

    @action(detail=True, methods=['post'], url_path='add_actividad')
    def add_actividad(self, request, pk=None):
        kit = self.get_object()
        self._require_staff_for_master(kit)
        data = request.data.copy()

        base_id = data.pop('base_actividad_id', None)
        if base_id:
            try:
                master = ActividadCronograma.objects.get(
                    id=base_id, proyecto__isnull=True, kit_cronograma__isnull=True
                )
                data.setdefault('codigo_actividad', master.codigo_actividad)
                data.setdefault('descripcion', master.descripcion)
                data.setdefault('fecha_inicio', str(master.fecha_inicio) if master.fecha_inicio else None)
                data.setdefault('fecha_fin', str(master.fecha_fin) if master.fecha_fin else None)
                data.setdefault('fase', master.fase)
                data.setdefault('sector', master.sector)
                if master.division_id:
                    data.setdefault('division', master.division_id)
                data['base_actividad'] = master.id
            except ActividadCronograma.DoesNotExist:
                return Response({'error': 'Actividad base no encontrada.'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = KitActividadCronogramaSerializer(data=data)
        if serializer.is_valid():
            serializer.save(kit_cronograma=kit)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='import_actividades')
    def import_actividades(self, request, pk=None):
        kit = self.get_object()
        self._require_staff_for_master(kit)
        master_ids = request.data.get('actividad_ids', [])
        if not master_ids:
            return Response({'error': 'Se requiere actividad_ids.'}, status=status.HTTP_400_BAD_REQUEST)

        created = []
        for master_id in master_ids:
            try:
                master = ActividadCronograma.objects.select_related('division').get(
                    id=master_id, proyecto__isnull=True, kit_cronograma__isnull=True
                )
                act = ActividadCronograma.objects.create(
                    codigo_actividad=master.codigo_actividad,
                    descripcion=master.descripcion,
                    fecha_inicio=master.fecha_inicio,
                    fecha_fin=master.fecha_fin,
                    duracion=master.duracion,
                    fase=master.fase,
                    sector=master.sector,
                    division=master.division,
                    kit_cronograma=kit,
                    base_actividad=master,
                )
                created.append(KitActividadCronogramaSerializer(act).data)
            except ActividadCronograma.DoesNotExist:
                continue

        return Response({'created': created}, status=status.HTTP_201_CREATED)

    @action(
        detail=True, methods=['post'], url_path='copy_to_project',
        permission_classes=[IsAuthenticated],
    )
    def copy_to_project(self, request, pk=None):
        master_kit = KitCronograma.objects.filter(pk=pk, proyecto__isnull=True).first()
        if master_kit is None:
            return Response(
                {'error': 'Kit maestro no encontrado.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        proyecto_id = request.data.get('proyecto')
        if not proyecto_id:
            return Response({'error': 'Se requiere el ID del proyecto.'}, status=status.HTTP_400_BAD_REQUEST)

        from bim.models import Project as _Project
        proyecto = _Project.objects.filter(pk=proyecto_id).first()
        if proyecto is None:
            return Response({'error': 'Proyecto no encontrado.'}, status=status.HTTP_404_NOT_FOUND)
        if not request.user.is_staff and proyecto.owner_id != request.user.id:
            return Response(
                {'error': 'No puede copiar a un proyecto ajeno.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        new_kit = KitCronograma.objects.create(
            codigo_kit=None,  # codigo_kit es unique global; la copia queda sin código.
            nombre=master_kit.nombre,
            descripcion=master_kit.descripcion,
            color=master_kit.color,
            proyecto_id=proyecto_id,
        )
        for act in master_kit.kit_actividades.select_related('division').all():
            ActividadCronograma.objects.create(
                codigo_actividad=act.codigo_actividad,
                descripcion=act.descripcion,
                fecha_inicio=act.fecha_inicio,
                fecha_fin=act.fecha_fin,
                duracion=act.duracion,
                fase=act.fase,
                sector=act.sector,
                division=act.division,
                kit_cronograma=new_kit,
                base_actividad=act.base_actividad,
            )

        return Response(KitCronogramaSerializer(new_kit).data, status=status.HTTP_201_CREATED)
