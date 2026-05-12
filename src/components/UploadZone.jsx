import { useRef } from 'react'
import { Upload, FileImage, X, Sparkles } from 'lucide-react'

export default function UploadZone({ accept = 'image/*', label, hint, file, onFile, onClear }) {
  const inputRef = useRef(null)

  const handleDrop = (e) => {
    e.preventDefault()
    const dropped = e.dataTransfer.files[0]
    if (dropped) onFile(dropped)
  }

  const handleChange = (e) => {
    const selected = e.target.files[0]
    if (selected) onFile(selected)
  }

  if (file) {
    return (
      <div className="relative rounded-2xl p-5 flex items-center gap-4 overflow-hidden gradient-border-yellow"
        style={{ background: 'rgba(244,196,48,0.05)' }}>
        <div className="absolute -top-8 -right-8 w-24 h-24 rounded-full bg-solarys-yellow/20 blur-2xl" />
        <div className="relative w-12 h-12 rounded-xl bg-gradient-to-br from-solarys-yellow to-solarys-orange flex items-center justify-center flex-shrink-0 shadow-lg">
          <FileImage size={22} className="text-white" />
        </div>
        <div className="relative flex-1 min-w-0">
          <p className="text-white font-semibold text-sm truncate">{file.name}</p>
          <p className="text-slate-400 text-xs mt-0.5 flex items-center gap-1">
            <Sparkles size={10} className="text-solarys-yellow" />
            {(file.size / 1024).toFixed(1)} KB · Ready for analysis
          </p>
        </div>
        <button
          onClick={onClear}
          className="relative w-8 h-8 rounded-lg bg-white/5 hover:bg-red-500/20 border border-white/10 hover:border-red-400/40 flex items-center justify-center transition-all"
        >
          <X size={15} className="text-slate-300" />
        </button>
      </div>
    )
  }

  return (
    <div
      className="upload-zone"
      onClick={() => inputRef.current?.click()}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={handleChange} />
      <div className="absolute inset-0 bg-grid opacity-30 pointer-events-none" />
      <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-solarys-blue/30 to-solarys-yellow/20 border border-solarys-yellow/30 flex items-center justify-center shadow-lg">
        <Upload size={24} className="text-solarys-yellow" />
      </div>
      <div className="relative text-center">
        <p className="font-semibold text-sm text-slate-700">{label || 'Drop file here or click to upload'}</p>
        <p className="text-xs mt-1 text-slate-500">{hint || 'Supports PNG, JPG, JPEG'}</p>
      </div>
    </div>
  )
}
