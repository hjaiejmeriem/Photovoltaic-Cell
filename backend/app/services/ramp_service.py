"""Solar Ramp Forecasting service (module 07).

Multimodal ResNet18 + GRU + tabular fusion model.
Predicts:
  - ramp_pct_t+15min  (regression — % PV change over next 15 min)
  - sudden_ramp       (binary — sudden variation event)

Inputs:
  - 12 sky images (fish-eye, .npy stack of (12,128,128,3) uint8 OR
                   12 separate PNG/JPG files in chronological order)
  - 34 tabular features (raw — backend scales them)
       OR a CSV with raw PV/weather time-series → backend computes lags + derived
"""
from __future__ import annotations
import io
import json
import base64
from typing import Any
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import joblib
import pandas as pd
from PIL import Image
from torchvision import models, transforms
from torchvision.models import ResNet18_Weights

from ..config import (
    RAMP_MODEL_PATH,
    RAMP_SCALER_PATH,
    RAMP_META_PATH,
    RAMP_SAMPLES_DIR,
    RAMP_DEPLOYMENT_DIR,
)

DEVICE = torch.device("cpu")
SEQ_LEN = 12
IMG_SIZE = 128
N_FEATURES = 34
EVENT_THRESHOLD_F1 = 0.7369   # from meta.json — optimal F1 threshold


# ─────────────────────────────────────────────────────────────────
# Architecture (exactly matches notebook MultimodalForecastNet v2)
# ─────────────────────────────────────────────────────────────────
class MultimodalForecastNet(nn.Module):
    def __init__(self, tabular_dim: int = 34, img_embed_dim: int = 128,
                 tab_embed_dim: int = 64, gru_hidden_dim: int = 128):
        super().__init__()
        # backbone — load WITHOUT weights, we'll restore from state_dict
        self.backbone = models.resnet18(weights=None)
        self.backbone.fc = nn.Identity()

        self.frame_proj = nn.Sequential(
            nn.Linear(512, img_embed_dim), nn.ReLU(), nn.Dropout(0.2),
        )
        self.gru = nn.GRU(
            input_size=img_embed_dim, hidden_size=gru_hidden_dim,
            num_layers=1, batch_first=True,
        )
        self.tabular_encoder = nn.Sequential(
            nn.Linear(tabular_dim, 128), nn.ReLU(), nn.Dropout(0.2),
            nn.Linear(128, tab_embed_dim), nn.ReLU(),
        )
        fusion_dim = gru_hidden_dim + tab_embed_dim
        self.fusion = nn.Sequential(
            nn.Linear(fusion_dim, 128), nn.ReLU(), nn.Dropout(0.3),
            nn.Linear(128, 64), nn.ReLU(),
        )
        self.reg_head = nn.Linear(64, 1)
        self.cls_head = nn.Sequential(
            nn.Linear(fusion_dim, 128), nn.ReLU(), nn.Dropout(0.3),
            nn.Linear(128, 64), nn.ReLU(),
            nn.Linear(64, 1),
        )

    def forward(self, images, tabular):
        B, T, C, H, W = images.shape
        x = images.view(B * T, C, H, W)
        frame_feats = self.backbone(x)
        frame_feats = self.frame_proj(frame_feats)
        frame_feats = frame_feats.view(B, T, -1)
        _, h_n = self.gru(frame_feats)
        img_seq_feat = h_n[-1]
        tab_feat = self.tabular_encoder(tabular)
        fused_raw = torch.cat([img_seq_feat, tab_feat], dim=1)
        fused = self.fusion(fused_raw)
        y_reg = self.reg_head(fused).squeeze(1)
        y_cls_logit = self.cls_head(fused_raw).squeeze(1)
        return y_reg, y_cls_logit


# ─────────────────────────────────────────────────────────────────
# Lazy singletons
# ─────────────────────────────────────────────────────────────────
_model: MultimodalForecastNet | None = None
_scaler = None
_meta: dict | None = None
_feature_cols: list[str] | None = None

# ImageNet normalization (matches preprocess.py)
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]
val_transform = transforms.Compose([
    transforms.ToPILImage(),
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])


