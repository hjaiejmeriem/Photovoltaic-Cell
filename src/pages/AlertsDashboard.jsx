import { useEffect, useState } from 'react'
import {
  BellRing, AlertTriangle, CheckCircle2, ScanSearch, BatteryFull,
  TrendingDown, ArrowRight, Loader2, RefreshCw, Sparkles, Check, Undo2,
  Archive,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  inspectPanelSample, predictBatterySampleById, getRampLiveTick,
} from '../services/api'
import { expertStore } from '../services/expertStore'

const COLORS = {
  critical: '#E11D48',  // rose-600
  warn:     '#D97706',  // amber-600
}
const SEV_LABEL = { critical: 'Action required', warn: 'Watch' }

// ── Persistent log of alerts the operator has marked as handled ──
// Stored per-tab. Each entry is a snapshot taken at the moment of
// marking — so even if the underlying condition is later resolved at
// the source (panel fixed, ramp event passed), the handled record
// remains visible in the "Processed" section for analysis & audit.
const HANDLED_KEY = 'solarys-handled-alerts'
const readHandled = () => {
  try { return JSON.parse(sessionStorage.getItem(HANDLED_KEY) || '[]') }
  catch { return [] }
}
const writeHandled = (arr) => {
  try { sessionStorage.setItem(HANDLED_KEY, JSON.stringify(arr)) } catch {}
}
const fmtDateTime = (ts) => {
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      + ' · ' + d.toLocaleDateString([], { day: '2-digit', month: 'short' })
  } catch { return '' }
}

