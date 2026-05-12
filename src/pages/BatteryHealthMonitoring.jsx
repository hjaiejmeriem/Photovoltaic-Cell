import { useEffect, useState } from 'react'
import {
  BatteryFull, BatteryWarning, BatteryLow, Loader2, AlertTriangle,
  CheckCircle2, ShieldCheck, ArrowRight, Info, Wrench, CalendarClock,
  Activity, Thermometer, MapPin, Flame,
} from 'lucide-react'
import clsx from 'clsx'
import { listBatterySamples, predictBatterySampleById } from '../services/api'

// ────────────────────────────────────────────────────────
// Translate the model's SoH score into customer-friendly content.
// SoH ∈ [0, 1] = State of Health, the standard battery industry metric.
// 1.0 = brand new ; 0.8 = mid-life ; below 0.7 = end-of-life
// ────────────────────────────────────────────────────────
function getOutcome(soh) {
  const pct = soh * 100
  if (soh >= 0.90) {
    return {
      title: 'Battery is in excellent condition',
      subtitle: 'No degradation detected. The unit is performing like new.',
      verdictLabel: 'Healthy',
      severity: 'good',
      Icon: BatteryFull,
      actions: [
        'Continue normal operation — no maintenance required.',
        'Schedule the next health check in 6 months.',
        'Operate within the manufacturer\'s recommended temperature range.',
      ],
    }
  }
  if (soh >= 0.70) {
    return {
      title: 'Battery is starting to degrade',
      subtitle: `Capacity is at ${pct.toFixed(0)}% of its original specification — early signs of wear.`,
      verdictLabel: 'Monitor closely',
      severity: 'warn',
      Icon: BatteryWarning,
      actions: [
        'Schedule a deep diagnostic within 2 weeks.',
        'Reduce depth-of-discharge to 80% to extend remaining life.',
        'Monitor cell temperatures daily; check ventilation airflow.',
        'Plan for replacement in the next 6–12 months.',
      ],
    }
  }
  return {
    title: 'Battery should be replaced',
    subtitle: `Capacity has fallen to ${pct.toFixed(0)}% of original — performance is significantly impaired and failure risk is high.`,
    verdictLabel: 'Replace now',
    severity: 'critical',
    Icon: BatteryLow,
    actions: [
      'Plan immediate replacement to avoid unexpected outage.',
      'Avoid full discharges and high-current charging until swap.',
      'Switch critical loads to backup power source.',
      'Notify maintenance team and order replacement unit.',
    ],
  }
}

const SEVERITY = {
  good:     { color: '#10B981', bg: 'bg-emerald-50',  text: 'text-emerald-700', border: 'border-emerald-200' },
  warn:     { color: '#F59E0B', bg: 'bg-amber-50',    text: 'text-amber-700',   border: 'border-amber-200' },
  critical: { color: '#EF4444', bg: 'bg-red-50',      text: 'text-red-700',     border: 'border-red-200' },
}

// ────────────────────────────────────────────────────────
// Big SoH dial — customer-friendly version of the previous SoHGauge
// ────────────────────────────────────────────────────────
function HealthDial({ soh, severity }) {
  const sev = SEVERITY[severity]
  const pct = Math.round(soh * 100)
  const r = 70, cx = 100, cy = 100
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - soh)
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={210} height={210} viewBox="0 0 200 200">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#E2E8F0" strokeWidth={16} />
        <circle
          cx={cx} cy={cy} r={r} fill="none"
          stroke={sev.color} strokeWidth={16}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dashoffset 0.8s ease, stroke 0.4s ease' }}
        />
        <text x={cx} y={cy - 4} textAnchor="middle" fill="#0F172A"
          fontSize={42} fontWeight="bold" fontFamily="ui-monospace, monospace">
          {pct}%
        </text>
        <text x={cx} y={cy + 22} textAnchor="middle" fill="#94A3B8" fontSize={10}
          style={{ letterSpacing: '1.5px' }}>
          REMAINING CAPACITY
        </text>
      </svg>
    </div>
  )
}

