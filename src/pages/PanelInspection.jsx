import { useEffect, useState } from 'react'
import {
  ScanSearch, AlertTriangle, CheckCircle2, Loader2, ArrowRight,
  Info, ShieldCheck, Camera, MapPin, Image as ImageIcon, Wrench,
} from 'lucide-react'
import clsx from 'clsx'
import { listPanelSamples, inspectPanelSample } from '../services/api'

const SEVERITY = {
  good:     { color: '#10B981', bg: 'bg-emerald-50',  text: 'text-emerald-700', border: 'border-emerald-200' },
  warn:     { color: '#F59E0B', bg: 'bg-amber-50',    text: 'text-amber-700',   border: 'border-amber-200' },
  critical: { color: '#EF4444', bg: 'bg-red-50',      text: 'text-red-700',     border: 'border-red-200' },
}

// Customer-friendly defect labels and explanations.
// We keep the technical term (used by the AI / industry) plus a plain-English label.
const DEFECT_INFO = {
  black_core: {
    label: 'Burnt cell',
    technical: 'black core',
    explainer:
      'A solar cell has overheated and is no longer producing electricity. ' +
      'This can come from a manufacturing flaw, a long-term hot spot, or partial shading.',
    severity: 'critical',
  },
  crack: {
    label: 'Cell crack',
    technical: 'crack',
    explainer:
      'A physical fracture in the silicon — usually from impact, hail, or thermal stress. ' +
      'The crack can grow over time and progressively reduce output.',
    severity: 'critical',
  },
  finger: {
    label: 'Broken connector lines',
    technical: 'finger',
    explainer:
      'The thin metallic "fingers" that collect electricity inside the cell are damaged. ' +
      'Production drops, but the panel can still operate at reduced output.',
    severity: 'warn',
  },
  horizontal_dislocation: {
    label: 'Cell misalignment',
    technical: 'horizontal dislocation',
    explainer:
      'A row of cells is shifted out of place — typically a manufacturing defect. ' +
      'Performance is uneven across the panel.',
    severity: 'warn',
  },
  short_circuit: {
    label: 'Short circuit',
    technical: 'short circuit',
    explainer:
      'An electrical fault inside the cell — current bypasses the load. ' +
      'Significant safety and fire risk if left unattended.',
    severity: 'critical',
  },
  thick_line: {
    label: 'Damaged busbar',
    technical: 'thick line',
    explainer:
      'The main current-collection bar (busbar) is degraded. The panel under-performs and the ' +
      'damage often spreads to neighboring cells.',
    severity: 'warn',
  },
}

function defectFullLabel(info) {
  if (!info) return null
  return info.technical && info.technical !== info.label.toLowerCase()
    ? `${info.label} (${info.technical})`
    : info.label
}

function getOutcome(result) {
  const isHealthy = result?.panel_status === 'Healthy'
  if (isHealthy) {
    return {
      title: 'Panel is in good condition',
      subtitle: 'No defects detected. The panel is operating normally.',
      severity: 'good',
      Icon: CheckCircle2,
      actions: [
        'No action required — keep the panel in service.',
        'Schedule next routine inspection in 12 months.',
      ],
    }
  }
  const defect = result?.step2_defect_type?.defect_type
  const info = DEFECT_INFO[defect] || {
    label: result?.step2_defect_type?.defect_type_pretty || 'Unknown defect',
    technical: defect || 'unknown',
    explainer: 'A defect was detected on this panel.',
    severity: 'warn',
  }
  const fullLabel = defectFullLabel(info) || info.label
  if (info.severity === 'critical') {
    return {
      title: `${fullLabel} detected`,
      subtitle: info.explainer,
      severity: 'critical',
      Icon: AlertTriangle,
      actions: [
        'Schedule replacement within the next 30 days.',
        'Disconnect the panel if a safety risk is suspected (short circuit, burnt cell).',
        'Document the location and serial number for the warranty claim.',
        'Notify the maintenance team immediately.',
      ],
    }
  }
  return {
    title: `${fullLabel} detected`,
    subtitle: info.explainer,
    severity: 'warn',
    Icon: AlertTriangle,
    actions: [
      'Schedule a deeper inspection within 2 weeks.',
      'Continue monitoring this panel\'s output for accelerated degradation.',
      'Plan for replacement in the next maintenance cycle if the defect spreads.',
    ],
  }
}

