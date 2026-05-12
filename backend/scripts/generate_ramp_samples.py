"""Generate 5 bundled demo samples for module 07 (Solar Ramp Forecasting).

The original SKIPPD HDF5 dataset isn't bundled (multi-GB), so we synthesize:
  - 12 fish-eye sky images per sample (procedural — clear / partial / cloudy / overcast)
  - 34 tabular features per sample (realistic ranges + derived precursors)

For each scenario from test_samples.json we use the recorded pred_* / true_*
values as ground-truth reference, displayed alongside the live prediction.
"""
from __future__ import annotations
import json
import os
from pathlib import Path

import numpy as np

THIS_DIR = Path(__file__).resolve().parent
RAMP_DIR = THIS_DIR.parent.parent / "models_input" / "07_solar_ramp" / \
    "Short-Term Solar Ramp Forecasting" / "Short-Term Solar Ramp Forecasting"
OUT_DIR = RAMP_DIR / "bundled_samples"
OUT_DIR.mkdir(exist_ok=True)


# ─────────────────────────────────────────────────────────────
# Procedural fish-eye sky image generator
# ─────────────────────────────────────────────────────────────
def fisheye_circle(size: int = 128) -> np.ndarray:
    """Return a (H,W) mask of the fisheye circular field-of-view."""
    yy, xx = np.mgrid[0:size, 0:size]
    cy, cx = size / 2 - 0.5, size / 2 - 0.5
    r = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    return r <= (size / 2 - 1)


