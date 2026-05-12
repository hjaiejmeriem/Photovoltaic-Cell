import clsx from 'clsx'
import { Info, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'

const variants = {
  info: {
    cls: 'border-sky-400/30 text-sky-200',
    bg: 'linear-gradient(135deg, rgba(30,111,186,0.15), rgba(91,163,221,0.05))',
    Icon: Info, iconColor: 'text-sky-400'
  },
  success: {
    cls: 'border-emerald-400/30 text-emerald-200',
    bg: 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(20,184,166,0.05))',
    Icon: CheckCircle2, iconColor: 'text-emerald-400'
  },
  warning: {
    cls: 'border-yellow-400/30 text-yellow-200',
    bg: 'linear-gradient(135deg, rgba(244,196,48,0.15), rgba(251,146,60,0.05))',
    Icon: AlertTriangle, iconColor: 'text-yellow-400'
  },
  danger: {
    cls: 'border-red-400/30 text-red-200',
    bg: 'linear-gradient(135deg, rgba(239,68,68,0.15), rgba(244,63,94,0.05))',
    Icon: XCircle, iconColor: 'text-red-400'
  },
}

export default function AlertBanner({ type = 'info', message }) {
  const v = variants[type] || variants.info
  const { Icon } = v
  return (
    <div
      className={clsx('flex items-start gap-3 border rounded-xl p-4 backdrop-blur-sm', v.cls)}
      style={{ background: v.bg }}
    >
      <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', v.iconColor)}
        style={{ background: 'rgba(255,255,255,0.05)' }}>
        <Icon size={16} className={v.iconColor} />
      </div>
      <p className="text-sm leading-relaxed flex-1 pt-1">{message}</p>
    </div>
  )
}
