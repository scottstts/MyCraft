import { useUIStore } from '../state/ui'

export function LoadingOverlay() {
  const loading = useUIStore(s => s.loading)

  if (!loading) return null

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.75)',
      backdropFilter: 'blur(8px)',
      zIndex: 9999,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '16px',
        padding: '32px',
        background: 'rgba(15, 23, 32, 0.96)',
        border: '1px solid rgba(148,163,184,0.16)',
        borderRadius: '16px',
        boxShadow: '0 24px 60px rgba(0,0,0,0.48)'
      }}>
        <div style={{
          width: '48px',
          height: '48px',
          border: '4px solid rgba(255,255,255,0.1)',
          borderTop: '4px solid #2dd4bf',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <div style={{
          color: '#f8f9fa',
          fontSize: '16px',
          fontWeight: 600,
          letterSpacing: '0.5px'
        }}>
          Loading...
        </div>
      </div>
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  )
}

export default LoadingOverlay
