// Maps service — 100% free, no API key required
// - Geocoding : Nominatim (OpenStreetMap)
// - Satellite : Esri World Imagery (free tile service, no key)

/**
 * Convert an address string to coordinates via Nominatim.
 * Free, no API key. Polite usage requires a meaningful User-Agent
 * which the browser sends automatically.
 *
 * @returns {Promise<{lat:number, lon:number, formatted:string, provider:string, boundingbox?:string[]}>}
 */
export async function geocodeAddress(address) {
  const cleaned = address.trim()
  if (!cleaned) throw new Error('Address is empty')

  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cleaned)}&format=json&limit=1&addressdetails=1`
  let res
  try {
    res = await fetch(url, { headers: { 'Accept-Language': 'en' } })
  } catch (err) {
    throw new Error('Network error — geocoding service unreachable')
  }
  if (!res.ok) throw new Error(`Nominatim error ${res.status}`)
  const data = await res.json()
  if (!data.length) throw new Error('Address not found — please check spelling')
  const r = data[0]
  return {
    lat: parseFloat(r.lat),
    lon: parseFloat(r.lon),
    formatted: r.display_name,
    boundingbox: r.boundingbox,
    provider: 'osm',
  }
}

/**
 * Reverse geocoding — coordinates → address.
 * Useful for "click on map" interactions.
 */
export async function reverseGeocode(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=18`
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } })
  if (!res.ok) throw new Error(`Nominatim error ${res.status}`)
  const data = await res.json()
  return {
    lat: parseFloat(data.lat),
    lon: parseFloat(data.lon),
    formatted: data.display_name,
    provider: 'osm',
  }
}

/**
 * Esri World Imagery — free satellite tile layer.
 * Used by Leaflet for interactive map display.
 */
export const ESRI_WORLD_IMAGERY = {
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  attribution: 'Tiles © Esri — World Imagery',
  maxZoom: 19,
}

/**
 * Build a static aerial image URL via Esri export service.
 * Used when we want a single PNG (e.g. to send to backend for segmentation).
 * No API key required.
 *
 * @param {object} opts
 * @param {number} opts.lat - center latitude
 * @param {number} opts.lon - center longitude
 * @param {number} opts.size - image size in px (default 512)
 * @param {number} opts.radiusMeters - half-extent of the box in meters (default 30)
 */
export function getStaticAerialUrl({ lat, lon, size = 512, radiusMeters = 30 }) {
  // Approx conversion: 1 degree latitude ≈ 111 km
  const dLat = radiusMeters / 111000
  const dLon = radiusMeters / (111000 * Math.cos(lat * Math.PI / 180))
  const minLon = lon - dLon
  const maxLon = lon + dLon
  const minLat = lat - dLat
  const maxLat = lat + dLat

  const params = new URLSearchParams({
    bbox: `${minLon},${minLat},${maxLon},${maxLat}`,
    bboxSR: '4326',
    imageSR: '4326',
    size: `${size},${size}`,
    format: 'png',
    f: 'image',
  })
  return `https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export?${params}`
}

export function getMapsLink(lat, lon) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=19/${lat}/${lon}`
}
