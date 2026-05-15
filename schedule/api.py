from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import KitCronograma, ActividadCronograma
from .serializers import (
    KitCronogramaSerializer,
    KitActividadCronogramaSerializer,
    ActividadCronogramaSerializer,
)


class ActividadCronogramaViewSet(viewsets.ModelViewSet):
    serializer_class = ActividadCronogramaSerializer

    def get_queryset(self):
        if self.action not in ('list',):
            return ActividadCronograma.objects.select_related('division').all()

        proyecto_id = self.request.query_params.get('proyecto')
        include_master = self.request.query_params.get('include_master', 'false').lower() == 'true'

        if proyecto_id:
            qs = ActividadCronograma.objects.filter(proyecto_id=proyecto_id)
            if include_master:
                qs = (
                    ActividadCronograma.objects.filter(
                        proyecto__isnull=True, kit_cronograma__isnull=True
                    ) | ActividadCronograma.objects.filter(proyecto_id=proyecto_id)
                )
            return qs.select_related('division')

        return ActividadCronograma.objects.filter(
            proyecto__isnull=True, kit_cronograma__isnull=True
        ).select_related('division')


class KitCronogramaViewSet(viewsets.ModelViewSet):
    serializer_class = KitCronogramaSerializer

    def get_queryset(self):
        if self.action not in ('list',):
            return KitCronograma.objects.prefetch_related('kit_actividades__division').all()

        proyecto_id = self.request.query_params.get('proyecto')
        if proyecto_id:
            return KitCronograma.objects.filter(
                proyecto_id=proyecto_id
            ).prefetch_related('kit_actividades__division')
        return KitCronograma.objects.filter(
            proyecto__isnull=True
        ).prefetch_related('kit_actividades__division')

    @action(detail=True, methods=['post'], url_path='add_actividad')
    def add_actividad(self, request, pk=None):
        kit = self.get_object()
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
                return Response(
                    {'error': 'Actividad base no encontrada.'},
                    status=status.HTTP_400_BAD_REQUEST
                )

        serializer = KitActividadCronogramaSerializer(data=data)
        if serializer.is_valid():
            serializer.save(kit_cronograma=kit)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='import_actividades')
    def import_actividades(self, request, pk=None):
        kit = self.get_object()
        master_ids = request.data.get('actividad_ids', [])
        if not master_ids:
            return Response(
                {'error': 'Se requiere actividad_ids.'},
                status=status.HTTP_400_BAD_REQUEST
            )

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

    @action(detail=True, methods=['post'], url_path='copy_to_project')
    def copy_to_project(self, request, pk=None):
        master_kit = self.get_object()
        proyecto_id = request.data.get('proyecto')
        if not proyecto_id:
            return Response(
                {'error': 'Se requiere el ID del proyecto.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        new_kit = KitCronograma.objects.create(
            codigo_kit=master_kit.codigo_kit,
            nombre=master_kit.nombre,
            descripcion=master_kit.descripcion,
            proyecto_id=proyecto_id,
        )
        for act in master_kit.kit_actividades.select_related('division').all():
            ActividadCronograma.objects.create(
                codigo_actividad=act.codigo_actividad,
                descripcion=act.descripcion,
                fecha_inicio=act.fecha_inicio,
                fecha_fin=act.fecha_fin,
                fase=act.fase,
                sector=act.sector,
                division=act.division,
                kit_cronograma=new_kit,
                base_actividad=act.base_actividad,
            )

        serializer = KitCronogramaSerializer(new_kit)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
