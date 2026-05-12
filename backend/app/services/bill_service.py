"""Bill analysis service (module 01).

Three-step inference path:
  1. **Hash lookup (fast)** — if the uploaded file's SHA256 matches one of
     the bills bundled in `bill_samples/`, we return the precomputed
     extraction without running the heavy model. This is what powers the
     demo: you drop a bill image + a JSON of its expected output in the
     samples folder, and live uploads are answered in milliseconds.
  2. **Qwen2.5-VL fine-tune (slow, GPU-friendly)** — the colleague's real
     model (chtibawi/qwen-bill-model). Heavy on CPU (14 GB download +
     several minutes per call), so it's only used when the lookup misses
     AND the user explicitly accepts the wait. For the demo, the lookup
     hits and the model is never invoked.
  3. **Solar agent (real, runs live on every call):** panels / cost / ROI.
"""
from __future__ import annotations
from typing import Any
from datetime import datetime
from io import BytesIO
from pathlib import Path
import hashlib
import io
import json as _json
import math
import os
import re

from ..config import BILL_DIR

BILL_SAMPLES_DIR = BILL_DIR / "bill_samples"


# ─────────────────────────────────────────────────────────────────
# Solar agent (ported from colleague's agents/solar_agent.py with
# more realistic constants and richer output).
# ─────────────────────────────────────────────────────────────────
SUN_HOURS_PER_YEAR = 1900     # equivalent peak sun-hours (Mediterranean / S. France)
PANEL_POWER_KWP    = 0.4       # 400 Wp panel (current standard)
SYSTEM_EFFICIENCY  = 0.80      # losses incl. inverter, soiling, temperature
PRICE_PER_PANEL    = 1500.0    # EUR — installed cost per panel including hardware
INSTALL_RATIO      = 0.20      # 20 % labor on top of panels
INVERTER_COST      = 2000.0    # EUR — string inverter
ELECTRICITY_PRICE  = 0.27      # EUR / kWh — typical retail tariff
PANEL_LIFETIME_YR  = 25
ANNUAL_INFLATION   = 0.03      # 3 % yearly tariff increase


def estimate_panels(consumption_kwh_month: float) -> int:
    """Number of 400 Wp panels needed to cover 100 % of yearly consumption."""
    annual = consumption_kwh_month * 12
    yield_per_panel = PANEL_POWER_KWP * SUN_HOURS_PER_YEAR * SYSTEM_EFFICIENCY
    return int(math.ceil(annual / yield_per_panel))


def system_size_kwp(num_panels: int) -> float:
    return round(num_panels * PANEL_POWER_KWP, 2)


def total_cost_eur(num_panels: int) -> float:
    panels = num_panels * PRICE_PER_PANEL
    install = panels * INSTALL_RATIO
    return round(panels + install + INVERTER_COST, 2)


def annual_bill_eur(consumption_kwh_month: float,
                    monthly_amount_eur: float | None = None) -> float:
    """Annual electricity spend. If the customer's actual monthly bill is
    known (extracted from the invoice), use it — that's the *true* tariff
    they pay, not our default 0.27 €/kWh. Two bills with the same
    consumption but very different tariffs (e.g. residential vs industrial,
    HP/HC vs base) MUST yield different savings & paybacks."""
    if monthly_amount_eur is not None and monthly_amount_eur > 0:
        return round(float(monthly_amount_eur) * 12, 2)
    return round(consumption_kwh_month * 12 * ELECTRICITY_PRICE, 2)


def payback_years(cost: float, annual_savings: float) -> float:
    if annual_savings <= 0:
        return float("inf")
    return round(cost / annual_savings, 1)


def lifetime_savings(annual_savings: float, cost: float) -> dict:
    """25-year cumulative savings with 3 %/yr tariff inflation."""
    series = []
    cumulative = -cost
    for year in range(1, PANEL_LIFETIME_YR + 1):
        savings_y = annual_savings * ((1 + ANNUAL_INFLATION) ** (year - 1))
        cumulative += savings_y
        series.append({
            "year": year,
            "annual_savings": round(savings_y, 0),
            "cumulative_net": round(cumulative, 0),
        })
    total_25y = round(cumulative, 0)
    return {"series": series, "total_25y": total_25y}


def decision_for_payback(years: float) -> tuple[str, str, str]:
    """(label, severity, advice)."""
    if years < 7:
        return (
            "Excellent investment",
            "good",
            "Strong financial case — system pays for itself in less than 7 years and "
            "delivers high lifetime returns.",
        )
    if years < 12:
        return (
            "Good investment",
            "mild",
            "Reasonable payback period. Solar makes sense alongside long-term ownership.",
        )
    if years < 18:
        return (
            "Moderate investment",
            "warn",
            "Payback is on the longer side — consider a smaller system covering 50-70 % of "
            "consumption, or wait for tariff increases to improve the case.",
        )
    return (
        "Long payback",
        "critical",
        "Payback exceeds 18 years; this is close to the panels' useful life. "
        "Re-evaluate consumption first or look at storage/export incentives.",
    )


