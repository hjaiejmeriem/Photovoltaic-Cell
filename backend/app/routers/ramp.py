"""Solar Ramp Forecasting endpoints (module 07)."""
import json
import math
import random
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, File, UploadFile, Form, HTTPException
from typing import List

import httpx

# Tunisia local time (UTC+1, no DST)
TUNIS_TZ = timezone(timedelta(hours=1))

from ..services.ramp_service import (
    predict_from_npy_stack,
    predict_from_files,
    predict_sample,
    list_samples,
    list_deployment_samples,
    predict_deployment_sample,
    derive_features_from_csv,
    get_feature_columns,
)

router = APIRouter(prefix="/api/ramp", tags=["ramp"])


@router.post("/forecast")
async def forecast(
    sky_images: UploadFile = File(..., description="Stack of 12 sky images: .npy (12,H,W,3) uint8"),
    features: str = Form(..., description="JSON dict with 34 features"),
) -> dict:
    """Forecast ramp from a single .npy stack of 12 frames + features JSON."""
    try:
        feats = json.loads(features)
        if not isinstance(feats, dict):
            raise ValueError("features must be a JSON object")
    except Exception as e:
        raise HTTPException(400, f"Invalid features JSON: {e}")

    npy_bytes = await sky_images.read()
    try:
        return predict_from_npy_stack(npy_bytes, feats)
    except FileNotFoundError as e:
        raise HTTPException(503, f"Model file missing: {e}")
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Forecast failed: {e}")


@router.post("/forecast-multi")
async def forecast_multi(
    sky_image_0: UploadFile = File(...),
    sky_image_1: UploadFile = File(...),
    sky_image_2: UploadFile = File(...),
    sky_image_3: UploadFile = File(...),
    sky_image_4: UploadFile = File(...),
    sky_image_5: UploadFile = File(...),
    sky_image_6: UploadFile = File(...),
    sky_image_7: UploadFile = File(...),
    sky_image_8: UploadFile = File(...),
    sky_image_9: UploadFile = File(...),
    sky_image_10: UploadFile = File(...),
    sky_image_11: UploadFile = File(...),
    features: str = Form(...),
) -> dict:
    """Forecast from 12 separate image files (chronological order: 0=oldest, 11=newest)."""
    try:
        feats = json.loads(features)
        if not isinstance(feats, dict):
            raise ValueError("features must be a JSON object")
    except Exception as e:
        raise HTTPException(400, f"Invalid features JSON: {e}")

    files = [sky_image_0, sky_image_1, sky_image_2, sky_image_3,
             sky_image_4, sky_image_5, sky_image_6, sky_image_7,
             sky_image_8, sky_image_9, sky_image_10, sky_image_11]
    payload = []
    for f in files:
        b = await f.read()
        payload.append((b, f.filename or ""))
    try:
        return predict_from_files(payload, feats)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Forecast failed: {e}")


@router.post("/forecast-csv")
async def forecast_csv(
    sky_images: UploadFile = File(..., description=".npy (12,H,W,3) stack"),
    csv_file: UploadFile = File(..., description="Raw CSV with timestamp + pv + 7 weather cols, ≥15 rows"),
) -> dict:
    """Forecast from .npy image stack + a raw CSV (backend derives the 34 features)."""
    npy_bytes = await sky_images.read()
    csv_bytes = await csv_file.read()
    try:
        feats = derive_features_from_csv(csv_bytes)
        return predict_from_npy_stack(npy_bytes, feats)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Forecast failed: {e}")


@router.post("/forecast-sample/{sample_id}")
def forecast_sample(sample_id: str) -> dict:
    """Run on a bundled demo sample (id from /samples list)."""
    try:
        return predict_sample(sample_id)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, f"Forecast failed: {e}")


@router.get("/samples")
def samples() -> dict:
    return {"samples": list_samples()}


@router.get("/deployment-samples")
def deployment_samples() -> dict:
    """List the real deployment-test samples (live sky-camera simulation)."""
    return {"samples": list_deployment_samples()}


@router.post("/forecast-deployment/{sample_id}")
def forecast_deployment(sample_id: str) -> dict:
    """Simulate live sky-camera feed: read sample's PNG frames + CSVs, run model."""
    try:
        return predict_deployment_sample(sample_id)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Forecast failed: {e}")


@router.get("/features")
def list_features_endpoint() -> dict:
    try:
        return {"feature_columns": get_feature_columns()}
    except FileNotFoundError as e:
        raise HTTPException(503, str(e))


# ─────────────────────────────────────────────────────────────────
# REAL-TIME / LIVE endpoint — simulates a sky camera + inverter feed
# Backed by Open-Meteo for the live weather (no API key required).
# Falls back to a bundled deployment sample for the sky frames + PV
# lags (model needs them; on a real install they'd come from the
# rooftop fish-eye + the inverter's SCADA bus).
# ─────────────────────────────────────────────────────────────────
DEFAULT_LATITUDE  = 36.84   # Tunis, where Esprit School of Engineering is
DEFAULT_LONGITUDE = 10.18

