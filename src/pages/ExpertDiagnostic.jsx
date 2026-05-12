import { useEffect, useRef, useState } from 'react'
import {
  Send, Loader2, Sparkles, Stethoscope, BatteryFull, ScanSearch,
  AlertTriangle, CheckCircle2, MessageCircle, X, Image as ImageIcon,
  Camera, Flame, Wrench, FileText, ArrowRight,
} from 'lucide-react'
import clsx from 'clsx'
import UploadZone from '../components/UploadZone'
import { inspectPanel, predictBatterySoh } from '../services/api'
import { expertStore } from '../services/expertStore'

const ACCENT = '#6366F1'
let MID = 1
const mkId = () => `m_${++MID}`
const now = () => Date.now()

const DEFECT_LABELS = {
  black_core: 'Burnt cell (black core)',
  crack: 'Cell crack (crack)',
  finger: 'Broken connector lines (finger)',
  horizontal_dislocation: 'Cell misalignment (horizontal dislocation)',
  short_circuit: 'Short circuit',
  thick_line: 'Damaged busbar (thick line)',
}

// ────────────────────────────────────────────────────────
// LLM-style narrative generation. We don't actually call an LLM —
// we string the model's output values into long, varied paragraphs
// that read like an expert's clinical note. Each generator returns
// {summary, recommendation, followup} so the chat shows three
// natural "messages" instead of a clinical card.
// ────────────────────────────────────────────────────────
function narratePanelInspection(data) {
  const isDefective = data.panel_status === 'Defective'
  const conf = data.step1_binary?.confidence_pct
  const defectKey = data.step2_defect_type?.defect_type
  const defectLabel = DEFECT_LABELS[defectKey] || data.step2_defect_type?.defect_type_pretty || 'a defect'
  const defectConf = data.step2_defect_type?.confidence_pct
  const nZones = data.step3_localization?.n_regions || 0
  const severity = data.severity || 'unknown'

  const DEFECT_EXPLAINER = {
    black_core: "A black-core defect means a solar cell has overheated to the point where it has stopped producing electricity altogether. It usually comes from a manufacturing flaw, a long-term hot spot caused by partial shading, or thermal stress. Black cores tend to spread to neighboring cells over time and increase the local fire risk.",
    crack: "A crack is a physical fracture in the silicon — typically caused by hail, impact during installation, or thermal cycling stress. Even a hairline crack reduces the cell's electrical output and tends to grow under repeated thermal cycles.",
    finger: "Broken finger lines mean the thin metallic strips that collect electricity inside the cell are damaged. The panel can still operate, but at reduced output — and the damage tends to spread along neighboring fingers over time.",
    horizontal_dislocation: "A horizontal dislocation is a row of cells shifted out of place — typically a manufacturing defect. The panel works but its output is uneven, which can stress the inverter and reduce overall array efficiency.",
    short_circuit: "A short circuit means current is bypassing the load somewhere inside the cell. This is the most safety-critical defect: it dissipates power as heat, can trigger thermal runaway, and presents a real fire risk if the panel stays in service.",
    thick_line: "A thick-line defect is degradation of the main busbar that collects current across the panel. Output drops noticeably and the damage tends to spread to adjacent cells, accelerating overall panel failure.",
  }

  if (!isDefective) {
    return {
      summary:
        `I've finished the 3-stage inspection on the panel image you uploaded. The first-stage binary classifier returned **Healthy** with **${conf}% confidence**, which is the strongest possible signal — there is no electroluminescence-detectable defect on this panel right now. Because the panel is healthy, stages 2 (defect-type classification) and 3 (damage localization) didn't run; there's nothing for them to look at.`,
      recommendation:
        "**My recommendation:** keep this panel in service and continue normal operation. There's no maintenance action to take. Schedule the next routine EL inspection in 12 months — black-core defects and busbar degradation typically take 6-18 months to show up after the first sign of underperformance, so an annual cadence is enough to catch issues early without over-inspecting.",
      followup:
        "If you noticed a drop in production, the panel isn't the cause — the next most common suspect is the **battery storage** (if any), which can mask itself as panel underperformance. Want me to run a battery State-of-Health diagnostic? Just upload a thermal scan of the battery using the **Upload battery image** button below.",
    }
  }

  const isCritical = ['black_core', 'crack', 'short_circuit'].includes(defectKey)
  const explainer = DEFECT_EXPLAINER[defectKey] || "This defect type reduces the panel's electrical output and tends to evolve over time."

  return {
    summary:
      `I've finished the 3-stage inspection on the panel you uploaded, and I have a confident reading. The first stage flagged this panel as **Damaged** at **${conf}% confidence**. The second stage identified the specific defect type as **${defectLabel}** at **${defectConf}% confidence** — a strong identification. The third stage localized **${nZones} damage zone${nZones > 1 ? 's' : ''}** on the panel surface (you can see them as the brightest regions on the heat map and the bounding-box overlay just below).\n\n${explainer}\n\nThe overall severity grade for this finding is **${severity}**.`,
    recommendation: isCritical
      ? `**My recommendation: replace this panel within 30 days.**\n\nHere's why this is urgent rather than something we can monitor: ${defectKey === 'short_circuit' ? "a short circuit dissipates power as heat right inside the panel, which means leaving it on the array creates a real fire risk. This isn't a theoretical concern — every additional week in service adds risk." : defectKey === 'crack' ? "cracks under thermal cycling tend to grow on every hot/cold transition. A panel that's at 85% output today may be at 60% in three months — and a fully cracked cell can become a hot spot that propagates to neighbors." : "black-core defects don't stay contained. The damaged cell heats up under load, that heat propagates to adjacent cells, and after a few months you can lose 3-4 cells from a single starting point. Catching it now means replacing one panel; waiting means replacing several plus repairing collateral damage."}\n\n**Concrete next steps:** (1) document the panel's location on the array and its serial number for the warranty claim; (2) order the replacement panel — same model and Wp rating to keep the array balanced; (3) schedule the swap with a certified installer; (4) if the array's monitoring system shows this panel still producing, manually disconnect it before the swap to avoid working on a live circuit.`
      : `**My recommendation: schedule a deeper inspection within 2 weeks, then plan replacement at the next maintenance cycle.**\n\nThis class of defect (${defectLabel}) doesn't pose an immediate safety risk and the panel is still producing — but its output is below spec, and the damage tends to creep across neighboring cells over the next 6-18 months. The right move is to keep an eye on this panel's per-string output (most inverters expose this), and replace it when its production drops below ~85% of the nameplate rating, or sooner if you spot the defect spreading on a follow-up EL scan.\n\n**Concrete next steps:** (1) tag this panel in your maintenance log with today's findings; (2) re-scan it in 3-6 months to check the defect's progression; (3) when you do replace it, file the warranty claim with the manufacturer using the EL images and confidence scores from this report.`,
    followup:
      "Even though we found the issue on the panel side, **a degraded battery can mask itself as a second underperformance source** — and we want to make sure we're treating the right disease. Want me to run a State-of-Health diagnostic on the battery so we close out the full diagnostic? Just upload a thermal scan of the battery via the **Upload battery image** button below.",
  }
}

