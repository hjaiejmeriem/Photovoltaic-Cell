"""Battery State-of-Health (SoH) prediction — Fusion Model V2.

Multimodal architecture combining:
  - ThermalCNN (image input — 1×64×64 thermal map)
  - BatteryLSTM (25 numeric features — voltage, current, temp, capacity, …)
  - IntermediateFusionGate + CrossModalAttention
  - Regression head with sigmoid → SoH ∈ [0, 1]

Inputs accepted:
  - thermal_image : .npy file (numpy array, any shape that PIL/np can decode to 64×64),
                    OR a regular image (PNG/JPG) which we convert to 64×64 grayscale
  - features      : JSON dict with the 25 feature names defined in feature_cols_v2.pkl
"""
from __future__ import annotations
import io
import json
import base64
from typing import Any

import numpy as np
import torch
import torch.nn as nn
import joblib
from PIL import Image

from ..config import (
    BATTERY_MODEL_PATH,
    BATTERY_SCALER_PATH,
    BATTERY_FEATURE_COLS_PATH,
    BATTERY_META_PATH,
    BATTERY_SAMPLES_DIR,
)

DEVICE = torch.device("cpu")


# ─────────────────────────────────────────────────────────────────
# Architecture (copied from `model_architecture.py`)
# ─────────────────────────────────────────────────────────────────
class ThermalCNN(nn.Module):
    def __init__(self, dropout=0.3):
        super().__init__()
        self.block1 = nn.Sequential(
            nn.Conv2d(1, 32, 3, padding=1), nn.BatchNorm2d(32), nn.ReLU(), nn.MaxPool2d(2))
        self.block2 = nn.Sequential(
            nn.Conv2d(32, 64, 3, padding=1), nn.BatchNorm2d(64), nn.ReLU(), nn.MaxPool2d(2))
        self.block3 = nn.Sequential(
            nn.Conv2d(64, 128, 3, padding=1), nn.BatchNorm2d(128), nn.ReLU(), nn.MaxPool2d(2))
        self.last_conv = nn.Sequential(
            nn.Conv2d(128, 128, 3, padding=1), nn.BatchNorm2d(128), nn.ReLU())
        self.pool = nn.AdaptiveAvgPool2d((4, 4))
        self.head = nn.Sequential(
            nn.Flatten(),
            nn.Linear(2048, 256), nn.ReLU(), nn.Dropout(dropout),
            nn.Linear(256, 64), nn.ReLU())

    def forward(self, x):
        x = self.block1(x); x = self.block2(x); x = self.block3(x)
        x = self.last_conv(x); x = self.pool(x)
        return self.head(x)


class BatteryLSTM(nn.Module):
    def __init__(self, input_size=25, hidden=128, layers=2, dropout=0.3):
        super().__init__()
        self.lstm = nn.LSTM(input_size, hidden, layers, batch_first=True,
                            dropout=dropout if layers > 1 else 0)
        self.head = nn.Sequential(nn.Linear(hidden, 64), nn.ReLU(), nn.Dropout(dropout / 2))

    def forward(self, x):
        if x.dim() == 2:
            x = x.unsqueeze(1)
        out, _ = self.lstm(x)
        return self.head(out[:, -1, :])


class IntermediateFusionGate(nn.Module):
    def __init__(self, dim=64):
        super().__init__()
        self.gate_feat2img = nn.Sequential(nn.Linear(dim, dim), nn.Sigmoid())
        self.gate_img2feat = nn.Sequential(nn.Linear(dim, dim), nn.Sigmoid())
        self.joint_proj = nn.Sequential(nn.Linear(dim * 2, dim), nn.ReLU())
        self.norm1 = nn.LayerNorm(dim)
        self.norm2 = nn.LayerNorm(dim)

    def forward(self, img_emb, feat_emb):
        gfi = self.gate_feat2img(feat_emb)
        gff = self.gate_img2feat(img_emb)
        ig = self.norm1(img_emb * gfi + img_emb)
        fg = self.norm2(feat_emb * gff + feat_emb)
        joint = self.joint_proj(torch.cat([ig, fg], dim=1))
        return ig + joint, fg + joint


class CrossModalAttention(nn.Module):
    def __init__(self, dim=64, n_heads=4):
        super().__init__()
        self.attn_img2feat = nn.MultiheadAttention(embed_dim=dim, num_heads=n_heads, batch_first=True)
        self.attn_feat2img = nn.MultiheadAttention(embed_dim=dim, num_heads=n_heads, batch_first=True)
        self.norm1 = nn.LayerNorm(dim)
        self.norm2 = nn.LayerNorm(dim)

    def forward(self, img_emb, feat_emb):
        iq = img_emb.unsqueeze(1); fk = feat_emb.unsqueeze(1)
        ia, _ = self.attn_img2feat(iq, fk, fk)
        fa, _ = self.attn_feat2img(fk, iq, iq)
        return self.norm1(img_emb + ia.squeeze(1)), self.norm2(feat_emb + fa.squeeze(1))