export default function AlertsDashboard() {
  const [loading, setLoading] = useState(true)
  const [alerts, setAlerts] = useState([])
  const [error, setError] = useState(null)
  const [handled, setHandled] = useState(() => readHandled())
  const handledIds = new Set(handled.map(h => h.id))

  // Mark an active alert as handled — moves it to the "Processed" section
  // and snapshots its content so it survives even if the source clears.
  const markHandled = (alert) => {
    const snap = {
      ...alert,
      handledAt: Date.now(),
    }
    // Strip the React icon component (can't JSON.stringify it). We store
    // the source string and re-derive the icon on render.
    const { icon, ...storable } = snap
    const next = [storable, ...handled.filter(h => h.id !== alert.id)]
    setHandled(next)
    writeHandled(next)
  }

  // Restore a handled alert back to the active "To handle" list.
  const unmarkHandled = (id) => {
    const next = handled.filter(h => h.id !== id)
    setHandled(next)
    writeHandled(next)
  }

  const clearAllHandled = () => {
    setHandled([])
    writeHandled([])
  }

  const refresh = async () => {
    setLoading(true); setError(null)
    try {
      // Panel and battery alerts are ONLY generated from real uploads
      // done in this browser session. If the operator hasn't uploaded
      // anything, we skip those sources entirely — no fallback to
      // bundled demo samples, otherwise we'd surface stale demo alerts
      // on every fresh session (panel_a is a defective sample by
      // design, sample2 is a warning battery — both would always
      // trigger noise).
      // The ramp source is always polled because it's truly live.
      const storedPanel = expertStore.getPanel()
      const storedBattery = expertStore.getBattery()

      const [panel, battery, ramp] = await Promise.allSettled([
        storedPanel
          ? Promise.resolve(storedPanel)
          : Promise.resolve(null),    // no upload → no panel source
        storedBattery
          ? Promise.resolve(storedBattery)
          : Promise.resolve(null),    // no upload → no battery source
        getRampLiveTick({ simulateAlert: false }),
      ])

      const collected = []

      if (panel.status === 'fulfilled' && panel.value) {
        const data = panel.value
        if (data.panel_status === 'Defective') {
          const def = data.step2_defect_type?.defect_type_pretty || 'Defect detected'
          const sev = ['black_core', 'crack', 'short_circuit'].includes(data.step2_defect_type?.defect_type)
            ? 'critical' : 'warn'
          collected.push({
            id: 'panel-a', severity: sev, module: 'Panel inspection',
            icon: ScanSearch, title: `Damage detected · ${def}`,
            site: data.label || 'Panel A',
            description:
              `${data.step3_localization?.n_regions || 0} damaged zone(s) located · AI confidence ${data.step1_binary?.confidence_pct}%. ` +
              (sev === 'critical'
                ? 'Replacement recommended within 30 days.'
                : 'Schedule deep inspection within 2 weeks.'),
            link: '/expert/diagnostic',
          })
        }
      }
      if (battery.status === 'fulfilled' && battery.value) {
        const data = battery.value
        if (data.status !== 'Healthy') {
          collected.push({
            id: 'battery-2',
            severity: data.status === 'Warning' ? 'warn' : 'critical',
            module: 'Battery health', icon: BatteryFull,
            title: data.status === 'Warning'
              ? `Battery at ${Math.round(data.soh * 100)}% capacity`
              : 'Battery below replacement threshold',
            site: data.label || 'Battery #2',
            description: data.message,
            link: '/expert/diagnostic',
          })
        }
      }
      if (ramp.status === 'fulfilled') {
        const data = ramp.value
        if (data.sudden_ramp_detected) {
          // Episode-specific id (direction + severity + trigger) so
          // different ramp episodes can be handled independently.
          const dir = data.ramp_pct_t_plus_15 < 0 ? 'down' : 'up'
          const sev = data.severity_pct >= 65 ? 'crit' : 'warn'
          const trig = data.meteo_stress ? 'meteo' : 'model'
          collected.push({
            id: `ramp-${dir}-${sev}-${trig}`,
            severity: data.severity_pct >= 65 ? 'critical' : 'warn',
            module: 'Live forecasting', icon: TrendingDown,
            title: `Sudden ${data.ramp_pct_t_plus_15 < 0 ? 'ramp-DOWN' : 'ramp-UP'} predicted`,
            site: 'Live tick',
            description: `Production change ${data.ramp_pct_t_plus_15 >= 0 ? '+' : ''}${data.ramp_pct_t_plus_15.toFixed(1)} pp in next 15 min · severity ${data.severity_pct}/100.`,
            link: '/expert/solar-ramp',
          })
        }
      }

      setAlerts(collected)
    } catch (e) {
      setError(e.message || 'Could not refresh alerts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // Refresh whenever the operator comes back to the tab — picks up any
    // new uploads done on Inspection/Forecasting pages while away.
    const onFocus = () => refresh()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // eslint-disable-next-line
  }, [])

  // Split active alerts into "to handle" (not yet marked) and skip those
  // already in the handled log (they appear in the Processed section instead).
  const toHandle = alerts.filter(a => !handledIds.has(a.id))
  const counts = {
    critical: toHandle.filter(a => a.severity === 'critical').length,
    warn:     toHandle.filter(a => a.severity === 'warn').length,
    handled:  handled.length,
  }

  // Re-derive the icon for stored (handled) alerts from the module name.
  const iconForModule = (module) => {
    if (module === 'Panel inspection') return ScanSearch
    if (module === 'Battery health') return BatteryFull
    if (module === 'Live forecasting') return TrendingDown
    return BellRing
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* HEADER — same style as Live Solar Forecasting */}
      <div className="page-header">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center">
                <BellRing size={16} className="text-rose-600" />
              </div>
              <h1 className="page-title">Alerts Dashboard</h1>
            </div>
            <p className="page-subtitle ml-11">
              Aggregated, real-time alerts from every module — sorted by severity.
              New alerts also pop up as a notification on top of the page.
            </p>
          </div>
          <button onClick={refresh} disabled={loading}
            className="text-xs font-semibold px-4 py-2.5 rounded-xl bg-slate-900 text-white shadow-sm hover:bg-slate-800 transition disabled:opacity-50 inline-flex items-center gap-2">
            {loading
              ? <><Loader2 size={13} className="animate-spin" /> Refreshing…</>
              : <><RefreshCw size={13} /> Refresh</>}
          </button>
        </div>
      </div>

      {/* All page content in a single white card */}
      <div className="card space-y-7 p-8">

      {/* SUMMARY LINE — minimal, no boxes */}
      {!loading && (
        <div className="flex items-center gap-6 text-sm pb-4 border-b border-slate-200/70 flex-wrap">
          {counts.critical > 0 && (
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              <span className="text-slate-700">
                <strong>{counts.critical}</strong> action {counts.critical > 1 ? 'items' : 'item'}
              </span>
            </div>
          )}
          {counts.warn > 0 && (
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <span className="text-slate-700">
                <strong>{counts.warn}</strong> watch{counts.warn > 1 ? 'ed items' : ' item'}
              </span>
            </div>
          )}
          {counts.critical === 0 && counts.warn === 0 && (
            <div className="flex items-center gap-2">
              <CheckCircle2 size={14} className="text-emerald-500" />
              <span className="text-slate-700">All systems nominal</span>
            </div>
          )}
          {counts.handled > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <Archive size={13} className="text-slate-400" />
              <span className="text-slate-500">
                <strong className="text-slate-700">{counts.handled}</strong> processed
              </span>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="text-sm text-rose-700 bg-rose-50/60 border border-rose-100 rounded-xl px-4 py-2.5">
          {error}
        </div>
      )}

      {loading && alerts.length === 0 && (
        <div className="flex items-center gap-3 text-slate-500 text-sm">
          <Loader2 size={18} className="animate-spin" />
          Polling all modules…
        </div>
      )}

      {!loading && toHandle.length === 0 && handled.length === 0 && !error && (
        <div className="flex items-start gap-3 py-6">
          <div className="w-11 h-11 rounded-2xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 size={20} className="text-emerald-600" />
          </div>
          <div>
            <p className="font-bold text-slate-900">All systems nominal</p>
            <p className="text-slate-500 text-sm mt-1">
              No alerts to display right now. Monitoring continues every 60 seconds.
            </p>
          </div>
        </div>
      )}

      {/* ── SECTION 1 — TO HANDLE ── */}
      {!loading && toHandle.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            <h2 className="text-xs uppercase tracking-[2px] font-bold text-slate-700">
              To handle <span className="text-slate-400 normal-case tracking-normal font-normal">· {toHandle.length}</span>
            </h2>
          </div>
          <div className="space-y-5">
            {toHandle
              .sort((a, b) => (a.severity === 'critical' ? -1 : 1) - (b.severity === 'critical' ? -1 : 1))
              .map(a => (
                <AlertItem key={a.id} alert={a} onMarkHandled={() => markHandled(a)} />
              ))}
          </div>
        </div>
      )}

      {/* ── SECTION 2 — PROCESSED (historical log) ── */}
      {!loading && handled.length > 0 && (
        <div className="space-y-4 pt-2 border-t border-slate-200/70">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Archive size={13} className="text-slate-400" />
              <h2 className="text-xs uppercase tracking-[2px] font-bold text-slate-500">
                Processed <span className="text-slate-400 normal-case tracking-normal font-normal">· {handled.length}</span>
              </h2>
            </div>
            <button onClick={clearAllHandled}
              className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-700 transition">
              Clear log
            </button>
          </div>
          <p className="text-[11px] text-slate-400 -mt-2">
            Snapshot taken at the moment of handling. Useful for post-mortem analysis and decision logs.
          </p>
          <div className="space-y-4">
            {handled.map(h => (
              <HandledItem key={h.id} alert={{ ...h, icon: iconForModule(h.module) }}
                onRestore={() => unmarkHandled(h.id)} />
            ))}
          </div>
        </div>
      )}
      </div>{/* close .card */}
    </div>
  )
}

