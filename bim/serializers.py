from rest_framework import serializers
from .models import Project, BIMModel, BIMElement
from costs.serializers import ActivityKitSerializer

class BIMModelSerializer(serializers.ModelSerializer):
    class Meta:
        model = BIMModel
        fields = '__all__'

class ProjectSerializer(serializers.ModelSerializer):
    bim_models = BIMModelSerializer(many=True, read_only=True)
    
    class Meta:
        model = Project
        fields = '__all__'

class BIMElementSerializer(serializers.ModelSerializer):
    activity_kit_detail = ActivityKitSerializer(source='activity_kit', read_only=True)
    
    class Meta:
        model = BIMElement
        fields = '__all__'
