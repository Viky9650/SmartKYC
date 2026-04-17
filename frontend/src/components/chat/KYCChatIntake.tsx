/**
 * KYCChatIntake — v2
 * ──────────────────
 * - Matches SmartKYC app theme exactly (hardcoded palette, JetBrains Mono, card styles)
 * - Reads Gemini key from VITE_GEMINI_API_KEY env (no modal unless missing)
 * - Queries backend DB for case history so officer can ask questions about past cases
 * - Inline extraction display after document upload
 *
 * Place at: src/components/chat/KYCChatIntake.tsx
 */

import {
  useState, useRef, useEffect, useCallback,
  KeyboardEvent, DragEvent, ChangeEvent,
} from 'react'
import { useNavigate } from 'react-router-dom'

// ─── Config ──────────────────────────────────────────────────────────────────
// Key + model are fetched from GET /api/config at runtime (sourced from backend .env)
// No VITE_ prefix needed — single source of truth
let GEMINI_MODEL = 'gemini-2.0-flash'
const API_BASE   = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8000/api'

// ─── Theme — matches the app exactly ─────────────────────────────────────────
const T = {
  bg:          '#f4f6fb',
  surface:     '#ffffff',
  border:      '#e4e9f4',
  text:        '#1e2a3a',
  textMid:     '#5a6a84',
  textMuted:   '#96a3bb',
  blue:        '#4a7fe8',
  blueLight:   '#dce8fc',
  blueMid:     '#bdd0f8',
  green:       '#15803d',
  greenLight:  '#dcfce7',
  greenBorder: '#bbf7d0',
  red:         '#b91c1c',
  redLight:    '#fee2e2',
  redBorder:   '#fecaca',
  mono:        'JetBrains Mono, monospace',
  radius:      8,
  radiusLg:    10,
}

// ─── System prompt ────────────────────────────────────────────────────────────
function buildSystemPrompt(caseContext: string) {
  return `You are a KYC/AML compliance intake assistant. Your job is to make case creation as effortless as possible.

CORE PHILOSOPHY: Zero friction. The officer should never have to fill a form. Extract everything from documents and conversation automatically.

=== WORKFLOW ===
1. If a document is uploaded: extract all fields, confirm what you found in ONE sentence, then immediately emit CASE_READY. Do not ask questions if you have a name.
2. If officer types a name/description: ask ONLY for nationality if missing, then emit CASE_READY.
3. Never ask for info that can be inferred. Never ask multiple questions.
4. If officer just says "check this person" with a name, emit CASE_READY immediately with what you have.

=== EXISTING CASES (for queries) ===
${caseContext || 'No cases loaded yet.'}
=== END ===

QUERY MODE: If asked about existing cases, risk scores, flags, status — answer directly from the case data above.

CASE_READY FORMAT — emit this the moment you have a name:
<CASE_READY>
{"subject_name":"...","subject_type":"...","nationality":"...","date_of_birth":"...","notes":"..."}
</CASE_READY>

Subject types: Individual | Company Director | PEP (Politically Exposed Person) | Corporate Entity | Trust / Foundation | Nominee
Default to "Individual" if unclear.

Rules:
- Emit CASE_READY as soon as you have a name. Don't wait for everything.
- After officer says "yes/launch/proceed/looks good" — do NOT re-emit CASE_READY. Just say "Launching now."
- Max 2 sentences per response. No bullet lists. No forms. No friction.
- When document is uploaded with fields: say "Got it — [Name], [DocType], launching investigation." then CASE_READY.`
}


// ─── Types ────────────────────────────────────────────────────────────────────
interface GeminiPart { text: string }
interface GeminiTurn { role: 'user' | 'model'; parts: GeminiPart[] }

interface CaseData {
  subject_name:  string
  subject_type:  string
  nationality:   string
  date_of_birth: string
  notes:         string
}

interface LaunchedCase {
  id:          string
  case_number: string
  risk_score:  number
  risk_level:  string
  status:      string
}

interface ExtractionResult {
  document_type:  string
  extracted_data: { fields: Record<string, string>; overall_confidence?: number }
}

interface ChatMessage {
  id:          string
  role:        'user' | 'assistant'
  content:     string | null
  time:        string
  file?:       { name: string; type: string }
  extraction?: ExtractionResult
  caseData?:   CaseData
  launched?:   LaunchedCase
}

interface Props {
  onCaseCreated?: (caseId: string) => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function parseCaseReady(text: string): CaseData | null {
  // Strategy 1: full tag with closing tag
  const m1 = text.match(/<CASE_READY>\s*([\s\S]*?)\s*<\/CASE_READY>/)
  if (m1) {
    try { return JSON.parse(m1[1].trim()) as CaseData } catch {}
  }
  // Strategy 2: opening tag only (Gemini sometimes omits the closing tag)
  const m2 = text.match(/<CASE_READY>\s*(\{[\s\S]*)/)
  if (m2) {
    const jsonStr = m2[1].trim()
    // Try full string first
    try { return JSON.parse(jsonStr) as CaseData } catch {}
    // Try to extract a complete JSON object even if trailing text follows
    let depth = 0, end = 0
    for (let i = 0; i < jsonStr.length; i++) {
      if (jsonStr[i] === '{') depth++
      else if (jsonStr[i] === '}') { depth--; if (depth === 0) { end = i + 1; break } }
    }
    if (end) {
      try { return JSON.parse(jsonStr.slice(0, end)) as CaseData } catch {}
    }
  }
  return null
}
function cleanText(t: string) {
  // Remove full CASE_READY block (with closing tag)
  let cleaned = t.replace(/<CASE_READY>[\s\S]*?<\/CASE_READY>/g, '')
  // Remove partial CASE_READY block (no closing tag — Gemini truncated it)
  cleaned = cleaned.replace(/<CASE_READY>[\s\S]*$/g, '')
  return cleaned.trim()
}
function ts() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 5) }
function riskColor(score: number) {
  if (score >= 80) return '#dc2626'
  if (score >= 60) return '#ea580c'
  if (score >= 40) return '#ca8a04'
  return '#16a34a'
}