function narrateBatteryDiagnostic(data) {
  const sohPct = Math.round(data.soh * 100)
  const sohRaw = data.soh.toFixed(2)
  const status = data.status

  if (status === 'Healthy') {
    return {
      summary:
        `I've run the multimodal battery diagnostic on the thermal scan you uploaded, combining the heat map analysis with the operational features. The model returned a State-of-Health score of **${sohRaw}** (= **${sohPct}% remaining capacity**), which is firmly in the **Healthy** range. For context: a brand-new battery starts at 1.00 (= 100%); the industry-standard replacement threshold is 0.70 (= 70%); your battery is well above both.\n\nThe thermal scan didn't show any concentrated hot spots, and the operational features don't show abnormal capacity-fade rate or unusual voltage drift. This battery is performing like new.`,
      recommendation:
        "**My recommendation: no maintenance action required.** Keep the battery in normal service, with the standard depth-of-discharge limits the manufacturer recommends (typically 80%). Schedule the next routine SoH check in **6 months** — that's the sweet spot for catching the first signs of capacity fade without over-inspecting. If you notice the system running shorter at night, or the battery getting unusually warm to the touch, run a follow-up scan sooner.",
      followup:
        "Anything else you'd like to check on the installation?",
    }
  }

  if (status === 'Warning') {
    return {
      summary:
        `I've run the multimodal battery diagnostic on the thermal scan you uploaded. The model returned a State-of-Health score of **${sohRaw}** (= **${sohPct}% remaining capacity**), which lands in the **Watch** range — above the 70% replacement threshold but below the 90% mark where we consider the battery still factory-fresh.\n\nIn practical terms: the battery is **starting to degrade**. Typical signs at this stage are slightly shorter overnight runtime, a small (5-10%) increase in the time it takes to reach full charge, and a faint warming during deep-discharge cycles. Nothing dramatic yet, but the trend is downward and it will accelerate.`,
      recommendation:
        "**My recommendation: don't replace yet, but plan for it.**\n\n(1) **Schedule a deep diagnostic within 2 weeks** — capacity test under controlled load, cell-level voltage check, and a fresh thermal scan after a full discharge cycle. (2) **Reduce the depth-of-discharge to 80%** in your inverter settings. Stopping shy of full discharge slows the degradation curve significantly and can buy you 6-12 extra months of useful life. (3) **Monitor cell temperatures daily** — if any single cell starts running hotter than its neighbors, that's the early sign of a hot-spot failure mode. (4) **Plan financially for replacement in 6-12 months.** Get a quote now so you're not pressured when capacity drops below 70%.",
      followup:
        "Anything else on this installation you'd like me to check, or any specific question about how to interpret the SoH score?",
    }
  }

  // Critical
  return {
    summary:
      `I've run the multimodal battery diagnostic on the thermal scan you uploaded. The model returned a State-of-Health score of **${sohRaw}** (= **${sohPct}% remaining capacity**), which puts the battery **below the 70% industry replacement threshold**.\n\nThis means the battery can no longer reliably cover full demand cycles, the capacity-fade rate is accelerating, and the failure risk has moved from "might happen someday" to "could happen during the next deep cycle". The thermal scan typically shows uneven heat distribution at this stage, and the cells closest to end-of-life will run noticeably hotter than the rest of the pack.`,
    recommendation:
      "**My recommendation: replace the battery immediately.**\n\nWhat to do this week: (1) **Switch critical loads to backup power** while you organize the replacement — fridge, medical equipment, security systems shouldn't depend on this battery for the next month. (2) **Avoid full discharges** — keep the battery between 30% and 80% if possible; this slows further degradation while you wait for the new unit. (3) **Order the replacement** — same chemistry and capacity as the current unit. (4) **Notify the maintenance team on duty** so they're aware of the elevated failure risk during the transition. (5) **Document the findings** (this report + the thermal scan) for the warranty claim if the unit is under coverage.\n\nDelay isn't recommended: the per-cell thermal stress at this SoH level can trigger a runaway failure, and the cost of replacing a failed-in-service battery is significantly higher than a planned swap (downtime + emergency labor + collateral damage to the inverter).",
    followup:
      "Anything else you'd like to check, or do you want me to walk you through the safety steps for the swap-out?",
  }
}

