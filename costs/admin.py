from django.contrib import admin
from import_export import resources, fields
from import_export.widgets import ForeignKeyWidget
from import_export.admin import ImportExportModelAdmin
from .models import MasterFormat, Activity, ActivityKit


class MasterFormatResource(resources.ModelResource):
    class Meta:
        model = MasterFormat
        import_id_fields = ('division_code',)
        fields = ('division_code', 'division_name')


class ActivityResource(resources.ModelResource):
    division = fields.Field(
        column_name='division',
        attribute='division',
        widget=ForeignKeyWidget(MasterFormat, 'division_code')
    )

    class Meta:
        model = Activity
        import_id_fields = ('codigo_actividad',)
        fields = ('codigo_actividad', 'descripcion', 'unidad', 'cu_total', 'material', 'mano_obra', 'equipo', 'division')


class ActivityKitResource(resources.ModelResource):
    class Meta:
        model = ActivityKit
        fields = ('id', 'codigo_kit', 'nombre', 'descripcion')
        export_order = ('id', 'codigo_kit', 'nombre', 'descripcion')


class KitActivityInline(admin.TabularInline):
    model = Activity
    fk_name = 'activity_kit'
    extra = 0
    fields = ('codigo_actividad', 'descripcion', 'unidad', 'cu_total', 'division', 'base_actividad')
    readonly_fields = ('base_actividad',)


@admin.register(MasterFormat)
class MasterFormatAdmin(ImportExportModelAdmin):
    resource_class = MasterFormatResource
    list_display = ('division_code', 'division_name')
    search_fields = ('division_code', 'division_name')


@admin.register(Activity)
class ActivityAdmin(ImportExportModelAdmin):
    resource_class = ActivityResource
    list_display = ('codigo_actividad', 'descripcion', 'unidad', 'cu_total', 'division', 'proyecto', 'activity_kit')
    list_filter = ('division', 'proyecto', 'activity_kit')
    search_fields = ('codigo_actividad', 'descripcion')


@admin.register(ActivityKit)
class ActivityKitAdmin(ImportExportModelAdmin):
    resource_class = ActivityKitResource
    list_display = ('codigo_kit', 'nombre', 'descripcion', 'proyecto')
    list_filter = ('proyecto',)
    search_fields = ('codigo_kit', 'nombre', 'descripcion')
    inlines = [KitActivityInline]