// ─── Gemini API ───────────────────────────────────────────────────────────────
async function callGemini(
  history: GeminiTurn[],
  apiKey: string,
  systemPrompt: string,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: history,
      generationConfig: { temperature: 0.3, maxOutputTokens: 600 },
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(err?.error?.message ?? `Gemini error ${res.status}`)
  }
  const data = await res.json() as {
    candidates?: Array<{ content: { parts: Array<{ text: string }> } }>
  }
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

// ─── Backend ──────────────────────────────────────────────────────────────────
async function apiFetchCases() {
  const res = await fetch(`${API_BASE}/cases/dashboard/summary?limit=50`)
  if (!res.ok) return []
  return res.json() as Promise<any[]>
}

async function apiCreateCase(data: Partial<CaseData>) {
  const res = await fetch(`${API_BASE}/cases/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create case')
  return res.json() as Promise<LaunchedCase & { case_number: string }>
}

async function apiUploadDoc(caseId: string, file: File): Promise<ExtractionResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE}/documents/upload/${caseId}`, {
    method: 'POST', body: form,
  })
  if (!res.ok) throw new Error('Upload failed')
  return res.json() as Promise<ExtractionResult>
}

async function apiStartInvestigation(caseId: string) {
  await fetch(`${API_BASE}/cases/${caseId}/start-investigation`, { method: 'POST' })
}

// ── Chat session persistence ─────────────────────────────────────────────────
function generateSessionId() {
  return new Date().toISOString().slice(0,10) + '-' + Math.random().toString(36).slice(2,8)
}

async function apiSaveSession(session: {
  session_id: string; started_at: string
  messages: any[]; cases_created: string[]
}) {
  await fetch(`${API_BASE}/chat/history`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  }).catch(() => {})
}

async function apiFetchSessions(): Promise<any[]> {
  const r = await fetch(`${API_BASE}/chat/history`)
  if (!r.ok) return []
  return r.json()
}

async function apiFetchSession(sessionId: string): Promise<any | null> {
  const r = await fetch(`${API_BASE}/chat/history/${sessionId}`)
  if (!r.ok) return null
  return r.json()
}

async function apiDeleteSession(sessionId: string) {
  await fetch(`${API_BASE}/chat/history/${sessionId}`, { method: 'DELETE' }).catch(() => {})
}

// Pre-extract a document without creating a case first.
// Uses a temp endpoint that runs the extraction pipeline and returns fields.
async function apiPreExtract(file: File): Promise<ExtractionResult> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE}/documents/extract-preview`, {
    method: 'POST', body: form,
  })
  if (!res.ok) throw new Error('Pre-extract failed')
  return res.json() as Promise<ExtractionResult>
}

function buildCaseContext(cases: any[]): string {
  if (!cases.length) return 'No cases found in database.'
  return cases.map(c => {
    const flags   = (c.top_flags || []).join(', ') || 'none'
    const ext     = c.document_extraction
    const docInfo = ext
      ? `Doc: ${ext.document_type} (${ext.country}), name: ${ext.full_name || 'n/a'}, DOB: ${ext.date_of_birth || 'n/a'}, conf: ${Math.round((ext.overall_confidence || 0) * 100)}%`
      : 'No document'
    return `[${c.case_number}] ${c.subject_name} | ${c.subject_type || 'Individual'} | ${c.nationality || 'Unknown nationality'} | Risk: ${Math.round(c.risk_score || 0)} (${c.risk_level || 'unknown'}) | Status: ${c.status} | Flags: ${flags} | ${docInfo} | Agents: ${c.agent_count || 0}`
  }).join('\n')
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, padding: '10px 14px', alignItems: 'center' }}>
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 6, height: 6, borderRadius: '50%', background: T.textMuted,
          animation: `kycBounce 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  )
}

