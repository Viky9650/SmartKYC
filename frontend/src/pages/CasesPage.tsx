import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { casesApi } from '../services/api'
import { PageTopbar, StatusBadge, RiskBadge, EmptyState } from '../components/shared/UI'
import { formatDateTime } from '../utils'
import type { Case } from '../types'

const STATUS_FILTERS = ['all', 'pending', 'investigating', 'review', 'cleared', 'rejected', 'on_hold']

export default function CasesPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [cases, setCases] = useState<Case[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState(searchParams.get('status') || 'all')

  useEffect(() => {
    casesApi.list()
      .then(setCases)
      .finally(() => setLoading(false))
  }, [])

  const filtered = cases.filter(c => {
    const matchSearch = !search ||
      c.subject_name.toLowerCase().includes(search.toLowerCase()) ||
      c.case_number.toLowerCase().includes(search.toLowerCase()) ||
      (c.nationality || '').toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'all' || c.status === statusFilter
    return matchSearch && matchStatus
  })

  return (
    <div>
      <PageTopbar
        title="All Cases"
        sub={`${filtered.length} cases shown`}
        actions={
          <button className="btn btn-primary" onClick={() => navigate('/cases/new')}>
            + New Case
          </button>
        }
      />

      <div style={{ padding: 24 }}>
        {/* Filters */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ maxWidth: 260 }}
            placeholder="Search by name, case ID, nationality..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 4 }}>
            {STATUS_FILTERS.map(s => (
              <button
                key={s}
                className={`btn ${statusFilter === s ? 'btn-primary' : ''}`}
                style={{ fontSize: 11, textTransform: 'capitalize' }}
                onClick={() => setStatusFilter(s)}
              >
                {s === 'all' ? 'All' : s.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#96a3bb' }}>Loading...</div>
          ) : filtered.length === 0 ? (
            <EmptyState icon="📋" title="No cases found" sub={search ? 'Try a different search term' : 'Create your first case'} />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e4e9f4' }}>
                  {['Case ID', 'Subject', 'Type', 'Nationality', 'Risk', 'Status', 'Flags', 'Created', ''].map(h => (
                    <th key={h} style={{
                      textAlign: 'left',
                      fontSize: 10,
                      color: '#96a3bb',
                      fontFamily: 'JetBrains Mono, monospace',
                      textTransform: 'uppercase',
                      padding: '10px 14px',
                      background: '#ffffff',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <CaseRow key={c.id} case_={c} onClick={() => navigate(`/cases/${c.id}`)} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function CaseRow({ case_: c, onClick }: { case_: Case; onClick: () => void }) {
  return (
    <tr
      className="table-row"
      style={{ cursor: 'pointer' }}
      onClick={onClick}
    >
      <td style={{ padding: '10px 14px', fontSize: 11, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
        {c.case_number}
      </td>
      <td style={{ padding: '10px 14px', fontWeight: 500, fontSize: 14, color: '#1e2a3a' }}>
        {c.subject_name}
      </td>
      <td style={{ padding: '10px 14px', fontSize: 12, color: '#5a6a84' }}>
        {c.subject_type || '—'}
      </td>
      <td style={{ padding: '10px 14px', fontSize: 12, color: '#5a6a84' }}>
        {c.nationality || '—'}
      </td>
      <td style={{ padding: '10px 14px' }}>
        <RiskBadge score={c.risk_score} />
      </td>
      <td style={{ padding: '10px 14px' }}>
        <StatusBadge status={c.status} />
      </td>
      <td style={{ padding: '10px 14px' }}>
        {c.risk_level === 'high' || c.risk_level === 'critical' ? (
          <span className="badge badge-red">{c.risk_level.toUpperCase()}</span>
        ) : c.risk_level === 'medium' ? (
          <span className="badge badge-amber">MEDIUM</span>
        ) : (
          <span style={{ color: '#96a3bb', fontSize: 11 }}>—</span>
        )}
      </td>
      <td style={{ padding: '10px 14px', fontSize: 11, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
        {formatDateTime(c.created_at)}
      </td>
      <td style={{ padding: '10px 14px' }}>
        <button className="btn btn-ghost" style={{ fontSize: 11 }}>View →</button>
      </td>
    </tr>
  )
}
