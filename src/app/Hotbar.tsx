import React from 'react'
import { useUIStore } from '../state/ui'
import { useInventory } from '../state/inventory'
import grassIcon from '../assets/material_icons/grass.png'
import dirtIcon from '../assets/material_icons/dirt.png'
import stoneIcon from '../assets/material_icons/cobblestone.png'
import sandIcon from '../assets/material_icons/sand.png'
import woodIcon from '../assets/material_icons/wood.png'
import branchIcon from '../assets/material_icons/branch.png'
import mapleBranchIcon from '../assets/material_icons/maple_branch.png'
import grassLeaveIcon from '../assets/material_icons/grass_leaves_icon.png'
import waterIcon from '../assets/material_icons/water.png'

const ICONS: Record<number, string> = {
  1: grassIcon, // grass
  2: dirtIcon,  // dirt
  3: stoneIcon, // stone (cobblestone texture)
  4: sandIcon,  // sand
  5: waterIcon, // water
  6: woodIcon,  // wood (trunk)
  7: branchIcon, // leaves
  8: mapleBranchIcon, // maple leaves
  9: grassLeaveIcon // decorative grass tuft
}

export function Hotbar() {
  const selectedSlot = useUIStore(s => s.selectedSlot)
  const inGame = useUIStore(s => s.inGame)
  const loading = useUIStore(s => s.loading)
  const slots = useInventory(s => s.slots)

  if (!inGame || loading) return null

  return (
    <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 4, padding: 4, background: 'rgba(0,0,0,0.25)', borderRadius: 6 }}>
      {slots.map((slot, idx) => {
        const isSel = idx === selectedSlot
        const icon = slot.blockId ? ICONS[slot.blockId] : undefined
        return (
          <div key={idx} style={{
            width: 44, height: 44, boxSizing: 'border-box',
            border: '2px solid', borderColor: isSel ? '#cfe9ef' : '#555',
            background: '#6b6e63',
            boxShadow: isSel ? '0 0 0 2px #1a1a1a inset' : '0 0 0 1px #2a2a2a inset',
            position: 'relative'
          }}>
            {icon && (
              <img src={icon} alt="" style={{ width: 32, height: 32, imageRendering: 'pixelated', position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }} />
            )}
            <div style={{ position: 'absolute', left: 2, top: 1, fontSize: 10, color: '#d8b35e', textShadow: '1px 1px 0 #000', fontWeight: 'bold' }}>{idx + 1}</div>
            {slot.count > 0 && (
              <div style={{ position: 'absolute', right: 2, bottom: 0, fontSize: 10, color: '#fff', textShadow: '1px 1px 0 #000' }}>{slot.count}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function CharacterSwitchHint() {
  const inGame = useUIStore(s => s.inGame)
  const loading = useUIStore(s => s.loading)
  const paused = useUIStore(s => s.paused)

  if (!inGame || loading || paused) return null

  return (
    <div
      aria-label="Press R to switch character"
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 84,
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 9px',
        background: 'rgba(8, 13, 18, 0.72)',
        border: '1px solid rgba(148,163,184,0.16)',
        borderRadius: 7,
        color: 'rgba(248,250,252,0.78)',
        fontSize: 11,
        lineHeight: '16px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        letterSpacing: 0.2,
        pointerEvents: 'none',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 6px 16px rgba(0,0,0,0.22)',
        zIndex: 1001,
        whiteSpace: 'nowrap',
      }}
    >
      <span>Press</span>
      <kbd
        style={{
          minWidth: 18,
          height: 18,
          padding: '0 5px',
          boxSizing: 'border-box',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid rgba(226,232,240,0.34)',
          borderBottomWidth: 2,
          borderRadius: 4,
          background: 'rgba(15,23,32,0.92)',
          color: '#f8fafc',
          fontSize: 10,
          lineHeight: '14px',
          fontFamily: 'inherit',
          fontWeight: 800,
          letterSpacing: 0.5,
        }}
      >
        R
      </kbd>
      <span>to switch character</span>
    </div>
  )
}

export function Crosshair() {
  const inGame = useUIStore(s => s.inGame)
  const loading = useUIStore(s => s.loading)
  const size = 14
  const thickness = 2

  if (!inGame || loading) return null

  return (
    <div style={{ position: 'absolute', left: '50%', top: '50%', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', width: size, height: thickness, background: '#fff', transform: 'translate(-50%, -50%)' }} />
      <div style={{ position: 'absolute', width: thickness, height: size, background: '#fff', transform: 'translate(-50%, -50%)' }} />
    </div>
  )
}

export function TopRightWidget() {
  const fps = useUIStore(s => s.fps)
  const gameStarted = useUIStore(s => s.gameStarted)
  const loading = useUIStore(s => s.loading)
  
  // Read time from engine globals for clock
  const [t, setT] = React.useState(0);
  React.useEffect(() => {
    let raf = 0
    const step = () => {
      const getFn = (window as unknown as { getGraphicsSettings?: () => { timeOfDay: { t: number } } }).getGraphicsSettings
      if (getFn) {
        const gs = getFn()
        if (gs && gs.timeOfDay) setT(gs.timeOfDay.t)
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Map t [0,1) such that t=0 -> 6:00 (sunrise), t=0.5 -> 18:00 (sunset)
  const hoursFloat = (6 + t * 24) % 12 // 12-hour clock
  const minutes = (hoursFloat % 1) * 60
  const hourAngle = (hoursFloat / 12) * 360 // deg
  const minuteAngle = (minutes / 60) * 360

  const clockSize = 36
  const center = clockSize / 2

  if (!gameStarted || loading) return null

  return (
    <div id="top-right-widget" style={{
      position: 'absolute',
      right: 12,
      top: 12,
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 12px',
      background: 'rgba(15, 23, 32, 0.94)',
      color: '#f8f9fa',
      border: '1px solid rgba(148,163,184,0.16)',
      borderRadius: '8px',
      fontSize: '12px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontWeight: 600,
      letterSpacing: 0.3,
      pointerEvents: 'none',
      backdropFilter: 'blur(10px)',
      boxShadow: '0 8px 20px rgba(0,0,0,0.28)',
      zIndex: 1001
    }}>
      {/* Pause hint */}
      <span style={{ opacity: 0.8 }}>Press P to pause</span>
      
      {/* Separator */}
      <div style={{ width: '1px', height: '16px', background: 'rgba(255,255,255,0.2)' }} />
      
      {/* FPS display */}
      <span style={{ color: '#2dd4bf', fontWeight: 700, minWidth: '48px', textAlign: 'center' }}>{fps} fps</span>
      
      {/* Separator */}
      <div style={{ width: '1px', height: '16px', background: 'rgba(255,255,255,0.2)' }} />
      
      {/* Clock */}
      <div style={{
        width: clockSize,
        height: clockSize,
        borderRadius: '50%',
        border: '2px solid rgba(255,255,255,0.4)',
        background: 'rgba(0,0,0,0.2)',
        position: 'relative',
        flexShrink: 0
      }}>
        {/* hour hand */}
        <div style={{
          position: 'absolute',
          left: center - 1.5,
          top: center - 8,
          width: 3,
          height: 8,
          background: '#fff',
          transformOrigin: '50% 100%',
          transform: `rotate(${hourAngle}deg)`,
          borderRadius: 2,
        }} />
        {/* minute hand */}
        <div style={{
          position: 'absolute',
          left: center - 0.5,
          top: center - 12,
          width: 1,
          height: 12,
          background: '#dde6ff',
          transformOrigin: '50% 100%',
          transform: `rotate(${minuteAngle}deg)`,
          borderRadius: 1,
        }} />
        {/* center dot */}
        <div style={{ position: 'absolute', left: center - 1.5, top: center - 1.5, width: 3, height: 3, background: '#fff', borderRadius: '50%' }} />
      </div>
    </div>
  )
}

// Legacy components for backward compatibility (now empty)
export function FpsOverlay() {
  return null
}

export function ClockOverlay() {
  return null
}

export function PauseHint() {
  return null
}

export function PauseMenu() {
  const paused = useUIStore(s => s.paused)
  const gameStarted = useUIStore(s => s.gameStarted)
  const loading = useUIStore(s => s.loading)
  const setPaused = useUIStore(s => s.setPaused)
  if (!paused || !gameStarted || loading) return null

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '16px',
      background: 'rgba(8, 13, 18, 0.76)',
      backdropFilter: 'blur(2px)',
      zIndex: 900,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 480,
        padding: 'clamp(20px, 5vw, 32px)',
        boxSizing: 'border-box',
        borderRadius: 16,
        background: 'rgba(15, 23, 32, 0.94)',
        border: '1px solid rgba(148,163,184,0.16)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.48)',
        backdropFilter: 'blur(20px)',
        color: '#f8f9fa',
      }}>
        <div style={{
          marginBottom: 'clamp(16px, 4vw, 24px)',
          paddingBottom: 16,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          fontSize: 'clamp(24px, 6vw, 28px)',
          fontWeight: 800,
          color: '#f8fafc',
        }}>
          Game Paused
        </div>
        <button
          onClick={() => {
            setPaused(false)
            ;(window as Window & { __requestGameEntryPointerLock?: () => void }).__requestGameEntryPointerLock?.()
          }}
          style={{
            width: '100%',
            height: 52,
            boxSizing: 'border-box',
            padding: '12px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#2dd4bf',
            color: '#061311',
            border: '1px solid rgba(94,234,212,0.5)',
            borderRadius: 12,
            cursor: 'pointer',
            fontWeight: 700,
            fontSize: 'clamp(14px, 3.5vw, 16px)',
            lineHeight: '20px',
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            boxShadow: '0 10px 24px rgba(0,0,0,0.32)',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            outline: 'none',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)'
            e.currentTarget.style.boxShadow = '0 14px 30px rgba(0,0,0,0.38)'
            e.currentTarget.style.background = '#5eead4'
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = 'translateY(0)'
            e.currentTarget.style.boxShadow = '0 10px 24px rgba(0,0,0,0.32)'
            e.currentTarget.style.background = '#2dd4bf'
          }}
        >
          Resume Game
        </button>
      </div>
    </div>
  )
}
