import type { RiskLevel, CaseStatus } from '../../types'

// ─── Risk helpers ─────────────────────────────────────────────────────────────
export function riskColor(score: number): string {
  if (score >= 80) return '#991b1b'
  if (score >= 60) return '#b91c1c'
  if (score >= 40) return '#b45309'
  return '#15803d'
}
function riskBg(score: number): string {
  if (score >= 80) return '#fee2e2'
  if (score >= 60) return '#fee2e2'
  if (score >= 40) return '#fef9c3'
  return '#dcfce7'
}
export function riskLabel(score: number): string {
  if (score >= 80) return 'CRITICAL'
  if (score >= 60) return 'HIGH RISK'
  if (score >= 40) return 'MEDIUM RISK'
  return 'LOW RISK'
}

// ─── Risk Score Ring ──────────────────────────────────────────────────────────
export function RiskRing({ score }: { score: number }) {
  const col = riskColor(score)
  const rotation = -90 + (score / 100) * 180
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width="140" height="76" viewBox="0 0 140 76">
        <defs>
          <linearGradient id="rg" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor="#22c55e" />
            <stop offset="50%"  stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
        </defs>
        <path d="M 15 70 A 55 55 0 0 1 125 70" fill="none" stroke="#e4e9f4" strokeWidth="10" strokeLinecap="round"/>
        <path d="M 15 70 A 55 55 0 0 1 125 70" fill="none" stroke="url(#rg)" strokeWidth="3" strokeLinecap="round"/>
        <line x1="70" y1="70" x2="70" y2="22"
          stroke={col} strokeWidth="2" strokeLinecap="round"
          transform={`rotate(${rotation},70,70)`}
          style={{ transition: 'transform 0.8s ease' }}
        />
        <circle cx="70" cy="70" r="4" fill={col}/>
      </svg>
      <div style={{ fontSize: 36, fontWeight: 700, fontFamily: 'JetBrains Mono,monospace', color: col, lineHeight: 1, marginTop: -8 }}>
        {Math.round(score)}
      </div>
      <div style={{ fontSize: 11, color: '#5a6a84', fontFamily: 'JetBrains Mono,monospace' }}>
        {riskLabel(score)}
      </div>
    </div>
  )
}

// ─── Status Badge ─────────────────────────────────────────────────────────────
export function statusBadgeClass(s: string): string {
  const m: Record<string,string> = {
    pending:'badge-blue', investigating:'badge-purple', review:'badge-amber',
    cleared:'badge-green', rejected:'badge-red', on_hold:'badge-orange',
    escalated:'badge-purple', pending_documents:'badge-blue',
  }
  return m[s] || 'badge-gray'
}
export function statusLabel(s: string): string {
  const m: Record<string,string> = {
    pending:'Pending', investigating:'Investigating', review:'Under Review',
    cleared:'Cleared', rejected:'Rejected', on_hold:'On Hold',
    escalated:'Escalated', pending_documents:'Docs Requested',
  }
  return m[s] || s
}
export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${statusBadgeClass(status)}`}>{statusLabel(status)}</span>
}

// ─── Risk Badge ───────────────────────────────────────────────────────────────
export function RiskBadge({ score }: { score: number }) {
  return (
    <span style={{
      fontFamily:'JetBrains Mono,monospace', fontWeight:700, fontSize:14,
      color: riskColor(score),
    }}>{Math.round(score)}</span>
  )
}

// ─── Confidence Bar ───────────────────────────────────────────────────────────
export function ConfidenceBar({ value, label }: { value: number; label?: string }) {
  const col = value >= 0.9 ? '#15803d' : value >= 0.7 ? '#b45309' : '#b91c1c'
  const bg  = value >= 0.9 ? '#dcfce7' : value >= 0.7 ? '#fef9c3' : '#fee2e2'
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
      {label && (
        <span style={{ fontSize:11, color:'#5a6a84', width:130, flexShrink:0,
          fontFamily:'JetBrains Mono,monospace', textTransform:'capitalize' }}>
          {label.replace(/_/g,' ')}
        </span>
      )}
      <div style={{ flex:1, background:'#eef1f8', height:5, borderRadius:3, overflow:'hidden' }}>
        <div style={{ width:`${value*100}%`, background:col, height:'100%', borderRadius:3, transition:'width 0.4s' }}/>
      </div>
      <span style={{ fontSize:11, color:col, fontFamily:'JetBrains Mono,monospace', width:34, textAlign:'right', fontWeight:600 }}>
        {Math.round(value*100)}%
      </span>
    </div>
  )
}

// ─── Metric Card ─────────────────────────────────────────────────────────────
export function MetricCard({ label, value, sub, color }: {
  label: string; value: string|number; sub?: string; color?: string
}) {
  return (
    <div style={{
      background:'#ffffff', border:'1px solid #e4e9f4', borderRadius:10,
      padding:'16px 18px', boxShadow:'0 1px 3px rgba(30,42,58,0.06)',
    }}>
      <div style={{ fontSize:11, color:'#96a3bb', fontFamily:'JetBrains Mono,monospace',
        textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:8 }}>{label}</div>
      <div style={{ fontSize:28, fontWeight:700, fontFamily:'JetBrains Mono,monospace',
        color: color||'#1e2a3a', lineHeight:1 }}>{value}</div>
      {sub && <div style={{ fontSize:11, color:'#5a6a84', marginTop:5 }}>{sub}</div>}
    </div>
  )
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
export function Spinner({ size=14 }: { size?: number }) {
  return (
    <div style={{
      width:size, height:size,
      border:`2px solid #d1d9ee`, borderTopColor:'#4a7fe8',
      borderRadius:'50%', animation:'spin 0.8s linear infinite', flexShrink:0,
    }}/>
  )
}

