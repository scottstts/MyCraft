import React from 'react'
import { useUIStore } from '../state/ui'
import { tryPlayOnUserGesture, nextTrack, prevTrack, isPlaying, getCurrentTime, getDuration, setCurrentTime, getCurrentTrackName, setDesiredPlaying, getVolume, setVolume } from './BgMusic'

// Always-visible music player widget (top-right), using the improved player UI
export const AudioPanel: React.FC = () => {
  const gameStarted = useUIStore(s => s.gameStarted)
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const [playing, setPlaying] = React.useState(false)
  const [elapsed, setElapsed] = React.useState(0)
  const [duration, setDur] = React.useState(0)
  const [trackName, setTrackName] = React.useState('')
  const [volume, setVol] = React.useState(0)
  const [topPx, setTopPx] = React.useState<number>(84)
  const [isDraggingProgress, setIsDraggingProgress] = React.useState(false)
  const [isDraggingVolume, setIsDraggingVolume] = React.useState(false)
  const fixedWidthPx = 240 // Fixed width to match TopRightWidget

  React.useEffect(() => {
    try { setPlaying(isPlaying()) } catch {}
    try {
      setElapsed(getCurrentTime())
      setDur(getDuration())
      setTrackName(getCurrentTrackName())
      setVol(getVolume())
    } catch {}
  }, [])

  React.useEffect(() => {
    let raf = 0
    const tick = () => {
      const ct = getCurrentTime()
      const du = getDuration()
      const p = isPlaying()
      const name = getCurrentTrackName()
      const vol = getVolume()
      setElapsed(ct)
      setDur(du)
      setPlaying(p)
      setTrackName(name)
      setVol(vol)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Position below the FPS widget
  React.useEffect(() => {
    const update = () => {
      const el = document.getElementById('top-right-widget')
      if (!el) return
      const r = el.getBoundingClientRect()
      if (Number.isFinite(r.bottom)) setTopPx(Math.ceil(r.bottom + 12))
    }
    update()
    window.addEventListener('resize', update)
    const id = window.setInterval(update, 1000)
    return () => { window.removeEventListener('resize', update); window.clearInterval(id) }
  }, [])

  // Handle dragging for progress and volume bars
  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingProgress) {
        const progressBar = document.querySelector('[data-progress-bar]') as HTMLDivElement
        if (progressBar) {
          const rect = progressBar.getBoundingClientRect()
          const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
          const d = getDuration()
          if (d > 0) setCurrentTime(ratio * d)
        }
      }
      if (isDraggingVolume) {
        const volumeBar = document.querySelector('[data-volume-bar]') as HTMLDivElement
        if (volumeBar) {
          const rect = volumeBar.getBoundingClientRect()
          const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
          setVolume(ratio)
          setVol(ratio)
        }
      }
    }

    const handleMouseUp = () => {
      setIsDraggingProgress(false)
      setIsDraggingVolume(false)
    }

    if (isDraggingProgress || isDraggingVolume) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDraggingProgress, isDraggingVolume])

  // no time labels in the compact widget

  if (!gameStarted) return null

  if (!gameStarted) return null

  return (
    <div ref={panelRef} style={{
      position: 'fixed',
      right: 12,
      top: topPx,
      width: fixedWidthPx,
      background: 'linear-gradient(90deg, rgba(32,39,49,0.95), rgba(22,27,35,0.95))',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '12px',
      padding: '8px 12px',
      color: '#ffffff',
      fontSize: '14px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      zIndex: 1001,
      pointerEvents: 'auto',
      backdropFilter: 'blur(24px)',
      boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 12px 32px rgba(0,0,0,0.5)'
    }}>
      {/* Player */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {/* Track name (gradient text, no pill) */}
        <div style={{
          alignSelf: 'flex-start',
          fontSize: 13,
          fontWeight: 800,
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          letterSpacing: -0.2
        }}>{trackName || '—'}</div>

        {/* Progress bar */}
        <div
          data-progress-bar
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
            const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
            const d = getDuration()
            if (d > 0) setCurrentTime(ratio * d)
          }}
          onMouseDown={(e) => {
            e.preventDefault()
            setIsDraggingProgress(true)
          }}
          style={{
            width: '100%', height: '8px', borderRadius: '6px',
            background: 'rgba(255,255,255,0.12)', cursor: 'pointer', position: 'relative'
          }}
        >
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${duration > 0 ? (Math.min(1, elapsed / duration) * 100) : 0}%`,
            background: 'linear-gradient(90deg, rgba(148,163,184,0.9), rgba(99,102,241,0.9))', borderRadius: '6px'
          }} />
        </div>

        {/* Control buttons */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
          <button
            aria-label="Previous track"
            onClick={() => { prevTrack(); setPlaying(isPlaying()); setTrackName(getCurrentTrackName()) }}
            style={{
              padding: '6px 8px',
              background: 'transparent',
              border: 'none',
              color: '#e2e8f0',
              cursor: 'pointer',
              fontSize: '22px'
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M18 7v10l-6-5 6-5zM10 7v10L4 12l6-5z"/>
            </svg>
          </button>
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
              padding: '6px 8px',
              background: 'transparent',
              border: 'none',
              color: '#e2e8f0',
              cursor: 'pointer',
              fontSize: '26px'
            }}
          >
            {playing ? (
              <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M6 5h4v14H6zM14 5h4v14h-4z"/>
              </svg>
            ) : (
              <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M8 5v14l11-7-11-7z"/>
              </svg>
            )}
          </button>
          <button
            aria-label="Next track"
            onClick={() => { nextTrack(); setPlaying(isPlaying()); setTrackName(getCurrentTrackName()) }}
            style={{
              padding: '6px 8px',
              background: 'transparent',
              border: 'none',
              color: '#e2e8f0',
              cursor: 'pointer',
              fontSize: '22px'
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M6 7v10l6-5-6-5zm8 0v10l6-5-6-5z"/>
            </svg>
          </button>
        </div>

        {/* Volume control */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '1px' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#94a3b8', flexShrink: 0 }}>
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
          </svg>
          <div
            data-volume-bar
            onClick={(e) => {
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
              const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
              setVolume(ratio)
              setVol(ratio)
            }}
            onMouseDown={(e) => {
              e.preventDefault()
              setIsDraggingVolume(true)
            }}
            style={{
              flex: 1, height: '6px', borderRadius: '4px',
              background: 'rgba(255,255,255,0.12)', cursor: 'pointer', position: 'relative'
            }}
          >
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: `${volume * 100}%`,
              background: 'linear-gradient(90deg, rgba(148,163,184,0.7), rgba(99,102,241,0.7))', borderRadius: '4px'
            }} />
          </div>
          <span style={{ fontSize: '11px', color: '#94a3b8', minWidth: '32px', textAlign: 'right' }}>
            {Math.round(volume * 100)}%
          </span>
        </div>
      </div>
    </div>
  )
}

export default AudioPanel
