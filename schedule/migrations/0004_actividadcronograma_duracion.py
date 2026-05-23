from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('schedule', '0003_kitcronograma_color'),
    ]

    operations = [
        migrations.AddField(
            model_name='actividadcronograma',
            name='duracion',
            field=models.PositiveIntegerField(
                blank=True,
                null=True,
                verbose_name='Duración (días)',
            ),
        ),
    ]