def cloud_field(size: int, density: float, seed: int) -> np.ndarray:
    """Multi-octave noise → soft cloud field in [0,1]."""
    rng = np.random.default_rng(seed)
    field = np.zeros((size, size), dtype=np.float32)
    for octave in range(4):
        s = max(2, size // (2 ** (3 - octave)))
        coarse = rng.random((s, s)).astype(np.float32)
        # nearest upsample then smooth
        zoom = size / s
        ys = (np.arange(size) / zoom).astype(int).clip(0, s - 1)
        xs = (np.arange(size) / zoom).astype(int).clip(0, s - 1)
        upsampled = coarse[ys[:, None], xs[None, :]]
        # box blur
        for _ in range(2):
            upsampled = (
                upsampled
                + np.roll(upsampled, 1, 0) + np.roll(upsampled, -1, 0)
                + np.roll(upsampled, 1, 1) + np.roll(upsampled, -1, 1)
            ) / 5.0
        field += upsampled * (0.5 ** octave)
    field = (field - field.min()) / (field.max() - field.min() + 1e-8)
    return np.clip(field * (0.4 + density * 1.2) - 0.1, 0, 1)


def synth_sky_image(scenario: str, t: int, seed: int = 42) -> np.ndarray:
    """Return a (128,128,3) uint8 fish-eye image for a given scenario at frame t (0..11)."""
    H = W = 128
    img = np.zeros((H, W, 3), dtype=np.float32)
    mask = fisheye_circle(H)

    # base sky gradient — bluer at center, brighter at horizon
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    cy, cx = H / 2, W / 2
    r = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / (H / 2)

    blue_sky = np.stack([
        0.40 + 0.30 * r,        # R
        0.55 + 0.25 * r,        # G
        0.85 - 0.15 * r,        # B
    ], axis=-1)

    if scenario == "clear":
        cloud_amt, density = 0.0, 0.0
    elif scenario == "partial_progressive":
        # cloud cover grows over the 12 frames
        cloud_amt = 0.15 + (t / 11.0) * 0.55
        density = cloud_amt
    elif scenario == "cloudy_drop":
        cloud_amt = 0.55 + (t / 11.0) * 0.35
        density = cloud_amt
    elif scenario == "overcast":
        cloud_amt = 0.85
        density = 0.9
    elif scenario == "borderline":
        cloud_amt = 0.40 + 0.20 * np.sin(t / 11.0 * np.pi)
        density = cloud_amt
    else:
        cloud_amt, density = 0.3, 0.3

    clouds = cloud_field(H, density=density, seed=seed + t)
    cloud_rgb = np.stack([clouds, clouds, clouds * 0.95], axis=-1)
    cloud_rgb = 0.55 + cloud_rgb * 0.45

    blend = np.clip(cloud_amt * clouds * 1.4, 0, 1)[..., None]
    img = blue_sky * (1 - blend) + cloud_rgb * blend
    img *= mask[..., None]   # circular fisheye field
    img = np.clip(img * 255, 0, 255).astype(np.uint8)
    return img


def synth_image_sequence(scenario: str, seed: int = 42) -> np.ndarray:
    """(12, 128, 128, 3) uint8."""
    return np.stack([synth_sky_image(scenario, t, seed=seed) for t in range(12)], axis=0)


# ─────────────────────────────────────────────────────────────
# Tabular features synthesizer
# ─────────────────────────────────────────────────────────────
FEATURE_COLS = [
    *[f"pv_log_lag_{i}" for i in range(15)],
    "T2M", "RH2M", "PS", "WS2M",
    "PRECTOTCORR", "ALLSKY_SFC_SW_DWN",
    "WD2M_sin", "WD2M_cos", "weather_age_min",
    "hour_sin", "hour_cos", "doy_sin", "doy_cos",
    "pv_velocity", "pv_accel", "pv_local_std",
    "pv_deviation", "pv_range_10", "pv_detrended",
]


def synth_features(scenario: str, seed: int = 42) -> dict:
    """Realistic raw (un-scaled) feature dict with 34 keys, tuned per scenario."""
    rng = np.random.default_rng(seed)

    # Base PV trajectory (log-PV ∈ ~[0, 30])
    if scenario == "clear":
        pv_base, pv_drift, pv_std = 22.0, +0.05, 0.15
    elif scenario == "partial_progressive":
        pv_base, pv_drift, pv_std = 19.0, -0.30, 0.50
    elif scenario == "cloudy_drop":
        pv_base, pv_drift, pv_std = 17.0, -0.65, 0.95
    elif scenario == "overcast":
        pv_base, pv_drift, pv_std = 21.0, -0.60, 0.85
    elif scenario == "borderline":
        pv_base, pv_drift, pv_std = 20.0, -0.30, 0.65
    else:
        pv_base, pv_drift, pv_std = 18.0, 0.0, 0.4

    # 15 lags: lag_0 = current (most recent), lag_14 = 14 min ago
    lags = np.array([
        pv_base + pv_drift * (-i) + rng.normal(0, pv_std)
        for i in range(15)
    ], dtype=np.float32)
    lags = np.clip(lags, 0, 30)

    # Derived precursors
    velocity = float(lags[0] - lags[1])
    accel = float((lags[0] - lags[1]) - (lags[1] - lags[2]))
    local_std = float(np.std(lags[:5]))
    ma15 = float(np.mean(lags))
    deviation = float(lags[0] - ma15)
    range_10 = float(np.max(lags[:10]) - np.min(lags[:10]))
    detrended = float(lags[0] - np.mean(lags))

    # Weather (Stanford CA approximate ranges)
    if scenario == "clear":
        t2m, rh, sw_dwn, ws = 295, 35, 850, 1.5
        precip = 0.0
    elif scenario == "overcast":
        t2m, rh, sw_dwn, ws = 285, 80, 250, 4.0
        precip = 0.5
    elif scenario == "cloudy_drop":
        t2m, rh, sw_dwn, ws = 288, 65, 450, 3.0
        precip = 0.1
    elif scenario == "partial_progressive":
        t2m, rh, sw_dwn, ws = 290, 55, 600, 2.5
        precip = 0.0
    else:  # borderline
        t2m, rh, sw_dwn, ws = 289, 60, 550, 3.0
        precip = 0.05

    feats = {}
    for i in range(15):
        feats[f"pv_log_lag_{i}"] = float(lags[i])
    feats["T2M"] = float(t2m + rng.normal(0, 0.5))
    feats["RH2M"] = float(rh + rng.normal(0, 2))
    feats["PS"] = float(101.3 + rng.normal(0, 0.3))
    feats["WS2M"] = float(ws + rng.normal(0, 0.3))
    feats["PRECTOTCORR"] = float(max(0, precip))
    feats["ALLSKY_SFC_SW_DWN"] = float(sw_dwn + rng.normal(0, 20))
    wd_deg = float(rng.uniform(0, 360))
    feats["WD2M_sin"] = float(np.sin(2 * np.pi * wd_deg / 360))
    feats["WD2M_cos"] = float(np.cos(2 * np.pi * wd_deg / 360))
    feats["weather_age_min"] = float(rng.uniform(1, 8))
    hour = 12 + int(rng.integers(-2, 3))
    feats["hour_sin"] = float(np.sin(2 * np.pi * hour / 24))
    feats["hour_cos"] = float(np.cos(2 * np.pi * hour / 24))
    doy = int(rng.integers(60, 280))
    feats["doy_sin"] = float(np.sin(2 * np.pi * doy / 365))
    feats["doy_cos"] = float(np.cos(2 * np.pi * doy / 365))
    feats["pv_velocity"] = velocity
    feats["pv_accel"] = accel
    feats["pv_local_std"] = local_std
    feats["pv_deviation"] = deviation
    feats["pv_range_10"] = range_10
    feats["pv_detrended"] = detrended
    return feats


# ─────────────────────────────────────────────────────────────
# Sample manifest — maps to test_samples.json scenarios
# ─────────────────────────────────────────────────────────────
SCENARIOS = [
    {
        "id": "stable_day", "label": "Stable Day",
        "description": "Clear sky, steady PV — model expects no ramp.",
        "icon_hint": "🟢",
        "ref_test_sample": "true_negative",
        "scenario_kind": "clear",
        "seed": 11,
    },
    {
        "id": "partial_clouds", "label": "Partial Clouds",
        "description": "Increasing cloud cover, mild PV deviation expected.",
        "icon_hint": "🟡",
        "ref_test_sample": "borderline",
        "scenario_kind": "partial_progressive",
        "seed": 22,
    },
    {
        "id": "cloud_drop", "label": "Cloud Drop",
        "description": "Heavy clouds rolling in — sudden negative ramp predicted.",
        "icon_hint": "🔴",
        "ref_test_sample": "true_positive_2",
        "scenario_kind": "cloudy_drop",
        "seed": 33,
    },
    {
        "id": "severe_drop", "label": "Severe Drop",
        "description": "Overcast conditions — strong PV decline.",
        "icon_hint": "🔴",
        "ref_test_sample": "true_positive_1",
        "scenario_kind": "overcast",
        "seed": 44,
    },
    {
        "id": "borderline_event", "label": "Borderline Event",
        "description": "On the edge — model may miss this ramp.",
        "icon_hint": "⚠",
        "ref_test_sample": "false_negative",
        "scenario_kind": "borderline",
        "seed": 55,
    },
]


def main() -> None:
    test_samples_path = RAMP_DIR / "test_samples.json"
    test_samples = {s["sample_name"]: s for s in json.loads(test_samples_path.read_text())}

    manifest = []
    for sc in SCENARIOS:
        sample_id = sc["id"]
        ref = test_samples.get(sc["ref_test_sample"], {})

        imgs = synth_image_sequence(sc["scenario_kind"], seed=sc["seed"])
        feats = synth_features(sc["scenario_kind"], seed=sc["seed"])

        np.save(OUT_DIR / f"{sample_id}_images.npy", imgs)
        (OUT_DIR / f"{sample_id}_features.json").write_text(json.dumps(feats, indent=2))
        (OUT_DIR / f"{sample_id}_reference.json").write_text(json.dumps({
            "label": sc["label"],
            "description": sc["description"],
            "ref_test_sample": sc["ref_test_sample"],
            "true_ramp_pct": ref.get("true_ramp_pct"),
            "true_sudden_ramp": ref.get("true_sudden_ramp"),
            "pred_ramp_pct_recorded": ref.get("pred_ramp_pct"),
            "pred_sudden_ramp_prob_recorded": ref.get("pred_sudden_ramp_prob"),
            "pred_sudden_ramp_recorded": ref.get("pred_sudden_ramp"),
        }, indent=2))

        manifest.append({
            "id": sample_id,
            "label": sc["label"],
            "description": sc["description"],
            "icon_hint": sc["icon_hint"],
            "ref_test_sample": sc["ref_test_sample"],
        })
        print(f"[ok] {sample_id} — images {imgs.shape} dtype={imgs.dtype}, "
              f"feats={len(feats)} keys")

    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"\nWrote {len(manifest)} samples → {OUT_DIR}")


if __name__ == "__main__":
    main()