def get_model():
    global _model, _scaler, _meta, _feature_cols
    if _model is None:
        if not RAMP_MODEL_PATH.exists():
            raise FileNotFoundError(f"Ramp model not found: {RAMP_MODEL_PATH}")
        _meta = json.loads(RAMP_META_PATH.read_text())
        _feature_cols = list(_meta["input"]["tabular"]["feature_cols"])
        m = MultimodalForecastNet(tabular_dim=len(_feature_cols))
        ckpt = torch.load(str(RAMP_MODEL_PATH), map_location=DEVICE)
        # Checkpoint may be a wrapper dict with metadata
        if isinstance(ckpt, dict) and "model_state_dict" in ckpt:
            state = ckpt["model_state_dict"]
            # use checkpoint-stored metadata if available
            if "feature_cols" in ckpt:
                _feature_cols = list(ckpt["feature_cols"])
            if "p_max_train" in ckpt:
                _meta.setdefault("training", {})["p_max_train"] = float(ckpt["p_max_train"])
        elif isinstance(ckpt, dict) and "state_dict" in ckpt:
            state = ckpt["state_dict"]
        else:
            state = ckpt
        m.load_state_dict(state)
        m.to(DEVICE).eval()
        _model = m
        _scaler = joblib.load(str(RAMP_SCALER_PATH))
    return _model, _scaler, _feature_cols, _meta


def get_feature_columns() -> list[str]:
    _, _, cols, _ = get_model()
    return list(cols)


# ─────────────────────────────────────────────────────────────────
# Image preprocessing
# ─────────────────────────────────────────────────────────────────
def _decode_image(file_bytes: bytes, filename: str = "") -> np.ndarray:
    """Decode a single image file → (H,W,3) uint8 array."""
    if filename.lower().endswith(".npy") or (
        len(file_bytes) >= 6 and file_bytes[:6] == b"\x93NUMPY"
    ):
        arr = np.load(io.BytesIO(file_bytes), allow_pickle=False)
        if arr.ndim == 4:
            return arr  # caller handles
        if arr.ndim == 3 and arr.shape[-1] in (1, 3, 4):
            return arr.astype(np.uint8) if arr.dtype != np.uint8 else arr
    img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
    return np.array(img, dtype=np.uint8)


def _build_image_tensor_from_npy_stack(npy_bytes: bytes) -> torch.Tensor:
    """Load a .npy with shape (12, H, W, 3) or (12, 3, H, W) → (1, 12, 3, 128, 128)."""
    arr = np.load(io.BytesIO(npy_bytes), allow_pickle=False)
    if arr.ndim != 4 or arr.shape[0] != SEQ_LEN:
        raise ValueError(
            f"Sky-images stack must be shape ({SEQ_LEN}, H, W, 3) "
            f"or ({SEQ_LEN}, 3, H, W) — got {arr.shape}"
        )
    # Convert (T,3,H,W) → (T,H,W,3) if needed
    if arr.shape[1] == 3 and arr.shape[-1] != 3:
        arr = arr.transpose(0, 2, 3, 1)
    if arr.dtype != np.uint8:
        arr = np.clip(arr, 0, 255).astype(np.uint8)
    frames = [val_transform(arr[t]) for t in range(SEQ_LEN)]
    return torch.stack(frames, dim=0).unsqueeze(0)  # (1,12,3,128,128)


def _build_image_tensor_from_files(files: list[tuple[bytes, str]]) -> torch.Tensor:
    """12 separate image files (ordered chronologically) → (1, 12, 3, 128, 128)."""
    if len(files) != SEQ_LEN:
        raise ValueError(f"Expected exactly {SEQ_LEN} image files, got {len(files)}")
    frames = []
    for b, name in files:
        arr = _decode_image(b, name)
        if arr.ndim != 3:
            raise ValueError(f"File {name} did not decode to (H,W,3)")
        frames.append(val_transform(arr))
    return torch.stack(frames, dim=0).unsqueeze(0)


# ─────────────────────────────────────────────────────────────────
# Tabular preprocessing
# ─────────────────────────────────────────────────────────────────
def _build_feature_tensor(features_dict: dict, feature_cols: list[str], scaler) -> torch.Tensor:
    missing = [c for c in feature_cols if c not in features_dict]
    if missing:
        raise ValueError(
            f"Missing {len(missing)} required feature(s): {missing[:5]}"
            f"{' …' if len(missing) > 5 else ''}"
        )
    row = pd.DataFrame([features_dict])[feature_cols]
    scaled = scaler.transform(row)
    return torch.tensor(scaled, dtype=torch.float32)


