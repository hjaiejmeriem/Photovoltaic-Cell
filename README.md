# Solarys — AI-Powered Solar Project Platform

## Overview
This project was developed as part of coursework at Esprit School of Engineering.
It is a **full-stack AI platform** that allows users to **manage the entire lifecycle of a solar
photovoltaic project** — from the very first electricity bill to the live monitoring of an installed
system. Solarys orchestrates **seven specialized AI models** behind a single, customer-facing
web interface so that any solar company can offer a personalized quote, validate the rooftop,
detect defective panels, monitor battery health, and forecast short-term production drops.

A typical end-to-end customer journey runs like this:

1. **Pre-installation — bill analysis.** The customer uploads their electricity bill; a vision-language model
   reads the monthly consumption and an agent computes the recommended panel count, total cost,
   and payback period, then exports a branded PDF quote.
2. **Pre-installation — rooftop suitability.** A U-Net segments the rooftop on an aerial photo and a
   geometric placement algorithm proposes a realistic panel layout, confirming whether the roof
   actually fits the panels recommended in step 1.
3. **Post-installation — panel inspection.** A 3-step pipeline (binary classifier → defect-type
   classifier → GradCAM localization) scans an EL image of any panel and flags damage with
   pixel-level explanations.
4. **Post-installation — battery monitoring.** A multimodal CNN + LSTM fusion model estimates the
   State of Health from a thermal scan and 25 operational features, telling the maintenance team
   when to schedule a replacement.
5. **Post-installation — production forecast.** A ResNet18 + GRU multimodal model uses 12 fish-eye
   sky frames + 34 weather/PV features to forecast PV ramp events 15 minutes in advance, so the
   battery and grid backup can react before a cloud arrives.
6. **Reports.** All five module outputs are aggregated into a single customer dossier — the
   "Dupont family" demo scenario walks through the full chain in one screen.

## Features
- **Bill Analysis.** OCR-style extraction of monthly consumption from an electricity bill
  + solar agent (panels, total cost, ROI, 25-year savings) + branded PDF quote download.
- **Rooftop Solar Potential.** U-Net segmentation of aerial / drone imagery, geometric panel
  placement algorithm, kWp sizing, and yearly production estimate — calibrated to residential scale.
- **Panel Damage Inspection.** Three-stage AI pipeline that classifies a panel as healthy or
  damaged, identifies the defect type (burnt cell, crack, finger, short circuit, busbar,
  dislocation), and highlights the damaged zones with a heat map and bounding boxes.
- **Battery Health Monitor.** Multimodal fusion of a thermal image (ThermalCNN) and 25 cycling
  features (BatteryLSTM) with cross-modal attention, producing the standard State of Health
  metric in [0, 1] with maintenance recommendations.
- **Solar Production Forecast.** Live "sky-camera" simulation that ingests 12 fish-eye frames
  + weather CSV + PV history CSV and predicts PV ramp % over the next 15 minutes, flagging
  sudden ramp events using the F1-optimal threshold from training.
- **Customer Dossier.** Single page that calls all five modules in parallel and synthesizes
  the results into a coherent narrative (pre-installation feasibility + post-installation
  monitoring) with an actionable maintenance list.
- **One-click demo samples.** Every page has a curated gallery of realistic samples that run
  the real models live, so reviewers see the full pipeline without uploading their own files.

## Tech Stack

### Frontend
- **React 18** + **Vite** (dev server, HMR)
- **React Router v6** for client-side navigation
- **Tailwind CSS** for design tokens, layout and theming
- **Recharts** for the production-trajectory and 25-year-savings charts
- **Lucide React** icons

### Backend
- **Python 3.12** + **FastAPI** + **Uvicorn** (single ASGI app exposing 5 routers)
- **TensorFlow 2.20** for the rooftop U-Net (Keras model)
- **PyTorch 2.2** + **torchvision** + **timm** for panel inspection (MobileNetV3, EfficientNet,
  Swin-T) and the multimodal fusion models (battery SoH and solar ramp)
- **scikit-learn** + **joblib** for feature scalers, **scipy** for signal processing
- **OpenCV** + **Pillow** + **tifffile** for image I/O and rendering
- **pandas** for tabular feature engineering on PV history
- **ReportLab** for the customer-ready PDF quote generation

### Other Tools
- **GitHub** for version control
- **HuggingFace Hub** (Qwen2.5-VL fine-tune for bill OCR — `chtibawi/qwen-bill-model`)
- **Kaggle Datasets** (Rooftop semantic segmentation, ELPV solar cells, SKIPPD sky/PV)
- **NASA POWER** weather data (cyclic time + irradiance features for the ramp model)

## Getting Started

### Prerequisites
- **Node.js 18+** and **npm** (frontend)
- **Python 3.12** (backend)
- A modern browser (Chrome / Firefox / Edge)

### Run the backend
```bash
cd backend
python -m venv venv
source venv/Scripts/activate   # Windows Git-Bash (use venv\Scripts\activate.bat in cmd)
pip install -r requirements.txt
uvicorn app.main:app --port 8000
```
The FastAPI app is now live on `http://localhost:8000` (interactive docs at `/docs`).

### Run the frontend
In a second terminal:
```bash
npm install
npm run dev
```
Open `http://localhost:5173` and click any of the seven AI modules from the sidebar.

### Optional: regenerate rooftop demo samples
```bash
cd backend
python scripts/pick_rooftop_samples.py --top 10            # show top candidates
python scripts/pick_rooftop_samples.py --copy 5            # write top 5 to samples/
```

### Optional: tune rooftop calibration
The rooftop service applies a calibration factor (default `0.40`) that brings Kaggle-tile-scale
predictions into typical residential range. Override via env var:
```bash
ROOFTOP_CALIBRATION=0.35 uvicorn app.main:app --port 8000
```

## Project Structure
```
Solarys_platform/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI entry point — registers 5 routers
│   │   ├── config.py               # paths to bundled models/samples
│   │   ├── routers/                # bill, rooftop, panel, battery, ramp
│   │   └── services/               # solar agent, U-Net, fusion model, etc.
│   ├── scripts/
│   │   ├── generate_ramp_samples.py    # builds bundled demo samples for module 07
│   │   └── pick_rooftop_samples.py     # auto-curates rooftop samples from the dataset
│   └── requirements.txt
├── src/                            # React frontend
│   ├── pages/                      # 7 AI module pages + Dashboard + Reports
│   ├── components/                 # Sidebar, UploadZone, AlertBanner, etc.
│   └── services/api.js             # backend API client
├── models_input/                   # all 7 trained models + their sample data
└── README.md
```

## Demo scenario
The platform is wired around a single coherent customer story — the **Dupont family at
12 rue des Roses, Paris**. Their bill calls for 11 panels (21 800 €, 12.5-year payback);
the rooftop analysis confirms 17 panels would fit; three years post-installation, panel
inspection finds one burnt cell, the battery is at 80 % capacity (monitor closely), and
today's afternoon clouds will cause a –3.2 pp dip in production. All of this is aggregated
on the **Customer Dossier** page (the Reports tab).

## Acknowledgments
This project was created under the supervision of Esprit School of Engineering.
