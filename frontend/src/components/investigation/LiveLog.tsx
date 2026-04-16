/**
 * LiveLog.tsx
 * ───────────
 * Drop-in replacement for the LiveLog export in InvestigationView.
 * Shows all investigation events including the new "verification_api_called"
 * events emitted by verification_service.py for every authority check.
 *
 * Place at: src/components/investigation/LiveLog.tsx
 * Then re-export from InvestigationView:
 *   export { default as LiveLog } from './LiveLog'
 * OR replace the LiveLog function inside InvestigationView.tsx directly.
 */

import { useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Event {
  id:         string
  event_type: string
  event_data: Record<string, any>
  message:    string
  timestamp:  string
}

interface Props {
  events: Event[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtTime(iso: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function resultBadge(result: string) {
  const map: Record<string, { bg: string; color: string; border: string; label: string }> = {
    clear:         { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0', label: '✓ clear' },
    verified:      { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0', label: '✓ verified' },
    found:         { bg: '#dcfce7', color: '#15803d', border: '#bbf7d0', label: '✓ found' },
    flagged:       { bg: '#fee2e2', color: '#b91c1c', border: '#fecaca', label: '⚠ flagged' },
    partial_match: { bg: '#fef9c3', color: '#b45309', border: '#fde68a', label: '~ partial' },
    error:         { bg: '#fee2e2', color: '#b91c1c', border: '#fecaca', label: '✕ error' },
    unknown:       { bg: '#f4f6fb', color: '#96a3bb', border: '#e4e9f4', label: '? unknown' },
  }
  const s = map[result] ?? map.unknown
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
      fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.04em',
    }}>{s.label}</span>
  )
}

function modeBadge(mode: string) {
  const isMock = mode === 'MOCK'
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
      background: isMock ? '#fef9c3' : '#dcfce7',
      color:      isMock ? '#b45309' : '#15803d',
      border:     `1px solid ${isMock ? '#fde68a' : '#bbf7d0'}`,
      fontFamily: 'JetBrains Mono, monospace',
    }}>{mode}</span>
  )
}

function typeBadge(type: string) {
  const map: Record<string, string> = {
    sanctions:    '#fee2e2',
    pep:          '#ede9fe',
    identity:     '#dce8fc',
    registry:     '#fef9c3',
    adverse_media:'#f4f6fb',
  }
  return (
    <span style={{
      fontSize: 9, padding: '1px 5px', borderRadius: 4,
      background: map[type] ?? '#f4f6fb',
      color: '#5a6a84', border: '1px solid #e4e9f4',
      fontFamily: 'JetBrains Mono, monospace',
    }}>{type?.replace(/_/g, ' ')}</span>
  )
}

// ─── Event row renderers ──────────────────────────────────────────────────────