function AlertItem({ alert, onMarkHandled }) {
  const c = COLORS[alert.severity] || COLORS.warn
  const Icon = alert.icon
  return (
    <div className="relative pl-5 group">
      {/* Left accent bar */}
      <span className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full" style={{ background: c }} />

      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: c + '12' }}>
          <Icon size={18} style={{ color: c }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-[9px] uppercase tracking-wider font-bold" style={{ color: c }}>
              {SEV_LABEL[alert.severity]}
            </span>
            <span className="text-[9px] uppercase tracking-wider text-slate-400">
              {alert.module}{alert.site ? ` · ${alert.site}` : ''}
            </span>
          </div>
          <h3 className="text-slate-900 font-bold text-base leading-snug mb-1.5">
            {alert.title}
          </h3>
          <p className="text-slate-600 text-sm leading-relaxed">
            {alert.description}
          </p>
          <div className="flex items-center gap-3 mt-2.5 flex-wrap">
            {alert.link && (
              <Link to={alert.link}
                className="inline-flex items-center gap-1 text-xs font-bold hover:gap-2 transition-all"
                style={{ color: c }}>
                Open module <ArrowRight size={12} />
              </Link>
            )}
            {onMarkHandled && (
              <button onClick={onMarkHandled}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 transition"
                title="Move to the processed log">
                <Check size={12} /> Mark as handled
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function HandledItem({ alert, onRestore }) {
  const Icon = alert.icon || BellRing
  return (
    <div className="relative pl-5 opacity-80 hover:opacity-100 transition-opacity">
      <span className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-slate-200" />
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-slate-100">
          <Icon size={16} className="text-slate-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
              <CheckCircle2 size={9} /> Handled
            </span>
            <span className="text-[9px] uppercase tracking-wider text-slate-400">
              {alert.module}{alert.site ? ` · ${alert.site}` : ''}
            </span>
            {alert.handledAt && (
              <span className="text-[9px] uppercase tracking-wider text-slate-400">
                · {fmtDateTime(alert.handledAt)}
              </span>
            )}
          </div>
          <h3 className="text-slate-700 font-semibold text-sm leading-snug mb-1 line-through decoration-slate-300">
            {alert.title}
          </h3>
          <p className="text-slate-500 text-xs leading-relaxed">
            {alert.description}
          </p>
          <button onClick={onRestore}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold mt-2 px-2.5 py-1 rounded-md border border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition"
            title="Move back to active alerts">
            <Undo2 size={11} /> Restore to active
          </button>
        </div>
      </div>
    </div>
  )
}
