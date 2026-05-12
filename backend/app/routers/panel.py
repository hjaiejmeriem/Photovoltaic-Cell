"""Panel Inspection endpoints — combines models 03/04/05."""
from fastapi import APIRouter, File, UploadFile, HTTPException

from ..config import PANEL_BINARY_DIR, PANEL_MULTICLASS_DIR
from ..services.panel_service import inspect_panel

router = APIRouter(prefix="/api/panel", tags=["panel"])

# ─────────────────────────────────────────────────────────────────
# Bundled sample catalog — varied defects so the demo shows the
# full range (different defect types + healthy if available).
# We pull from both the binary and the multiclass sample folders.
# ─────────────────────────────────────────────────────────────────
PANEL_SAMPLE_CATALOG = [
    {
        "id": "panel_a",
        "label": "Panel A — Rooftop array, row 3",
        "subtitle": "Showing visible cell discoloration",
        "icon_hint": "📸",
        "_source_dir": "multiclass",
        "filename": "img001183.jpg",
        "expected": "black_core",
    },
    {
        "id": "panel_b",
        "label": "Panel B — South facade, row 1",
        "subtitle": "Suspicious horizontal striping",
        "icon_hint": "📸",
        "_source_dir": "multiclass",
        "filename": "img001829.jpg",
        "expected": "finger",
    },
    {
        "id": "panel_c",
        "label": "Panel C — East roof, row 2",
        "subtitle": "Routine inspection, no obvious damage",
        "icon_hint": "📸",
        "_source_dir": "multiclass",
        "filename": "img001405.jpg",
        "expected": "black_core",
    },
    {
        "id": "panel_d",
        "label": "Panel D — Carport, central panel",
        "subtitle": "Underperforming since last week",
        "icon_hint": "📸",
        "_source_dir": "multiclass",
        "filename": "img022811.jpg",
        "expected": "short_circuit",
    },
    {
        "id": "panel_e",
        "label": "Panel E — Rooftop array, row 5",
        "subtitle": "Reported by maintenance team",
        "icon_hint": "📸",
        "_source_dir": "binary",
        "filename": "0845.jpg",
        "expected": "defect",
    },
]


def _panel_sample_path(entry: dict):
    base = PANEL_MULTICLASS_DIR if entry["_source_dir"] == "multiclass" else PANEL_BINARY_DIR
    return base / "samples" / entry["filename"]


def _list_panel_samples() -> list[dict]:
    out = []
    for s in PANEL_SAMPLE_CATALOG:
        out.append({
            "id": s["id"],
            "label": s["label"],
            "subtitle": s["subtitle"],
            "icon_hint": s["icon_hint"],
            "available": _panel_sample_path(s).exists(),
        })
    return out


@router.post("/inspect")
async def inspect(file: UploadFile = File(...)) -> dict:
    """Run full 3-step EL panel inspection.

    Step 1 → binary (healthy/defective) — always
    Step 2 → defect type (6 classes)    — only if defective
    Step 3 → GradCAM localization       — only if defective
    """
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(400, f"Expected image, got {file.content_type}")
    try:
        data = await file.read()
        return inspect_panel(data)
    except FileNotFoundError as e:
        raise HTTPException(503, f"Model file missing: {e}")
    except Exception as e:
        raise HTTPException(500, f"Inspection failed: {e}")


@router.get("/samples")
def list_panel_samples_endpoint() -> dict:
    """List the bundled panel inspection samples (5 panels)."""
    return {"samples": _list_panel_samples()}


@router.post("/inspect-sample/{sample_id}")
def inspect_panel_sample(sample_id: str) -> dict:
    """Run the inspection pipeline on a bundled panel sample."""
    entry = next((s for s in PANEL_SAMPLE_CATALOG if s["id"] == sample_id), None)
    if entry is None:
        raise HTTPException(404, f"Unknown panel sample: {sample_id}")
    path = _panel_sample_path(entry)
    if not path.exists():
        raise HTTPException(404, f"Sample file missing: {path.name}")
    try:
        result = inspect_panel(path.read_bytes())
    except FileNotFoundError as e:
        raise HTTPException(503, f"Model file missing: {e}")
    except Exception as e:
        raise HTTPException(500, f"Inspection failed: {e}")
    result["source"] = sample_id
    result["label"] = entry["label"]
    result["subtitle"] = entry["subtitle"]
    return result


@router.get("/health")
def health() -> dict:
    from ..config import (
        PANEL_BINARY_MODEL, PANEL_MULTICLASS_MODEL, PANEL_DETECTION_MODEL
    )
    return {
        "status": "ok",
        "models": {
            "binary":     {"present": PANEL_BINARY_MODEL.exists(),     "path": str(PANEL_BINARY_MODEL)},
            "multiclass": {"present": PANEL_MULTICLASS_MODEL.exists(), "path": str(PANEL_MULTICLASS_MODEL)},
            "detection":  {"present": PANEL_DETECTION_MODEL.exists(),  "path": str(PANEL_DETECTION_MODEL)},
        },
        "n_samples": sum(1 for s in _list_panel_samples() if s["available"]),
    }
