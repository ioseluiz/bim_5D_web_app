from rest_framework import serializers
from .models import MasterFormat, Activity, ActivityKit

class MasterFormatSerializer(serializers.ModelSerializer):
    class Meta:
        model = MasterFormat
        fields = '__all__'

class ActivitySerializer(serializers.ModelSerializer):
    division_name = serializers.ReadOnlyField(source='division.division_name')
    division_code = serializers.ReadOnlyField(source='division.division_code')
    
    class Meta:
        model = Activity
        fields = '__all__'

class ActivityKitSerializer(serializers.ModelSerializer):
    activities = ActivitySerializer(many=True, read_only=True)
    
    class Meta:
        model = ActivityKit
        fields = '__all__'
