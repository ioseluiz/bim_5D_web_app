"""Tests de exportación de la biblioteca de kits.

Cada formato debe hacer round-trip: export → limpiar DB → import → mismos datos.
"""
from __future__ import annotations

import json
import zipfile
from decimal import Decimal
from io import BytesIO

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from costs.importers import (
    apply_import,
    export_library_csv_zip,
    export_library_json,
    export_library_xlsx,
    parse_file,
)
from costs.models import Activity, ActivityKit, MasterFormat


pytestmark = pytest.mark.django_db
User = get_user_model()


@pytest.fixture
def seeded_library():
    d1 = MasterFormat.objects.create(division_code="03", division_name="Concrete")
    d2 = MasterFormat.objects.create(division_code="04", division_name="Masonry")
    k1 = ActivityKit.objects.create(codigo_kit="KIT-A", nombre="Kit A", descripcion="desc A", color="#111111")
    k2 = ActivityKit.objects.create(codigo_kit="KIT-B", nombre="Kit B", descripcion="desc B", color="#222222")
    Activity.objects.create(
        codigo_actividad="A-1", descripcion="Excavación", unidad="m3",
        cu_total=Decimal("50"), material=Decimal("15"), mano_obra=Decimal("25"), equipo=Decimal("10"),
        division=d1, activity_kit=k1,
    )
    Activity.objects.create(
        codigo_actividad="A-2", descripcion="Concreto", unidad="m3",
        cu_total=Decimal("220"), material=Decimal("140"), mano_obra=Decimal("60"), equipo=Decimal("20"),
        division=d1, activity_kit=k1,
    )
    Activity.objects.create(
        codigo_actividad="A-3", descripcion="Muro", unidad="m2",
        cu_total=Decimal("45"), material=Decimal("25"), mano_obra=Decimal("15"), equipo=Decimal("5"),
        division=d2, activity_kit=k2,
    )
    return {"divisions": 2, "kits": 2, "activities": 3}


def _wipe_library():
    Activity.objects.all().delete()
    ActivityKit.objects.all().delete()
    MasterFormat.objects.all().delete()


# ── Contenido básico ─────────────────────────────────────────────────────────


def test_export_xlsx_contains_all_rows(seeded_library):
    content = export_library_xlsx()
    payload = parse_file(SimpleUploadedFile("biblioteca.xlsx", content))
    assert len(payload.divisions) == seeded_library["divisions"]
    assert len(payload.kits) == seeded_library["kits"]
    assert len(payload.activities) == seeded_library["activities"]


def test_export_json_is_nested(seeded_library):
    data = json.loads(export_library_json())
    assert len(data["divisiones"]) == seeded_library["divisions"]
    assert len(data["kits"]) == seeded_library["kits"]
    total_acts = sum(len(k["actividades"]) for k in data["kits"])
    assert total_acts == seeded_library["activities"]


def test_export_csv_zip_has_three_files(seeded_library):
    zbytes = export_library_csv_zip()
    with zipfile.ZipFile(BytesIO(zbytes)) as zf:
        assert set(zf.namelist()) == {"divisiones.csv", "kits.csv", "actividades.csv"}


# ── Round-trip: export → wipe → import → misma DB ────────────────────────────


def test_roundtrip_xlsx(seeded_library):
    content = export_library_xlsx()
    _wipe_library()
    summary = apply_import(parse_file(SimpleUploadedFile("biblioteca.xlsx", content)))
    assert summary.divisions_created == seeded_library["divisions"]
    assert summary.kits_created == seeded_library["kits"]
    assert summary.activities_created == seeded_library["activities"]
    assert summary.errors == []
    # Comprobar detalle: una actividad conserva sus valores.
    act = Activity.objects.get(codigo_actividad="A-2")
    assert act.cu_total == Decimal("220")
    assert act.division.division_code == "03"


def test_roundtrip_json(seeded_library):
    content = export_library_json()
    _wipe_library()
    summary = apply_import(parse_file(SimpleUploadedFile("biblioteca.json", content)))
    assert summary.divisions_created == seeded_library["divisions"]
    assert summary.kits_created == seeded_library["kits"]
    assert summary.activities_created == seeded_library["activities"]
    assert summary.errors == []


def test_roundtrip_csv(seeded_library):
    zbytes = export_library_csv_zip()
    with zipfile.ZipFile(BytesIO(zbytes)) as zf:
        div_csv = zf.read("divisiones.csv")
        kits_csv = zf.read("kits.csv")
        acts_csv = zf.read("actividades.csv")

    _wipe_library()

    # El importer acepta múltiples archivos CSV en el mismo call vía parse_file.
    from costs.importers import ImportPayload

    combined = ImportPayload()
    combined.extend(parse_file(SimpleUploadedFile("divisiones.csv", div_csv)))
    combined.extend(parse_file(SimpleUploadedFile("kits.csv", kits_csv)))
    combined.extend(parse_file(SimpleUploadedFile("actividades.csv", acts_csv)))
    summary = apply_import(combined)

    assert summary.divisions_created == seeded_library["divisions"]
    assert summary.kits_created == seeded_library["kits"]
    assert summary.activities_created == seeded_library["activities"]
    assert summary.errors == []


# ── HTTP endpoint ────────────────────────────────────────────────────────────


@pytest.fixture
def regular_user(db):
    return User.objects.create_user(
        username="ana", email="ana@example.com", password="x",
    )


def test_export_endpoint_authenticated_user_can_download_xlsx(regular_user, seeded_library):
    c = APIClient()
    c.force_authenticate(regular_user)
    resp = c.get("/api/activity-kits/export_library/?fmt=xlsx")
    assert resp.status_code == 200
    assert resp["Content-Type"].startswith("application/vnd.openxmlformats")
    assert "biblioteca_kits.xlsx" in resp["Content-Disposition"]


def test_export_endpoint_supports_json_and_csv(regular_user, seeded_library):
    c = APIClient()
    c.force_authenticate(regular_user)
    resp_json = c.get("/api/activity-kits/export_library/?fmt=json")
    assert resp_json.status_code == 200
    assert resp_json["Content-Type"] == "application/json"

    resp_csv = c.get("/api/activity-kits/export_library/?fmt=csv")
    assert resp_csv.status_code == 200
    assert resp_csv["Content-Type"] == "application/zip"


def test_export_endpoint_rejects_invalid_format(regular_user, seeded_library):
    c = APIClient()
    c.force_authenticate(regular_user)
    resp = c.get("/api/activity-kits/export_library/?fmt=pdf")
    assert resp.status_code == 400


def test_export_endpoint_requires_authentication(seeded_library):
    resp = APIClient().get("/api/activity-kits/export_library/?fmt=xlsx")
    assert resp.status_code in (401, 403)
