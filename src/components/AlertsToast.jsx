import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BellRing, AlertTriangle, X, ArrowRight, ScanSearch, BatteryFull, TrendingDown,
} from 'lucide-react'
import clsx from 'clsx'
import {
  inspectPanelSample, predictBatterySampleById, getRampLiveTick,
} from '../services/api'
import { expertStore } from '../services/expertStore'

const POLL_INTERVAL_MS = 60_000             // re-check every 60 s
const FIRST_POLL_DELAY_MS = 1_500           // tiny delay so the layout settles
const SEEN_KEY = 'solarys-seen-alerts'      // alerts already shown once
const DISMISSED_KEY = 'solarys-dismissed-alerts'  // alerts the user explicitly closed
// Shared key with the Live Solar Forecasting page so a ramp dismissal
// on EITHER surface mutes it on the other.
const RAMP_DISMISSED_KEY = 'solarys-ramp-alerts-dismissed'

function readSeen() {
  try { return JSON.parse(sessionStorage.getItem(SEEN_KEY) || '[]') }
  catch { return [] }
}
function writeSeen(ids) {
  try { sessionStorage.setItem(SEEN_KEY, JSON.stringify(ids)) } catch {}
}
function readDismissed() {
  try { return JSON.parse(sessionStorage.getItem(DISMISSED_KEY) || '[]') }
  catch { return [] }
}
function writeDismissed(ids) {
  try { sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(ids)) } catch {}
}
function readRampDismissed() {
  try { return JSON.parse(sessionStorage.getItem(RAMP_DISMISSED_KEY) || '[]') }
  catch { return [] }
}
function writeRampDismissed(arr) {
  try { sessionStorage.setItem(RAMP_DISMISSED_KEY, JSON.stringify(arr)) } catch {}
}

// Stable per-episode key for ramp alerts — identical to the one used on
// the Live Forecasting page. As long as the alert characteristics
// (direction, severity, trigger source) don't change, the key stays the
// same → no re-toast every 60 s.
function rampEpisodeKey(tick) {
  if (!tick?.sudden_ramp_detected) return null
  const dir = tick.ramp_pct_t_plus_15 < 0 ? 'down' : 'up'
  const sev = tick.severity_pct >= 65 ? 'crit' : 'warn'
  const trig = tick.meteo_stress ? 'meteo' : 'model'
  return `${dir}-${sev}-${trig}`
}

const ICON = {
  panel:   ScanSearch,
  battery: BatteryFull,
  ramp:    TrendingDown,
}
// Softer, less aggressive palette — pastel borders, deeper accent for icons
const SEVERITY_PALETTE = {
  critical: {
    accent:    '#E11D48',   // rose-600
    bg:        'linear-gradient(135deg, #FFF1F2 0%, #FFE4E6 100%)',
    border:    '#FECDD3',
    iconBg:    '#FFE4E6',
    softShadow:'0 16px 40px rgba(225,29,72,0.18)',
  },
  warn: {
    accent:    '#D97706',   // amber-600
    bg:        'linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)',
    border:    '#FDE68A',
    iconBg:    '#FEF3C7',
    softShadow:'0 16px 40px rgba(217,119,6,0.18)',
  },
}

