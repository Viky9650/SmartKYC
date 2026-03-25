import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { casesApi } from '../services/api'
import {
  PageTopbar, RiskRing, StatusBadge, FlagTags, EmptyState, SectionHeader,
} from '../components/shared/UI'
import {
  InvestigationPlanCard, AgentTimeline, VerificationSourcesPanel,
  AgentFindingsPanel, LiveLog,
} from '../components/investigation/InvestigationView'
import DocumentExtractionPanel from '../components/documents/DocumentExtractionPanel'
import DocumentUpload from '../components/documents/DocumentUpload'
import { formatDateTime } from '../utils'

// ── Identity Discrepancy Banner ────────────────────────────────────────────
function IdentityDiscrepancyBanner({
  caseId, agents, caseData, onResolved,
}: {
  caseId: string
  agents: any[]
  caseData: any
  onResolved: () => void
}) {
  const [action, setAction] = useState<null | 'confirm' | 'flag'>(null)
  const [correctName, setCorrectName]            = useState(caseData.subject_name || '')
  const [correctDob, setCorrectDob]              = useState(caseData.date_of_birth || '')
  const [correctNationality, setCorrectNationality] = useState(caseData.nationality || '')
  const [notes, setNotes]             = useState('')
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')

  const identityAgent = agents.find(a => a.agent_name === 'identity_agent')
  if (!identityAgent) return null

  const flags: string[] = identityAgent.flags || []
  const hasMismatch = flags.some(f =>
    ['name_mismatch_critical','name_mismatch','dob_mismatch'].includes(f)
  )
  const alreadyConfirmed = flags.includes('officer_confirmed_suspicious')
  if (!hasMismatch && !alreadyConfirmed) return null

  // Extract what the document says from evidence
  const ev = identityAgent.evidence || {}
  const nameCheck = ev.name_mismatch_check || {}
  const dobCheck  = ev.dob_mismatch_check  || {}
  const docName = nameCheck.document_name || ''
  const docDob  = dobCheck.document_dob   || ''

  async function submit() {
    if (!action) return
    setSaving(true); setError('')
    try {
      const body: any = { action: action === 'confirm' ? 'confirm_document' : 'flag_suspicious', notes }
      if (action === 'confirm') {
        if (correctName)        body.correct_name        = correctName
        if (correctDob)         body.correct_dob         = correctDob
        if (correctNationality) body.correct_nationality = correctNationality
      }
      const res = await fetch(`/api/cases/${caseId}/correct-identity`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      onResolved()
    } catch (e: any) {
      setError(e.message || 'Request failed')
    } finally {
      setSaving(false)
    }
  }

  if (alreadyConfirmed) {
    return (
      <div style={{
        padding: '12px 16px', borderRadius: 10, marginBottom: 16,
        background: '#fee2e222', border: '1px solid #ef4444',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: 18 }}>🚨</span>
        <div style={{ fontSize: 13, color: '#b91c1c', fontWeight: 500 }}>
          Identity mismatch confirmed as suspicious by compliance officer.
        </div>
      </div>
    )
  }

  return (
    <div style={{
      padding: '16px 18px', borderRadius: 10, marginBottom: 16,
      background: '#fffbeb', border: '2px solid #f59e0b',
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
        <span style={{ fontSize: 22, flexShrink: 0 }}>⚠️</span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>
            Data Entry Discrepancy — Officer Action Required
          </div>
          <div style={{ fontSize: 13, color: '#78350f', lineHeight: 1.6 }}>
            The uploaded document doesn't match what was entered when the case was created.
            This could be a <strong>typo by the officer</strong> or a <strong>fraudulent document</strong>.
            Please review and take action below.
          </div>
        </div>
      </div>

      {/* Side-by-side comparison */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
        marginBottom: 14, padding: '12px', background: '#fef3c7',
        borderRadius: 8, border: '1px solid #fde68a',
      }}>
        <div>
          <div style={{ fontSize: 10, color: '#92400e', fontFamily: 'JetBrains Mono,monospace',
            textTransform: 'uppercase', marginBottom: 6, fontWeight: 700 }}>
            📋 Case Registration
          </div>
          {caseData.subject_name && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 10, color: '#78350f' }}>Name</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1e2a3a',
                fontFamily: 'JetBrains Mono,monospace' }}>{caseData.subject_name}</div>
            </div>
          )}
          {caseData.date_of_birth && (
            <div>
              <div style={{ fontSize: 10, color: '#78350f' }}>Date of Birth</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1e2a3a',
                fontFamily: 'JetBrains Mono,monospace' }}>{caseData.date_of_birth}</div>
            </div>
          )}
          {caseData.nationality && (
            <div>
              <div style={{ fontSize: 10, color: '#78350f' }}>Nationality</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1e2a3a',
                fontFamily: 'JetBrains Mono,monospace' }}>{caseData.nationality}</div>
            </div>
          )}
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#92400e', fontFamily: 'JetBrains Mono,monospace',
            textTransform: 'uppercase', marginBottom: 6, fontWeight: 700 }}>
            🪪 Extracted from Document
          </div>
          {docName && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 10, color: '#78350f' }}>Name</div>
              <div style={{ fontSize: 13, fontWeight: 600,
                color: flags.includes('name_mismatch_critical') || flags.includes('name_mismatch') ? '#dc2626' : '#1e2a3a',
                fontFamily: 'JetBrains Mono,monospace' }}>{docName}</div>
            </div>
          )}
          {docDob && (
            <div>
              <div style={{ fontSize: 10, color: '#78350f' }}>Date of Birth</div>
              <div style={{ fontSize: 13, fontWeight: 600,
                color: flags.includes('dob_mismatch') ? '#dc2626' : '#1e2a3a',
                fontFamily: 'JetBrains Mono,monospace' }}>{docDob}</div>
            </div>
          )}
        </div>
      </div>

      {/* Action choice */}
      {!action ? (
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => { setAction('confirm'); setCorrectName(docName || caseData.subject_name); setCorrectDob(docDob || caseData.date_of_birth) }}
            style={{
              flex: 1, padding: '10px', borderRadius: 8, border: '2px solid #22c55e',
              background: '#f0fdf4', color: '#15803d', fontWeight: 600, fontSize: 13,
              cursor: 'pointer',
            }}>
            ✏️ Data Entry Error — Update Case
          </button>
          <button
            onClick={() => setAction('flag')}
            style={{
              flex: 1, padding: '10px', borderRadius: 8, border: '2px solid #ef4444',
              background: '#fef2f2', color: '#b91c1c', fontWeight: 600, fontSize: 13,
              cursor: 'pointer',
            }}>
            🚨 Suspicious — Flag for Investigation
          </button>
        </div>
      ) : action === 'confirm' ? (
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#15803d', marginBottom: 10 }}>
            ✏️ Correct the case registration details
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: '#166534', display: 'block', marginBottom: 3 }}>Correct Name</label>
              <input
                style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #86efac',
                  fontSize: 13, fontFamily: 'JetBrains Mono,monospace', boxSizing: 'border-box' }}
                value={correctName}
                onChange={e => setCorrectName(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#166534', display: 'block', marginBottom: 3 }}>Correct DOB</label>
              <input
                style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #86efac',
                  fontSize: 13, fontFamily: 'JetBrains Mono,monospace', boxSizing: 'border-box' }}
                value={correctDob}
                placeholder="DD/MM/YYYY"
                onChange={e => setCorrectDob(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: '#166534', display: 'block', marginBottom: 3 }}>Correct Nationality</label>
              <input
                style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #86efac',
                  fontSize: 13, fontFamily: 'JetBrains Mono,monospace', boxSizing: 'border-box' }}
                value={correctNationality}
                placeholder="e.g. Indian"
                onChange={e => setCorrectNationality(e.target.value)}
              />
            </div>
          </div>
          <textarea
            style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #86efac',
              fontSize: 12, marginBottom: 10, resize: 'vertical', boxSizing: 'border-box' }}
            rows={2} placeholder="Optional note (e.g. 'Officer typo on intake form')"
            value={notes} onChange={e => setNotes(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={submit} disabled={saving} style={{
              padding: '8px 16px', borderRadius: 6, background: '#22c55e', color: '#fff',
              border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer',
            }}>{saving ? 'Saving…' : 'Confirm Correction'}</button>
            <button onClick={() => setAction(null)} disabled={saving} style={{
              padding: '8px 16px', borderRadius: 6, background: 'transparent',
              border: '1px solid #d1d9ee', fontSize: 12, cursor: 'pointer',
            }}>Back</button>
          </div>
          {error && <div style={{ marginTop: 8, fontSize: 12, color: '#dc2626' }}>{error}</div>}
        </div>
      ) : (
        <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#b91c1c', marginBottom: 8 }}>
            🚨 Confirm this is a genuinely suspicious document
          </div>
          <div style={{ fontSize: 12, color: '#7f1d1d', marginBottom: 10 }}>
            This will raise the risk score and mark the case for urgent review.
            The mismatch will be recorded as confirmed fraud indicator.
          </div>
          <textarea
            style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid #fca5a5',
              fontSize: 12, marginBottom: 10, resize: 'vertical', boxSizing: 'border-box' }}
            rows={2} placeholder="Required: reason for suspicion"
            value={notes} onChange={e => setNotes(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={submit} disabled={saving || !notes.trim()} style={{
              padding: '8px 16px', borderRadius: 6, background: '#ef4444', color: '#fff',
              border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer',
              opacity: notes.trim() ? 1 : 0.5,
            }}>{saving ? 'Saving…' : 'Confirm Suspicious'}</button>
            <button onClick={() => setAction(null)} disabled={saving} style={{
              padding: '8px 16px', borderRadius: 6, background: 'transparent',
              border: '1px solid #d1d9ee', fontSize: 12, cursor: 'pointer',
            }}>Back</button>
          </div>
          {error && <div style={{ marginTop: 8, fontSize: 12, color: '#dc2626' }}>{error}</div>}
        </div>
      )}
    </div>
  )
}
import type { CaseDetail } from '../types'

