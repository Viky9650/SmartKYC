import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDropzone } from 'react-dropzone'
import { casesApi, documentsApi } from '../services/api'
import { PageTopbar, Spinner, ConfidenceBar } from '../components/shared/UI'

const SUBJECT_TYPES = [
  'Individual', 'Company Director', 'PEP (Politically Exposed Person)',
  'Corporate Entity', 'Trust / Foundation', 'Nominee',
]

const NATIONALITIES = [
  'Indian', 'British', 'American', 'Russian Federation', 'UAE / Emirati',
  'Chinese', 'German', 'French', 'Italian', 'Spanish', 'Nigerian',
  'South African', 'Brazilian', 'Saudi Arabian', 'Iranian', 'Turkish',
   'Sri Lankan', 'Other',
]

const DOC_TYPES = [
  { value: '', label: 'Auto-detect from file' },
  { value: 'IN_PASSPORT',         label: '🇮🇳 India — Passport' },
  { value: 'IN_AADHAAR',          label: '🇮🇳 India — Aadhaar Card' },
  { value: 'IN_PAN',              label: '🇮🇳 India — PAN Card' },
  { value: 'IN_VOTER_ID',         label: '🇮🇳 India — Voter ID' },
  { value: 'IN_DRIVING_LICENSE',  label: '🇮🇳 India — Driving License' },
  { value: 'GB_PASSPORT',         label: '🇬🇧 UK — Passport' },
  { value: 'GB_DRIVING_LICENSE',  label: '🇬🇧 UK — Driving Licence' },
  { value: 'US_PASSPORT',         label: '🇺🇸 US — Passport' },
  { value: 'US_DRIVERS_LICENSE',  label: '🇺🇸 US — Driver\'s License' },
  { value: 'EU_PASSPORT',         label: '🇪🇺 EU — Passport' },
  { value: 'EU_NATIONAL_ID',      label: '🇪🇺 EU — National ID' },
  { value: 'RU_PASSPORT',         label: '🇷🇺 Russia — Passport' },
  { value: 'AE_PASSPORT',         label: '🇦🇪 UAE — Passport' },
  { value: 'AE_EMIRATES_ID',      label: '🇦🇪 UAE — Emirates ID' },
  { value: 'CN_PASSPORT',         label: '🇨🇳 China — Passport' },
  { value: 'CN_ID_CARD',          label: '🇨🇳 China — Resident ID' },
  { value: 'COMPANY_REGISTRATION',label: '🏢 Company Registration' },
  { value: 'GENERIC_PASSPORT',    label: '🌍 Generic Passport' },
]