function PanelTile({ sample, active, running, onClick }) {
  const isRunning = running && active
  return (
    <button
      onClick={() => onClick(sample.id)}
      disabled={running || !sample.available}
      className={clsx(
        'relative text-left border rounded-xl p-4 transition-all flex flex-col gap-3',
        'hover:border-violet-300 hover:shadow-md',
        active ? 'border-violet-400 bg-gradient-to-br from-violet-50 to-purple-50/60 shadow-md'
               : 'border-slate-200 bg-white',
        running && !active && 'opacity-50 cursor-not-allowed',
        !sample.available && 'opacity-50 cursor-not-allowed',
      )}>
      <div className="flex items-center gap-2.5">
        <div className={clsx(
          'w-9 h-9 rounded-lg flex items-center justify-center',
          active ? 'bg-violet-500 text-white' : 'bg-slate-100 text-slate-500'
        )}>
          <Camera size={17} />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-800">{sample.label}</p>
          <p className="text-[11px] text-slate-500">{sample.subtitle}</p>
        </div>
      </div>
      <div className={clsx(
        'mt-auto text-xs font-semibold rounded-lg py-2 px-3 flex items-center justify-center gap-1.5 transition',
        isRunning
          ? 'bg-violet-100 text-violet-700'
          : active
            ? 'bg-violet-500 text-white'
            : 'bg-slate-50 text-slate-700'
      )}>
        {isRunning
          ? <><Loader2 size={13} className="animate-spin" /> Inspecting…</>
          : <>Run inspection <ArrowRight size={13} /></>}
      </div>
    </button>
  )
}

