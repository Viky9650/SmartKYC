import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { casesApi, reviewsApi } from '../services/api'
import { MetricCard, StatusBadge, RiskBadge, PageTopbar, EmptyState, FlagTags, Spinner } from '../components/shared/UI'
import { riskColor, formatDateTime } from '../utils'
import type { Case } from '../types'

// ─── Types ────────────────────────────────────────────────────────────────────
interface KeyField { label: string; value: string; confidence: number }

interface ExtractionSummary {
  document_type: string
  country: string
  issuer: string
  full_name: string
  date_of_birth: string
  nationality: string
  document_number: string
  date_of_expiry: string
  sex: string
  overall_confidence: number
  extraction_method: string
  key_fields: KeyField[]
}

interface DashboardCase extends Case {
  document_extraction: ExtractionSummary | null
  agent_count: number
  top_flags: string[]
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const navigate = useNavigate()
  const [rows, setRows]           = useState<DashboardCase[]>([])
  const [cases, setCases]         = useState<Case[]>([])
  const [queueCount, setQueueCount] = useState(0)
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<DashboardCase | null>(null)
  const [caseDetail, setCaseDetail] = useState<any | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  async function loadDetail(id: string) {
    setDetailLoading(true)
    try {
      const d = await casesApi.get(id)
      setCaseDetail(d)
    } catch { setCaseDetail(null) }
    finally { setDetailLoading(false) }
  }

  // Expose a refresh function so child components can trigger immediate reload
  async function refresh() {
    try {
      const [summary, allCases, queue] = await Promise.all([
        casesApi.dashboardSummary(12).catch(() => [] as any[]),
        casesApi.list().catch(() => [] as any[]),
        reviewsApi.getQueue().catch(() => [] as any[]),
      ])
      setRows(summary)
      setCases(allCases)
      setQueueCount(queue.length)
      setSelected((prev: any) => prev ?? (summary.length > 0 ? summary[0] : null))
      setLoading(false)
    } catch { setLoading(false) }
  }

