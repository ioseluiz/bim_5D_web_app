from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def assign_projects_to_admin(apps, schema_editor):
    """Assign all existing projects to the first superuser (admin)."""
    Project = apps.get_model('bim', 'Project')
    User = apps.get_model(settings.AUTH_USER_MODEL)

    admin = User.objects.filter(is_superuser=True).order_by('pk').first()
    if admin:
        Project.objects.filter(owner__isnull=True).update(owner=admin)


class Migration(migrations.Migration):

    dependencies = [
        ('bim', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='project',
            name='owner',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='projects',
                to=settings.AUTH_USER_MODEL,
                verbose_name='Propietario',
            ),
        ),
        migrations.RunPython(assign_projects_to_admin, migrations.RunPython.noop),
    ]
