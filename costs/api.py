from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import MasterFormat, Activity, ActivityKit, ProjectBudgetItem
from .serializers import (
    MasterFormatSerializer, ActivitySerializer,
    ActivityKitSerializer, ProjectBudgetItemSerializer
)

class MasterFormatViewSet(viewsets.ModelViewSet):
    queryset = MasterFormat.objects.all()
    serializer_class = MasterFormatSerializer

class ActivityViewSet(viewsets.ModelViewSet):
    serializer_class = ActivitySerializer

    def get_queryset(self):
        proyecto_id = self.request.query_params.get('proyecto')
        include_master = self.request.query_params.get('include_master', 'false').lower() == 'true'

        if proyecto_id:
            qs = Activity.objects.filter(proyecto_id=proyecto_id)
            if include_master:
                qs = (Activity.objects.filter(proyecto__isnull=True) |
                      Activity.objects.filter(proyecto_id=proyecto_id))
            return qs

        return Activity.objects.filter(proyecto__isnull=True)

class ActivityKitViewSet(viewsets.ModelViewSet):
    serializer_class = ActivityKitSerializer

    def get_queryset(self):
        proyecto_id = self.request.query_params.get('proyecto')
        if proyecto_id:
            return ActivityKit.objects.filter(proyecto_id=proyecto_id)
        return ActivityKit.objects.filter(proyecto__isnull=True)

    @action(detail=True, methods=['post'], url_path='copy_to_project')
    def copy_to_project(self, request, pk=None):
        master_kit = self.get_object()
        proyecto_id = request.data.get('proyecto')
        if not proyecto_id:
            return Response(
                {'error': 'Se requiere el ID del proyecto.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        new_kit = ActivityKit.objects.create(
            nombre=master_kit.nombre,
            descripcion=master_kit.descripcion,
            proyecto_id=proyecto_id
        )
        new_kit.activities.set(master_kit.activities.all())
        serializer = ActivityKitSerializer(new_kit)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

class ProjectBudgetItemViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectBudgetItemSerializer

    def get_queryset(self):
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
            return Response(
                {'error': 'Se requiere el ID del proyecto.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        kits = ActivityKit.objects.filter(proyecto_id=proyecto_id)
        activities = Activity.objects.filter(kits__in=kits).distinct()

        created = 0
        for activity in activities:
            _, was_created = ProjectBudgetItem.objects.get_or_create(
                proyecto_id=proyecto_id,
                actividad=activity,
                defaults={'cantidad': 0}
            )
            if was_created:
                created += 1

        return Response({
            'message': f'{created} ítems nuevos generados.',
            'total': activities.count()
        })
