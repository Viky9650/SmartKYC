import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { casesApi, documentsApi, chatApi, reviewsApi } from '../services/api'

// ── Types ─────────────────────────────────────────────────────────────────────
type MsgRole = 'bot' | 'user'
interface Msg {
  id: string
  role: MsgRole
  text?: string
  file?: { name: string; size: number }
  extraction?: any
  caseCard?: { caseId: string; caseNumber: string; subjectName: string; status: string }
}

const DOC_TYPE_LABELS: Record<string, string> = {
  US_PASSPORT: '🇺🇸 US Passport',
  GB_PASSPORT: '🇬🇧 UK Passport',
  IN_PASSPORT: '🇮🇳 India Passport',
  IN_AADHAAR: '🇮🇳 Aadhaar Card',
  IN_PAN: '🇮🇳 PAN Card',
  EU_PASSPORT: '🇪🇺 EU Passport',
  EU_NATIONAL_ID: '🇪🇺 EU National ID',
  AE_PASSPORT: '🇦🇪 UAE Passport',
  AE_EMIRATES_ID: '🇦🇪 Emirates ID',
  CN_PASSPORT: '🇨🇳 China Passport',
  CN_ID_CARD: '🇨🇳 China Resident ID',
  RU_PASSPORT: '🇷🇺 Russia Passport',
  COMPANY_REGISTRATION: '🏢 Company Registration',
  GENERIC_PASSPORT: '🌍 Passport',
}