function ExtractionCard({ extraction }: { extraction: ExtractionResult }) {
  const fields  = extraction.extracted_data?.fields ?? {}
  const conf    = extraction.extracted_data?.overall_confidence ?? 0
  const entries = Object.entries(fields).filter(([k]) => !k.startsWith('_')).slice(0, 8)
  if (!entries.length) return null
  return (
    <div style={{
      marginTop: 8, border: `1px solid ${T.greenBorder}`,
      borderRadius: T.radiusLg, overflow: 'hidden',
    }}>
      <div style={{
        padding: '8px 14px', background: T.greenLight,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: T.green }}>
          ✓ {extraction.document_type || 'Document'} extracted
        </span>
        {conf > 0 && (
          <span style={{ fontSize: 11, fontFamily: T.mono, color: T.green }}>
            {Math.round(conf * 100)}% confidence
          </span>
        )}
      </div>
      <div style={{
        padding: '10px 14px', background: T.surface,
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px',
      }}>
        {entries.map(([key, value]) => (
          <div key={key}>
            <div style={{
              fontSize: 9, color: T.textMuted, fontFamily: T.mono,
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2,
            }}>
              {key.replace(/_/g, ' ')}
            </div>
            <div style={{ fontSize: 12, color: T.text, fontFamily: T.mono, wordBreak: 'break-all' }}>
              {String(value)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CaseReadyCard({ caseData, onLaunch, onEdit, launching }: {
  caseData:  CaseData
  onLaunch:  () => void
  onEdit:    () => void
  launching: boolean
}) {
  return (
    <div style={{
      marginTop: 8, border: `1px solid ${T.blueMid}`,
      borderRadius: T.radiusLg, overflow: 'hidden',
    }}>
      <div style={{
        padding: '8px 14px', background: T.blueLight,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: T.blue }}>
          Ready to launch investigation
        </span>
      </div>
      <div style={{ padding: '12px 14px', background: T.surface }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px', marginBottom: 12 }}>
          {([
            ['Name',          caseData.subject_name],
            ['Type',          caseData.subject_type],
            ['Nationality',   caseData.nationality  || '—'],
            ['Date of Birth', caseData.date_of_birth || '—'],
          ] as [string, string][]).map(([label, value]) => (
            <div key={label}>
              <div style={{
                fontSize: 9, color: T.textMuted, fontFamily: T.mono,
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2,
              }}>{label}</div>
              <div style={{ fontSize: 13, color: T.text, fontFamily: T.mono }}>{value}</div>
            </div>
          ))}
        </div>
        {caseData.notes && (
          <div style={{
            fontSize: 12, color: T.textMid, fontStyle: 'italic',
            padding: '7px 10px', background: T.bg,
            borderRadius: T.radius, border: `1px solid ${T.border}`, marginBottom: 12,
          }}>
            {caseData.notes}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onLaunch} disabled={launching}
            style={{
              flex: 1, padding: '9px 0',
              background: launching ? T.bg : T.blue,
              color: launching ? T.textMuted : '#fff',
              border: `1px solid ${launching ? T.border : T.blue}`,
              borderRadius: T.radius, fontSize: 13, fontWeight: 600,
              cursor: launching ? 'not-allowed' : 'pointer', transition: 'all 0.15s',
            }}
          >
            {launching ? 'Launching…' : '🔍 Launch Investigation'}
          </button>
          <button
            onClick={onEdit} disabled={launching}
            style={{
              padding: '9px 16px', background: T.surface, color: T.textMid,
              border: `1px solid ${T.border}`, borderRadius: T.radius,
              fontSize: 13, cursor: 'pointer',
            }}
          >Edit</button>
        </div>
      </div>
    </div>
  )
}

function LaunchedCard({ data, onOpen }: { data: LaunchedCase; onOpen: () => void }) {
  const color = riskColor(data.risk_score ?? 0)
  return (
    <div style={{
      marginTop: 8, border: `1px solid ${T.border}`,
      borderRadius: T.radiusLg, overflow: 'hidden',
    }}>
      <div style={{
        padding: '8px 14px', borderBottom: `1px solid ${T.border}`,
        background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>Investigation launched</span>
        <span style={{ fontSize: 11, fontFamily: T.mono, color: T.textMuted }}>{data.case_number}</span>
      </div>
      <div style={{ padding: '12px 14px', background: T.surface, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{
          width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
          border: `2px solid ${color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: 15, fontWeight: 700, fontFamily: T.mono, color }}>
            {Math.round(data.risk_score ?? 0)}
          </span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: T.text,
            marginBottom: 2, textTransform: 'capitalize',
          }}>
            {data.risk_level || 'Processing'} risk
          </div>
          <div style={{ fontSize: 12, color: T.textMid, textTransform: 'capitalize' }}>
            {data.status || 'investigating'}
          </div>
        </div>
        <button
          onClick={onOpen}
          style={{
            padding: '7px 16px', background: T.blue, color: '#fff',
            border: 'none', borderRadius: T.radius, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >Open case →</button>
      </div>
    </div>
  )
}

function MsgBubble({ msg, onLaunch, onEdit, launchingId, onOpen }: {
  msg:         ChatMessage
  onLaunch:    (id: string) => void
  onEdit:      (id: string) => void
  launchingId: string | null
  onOpen:      (caseId: string) => void
}) {
  const isUser = msg.role === 'user'
  return (
    <div style={{
      display: 'flex', gap: 10,
      flexDirection: isUser ? 'row-reverse' : 'row',
      alignItems: 'flex-start',
      animation: 'kycFadeIn 0.18s ease-out',
    }}>
      {/* Avatar */}
      <div style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        background: isUser
          ? 'linear-gradient(135deg,#dce8fc,#ede9fe)'
          : 'linear-gradient(135deg,#4a7fe8,#7c3aed)',
        border: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 700, fontFamily: T.mono,
        color: isUser ? T.blue : '#fff',
        boxShadow: isUser ? 'none' : '0 2px 6px rgba(74,127,232,0.3)',
      }}>
        {isUser ? 'CO' : 'K'}
      </div>

      <div style={{ flex: 1, maxWidth: '82%', minWidth: 0 }}>
        {/* File pill */}
        {msg.file && (
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '3px 10px', marginBottom: 6,
            background: T.bg, border: `1px solid ${T.border}`,
            borderRadius: T.radius, fontSize: 11, color: T.textMid, fontFamily: T.mono,
            maxWidth: '100%', overflow: 'hidden',
          }}>
            <span>{msg.file.type === 'application/pdf' ? '📋' : '🖼️'}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {msg.file.name}
            </span>
          </div>
        )}

        {/* Text bubble */}
        {msg.content && (
          <div style={{
            padding: '10px 14px',
            background: isUser ? T.blueLight : T.surface,
            border: `1px solid ${isUser ? T.blueMid : T.border}`,
            borderRadius: isUser ? '10px 3px 10px 10px' : '3px 10px 10px 10px',
            fontSize: 13, color: T.text, lineHeight: 1.65,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            boxShadow: '0 1px 3px rgba(30,42,58,0.05)',
          }}>
            {msg.content}
          </div>
        )}

        {msg.extraction && <ExtractionCard extraction={msg.extraction} />}
        {msg.caseData && !msg.launched && (
          <CaseReadyCard
            caseData={msg.caseData}
            onLaunch={() => onLaunch(msg.id)}
            onEdit={()   => onEdit(msg.id)}
            launching={launchingId === msg.id}
          />
        )}
        {msg.launched && (
          <LaunchedCard data={msg.launched} onOpen={() => onOpen(msg.launched!.id)} />
        )}

        <div style={{
          fontSize: 10, color: T.textMuted, fontFamily: T.mono,
          marginTop: 4, textAlign: isUser ? 'right' : 'left',
        }}>
          {msg.time}
        </div>
      </div>
    </div>
  )
}

function ApiKeyModal({ onSubmit }: { onSubmit: (k: string) => void }) {
  const [key, setKey] = useState('')
  return (
    <div style={{
      position: 'absolute', inset: 0, background: 'rgba(30,42,58,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: T.radiusLg, padding: '28px 24px', width: 380, maxWidth: '90vw',
        boxShadow: '0 8px 32px rgba(30,42,58,0.15)',
      }}>
        <div style={{
          fontSize: 10, color: T.textMuted, fontFamily: T.mono,
          letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8,
        }}>Configuration</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 6 }}>
          Gemini API Key
        </div>
        <p style={{ fontSize: 13, color: T.textMid, margin: '0 0 16px', lineHeight: 1.6 }}>
          Add <code style={{ fontFamily: T.mono, background: T.bg, padding: '1px 5px', borderRadius: 4 }}>VITE_GEMINI_API_KEY</code> to your{' '}
          <code style={{ fontFamily: T.mono, background: T.bg, padding: '1px 5px', borderRadius: 4 }}>.env</code>{' '}
          to skip this prompt permanently.
        </p>
        <input
          type="password" placeholder="AIzaSy..."
          value={key} onChange={e => setKey(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && key.trim() && onSubmit(key.trim())}
          autoFocus
          style={{
            width: '100%', padding: '9px 12px', marginBottom: 12,
            border: `1px solid ${T.border}`, borderRadius: T.radius,
            fontSize: 13, fontFamily: T.mono, color: T.text,
            background: T.bg, outline: 'none', boxSizing: 'border-box',
          }}
        />
        <button
          onClick={() => key.trim() && onSubmit(key.trim())}
          style={{
            width: '100%', padding: '10px 0',
            background: T.blue, color: '#fff', border: 'none',
            borderRadius: T.radius, fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}
        >Connect</button>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function KYCChatIntake({ onCaseCreated }: Props) {
  const navigate = useNavigate()

  const [apiKey, setApiKey]               = useState('')
  const [showKeyModal, setShowKeyModal]   = useState(false)
  const [messages, setMessages]           = useState<ChatMessage[]>([{
    id: 'welcome', role: 'assistant', time: ts(),
    content: 'Welcome. Drop an ID document to auto-launch an investigation instantly, or just type a name and I\'ll handle the rest.\n\nYou can also ask about any existing case — risk scores, flags, agent findings.',
  }])
  const [input, setInput]                 = useState('')
  const [pendingFile, setPendingFile]     = useState<File | null>(null)
  const [typing, setTyping]               = useState(false)
  const [launchingId, setLaunchingId]     = useState<string | null>(null)
  const [currentCaseId, setCurrentCaseId] = useState<string | null>(null)
  const [errorMsg, setErrorMsg]           = useState<string | null>(null)
  const [dragging, setDragging]           = useState(false)
  const [caseContext, setCaseContext]      = useState('')
  const [geminiModel, setGeminiModel]       = useState('gemini-2.0-flash')
  const [sessionId, setSessionId]           = useState(() => generateSessionId())
  const [sessionStarted, setSessionStarted] = useState(() => new Date().toISOString())
  const [casesCreated, setCasesCreated]     = useState<string[]>([])
  const [sessions, setSessions]             = useState<any[]>([])
  const [showHistory, setShowHistory]       = useState(false)
  const [loadingSession, setLoadingSession] = useState(false)

  const bottomRef  = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLTextAreaElement>(null)
  const historyRef      = useRef<GeminiTurn[]>([])
  const pendingFilesRef = useRef<Map<string, File>>(new Map())

  // Auto-save chat session whenever messages change
  useEffect(() => {
    if (messages.length <= 1) return  // Don't save just the welcome message
    const timer = setTimeout(() => {
      // Strip File objects — not serialisable
      const serialisable = messages.map(m => ({
        ...m,
        file: m.file ? { name: m.file.name, type: m.file.type } : undefined,
        extraction: m.extraction,
        caseData: m.caseData,
        launched: m.launched,
      }))
      apiSaveSession({
        session_id:    sessionId,
        started_at:    sessionStarted,
        messages:      serialisable,
        cases_created: casesCreated,
      })
    }, 1500)  // 1.5s debounce
    return () => clearTimeout(timer)
  }, [messages, casesCreated])

  // On mount: fetch Gemini config from backend, then load case context
  useEffect(() => {
    // Fetch key + model from /api/config (reads from backend .env)
    fetch(`${API_BASE}/config`)
      .then(r => r.json())
      .then((d: { gemini_api_key?: string; gemini_model?: string }) => {
        if (d.gemini_api_key) {
          setApiKey(d.gemini_api_key)
          setShowKeyModal(false)
        }
        if (d.gemini_model) {
          GEMINI_MODEL = d.gemini_model
          setGeminiModel(d.gemini_model)
        }
      })
      .catch(() => {
        // If config fetch fails, show the manual key modal
        setShowKeyModal(true)
      })

    // Load case context from DB
    apiFetchCases()
      .then(cases => setCaseContext(buildCaseContext(cases)))
      .catch(() => {})

    // Load session list for history sidebar
    apiFetchSessions().then(setSessions).catch(() => {})
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, typing])

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function addMsg(partial: Omit<ChatMessage, 'id' | 'time'>): ChatMessage {
    const msg: ChatMessage = { id: uid(), time: ts(), ...partial }
    setMessages(prev => [...prev, msg])
    return msg
  }
  function patchMsg(id: string, patch: Partial<ChatMessage>) {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m))
  }
  function handleApiKey(key: string) {
    setApiKey(key)
    setShowKeyModal(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }
  async function refreshCaseContext() {
    try {
      const cases = await apiFetchCases()
      setCaseContext(buildCaseContext(cases))
    } catch {}
  }

  // ── Send ─────────────────────────────────────────────────────────────────────
  const send = useCallback(async (textOverride?: string, fileOverride?: File | null) => {
    const text = (textOverride ?? input).trim()
    const file = fileOverride !== undefined ? fileOverride : pendingFile
    if (!text && !file) return
    if (!apiKey) { setShowKeyModal(true); return }

    setInput('')
    setPendingFile(null)
    setErrorMsg(null)

    const userParts: GeminiPart[] = []
    let extraction: ExtractionResult | undefined

    if (file) {
      if (currentCaseId) {
        // Case exists — upload directly and get extraction
        try {
          extraction = await apiUploadDoc(currentCaseId, file)
          const fields = extraction.extracted_data?.fields ?? {}
          const conf   = Math.round((extraction.extracted_data?.overall_confidence ?? 0) * 100)
          userParts.push({
            text: `[Document uploaded to case. Type: ${extraction.document_type}. Confidence: ${conf}%. Extracted fields: ${JSON.stringify(fields)}. Use these exact values for subject_name, nationality, date_of_birth in CASE_READY.]`
          })
        } catch {
          userParts.push({ text: `[Document attached: ${file.name} — extraction pending]` })
        }
      } else {
        // No case yet — pre-extract via backend before Gemini call
        // so Gemini gets the real name/fields instead of inventing placeholders
        try {
          extraction = await apiPreExtract(file)
          const fields = extraction.extracted_data?.fields ?? {}
          const conf   = Math.round((extraction.extracted_data?.overall_confidence ?? 0) * 100)
          const fullName = (fields as any).full_name || (fields as any).name ||
            [fields.given_names, fields.surname].filter(Boolean).join(' ') ||
            (fields as any).surname || ''
          userParts.push({
            text: `[Document pre-extracted. Type: ${extraction.document_type}. Confidence: ${conf}%. Fields: ${JSON.stringify(fields)}. IMPORTANT: Use "${fullName || 'see fields'}" as subject_name in CASE_READY — do NOT use a placeholder like "JOHN DOE". Use the exact name from the document.]`
          })
        } catch {
          userParts.push({ text: `[Document attached: ${file.name}. Extract fields from the document image and use the real name in CASE_READY.]` })
        }
      }
    }
    if (text) userParts.push({ text })

    const userMsg = addMsg({ role: 'user', content: text || null, file: file ? { name: file.name, type: file.type } : undefined, extraction })
    // Store the actual File object so we can upload it after case creation
    if (file) pendingFilesRef.current.set(userMsg.id, file)
    historyRef.current.push({ role: 'user', parts: userParts })
    setTyping(true)

    try {
      const systemPrompt = buildSystemPrompt(caseContext)
      const response     = await callGemini(historyRef.current, apiKey, systemPrompt)
      historyRef.current.push({ role: 'model', parts: [{ text: response }] })

      const caseData    = parseCaseReady(response)
      const visibleText = cleanText(response)

      if (caseData) {
        // Auto-launch immediately — no confirm card, no extra click needed
        const launchMsgId = uid()
        const launchMsg: ChatMessage = {
          id: launchMsgId, time: ts(), role: 'assistant',
          content: visibleText || null,
          caseData,
        }
        setMessages(prev => [...prev, launchMsg])
        // Trigger launch automatically after a short delay so officer sees the message
        setTimeout(() => autoLaunch(launchMsgId, caseData), 800)
      } else {
        addMsg({ role: 'assistant', content: visibleText || null })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setErrorMsg(msg)
      addMsg({ role: 'assistant', content: `Error: ${msg}` })
    } finally {
      setTyping(false)
      inputRef.current?.focus()
    }
  }, [input, pendingFile, apiKey, currentCaseId, caseContext])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  // ── Launch ───────────────────────────────────────────────────────────────────
  async function handleLaunch(msgId: string) {
    const msg = messages.find(m => m.id === msgId)
    if (!msg?.caseData) return
    setLaunchingId(msgId)
    setErrorMsg(null)
    try {
      // 1. Create the case
      const newCase = await apiCreateCase({
        subject_name:  msg.caseData.subject_name,
        subject_type:  msg.caseData.subject_type || 'Individual',
        nationality:   msg.caseData.nationality  || undefined,
        date_of_birth: msg.caseData.date_of_birth || undefined,
        notes:         msg.caseData.notes         || undefined,
      })
      setCurrentCaseId(newCase.id)

      // 2. Upload ALL files attached during this conversation
      const fileMsgs = [...messages].filter(m => m.file)
      for (const fileMsg of fileMsgs) {
        const storedFile = pendingFilesRef.current.get(fileMsg.id)
        if (storedFile) {
          try {
            const result = await apiUploadDoc(newCase.id, storedFile)
            // Render extraction inline on the original file message bubble
            patchMsg(fileMsg.id, { extraction: result })
          } catch (e) {
            console.warn('Document upload failed:', e)
          }
        }
      }

      // 3. Start investigation (non-blocking)
      apiStartInvestigation(newCase.id).catch(() => {})

      // 4. Replace confirm card in-place with launched card — chat stays visible
      patchMsg(msgId, { caseData: undefined, launched: newCase })

      // 5. Notify parent — ChatCasePage must NOT auto-navigate (removed setTimeout there)
      onCaseCreated?.(newCase.id)
      await refreshCaseContext()

      // 6. Follow-up message stays in chat
      addMsg({
        role: 'assistant',
        content: `Investigation launched for ${msg.caseData.subject_name} (${newCase.case_number}). Agents are running in the background.\n\nClick "Open case \u2192" to view the full investigation, or continue chatting to start another intake.`,
      })

    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      setErrorMsg(errMsg)
      addMsg({ role: 'assistant', content: `Couldn't reach the backend: ${errMsg}. Check that the API server is running on port 8000.` })
    } finally {
      setLaunchingId(null)
    }
  }
  // autoLaunch: called automatically when Gemini emits CASE_READY
  // No confirm card — fires immediately
  async function autoLaunch(msgId: string, caseData: CaseData) {
    setLaunchingId(msgId)
    setErrorMsg(null)
    try {
      const newCase = await apiCreateCase({
        subject_name:  caseData.subject_name,
        subject_type:  caseData.subject_type  || 'Individual',
        nationality:   caseData.nationality   || undefined,
        date_of_birth: caseData.date_of_birth || undefined,
        notes:         caseData.notes         || undefined,
      })
      setCurrentCaseId(newCase.id)

      // Upload ALL files attached in this conversation
      const currentMsgs = await new Promise<ChatMessage[]>(resolve => {
        setMessages(prev => { resolve(prev); return prev })
      })
      for (const fileMsg of currentMsgs.filter(m => m.file)) {
        const storedFile = pendingFilesRef.current.get(fileMsg.id)
        if (storedFile) {
          try {
            const result = await apiUploadDoc(newCase.id, storedFile)
            patchMsg(fileMsg.id, { extraction: result })
          } catch (e) { console.warn('Doc upload failed:', e) }
        }
      }

      apiStartInvestigation(newCase.id).catch(() => {})

      // Replace the CASE_READY message with the launched card in-place
      patchMsg(msgId, { caseData: undefined, launched: newCase })
      onCaseCreated?.(newCase.id)
      await refreshCaseContext()

      addMsg({
        role: 'assistant',
        content: `Investigation launched for ${caseData.subject_name} (${newCase.case_number}). Agents are running — click "Open case →" to follow along.`,
      })
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      setErrorMsg(errMsg)
      addMsg({ role: 'assistant', content: `Backend error: ${errMsg}` })
    } finally {
      setLaunchingId(null)
    }
  }

  function handleEdit(msgId: string) {
    historyRef.current.push({ role: 'user', parts: [{ text: 'I want to edit the case details.' }] })
    addMsg({ role: 'assistant', content: 'Sure — what would you like to correct? Name, type, nationality, date of birth, or notes.' })
  }

  function handleOpen(caseId: string) { navigate(`/cases/${caseId}`) }

  async function loadSession(id: string) {
    setLoadingSession(true)
    try {
      const data = await apiFetchSession(id)
      if (!data) return
      // Restore messages — files won't be restorable but all text/cards will
      const restored = (data.messages || []).map((m: any) => ({
        ...m,
        // Mark restored file bubbles so we know not to re-upload
        file: m.file ? { ...m.file, restored: true } : undefined,
      }))
      setMessages(restored)
      setSessionId(data.session_id)
      setSessionStarted(data.started_at)
      setCasesCreated(data.cases_created || [])
      historyRef.current = []  // Reset Gemini history — it will rebuild from context
      setShowHistory(false)
      // Reload DB context so Gemini has fresh case data
      apiFetchCases().then(c => setCaseContext(buildCaseContext(c))).catch(() => {})
    } finally {
      setLoadingSession(false)
    }
  }

  function startNewSession() {
    setMessages([{
      id: 'welcome', role: 'assistant', time: ts(),
      content: 'New session started. Drop an ID document to auto-launch, or describe a subject to investigate.',
    }])
    setSessionId(generateSessionId())
    setSessionStarted(new Date().toISOString())
    setCasesCreated([])
    setCurrentCaseId(null)
    historyRef.current = []
    setShowHistory(false)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFileSelected(f)
  }

  function handleFileSelected(f: File) {
    // Auto-send the file immediately with a trigger message
    // so officer never has to press Enter after dropping a doc
    send('Please extract this document and launch the investigation.', f)
  }

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @keyframes kycFadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes kycBounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-6px)} }
        .kyc-send:hover:not(:disabled) { background: #3a6fd8 !important; }
        .kyc-attach:hover { border-color: #bdd0f8 !important; background: #f0f4fd !important; }
        .kyc-textarea:focus { outline: none !important; border-color: #bdd0f8 !important; box-shadow: 0 0 0 3px rgba(74,127,232,0.12) !important; }
      `}</style>

      <div
        style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', background: T.bg }}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }}
        onDrop={handleDrop}
      >
        {showKeyModal && <ApiKeyModal onSubmit={handleApiKey} />}

        {/* Drag overlay */}
        {dragging && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 50, pointerEvents: 'none',
            border: `2px dashed ${T.blue}`, borderRadius: T.radiusLg,
            background: 'rgba(74,127,232,0.05)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              padding: '12px 24px', background: T.blueLight,
              border: `1px solid ${T.blueMid}`, borderRadius: T.radiusLg,
              fontSize: 14, fontWeight: 600, color: T.blue,
            }}>Drop document to attach</div>
          </div>
        )}

        {/* History sidebar — slides in from right */}
        {showHistory && (
          <div style={{
            position: 'absolute', top: 57, right: 0, bottom: 0, width: 320, zIndex: 40,
            background: T.surface, borderLeft: `1px solid ${T.border}`,
            display: 'flex', flexDirection: 'column',
            boxShadow: '-4px 0 16px rgba(30,42,58,0.08)',
            animation: 'kycFadeIn 0.18s ease-out',
          }}>
            {/* Sidebar header */}
            <div style={{
              padding: '12px 16px', borderBottom: `1px solid ${T.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>
                Chat History
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <span style={{
                  fontSize: 10, color: T.textMuted, fontFamily: T.mono,
                  padding: '2px 8px', background: T.bg, borderRadius: 10,
                  border: `1px solid ${T.border}`,
                }}>
                  {sessions.length} sessions
                </span>
                <button
                  onClick={() => setShowHistory(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 16, padding: 0 }}
                >✕</button>
              </div>
            </div>

            {/* Current session indicator */}
            <div style={{
              padding: '8px 16px', borderBottom: `1px solid ${T.borderLight}`,
              background: T.blueLight, flexShrink: 0,
            }}>
              <div style={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
                Current session
              </div>
              <div style={{ fontSize: 12, color: T.text, fontFamily: T.mono }}>
                {sessionId} · {messages.length - 1} messages
              </div>
            </div>

            {/* Session list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
              {loadingSession && (
                <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: T.textMuted }}>
                  Loading session...
                </div>
              )}
              {sessions.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: T.textMuted }}>
                  No saved sessions yet. Sessions are auto-saved as you chat.
                </div>
              ) : (
                sessions.map(s => {
                  const isActive = s.session_id === sessionId
                  return (
                    <div
                      key={s.session_id}
                      onClick={() => !isActive && loadSession(s.session_id)}
                      style={{
                        padding: '10px 12px', borderRadius: T.radius, marginBottom: 6,
                        border: `1px solid ${isActive ? T.blueMid : T.border}`,
                        background: isActive ? T.blueLight : 'transparent',
                        cursor: isActive ? 'default' : 'pointer',
                        transition: 'all 0.12s',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <span style={{ fontSize: 11, fontFamily: T.mono, color: isActive ? T.blue : T.textMid, fontWeight: 600 }}>
                          {s.session_id}
                          {isActive && <span style={{ marginLeft: 6, fontSize: 9, color: T.blue }}> ● current</span>}
                        </span>
                        <span style={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono }}>
                          {s.message_count} msgs
                        </span>
                      </div>
                      {s.started_at && (
                        <div style={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono, marginBottom: 4 }}>
                          {new Date(s.started_at).toLocaleString()}
                        </div>
                      )}
                      {s.last_message && (
                        <div style={{
                          fontSize: 11, color: T.textMid,
                          overflow: 'hidden', textOverflow: 'ellipsis',
                          display: '-webkit-box', WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}>
                          {s.last_message}
                        </div>
                      )}
                      {s.cases_created?.length > 0 && (
                        <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {s.cases_created.map((id: string) => (
                            <span
                              key={id}
                              onClick={e => { e.stopPropagation(); navigate(`/cases/${id}`) }}
                              style={{
                                fontSize: 9, padding: '1px 6px', borderRadius: 4,
                                background: T.greenLight, color: T.green,
                                border: `1px solid ${T.greenBorder}`,
                                fontFamily: T.mono, cursor: 'pointer',
                              }}
                            >↗ case</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>

            {/* Footer actions */}
            <div style={{
              padding: '10px 12px', borderTop: `1px solid ${T.border}`,
              display: 'flex', gap: 8, flexShrink: 0,
            }}>
              <button
                onClick={startNewSession}
                style={{
                  flex: 1, padding: '8px 0', fontSize: 12, fontWeight: 600,
                  background: T.blue, color: '#fff',
                  border: 'none', borderRadius: T.radius, cursor: 'pointer',
                }}
              >＋ New Session</button>
              <button
                onClick={() => apiFetchSessions().then(setSessions).catch(() => {})}
                style={{
                  padding: '8px 12px', fontSize: 12,
                  background: T.bg, color: T.textMid,
                  border: `1px solid ${T.border}`, borderRadius: T.radius, cursor: 'pointer',
                }}
              >↺</button>
            </div>
          </div>
        )}

        {/* Header */}
        <div style={{
          padding: '0 20px', height: 57, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: `1px solid ${T.border}`, background: T.surface,
          boxShadow: '0 1px 3px rgba(30,42,58,0.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 9,
              background: 'linear-gradient(135deg,#4a7fe8,#7c3aed)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 700, color: '#fff',
              boxShadow: '0 2px 6px rgba(74,127,232,0.35)',
            }}>K</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>KYC Chat Intake</div>
              <div style={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono, letterSpacing: '0.06em' }}>
                {geminiModel.toUpperCase()} · AI CASE ASSISTANT
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {caseContext && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '3px 10px', background: T.bg, border: `1px solid ${T.border}`,
                borderRadius: 20, fontSize: 10, color: T.textMid, fontFamily: T.mono,
              }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: T.green }} />
                DB loaded
              </div>
            )}
            {/* History toggle */}
            <button
              onClick={() => { setShowHistory(h => !h); apiFetchSessions().then(setSessions).catch(() => {}) }}
              style={{
                padding: '4px 12px', fontSize: 11, fontWeight: 600,
                background: showHistory ? T.blueLight : T.bg,
                color: showHistory ? T.blue : T.textMid,
                border: `1px solid ${showHistory ? T.blueMid : T.border}`,
                borderRadius: 20, cursor: 'pointer', fontFamily: T.mono,
              }}
            >📋 History</button>
            {/* New session */}
            <button
              onClick={startNewSession}
              style={{
                padding: '4px 12px', fontSize: 11, fontWeight: 600,
                background: T.bg, color: T.textMid,
                border: `1px solid ${T.border}`, borderRadius: 20, cursor: 'pointer',
              }}
            >＋ New</button>
            {apiKey ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '3px 10px', background: T.greenLight, border: `1px solid ${T.greenBorder}`,
                borderRadius: 20, fontSize: 10, color: T.green, fontFamily: T.mono, fontWeight: 600,
              }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: T.green }} />
                Connected
              </div>
            ) : (
              <button onClick={() => setShowKeyModal(true)} style={{
                padding: '4px 12px', fontSize: 11, fontWeight: 600,
                background: T.redLight, color: T.red,
                border: `1px solid ${T.redBorder}`, borderRadius: 20, cursor: 'pointer',
              }}>⚠ Set API key</button>
            )}
          </div>
        </div>

        {/* Messages */}
        <div style={{
          flex: 1, overflowY: 'auto', padding: '20px 24px',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}>
          {messages.map(msg => (
            <MsgBubble
              key={msg.id} msg={msg}
              onLaunch={handleLaunch} onEdit={handleEdit}
              launchingId={launchingId} onOpen={handleOpen}
            />
          ))}

          {typing && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg,#4a7fe8,#7c3aed)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 700, color: '#fff', fontFamily: T.mono,
                boxShadow: '0 2px 6px rgba(74,127,232,0.3)',
              }}>K</div>
              <div style={{
                background: T.surface, border: `1px solid ${T.border}`,
                borderRadius: '3px 10px 10px 10px',
                boxShadow: '0 1px 3px rgba(30,42,58,0.05)',
              }}>
                <TypingDots />
              </div>
            </div>
          )}

          {errorMsg && (
            <div style={{
              padding: '8px 14px', fontSize: 12, background: T.redLight,
              border: `1px solid ${T.redBorder}`, borderRadius: T.radius, color: T.red,
            }}>⚠ {errorMsg}</div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div style={{
          borderTop: `1px solid ${T.border}`, background: T.surface,
          padding: '12px 20px 16px', flexShrink: 0,
          boxShadow: '0 -1px 4px rgba(30,42,58,0.04)',
        }}>
          {pendingFile && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '5px 12px', marginBottom: 8,
              background: T.blueLight, border: `1px solid ${T.blueMid}`,
              borderRadius: T.radius,
            }}>
              <span style={{ fontSize: 13 }}>{pendingFile.type === 'application/pdf' ? '📋' : '🖼️'}</span>
              <span style={{
                fontSize: 12, color: T.text, flex: 1,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: T.mono,
              }}>{pendingFile.name}</span>
              <button onClick={() => setPendingFile(null)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: T.textMuted, fontSize: 14, padding: 0, lineHeight: 1,
              }}>✕</button>
            </div>
          )}

          <label className="kyc-attach" style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 12px', marginBottom: 8,
            border: `1px dashed ${T.border}`, borderRadius: T.radius,
            cursor: 'pointer', background: 'transparent', transition: 'all 0.15s',
          }}>
            <input type="file" accept="image/*,application/pdf" style={{ display: 'none' }}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const f = e.target.files?.[0]
                if (f) { handleFileSelected(f); e.target.value = '' }
              }}
            />
            <span style={{ fontSize: 14 }}>📎</span>
            <span style={{ fontSize: 12, color: T.textMuted }}>
              Attach ID document — passport · Aadhaar · PAN · driving licence · company registration
            </span>
          </label>

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              className="kyc-textarea"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder={'Drop a document above, type a name, or ask about existing cases…'}
              disabled={typing}
              style={{
                flex: 1, resize: 'none', lineHeight: 1.5,
                fontFamily: 'inherit', fontSize: 13, color: T.text,
                padding: '9px 12px', minHeight: 38, maxHeight: 120, overflowY: 'auto',
                border: `1px solid ${T.border}`, borderRadius: T.radius,
                background: T.bg, transition: 'border-color 0.15s, box-shadow 0.15s',
              }}
            />
            <button
              className="kyc-send"
              onClick={() => send()}
              disabled={typing || (!input.trim() && !pendingFile)}
              style={{
                width: 38, height: 38, flexShrink: 0,
                background: typing || (!input.trim() && !pendingFile) ? T.bg : T.blue,
                color: typing || (!input.trim() && !pendingFile) ? T.textMuted : '#fff',
                border: `1px solid ${typing || (!input.trim() && !pendingFile) ? T.border : T.blue}`,
                borderRadius: T.radius, cursor: typing || (!input.trim() && !pendingFile) ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, transition: 'all 0.15s',
                boxShadow: typing || (!input.trim() && !pendingFile) ? 'none' : '0 2px 6px rgba(74,127,232,0.3)',
              }}
            >↑</button>
          </div>

          <div style={{ marginTop: 6, fontSize: 10, color: T.textMuted, fontFamily: T.mono }}>
            Enter to send · Shift+Enter for new line · drag &amp; drop documents anywhere
          </div>
        </div>
      </div>
    </>
  )
}
