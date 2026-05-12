"""Rooftop segmentation endpoints."""
from __future__ import annotations
from typing import Optional

import httpx
from fastapi import APIRouter, File, UploadFile, HTTPException
from pydantic import BaseModel

from ..config import ROOFTOP_SAMPLES_DIR
from ..services.rooftop_service import predict_rooftop

router = APIRouter(prefix="/api/rooftop", tags=["rooftop"])

# ─────────────────────────────────────────────────────────────────
# Bundled sample catalog (5 aerial photos from colleague's test set)
# ─────────────────────────────────────────────────────────────────
ROOFTOP_SAMPLE_CATALOG = [
    {
        "id": "sample_1",
        "label": "Large residential building",
        "subtitle": "Multi-occupant home, generous rooftop area",
        "icon_hint": "🏠",
        "filename": "sample_1.tif",
    },
    {
        "id": "sample_2",
        "label": "Family house — 12 rue des Roses",
        "subtitle": "Single-family home with simple roof — Dupont demo",
        "icon_hint": "🏡",
        "filename": "sample_2.tif",
    },
    {
        "id": "sample_3",
        "label": "Small commercial building",
        "subtitle": "Light industrial roof, plenty of usable surface",
        "icon_hint": "🏢",
        "filename": "sample_3.tif",
    },
    {
        "id": "sample_4",
        "label": "Suburban property",
        "subtitle": "Detached home with garage and outbuildings",
        "icon_hint": "🏘️",
        "filename": "sample_4.tif",
    },
    {
        "id": "sample_5",
        "label": "Compact townhouse",
        "subtitle": "City-center home, smaller rooftop footprint",
        "icon_hint": "🏠",
        "filename": "sample_5.tif",
    },
]


def _list_rooftop_samples() -> list[dict]:
    out = []
    for s in ROOFTOP_SAMPLE_CATALOG:
        path = ROOFTOP_SAMPLES_DIR / s["filename"]
        out.append({
            "id": s["id"],
            "label": s["label"],
            "subtitle": s["subtitle"],
            "icon_hint": s["icon_hint"],
            "available": path.exists(),
        })
    return out


class CoordsRequest(BaseModel):
    lat: float
    lon: float
    size: int = 512
    radius_meters: int = 30


def _esri_url(lat: float, lon: float, size: int, radius_meters: int) -> str:
    """Build the Esri World Imagery export URL (free, no key)."""
    import math
    d_lat = radius_meters / 111000
    d_lon = radius_meters / (111000 * math.cos(math.radians(lat)))
    bbox = f"{lon - d_lon},{lat - d_lat},{lon + d_lon},{lat + d_lat}"
    return (
        "https://services.arcgisonline.com/arcgis/rest/services/"
        "World_Imagery/MapServer/export"
        f"?bbox={bbox}&bboxSR=4326&imageSR=4326"
        f"&size={size},{size}&format=png&f=image"
    )


@router.post("/segment")
async def segment_uploaded(
    file: UploadFile = File(...),
    isolate_center: bool = False,
) -> dict:
    """Run U-Net segmentation on an uploaded image.

    Query param `isolate_center` (default FALSE): if True, keep only the rooftop
    component located under the center of the image. Disabled by default so the
    pipeline matches the original notebook exactly.
    """
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(400, f"Expected image, got {file.content_type}")
    try:
        data = await file.read()
        result = predict_rooftop(data, isolate_center=isolate_center)
    except Exception as e:
        raise HTTPException(500, f"Segmentation failed: {e}")
    return result


@router.post("/segment-from-coords")
async def segment_from_coords(req: CoordsRequest) -> dict:
    """Fetch the satellite image from Esri then run segmentation."""
    url = _esri_url(req.lat, req.lon, req.size, req.radius_meters)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(url)
            if res.status_code != 200:
                raise HTTPException(
                    502, f"Esri returned {res.status_code} — could not fetch satellite image"
                )
            image_bytes = res.content
    except httpx.RequestError as e:
        raise HTTPException(502, f"Network error fetching satellite image: {e}")

    try:
        result = predict_rooftop(image_bytes)
    except Exception as e:
        raise HTTPException(500, f"Segmentation failed: {e}")

    result["source"] = {"provider": "esri", "url": url}
    return result


@router.get("/samples")
def list_samples_endpoint() -> dict:
    """List the bundled rooftop samples (5 aerial photos)."""
    return {"samples": _list_rooftop_samples()}


@router.post("/segment-sample/{sample_id}")
def segment_sample_endpoint(sample_id: str) -> dict:
    """Run the rooftop pipeline on a bundled aerial sample (one-click demo)."""
    entry = next((s for s in ROOFTOP_SAMPLE_CATALOG if s["id"] == sample_id), None)
    if entry is None:
        raise HTTPException(404, f"Unknown rooftop sample: {sample_id}")
    path = ROOFTOP_SAMPLES_DIR / entry["filename"]
    if not path.exists():
        raise HTTPException(404, f"Sample file missing: {path.name}")
    try:
        result = predict_rooftop(path.read_bytes(), isolate_center=False)
    except Exception as e:
        raise HTTPException(500, f"Segmentation failed: {e}")
    result["source"] = sample_id
    result["label"] = entry["label"]
    result["subtitle"] = entry["subtitle"]
    return result


@router.get("/health")
def health() -> dict:
    """Quick health probe (does not load the model)."""
    from ..config import ROOFTOP_MODEL_PATH, ROOFTOP_META_PATH
    return {
        "status": "ok",
        "model_present": ROOFTOP_MODEL_PATH.exists(),
        "meta_present": ROOFTOP_META_PATH.exists(),
        "n_samples": sum(1 for s in _list_rooftop_samples() if s["available"]),
    }
