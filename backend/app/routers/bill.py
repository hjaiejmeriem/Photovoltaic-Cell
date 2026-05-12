"""Electricity-bill analysis endpoints (module 01)."""
from fastapi import APIRouter, HTTPException, Body, UploadFile, File
from fastapi.responses import Response

from ..services.bill_service import (
    list_bill_samples, analyze_sample, analyze_consumption,
    build_report_pdf, build_sample_report_pdf, build_combined_pdf,
    predict_bill_from_image, reload_bundled_bills, _bundled_bills,
)

router = APIRouter(prefix="/api/bill", tags=["bill"])


@router.get("/samples")
def samples() -> dict:
    """List the bundled bill samples (small / family / business)."""
    return {"samples": list_bill_samples()}


@router.post("/lookup")
async def lookup_only(file: UploadFile = File(...)) -> dict:
    """Hash-only lookup: returns the analysis if the uploaded file
    matches a bundled sample, else 404. Never invokes the heavy model.
    Frontend can call this first; on 404 it falls back to the rotation."""
    image_bytes = await file.read()
    from ..services.bill_service import _sha256
    file_hash = _sha256(image_bytes)
    bundled = _bundled_bills().get(file_hash)
    if bundled is None:
        raise HTTPException(404, "No bundled match for this file's hash.")
    try:
        consumption = float(bundled.get("consommation_kwh"))
        amount = bundled.get("montant_total")
        from ..services.bill_service import ELECTRICITY_PRICE
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
    except Exception as e:
        raise HTTPException(500, f"Lookup matched but reconstruction failed: {e}")


@router.post("/analyze-upload")
async def analyze_upload(file: UploadFile = File(...)) -> dict:
    """Run the colleague's Qwen2.5-VL fine-tune on an uploaded bill image,
    then hand off to the solar agent. Returns the same shape as analyze_sample.

    Heavy on CPU — first call downloads the ~14 GB model from HuggingFace
    and may take several minutes. Subsequent calls are ~30s on CPU.
    """
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(400, f"Expected an image, got {file.content_type}")
    try:
        image_bytes = await file.read()
        return predict_bill_from_image(image_bytes)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Bill OCR failed: {e}")


@router.post("/analyze-sample/{sample_id}")
def analyze_sample_endpoint(sample_id: str) -> dict:
    """Run the solar agent on a bundled sample (simulates AI extraction + agent)."""
    try:
        return analyze_sample(sample_id)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Analysis failed: {e}")


@router.post("/analyze-consumption")
def analyze_consumption_endpoint(
    body: dict = Body(..., example={"monthly_consumption_kwh": 450}),
) -> dict:
    """Run the solar agent on a custom monthly consumption (kWh/month)."""
    try:
        return analyze_consumption(
            consumption_kwh_month=float(body["monthly_consumption_kwh"]),
            monthly_amount_eur=body.get("monthly_amount_eur"),
            billing_period=body.get("billing_period"),
            tariff_code=body.get("tariff_code"),
            label=body.get("label"),
        )
    except (KeyError, TypeError, ValueError) as e:
        raise HTTPException(400, f"Invalid payload: {e}")
    except Exception as e:
        raise HTTPException(500, f"Analysis failed: {e}")


@router.get("/report/{sample_id}")
def report_sample_pdf(sample_id: str):
    """Download the customer-ready solar quote PDF for a bundled sample."""
    try:
        pdf_bytes, filename = build_sample_report_pdf(sample_id)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, f"PDF generation failed: {e}")

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf_bytes)),
        },
    )


@router.post("/report")
def report_custom_pdf(body: dict = Body(...)):
    """Generate a PDF for a custom analysis result (already computed)."""
    try:
        pdf_bytes = build_report_pdf(body)
    except Exception as e:
        raise HTTPException(500, f"PDF generation failed: {e}")
    filename = "solarys-quote.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf_bytes)),
        },
    )


@router.post("/report-combined")
def report_combined(body: dict = Body(...)):
    """Generate a combined Bill + Rooftop PDF — used by the Client Report page.
    Body shape: { bill: <analyze_consumption result>, rooftop: <segment-* result> }
    """
    bill_report = body.get("bill") or {}
    rooftop_result = body.get("rooftop") or {}
    if not bill_report or not rooftop_result:
        raise HTTPException(400, "Both 'bill' and 'rooftop' fields are required.")
    try:
        pdf_bytes = build_combined_pdf(bill_report, rooftop_result)
    except Exception as e:
        raise HTTPException(500, f"Combined PDF generation failed: {e}")
    filename = "solarys-feasibility-report.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf_bytes)),
        },
    )


@router.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "n_samples": len(list_bill_samples()),
        "n_bundled_bills": len(_bundled_bills()),
    }


@router.post("/reload-bundled-bills")
def reload_bundled() -> dict:
    """Rescan the bill_samples folder after dropping a new file."""
    n = reload_bundled_bills()
    return {"status": "ok", "n_bundled_bills": n}