class FusionModelV2(nn.Module):
    def __init__(self, n_feats=25, dropout=0.3):
        super().__init__()
        self.cnn = ThermalCNN(dropout=dropout)
        self.lstm = BatteryLSTM(input_size=n_feats, dropout=dropout)
        self.inter_fusion = IntermediateFusionGate(dim=64)
        self.cross_attn = CrossModalAttention(dim=64, n_heads=4)
        self.head = nn.Sequential(
            nn.Linear(128, 256), nn.GELU(), nn.Dropout(dropout),
            nn.Linear(256, 128), nn.GELU(), nn.Dropout(dropout / 2),
            nn.Linear(128, 64), nn.GELU(),
            nn.Linear(64, 1), nn.Sigmoid())

    def forward(self, img, feats):
        ie = self.cnn(img); fe = self.lstm(feats)
        ie, fe = self.inter_fusion(ie, fe)
        ia, fa = self.cross_attn(ie, fe)
        return self.head(torch.cat([ia, fa], dim=1)).squeeze(1)


# ─────────────────────────────────────────────────────────────────
# Lazy singletons
# ─────────────────────────────────────────────────────────────────
_model = None
_scaler = None
_feature_cols: list[str] | None = None


def get_model_and_scaler():
    global _model, _scaler, _feature_cols
    if _model is None:
        if not BATTERY_MODEL_PATH.exists():
            raise FileNotFoundError(f"Battery model not found: {BATTERY_MODEL_PATH}")
        m = FusionModelV2(n_feats=25)
        state = torch.load(str(BATTERY_MODEL_PATH), map_location=DEVICE)
        m.load_state_dict(state)
        m.to(DEVICE).eval()
        _model = m
        _scaler = joblib.load(str(BATTERY_SCALER_PATH))
        _feature_cols = joblib.load(str(BATTERY_FEATURE_COLS_PATH))
    return _model, _scaler, _feature_cols


def get_feature_columns() -> list[str]:
    _, _, cols = get_model_and_scaler()
    return list(cols)


# ─────────────────────────────────────────────────────────────────
# Preprocessing
# ─────────────────────────────────────────────────────────────────
def _load_thermal_array(image_bytes: bytes, filename: str = "") -> np.ndarray:
    """Decode a thermal image into a (H, W) numpy array.

    Accepts:
      - .npy raw numpy arrays (any 2D shape — will be resized to 64×64)
      - regular images (PNG/JPG/TIFF) → grayscale → 64×64
    """
    is_npy = filename.lower().endswith(".npy")
    if is_npy or (len(image_bytes) >= 6 and image_bytes[:6] == b"\x93NUMPY"):
        arr = np.load(io.BytesIO(image_bytes), allow_pickle=False)
    else:
        img = Image.open(io.BytesIO(image_bytes)).convert("L")  # grayscale
        arr = np.array(img, dtype=np.float32)

    # If the array has channels, take the mean
    if arr.ndim == 3:
        arr = arr.mean(axis=-1)

    # Resize to 64×64 if needed
    if arr.shape != (64, 64):
        img_pil = Image.fromarray(arr.astype(np.float32), mode="F").resize(
            (64, 64), Image.BILINEAR
        )
        arr = np.array(img_pil, dtype=np.float32)
    return arr.astype(np.float32)


def _normalize_image(arr: np.ndarray) -> np.ndarray:
    """Min-max normalize to [0, 1] (matches preprocess.py from the bundle)."""
    mn, mx = float(arr.min()), float(arr.max())
    return (arr - mn) / (mx - mn + 1e-6)


def _build_feature_tensor(features_dict: dict, feature_cols: list[str], scaler) -> torch.Tensor:
    missing = [c for c in feature_cols if c not in features_dict]
    if missing:
        raise ValueError(
            f"Missing {len(missing)} required feature(s): {missing[:5]}"
            f"{' …' if len(missing) > 5 else ''}"
        )
    raw = np.array([float(features_dict[c]) for c in feature_cols], dtype=np.float32).reshape(1, -1)
    scaled = scaler.transform(raw)
    return torch.tensor(scaled, dtype=torch.float32)


# ─────────────────────────────────────────────────────────────────
# Image rendering for response (heatmap viz of the thermal input)
# ─────────────────────────────────────────────────────────────────
def _thermal_to_b64_png(arr_norm: np.ndarray) -> str:
    """Render normalized thermal array as a JET colormap PNG (data URL)."""
    import cv2
    u8 = (np.clip(arr_norm, 0, 1) * 255).astype(np.uint8)
    colored = cv2.applyColorMap(u8, cv2.COLORMAP_JET)
    colored = cv2.cvtColor(colored, cv2.COLOR_BGR2RGB)
    # Upscale to 256×256 for nicer display
    img = Image.fromarray(colored).resize((256, 256), Image.NEAREST)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


