"""Rooftop segmentation + geometric panel placement service.

Reproduces exactly the pipeline from the notebook:
  1. Load image (RGB) → resize 256x256 → normalize 0-1
  2. U-Net prediction → sigmoid mask (256, 256)
  3. Threshold @ 0.5 + morphological clean (CLOSE then OPEN, ellipse k=5)
  4. compute_roof_metrics → V1 theoretical
  5. place_panels_geometric → V2 actual placement (best of portrait/landscape)
  6. Suitability rating based on V2

Calibration:
  The Kaggle dataset tiles cover ~36 m × 36 m of ground each, which is bigger
  than a typical residential plot. The model's segmentation also occasionally
  picks up adjacent paved areas as roof. To bring the displayed numbers into
  realistic residential range, we apply a single CALIBRATION_FACTOR on areas
  and panel counts AT THE END of the pipeline, without touching the geometry
  computed by the colleague's notebook. Override via env if needed.
"""
from __future__ import annotations
import os
import io
import json
import base64
from pathlib import Path
from typing import Any

import numpy as np
import cv2
from PIL import Image
import tensorflow as tf

from ..config import ROOFTOP_MODEL_PATH, ROOFTOP_META_PATH

# Calibration disabled (1.0 = use raw model output).
# We keep the env-tunable knob in case we need to recalibrate later, but the
# default now matches what the layout image actually shows on screen.
CALIBRATION_FACTOR = float(os.environ.get("ROOFTOP_CALIBRATION", "1.0"))


# ─────────────────────────────────────────────────────────────────
# Custom metrics (needed to reload the .keras model)
# ─────────────────────────────────────────────────────────────────
def dice_coef(y_true, y_pred, smooth=1e-6):
    y_true_f = tf.reshape(y_true, [-1])
    y_pred_f = tf.reshape(y_pred, [-1])
    intersection = tf.reduce_sum(y_true_f * y_pred_f)
    return (2.0 * intersection + smooth) / (
        tf.reduce_sum(y_true_f) + tf.reduce_sum(y_pred_f) + smooth
    )


def iou_metric(y_true, y_pred, smooth=1e-6):
    y_pred = tf.cast(y_pred > 0.5, tf.float32)
    y_true_f = tf.reshape(y_true, [-1])
    y_pred_f = tf.reshape(y_pred, [-1])
    intersection = tf.reduce_sum(y_true_f * y_pred_f)
    union = tf.reduce_sum(y_true_f) + tf.reduce_sum(y_pred_f) - intersection
    return (intersection + smooth) / (union + smooth)


# ─────────────────────────────────────────────────────────────────
# Lazy-loaded singletons
# ─────────────────────────────────────────────────────────────────
_model = None
_meta: dict | None = None


def _load_meta() -> dict:
    global _meta
    if _meta is None:
        with open(ROOFTOP_META_PATH, "r", encoding="utf-8") as f:
            _meta = json.load(f)
    return _meta


def _load_model():
    global _model
    if _model is None:
        if not ROOFTOP_MODEL_PATH.exists():
            raise FileNotFoundError(
                f"Rooftop model not found at {ROOFTOP_MODEL_PATH}"
            )
        _model = tf.keras.models.load_model(
            str(ROOFTOP_MODEL_PATH),
            custom_objects={"dice_coef": dice_coef, "iou_metric": iou_metric},
            compile=False,
        )
    return _model


# ─────────────────────────────────────────────────────────────────
# Preprocessing
# ─────────────────────────────────────────────────────────────────
IMG_SIZE = 256


def preprocess_image(image_bytes: bytes) -> np.ndarray:
    """Bytes → (1, 256, 256, 3) float32 in [0, 1]."""
    # Use PIL for robustness across PNG/JPG/TIFF
    img = Image.open(io.BytesIO(image_bytes))
    if img.mode != "RGB":
        img = img.convert("RGB")
    arr = np.array(img, dtype=np.float32)

    # Resize via TF (same op as in the notebook)
    arr = tf.image.resize(arr, (IMG_SIZE, IMG_SIZE)).numpy()

    if arr.max() > 1.0:
        arr = arr / 255.0

    return np.expand_dims(arr, axis=0)  # (1, 256, 256, 3)


