/**
 * Cross-page expert-side store (panel inspection + battery health).
 *
 * The Expert Diagnostic page writes each successful inspection here.
 * The Reports page and the Alerts Dashboard read from it so they
 * always reflect the latest upload — not a hardcoded demo sample.
 *
 * Per-tab isolation: sessionStorage. Clears when the tab closes.
 */
const KEYS = {
  panel:   'solarys-expert-panel',
  battery: 'solarys-expert-battery',
}

function _read(key) {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
function _write(key, value) {
  try {
    if (value == null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, JSON.stringify({ ...value, _stored_at: Date.now() }))
  } catch {}
}

export const expertStore = {
  getPanel:    () => _read(KEYS.panel),
  setPanel:    (v) => _write(KEYS.panel, v),
  clearPanel:  () => _write(KEYS.panel, null),
  getBattery:  () => _read(KEYS.battery),
  setBattery:  (v) => _write(KEYS.battery, v),
  clearBattery:() => _write(KEYS.battery, null),
  clearAll:    () => {
    _write(KEYS.panel, null); _write(KEYS.battery, null)
  },
}
