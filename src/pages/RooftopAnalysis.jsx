import { useState } from 'react'
import {
  Satellite, Sun, Loader2, AlertTriangle, CheckCircle2, ZapOff,
  Info, ShieldCheck, Image as ImageIcon, Maximize2, Compass,
} from 'lucide-react'
import clsx from 'clsx'
import UploadZone from '../components/UploadZone'
import { segmentRooftopFromFile } from '../services/api'
import { clientStore } from '../services/clientStore'

const SEVERITY = {
  good:     { color: '#10B981', bg: 'bg-emerald-50',  text: 'text-emerald-700', border: 'border-emerald-200' },
  warn:     { color: '#F59E0B', bg: 'bg-amber-50',    text: 'text-amber-700',   border: 'border-amber-200' },
  critical: { color: '#EF4444', bg: 'bg-red-50',      text: 'text-red-700',     border: 'border-red-200' },
}

function getOutcome(metrics) {
  const n = metrics?.estimated_panels_v2 ?? 0
  const cap = metrics?.estimated_capacity_v2_kwp ?? 0
  if (n === 0) {
    return { title: 'No usable rooftop area found', subtitle: 'The image does not contain a clearly identifiable rooftop, or the surface is too small / shaded for solar.', severity: 'critical', Icon: ZapOff,
      actions: ['Use an aerial / drone photo taken at noon.', 'Make sure the rooftop is centered.', 'Trim trees that shade the building.'] }
  }
  if (n >= 20) {
    return { title: 'Excellent rooftop for solar', subtitle: `Plenty of usable surface — up to ${n} panels (~${cap} kWp). Strong financial case.`, severity: 'good', Icon: CheckCircle2,
      actions: ['Proceed with detailed financial quote.', 'Order on-site survey to confirm orientation.', 'Plan for grid feed-in agreement.'] }
  }
  if (n >= 8) {
    return { title: 'Good rooftop fit', subtitle: `Solid potential — ${n} panels (~${cap} kWp) fit on the usable surface.`, severity: 'good', Icon: CheckCircle2,
      actions: ['Proceed with full quote.', 'Schedule on-site visit.'] }
  }
  return { title: 'Limited rooftop space', subtitle: `Only room for ${n} panels (~${cap} kWp).`, severity: 'warn', Icon: AlertTriangle,
    actions: ['Quote a partial-coverage system.', 'Combine with energy-saving measures.', 'Verify on-site obstacles.'] }
}

function MetricBig({ icon: Ic, label, value, sublabel, color = '#0F172A' }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-2 mb-2 text-slate-500">
        <Ic size={14} />
        <p className="text-[11px] uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-3xl font-bold font-mono" style={{ color }}>{value}</p>
      {sublabel && <p className="text-xs text-slate-500 mt-1">{sublabel}</p>}
    </div>
  )
}