function uid() {
  return Math.random().toString(36).slice(2)
}

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1048576).toFixed(1)} MB`
}

// ── Extraction card shown inside chat ─────────────────────────────────────────
function ExtractionCard({ extraction }: { extraction: any }) {
  const fields = extraction?.fields || {}
  const confs = extraction?.confidences || {}
  const fullName = extraction?.full_name || fields?.name || ''
  const method = extraction?.extraction_method || ''
  const conf = extraction?.overall_confidence || 0
  const docType = extraction?.document_type || ''
  const country = extraction?.country || ''

  const methodBadge = ({
    gemini_vision: { label: '✦ Gemini Vision', bg: '#dcfce7', color: '#15803d', border: '#bbf7d0' },
    mrz:           { label: '⊞ MRZ Parser',    bg: '#dce8fc', color: '#2563eb', border: '#bdd0f8' },
    tesseract:     { label: '◈ OCR Fallback',  bg: '#fef9c3', color: '#b45309', border: '#fde68a' },
    pdfminer:      { label: '⊠ PDF Text',      bg: '#ede9fe', color: '#6d28d9', border: '#ddd6fe' },
  } as Record<string, any>)[method] || { label: method || 'extracted', bg: '#eef1f8', color: '#5a6a84', border: '#d1d9ee' }

  const entries = Object.entries(fields)
    .filter(([k]) => !k.startsWith('_'))
    .slice(0, 12)

  if (!entries.length && !fullName) {
    return (
      <div style={{ padding: '10px 14px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 8, fontSize: 13, color: '#b45309' }}>
        ⚠ Document detected but no fields could be extracted. Try a clearer image.
      </div>
    )
  }

  return (
    <div style={{
      background: '#f8fffe', border: '1px solid #a7f3d0',
      borderRadius: 12, padding: 16, marginTop: 8,
    }}>
      {/* Header badges */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#15803d' }}>✓ Fields extracted</span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
          background: methodBadge.bg, color: methodBadge.color, border: `1px solid ${methodBadge.border}`,
          fontFamily: 'monospace',
        }}>{methodBadge.label}</span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
          background: conf >= 0.9 ? '#dcfce7' : '#fef9c3',
          color: conf >= 0.9 ? '#15803d' : '#b45309',
          border: `1px solid ${conf >= 0.9 ? '#bbf7d0' : '#fde68a'}`,
          fontFamily: 'monospace',
        }}>{Math.round(conf * 100)}% conf.</span>
        {docType && (
          <span style={{ fontSize: 11, color: '#5a6a84' }}>{docType}{country ? ` · ${country}` : ''}</span>
        )}
      </div>

      {/* Full name highlight */}
      {fullName && (
        <div style={{
          padding: '8px 12px', background: '#dce8fc',
          border: '1px solid #bdd0f8', borderRadius: 8, marginBottom: 12,
        }}>
          <div style={{ fontSize: 10, color: '#5a6a84', fontFamily: 'monospace', marginBottom: 2 }}>EXTRACTED NAME</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1e2a3a', fontFamily: 'monospace' }}>{fullName}</div>
        </div>
      )}

      {/* Fields grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
        {entries.map(([key, value]) => (
          <div key={key}>
            <div style={{ fontSize: 10, color: '#96a3bb', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
              {key.replace(/_/g, ' ')}
            </div>
            <div style={{ fontSize: 12, color: '#1e2a3a', fontFamily: 'monospace', wordBreak: 'break-all', marginBottom: 3 }}>
              {String(value)}
            </div>
            {(confs[key] ?? 0) > 0 && (
              <div style={{ height: 3, background: '#e4e9f4', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  width: `${confs[key] * 100}%`, height: '100%', borderRadius: 2,
                  background: confs[key] >= 0.9 ? '#22c55e' : confs[key] >= 0.7 ? '#f59e0b' : '#ef4444',
                }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Case card shown after launch ──────────────────────────────────────────────
function CaseCard({ caseId, caseNumber, subjectName, status, onOpen }: {
  caseId: string; caseNumber: string; subjectName: string; status: string
  onOpen: () => void
}) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, #f0f7ff, #ffffff)',
      border: '1px solid #bdd0f8', borderRadius: 12, padding: '14px 16px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginTop: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%',
          background: '#dce8fc', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16,
        }}>B</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1e2a3a' }}>{subjectName || 'Unknown Subject'}</div>
          <div style={{ fontSize: 11, color: '#96a3bb', fontFamily: 'monospace' }}>{caseNumber} · {status}</div>
        </div>
      </div>
      <button
        onClick={onOpen}
        style={{
          padding: '7px 14px', background: '#3b6cf4', color: '#fff',
          border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
        }}
      >
        Open case →
      </button>
    </div>
  )
}

// ── Session helpers ───────────────────────────────────────────────────────────
const WELCOME_MSG: Msg = {
  id: 'welcome',
  role: 'bot',
  text: "Welcome to SmartKYC. Here's what I can do:\n\n• **Launch an investigation** — drop an ID document or type a subject's full name\n• **Answer case queries** — ask about risk levels, pending reviews, flags, counts\n\nExamples: \"How many cases are for review?\", \"List high risk cases\", \"Show pending cases\"",
}

function newSessionId() {
  const now = new Date()
  const date = now.toISOString().slice(0, 10)
  return `${date}-${Math.random().toString(36).slice(2, 8)}`
}

// ── Main Chat Intake page ─────────────────────────────────────────────────────
export default function ChatIntakePage() {
  const navigate = useNavigate()
  const [messages, setMessages] = useState<Msg[]>([WELCOME_MSG])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const dragCounter = useRef(0)
  const [dragging, setDragging] = useState(false)

  // ── History panel ──────────────────────────────────────────────────────────
  const [showHistory, setShowHistory] = useState(false)
  const [historySessions, setHistorySessions] = useState<any[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [viewingSession, setViewingSession] = useState<any | null>(null)

  // ── Session persistence ────────────────────────────────────────────────────
  const sessionIdRef  = useRef<string>(newSessionId())
  const startedAtRef  = useRef<string>(new Date().toISOString())
  const casesCreated  = useRef<string[]>([])
  const saveTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Always start fresh — do NOT auto-load last session into current chat
  // (history is browsable via the History panel instead)

  // Debounced save whenever messages change (only if more than welcome msg)
  useEffect(() => {
    if (messages.length <= 1) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      chatApi.saveSession({
        session_id:    sessionIdRef.current,
        started_at:    startedAtRef.current,
        messages,
        cases_created: casesCreated.current,
      }).catch(() => {})
    }, 800)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [messages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function addMsg(msg: Omit<Msg, 'id'>) {
    setMessages(p => [...p, { ...msg, id: uid() }])
  }

  // ── Load history sessions ──────────────────────────────────────────────────
  function openHistory() {
    setShowHistory(true)
    setViewingSession(null)
    setHistoryLoading(true)
    chatApi.listSessions().then((sessions: any[]) => {
      setHistorySessions(sessions || [])
    }).catch(() => setHistorySessions([])).finally(() => setHistoryLoading(false))
  }

  function loadHistorySession(s: any) {
    chatApi.getSession(s.session_id).then((data: any) => {
      setViewingSession({ ...s, messages: data?.messages || [] })
    }).catch(() => {})
  }

  // ── Case query answering ───────────────────────────────────────────────────
  async function answerCaseQuery(text: string): Promise<boolean> {
    const t = text.toLowerCase()

    const isCaseQuery =
      /\b(case|cases|investigation|review|queue|risk|pending|flag|high|critical|medium|low|approved|rejected|score|agent)\b/.test(t) &&
      /\b(how many|count|list|show|find|get|what|any|all|recent|top|which|total|open|are there)\b/.test(t)

    if (!isCaseQuery) return false

    const isReviewQuery = /\b(review|queue)\b/.test(t)

    // Fetch from purpose-built queue endpoint for review queries (accurate),
    // or from the full case list (with high limit) for everything else.
    let allCases: any[]
    if (isReviewQuery) {
      const [queue, all] = await Promise.all([
        reviewsApi.getQueue(),
        casesApi.list(undefined, 500),
      ])
      // Use queue as the review subset directly
      const riskColor = (r: string) => ({ critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }[r] || '⚪')
      if (/how many|count|total|number of/.test(t)) {
        const lines = queue.slice(0, 5).map((c: any) =>
          `• ${c.subject_name} (${c.case_number}) — ${c.risk_level} risk`
        )
        addMsg({
          role: 'bot',
          text: `There are **${queue.length} cases under review** out of ${all.length} total.\n\n` +
            (lines.length ? lines.join('\n') + (queue.length > 5 ? `\n…and ${queue.length - 5} more` : '') : ''),
        })
      } else {
        const show = queue.slice(0, 8)
        if (!show.length) {
          addMsg({ role: 'bot', text: 'No cases currently in the review queue.' })
          return true
        }
        const lines = show.map((c: any) =>
          `${riskColor(c.risk_level)} **${c.subject_name}** — ${c.case_number} · score ${Math.round(c.risk_score || 0)} · ${c.status}`
        )
        addMsg({
          role: 'bot',
          text: `**Cases under review** (${queue.length} total):\n\n${lines.join('\n')}` +
            (queue.length > 8 ? `\n\n…and ${queue.length - 8} more. Visit Review Queue for the full list.` : ''),
        })
      }
      return true
    }

    allCases = await casesApi.list(undefined, 500)

    // ── How many X cases ─────────────────────────────────────────────────────
    if (/how many|count|total|number of/.test(t)) {
      let subset = allCases
      let label = 'total'
      if (/pending/.test(t))              { subset = allCases.filter(c => c.status === 'pending'); label = 'pending investigation' }
      else if (/high|critical/.test(t))   { subset = allCases.filter(c => c.risk_level === 'high' || c.risk_level === 'critical'); label = 'high / critical risk' }
      else if (/medium/.test(t))          { subset = allCases.filter(c => c.risk_level === 'medium'); label = 'medium risk' }
      else if (/low/.test(t))             { subset = allCases.filter(c => c.risk_level === 'low'); label = 'low risk' }
      else if (/approv|clear/.test(t))    { subset = allCases.filter(c => c.status === 'cleared' || c.status === 'approved'); label = 'approved / cleared' }
      else if (/reject/.test(t))          { subset = allCases.filter(c => c.status === 'rejected'); label = 'rejected' }
      else if (/invest/.test(t))          { subset = allCases.filter(c => c.status === 'investigating'); label = 'under investigation' }

      const lines = subset.slice(0, 5).map(c =>
        `• ${c.subject_name} (${c.case_number}) — ${c.risk_level} risk, ${c.status}`
      )
      addMsg({
        role: 'bot',
        text: `There are **${subset.length} ${label} cases** out of ${allCases.length} total.\n\n` +
          (lines.length ? lines.join('\n') + (subset.length > 5 ? `\n…and ${subset.length - 5} more` : '') : ''),
      })
      return true
    }

    // ── List / show cases ────────────────────────────────────────────────────
    if (/list|show|find|get|any|all|recent|top|which|open/.test(t)) {
      let subset = allCases
      let label = 'recent'

      const riskColor = (r: string) => ({ critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }[r] || '⚪')

      if (/high|critical/.test(t))        { subset = allCases.filter(c => c.risk_level === 'high' || c.risk_level === 'critical'); label = 'high / critical risk' }
      else if (/medium/.test(t))          { subset = allCases.filter(c => c.risk_level === 'medium'); label = 'medium risk' }
      else if (/low/.test(t))             { subset = allCases.filter(c => c.risk_level === 'low'); label = 'low risk' }
      else if (/pending/.test(t))         { subset = allCases.filter(c => c.status === 'pending'); label = 'pending investigation' }
      else if (/approv|clear/.test(t))    { subset = allCases.filter(c => c.status === 'cleared' || c.status === 'approved'); label = 'approved / cleared' }
      else if (/reject/.test(t))          { subset = allCases.filter(c => c.status === 'rejected'); label = 'rejected' }
      else if (/flag/.test(t))            { subset = allCases.filter(c => (c.risk_score || 0) > 50); label = 'flagged (risk > 50)' }
      else if (/invest/.test(t))          { subset = allCases.filter(c => c.status === 'investigating'); label = 'under investigation' }

      const show = subset.slice(0, 8)
      if (!show.length) {
        addMsg({ role: 'bot', text: `No ${label} cases found.` })
        return true
      }

      const lines = show.map(c =>
        `${riskColor(c.risk_level)} **${c.subject_name}** — ${c.case_number} · score ${Math.round(c.risk_score || 0)} · ${c.status}`
      )
      addMsg({
        role: 'bot',
        text: `**${label.charAt(0).toUpperCase() + label.slice(1)} cases** (${subset.length} total):\n\n${lines.join('\n')}` +
          (subset.length > 8 ? `\n\n…and ${subset.length - 8} more. Visit All Cases for the full list.` : ''),
      })
      return true
    }

    return false
  }

  // ── Handle file drop / pick ────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    if (!file) return
    setBusy(true)

    // Show user file bubble
    addMsg({ role: 'user', file: { name: file.name, size: file.size } })
    addMsg({ role: 'bot', text: `Got it — detecting document type for **${file.name}**, extracting fields…` })

    try {
      // Step 1: create a placeholder case
      const newCase = await casesApi.create({
        subject_name: 'Processing…',
        subject_type: 'Individual',
      })

      // Step 2: upload + extract
      const uploadResult = await documentsApi.upload(newCase.id, file)

      // The full extraction lives on uploadResult.extraction
      const extraction = uploadResult.extraction || uploadResult.extracted_data || {}
      const fields = extraction.fields || {}
      const fullName = extraction.full_name || fields.full_name || fields.name || ''
      const docType = extraction.document_type || uploadResult.document_type || ''
      const nationality = fields.nationality || ''
      const dob = fields.date_of_birth || ''
      const docLabel = DOC_TYPE_LABELS[uploadResult.document_type] || docType || 'document'

      // Step 3: patch case with extracted name + details
      if (fullName || nationality || dob) {
        await casesApi.update(newCase.id, {
          subject_name: fullName || 'Unknown Subject',
          nationality: nationality || undefined,
          date_of_birth: dob || undefined,
        })
      }

      // Show extraction in chat
      addMsg({
        role: 'bot',
        text: `Extracted **${docLabel}** fields:`,
        extraction,
      })

      // Step 4: launch investigation
      addMsg({ role: 'bot', text: 'Launching investigation…' })
      await casesApi.startInvestigation(newCase.id)

      casesCreated.current = [...new Set([...casesCreated.current, newCase.id])]

      addMsg({
        role: 'bot',
        text: `Investigation launched for **${fullName || 'this subject'}** (${newCase.case_number}). Agents are running — click "Open case →" to follow along.`,
        caseCard: {
          caseId: newCase.id,
          caseNumber: newCase.case_number,
          subjectName: fullName || 'Unknown Subject',
          status: 'pending',
        },
      })
    } catch (e: any) {
      addMsg({ role: 'bot', text: `⚠ Something went wrong: ${e?.response?.data?.detail || e?.message || 'unknown error'}` })
    } finally {
      setBusy(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handle text input ──────────────────────────────────────────────────────
  async function handleSend() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    setBusy(true)
    addMsg({ role: 'user', text })

    try {
      // ── Detect whether the input looks like a personal/company name ─────────
      // Rules (all must pass):
      //  1. 2–6 words
      //  2. ≤ 60 chars
      //  3. Does NOT start with a question word or common sentence starter
      //  4. Does NOT contain punctuation typical of questions/sentences
      //  5. Each word is capitalised or all-caps (names usually are)
      const QUESTION_STARTERS = /^(how|what|who|where|when|why|is|are|can|do|does|did|has|have|show|list|find|get|tell|give|check|any|which|could|would|should|please|i |we |the |a |an )/i
      const words = text.trim().split(/\s+/)
      const looksLikeName = (
        words.length >= 2 &&
        words.length <= 6 &&
        text.length <= 60 &&
        !QUESTION_STARTERS.test(text) &&
        !/[?.,!;:]/.test(text) &&
        words.every(w => /^[A-Za-z][a-z]*$/.test(w) || /^[A-Z]+$/.test(w) || /^[A-Z][a-z]+/.test(w))
      )

      if (looksLikeName) {
        addMsg({ role: 'bot', text: `Creating investigation for **${text}**…` })
        const newCase = await casesApi.create({ subject_name: text, subject_type: 'Individual' })
        await casesApi.startInvestigation(newCase.id)
        casesCreated.current = [...new Set([...casesCreated.current, newCase.id])]
        addMsg({
          role: 'bot',
          text: `Investigation launched for **${text}** (${newCase.case_number}). Agents are running.`,
          caseCard: {
            caseId: newCase.id,
            caseNumber: newCase.case_number,
            subjectName: text,
            status: 'pending',
          },
        })
      } else {
        // Try to answer a case query first
        const answered = await answerCaseQuery(text)
        if (!answered) {
          addMsg({ role: 'bot', text: `To launch an investigation, drop an ID document here or type a subject's full name (e.g. "John Smith").\n\nFor case queries, try:\n• "How many cases are for review?"\n• "List high risk cases"\n• "Show pending cases"` })
        }
      }
    } catch (e: any) {
      addMsg({ role: 'bot', text: `⚠ Error: ${e?.response?.data?.detail || e?.message || 'unknown error'}` })
    } finally {
      setBusy(false)
    }
  }

  // ── Drag & drop ────────────────────────────────────────────────────────────
  function onDragEnter(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current++
    setDragging(true)
  }
  function onDragLeave(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current === 0) setDragging(false)
  }
  function onDragOver(e: React.DragEvent) { e.preventDefault() }
  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current = 0
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: dragging ? '#eef5ff' : '#f6f8fd', transition: 'background 0.2s' }}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Header */}
      <div style={{
        borderBottom: '1px solid #e4e9f4', padding: '14px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: '#fff',
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1e2a3a' }}>KYC Chat Intake</div>
          <div style={{ fontSize: 11, color: '#96a3bb', fontFamily: 'monospace' }}>GEMINI-2.5-FLASH · AI CASE ASSISTANT</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, background: '#dcfce7', color: '#15803d', padding: '3px 9px', borderRadius: 6, fontWeight: 600 }}>● Connected</span>
          <button
            onClick={openHistory}
            style={{ fontSize: 12, padding: '6px 12px', background: '#eef1f8', border: 'none', borderRadius: 7, cursor: 'pointer', color: '#5a6a84', fontWeight: 500 }}
            title="Browse chat history"
          >
            🕐 History
          </button>
          <button
            onClick={() => {
              sessionIdRef.current = newSessionId()
              startedAtRef.current = new Date().toISOString()
              casesCreated.current = []
              setMessages([WELCOME_MSG])
            }}
            style={{ fontSize: 12, padding: '6px 12px', background: '#eef1f8', border: 'none', borderRadius: 7, cursor: 'pointer', color: '#5a6a84', fontWeight: 500 }}
            title="Start a new chat session"
          >
            + New Chat
          </button>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {messages.map(msg => (
          <div key={msg.id} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: 10 }}>
            {msg.role === 'bot' && (
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#3b6cf4', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>K</div>
            )}
            <div style={{ maxWidth: '72%' }}>
              {/* File bubble */}
              {msg.file && (
                <div style={{
                  background: '#fff', border: '1px solid #e4e9f4',
                  borderRadius: 10, padding: '10px 14px',
                  display: 'flex', alignItems: 'center', gap: 10,
                  marginBottom: msg.text || msg.extraction ? 8 : 0,
                }}>
                  <span style={{ fontSize: 20 }}>📄</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#1e2a3a' }}>{msg.file.name}</div>
                    <div style={{ fontSize: 11, color: '#96a3bb' }}>{formatBytes(msg.file.size)}</div>
                  </div>
                </div>
              )}

              {/* Text bubble */}
              {msg.text && (
                <div style={{
                  padding: '10px 14px',
                  background: msg.role === 'user' ? '#3b6cf4' : '#fff',
                  color: msg.role === 'user' ? '#fff' : '#1e2a3a',
                  border: msg.role === 'bot' ? '1px solid #e4e9f4' : 'none',
                  borderRadius: 12,
                  fontSize: 13,
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                }}>
                  {msg.text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
                    part.startsWith('**') && part.endsWith('**')
                      ? <strong key={i}>{part.slice(2, -2)}</strong>
                      : part
                  )}
                </div>
              )}

              {/* Extraction card */}
              {msg.extraction && <ExtractionCard extraction={msg.extraction} />}

              {/* Case card */}
              {msg.caseCard && (
                <CaseCard
                  {...msg.caseCard}
                  onOpen={() => navigate(`/cases/${msg.caseCard!.caseId}`)}
                />
              )}
            </div>
            {msg.role === 'user' && (
              <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#1e2a3a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>K</div>
            )}
          </div>
        ))}
        {busy && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#3b6cf4', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 13, fontWeight: 700 }}>K</div>
            <div style={{ padding: '10px 14px', background: '#fff', border: '1px solid #e4e9f4', borderRadius: 12, fontSize: 13, color: '#96a3bb', display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#3b6cf4', animation: 'pulse 1s infinite' }} />
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#3b6cf4', animation: 'pulse 1s 0.2s infinite' }} />
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#3b6cf4', animation: 'pulse 1s 0.4s infinite' }} />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Drag overlay */}
      {dragging && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(59,108,244,0.08)',
          border: '3px dashed #3b6cf4', zIndex: 50,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#3b6cf4' }}>Drop document here</div>
        </div>
      )}

      {/* Input bar */}
      <div style={{ borderTop: '1px solid #e4e9f4', padding: '14px 24px', background: '#fff' }}>
        <div style={{ fontSize: 11, color: '#96a3bb', marginBottom: 8 }}>
          Attach ID document — passport · Aadhaar · PAN · driving licence · company registration
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            style={{ padding: '9px 12px', background: '#eef1f8', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 16, color: '#5a6a84', flexShrink: 0 }}
            title="Attach document"
          >
            📎
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) { handleFile(f); e.target.value = '' } }}
          />
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder="Drop a document above, type a name, or ask about existing cases…"
            disabled={busy}
            rows={1}
            style={{
              flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid #d1d9ee',
              fontSize: 13, resize: 'none', outline: 'none', fontFamily: 'inherit',
              lineHeight: 1.5, color: '#1e2a3a', background: busy ? '#f6f8fd' : '#fff',
            }}
          />
          <button
            onClick={handleSend}
            disabled={busy || !input.trim()}
            style={{
              padding: '9px 16px', background: '#3b6cf4', color: '#fff',
              border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
              opacity: (busy || !input.trim()) ? 0.5 : 1, flexShrink: 0,
            }}
          >
            ↑
          </button>
        </div>
        <div style={{ fontSize: 10, color: '#c4ccd9', marginTop: 6 }}>
          Enter to send · Shift+Enter for new line · Drag & Drop documents anywhere
        </div>
      </div>

      {/* ── History panel ───────────────────────────────────────────────────── */}
      {showHistory && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
        }} onClick={() => { setShowHistory(false); setViewingSession(null) }}>
          <div style={{
            width: 400, height: '100%', background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }} onClick={e => e.stopPropagation()}>
            {/* Panel header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #e4e9f4', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                {viewingSession
                  ? <button onClick={() => setViewingSession(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3b6cf4', fontSize: 13, fontWeight: 600, padding: 0 }}>← Back</button>
                  : <span style={{ fontSize: 14, fontWeight: 700, color: '#1e2a3a' }}>🕐 Chat History</span>
                }
              </div>
              <button onClick={() => { setShowHistory(false); setViewingSession(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#96a3bb', lineHeight: 1 }}>×</button>
            </div>

            {/* Session list or session detail */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
              {viewingSession ? (
                /* ── View a past session ── */
                <div>
                  <div style={{ fontSize: 12, color: '#96a3bb', marginBottom: 12 }}>
                    {new Date(viewingSession.started_at).toLocaleString()} · {viewingSession.messages?.length || 0} messages
                  </div>
                  {(viewingSession.messages || []).map((m: any, i: number) => (
                    <div key={i} style={{ marginBottom: 10, display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                      <div style={{
                        maxWidth: '85%', padding: '8px 12px', borderRadius: 10, fontSize: 12, lineHeight: 1.5,
                        background: m.role === 'user' ? '#3b6cf4' : '#f0f2f8',
                        color: m.role === 'user' ? '#fff' : '#1e2a3a',
                        whiteSpace: 'pre-wrap',
                      }}>
                        {(m.text || '').replace(/\*\*(.+?)\*\*/g, '$1')}
                        {m.file && <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>📄 {m.file.name}</div>}
                        {m.caseCard && <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>📋 {m.caseCard.subjectName} ({m.caseCard.caseNumber})</div>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : historyLoading ? (
                <div style={{ textAlign: 'center', color: '#96a3bb', fontSize: 13, padding: 24 }}>Loading…</div>
              ) : historySessions.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#96a3bb', fontSize: 13, padding: 24 }}>No past sessions yet.</div>
              ) : (
                /* ── Session list ── */
                historySessions.map((s: any) => {
                  const preview = s.last_message?.slice(0, 70) || 'Chat session'
                  const date = new Date(s.started_at)
                  const msgCount = s.message_count || 0
                  return (
                    <div
                      key={s.session_id}
                      onClick={() => loadHistorySession(s)}
                      style={{
                        padding: '12px 14px', borderRadius: 10, cursor: 'pointer', marginBottom: 8,
                        border: '1px solid #e4e9f4', background: '#fafbfd',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#eef1f8')}
                      onMouseLeave={e => (e.currentTarget.style.background = '#fafbfd')}
                    >
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#1e2a3a', marginBottom: 3 }}>
                        {date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · {date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div style={{ fontSize: 12, color: '#5a6a84', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {preview}
                      </div>
                      <div style={{ fontSize: 11, color: '#96a3bb' }}>
                        {msgCount} messages {s.cases_created?.length ? `· ${s.cases_created.length} case${s.cases_created.length > 1 ? 's' : ''} created` : ''}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
