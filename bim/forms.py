from django import forms
from .models import Project, BIMModel

class ProjectForm(forms.ModelForm):
    class Meta:
        model = Project
        fields = ['nombre', 'descripcion']
        widgets = {
            'descripcion': forms.Textarea(attrs={'rows': 4}),
        }

class BIMModelForm(forms.ModelForm):
    class Meta:
        model = BIMModel
        fields = ['nombre', 'archivo', 'version']
