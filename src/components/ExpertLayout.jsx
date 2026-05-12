import { NavLink, Outlet, Link } from 'react-router-dom'
import {
  Sun, Stethoscope, TrendingUp, BellRing, FileBarChart2, Home, ArrowLeft,
} from 'lucide-react'
import clsx from 'clsx'
import AlertsToast from './AlertsToast'

const NAV = [
  { to: 'diagnostic',         label: 'Inspection & Diagnostic', icon: Stethoscope },
  { to: 'solar-ramp',         label: 'Live Forecasting',        icon: TrendingUp },
  { to: 'alerts',             label: 'Alerts Dashboard',        icon: BellRing },
  { to: 'customer-dossier',   label: 'Customer Report',         icon: FileBarChart2 },
]

export default function ExpertLayout() {
  return (
    <div className="flex h-screen overflow-hidden relative">
      <div className="fixed top-0 left-1/4 w-96 h-96 bg-indigo-500/15 rounded-full blur-[120px] animate-float pointer-events-none" />
      <div className="fixed bottom-0 right-1/4 w-96 h-96 bg-violet-400/12 rounded-full blur-[120px] animate-float-slow pointer-events-none" />

      <aside className="w-64 flex-shrink-0 flex flex-col h-full relative z-10 glass border-r border-indigo-500/15">
        <div className="px-5 py-6 border-b border-indigo-500/15">
          <Link to="/" className="flex items-center gap-3 hover:opacity-80 transition">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-violet-700 flex items-center justify-center shadow-lg">
              <Sun size={22} className="text-solarys-yellow animate-spin-slow" />
            </div>
            <div>
              <p className="font-display font-extrabold text-xl leading-tight tracking-wider text-slate-900">
                SOLAR<span className="text-gradient-yellow">YS</span>
              </p>
              <p className="text-violet-600 text-[9px] font-bold tracking-[2px] uppercase">Expert Space</p>
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 flex flex-col gap-1 overflow-y-auto">
          {NAV.map(item => (
            <NavLink key={item.to} to={item.to}
              className={({ isActive }) => clsx(
                'group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                isActive
                  ? 'nav-active text-slate-900 font-semibold'
                  : 'text-slate-600 hover:text-indigo-600 hover:bg-white/60'
              )}>
              <item.icon size={18} className="flex-shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.badge && (
                <span className={clsx(
                  'text-[8px] font-bold px-1.5 py-0.5 rounded-md text-white shadow-sm',
                  item.badge === 'LIVE'
                    ? 'bg-gradient-to-r from-emerald-400 to-emerald-600 animate-pulse'
                    : 'bg-gradient-to-r from-indigo-500 to-violet-600'
                )}>
                  {item.badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-4 border-t border-indigo-500/15">
          <Link to="/" className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-slate-500 hover:text-indigo-600 hover:bg-white/60 transition">
            <ArrowLeft size={14} />
            <span>Back to home</span>
          </Link>
          <Link to="/client" className="mt-1 flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-slate-500 hover:text-indigo-600 hover:bg-white/60 transition">
            <Home size={14} />
            <span>Switch to Client Space</span>
          </Link>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto relative z-10">
        <div className="max-w-7xl mx-auto px-8 py-10 animate-fade-up">
          <Outlet />
        </div>
      </main>

      {/* Global alerts toast — pops up the first time a new alert is detected
          across panel / battery / live-forecasting; the alert remains in
          /expert/alerts after dismissal. */}
      <AlertsToast />
    </div>
  )
}
