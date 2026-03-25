import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { reviewsApi } from '../../services/api'

export default function Layout() {
  const [queueCount, setQueueCount] = useState(0)

  useEffect(() => {
    reviewsApi.getQueue().then(q => setQueueCount(q.length)).catch(() => {})
    const iv = setInterval(() => {
      reviewsApi.getQueue().then(q => setQueueCount(q.length)).catch(() => {})
    }, 15000)
    return () => clearInterval(iv)
  }, [])

  const navItems = [
    { to: '/dashboard',  label: 'Dashboard',     icon: '◈' },
    { to: '/cases/new',  label: 'New Case',       icon: '＋' },
    { to: '/review',     label: 'Review Queue',   icon: '⬡', badge: queueCount },
    { to: '/cases',      label: 'All Cases',      icon: '☰' },
    { to: '/authorities',label: 'Authorities',    icon: '⊕' },
  ]

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#f4f6fb', overflow: 'hidden' }}>

      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside style={{
        width: 228,
        background: '#ffffff',
        borderRight: '1px solid #e4e9f4',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        boxShadow: '1px 0 4px rgba(30,42,58,0.04)',
      }}>

        {/* Logo */}
        <div style={{
          padding: '20px 18px 16px',
          borderBottom: '1px solid #e4e9f4',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <div style={{
            width: 32, height: 32,
            background: 'linear-gradient(135deg, #4a7fe8, #7c3aed)',
            borderRadius: 9,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 15, fontWeight: 700, color: '#fff',
            flexShrink: 0,
            boxShadow: '0 2px 6px rgba(74,127,232,0.35)',
          }}>K</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1e2a3a', letterSpacing: '0.01em' }}>SmartKYC</div>
            <div style={{ fontSize: 9, color: '#96a3bb', fontFamily: 'JetBrains Mono,monospace', letterSpacing: '0.1em', marginTop: 1 }}>
              COMPLIANCE PLATFORM
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ padding: '10px 10px', flex: 1 }}>
          <div style={{ fontSize: 10, color: '#96a3bb', fontWeight: 600, letterSpacing: '0.1em', padding: '6px 8px 8px', textTransform: 'uppercase' }}>
            Navigation
          </div>
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
              style={{ marginBottom: 2, textDecoration: 'none' }}
            >
              <span style={{ fontSize: 12, width: 20, textAlign: 'center', opacity: 0.5, flexShrink: 0 }}>
                {item.icon}
              </span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {!!item.badge && (
                <span style={{
                  background: '#fee2e2', color: '#b91c1c',
                  fontSize: 10, fontWeight: 700,
                  padding: '1px 6px', borderRadius: 10,
                  fontFamily: 'JetBrains Mono,monospace',
                  border: '1px solid #fecaca',
                }}>{item.badge}</span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div style={{ padding: '12px', borderTop: '1px solid #e4e9f4' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 12px',
            background: '#f4f6fb',
            borderRadius: 10,
            border: '1px solid #e4e9f4',
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: '50%',
              background: 'linear-gradient(135deg,#dce8fc,#ede9fe)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, color: '#4a7fe8', flexShrink: 0,
            }}>CO</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#1e2a3a' }}>Compliance Officer</div>
              <div style={{ fontSize: 10, color: '#96a3bb', fontFamily: 'JetBrains Mono,monospace' }}>ADMIN · LEVEL 3</div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────────── */}
      <main style={{ flex: 1, overflowY: 'auto', background: '#f4f6fb' }}>
        <Outlet />
      </main>
    </div>
  )
}