// ────────────────────────────────────────────────────────
// Battery tile — like a fleet card, one click to inspect
// ────────────────────────────────────────────────────────
function BatteryTile({ sample, active, running, onClick }) {
  const isRunning = running && active
  return (
    <button
      onClick={() => onClick(sample.id)}
      disabled={running || !sample.available}
      className={clsx(
        'relative text-left border rounded-xl p-4 transition-all flex flex-col gap-3',
        'hover:border-teal-300 hover:shadow-md',
        active ? 'border-teal-400 bg-gradient-to-br from-teal-50 to-emerald-50/60 shadow-md'
               : 'border-slate-200 bg-white',
        running && !active && 'opacity-50 cursor-not-allowed',
        !sample.available && 'opacity-50 cursor-not-allowed',
      )}>
      <div className="flex items-center gap-2.5">
        <div className={clsx(
          'w-9 h-9 rounded-lg flex items-center justify-center',
          active ? 'bg-teal-500 text-white' : 'bg-slate-100 text-slate-500'
        )}>
          <BatteryFull size={17} />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-800">{sample.label}</p>
          <p className="text-[11px] text-slate-500 flex items-center gap-1">
            <MapPin size={10} /> {sample.site}
          </p>
        </div>
      </div>
      <p className="text-[11px] text-slate-500 leading-snug">{sample.description}</p>
      <div className={clsx(
        'mt-auto text-xs font-semibold rounded-lg py-2 px-3 flex items-center justify-center gap-1.5 transition',
        isRunning
          ? 'bg-teal-100 text-teal-700'
          : active
            ? 'bg-teal-500 text-white'
            : 'bg-slate-50 text-slate-700'
      )}>
        {isRunning
          ? <><Loader2 size={13} className="animate-spin" /> Running health check…</>
          : <>Run health check <ArrowRight size={13} /></>}
      </div>
    </button>
  )
}

