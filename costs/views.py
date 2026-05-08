from django.views.generic import ListView, CreateView, UpdateView, DeleteView
from django.urls import reverse_lazy
from .models import MasterFormat, Activity, ActivityKit
from .forms import MasterFormatForm, ActivityForm, ActivityKitForm

# MasterFormat Views
class MasterFormatListView(ListView):
    model = MasterFormat
    template_name = 'costs/masterformat_list.html'
    context_object_name = 'divisions'

class MasterFormatCreateView(CreateView):
    model = MasterFormat
    form_class = MasterFormatForm
    template_name = 'costs/masterformat_form.html'
    success_url = reverse_lazy('costs:masterformat_list')

class MasterFormatUpdateView(UpdateView):
    model = MasterFormat
    form_class = MasterFormatForm
    template_name = 'costs/masterformat_form.html'
    success_url = reverse_lazy('costs:masterformat_list')

class MasterFormatDeleteView(DeleteView):
    model = MasterFormat
    template_name = 'costs/masterformat_confirm_delete.html'
    success_url = reverse_lazy('costs:masterformat_list')

# Activity Views
class ActivityListView(ListView):
    model = Activity
    template_name = 'costs/activity_list.html'
    context_object_name = 'activities'

class ActivityCreateView(CreateView):
    model = Activity
    form_class = ActivityForm
    template_name = 'costs/activity_form.html'
    success_url = reverse_lazy('costs:activity_list')

class ActivityUpdateView(UpdateView):
    model = Activity
    form_class = ActivityForm
    template_name = 'costs/activity_form.html'
    success_url = reverse_lazy('costs:activity_list')

class ActivityDeleteView(DeleteView):
    model = Activity
    template_name = 'costs/activity_confirm_delete.html'
    success_url = reverse_lazy('costs:activity_list')

# ActivityKit Views
class ActivityKitListView(ListView):
    model = ActivityKit
    template_name = 'costs/activitykit_list.html'
    context_object_name = 'kits'

class ActivityKitCreateView(CreateView):
    model = ActivityKit
    form_class = ActivityKitForm
    template_name = 'costs/activitykit_form.html'
    success_url = reverse_lazy('costs:activitykit_list')

class ActivityKitUpdateView(UpdateView):
    model = ActivityKit
    form_class = ActivityKitForm
    template_name = 'costs/activitykit_form.html'
    success_url = reverse_lazy('costs:activitykit_list')

class ActivityKitDeleteView(DeleteView):
    model = ActivityKit
    template_name = 'costs/activitykit_confirm_delete.html'
    success_url = reverse_lazy('costs:activitykit_list')
