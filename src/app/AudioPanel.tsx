import React from 'react'
import { useUIStore } from '../state/ui'
import { tryPlayOnUserGesture, nextTrack, prevTrack, isPlaying, getCurrentTime, getDuration, setCurrentTime, getCurrentTrackName, setDesiredPlaying } from './BgMusic'

// Always-visible music player widget (top-right), using the improved player UI
export const AudioPanel: React.FC = () => {
  const gameStarted = useUIStore(s => s.gameStarted)
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const [playing, setPlaying] = React.useState(false)
  const [elapsed, setElapsed] = React.useState(0)
  const [duration, setDur] = React.useState(0)
  const [trackName, setTrackName] = React.useState('')
  const [topPx, setTopPx] = React.useState<number>(84)
  const [wPx, setWPx] = React.useState<number>(280)

  React.useEffect(() => {
    try { setPlaying(isPlaying()) } catch {}
    try {
      setElapsed(getCurrentTime())
      setDur(getDuration())
      setTrackName(getCurrentTrackName())
    } catch {}
  }, [])

  React.useEffect(() => {
    let raf = 0
    const tick = () => {
      const ct = getCurrentTime()
      const du = getDuration()
      const p = isPlaying()
      const name = getCurrentTrackName()
      setElapsed(ct)
      setDur(du)
      setPlaying(p)
      setTrackName(name)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Align width and position with the FPS widget above
  React.useEffect(() => {
    const update = () => {
      const el = document.getElementById('top-right-widget')
      if (!el) return
      const r = el.getBoundingClientRect()
      if (Number.isFinite(r.width) && r.width > 0) setWPx(Math.ceil(r.width))
      if (Number.isFinite(r.bottom)) setTopPx(Math.ceil(r.bottom + 12))
    }
    update()
    window.addEventListener('resize', update)
    const id = window.setInterval(update, 1000)
    return () => { window.removeEventListener('resize', update); window.clearInterval(id) }
  }, [])

  // no time labels in the compact widget

  if (!gameStarted) return null

  if (!gameStarted) return null

  return (
    <div ref={panelRef} style={{
      position: 'fixed',
      right: 12,
      top: topPx,
      width: wPx,
      background: 'linear-gradient(135deg, rgba(20,25,35,0.98) 0%, rgba(15,20,28,0.98) 100%)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '12px',
      padding: '12px',
      color: '#ffffff',
      fontSize: '14px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      zIndex: 1200,
      pointerEvents: 'auto',
      backdropFilter: 'blur(24px)',
      boxShadow: '0 24px 64px rgba(0,0,0,0.6), 0 12px 32px rgba(0,0,0,0.5)'
    }}>
      {/* Player */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect()
            const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
            const d = getDuration()
            if (d > 0) setCurrentTime(ratio * d)
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
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginTop: '2px' }}>
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
      </div>
    </div>
  )
}

export default AudioPanel
