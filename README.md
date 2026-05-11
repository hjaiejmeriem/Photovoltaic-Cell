# ☀️ Solar PV Ramp Event Forecasting

> **Multimodal Deep Learning for Sudden Solar Power Ramp Detection**  
> Predicts abrupt changes in photovoltaic output 15 minutes ahead using sky images, weather data, and historical PV readings.

---

## 📌 Project Overview

Solar power ramp events — sudden drops or spikes in PV output caused by cloud cover changes — pose a major challenge for grid stability. This project builds a **multi-task ResNet18 + GRU hybrid model** that simultaneously:

- **Regresses** the expected PV output change (%) at t+15 min
- **Classifies** whether a sudden ramp event will occur

The model is trained on the **SKIPPD dataset** (Stanford Solar Power Dataset) covering 2017–2019, enriched with NASA POWER meteorological data.

---

## 🗂️ Structure

```
├── E5er_mo7awla.ipynb          # Main training & evaluation notebook
├── download_weather.py         # NASA POWER API weather data downloader
├── README.md                   # This file
```

---

## 🧠 Model Architecture

The model fuses **three input streams**:

| Stream | Input | Encoder |
|---|---|---|
| 🖼️ Sky Images | 12 consecutive frames (128×128 RGB) | ResNet18 (pretrained) |
| ⚡ PV History | 15 lag readings (log scale) | GRU |
| 🌤️ Weather | Meteo features + time encodings | MLP |

The fused representation feeds into two heads:
- **Regression head** → ramp % at t+15 min
- **Classification head** → sudden ramp probability

---

## 📦 Dataset

### SKIPPD (Stanford)
- Sky images + PV log readings, 2017–2019
- HDF5 format: `2017_2019_images_pv_processed.hdf5`
- Timestamps: `times_trainval.npy`

### NASA POWER Weather
Fetched via `download_weather.py` for Stanford coordinates (37.43°N, 122.17°W):

| Variable | Description |
|---|---|
| `T2M` | Temperature at 2m (°C) |
| `RH2M` | Relative humidity (%) |
| `PS` | Surface pressure (kPa) |
| `WS2M` | Wind speed at 2m (m/s) |
| `WD2M` | Wind direction (°) |
| `PRECTOTCORR` | Precipitation (mm/hr) |
| `ALLSKY_SFC_SW_DWN` | Solar irradiance (kW·h/m²/day) |

---


### Training

Training runs in **2 stages**:
1. **Stage 1** — ResNet18 backbone frozen, heads trained
2. **Stage 2** — Full fine-tuning with differential learning rates


---

## 📊 Model Output

For each sample, the model returns:

```json
{
  "ramp_pct_t_plus_15": -3.18,
  "sudden_ramp_prob": 0.20,
  "sudden_ramp_detected": false,
  "label": "normal"
}
```


## 🛠️ Dependencies

```
torch
torchvision
numpy
pandas
scikit-learn
scipy
h5py
joblib
matplotlib
requests
Pillow
```

Install with:
```bash
pip install torch torchvision numpy pandas scikit-learn scipy h5py joblib matplotlib requests Pillow
```

---

## 📍 References

- **SKIPPD Dataset**: [Kaggle – marghedranim/skippd](https://www.kaggle.com/datasets/marghedranim/skippd)
- **NASA POWER API**: [power.larc.nasa.gov](https://power.larc.nasa.gov/)

---

## 👤 Author

> Project developed as part of solar energy forecasting research.  
> Feel free to open issues or pull requests for improvements.