// ─── Empty State ──────────────────────────────────────────────────────────────
export function EmptyState({ icon, title, sub }: { icon:string; title:string; sub?: string }) {
  return (
    <div style={{ textAlign:'center', padding:'36px 20px' }}>
      <div style={{ fontSize:32, marginBottom:10, opacity:0.3 }}>{icon}</div>
      <div style={{ fontSize:14, fontWeight:500, color:'#5a6a84', marginBottom:4 }}>{title}</div>
      {sub && <div style={{ fontSize:12, color:'#96a3bb' }}>{sub}</div>}
    </div>
  )
}

// ─── Section Header ───────────────────────────────────────────────────────────
export function SectionHeader({ title, action, badge }: {
  title:string; action?: React.ReactNode; badge?: React.ReactNode
}) {
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
      <span style={{ fontSize:11, fontWeight:600, textTransform:'uppercase',
        letterSpacing:'0.08em', color:'#96a3bb' }}>{title}</span>
      <div style={{ display:'flex', gap:8, alignItems:'center' }}>{badge}{action}</div>
    </div>
  )
}

// ─── Flag Tags ────────────────────────────────────────────────────────────────
export function FlagTags({ flags }: { flags: string[] }) {
  if (!flags?.length) return null
  return (
    <div style={{ display:'flex', flexWrap:'wrap' }}>
      {flags.map(f => (
        <span key={f} className="flag-tag">⚠ {f.replace(/_/g,' ')}</span>
      ))}
    </div>
  )
}

// ─── Page Topbar ─────────────────────────────────────────────────────────────
export function PageTopbar({ title, actions, sub }: {
  title:string; actions?: React.ReactNode; sub?: string
}) {
  return (
    <div style={{
      display:'flex', alignItems:'center', justifyContent:'space-between',
      padding:'14px 24px',
      borderBottom:'1px solid #e4e9f4',
      background:'#ffffff',
      position:'sticky', top:0, zIndex:10,
      boxShadow:'0 1px 3px rgba(30,42,58,0.05)',
    }}>
      <div>
        <div style={{ fontSize:16, fontWeight:700, color:'#1e2a3a' }}>{title}</div>
        {sub && <div style={{ fontSize:11, color:'#96a3bb', fontFamily:'JetBrains Mono,monospace', marginTop:2 }}>{sub}</div>}
      </div>
      {actions && <div style={{ display:'flex', gap:8, alignItems:'center' }}>{actions}</div>}
    </div>
  )
}