# Internal counter — used only as tiebreaker inside a single time-of-day
# bucket (e.g. alternates between sample_2 and sample_5 in the morning).
_LIVE_SAMPLE_INDEX = 0


# ── Time-of-day → sample mapping ────────────────────────────────────
# Maps the current local hour in Tunis to the deployment samples whose
# sky-image content is consistent with that period of the day. With one
# minute of polling you'd see the SAME bucket — the morning sample at
# 09:00, the afternoon sample at 14:00 — and only fall back to a rotation
# inside a bucket when there are several candidates.
_TIME_BUCKETS = [
    # (start_h, end_h, [candidate sample_ids], bucket_label)
    (5,  10, ["sample_2", "sample_5"], "morning"),    # 🌅 sunrise / rising
    (10, 14, ["sample_3"],             "midday"),     # ⛅ midday (cloudy in the bundle)
    (14, 18, ["sample_4"],             "afternoon"),  # 🌇 late afternoon
    (18, 22, ["sample_1"],             "evening"),    # 🟢 evening stable
    (22, 24, ["sample_1"],             "night"),      # rolled-over evening
    (0,  5,  ["sample_1"],             "night"),      # 🌙 pre-dawn
]


def _pick_sample_for_now(available_ids: list[str]) -> tuple[str, str]:
    """Returns (sample_id, bucket_label). Falls back to the first
    available sample if the time bucket's preferred IDs aren't bundled.
    """
    global _LIVE_SAMPLE_INDEX
    now = datetime.now(TUNIS_TZ)
    hour = now.hour
    for start, end, candidates, label in _TIME_BUCKETS:
        if start <= hour < end:
            # Filter to only candidates that actually exist in bundle
            present = [s for s in candidates if s in available_ids]
            if present:
                chosen = present[_LIVE_SAMPLE_INDEX % len(present)]
                _LIVE_SAMPLE_INDEX += 1
                return chosen, label
            break
    # Fallback
    return available_ids[0], "default"


# ── Meteo stress detection ──────────────────────────────────────────
# Real-world conditions that physically guarantee a sudden PV drop.
# Triggered from the live Open-Meteo reading — when nature delivers a
# stress event, we surface it as a sudden_ramp_detected alert even if
# the bundled sample/features wouldn't have crossed the F1 threshold.
def _detect_meteo_stress(weather: dict | None, hour: int) -> dict | None:
    """Return None if no stress, else {reason, severity, expected_drop_pct}."""
    if not weather:
        return None

    rad = weather.get("ALLSKY_SFC_SW_DWN")
    prec = weather.get("PRECTOTCORR")
    wind = weather.get("WS2M")
    rh = weather.get("RH2M")

    reasons = []
    severity_pp = 0   # how many percentage points of system peak to attribute

    # Heavy precipitation — direct cloud cover, panels wet
    if prec is not None and prec > 0.5:
        reasons.append(f"precipitation {prec:.1f} mm/h")
        severity_pp += min(20, 6 + prec * 4)

    # Very low radiation during daytime (overcast / storm)
    if rad is not None and 7 <= hour <= 18 and rad < 200:
        reasons.append(f"shortwave radiation collapsed to {rad:.0f} W/m²")
        severity_pp += 10 if rad < 100 else 6

    # Strong wind — fast cloud advection, ramp-up/down events
    if wind is not None and wind > 8:
        reasons.append(f"wind speed {wind:.1f} m/s (fast cloud advection)")
        severity_pp += 4

    # Very humid + low radiation = thick overcast forming
    if rh is not None and rh > 85 and rad is not None and rad < 400:
        reasons.append(f"humidity {rh:.0f}% with weak insolation")
        severity_pp += 3

    if not reasons:
        return None

    severity_pp = min(severity_pp, 25)  # cap at -25 pp
    return {
        "reason": " · ".join(reasons),
        "expected_drop_pct": -float(severity_pp),
        "severity": "danger" if severity_pp >= 12 else "warning",
    }


def _fetch_open_meteo(lat: float, lon: float) -> dict | None:
    """Fetch current weather from the free Open-Meteo API. No key required.
    Returns None on failure (caller falls back to sample features).
    """
    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        "&current=temperature_2m,relative_humidity_2m,surface_pressure,"
        "wind_speed_10m,wind_direction_10m,precipitation,shortwave_radiation"
        "&timezone=auto"
    )
    try:
        with httpx.Client(timeout=4.0) as client:
            r = client.get(url)
            if r.status_code != 200:
                return None
            data = r.json().get("current") or {}
            return {
                "T2M":               data.get("temperature_2m"),
                "RH2M":              data.get("relative_humidity_2m"),
                "PS":                data.get("surface_pressure"),
                "WS2M":              data.get("wind_speed_10m"),
                "WD2M":              data.get("wind_direction_10m"),
                "PRECTOTCORR":       data.get("precipitation"),
                "ALLSKY_SFC_SW_DWN": data.get("shortwave_radiation"),
            }
    except Exception:
        return None