// ────────────────────────────────────────────────────────
export default function BatteryHealthMonitoring() {
  const [samples, setSamples] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeSampleId, setActiveSampleId] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    listBatterySamples()
      .then(d => setSamples(d.samples || []))
      .catch(e => setError(`Could not load battery list: ${e.message}`))
  }, [])

  const runCheck = async (id) => {
    setLoading(true); setError(null); setResult(null); setActiveSampleId(id)
    try {
      const data = await predictBatterySampleById(id)
      setResult(data)
    } catch (e) {
      setError(e.message || 'Health check failed')
    } finally {
      setLoading(false)
    }
  }

  const outcome = result ? getOutcome(result.soh) : null
  const sev = outcome ? SEVERITY[outcome.severity] : null

  return (
    <div className="space-y-6">
      {/* ── PAGE HEADER ── */}
      <div className="page-header">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-lg bg-teal-100 flex items-center justify-center">
            <BatteryFull size={16} className="text-teal-600" />
          </div>
          <h1 className="page-title">Battery Health Monitor</h1>
        </div>
        <p className="page-subtitle ml-11">
          Inspect every battery in your fleet before it fails. Combines a thermal scan
          and operational history to estimate how much life is left in each unit.
        </p>
      </div>

      {/* ── INTRO (only when idle) ── */}
      {!result && !loading && (
        <div className="card bg-gradient-to-r from-teal-50 to-emerald-50/40 border-teal-100">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-teal-500 text-white flex items-center justify-center flex-shrink-0">
              <Info size={17} />
            </div>
            <div>
              <h3 className="text-slate-800 font-semibold text-sm mb-1">
                What this tool tells you
              </h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                Solar storage batteries lose capacity slowly over years. Replacing them too early
                wastes money; replacing them too late causes blackouts. This AI estimates each
                unit's <span className="font-semibold">remaining capacity</span> (State of Health)
                from a thermal scan and recent operational data — so you know exactly when to
                schedule a swap.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── BATTERY FLEET PICKER ── */}
      <div className="card">
        <h2 className="text-slate-700 font-semibold text-sm uppercase tracking-wide mb-4">
          Pick a battery to inspect
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {samples.map(s => (
            <BatteryTile
              key={s.id}
              sample={s}
              active={activeSampleId === s.id}
              running={loading}
              onClick={runCheck}
            />
          ))}
        </div>
      </div>

      {/* ── ERROR ── */}
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

      {/* ── LOADING ── */}
      {loading && (
        <div className="card flex flex-col items-center justify-center py-10 gap-3">
          <Loader2 size={32} className="text-teal-600 animate-spin" />
          <p className="text-slate-600 text-sm">Running diagnostic…</p>
          <p className="text-slate-400 text-xs">Comparing thermal scan against the unit's operating history.</p>
        </div>
      )}

      {/* ── RESULT ── */}
      {result && outcome && (
        <>
          {/* HEADLINE */}
          <div className="card space-y-5">
            <div className="flex items-start gap-4">
              <div className={clsx(
                'w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0',
                sev.bg
              )}>
                <outcome.Icon size={26} style={{ color: sev.color }} strokeWidth={2} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-bold text-slate-900">{outcome.title}</h2>
                  <span className={clsx(
                    'text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider',
                    sev.bg, sev.text, sev.border
                  )}>
                    {outcome.verdictLabel}
                  </span>
                </div>
                <p className="text-slate-600 text-sm mt-1">{outcome.subtitle}</p>
                {result.label && (
                  <p className="text-slate-500 text-xs mt-2 flex items-center gap-1.5">
                    <MapPin size={11} /> {result.label}
                  </p>
                )}
              </div>
            </div>

            {/* Big dial */}
            <div className="flex flex-col sm:flex-row items-center gap-6 pt-2">
              <HealthDial soh={result.soh} severity={outcome.severity} />
              <div className="flex-1 space-y-3">
                <div className={clsx('rounded-xl p-4 border', sev.bg, sev.border)}>
                  <p className={clsx('text-xs font-semibold uppercase tracking-wide mb-1', sev.text)}>
                    What this means
                  </p>
                  <p className="text-slate-700 text-sm">
                    A new battery starts at 100% capacity. Below 70% it can no longer reliably
                    cover full demand cycles — that's the industry replacement threshold.
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg p-2 border border-emerald-200 bg-emerald-50">
                    <p className="text-[10px] font-semibold text-emerald-700 uppercase">Healthy</p>
                    <p className="text-[10px] text-slate-500">≥ 90%</p>
                  </div>
                  <div className="rounded-lg p-2 border border-amber-200 bg-amber-50">
                    <p className="text-[10px] font-semibold text-amber-700 uppercase">Monitor</p>
                    <p className="text-[10px] text-slate-500">70 – 89%</p>
                  </div>
                  <div className="rounded-lg p-2 border border-red-200 bg-red-50">
                    <p className="text-[10px] font-semibold text-red-700 uppercase">Replace</p>
                    <p className="text-[10px] text-slate-500">&lt; 70%</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Recommended actions */}
            <div className={clsx('rounded-lg p-4 border', sev.bg, sev.border)}>
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck size={16} className={sev.text} />
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

          {/* THERMAL SCAN */}
          {result.thermal_image && (
            <div className="card">
              <h2 className="text-slate-700 font-semibold text-sm uppercase tracking-wide mb-1 flex items-center gap-2">
                <Flame size={15} className="text-teal-600" />
                Thermal scan
              </h2>
              <p className="text-[11px] text-slate-500 mb-3">
                Heat map of the battery surface. Hot spots can signal weakened cells —
                the AI looks at this image plus operational data to estimate health.
              </p>
              <div className="flex items-start gap-4">
                <img src={result.thermal_image} alt="Thermal scan"
                  className="rounded-xl max-w-xs border border-slate-200" />
                <div className="flex-1 space-y-2 pt-1">
                  <div className="flex items-start gap-2">
                    <Thermometer size={14} className="text-slate-400 mt-0.5" />
                    <p className="text-xs text-slate-600">
                      <span className="font-semibold">How to read it:</span> blue = cool,
                      red/yellow = hot. Uniform color = healthy. Bright hot patches =
                      cells under stress.
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    <Activity size={14} className="text-slate-400 mt-0.5" />
                    <p className="text-xs text-slate-600">
                      <span className="font-semibold">What the AI checks:</span> the thermal
                      pattern is combined with charge/discharge history, voltage profile, and
                      cycle count to produce the State of Health score.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── HOW IT WORKS ── */}
      {!result && !loading && (
        <div className="card">
          <h3 className="text-slate-700 text-sm font-semibold mb-4 uppercase tracking-wide">
            How it works
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { step: '1', icon: Flame, title: 'Thermal scan',
                desc: 'A handheld or fixed thermal camera captures the battery surface heat pattern.' },
              { step: '2', icon: Activity, title: 'Operating history',
                desc: 'The unit\'s recent voltage, temperature, charge cycles and capacity data are pulled.' },
              { step: '3', icon: BatteryFull, title: 'AI health estimate',
                desc: 'A neural network combines both signals and outputs the remaining capacity %.' },
              { step: '4', icon: CalendarClock, title: 'Maintenance schedule',
                desc: 'You get a clear verdict — keep, monitor, or replace — with concrete next steps.' },
            ].map(s => {
              const Ic = s.icon
              return (
                <div key={s.step} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-7 h-7 rounded-full bg-teal-500 text-white text-xs font-bold flex items-center justify-center">
                      {s.step}
                    </span>
                    <Ic size={15} className="text-teal-600" />
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
