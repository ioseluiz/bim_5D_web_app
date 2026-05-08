from django.contrib import admin
from .models import Project, BIMModel, BIMElement

class BIMModelInline(admin.TabularInline):
    model = BIMModel
    extra = 1

@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'creado_el')
    inlines = [BIMModelInline]

@admin.register(BIMModel)
class BIMModelAdmin(admin.ModelAdmin):
    list_display = ('nombre', 'proyecto', 'version', 'cargado_el')
    list_filter = ('proyecto',)

@admin.register(BIMElement)
class BIMElementAdmin(admin.ModelAdmin):
    list_display = ('guid', 'tipo', 'categoria', 'modelo', 'activity_kit')
    list_filter = ('modelo', 'categoria')
    search_fields = ('guid', 'tipo')