def derive_features_from_csv(csv_bytes: bytes) -> dict:
    """Take a raw CSV (timestamp + pv + weather columns) and compute the 34 features.

    Required CSV columns (case-insensitive):
      - timestamp (parseable datetime)
      - pv         (raw PV value — will be log-transformed)
      - T2M, RH2M, PS, WS2M, PRECTOTCORR, ALLSKY_SFC_SW_DWN, WD2M

    Uses the LAST row as t=0 and the previous 14 rows for lags + derived features.
    """
    df = pd.read_csv(io.BytesIO(csv_bytes))
    df.columns = [c.strip() for c in df.columns]

    # required columns check
    req = ["timestamp", "pv", "T2M", "RH2M", "PS", "WS2M",
           "PRECTOTCORR", "ALLSKY_SFC_SW_DWN", "WD2M"]
    missing = [c for c in req if c not in df.columns]
    if missing:
        raise ValueError(f"CSV missing column(s): {missing}")

    if len(df) < 15:
        raise ValueError(f"CSV needs at least 15 rows for lags — got {len(df)}")

    df = df.sort_values("timestamp").reset_index(drop=True)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df["pv_log"] = np.log1p(df["pv"].astype(float))

    # 15 lags (lag_0 = current row, lag_i = i rows ago)
    last = len(df) - 1
    lags = {f"pv_log_lag_{i}": float(df["pv_log"].iloc[last - i]) for i in range(15)}

    # Derived precursors (computed up to t=last)
    pv_log = df["pv_log"]
    velocity = float(pv_log.iloc[last] - pv_log.iloc[last - 1])
    accel = float((pv_log.iloc[last] - pv_log.iloc[last - 1])
                  - (pv_log.iloc[last - 1] - pv_log.iloc[last - 2]))
    local_std = float(pv_log.iloc[max(0, last - 4):last + 1].std() or 0.0)
    ma15 = float(pv_log.iloc[max(0, last - 14):last + 1].mean())
    deviation = float(pv_log.iloc[last] - ma15)
    win10 = pv_log.iloc[max(0, last - 9):last + 1]
    range_10 = float(win10.max() - win10.min())
    detrended = float(pv_log.iloc[last] - pv_log.iloc[max(0, last - 14):last + 1].mean())

    row = df.iloc[last]
    ts = row["timestamp"]
    hour = ts.hour
    doy = ts.dayofyear
    wd_deg = float(row["WD2M"])

    # Weather age (here approximated as 0 since CSV is the data itself; user can override)
    weather_age_min = 0.0

    feats = {
        **lags,
        "T2M": float(row["T2M"]),
        "RH2M": float(row["RH2M"]),
        "PS": float(row["PS"]),
        "WS2M": float(row["WS2M"]),
        "PRECTOTCORR": float(row["PRECTOTCORR"]),
        "ALLSKY_SFC_SW_DWN": float(row["ALLSKY_SFC_SW_DWN"]),
        "WD2M_sin": float(np.sin(2 * np.pi * wd_deg / 360)),
        "WD2M_cos": float(np.cos(2 * np.pi * wd_deg / 360)),
        "weather_age_min": weather_age_min,
        "hour_sin": float(np.sin(2 * np.pi * hour / 24)),
        "hour_cos": float(np.cos(2 * np.pi * hour / 24)),
        "doy_sin": float(np.sin(2 * np.pi * doy / 365)),
        "doy_cos": float(np.cos(2 * np.pi * doy / 365)),
        "pv_velocity": velocity,
        "pv_accel": accel,
        "pv_local_std": local_std,
        "pv_deviation": deviation,
        "pv_range_10": range_10,
        "pv_detrended": detrended,
    }
    return feats


