from django.urls import path, include
from rest_framework.routers import DefaultRouter
from bim.api import ProjectViewSet, BIMModelViewSet, BIMElementViewSet
from costs.api import MasterFormatViewSet, ActivityViewSet, ActivityKitViewSet, ProjectBudgetItemViewSet

router = DefaultRouter()
router.register(r'projects', ProjectViewSet)
router.register(r'bim-models', BIMModelViewSet)
router.register(r'bim-elements', BIMElementViewSet)
router.register(r'masterformat', MasterFormatViewSet)
router.register(r'activities', ActivityViewSet, basename='activity')
router.register(r'activity-kits', ActivityKitViewSet, basename='activitykit')
router.register(r'budget-items', ProjectBudgetItemViewSet, basename='budgetitem')

urlpatterns = [
    path('', include(router.urls)),
]
