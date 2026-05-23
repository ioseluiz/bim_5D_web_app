from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('costs', '0005_activity_kit_activities_refactor'),
    ]

    operations = [
        migrations.AddField(
            model_name='activitykit',
            name='color',
            field=models.CharField(
                blank=True,
                default='#3b82f6',
                max_length=9,
                verbose_name='Color del Kit',
            ),
        ),
    ]
