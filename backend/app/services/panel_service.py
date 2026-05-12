"""Panel Inspection service — combines 3 models from the EL pipeline.

Step 1 — Binary classification (MobileNetV3, module 04)
        → healthy vs defect (argmax)
Step 2 — Multi-class defect type (EfficientNet, module 05)
        → 6 defect types (only if defective)
Step 3 — Defect localization (Swin-T + GradCAM, module 03)
        → activation heatmap overlay (only if defective)

Models are TorchScript (.pt) for #04 and #05, and a state_dict (.pth) for #03
which requires the timm SwinClassifier architecture to be rebuilt.
"""
from __future__ import annotations
import io
import json
import base64
from typing import Any

import numpy as np
import cv2
import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import transforms
from PIL import Image

from ..config import (
    PANEL_BINARY_MODEL, PANEL_BINARY_META,
    PANEL_MULTICLASS_MODEL, PANEL_MULTICLASS_META,
    PANEL_DETECTION_MODEL, PANEL_DETECTION_META,
)

DEVICE = torch.device("cpu")  # demo runs on CPU — switch to "cuda" if available


# ─────────────────────────────────────────────────────────────────
# Lazy-loaded singletons
# ─────────────────────────────────────────────────────────────────
_binary_model = None
_binary_meta: dict | None = None
_multiclass_model = None
_multiclass_meta: dict | None = None
_detection_model = None
_detection_meta: dict | None = None


def _load_meta(path) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _load_torchscript(path):
    return torch.jit.load(str(path), map_location=DEVICE).eval()


def get_binary():
    global _binary_model, _binary_meta
    if _binary_model is None:
        _binary_model = _load_torchscript(PANEL_BINARY_MODEL)
        _binary_meta = _load_meta(PANEL_BINARY_META)
    return _binary_model, _binary_meta


def get_multiclass():
    global _multiclass_model, _multiclass_meta
    if _multiclass_model is None:
        _multiclass_model = _load_torchscript(PANEL_MULTICLASS_MODEL)
        _multiclass_meta = _load_meta(PANEL_MULTICLASS_META)
    return _multiclass_model, _multiclass_meta


# ─────────────────────────────────────────────────────────────────
# Module 03 — Swin-T architecture (rebuilt to load state_dict)
# ─────────────────────────────────────────────────────────────────
class SwinClassifier(nn.Module):
    """Reproduces the architecture from `runTesteSamples.py` (bloc_E)."""
    def __init__(self):
        super().__init__()
        import timm
        self.backbone = timm.create_model(
            "swin_tiny_patch4_window7_224",
            pretrained=False,
            num_classes=0,
            drop_rate=0.10,
            drop_path_rate=0.05,
        )
        in_features = self.backbone.num_features
        self.head = nn.Sequential(
            nn.LayerNorm(in_features),
            nn.Dropout(p=0.20),
            nn.Linear(in_features, 256),
            nn.GELU(),
            nn.Dropout(p=0.10),
            nn.Linear(256, 2),
        )

    def forward(self, x):
        return self.head(self.backbone(x))


def get_detection():
    global _detection_model, _detection_meta
    if _detection_model is None:
        model = SwinClassifier()
        state = torch.load(str(PANEL_DETECTION_MODEL), map_location=DEVICE)
        model.load_state_dict(state)
        model.to(DEVICE).eval()
        _detection_model = model
        _detection_meta = _load_meta(PANEL_DETECTION_META)
    return _detection_model, _detection_meta


# ─────────────────────────────────────────────────────────────────
# Preprocessing — one transform per model
# ─────────────────────────────────────────────────────────────────
# Module 04 — MobileNetV3 (gray-EL specific stats)
_BIN_MEAN = [0.5197755694389343] * 3
_BIN_STD = [0.16127821803092957] * 3
_binary_transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=_BIN_MEAN, std=_BIN_STD),
])

# Module 05 — EfficientNet (no normalization — just ToTensor)
_multiclass_transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
])

# Module 03 — Swin-T (ImageNet normalization)
_IMAGENET_MEAN = [0.485, 0.456, 0.406]
_IMAGENET_STD = [0.229, 0.224, 0.225]
_detection_transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=_IMAGENET_MEAN, std=_IMAGENET_STD),
])


def _open_image(image_bytes: bytes) -> Image.Image:
    return Image.open(io.BytesIO(image_bytes)).convert("RGB")


# ─────────────────────────────────────────────────────────────────
# Step 1 — Binary classification
# ─────────────────────────────────────────────────────────────────
def predict_binary(img: Image.Image) -> dict:
    model, meta = get_binary()
    classes = meta["classes"]   # ['defect', 'healthy']
    tensor = _binary_transform(img).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        logits = model(tensor)
        probs = F.softmax(logits, dim=1)[0]
    idx = int(probs.argmax().item())
    return {
        "class_index": idx,
        "class_name": classes[idx],
        "confidence": round(float(probs[idx].item()), 4),
        "prob_defect": round(float(probs[classes.index("defect")].item()), 4),
        "prob_healthy": round(float(probs[classes.index("healthy")].item()), 4),
    }


