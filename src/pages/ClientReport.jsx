import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  FileText, Receipt, Satellite, Loader2, Download, Eye, RefreshCw,
  CheckCircle2, AlertTriangle, Sun, Wallet, CalendarRange, TrendingUp,
  ArrowRight, MapPin, Sparkles,
} from 'lucide-react'
import clsx from 'clsx'
import { combinedFeasibilityReport } from '../services/api'
import { clientStore } from '../services/clientStore'

const COLORS = {
  good:     { hex: '#10B981', text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  warn:     { hex: '#D97706', text: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200' },
  critical: { hex: '#E11D48', text: 'text-rose-700',    bg: 'bg-rose-50',    border: 'border-rose-200' },
  neutral:  { hex: '#475569' },
}

function eur(n) {
  if (n == null || isNaN(n)) return '—'
  return `${Math.round(n).toLocaleString('en-US')} €`.replace(/,/g, ' ')
}

export default function ClientReport() {
  // Pull whatever the user already analyzed on the Bill / Rooftop pages
  const [bill, setBill] = useState(() => clientStore.getBill())
  const [rooftop, setRooftop] = useState(() => clientStore.getRooftop())
  const [pdfUrl, setPdfUrl] = useState(null)
  const [pdfBuilding, setPdfBuilding] = useState(false)
  const [error, setError] = useState(null)

  // Refresh from store (in case user just analyzed something then came here)
  const refresh = () => {
    setBill(clientStore.getBill())
    setRooftop(clientStore.getRooftop())
    if (pdfUrl) { URL.revokeObjectURL(pdfUrl); setPdfUrl(null) }
    setError(null)
  }
  useEffect(() => {
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
    // eslint-disable-next-line
  }, [])

  const ready = bill && rooftop
  const fits = ready
    && (rooftop.metrics?.estimated_panels_v2 || 0) >= (bill.recommendation?.panels || 0)
  const sev = ready ? COLORS[fits ? 'good' : 'warn'] : null

  const buildPdf = async () => {
    if (!ready) return
    setPdfBuilding(true)
    try {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
      const url = await combinedFeasibilityReport(bill, rooftop)
      setPdfUrl(url)
    } catch (e) {
      setError(`Could not build PDF: ${e.message}`)
    } finally {
      setPdfBuilding(false)
    }
  }
  const downloadPdf = async () => {
    if (!ready) return
    try {
      const url = pdfUrl || await combinedFeasibilityReport(bill, rooftop)
      const a = document.createElement('a')
      a.href = url; a.download = 'solarys-feasibility-report.pdf'; a.click()
      if (!pdfUrl) setTimeout(() => URL.revokeObjectURL(url), 30000)
    } catch (e) {
      setError(`Could not download PDF: ${e.message}`)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      {/* HEADER — same style as other pages */}
      <div className="page-header">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                <FileText size={16} className="text-emerald-600" />
              </div>
              <h1 className="page-title">Combined Solar Report</h1>
            </div>
            <p className="page-subtitle ml-11">
              Auto-aggregated summary of your bill analysis and rooftop check —
              with a downloadable PDF you can share with your installer.
            </p>
          </div>
          <button onClick={refresh}
            className="text-xs font-semibold px-4 py-2.5 rounded-xl bg-slate-900 text-white shadow-sm hover:bg-slate-800 transition inline-flex items-center gap-2">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      <div className="card p-8 space-y-7">
        {/* Empty state — guide the user to the right pages */}
        {!ready && (
          <section>
            <p className="text-slate-400 text-[10px] uppercase tracking-[3px] font-bold mb-3">
              Waiting for your analyses…
            </p>
            <p className="text-slate-600 text-sm leading-relaxed mb-6 max-w-2xl">
              Run both the Bill Analysis and the Rooftop Analysis first.
              When both are done, this page will combine them automatically into a
              feasibility report you can download as a PDF.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <RunCta
                done={!!bill}
                Icon={Receipt}
                title="Bill analysis"
                detail={bill ? `Analyzed: ${bill.extracted?.monthly_consumption_kwh} kWh/month` : 'Not yet — please run it first'}
                to="/client/bill-analysis"
              />
              <RunCta
                done={!!rooftop}
                Icon={Satellite}
                title="Rooftop analysis"
                detail={rooftop
                  ? `Analyzed: ${rooftop.metrics?.usable_roof_area_m2} m² usable`
                  : 'Not yet — please run it first'}
                to="/client/rooftop-analysis"
              />
            </div>
          </section>
        )}

        {error && (
          <div className="rounded-lg px-3 py-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm flex items-start gap-2">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Combined report */}
        {ready && sev && (
          <>
            {/* Verdict bar */}
            <section className={clsx('rounded-2xl border p-5 flex items-start gap-4', sev.bg, sev.border)}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: sev.hex + '22' }}>
                {fits
                  ? <CheckCircle2 size={22} style={{ color: sev.hex }} />
                  : <AlertTriangle size={22} style={{ color: sev.hex }} />}
              </div>
              <div>
                <p className={clsx('text-[10px] uppercase tracking-[3px] font-bold mb-1', sev.text)}>
                  {fits ? 'Project feasible' : 'Tight fit — partial coverage'}
                </p>
                <p className="text-slate-900 font-bold text-lg leading-snug">
                  {fits
                    ? `Your bill calls for ${bill.recommendation.panels} panels — your rooftop fits up to ${rooftop.metrics.estimated_panels_v2}.`
                    : `Your bill calls for ${bill.recommendation.panels} panels but the roof only fits ${rooftop.metrics.estimated_panels_v2}.`}
                </p>
                <p className="text-slate-600 text-sm mt-1.5">
                  {fits
                    ? `Pays for itself in ${bill.recommendation.payback_years} years, then keeps generating free electricity for the rest of the panels' life.`
                    : 'A partial-coverage system is still possible — the report below shows the numbers.'}
                </p>
              </div>
            </section>

            {/* Headline KPIs */}
            <section>
              <p className="text-slate-400 text-[10px] uppercase tracking-[3px] font-bold mb-3">
                Headline numbers
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <BigNumber Icon={Sun} label="Recommended panels" value={bill.recommendation.panels} />
                <BigNumber Icon={Wallet} label="Total cost" value={eur(bill.recommendation.total_cost_eur)} />
                <BigNumber Icon={CalendarRange} label="Payback" value={`${bill.recommendation.payback_years} yrs`} />
                <BigNumber Icon={TrendingUp} label="25-yr net" value={eur(bill.recommendation.lifetime_net_savings_eur)} />
              </div>
            </section>

            {/* Two summary panels */}
            <section>
              <p className="text-slate-400 text-[10px] uppercase tracking-[3px] font-bold mb-3">
                What we found
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <SummaryPanel title="From your bill" Icon={Receipt}
                  metrics={[
                    { label: 'Monthly use',  value: `${bill.extracted.monthly_consumption_kwh} kWh` },
                    { label: 'Annual bill',  value: eur(bill.extracted.annual_amount_eur) },
                    { label: 'Recommended', value: `${bill.recommendation.panels} panels` },
                    { label: 'System size',  value: `${bill.recommendation.system_size_kwp} kWp` },
                    { label: 'Total cost',   value: eur(bill.recommendation.total_cost_eur) },
                    { label: 'Payback',      value: `${bill.recommendation.payback_years} yrs` },
                  ]}
                />
                <SummaryPanel title="From your rooftop" Icon={Satellite}
                  metrics={[
                    { label: 'Usable roof',   value: `${rooftop.metrics.usable_roof_area_m2} m²` },
                    { label: 'Total roof',    value: `${rooftop.metrics.total_roof_area_m2} m²` },
                    { label: 'Panels fit',    value: rooftop.metrics.estimated_panels_v2 },
                    { label: 'Capacity',      value: `${rooftop.metrics.estimated_capacity_v2_kwp} kWp` },
                    { label: 'Yearly output', value: `${(rooftop.metrics.annual_production_v2_kwh / 1000).toFixed(1)} MWh` },
                    { label: 'Orientation',   value: rooftop.metrics.panel_orientation || '—' },
                  ]}
                />
              </div>
            </section>

            {/* Final advice */}
            <section>
              <p className="text-slate-400 text-[10px] uppercase tracking-[3px] font-bold mb-3">
                Recommendation
              </p>
              <div className="rounded-2xl border border-slate-300 bg-white p-5">
                <p className="text-slate-700 text-sm leading-relaxed">
                  {bill.recommendation.advice}
                </p>
              </div>
            </section>

            {/* PDF download */}
            <section>
              <p className="text-slate-400 text-[10px] uppercase tracking-[3px] font-bold mb-3">
                Combined PDF report
              </p>
              <div className="rounded-2xl border border-slate-300 bg-white p-5 flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-slate-900 font-bold text-sm flex items-center gap-2">
                    <FileText size={14} className="text-emerald-600" /> Solar feasibility report
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1 max-w-md">
                    A one-page PDF combining the bill analysis and the rooftop check —
                    branded, ready to share with the customer or installer.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={buildPdf} disabled={pdfBuilding}
                    className="text-xs font-semibold rounded-lg py-2 px-3 bg-slate-100 text-slate-700 hover:bg-slate-200 inline-flex items-center gap-1.5 disabled:opacity-50">
                    {pdfBuilding
                      ? <><Loader2 size={13} className="animate-spin" /> Building…</>
                      : <><Eye size={13} /> Preview</>}
                  </button>
                  <button onClick={downloadPdf}
                    className="text-xs font-semibold rounded-lg py-2 px-3 bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-1.5">
                    <Download size={13} /> Download PDF
                  </button>
                </div>
              </div>
              {pdfUrl && (
                <div className="mt-3 rounded-xl border border-slate-300 overflow-hidden">
                  <iframe src={pdfUrl} title="Combined feasibility report"
                    className="w-full" style={{ height: '720px', background: '#F8FAFC' }} />
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────
function RunCta({ done, Icon, title, detail, to }) {
  return (
    <div className={clsx(
      'rounded-2xl border p-5 flex items-center gap-4',
      done ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-300 bg-white'
    )}>
      <div className={clsx(
        'w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0',
        done ? 'bg-emerald-100' : 'bg-slate-100'
      )}>
        {done
          ? <CheckCircle2 size={20} className="text-emerald-600" />
          : <Icon size={18} className="text-slate-600" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-slate-900 font-bold text-sm">{title}</p>
        <p className="text-slate-500 text-xs mt-0.5">{detail}</p>
      </div>
      {!done && (
        <Link to={to}
          className="text-xs font-bold px-3 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition inline-flex items-center gap-1.5">
          Go <ArrowRight size={12} />
        </Link>
      )}
    </div>
  )
}

function SummaryPanel({ title, Icon, metrics }) {
  return (
    <div className="rounded-2xl border border-slate-300 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
          <Icon size={13} className="text-slate-600" />
        </div>
        <h3 className="text-slate-800 font-bold text-sm">{title}</h3>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {metrics.map(m => (
          <div key={m.label} className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
            <p className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">{m.label}</p>
            <p className="font-bold font-mono text-sm mt-0.5 text-slate-900">{m.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function BigNumber({ Icon, label, value }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-300 shadow-sm p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
          <Icon size={13} className="text-slate-600" />
        </div>
        <p className="text-[9px] uppercase tracking-wider font-bold text-slate-500">{label}</p>
      </div>
      <p className="text-2xl font-extrabold leading-tight font-mono text-slate-900">{value}</p>
    </div>
  )
}