export default function RooftopAnalysis() {
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const runAnalysis = async () => {
    if (!file) return
    setLoading(true); setError(null); setResult(null)
    try {
      const data = await segmentRooftopFromFile(file)
      setResult(data)
      // Make the result available to the Combined Report page
      clientStore.setRooftop(data)
    } catch (e) {
      setError(e.message || 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  const m = result?.metrics
  const outcome = m ? getOutcome(m) : null
  const sev = outcome ? SEVERITY[outcome.severity] : null

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center">
            <Satellite size={16} className="text-sky-600" />
          </div>
          <h1 className="page-title">Rooftop Solar Potential</h1>
        </div>
        <p className="page-subtitle ml-11">
          Upload an aerial or satellite photo of any rooftop and instantly know how many
          panels will fit, the kWp installable, and the yearly production estimate.
        </p>
      </div>

      <div className="card space-y-5">
        <h2 className="text-slate-700 font-semibold text-sm uppercase tracking-wide flex items-center gap-2">
          <ImageIcon size={14} className="text-sky-600" /> Upload an aerial photo
        </h2>
        <UploadZone
          accept="image/*,.tif,.tiff"
          label="Drop an aerial / satellite / drone photo"
          hint="PNG, JPG or TIFF · top-down view of the building"
          file={file}
          onFile={(f) => { setFile(f); setResult(null); setError(null) }}
          onClear={() => { setFile(null); setResult(null); setError(null) }}
        />
        <button
          onClick={runAnalysis}
          disabled={!file || loading}
          className="btn-primary w-full justify-center">
          {loading
            ? <><Loader2 size={16} className="animate-spin" /> Analyzing rooftop…</>
            : <><Satellite size={16} /> Analyze rooftop</>}
        </button>
      </div>

      {error && (
        <div className="card">
          <div className="rounded-lg px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-sm flex items-start gap-2">
            <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Analysis failed</p>
              <p className="text-xs mt-0.5">{error}</p>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="card flex flex-col items-center justify-center py-10 gap-3">
          <Loader2 size={32} className="text-sky-600 animate-spin" />
          <p className="text-slate-600 text-sm">Reading the rooftop from the aerial photo…</p>
        </div>
      )}

      {result && outcome && sev && (
        <>
          <div className="card space-y-5">
            <div className="flex items-start gap-4">
              <div className={clsx('w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0', sev.bg)}>
                <outcome.Icon size={26} style={{ color: sev.color }} strokeWidth={2} />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-slate-900">{outcome.title}</h2>
                <p className="text-slate-600 text-sm mt-1">{outcome.subtitle}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricBig icon={Maximize2} label="Usable rooftop" value={`${m.usable_roof_area_m2} m²`}
                sublabel={`Total: ${m.total_roof_area_m2} m² · ${m.real_coverage_pct}% covered`} />
              <MetricBig icon={Sun} label="Panels that fit" value={m.estimated_panels_v2}
                sublabel={`Theoretical max: ${m.estimated_panels_v1}`} color={sev.color} />
              <MetricBig icon={ShieldCheck} label="Installation size" value={`${m.estimated_capacity_v2_kwp} kWp`}
                sublabel={m.panel_orientation ? `${m.panel_orientation} orientation` : 'Standard layout'} />
              <MetricBig icon={Compass} label="Yearly production" value={`${(m.annual_production_v2_kwh / 1000).toFixed(1)} MWh`}
                sublabel="Estimated electricity output / year" color="#10B981" />
            </div>

            <div className={clsx('rounded-lg p-4 border', sev.bg, sev.border)}>
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck size={16} className={sev.text} />
                <p className={clsx('text-xs font-semibold uppercase tracking-wide', sev.text)}>Recommended actions</p>
              </div>
              <ul className="space-y-1.5 ml-1">
                {outcome.actions.map((a, i) => (
                  <li key={i} className="text-slate-700 text-sm flex items-start gap-2">
                    <span className="mt-2 w-1 h-1 rounded-full flex-shrink-0" style={{ background: sev.color }} />
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {result.images && (
            <div className="card">
              <h2 className="text-slate-700 font-semibold text-sm uppercase tracking-wide mb-1 flex items-center gap-2">
                <ImageIcon size={15} className="text-sky-600" />
                What the AI saw
              </h2>
              <p className="text-[11px] text-slate-500 mb-3">
                The aerial photo, the AI's view of the rooftop outline, and the proposed panel layout.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1.5">Aerial photo</p>
                  <img src={result.images.original} alt="Aerial"
                    className="rounded-xl w-full aspect-square object-cover border border-slate-200" />
                </div>
                <div>
                  <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1.5">Detected rooftop area</p>
                  <img src={result.images.mask} alt="Outline"
                    className="rounded-xl w-full aspect-square object-cover border border-slate-200 bg-slate-100" />
                </div>
                <div>
                  <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1.5">Proposed panel layout</p>
                  <img src={result.images.placement} alt="Panel layout"
                    className="rounded-xl w-full aspect-square object-cover border border-slate-200" />
                </div>
              </div>
            </div>
          )}
        </>
      )}

    </div>
  )
}