# ─────────────────────────────────────────────────────────────────
# Step 2 — Multi-class defect type
# ─────────────────────────────────────────────────────────────────
def predict_multiclass(img: Image.Image) -> dict:
    model, meta = get_multiclass()
    classes = meta["classes"]   # 6 defect types
    tensor = _multiclass_transform(img).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        logits = model(tensor)
        probs = F.softmax(logits, dim=1)[0]
    idx = int(probs.argmax().item())
    # Top-3 ranking for explainability
    top_k = torch.topk(probs, k=min(3, len(classes)))
    top_list = [
        {"class": classes[int(i)], "prob": round(float(p), 4)}
        for p, i in zip(top_k.values.tolist(), top_k.indices.tolist())
    ]
    return {
        "class_index": idx,
        "class_name": classes[idx],
        "confidence": round(float(probs[idx].item()), 4),
        "top3": top_list,
    }


# ─────────────────────────────────────────────────────────────────
# Step 3 — Localization via GradCAM on Swin-T
# ─────────────────────────────────────────────────────────────────
def _swin_gradcam(model, tensor: torch.Tensor, target_class: int = 1) -> np.ndarray:
    """Compute GradCAM heatmap for the Swin-T classifier on `target_class`.

    We hook into `model.backbone.norm` (the last LayerNorm in the Swin stack),
    which gives us a feature map suitable for CAM-style aggregation.
    Returns a (H, W) heatmap normalized in [0, 1].
    """
    activations = {}
    gradients = {}

    def fwd_hook(module, inp, out):
        activations["v"] = out

    def bwd_hook(module, grad_in, grad_out):
        gradients["v"] = grad_out[0]

    target_layer = model.backbone.norm
    fh = target_layer.register_forward_hook(fwd_hook)
    bh = target_layer.register_full_backward_hook(bwd_hook)

    try:
        tensor = tensor.clone().detach().requires_grad_(True)
        logits = model(tensor)               # [1, 2]
        score = logits[0, target_class]
        model.zero_grad()
        score.backward()

        act = activations["v"]               # shape depends on Swin version
        grad = gradients["v"]
    finally:
        fh.remove()
        bh.remove()

    # Swin returns tokens of shape [B, H*W, C] or [B, H, W, C]; normalize to [B, C, H, W]
    if act.dim() == 3:
        # [B, N, C] → reshape to [B, h, w, C] (h=w=sqrt(N))
        b, n, c = act.shape
        h = int(round(n ** 0.5))
        act = act.view(b, h, h, c).permute(0, 3, 1, 2)        # [B, C, H, W]
        grad = grad.view(b, h, h, c).permute(0, 3, 1, 2)
    elif act.dim() == 4 and act.shape[-1] != act.shape[1]:
        # [B, H, W, C] (channels-last) → [B, C, H, W]
        act = act.permute(0, 3, 1, 2)
        grad = grad.permute(0, 3, 1, 2)

    weights = grad.mean(dim=(2, 3), keepdim=True)                # [B, C, 1, 1]
    cam = (weights * act).sum(dim=1, keepdim=False)              # [B, H, W]
    cam = F.relu(cam)
    cam = cam[0].detach().cpu().numpy()

    if cam.max() > 0:
        cam = cam / cam.max()
    return cam.astype(np.float32)


def localize_defect(img: Image.Image) -> dict:
    """Run Swin-T classifier + GradCAM. Returns probability + heatmap overlay."""
    model, meta = get_detection()
    threshold = meta.get("decision_pipeline", {}).get("threshold", 0.28)
    classes = meta["classes"]   # ['healthy', 'defective']

    tensor = _detection_transform(img).unsqueeze(0).to(DEVICE)

    # Forward (no grad) for probabilities
    with torch.no_grad():
        logits = model(tensor)
        probs = F.softmax(logits, dim=1)[0]
    prob_defect = float(probs[1].item())
    label = "defective" if prob_defect >= threshold else "healthy"

    # GradCAM on the defect class
    cam = _swin_gradcam(model, tensor, target_class=1)

    # Resize CAM to 224×224 (display size)
    cam_resized = cv2.resize(cam, (224, 224), interpolation=cv2.INTER_CUBIC)

    return {
        "label": label,
        "prob_defect": round(prob_defect, 4),
        "prob_healthy": round(float(probs[0].item()), 4),
        "threshold": threshold,
        "heatmap": cam_resized,           # numpy (H, W) for caller to render
    }


