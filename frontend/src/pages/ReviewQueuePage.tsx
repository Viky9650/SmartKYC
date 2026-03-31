import { useState, useEffect } from 'react'
import { casesApi, reviewsApi } from '../services/api'
import { PageTopbar, EmptyState, RiskRing, StatusBadge } from '../components/shared/UI'
import ReviewPanel from '../components/review/ReviewPanel'
import { riskColor, formatDateTime } from '../utils'
import type { CaseDetail } from '../types'

type SortMode = 'date' | 'risk'

export default function ReviewQueuePage() {
  const [queue, setQueue]           = useState<any[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail]         = useState<CaseDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loading, setLoading]       = useState(true)
  const [sort, setSort]             = useState<SortMode>('date')

  async function loadQueue(sortMode: SortMode = sort) {
    try {
      const q = await reviewsApi.getQueue(sortMode)
      setQueue(q)
      if (q.length > 0 && !selectedId) {
        selectCase(q[0].id)
      }
    } finally {
      setLoading(false)
    }
  }

  async function selectCase(id: string) {
    setSelectedId(id)
    setLoadingDetail(true)
    try {
      const d = await casesApi.get(id)
      setDetail(d)
    } finally {
      setLoadingDetail(false)
    }
  }

  useEffect(() => { loadQueue(sort) }, [sort])

  function handleDecision() {
    setTimeout(() => {
      loadQueue(sort)
      setSelectedId(null)
      setDetail(null)
    }, 1500)
  }

  function toggleSort() {
    setSort(s => s === 'date' ? 'risk' : 'date')
  }

  return (
    <div>
      <PageTopbar
        title="Human Review Queue"
        sub="Cases requiring compliance officer decision"
        actions={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="badge badge-amber">{queue.length} Pending</span>
            {/* Sort toggle */}
            <button
              onClick={toggleSort}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 12px',
                background: '#ffffff',
                border: '1px solid #e4e9f4',
                borderRadius: 8,
                fontSize: 11, fontWeight: 600,
                color: '#5a6a84',
                cursor: 'pointer',
                fontFamily: 'JetBrains Mono, monospace',
                transition: 'all 0.15s',
              }}
            >
              {sort === 'date' ? (
                <><span>↓</span> Newest first</>
              ) : (
                <><span>↓</span> Highest risk first</>
              )}
            </button>
          </div>
        }
      />

      <div style={{ display: 'flex', height: 'calc(100vh - 65px)', overflow: 'hidden' }}>

        {/* Queue list */}
        <div style={{
          width: 320,
          borderRight: '1px solid #e4e9f4',
          overflowY: 'auto',
          background: '#ffffff',
          flexShrink: 0,
        }}>
          {/* Sort label */}
          <div style={{
            padding: '8px 16px',
            borderBottom: '1px solid #e4e9f4',
            fontSize: 10, fontWeight: 600,
            color: '#96a3bb',
            fontFamily: 'JetBrains Mono, monospace',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span>{sort === 'date' ? 'Sorted by date — newest first' : 'Sorted by risk score'}</span>
          </div>

          {loading ? (
            <div style={{ padding: 20, color: '#96a3bb', fontSize: 13 }}>Loading queue...</div>
          ) : queue.length === 0 ? (
            <div style={{ padding: 20 }}>
              <EmptyState icon="✅" title="Queue empty" sub="All cases have been reviewed" />
            </div>
          ) : (
            <div style={{ padding: 12 }}>
              {queue.map((c, idx) => (
                <QueueItem
                  key={c.id}
                  case_={c}
                  rank={idx + 1}
                  sort={sort}
                  selected={selectedId === c.id}
                  onClick={() => selectCase(c.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {loadingDetail ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#96a3bb' }}>Loading case...</div>
          ) : detail ? (
            <ReviewPanel caseDetail={detail} onDecision={handleDecision} />
          ) : queue.length > 0 ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <EmptyState icon="👈" title="Select a case" sub="Choose a case from the queue to review" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function QueueItem({
  case_: c, rank, sort, selected, onClick,
}: {
  case_: any; rank: number; sort: SortMode; selected: boolean; onClick: () => void
}) {
  const color = riskColor(c.risk_score)

  // Format relative time
  function relativeTime(iso: string): string {
    if (!iso) return ''
    const diff = Date.now() - new Date(iso).getTime()
    const mins  = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days  = Math.floor(diff / 86400000)
    if (mins < 60)  return `${mins}m ago`
    if (hours < 24) return `${hours}h ago`
    return `${days}d ago`
  }

  return (
    <div
      onClick={onClick}
      style={{
        padding: '12px 14px',
        borderRadius: 8,
        border: `1px solid ${selected ? '#4a7fe8' : '#e4e9f4'}`,
        background: selected ? '#dce8fc44' : 'transparent',
        cursor: 'pointer',
        marginBottom: 8,
        transition: 'all 0.15s',
        position: 'relative',
      }}
    >
      {/* Rank badge */}
      <div style={{
        position: 'absolute', top: 8, right: 8,
        fontSize: 9, fontWeight: 700,
        fontFamily: 'JetBrains Mono, monospace',
        color: '#d1d9ee',
      }}>#{rank}</div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, paddingRight: 20 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#1e2a3a' }}>{c.subject_name}</span>
        <span style={{ fontSize: 17, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color }}>
          {Math.round(c.risk_score)}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace' }}>{c.case_number}</span>
        <span style={{ color: '#e4e9f4' }}>·</span>
        <span style={{ fontSize: 11, color: '#5a6a84' }}>{c.subject_type}</span>
        {c.nationality && (
          <>
            <span style={{ color: '#e4e9f4' }}>·</span>
            <span style={{ fontSize: 11, color: '#5a6a84' }}>{c.nationality}</span>
          </>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <StatusBadge status={c.status} />
        {/* Show date prominently when sorting by date, risk bar when sorting by risk */}
        {sort === 'date' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#5a6a84', fontFamily: 'JetBrains Mono, monospace' }}>
              {relativeTime(c.created_at)}
            </span>
            <span style={{ fontSize: 9, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace' }}>
              {formatDateTime(c.created_at)}
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
            <div style={{ width: 60, height: 4, background: '#f0f3fa', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                width: `${c.risk_score}%`, height: '100%', borderRadius: 2,
                background: color, transition: 'width 0.4s',
              }} />
            </div>
            <span style={{ fontSize: 9, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace' }}>
              {formatDateTime(c.created_at)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
