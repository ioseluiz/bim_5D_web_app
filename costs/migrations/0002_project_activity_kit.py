import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('costs', '0001_initial'),
        ('bim', '0001_initial'),
    ]

    operations = [
        # Eliminar unique=True de codigo_actividad
        migrations.AlterField(
            model_name='activity',
            name='codigo_actividad',
            field=models.CharField(max_length=50, verbose_name='Código de Actividad'),
        ),
        # Agregar FK proyecto a Activity
        migrations.AddField(
            model_name='activity',
            name='proyecto',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='activities',
                to='bim.project',
                verbose_name='Proyecto'
            ),
        ),
        # Agregar FK base_actividad a Activity (referencia a sí misma)
        migrations.AddField(
            model_name='activity',
            name='base_actividad',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='overrides',
                to='costs.activity',
                verbose_name='Actividad Base (Maestra)'
            ),
        ),
        # Restricción única condicional: solo aplica a actividades maestras (proyecto=null)
        migrations.AddConstraint(
            model_name='activity',
            constraint=models.UniqueConstraint(
                fields=['codigo_actividad'],
                condition=models.Q(proyecto__isnull=True),
                name='unique_master_codigo_actividad'
            ),
        ),
        # Agregar FK proyecto a ActivityKit
        migrations.AddField(
            model_name='activitykit',
            name='proyecto',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='activity_kits',
                to='bim.project',
                verbose_name='Proyecto'
            ),
        ),
        # Permitir M2M vacío en ActivityKit
        migrations.AlterField(
            model_name='activitykit',
            name='activities',
            field=models.ManyToManyField(
                blank=True,
                related_name='kits',
                to='costs.activity',
                verbose_name='Actividades'
            ),
        ),
    ]
