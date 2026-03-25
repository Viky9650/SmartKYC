import { useState, useEffect } from 'react'
import { authoritiesApi } from '../services/api'
import { PageTopbar, EmptyState } from '../components/shared/UI'
import { sourceTypeColor } from '../utils'
import type { VerificationAuthority } from '../types'

const TYPE_ORDER = ['sanctions', 'pep', 'identity', 'registry', 'adverse_media']
const TYPE_LABELS: Record<string, string> = {
  sanctions: '🛡 Sanctions Lists',
  pep: '👤 PEP Databases',
  identity: '🪪 Identity Verification',
  registry: '🏢 Corporate Registries',
  adverse_media: '📰 Adverse Media',
}

export default function AuthoritiesPage() {
  const [authorities, setAuthorities] = useState<VerificationAuthority[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    authoritiesApi.list()
      .then(setAuthorities)
      .finally(() => setLoading(false))
  }, [])

  const groups: Record<string, VerificationAuthority[]> = {}
  authorities.forEach(a => {
    if (!groups[a.type]) groups[a.type] = []
    groups[a.type].push(a)
  })

  const mockCount = authorities.filter(a => a.mock_mode).length
  const configuredCount = authorities.filter(a => a.api_configured).length

  return (
    <div>
      <PageTopbar
        title="Verification Authorities"
        sub={`${authorities.length} authorities · ${mockCount > 0 ? `${mockCount} in MOCK mode` : 'All LIVE'}`}
        actions={
          <div style={{ display: 'flex', gap: 6 }}>
            {mockCount > 0 && (
              <span className="badge badge-amber">⚠ Mock Mode Active</span>
            )}
            <span className="badge badge-green">{configuredCount} configured</span>
          </div>
        }
      />

      <div style={{ padding: 24 }}>

        {/* Mock mode banner */}
        {mockCount > 0 && (
          <div style={{
            padding: '14px 18px',
            background: '#fef9c322',
            border: '1px solid #f59e0b',
            borderRadius: 10,
            marginBottom: 20,
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
          }}>
            <span style={{ fontSize: 20 }}>⚠</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#b45309', marginBottom: 4 }}>
                Mock Verification Mode
              </div>
              <div style={{ fontSize: 13, color: '#5a6a84' }}>
                All verification checks are using realistic mock responses. To enable real API calls,
                set <code style={{ fontFamily: 'JetBrains Mono, monospace', background: '#eef1f8', padding: '1px 4px', borderRadius: 3 }}>USE_MOCK_VERIFICATION=false</code> in{' '}
                <code style={{ fontFamily: 'JetBrains Mono, monospace', background: '#eef1f8', padding: '1px 4px', borderRadius: 3 }}>.env</code>{' '}
                and configure the relevant API keys.
              </div>
            </div>
          </div>
        )}

        {/* Type filters */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
          <button
            className={`btn ${filter === 'all' ? 'btn-primary' : ''}`}
            onClick={() => setFilter('all')}
            style={{ fontSize: 11 }}
          >All</button>
          {TYPE_ORDER.map(t => (
            <button
              key={t}
              className={`btn ${filter === t ? 'btn-primary' : ''}`}
              onClick={() => setFilter(t)}
              style={{ fontSize: 11 }}
            >
              {TYPE_LABELS[t]?.split(' ').slice(1).join(' ') || t}
            </button>
          ))}
        </div>

        {/* Authorities by type */}
        {loading ? (
          <div style={{ color: '#96a3bb', fontSize: 13 }}>Loading...</div>
        ) : (
          TYPE_ORDER
            .filter(t => filter === 'all' || filter === t)
            .map(type => (
              <AuthorityGroup
                key={type}
                type={type}
                label={TYPE_LABELS[type] || type}
                authorities={groups[type] || []}
              />
            ))
        )}
      </div>
    </div>
  )
}

function AuthorityGroup({ type, label, authorities }: { type: string; label: string; authorities: VerificationAuthority[] }) {
  if (!authorities.length) return null
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        fontSize: 13,
        fontWeight: 600,
        color: sourceTypeColor(type),
        marginBottom: 12,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        {label}
        <span style={{ fontSize: 11, color: '#96a3bb', fontWeight: 400 }}>
          ({authorities.length})
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
        {authorities.map(a => <AuthorityCard key={a.key} authority={a} />)}
      </div>
    </div>
  )
}

function AuthorityCard({ authority: a }: { authority: VerificationAuthority }) {
  const color = sourceTypeColor(a.type)
  return (
    <div style={{
      background: '#ffffff',
      border: `1px solid ${a.mock_mode ? '#d1d9ee' : '#e4e9f4'}`,
      borderRadius: 10,
      padding: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1e2a3a', marginBottom: 2 }}>{a.name}</div>
          <div style={{ fontSize: 11, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace' }}>
            {a.country}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
          {a.mock_mode
            ? <span className="badge badge-amber">MOCK</span>
            : <span className="badge badge-green">LIVE</span>
          }
          {a.is_free
            ? <span className="badge badge-blue">FREE API</span>
            : <span className="badge badge-gray">PAID</span>
          }
        </div>
      </div>

      <div style={{ fontSize: 12, color: '#5a6a84', marginBottom: 10 }}>{a.description}</div>

      <div style={{ fontSize: 11, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace', marginBottom: 8, wordBreak: 'break-all' }}>
        {a.full_name}
      </div>

      {/* API endpoint */}
      {a.real_api_endpoint && (
        <div style={{
          padding: '6px 8px',
          background: '#eef1f8',
          borderRadius: 5,
          fontSize: 10,
          fontFamily: 'JetBrains Mono, monospace',
          color: '#96a3bb',
          marginBottom: 10,
          wordBreak: 'break-all',
        }}>
          {a.real_api_endpoint}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: a.api_configured ? '#22c55e' : '#96a3bb',
          flexShrink: 0,
        }} />
        <span style={{ fontSize: 11, color: a.api_configured ? '#22c55e' : '#96a3bb' }}>
          {a.api_configured ? 'API key configured' : 'API key not set'}
        </span>
        <a
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginLeft: 'auto', fontSize: 11, color: '#4a7fe8', textDecoration: 'none' }}
        >
          Docs →
        </a>
      </div>
    </div>
  )
}
