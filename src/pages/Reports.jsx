import { useState, useEffect } from 'react'
import {
  FileBarChart2, Zap, Satellite, ScanSearch, BatteryFull, TrendingDown,
  CheckCircle2, AlertTriangle, Loader2, MapPin, Calendar, Sparkles,
  Download, Sun, Wallet, Activity, ShieldCheck, Wrench,
} from 'lucide-react'
import clsx from 'clsx'
import {
  analyzeBillSample, segmentRooftopSample, inspectPanelSample,
  predictBatterySampleById, forecastRampDeployment,
  billReportSampleUrl,
} from '../services/api'
import { clientStore } from '../services/clientStore'
import { expertStore } from '../services/expertStore'

const CUSTOMER = {
  name: 'Dupont family',
  address: '12 rue des Roses, 75011 Paris',
  installation_date: 'June 2022',
  bill_sample:    'family_house',
  rooftop_sample: 'sample_2',
  panel_sample:   'panel_a',
  battery_sample: 'sample2',
  ramp_sample:    'sample_3',
}

function eur(n) {
  if (n == null || isNaN(n)) return '—'
  return `${Math.round(n).toLocaleString('en-US')} €`.replace(/,/g, ' ')
}

// Neutral first — color is reserved for status meaning, not module identity.
const COLORS = {
  good:     { hex: '#10B981', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  warn:     { hex: '#D97706', bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200' },
  critical: { hex: '#E11D48', bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200' },
  neutral:  { hex: '#475569' },   // slate-600 — default for module cards & headlines
  accent:   { hex: '#1E6FBA' },   // brand blue — used sparingly
}

// ────────────────────────────────────────────────────────
export default function Reports() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  // Per-section provenance: 'upload' if the user uploaded it this session,
  // 'demo' if we fell back to a bundled sample.
  const [provenance, setProvenance] = useState({
    bill: 'demo', rooftop: 'demo', panel: 'demo', battery: 'demo', ramp: 'demo',
  })

  useEffect(() => {
    let mounted = true
    const run = async () => {
      setLoading(true)

      // Prefer the user's actual uploads (sessionStorage) over demo samples.
      const storedBill    = clientStore.getBill()
      const storedRoof    = clientStore.getRooftop()
      const storedPanel   = expertStore.getPanel()
      const storedBattery = expertStore.getBattery()

      const [bill, rooftop, panel, battery, ramp] = await Promise.allSettled([
        storedBill    ? Promise.resolve(storedBill)    : analyzeBillSample(CUSTOMER.bill_sample),
        storedRoof    ? Promise.resolve(storedRoof)    : segmentRooftopSample(CUSTOMER.rooftop_sample),
        storedPanel   ? Promise.resolve(storedPanel)   : inspectPanelSample(CUSTOMER.panel_sample),
        storedBattery ? Promise.resolve(storedBattery) : predictBatterySampleById(CUSTOMER.battery_sample),
        forecastRampDeployment(CUSTOMER.ramp_sample),
      ])
      if (!mounted) return
      setData({
        bill:    bill.status === 'fulfilled'    ? bill.value    : null,
        rooftop: rooftop.status === 'fulfilled' ? rooftop.value : null,
        panel:   panel.status === 'fulfilled'   ? panel.value   : null,
        battery: battery.status === 'fulfilled' ? battery.value : null,
        ramp:    ramp.status === 'fulfilled'    ? ramp.value    : null,
      })
      setProvenance({
        bill:    storedBill    ? 'upload' : 'demo',
        rooftop: storedRoof    ? 'upload' : 'demo',
        panel:   storedPanel   ? 'upload' : 'demo',
        battery: storedBattery ? 'upload' : 'demo',
        ramp:    'live',   // ramp is always a live tick
      })
      setLoading(false)
    }
    run()
    // Refresh on tab focus so the report picks up uploads done elsewhere
    const onFocus = () => setRefreshKey(k => k + 1)
    window.addEventListener('focus', onFocus)
    return () => { mounted = false; window.removeEventListener('focus', onFocus) }
  }, [refreshKey])

  // ── Dynamic customer profile ──
  // Build the customer label from what's actually uploaded — if the client
  // side gave us a real bill, use its label; if the expert side ran a real
  // inspection, use its label too. Falls back to the bundled CUSTOMER demo.
  const isUploadedAny =
    provenance.bill === 'upload' || provenance.rooftop === 'upload'
    || provenance.panel === 'upload' || provenance.battery === 'upload'
  const dynamicCustomer = isUploadedAny ? {
    name: data?.bill?.extracted?.label
       || data?.panel?.label
       || data?.battery?.label
       || 'Current customer',
    address: 'Live customer session · uploads from this browser tab',
    installation_date: 'In progress',
  } : CUSTOMER

  // Synthesis derived from raw module outputs
  const s = data && (() => {
    const recommended = data.bill?.recommendation?.panels
    const fittable    = data.rooftop?.metrics?.estimated_panels_v2
    const billCost    = data.bill?.recommendation?.total_cost_eur
    const billPayback = data.bill?.recommendation?.payback_years
    const sysSize     = data.bill?.recommendation?.system_size_kwp
    const annualSavings = data.bill?.recommendation?.annual_savings_eur
    const lifetimeNet = data.bill?.recommendation?.lifetime_net_savings_eur
    const consumption = data.bill?.extracted?.monthly_consumption_kwh
    const usableArea  = data.rooftop?.metrics?.usable_roof_area_m2
    const yearlyOut   = data.rooftop?.metrics?.annual_production_v2_kwh
    const panelDamaged = data.panel?.panel_status === 'Defective'
    const defectName   = data.panel?.step2_defect_type?.defect_type_pretty
    const panelConfidence = data.panel?.step1_binary?.confidence_pct
    const batterySoH   = Math.round((data.battery?.soh || 0) * 100)
    const batteryStatus= data.battery?.status
    const rampPct      = data.ramp?.ramp_pct_t_plus_15 ?? data.ramp?.ramp_pct
    const rampProb     = data.ramp?.sudden_ramp_prob
    const rampAlert    = data.ramp?.severity === 'danger' || data.ramp?.sudden_ramp_detected

    const onlinePanels = panelDamaged ? Math.max(0, recommended - 1) : recommended

    const issues = []
    if (panelDamaged)
      issues.push({ severity: 'critical', text: `Replace **Panel A** within 30 days — ${(defectName || 'damage').toLowerCase()} detected.` })
    if (batteryStatus === 'Warning')
      issues.push({ severity: 'warn', text: `Plan battery replacement in **6–12 months** — capacity at ${batterySoH}%.` })
    if (batteryStatus === 'Critical')
      issues.push({ severity: 'critical', text: 'Replace battery **immediately** — below replacement threshold.' })
    if (rampAlert)
      issues.push({ severity: 'warn', text: 'Pre-charge battery — sudden production drop predicted in next 15 minutes.' })

    return { recommended, fittable, billCost, billPayback, sysSize, annualSavings,
      lifetimeNet, consumption, usableArea, yearlyOut, panelDamaged, defectName,
      panelConfidence, batterySoH, batteryStatus, rampPct, rampProb, rampAlert,
      onlinePanels, issues }
  })()

  return (
    <div className="space-y-6 max-w-5xl">
      {/* HEADER — same style as Live Solar Forecasting */}
      <div className="page-header">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                <FileBarChart2 size={16} className="text-blue-600" />
              </div>
              <h1 className="page-title">Customer Report</h1>
            </div>
            <p className="page-subtitle ml-11">
              One page summary of every AI module's findings for one customer's installation —
              from the original quote to today's live monitoring.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setRefreshKey(k => k + 1)} disabled={loading}
              className="text-xs font-semibold px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-slate-700 shadow-sm hover:bg-slate-50 transition disabled:opacity-50 inline-flex items-center gap-2"
              title="Re-read the latest uploads from this session">
              {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              Refresh
            </button>
            <a href={billReportSampleUrl(CUSTOMER.bill_sample)} target="_blank" rel="noopener"
              className="text-xs font-semibold px-4 py-2.5 rounded-xl bg-slate-900 text-white shadow-sm hover:bg-slate-800 transition inline-flex items-center gap-2">
              <Download size={14} /> Download solar quote
            </a>
          </div>
        </div>
        {!loading && (
          <div className="ml-11 mt-3 space-y-2">
            {/* Per-source provenance — shows the operator exactly which
                sections came from the customer's uploads vs bundled demo */}
            <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
              <span className="uppercase tracking-wider text-slate-400 font-bold mr-1">Sources:</span>
              <ProvenanceChip label="Bill"    kind={provenance.bill}    side="client" />
              <ProvenanceChip label="Roof"    kind={provenance.rooftop} side="client" />
              <ProvenanceChip label="Panel"   kind={provenance.panel}   side="expert" />
              <ProvenanceChip label="Battery" kind={provenance.battery} side="expert" />
              <ProvenanceChip label="Live forecast" kind="live" side="live" />
            </div>
            {isUploadedAny && (
              <p className="text-[11px] text-slate-500">
                Dossier built from <strong className="text-slate-700">{dynamicCustomer.name}</strong>{' '}
                — combining client-side uploads (bill, rooftop) with expert-side inspections (panel, battery) in this browser session.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Whole dossier in a single white card */}
      <div className="card p-8 space-y-8">
        {loading && (
          <div className="flex items-center gap-3 text-slate-500 text-sm py-6">
            <Loader2 size={18} className="animate-spin" />
            Running all 5 AI modules in parallel…
          </div>
        )}

        {data && s && (
          <>
            {/* CUSTOMER STRIP */}
            <div className="flex items-start justify-between gap-4 flex-wrap pb-6 border-b border-slate-200/70">
              <div>
                <p className="text-slate-400 text-[10px] uppercase tracking-[3px] font-bold mb-1">Customer</p>
                <h2 className="font-display text-2xl font-extrabold text-slate-900">{dynamicCustomer.name}</h2>
                <div className="flex items-center gap-3 mt-2 text-xs text-slate-500 flex-wrap">
                  <span className="flex items-center gap-1.5"><MapPin size={12} className="text-slate-400" /> {dynamicCustomer.address}</span>
                  <span className="text-slate-300">·</span>
                  <span className="flex items-center gap-1.5"><Calendar size={12} className="text-slate-400" /> {isUploadedAny ? 'Session-bound dossier' : `Installed ${dynamicCustomer.installation_date}`}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <SystemStatusPill issues={s.issues.length} />
              </div>
            </div>

            {/* TOP KPIs — neutral slate, color reserved for the only two
                values that carry health information. */}
            <section>
              <p className="text-slate-400 text-[10px] uppercase tracking-[3px] font-bold mb-3">Headline numbers</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi
                  Icon={Sun}
                  label="Panels online"
                  value={`${s.onlinePanels} / ${s.recommended}`}
                  sub={`${s.sysSize} kWp installed`}
                  color={s.panelDamaged ? COLORS.warn.hex : COLORS.neutral.hex}
                />
                <Kpi
                  Icon={BatteryFull}
                  label="Battery health"
                  value={`${s.batterySoH}%`}
                  sub={s.batteryStatus}
                  color={s.batteryStatus === 'Healthy' ? COLORS.neutral.hex
                       : s.batteryStatus === 'Warning' ? COLORS.warn.hex : COLORS.critical.hex}
                />
                <Kpi
                  Icon={Wallet}
                  label="Annual savings"
                  value={eur(s.annualSavings)}
                  sub={`${s.billPayback}-yr payback`}
                  color={COLORS.neutral.hex}
                />
                <Kpi
                  Icon={Activity}
                  label="25-yr net gain"
                  value={eur(s.lifetimeNet)}
                  sub="After all costs"
                  color={COLORS.neutral.hex}
                />
              </div>
            </section>

            {/* PRE-INSTALLATION */}
            <section>
              <SectionTitle kicker="Phase 1 · Pre-installation" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <ModuleCard
                  Icon={Zap}
                  title="Bill analysis"
                  pillSeverity="warn"
                  pill={data.bill?.recommendation?.decision || '—'}
                  metrics={[
                    { label: 'Monthly use',    value: `${s.consumption} kWh` },
                    { label: 'Annual use',     value: `${data.bill?.extracted?.annual_consumption_kwh?.toLocaleString('en-US')} kWh` },
                    { label: 'Recommended',    value: `${s.recommended} panels`, accent: true },
                    { label: 'System cost',    value: eur(s.billCost) },
                  ]}
                />
                <ModuleCard
                  Icon={Satellite}
                  title="Rooftop suitability"
                  pillSeverity={s.fittable >= s.recommended ? 'good' : 'warn'}
                  pill={s.fittable >= s.recommended ? 'Suitable' : 'Tight fit'}
                  metrics={[
                    { label: 'Usable roof',    value: `${s.usableArea} m²` },
                    { label: 'Panels fit',     value: s.fittable, accent: true },
                    { label: 'Capacity',       value: `${data.rooftop?.metrics?.estimated_capacity_v2_kwp} kWp` },
                    { label: 'Yearly output',  value: `${(s.yearlyOut/1000).toFixed(1)} MWh` },
                  ]}
                />
              </div>
            </section>

            {/* POST-INSTALLATION */}
            <section>
              <SectionTitle kicker="Phase 2 · Post-installation monitoring" />
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <ModuleCard
                  Icon={ScanSearch}
                  title="Panel inspection"
                  pillSeverity={s.panelDamaged ? 'critical' : 'good'}
                  pill={s.panelDamaged ? 'Damaged' : 'Healthy'}
                  metrics={[
                    { label: 'Status',     value: s.panelDamaged ? '✗ Damaged' : '✓ Healthy', accent: true,
                      accentColor: s.panelDamaged ? COLORS.critical.hex : COLORS.good.hex },
                    { label: 'Confidence', value: `${s.panelConfidence}%` },
                    { label: 'Defect',     value: s.panelDamaged ? s.defectName : '—' },
                    { label: 'Severity',   value: data.panel?.severity || '—' },
                  ]}
                />
                <ModuleCard
                  Icon={BatteryFull}
                  title="Battery health"
                  pillSeverity={s.batteryStatus === 'Healthy' ? 'good'
                              : s.batteryStatus === 'Warning' ? 'warn' : 'critical'}
                  pill={s.batteryStatus === 'Healthy' ? 'Healthy'
                       : s.batteryStatus === 'Warning' ? 'Monitor' : 'Replace'}
                  metrics={[
                    { label: 'Capacity',  value: `${s.batterySoH}%`, accent: true,
                      accentColor: s.batteryStatus === 'Healthy' ? COLORS.good.hex
                                 : s.batteryStatus === 'Warning' ? COLORS.warn.hex : COLORS.critical.hex },
                    { label: 'Status',    value: s.batteryStatus },
                    { label: 'SoH score', value: data.battery?.soh.toFixed(2) },
                    { label: 'Threshold', value: '70% min' },
                  ]}
                />
                <ModuleCard
                  Icon={TrendingDown}
                  title="Live forecast (15 min)"
                  pillSeverity={s.rampAlert ? 'warn' : 'good'}
                  pill={s.rampAlert ? 'Watch' : 'Stable'}
                  metrics={[
                    { label: 'Forecast',  value: `${s.rampPct >= 0 ? '+' : ''}${s.rampPct?.toFixed(1)} pp`, accent: true,
                      accentColor: s.rampAlert ? COLORS.warn.hex : COLORS.neutral.hex },
                    { label: 'Probability', value: `${Math.round((s.rampProb || 0) * 100)}%` },
                    { label: 'Detected',  value: data.ramp?.sudden_ramp_detected ? 'Yes' : 'No' },
                    { label: 'Verdict',   value: data.ramp?.status || '—' },
                  ]}
                />
              </div>
            </section>

            {/* ACTION ITEMS */}
            {s.issues.length > 0 && (
              <section>
                <SectionTitle accent={COLORS.warn.hex} kicker={`Action items · ${s.issues.length} pending`} />
                <div className="space-y-2.5">
                  {s.issues.map((it, i) => {
                    const c = COLORS[it.severity]
                    return (
                      <div key={i}
                        className={clsx('rounded-xl border p-4 flex items-start gap-3', c.bg, c.border)}>
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 font-bold text-xs"
                          style={{ background: c.hex + '22', color: c.hex }}>
                          {i + 1}
                        </div>
                        <p className={clsx('text-sm leading-relaxed flex-1', c.text)}
                          dangerouslySetInnerHTML={{
                            __html: it.text.replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold">$1</strong>')
                          }} />
                        <Wrench size={14} className={c.text + ' mt-1 flex-shrink-0 opacity-60'} />
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {s.issues.length === 0 && (
              <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 flex items-start gap-3">
                <CheckCircle2 size={18} className="text-emerald-600 mt-0.5" />
                <div>
                  <p className="text-emerald-700 font-bold text-sm">All systems nominal</p>
                  <p className="text-emerald-600 text-xs mt-0.5">No action required this cycle.</p>
                </div>
              </section>
            )}

            {/* ─── FINAL AI VERDICT — the part that makes it feel like a report ─── */}
            <FinalVerdict s={s} customer={CUSTOMER} eur={eur} />
          </>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────
// Big closing block — synthesizes investment + health + plan into a
// proper "AI inspector's note" so the dossier reads like a system
// assessment, not just a list of module results.
// ────────────────────────────────────────────────────────
function FinalVerdict({ s, customer, eur }) {
  const yearsOnline = 3   // hard-coded for now; could be computed from install date
  const pctSavedSoFar = Math.round(100 * (yearsOnline / s.billPayback))
  const yearsToPayback = Math.max(0, +(s.billPayback - yearsOnline).toFixed(1))
  const overallSeverity = s.issues.some(i => i.severity === 'critical') ? 'critical'
                        : s.issues.length > 0 ? 'warn' : 'good'

  const verdictLine = overallSeverity === 'good'
    ? "The installation is performing as planned, with no maintenance flag this cycle."
    : overallSeverity === 'warn'
      ? "The installation is performing well overall, with a small number of items to address before they escalate."
      : "The installation needs immediate attention — at least one critical issue has been identified."

  const verdictColor = COLORS[overallSeverity].hex
  const VerdictIcon = overallSeverity === 'good' ? CheckCircle2 : AlertTriangle

  return (
    <section className="mt-2">
      <SectionTitle kicker="AI final verdict · system assessment" />

      {/* Hero verdict line */}
      <div className="rounded-2xl border-2 p-6"
        style={{
          background: 'linear-gradient(135deg, #F8FBFF 0%, #FFFFFF 100%)',
          borderColor: verdictColor + '50',
        }}>
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: verdictColor + '15' }}>
            <VerdictIcon size={22} style={{ color: verdictColor }} />
          </div>
          <div className="flex-1">
            <p className="text-[10px] uppercase tracking-[3px] font-bold mb-1" style={{ color: verdictColor }}>
              Overall verdict
            </p>
            <h3 className="text-slate-900 font-bold text-lg leading-snug">
              {verdictLine}
            </h3>
          </div>
        </div>

        {/* 3 sub-sections inside the verdict block */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-6 pt-6 border-t border-slate-200">
          <VerdictBlock
            kicker="Investment outlook"
            headline={`${pctSavedSoFar}% of the way to payback`}
            body={
              `${customer.name.split(' ')[0]} ${customer.name.split(' ').slice(1).join(' ')} have been generating their own electricity for ` +
              `${yearsOnline} years. With a ${s.billPayback}-year payback target, ` +
              `they are roughly ${pctSavedSoFar}% of the way there — about ${yearsToPayback} years before the system has paid for itself, ` +
              `then 25 - ${yearsOnline + Math.ceil(yearsToPayback)} years of pure savings to follow. ` +
              `Total lifetime net gain projected: ${eur(s.lifetimeNet)}.`
            }
          />
          <VerdictBlock
            kicker="System health"
            headline={
              s.panelDamaged && s.batteryStatus !== 'Healthy' ? 'Two subsystems need attention'
              : s.panelDamaged ? 'One panel needs attention'
              : s.batteryStatus !== 'Healthy' ? 'Battery is degrading'
              : 'All subsystems nominal'
            }
            body={
              `${s.onlinePanels} of ${s.recommended} panels are online. ` +
              `Battery capacity is at ${s.batterySoH}% (industry replacement threshold: 70%). ` +
              `Today's live forecast: ${s.rampPct >= 0 ? '+' : ''}${s.rampPct?.toFixed(1)} pp over the next 15 minutes — ` +
              `${s.rampAlert ? 'a sudden ramp event is flagged' : 'within normal operating range'}.`
            }
          />
          <VerdictBlock
            kicker="Recommended next steps"
            headline={
              s.issues.length === 0
                ? 'Schedule next routine check in 6 months'
                : `${s.issues.length} action${s.issues.length > 1 ? 's' : ''} for the maintenance team`
            }
            body={
              s.issues.length === 0
                ? "No maintenance action is required at this cycle. Continue the standard 6-month inspection rhythm."
                : (
                  s.issues.map((it, i) =>
                    String(i + 1) + ". " + it.text.replace(/\*\*/g, '')
                  ).join(' ')
                )
            }
          />
        </div>
      </div>

      <p className="text-[10px] text-slate-400 italic mt-3 text-center">
        Generated by Solarys AI — bill analysis, rooftop segmentation, panel inspection,
        battery State-of-Health, and live ramp forecasting · refreshed in real time.
      </p>
    </section>
  )
}

function VerdictBlock({ kicker, headline, body }) {
  return (
    <div>
      <p className="text-slate-400 text-[9px] uppercase tracking-[2px] font-bold mb-2">{kicker}</p>
      <p className="text-slate-900 font-bold text-sm mb-2 leading-snug">{headline}</p>
      <p className="text-slate-600 text-xs leading-relaxed">{body}</p>
    </div>
  )
}

// ────────────────────────────────────────────────────────
function Kpi({ Icon, label, value, sub, color }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-300 shadow-sm p-4 hover:shadow-md hover:border-slate-400 transition">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
          <Icon size={14} className="text-slate-600" />
        </div>
        <p className="text-[9px] uppercase tracking-wider font-bold text-slate-500">{label}</p>
      </div>
      <p className="text-2xl font-extrabold leading-tight font-mono" style={{ color }}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500 mt-1">{sub}</p>}
    </div>
  )
}

function SectionTitle({ kicker }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="w-1 h-4 rounded-full bg-slate-300" />
      <p className="text-slate-600 text-[10px] uppercase tracking-[3px] font-bold">{kicker}</p>
    </div>
  )
}

function ModuleCard({ Icon, title, pill, pillSeverity = 'neutral', metrics }) {
  const sev = COLORS[pillSeverity] || COLORS.neutral
  return (
    <div className="rounded-2xl border border-slate-300 bg-white overflow-hidden shadow-sm hover:shadow-md hover:border-slate-400 transition-all">
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
              <Icon size={15} className="text-slate-600" />
            </div>
            <h3 className="text-slate-800 font-bold text-sm">{title}</h3>
          </div>
          {pill && (
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider whitespace-nowrap"
              style={{ background: sev.hex + '15', color: sev.hex }}>
              {pill}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {metrics.map(m => (
            <div key={m.label} className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
              <p className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">{m.label}</p>
              <p className={clsx('font-bold font-mono mt-0.5', m.accent ? 'text-base' : 'text-sm')}
                style={{ color: m.accent ? (m.accentColor || COLORS.neutral.hex) : '#0F172A' }}>
                {m.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SystemStatusPill({ issues }) {
  if (issues === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700">
        <CheckCircle2 size={12} /> All systems nominal
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700">
      <AlertTriangle size={12} /> {issues} action {issues > 1 ? 'items' : 'item'}
    </span>
  )
}

// Small chip showing where a section of the dossier came from.
function ProvenanceChip({ label, kind, side }) {
  // kind: 'upload' | 'demo' | 'live'
  // side: 'client' | 'expert' | 'live'  — purely for color coding the SOURCE
  const palette = {
    upload: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500', tag: 'UPLOADED' },
    demo:   { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   dot: 'bg-amber-500',   tag: 'DEMO' },
    live:   { bg: 'bg-blue-50',    border: 'border-blue-200',    text: 'text-blue-700',    dot: 'bg-blue-500',    tag: 'LIVE' },
  }[kind] || { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-600', dot: 'bg-slate-400', tag: '?' }
  const sideLabel = side === 'client' ? 'Client' : side === 'expert' ? 'Expert' : 'Live'
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 font-semibold px-2 py-0.5 rounded-full border',
      palette.bg, palette.border, palette.text
    )}>
      <span className={clsx('w-1.5 h-1.5 rounded-full', palette.dot)} />
      <span>{label}</span>
      <span className="opacity-60 uppercase tracking-wider">· {sideLabel} · {palette.tag}</span>
    </span>
  )
}