// ────────────────────────────────────────────────────────
// Polls all 3 alert sources and surfaces NEW alerts as toasts.
// "New" = id never shown in this session (sessionStorage).
// ────────────────────────────────────────────────────────
export default function AlertsToast() {
  const [stack, setStack] = useState([])    // alerts currently shown as toasts
  const seenRef = useRef(new Set(readSeen()))
  const dismissedRef = useRef(new Set(readDismissed()))   // user-closed (toast or page)
  const timerRef = useRef(null)

  const fetchAlerts = async () => {
    // Always re-read dismissed sets from storage in case the Live
    // Forecasting page wrote to them since the last poll.
    dismissedRef.current = new Set([
      ...readDismissed(),
      ...readRampDismissed().map(k => `ramp:${k}`),
    ])
    // Panel and battery toasts are ONLY based on real uploads done in
    // this session. No fallback to bundled demo samples — otherwise the
    // toast would always pop noise from `panel_a` / `sample2` even when
    // the operator never touched those modules.
    const storedPanel = expertStore.getPanel()
    const storedBattery = expertStore.getBattery()
    const [panel, battery, ramp] = await Promise.allSettled([
      storedPanel ? Promise.resolve(storedPanel) : Promise.resolve(null),
      storedBattery ? Promise.resolve(storedBattery) : Promise.resolve(null),
      getRampLiveTick({ simulateAlert: false }),
    ])

    const collected = []

    if (panel.status === 'fulfilled' && panel.value) {
      const data = panel.value
      if (data.panel_status === 'Defective') {
        const isCritical = ['black_core', 'crack', 'short_circuit']
          .includes(data.step2_defect_type?.defect_type)
        collected.push({
          id: `panel:panel_a:${data.step2_defect_type?.defect_type}`,
          source: 'panel',
          severity: isCritical ? 'critical' : 'warn',
          title: `Damage on ${data.label || 'Panel A'}`,
          body: data.step2_defect_type?.defect_type_pretty
            ? `Defect: ${data.step2_defect_type.defect_type_pretty} · severity ${data.severity || '—'}`
            : 'A defect was detected on this panel.',
          link: '/expert/diagnostic',
          linkLabel: 'Open diagnostic',
        })
      }
    }

    if (battery.status === 'fulfilled' && battery.value) {
      const data = battery.value
      if (data.status !== 'Healthy') {
        collected.push({
          id: `battery:${data.source}:${data.status}`,
          source: 'battery',
          severity: data.status === 'Warning' ? 'warn' : 'critical',
          title: data.status === 'Warning'
            ? `Battery at ${Math.round(data.soh * 100)}% capacity`
            : 'Battery below replacement threshold',
          body: data.message,
          link: '/expert/diagnostic',
          linkLabel: 'Open diagnostic',
        })
      }
    }

    if (ramp.status === 'fulfilled') {
      const data = ramp.value
      const episode = rampEpisodeKey(data)
      if (episode) {
        // STABLE id per episode (direction + severity + trigger) — does
        // NOT change at every 60 s tick. As long as the alert keeps the
        // same character, the toast pops once and stays dismissed.
        collected.push({
          id: `ramp:${episode}`,
          source: 'ramp',
          severity: data.severity_pct >= 65 ? 'critical' : 'warn',
          title: `Sudden ${data.ramp_pct_t_plus_15 < 0 ? 'ramp-DOWN' : 'ramp-UP'} predicted`,
          body: `Forecast change ${data.ramp_pct_t_plus_15 >= 0 ? '+' : ''}${data.ramp_pct_t_plus_15.toFixed(1)} pp in next 15 min · severity ${data.severity_pct}/100`,
          link: '/expert/solar-ramp',
          linkLabel: 'Open live forecast',
        })
      }
    }

    // Filter out alerts that have already been shown OR explicitly dismissed.
    const fresh = collected.filter(a =>
      !seenRef.current.has(a.id) && !dismissedRef.current.has(a.id)
    )
    if (fresh.length > 0) {
      // Mark as seen and push onto the stack
      fresh.forEach(a => seenRef.current.add(a.id))
      writeSeen([...seenRef.current])
      setStack(prev => [...fresh, ...prev].slice(0, 4))   // cap visible toasts
    }
  }

  useEffect(() => {
    const t1 = setTimeout(fetchAlerts, FIRST_POLL_DELAY_MS)
    timerRef.current = setInterval(fetchAlerts, POLL_INTERVAL_MS)
    return () => {
      clearTimeout(t1)
      clearInterval(timerRef.current)
    }
    // eslint-disable-next-line
  }, [])

  const dismiss = (id) => {
    // Persist the dismissal so this alert never re-pops in the same tab,
    // even if the underlying condition is still active.
    dismissedRef.current.add(id)
    writeDismissed([...dismissedRef.current])
    // Mirror to the ramp-specific dismissed set so the Live Forecasting
    // page's banner respects the same dismissal.
    if (id.startsWith('ramp:')) {
      const episode = id.slice('ramp:'.length)
      const arr = Array.from(new Set([...readRampDismissed(), episode]))
      writeRampDismissed(arr)
    }
    setStack(prev => prev.filter(a => a.id !== id))
  }

  if (stack.length === 0) return null

  return (
    <div className="fixed top-5 right-5 z-[60] flex flex-col gap-3 max-w-sm">
      {stack.map(a => (
        <Toast key={a.id} alert={a} onClose={() => dismiss(a.id)} />
      ))}
    </div>
  )
}

function Toast({ alert, onClose }) {
  const Icon = ICON[alert.source] || BellRing
  const p = SEVERITY_PALETTE[alert.severity] || SEVERITY_PALETTE.warn
  return (
    <div className="rounded-2xl p-4 backdrop-blur-md animate-fade-up overflow-hidden"
      style={{
        background: p.bg,
        border: `1px solid ${p.border}`,
        boxShadow: p.softShadow,
      }}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: p.iconBg }}>
          <Icon size={18} style={{ color: p.accent }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <BellRing size={10} style={{ color: p.accent }} />
            <p className="text-[10px] uppercase tracking-wider font-bold" style={{ color: p.accent }}>
              {alert.severity === 'critical' ? 'Action required' : 'Alert'}
            </p>
          </div>
          <p className="font-bold text-slate-900 text-sm leading-snug">{alert.title}</p>
          <p className="text-slate-600 text-xs mt-1 leading-relaxed">{alert.body}</p>
          {alert.link && (
            <Link to={alert.link} onClick={onClose}
              className="inline-flex items-center gap-1 text-xs font-bold mt-2.5 hover:gap-2 transition-all"
              style={{ color: p.accent }}>
              {alert.linkLabel || 'Open'} <ArrowRight size={12} />
            </Link>
          )}
        </div>
        <button onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-white/50 transition flex-shrink-0">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
