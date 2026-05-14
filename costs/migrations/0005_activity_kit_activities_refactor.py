from django.db import migrations, models
import django.db.models.deletion


def migrate_m2m_to_fk(apps, schema_editor):
    """Convert existing M2M kit-activity relationships to FK-based kit activities."""
    ActivityKit = apps.get_model('costs', 'ActivityKit')
    Activity = apps.get_model('costs', 'Activity')

    for kit in ActivityKit.objects.all():
        for master_activity in kit.activities.all():
            Activity.objects.create(
                codigo_actividad=master_activity.codigo_actividad,
                descripcion=master_activity.descripcion,
                unidad=master_activity.unidad,
                cu_total=master_activity.cu_total,
                material=master_activity.material,
                mano_obra=master_activity.mano_obra,
                equipo=master_activity.equipo,
                division=master_activity.division,
                activity_kit=kit,
                base_actividad=master_activity,
            )


class Migration(migrations.Migration):

    dependencies = [
        ('costs', '0004_activitykit_codigo_kit'),
    ]

    operations = [
        # 1. Add activity_kit FK to Activity
        migrations.AddField(
            model_name='activity',
            name='activity_kit',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='kit_activities',
                to='costs.activitykit',
                verbose_name='Kit de Actividades',
            ),
        ),
        # 2. Update unique constraint BEFORE data migration so kit activities don't collide
        migrations.RemoveConstraint(
            model_name='activity',
            name='unique_master_codigo_actividad',
        ),
        migrations.AddConstraint(
            model_name='activity',
            constraint=models.UniqueConstraint(
                condition=models.Q(proyecto__isnull=True, activity_kit__isnull=True),
                fields=['codigo_actividad'],
                name='unique_master_codigo_actividad',
            ),
        ),
        # 3. Convert M2M entries to FK-based Activity records
        migrations.RunPython(migrate_m2m_to_fk, migrations.RunPython.noop),
        # 4. Remove M2M field
        migrations.RemoveField(
            model_name='activitykit',
            name='activities',
        ),
    ]
