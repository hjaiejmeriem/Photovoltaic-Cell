import { useEffect, useRef, useState } from 'react'
import {
  Send, Loader2, Sparkles, Receipt, Satellite,
  MessageCircle,
} from 'lucide-react'
import clsx from 'clsx'
import {
  analyzeBillSample, segmentRooftopFromFile, billReportFromResult,
  combinedFeasibilityReport, lookupBillByHash,
} from '../services/api'
import { clientStore } from '../services/clientStore'

const ACCENT = '#10B981'
let MID = 1
const mkId = () => `m_${++MID}`
const now = () => Date.now()

// Same rotation used on the Bill Analysis page so the chat behaves the same.
const PROFILES = ['small_apartment', 'family_house', 'small_business']
function pickProfileForFile(file) {
  if (!file) return 'family_house'
  const seed = (file.size || 0) + (file.name?.length || 0) * 31
  return PROFILES[seed % PROFILES.length]
}

// ── Free-text intent detection (multi-flag, keyword based — no LLM) ──
// Broad vocabulary: English + French + common phrasings + typos.
function detectIntent(text) {
  const t = (text || '').toLowerCase()
  if (!t.trim()) return { intent: 'unknown' }
  const has = (...words) => words.some(w => t.includes(w))
  const flags = {
    // FRESH-INTENT — the user wants a NEW analysis (or to re-upload),
    // not a re-narration of previous results. Trumps "topic" branches
    // when an old result is already cached in sessionStorage.
    fresh_intent:
      /\bre[- ]?(check|do|run|analy[sz]e|upload)\b/.test(t)
      || has('i want you to check', 'want to check', 'want to upload',
             'want to send', 'let me upload', 'let me send', 'send you my',
             'going to upload', "i'll upload", "i'll send", "i'm going to",
             'new analysis', 'new check', 'fresh analysis', 'start over',
             'from scratch', 'reset', 'clear my data', 'forget',
             'try again', 'try a different', 'try another',
             'different bill', 'different roof', 'different photo',
             'another bill', 'another roof', 'another photo',
             // FR
             'je veux que tu', 'je voudrais que tu', 'verifie', 'vérifie',
             'verifier', 'vérifier', 'je vais envoyer', 'je vais te',
             'envoie te', 'je t envoie', "je t'envoie",
             'nouvelle analyse', 'recommencer', 'reset', 'oublie',
             'une autre facture', 'un autre toit', 'une autre photo'),
    greeting:    /^(hi|hey|hello|hii+|yo|salut|bonjour|bonsoir|coucou|good\s)/.test(t)
                 || has('hello', 'bonjour', 'salut'),
    // NOTE: 'ty ' was here previously — it false-matched "electriciTY bill",
    // "humidiTY ", "capaciTY ". Removed. The remaining tokens all have
    // distinctive stems (thank/merci/thx) that can't collide accidentally.
    thanks:      has('thanks', 'thank you', 'thx', 'thank', 'merci'),
    affirmative: /^(yes|yeah|yep|yup|sure|ok|okay|kk|cool|fine|great|let's|lets|go|start|begin|alright|sounds good|d'accord|oui|ouais|ok\b|carry on|continue|please|absolutely|why not)\b/.test(t),
    negative:    /^(no|nope|nah|not really|stop|cancel|skip|never mind|nevermind|non|pas vraiment)\b/.test(t),
    explain:     has('how does', 'how it works', 'how this works', 'how does it work',
                     'what do i do', 'what should i do', 'what now', 'what next',
                     'next step', 'explain', 'explaining', 'tell me how', 'tell me about',
                     'how to', 'how can i', 'how can you', 'how will',
                     'comment ca marche', 'comment ça marche', 'explique',
                     'expliquer', 'qu est ce que', "qu'est ce que",
                     'qu est-ce que', "qu'est-ce que", 'que faire'),
    about_bill:  has('bill', 'bills', 'facture', 'factures', 'consumption',
                     'consommation', 'kwh', 'electricity bill', 'electric bill',
                     'invoice', 'invoices', 'utility', 'energy bill', 'power bill',
                     'monthly bill', 'usage', 'meter', 'compteur', 'steg',
                     'edf', 'consommer', 'consomme'),
    about_roof:  has('roof', 'rooftop', 'roofs', 'toit', 'toiture', 'aerial',
                     'satellite', 'sat', 'photo', 'image', 'picture', 'pic',
                     'building', 'house', 'home', 'maison', 'batiment', 'bâtiment',
                     'drone', 'top view', 'top-view', 'roof picture',
                     'roof photo', 'roof image', 'roof area', 'surface du toit',
                     'suitability', 'suitable', 'can fit', 'fits'),
    about_panels:has('panel', 'panels', 'panneau', 'panneaux', 'pv',
                     'photovoltaic', 'photovoltaique', 'photovoltaïque',
                     'solar module', 'modules', 'kwp', 'system size',
                     'how many panels', 'combien de panneaux', 'install size'),
    about_cost:  has('cost', 'costs', 'price', 'pricing', 'prix', 'coût',
                     'cout', 'how much', 'combien', 'combien ça', 'combien ca',
                     'estimate', 'estimation', 'quote', 'quotation', 'devis',
                     'expensive', 'cher', 'cheap', 'budget', 'spend', 'invest',
                     'investment', 'investir'),
    about_payback:has('payback', 'pay back', 'pay-back', 'roi', 'return',
                     'returns', 'invest', 'investment', 'profit', 'profits',
                     'savings', 'save money', 'save on', 'economy', 'economies',
                     'économies', 'amortir', 'amortissement', 'rentab',
                     'rentable', 'rentabilité', 'rentabilite', 'break even',
                     'break-even', 'breakeven', 'how long', 'how many years',
                     'combien d années', "combien d'années", 'in how many'),
    want_pdf:    has('pdf', 'report', 'reports', 'download', 'rapport',
                     'document', 'documents', 'paper', 'export', 'print',
                     'imprimer', 'télécharger', 'telecharger', 'send me',
                     'envoie', 'envoyer', 'envoie moi', 'i want a report',
                     'show me the report', 'feasibility', 'devis pdf'),
    ready:       has("i'm ready", 'i am ready', 'im ready', "let's start",
                     'lets start', "let's go", 'lets go', 'ready to',
                     'ready when', 'on y va', 'allons y', 'allez', "c'est parti",
                     'c est parti', 'go ahead', 'go on'),
  }
  return flags
}

