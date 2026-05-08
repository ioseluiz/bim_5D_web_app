from django.db import models

class MasterFormat(models.Model):
    division_code = models.CharField(max_length=20, unique=True, verbose_name="Código de División")
    division_name = models.CharField(max_length=255, verbose_name="Nombre de la División")

    def __str__(self):
        return f"{self.division_code} - {self.division_name}"

    class Meta:
        verbose_name = "MasterFormat"
        verbose_name_plural = "MasterFormat Divisions"

class Activity(models.Model):
    codigo_actividad = models.CharField(max_length=50, unique=True, verbose_name="Código de Actividad")
    descripcion = models.TextField(verbose_name="Descripción")
    unidad = models.CharField(max_length=20, verbose_name="Unidad")
    cu_total = models.DecimalField(max_digits=12, decimal_places=4, verbose_name="Costo Unitario Total")
    material = models.DecimalField(max_digits=12, decimal_places=4, default=0, verbose_name="Material")
    mano_obra = models.DecimalField(max_digits=12, decimal_places=4, default=0, verbose_name="Mano de Obra")
    equipo = models.DecimalField(max_digits=12, decimal_places=4, default=0, verbose_name="Equipo")
    division = models.ForeignKey(MasterFormat, on_delete=models.CASCADE, related_name="activities", verbose_name="División MasterFormat")

    def __str__(self):
        return f"{self.codigo_actividad} - {self.descripcion[:50]}"

    class Meta:
        verbose_name = "Actividad"
        verbose_name_plural = "Actividades"

class ActivityKit(models.Model):
    nombre = models.CharField(max_length=255, verbose_name="Nombre del Kit")
    descripcion = models.TextField(blank=True, null=True, verbose_name="Descripción")
    activities = models.ManyToManyField(Activity, related_name="kits", verbose_name="Actividades")

    def __str__(self):
        return self.nombre

    class Meta:
        verbose_name = "Kit de Actividades"
        verbose_name_plural = "Kits de Actividades"
