from django.db import models
from costs.models import ActivityKit

class Project(models.Model):
    nombre = models.CharField(max_length=255, verbose_name="Nombre del Proyecto")
    descripcion = models.TextField(blank=True, null=True, verbose_name="Descripción")
    creado_el = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.nombre

    class Meta:
        verbose_name = "Proyecto"
        verbose_name_plural = "Proyectos"

class BIMModel(models.Model):
    proyecto = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="bim_models", verbose_name="Proyecto")
    nombre = models.CharField(max_length=255, verbose_name="Nombre del Modelo")
    archivo = models.FileField(upload_to="bim_models/", verbose_name="Archivo IFC")
    version = models.CharField(max_length=50, blank=True, null=True, verbose_name="Versión")
    cargado_el = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.proyecto.nombre} - {self.nombre}"

    class Meta:
        verbose_name = "Modelo BIM"
        verbose_name_plural = "Modelos BIM"

class BIMElement(models.Model):
    guid = models.CharField(max_length=50, unique=True, verbose_name="GUID")
    categoria = models.CharField(max_length=100, verbose_name="Categoría")
    tipo = models.CharField(max_length=255, verbose_name="Tipo")
    modelo = models.ForeignKey(BIMModel, on_delete=models.CASCADE, related_name="elements", verbose_name="Modelo BIM")
    activity_kit = models.ForeignKey(ActivityKit, on_delete=models.SET_NULL, null=True, blank=True, related_name="elements", verbose_name="Kit de Actividades")

    def __str__(self):
        return f"{self.guid} - {self.tipo}"

    class Meta:
        verbose_name = "Elemento BIM"
        verbose_name_plural = "Elementos BIM"