  useEffect(() => {
    refresh()
    const iv = setInterval(refresh, 8000)   // poll every 8s
    return () => clearInterval(iv)
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const highRisk     = cases.filter(c => c.risk_score >= 60).length
  const clearedCount = cases.filter(c => c.status === 'cleared').length
  const withDocs     = rows.filter(r => r.document_extraction).length

  return (
    <div>
      <PageTopbar
        title="Investigation Dashboard"
        sub={`${cases.length} total cases · ${withDocs} with extracted documents`}
        actions={
          <>
            <span className="badge badge-green">● System Online</span>
            <button className="btn btn-primary" onClick={() => navigate('/cases/new')}>+ New Case</button>
          </>
        }
      />

      <div style={{ padding: 24 }}>
        {/* ── Metric row ───────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 24 }}>
          <MetricCard label="Total Cases"     value={cases.length}  sub="All time"          color="#3b82f6" />
          <MetricCard label="Pending Review"  value={queueCount}    sub="Requires attention" color="#f59e0b" />
          <MetricCard label="High Risk"       value={highRisk}      sub="Score ≥ 60"         color="#ef4444" />
          <MetricCard label="Docs Extracted"  value={withDocs}      sub="With ID extraction" color="#10b981" />
        </div>

        {/* ── Main split ───────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16, marginBottom: 16 }}>

          {/* Left: case list with inline extraction preview */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid #e4e9f4' }}>
              <span className="card-title" style={{ marginBottom: 0 }}>Recent Cases</span>
              <button className="btn btn-ghost" style={{ fontSize: 11 }} onClick={() => navigate('/cases')}>View all →</button>
            </div>

            {loading ? (
              <div style={{ padding: 24, display: 'flex', gap: 8, alignItems: 'center', color: '#96a3bb' }}>
                <Spinner /> Loading...
              </div>
            ) : rows.length === 0 ? (
              <div style={{ padding: 20 }}>
                <EmptyState icon="📋" title="No cases yet" sub="Create your first investigation" />
              </div>
            ) : (
              rows.map(row => (
                <CaseListRow
                  key={row.id}
                  row={row}
                  selected={selected?.id === row.id}
                  onClick={() => { setSelected(row); loadDetail(row.id); navigate(`/cases/${row.id}`) }}
                  onHover={() => { setSelected(row); if (selected?.id !== row.id) loadDetail(row.id) }}
                />
              ))
            )}
          </div>

          {/* Right: extraction detail panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {selected ? (
              <ExtractionDetailCard row={selected} onOpen={() => navigate(`/cases/${selected.id}`)} />
            ) : (
              <div className="card" style={{ textAlign: 'center', padding: 40 }}>
                <EmptyState icon="🪪" title="Select a case" sub="Hover over a case to preview extraction" />
              </div>
            )}

            {/* Risk distribution */}
            <div className="card">
              <span className="card-title">Risk Distribution</span>
              <RiskDistribution cases={cases} />
            </div>
          </div>
        </div>

        {/* ── Status breakdown ─────────────────────────────────────────── */}
        <div className="card">
          <span className="card-title">Case Status Overview</span>
          <StatusBreakdown cases={cases} onNavigate={s => navigate(`/cases?status=${s}`)} />
        </div>
      </div>
    </div>
  )
}

// ─── Case list row with compact extraction preview ─────────────────────────
function CaseListRow({
  row, selected, onClick, onHover,
}: { row: DashboardCase; selected: boolean; onClick: () => void; onHover: () => void }) {
  const ext = row.document_extraction
  const scoreColor = riskColor(row.risk_score)

  return (
    <div
      onClick={onClick}
      onMouseEnter={onHover}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 12,
        padding: '12px 16px',
        borderBottom: '1px solid #e4e9f4',
        cursor: 'pointer',
        background: selected ? '#dce8fc44' : 'transparent',
        borderLeft: `3px solid ${selected ? '#4a7fe8' : 'transparent'}`,
        transition: 'all 0.12s',
      }}
    >
      {/* Left: subject + doc info */}
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          {/* Document type icon */}
          <span style={{ fontSize: 14, flexShrink: 0 }}>
            {!ext ? '👤' :
              ext.document_type?.includes('Passport') ? '🛂' :
              ext.document_type?.includes('Aadhaar') ? '🆔' :
              ext.document_type?.includes('PAN') ? '💳' :
              ext.document_type?.includes('Company') ? '🏢' :
              ext.document_type?.includes('Driving') ? '🚗' : '📄'}
          </span>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#1e2a3a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ext?.full_name || row.subject_name}
          </span>
          {ext?.full_name && ext.full_name !== row.subject_name && (
            <span style={{ fontSize: 11, color: '#96a3bb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              ({row.subject_name})
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace' }}>{row.case_number}</span>

          {ext ? (
            <>
              <span style={{ fontSize: 10, color: '#5a6a84' }}>{ext.document_type}</span>
              {ext.country && <span style={{ fontSize: 10, color: '#5a6a84' }}>· {ext.country}</span>}
              {ext.document_number && (
                <span style={{ fontSize: 10, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace' }}>
                  #{ext.document_number}
                </span>
              )}
              {ext.date_of_birth && (
                <span style={{ fontSize: 10, color: '#96a3bb' }}>DOB: {ext.date_of_birth}</span>
              )}
              {/* confidence pill */}
              <span style={{
                fontSize: 9,
                padding: '1px 5px',
                borderRadius: 3,
                background: ext.overall_confidence >= 0.9 ? '#dcfce7' : '#fef9c3',
                color: ext.overall_confidence >= 0.9 ? '#22c55e' : '#f59e0b',
                fontFamily: 'JetBrains Mono, monospace',
                border: `1px solid ${ext.overall_confidence >= 0.9 ? '#22c55e' : '#f59e0b'}44`,
              }}>
                {Math.round(ext.overall_confidence * 100)}% conf
              </span>
            </>
          ) : (
            <span style={{ fontSize: 10, color: '#d1d9ee', fontStyle: 'italic' }}>No document</span>
          )}
        </div>

        {row.top_flags.length > 0 && (
          <div style={{ marginTop: 4, display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {row.top_flags.slice(0, 3).map(f => (
              <span key={f} style={{
                fontSize: 9, padding: '1px 5px', borderRadius: 3,
                background: '#fee2e2', color: '#ef4444',
                border: '1px solid #fecaca', fontFamily: 'JetBrains Mono, monospace',
              }}>⚠ {f.replace(/_/g, ' ')}</span>
            ))}
          </div>
        )}
      </div>

      {/* Right: score + status */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        <span style={{ fontSize: 18, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: scoreColor, lineHeight: 1 }}>
          {Math.round(row.risk_score)}
        </span>
        <StatusBadge status={row.status} />
        <span style={{ fontSize: 10, color: '#d1d9ee', fontFamily: 'JetBrains Mono, monospace' }}>
          {formatDateTime(row.created_at).split(',')[0]}
        </span>
      </div>
    </div>
  )
}

// ─── Extraction Detail Panel (right column) ───────────────────────────────
function ExtractionDetailCard({ row, onOpen }: { row: DashboardCase; onOpen: () => void }) {
  const ext = row.document_extraction
  const scoreColor = riskColor(row.risk_score)

  return (
    <div className="card animate-fade-in" style={{ padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px',
        borderBottom: '1px solid #e4e9f4',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1e2a3a' }}>{ext?.full_name || row.subject_name}</div>
          <div style={{ fontSize: 10, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace', marginTop: 1 }}>{row.case_number}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <span style={{ fontSize: 22, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: scoreColor }}>
            {Math.round(row.risk_score)}
          </span>
          <StatusBadge status={row.status} />
        </div>
      </div>

      {/* Flags */}
      {row.top_flags.length > 0 && (
        <div style={{ padding: '8px 14px', borderBottom: '1px solid #e4e9f4', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {row.top_flags.map(f => (
            <span key={f} className="flag-tag" style={{ fontSize: 10 }}>⚠ {f.replace(/_/g, ' ')}</span>
          ))}
        </div>
      )}

      {/* Extraction data */}
      {ext ? (
        <div style={{ padding: '12px 14px' }}>
          {/* Doc type + confidence */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            <span className="badge badge-blue">{ext.document_type}</span>
            {ext.country && <span className="badge badge-gray">{ext.country}</span>}
            {ext.issuer && <span className="badge badge-gray" style={{ fontSize: 9 }}>{ext.issuer}</span>}
            <span className={`badge ${ext.overall_confidence >= 0.9 ? 'badge-green' : 'badge-amber'}`}>
              {Math.round(ext.overall_confidence * 100)}% confidence
            </span>
          </div>

          {/* Extracted fields */}
          <div style={{ fontSize: 10, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
            Extracted Fields
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px' }}>
            {ext.key_fields.map(field => (
              <FieldCell key={field.label} field={field} />
            ))}
          </div>

          {/* Extraction method */}
          {ext.extraction_method && (
            <div style={{ marginTop: 10, fontSize: 10, color: '#d1d9ee', fontFamily: 'JetBrains Mono, monospace' }}>
              method: {ext.extraction_method}
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: '20px 14px', textAlign: 'center' }}>
          <div style={{ fontSize: 24, marginBottom: 8, opacity: 0.3 }}>📄</div>
          <div style={{ fontSize: 12, color: '#96a3bb' }}>No document uploaded</div>
          <div style={{ fontSize: 11, color: '#d1d9ee', marginTop: 2 }}>Upload an ID document to see extraction</div>
        </div>
      )}

      {/* Open button */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid #e4e9f4' }}>
        <button
          className="btn btn-primary"
          style={{ width: '100%', justifyContent: 'center', fontSize: 12 }}
          onClick={onOpen}
        >
          Open Case →
        </button>
      </div>
    </div>
  )
}

function FieldCell({ field }: { field: KeyField }) {
  const conf = field.confidence
  const confColor = conf >= 0.9 ? '#22c55e' : conf >= 0.7 ? '#f59e0b' : '#ef4444'
  return (
    <div>
      <div style={{ fontSize: 9, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', marginBottom: 2 }}>
        {field.label}
      </div>
      <div style={{ fontSize: 12, color: '#1e2a3a', fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all', marginBottom: 2 }}>
        {field.value}
      </div>
      {/* Confidence micro-bar */}
      {conf > 0 && (
        <div style={{ height: 2, background: '#f0f3fa', borderRadius: 1, overflow: 'hidden' }}>
          <div style={{ width: `${conf * 100}%`, height: '100%', background: confColor, transition: 'width 0.4s' }} />
        </div>
      )}
    </div>
  )
}

// ─── Risk Distribution ────────────────────────────────────────────────────────
function RiskDistribution({ cases }: { cases: Case[] }) {
  const buckets = [
    { label: 'Critical (80–100)', min: 80, max: 100, color: '#991b1b' },
    { label: 'High (60–79)',      min: 60, max: 79,  color: '#ef4444' },
    { label: 'Medium (40–59)',    min: 40, max: 59,  color: '#f59e0b' },
    { label: 'Low (0–39)',        min: 0,  max: 39,  color: '#22c55e' },
  ]
  const total = cases.length || 1
  return (
    <div>
      {buckets.map(b => {
        const count = cases.filter(c => c.risk_score >= b.min && c.risk_score <= b.max).length
        const pct = (count / total) * 100
        return (
          <div key={b.label} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: '#5a6a84' }}>{b.label}</span>
              <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: b.color }}>{count}</span>
            </div>
            <div style={{ height: 5, background: '#f0f3fa', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: b.color, borderRadius: 3, transition: 'width 0.8s ease' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Status Breakdown ─────────────────────────────────────────────────────────
function StatusBreakdown({ cases, onNavigate }: { cases: Case[]; onNavigate: (s: string) => void }) {
  const statuses = ['pending','investigating','review','cleared','rejected','on_hold','escalated']
  const colors: Record<string,string> = {
    pending:'#4a7fe8', investigating:'#8b5cf6', review:'#f59e0b',
    cleared:'#22c55e', rejected:'#ef4444', on_hold:'#f97316', escalated:'#7c3aed',
  }
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {statuses.map(s => {
        const count = cases.filter(c => c.status === s).length
        return (
          <div key={s} onClick={() => onNavigate(s)} style={{
            padding: '10px 18px', background: '#eef1f8',
            border: `1px solid ${count > 0 ? colors[s]+'44' : '#e4e9f4'}`,
            borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
            minWidth: 90, textAlign: 'center',
          }}>
            <div style={{
              fontSize: 26, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
              color: count > 0 ? colors[s] : '#d1d9ee', lineHeight: 1, marginBottom: 3,
            }}>{count}</div>
            <div style={{ fontSize: 10, color: count > 0 ? '#5a6a84' : '#d1d9ee', textTransform: 'capitalize' }}>
              {s.replace(/_/g, ' ')}
            </div>
          </div>
        )
      })}
    </div>
  )
}
