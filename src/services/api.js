// Solarys API client — calls the FastAPI backend
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000'

async function _handle(res) {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const err = await res.json()
      msg = err.detail || msg
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.json()
}

/**
 * POST /api/rooftop/segment — uploaded aerial image
 * Pure pipeline: image → U-Net → mask + metrics + panel placement.
 * No center isolation, no zoom, no transformation — same as the notebook.
 *
 * @param {File|Blob} file
 * @param {{isolateCenter?: boolean}} [opts] — kept for API compat, defaults to false
 */
export async function segmentRooftopFromFile(file, opts = {}) {
  const formData = new FormData()
  formData.append('file', file, file.name || 'image.png')
  const isolate = opts.isolateCenter === true
  const url = `${API_BASE}/api/rooftop/segment?isolate_center=${isolate ? 'true' : 'false'}`
  const res = await fetch(url, { method: 'POST', body: formData })
  return _handle(res)
}

/**
 * POST /api/rooftop/segment-from-coords — fetch satellite + segment
 * @param {{lat:number, lon:number, size?:number, radius_meters?:number}} body
 */
export async function segmentRooftopFromCoords(body) {
  const res = await fetch(`${API_BASE}/api/rooftop/segment-from-coords`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return _handle(res)
}

/**
 * GET /api/rooftop/samples — list bundled aerial samples.
 */
export async function listRooftopSamples() {
  const res = await fetch(`${API_BASE}/api/rooftop/samples`)
  return _handle(res)
}

/**
 * POST /api/rooftop/segment-sample/{id} — one-click pipeline on a sample.
 */
export async function segmentRooftopSample(sampleId) {
  const res = await fetch(`${API_BASE}/api/rooftop/segment-sample/${sampleId}`, { method: 'POST' })
  return _handle(res)
}

/**
 * GET /api/rooftop/health
 */
export async function rooftopHealth() {
  try {
    const res = await fetch(`${API_BASE}/api/rooftop/health`)
    if (!res.ok) return { status: 'down', error: `HTTP ${res.status}` }
    return res.json()
  } catch (e) {
    return { status: 'down', error: e.message }
  }
}

/**
 * POST /api/panel/inspect — upload an EL panel image and get the full pipeline.
 * Returns: { panel_status, step1_binary, step2_defect_type, step3_localization,
 *            images:{original,heatmap,bboxes}, recommendation, severity? }
 *
 * @param {File|Blob} file
 */
export async function inspectPanel(file) {
  const formData = new FormData()
  formData.append('file', file, file.name || 'panel.png')
  const res = await fetch(`${API_BASE}/api/panel/inspect`, {
    method: 'POST',
    body: formData,
  })
  return _handle(res)
}

/**
 * GET /api/panel/samples — list bundled panel inspection samples.
 */
export async function listPanelSamples() {
  const res = await fetch(`${API_BASE}/api/panel/samples`)
  return _handle(res)
}

/**
 * POST /api/panel/inspect-sample/{id} — one-click inspection on a sample.
 */
export async function inspectPanelSample(sampleId) {
  const res = await fetch(`${API_BASE}/api/panel/inspect-sample/${sampleId}`, { method: 'POST' })
  return _handle(res)
}

/**
 * POST /api/battery/predict — multimodal SoH prediction.
 * @param {File|Blob} thermalFile  thermal image (.npy or PNG/JPG)
 * @param {object} features  dict of 25 feature names → numbers
 */
export async function predictBatterySoh(thermalFile, features) {
  const formData = new FormData()
  formData.append('thermal_image', thermalFile, thermalFile.name || 'thermal.npy')
  formData.append('features', JSON.stringify(features))
  const res = await fetch(`${API_BASE}/api/battery/predict`, {
    method: 'POST',
    body: formData,
  })
  return _handle(res)
}

/**
 * POST /api/battery/predict-sample — run on the bundled demo sample.
 */
export async function predictBatterySample() {
  const res = await fetch(`${API_BASE}/api/battery/predict-sample`, { method: 'POST' })
  return _handle(res)
}

/**
 * GET /api/battery/features — list of 25 feature names.
 */
export async function getBatteryFeatures() {
  const res = await fetch(`${API_BASE}/api/battery/features`)
  return _handle(res)
}

/**
 * GET /api/battery/samples — list bundled battery test samples.
 */
export async function listBatterySamples() {
  const res = await fetch(`${API_BASE}/api/battery/samples`)
  return _handle(res)
}

/**
 * POST /api/battery/predict-sample/{id} — run on a specific bundled sample.
 */
export async function predictBatterySampleById(sampleId) {
  const res = await fetch(`${API_BASE}/api/battery/predict-sample/${sampleId}`, { method: 'POST' })
  return _handle(res)
}

// ──────────────────────────────────────────────────────────
// Module 01 — Bill analysis (consumption → solar quote)
// ──────────────────────────────────────────────────────────

/**
 * GET /api/bill/samples — list bundled bill profiles.
 */
export async function listBillSamples() {
  const res = await fetch(`${API_BASE}/api/bill/samples`)
  return _handle(res)
}

/**
 * POST /api/bill/analyze-sample/{id} — run the solar agent on a sample.
 */
export async function analyzeBillSample(sampleId) {
  const res = await fetch(`${API_BASE}/api/bill/analyze-sample/${sampleId}`, { method: 'POST' })
  return _handle(res)
}

/**
 * POST /api/bill/analyze-upload — run Qwen2.5-VL on an uploaded bill image.
 * First call downloads the ~14 GB model and may take several minutes.
 */
export async function analyzeBillUpload(file) {
  const fd = new FormData()
  fd.append('file', file, file.name || 'bill.png')
  const res = await fetch(`${API_BASE}/api/bill/analyze-upload`, { method: 'POST', body: fd })
  return _handle(res)
}

/**
 * POST /api/bill/lookup — fast hash-only lookup of a bundled sample.
 * Returns the analysis if matched, throws on 404 (no match).
 */
export async function lookupBillByHash(file) {
  const fd = new FormData()
  fd.append('file', file, file.name || 'bill.png')
  const res = await fetch(`${API_BASE}/api/bill/lookup`, { method: 'POST', body: fd })
  if (res.status === 404) throw new Error('NO_MATCH')
  return _handle(res)
}

/**
 * Download the PDF quote for a bundled sample (triggers a browser download).
 */
export function billReportSampleUrl(sampleId) {
  return `${API_BASE}/api/bill/report/${sampleId}`
}

/**
 * Build a PDF from an already-computed analysis result. Returns a Blob URL.
 */
export async function billReportFromResult(result) {
  const res = await fetch(`${API_BASE}/api/bill/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { msg = (await res.json()).detail || msg } catch {}
    throw new Error(msg)
  }
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

/**
 * Build a combined Bill + Rooftop feasibility PDF. Returns a Blob URL.
 */
export async function combinedFeasibilityReport(billResult, rooftopResult) {
  const res = await fetch(`${API_BASE}/api/bill/report-combined`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bill: billResult, rooftop: rooftopResult }),
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { msg = (await res.json()).detail || msg } catch {}
    throw new Error(msg)
  }
  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

// ──────────────────────────────────────────────────────────
// Module 07 — Solar Ramp Forecasting
// ──────────────────────────────────────────────────────────

/**
 * GET /api/ramp/samples — list bundled (synthetic) demo samples.
 */
export async function listRampSamples() {
  const res = await fetch(`${API_BASE}/api/ramp/samples`)
  return _handle(res)
}

/**
 * POST /api/ramp/forecast-sample/{id} — run on a bundled (synthetic) demo sample.
 */
export async function forecastRampSample(sampleId) {
  const res = await fetch(`${API_BASE}/api/ramp/forecast-sample/${sampleId}`, { method: 'POST' })
  return _handle(res)
}

/**
 * GET /api/ramp/deployment-samples — list real deployment-test samples.
 */
export async function listRampDeploymentSamples() {
  const res = await fetch(`${API_BASE}/api/ramp/deployment-samples`)
  return _handle(res)
}

/**
 * POST /api/ramp/forecast-deployment/{id} — simulate sky-camera live feed.
 */
export async function forecastRampDeployment(sampleId) {
  const res = await fetch(`${API_BASE}/api/ramp/forecast-deployment/${sampleId}`, { method: 'POST' })
  return _handle(res)
}

/**
 * GET /api/ramp/live — single tick of the real-time forecasting feed.
 *   - lat / lon : geographic point used for the Open-Meteo weather fetch
 *   - simulateAlert : force-pick a sample that triggers a sudden ramp event
 */
export async function getRampLiveTick({ lat, lon, simulateAlert } = {}) {
  const params = new URLSearchParams()
  if (lat != null) params.set('lat', lat)
  if (lon != null) params.set('lon', lon)
  if (simulateAlert) params.set('simulate_alert', 'true')
  const url = `${API_BASE}/api/ramp/live${params.toString() ? '?' + params.toString() : ''}`
  const res = await fetch(url)
  return _handle(res)
}

/**
 * POST /api/ramp/forecast — .npy stack of 12 frames + features dict.
 */
export async function forecastRamp(npyFile, features) {
  const formData = new FormData()
  formData.append('sky_images', npyFile, npyFile.name || 'sky.npy')
  formData.append('features', JSON.stringify(features))
  const res = await fetch(`${API_BASE}/api/ramp/forecast`, { method: 'POST', body: formData })
  return _handle(res)
}

/**
 * POST /api/ramp/forecast-csv — .npy stack + raw CSV (backend derives features).
 */
export async function forecastRampFromCsv(npyFile, csvFile) {
  const formData = new FormData()
  formData.append('sky_images', npyFile, npyFile.name || 'sky.npy')
  formData.append('csv_file', csvFile, csvFile.name || 'weather.csv')
  const res = await fetch(`${API_BASE}/api/ramp/forecast-csv`, { method: 'POST', body: formData })
  return _handle(res)
}

/**
 * POST /api/ramp/forecast-multi — 12 separate image files + features dict.
 */
export async function forecastRampFromImages(imageFiles, features) {
  if (imageFiles.length !== 12) throw new Error('Need exactly 12 sky image files')
  const formData = new FormData()
  imageFiles.forEach((f, i) => formData.append(`sky_image_${i}`, f, f.name || `sky_${i}.png`))
  formData.append('features', JSON.stringify(features))
  const res = await fetch(`${API_BASE}/api/ramp/forecast-multi`, { method: 'POST', body: formData })
  return _handle(res)
}
