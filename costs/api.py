from rest_framework import viewsets
from .models import MasterFormat, Activity, ActivityKit
from .serializers import MasterFormatSerializer, ActivitySerializer, ActivityKitSerializer

class MasterFormatViewSet(viewsets.ModelViewSet):
    queryset = MasterFormat.objects.all()
    serializer_class = MasterFormatSerializer

class ActivityViewSet(viewsets.ModelViewSet):
    queryset = Activity.objects.all()
    serializer_class = ActivitySerializer

class ActivityKitViewSet(viewsets.ModelViewSet):
    queryset = ActivityKit.objects.all()
    serializer_class = ActivityKitSerializer
