from django import forms
from .models import MasterFormat, Activity, ActivityKit

class MasterFormatForm(forms.ModelForm):
    class Meta:
        model = MasterFormat
        fields = ['division_code', 'division_name']

class ActivityForm(forms.ModelForm):
    class Meta:
        model = Activity
        fields = [
            'codigo_actividad', 'descripcion', 'unidad', 
            'cu_total', 'material', 'mano_obra', 'equipo', 'division'
        ]
        widgets = {
            'descripcion': forms.Textarea(attrs={'rows': 3}),
        }

class ActivityKitForm(forms.ModelForm):
    class Meta:
        model = ActivityKit
        fields = ['nombre', 'descripcion', 'activities']
        widgets = {
            'descripcion': forms.Textarea(attrs={'rows': 3}),
            'activities': forms.CheckboxSelectMultiple(),
        }