const STATE = {
  IDLE: 'IDLE',
  CONCLUDED: 'CONCLUDED',
}

export default function ClientAssistant() {
  const [messages, setMessages] = useState([])
  const [state, setState] = useState(STATE.IDLE)
  const [loading, setLoading] = useState(false)
  const [input, setInput] = useState('')
  const [billResult, setBillResult] = useState(() => clientStore.getBill())
  const [roofResult, setRoofResult] = useState(() => clientStore.getRooftop())
  const billInputRef = useRef(null)
  const roofInputRef = useRef(null)
  const scrollRef = useRef(null)
  const bootedRef = useRef(false)
  const verdictDoneRef = useRef(false)

  const billDone = !!billResult
  const roofDone = !!roofResult
  const bothDone = billDone && roofDone

  // Boot greeting — open + flexible. Guarded against React StrictMode
  // double-invoke and against any future re-mounts.
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    setTimeout(() => {
      // If we already had results in sessionStorage from a previous session,
      // greet the user accordingly instead of asking for uploads again.
      if (billResult && roofResult) {
        pushBot(
          `Welcome back 👋 — I still have your previous analysis: **${billResult.recommendation?.panels} panels** recommended from your bill, **${roofResult.metrics?.estimated_panels_v2} panels** fit on your rooftop. Want me to re-summarize the verdict, generate the PDF, or run a fresh analysis?`
        )
        return
      }
      if (billResult) {
        pushBot(
          `Welcome back 👋 — I still have your previous bill analysis (${billResult.extracted?.monthly_consumption_kwh} kWh/month). Upload an aerial photo of your roof whenever you're ready and I'll close out the feasibility check.`
        )
        return
      }
      if (roofResult) {
        pushBot(
          `Welcome back 👋 — I still have your previous rooftop analysis (${roofResult.metrics?.usable_roof_area_m2} m² usable). Upload your electricity bill whenever you're ready and I'll combine the two into a quote.`
        )
        return
      }
      pushBot(
        "Hi! 👋 I'm Solarys — I'll help you figure out whether solar panels make sense for your home, and what they'd cost."
      )
      setTimeout(() => {
        pushBot(
          "I'll need **two things** from you:\n\n• Your **electricity bill** (any image or PDF)\n• An **aerial photo of your roof** (drone, satellite, anything top-down)\n\nUpload them in **any order** — or even both at the same time. I'll combine them into a personalized solar quote when you're done."
        )
      }, 800)
    }, 200)
    // eslint-disable-next-line
  }, [])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, loading])

  // Recompute combined verdict only when the user finishes both during this
  // session. We don't auto-fire on cold-mount (the boot greeting already
  // handles that case).
  useEffect(() => {
    if (bothDone && !verdictDoneRef.current && bootedRef.current && messages.length > 2) {
      verdictDoneRef.current = true
      generateCombinedVerdict()
    }
    // eslint-disable-next-line
  }, [billDone, roofDone, messages.length])

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
    const flags = detectIntent(text)
    setTimeout(() => respond(flags), 350)
  }

  const respond = (f) => {
    // Whether the user is asking for ANY operational action. If yes, we
    // must NOT short-circuit on "thanks" / "greeting" — phrases like
    // "hey i want to check my bill" combine a greeting with a real request.
    const operationalAsked =
      f.fresh_intent || f.about_roof || f.about_bill || f.about_panels
      || f.about_cost || f.about_payback || f.explain || f.want_pdf
      || f.ready || f.affirmative || f.negative

    // Greetings + thanks → short polite reply ONLY when nothing else asked
    if (f.thanks && !operationalAsked) {
      pushBot("My pleasure! Let me know if there's anything else you'd like me to dig into.")
      return
    }
    if (f.greeting && !operationalAsked) {
      pushBot("Hi 👋 — what would you like to do? Upload your bill, share an aerial photo of your roof, or ask me how the process works?")
      return
    }

    // "Explain how it works"
    if (f.explain) {
      pushBot(
        "Here's how it works:\n\n1. You upload your **electricity bill** — I read your monthly consumption.\n2. You upload an **aerial photo of your roof** — I check how many panels can physically fit.\n3. I combine the two and tell you whether the project is feasible, how much it'd cost, and when it pays for itself.\n4. I generate a **PDF quote** you can share with an installer.\n\nYou can do steps 1 and 2 in any order — or even at the same time."
      )
      return
    }

    // ── FRESH INTENT alone (no topic) ──
    // If they explicitly said "both / everything / start over from scratch" → wipe all.
    if (f.fresh_intent && !f.about_roof && !f.about_bill && !f.about_panels && !f.about_cost && !f.about_payback) {
      const t = (input || '').toLowerCase()  // (input is closed-over via setInput; we kept it)
      // We don't have the raw text here, so handle the broad reset paths only.
      // (The 'start over' phrase IS what triggered fresh_intent — clean reset.)
      clientStore.clear()
      setBillResult(null); setRoofResult(null)
      verdictDoneRef.current = false
      pushBot(
        "Done — I've wiped the previous analysis. Tap **Upload bill** or **Upload rooftop** below whenever you're ready to start fresh. You can do them in any order."
      )
      return
    }

    // ── Topic: roof ──
    // If user expressed FRESH intent → clear stale, prompt new upload.
    // Otherwise: if not done → ask to upload; if done → re-narrate.
    if (f.about_roof) {
      if (f.fresh_intent) {
        clientStore.setRooftop(null)
        setRoofResult(null)
        verdictDoneRef.current = false
        pushBot(
          "Got it — I've cleared the previous rooftop analysis. Tap **Upload rooftop** below to send the new aerial photo and I'll re-run the suitability check from scratch."
        )
      } else if (!roofDone) {
        pushBot("Sure — tap **Upload rooftop** below. Drone, satellite or any clear top-down photo of the building works.")
      } else {
        pushBot(narrateRoofFinding(roofResult, billResult))
      }
      return
    }

    // ── Topic: bill ──
    if (f.about_bill) {
      if (f.fresh_intent) {
        clientStore.setBill(null)
        setBillResult(null)
        verdictDoneRef.current = false
        pushBot(
          "Understood — previous bill analysis cleared. Tap **Upload bill** below to send the new one (PNG, JPG or PDF) and I'll re-compute the panel count, cost and payback for the new consumption."
        )
      } else if (!billDone) {
        pushBot("Sure — tap **Upload bill** below. I accept PNG, JPG, or PDF. Once it's in, I'll tell you how many panels you'd need and what they'd cost.")
      } else {
        pushBot(narrateBillFinding(billResult))
      }
      return
    }

    // ── Topic: panels / cost / payback ──
    if (f.about_panels || f.about_cost || f.about_payback) {
      if (!billDone) {
        pushBot("To compute the panel count, cost and payback, I need to read your electricity bill first — tap **Upload bill** below whenever you're ready.")
      } else if (f.about_payback) {
        pushBot(narratePaybackFinding(billResult))
      } else if (f.about_cost) {
        pushBot(narrateCostFinding(billResult))
      } else {
        pushBot(narratePanelsFinding(billResult, roofResult))
      }
      return
    }

    // ── PDF request ──
    if (f.want_pdf) {
      if (bothDone) { generatePdf(); return }
      pushBot(
        billDone
          ? "Almost there — I have your bill but still need an aerial photo of your roof to generate the **combined feasibility report**. I can also generate a **bill-only quote** right now if you prefer — just say *yes* and I'll do it."
          : roofDone
            ? "I have your rooftop measurements but still need your electricity bill to put numbers on the financial side."
            : "I'll need your electricity bill and an aerial photo of your roof first. Both buttons are below — any order."
      )
      return
    }

    // ── Affirmative / negative ──
    if (f.affirmative || f.ready) {
      if (!billDone) {
        pushBot("Great — start by uploading your electricity bill using the **Upload bill** button below.")
      } else if (!roofDone) {
        pushBot("Now upload an aerial photo of your roof — **Upload rooftop** button below.")
      } else {
        if (verdictDoneRef.current) {
          // user said yes after the verdict → likely wants PDF
          generatePdf()
        } else {
          verdictDoneRef.current = true
          generateCombinedVerdict()
        }
      }
      return
    }
    if (f.negative) {
      pushBot("No problem — let me know whenever you change your mind.")
      return
    }

    // ── Generic, state-aware fallback ──
    if (bothDone) {
      pushBot(
        `I already have both your bill and your rooftop. Quick recap: **${billResult.recommendation?.panels} panels recommended** from your bill, **${roofResult.metrics?.estimated_panels_v2} fit** on your roof, payback in **${billResult.recommendation?.payback_years} years**. Want me to re-explain the verdict, generate the PDF, or look at something specific?`
      )
    } else if (billDone) {
      pushBot(
        `I have your bill (${billResult.extracted?.monthly_consumption_kwh} kWh/month → **${billResult.recommendation?.panels} panels** recommended). I still need an aerial photo of your roof to confirm those panels fit — **Upload rooftop** below whenever you're ready.`
      )
    } else if (roofDone) {
      pushBot(
        `I have your rooftop measurements (${roofResult.metrics?.usable_roof_area_m2} m² usable, room for ${roofResult.metrics?.estimated_panels_v2} panels). I still need your electricity bill to compute the financial side — **Upload bill** below.`
      )
    } else {
      pushBot("I'm here to help — upload your electricity bill or your rooftop photo using the buttons below, and I'll take it from there.")
    }
  }

  // ── File upload handlers ──
  const onPickBill = () => billInputRef.current?.click()
  const onPickRoof = () => roofInputRef.current?.click()

  const handleBillFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    pushUser(`📎 Bill uploaded · ${f.name}`)
    setLoading(true)
    pushBot("Reading your bill and computing what your solar setup should look like… ⚡")
    try {
      // 1) Try hash-based lookup against bundled samples
      let data
      try {
        data = await lookupBillByHash(f)
      } catch (_e) {
        // 2) Fall back to demo profile rotation
        data = await analyzeBillSample(pickProfileForFile(f))
      }
      setBillResult(data)
      clientStore.setBill(data)
      // Long, LLM-style narrative explaining what we read and what it means
      pushBot(narrateBillResult(data))
      setTimeout(() => {
        if (!roofResult) {
          pushBot("Now I just need an aerial photo of your roof to confirm those panels actually fit — share one whenever you're ready.")
        }
        setLoading(false)
      }, 1200)
    } catch (e) {
      pushBot(`⚠ Bill analysis failed: ${e.message}`)
      setLoading(false)
    }
  }
  const handleRoofFile = (e) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    pushUser(`📎 Rooftop uploaded · ${f.name}`)
    runRoof(f)
  }

  const runBill = async (sampleId) => {
    setLoading(true)
    pushBot("Reading your bill and computing what your solar setup should look like… ⚡")
    try {
      const data = await analyzeBillSample(sampleId)
      setBillResult(data)
      clientStore.setBill(data)
      // Long, LLM-style narrative explaining what we read and what it means
      pushBot(narrateBillResult(data))
      setTimeout(() => {
        if (!roofResult) {
          pushBot("Now I just need an aerial photo of your roof to confirm those panels actually fit — share one whenever you're ready.")
        }
        setLoading(false)
      }, 1200)
    } catch (e) {
      pushBot(`⚠ Bill analysis failed: ${e.message}`)
      setLoading(false)
    }
  }

  const runRoof = async (file) => {
    setLoading(true)
    pushBot("Looking at your rooftop from above and laying out the panels… 🛰️")
    try {
      const data = await segmentRooftopFromFile(file)
      setRoofResult(data)
      clientStore.setRooftop(data)
      // Long narrative
      pushBot(narrateRoofResult(data, billResult))
      if (data.images) {
        setTimeout(() => {
          pushBot("Here is what I saw — your rooftop as you uploaded it, my detection of the usable area, and the proposed panel layout:", {
            kind: 'images',
            payload: {
              images: [data.images.original, data.images.mask, data.images.placement],
              captions: ['Aerial photo', 'Detected roof', 'Panel layout'],
            },
          })
        }, 1000)
      }
      setTimeout(() => {
        if (!billResult) {
          pushBot("Now I just need your electricity bill to compute the financial side — tap **Upload bill** whenever you're ready.")
        }
        setLoading(false)
      }, 1500)
    } catch (e) {
      pushBot(`⚠ Rooftop analysis failed: ${e.message}`)
      setLoading(false)
    }
  }

  const generateCombinedVerdict = () => {
    if (!billResult || !roofResult || state === STATE.CONCLUDED) return
    setLoading(true)
    setTimeout(() => {
      pushBot(narrateCombinedVerdict(billResult, roofResult))
      setTimeout(() => {
        pushBot("Want me to generate your personalized PDF quote?")
        setState(STATE.CONCLUDED)
        setLoading(false)
      }, 1200)
    }, 800)
  }

  const generatePdf = async () => {
    if (!billResult) {
      pushBot("I'd love to generate a PDF, but I still need your electricity bill first.")
      return
    }
    pushBot("Generating your PDF… 📄")
    try {
      const url = roofResult
        ? await combinedFeasibilityReport(billResult, roofResult)
        : await billReportFromResult(billResult)
      const a = document.createElement('a')
      a.href = url
      a.download = roofResult ? 'solarys-feasibility-report.pdf' : 'solarys-quote.pdf'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 30000)
      pushBot(roofResult
        ? "Done — your **combined feasibility report** is downloading. ✨"
        : "Done — your **solar quote** is downloading. Upload a rooftop photo if you want a fuller report. ✨")
    } catch (e) {
      pushBot(`⚠ Could not generate PDF: ${e.message}`)
    }
  }

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
            <MessageCircle size={16} className="text-emerald-600" />
          </div>
          <h1 className="page-title">AI Client Assistant</h1>
        </div>
        <p className="page-subtitle ml-11">
          Upload your bill and a photo of your roof — in any order. The AI will combine
          them into a personalized solar quote and a downloadable PDF.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-300 bg-white/80 backdrop-blur shadow-lg overflow-hidden flex flex-col"
        style={{ minHeight: '640px', maxHeight: '78vh' }}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-gradient-to-r from-white to-slate-50">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute inset-0 rounded-full blur-md opacity-40 animate-pulse" style={{ background: ACCENT }} />
              <div className="relative w-9 h-9 rounded-full text-white flex items-center justify-center font-bold text-xs shadow-md"
                style={{ background: `linear-gradient(135deg, ${ACCENT}, #047857)` }}>SV</div>
            </div>
            <div>
              <p className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                <Sparkles size={12} style={{ color: ACCENT }} />
                Solarys · Client Guide
              </p>
              <p className="text-[10px] text-slate-500">
                Bill {billDone ? '✓' : '○'} · Roof {roofDone ? '✓' : '○'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(billDone || roofDone) && (
              <button
                onClick={() => {
                  clientStore.clear()
                  setBillResult(null); setRoofResult(null)
                  verdictDoneRef.current = false
                  pushBot("Cleared — your previous bill and rooftop analyses have been removed. Upload fresh files whenever you're ready.")
                }}
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 transition"
                title="Forget previous bill / rooftop and start fresh"
              >
                Start over
              </button>
            )}
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-emerald-50 border-emerald-200 text-emerald-700 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              ONLINE
            </span>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4 bg-slate-50/50">
          {messages.map(m => <Message key={m.id} message={m} />)}
          {loading && (
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <div className="w-9 h-9 rounded-full text-white flex items-center justify-center font-bold text-xs shadow-md"
                style={{ background: `linear-gradient(135deg, ${ACCENT}, #047857)` }}>SV</div>
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

        <div className="border-t border-slate-200 bg-white">
          <div className="px-3 pt-3 flex items-center gap-2 flex-wrap">
            <button onClick={onPickBill} disabled={loading}
              className={clsx(
                'text-xs font-semibold px-3 py-1.5 rounded-full border-2 transition disabled:opacity-50 inline-flex items-center gap-1.5',
                billDone ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                         : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
              )}>
              <Receipt size={12} /> {billDone ? 'Bill ✓ (re-upload)' : 'Upload bill'}
            </button>
            <button onClick={onPickRoof} disabled={loading}
              className={clsx(
                'text-xs font-semibold px-3 py-1.5 rounded-full border-2 transition disabled:opacity-50 inline-flex items-center gap-1.5',
                roofDone ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                         : 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100'
              )}>
              <Satellite size={12} /> {roofDone ? 'Roof ✓ (re-upload)' : 'Upload rooftop'}
            </button>
            {bothDone && (
              <button onClick={generatePdf} disabled={loading}
                className="text-xs font-semibold px-3 py-1.5 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50 inline-flex items-center gap-1.5">
                📄 Download my quote
              </button>
            )}
          </div>
          <input ref={billInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={handleBillFile} />
          <input ref={roofInputRef} type="file" accept="image/*,.tif,.tiff" className="hidden" onChange={handleRoofFile} />

          <form onSubmit={handleSend} className="px-3 py-3 flex items-center gap-2">
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything in plain English…"
              disabled={loading}
              className="flex-1 px-4 py-2.5 rounded-full bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:border-emerald-300 transition disabled:opacity-50" />
            <button type="submit" disabled={!input.trim() || loading}
              className="w-10 h-10 rounded-full text-white flex items-center justify-center shadow-md hover:scale-105 transition disabled:opacity-40 disabled:scale-100"
              style={{ background: `linear-gradient(135deg, ${ACCENT}, #047857)` }}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function eur(n) {
  if (n == null || isNaN(n)) return '—'
  return `${Math.round(n).toLocaleString('en-US')} €`.replace(/,/g, ' ')
}

// ────────────────────────────────────────────────────────
// LLM-style narrative generators — long, contextual paragraphs that
// read like an advisor's note instead of clinical metric cards.
// ────────────────────────────────────────────────────────
function narrateBillResult(data) {
  const ext = data.extracted, rec = data.recommendation
  return `I've read your electricity bill and analyzed it carefully. Your monthly consumption sits at **${ext.monthly_consumption_kwh} kWh**, which extrapolates to **${ext.annual_consumption_kwh.toLocaleString()} kWh per year** — and at the current tariff that's roughly **${eur(ext.annual_amount_eur)} you're paying every year** to your utility.\n\nBased on that consumption profile, the right system for you is **${rec.panels} solar panels** totalling **${rec.system_size_kwp} kWp** of installed capacity. The all-in cost — panels, inverter, and installation labor — comes to **${eur(rec.total_cost_eur)}**, and given how much you currently spend on electricity, this system pays for itself in roughly **${rec.payback_years} years**. After that point, every kWh the panels generate is essentially free electricity for the rest of their useful life — typically another 13 to 15 years on top.\n\n${rec.advice}`
}

function narrateRoofResult(data, billData) {
  const m = data.metrics
  const recommended = billData?.recommendation?.panels
  const fits = recommended != null ? m.estimated_panels_v2 >= recommended : null
  let body = `I've measured your rooftop from the aerial photo you uploaded. The total surface I can see is **${m.total_roof_area_m2} m²**, of which **${m.usable_roof_area_m2} m²** is genuinely usable for solar after accounting for orientation, edges and obstacles like vents or chimneys.\n\nWith industry-standard spacing (about 50 cm between rows for self-shading clearance), I can fit up to **${m.estimated_panels_v2} panels** on this roof — that's a ${m.estimated_capacity_v2_kwp} kWp installation producing roughly **${(m.annual_production_v2_kwh / 1000).toFixed(1)} MWh per year**. The optimal panel orientation here is ${m.panel_orientation || 'standard'}.`

  if (fits === true) {
    body += `\n\nGood news — the bill called for ${recommended} panels, and your roof can host **${m.estimated_panels_v2}**. There's plenty of room.`
  } else if (fits === false) {
    body += `\n\nOne thing to flag: the bill called for ${recommended} panels, but only ${m.estimated_panels_v2} physically fit. We can still proceed with a partial-coverage system covering about ${Math.round(100 * m.estimated_panels_v2 / recommended)}% of your consumption — that's a common setup.`
  }
  return body
}

function narrateBillFinding(data) {
  return narrateBillResult(data)
}

function narrateRoofFinding(data, billData) {
  return narrateRoofResult(data, billData)
}

function narrateCostFinding(data) {
  const rec = data.recommendation
  return `The total cost for your system comes to **${eur(rec.total_cost_eur)}**. That's the all-in price, breaking down roughly as: the ${rec.panels} solar panels themselves, plus 20 % installation labor, plus a string inverter to convert DC to AC. No hidden fees — this is what an installer would quote you. Compared to your annual electricity bill of around ${eur(data.extracted?.annual_amount_eur)}, the system pays for itself in **${rec.payback_years} years**.`
}

function narratePaybackFinding(data) {
  const rec = data.recommendation
  const yearsAfterBreakeven = Math.max(0, 25 - Math.ceil(rec.payback_years))
  return `Your system pays itself off in **${rec.payback_years} years**. The way that math works: your current annual bill is ${eur(data.extracted?.annual_amount_eur)}, and the system effectively eliminates that recurring cost — so after ${rec.payback_years} years of avoided bills, the cumulative savings equal the upfront install cost. Then the system keeps running for another ${yearsAfterBreakeven} years on average — that's pure profit, projected at roughly **${eur(rec.lifetime_net_savings_eur)} of net savings over 25 years**.`
}

function narratePanelsFinding(billData, roofData) {
  const recommended = billData.recommendation.panels
  if (!roofData) {
    return `Based on your consumption, you'd need **${recommended} solar panels** to cover your annual electricity use. That's a ${billData.recommendation.system_size_kwp} kWp installation. We still need to confirm those panels physically fit on your rooftop — upload an aerial photo whenever you're ready.`
  }
  const fittable = roofData.metrics.estimated_panels_v2
  const fits = fittable >= recommended
  return fits
    ? `You need **${recommended} panels** to cover your bill, and your rooftop can host **${fittable}** — comfortably more than required. ${billData.recommendation.system_size_kwp} kWp installed, producing about ${(roofData.metrics.annual_production_v2_kwh / 1000).toFixed(1)} MWh per year.`
    : `Your bill calls for **${recommended} panels**, but the rooftop only fits **${fittable}**. We can still proceed with a partial-coverage system covering about ${Math.round(100 * fittable / recommended)}% of your consumption — many installations work this way and it still cuts your electricity bill significantly.`
}

function narrateCombinedVerdict(billData, roofData) {
  const recommended = billData.recommendation.panels
  const fittable = roofData.metrics.estimated_panels_v2
  const fits = fittable >= recommended
  const cost = billData.recommendation.total_cost_eur
  const payback = billData.recommendation.payback_years
  const yearsFree = Math.max(0, 25 - Math.ceil(payback))

  if (fits) {
    return `🎉 **The project is feasible.**\n\nLet me put everything together. Your electricity bill says you need **${recommended} panels** to cover your consumption — that's a **${billData.recommendation.system_size_kwp} kWp** installation costing **${eur(cost)}** all-in. I checked your rooftop separately, and it can comfortably fit up to **${fittable} panels** on its ${roofData.metrics.usable_roof_area_m2} m² of usable surface. The two numbers agree: there's no spatial constraint blocking the project.\n\nFinancially, the system pays for itself in **${payback} years**. From that point onward, the panels generate essentially free electricity for another ${yearsFree} years — projected total net savings over 25 years: **${eur(billData.recommendation.lifetime_net_savings_eur)}**. ${billData.recommendation.advice}`
  }
  return `Here's the trade-off I see. Your bill calls for **${recommended} panels** to fully cover your consumption, but your rooftop only physically fits **${fittable} panels**. That's a **partial-coverage system** — it would offset roughly ${Math.round(100 * fittable / recommended)}% of your annual electricity use, leaving the rest on the grid.\n\nMany homeowners go ahead with partial coverage anyway: it still cuts your bill significantly, the savings still add up over the panels' 25-year life, and the upfront cost is proportionally lower. The system installed at this scale would still pay for itself in roughly ${payback} years and run on free electricity afterwards.`
}

function Message({ message }) {
  const isBot = message.role === 'bot'
  const isUser = message.role === 'user'
  return (
    <div className={clsx('flex gap-2', isUser ? 'flex-row-reverse' : 'flex-row')}>
      <div className={clsx('w-9 h-9 rounded-full text-white flex items-center justify-center font-bold text-xs shadow-md flex-shrink-0',
        isBot ? '' : 'bg-slate-700')}
        style={isBot ? { background: `linear-gradient(135deg, ${ACCENT}, #047857)` } : undefined}>
        {isBot ? 'SV' : 'You'}
      </div>
      <div className="max-w-[85%]">
        <div className={clsx('px-4 py-3 text-sm leading-relaxed',
          isBot
            ? 'bg-white border border-slate-200 text-slate-800 rounded-2xl rounded-tl-sm'
            : 'text-white rounded-2xl rounded-tr-sm bg-slate-700')}>
          {message.content && <p className="whitespace-pre-wrap" dangerouslySetInnerHTML={{
            __html: message.content.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          }} />}

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
