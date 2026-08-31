from django.http import HttpResponse
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from .importers import (
    ImportError_,
    ImportPayload,
    apply_import,
    build_template_workbook,
    export_library_csv_zip,
    export_library_json,
    export_library_xlsx,
    parse_file,
)
from .models import MasterFormat, Activity, ActivityKit, ProjectBudgetItem
from .permissions import (
    ActivityObjectPermission, IsStaff, IsStaffOrReadOnly, KitObjectPermission,
)
from .serializers import (
    MasterFormatSerializer, ActivitySerializer, KitActivitySerializer,
    ActivityKitSerializer, ProjectBudgetItemSerializer,
)


class MasterFormatViewSet(viewsets.ModelViewSet):
    queryset = MasterFormat.objects.all()
    serializer_class = MasterFormatSerializer
    permission_classes = [IsStaffOrReadOnly]


class ActivityViewSet(viewsets.ModelViewSet):
    serializer_class = ActivitySerializer
    permission_classes = [ActivityObjectPermission]

    def perform_create(self, serializer):
        proyecto = serializer.validated_data.get('proyecto')
        activity_kit = serializer.validated_data.get('activity_kit')
        user = self.request.user
        if proyecto is not None:
            if not user.is_staff and getattr(proyecto, 'owner_id', None) != user.id:
                raise PermissionDenied("No puede crear actividades en este proyecto.")
        elif activity_kit is not None:
            kit_proyecto = getattr(activity_kit, 'proyecto', None)
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
            return Activity.objects.select_related('division').all()

        proyecto_id = self.request.query_params.get('proyecto')
        include_master = self.request.query_params.get('include_master', 'false').lower() == 'true'

        if proyecto_id:
            # Verify the project belongs to the current user
            qs = Activity.objects.filter(
                proyecto_id=proyecto_id,
                proyecto__owner=self.request.user,
            )
            if include_master:
                qs = (
                    Activity.objects.filter(proyecto__isnull=True, activity_kit__isnull=True) |
                    Activity.objects.filter(proyecto_id=proyecto_id, proyecto__owner=self.request.user)
                )
            return qs.select_related('division')

        return Activity.objects.filter(
            proyecto__isnull=True, activity_kit__isnull=True
        ).select_related('division')


class ActivityKitViewSet(viewsets.ModelViewSet):
    serializer_class = ActivityKitSerializer
    permission_classes = [KitObjectPermission]

    def get_queryset(self):
        proyecto_id = self.request.query_params.get('proyecto')
        if proyecto_id:
            return ActivityKit.objects.filter(
                proyecto_id=proyecto_id,
                proyecto__owner=self.request.user,
            ).prefetch_related('kit_activities__division')
        if self.action == 'list':
            # Sin ?proyecto, la lista muestra sólo la biblioteca compartida.
            return ActivityKit.objects.filter(
                proyecto__isnull=True
            ).prefetch_related('kit_activities__division')
        # Retrieve/update/delete: maestros + kits de proyectos del usuario.
        return (
            ActivityKit.objects.filter(proyecto__isnull=True) |
            ActivityKit.objects.filter(proyecto__owner=self.request.user)
        ).prefetch_related('kit_activities__division')

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

    @action(detail=True, methods=['post'], url_path='add_activity')
    def add_activity(self, request, pk=None):
        kit = self.get_object()
        self._require_staff_for_master(kit)
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
        kit = self.get_object()
        self._require_staff_for_master(kit)
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
                    base_actividad=master.base_actividad,
                )
                created.append(KitActivitySerializer(act).data)
            except Activity.DoesNotExist:
                continue

        return Response({'created': created}, status=status.HTTP_201_CREATED)

    @action(
        detail=False, methods=['post'], url_path='import_library',
        parser_classes=[MultiPartParser, FormParser, JSONParser],
        permission_classes=[IsStaff],
    )
    def import_library(self, request):
        files = request.FILES.getlist('files') or (
            [request.FILES['file']] if 'file' in request.FILES else []
        )
        if not files:
            return Response(
                {'error': 'Adjunte al menos un archivo en el campo «files».'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        combined = ImportPayload()
        try:
            for f in files:
                combined.extend(parse_file(f))
            summary = apply_import(combined)
        except ImportError_ as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(summary.as_dict(), status=status.HTTP_200_OK)

    @action(detail=False, methods=['get'], url_path='export_library')
    def export_library(self, request):
        # `format` es reservado por DRF (content negotiation); usamos `fmt`.
        fmt = (request.query_params.get('fmt') or 'xlsx').lower()
        if fmt == 'xlsx':
            content = export_library_xlsx()
            content_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            filename = 'biblioteca_kits.xlsx'
        elif fmt == 'json':
            content = export_library_json()
            content_type = 'application/json'
            filename = 'biblioteca_kits.json'
        elif fmt == 'csv':
            content = export_library_csv_zip()
            content_type = 'application/zip'
            filename = 'biblioteca_kits.zip'
        else:
            return Response(
                {'error': "Formato inválido. Use 'xlsx', 'csv' o 'json'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        response = HttpResponse(content, content_type=content_type)
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response

    @action(detail=False, methods=['get'], url_path='template')
    def template(self, request):
        content = build_template_workbook()
        response = HttpResponse(
            content,
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        response['Content-Disposition'] = (
            'attachment; filename="plantilla_biblioteca_kits.xlsx"'
        )
        return response

    @action(
        detail=True, methods=['post'], url_path='copy_to_project',
        permission_classes=[IsAuthenticated],
    )
    def copy_to_project(self, request, pk=None):
        # Copiar un kit maestro NO lo modifica: sólo lee de él y crea uno nuevo
        # en el proyecto del usuario. Se salta `get_object()` (cuyo check por
        # objeto es de escritura) y valida ownership del proyecto destino.
        master_kit = ActivityKit.objects.filter(pk=pk, proyecto__isnull=True).first()
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

        new_kit = ActivityKit.objects.create(
            codigo_kit=None,  # codigo_kit es unique global; la copia queda sin código.
            nombre=master_kit.nombre,
            descripcion=master_kit.descripcion,
            color=master_kit.color,
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

        return Response(ActivityKitSerializer(new_kit).data, status=status.HTTP_201_CREATED)


class ProjectBudgetItemViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectBudgetItemSerializer

    def get_queryset(self):
        if self.action not in ('list',):
            return ProjectBudgetItem.objects.select_related(
                'actividad', 'actividad__division'
            ).filter(proyecto__owner=self.request.user)

        proyecto_id = self.request.query_params.get('proyecto')
        if proyecto_id:
            return ProjectBudgetItem.objects.filter(
                proyecto_id=proyecto_id,
                proyecto__owner=self.request.user,
            ).select_related('actividad', 'actividad__division')
        return ProjectBudgetItem.objects.none()

    @action(detail=False, methods=['post'], url_path='generate_from_kits')
    def generate_from_kits(self, request):
        proyecto_id = request.data.get('proyecto')
        if not proyecto_id:
            return Response({'error': 'Se requiere el ID del proyecto.'}, status=status.HTTP_400_BAD_REQUEST)

        kits = ActivityKit.objects.filter(
            proyecto_id=proyecto_id, proyecto__owner=request.user
        )
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
