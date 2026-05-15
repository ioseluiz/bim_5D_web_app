from django.urls import path, include
from rest_framework.routers import DefaultRouter
from bim.api import ProjectViewSet, BIMModelViewSet, BIMElementViewSet
from costs.api import MasterFormatViewSet, ActivityViewSet, ActivityKitViewSet, ProjectBudgetItemViewSet
from schedule.api import KitCronogramaViewSet, ActividadCronogramaViewSet

router = DefaultRouter()
router.register(r'projects', ProjectViewSet)
router.register(r'bim-models', BIMModelViewSet)
router.register(r'bim-elements', BIMElementViewSet)
router.register(r'masterformat', MasterFormatViewSet)
router.register(r'activities', ActivityViewSet, basename='activity')
router.register(r'activity-kits', ActivityKitViewSet, basename='activitykit')
router.register(r'budget-items', ProjectBudgetItemViewSet, basename='budgetitem')
router.register(r'schedule-kits', KitCronogramaViewSet, basename='schedulekit')
router.register(r'schedule-activities', ActividadCronogramaViewSet, basename='scheduleactivity')

urlpatterns = [
    path('', include(router.urls)),
]