// ── Verification Sources Panel ─────────────────────────────────────────────
function VerificationResultPanel({ sources }: { sources: any[] }) {
  if (!sources || sources.length === 0) {
    return (
      <div className="card">
        <span className="card-title">Verification Sources</span>
        <div style={{ fontSize: 12, color: '#96a3bb', fontStyle: 'italic' }}>No verification sources yet</div>
      </div>
    )
  }

  // Group by source_type
  const groups: Record<string, any[]> = {}
  sources.forEach(s => {
    const t = s.source_type || 'other'
    if (!groups[t]) groups[t] = []
    groups[t].push(s)
  })

  const typeLabels: Record<string, string> = {
    sanctions: '🛡 Sanctions Lists',
    pep: '👤 PEP Databases',
    identity: '🪪 Identity Verification',
    registry: '🏢 Corporate Registries',
    adverse_media: '📰 Adverse Media',
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span className="card-title" style={{ marginBottom: 0 }}>Verification Sources</span>
        <span className="badge badge-blue">{sources.length} checked</span>
      </div>

      {Object.entries(groups).map(([type, srcs]) => (
        <div key={type} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#5a6a84', textTransform: 'uppercase',
            letterSpacing: '0.07em', marginBottom: 8 }}>
            {typeLabels[type] || type}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {srcs.map((s, i) => (
              <VerificationSourceCard key={i} source={s} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function VerificationSourceCard({ source: s }: { source: any }) {
  const rd = s.result_detail || {}
  const isIdentity = s.source_type === 'identity'
  const verifiedFields: any[] = rd.verified_fields || []
  const failedFields: any[]   = rd.failed_fields   || []
  const hasFieldData = verifiedFields.length > 0 || failedFields.length > 0

  // Overall status
  const isClear   = s.result === 'clear'
  const isFlagged = s.result === 'flagged'
  const isPartial = s.result === 'partial_match'

  const statusDot = isClear ? '#22c55e' : isFlagged ? '#ef4444' : '#f59e0b'
  const statusLabel = isClear ? 'Verified ✓' : isFlagged ? 'Failed ✗' : isPartial ? 'Partial Match ⚠' : s.result

  return (
    <div style={{
      border: `1px solid ${isClear ? '#bbf7d0' : isFlagged ? '#fecaca' : '#fde68a'}`,
      borderRadius: 8,
      background: isClear ? '#f0fdf4' : isFlagged ? '#fef2f2' : '#fffbeb',
      overflow: 'hidden',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', borderBottom: hasFieldData ? `1px solid ${isClear ? '#bbf7d0' : isFlagged ? '#fecaca' : '#fde68a'}` : 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusDot, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1e2a3a' }}>{s.source_name}</span>
          {s.is_mock && (
            <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3,
              background: '#fef9c3', color: '#b45309', border: '1px solid #fde68a',
              fontFamily: 'JetBrains Mono,monospace' }}>MOCK</span>
          )}
        </div>
        <span style={{
          fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono,monospace',
          color: isClear ? '#15803d' : isFlagged ? '#b91c1c' : '#b45309',
        }}>
          {statusLabel}
        </span>
      </div>

      {/* Identity authority: show field-level results */}
      {isIdentity && hasFieldData && (
        <div style={{ padding: '10px 12px' }}>
          {rd.authority && (
            <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 8, fontStyle: 'italic' }}>
              Authority: {rd.authority}
            </div>
          )}

          {verifiedFields.length > 0 && (
            <div style={{ marginBottom: failedFields.length > 0 ? 8 : 0 }}>
              <div style={{ fontSize: 10, color: '#15803d', fontWeight: 700, marginBottom: 4,
                textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                ✓ Verified Fields
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {verifiedFields.map((f: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8,
                    padding: '4px 8px', background: '#dcfce7', borderRadius: 5 }}>
                    <span style={{ fontSize: 10, color: '#166534', fontWeight: 600,
                      fontFamily: 'JetBrains Mono,monospace', minWidth: 110 }}>
                      {f.field}
                    </span>
                    <span style={{ fontSize: 11, color: '#1e2a3a', fontFamily: 'JetBrains Mono,monospace',
                      fontWeight: 500 }}>
                      {f.value}
                    </span>
                    {f.note && (
                      <span style={{ fontSize: 10, color: '#6b7280', marginLeft: 'auto' }}>{f.note}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {failedFields.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: '#b91c1c', fontWeight: 700, marginBottom: 4,
                textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                ✗ Failed / Incorrect Fields
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {failedFields.map((f: any, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 8,
                    padding: '4px 8px', background: '#fee2e2', borderRadius: 5 }}>
                    <span style={{ fontSize: 10, color: '#b91c1c', fontWeight: 600,
                      fontFamily: 'JetBrains Mono,monospace', minWidth: 110 }}>
                      {f.field}
                    </span>
                    <span style={{ fontSize: 11, color: '#7f1d1d', fontFamily: 'JetBrains Mono,monospace' }}>
                      {f.value}
                    </span>
                    {f.reason && (
                      <span style={{ fontSize: 10, color: '#b91c1c', marginLeft: 'auto' }}>
                        {f.reason}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {rd.note && (
            <div style={{ marginTop: 8, fontSize: 10, color: '#6b7280', fontStyle: 'italic',
              borderTop: '1px solid #e4e9f4', paddingTop: 6 }}>
              {rd.note}
            </div>
          )}
        </div>
      )}

      {/* Non-identity sources: show matches/flags if any */}
      {!isIdentity && isFlagged && rd.matches && rd.matches.length > 0 && (
        <div style={{ padding: '8px 12px' }}>
          {rd.matches.map((m: any, i: number) => (
            <div key={i} style={{ fontSize: 12, color: '#b91c1c', marginBottom: 2 }}>
              ⚠ {m.match_type}: score {Math.round((m.score || 0) * 100)}% — {m.note || ''}
            </div>
          ))}
        </div>
      )}
      {!isIdentity && rd.articles_found > 0 && (
        <div style={{ padding: '8px 12px', fontSize: 12, color: '#b45309' }}>
          {rd.articles_found} adverse media article{rd.articles_found > 1 ? 's' : ''} found
        </div>
      )}
    </div>
  )
}

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<CaseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [polling, setPolling] = useState(false)

  const fetchDetail = useCallback(async () => {
    if (!id) return
    try {
      const data = await casesApi.get(id)
      setDetail(data)
      // Keep polling if still investigating
      if (['pending', 'investigating'].includes(data.case.status)) {
        setPolling(true)
      } else {
        setPolling(false)
      }
    } catch {
      setPolling(false)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    fetchDetail()
  }, [fetchDetail])

  useEffect(() => {
    if (!polling) return
    const interval = setInterval(fetchDetail, 3000)
    return () => clearInterval(interval)
  }, [polling, fetchDetail])

  if (loading) {
    return (
      <div>
        <PageTopbar title="Case Detail" />
        <div style={{ padding: 24, textAlign: 'center', color: '#96a3bb' }}>Loading...</div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div>
        <PageTopbar title="Case Not Found" />
        <div style={{ padding: 24 }}>
          <EmptyState icon="❓" title="Case not found" sub="The case may have been deleted or the ID is invalid" />
        </div>
      </div>
    )
  }

  const { case: c, agents, verification_sources, documents, events, reviews } = detail
  const isInvestigating = ['pending', 'investigating'].includes(c.status)
  const latestReview = reviews?.[0]

  return (
    <div>
      <PageTopbar
        title={c.subject_name}
        sub={`${c.case_number} · ${c.subject_type || 'Individual'} · ${c.nationality || '—'}`}
        actions={
          <>
            {polling && <span className="badge badge-blue" style={{ animation: 'pulse 2s infinite' }}>● Investigating</span>}
            <StatusBadge status={c.status} />
            {c.status === 'review' && (
              <button className="btn btn-primary" onClick={() => navigate('/review')}>
                Review Queue →
              </button>
            )}
          </>
        }
      />

      <div style={{ padding: 24 }}>

        {/* Summary Row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 20, marginBottom: 20, alignItems: 'start' }}>
          {/* Risk gauge */}
          <div className="card" style={{ minWidth: 180, textAlign: 'center' }}>
            <span className="card-title">Risk Score</span>
            <RiskRing score={c.risk_score} />
          </div>

          {/* Subject info */}
          <div className="card">
            <span className="card-title">Subject Profile</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px', fontSize: 13 }}>
              {[
                ['Subject Type',   c.subject_type  || '—'],
                ['Nationality',    c.nationality   || '—'],
                ['Date of Birth',  c.date_of_birth || '—'],
                ['Case Number',    c.case_number],
                ['Status',         c.status],
                ['Created',        formatDateTime(c.created_at)],
              ].map(([label, value]) => (
                <div key={label}>
                  <div style={{ fontSize: 10, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', marginBottom: 1 }}>{label}</div>
                  <div style={{ color: '#1e2a3a', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{String(value)}</div>
                </div>
              ))}
            </div>
            {c.notes && (
              <div style={{ marginTop: 12, padding: '8px 10px', background: '#eef1f8', borderRadius: 6, fontSize: 12, color: '#5a6a84', fontStyle: 'italic' }}>
                {c.notes}
              </div>
            )}
          </div>

          {/* Flags + Review status */}
          <div style={{ minWidth: 220 }}>
            <div className="card" style={{ marginBottom: 10 }}>
              <span className="card-title">Risk Flags</span>
              {agents?.flatMap(a => a.flags || []).length > 0 ? (
                <FlagTags flags={[...new Set(agents.flatMap(a => a.flags || []))]} />
              ) : (
                <span style={{ fontSize: 12, color: '#96a3bb', fontStyle: 'italic' }}>No flags</span>
              )}
            </div>

            {latestReview && (
              <div className="card">
                <span className="card-title">Last Review</span>
                <div style={{ fontSize: 12, color: '#5a6a84', marginBottom: 6 }}>
                  {latestReview.reviewer_name} · {formatDateTime(latestReview.reviewed_at)}
                </div>
                <span className={`badge ${
                  latestReview.decision === 'approved' ? 'badge-green' :
                  latestReview.decision === 'rejected' ? 'badge-red' : 'badge-amber'
                }`}>
                  {latestReview.decision.replace(/_/g, ' ').toUpperCase()}
                </span>
                {latestReview.comments && (
                  <div style={{ marginTop: 8, fontSize: 11, color: '#5a6a84', fontStyle: 'italic' }}>
                    "{latestReview.comments}"
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Identity Discrepancy Banner — shown when name/DOB mismatch needs officer action */}
        <IdentityDiscrepancyBanner
          caseId={c.id}
          agents={agents || []}
          caseData={c}
          onResolved={fetchDetail}
        />

        {/* Investigation Plan */}
        <div style={{ marginBottom: 16 }}>
          <InvestigationPlanCard
            plan={c.investigation_plan as any}
            loading={isInvestigating && !c.investigation_plan}
          />
        </div>

        {/* Document Extraction — prominent section */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <SectionHeader
              title="Document Extraction Results"
              badge={<span className="badge badge-green">{documents?.length || 0} doc(s)</span>}
            />
          </div>
          {documents?.length > 0 ? (
            <DocumentExtractionPanel documents={documents} />
          ) : (
            <div style={{
              padding: '20px', textAlign: 'center',
              border: '2px dashed #d1d9ee', borderRadius: 10,
              background: '#f8f9fd', marginBottom: 16,
            }}>
              <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>📄</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: '#5a6a84', marginBottom: 4 }}>No documents uploaded yet</div>
              <div style={{ fontSize: 12, color: '#96a3bb' }}>Upload an ID document to extract fields</div>
            </div>
          )}
          {/* Attach additional document */}
          <div style={{ borderTop: '1px solid #e4e9f4', paddingTop: 14, marginTop: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#1e2a3a', marginBottom: 10 }}>
              {documents?.length ? 'Attach Another Document' : 'Upload Identity Document'}
            </div>
            <DocumentUpload caseId={c.id} onUploaded={() => fetchDetail()} />
          </div>
        </div>

        {/* Two column: agents + verification */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <AgentTimeline agents={agents || []} loading={isInvestigating} plan={c.investigation_plan as any} />
          <VerificationResultPanel sources={verification_sources || []} />
        </div>

        {/* Two column: findings + log */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <AgentFindingsPanel agents={agents || []} />
          <LiveLog events={events || []} />
        </div>

        {/* Route to review CTA */}
        {c.status === 'review' && (
          <div className="card" style={{ border: '1px solid #fde68a', background: 'linear-gradient(135deg, #fef9c320, #ffffff)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#1e2a3a', marginBottom: 4 }}>
                  Investigation Complete — Pending Human Review
                </div>
                <div style={{ fontSize: 12, color: '#5a6a84' }}>
                  Risk score: <span style={{ color: '#f59e0b', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>{Math.round(c.risk_score)}</span>
                  {' '}· {(agents || []).length} agents completed
                </div>
              </div>
              <button
                className="btn btn-primary"
                style={{ padding: '10px 20px' }}
                onClick={() => navigate('/review')}
              >
                Open Review Queue →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