# ─────────────────────────────────────────────────────────────────
# Image → b64 (for frontend display)
# ─────────────────────────────────────────────────────────────────
def _image_to_b64(arr_uint8: np.ndarray, target_size: int = 128) -> str:
    if arr_uint8.shape[0] == 3 and arr_uint8.ndim == 3:
        arr_uint8 = arr_uint8.transpose(1, 2, 0)
    img = Image.fromarray(arr_uint8.astype(np.uint8))
    if img.size != (target_size, target_size):
        img = img.resize((target_size, target_size), Image.BILINEAR)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _frames_for_display(frames_uint8: np.ndarray) -> list[str]:
    """frames_uint8 shape (12, H, W, 3) uint8 → 12 data URLs."""
    return [_image_to_b64(frames_uint8[t]) for t in range(SEQ_LEN)]


# ─────────────────────────────────────────────────────────────────
# Status / advice
# ─────────────────────────────────────────────────────────────────
def _build_advice(ramp_pct: float, prob: float, is_ramp: bool) -> tuple[str, str, str]:
    if is_ramp and ramp_pct < 0:
        status = "Sudden Drop"
        severity = "danger"
        msg = (
            f"⚠ Sudden negative ramp detected — PV expected to drop {abs(ramp_pct):.1f}% "
            "over the next 15 minutes. Cloud cover incoming. "
            "Consider activating battery dispatch or grid backup."
        )
    elif is_ramp and ramp_pct > 0:
        status = "Sudden Surge"
        severity = "warning"
        msg = (
            f"⚡ Sudden positive ramp — PV expected to rise {ramp_pct:.1f}%. "
            "Inverter clipping risk; check capacity headroom."
        )
    elif abs(ramp_pct) >= 5:
        status = "Mild Variation"
        severity = "warning"
        msg = (
            f"Moderate {('drop' if ramp_pct < 0 else 'rise')} of {abs(ramp_pct):.1f}% "
            "expected. No sudden ramp event flagged."
        )
    else:
        status = "Stable"
        severity = "success"
        msg = (
            f"Production stable — predicted {ramp_pct:+.1f}% change over next 15 min. "
            "Normal grid operation expected."
        )
    return status, severity, msg


# ─────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────
def predict_ramp(images_tensor: torch.Tensor, features_dict: dict,
                 display_frames: np.ndarray | None = None) -> dict[str, Any]:
    """Run the multimodal model. Returns ramp + classification + visualizations."""
    model, scaler, feature_cols, meta = get_model()

    feat_tensor = _build_feature_tensor(features_dict, feature_cols, scaler).to(DEVICE)
    images_tensor = images_tensor.to(DEVICE)

    with torch.no_grad():
        y_reg, y_cls_logit = model(images_tensor, feat_tensor)
    ramp_pct = float(y_reg.item())
    prob = float(torch.sigmoid(y_cls_logit).item())
    is_ramp = bool(prob >= EVENT_THRESHOLD_F1)
    direction = "positive" if ramp_pct >= 0 else "negative"

    status, severity, message = _build_advice(ramp_pct, prob, is_ramp)

    out = {
        "ramp_pct": round(ramp_pct, 4),
        "direction": direction,
        "sudden_ramp_prob": round(prob, 4),
        "sudden_ramp_detected": is_ramp,
        "label": "SUDDEN RAMP" if is_ramp else "normal",
        "status": status,
        "severity": severity,
        "message": message,
        "event_threshold": EVENT_THRESHOLD_F1,
        "n_features_used": len(feature_cols),
    }

    if display_frames is not None:
        out["sky_frames"] = _frames_for_display(display_frames)

    # PV trajectory for the chart (last 15 lags + projected at t+15)
    lags = [features_dict.get(f"pv_log_lag_{i}", None) for i in range(15)]
    if all(v is not None for v in lags):
        # lag_0 = current, lag_14 = oldest → reverse for chart
        pv_history = [round(float(v), 4) for v in reversed(lags)]
        # Projection: ramp_pct is % of P_MAX_TRAIN (29.5585 from meta), shift in pv_log space
        p_max_train = float(meta.get("training", {}).get("p_max_train", 29.5585))
        projected = float(lags[0]) + (ramp_pct / 100.0) * p_max_train
        out["pv_history"] = pv_history
        out["pv_projected"] = round(projected, 4)

    return out


