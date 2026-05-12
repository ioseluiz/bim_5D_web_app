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
    codigo_actividad = models.CharField(max_length=50, verbose_name="Código de Actividad")
    descripcion = models.TextField(verbose_name="Descripción")
    unidad = models.CharField(max_length=20, verbose_name="Unidad")
    cu_total = models.DecimalField(max_digits=12, decimal_places=4, verbose_name="Costo Unitario Total")
    material = models.DecimalField(max_digits=12, decimal_places=4, default=0, verbose_name="Material")
    mano_obra = models.DecimalField(max_digits=12, decimal_places=4, default=0, verbose_name="Mano de Obra")
    equipo = models.DecimalField(max_digits=12, decimal_places=4, default=0, verbose_name="Equipo")
    division = models.ForeignKey(MasterFormat, on_delete=models.CASCADE, related_name="activities", verbose_name="División MasterFormat")
    proyecto = models.ForeignKey(
        'bim.Project',
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name="activities",
        verbose_name="Proyecto"
    )
    base_actividad = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="overrides",
        verbose_name="Actividad Base (Maestra)"
    )

    def __str__(self):
        return f"{self.codigo_actividad} - {self.descripcion[:50]}"

    class Meta:
        verbose_name = "Actividad"
        verbose_name_plural = "Actividades"
        constraints = [
            models.UniqueConstraint(
                fields=['codigo_actividad'],
                condition=models.Q(proyecto__isnull=True),
                name='unique_master_codigo_actividad'
            ),
        ]

class ActivityKit(models.Model):
    nombre = models.CharField(max_length=255, verbose_name="Nombre del Kit")
    descripcion = models.TextField(blank=True, null=True, verbose_name="Descripción")
    activities = models.ManyToManyField(Activity, related_name="kits", blank=True, verbose_name="Actividades")
    proyecto = models.ForeignKey(
        'bim.Project',
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name="activity_kits",
        verbose_name="Proyecto"
    )

    def __str__(self):
        return self.nombre

    class Meta:
        verbose_name = "Kit de Actividades"
        verbose_name_plural = "Kits de Actividades"

class ProjectBudgetItem(models.Model):
    proyecto = models.ForeignKey(
        'bim.Project',
        on_delete=models.CASCADE,
        related_name="budget_items",
        verbose_name="Proyecto"
    )
    actividad = models.ForeignKey(
        Activity,
        on_delete=models.CASCADE,
        related_name="budget_items",
        verbose_name="Actividad"
    )
    cantidad = models.DecimalField(max_digits=14, decimal_places=4, default=0, verbose_name="Cantidad")

    def __str__(self):
        return f"{self.proyecto} – {self.actividad.codigo_actividad}"

    class Meta:
        verbose_name = "Ítem de Presupuesto"
        verbose_name_plural = "Ítems de Presupuesto"
        unique_together = [['proyecto', 'actividad']]
