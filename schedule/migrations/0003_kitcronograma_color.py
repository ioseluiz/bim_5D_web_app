from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('schedule', '0002_actividadcronograma_division'),
    ]

    operations = [
        migrations.AddField(
            model_name='kitcronograma',
            name='color',
            field=models.CharField(
                blank=True,
                default='#22c55e',
                max_length=9,
                verbose_name='Color del Kit',
            ),
        ),
    ]
