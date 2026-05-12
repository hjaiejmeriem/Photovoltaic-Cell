"""Battery State-of-Health endpoints (module 06)."""
import json
from fastapi import APIRouter, File, UploadFile, Form, HTTPException

from ..services.battery_service import (
    predict_battery_soh, predict_sample, get_feature_columns,
    list_battery_samples,
)

router = APIRouter(prefix="/api/battery", tags=["battery"])


@router.post("/predict")
async def predict(
    thermal_image: UploadFile = File(..., description="Thermal map (.npy or PNG/JPG)"),
    features: str = Form(..., description="JSON string of the 25 features"),
) -> dict:
    """Predict battery SoH from a thermal image + 25 features (JSON in form field)."""
    # Parse features JSON
    try:
        feats = json.loads(features)
        if not isinstance(feats, dict):
            raise ValueError("features must be a JSON object")
    except Exception as e:
        raise HTTPException(400, f"Invalid features JSON: {e}")

    img_bytes = await thermal_image.read()
    fname = thermal_image.filename or ""
    try:
        return predict_battery_soh(img_bytes, fname, feats)
    except FileNotFoundError as e:
        raise HTTPException(503, f"Model file missing: {e}")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Prediction failed: {e}")


@router.post("/predict-sample")
def predict_sample_endpoint() -> dict:
    """Run the model on the first bundled sample (default: sample1)."""
    try:
        return predict_sample("sample1")
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, f"Prediction failed: {e}")


@router.post("/predict-sample/{sample_id}")
def predict_sample_by_id(sample_id: str) -> dict:
    """Run the model on a specific bundled sample (sample1/sample2/sample3)."""
    try:
        return predict_sample(sample_id)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, f"Prediction failed: {e}")


@router.get("/samples")
def list_samples_endpoint() -> dict:
    """List the bundled battery samples (for the demo gallery)."""
    return {"samples": list_battery_samples()}


@router.get("/features")
def list_features() -> dict:
    """Return the ordered list of 25 feature names the model expects."""
    try:
        return {"feature_columns": get_feature_columns()}
    except FileNotFoundError as e:
        raise HTTPException(503, str(e))


@router.get("/health")
def health() -> dict:
    from ..config import (
        BATTERY_MODEL_PATH, BATTERY_SCALER_PATH, BATTERY_FEATURE_COLS_PATH,
        BATTERY_SAMPLES_DIR,
    )
    return {
        "status": "ok",
        "model_present":   BATTERY_MODEL_PATH.exists(),
        "scaler_present":  BATTERY_SCALER_PATH.exists(),
        "cols_present":    BATTERY_FEATURE_COLS_PATH.exists(),
        "sample_present":  (BATTERY_SAMPLES_DIR / "sample1.npy").exists(),
    }
