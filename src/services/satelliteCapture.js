// Capture a square satellite image at given (lat, lon) by stitching Esri World Imagery tiles.
// Runs entirely in the browser → no CORS proxy, no Esri export endpoint, no API key.

const TILE_URL = (z, x, y) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`

const TILE_SIZE = 256

// Web Mercator math
function lonLatToTile(lon, lat, z) {
  const n = 2 ** z
  const x = ((lon + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  return { x, y }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load tile ${src}`))
    img.src = src
  })
}

/**
 * Capture a satellite image as a Blob (PNG) centered on (lat, lon).
 * @param {object} opts
 * @param {number} opts.lat
 * @param {number} opts.lon
 * @param {number} opts.zoom   default 19 (max Esri precision in most areas)
 * @param {number} opts.size   output size in px (default 512)
 * @returns {Promise<Blob>}
 */
export async function captureSatelliteImage({ lat, lon, zoom = 19, size = 512 }) {
  const center = lonLatToTile(lon, lat, zoom)

  // Compute the source rectangle in tile-pixel space
  const halfSizePx = size / 2
  const centerPxX = center.x * TILE_SIZE
  const centerPxY = center.y * TILE_SIZE
  const minPxX = centerPxX - halfSizePx
  const minPxY = centerPxY - halfSizePx

  const tileMinX = Math.floor(minPxX / TILE_SIZE)
  const tileMinY = Math.floor(minPxY / TILE_SIZE)
  const tileMaxX = Math.ceil((minPxX + size) / TILE_SIZE)
  const tileMaxY = Math.ceil((minPxY + size) / TILE_SIZE)

  // Load all needed tiles in parallel
  const tiles = []
  for (let tx = tileMinX; tx < tileMaxX; tx++) {
    for (let ty = tileMinY; ty < tileMaxY; ty++) {
      tiles.push(
        loadImage(TILE_URL(zoom, tx, ty)).then((img) => ({ img, tx, ty }))
      )
    }
  }
  const loaded = await Promise.all(tiles)

  // Compose into a canvas
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  for (const { img, tx, ty } of loaded) {
    const dx = tx * TILE_SIZE - minPxX
    const dy = ty * TILE_SIZE - minPxY
    ctx.drawImage(img, dx, dy)
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Canvas to Blob failed'))
    }, 'image/png')
  })
}
