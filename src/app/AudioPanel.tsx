import React from 'react'
import { useUIStore } from '../state/ui'
import { getVolume, setVolume } from './BgMusic'

export const AudioPanel: React.FC = () => {
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const audioVisible = useUIStore(s => s.audioVisible)
  const setAudioVisible = useUIStore(s => s.setAudioVisible)
  const setDebugVisible = useUIStore(s => s.setDebugVisible)
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

  if (!audioVisible) {
    return (
      <div style={{ position: 'fixed', top: '92px', left: '12px', zIndex: 1000 }}>
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
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)'
            e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = 'translateY(0)'
            e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.3)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
          }}
        >
          Audio Settings
        </button>
      </div>
    )
  }

  return (
    <div ref={panelRef} style={{
      position: 'fixed',
      top: '92px', // directly under the Graphics Settings button
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