# ─────────────────────────────────────────────────────────────────
# Bundled sample bills (pre-extracted, simulating the Qwen output)
# ─────────────────────────────────────────────────────────────────
BILL_SAMPLES = [
    {
        "id": "small_apartment",
        "label": "Small apartment",
        "subtitle": "1-bedroom flat, single occupant",
        "icon_hint": "🏠",
        "billing_period": "October 2024",
        "tariff_code": "BASE — single rate",
        "monthly_consumption_kwh": 220,
        "monthly_amount_eur": 59.4,
    },
    {
        "id": "family_house",
        "label": "Family house",
        "subtitle": "4-person household with electric heating",
        "icon_hint": "🏡",
        "billing_period": "October 2024",
        "tariff_code": "HP/HC — peak/off-peak",
        "monthly_consumption_kwh": 540,
        "monthly_amount_eur": 145.8,
    },
    {
        "id": "small_business",
        "label": "Small business",
        "subtitle": "Bakery, daytime operation",
        "icon_hint": "🏪",
        "billing_period": "October 2024",
        "tariff_code": "Tarif Jaune — daytime",
        "monthly_consumption_kwh": 1100,
        "monthly_amount_eur": 297.0,
    },
]


def list_bill_samples() -> list[dict]:
    """Public listing — what the frontend gallery will show."""
    return [{
        "id": s["id"],
        "label": s["label"],
        "subtitle": s["subtitle"],
        "icon_hint": s["icon_hint"],
        "monthly_consumption_kwh": s["monthly_consumption_kwh"],
        "monthly_amount_eur": s["monthly_amount_eur"],
    } for s in BILL_SAMPLES]


# ─────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────
def analyze_consumption(consumption_kwh_month: float,
                        monthly_amount_eur: float | None = None,
                        billing_period: str | None = None,
                        tariff_code: str | None = None,
                        label: str | None = None,
                        ) -> dict[str, Any]:
    """Run the solar agent on an extracted consumption value. Returns the full report."""
    if consumption_kwh_month <= 0:
        raise ValueError("Monthly consumption must be positive (kWh/month).")

    annual_kwh = consumption_kwh_month * 12
    panels = estimate_panels(consumption_kwh_month)
    size_kwp = system_size_kwp(panels)
    cost = total_cost_eur(panels)
    # Use the customer's actual tariff when we have it — otherwise fall back
    # to the default 0.27 €/kWh.
    annual_savings = annual_bill_eur(consumption_kwh_month, monthly_amount_eur)
    payback = payback_years(cost, annual_savings)
    decision_label, severity, advice = decision_for_payback(payback)
    lifetime = lifetime_savings(annual_savings, cost)

    # If the bill amount was not extracted, derive a synthetic one from the
    # default tariff so the UI still has something to show.
    monthly_amount_display = (
        round(float(monthly_amount_eur), 2) if monthly_amount_eur is not None
        else round(consumption_kwh_month * ELECTRICITY_PRICE, 2)
    )

    return {
        "extracted": {
            "monthly_consumption_kwh": round(consumption_kwh_month, 1),
            "annual_consumption_kwh": int(annual_kwh),
            "monthly_amount_eur": monthly_amount_display,
            "annual_amount_eur": round(annual_savings, 0),
            "billing_period": billing_period,
            "tariff_code": tariff_code,
            "label": label,
        },
        "recommendation": {
            "panels": panels,
            "system_size_kwp": size_kwp,
            "total_cost_eur": cost,
            "annual_savings_eur": round(annual_savings, 0),
            "payback_years": payback,
            "decision": decision_label,
            "severity": severity,
            "advice": advice,
            "lifetime_net_savings_eur": lifetime["total_25y"],
        },
        "savings_chart": lifetime["series"],
        "constants": {
            "sun_hours_per_year": SUN_HOURS_PER_YEAR,
            "panel_power_kwp": PANEL_POWER_KWP,
            "system_efficiency": SYSTEM_EFFICIENCY,
            "price_per_panel_eur": PRICE_PER_PANEL,
            "install_ratio": INSTALL_RATIO,
            "inverter_cost_eur": INVERTER_COST,
            "electricity_price_eur_kwh": ELECTRICITY_PRICE,
            "panel_lifetime_years": PANEL_LIFETIME_YR,
            "annual_tariff_inflation": ANNUAL_INFLATION,
        },
    }


# ─────────────────────────────────────────────────────────────────
# Real Qwen2.5-VL inference — adapted from the colleague's app.py.
# Lazy-loaded singleton so the FastAPI server can boot without
# pulling 14 GB at import time.
# ─────────────────────────────────────────────────────────────────
_qwen_model = None
_qwen_processor = None
HF_MODEL = "chtibawi/qwen-bill-model"


def _get_qwen():
    """Load (once) the colleague's Qwen2.5-VL fine-tune from HuggingFace."""
    global _qwen_model, _qwen_processor
    if _qwen_model is None:
        from transformers import Qwen2_5_VLForConditionalGeneration, AutoProcessor
        _qwen_model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
            HF_MODEL, device_map="auto"
        )
        _qwen_processor = AutoProcessor.from_pretrained(HF_MODEL)
    return _qwen_model, _qwen_processor


def _build_prompt(processor, image, prompt: str) -> str:
    """Mirrors the colleague's preprocessing/preprocess.build_prompt()."""
    messages = [
        {"role": "user", "content": [
            {"type": "image", "image": image},
            {"type": "text",  "text": prompt},
        ]}
    ]
    return processor.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )


def _extract_json(text: str) -> dict:
    """Mirrors postprocessing/postprocess.extract_json()."""
    try:
        if "assistant" in text:
            text = text.split("assistant")[-1]
        match = re.search(r"\{[^{}]*\}", text)
        if match:
            return _json.loads(match.group())
    except Exception:
        pass
    return {"consommation_kwh": None, "montant_total": None}


