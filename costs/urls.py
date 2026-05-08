from django.urls import path
from . import views

app_name = 'costs'

urlpatterns = [
    # MasterFormat
    path('masterformat/', views.MasterFormatListView.as_view(), name='masterformat_list'),
    path('masterformat/add/', views.MasterFormatCreateView.as_view(), name='masterformat_create'),
    path('masterformat/<int:pk>/edit/', views.MasterFormatUpdateView.as_view(), name='masterformat_edit'),
    path('masterformat/<int:pk>/delete/', views.MasterFormatDeleteView.as_view(), name='masterformat_delete'),
    
    # Actividades
    path('activities/', views.ActivityListView.as_view(), name='activity_list'),
    path('activity/add/', views.ActivityCreateView.as_view(), name='activity_create'),
    path('activity/<int:pk>/edit/', views.ActivityUpdateView.as_view(), name='activity_edit'),
    path('activity/<int:pk>/delete/', views.ActivityDeleteView.as_view(), name='activity_delete'),
    
    # Kits
    path('kits/', views.ActivityKitListView.as_view(), name='activitykit_list'),
    path('kit/add/', views.ActivityKitCreateView.as_view(), name='activitykit_create'),
    path('kit/<int:pk>/edit/', views.ActivityKitUpdateView.as_view(), name='activitykit_edit'),
    path('kit/<int:pk>/delete/', views.ActivityKitDeleteView.as_view(), name='activitykit_delete'),
]
