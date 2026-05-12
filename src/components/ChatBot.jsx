import { useEffect, useRef, useState } from 'react'
import { Send, Sparkles, Loader2, Paperclip, X } from 'lucide-react'
import clsx from 'clsx'

/**
 * Reusable chatbot UI with a guided, scripted conversation flow.
 * The actual logic (state machine + API calls) is provided via the `onUserMessage`
 * and `onChoiceClick` callbacks, plus the `messages` array which the parent owns.
 *
 * Each message is shaped like:
 *   { id, role: 'bot' | 'user' | 'system', content, kind?, payload?, ts }
 *
 * `kind` lets the parent ask the chatbot to render special bubbles:
 *   - 'choices'  → payload.choices = [{ id, label }]
 *   - 'upload'   → payload.accept = 'image/*' | '.pdf' | …
 *   - 'card'     → payload.title, payload.body, payload.footer
 *   - 'images'   → payload.images = [data URLs]
 *   - 'metrics'  → payload.metrics = [{ label, value, color? }]
 *   - 'pdf'      → payload.url, payload.filename
 */
export default function ChatBot({
  title = 'AI Assistant',
  subtitle,
  accentColor = '#10B981',     // emerald
  avatarLabel = 'AI',
  messages = [],
  onSendMessage,                // (text) => void
  onChoice,                     // (choiceId, choice) => void
  onFileUpload,                 // (file, kind) => void
  pendingChoices,               // [{ id, label, hint? }]
  pendingUpload,                // { accept, label, hint }
  loading = false,
  placeholder = 'Type your message…',
}) {
  const [input, setInput] = useState('')
  const fileInputRef = useRef(null)
  const scrollRef = useRef(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  const handleSubmit = (e) => {
    e?.preventDefault()
    if (!input.trim() || loading) return
    onSendMessage?.(input.trim())
    setInput('')
  }

  const handleFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    onFileUpload?.(f, pendingUpload?.kind)
    e.target.value = ''
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur shadow-lg overflow-hidden flex flex-col"
      style={{ minHeight: '560px', maxHeight: '78vh' }}>
      {/* HEADER */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-gradient-to-r from-white to-slate-50">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 rounded-full blur-md opacity-40 animate-pulse" style={{ background: accentColor }} />
            <div className="relative w-9 h-9 rounded-full text-white flex items-center justify-center font-bold text-xs shadow-md"
              style={{ background: `linear-gradient(135deg, ${accentColor}, ${shade(accentColor, -20)})` }}>
              {avatarLabel}
            </div>
          </div>
          <div>
            <p className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
              <Sparkles size={12} style={{ color: accentColor }} />
              {title}
            </p>
            {subtitle && <p className="text-[10px] text-slate-500">{subtitle}</p>}
          </div>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 border-emerald-200 text-emerald-700 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          ONLINE
        </span>
      </div>

      {/* MESSAGES */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-slate-50/50">
        {messages.map(m => (
          <Message key={m.id} message={m} accentColor={accentColor}
            onChoice={onChoice} avatarLabel={avatarLabel} />
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-slate-500 text-sm">
            <div className="w-9 h-9 rounded-full text-white flex items-center justify-center font-bold text-xs shadow-md flex-shrink-0"
              style={{ background: `linear-gradient(135deg, ${accentColor}, ${shade(accentColor, -20)})` }}>
              {avatarLabel}
            </div>
            <div className="bg-white border border-slate-200 px-4 py-3 rounded-2xl rounded-tl-sm">
              <span className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* PENDING CHOICES (above input) */}
      {pendingChoices && pendingChoices.length > 0 && (
        <div className="px-5 py-3 border-t border-slate-200 bg-white flex flex-wrap gap-2">
          {pendingChoices.map(c => (
            <button key={c.id}
              onClick={() => onChoice?.(c.id, c)}
              disabled={loading}
              className="text-xs font-semibold px-4 py-2 rounded-full border-2 transition hover:scale-[1.03] disabled:opacity-50"
              style={{
                borderColor: accentColor + '60',
                color: accentColor,
                background: accentColor + '10',
              }}>
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* PENDING UPLOAD prompt */}
      {pendingUpload && (
        <div className="px-5 py-3 border-t border-slate-200 bg-amber-50/50">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Paperclip size={15} className="text-amber-600" />
              <div>
                <p className="text-xs font-bold text-amber-800">{pendingUpload.label || 'Upload requested'}</p>
                {pendingUpload.hint && <p className="text-[10px] text-amber-600">{pendingUpload.hint}</p>}
              </div>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="text-xs font-bold px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition">
              Choose file
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={pendingUpload.accept || '*'}
            className="hidden"
            onChange={handleFile}
          />
        </div>
      )}

      {/* INPUT */}
      <form onSubmit={handleSubmit}
        className="border-t border-slate-200 px-3 py-3 bg-white flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          disabled={loading}
          className="flex-1 px-4 py-2.5 rounded-full bg-slate-50 border border-slate-200 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-slate-400 transition disabled:opacity-50"
        />
        <button type="submit" disabled={!input.trim() || loading}
          className="w-10 h-10 rounded-full text-white flex items-center justify-center shadow-md hover:scale-105 transition disabled:opacity-40 disabled:scale-100"
          style={{ background: `linear-gradient(135deg, ${accentColor}, ${shade(accentColor, -20)})` }}>
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        </button>
      </form>
    </div>
  )
}

// ── Single message bubble ──
function Message({ message, accentColor, onChoice, avatarLabel }) {
  const isBot = message.role === 'bot'
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

  if (isSystem) {
    return (
      <div className="flex justify-center">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 bg-white border border-slate-200 px-3 py-1 rounded-full">
          {message.content}
        </span>
      </div>
    )
  }

  return (
    <div className={clsx('flex gap-2', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div className={clsx(
        'w-9 h-9 rounded-full text-white flex items-center justify-center font-bold text-xs shadow-md flex-shrink-0',
        isBot ? '' : 'bg-slate-700'
      )}
        style={isBot ? { background: `linear-gradient(135deg, ${accentColor}, ${shade(accentColor, -20)})` } : undefined}>
        {isBot ? avatarLabel : 'You'}
      </div>

      <div className={clsx('max-w-[80%]')}>
        <div className={clsx(
          'px-4 py-3 text-sm leading-relaxed',
          isBot
            ? 'bg-white border border-slate-200 text-slate-800 rounded-2xl rounded-tl-sm'
            : 'text-white rounded-2xl rounded-tr-sm'
        )}
          style={isUser ? { background: `linear-gradient(135deg, #475569, #1e293b)` } : undefined}>
          {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}

          {message.kind === 'card' && message.payload && (
            <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
              {message.payload.title && (
                <p className="text-xs font-bold uppercase tracking-wide text-slate-700">
                  {message.payload.title}
                </p>
              )}
              {message.payload.body && (
                <p className="text-xs text-slate-600">{message.payload.body}</p>
              )}
              {message.payload.metrics && (
                <div className="grid grid-cols-2 gap-2">
                  {message.payload.metrics.map(m => (
                    <div key={m.label} className="rounded-md bg-white border border-slate-200 p-2">
                      <p className="text-[9px] uppercase tracking-wider text-slate-500">{m.label}</p>
                      <p className="font-bold text-slate-800 text-sm font-mono" style={{ color: m.color }}>{m.value}</p>
                    </div>
                  ))}
                </div>
              )}
              {message.payload.footer && (
                <p className="text-[10px] text-slate-500 italic mt-1">{message.payload.footer}</p>
              )}
            </div>
          )}

          {message.kind === 'images' && message.payload?.images && (
            <div className="mt-2 grid grid-cols-3 gap-2">
              {message.payload.images.map((src, i) => (
                <div key={i}>
                  {message.payload.captions?.[i] && (
                    <p className="text-[9px] uppercase tracking-wider text-slate-500 mb-1">{message.payload.captions[i]}</p>
                  )}
                  <img src={src} alt="" className="w-full aspect-square object-cover rounded-md border border-slate-200" />
                </div>
              ))}
            </div>
          )}

          {message.kind === 'pdf' && message.payload?.url && (
            <a href={message.payload.url} target="_blank" rel="noopener"
              className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 rounded-lg text-white text-xs font-bold shadow-md hover:scale-[1.02] transition"
              style={{ background: accentColor }}>
              📄 Download {message.payload.filename || 'PDF'}
            </a>
          )}
        </div>
        {message.ts && (
          <p className={clsx('text-[10px] text-slate-400 mt-1', isUser ? 'text-right' : 'text-left')}>
            {new Date(message.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </div>
    </div>
  )
}

// ── tiny color helper (no extra dep) ──
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.max(0, Math.min(255, ((n >> 16) & 0xff) + amount))
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amount))
  const b = Math.max(0, Math.min(255, (n & 0xff) + amount))
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`
}
