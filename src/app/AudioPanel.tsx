import React from 'react'
import { useUIStore } from '../state/ui'
import { getVolume, setVolume, tryPlayOnUserGesture, nextTrack, prevTrack, isPlaying, getCurrentTime, getDuration, setCurrentTime, getCurrentTrackName, setDesiredPlaying } from './BgMusic'

export const AudioPanel: React.FC = () => {
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const audioVisible = useUIStore(s => s.audioVisible)
  const setAudioVisible = useUIStore(s => s.setAudioVisible)
  const setDebugVisible = useUIStore(s => s.setDebugVisible)
  const setLoading = useUIStore(s => s.setLoading)
  const gameStarted = useUIStore(s => s.gameStarted)
  const [vol, setVol] = React.useState(0.2)
  const [sfxVol, setSfxVol] = React.useState(0.7)
  const [playing, setPlaying] = React.useState(false)
  const [elapsed, setElapsed] = React.useState(0)
  const [duration, setDur] = React.useState(0)
  const [trackName, setTrackName] = React.useState('')

  React.useEffect(() => {
    // Initialize slider from current audio volume
    try {
      const v = getVolume()
      if (typeof v === 'number' && !Number.isNaN(v)) setVol(v)
    } catch {
      // ignore
    }
    try {
      setPlaying(isPlaying())
    } catch {
      // ignore
    }
    try {
      setElapsed(getCurrentTime())
      setDur(getDuration())
      setTrackName(getCurrentTrackName())
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

  // Poll for progress while panel is mounted; cheap and robust
  React.useEffect(() => {
    let raf = 0
    const tick = () => {
      const ct = getCurrentTime()
      const du = getDuration()
      const p = isPlaying()
      const name = getCurrentTrackName()
      setElapsed((prev) => (Math.abs(prev - ct) > 0.2 ? ct : prev))
      setDur((prev) => (prev !== du ? du : prev))
      setPlaying((prev) => (prev !== p ? p : prev))
      setTrackName((prev) => (prev !== name ? name : prev))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const fmt = (s: number) => {
    s = Math.max(0, Math.floor(s))
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

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
              // Minimal structural types to avoid explicit any
              type SaveFilePickerOptions = {
                suggestedName?: string
                types?: Array<{ description?: string; accept: Record<string, string[]> }>
                excludeAcceptAllOption?: boolean
              }
              type FileSystemFileHandleLike = {
                createWritable: () => Promise<{ write(data: Blob | BufferSource | string): Promise<void>; close(): Promise<void> }>
              }
              // Step 1: Ask the user where to save (when supported)
              const w = window as unknown as { showSaveFilePicker?: (opts?: SaveFilePickerOptions) => Promise<FileSystemFileHandleLike> } & { __nextSaveFileHandle?: unknown };
              if (typeof w.showSaveFilePicker === 'function') {
                try {
                  const suggestedName = `mycraft-world-${new Date().toISOString().replace(/[:.]/g,'-').replace('T','_').replace('Z','')}.json`
                  const handle = await w.showSaveFilePicker({
                    suggestedName,
                    types: [{ description: 'MyCraft World (JSON)', accept: { 'application/json': ['.json'] } }],
                  })
                  w.__nextSaveFileHandle = handle
                } catch (err: unknown) {
                  const name = (err as { name?: string } | undefined)?.name
                  if (name === 'AbortError' || name === 'NotAllowedError') {
                    setLoading(false)
                    return
                  }
                  console.warn('Save picker failed; falling back to default download.', err)
                }
              }

              // Step 2: Trigger the actual save (engine will use handle if provided)
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
      top: '94px',
      left: '12px',
      width: '380px',
      background: 'linear-gradient(135deg, rgba(20,25,35,0.98) 0%, rgba(15,20,28,0.98) 100%)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '24px',
      padding: '32px',
      color: '#ffffff',
      fontSize: '14px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      zIndex: 2000,
      maxHeight: '70vh',
      overflowY: 'auto',
      backdropFilter: 'blur(32px)',
      boxShadow: '0 32px 80px rgba(0,0,0,0.8), 0 16px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <div style={{
          fontSize: '20px',
          fontWeight: 700,
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          letterSpacing: -0.5
        }}>Now Playing</div>
        <button
          onClick={() => setAudioVisible(false)}
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#ffffff',
            cursor: 'pointer',
            padding: '8px 10px',
            borderRadius: '12px',
            fontSize: '16px',
            fontWeight: 400,
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            outline: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '36px',
            height: '36px'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.12)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.16)'
            e.currentTarget.style.transform = 'scale(1.05)'
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
            e.currentTarget.style.transform = 'scale(1)'
          }}
        >
          ✕
        </button>
      </div>

      {/* Track Info */}
      <div style={{ textAlign: 'center', marginBottom: '32px' }}>
        <div style={{
          fontSize: '18px',
          fontWeight: 700,
          color: '#ffffff',
          letterSpacing: -0.3,
          lineHeight: 1.2
        }}>{trackName || 'No Track Selected'}</div>
      </div>

      {/* Progress Section */}
      <div style={{ marginBottom: '32px' }}>
        {/* Progress bar */}
        <div
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
            const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
            const d = getDuration()
            if (d > 0) setCurrentTime(ratio * d)
          }}
          style={{
            width: '100%',
            height: '6px',
            borderRadius: '3px',
            background: 'rgba(255,255,255,0.12)',
            cursor: 'pointer',
            position: 'relative',
            marginBottom: '12px',
            transition: 'all 0.2s ease'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.height = '8px'
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.height = '6px'
          }}
        >
          <div style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${duration > 0 ? (Math.min(1, elapsed / duration) * 100) : 0}%`,
            background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)',
            borderRadius: '3px',
            transition: 'width 0.1s ease'
          }} />
          <div style={{
            position: 'absolute',
            left: `${duration > 0 ? (Math.min(1, elapsed / duration) * 100) : 0}%`,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: '14px',
            height: '14px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            borderRadius: '50%',
            border: '2px solid rgba(255,255,255,0.9)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
            opacity: duration > 0 ? 1 : 0,
            transition: 'opacity 0.2s ease'
          }} />
        </div>

        {/* Time labels */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          fontSize: '12px', 
          fontWeight: 600, 
          color: 'rgba(255,255,255,0.6)',
          letterSpacing: 0.3
        }}>
          <span>{fmt(elapsed)}</span>
          <span>{duration > 0 ? `-${fmt(Math.max(0, duration - elapsed))}` : '-0:00'}</span>
        </div>
      </div>

      {/* Control buttons */}
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        gap: '24px',
        marginBottom: '32px'
      }}>
        <button
          aria-label="Previous track"
          onClick={() => { prevTrack(); setPlaying(isPlaying()); setTrackName(getCurrentTrackName()) }}
          style={{
            padding: '12px',
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '50%',
            color: '#ffffff',
            cursor: 'pointer',
            fontSize: '18px',
            width: '48px',
            height: '48px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            outline: 'none'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.16)'
            e.currentTarget.style.transform = 'scale(1.1)'
            e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)'
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
            e.currentTarget.style.transform = 'scale(1)'
            e.currentTarget.style.boxShadow = 'none'
          }}
        >⏮</button>

          <button
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={() => {
              if (playing) {
                setDesiredPlaying(false)
                setPlaying(false)
              } else {
                setDesiredPlaying(true)
                tryPlayOnUserGesture()
                setPlaying(true)
              }
            }}
          style={{
            padding: '16px',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '50%',
            color: '#ffffff',
            cursor: 'pointer',
            width: '64px',
            height: '64px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            outline: 'none',
            boxShadow: '0 8px 24px rgba(102,126,234,0.3)'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.transform = 'scale(1.1)'
            e.currentTarget.style.boxShadow = '0 12px 32px rgba(102,126,234,0.5)'
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = 'scale(1)'
            e.currentTarget.style.boxShadow = '0 8px 24px rgba(102,126,234,0.3)'
          }}
        >
          {playing ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 4h4v16H6V4zM14 4h4v16h-4V4z"/>
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          )}
        </button>

        <button
          aria-label="Next track"
          onClick={() => { nextTrack(); setPlaying(isPlaying()); setTrackName(getCurrentTrackName()) }}
          style={{
            padding: '12px',
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '50%',
            color: '#ffffff',
            cursor: 'pointer',
            fontSize: '18px',
            width: '48px',
            height: '48px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
            outline: 'none'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.16)'
            e.currentTarget.style.transform = 'scale(1.1)'
            e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)'
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.08)'
            e.currentTarget.style.transform = 'scale(1)'
            e.currentTarget.style.boxShadow = 'none'
          }}
        >⏭</button>
      </div>

      {/* Volume Controls */}
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '24px'
      }}>
        {/* Music Volume */}
        <div style={{ 
          padding: '20px 24px', 
          borderRadius: '16px', 
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.06)'
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '16px'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span style={{
                fontSize: '14px',
                fontWeight: 600,
                color: 'rgba(255,255,255,0.9)'
              }}>Music Volume</span>
            </div>
            <span style={{ 
              color: '#ffffff',
              fontSize: '14px',
              fontWeight: 700,
              minWidth: '40px',
              textAlign: 'right'
            }}>{Math.round(vol * 100)}%</span>
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
            style={{ 
              width: '100%', 
              height: '6px', 
              borderRadius: '3px', 
              background: 'rgba(255,255,255,0.12)', 
              outline: 'none', 
              cursor: 'pointer',
              appearance: 'none',
              WebkitAppearance: 'none'
            }}
          />
        </div>

        {/* SFX Volume */}
        <div style={{ 
          padding: '20px 24px', 
          borderRadius: '16px', 
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.06)'
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center',
            marginBottom: '16px'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span style={{
                fontSize: '14px',
                fontWeight: 600,
                color: 'rgba(255,255,255,0.9)'
              }}>Sound Effects Volume</span>
            </div>
            <span style={{ 
              color: '#ffffff',
              fontSize: '14px',
              fontWeight: 700,
              minWidth: '40px',
              textAlign: 'right'
            }}>{Math.round(sfxVol * 100)}%</span>
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
            style={{ 
              width: '100%', 
              height: '6px', 
              borderRadius: '3px', 
              background: 'rgba(255,255,255,0.12)', 
              outline: 'none', 
              cursor: 'pointer',
              appearance: 'none',
              WebkitAppearance: 'none'
            }}
          />
        </div>
      </div>
    </div>
  )
}

export default AudioPanel
