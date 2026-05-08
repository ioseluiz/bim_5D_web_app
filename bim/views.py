from django.views.generic import ListView, DetailView, TemplateView, CreateView, UpdateView, DeleteView
from django.urls import reverse_lazy
from django.shortcuts import get_object_or_404
from django.http import JsonResponse
from django.views import View
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
import json
from .models import Project, BIMModel, BIMElement
from .forms import ProjectForm, BIMModelForm
from costs.models import ActivityKit

class HomeView(TemplateView):
    template_name = 'home.html'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['project_count'] = Project.objects.count()
        context['model_count'] = BIMModel.objects.count()
        return context

class ProjectListView(ListView):
    model = Project
    template_name = 'bim/project_list.html'
    context_object_name = 'projects'

class ProjectDetailView(DetailView):
    model = Project
    template_name = 'bim/project_detail.html'
    context_object_name = 'project'

class ProjectCreateView(CreateView):
    model = Project
    form_class = ProjectForm
    template_name = 'bim/project_form.html'
    success_url = reverse_lazy('bim:project_list')

class ProjectUpdateView(UpdateView):
    model = Project
    form_class = ProjectForm
    template_name = 'bim/project_form.html'
    success_url = reverse_lazy('bim:project_list')

class ProjectDeleteView(DeleteView):
    model = Project
    template_name = 'bim/project_confirm_delete.html'
    success_url = reverse_lazy('bim:project_list')

class BIMModelCreateView(CreateView):
    model = BIMModel
    form_class = BIMModelForm
    template_name = 'bim/bimmodel_form.html'

    def form_valid(self, form):
        project = get_object_or_404(Project, pk=self.kwargs['project_pk'])
        form.instance.proyecto = project
        return super().form_valid(form)

    def get_success_url(self):
        return reverse_lazy('bim:project_detail', kwargs={'pk': self.kwargs['project_pk']})

class BIMModelDeleteView(DeleteView):
    model = BIMModel
    template_name = 'bim/bimmodel_confirm_delete.html'

    def get_success_url(self):
        return reverse_lazy('bim:project_detail', kwargs={'pk': self.object.proyecto.pk})

class BIMViewerView(DetailView):
    model = BIMModel
    template_name = 'bim/bim_viewer.html'
    context_object_name = 'bim_model'

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context['activity_kits'] = ActivityKit.objects.all()
        return context

class LinkElementKitView(View):
    @method_decorator(csrf_exempt)
    def dispatch(self, *args, **kwargs):
        return super().dispatch(*args, **kwargs)

    def post(self, request, *args, **kwargs):
        try:
            data = json.loads(request.body)
            guid = data.get('guid')
            model_id = data.get('model_id')
            kit_id = data.get('kit_id')
            categoria = data.get('categoria', 'Unknown')
            tipo = data.get('tipo', 'Unknown')

            if not guid or not model_id:
                return JsonResponse({'error': 'Missing GUID or Model ID'}, status=400)

            bim_model = get_object_or_404(BIMModel, pk=model_id)
            
            # Buscar o crear el elemento
            element, created = BIMElement.objects.get_or_create(
                guid=guid,
                defaults={
                    'modelo': bim_model,
                    'categoria': categoria,
                    'tipo': tipo
                }
            )

            if kit_id:
                kit = get_object_or_404(ActivityKit, pk=kit_id)
                element.activity_kit = kit
            else:
                element.activity_kit = None
            
            element.save()

            return JsonResponse({
                'status': 'success',
                'element_id': element.id,
                'kit': element.activity_kit.nombre if element.activity_kit else None
            })
        except Exception as e:
            return JsonResponse({'error': str(e)}, status=500)

class ElementDetailAPIView(View):
    def get(self, request, guid, *args, **kwargs):
        element = BIMElement.objects.filter(guid=guid).first()
        if element:
            return JsonResponse({
                'guid': element.guid,
                'categoria': element.categoria,
                'tipo': element.tipo,
                'kit_id': element.activity_kit.id if element.activity_kit else None,
                'kit_nombre': element.activity_kit.nombre if element.activity_kit else None
            })
        return JsonResponse({'error': 'Not found'}, status=404)
