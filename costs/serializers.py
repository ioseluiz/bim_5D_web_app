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

class KitActivitySerializer(serializers.ModelSerializer):
    division_name = serializers.ReadOnlyField(source='division.division_name')
    division_code = serializers.ReadOnlyField(source='division.division_code')

    class Meta:
        model = Activity
        fields = [
            'id', 'codigo_actividad', 'descripcion', 'unidad',
            'cu_total', 'material', 'mano_obra', 'equipo',
            'division', 'division_name', 'division_code', 'base_actividad',
        ]

class ActivityKitSerializer(serializers.ModelSerializer):
    kit_activities = KitActivitySerializer(many=True, read_only=True)

    class Meta:
        model = ActivityKit
        fields = ['id', 'codigo_kit', 'nombre', 'descripcion', 'proyecto', 'kit_activities']

    def create(self, validated_data):
        return ActivityKit.objects.create(**validated_data)

    def update(self, instance, validated_data):
        instance.codigo_kit = validated_data.get('codigo_kit', instance.codigo_kit)
        instance.nombre = validated_data.get('nombre', instance.nombre)
        instance.descripcion = validated_data.get('descripcion', instance.descripcion)
        if 'proyecto' in validated_data:
            instance.proyecto = validated_data['proyecto']
        instance.save()
        return instance

class ProjectBudgetItemSerializer(serializers.ModelSerializer):
    actividad_detail = ActivitySerializer(source='actividad', read_only=True)
    costo_total = serializers.SerializerMethodField()

    class Meta:
        model = ProjectBudgetItem
        fields = ['id', 'proyecto', 'actividad', 'cantidad', 'actividad_detail', 'costo_total']

    def get_costo_total(self, obj):
        return float(obj.cantidad) * float(obj.actividad.cu_total)