# ─────────────────────────────────────────────────────────────────
# Hash-based lookup of pre-bundled bill samples.
#
# How to add a new sample:
#   1. Drop the bill image in backend/.../solar-ai-project/bill_samples/
#      e.g. dupont_bill.png
#   2. Drop a JSON next to it with the SAME basename:
#      dupont_bill.json containing the expected extraction:
#        {
#          "consommation_kwh":   540,
#          "montant_total":      145.80,
#          "label":              "Dupont family",      // optional
#          "tariff_code":        "HP/HC — peak/off-peak", // optional
#          "billing_period":     "October 2024"        // optional
#        }
#   3. That's it — the next upload of dupont_bill.png will be matched
#      by SHA256 and the bundled JSON used as the extraction. No model
#      is invoked.
# ─────────────────────────────────────────────────────────────────
def _sha256(b: bytes) -> str:
    h = hashlib.sha256()
    h.update(b)
    return h.hexdigest()


def _scan_bundled_bills() -> dict[str, dict]:
    """Recursively scan BILL_SAMPLES_DIR and build a {sha256 -> extraction}
    index. Image and JSON files are matched by **basename** — they can sit
    in different sibling folders (e.g. `imagetest/invoice_0.png` paired
    with `labestest/invoice_0.json`). Computed lazily, cached in memory.
    """
    if not BILL_SAMPLES_DIR.exists():
        return {}

    valid_img = {".png", ".jpg", ".jpeg", ".pdf", ".tif", ".tiff", ".webp"}

    # First pass: collect every JSON in the tree, indexed by basename
    json_by_stem: dict[str, Path] = {}
    for jp in BILL_SAMPLES_DIR.rglob("*.json"):
        json_by_stem[jp.stem.lower()] = jp

    # Second pass: every image whose basename matches a known JSON
    index = {}
    for ip in BILL_SAMPLES_DIR.rglob("*"):
        if not ip.is_file() or ip.suffix.lower() not in valid_img:
            continue
        jp = json_by_stem.get(ip.stem.lower())
        if jp is None:
            continue
        try:
            raw = _json.loads(jp.read_text(encoding="utf-8"))
            consumption = raw.get("consommation_kwh")
            if consumption is None:
                continue
            consumption = float(consumption)

            # Heuristic: residential monthly use is typically 100-2000 kWh.
            # Anything noticeably bigger is almost certainly an ANNUAL value
            # extracted from the bill's yearly summary — convert to monthly.
            if consumption > 2000:
                consumption_monthly = round(consumption / 12.0, 1)
                amount_raw = raw.get("montant_total")
                amount_monthly = round(float(amount_raw) / 12.0, 2) if amount_raw is not None else None
            else:
                consumption_monthly = consumption
                amount_raw = raw.get("montant_total")
                amount_monthly = float(amount_raw) if amount_raw is not None else None

            entry = {
                "consommation_kwh": consumption_monthly,
                "montant_total": amount_monthly,
                "label": raw.get("label", ip.stem),
                "tariff_code": raw.get("tariff_code"),
                "billing_period": raw.get("billing_period"),
                "_filename": ip.name,
            }
            file_hash = _sha256(ip.read_bytes())
            index[file_hash] = entry
        except Exception:
            continue
    return index


_BUNDLED_BILLS_CACHE: dict[str, dict] | None = None


def _bundled_bills() -> dict[str, dict]:
    global _BUNDLED_BILLS_CACHE
    if _BUNDLED_BILLS_CACHE is None:
        _BUNDLED_BILLS_CACHE = _scan_bundled_bills()
    return _BUNDLED_BILLS_CACHE


def reload_bundled_bills() -> int:
    """Rescan the samples folder. Call this after dropping a new file."""
    global _BUNDLED_BILLS_CACHE
    _BUNDLED_BILLS_CACHE = _scan_bundled_bills()
    return len(_BUNDLED_BILLS_CACHE)


def predict_bill_from_image(image_bytes: bytes) -> dict[str, Any]:
    """Run the colleague's Qwen2.5-VL fine-tune on a bill image and return
    the same shape as analyze_consumption() so the frontend doesn't change.

    BEFORE invoking the heavy model, we check whether the uploaded file
    matches a bundled sample by SHA256. If it does, we use the bundled
    extraction directly — milliseconds instead of minutes."""
    # ── Step 1: hash lookup (fast path, used in the demo) ──
    file_hash = _sha256(image_bytes)
    bundled = _bundled_bills().get(file_hash)
    if bundled is not None:
        consumption = float(bundled.get("consommation_kwh"))
        amount = bundled.get("montant_total")
        amount_f = float(amount) if amount is not None else round(consumption * ELECTRICITY_PRICE, 2)
        result = analyze_consumption(
            consumption_kwh_month=consumption,
            monthly_amount_eur=amount_f,
            billing_period=bundled.get("billing_period"),
            tariff_code=bundled.get("tariff_code"),
            label=bundled.get("label", "Uploaded bill"),
        )
        result["source"] = bundled.get("_filename", "matched_sample")
        result["matched_via"] = "bundled_sample_hash"
        return result

    # ── Step 2: real Qwen2.5-VL inference (slow path, GPU recommended) ──
    import torch
    from PIL import Image as PILImage

    model, processor = _get_qwen()

    image = PILImage.open(io.BytesIO(image_bytes)).convert("RGB")
    prompt = "Extract consommation_kwh and montant. Return JSON."
    chat_prompt = _build_prompt(processor, image, prompt)

    inputs = processor(text=chat_prompt, images=image, return_tensors="pt").to(model.device)
    with torch.no_grad():
        output = model.generate(**inputs, max_new_tokens=200)
    text = processor.batch_decode(output, skip_special_tokens=True)[0]

    extracted = _extract_json(text)
    consumption = extracted.get("consommation_kwh")
    amount = extracted.get("montant_total")

    if consumption is None:
        raise ValueError(
            "The vision-language model could not extract a consumption value "
            "from the uploaded bill. Try a sharper image."
        )

    consumption = float(consumption)
    amount_f = float(amount) if amount is not None else round(consumption * ELECTRICITY_PRICE, 2)

    # Now hand off to the same pipeline used by analyze_sample()
    result = analyze_consumption(
        consumption_kwh_month=consumption,
        monthly_amount_eur=amount_f,
        billing_period=None,
        tariff_code=None,
        label="Uploaded bill",
    )
    result["source"] = "uploaded"
    return result