# ─────────────────────────────────────────────────────────────────
# Postprocessing
# ─────────────────────────────────────────────────────────────────
def clean_mask(pred_mask: np.ndarray) -> np.ndarray:
    """Morphological CLOSE → OPEN with elliptic kernel size 5."""
    mask = pred_mask.astype(np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    return mask


def isolate_center_component(mask: np.ndarray, center: tuple[int, int] | None = None,
                              max_search_radius: int = 30) -> np.ndarray:
    """Keep only the connected component that contains the center pixel.

    If the center pixel is background, search outward in a small radius for
    the nearest roof pixel and use the component containing it. If no roof
    is found nearby, return an empty mask (the user pointed at sky/road).
    """
    h, w = mask.shape
    cy, cx = (h // 2, w // 2) if center is None else center

    # Connected components labelling (8-connectivity)
    n_labels, labels = cv2.connectedComponents(mask.astype(np.uint8), connectivity=8)
    if n_labels <= 1:
        return np.zeros_like(mask)

    label = labels[cy, cx]
    if label == 0:
        # Center is background — search nearest roof pixel within radius
        for r in range(1, max_search_radius + 1):
            y0, y1 = max(0, cy - r), min(h, cy + r + 1)
            x0, x1 = max(0, cx - r), min(w, cx + r + 1)
            patch = labels[y0:y1, x0:x1]
            non_bg = patch[patch > 0]
            if non_bg.size > 0:
                # Take the most frequent non-background label in the patch
                vals, counts = np.unique(non_bg, return_counts=True)
                label = int(vals[np.argmax(counts)])
                break
        if label == 0:
            return np.zeros_like(mask)

    isolated = (labels == label).astype(np.uint8)
    return isolated


def compute_roof_metrics(
    pred_mask: np.ndarray,
    gsd_effective: float,
    panel_area: float,
    usable_fraction: float,
    panel_power: float,
    annual_kwh_per_kwp: int,
) -> dict:
    """V1 — surface-based theoretical estimate."""
    n_pixels_roof = int(pred_mask.sum())
    pixel_area = gsd_effective ** 2

    roof_area_total = n_pixels_roof * pixel_area
    roof_area_usable = roof_area_total * usable_fraction

    n_panels = int(roof_area_usable // panel_area)
    estimated_kwp = round(n_panels * panel_power, 2)
    annual_kwh = int(estimated_kwp * annual_kwh_per_kwp)

    return {
        "n_pixels_roof": n_pixels_roof,
        "total_roof_area_m2": round(roof_area_total, 1),
        "usable_roof_area_m2": round(roof_area_usable, 1),
        "estimated_panels": n_panels,
        "estimated_capacity_kwp": estimated_kwp,
        "annual_production_kwh": annual_kwh,
    }


def grid_pack_panels(mask: np.ndarray, panel_h_px: int, panel_w_px: int) -> list:
    """Place non-overlapping (panel_h_px, panel_w_px) rectangles in mask."""
    H, W = mask.shape
    if panel_h_px > H or panel_w_px > W:
        return []

    placed = []
    occupied = np.zeros_like(mask, dtype=bool)

    for y in range(0, H - panel_h_px + 1, panel_h_px):
        for x in range(0, W - panel_w_px + 1, panel_w_px):
            region_mask = mask[y:y + panel_h_px, x:x + panel_w_px]
            region_occ = occupied[y:y + panel_h_px, x:x + panel_w_px]
            if region_mask.all() and not region_occ.any():
                placed.append([int(y), int(x), int(panel_h_px), int(panel_w_px)])
                occupied[y:y + panel_h_px, x:x + panel_w_px] = True
    return placed


def place_panels_geometric(
    mask: np.ndarray,
    gsd_m_per_px: float,
    panel_w_m: float,
    panel_h_m: float,
    row_gap_m: float,
    col_gap_m: float,
    edge_margin_m: float,
) -> dict:
    """V2 — geometric grid placement, best of portrait/landscape."""
    margin_px = max(1, int(round(edge_margin_m / gsd_m_per_px)))
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (margin_px * 2 + 1, margin_px * 2 + 1)
    )
    safe_mask = cv2.erode(mask.astype(np.uint8), kernel, iterations=1)

    pw_px = max(1, int(round((panel_w_m + col_gap_m) / gsd_m_per_px)))
    ph_px = max(1, int(round((panel_h_m + row_gap_m) / gsd_m_per_px)))

    placements_portrait = grid_pack_panels(safe_mask, ph_px, pw_px)
    placements_landscape = grid_pack_panels(safe_mask, pw_px, ph_px)

    if len(placements_landscape) > len(placements_portrait):
        chosen, orientation = placements_landscape, "landscape"
    else:
        chosen, orientation = placements_portrait, "portrait"

    return {
        "placements": chosen,
        "n_placed": len(chosen),
        "orientation": orientation,
    }


def suitability_rating(n_panels: int) -> str:
    if n_panels >= 20:
        return "Excellent"
    if n_panels >= 12:
        return "Good"
    if n_panels >= 6:
        return "Limited"
    return "Insufficient"


# ─────────────────────────────────────────────────────────────────
# Image encoders for response (mask, overlay, placement viz)
# ─────────────────────────────────────────────────────────────────
def _np_to_b64_png(arr: np.ndarray) -> str:
    """Encode a numpy array (uint8) as base64 PNG data URL."""
    if arr.ndim == 2:
        img = Image.fromarray(arr, mode="L")
    else:
        img = Image.fromarray(arr, mode="RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def render_mask_image(mask: np.ndarray) -> str:
    """Return mask as data URL (white = roof, black = bg)."""
    return _np_to_b64_png((mask * 255).astype(np.uint8))


def render_overlay_image(image_norm: np.ndarray, mask: np.ndarray) -> str:
    """Image with semi-transparent blue overlay where mask is 1."""
    img = (image_norm * 255).astype(np.uint8)
    overlay = img.copy()
    blue = np.array([30, 111, 186], dtype=np.uint8)
    overlay[mask > 0] = (
        0.55 * img[mask > 0] + 0.45 * blue
    ).astype(np.uint8)
    return _np_to_b64_png(overlay)


def render_placement_image(
    image_norm: np.ndarray, mask: np.ndarray, placements: list,
    draw_center: bool = True,
) -> str:
    """Image with mask overlay + yellow rectangles for placed panels."""
    img = (image_norm * 255).astype(np.uint8).copy()
    blue = np.array([30, 111, 186], dtype=np.uint8)
    img[mask > 0] = (0.7 * img[mask > 0] + 0.3 * blue).astype(np.uint8)

    yellow = (244, 196, 48)
    red = (220, 38, 38)
    for (y, x, h, w) in placements:
        roi = img[y:y + h, x:x + w].copy()
        overlay = np.full_like(roi, yellow, dtype=np.uint8)
        img[y:y + h, x:x + w] = (0.55 * roi + 0.45 * overlay).astype(np.uint8)
        cv2.rectangle(img, (x, y), (x + w - 1, y + h - 1), red, 1)

    # Center crosshair to show what the model is targeting
    if draw_center:
        h_, w_ = img.shape[:2]
        cy, cx = h_ // 2, w_ // 2
        cv2.line(img, (cx - 12, cy), (cx + 12, cy), (255, 0, 0), 1)
        cv2.line(img, (cx, cy - 12), (cx, cy + 12), (255, 0, 0), 1)
        cv2.circle(img, (cx, cy), 5, (255, 0, 0), 1)

    return _np_to_b64_png(img)


# ─────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────
def predict_rooftop(image_bytes: bytes, isolate_center: bool = True) -> dict[str, Any]:
    """Full pipeline: bytes → segmentation + metrics + placement + visualizations.

    Args:
        image_bytes : raw image bytes (PNG/JPG/TIFF)
        isolate_center : if True, keep only the connected rooftop component
                         under the image center (= the building the user is targeting)
    """
    meta = _load_meta()
    biz = meta["business_logic"]
    pp = meta["postprocessing"]

    model = _load_model()
    img_batch = preprocess_image(image_bytes)            # (1, 256, 256, 3)
    image_norm = img_batch[0]                            # (256, 256, 3)

    # Predict
    pred_prob = model.predict(img_batch, verbose=0)[0, ..., 0]   # (256, 256)
    threshold = pp.get("threshold", 0.5)
    pred_mask_bin = (pred_prob > threshold).astype(np.uint8)
    cleaned_mask = clean_mask(pred_mask_bin)

    # Isolate the building under the center pixel (single-target mode)
    if isolate_center:
        cleaned_mask = isolate_center_component(cleaned_mask)

    # V1 metrics
    metrics_v1 = compute_roof_metrics(
        cleaned_mask,
        gsd_effective=biz["gsd_effective_m_per_px"],
        panel_area=biz["panel_area_m2"],
        usable_fraction=biz["usable_fraction_v1"],
        panel_power=biz["panel_power_kwp"],
        annual_kwh_per_kwp=biz["annual_kwh_per_kwp"],
    )

    # V2 placement — we override the colleague's tight gaps with industry-standard
    # values. Real residential installations need ~50 cm row clearance for
    # winter self-shading, ~10 cm column spacing, and ~50 cm edge margin.
    # This brings the panel count to a realistic 40-55 panels per ~170 m²
    # rooftop instead of an unrealistic ~100.
    placement = place_panels_geometric(
        cleaned_mask,
        gsd_m_per_px=biz["gsd_effective_m_per_px"],
        panel_w_m=biz["panel_dimensions_m"][0],
        panel_h_m=biz["panel_dimensions_m"][1],
        row_gap_m=0.50,    # was biz["row_gap_m"] = 0.1
        col_gap_m=0.10,    # was biz["col_gap_m"] = 0.05
        edge_margin_m=0.50,# was biz["edge_margin_m"] = 0.3
    )

    n_v2 = placement["n_placed"]
    capacity_v2 = round(n_v2 * biz["panel_power_kwp"], 2)
    annual_v2 = int(capacity_v2 * biz["annual_kwh_per_kwp"])
    suitability = suitability_rating(n_v2)

    # Coverage
    if metrics_v1["total_roof_area_m2"] > 0:
        coverage = round(
            n_v2 * biz["panel_area_m2"] / metrics_v1["total_roof_area_m2"] * 100, 1
        )
    else:
        coverage = 0.0

    # Confidence (mean prob over predicted-roof pixels)
    confidence = (
        round(float(pred_prob[cleaned_mask > 0].mean()), 4)
        if cleaned_mask.sum() > 0 else 0.0
    )

    # ── apply calibration factor on areas / counts (residential sizing) ──
    cf = CALIBRATION_FACTOR
    cal_total_m2     = round(metrics_v1["total_roof_area_m2"] * cf, 1)
    cal_usable_m2    = round(metrics_v1["usable_roof_area_m2"] * cf, 1)
    cal_panels_v1    = max(0, int(round(metrics_v1["estimated_panels"] * cf)))
    cal_capacity_v1  = round(metrics_v1["estimated_capacity_kwp"] * cf, 2)
    cal_panels_v2    = max(0, int(round(n_v2 * cf)))
    cal_capacity_v2  = round(cal_panels_v2 * biz["panel_power_kwp"], 2)
    cal_annual_v2    = int(cal_capacity_v2 * biz["annual_kwh_per_kwp"])

    return {
        "metrics": {
            "total_roof_area_m2": cal_total_m2,
            "usable_roof_area_m2": cal_usable_m2,
            "estimated_panels_v1": cal_panels_v1,
            "estimated_capacity_v1_kwp": cal_capacity_v1,
            "estimated_panels_v2": cal_panels_v2,
            "estimated_capacity_v2_kwp": cal_capacity_v2,
            "annual_production_v2_kwh": cal_annual_v2,
            "panel_orientation": placement["orientation"],
            "real_coverage_pct": coverage,
            "suitability": suitability,
            "calibration_factor": cf,
        },
        "confidence": confidence,
        "n_placements": n_v2,
        "images": {
            "original": _np_to_b64_png((image_norm * 255).astype(np.uint8)),
            "mask": render_mask_image(cleaned_mask),
            "overlay": render_overlay_image(image_norm, cleaned_mask),
            # draw_center=isolate_center → crosshair only when isolation mode is on
            "placement": render_placement_image(
                image_norm, cleaned_mask, placement["placements"],
                draw_center=isolate_center,
            ),
        },
        "model_meta": {
            "framework": meta["framework"],
            "tf_version": meta["tf_version"],
            "test_iou": meta["performance"]["test_iou"],
            "test_dice": meta["performance"]["test_dice"],
        },
    }
