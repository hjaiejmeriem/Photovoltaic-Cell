import clsx from 'clsx'

export default function ResultCard({ label, value, unit, icon: Icon, status, sub }) {
  return (
    <div className="metric-card">
      <div className="flex items-start justify-between">
        <span className="text-slate-400 text-xs font-medium uppercase tracking-wide">{label}</span>
        {Icon && (
          <div className="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center">
            <Icon size={16} className="text-amber-400" />
          </div>
        )}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold text-white">{value}</span>
        {unit && <span className="text-slate-400 text-sm">{unit}</span>}
      </div>
      {status && (
        <span className={clsx('text-xs font-semibold px-2.5 py-1 rounded-full w-fit', status)}>
          {sub}
        </span>
      )}
      {!status && sub && <span className="text-slate-400 text-xs">{sub}</span>}
    </div>
  )
}