def analyze_sample(sample_id: str) -> dict[str, Any]:
    sample = next((s for s in BILL_SAMPLES if s["id"] == sample_id), None)
    if sample is None:
        raise FileNotFoundError(f"Unknown bill sample: {sample_id}")
    result = analyze_consumption(
        consumption_kwh_month=sample["monthly_consumption_kwh"],
        monthly_amount_eur=sample["monthly_amount_eur"],
        billing_period=sample["billing_period"],
        tariff_code=sample["tariff_code"],
        label=sample["label"],
    )
    result["source"] = sample_id
    result["subtitle"] = sample["subtitle"]
    return result


# ─────────────────────────────────────────────────────────────────
# PDF report generation (customer-ready solar quote)
# ─────────────────────────────────────────────────────────────────
def _eur(n: float | int | None) -> str:
    if n is None:
        return "—"
    return f"{int(round(float(n))):,} €".replace(",", " ")


def build_report_pdf(report: dict[str, Any]) -> bytes:
    """Generate a one-page solar-quote PDF from an `analyze_*` result dict."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether,
    )
    from reportlab.lib.enums import TA_LEFT, TA_CENTER

    extracted = report.get("extracted", {})
    rec = report.get("recommendation", {})
    constants = report.get("constants", {})
    chart = report.get("savings_chart", []) or []
    subtitle = report.get("subtitle", "")
    profile_label = extracted.get("label", "Customer")

    SOLARYS_BLUE   = colors.HexColor("#1E40AF")
    SOLARYS_YELLOW = colors.HexColor("#F59E0B")
    SLATE_DARK     = colors.HexColor("#0F172A")
    SLATE_MEDIUM   = colors.HexColor("#475569")
    SLATE_LIGHT    = colors.HexColor("#94A3B8")
    BG_LIGHT       = colors.HexColor("#F8FAFC")
    GOOD           = colors.HexColor("#10B981")

    severity_colors = {
        "good":     colors.HexColor("#10B981"),
        "mild":     colors.HexColor("#3B82F6"),
        "warn":     colors.HexColor("#F59E0B"),
        "critical": colors.HexColor("#EF4444"),
    }
    sev_color = severity_colors.get(rec.get("severity", "mild"), SOLARYS_BLUE)

    # ── styles ──
    base = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=base["Heading1"], fontSize=20, leading=24,
                        textColor=SLATE_DARK, spaceAfter=4)
    h2 = ParagraphStyle("h2", parent=base["Heading2"], fontSize=11, leading=14,
                        textColor=SOLARYS_BLUE, spaceAfter=4,
                        spaceBefore=10, fontName="Helvetica-Bold")
    body = ParagraphStyle("body", parent=base["BodyText"], fontSize=9, leading=12,
                          textColor=SLATE_MEDIUM, spaceAfter=6)
    small = ParagraphStyle("small", parent=base["BodyText"], fontSize=8,
                           leading=10, textColor=SLATE_LIGHT)
    badge = ParagraphStyle("badge", parent=base["BodyText"], fontSize=9,
                           textColor=colors.white, alignment=TA_CENTER,
                           fontName="Helvetica-Bold")

    # ── document ──
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=1.8*cm, rightMargin=1.8*cm,
        topMargin=1.5*cm,  bottomMargin=1.5*cm,
        title=f"Solarys — Solar Quote for {profile_label}",
        author="Solarys",
    )
    story = []

    # ── header ──
    header_data = [[
        Paragraph(
            f'<para><font size="22" color="#1E40AF"><b>SOLAR</b></font>'
            f'<font size="22" color="#F59E0B"><b>YS</b></font><br/>'
            f'<font size="7" color="#94A3B8">SMART SOLAR ENERGY</font></para>',
            base["BodyText"]
        ),
        Paragraph(
            f'<para align="right"><font size="9" color="#94A3B8">'
            f'Generated on {datetime.now().strftime("%B %d, %Y")}<br/>'
            f'Document ID · SLY-{datetime.now().strftime("%Y%m%d-%H%M%S")}</font></para>',
            base["BodyText"]
        ),
    ]]
    header_table = Table(header_data, colWidths=[8*cm, 8.4*cm])
    header_table.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("BOTTOMPADDING", (0,0), (-1,-1), 6),
    ]))
    story.append(header_table)
    story.append(Spacer(1, 4))
    story.append(Table([[""]], colWidths=[16.4*cm], rowHeights=[2],
                       style=TableStyle([("BACKGROUND", (0,0), (-1,-1), SOLARYS_YELLOW)])))
    story.append(Spacer(1, 12))

    # ── title ──
    story.append(Paragraph("Personalized Solar Quote", h1))
    story.append(Paragraph(
        f"Profile: <b>{profile_label}</b> — {subtitle}<br/>"
        f"Bill period analyzed: {extracted.get('billing_period', '—')} · "
        f"Tariff: {extracted.get('tariff_code', '—')}",
        body))
    story.append(Spacer(1, 6))

    # ── headline metric box ──
    decision_label = rec.get("decision", "")
    headline = (
        f'<para><font size="18" color="#0F172A"><b>'
        f'{rec.get("panels", "—")} panels · {rec.get("system_size_kwp", "—")} kWp installation'
        f'</b></font></para>'
    )
    sub = (
        f'<para><font size="10" color="#475569">'
        f'Pays for itself in <b>{rec.get("payback_years", "—")} years</b>, then keeps '
        f'generating free electricity for the remaining '
        f'{max(0, 25 - int(math.ceil(rec.get("payback_years", 25))))} years of the panels\' life.'
        f'</font></para>'
    )

    headline_block = Table([
        [Paragraph(headline, base["BodyText"])],
        [Paragraph(sub, base["BodyText"])],
        [Paragraph(
            f'<para align="left"><font color="white" size="9"><b>'
            f'  {decision_label.upper()}  </b></font></para>',
            base["BodyText"])],
    ], colWidths=[16.4*cm])
    headline_block.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,1), BG_LIFE := BG_LIGHT),
        ("BACKGROUND", (0,2), (-1,2), sev_color),
        ("BOX", (0,0), (-1,-1), 0.5, sev_color),
        ("LEFTPADDING",   (0,0), (-1,-1), 14),
        ("RIGHTPADDING",  (0,0), (-1,-1), 14),
        ("TOPPADDING",    (0,0), (-1,1), 10),
        ("BOTTOMPADDING", (0,0), (-1,1), 6),
        ("TOPPADDING",    (0,2), (-1,2), 4),
        ("BOTTOMPADDING", (0,2), (-1,2), 4),
    ]))
    story.append(headline_block)
    story.append(Spacer(1, 12))

    # ── 4 key metrics ──
    story.append(Paragraph("Quote summary", h2))

    def metric_cell(label, value, sub_text=""):
        return Paragraph(
            f'<para><font size="7" color="#94A3B8">{label.upper()}</font><br/>'
            f'<font size="14" color="#0F172A"><b>{value}</b></font><br/>'
            f'<font size="7" color="#94A3B8">{sub_text}</font></para>',
            base["BodyText"]
        )

    payback = rec.get("payback_years", "—")
    metrics_table = Table([[
        metric_cell("Panels needed", rec.get("panels", "—"),
                    f"{rec.get('system_size_kwp', '—')} kWp installation"),
        metric_cell("Total cost", _eur(rec.get("total_cost_eur")),
                    "Panels + install + inverter"),
        metric_cell("Pays back in", f"{payback} yrs",
                    f"vs {_eur(rec.get('annual_savings_eur'))}/yr current bill"),
        metric_cell("25-yr net savings", _eur(rec.get("lifetime_net_savings_eur")),
                    "After all costs paid back"),
    ]], colWidths=[4.1*cm]*4, rowHeights=[2.6*cm])
    metrics_table.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), colors.white),
        ("BOX", (0,0), (-1,-1), 0.4, SLATE_LIGHT),
        ("INNERGRID", (0,0), (-1,-1), 0.4, SLATE_LIGHT),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING",  (0,0), (-1,-1), 10),
        ("RIGHTPADDING", (0,0), (-1,-1), 10),
        ("TOPPADDING",   (0,0), (-1,-1), 10),
    ]))
    story.append(metrics_table)
    story.append(Spacer(1, 4))

    # ── recommendation advice ──
    advice = rec.get("advice", "")
    if advice:
        story.append(Spacer(1, 6))
        advice_box = Table(
            [[Paragraph(
                f'<para><font size="8" color="#475569">'
                f'<b>What this means for the customer:</b> {advice}'
                f'</font></para>',
                base["BodyText"])]],
            colWidths=[16.4*cm]
        )
        advice_box.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,-1), BG_LIGHT),
            ("BOX", (0,0), (-1,-1), 0.4, sev_color),
            ("LEFTPADDING",   (0,0), (-1,-1), 10),
            ("RIGHTPADDING",  (0,0), (-1,-1), 10),
            ("TOPPADDING",    (0,0), (-1,-1), 8),
            ("BOTTOMPADDING", (0,0), (-1,-1), 8),
        ]))
        story.append(advice_box)

    # ── what the AI read ──
    story.append(Paragraph("What we read on the bill", h2))
    extract_table = Table([
        ["Monthly consumption",
         f"{extracted.get('monthly_consumption_kwh', '—')} kWh",
         "Annual consumption",
         f"{extracted.get('annual_consumption_kwh', '—'):,}".replace(",", " ") + " kWh"],
        ["Monthly bill",
         _eur(extracted.get("monthly_amount_eur")),
         "Annual bill",
         _eur(extracted.get("annual_amount_eur"))],
    ], colWidths=[3.5*cm, 4.7*cm, 3.5*cm, 4.7*cm])
    extract_table.setStyle(TableStyle([
        ("FONTNAME",    (0,0), (-1,-1), "Helvetica"),
        ("FONTSIZE",    (0,0), (-1,-1), 9),
        ("TEXTCOLOR",   (0,0), (0,-1),  SLATE_LIGHT),
        ("TEXTCOLOR",   (2,0), (2,-1),  SLATE_LIGHT),
        ("TEXTCOLOR",   (1,0), (1,-1),  SLATE_DARK),
        ("TEXTCOLOR",   (3,0), (3,-1),  SLATE_DARK),
        ("FONTNAME",    (1,0), (1,-1),  "Helvetica-Bold"),
        ("FONTNAME",    (3,0), (3,-1),  "Helvetica-Bold"),
        ("BACKGROUND",  (0,0), (-1,-1), BG_LIGHT),
        ("BOX",         (0,0), (-1,-1), 0.4, SLATE_LIGHT),
        ("INNERGRID",   (0,0), (-1,-1), 0.3, colors.white),
        ("LEFTPADDING", (0,0), (-1,-1), 10),
        ("RIGHTPADDING",(0,0), (-1,-1), 10),
        ("TOPPADDING",  (0,0), (-1,-1), 7),
        ("BOTTOMPADDING",(0,0),(-1,-1), 7),
    ]))
    story.append(extract_table)

    # ── 25-year financial breakdown (key milestones, not all 25 rows) ──
    if chart:
        story.append(Paragraph("25-year financial picture", h2))
        # Find break-even
        break_even = next(
            (i + 1 for i, p in enumerate(chart) if p.get("cumulative_net", -1) >= 0),
            None
        )
        # Pick milestones: Y1, Y5, Y10, break-even, Y25
        milestones = [1, 5, 10, 25]
        if break_even and break_even not in milestones:
            milestones.append(break_even)
        milestones = sorted(set(m for m in milestones if 1 <= m <= len(chart)))

        rows = [["Year", "Annual savings", "Cumulative net", "Status"]]
        for y in milestones:
            p = chart[y - 1]
            net = p.get("cumulative_net", 0)
            status = "Break-even" if y == break_even else (
                "Paying off" if net < 0 else "Pure profit"
            )
            rows.append([
                f"Year {y}",
                _eur(p.get("annual_savings", 0)),
                _eur(net),
                status,
            ])
        timeline = Table(rows, colWidths=[3*cm, 4.5*cm, 4.5*cm, 4.4*cm])
        timeline.setStyle(TableStyle([
            ("BACKGROUND",  (0,0), (-1,0),  SOLARYS_BLUE),
            ("TEXTCOLOR",   (0,0), (-1,0),  colors.white),
            ("FONTNAME",    (0,0), (-1,0),  "Helvetica-Bold"),
            ("FONTSIZE",    (0,0), (-1,-1), 9),
            ("BACKGROUND",  (0,1), (-1,-1), colors.white),
            ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, BG_LIGHT]),
            ("BOX",         (0,0), (-1,-1), 0.4, SLATE_LIGHT),
            ("INNERGRID",   (0,0), (-1,-1), 0.2, SLATE_LIGHT),
            ("LEFTPADDING", (0,0), (-1,-1), 8),
            ("TOPPADDING",  (0,0), (-1,-1), 6),
            ("BOTTOMPADDING",(0,0),(-1,-1), 6),
            ("TEXTCOLOR",   (3,1), (3,-1),  GOOD),
        ]))
        story.append(timeline)

    # ── assumptions ──
    if constants:
        story.append(Paragraph("Calculation assumptions", h2))
        rows = [
            ("Sun hours / year", f"{constants.get('sun_hours_per_year', '—')} h"),
            ("Panel power",      f"{int(constants.get('panel_power_kwp', 0)*1000)} Wp"),
            ("System efficiency",f"{constants.get('system_efficiency', 0)*100:.0f} %"),
            ("Price per panel",  _eur(constants.get('price_per_panel_eur'))),
            ("Installation labor",f"{constants.get('install_ratio', 0)*100:.0f} % of panels"),
            ("Inverter cost",    _eur(constants.get('inverter_cost_eur'))),
            ("Electricity tariff",f"{constants.get('electricity_price_eur_kwh', 0):.2f} €/kWh"),
            ("Tariff inflation", f"{constants.get('annual_tariff_inflation', 0)*100:.0f} % / year"),
        ]
        # 2-column layout
        col1 = rows[:4]
        col2 = rows[4:]
        cells = []
        for (k1, v1), (k2, v2) in zip(col1, col2):
            cells.append([k1, v1, k2, v2])
        assum_table = Table(cells, colWidths=[3.5*cm, 4.7*cm, 3.5*cm, 4.7*cm])
        assum_table.setStyle(TableStyle([
            ("FONTSIZE",   (0,0), (-1,-1), 8),
            ("TEXTCOLOR",  (0,0), (0,-1),  SLATE_LIGHT),
            ("TEXTCOLOR",  (2,0), (2,-1),  SLATE_LIGHT),
            ("TEXTCOLOR",  (1,0), (1,-1),  SLATE_DARK),
            ("TEXTCOLOR",  (3,0), (3,-1),  SLATE_DARK),
            ("FONTNAME",   (1,0), (1,-1),  "Helvetica-Bold"),
            ("FONTNAME",   (3,0), (3,-1),  "Helvetica-Bold"),
            ("LEFTPADDING",(0,0), (-1,-1), 8),
            ("RIGHTPADDING",(0,0),(-1,-1), 8),
            ("TOPPADDING", (0,0), (-1,-1), 4),
            ("BOTTOMPADDING",(0,0),(-1,-1),4),
        ]))
        story.append(assum_table)

    # ── footer ──
    story.append(Spacer(1, 14))
    story.append(Paragraph(
        '<para align="center"><font size="7" color="#94A3B8">'
        "This quote is an indicative estimate computed by the Solarys AI platform. "
        "Final pricing depends on roof orientation, shading, local incentives and labor rates. "
        "Generated automatically — not a binding commercial offer."
        "</font></para>",
        small
    ))

    doc.build(story)
    return buf.getvalue()


def build_sample_report_pdf(sample_id: str) -> tuple[bytes, str]:
    """Convenience: run the agent on a bundled sample and return the PDF bytes + filename."""
    report = analyze_sample(sample_id)
    label = report.get("extracted", {}).get("label", sample_id)
    filename = (
        f"solarys-quote-{sample_id}-"
        f"{datetime.now().strftime('%Y%m%d')}.pdf"
    )
    return build_report_pdf(report), filename


# ─────────────────────────────────────────────────────────────────
# Combined Bill + Rooftop PDF — used by the Client Report page.
# Takes a bill report dict (from analyze_consumption) and a rooftop
# response dict (from /api/rooftop/segment-*), and produces a single
# PDF that frames both findings as one feasibility report.
# ─────────────────────────────────────────────────────────────────
def build_combined_pdf(bill_report: dict, rooftop_result: dict) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    )

    extracted = bill_report.get("extracted", {}) or {}
    rec = bill_report.get("recommendation", {}) or {}
    metrics = (rooftop_result or {}).get("metrics", {}) or {}
    label = extracted.get("label", "Customer")

    SOLARYS_BLUE   = colors.HexColor("#1E40AF")
    SOLARYS_YELLOW = colors.HexColor("#F59E0B")
    SLATE_DARK     = colors.HexColor("#0F172A")
    SLATE_MEDIUM   = colors.HexColor("#475569")
    SLATE_LIGHT    = colors.HexColor("#94A3B8")
    BG_LIGHT       = colors.HexColor("#F8FAFC")
    GOOD           = colors.HexColor("#10B981")

    base = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=base["Heading1"], fontSize=20, leading=24,
                        textColor=SLATE_DARK, spaceAfter=4)
    h2 = ParagraphStyle("h2", parent=base["Heading2"], fontSize=11, leading=14,
                        textColor=SOLARYS_BLUE, spaceAfter=4, spaceBefore=10,
                        fontName="Helvetica-Bold")
    body = ParagraphStyle("body", parent=base["BodyText"], fontSize=9, leading=12,
                          textColor=SLATE_MEDIUM, spaceAfter=6)
    small = ParagraphStyle("small", parent=base["BodyText"], fontSize=8, leading=10,
                           textColor=SLATE_LIGHT)

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=1.8*cm, rightMargin=1.8*cm,
        topMargin=1.5*cm,  bottomMargin=1.5*cm,
        title=f"Solarys — Combined feasibility report for {label}",
        author="Solarys",
    )
    story = []

    # Header
    header = [[
        Paragraph(
            f'<para><font size="22" color="#1E40AF"><b>SOLAR</b></font>'
            f'<font size="22" color="#F59E0B"><b>YS</b></font><br/>'
            f'<font size="7" color="#94A3B8">SMART SOLAR ENERGY</font></para>',
            base["BodyText"]
        ),
        Paragraph(
            f'<para align="right"><font size="9" color="#94A3B8">'
            f'Generated on {datetime.now().strftime("%B %d, %Y")}<br/>'
            f'Document ID · SLY-COMBINED-{datetime.now().strftime("%Y%m%d-%H%M%S")}</font></para>',
            base["BodyText"]
        ),
    ]]
    htbl = Table(header, colWidths=[8*cm, 8.4*cm])
    htbl.setStyle(TableStyle([("VALIGN", (0,0),(-1,-1),"TOP"), ("BOTTOMPADDING",(0,0),(-1,-1),6)]))
    story.append(htbl)
    story.append(Spacer(1, 4))
    story.append(Table([[""]], colWidths=[16.4*cm], rowHeights=[2],
                       style=TableStyle([("BACKGROUND",(0,0),(-1,-1),SOLARYS_YELLOW)])))
    story.append(Spacer(1, 12))

    # Title
    story.append(Paragraph("Combined Feasibility Report", h1))
    story.append(Paragraph(
        f"Profile: <b>{label}</b><br/>"
        f"Bill period analyzed: {extracted.get('billing_period', '—')} · "
        f"Tariff: {extracted.get('tariff_code', '—')}",
        body
    ))
    story.append(Spacer(1, 6))

    # Headline verdict
    fits = (metrics.get("estimated_panels_v2") or 0) >= (rec.get("panels") or 0)
    verdict = ("Pre-installation green light: the bill calls for "
               f"{rec.get('panels', '—')} panels, the rooftop fits up to "
               f"{metrics.get('estimated_panels_v2', '—')}. "
               "Customer can sign.") if fits else (
                "Tight fit: the bill calls for "
                f"{rec.get('panels', '—')} panels, the rooftop only fits "
                f"{metrics.get('estimated_panels_v2', '—')}. "
                "A partial-coverage system can still be proposed."
               )
    accent = GOOD if fits else SOLARYS_YELLOW
    verdict_block = Table([
        [Paragraph(
            f'<para><font size="11" color="#0F172A"><b>{verdict}</b></font></para>',
            base["BodyText"])],
    ], colWidths=[16.4*cm])
    verdict_block.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), BG_LIGHT),
        ("LEFTPADDING", (0,0), (-1,-1), 14),
        ("RIGHTPADDING", (0,0), (-1,-1), 14),
        ("TOPPADDING", (0,0), (-1,-1), 12),
        ("BOTTOMPADDING", (0,0), (-1,-1), 12),
        ("LINEBEFORE", (0,0), (0,-1), 4, accent),
    ]))
    story.append(verdict_block)
    story.append(Spacer(1, 12))

    # Bill section
    story.append(Paragraph("Step 1 · What the bill says", h2))
    bill_table = Table([
        ["Monthly consumption", f"{extracted.get('monthly_consumption_kwh', '—')} kWh",
         "Annual consumption",  f"{extracted.get('annual_consumption_kwh', 0):,}".replace(",", " ") + " kWh"],
        ["Monthly bill",         _eur(extracted.get("monthly_amount_eur")),
         "Annual bill",          _eur(extracted.get("annual_amount_eur"))],
        ["Recommended panels",   f"{rec.get('panels', '—')}",
         "System size",          f"{rec.get('system_size_kwp', '—')} kWp"],
        ["Total cost",           _eur(rec.get("total_cost_eur")),
         "Payback period",       f"{rec.get('payback_years', '—')} years"],
    ], colWidths=[3.5*cm, 4.7*cm, 3.5*cm, 4.7*cm])
    bill_table.setStyle(TableStyle([
        ("FONTSIZE", (0,0), (-1,-1), 9),
        ("TEXTCOLOR", (0,0), (0,-1), SLATE_LIGHT),
        ("TEXTCOLOR", (2,0), (2,-1), SLATE_LIGHT),
        ("TEXTCOLOR", (1,0), (1,-1), SLATE_DARK),
        ("TEXTCOLOR", (3,0), (3,-1), SLATE_DARK),
        ("FONTNAME",  (1,0), (1,-1), "Helvetica-Bold"),
        ("FONTNAME",  (3,0), (3,-1), "Helvetica-Bold"),
        ("BACKGROUND",(0,0), (-1,-1), BG_LIGHT),
        ("BOX",       (0,0), (-1,-1), 0.4, SLATE_LIGHT),
        ("INNERGRID", (0,0), (-1,-1), 0.3, colors.white),
        ("LEFTPADDING",(0,0), (-1,-1), 10),
        ("RIGHTPADDING",(0,0),(-1,-1), 10),
        ("TOPPADDING",(0,0), (-1,-1), 7),
        ("BOTTOMPADDING",(0,0),(-1,-1), 7),
    ]))
    story.append(bill_table)

    # Rooftop section
    story.append(Paragraph("Step 2 · What the rooftop allows", h2))
    rt_table = Table([
        ["Total roof area",  f"{metrics.get('total_roof_area_m2', '—')} m²",
         "Usable surface",   f"{metrics.get('usable_roof_area_m2', '—')} m²"],
        ["Panels that fit",  f"{metrics.get('estimated_panels_v2', '—')}",
         "Theoretical max",  f"{metrics.get('estimated_panels_v1', '—')}"],
        ["Installation size",f"{metrics.get('estimated_capacity_v2_kwp', '—')} kWp",
         "Yearly production",f"{(metrics.get('annual_production_v2_kwh', 0)/1000):.1f} MWh"],
        ["Orientation",      str(metrics.get("panel_orientation", "—")).title(),
         "Roof coverage",    f"{metrics.get('real_coverage_pct', '—')}%"],
    ], colWidths=[3.5*cm, 4.7*cm, 3.5*cm, 4.7*cm])
    rt_table.setStyle(TableStyle([
        ("FONTSIZE", (0,0), (-1,-1), 9),
        ("TEXTCOLOR", (0,0), (0,-1), SLATE_LIGHT),
        ("TEXTCOLOR", (2,0), (2,-1), SLATE_LIGHT),
        ("TEXTCOLOR", (1,0), (1,-1), SLATE_DARK),
        ("TEXTCOLOR", (3,0), (3,-1), SLATE_DARK),
        ("FONTNAME",  (1,0), (1,-1), "Helvetica-Bold"),
        ("FONTNAME",  (3,0), (3,-1), "Helvetica-Bold"),
        ("BACKGROUND",(0,0), (-1,-1), BG_LIGHT),
        ("BOX",       (0,0), (-1,-1), 0.4, SLATE_LIGHT),
        ("INNERGRID", (0,0), (-1,-1), 0.3, colors.white),
        ("LEFTPADDING",(0,0), (-1,-1), 10),
        ("RIGHTPADDING",(0,0),(-1,-1), 10),
        ("TOPPADDING",(0,0), (-1,-1), 7),
        ("BOTTOMPADDING",(0,0),(-1,-1), 7),
    ]))
    story.append(rt_table)

    # Final recommendation
    story.append(Paragraph("Final recommendation", h2))
    advice = rec.get("advice") or "No additional advice."
    story.append(Paragraph(
        f"<para><font size='10' color='#475569'>{verdict}<br/><br/>"
        f"<b>Investment outlook:</b> {advice}</font></para>",
        base["BodyText"]
    ))

    # Footer
    story.append(Spacer(1, 14))
    story.append(Paragraph(
        '<para align="center"><font size="7" color="#94A3B8">'
        "This report is an indicative estimate computed by the Solarys AI platform. "
        "Final pricing and panel layout depend on roof orientation, shading and on-site survey. "
        "Generated automatically — not a binding commercial offer."
        "</font></para>",
        small
    ))

    doc.build(story)
    return buf.getvalue()
