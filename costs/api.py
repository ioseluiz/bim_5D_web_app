from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import MasterFormat, Activity, ActivityKit, ProjectBudgetItem
from .serializers import (
    MasterFormatSerializer, ActivitySerializer, KitActivitySerializer,
    ActivityKitSerializer, ProjectBudgetItemSerializer
)

class MasterFormatViewSet(viewsets.ModelViewSet):
    queryset = MasterFormat.objects.all()
    serializer_class = MasterFormatSerializer

class ActivityViewSet(viewsets.ModelViewSet):
    serializer_class = ActivitySerializer

    def get_queryset(self):
        # For object-level operations allow any activity to be found
        if self.action not in ('list',):
            return Activity.objects.select_related('division').all()

        proyecto_id = self.request.query_params.get('proyecto')
        include_master = self.request.query_params.get('include_master', 'false').lower() == 'true'

        if proyecto_id:
            qs = Activity.objects.filter(proyecto_id=proyecto_id)
            if include_master:
                qs = (
                    Activity.objects.filter(proyecto__isnull=True, activity_kit__isnull=True) |
                    Activity.objects.filter(proyecto_id=proyecto_id)
                )
            return qs.select_related('division')

        # Default: master catalogue only (no kit or project activities)
        return Activity.objects.filter(
            proyecto__isnull=True, activity_kit__isnull=True
        ).select_related('division')

class ActivityKitViewSet(viewsets.ModelViewSet):
    serializer_class = ActivityKitSerializer

    def get_queryset(self):
        proyecto_id = self.request.query_params.get('proyecto')
        if proyecto_id:
            return ActivityKit.objects.filter(proyecto_id=proyecto_id).prefetch_related('kit_activities__division')
        return ActivityKit.objects.filter(proyecto__isnull=True).prefetch_related('kit_activities__division')

    @action(detail=True, methods=['post'], url_path='add_activity')
    def add_activity(self, request, pk=None):
        """Create a single new activity for this kit (from scratch or derived from a master)."""
        kit = self.get_object()
        data = request.data.copy()

        base_id = data.pop('base_actividad_id', None)
        if base_id:
            try:
                master = Activity.objects.get(
                    id=base_id, proyecto__isnull=True, activity_kit__isnull=True
                )
                data.setdefault('codigo_actividad', master.codigo_actividad)
                data.setdefault('descripcion', master.descripcion)
                data.setdefault('unidad', master.unidad)
                data.setdefault('cu_total', str(master.cu_total))
                data.setdefault('material', str(master.material))
                data.setdefault('mano_obra', str(master.mano_obra))
                data.setdefault('equipo', str(master.equipo))
                data.setdefault('division', master.division_id)
                data['base_actividad'] = master.id
            except Activity.DoesNotExist:
                return Response({'error': 'Actividad base no encontrada.'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = KitActivitySerializer(data=data)
        if serializer.is_valid():
            serializer.save(activity_kit=kit)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='import_activities')
    def import_activities(self, request, pk=None):
        """Import multiple master activities into this kit (creates editable copies)."""
        kit = self.get_object()
        master_ids = request.data.get('activity_ids', [])
        if not master_ids:
            return Response({'error': 'Se requiere activity_ids.'}, status=status.HTTP_400_BAD_REQUEST)

        created = []
        for master_id in master_ids:
            try:
                master = Activity.objects.get(
                    id=master_id, proyecto__isnull=True, activity_kit__isnull=True
                )
                act = Activity.objects.create(
                    codigo_actividad=master.codigo_actividad,
                    descripcion=master.descripcion,
                    unidad=master.unidad,
                    cu_total=master.cu_total,
                    material=master.material,
                    mano_obra=master.mano_obra,
                    equipo=master.equipo,
                    division=master.division,
                    activity_kit=kit,
                    base_actividad=master,
                )
                created.append(KitActivitySerializer(act).data)
            except Activity.DoesNotExist:
                continue

        return Response({'created': created}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='copy_to_project')
    def copy_to_project(self, request, pk=None):
        master_kit = self.get_object()
        proyecto_id = request.data.get('proyecto')
        if not proyecto_id:
            return Response({'error': 'Se requiere el ID del proyecto.'}, status=status.HTTP_400_BAD_REQUEST)

        new_kit = ActivityKit.objects.create(
            codigo_kit=master_kit.codigo_kit,
            nombre=master_kit.nombre,
            descripcion=master_kit.descripcion,
            proyecto_id=proyecto_id,
        )
        for act in master_kit.kit_activities.all():
            Activity.objects.create(
                codigo_actividad=act.codigo_actividad,
                descripcion=act.descripcion,
                unidad=act.unidad,
                cu_total=act.cu_total,
                material=act.material,
                mano_obra=act.mano_obra,
                equipo=act.equipo,
                division=act.division,
                activity_kit=new_kit,
                base_actividad=act.base_actividad,
            )

        serializer = ActivityKitSerializer(new_kit)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ProjectBudgetItemViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectBudgetItemSerializer

    def get_queryset(self):
        if self.action not in ('list',):
            return ProjectBudgetItem.objects.select_related(
                'actividad', 'actividad__division'
            ).all()
        proyecto_id = self.request.query_params.get('proyecto')
        if proyecto_id:
            return ProjectBudgetItem.objects.filter(
                proyecto_id=proyecto_id
            ).select_related('actividad', 'actividad__division')
        return ProjectBudgetItem.objects.none()

    @action(detail=False, methods=['post'], url_path='generate_from_kits')
    def generate_from_kits(self, request):
        proyecto_id = request.data.get('proyecto')
        if not proyecto_id:
            return Response({'error': 'Se requiere el ID del proyecto.'}, status=status.HTTP_400_BAD_REQUEST)

        kits = ActivityKit.objects.filter(proyecto_id=proyecto_id)
        activities = Activity.objects.filter(activity_kit__in=kits)

        created = 0
        for activity in activities:
            _, was_created = ProjectBudgetItem.objects.get_or_create(
                proyecto_id=proyecto_id,
                actividad=activity,
                defaults={'cantidad': 0},
            )
            if was_created:
                created += 1

        return Response({'message': f'{created} ítems nuevos generados.', 'total': activities.count()})
