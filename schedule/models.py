from django.db import models
from costs.models import MasterFormat


class KitCronograma(models.Model):
    codigo_kit = models.CharField(
        max_length=50, unique=True, null=True, blank=True,
        verbose_name="Código del Kit"
    )
    nombre = models.CharField(max_length=255, verbose_name="Nombre del Kit")
    descripcion = models.TextField(blank=True, null=True, verbose_name="Descripción")
    proyecto = models.ForeignKey(
        'bim.Project',
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name="schedule_kits",
        verbose_name="Proyecto"
    )

    def __str__(self):
        return self.nombre

    class Meta:
        verbose_name = "Kit de Cronograma"
        verbose_name_plural = "Kits de Cronograma"


class ActividadCronograma(models.Model):
    codigo_actividad = models.CharField(max_length=50, verbose_name="Código de Actividad")
    descripcion = models.TextField(verbose_name="Descripción")
    fecha_inicio = models.DateField(null=True, blank=True, verbose_name="Fecha de Inicio")
    fecha_fin = models.DateField(null=True, blank=True, verbose_name="Fecha de Fin")
    fase = models.CharField(max_length=100, blank=True, default='', verbose_name="Fase")
    sector = models.CharField(max_length=100, blank=True, default='', verbose_name="Sector")
    division = models.ForeignKey(
        MasterFormat,
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name="schedule_actividades",
        verbose_name="División MasterFormat"
    )
    kit_cronograma = models.ForeignKey(
        KitCronograma,
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name="kit_actividades",
        verbose_name="Kit de Cronograma"
    )
    proyecto = models.ForeignKey(
        'bim.Project',
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name="schedule_actividades",
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
        verbose_name = "Actividad de Cronograma"
        verbose_name_plural = "Actividades de Cronograma"
        constraints = [
            models.UniqueConstraint(
                fields=['codigo_actividad'],
                condition=models.Q(proyecto__isnull=True, kit_cronograma__isnull=True),
                name='unique_master_schedule_codigo'
            ),
        ]