def predict_from_npy_stack(npy_bytes: bytes, features_dict: dict) -> dict[str, Any]:
    """Inference on a (12,H,W,3) .npy stack + features dict."""
    images_tensor = _build_image_tensor_from_npy_stack(npy_bytes)
    # Reload raw frames for display
    display = np.load(io.BytesIO(npy_bytes), allow_pickle=False)
    if display.shape[1] == 3 and display.shape[-1] != 3:
        display = display.transpose(0, 2, 3, 1)
    if display.dtype != np.uint8:
        display = np.clip(display, 0, 255).astype(np.uint8)
    return predict_ramp(images_tensor, features_dict, display_frames=display)


def predict_from_files(image_files: list[tuple[bytes, str]], features_dict: dict) -> dict[str, Any]:
    """Inference on 12 separate image files."""
    images_tensor = _build_image_tensor_from_files(image_files)
    display = np.stack([_decode_image(b, n) for b, n in image_files], axis=0)
    return predict_ramp(images_tensor, features_dict, display_frames=display)


# ─────────────────────────────────────────────────────────────────
# Bundled demo samples
# ─────────────────────────────────────────────────────────────────
def list_samples() -> list[dict]:
    manifest_path = RAMP_SAMPLES_DIR / "manifest.json"
    if not manifest_path.exists():
        return []
    return json.loads(manifest_path.read_text())


def list_deployment_samples() -> list[dict]:
    """Return metadata about real deployment-test samples (from colleague)."""
    if not RAMP_DEPLOYMENT_DIR.exists():
        return []
    out = []
    LABELS = {
        "sample_1": ("Evening — Stable", "Clear sky, sun setting calmly. Power output gently winding down.", "🟢"),
        "sample_2": ("Morning — Rising", "Sun is climbing. Production picking up steadily.", "🌅"),
        "sample_3": ("Afternoon — Cloudy", "Thin clouds passing overhead. Production lightly fluctuating.", "⛅"),
        "sample_4": ("Evening — Decline", "Late afternoon. Sun dropping toward the horizon.", "🌇"),
        "sample_5": ("Morning — Steady", "Bright morning, low cloud cover. Smooth production.", "☀️"),
    }
    for sub in sorted(RAMP_DEPLOYMENT_DIR.iterdir()):
        if not sub.is_dir():
            continue
        sid = sub.name
        exp_path = sub / "expected_output.json"
        meta_lbl, meta_desc, icon = LABELS.get(
            sid, (sid.replace("_", " ").title(), "Live deployment sample.", "📷")
        )
        timestamp = None
        if exp_path.exists():
            try:
                exp = json.loads(exp_path.read_text())
                timestamp = exp.get("timestamp")
            except Exception:
                pass
        # Count frames present
        sky_dir = sub / "sky_images"
        n_frames = sum(1 for _ in sky_dir.glob("*.png")) if sky_dir.exists() else 0
        out.append({
            "id": sid,
            "label": meta_lbl,
            "description": meta_desc,
            "icon_hint": icon,
            "timestamp": timestamp,
            "n_frames": n_frames,
        })
    return out


