import type { RiskLevel, CaseStatus } from '../types'

export function riskColor(score: number): string {
  if (score >= 80) return '#991b1b'
  if (score >= 60) return '#b91c1c'
  if (score >= 40) return '#b45309'
  return '#15803d'
}

export function riskBadgeClass(score: number): string {
  if (score >= 60) return 'badge-red'
  if (score >= 40) return 'badge-amber'
  return 'badge-green'
}

export function riskLabel(score: number): string {
  if (score >= 80) return 'CRITICAL'
  if (score >= 60) return 'HIGH RISK'
  if (score >= 40) return 'MEDIUM RISK'
  return 'LOW RISK'
}

export function statusBadgeClass(status: string): string {
  const m: Record<string,string> = {
    pending:'badge-blue', investigating:'badge-purple', review:'badge-amber',
    cleared:'badge-green', rejected:'badge-red', on_hold:'badge-orange',
    escalated:'badge-purple', pending_documents:'badge-blue',
  }
  return m[status] || 'badge-gray'
}

export function statusLabel(status: string): string {
  const m: Record<string,string> = {
    pending:'Pending', investigating:'Investigating', review:'Under Review',
    cleared:'Cleared', rejected:'Rejected', on_hold:'On Hold',
    escalated:'Escalated', pending_documents:'Docs Requested',
  }
  return m[status] || status
}

export function agentDisplayName(name: string): string {
  const m: Record<string,string> = {
    identity_agent:'Identity Agent', sanctions_agent:'Sanctions Agent',
    pep_agent:'PEP Agent', registry_agent:'Registry Agent',
    adverse_media_agent:'Adverse Media', transaction_analysis_agent:'Transaction Analysis',
    risk_aggregation_agent:'Risk Aggregation',
  }
  return m[name] || name.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())
}

export function agentColor(name: string): string {
  const m: Record<string,string> = {
    identity_agent:'#4a7fe8', sanctions_agent:'#ef4444', pep_agent:'#8b5cf6',
    registry_agent:'#f59e0b', adverse_media_agent:'#14b8a6',
    transaction_analysis_agent:'#22c55e', risk_aggregation_agent:'#4f46e5',
  }
  return m[name] || '#96a3bb'
}

export function agentBgColor(name: string): string {
  const m: Record<string,string> = {
    identity_agent:'#dce8fc', sanctions_agent:'#fee2e2', pep_agent:'#ede9fe',
    registry_agent:'#fef9c3', adverse_media_agent:'#ccfbf1',
    transaction_analysis_agent:'#dcfce7', risk_aggregation_agent:'#e0e7ff',
  }
  return m[name] || '#eef1f8'
}

export function sourceTypeColor(type: string): string {
  const m: Record<string,string> = {
    sanctions:'#b91c1c', pep:'#6d28d9', identity:'#2563eb',
    registry:'#b45309', adverse_media:'#0f766e',
  }
  return m[type] || '#5a6a84'
}

export function resultBadgeClass(result: string): string {
  const m: Record<string,string> = {
    clear:'badge-green', flagged:'badge-red', partial_match:'badge-amber',
    found:'badge-blue', error:'badge-gray', unknown:'badge-gray',
  }
  return m[result?.toLowerCase()] || 'badge-gray'
}

export function formatDate(iso?: string): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) }
  catch { return iso }
}

export function formatDateTime(iso?: string): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) }
  catch { return iso }
}

export function decisionLabel(d: string): string {
  const m: Record<string,string> = {
    approved:'✓ Approved', rejected:'✕ Rejected', on_hold:'⏸ On Hold',
    escalated:'↑ Escalated', request_documents:'📄 Docs Requested',
  }
  return m[d] || d
}

export function decisionBadgeClass(d: string): string {
  const m: Record<string,string> = {
    approved:'badge-green', rejected:'badge-red', on_hold:'badge-amber',
    escalated:'badge-purple', request_documents:'badge-blue',
  }
  return m[d] || 'badge-gray'
}
