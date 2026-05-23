from rest_framework import serializers
from .models import KitCronograma, ActividadCronograma
from datetime import date


class ActividadCronogramaSerializer(serializers.ModelSerializer):
    division_name = serializers.ReadOnlyField(source='division.division_name')
    division_code = serializers.ReadOnlyField(source='division.division_code')
    es_proyecto = serializers.SerializerMethodField()

    class Meta:
        model = ActividadCronograma
        fields = '__all__'

    def get_es_proyecto(self, obj):
        return obj.proyecto_id is not None


class KitActividadCronogramaSerializer(serializers.ModelSerializer):
    division_name = serializers.ReadOnlyField(source='division.division_name')
    division_code = serializers.ReadOnlyField(source='division.division_code')

    class Meta:
        model = ActividadCronograma
        fields = [
            'id', 'codigo_actividad', 'descripcion',
            'fecha_inicio', 'fecha_fin', 'duracion', 'fase', 'sector',
            'division', 'division_name', 'division_code',
            'base_actividad',
        ]


class KitCronogramaSerializer(serializers.ModelSerializer):
    kit_actividades = KitActividadCronogramaSerializer(many=True, read_only=True)
    fecha_inicio    = serializers.SerializerMethodField()
    fecha_fin       = serializers.SerializerMethodField()

    class Meta:
        model = KitCronograma
        fields = ['id', 'codigo_kit', 'nombre', 'descripcion', 'color', 'proyecto',
                  'fecha_inicio', 'fecha_fin', 'kit_actividades']

    def get_fecha_inicio(self, obj) -> str | None:
        dates = [a.fecha_inicio for a in obj.kit_actividades.all() if a.fecha_inicio]
        result = min(dates) if dates else None
        return result.isoformat() if isinstance(result, date) else None

    def get_fecha_fin(self, obj) -> str | None:
        dates = [a.fecha_fin for a in obj.kit_actividades.all() if a.fecha_fin]
        result = max(dates) if dates else None
        return result.isoformat() if isinstance(result, date) else None

    def create(self, validated_data):
        return KitCronograma.objects.create(**validated_data)

    def update(self, instance, validated_data):
        instance.codigo_kit = validated_data.get('codigo_kit', instance.codigo_kit)
        instance.nombre = validated_data.get('nombre', instance.nombre)
        instance.descripcion = validated_data.get('descripcion', instance.descripcion)
        instance.color = validated_data.get('color', instance.color)
        if 'proyecto' in validated_data:
            instance.proyecto = validated_data['proyecto']
        instance.save()
        return instance
