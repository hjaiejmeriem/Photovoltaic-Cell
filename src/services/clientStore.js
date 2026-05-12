/**
 * Cross-page client-side store for the Client Space.
 *
 * The Bill Analysis and Rooftop Analysis pages each write their latest result
 * to sessionStorage. The Combined Report page reads both — no need to upload
 * the same files twice. Storage is per browser tab (sessionStorage), so each
 * customer session is isolated.
 */
const KEYS = {
  bill:    'solarvision-bill-result',
  rooftop: 'solarvision-rooftop-result',
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
    else sessionStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

export const clientStore = {
  getBill:     () => _read(KEYS.bill),
  setBill:     (v) => _write(KEYS.bill, v ? { ...v, _stored_at: Date.now() } : null),
  getRooftop:  () => _read(KEYS.rooftop),
  setRooftop:  (v) => _write(KEYS.rooftop, v ? { ...v, _stored_at: Date.now() } : null),
  clear:       () => { _write(KEYS.bill, null); _write(KEYS.rooftop, null) },
}
