/**
 * ReviewPanel.tsx
 * Full human review panel — shown in ReviewQueuePage and embedded in CaseDetailPage.
 * Displays risk summary, all agent findings, field mismatches, and the decision form.
 */

import { useState } from 'react'
import { reviewsApi } from '../../services/api'
import { RiskRing, StatusBadge, FlagTags } from '../shared/UI'
import { riskColor, formatDateTime } from '../../utils'
import type { CaseDetail } from '../../types'

// ─── Decisions ────────────────────────────────────────────────────────────────

const DECISIONS = [
  {
    value: 'approved',
    label: 'Approve',
    icon: '✓',
    description: 'Subject passed all checks. Proceed with onboarding.',
    bg: '#E1F5EE', color: '#085041', border: '#1D9E75',
  },
  {
    value: 'rejected',
    label: 'Reject',
    icon: '✕',
    description: 'Subject failed KYC/AML checks. Do not onboard.',
    bg: '#FCEBEB', color: '#501313', border: '#E24B4A',
  },
  {
    value: 'request_documents',
    label: 'Request Docs',
    icon: '📄',
    description: 'More identity documents needed before decision.',
    bg: '#E6F1FB', color: '#042C53', border: '#378ADD',
  },
  {
    value: 'on_hold',
    label: 'Hold',
    icon: '⏸',
    description: 'Pending further investigation or third-party check.',
    bg: '#FAEEDA', color: '#412402', border: '#BA7517',
  },
  {
    value: 'escalated',
    label: 'Escalate',
    icon: '↑',
    description: 'Escalate to senior compliance officer or MLRO.',
    bg: '#EEEDFE', color: '#26215C', border: '#7F77DD',
  },
]

const FLAG_SEVERITY: Record<string, 'high' | 'medium' | 'low'> = {
  sanctions_match:             'high',
  pep_confirmed:               'high',
  dob_mismatch:                'high',
  document_expired:            'high',
  name_mismatch:               'high',
  identity_verification_failed:'high',
  invalid_document_number:     'high',
  adverse_media:               'medium',
  high_risk_jurisdiction:      'medium',
  sanctions_partial_match:     'medium',
  pep_family_connections:      'medium',
  nationality_mismatch:        'medium',
  registry_mismatch:           'medium',
  nominee_director:            'medium',
  undisclosed_beneficial_owner:'medium',
  high_value_transactions:     'medium',
  cross_border_transfers:      'low',
  gender_mismatch:             'low',
}