export default function NewCasePage() {
  const navigate = useNavigate()

  // Form state
  const [form, setForm] = useState({
    subject_name: '', subject_type: 'Individual',
    date_of_birth: '', nationality: '', notes: '',
  })

  // Upload state
  const [docType, setDocType]         = useState('')
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [extraction, setExtraction]   = useState<any>(null)
  const [uploadError, setUploadError] = useState('')

  // Submission state
  const [status, setStatus] = useState<'idle' | 'creating' | 'uploading' | 'launching'>('idle')
  const [formError, setFormError]     = useState('')

  function update(field: string, value: string) {
    setForm(p => ({ ...p, [field]: value }))
  }

  // ── Drop zone ──────────────────────────────────────────────────────────────
  const onDrop = useCallback((files: File[]) => {
    if (files[0]) {
      setUploadedFile(files[0])
      setExtraction(null)
      setUploadError('')
    }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [], 'application/pdf': [] },
    maxFiles: 1,
    disabled: status !== 'idle',
  })

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!form.subject_name.trim()) {
      setFormError('Subject name is required')
      return
    }
    setFormError('')

    try {
      // Step 1: create case
      setStatus('creating')
      const newCase = await casesApi.create(form)

      // Step 2: upload + extract document (if one was dropped)
      if (uploadedFile) {
        setStatus('uploading')
        try {
          const result = await documentsApi.upload(newCase.id, uploadedFile, docType || undefined)
          setExtraction(result.extraction)
        } catch (e: any) {
          setUploadError(e?.response?.data?.detail || 'Document upload failed — continuing without it')
        }
      }

      // Step 3: start investigation (non-blocking — redirect immediately, 
      //   investigation runs in background on server)
      setStatus('launching')
      casesApi.startInvestigation(newCase.id).catch(() => {})
      // Small delay so user sees the "Launching" state, then redirect to case detail
      await new Promise(r => setTimeout(r, 800))
      navigate(`/cases/${newCase.id}`)

    } catch (e: any) {
      setFormError(e?.response?.data?.detail || 'Something went wrong')
      setStatus('idle')
    }
  }

  const isSubmitting = status !== 'idle'

  return (
    <div>
      <PageTopbar
        title="New Investigation Case"
        sub="Fill subject details, upload an ID document, then launch"
      />

      <div style={{ padding: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, maxWidth: 1100, margin: '0 auto' }}>

          {/* ── LEFT: Subject info ────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div className="card">
              <div className="card-title">Subject Information</div>

              <div style={{ marginBottom: 14 }}>
                <label className="label">Full Name *</label>
                <input className="input" placeholder="e.g. Rajesh Kumar Sharma"
                  value={form.subject_name} onChange={e => update('subject_name', e.target.value)}
                  disabled={isSubmitting} />
              </div>

              <div style={{ marginBottom: 14 }}>
                <label className="label">Subject Type</label>
                <select className="input" value={form.subject_type}
                  onChange={e => update('subject_type', e.target.value)} disabled={isSubmitting}>
                  {SUBJECT_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label className="label">Date of Birth</label>
                  <input className="input" placeholder="DD/MM/YYYY"
                    value={form.date_of_birth} onChange={e => update('date_of_birth', e.target.value)}
                    disabled={isSubmitting} />
                </div>
                <div>
                  <label className="label">Nationality</label>
                  <select className="input" value={form.nationality}
                    onChange={e => update('nationality', e.target.value)} disabled={isSubmitting}>
                    <option value="">Select…</option>
                    {NATIONALITIES.map(n => <option key={n}>{n}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: 4 }}>
                <label className="label">Investigation Notes</label>
                <textarea className="input" rows={3}
                  placeholder="Additional context — relationships, transaction history, source of wealth…"
                  value={form.notes} onChange={e => update('notes', e.target.value)}
                  disabled={isSubmitting} />
              </div>
            </div>

            {/* AI pipeline info */}
            <div className="card">
              <div className="card-title">What happens next</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { step: '01', icon: '📄', label: 'Document Extraction', desc: 'Gemini Vision reads your uploaded file and extracts all fields with confidence scores' },
                  { step: '02', icon: '🧠', label: 'AI Investigation Plan', desc: 'LLM decides which agents to spawn based on subject nationality, type and risk profile' },
                  { step: '03', icon: '🤖', label: 'Agent Execution', desc: 'Mandatory + conditional + LLM-decided agents run: Sanctions, PEP, Registry, Media…' },
                  { step: '04', icon: '📊', label: 'Risk Score & Review', desc: 'Weighted risk aggregation → routed to human review queue' },
                ].map(item => (
                  <div key={item.step} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    padding: '10px 12px', background: '#f4f6fb',
                    borderRadius: 8, border: '1px solid #e4e9f4',
                  }}>
                    <div style={{
                      fontSize: 10, fontWeight: 700, color: '#4a7fe8',
                      fontFamily: 'JetBrains Mono,monospace',
                      background: '#dce8fc', padding: '2px 6px',
                      borderRadius: 4, flexShrink: 0, marginTop: 2,
                    }}>{item.step}</div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#1e2a3a', marginBottom: 2 }}>
                        {item.icon} {item.label}
                      </div>
                      <div style={{ fontSize: 11, color: '#5a6a84', lineHeight: 1.5 }}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── RIGHT: Document upload + launch ──────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            <div className="card">
              <div className="card-title">Upload Identity Document</div>

              {/* Document type hint */}
              <div style={{ marginBottom: 14 }}>
                <label className="label">Document Type</label>
                <select className="input" value={docType}
                  onChange={e => setDocType(e.target.value)} disabled={isSubmitting}>
                  {DOC_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <div style={{ fontSize: 11, color: '#96a3bb', marginTop: 4 }}>
                  Auto-detect works well if your filename includes the doc type (e.g. aadhaar_card.jpg)
                </div>
              </div>

              {/* Drop zone — always visible */}
              {!uploadedFile ? (
                <div
                  {...getRootProps()}
                  style={{
                    border: `2px dashed ${isDragActive ? '#4a7fe8' : '#b8c4de'}`,
                    borderRadius: 12,
                    padding: '36px 20px',
                    textAlign: 'center',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer',
                    background: isDragActive ? '#dce8fc33' : '#f8f9fd',
                    transition: 'all 0.2s',
                  }}
                >
                  <input {...getInputProps()} />
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: '#1e2a3a', marginBottom: 6 }}>
                    {isDragActive ? 'Drop your document here' : 'Click or drag to upload'}
                  </div>
                  <div style={{ fontSize: 13, color: '#5a6a84', marginBottom: 6 }}>
                    Passport · Aadhaar · PAN · Voter ID · National ID · Company Registration
                  </div>
                  <div style={{ fontSize: 11, color: '#96a3bb' }}>
                    JPG · PNG · PDF · WEBP · up to 20 MB
                  </div>
                </div>
              ) : (
                /* File selected — show preview */
                <div>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 14px',
                    background: '#f0f7ff',
                    border: '1px solid #bdd0f8',
                    borderRadius: 10, marginBottom: 12,
                  }}>
                    <span style={{ fontSize: 28 }}>
                      {uploadedFile.type === 'application/pdf' ? '📋' : '🖼️'}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#1e2a3a',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {uploadedFile.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#5a6a84', fontFamily: 'JetBrains Mono,monospace' }}>
                        {uploadedFile.type || 'file'} · {(uploadedFile.size / 1024).toFixed(0)} KB
                      </div>
                    </div>
                    {!isSubmitting && (
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: '4px 8px', color: '#96a3bb' }}
                        onClick={() => { setUploadedFile(null); setExtraction(null); setUploadError('') }}
                      >
                        ✕ Remove
                      </button>
                    )}
                  </div>

                  {/* Extraction preview (shown after upload completes) */}
                  {extraction && <ExtractionPreview extraction={extraction} />}

                  {uploadError && (
                    <div style={{ padding: '8px 12px', background: '#fef3c7', border: '1px solid #fde68a',
                      borderRadius: 6, fontSize: 12, color: '#b45309', marginTop: 8 }}>
                      ⚠ {uploadError}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Status messages during processing */}
            {isSubmitting && (
              <div className="card" style={{ border: '1px solid #bdd0f8', background: '#f0f7ff' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { step: 'creating',  label: 'Creating case record…' },
                    { step: 'uploading', label: 'Extracting document fields with Gemini Vision…' },
                    { step: 'launching', label: 'Launching AI investigation agents…' },
                  ].map(s => {
                    const steps = ['creating', 'uploading', 'launching']
                    const idx = steps.indexOf(s.step)
                    const curIdx = steps.indexOf(status)
                    const done = idx < curIdx
                    const active = idx === curIdx
                    return (
                      <div key={s.step} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {done ? (
                          <span style={{ fontSize: 14, color: '#15803d' }}>✓</span>
                        ) : active ? (
                          <Spinner size={14} />
                        ) : (
                          <div style={{ width: 14, height: 14, borderRadius: '50%',
                            border: '2px solid #d1d9ee', flexShrink: 0 }} />
                        )}
                        <span style={{ fontSize: 13, color: active ? '#1e2a3a' : '#96a3bb', fontWeight: active ? 500 : 400 }}>
                          {s.label}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Error */}
            {formError && (
              <div style={{ padding: '10px 14px', background: '#fee2e2', border: '1px solid #fecaca',
                borderRadius: 8, fontSize: 13, color: '#b91c1c' }}>
                {formError}
              </div>
            )}

            {/* Launch button */}
            <button
              className="btn btn-primary"
              style={{
                width: '100%', justifyContent: 'center',
                padding: '14px 20px', fontSize: 15, fontWeight: 600,
                borderRadius: 10,
                opacity: isSubmitting ? 0.7 : 1,
              }}
              onClick={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <><Spinner size={16} /> Processing…</>
              ) : (
                <>🔍 {uploadedFile ? 'Upload Document & Launch Investigation' : 'Launch Investigation'}</>
              )}
            </button>

            {!uploadedFile && !isSubmitting && (
              <div style={{ textAlign: 'center', fontSize: 12, color: '#96a3bb' }}>
                Document upload is optional — the AI will still run all available checks
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}

// ── Extraction preview shown after successful upload ───────────────────────
function ExtractionPreview({ extraction }: { extraction: any }) {
  const fields   = extraction?.fields || {}
  const confs    = extraction?.confidences || {}
  const fullName = extraction?.full_name || fields?.name || ''
  const method   = extraction?.extraction_method || ''
  const conf     = extraction?.overall_confidence || 0

  const methodBadge = {
    gemini_vision: { label: '✦ Gemini Vision', bg: '#dcfce7', color: '#15803d', border: '#bbf7d0' },
    mrz:           { label: '⊞ MRZ Parser',    bg: '#dce8fc', color: '#2563eb', border: '#bdd0f8' },
    tesseract:     { label: '◈ OCR Fallback',   bg: '#fef9c3', color: '#b45309', border: '#fde68a' },
    pdfminer:      { label: '⊠ PDF Text',       bg: '#ede9fe', color: '#6d28d9', border: '#ddd6fe' },
  }[method] || { label: method, bg: '#eef1f8', color: '#5a6a84', border: '#d1d9ee' }

  const entries = Object.entries(fields).filter(([k]) => !k.startsWith('_')).slice(0, 10)

  if (!entries.length && !fullName) return null

  return (
    <div style={{
      background: '#f8fffe', border: '1px solid #a7f3d0',
      borderRadius: 10, padding: '14px',
      animation: 'slideUp 0.25s ease-out',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#15803d' }}>✓ Extracted</span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
          background: methodBadge.bg, color: methodBadge.color, border: `1px solid ${methodBadge.border}`,
          fontFamily: 'JetBrains Mono,monospace',
        }}>{methodBadge.label}</span>
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
          background: conf >= 0.9 ? '#dcfce7' : '#fef9c3',
          color: conf >= 0.9 ? '#15803d' : '#b45309',
          border: `1px solid ${conf >= 0.9 ? '#bbf7d0' : '#fde68a'}`,
          fontFamily: 'JetBrains Mono,monospace',
        }}>{Math.round(conf * 100)}% confidence</span>
        <span style={{ fontSize: 11, color: '#5a6a84' }}>{extraction?.document_type} · {extraction?.country}</span>
      </div>

      {/* Full name highlight */}
      {fullName && (
        <div style={{
          padding: '8px 12px', background: '#dce8fc',
          border: '1px solid #bdd0f8', borderRadius: 8, marginBottom: 12,
        }}>
          <div style={{ fontSize: 10, color: '#5a6a84', fontFamily: 'JetBrains Mono,monospace', marginBottom: 2 }}>
            EXTRACTED NAME
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1e2a3a', fontFamily: 'JetBrains Mono,monospace' }}>
            {fullName}
          </div>
        </div>
      )}

      {/* Fields grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
        {entries.map(([key, value]) => (
          <div key={key}>
            <div style={{ fontSize: 10, color: '#96a3bb', fontFamily: 'JetBrains Mono,monospace',
              textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
              {key.replace(/_/g, ' ')}
            </div>
            <div style={{ fontSize: 12, color: '#1e2a3a', fontFamily: 'JetBrains Mono,monospace',
              wordBreak: 'break-all', marginBottom: 3 }}>
              {String(value)}
            </div>
            {confs[key] > 0 && (
              <div style={{ height: 3, background: '#e4e9f4', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  width: `${confs[key] * 100}%`, height: '100%', borderRadius: 2,
                  background: confs[key] >= 0.9 ? '#22c55e' : confs[key] >= 0.7 ? '#f59e0b' : '#ef4444',
                  transition: 'width 0.4s ease',
                }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