@router.get("/live")
def forecast_live(
    lat: float = DEFAULT_LATITUDE,
    lon: float = DEFAULT_LONGITUDE,
    simulate_alert: bool = False,
):
    """Real-time forecast tick — what an operator's dashboard polls every 60s.

    Pipeline:
      1. Pick a deployment sample (rotating) for the sky-frame stack and
         pre-computed PV lags. These would come from a fish-eye camera and
         the inverter's SCADA bus in a real install.
      2. Fetch current weather from Open-Meteo for the given lat/lon.
         Fall back to the sample's own meteo if the call fails.
      3. Run the multimodal model.
      4. Return the alert-ready payload.

    Query params:
      - lat / lon : geographic location for Open-Meteo (defaults: Tunis)
      - simulate_alert : if True, force-pick a sample known to trigger a
                          sudden ramp event (handy for the demo).
    """
    deployment_samples = list_deployment_samples()
    if not deployment_samples:
        raise HTTPException(503, "No deployment samples available for live mode.")
    available_ids = [s["id"] for s in deployment_samples]

    # ── Step 1: live weather (we fetch FIRST because the sample picker
    #            and the feature splicing both depend on it) ──────────
    weather = _fetch_open_meteo(lat, lon)

    # ── Night-mode short-circuit ────────────────────────────────────
    # Outside daylight (Tunis < 06:00 or ≥ 19:00), the sun is below the
    # horizon → no PV production to forecast. Running the model on
    # day-time PV lags + night radiation pushes it way outside its
    # training distribution and yields nonsense (we saw +560 pp).
    # Return a deterministic "night" tick instead.
    now_local_pre = datetime.now(TUNIS_TZ)
    if now_local_pre.hour < 6 or now_local_pre.hour >= 19:
        target_id = "sample_1" if "sample_1" in available_ids else available_ids[0]
        target = next(s for s in deployment_samples if s["id"] == target_id)
        # Still need a sky frame for the UI tile — read it without running model
        from ..services.ramp_service import RAMP_DEPLOYMENT_DIR, _image_to_b64
        import numpy as _np
        from PIL import Image as _Image
        sky_dir = RAMP_DEPLOYMENT_DIR / target_id / "sky_images"
        sky_frame = None
        if sky_dir.exists():
            pngs = sorted(sky_dir.glob("*.png"))
            if pngs:
                arr = _np.array(_Image.open(pngs[-1]).convert("RGB"), dtype=_np.uint8)
                sky_frame = _image_to_b64(arr)
        return {
            "tick_at": datetime.now(timezone.utc).isoformat(),
            "lat": lat, "lon": lon,
            "ramp_pct_t_plus_15": 0.0,
            "sudden_ramp_prob":   0.0,
            "sudden_ramp_detected": False,
            "label":   "night",
            "severity_pct": 0.0,
            "direction": "neutral",
            "status":   "Night — no production",
            "severity": "good",
            "message":  "The sun is below the horizon. Forecasting is suspended until 06:00 local. Monitoring resumes automatically at sunrise.",
            "event_threshold": 0.7369,
            "sample_id":    target_id,
            "sample_label": target["label"],
            "time_bucket":  "night",
            "local_time":   now_local_pre.strftime("%H:%M"),
            "meteo_stress": None,
            "model_used_live_meteo": False,
            "night_mode":   True,
            "weather":      weather or {},
            "weather_source": "open-meteo.com" if weather else "fallback",
            "latest_sky_frame": sky_frame,
        }

    # ── Step 2: pick the sample that matches the current local time ──
    if simulate_alert:
        # Legacy demo path: force a known-evening sample to trigger UI
        target_id = "sample_4" if "sample_4" in available_ids else available_ids[0]
        bucket = "demo"
    else:
        target_id, bucket = _pick_sample_for_now(available_ids)
    target = next(s for s in deployment_samples if s["id"] == target_id)

    # ── Step 3: run the model with the live weather spliced in ───────
    try:
        result = predict_deployment_sample(target_id, weather_override=weather)
    except Exception as e:
        raise HTTPException(500, f"Live forecast failed: {e}")

    # Pull model outputs (these now reflect the live meteo, not the bundled CSV)
    sudden = bool(result.get("sudden_ramp_detected"))
    ramp_pct = float(result.get("ramp_pct", 0))
    # Guard against out-of-distribution explosions (we saw +560 pp at night).
    # A real PV system cannot ramp more than ~50 percentage points of peak
    # in 15 min — anything beyond is the model extrapolating nonsense.
    if abs(ramp_pct) > 50:
        ramp_pct = 50.0 if ramp_pct > 0 else -50.0
        # Treat extreme extrapolation as low-confidence — don't pop a critical
        # alert just because the model went off the rails.
        sudden = False
    prob = float(result.get("sudden_ramp_prob", 0))
    severity_pct = round(min(100.0, max(0.0, abs(ramp_pct) * 5 + prob * 50)), 1)

    # ── Step 4: meteo-stress override — if real-world conditions
    #            physically guarantee a drop, surface it as an alert
    #            even when the model's classifier didn't fire. ─────────
    now_local = datetime.now(TUNIS_TZ)
    stress = _detect_meteo_stress(weather, now_local.hour)
    stress_triggered = False
    if stress is not None and not sudden:
        sudden = True
        stress_triggered = True
        # Override the ramp toward the predicted drop unless the model
        # already predicted something worse
        drop = stress["expected_drop_pct"]
        if ramp_pct > drop:   # i.e. model is less pessimistic than physics
            ramp_pct = drop
        prob = max(prob, 0.82)
        severity_pct = round(min(100.0, max(0.0, abs(ramp_pct) * 5 + prob * 50)), 1)

    # ── Step 5: legacy demo button (kept for completeness) ───────────
    if simulate_alert:
        sudden = True
        if abs(ramp_pct) < 12:
            ramp_pct = -14.5 if ramp_pct < 0 else 14.5
        prob = max(prob, 0.82)
        severity_pct = round(min(100.0, max(0.0, abs(ramp_pct) * 5 + prob * 50)), 1)

    # If meteo stress triggered, replace the message with a physics-grounded one
    if stress_triggered:
        message = (
            f"⚠ Meteo stress detected — {stress['reason']}. "
            f"Production expected to drop {abs(ramp_pct):.1f} pp over the next 15 min. "
            "Activate battery dispatch and shed non-critical loads."
        )
        status = "Sudden Drop (Meteo Stress)"
        severity = stress["severity"]
    else:
        message = result.get("message")
        status = result.get("status")
        severity = result.get("severity")

    out = {
        "tick_at": datetime.now(timezone.utc).isoformat(),
        "lat": lat,
        "lon": lon,
        # ── core model output (matches the schema requested by the brief) ──
        "ramp_pct_t_plus_15":   round(ramp_pct, 4),
        "sudden_ramp_prob":     round(prob, 4),
        "sudden_ramp_detected": sudden,
        "label":                "SUDDEN RAMP" if sudden else "normal",
        "severity_pct":         severity_pct,
        # ── extra context for the live dashboard ──
        "direction":            "negative" if ramp_pct < 0 else "positive",
        "status":               status,
        "severity":             severity,
        "message":              message,
        "event_threshold":      result.get("event_threshold"),
        "sample_id":            target["id"],
        "sample_label":         target["label"],
        "time_bucket":          bucket,
        "local_time":           now_local.strftime("%H:%M"),
        "meteo_stress":         stress,   # null or {reason, expected_drop_pct, severity}
        "model_used_live_meteo": weather is not None,
        # ── live weather (Open-Meteo if available) ──
        "weather":              weather or {
            "T2M": None, "RH2M": None, "PS": None, "WS2M": None,
            "WD2M": None, "PRECTOTCORR": None, "ALLSKY_SFC_SW_DWN": None,
            "_note": "Open-Meteo unreachable — falling back to bundled meteo CSV.",
        },
        "weather_source":       "open-meteo.com" if weather else "fallback",
        # ── latest sky frame for the dashboard tile ──
        "latest_sky_frame":     (result.get("sky_frames") or [None])[-1],
        # ── reference (training-time prediction for this sample) ──
        "reference":            result.get("reference"),
    }
    return out


@router.get("/health")
def health() -> dict:
    from ..config import (
        RAMP_MODEL_PATH, RAMP_SCALER_PATH, RAMP_META_PATH,
        RAMP_SAMPLES_DIR, RAMP_DEPLOYMENT_DIR,
    )
    manifest = RAMP_SAMPLES_DIR / "manifest.json"
    return {
        "status": "ok",
        "model_present": RAMP_MODEL_PATH.exists(),
        "scaler_present": RAMP_SCALER_PATH.exists(),
        "meta_present": RAMP_META_PATH.exists(),
        "samples_present": manifest.exists(),
        "n_samples": len(list_samples()),
        "deployment_dir_present": RAMP_DEPLOYMENT_DIR.exists(),
        "n_deployment_samples": len(list_deployment_samples()),
    }
