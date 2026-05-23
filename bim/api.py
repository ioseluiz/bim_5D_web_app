from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Project, BIMModel, BIMElement
from .serializers import ProjectSerializer, BIMModelSerializer, BIMElementSerializer


class ProjectViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectSerializer

    def get_queryset(self):
        return Project.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)


class BIMModelViewSet(viewsets.ModelViewSet):
    serializer_class = BIMModelSerializer

    def get_queryset(self):
        return BIMModel.objects.filter(proyecto__owner=self.request.user)


class BIMElementViewSet(viewsets.ModelViewSet):
    serializer_class = BIMElementSerializer
    lookup_field = 'guid'

    def get_queryset(self):
        return BIMElement.objects.filter(modelo__proyecto__owner=self.request.user)

    @action(detail=False, methods=['post'])
    def link_kit(self, request):
        guid = request.data.get('guid')
        model_id = request.data.get('model_id')
        kit_id = request.data.get('kit_id')
        categoria = request.data.get('categoria', 'Unknown')
        tipo = request.data.get('tipo', 'Unknown')

        if not guid or not model_id:
            return Response({'error': 'Missing GUID or Model ID'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            bim_model = BIMModel.objects.get(pk=model_id, proyecto__owner=request.user)
            element, _ = BIMElement.objects.get_or_create(
                guid=guid,
                defaults={'modelo': bim_model, 'categoria': categoria, 'tipo': tipo},
            )
            element.activity_kit_id = kit_id if kit_id else None
            element.save()
            return Response(self.get_serializer(element).data)
        except BIMModel.DoesNotExist:
            return Response({'error': 'Model not found'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
