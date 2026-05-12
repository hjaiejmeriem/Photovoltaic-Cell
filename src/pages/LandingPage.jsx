import { Link } from 'react-router-dom'
import {
  Sun, ArrowRight, Zap, Satellite, ScanSearch, BatteryFull,
  TrendingUp, FileText, MessageCircle, Mail, Phone, MapPin,
  Sparkles, ShieldCheck, Cpu, Globe2, ChevronRight,
} from 'lucide-react'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-amber-50/20 relative overflow-hidden">
      {/* Background orbs */}
      <div className="fixed top-0 left-1/4 w-[600px] h-[600px] bg-solarys-blue/15 rounded-full blur-[160px] animate-float pointer-events-none" />
      <div className="fixed bottom-0 right-1/4 w-[600px] h-[600px] bg-solarys-yellow/15 rounded-full blur-[160px] animate-float-slow pointer-events-none" />
      <div className="fixed top-1/2 right-0 w-96 h-96 bg-violet-400/10 rounded-full blur-[120px] animate-float pointer-events-none" />

      {/* ── NAV ── */}
      <nav className="relative z-20 backdrop-blur-md bg-white/40 border-b border-white/40">
        <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-solarys-blue to-solarys-blue-dark flex items-center justify-center shadow-lg">
              <Sun size={22} className="text-solarys-yellow animate-spin-slow" />
            </div>
            <div>
              <p className="font-display font-extrabold text-xl leading-tight tracking-wider text-slate-900">
                SOLAR<span className="text-gradient-yellow">YS</span>
              </p>
              <p className="text-slate-500 text-[9px] font-medium tracking-[3px] uppercase">Smart Solar Energy</p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-700">
            <a href="#about" className="hover:text-solarys-blue transition">About us</a>
            <a href="#services" className="hover:text-solarys-blue transition">Services</a>
            <a href="#contact" className="hover:text-solarys-blue transition">Contact</a>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/client" className="text-xs font-semibold px-4 py-2 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition">
              Client Space
            </Link>
            <Link to="/expert" className="text-xs font-semibold px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-700 text-white shadow-md hover:shadow-lg transition">
              Expert Space
            </Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative z-10 max-w-7xl mx-auto px-8 pt-24 pb-28 text-center">
        <h1 className="font-display text-5xl md:text-6xl font-extrabold text-slate-900 leading-[1.05] mb-6 max-w-4xl mx-auto">
          The intelligent platform<br />
          <span className="text-gradient-yellow">behind every solar panel</span>
        </h1>
        <p className="text-slate-600 text-lg leading-relaxed mb-10 max-w-2xl mx-auto">
          From the first electricity bill to the day-to-day monitoring of an installed system,
          <span className="font-semibold text-slate-800"> Solarys </span>
          assists customers and solar-energy companies through every step — design,
          installation, and lifetime maintenance.
        </p>
        <div className="flex flex-wrap gap-3 justify-center">
          <Link to="/client"
            className="group flex items-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold shadow-lg shadow-emerald-500/30 hover:shadow-xl hover:scale-[1.02] transition-all">
            <MessageCircle size={18} />
            I'm a customer
            <ArrowRight size={16} className="group-hover:translate-x-1 transition" />
          </Link>
          <Link to="/expert"
            className="group flex items-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-700 text-white font-bold shadow-lg shadow-indigo-500/30 hover:shadow-xl hover:scale-[1.02] transition-all">
            <ShieldCheck size={18} />
            I'm a solar expert
            <ArrowRight size={16} className="group-hover:translate-x-1 transition" />
          </Link>
        </div>
        <div className="mt-14 grid grid-cols-3 gap-4 max-w-xl mx-auto">
          {[
            { value: '7', label: 'AI models' },
            { value: '<5s', label: 'Per inference' },
            { value: '25y', label: 'Lifetime tracking' },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-slate-200 bg-white/70 backdrop-blur p-4">
              <p className="text-3xl font-bold text-slate-900">{s.value}</p>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── ABOUT ── */}
      <section id="about" className="relative z-10 py-20 bg-white/40 backdrop-blur-sm border-y border-white/60">
        <div className="max-w-7xl mx-auto px-8 grid lg:grid-cols-3 gap-10 items-start">
          <div className="lg:col-span-1">
            <p className="text-emerald-600 text-xs font-bold tracking-[3px] uppercase mb-3">About us</p>
            <h2 className="font-display text-4xl font-extrabold text-slate-900 mb-4">
              We turn solar projects into intelligent, lifetime-managed systems.
            </h2>
          </div>
          <div className="lg:col-span-2 space-y-5 text-slate-600">
            <p>
              <span className="font-semibold text-slate-800">Solarys</span> is a Tunisian
              engineering project built at <span className="font-semibold">Esprit School of
              Engineering</span> by a team of computer-science students passionate about
              renewable energy and applied AI. We believe solar deployment shouldn't stop at
              installation day — it should be supported by continuous, intelligent monitoring.
            </p>
            <p>
              Our platform brings together <span className="font-semibold text-slate-800">seven
              deep-learning models</span> — from vision-language extraction of electricity
              bills to multimodal real-time forecasting — into a single, customer-facing
              workflow used by both end-customers and solar-installation experts.
            </p>
            <div className="grid grid-cols-2 gap-4 mt-6">
              <div className="rounded-xl bg-gradient-to-br from-amber-50 to-yellow-50 border border-amber-100 p-4">
                <Cpu size={18} className="text-amber-600 mb-2" />
                <p className="text-slate-800 font-bold text-sm">AI-first architecture</p>
                <p className="text-xs text-slate-600 mt-1">Every step of the workflow is powered by a specialized model.</p>
              </div>
              <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 p-4">
                <Globe2 size={18} className="text-emerald-600 mb-2" />
                <p className="text-slate-800 font-bold text-sm">End-to-end coverage</p>
                <p className="text-xs text-slate-600 mt-1">From feasibility study to 25-year maintenance.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SERVICES ── */}
      <section id="services" className="relative z-10 py-20">
        <div className="max-w-7xl mx-auto px-8">
          <div className="text-center mb-12">
            <p className="text-solarys-yellow-dark text-xs font-bold tracking-[3px] uppercase mb-3">Our services</p>
            <h2 className="font-display text-4xl font-extrabold text-slate-900 mb-4">
              Two spaces, one platform
            </h2>
            <p className="text-slate-600 max-w-2xl mx-auto">
              The same AI engine powers both the customer journey and the maintenance dashboard.
              Pick the space that matches your role.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* CLIENT CARD */}
            <div className="group rounded-3xl bg-gradient-to-br from-emerald-50 via-teal-50/60 to-white border-2 border-emerald-100 p-8 hover:shadow-2xl hover:scale-[1.01] transition-all">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shadow-lg">
                  <MessageCircle size={22} />
                </div>
                <div>
                  <p className="text-emerald-600 text-[10px] font-bold tracking-wider uppercase">For homeowners</p>
                  <h3 className="font-display font-extrabold text-2xl text-slate-900">Client Space</h3>
                </div>
              </div>
              <p className="text-slate-600 mb-5 leading-relaxed">
                A guided AI assistant walks you through everything: upload your electricity bill,
                share an aerial photo of your roof, and receive an instant, personalized solar
                quote with PDF download.
              </p>
              <ul className="space-y-2.5 mb-6">
                {[
                  'Upload an electricity bill and get a personalized quote',
                  'Visual rooftop analysis to confirm panel feasibility',
                  'Conversational AI guides you step-by-step',
                  'Branded PDF report you can keep or share',
                ].map(t => (
                  <li key={t} className="flex items-start gap-2 text-sm text-slate-700">
                    <ChevronRight size={16} className="text-emerald-500 mt-0.5 flex-shrink-0" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
              <Link to="/client"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-500 text-white font-bold shadow-md hover:bg-emerald-600 transition">
                Start as a client
                <ArrowRight size={16} />
              </Link>
            </div>

            {/* EXPERT CARD */}
            <div className="group rounded-3xl bg-gradient-to-br from-indigo-50 via-violet-50/60 to-white border-2 border-indigo-100 p-8 hover:shadow-2xl hover:scale-[1.01] transition-all">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 text-white flex items-center justify-center shadow-lg">
                  <ShieldCheck size={22} />
                </div>
                <div>
                  <p className="text-violet-600 text-[10px] font-bold tracking-wider uppercase">For installers</p>
                  <h3 className="font-display font-extrabold text-2xl text-slate-900">Expert Space</h3>
                </div>
              </div>
              <p className="text-slate-600 mb-5 leading-relaxed">
                A diagnostic AI agent helps your maintenance team troubleshoot underperformance,
                inspect panels, monitor batteries, and react to short-term production drops in
                real time.
              </p>
              <ul className="space-y-2.5 mb-6">
                {[
                  'AI diagnostic chat: production drop → panel scan → battery check',
                  'Live solar ramp forecasting (auto-refresh every 60 seconds)',
                  'Real-time alerts dashboard for sudden production events',
                  'Customer report aggregating all 5 modules per installation',
                ].map(t => (
                  <li key={t} className="flex items-start gap-2 text-sm text-slate-700">
                    <ChevronRight size={16} className="text-violet-500 mt-0.5 flex-shrink-0" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
              <Link to="/expert"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-700 text-white font-bold shadow-md hover:opacity-90 transition">
                Open expert dashboard
                <ArrowRight size={16} />
              </Link>
            </div>
          </div>

          {/* Module pills */}
          <div className="mt-12">
            <p className="text-center text-slate-500 text-xs uppercase tracking-[3px] font-bold mb-6">All 7 AI modules at a glance</p>
            <div className="flex flex-wrap justify-center gap-3">
              {[
                { Icon: Zap, label: 'Bill Analysis', color: '#F59E0B' },
                { Icon: Satellite, label: 'Rooftop Segmentation', color: '#0EA5E9' },
                { Icon: ScanSearch, label: 'Panel Damage Detection', color: '#8B5CF6' },
                { Icon: ScanSearch, label: 'Defect Classification', color: '#8B5CF6' },
                { Icon: ScanSearch, label: 'Defect Localization', color: '#8B5CF6' },
                { Icon: BatteryFull, label: 'Battery State of Health', color: '#14B8A6' },
                { Icon: TrendingUp, label: 'Live Ramp Forecasting', color: '#F97316' },
              ].map(m => (
                <div key={m.label} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white border border-slate-200 shadow-sm hover:shadow-md transition">
                  <m.Icon size={14} style={{ color: m.color }} />
                  <span className="text-sm text-slate-700 font-medium">{m.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── CONTACT ── */}
      <section id="contact" className="relative z-10 py-20 bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 text-white">
        <div className="max-w-7xl mx-auto px-8 grid lg:grid-cols-2 gap-12">
          <div>
            <p className="text-amber-300 text-xs font-bold tracking-[3px] uppercase mb-3">Contact us</p>
            <h2 className="font-display text-4xl font-extrabold mb-4">
              Bring solar intelligence to<br />your installation business
            </h2>
            <p className="text-blue-100 leading-relaxed mb-8">
              Whether you're a homeowner curious about going solar, or a solar-energy company
              looking to add AI to your installation pipeline, we'd love to hear from you.
            </p>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center">
                  <Mail size={18} className="text-amber-300" />
                </div>
                <div>
                  <p className="text-blue-200 text-[10px] uppercase tracking-wider font-bold">Email</p>
                  <p className="text-white font-semibold">contact@solarys.ai</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center">
                  <Phone size={18} className="text-amber-300" />
                </div>
                <div>
                  <p className="text-blue-200 text-[10px] uppercase tracking-wider font-bold">Phone</p>
                  <p className="text-white font-semibold">+216 71 000 000</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center">
                  <MapPin size={18} className="text-amber-300" />
                </div>
                <div>
                  <p className="text-blue-200 text-[10px] uppercase tracking-wider font-bold">Address</p>
                  <p className="text-white font-semibold">Esprit School of Engineering · Tunis</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl bg-white/10 backdrop-blur-md border border-white/20 p-7">
            <h3 className="font-display font-bold text-xl mb-5">Send us a message</h3>
            <form onSubmit={(e) => { e.preventDefault(); alert('Thanks! In production this would email contact@solarys.ai') }} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <input type="text" placeholder="Your name" className="w-full px-4 py-3 rounded-xl bg-white/15 border border-white/20 text-white placeholder-blue-200/50 text-sm focus:outline-none focus:border-amber-300 transition" />
                <input type="email" placeholder="Your email" className="w-full px-4 py-3 rounded-xl bg-white/15 border border-white/20 text-white placeholder-blue-200/50 text-sm focus:outline-none focus:border-amber-300 transition" />
              </div>
              <input type="text" placeholder="Subject" className="w-full px-4 py-3 rounded-xl bg-white/15 border border-white/20 text-white placeholder-blue-200/50 text-sm focus:outline-none focus:border-amber-300 transition" />
              <textarea rows={5} placeholder="Tell us about your project…" className="w-full px-4 py-3 rounded-xl bg-white/15 border border-white/20 text-white placeholder-blue-200/50 text-sm focus:outline-none focus:border-amber-300 transition resize-none" />
              <button type="submit" className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 text-slate-900 font-bold shadow-lg hover:shadow-xl transition">
                Send message
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="relative z-10 py-8 bg-slate-950 text-slate-400 text-xs">
        <div className="max-w-7xl mx-auto px-8 flex flex-col md:flex-row items-center justify-between gap-3">
          <p>© 2026 Solarys · Built at Esprit School of Engineering</p>
          <div className="flex items-center gap-5">
            <a href="#about" className="hover:text-white transition">About</a>
            <a href="#services" className="hover:text-white transition">Services</a>
            <a href="#contact" className="hover:text-white transition">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
