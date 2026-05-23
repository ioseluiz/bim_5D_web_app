from django.urls import path, include
from rest_framework.routers import DefaultRouter
from bim.api import ProjectViewSet, BIMModelViewSet, BIMElementViewSet
from bim.video_views import convert_video_to_mp4
from costs.api import MasterFormatViewSet, ActivityViewSet, ActivityKitViewSet, ProjectBudgetItemViewSet
from schedule.api import KitCronogramaViewSet, ActividadCronogramaViewSet
from accounts.views import login_view, logout_view, me_view

router = DefaultRouter()
router.register(r'projects', ProjectViewSet, basename='project')
router.register(r'bim-models', BIMModelViewSet, basename='bimmodel')
router.register(r'bim-elements', BIMElementViewSet, basename='bimelement')
router.register(r'masterformat', MasterFormatViewSet)
router.register(r'activities', ActivityViewSet, basename='activity')
router.register(r'activity-kits', ActivityKitViewSet, basename='activitykit')
router.register(r'budget-items', ProjectBudgetItemViewSet, basename='budgetitem')
router.register(r'schedule-kits', KitCronogramaViewSet, basename='schedulekit')
router.register(r'schedule-activities', ActividadCronogramaViewSet, basename='scheduleactivity')

urlpatterns = [
    path('', include(router.urls)),
    path('convert-video/', convert_video_to_mp4),
    path('auth/login/',  login_view),
    path('auth/logout/', logout_view),
    path('auth/me/',     me_view),
]