function VerificationRow({ data, time }: { data: Record<string, any>; time: string }) {
  const [expanded, setExpanded] = useState(false)
  const elapsedMs = data.elapsed_ms ?? null

  return (
    <div style={{
      padding: '7px 10px', marginBottom: 4,
      background: '#f8f9fd', border: '1px solid #e4e9f4', borderRadius: 8,
      borderLeft: `3px solid ${data.result === 'clear' || data.result === 'verified' ? '#22c55e' : data.result === 'flagged' ? '#ef4444' : '#f59e0b'}`,
    }}>
      {/* Main row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 }}>
          {time}
        </span>
        <span style={{ fontSize: 10, color: '#5a6a84' }}>🔍</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#1e2a3a', flex: 1 }}>
          {data.authority_name}
        </span>
        {data.authority_type && typeBadge(data.authority_type)}
        {data.mode && modeBadge(data.mode)}
        {data.result && resultBadge(data.result)}
        {elapsedMs !== null && (
          <span style={{ fontSize: 9, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace', marginLeft: 'auto' }}>
            {elapsedMs}ms
          </span>
        )}
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 10, color: '#96a3bb', padding: '0 2px',
          }}
        >{expanded ? '▲' : '▼'}</button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #e4e9f4' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
            {[
              ['Authority key', data.authority_key],
              ['Subject',       data.subject],
              ['Endpoint',      data.endpoint],
              ['Mode',          data.mode],
              ['Result',        data.result],
              ['Elapsed',       elapsedMs != null ? `${elapsedMs}ms` : '—'],
            ].map(([label, value]) => value ? (
              <div key={label as string}>
                <div style={{ fontSize: 9, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 1 }}>
                  {label}
                </div>
                <div style={{ fontSize: 11, color: '#1e2a3a', fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all' }}>
                  {value as string}
                </div>
              </div>
            ) : null)}
          </div>
          {data.flags && data.flags.length > 0 && (
            <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {data.flags.map((f: string) => (
                <span key={f} style={{
                  fontSize: 9, padding: '1px 6px', borderRadius: 4,
                  background: '#fee2e2', color: '#ef4444', border: '1px solid #fecaca',
                  fontFamily: 'JetBrains Mono, monospace',
                }}>⚠ {f}</span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function GenericRow({ event, time }: { event: Event; time: string }) {
  const iconMap: Record<string, string> = {
    plan_generated:        '🧠',
    agent_started:         '▶',
    agent_completed:       '✓',
    agent_failed:          '✕',
    escalation_triggered:  '⬆',
    investigation_complete:'⚑',
  }
  const colorMap: Record<string, string> = {
    agent_completed:       '#15803d',
    agent_failed:          '#b91c1c',
    investigation_complete:'#4a7fe8',
    escalation_triggered:  '#7c3aed',
  }
  const icon  = iconMap[event.event_type] ?? '●'
  const color = colorMap[event.event_type] ?? '#5a6a84'
  const d     = event.event_data

  let label = event.event_type.replace(/_/g, ' ')
  if (d.agent)        label = `${d.display_name || d.agent}`
  if (d.final_score != null) label = `Investigation complete — final score ${d.final_score?.toFixed(1)} (${d.risk_level?.toUpperCase()})`

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '5px 8px', marginBottom: 3,
    }}>
      <span style={{ fontSize: 10, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0, marginTop: 1 }}>
        {time}
      </span>
      <span style={{ fontSize: 11, color, flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 12, color: '#1e2a3a', lineHeight: 1.4 }}>
        {label}
        {d.score != null && (
          <span style={{ fontFamily: 'JetBrains Mono, monospace', color, marginLeft: 8 }}>
            score {d.score}
          </span>
        )}
        {d.source && (
          <span style={{
            marginLeft: 8, fontSize: 9, padding: '1px 5px', borderRadius: 4,
            background: '#eef1f8', color: '#5a6a84', border: '1px solid #e4e9f4',
            fontFamily: 'JetBrains Mono, monospace',
          }}>{d.source}</span>
        )}
        {d.flags?.length > 0 && (
          <span style={{ marginLeft: 6 }}>
            {d.flags.map((f: string) => (
              <span key={f} style={{
                fontSize: 9, padding: '1px 5px', borderRadius: 4,
                background: '#fee2e2', color: '#ef4444', border: '1px solid #fecaca',
                fontFamily: 'JetBrains Mono, monospace', marginLeft: 3,
              }}>⚠ {f.replace(/_/g, ' ')}</span>
            ))}
          </span>
        )}
      </span>
    </div>
  )
}

// ─── Filter bar ───────────────────────────────────────────────────────────────
const FILTERS = [
  { key: 'all',          label: 'All' },
  { key: 'verification', label: '🔍 API Calls' },
  { key: 'agents',       label: '🤖 Agents' },
  { key: 'system',       label: '⚙ System' },
]

function filterEvent(e: Event, filter: string): boolean {
  if (filter === 'all')          return true
  if (filter === 'verification') return e.event_type === 'verification_api_called'
  if (filter === 'agents')       return ['agent_started','agent_completed','agent_failed','escalation_triggered'].includes(e.event_type)
  if (filter === 'system')       return ['plan_generated','investigation_complete'].includes(e.event_type)
  return true
}

// ─── Main export ──────────────────────────────────────────────────────────────
export default function LiveLog({ events }: Props) {
  const [filter, setFilter] = useState('all')

  const filtered = events.filter(e => filterEvent(e, filter))

  // Count API calls
  const apiCallCount = events.filter(e => e.event_type === 'verification_api_called').length

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', maxHeight: 520 }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 10, flexShrink: 0,
      }}>
        <span className="card-title" style={{ marginBottom: 0 }}>
          Investigation Log
        </span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {apiCallCount > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
              background: '#dce8fc', color: '#4a7fe8', border: '1px solid #bdd0f8',
              fontFamily: 'JetBrains Mono, monospace',
            }}>{apiCallCount} API calls</span>
          )}
          <span style={{
            fontSize: 10, color: '#96a3bb',
            fontFamily: 'JetBrains Mono, monospace',
          }}>{events.length} events</span>
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexShrink: 0 }}>
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              padding: '3px 10px', fontSize: 10, fontWeight: 600,
              background: filter === f.key ? '#4a7fe8' : '#f4f6fb',
              color:      filter === f.key ? '#fff'    : '#5a6a84',
              border:     `1px solid ${filter === f.key ? '#4a7fe8' : '#e4e9f4'}`,
              borderRadius: 6, cursor: 'pointer', transition: 'all 0.12s',
            }}
          >{f.label}</button>
        ))}
      </div>

      {/* Events */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#96a3bb', fontSize: 12 }}>
            {events.length === 0 ? 'Investigation not started yet' : 'No events match this filter'}
          </div>
        ) : (
          filtered.map(e => {
            const time = fmtTime(e.timestamp)
            if (e.event_type === 'verification_api_called') {
              return <VerificationRow key={e.id} data={e.event_data} time={time} />
            }
            return <GenericRow key={e.id} event={e} time={time} />
          })
        )}
      </div>
    </div>
  )
}
