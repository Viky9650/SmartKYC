/**
 * InvestigationView.tsx
 * All investigation UI components used in CaseDetailPage.
 * Exports: InvestigationPlanCard, AgentTimeline, VerificationSourcesPanel,
 *          AgentFindingsPanel, LiveLog
 */

import { useState } from 'react'
import { riskColor, formatDateTime } from '../../utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Agent {
  id: string
  agent_name: string
  risk_score: number
  flags: string[]
  summary: string
  confidence: number
  evidence: Record<string, any>
  status: string
  completed_at: string | null
}

interface VerificationSource {
  id: string
  source_name: string
  source_type: string
  result: string
  result_detail: Record<string, any>
  is_mock: boolean
  checked_at: string | null
}

interface Event {
  id: string
  event_type: string
  event_data: Record<string, any>
  message: string
  timestamp: string | null
}

interface InvestigationPlan {
  investigation_plan: string[]
  mandatory_agents: string[]
  conditional_agents: string[]
  llm_decided_agents: string[]
  agent_sources: Record<string, string>
  reasoning: string
  agent_reasoning: Record<string, string>
  excluded_reasoning: Record<string, string>
  risk_indicators: string[]
  priority_level: string
  estimated_risk: number
  special_notes: string
  total_agents: number
  llm_contributed: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const AGENT_DISPLAY: Record<string, { label: string; icon: string }> = {
  identity_verification:    { label: 'Identity Verification', icon: '🪪' },
  identity_agent:           { label: 'Identity Verification', icon: '🪪' },
  sanctions_screening:      { label: 'Sanctions Screening',   icon: '🛡' },
  sanctions_agent:          { label: 'Sanctions Screening',   icon: '🛡' },
  pep_check:                { label: 'PEP Check',             icon: '👤' },
  pep_agent:                { label: 'PEP Check',             icon: '👤' },
  registry_lookup:          { label: 'Registry Lookup',       icon: '🏢' },
  registry_agent:           { label: 'Registry Lookup',       icon: '🏢' },
  adverse_media_scan:       { label: 'Adverse Media',         icon: '📰' },
  adverse_media_agent:      { label: 'Adverse Media',         icon: '📰' },
  transaction_analysis:     { label: 'Transaction Analysis',  icon: '💳' },
  transaction_analysis_agent:{ label: 'Transaction Analysis', icon: '💳' },
  risk_aggregation_agent:   { label: 'Risk Aggregation',      icon: '📊' },
}

const SOURCE_COLORS: Record<string, string> = {
  mandatory:    '#1D9E75',
  conditional:  '#BA7517',
  llm_decided:  '#7F77DD',
  escalated:    '#D85A30',
}

const SOURCE_LABELS: Record<string, string> = {
  mandatory:   'Mandatory',
  conditional: 'Conditional',
  llm_decided: 'LLM decided',
  escalated:   'Escalated',
}

const RESULT_COLORS: Record<string, string> = {
  clear:         '#1D9E75',
  found:         '#1D9E75',
  flagged:       '#E24B4A',
  partial_match: '#BA7517',
  error:         '#888780',
}

const TYPE_COLORS: Record<string, string> = {
  sanctions:    '#E24B4A',
  pep:          '#D85A30',
  identity:     '#378ADD',
  registry:     '#7F77DD',
  adverse_media:'#BA7517',
}

function agentLabel(key: string) {
  return AGENT_DISPLAY[key]?.label || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
function agentIcon(key: string) {
  return AGENT_DISPLAY[key]?.icon || '🔍'
}
function scoreLevel(s: number) {
  if (s >= 80) return { label: 'CRITICAL', color: '#E24B4A', bg: '#FCEBEB' }
  if (s >= 60) return { label: 'HIGH',     color: '#D85A30', bg: '#FAECE7' }
  if (s >= 40) return { label: 'MEDIUM',   color: '#BA7517', bg: '#FAEEDA' }
  return           { label: 'LOW',      color: '#1D9E75', bg: '#E1F5EE' }
}

// ─── 1. InvestigationPlanCard ─────────────────────────────────────────────────

export function InvestigationPlanCard({
  plan, loading,
}: { plan: InvestigationPlan | null; loading: boolean }) {
  const [expanded, setExpanded] = useState(false)

  if (loading) {
    return (
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 10, height: 10, borderRadius: '50%',
            background: '#4a7fe8', animation: 'pulse 1.5s infinite',
          }} />
          <span style={{ fontSize: 13, color: '#5a6a84' }}>
            LLM generating investigation plan…
          </span>
        </div>
      </div>
    )
  }

