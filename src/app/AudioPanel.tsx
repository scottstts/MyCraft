import React from 'react'
import { useUIStore } from '../state/ui'
import { getVolume, setVolume } from './BgMusic'

export const AudioPanel: React.FC = () => {
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const audioVisible = useUIStore(s => s.audioVisible)
  const setAudioVisible = useUIStore(s => s.setAudioVisible)
  const setDebugVisible = useUIStore(s => s.setDebugVisible)
  const setLoading = useUIStore(s => s.setLoading)
  const gameStarted = useUIStore(s => s.gameStarted)
  const [vol, setVol] = React.useState(0.2)
  const [sfxVol, setSfxVol] = React.useState(0.7)

  React.useEffect(() => {
    // Initialize slider from current audio volume
    try {
      const v = getVolume()
      if (typeof v === 'number' && !Number.isNaN(v)) setVol(v)
    } catch {
      // ignore
    }
    try {
      const sfx = (window as Window & { __getSfxVolume?: () => number }).__getSfxVolume?.()
      if (typeof sfx === 'number' && !Number.isNaN(sfx)) setSfxVol(sfx)
    } catch {
      // ignore
    }
  }, [])

  // Close on outside click when open
  React.useEffect(() => {
    if (!audioVisible) return
    const onDown = (e: MouseEvent) => {
      const el = panelRef.current
      if (!el) return
      if (!el.contains(e.target as Node)) {
        setAudioVisible(false)
      }
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [audioVisible, setAudioVisible])

  // Ensure only one panel open at a time
  React.useEffect(() => {
    if (audioVisible) setDebugVisible(false)
  }, [audioVisible, setDebugVisible])

  // Hide launcher buttons while StartPanel is visible
  if (!gameStarted) return null

  if (!audioVisible) {
    return (
      <div style={{ position: 'fixed', top: '54px', left: '12px', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <button
          onClick={() => { setDebugVisible(false); setAudioVisible(true) }}
          style={{
            padding: '8px 12px',
            background: 'linear-gradient(145deg, rgba(32,39,49,0.95), rgba(22,27,35,0.95))',
            color: '#f8f9fa',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '12px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontWeight: 600,
            letterSpacing: 0.3,
            pointerEvents: 'auto',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            minWidth: '140px',
            justifyContent: 'flex-start',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)'
            e.currentTarget.style.boxShadow = '0 8px 32px rgba(245,87,108,0.4), 0 4px 16px rgba(0,0,0,0.4)'
            e.currentTarget.style.borderColor = 'rgba(245,87,108,0.4)'
            e.currentTarget.style.background = 'linear-gradient(145deg, rgba(42,49,59,0.98), rgba(32,37,45,0.98))'
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = 'translateY(0)'
            e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.3)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
            e.currentTarget.style.background = 'linear-gradient(145deg, rgba(32,39,49,0.95), rgba(22,27,35,0.95))'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ marginRight: '6px', flexShrink: 0 }}>
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" fill="currentColor" opacity="0.8"/>
          </svg>
          Audio Settings
        </button>

        <button
          onClick={async () => { 
            setLoading(true)
            try {
              ;(window as Window & { __saveWorld?: () => void }).__saveWorld?.()
              // Add a small delay to show the loader
              await new Promise(resolve => setTimeout(resolve, 500))
            } catch (e) {
              console.error('Save failed:', e)
            } finally {
              setLoading(false)
            }
          }}
          style={{
            padding: '8px 12px',
            background: 'linear-gradient(145deg, rgba(32,39,49,0.95), rgba(22,27,35,0.95))',
            color: '#f8f9fa',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '12px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontWeight: 600,
            letterSpacing: 0.3,
            pointerEvents: 'auto',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            width: 'fit-content',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)'
            e.currentTarget.style.boxShadow = '0 8px 32px rgba(147,51,234,0.4), 0 4px 16px rgba(0,0,0,0.4)'
            e.currentTarget.style.borderColor = 'rgba(147,51,234,0.4)'
            e.currentTarget.style.background = 'linear-gradient(145deg, rgba(42,49,59,0.98), rgba(32,37,45,0.98))'
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = 'translateY(0)'
            e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.3)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
            e.currentTarget.style.background = 'linear-gradient(145deg, rgba(32,39,49,0.95), rgba(22,27,35,0.95))'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ marginRight: '6px', flexShrink: 0 }}>
            <path d="M17 3H7a2 2 0 00-2 2v14l7-3 7 3V5a2 2 0 00-2-2z" fill="currentColor" opacity="0.8"/>
          </svg>
          Save World
        </button>
      </div>
    )
  }

  return (
    <div ref={panelRef} style={{
      position: 'fixed',
      top: '94px', // directly under the Audio Settings button
      left: '12px',
      width: '320px',
      background: 'linear-gradient(145deg, rgba(32,39,49,0.98), rgba(22,27,35,0.98))',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '16px',
      padding: '20px',
      color: '#f8f9fa',
      fontSize: '13px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      zIndex: 2000,
      maxHeight: '60vh',
      overflowY: 'auto',
      backdropFilter: 'blur(20px)',
      boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 8px 32px rgba(0,0,0,0.4)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <h3 style={{
          margin: 0,
          fontSize: '18px',
          fontWeight: 700,
          background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text'
        }}>Audio</h3>
        <button
          onClick={() => setAudioVisible(false)}
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#f8f9fa',
            cursor: 'pointer',
            padding: '8px 10px',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 600,
            transition: 'all 0.2s ease',
            outline: 'none'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(255,255,255,0.08))'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ marginBottom: '12px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.02)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px', fontWeight: 500, color: '#94a3b8' }}>
          <span>Music Volume</span>
          <span style={{ color: '#e2e8f0' }}>{Math.round(vol * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={vol}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            setVol(v)
            setVolume(v)
          }}
          style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.1)', outline: 'none', cursor: 'pointer' }}
        />
      </div>

      <div style={{ marginTop: '12px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.02)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px', fontWeight: 500, color: '#94a3b8' }}>
          <span>Sound Effects Volume</span>
          <span style={{ color: '#e2e8f0' }}>{Math.round(sfxVol * 100)}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={sfxVol}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            setSfxVol(v)
            ;(window as Window & { __setSfxVolume?: (v: number) => void }).__setSfxVolume?.(v)
          }}
          style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.1)', outline: 'none', cursor: 'pointer' }}
        />
      </div>
    </div>
  )
}

export default AudioPanel
