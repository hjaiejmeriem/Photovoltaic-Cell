import { useEffect } from 'react'
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ESRI_WORLD_IMAGERY } from '../services/maps'

// Fix default icon paths (Leaflet expects them relative; we override with CDN URLs)
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// Custom yellow/blue Solarys marker (SVG)
const solarysIcon = L.divIcon({
  className: 'solarys-marker',
  html: `
    <div style="
      width: 32px; height: 32px;
      background: linear-gradient(135deg, #F4C430 0%, #1E6FBA 100%);
      border: 3px solid white;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      display: flex; align-items: center; justify-content: center;
    ">
      <div style="transform: rotate(45deg); width: 10px; height: 10px; background: white; border-radius: 50%;"></div>
    </div>
  `,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
})

function Recenter({ lat, lon, zoom }) {
  const map = useMap()
  useEffect(() => {
    map.flyTo([lat, lon], zoom, { duration: 0.8 })
  }, [lat, lon, zoom, map])
  return null
}

export default function SatelliteMap({ lat, lon, zoom = 19, height = 360 }) {
  return (
    <div className="rounded-xl overflow-hidden border border-slate-200 shadow-sm" style={{ height }}>
      <MapContainer
        center={[lat, lon]}
        zoom={zoom}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
        zoomControl={true}
      >
        <TileLayer
          url={ESRI_WORLD_IMAGERY.url}
          attribution={ESRI_WORLD_IMAGERY.attribution}
          maxZoom={ESRI_WORLD_IMAGERY.maxZoom}
        />
        <Marker position={[lat, lon]} icon={solarysIcon} />
        <Recenter lat={lat} lon={lon} zoom={zoom} />
      </MapContainer>
    </div>
  )
}