  if (!plan) return null

  const priorityColors: Record<string, { bg: string; color: string }> = {
    CRITICAL: { bg: '#FCEBEB', color: '#A32D2D' },
    HIGH:     { bg: '#FAECE7', color: '#712B13' },
    MEDIUM:   { bg: '#FAEEDA', color: '#633806' },
    LOW:      { bg: '#E1F5EE', color: '#085041' },
  }
  const pc = priorityColors[plan.priority_level] || priorityColors.MEDIUM

  return (
    <div className="card">
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#1e2a3a', marginBottom: 4 }}>
            Investigation Plan
            {plan.llm_contributed && (
              <span style={{
                marginLeft: 8, fontSize: 10, fontWeight: 700,
                background: '#EEEDFE', color: '#534AB7',
                border: '1px solid #AFA9EC',
                padding: '2px 7px', borderRadius: 4,
                fontFamily: 'JetBrains Mono, monospace',
              }}>AI-GENERATED</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#5a6a84' }}>
            {plan.total_agents} agent{plan.total_agents !== 1 ? 's' : ''} selected
            {' · '}
            {plan.mandatory_agents?.length || 0} mandatory
            {plan.conditional_agents?.length > 0 && ` · ${plan.conditional_agents.length} conditional`}
            {plan.llm_decided_agents?.length > 0 && ` · ${plan.llm_decided_agents.length} AI-decided`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 6,
            background: pc.bg, color: pc.color,
          }}>{plan.priority_level}</span>
          <span style={{
            fontSize: 18, fontWeight: 700,
            fontFamily: 'JetBrains Mono, monospace',
            color: riskColor(plan.estimated_risk),
          }}>{plan.estimated_risk}</span>
        </div>
      </div>

      {/* Agent pipeline — horizontal flow */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        overflowX: 'auto', paddingBottom: 4, marginBottom: 12,
      }}>
        {plan.investigation_plan?.map((key, i) => {
          const source = plan.agent_sources?.[key] || 'mandatory'
          const isLast = i === plan.investigation_plan.length - 1
          const sourceColor = SOURCE_COLORS[source] || '#888780'
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <div style={{
                padding: '8px 12px',
                background: '#f4f6fb',
                border: `1px solid ${sourceColor}44`,
                borderRadius: 8,
                textAlign: 'center',
                minWidth: 100,
              }}>
                <div style={{ fontSize: 16, marginBottom: 2 }}>{agentIcon(key)}</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#1e2a3a', marginBottom: 2 }}>
                  {agentLabel(key).split(' ').map((w, j) => (
                    <span key={j}>{w}{j < agentLabel(key).split(' ').length - 1 ? ' ' : ''}</span>
                  ))}
                </div>
                <div style={{
                  fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
                  color: sourceColor, fontWeight: 700,
                  background: `${sourceColor}18`,
                  padding: '1px 5px', borderRadius: 3, display: 'inline-block',
                }}>{SOURCE_LABELS[source] || source}</div>
              </div>
              {!isLast && (
                <div style={{
                  width: 20, height: 1,
                  background: 'linear-gradient(90deg, #d1d9ee, #b8c4de)',
                  position: 'relative', flexShrink: 0,
                }}>
                  <div style={{
                    position: 'absolute', right: -3, top: -4,
                    width: 0, height: 0,
                    borderTop: '4px solid transparent',
                    borderBottom: '4px solid transparent',
                    borderLeft: '6px solid #b8c4de',
                  }} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Risk indicators */}
      {plan.risk_indicators?.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {plan.risk_indicators.map(ri => (
            <span key={ri} style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 4,
              background: '#FAEEDA', color: '#633806',
              border: '1px solid #EF9F2744',
              fontFamily: 'JetBrains Mono, monospace',
            }}>⚠ {ri}</span>
          ))}
        </div>
      )}

      {/* LLM reasoning — collapsible */}
      {plan.reasoning && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 11, color: '#4a7fe8', padding: 0, display: 'flex',
              alignItems: 'center', gap: 4,
            }}
          >
            {expanded ? '▾' : '▸'} AI reasoning
          </button>
          {expanded && (
            <div style={{
              marginTop: 8, padding: '10px 12px',
              background: '#f4f6fb', borderRadius: 8,
              fontSize: 12, color: '#5a6a84', lineHeight: 1.6,
              borderLeft: '3px solid #7F77DD',
            }}>
              {plan.reasoning}
              {plan.special_notes && (
                <div style={{ marginTop: 6, color: '#D85A30', fontWeight: 500 }}>
                  ⚠ {plan.special_notes}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── 2. AgentTimeline ─────────────────────────────────────────────────────────

export function AgentTimeline({
  agents, loading, plan,
}: { agents: Agent[]; loading: boolean; plan: InvestigationPlan | null }) {
  const [selected, setSelected] = useState<string | null>(null)

  // Build ordered list from plan, fall back to agents order
  const plannedKeys = plan?.investigation_plan || []
  const agentMap: Record<string, Agent> = {}
  agents.forEach(a => { agentMap[a.agent_name] = a })

  // All keys: planned order first, then any extra agents not in plan
  const allKeys = [
    ...plannedKeys,
    ...agents.map(a => a.agent_name).filter(k => !plannedKeys.includes(k)),
  ]

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid #e4e9f4',
        fontSize: 13, fontWeight: 600, color: '#1e2a3a',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span>Agent Timeline</span>
        {loading && (
          <span style={{
            fontSize: 10, color: '#4a7fe8', fontFamily: 'JetBrains Mono, monospace',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: '#4a7fe8',
              display: 'inline-block', animation: 'pulse 1.5s infinite',
            }} />
            RUNNING
          </span>
        )}
      </div>

      <div style={{ padding: '8px 0' }}>
        {allKeys.filter(k => k !== 'risk_aggregation_agent').map((key, idx) => {
          const agent = agentMap[key]
          const source = plan?.agent_sources?.[key] || 'mandatory'
          const sourceColor = SOURCE_COLORS[source] || '#888780'
          const isRunning  = loading && !agent
          const isDone     = !!agent
          const isSelected = selected === key
          const level      = agent ? scoreLevel(agent.risk_score) : null

          return (
            <div
              key={key}
              onClick={() => isDone && setSelected(isSelected ? null : key)}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 0,
                cursor: isDone ? 'pointer' : 'default',
                background: isSelected ? '#dce8fc22' : 'transparent',
                transition: 'background 0.15s',
              }}
            >
              {/* Timeline spine */}
              <div style={{ width: 48, display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                <div style={{ width: 1, height: 8, background: idx === 0 ? 'transparent' : '#e4e9f4' }} />
                {/* Status dot */}
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: isDone
                    ? (agent.flags.length > 0 ? '#FCEBEB' : '#E1F5EE')
                    : isRunning ? '#dce8fc' : '#f4f6fb',
                  border: `1.5px solid ${isDone
                    ? (agent.flags.length > 0 ? '#E24B4A' : '#1D9E75')
                    : isRunning ? '#4a7fe8' : '#d1d9ee'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13,
                  animation: isRunning ? 'pulse 1.5s infinite' : 'none',
                  flexShrink: 0,
                }}>
                  {isDone
                    ? (agent.flags.length > 0 ? '⚠' : '✓')
                    : isRunning ? '…' : agentIcon(key)}
                </div>
                <div style={{ width: 1, flex: 1, background: '#e4e9f4', minHeight: 8 }} />
              </div>

              {/* Content */}
              <div style={{ flex: 1, padding: '6px 16px 6px 4px', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#1e2a3a' }}>
                    {agentLabel(key)}
                  </span>
                  <span style={{
                    fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
                    color: sourceColor, background: `${sourceColor}18`,
                    padding: '1px 5px', borderRadius: 3, fontWeight: 700,
                  }}>{SOURCE_LABELS[source] || source}</span>
                  {isDone && level && (
                    <span style={{
                      fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
                      color: level.color, marginLeft: 'auto',
                    }}>{Math.round(agent.risk_score)}</span>
                  )}
                </div>

                {isDone && (
                  <>
                    <div style={{ fontSize: 11, color: '#5a6a84', marginBottom: 4, lineHeight: 1.5 }}>
                      {agent.summary}
                    </div>
                    {agent.flags.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 4 }}>
                        {agent.flags.map(f => (
                          <span key={f} style={{
                            fontSize: 9, padding: '1px 6px', borderRadius: 3,
                            background: '#fee2e2', color: '#ef4444',
                            border: '1px solid #fecaca',
                            fontFamily: 'JetBrains Mono, monospace',
                          }}>⚑ {f.replace(/_/g, ' ')}</span>
                        ))}
                      </div>
                    )}
                    {/* Expanded evidence */}
                    {isSelected && (
                      <div style={{
                        marginTop: 6, padding: '10px 12px',
                        background: '#f8f9fd', borderRadius: 8,
                        border: '1px solid #e4e9f4', fontSize: 11,
                      }}>
                        <div style={{ fontSize: 10, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace', marginBottom: 6, textTransform: 'uppercase' }}>
                          Evidence · confidence {Math.round((agent.confidence || 0) * 100)}%
                        </div>
                        {Object.entries(agent.evidence || {})
                          .filter(([k]) => !k.startsWith('_'))
                          .slice(0, 5)
                          .map(([k, v]) => (
                            <div key={k} style={{ marginBottom: 4 }}>
                              <span style={{ color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace' }}>{k}: </span>
                              <span style={{ color: '#1e2a3a' }}>
                                {typeof v === 'object'
                                  ? JSON.stringify(v).slice(0, 120)
                                  : String(v).slice(0, 120)}
                              </span>
                            </div>
                          ))}
                      </div>
                    )}
                  </>
                )}

                {isRunning && (
                  <div style={{ fontSize: 11, color: '#96a3bb', fontStyle: 'italic' }}>
                    Running checks…
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {/* Risk aggregation — always last, separated */}
        {agentMap['risk_aggregation_agent'] && (() => {
          const agent = agentMap['risk_aggregation_agent']
          const level = scoreLevel(agent.risk_score)
          return (
            <div style={{ margin: '4px 16px 8px', padding: '10px 14px', borderRadius: 8,
              background: level.bg, border: `1px solid ${level.color}44` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: level.color }}>
                  📊 Risk Aggregation — Final Score
                </span>
                <span style={{
                  fontSize: 22, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
                  color: level.color,
                }}>{Math.round(agent.risk_score)}</span>
              </div>
              <div style={{ fontSize: 11, color: level.color, opacity: 0.8, marginTop: 2 }}>
                {agent.summary}
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}

// ─── 3. VerificationSourcesPanel ─────────────────────────────────────────────

export function VerificationSourcesPanel({ sources }: { sources: VerificationSource[] }) {
  const grouped: Record<string, VerificationSource[]> = {}
  sources.forEach(s => {
    const t = s.source_type || 'other'
    if (!grouped[t]) grouped[t] = []
    grouped[t].push(s)
  })

  const typeOrder = ['sanctions', 'pep', 'identity', 'registry', 'adverse_media']
  const typeLabels: Record<string, string> = {
    sanctions: 'Sanctions Lists', pep: 'PEP Databases',
    identity: 'Identity Verification', registry: 'Corporate Registries',
    adverse_media: 'Adverse Media',
  }

  if (sources.length === 0) {
    return (
      <div className="card">
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1e2a3a', marginBottom: 12 }}>
          Verification Sources
        </div>
        <div style={{ fontSize: 12, color: '#96a3bb', fontStyle: 'italic' }}>
          No verification sources yet — investigation hasn't run.
        </div>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #e4e9f4',
        fontSize: 13, fontWeight: 600, color: '#1e2a3a' }}>
        Verification Sources
        <span style={{ marginLeft: 8, fontSize: 11, color: '#96a3bb', fontWeight: 400 }}>
          {sources.length} checked
        </span>
      </div>
      <div style={{ padding: '8px 0' }}>
        {[...typeOrder, ...Object.keys(grouped).filter(k => !typeOrder.includes(k))]
          .filter(t => grouped[t])
          .map(type => (
            <div key={type}>
              <div style={{
                padding: '4px 16px', fontSize: 10,
                color: TYPE_COLORS[type] || '#888780',
                fontFamily: 'JetBrains Mono, monospace',
                fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
              }}>
                {typeLabels[type] || type}
              </div>
              {grouped[type].map(src => {
                const rc = RESULT_COLORS[src.result] || '#888780'
                const mismatches = src.result_detail?.field_mismatches || {}
                const hasMismatches = Object.keys(mismatches).length > 0
                return (
                  <div key={src.id} style={{
                    display: 'flex', alignItems: 'flex-start',
                    padding: '6px 16px', gap: 10,
                    borderBottom: '1px solid #f0f3fa',
                  }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: rc, flexShrink: 0, marginTop: 5,
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, fontWeight: 500, color: '#1e2a3a' }}>
                          {src.source_name}
                        </span>
                        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                          {src.is_mock && (
                            <span style={{
                              fontSize: 9, color: '#96a3bb',
                              fontFamily: 'JetBrains Mono, monospace',
                              background: '#f0f3fa', padding: '1px 4px', borderRadius: 3,
                            }}>MOCK</span>
                          )}
                          <span style={{
                            fontSize: 10, fontWeight: 700, color: rc,
                            fontFamily: 'JetBrains Mono, monospace',
                            textTransform: 'uppercase',
                          }}>{src.result.replace('_', ' ')}</span>
                        </div>
                      </div>
                      {/* Show field mismatches inline */}
                      {hasMismatches && (
                        <div style={{ marginTop: 4 }}>
                          {Object.entries(mismatches).map(([field, detail]: [string, any]) => (
                            <div key={field} style={{
                              fontSize: 10, padding: '3px 8px', marginBottom: 2,
                              background: '#FEF3C7', borderRadius: 4,
                              border: '1px solid #FDE68A',
                              fontFamily: 'JetBrains Mono, monospace',
                            }}>
                              <span style={{ color: '#92400E', fontWeight: 600 }}>
                                {field.replace(/_/g, ' ')}:
                              </span>
                              <span style={{ color: '#B45309' }}>
                                {' '}{detail.document_value} ≠ {detail.authority_value}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Show flags */}
                      {src.result_detail?.flags?.length > 0 && (
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 3 }}>
                          {src.result_detail.flags.map((f: string) => (
                            <span key={f} style={{
                              fontSize: 9, padding: '1px 5px', borderRadius: 3,
                              background: '#fee2e2', color: '#ef4444',
                              border: '1px solid #fecaca',
                              fontFamily: 'JetBrains Mono, monospace',
                            }}>{f.replace(/_/g, ' ')}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
      </div>
    </div>
  )
}

// ─── 4. AgentFindingsPanel ────────────────────────────────────────────────────

export function AgentFindingsPanel({ agents }: { agents: Agent[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const withFlags = agents.filter(a => a.flags.length > 0 && a.agent_name !== 'risk_aggregation_agent')
  const clean     = agents.filter(a => a.flags.length === 0 && a.agent_name !== 'risk_aggregation_agent')

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #e4e9f4',
        fontSize: 13, fontWeight: 600, color: '#1e2a3a',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Agent Findings</span>
        <div style={{ display: 'flex', gap: 6 }}>
          {withFlags.length > 0 && (
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 4,
              background: '#FCEBEB', color: '#A32D2D', fontWeight: 600,
            }}>{withFlags.length} flagged</span>
          )}
          {clean.length > 0 && (
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 4,
              background: '#E1F5EE', color: '#085041', fontWeight: 600,
            }}>{clean.length} clear</span>
          )}
        </div>
      </div>

      {agents.length === 0 ? (
        <div style={{ padding: 20, fontSize: 12, color: '#96a3bb', fontStyle: 'italic' }}>
          No agent results yet.
        </div>
      ) : (
        <div>
          {/* Flagged agents first */}
          {withFlags.map(agent => {
            const isOpen = expanded === agent.id
            const level  = scoreLevel(agent.risk_score)
            return (
              <div key={agent.id} style={{ borderBottom: '1px solid #f0f3fa' }}>
                <div
                  onClick={() => setExpanded(isOpen ? null : agent.id)}
                  style={{
                    padding: '10px 16px', cursor: 'pointer',
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    background: isOpen ? '#fff8f7' : 'transparent',
                    transition: 'background 0.15s',
                  }}
                >
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{agentIcon(agent.agent_name)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#1e2a3a' }}>
                        {agentLabel(agent.agent_name)}
                      </span>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700,
                          color: level.color, background: level.bg,
                          padding: '1px 6px', borderRadius: 4,
                        }}>{level.label}</span>
                        <span style={{
                          fontSize: 14, fontWeight: 700,
                          fontFamily: 'JetBrains Mono, monospace',
                          color: level.color,
                        }}>{Math.round(agent.risk_score)}</span>
                        <span style={{ fontSize: 10, color: '#96a3bb' }}>{isOpen ? '▾' : '▸'}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#5a6a84', lineHeight: 1.5 }}>
                      {agent.summary}
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                      {agent.flags.map(f => (
                        <span key={f} style={{
                          fontSize: 9, padding: '1px 6px', borderRadius: 3,
                          background: '#fee2e2', color: '#ef4444',
                          border: '1px solid #fecaca',
                          fontFamily: 'JetBrains Mono, monospace',
                        }}>⚑ {f.replace(/_/g, ' ')}</span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Expanded detail */}
                {isOpen && (
                  <div style={{
                    padding: '0 16px 12px 42px',
                    background: '#fff8f7',
                  }}>
                    {/* Field mismatches if any */}
                    {agent.evidence?._field_mismatches && Object.keys(agent.evidence._field_mismatches).length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 10, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace', marginBottom: 4, textTransform: 'uppercase' }}>
                          Field Mismatches
                        </div>
                        {Object.entries(agent.evidence._field_mismatches).map(([field, detail]: [string, any]) => (
                          <div key={field} style={{
                            padding: '6px 10px', marginBottom: 4,
                            background: '#FEF9C3', border: '1px solid #FDE68A',
                            borderRadius: 6, fontSize: 11,
                          }}>
                            <div style={{ fontWeight: 600, color: '#92400E', marginBottom: 2, textTransform: 'uppercase', fontSize: 10 }}>
                              {field.replace(/_/g, ' ')}
                            </div>
                            <div style={{ display: 'flex', gap: 16 }}>
                              <div>
                                <span style={{ color: '#96a3bb', fontSize: 9 }}>DOCUMENT </span>
                                <span style={{ color: '#1e2a3a', fontFamily: 'JetBrains Mono, monospace' }}>
                                  {detail.document_value}
                                </span>
                              </div>
                              <div>
                                <span style={{ color: '#96a3bb', fontSize: 9 }}>AUTHORITY </span>
                                <span style={{ color: '#1e2a3a', fontFamily: 'JetBrains Mono, monospace' }}>
                                  {detail.authority_value}
                                </span>
                              </div>
                            </div>
                            {detail.note && (
                              <div style={{ color: '#B45309', fontSize: 10, marginTop: 2 }}>{detail.note}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Other evidence entries */}
                    <div style={{ fontSize: 10, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace', marginBottom: 4, textTransform: 'uppercase' }}>
                      Evidence · confidence {Math.round((agent.confidence || 0) * 100)}%
                    </div>
                    {Object.entries(agent.evidence || {})
                      .filter(([k]) => !k.startsWith('_'))
                      .map(([k, v]) => (
                        <div key={k} style={{
                          fontSize: 11, marginBottom: 3,
                          fontFamily: 'JetBrains Mono, monospace',
                        }}>
                          <span style={{ color: '#96a3bb' }}>{k}: </span>
                          <span style={{ color: '#5a6a84' }}>
                            {typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : String(v).slice(0, 200)}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )
          })}

          {/* Clean agents — compact */}
          {clean.map(agent => (
            <div key={agent.id} style={{
              padding: '8px 16px', borderBottom: '1px solid #f0f3fa',
              display: 'flex', alignItems: 'center', gap: 10,
              opacity: 0.7,
            }}>
              <span style={{ fontSize: 14 }}>{agentIcon(agent.agent_name)}</span>
              <span style={{ fontSize: 12, color: '#5a6a84', flex: 1 }}>
                {agentLabel(agent.agent_name)}
              </span>
              <span style={{
                fontSize: 10, color: '#1D9E75', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
              }}>✓ CLEAR {Math.round(agent.risk_score)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── 5. LiveLog ───────────────────────────────────────────────────────────────

const EVENT_ICONS: Record<string, string> = {
  plan_generated:         '🧠',
  agent_started:          '▶',
  agent_completed:        '✓',
  agent_failed:           '✗',
  escalation_triggered:   '🔺',
  investigation_complete: '🏁',
  document_uploaded:      '📄',
  created:                '✦',
}

const EVENT_COLORS: Record<string, string> = {
  plan_generated:         '#7F77DD',
  agent_started:          '#378ADD',
  agent_completed:        '#1D9E75',
  agent_failed:           '#E24B4A',
  escalation_triggered:   '#D85A30',
  investigation_complete: '#1D9E75',
  document_uploaded:      '#BA7517',
  created:                '#888780',
}

export function LiveLog({ events }: { events: Event[] }) {
  const [showAll, setShowAll] = useState(false)
  const displayed = showAll ? events : events.slice(-12)

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid #e4e9f4',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#1e2a3a' }}>
          Investigation Log
        </span>
        <span style={{ fontSize: 11, color: '#96a3bb', fontFamily: 'JetBrains Mono, monospace' }}>
          {events.length} events
        </span>
      </div>

      <div style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
        maxHeight: 360, overflowY: 'auto',
        padding: '8px 0',
      }}>
        {events.length === 0 ? (
          <div style={{ padding: '12px 16px', color: '#96a3bb' }}>
            Waiting for investigation to start…
          </div>
        ) : (
          displayed.map((event, idx) => {
            const color = EVENT_COLORS[event.event_type] || '#888780'
            const icon  = EVENT_ICONS[event.event_type] || '·'
            const isComplete = event.event_type === 'investigation_complete'
            const isFailed   = event.event_type === 'agent_failed'

            return (
              <div key={event.id} style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '4px 16px',
                background: isComplete ? '#E1F5EE44' : isFailed ? '#FCEBEB44' : 'transparent',
              }}>
                {/* Timestamp */}
                <span style={{ color: '#d1d9ee', flexShrink: 0, fontSize: 10, paddingTop: 1 }}>
                  {event.timestamp ? new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--:--'}
                </span>
                {/* Icon */}
                <span style={{ color, flexShrink: 0, width: 12, textAlign: 'center' }}>
                  {icon}
                </span>
                {/* Message */}
                <span style={{ color: isComplete ? '#085041' : isFailed ? '#A32D2D' : '#5a6a84', flex: 1 }}>
                  {/* Format nicely based on event type */}
                  {event.event_type === 'agent_completed' && event.event_data?.agent ? (
                    <span>
                      <span style={{ color: '#1e2a3a' }}>
                        {agentLabel(event.event_data.agent)}
                      </span>
                      {' — score '}
                      <span style={{ color: riskColor(event.event_data.score || 0) }}>
                        {event.event_data.score?.toFixed(0)}
                      </span>
                      {event.event_data.flags?.length > 0 && (
                        <span style={{ color: '#E24B4A' }}>
                          {' '}⚑ {event.event_data.flags.join(', ')}
                        </span>
                      )}
                    </span>
                  ) : event.event_type === 'agent_started' && event.event_data?.display_name ? (
                    <span>
                      Starting{' '}
                      <span style={{ color: '#1e2a3a' }}>{event.event_data.display_name}</span>
                      {event.event_data.source && (
                        <span style={{ color: SOURCE_COLORS[event.event_data.source] || '#888780' }}>
                          {' '}[{event.event_data.source}]
                        </span>
                      )}
                    </span>
                  ) : event.event_type === 'plan_generated' ? (
                    <span>
                      Plan generated —{' '}
                      <span style={{ color: '#1e2a3a' }}>
                        {event.event_data.total_agents} agents
                      </span>
                      {event.event_data.priority && (
                        <span style={{ color: EVENT_COLORS.escalation_triggered }}>
                          {' '}· {event.event_data.priority}
                        </span>
                      )}
                    </span>
                  ) : event.event_type === 'investigation_complete' ? (
                    <span style={{ fontWeight: 600 }}>
                      Investigation complete — final score{' '}
                      <span style={{ color: riskColor(event.event_data.final_score || 0) }}>
                        {event.event_data.final_score?.toFixed(1)}
                      </span>
                      {' '}({event.event_data.risk_level?.toUpperCase()})
                    </span>
                  ) : (
                    event.message?.slice(0, 120) || event.event_type
                  )}
                </span>
              </div>
            )
          })
        )}
      </div>

      {events.length > 12 && (
        <div style={{ padding: '6px 16px', borderTop: '1px solid #e4e9f4' }}>
          <button
            onClick={() => setShowAll(!showAll)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 11, color: '#4a7fe8', padding: 0,
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            {showAll ? '▴ Show less' : `▾ Show all ${events.length} events`}
          </button>
        </div>
      )}
    </div>
  )
}