const SEVERITY_COLORS = {
  high:   { bg: '#FCEBEB', color: '#A32D2D', border: '#F7C1C1' },
  medium: { bg: '#FAEEDA', color: '#633806', border: '#FAC775' },
  low:    { bg: '#E6F1FB', color: '#0C447C', border: '#B5D4F4' },
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ReviewPanel({
  caseDetail,
  onDecision,
  compact = false,
}: {
  caseDetail: CaseDetail
  onDecision: (decision: string) => void
  compact?: boolean
}) {
  const [selected, setSelected]   = useState<string | null>(null)
  const [comments, setComments]   = useState('')
  const [riskOverride, setRiskOverride] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted]  = useState(false)
  const [error, setError]          = useState('')

  const { case: c, agents = [], verification_sources = [], documents = [], reviews = [] } = caseDetail

  // Collect all unique flags across agents
  const allFlags = [...new Set(agents.flatMap(a => a.flags || []))]
  const highFlags   = allFlags.filter(f => FLAG_SEVERITY[f] === 'high')
  const mediumFlags = allFlags.filter(f => FLAG_SEVERITY[f] === 'medium')
  const lowFlags    = allFlags.filter(f => FLAG_SEVERITY[f] === 'low' || !FLAG_SEVERITY[f])

  // All field mismatches from identity agent
  const identityAgent = agents.find(a => a.agent_name === 'identity_agent')
  const fieldMismatches = identityAgent?.evidence?._field_mismatches || {}

  async function handleSubmit() {
    if (!selected) { setError('Please select a decision'); return }
    setError('')
    setSubmitting(true)
    try {
      await reviewsApi.submit({
        case_id: c.id,
        decision: selected,
        comments: comments.trim() || undefined,
        risk_override: riskOverride ? parseFloat(riskOverride) : undefined,
      })
      setSubmitted(true)
      setTimeout(() => onDecision(selected), 800)
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Submission failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    const dec = DECISIONS.find(d => d.value === selected)
    return (
      <div style={{
        textAlign: 'center', padding: 40,
        background: dec?.bg, borderRadius: 12,
        border: `1px solid ${dec?.border}`,
      }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>{dec?.icon}</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: dec?.color, marginBottom: 6 }}>
          Decision recorded — {dec?.label}
        </div>
        <div style={{ fontSize: 13, color: dec?.color, opacity: 0.7 }}>
          Case {c.case_number} has been {selected?.replace('_', ' ')}.
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Risk summary header ─────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: compact ? '80px 1fr' : '120px 1fr auto',
        gap: 16, alignItems: 'start',
        padding: 16, borderRadius: 10,
        background: c.risk_score >= 60 ? '#FEF2F2' : c.risk_score >= 40 ? '#FFFBEB' : '#F0FDF4',
        border: `1px solid ${riskColor(c.risk_score)}33`,
      }}>
        <div style={{ textAlign: 'center' }}>
          <RiskRing score={c.risk_score} size={compact ? 64 : 90} />
        </div>
        <div>
          <div style={{ fontSize: compact ? 14 : 16, fontWeight: 600, color: '#1e2a3a', marginBottom: 4 }}>
            {c.subject_name}
          </div>
          <div style={{ fontSize: 11, color: '#5a6a84', marginBottom: 8 }}>
            {c.case_number} · {c.subject_type} · {c.nationality || '—'}
          </div>
          {/* Severity-grouped flags */}
          {allFlags.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {highFlags.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {highFlags.map(f => (
                    <FlagChip key={f} flag={f} severity="high" />
                  ))}
                </div>
              )}
              {mediumFlags.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {mediumFlags.map(f => (
                    <FlagChip key={f} flag={f} severity="medium" />
                  ))}
                </div>
              )}
              {lowFlags.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {lowFlags.map(f => (
                    <FlagChip key={f} flag={f} severity="low" />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span style={{ fontSize: 11, color: '#1D9E75' }}>✓ No risk flags raised</span>
          )}
        </div>
        {!compact && (
          <div style={{ textAlign: 'right' }}>
            <StatusBadge status={c.status} />
            <div style={{ fontSize: 10, color: '#96a3bb', marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>
              {formatDateTime(c.created_at)}
            </div>
          </div>
        )}
      </div>

      {/* ── Field mismatches callout ────────────────────────────────────── */}
      {Object.keys(fieldMismatches).length > 0 && (
        <div style={{
          padding: 14, borderRadius: 10,
          background: '#FEF9C3', border: '1px solid #FDE68A',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#92400E', marginBottom: 10 }}>
            ⚠ Identity Field Mismatches Detected
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Object.entries(fieldMismatches).map(([field, detail]: [string, any]) => (
              <div key={field} style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr',
                gap: 8, padding: '8px 10px',
                background: '#FFFBEB', borderRadius: 6,
                border: '1px solid #FDE68A',
              }}>
                <div>
                  <div style={{ fontSize: 9, color: '#B45309', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', marginBottom: 2 }}>
                    {field.replace(/_/g, ' ')} — Document
                  </div>
                  <div style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: '#1e2a3a', fontWeight: 600 }}>
                    {detail.document_value || '—'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: '#B45309', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', marginBottom: 2 }}>
                    {field.replace(/_/g, ' ')} — Authority Record
                  </div>
                  <div style={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: '#1e2a3a', fontWeight: 600 }}>
                    {detail.authority_value || '—'}
                  </div>
                </div>
                {detail.note && (
                  <div style={{ gridColumn: '1/-1', fontSize: 10, color: '#92400E', fontStyle: 'italic' }}>
                    {detail.note}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Agent summary strip ─────────────────────────────────────────── */}
      {agents.filter(a => a.agent_name !== 'risk_aggregation_agent').length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {agents
            .filter(a => a.agent_name !== 'risk_aggregation_agent')
            .map(agent => {
              const hasFlags = agent.flags?.length > 0
              return (
                <div key={agent.id} style={{
                  padding: '6px 10px', borderRadius: 6,
                  background: hasFlags ? '#FEF2F2' : '#F0FDF4',
                  border: `1px solid ${hasFlags ? '#FCA5A5' : '#86EFAC'}`,
                  fontSize: 11,
                }}>
                  <span style={{ fontWeight: 600, color: hasFlags ? '#991B1B' : '#166534' }}>
                    {hasFlags ? '⚑' : '✓'}{' '}
                    {agent.agent_name.replace(/_agent/g, '').replace(/_/g, ' ')
                      .replace(/\b\w/g, (c: string) => c.toUpperCase())}
                  </span>
                  <span style={{
                    marginLeft: 6, fontFamily: 'JetBrains Mono, monospace',
                    color: riskColor(agent.risk_score), fontWeight: 700,
                  }}>{Math.round(agent.risk_score)}</span>
                </div>
              )
            })}
        </div>
      )}

      {/* ── Previous reviews ────────────────────────────────────────────── */}
      {reviews.length > 0 && (
        <div style={{
          padding: '10px 14px', borderRadius: 8,
          background: '#f8f9fd', border: '1px solid #e4e9f4',
        }}>
          <div style={{ fontSize: 11, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', marginBottom: 8 }}>
            Previous Reviews
          </div>
          {reviews.map((r: any) => (
            <div key={r.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              marginBottom: 6, paddingBottom: 6,
              borderBottom: '1px solid #f0f3fa',
            }}>
              <span style={{
                fontSize: 10, padding: '2px 7px', borderRadius: 4, fontWeight: 600,
                background: r.decision === 'approved' ? '#E1F5EE' :
                            r.decision === 'rejected' ? '#FCEBEB' : '#FAEEDA',
                color: r.decision === 'approved' ? '#085041' :
                       r.decision === 'rejected' ? '#501313' : '#412402',
              }}>{r.decision.replace(/_/g, ' ').toUpperCase()}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#5a6a84' }}>
                  {r.reviewer_name} · {formatDateTime(r.reviewed_at)}
                </div>
                {r.comments && (
                  <div style={{ fontSize: 11, color: '#1e2a3a', fontStyle: 'italic', marginTop: 2 }}>
                    "{r.comments}"
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Decision form ───────────────────────────────────────────────── */}
      <div style={{
        padding: 16, borderRadius: 10,
        background: '#ffffff', border: '1px solid #e4e9f4',
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1e2a3a', marginBottom: 12 }}>
          Compliance Decision
        </div>

        {/* Decision buttons */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: compact ? 'repeat(3, 1fr)' : 'repeat(5, 1fr)',
          gap: 8, marginBottom: 14,
        }}>
          {DECISIONS.map(d => (
            <button
              key={d.value}
              onClick={() => setSelected(d.value)}
              disabled={submitting}
              title={d.description}
              style={{
                padding: compact ? '8px 6px' : '10px 8px',
                borderRadius: 8,
                border: `1.5px solid ${selected === d.value ? d.border : '#e4e9f4'}`,
                background: selected === d.value ? d.bg : '#f8f9fd',
                cursor: submitting ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: compact ? 16 : 20, marginBottom: 2 }}>{d.icon}</div>
              <div style={{
                fontSize: 10, fontWeight: 700,
                color: selected === d.value ? d.color : '#5a6a84',
              }}>{d.label}</div>
            </button>
          ))}
        </div>

        {/* Description of selected decision */}
        {selected && (
          <div style={{
            fontSize: 11, color: '#5a6a84',
            padding: '6px 10px', background: '#f4f6fb',
            borderRadius: 6, marginBottom: 12,
          }}>
            {DECISIONS.find(d => d.value === selected)?.description}
          </div>
        )}

        {/* Comments */}
        <textarea
          placeholder="Compliance notes… (required for rejection or escalation)"
          value={comments}
          onChange={e => setComments(e.target.value)}
          disabled={submitting}
          rows={compact ? 2 : 3}
          style={{
            width: '100%', marginBottom: 10,
            fontFamily: 'inherit', fontSize: 12,
            resize: 'vertical',
          }}
          className="input"
        />

        {/* Risk override */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: '#5a6a84', flexShrink: 0 }}>
            Override risk score (optional):
          </label>
          <input
            type="number"
            min={0} max={100}
            placeholder={String(Math.round(c.risk_score))}
            value={riskOverride}
            onChange={e => setRiskOverride(e.target.value)}
            disabled={submitting}
            className="input"
            style={{ width: 80, fontSize: 12 }}
          />
          <span style={{ fontSize: 11, color: '#96a3bb' }}>0 – 100</span>
        </div>

        {/* Error */}
        {error && (
          <div style={{
            padding: '8px 12px', marginBottom: 10,
            background: '#fee2e2', border: '1px solid #fecaca',
            borderRadius: 6, fontSize: 12, color: '#b91c1c',
          }}>{error}</div>
        )}

        {/* Validation hint */}
        {selected === 'rejected' && !comments.trim() && (
          <div style={{
            padding: '6px 10px', marginBottom: 10,
            background: '#FAEEDA', border: '1px solid #FAC775',
            borderRadius: 6, fontSize: 11, color: '#633806',
          }}>⚠ Please add a comment explaining the rejection reason.</div>
        )}

        {/* Submit */}
        <button
          className="btn btn-primary"
          style={{
            width: '100%', justifyContent: 'center',
            padding: compact ? '10px' : '12px 20px',
            fontSize: 13, fontWeight: 600,
            opacity: (!selected || submitting) ? 0.6 : 1,
            background: selected
              ? DECISIONS.find(d => d.value === selected)?.border
              : undefined,
          }}
          onClick={handleSubmit}
          disabled={!selected || submitting}
        >
          {submitting ? 'Submitting…' : selected
            ? `Submit — ${DECISIONS.find(d => d.value === selected)?.label}`
            : 'Select a decision above'}
        </button>
      </div>
    </div>
  )
}

// ─── Flag chip ────────────────────────────────────────────────────────────────

function FlagChip({ flag, severity }: { flag: string; severity: 'high' | 'medium' | 'low' }) {
  const sc = SEVERITY_COLORS[severity]
  return (
    <span style={{
      fontSize: 10, padding: '2px 8px', borderRadius: 4,
      background: sc.bg, color: sc.color,
      border: `1px solid ${sc.border}`,
      fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
    }}>
      {severity === 'high' ? '⚑' : severity === 'medium' ? '▲' : '·'}{' '}
      {flag.replace(/_/g, ' ')}
    </span>
  )
}
