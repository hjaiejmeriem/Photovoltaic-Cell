# Solarys Backend

FastAPI backend for the Solarys platform.

## Setup

```bash
cd backend
python -m venv venv
venv\Scripts\activate         # Windows
# source venv/bin/activate    # macOS/Linux
pip install -r requirements.txt
```

## Run

```bash
uvicorn app.main:app --reload --port 8000
```

API will be available at `http://localhost:8000` and interactive docs at `http://localhost:8000/docs`.

## Endpoints

### `POST /api/rooftop/segment`
Upload an aerial image (multipart/form-data). Returns segmentation + V1/V2 panel placement metrics + base64-encoded visualizations.

### `POST /api/rooftop/segment-from-coords`
Body: `{ "lat": 48.858, "lon": 2.294, "size": 512, "radius_meters": 30 }`
Server fetches the Esri World Imagery satellite tile and runs segmentation.

### `GET /api/rooftop/health`
Quick probe — confirms the model file is present.

## Notes

- **First call is slow** — TensorFlow lazy-loads the model (~5-10s).
- The model is loaded once and kept in memory.
- All visualizations are returned as base64 PNG data URLs in the JSON response.