def _read_deployment_features(sample_dir: Path) -> dict:
    """Read pv_history_input.csv + meteo_input.csv → 34-feature dict.

    Replicates the EXACT recipe from the training notebook:
      - pv_velocity   = pv_log.diff(1)               → lag_0 - lag_1
      - pv_accel      = diff(1) - shift(1).diff(1)   → lag_0 - 2*lag_1 + lag_2
      - pv_local_std  = rolling(5).std()             → ddof=1 (pandas default)
      - pv_deviation  = pv_log - rolling(15).mean()  → lag_0 - mean(lag_0..lag_14)
      - pv_range_10   = rolling(10).max - rolling(10).min  → over lag_0..lag_9
      - pv_detrended  = pv_log - savgol_filter(window=11, polyorder=2)
    """
    from scipy.signal import savgol_filter

    pv_csv = sample_dir / "pv_history_input.csv"
    met_csv = sample_dir / "meteo_input.csv"
    if not pv_csv.exists() or not met_csv.exists():
        raise FileNotFoundError(f"Missing input CSV(s) in {sample_dir}")

    pv_df = pd.read_csv(pv_csv)
    met_df = pd.read_csv(met_csv)
    pv_row = pv_df.iloc[0]
    met_row = met_df.iloc[0]

    # 15 PV log lags — lag_0 = current (most recent), lag_14 = oldest
    lags = [float(pv_row[f"pv_log_lag_{i}"]) for i in range(15)]

    # Derived PV precursors — match notebook recipe exactly
    velocity = lags[0] - lags[1]
    accel = lags[0] - 2 * lags[1] + lags[2]
    # rolling(5).std() with min_periods=1, ddof=1 → over [lag_4..lag_0]
    local_std = float(pd.Series(lags[:5]).std(ddof=1))   # ddof=1 like pandas
    ma15 = float(np.mean(lags))                           # rolling(15).mean()
    deviation = lags[0] - ma15
    range_10 = float(np.max(lags[:10]) - np.min(lags[:10]))
    # pv_detrended — Savitzky-Golay residual. With only 15 lags and notebook's
    # global window_length=61 unavailable, use the largest odd window ≤ len.
    pv_series_oldest_first = np.array(lags[::-1], dtype=np.float64)   # lag_14..lag_0
    wl = min(11, len(pv_series_oldest_first) - 1)
    if wl % 2 == 0:
        wl -= 1
    if wl >= 5:
        pv_smooth = savgol_filter(pv_series_oldest_first, window_length=wl, polyorder=2)
        detrended = float(pv_series_oldest_first[-1] - pv_smooth[-1])  # residual at "now" (=lag_0)
    else:
        detrended = 0.0

    # Time features from timestamp
    ts = pd.to_datetime(met_row["timestamp"])
    hour = ts.hour
    doy = ts.dayofyear
    wd_deg = float(met_row["WD2M"])

    feats = {
        **{f"pv_log_lag_{i}": float(lags[i]) for i in range(15)},
        "T2M": float(met_row["T2M"]),
        "RH2M": float(met_row["RH2M"]),
        "PS": float(met_row["PS"]),
        "WS2M": float(met_row["WS2M"]),
        "PRECTOTCORR": float(met_row["PRECTOTCORR"]),
        "ALLSKY_SFC_SW_DWN": float(met_row["ALLSKY_SFC_SW_DWN"]),
        "WD2M_sin": float(np.sin(2 * np.pi * wd_deg / 360)),
        "WD2M_cos": float(np.cos(2 * np.pi * wd_deg / 360)),
        "weather_age_min": float(met_row["weather_age_min"]),
        "hour_sin": float(np.sin(2 * np.pi * hour / 24)),
        "hour_cos": float(np.cos(2 * np.pi * hour / 24)),
        "doy_sin": float(np.sin(2 * np.pi * doy / 365)),
        "doy_cos": float(np.cos(2 * np.pi * doy / 365)),
        "pv_velocity": float(velocity),
        "pv_accel": float(accel),
        "pv_local_std": float(local_std),
        "pv_deviation": float(deviation),
        "pv_range_10": float(range_10),
        "pv_detrended": float(detrended),
    }
    return feats


def _read_deployment_images(sample_dir: Path) -> tuple[torch.Tensor, np.ndarray]:
    """Read sky_images/*.png → keep the last 12 frames → (1,12,3,128,128) tensor + display array."""
    sky_dir = sample_dir / "sky_images"
    if not sky_dir.exists():
        raise FileNotFoundError(f"Missing sky_images dir in {sample_dir}")
    pngs = sorted(sky_dir.glob("*.png"))
    if len(pngs) < SEQ_LEN:
        raise ValueError(f"Need at least {SEQ_LEN} sky frames, got {len(pngs)}")
    # Take the last SEQ_LEN frames (most recent → "now")
    selected = pngs[-SEQ_LEN:]
    raw_frames = []
    tensors = []
    for p in selected:
        arr = np.array(Image.open(p).convert("RGB"), dtype=np.uint8)
        raw_frames.append(arr)
        tensors.append(val_transform(arr))
    images_tensor = torch.stack(tensors, dim=0).unsqueeze(0)  # (1,12,3,128,128)
    display = np.stack(raw_frames, axis=0)
    return images_tensor, display


