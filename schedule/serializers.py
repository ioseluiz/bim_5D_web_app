from rest_framework import serializers
from .models import KitCronograma, ActividadCronograma


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
            'fecha_inicio', 'fecha_fin', 'fase', 'sector',
            'division', 'division_name', 'division_code',
            'base_actividad',
        ]


class KitCronogramaSerializer(serializers.ModelSerializer):
    kit_actividades = KitActividadCronogramaSerializer(many=True, read_only=True)

    class Meta:
        model = KitCronograma
        fields = ['id', 'codigo_kit', 'nombre', 'descripcion', 'proyecto', 'kit_actividades']

    def create(self, validated_data):
        return KitCronograma.objects.create(**validated_data)

    def update(self, instance, validated_data):
        instance.codigo_kit = validated_data.get('codigo_kit', instance.codigo_kit)
        instance.nombre = validated_data.get('nombre', instance.nombre)
        instance.descripcion = validated_data.get('descripcion', instance.descripcion)
        if 'proyecto' in validated_data:
            instance.proyecto = validated_data['proyecto']
        instance.save()
        return instance
