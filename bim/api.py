from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Project, BIMModel, BIMElement
from .serializers import ProjectSerializer, BIMModelSerializer, BIMElementSerializer

class ProjectViewSet(viewsets.ModelViewSet):
    queryset = Project.objects.all()
    serializer_class = ProjectSerializer

class BIMModelViewSet(viewsets.ModelViewSet):
    queryset = BIMModel.objects.all()
    serializer_class = BIMModelSerializer

class BIMElementViewSet(viewsets.ModelViewSet):
    queryset = BIMElement.objects.all()
    serializer_class = BIMElementSerializer
    lookup_field = 'guid'

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
            bim_model = BIMModel.objects.get(pk=model_id)
            element, created = BIMElement.objects.get_or_create(
                guid=guid,
                defaults={
                    'modelo': bim_model,
                    'categoria': categoria,
                    'tipo': tipo
                }
            )

            if kit_id:
                element.activity_kit_id = kit_id
            else:
                element.activity_kit = None
            
            element.save()
            serializer = self.get_serializer(element)
            return Response(serializer.data)
        except BIMModel.DoesNotExist:
            return Response({'error': 'Model not found'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