# ─────────────────────────────────────────────────────────────────
# Image rendering helpers
# ─────────────────────────────────────────────────────────────────
def _np_to_b64_png(arr: np.ndarray) -> str:
    if arr.ndim == 2:
        img = Image.fromarray(arr, mode="L")
    else:
        img = Image.fromarray(arr, mode="RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _heatmap_overlay(pil_img: Image.Image, heatmap: np.ndarray, alpha: float = 0.45) -> str:
    """Overlay a JET colormap heatmap on top of the original image."""
    base = np.array(pil_img.resize((224, 224)).convert("RGB"))
    hm = np.clip(heatmap, 0, 1)
    hm_u8 = (hm * 255).astype(np.uint8)
    colored = cv2.applyColorMap(hm_u8, cv2.COLORMAP_JET)
    colored = cv2.cvtColor(colored, cv2.COLOR_BGR2RGB)
    overlay = (base * (1 - alpha) + colored * alpha).clip(0, 255).astype(np.uint8)
    return _np_to_b64_png(overlay)


def _heatmap_to_bbox(heatmap: np.ndarray, threshold: float = 0.5) -> list:
    """Extract bounding boxes from heatmap by thresholding + connected components."""
    binary = (heatmap >= threshold).astype(np.uint8) * 255
    if binary.sum() == 0:
        return []
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    boxes = []
    h, w = heatmap.shape
    min_area = (w * h) * 0.01   # ignore tiny blobs (<1% of image)
    for c in contours:
        x, y, bw, bh = cv2.boundingRect(c)
        if bw * bh >= min_area:
            # Mean activation inside the box = "confidence"
            roi = heatmap[y:y + bh, x:x + bw]
            boxes.append({
                "x": int(x), "y": int(y),
                "w": int(bw), "h": int(bh),
                "score": round(float(roi.mean()), 4),
            })
    boxes.sort(key=lambda b: b["score"], reverse=True)
    return boxes[:5]   # cap at 5 boxes


def _bbox_overlay(pil_img: Image.Image, boxes: list) -> str:
    """Draw red rectangles for each defect bbox."""
    base = np.array(pil_img.resize((224, 224)).convert("RGB"))
    for b in boxes:
        cv2.rectangle(base, (b["x"], b["y"]),
                      (b["x"] + b["w"], b["y"] + b["h"]),
                      (220, 38, 38), 2)
        # score label
        label = f"{b['score']:.2f}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.4, 1)
        cv2.rectangle(base, (b["x"], b["y"] - th - 4),
                      (b["x"] + tw + 4, b["y"]),
                      (220, 38, 38), -1)
        cv2.putText(base, label, (b["x"] + 2, b["y"] - 2),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1, cv2.LINE_AA)
    return _np_to_b64_png(base)


def _format_defect_name(name: str) -> str:
    """black_core → Black core ; horizontal_dislocation → Horizontal dislocation"""
    return name.replace("_", " ").capitalize()


# ─────────────────────────────────────────────────────────────────
# Public API — full inspection pipeline
# ─────────────────────────────────────────────────────────────────
def inspect_panel(image_bytes: bytes) -> dict[str, Any]:
    """Run the full 3-step Panel Inspection pipeline.

    Step 1 always runs. Steps 2 & 3 only run if the panel is classified
    as defective by Step 1.
    """
    img = _open_image(image_bytes)
    original_b64 = _np_to_b64_png(np.array(img.resize((224, 224))))

    # ── Step 1 — Binary
    binary = predict_binary(img)
    is_defective = (binary["class_name"] == "defect")

    result = {
        "panel_status": "Defective" if is_defective else "Healthy",
        "step1_binary": {
            "label": binary["class_name"],
            "confidence_pct": round(binary["confidence"] * 100, 1),
            "prob_defect": binary["prob_defect"],
            "prob_healthy": binary["prob_healthy"],
        },
        "step2_defect_type": None,
        "step3_localization": None,
        "images": {
            "original": original_b64,
            "heatmap": None,
            "bboxes": None,
        },
        "recommendation": "",
    }

    if not is_defective:
        result["recommendation"] = (
            "Panel is in good condition. No defects detected. "
            "Continue normal operation and schedule next inspection in 6 months."
        )
        return result

    # ── Step 2 — Multi-class defect type
    multi = predict_multiclass(img)
    result["step2_defect_type"] = {
        "defect_type": multi["class_name"],
        "defect_type_pretty": _format_defect_name(multi["class_name"]),
        "confidence_pct": round(multi["confidence"] * 100, 1),
        "top3": [
            {"name": _format_defect_name(t["class"]), "prob_pct": round(t["prob"] * 100, 1)}
            for t in multi["top3"]
        ],
    }

    # ── Step 3 — GradCAM localization
    try:
        det = localize_defect(img)
        boxes = _heatmap_to_bbox(det["heatmap"], threshold=0.5)
        result["step3_localization"] = {
            "n_regions": len(boxes),
            "regions": boxes,
            "swin_prob_defect": det["prob_defect"],
            "swin_threshold": det["threshold"],
        }
        result["images"]["heatmap"] = _heatmap_overlay(img, det["heatmap"])
        result["images"]["bboxes"] = _bbox_overlay(img, boxes)
    except Exception as e:
        # If Swin-T fails (architecture mismatch, etc.), don't crash the whole inspection
        result["step3_localization"] = {"error": f"GradCAM failed: {e}"}

    # Severity heuristic
    severity = "High" if multi["confidence"] > 0.9 else "Medium" if multi["confidence"] > 0.6 else "Low"

    result["recommendation"] = (
        f"Panel is defective. Detected defect type: "
        f"{_format_defect_name(multi['class_name'])} "
        f"(confidence {multi['confidence']*100:.1f}%, severity {severity}). "
        f"A maintenance inspection is recommended within 30 days."
    )
    result["severity"] = severity

    return result