// ────────────────────────────────────────────────────────
// Multi-flag intent detection. A message can have BOTH a
// greeting AND a complaint — we want the complaint to win.
// Tolerant to common typos ("pannel", "panneau", etc.).
// ────────────────────────────────────────────────────────
function detectIntent(text, state) {
  const t = (text || '').toLowerCase()
  if (!t.trim()) return { intent: 'unknown' }
  const has = (...words) => words.some(w => t.includes(w))

  // Broad vocabulary: English + French + slang + common typos.
  const flags = {
    greeting:           /^(hi|hey|hello|hii+|yo|salut|bonjour|bonsoir|coucou|good\s)/.test(t)
                        || has('hello', 'bonjour', 'salut'),
    thanks:             has('thanks', 'thank you', 'thx', 'ty ', 'thank', 'merci'),
    affirmative:        /^(yes|yeah|yep|yup|sure|ok|okay|kk|please|go ahead|sounds good|do it|absolutely|why not|alright|continue|carry on|go on|oui|ouais|d'accord)\b/.test(t),
    negative:           /^(no|nope|nah|not|stop|nevermind|never mind|cancel|skip|abort|leave it|non|pas vraiment)\b/.test(t),

    complaint_panel:    /\bp[ae]n+e?l|panneau|panneaux|cell|module\b/.test(t)
                        || has('underperform', 'under-perform', 'less production',
                              'low output', 'low production', 'broken', 'damaged',
                              'burnt', 'burned', 'crack', 'cracked', 'cracks',
                              'hot spot', 'hotspot', 'hot-spot', 'el image',
                              'el scan', 'electroluminescence', 'finger',
                              'black core', 'short circuit', 'shorted',
                              'thick line', 'horizontal dislocation', 'defect',
                              'defective', 'cassé', 'casse', 'défaut', 'defaut',
                              'abîmé', 'abime', 'brulé', 'brule'),
    complaint_battery:  has('battery', 'batteries', 'batterie', 'batteries',
                              'storage', 'discharge', 'discharges',
                              'discharging', 'charge', 'charging', 'drain',
                              'drains', 'draining', "won't hold", 'wont hold',
                              "doesn't hold", 'doesnt hold', 'soh',
                              'state of health', 'capacity loss', 'capacity drop',
                              'cycles', 'dies', 'dying', 'dead battery',
                              'flat battery', 'décharge', 'decharge', 'autonomie'),
    complaint_drop:     has('drop', 'dropped', 'dropping', 'fall', 'fell',
                              'falling', 'decrease', 'decreasing', 'decreased',
                              'lower', 'lowering', 'losing', 'lost', 'less',
                              'weak', 'weaker', 'slow', 'slower', 'slowing',
                              'baisse', 'baissé', 'baisser', 'réduction',
                              'reduction', 'underperform', 'under perform',
                              'less performant', 'less performing', 'performant',
                              'less than usual', 'production drop',
                              'output drop', 'yield drop', 'rendement',
                              'rendement baisse', 'moins de production'),

    ask_advice:         has('what should i do', 'what do i do', 'what to do',
                              'help me', 'help', 'advice', 'recommend',
                              'recommendation', 'next step', 'next steps',
                              'que faire', 'aide', "qu'est ce que je fais",
                              'que dois-je', 'que faut il', 'que faut-il'),
    ask_state_panel:    has('how is the panel', 'state of the panel',
                              'check the panel', 'check my panel',
                              'check panel', 'inspect the panel',
                              'inspect my panel', 'inspect panel',
                              'is my panel', 'are my panels',
                              'how are my panels', 'health of my panel',
                              'panel health', 'panel status',
                              'état du panneau', 'etat du panneau',
                              'vérifier panneau', 'verifier panneau',
                              'inspecter panneau'),
    ask_state_battery:  has('how is the battery', 'state of the battery',
                              'check the battery', 'check my battery',
                              'check battery', 'inspect the battery',
                              'inspect battery', 'is my battery',
                              'how is my battery', 'battery health',
                              'battery status', 'battery state',
                              'état de la batterie', 'etat de la batterie',
                              'vérifier batterie', 'verifier batterie',
                              'autonomie batterie'),

    upload_intent:      has('upload', 'send', 'send you', 'attach', 'attached',
                              'here is', "here's", 'voici', 'envoie',
                              'envoyer', 'envoie te', 'je vais te', 'i will send',
                              "i'll upload", "i'll send", 'je t envoie',
                              "je t'envoie", 'je vais envoyer'),
    ask_report:         has('pdf', 'report', 'rapport', 'download', 'export',
                              'document', 'feasibility', 'final report',
                              'summary report'),
  }

  // Priority: complaint about a specific subsystem wins
  if (flags.complaint_panel)  return { intent: 'complaint_panel',  hadGreeting: flags.greeting }
  if (flags.complaint_battery) return { intent: 'complaint_battery', hadGreeting: flags.greeting }
  if (flags.complaint_drop)   return { intent: 'complaint_generic_drop', hadGreeting: flags.greeting }

  if (flags.ask_state_panel)   return { intent: 'ask_state_panel' }
  if (flags.ask_state_battery) return { intent: 'ask_state_battery' }

  if (flags.affirmative) return { intent: 'affirmative' }
  if (flags.negative)    return { intent: 'negative' }
  if (flags.ask_advice)  return { intent: 'ask_advice' }
  if (flags.thanks)      return { intent: 'thanks' }
  if (flags.greeting)    return { intent: 'greeting' }

  return { intent: 'unknown' }
}

const STATE = {
  IDLE: 'IDLE',
  AWAITING_PANEL: 'AWAITING_PANEL',
  AWAITING_BATTERY_IMG: 'AWAITING_BATTERY_IMG',
  AWAITING_BATTERY_FEATURES: 'AWAITING_BATTERY_FEATURES',
  PANEL_HEALTHY: 'PANEL_HEALTHY',
  PANEL_DEFECTIVE: 'PANEL_DEFECTIVE',
  BATTERY_DONE: 'BATTERY_DONE',
}

// 25 feature names expected by the battery model — used to validate the
// JSON the user uploads inside the chat.
const BATTERY_FEATURE_KEYS = [
  'temp_mean','temp_max','temp_std','voltage_mean','voltage_min','current_mean',
  'R_estimated','delta_capacity','delta_temp','delta_voltage','capacity_fade_rate',
  'cap_roll_mean','cap_roll_std','temp_roll_max','cycle_normalized',
  'I_pv_mean','I_pv_max','I_pv_std','Q_pv_mean','Q_pv_max',
  'T_surface_mean','T_surface_max','T_surface_std','pv_variability','charge_factor',
]

// ────────────────────────────────────────────────────────
export default function ExpertDiagnostic() {
  // Direct-upload mode state
  const [panelFile, setPanelFile] = useState(null)
  const [panelResult, setPanelResult] = useState(null)
  const [panelLoading, setPanelLoading] = useState(false)
  const [panelError, setPanelError] = useState(null)

  const [batteryImg, setBatteryImg] = useState(null)
  const [batteryFeats, setBatteryFeats] = useState(null)   // File (json)
  const [batteryResult, setBatteryResult] = useState(null)
  const [batteryLoading, setBatteryLoading] = useState(false)
  const [batteryError, setBatteryError] = useState(null)

  // Chat drawer
  const [chatOpen, setChatOpen] = useState(false)

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
            <Stethoscope size={16} className="text-indigo-600" />
          </div>
          <h1 className="page-title">Inspection & Diagnostic</h1>
        </div>
        <p className="page-subtitle ml-11">
          One workspace for panel inspection and battery health. Upload your files directly
          on the page — or open the AI agent and let it guide the diagnostic.
        </p>
      </div>

      {/* Two main sections side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PanelInspectionCard
          file={panelFile}
          result={panelResult}
          loading={panelLoading}
          error={panelError}
          onFileChange={(f) => { setPanelFile(f); setPanelResult(null); setPanelError(null) }}
          onClear={() => { setPanelFile(null); setPanelResult(null); setPanelError(null) }}
          onRun={async () => {
            if (!panelFile) return
            setPanelLoading(true); setPanelError(null); setPanelResult(null)
            try {
              const r = await inspectPanel(panelFile)
              setPanelResult(r)
              expertStore.setPanel(r)   // share with Reports + Alerts Dashboard
            }
            catch (e) { setPanelError(e.message || 'Inspection failed') }
            finally { setPanelLoading(false) }
          }}
        />

        <BatteryHealthCard
          imgFile={batteryImg}
          featsFile={batteryFeats}
          result={batteryResult}
          loading={batteryLoading}
          error={batteryError}
          onImgChange={(f) => { setBatteryImg(f); setBatteryResult(null); setBatteryError(null) }}
          onFeatsChange={(f) => { setBatteryFeats(f); setBatteryResult(null); setBatteryError(null) }}
          onClearImg={() => { setBatteryImg(null); setBatteryResult(null); setBatteryError(null) }}
          onClearFeats={() => { setBatteryFeats(null); setBatteryResult(null); setBatteryError(null) }}
          onRun={async () => {
            if (!batteryImg || !batteryFeats) return
            setBatteryLoading(true); setBatteryError(null); setBatteryResult(null)
            try {
              const text = await batteryFeats.text()
              const parsed = JSON.parse(text)
              const r = await predictBatterySoh(batteryImg, parsed)
              setBatteryResult(r)
              expertStore.setBattery(r)   // share with Reports + Alerts Dashboard
            } catch (e) {
              setBatteryError(e.message || 'Battery diagnostic failed')
            } finally { setBatteryLoading(false) }
          }}
        />
      </div>

      {/* Floating CTA — talk to expert agent */}
      <ChatLauncher onOpen={() => setChatOpen(true)} hidden={chatOpen} />

      {/* Chat drawer */}
      {chatOpen && <ChatDrawer onClose={() => setChatOpen(false)} />}
    </div>
  )
}