export default function PanelInspection() {
  const [samples, setSamples] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeId, setActiveId] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    listPanelSamples()
      .then(d => setSamples(d.samples || []))
      .catch(e => setError(`Could not load panel list: ${e.message}`))
  }, [])

  const runInspection = async (id) => {
    setLoading(true); setError(null); setResult(null); setActiveId(id)
    try {
      const data = await inspectPanelSample(id)
      setResult(data)
    } catch (e) {
      setError(e.message || 'Inspection failed')
    } finally {
      setLoading(false)
    }
  }

  const outcome = result ? getOutcome(result) : null
  const sev = outcome ? SEVERITY[outcome.severity] : null
  const isHealthy = result?.panel_status === 'Healthy'

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
            <ScanSearch size={16} className="text-violet-600" />
          </div>
          <h1 className="page-title">Panel Damage Inspection</h1>
        </div>
        <p className="page-subtitle ml-11">
          Catch defective solar panels before they cost you energy. The AI scans
          a close-up photo and tells you whether the panel is healthy, what's wrong,
          and where on the panel the damage sits.
        </p>
      </div>

      {/* INTRO (idle) */}
      {!result && !loading && (
        <div className="card bg-gradient-to-r from-violet-50 to-purple-50/40 border-violet-100">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-violet-500 text-white flex items-center justify-center flex-shrink-0">
              <Info size={17} />
            </div>
            <div>
              <h3 className="text-slate-800 font-semibold text-sm mb-1">
                Why this matters
              </h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                A defective panel keeps drawing power from the rest of the array,
                lowering total output by 5-15 % and sometimes causing safety risks.
                Catching damage early — before performance degrades — saves both
                energy and replacement costs.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* SAMPLES */}
      <div className="card">
        <h2 className="text-slate-700 font-semibold text-sm uppercase tracking-wide mb-4">
          Pick a panel to inspect
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {samples.map(s => (
            <PanelTile
              key={s.id}
              sample={s}
              active={activeId === s.id}
              running={loading}
              onClick={runInspection}
            />
          ))}
        </div>
      </div>

      {/* ERROR */}
      {error && (
        <div className="card">
          <div className="rounded-lg px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-sm flex items-start gap-2">
            <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Something went wrong</p>
              <p className="text-xs mt-0.5">{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* LOADING */}
      {loading && (
        <div className="card flex flex-col items-center justify-center py-10 gap-3">
          <Loader2 size={32} className="text-violet-600 animate-spin" />
          <p className="text-slate-600 text-sm">Scanning the panel for damage…</p>
        </div>
      )}

      {/* RESULT */}
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
                {result.label && (
                  <p className="text-slate-500 text-xs mt-2 flex items-center gap-1.5">
                    <MapPin size={11} /> {result.label}
                  </p>
                )}
              </div>
            </div>

            {/* Confidence row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className={clsx(
                'rounded-xl p-4 border',
                isHealthy ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'
              )}>
                <p className={clsx(
                  'text-[10px] uppercase tracking-wide font-semibold mb-1',
                  isHealthy ? 'text-emerald-700' : 'text-red-700'
                )}>
                  Health verdict
                </p>
                <p className="text-slate-900 font-bold text-lg">
                  {isHealthy ? '✓ Healthy' : '✗ Damaged'}
                </p>
                <p className="text-slate-500 text-[11px] mt-1">
                  AI confidence: {result.step1_binary?.confidence_pct}%
                </p>
              </div>

              {result.step2_defect_type ? (
                <div className="rounded-xl p-4 border border-slate-200 bg-white">
                  <p className="text-slate-500 text-[10px] uppercase tracking-wide font-semibold mb-1">
                    Damage type
                  </p>
                  <p className="text-slate-900 font-bold text-lg">
                    {defectFullLabel(DEFECT_INFO[result.step2_defect_type.defect_type])
                      || result.step2_defect_type.defect_type_pretty}
                  </p>
                  <p className="text-slate-500 text-[11px] mt-1">
                    AI confidence: {result.step2_defect_type.confidence_pct}%
                  </p>
                </div>
              ) : (
                <div className="rounded-xl p-4 border border-slate-200 bg-slate-50">
                  <p className="text-slate-500 text-[10px] uppercase tracking-wide font-semibold mb-1">
                    Damage type
                  </p>
                  <p className="text-slate-400 text-sm italic mt-2">No defect to classify</p>
                </div>
              )}

              <div className="rounded-xl p-4 border border-slate-200 bg-white">
                <p className="text-slate-500 text-[10px] uppercase tracking-wide font-semibold mb-1">
                  Damage zones found
                </p>
                <p className="text-slate-900 font-bold text-lg">
                  {result.step3_localization?.regions?.length
                    ? `${result.step3_localization.n_regions} zone${result.step3_localization.n_regions > 1 ? 's' : ''}`
                    : '—'}
                </p>
                <p className="text-slate-500 text-[11px] mt-1">
                  {result.severity ? `Severity: ${result.severity}` : 'No localization needed'}
                </p>
              </div>
            </div>

            {/* Top-3 alternatives — only if defective and we have them */}
            {result.step2_defect_type?.top3 && result.step2_defect_type.top3.length > 1 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-slate-700 text-xs font-semibold uppercase tracking-wide mb-3">
                  AI-considered alternatives
                </p>
                <div className="space-y-1.5">
                  {result.step2_defect_type.top3.map(t => {
                    const k = t.name?.toLowerCase()?.replace(/ /g, '_')
                    const info = DEFECT_INFO[k]
                    return (
                    <div key={t.name} className="flex items-center gap-2">
                      <span className="text-slate-700 text-xs flex-1">
                        {defectFullLabel(info) || t.name}
                      </span>
                      <div className="flex-[2] h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div className="h-full bg-violet-400 rounded-full"
                          style={{ width: `${t.prob_pct}%` }} />
                      </div>
                      <span className="text-slate-600 text-[10px] font-mono w-10 text-right">
                        {t.prob_pct}%
                      </span>
                    </div>
                  )})}
                </div>
              </div>
            )}

            {/* Recommended actions */}
            <div className={clsx('rounded-lg p-4 border', sev.bg, sev.border)}>
              <div className="flex items-center gap-2 mb-2">
                <Wrench size={16} className={sev.text} />
                <p className={clsx('text-xs font-semibold uppercase tracking-wide', sev.text)}>
                  Recommended actions
                </p>
              </div>
              <ul className="space-y-1.5 ml-1">
                {outcome.actions.map((a, i) => (
                  <li key={i} className="text-slate-700 text-sm flex items-start gap-2">
                    <span className="mt-2 w-1 h-1 rounded-full flex-shrink-0"
                      style={{ background: sev.color }} />
                    <span>{a}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* What the AI saw — visualizations */}
          {!isHealthy && result.images && (
            <div className="card">
              <h2 className="text-slate-700 font-semibold text-sm uppercase tracking-wide mb-1 flex items-center gap-2">
                <ImageIcon size={15} className="text-violet-600" />
                Where the damage is
              </h2>
              <p className="text-[11px] text-slate-500 mb-3">
                The original panel scan, a heat map showing where the AI sees damage,
                and the same damage outlined as boxes — to direct the maintenance team.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1.5">
                    Original panel scan
                  </p>
                  <img src={result.images.original} alt="Panel"
                    className="rounded-xl w-full aspect-square object-cover border border-slate-200 bg-slate-100" />
                </div>
                <div>
                  <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1.5">
                    Damage heat map
                  </p>
                  {result.images.heatmap ? (
                    <img src={result.images.heatmap} alt="Heatmap"
                      className="rounded-xl w-full aspect-square object-cover border border-slate-200" />
                  ) : (
                    <div className="rounded-xl w-full aspect-square border border-slate-200 bg-slate-100 flex items-center justify-center text-slate-400 text-xs">
                      Not available
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-slate-500 text-[10px] uppercase tracking-wide mb-1.5">
                    Damage zones outlined
                  </p>
                  {result.images.bboxes ? (
                    <img src={result.images.bboxes} alt="Boxes"
                      className="rounded-xl w-full aspect-square object-cover border border-slate-200" />
                  ) : (
                    <div className="rounded-xl w-full aspect-square border border-slate-200 bg-slate-100 flex items-center justify-center text-slate-400 text-xs">
                      Not available
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* HOW IT WORKS — idle */}
      {!result && !loading && (
        <div className="card">
          <h3 className="text-slate-700 text-sm font-semibold mb-4 uppercase tracking-wide">
            How it works
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { step: '1', icon: Camera, title: 'Take a close-up scan',
                desc: 'A handheld camera captures a high-resolution image of the panel surface.' },
              { step: '2', icon: ShieldCheck, title: 'Healthy or damaged?',
                desc: 'A first AI says whether the panel is healthy or shows any damage.' },
              { step: '3', icon: ScanSearch, title: 'What kind of damage?',
                desc: 'If damaged, a second AI identifies the type — burnt cell (black core), crack, broken finger lines, short circuit, busbar damage…' },
              { step: '4', icon: MapPin, title: 'Where exactly?',
                desc: 'A third AI highlights the damaged zones so the maintenance team knows where to look.' },
            ].map(s => {
              const Ic = s.icon
              return (
                <div key={s.step} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-7 h-7 rounded-full bg-violet-500 text-white text-xs font-bold flex items-center justify-center">
                      {s.step}
                    </span>
                    <Ic size={15} className="text-violet-600" />
                  </div>
                  <p className="text-slate-800 text-sm font-semibold mb-1">{s.title}</p>
                  <p className="text-slate-500 text-xs leading-relaxed">{s.desc}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
