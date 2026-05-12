import {
  Home, Zap, Satellite, ScanSearch, BatteryFull, TrendingUp,
  ArrowRight, Sun, Activity, ShieldCheck, AlertTriangle, BarChart3,
  Sparkles, Zap as Lightning, Globe, Cpu
} from 'lucide-react'
import { useEffect, useState } from 'react'

const summaryCards = [
  { label: 'Analyzed Roofs', value: 24, icon: Satellite, gradient: 'from-sky-500 to-blue-600', glow: 'rgba(14,165,233,0.4)', kind: 'int' },
  { label: 'Estimated Panels', value: 312, icon: Sun, gradient: 'from-yellow-400 to-orange-500', glow: 'rgba(244,196,48,0.5)', kind: 'int' },
  { label: 'Defective Panels', value: 7, icon: AlertTriangle, gradient: 'from-red-500 to-rose-600', glow: 'rgba(239,68,68,0.4)', kind: 'int' },
  { label: 'Avg Battery SoH', value: 0.87, icon: BatteryFull, gradient: 'from-emerald-400 to-teal-600', glow: 'rgba(16,185,129,0.4)', kind: 'decimal' },
  { label: 'Forecast Risk', value: 'Medium', icon: TrendingUp, gradient: 'from-orange-500 to-red-500', glow: 'rgba(251,146,60,0.4)', kind: 'text' },
]

const workflow = [
  { label: 'Customer Request', icon: Home, color: 'from-slate-500 to-slate-700' },
  { label: 'Bill Analysis', icon: Zap, color: 'from-yellow-400 to-amber-500' },
  { label: 'Rooftop Analysis', icon: Satellite, color: 'from-sky-500 to-blue-600' },
  { label: 'Installation', icon: Sun, color: 'from-emerald-400 to-teal-600' },
  { label: 'Panel Inspection', icon: ScanSearch, color: 'from-violet-500 to-purple-600' },
  { label: 'Battery Monitor', icon: BatteryFull, color: 'from-teal-400 to-cyan-600' },
  { label: 'Ramp Forecast', icon: TrendingUp, color: 'from-orange-400 to-red-500' },
  { label: 'Decisions', icon: BarChart3, color: 'from-rose-500 to-pink-600' },
]

const recentActivity = [
  { site: 'Site A — Lyon', action: 'Rooftop analysis completed', status: 'success', time: '2 min ago' },
  { site: 'Site B — Paris', action: 'Defective panel detected (micro-crack)', status: 'warning', time: '18 min ago' },
  { site: 'Site C — Marseille', action: 'Battery SoH = 0.71 — Warning', status: 'warning', time: '1 h ago' },
  { site: 'Site D — Bordeaux', action: 'Ramp event: Low risk', status: 'success', time: '2 h ago' },
  { site: 'Site E — Toulouse', action: 'Bill analysis: 14 panels recommended', status: 'info', time: '3 h ago' },
]

const statusDot = {
  success: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]',
  warning: 'bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.8)]',
  info: 'bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]'
}

function CountUp({ end, duration = 1500, decimals = 0 }) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    if (typeof end !== 'number') return setVal(end)
    const start = Date.now()
    const tick = () => {
      const p = Math.min((Date.now() - start) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setVal(end * eased)
      if (p < 1) requestAnimationFrame(tick)
    }
    tick()
  }, [end])
  return <>{typeof val === 'number' ? val.toFixed(decimals) : val}</>
}

