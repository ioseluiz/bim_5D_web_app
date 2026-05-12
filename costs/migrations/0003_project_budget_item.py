import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('costs', '0002_project_activity_kit'),
        ('bim', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='ProjectBudgetItem',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('cantidad', models.DecimalField(decimal_places=4, default=0, max_digits=14, verbose_name='Cantidad')),
                ('actividad', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='budget_items',
                    to='costs.activity',
                    verbose_name='Actividad'
                )),
                ('proyecto', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='budget_items',
                    to='bim.project',
                    verbose_name='Proyecto'
                )),
            ],
            options={
                'verbose_name': 'Ítem de Presupuesto',
                'verbose_name_plural': 'Ítems de Presupuesto',
                'unique_together': {('proyecto', 'actividad')},
            },
        ),
    ]
