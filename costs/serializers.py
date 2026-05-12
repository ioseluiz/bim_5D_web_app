from rest_framework import serializers
from .models import MasterFormat, Activity, ActivityKit, ProjectBudgetItem

class MasterFormatSerializer(serializers.ModelSerializer):
    class Meta:
        model = MasterFormat
        fields = '__all__'

class ActivitySerializer(serializers.ModelSerializer):
    division_name = serializers.ReadOnlyField(source='division.division_name')
    division_code = serializers.ReadOnlyField(source='division.division_code')
    es_proyecto = serializers.SerializerMethodField()

    class Meta:
        model = Activity
        fields = '__all__'

    def get_es_proyecto(self, obj):
        return obj.proyecto_id is not None

class ActivityKitSerializer(serializers.ModelSerializer):
    activities = ActivitySerializer(many=True, read_only=True)

    class Meta:
        model = ActivityKit
        fields = '__all__'

    def create(self, validated_data):
        activity_ids = self.initial_data.get('activities', [])
        kit = ActivityKit.objects.create(**validated_data)
        if activity_ids:
            kit.activities.set(activity_ids)
        return kit

    def update(self, instance, validated_data):
        instance.nombre = validated_data.get('nombre', instance.nombre)
        instance.descripcion = validated_data.get('descripcion', instance.descripcion)
        if 'proyecto' in validated_data:
            instance.proyecto = validated_data['proyecto']
        instance.save()
        activity_ids = self.initial_data.get('activities')
        if activity_ids is not None:
            instance.activities.set(activity_ids)
        return instance

class ProjectBudgetItemSerializer(serializers.ModelSerializer):
    actividad_detail = ActivitySerializer(source='actividad', read_only=True)
    costo_total = serializers.SerializerMethodField()

    class Meta:
        model = ProjectBudgetItem
        fields = ['id', 'proyecto', 'actividad', 'cantidad', 'actividad_detail', 'costo_total']

    def get_costo_total(self, obj):
        return float(obj.cantidad) * float(obj.actividad.cu_total)