export default function Dashboard() {
  const [particles] = useState(() => Array.from({ length: 20 }, () => ({
    x: Math.random() * 100,
    y: Math.random() * 100,
    delay: Math.random() * 5,
    size: Math.random() * 3 + 1,
  })))

  return (
    <div className="space-y-8">
      {/* HERO */}
      <div className="relative overflow-hidden rounded-3xl gradient-border-yellow">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: 'url("https://images.unsplash.com/photo-1509391366360-2e959784a276?w=1600&q=80")',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-solarys-midnight via-solarys-midnight/85 to-solarys-midnight/40" />
        <div className="absolute inset-0 bg-grid opacity-50" />

        {particles.map((p, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-solarys-yellow/40 animate-float pointer-events-none"
            style={{
              left: `${p.x}%`, top: `${p.y}%`,
              width: `${p.size}px`, height: `${p.size}px`,
              animationDelay: `${p.delay}s`,
              boxShadow: '0 0 6px rgba(244,196,48,0.8)',
            }}
          />
        ))}

        <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-gradient-to-br from-solarys-yellow to-solarys-orange opacity-20 blur-3xl animate-glow" />
        <div className="absolute top-10 right-10">
          <div className="relative w-32 h-32">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-solarys-yellow to-solarys-orange opacity-30 blur-xl animate-pulse" />
            <Sun size={128} className="relative text-solarys-yellow/60 animate-spin-slow" strokeWidth={1} />
          </div>
        </div>

        <div className="relative p-10">
          <h1 className="font-display text-5xl md:text-6xl font-extrabold tracking-tight mb-3 leading-[1.05] mt-2">
            <span className="text-white">Powering the</span><br />
            <span className="text-gradient-solar">Future of Solar</span>
          </h1>
          <p className="text-slate-300 text-base max-w-2xl mb-6 leading-relaxed">
            <span className="font-display text-solarys-yellow font-bold">SOLARYS</span> orchestrates the full lifecycle of solar projects —
            pre-installation analysis, real-time monitoring, predictive maintenance —
            powered by <span className="text-white font-semibold">7 integrated AI models</span>.
          </p>
          <div className="flex flex-wrap gap-3">
            <a href="/pre-installation/bill-analysis" className="btn-yellow">
              <Lightning size={16} /> Start AI Analysis
              <ArrowRight size={14} />
            </a>
            <a href="/reports" className="btn-secondary">
              <BarChart3 size={15} /> View Reports
            </a>
          </div>

          <div className="grid grid-cols-3 gap-4 mt-8 max-w-2xl">
            {[
              { label: 'AI Models', value: '7', icon: Cpu },
              { label: 'Sites Active', value: '24', icon: Globe },
              { label: 'Uptime', value: '99.9%', icon: Activity },
            ].map(s => (
              <div key={s.label}
                className="rounded-xl p-3 flex items-center gap-3 transition-all hover:scale-[1.02]"
                style={{
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(244,196,48,0.10) 100%)',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                  border: '1px solid rgba(244,196,48,0.35)',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.15)',
                }}>
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #F4C430, #FB923C)', boxShadow: '0 4px 12px rgba(244,196,48,0.4)' }}>
                  <s.icon size={18} className="text-white" />
                </div>
                <div>
                  <p className="text-white font-extrabold text-lg leading-none drop-shadow-md">{s.value}</p>
                  <p className="text-yellow-100/80 text-[10px] uppercase tracking-wider mt-1 font-semibold">{s.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div>
        <div className="flex items-center gap-2 mb-5">
          <div className="h-px flex-1 bg-gradient-to-r from-solarys-yellow/40 to-transparent" />
          <h2 className="text-slate-600 text-xs font-bold uppercase tracking-[3px] flex items-center gap-2">
            <Sparkles size={12} className="text-solarys-yellow" /> Platform Overview
          </h2>
          <div className="h-px flex-1 bg-gradient-to-l from-solarys-yellow/40 to-transparent" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {summaryCards.map((card) => (
            <div key={card.label} className="card-hover group cursor-pointer">
              <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full opacity-20 blur-2xl group-hover:opacity-40 transition-opacity"
                style={{ background: card.glow }} />
              <div className="relative">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${card.gradient} flex items-center justify-center mb-3 shadow-lg group-hover:scale-110 transition-transform`}>
                  <card.icon size={20} className="text-white" />
                </div>
                <p className="text-3xl font-extrabold text-slate-900 tracking-tight">
                  {card.kind === 'int'
                    ? <CountUp end={card.value} decimals={0} />
                    : card.kind === 'decimal'
                      ? <CountUp end={card.value} decimals={2} />
                      : card.value}
                </p>
                <p className="text-slate-500 text-xs mt-1.5 font-medium">{card.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Workflow Timeline */}
      <div className="card relative overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-30" />
        <div className="relative">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-slate-900 font-bold text-lg flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-solarys-blue to-solarys-yellow flex items-center justify-center">
                <Activity size={16} className="text-white" />
              </div>
              Project Lifecycle Workflow
            </h2>
            <span className="text-xs text-slate-500 font-medium">8 stages • End-to-end</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {workflow.map((step, i) => (
              <div key={step.label} className="flex items-center gap-3 group">
                <div className="flex flex-col items-center gap-2">
                  <div className="relative">
                    <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${step.color} blur-md opacity-50 group-hover:opacity-80 transition-opacity`} />
                    <div className={`relative w-12 h-12 rounded-2xl bg-gradient-to-br ${step.color} flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform`}>
                      <step.icon size={20} className="text-white" />
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-700 font-semibold text-center leading-tight max-w-[72px]">
                    {step.label}
                  </span>
                </div>
                {i < workflow.length - 1 && (
                  <div className="flex items-center mb-6">
                    <div className="w-4 h-px bg-gradient-to-r from-solarys-yellow/40 to-solarys-blue/40" />
                    <ArrowRight size={12} className="text-solarys-yellow/60" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="card">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-slate-900 font-bold text-lg flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center">
              <ShieldCheck size={16} className="text-white" />
            </div>
            Recent Activity
          </h2>
          <a href="#" className="text-xs text-solarys-blue hover:text-solarys-yellow-dark hover:underline font-semibold">View all →</a>
        </div>
        <div className="flex flex-col gap-1">
          {recentActivity.map((item, i) => (
            <div key={i} className="flex items-center gap-4 p-3 rounded-xl hover:bg-white/70 transition-all duration-200 cursor-pointer group">
              <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusDot[item.status]}`} />
              <div className="flex-1 min-w-0">
                <p className="text-slate-800 text-sm font-semibold group-hover:text-solarys-blue transition-colors">{item.site}</p>
                <p className="text-slate-500 text-xs mt-0.5 truncate">{item.action}</p>
              </div>
              <span className="text-slate-500 text-xs flex-shrink-0 font-medium">{item.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
