from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('costs', '0003_project_budget_item'),
    ]

    operations = [
        migrations.AddField(
            model_name='activitykit',
            name='codigo_kit',
            field=models.CharField(
                blank=True,
                max_length=50,
                null=True,
                unique=True,
                verbose_name='Código del Kit',
            ),
        ),
    ]