# ─────────────────────────────────────────────────────────────────
# Status / recommendation logic
# ─────────────────────────────────────────────────────────────────
def _status_from_soh(soh: float) -> tuple[str, str]:
    if soh >= 0.90:
        status = "Healthy"
        msg = (
            f"SoH = {soh:.2f} — Battery is in healthy condition. "
            "Internal performance is within normal range. "
            "Continue normal operation and monitor every 3 months."
        )
    elif soh >= 0.70:
        status = "Warning"
        msg = (
            f"SoH = {soh:.2f} — Battery health is degrading. "
            "Capacity fade above acceptable threshold. "
            "Schedule a deep diagnostic within 2 weeks."
        )
    else:
        status = "Critical"
        msg = (
            f"SoH = {soh:.2f} — Battery is in critical condition. "
            "Immediate replacement is strongly recommended to avoid system failure."
        )
    return status, msg


# ─────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────
def predict_battery_soh(image_bytes: bytes, image_filename: str,
                        features_dict: dict) -> dict[str, Any]:
    """Run the multimodal fusion model. Returns SoH + status + visualizations."""
    model, scaler, feature_cols = get_model_and_scaler()

    # Prepare image tensor (1, 1, 64, 64)
    arr = _load_thermal_array(image_bytes, image_filename)
    arr_norm = _normalize_image(arr)
    img_tensor = torch.tensor(arr_norm[np.newaxis, np.newaxis, :, :], dtype=torch.float32).to(DEVICE)

    # Prepare features tensor (1, 25)
    feat_tensor = _build_feature_tensor(features_dict, feature_cols, scaler).to(DEVICE)

    # Forward
    with torch.no_grad():
        soh = float(model(img_tensor, feat_tensor).item())
    soh = max(0.0, min(1.0, soh))   # clamp [0,1]

    status, message = _status_from_soh(soh)

    # Heuristic context metrics (best-effort, derived from raw features if present)
    extra = {}
    for label, key in [
        ("Charge Cycles",       "cycle_normalized"),
        ("Capacity Fade",       "capacity_fade_rate"),
        ("Mean Temperature",    "temp_mean"),
        ("Mean Voltage",        "voltage_mean"),
    ]:
        if key in features_dict:
            extra[label] = round(float(features_dict[key]), 4)

    return {
        "soh": round(soh, 4),
        "soh_pct": round(soh * 100, 1),
        "status": status,
        "message": message,
        "n_features_used": len(feature_cols),
        "context_features": extra,
        "thermal_image": _thermal_to_b64_png(arr_norm),
    }


# ─────────────────────────────────────────────────────────────────
# Bundled sample catalog (3 batteries from colleague's test set)
# ─────────────────────────────────────────────────────────────────
SAMPLE_CATALOG = [
    {
        "id": "sample1",
        "label": "Battery #1 — Rooftop array",
        "site": "Site A",
        "description": "Recently commissioned, expected near-perfect health.",
        "icon_hint": "🟢",
        "_files": {
            "npy": "sample1.npy",
            "features": "sample1_features.json",
            "expected": "sample1_expected.json",
        },
    },
    {
        "id": "sample2",
        "label": "Battery #2 — Office annex",
        "site": "Site B",
        "description": "Mid-life unit, showing early signs of capacity fade.",
        "icon_hint": "🟡",
        "_files": {
            "npy": "sample2.npy",
            "features": "sample2.json",
            "expected": "sample2expected.json",
        },
    },
    {
        "id": "sample3",
        "label": "Battery #3 — Storage facility",
        "site": "Site C",
        "description": "End-of-life approaching, significant degradation expected.",
        "icon_hint": "🔴",
        "_files": {
            "npy": "sample3.npy",
            "features": "sample3.json",
            "expected": "sample3expected.json",
        },
    },
]


def list_battery_samples() -> list[dict]:
    """Public sample listing (without the internal _files mapping)."""
    out = []
    for s in SAMPLE_CATALOG:
        files = s["_files"]
        npy_present = (BATTERY_SAMPLES_DIR / files["npy"]).exists()
        out.append({
            "id": s["id"],
            "label": s["label"],
            "site": s["site"],
            "description": s["description"],
            "icon_hint": s["icon_hint"],
            "available": npy_present,
        })
    return out


def predict_sample(sample_id: str = "sample1") -> dict[str, Any]:
    """Run prediction on a bundled sample (thermal .npy + features JSON)."""
    entry = next((s for s in SAMPLE_CATALOG if s["id"] == sample_id), None)
    if entry is None:
        raise FileNotFoundError(f"Unknown battery sample id: {sample_id}")

    files = entry["_files"]
    npy_path = BATTERY_SAMPLES_DIR / files["npy"]
    feat_path = BATTERY_SAMPLES_DIR / files["features"]
    expected_path = BATTERY_SAMPLES_DIR / files["expected"]

    if not npy_path.exists() or not feat_path.exists():
        raise FileNotFoundError(
            f"Sample files missing for {sample_id} in {BATTERY_SAMPLES_DIR}"
        )

    image_bytes = npy_path.read_bytes()
    features = json.loads(feat_path.read_text())
    result = predict_battery_soh(image_bytes, files["npy"], features)

    if expected_path.exists():
        try:
            exp = json.loads(expected_path.read_text())
            result["expected_soh"] = exp.get("SoH_true")
        except Exception:
            pass

    result["source"] = sample_id
    result["label"] = entry["label"]
    result["site"] = entry["site"]
    return result
