import { useState, useEffect } from 'react'
import { casesApi, reviewsApi } from '../services/api'
import { PageTopbar, EmptyState, RiskRing, StatusBadge } from '../components/shared/UI'
import ReviewPanel from '../components/review/ReviewPanel'
import { riskColor, formatDateTime } from '../utils'
import type { CaseDetail } from '../types'

export default function ReviewQueuePage() {
  const [queue, setQueue] = useState<any[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CaseDetail | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loading, setLoading] = useState(true)

  async function loadQueue() {
    try {
      const q = await reviewsApi.getQueue()
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

  useEffect(() => { loadQueue() }, [])

  function handleDecision() {
    // Refresh queue after decision
    setTimeout(() => {
      loadQueue()
      setSelectedId(null)
      setDetail(null)
    }, 1500)
  }

  return (
    <div>
      <PageTopbar
        title="Human Review Queue"
        sub="Cases requiring compliance officer decision"
        actions={
          <span className="badge badge-amber">{queue.length} Pending</span>
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
          {loading ? (
            <div style={{ padding: 20, color: '#96a3bb', fontSize: 13 }}>Loading queue...</div>
          ) : queue.length === 0 ? (
            <div style={{ padding: 20 }}>
              <EmptyState icon="✅" title="Queue empty" sub="All cases have been reviewed" />
            </div>
          ) : (
            <div style={{ padding: 12 }}>
              {queue.map(c => (
                <QueueItem
                  key={c.id}
                  case_={c}
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

function QueueItem({ case_: c, selected, onClick }: { case_: any; selected: boolean; onClick: () => void }) {
  const color = riskColor(c.risk_score)
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
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#1e2a3a' }}>{c.subject_name}</span>
        <span style={{ fontSize: 18, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color }}>
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
        <span style={{ fontSize: 10, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace' }}>
          {formatDateTime(c.created_at)}
        </span>
      </div>
    </div>
  )
}
