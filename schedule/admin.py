from django.contrib import admin
from .models import KitCronograma, ActividadCronograma


class ActividadCronogramaInline(admin.TabularInline):
    model = ActividadCronograma
    fk_name = 'kit_cronograma'
    extra = 0
    fields = ('codigo_actividad', 'descripcion', 'fecha_inicio', 'fecha_fin', 'fase', 'sector', 'division', 'base_actividad')
    readonly_fields = ('base_actividad',)


@admin.register(KitCronograma)
class KitCronogramaAdmin(admin.ModelAdmin):
    list_display = ('codigo_kit', 'nombre', 'descripcion', 'proyecto')
    list_filter = ('proyecto',)
    search_fields = ('codigo_kit', 'nombre', 'descripcion')
    inlines = [ActividadCronogramaInline]


@admin.register(ActividadCronograma)
class ActividadCronogramaAdmin(admin.ModelAdmin):
    list_display = ('codigo_actividad', 'descripcion', 'fecha_inicio', 'fecha_fin', 'fase', 'sector', 'division', 'proyecto', 'kit_cronograma')
    list_filter = ('division', 'fase', 'sector', 'proyecto', 'kit_cronograma')
    search_fields = ('codigo_actividad', 'descripcion', 'fase', 'sector')