def _apply_weather_overrides(features: dict, weather: dict | None,
                             now_local=None) -> dict:
    """Splice live Open-Meteo readings into the feature dict so the model
    actually reacts to current conditions. Keeps the bundled PV lags
    (we can't get 15 consecutive live PV measurements without history),
    but overrides every weather column and the time-of-day features.

    Mutates a copy, returns the new dict. If `weather` is None or any
    value is missing, the bundled value is kept.
    """
    import datetime as _dt
    out = dict(features)
    if weather:
        mapping = {
            "T2M": weather.get("T2M"),
            "RH2M": weather.get("RH2M"),
            "PS": weather.get("PS"),
            "WS2M": weather.get("WS2M"),
            "PRECTOTCORR": weather.get("PRECTOTCORR"),
            "ALLSKY_SFC_SW_DWN": weather.get("ALLSKY_SFC_SW_DWN"),
        }
        for k, v in mapping.items():
            if v is not None:
                out[k] = float(v)
        wd = weather.get("WD2M")
        if wd is not None:
            out["WD2M_sin"] = float(np.sin(2 * np.pi * float(wd) / 360))
            out["WD2M_cos"] = float(np.cos(2 * np.pi * float(wd) / 360))
        # Live reading → fresh
        out["weather_age_min"] = 0.0

    # Real time of day (the sample's bundled timestamp is months old)
    if now_local is None:
        now_local = _dt.datetime.now(_dt.timezone(_dt.timedelta(hours=1)))  # Tunis UTC+1
    hour = now_local.hour + now_local.minute / 60.0
    doy = now_local.timetuple().tm_yday
    out["hour_sin"] = float(np.sin(2 * np.pi * hour / 24))
    out["hour_cos"] = float(np.cos(2 * np.pi * hour / 24))
    out["doy_sin"] = float(np.sin(2 * np.pi * doy / 365))
    out["doy_cos"] = float(np.cos(2 * np.pi * doy / 365))
    return out


def predict_deployment_sample(sample_id: str,
                              weather_override: dict | None = None,
                              ) -> dict[str, Any]:
    """Run forecast on a real deployment-test sample (PNG fish-eye + CSV).

    If `weather_override` is given (from a live source like Open-Meteo),
    its values are spliced into the feature vector BEFORE inference so
    the model actually reacts to current weather rather than the
    bundled CSV's frozen snapshot.
    """
    sample_dir = RAMP_DEPLOYMENT_DIR / sample_id
    if not sample_dir.exists():
        raise FileNotFoundError(f"Deployment sample '{sample_id}' not found")

    images_tensor, display = _read_deployment_images(sample_dir)
    features = _read_deployment_features(sample_dir)
    if weather_override is not None:
        features = _apply_weather_overrides(features, weather_override)
    result = predict_ramp(images_tensor, features, display_frames=display)
    result["source"] = sample_id
    result["mode"] = "deployment"
    if weather_override is not None:
        result["features_used"] = {
            k: features[k] for k in (
                "T2M", "RH2M", "PS", "WS2M", "PRECTOTCORR",
                "ALLSKY_SFC_SW_DWN", "hour_sin", "hour_cos"
            ) if k in features
        }

    # Attach expected output as reference
    exp_path = sample_dir / "expected_output.json"
    if exp_path.exists():
        try:
            exp = json.loads(exp_path.read_text())
            result["reference"] = {
                "label": sample_id,
                "ref_test_sample": "deployment_input",
                "timestamp": exp.get("timestamp"),
                "true_ramp_pct": exp.get("true_ramp_pct"),
                "true_label": exp.get("true_label"),
                "expected_ramp_pct": exp.get("expected_ramp_pct"),
                "expected_ramp_prob": exp.get("expected_ramp_prob"),
                "expected_label": exp.get("expected_label"),
            }
        except Exception:
            pass
    return result


def predict_sample(sample_id: str) -> dict[str, Any]:
    npy_path = RAMP_SAMPLES_DIR / f"{sample_id}_images.npy"
    feat_path = RAMP_SAMPLES_DIR / f"{sample_id}_features.json"
    ref_path = RAMP_SAMPLES_DIR / f"{sample_id}_reference.json"

    if not npy_path.exists() or not feat_path.exists():
        raise FileNotFoundError(f"Sample '{sample_id}' missing in {RAMP_SAMPLES_DIR}")

    features = json.loads(feat_path.read_text())
    result = predict_from_npy_stack(npy_path.read_bytes(), features)
    result["source"] = sample_id

    if ref_path.exists():
        try:
            ref = json.loads(ref_path.read_text())
            result["reference"] = ref
        except Exception:
            pass
    return result
