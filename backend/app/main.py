"""Solarys backend — FastAPI entry point."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import ALLOWED_ORIGINS
from .routers import rooftop, panel, battery, ramp, bill

app = FastAPI(
    title="Solarys API",
    description="AI-powered solar platform backend — segmentation, analysis, monitoring",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rooftop.router)
app.include_router(panel.router)
app.include_router(battery.router)
app.include_router(ramp.router)
app.include_router(bill.router)


@app.get("/")
def root():
    return {
        "service": "Solarys API",
        "endpoints": [
            "POST /api/rooftop/segment              (multipart file upload)",
            "POST /api/rooftop/segment-from-coords  (JSON {lat, lon})",
            "GET  /api/rooftop/health",
            "POST /api/panel/inspect                (multipart EL image upload)",
            "GET  /api/panel/health",
            "POST /api/battery/predict              (multipart thermal + JSON features)",
            "POST /api/battery/predict-sample       (run on bundled demo sample)",
            "GET  /api/battery/features             (25 feature names)",
            "GET  /api/battery/health",
            "POST /api/ramp/forecast                (multipart 12-frame .npy + JSON features)",
            "POST /api/ramp/forecast-multi          (multipart 12 separate images + JSON features)",
            "POST /api/ramp/forecast-csv            (multipart 12-frame .npy + raw CSV)",
            "POST /api/ramp/forecast-sample/{id}    (run on bundled demo sample)",
            "GET  /api/ramp/samples                 (list bundled demo samples)",
            "GET  /api/ramp/features                (34 feature names)",
            "GET  /api/ramp/health",
        ],
    }