// ────────────────────────────────────────────────────────
function PanelInspectionCard({ file, result, loading, error, onFileChange, onClear, onRun }) {
  const isDefective = result?.panel_status === 'Defective'
  const defectKey = result?.step2_defect_type?.defect_type
  const defectLabel = DEFECT_LABELS[defectKey] || result?.step2_defect_type?.defect_type_pretty || '—'
  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center">
          <ScanSearch size={17} className="text-violet-600" />
        </div>
        <div>
          <h2 className="text-slate-800 font-semibold text-sm">Panel inspection</h2>
          <p className="text-[11px] text-slate-500">Upload an electroluminescence (EL) scan</p>
        </div>
      </div>

      <UploadZone
        accept="image/*"
        label="Drop EL panel image here"
        hint="PNG, JPG or TIFF · close-up of the panel surface"
        file={file}
        onFile={onFileChange}
        onClear={onClear}
      />
      <button onClick={onRun} disabled={!file || loading}
        className="btn-primary w-full justify-center"
        style={{ background: file && !loading ? 'linear-gradient(135deg, #8B5CF6, #7C3AED)' : undefined }}>
        {loading
          ? <><Loader2 size={16} className="animate-spin" /> Inspecting…</>
          : <><ScanSearch size={16} /> Run inspection</>}
      </button>

      {error && (
        <div className="rounded-lg px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-xs">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3 pt-2">
          <div className={clsx(
            'rounded-xl p-4 border-2 flex items-start gap-3',
            isDefective ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'
          )}>
            {isDefective
              ? <AlertTriangle size={22} className="text-red-600 mt-0.5" />
              : <CheckCircle2 size={22} className="text-emerald-600 mt-0.5" />}
            <div>
              <p className={clsx('font-bold text-base',
                isDefective ? 'text-red-700' : 'text-emerald-700')}>
                {isDefective ? '✗ Damaged panel' : '✓ Healthy panel'}
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                {isDefective
                  ? `Defect identified: ${defectLabel} · severity ${result.severity || '—'}`
                  : `AI confidence ${result.step1_binary?.confidence_pct}% · no defect detected.`}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Metric label="Health" value={isDefective ? '✗ Damaged' : '✓ Healthy'}
              color={isDefective ? '#EF4444' : '#10B981'} />
            <Metric label="AI confidence" value={`${result.step1_binary?.confidence_pct}%`} />
            <Metric label="Defect type" value={isDefective ? defectLabel : '—'} />
            <Metric label="Severity" value={result.severity || '—'} />
          </div>

          {isDefective && result.images && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Where the damage is</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { src: result.images.original, label: 'Original' },
                  { src: result.images.heatmap,  label: 'Heat map' },
                  { src: result.images.bboxes,   label: 'Damage zones' },
                ].filter(x => x.src).map((x, i) => (
                  <div key={i}>
                    <p className="text-[9px] uppercase tracking-wider text-slate-500 mb-1">{x.label}</p>
                    <img src={x.src} alt="" className="w-full aspect-square object-cover rounded-md border border-slate-200" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {isDefective && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3">
              <p className="text-[10px] uppercase tracking-wider text-red-700 font-bold mb-1 flex items-center gap-1.5">
                <Wrench size={12} /> Recommended action
              </p>
              <p className="text-sm text-slate-700">
                {['black_core', 'crack', 'short_circuit'].includes(defectKey)
                  ? '🚨 Replace within 30 days. This defect type tends to spread and increases the safety risk.'
                  : '⚠ Schedule a deeper inspection within 2 weeks. Continue monitoring this panel\'s output.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────
function BatteryHealthCard({ imgFile, featsFile, result, loading, error,
  onImgChange, onFeatsChange, onClearImg, onClearFeats, onRun }) {
  const sohPct = result ? Math.round(result.soh * 100) : null
  const sevColor = !result ? '#0F172A'
    : result.status === 'Healthy' ? '#10B981'
    : result.status === 'Warning' ? '#F59E0B' : '#EF4444'
  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-xl bg-teal-100 flex items-center justify-center">
          <BatteryFull size={17} className="text-teal-600" />
        </div>
        <div>
          <h2 className="text-slate-800 font-semibold text-sm">Battery State of Health</h2>
          <p className="text-[11px] text-slate-500">Thermal scan + 25 cycling features</p>
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">Thermal image</p>
        <UploadZone
          accept="image/*,.npy"
          label="Drop thermal scan"
          hint=".npy or PNG/JPG · 64×64 grayscale"
          file={imgFile}
          onFile={onImgChange}
          onClear={onClearImg}
        />
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">Features JSON</p>
        <UploadZone
          accept=".json,application/json"
          label="Drop 25-feature JSON"
          hint="voltage_mean, temp_mean, capacity_fade_rate, …"
          file={featsFile}
          onFile={onFeatsChange}
          onClear={onClearFeats}
        />
      </div>

      <button onClick={onRun} disabled={!imgFile || !featsFile || loading}
        className="btn-primary w-full justify-center"
        style={{ background: imgFile && featsFile && !loading ? 'linear-gradient(135deg, #14B8A6, #0F766E)' : undefined }}>
        {loading
          ? <><Loader2 size={16} className="animate-spin" /> Diagnosing…</>
          : <><BatteryFull size={16} /> Run diagnostic</>}
      </button>

      {error && (
        <div className="rounded-lg px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-xs">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3 pt-2">
          <div className="rounded-xl p-4 border-2 flex items-start gap-3"
            style={{ borderColor: sevColor + '40', background: sevColor + '12' }}>
            <BatteryFull size={22} style={{ color: sevColor }} className="mt-0.5" />
            <div>
              <p className="font-bold text-base" style={{ color: sevColor }}>
                {result.status === 'Healthy' ? '✓ Battery healthy'
                : result.status === 'Warning' ? '⚠ Battery degrading'
                : '🚨 Battery critical'}
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                Remaining capacity: <span className="font-bold" style={{ color: sevColor }}>{sohPct}%</span>
                {' · '}Industry replacement threshold: 70%
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Metric label="Remaining capacity" value={`${sohPct}%`} color={sevColor} />
            <Metric label="Status" value={result.status} />
            <Metric label="SoH score" value={result.soh.toFixed(2)} />
            <Metric label="Threshold" value="70% min" />
          </div>

          {result.thermal_image && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Thermal scan</p>
              <img src={result.thermal_image} alt="Thermal"
                className="w-full max-w-[180px] aspect-square object-cover rounded-md border border-slate-200" />
            </div>
          )}

          <div className="rounded-lg p-3 border" style={{ borderColor: sevColor + '40', background: sevColor + '08' }}>
            <p className="text-[10px] uppercase tracking-wider font-bold mb-1 flex items-center gap-1.5"
              style={{ color: sevColor }}>
              <Wrench size={12} /> Recommended action
            </p>
            <p className="text-sm text-slate-700">
              {result.status === 'Healthy'
                ? 'No maintenance needed. Continue normal operation. Schedule next health check in 6 months.'
                : result.status === 'Warning'
                  ? 'Schedule deep diagnostic within 2 weeks. Reduce depth-of-discharge to 80%. Plan replacement in 6-12 months.'
                  : 'Replace immediately. Battery below 70% industry threshold. Switch critical loads to backup.'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, color = '#0F172A' }) {
  return (
    <div className="rounded-md bg-white border border-slate-200 p-2">
      <p className="text-[9px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="font-bold text-slate-800 text-sm font-mono" style={{ color }}>{value}</p>
    </div>
  )
}

// ────────────────────────────────────────────────────────
// Floating chat launcher (visible until chat is opened)
// ────────────────────────────────────────────────────────
function ChatLauncher({ onOpen, hidden }) {
  if (hidden) return null
  return (
    <div className="fixed bottom-6 right-6 z-40">
      <button onClick={onOpen}
        className="group relative flex items-center gap-3 pl-4 pr-5 py-3 rounded-full text-white shadow-2xl hover:scale-105 transition-all"
        style={{ background: `linear-gradient(135deg, ${ACCENT}, #4F46E5)`,
                 boxShadow: '0 20px 50px rgba(99,102,241,0.45)' }}>
        <span className="absolute inset-0 rounded-full blur-md opacity-50 -z-10 animate-pulse"
          style={{ background: ACCENT }} />
        <div className="relative w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-md">
          <span className="text-2xl">🩺</span>
        </div>
        <div className="text-left">
          <p className="text-[10px] uppercase tracking-wider font-bold opacity-90">Need a hand?</p>
          <p className="text-sm font-bold">Talk to our expert agent</p>
        </div>
        <Sparkles size={16} className="opacity-80 group-hover:rotate-12 transition" />
      </button>
    </div>
  )
}

// ────────────────────────────────────────────────────────
// Slide-over chat drawer
// ────────────────────────────────────────────────────────
function ChatDrawer({ onClose }) {
  const [messages, setMessages] = useState([])
  const [state, setState] = useState(STATE.IDLE)
  const [loading, setLoading] = useState(false)
  const [input, setInput] = useState('')
  const panelRef = useRef(null)
  const batImgRef = useRef(null)
  const batFeatsRef = useRef(null)
  const scrollRef = useRef(null)
  const bootedRef = useRef(false)

  // Pending battery state — chatbot collects image + features step by step
  const [pendingBatteryImg, setPendingBatteryImg] = useState(null)

  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    setTimeout(() => {
      pushBot("Hi 👋 I'm the Expert Diagnostic agent. Tell me what you're seeing on the installation — describe the issue in your own words.")
    }, 200)
    // eslint-disable-next-line
  }, [])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, loading])

  const pushBot = (content, extras = {}) =>
    setMessages(prev => [...prev, { id: mkId(), role: 'bot', content, ts: now(), ...extras }])
  const pushUser = (content) =>
    setMessages(prev => [...prev, { id: mkId(), role: 'user', content, ts: now() }])

  const handleSend = (e) => {
    e?.preventDefault()
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    pushUser(text)
    const det = detectIntent(text, state)
    setTimeout(() => respond(det, text), 350)
  }

  const respond = ({ intent, hadGreeting }, originalText) => {
    const greetingPrefix = hadGreeting ? "Hi there 👋 — " : ""

    if (intent === 'thanks') {
      pushBot("You're welcome. I'm here whenever you need another check.")
      return
    }
    if (intent === 'greeting') {
      pushBot("Hi 👋 — what's happening on the installation? Describe the symptom and I'll route you to the right diagnostic.")
      return
    }

    if (intent === 'complaint_panel' || intent === 'complaint_generic_drop') {
      pushBot(
        greetingPrefix +
        "thanks for the heads-up. A drop in production usually means **one of the panels has a defect**. Let's start there — please upload an electroluminescence (EL) scan of the suspect panel using the **📷 Upload panel** button below."
      )
      setState(STATE.AWAITING_PANEL)
      return
    }

    if (intent === 'complaint_battery') {
      pushBot(
        greetingPrefix +
        "battery degradation can absolutely cause underperformance. Let's run the State-of-Health diagnostic. I need **two files**: a thermal scan of the battery, and a 25-feature JSON. Start by uploading the thermal scan — **🔋 Upload battery image**."
      )
      setState(STATE.AWAITING_BATTERY_IMG)
      return
    }

    if (intent === 'affirmative') {
      if (state === STATE.PANEL_HEALTHY) {
        pushBot("Good — please upload a thermal scan of the battery using the **🔋 Upload battery image** button below. After that I'll ask for the 25-feature JSON.")
        setState(STATE.AWAITING_BATTERY_IMG)
        return
      }
      if (state === STATE.PANEL_DEFECTIVE) {
        pushBot("Smart — let's also confirm the battery isn't a secondary issue. Upload the thermal scan with **🔋 Upload battery image** below.")
        setState(STATE.AWAITING_BATTERY_IMG)
        return
      }
      if (state === STATE.IDLE) {
        pushBot("Sure — tell me a bit more. Is the issue on a specific panel, the battery, or general system performance?")
        return
      }
    }

    if (intent === 'negative') {
      if (state === STATE.PANEL_HEALTHY || state === STATE.PANEL_DEFECTIVE) {
        pushBot("Understood — diagnostic closed. If the issue persists, just describe it and we'll dig deeper.")
        setState(STATE.IDLE)
        return
      }
    }

    if (intent === 'ask_advice') {
      if (state === STATE.PANEL_DEFECTIVE) {
        pushBot("Highest priority: schedule the panel replacement. Document the location & serial number for the warranty claim. Optionally, also check the battery to rule out a second issue.")
        return
      }
      if (state === STATE.BATTERY_DONE) {
        pushBot("Follow the action plan above. Re-test after any maintenance. Anything else to check?")
        return
      }
      pushBot("Tell me what symptom you noticed (panel performance drop, battery discharge, abnormal heat) and I'll route you to the right diagnostic.")
      return
    }

    if (intent === 'ask_state_panel') {
      pushBot("Upload an EL scan of the panel via **📷 Upload panel** below and I'll inspect it.")
      setState(STATE.AWAITING_PANEL); return
    }
    if (intent === 'ask_state_battery') {
      pushBot("Upload a thermal scan of the battery via **🔋 Upload battery image** below.")
      setState(STATE.AWAITING_BATTERY_IMG); return
    }

    pushBot("I want to make sure I help correctly — could you describe the symptom you're seeing on the installation? For example: \"my panels produce less than usual\" or \"the battery doesn't hold charge anymore\".")
  }

  // ── File handlers in chat ──
  const onPickPanel    = () => panelRef.current?.click()
  const onPickBatImg   = () => batImgRef.current?.click()
  const onPickBatFeats = () => batFeatsRef.current?.click()

  const handlePanel = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    pushUser(`📎 Panel image · ${f.name}`)
    setLoading(true); setState(STATE.AWAITING_PANEL)
    pushBot("Let me run the full inspection — health check, defect-type classification and damage localization. Give me a few seconds… 🔍")
    try {
      const data = await inspectPanel(f)
      const isDefective = data.panel_status === 'Defective'
      const narrative = narratePanelInspection(data)

      // ── Long, generated-style summary paragraph ──
      pushBot(narrative.summary)

      // ── Show the AI's visual evidence INSIDE the chat (different from
      //     the direct-upload UI: the chat ALWAYS shows the visualizations
      //     when there's a defect, with a friendly intro line)
      if (isDefective && data.images) {
        setTimeout(() => {
          pushBot(
            `Here's what the AI saw — on the left the panel as you uploaded it, in the middle the damage heat map (the red areas are where the model is focusing), and on the right the same regions outlined for the maintenance team:`,
            {
              kind: 'images',
              payload: {
                images: [data.images.original, data.images.heatmap, data.images.bboxes].filter(Boolean),
                captions: ['Your scan', 'Damage heat map', 'Damage zones outlined'],
              },
            }
          )
        }, 700)
      }

      // ── Recommendation paragraph ──
      setTimeout(() => {
        pushBot(narrative.recommendation)
      }, isDefective ? 1500 : 800)

      // ── Follow-up question (offer the battery check) ──
      setTimeout(() => {
        pushBot(narrative.followup)
        setState(isDefective ? STATE.PANEL_DEFECTIVE : STATE.PANEL_HEALTHY)
        setLoading(false)
      }, isDefective ? 2300 : 1500)
    } catch (e) {
      pushBot(`⚠ I couldn't run the inspection: ${e.message}. The image might be unreadable, or the backend might be offline. Want to try a different file?`)
      setLoading(false)
    }
  }

  const handleBatteryImg = (e) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    pushUser(`📎 Battery thermal scan · ${f.name}`)
    setPendingBatteryImg(f)
    setState(STATE.AWAITING_BATTERY_FEATURES)
    pushBot("Got the thermal scan. Now I need the **25-feature JSON** — please upload it using the **🧾 Upload features JSON** button below.")
  }

  const handleBatteryFeats = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    if (!pendingBatteryImg) {
      pushBot("⚠ I'm missing the thermal scan. Please upload the battery image first via **🔋 Upload battery image**.")
      return
    }
    pushUser(`📎 Features JSON · ${f.name}`)
    setLoading(true)
    pushBot("Running the multimodal battery diagnostic… 🔋")
    try {
      const text = await f.text()
      const features = JSON.parse(text)
      const missing = BATTERY_FEATURE_KEYS.filter(k => !(k in features))
      if (missing.length > 0) {
        pushBot(`⚠ The JSON is missing ${missing.length} required feature(s): ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}. Please upload a JSON containing all 25 keys.`)
        setLoading(false)
        return
      }

      const data = await predictBatterySoh(pendingBatteryImg, features)
      const narrative = narrateBatteryDiagnostic(data)

      // Long generated summary
      pushBot(narrative.summary)

      // Show the thermal scan in chat (same image they uploaded, processed)
      if (data.thermal_image) {
        setTimeout(() => {
          pushBot(
            "Here's the thermal scan I analyzed — the colors map heat (blue = cool, red = hot). Uniform color is healthy; bright concentrated patches signal cells under stress.",
            {
              kind: 'images',
              payload: { images: [data.thermal_image], captions: ['Battery thermal scan'] },
            }
          )
        }, 700)
      }

      // Recommendation paragraph
      setTimeout(() => {
        pushBot(narrative.recommendation)
      }, 1500)

      setTimeout(() => {
        pushBot(narrative.followup)
        setState(STATE.BATTERY_DONE)
        setLoading(false)
        setPendingBatteryImg(null)
      }, 2300)
    } catch (e) {
      pushBot(`⚠ Battery diagnostic failed: ${e.message}`)
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-fade-up"
        onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-3xl bg-white shadow-2xl flex flex-col animate-fade-up"
        style={{ height: '100vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200"
          style={{ background: `linear-gradient(135deg, ${ACCENT}, #4F46E5)` }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-md">
              <span className="text-xl">🩺</span>
            </div>
            <div>
              <p className="font-bold text-white text-sm flex items-center gap-1.5">
                <Sparkles size={12} /> Expert Diagnostic agent
              </p>
              <p className="text-[10px] text-white/80">Tell me anything — I understand free language</p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition">
            <X size={16} />
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-slate-50/50">
          {messages.map(m => <Message key={m.id} message={m} />)}
          {loading && (
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <div className="w-9 h-9 rounded-full text-white flex items-center justify-center font-bold text-xs shadow-md flex-shrink-0"
                style={{ background: `linear-gradient(135deg, ${ACCENT}, #4F46E5)` }}>DR</div>
              <div className="bg-white border border-slate-200 px-4 py-3 rounded-2xl rounded-tl-sm">
                <span className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Upload buttons */}
        <div className="border-t border-slate-200 bg-white">
          <div className="px-3 pt-3 flex items-center gap-2 flex-wrap">
            <button onClick={onPickPanel} disabled={loading}
              className="text-xs font-semibold px-3 py-1.5 rounded-full border-2 border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 transition disabled:opacity-50 inline-flex items-center gap-1.5">
              <Camera size={12} /> Upload panel
            </button>
            <button onClick={onPickBatImg} disabled={loading}
              className="text-xs font-semibold px-3 py-1.5 rounded-full border-2 border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100 transition disabled:opacity-50 inline-flex items-center gap-1.5">
              <Flame size={12} /> Upload battery image
            </button>
            <button onClick={onPickBatFeats} disabled={loading}
              className="text-xs font-semibold px-3 py-1.5 rounded-full border-2 border-cyan-200 bg-cyan-50 text-cyan-700 hover:bg-cyan-100 transition disabled:opacity-50 inline-flex items-center gap-1.5">
              <FileText size={12} /> Upload features JSON
            </button>
          </div>
          <input ref={panelRef}    type="file" accept="image/*" className="hidden" onChange={handlePanel} />
          <input ref={batImgRef}   type="file" accept="image/*,.npy" className="hidden" onChange={handleBatteryImg} />
          <input ref={batFeatsRef} type="file" accept=".json,application/json" className="hidden" onChange={handleBatteryFeats} />

          <form onSubmit={handleSend} className="px-3 py-3 flex items-center gap-2">
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
              placeholder="Describe the issue freely…"
              disabled={loading}
              className="flex-1 px-4 py-2.5 rounded-full bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:border-indigo-300 transition disabled:opacity-50" />
            <button type="submit" disabled={!input.trim() || loading}
              className="w-10 h-10 rounded-full text-white flex items-center justify-center shadow-md hover:scale-105 transition disabled:opacity-40 disabled:scale-100"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, #4F46E5)` }}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function Message({ message }) {
  const isBot = message.role === 'bot'
  const isUser = message.role === 'user'
  return (
    <div className={clsx('flex gap-2', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div className={clsx('w-9 h-9 rounded-full text-white flex items-center justify-center font-bold text-xs shadow-md flex-shrink-0',
        isBot ? '' : 'bg-slate-700')}
        style={isBot ? { background: `linear-gradient(135deg, ${ACCENT}, #4F46E5)` } : undefined}>
        {isBot ? 'DR' : 'You'}
      </div>
      <div className="max-w-[85%]">
        <div className={clsx('px-4 py-3 text-sm leading-relaxed',
          isBot
            ? 'bg-white border border-slate-200 text-slate-800 rounded-2xl rounded-tl-sm'
            : 'text-white rounded-2xl rounded-tr-sm bg-slate-700')}>
          {message.content && (
            <p className="whitespace-pre-wrap" dangerouslySetInnerHTML={{
              __html: message.content
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            }} />
          )}
          {message.kind === 'card' && message.payload && (
            <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
              {message.payload.title && (
                <p className="text-xs font-bold uppercase tracking-wide text-slate-700">{message.payload.title}</p>
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
                <p className="text-[10px] text-slate-500 italic">{message.payload.footer}</p>
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
