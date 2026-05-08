from django.urls import path
from . import views

app_name = 'bim'

urlpatterns = [
    path('', views.HomeView.as_view(), name='home'),
    
    # Proyectos
    path('projects/', views.ProjectListView.as_view(), name='project_list'),
    path('project/add/', views.ProjectCreateView.as_view(), name='project_create'),
    path('project/<int:pk>/', views.ProjectDetailView.as_view(), name='project_detail'),
    path('project/<int:pk>/edit/', views.ProjectUpdateView.as_view(), name='project_edit'),
    path('project/<int:pk>/delete/', views.ProjectDeleteView.as_view(), name='project_delete'),
    
    # Modelos
    path('project/<int:project_pk>/model/add/', views.BIMModelCreateView.as_view(), name='model_create'),
    path('model/<int:pk>/delete/', views.BIMModelDeleteView.as_view(), name='model_delete'),
    path('model/<int:pk>/viewer/', views.BIMViewerView.as_view(), name='bim_viewer'),
    
    # API para Visor
    path('api/link-element-kit/', views.LinkElementKitView.as_view(), name='api_link_element_kit'),
    path('api/element-detail/<str:guid>/', views.ElementDetailAPIView.as_view(), name='api_element_detail'),
]
