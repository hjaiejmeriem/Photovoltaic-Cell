import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Zap, Satellite, ScanSearch,
  BatteryFull, TrendingUp, FileBarChart2, ChevronDown,
  Sun, ChevronRight, Settings
} from 'lucide-react'
import { useState } from 'react'
import clsx from 'clsx'

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard', badge: null },
  {
    label: 'Pre-Installation',
    icon: Sun,
    children: [
      { label: 'Bill Analysis', icon: Zap, to: '/pre-installation/bill-analysis' },
      { label: 'Rooftop Analysis', icon: Satellite, to: '/pre-installation/rooftop-analysis' },
    ],
  },
  {
    label: 'Post-Installation',
    icon: ScanSearch,
    children: [
      { label: 'Panel Inspection', icon: ScanSearch, to: '/post-installation/panel-inspection' },
      { label: 'Battery Health', icon: BatteryFull, to: '/post-installation/battery-health' },
      { label: 'Solar Ramp Forecast', icon: TrendingUp, to: '/post-installation/solar-ramp' },
    ],
  },
  { label: 'Reports', icon: FileBarChart2, to: '/reports', badge: 'NEW' },
]

function NavItem({ item }) {
  const location = useLocation()
  const hasChildren = !!item.children
  const isGroupActive = hasChildren && item.children.some(c => location.pathname === c.to)
  const [open, setOpen] = useState(isGroupActive)

  if (hasChildren) {
    return (
      <div>
        <button
          onClick={() => setOpen(o => !o)}
          className={clsx(
            'group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-300',
            isGroupActive
              ? 'nav-active text-slate-900'
              : 'text-slate-600 hover:text-solarys-blue hover:bg-white/60'
          )}
        >
          <item.icon size={18} className={clsx('flex-shrink-0 transition-transform group-hover:scale-110', isGroupActive && 'text-solarys-yellow-dark')} />
          <span className="flex-1 text-left">{item.label}</span>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        {open && (
          <div className="mt-1.5 ml-4 border-l border-solarys-yellow/40 pl-3 flex flex-col gap-0.5">
            {item.children.map(child => (
              <NavLink
                key={child.to}
                to={child.to}
                className={({ isActive }) =>
                  clsx(
                    'group flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-300 relative',
                    isActive
                      ? 'nav-active text-slate-900 font-semibold'
                      : 'text-slate-600 hover:text-solarys-blue hover:bg-white/60'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute -left-[15px] top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-solarys-yellow shadow-[0_0_8px_rgba(244,196,48,0.8)]" />}
                    <child.icon size={15} className={clsx('flex-shrink-0 transition-transform group-hover:scale-110', isActive && 'text-solarys-yellow-dark')} />
                    {child.label}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        clsx(
          'group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-300',
          isActive
            ? 'nav-active text-slate-900 font-semibold'
            : 'text-slate-600 hover:text-solarys-blue hover:bg-white/60'
        )
      }
    >
      {({ isActive }) => (
        <>
          <item.icon size={18} className={clsx('flex-shrink-0 transition-transform group-hover:scale-110', isActive && 'text-solarys-yellow-dark')} />
          <span className="flex-1">{item.label}</span>
          {item.badge && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-gradient-to-r from-solarys-yellow to-solarys-orange text-white shadow-sm">
              {item.badge}
            </span>
          )}
        </>
      )}
    </NavLink>
  )
}

export default function Sidebar() {
  return (
    <aside className="w-64 flex-shrink-0 flex flex-col h-full relative z-10 glass border-r border-solarys-blue/15">
      {/* Logo */}
      <div className="px-5 py-6 border-b border-solarys-blue/15 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-solarys-blue/8 via-transparent to-solarys-yellow/12" />
        <div className="relative flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 bg-solarys-yellow rounded-xl blur-md opacity-40 animate-pulse" />
            <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-solarys-blue to-solarys-blue-dark flex items-center justify-center shadow-lg">
              <Sun size={22} className="text-solarys-yellow animate-spin-slow" />
            </div>
          </div>
          <div>
            <p className="font-display font-extrabold text-xl leading-tight tracking-wider text-slate-900">
              SOLAR<span className="text-gradient-yellow">YS</span>
            </p>
            <p className="text-slate-500 text-[9px] font-medium tracking-[3px] uppercase">Smart Solar Energy</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-1 overflow-y-auto">
        {navItems.map(item => (
          <NavItem key={item.label} item={item} />
        ))}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-solarys-blue/15">
        <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/60 transition-colors cursor-pointer">
          <div className="relative">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-solarys-yellow to-solarys-orange flex items-center justify-center shadow-lg">
              <span className="text-white text-xs font-extrabold">SA</span>
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-slate-800 text-xs font-semibold truncate">Solar Admin</p>
            <p className="text-slate-500 text-[10px] truncate">admin@solarys.io</p>
          </div>
          <Settings size={14} className="text-slate-400 hover:text-solarys-yellow-dark transition-colors" />
        </div>
      </div>
    </aside>
  )
}
