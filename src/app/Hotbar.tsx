import { useUIStore } from '../state/ui'
import { useInventory } from '../state/inventory'
import grassIcon from '../assets/material_icons/grass.png'
import dirtIcon from '../assets/material_icons/dirt.png'
import stoneIcon from '../assets/material_icons/cobblestone.png'
import sandIcon from '../assets/material_icons/sand.png'
import woodIcon from '../assets/material_icons/wood.png'
import glassIcon from '../assets/material_icons/glass.png'
import waterIcon from '../assets/material_icons/water.png'

const ICONS: Record<number, string> = {
  1: grassIcon, // grass
  2: dirtIcon,
  3: stoneIcon,
  4: sandIcon,
  5: woodIcon,
  6: glassIcon,
  7: waterIcon,
}

export function Hotbar() {
  const selectedSlot = useUIStore(s => s.selectedSlot)
  const gameStarted = useUIStore(s => s.gameStarted)
  const slots = useInventory(s => s.slots)

  if (!gameStarted) return null

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
            {slot.count > 0 && (
              <div style={{ position: 'absolute', right: 2, bottom: 0, fontSize: 10, color: '#fff', textShadow: '1px 1px 0 #000' }}>{slot.count}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function Crosshair() {
  const gameStarted = useUIStore(s => s.gameStarted)
  const size = 14
  const thickness = 2

  if (!gameStarted) return null

  return (
    <div style={{ position: 'absolute', left: '50%', top: '50%', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', width: size, height: thickness, background: '#fff', transform: 'translate(-50%, -50%)' }} />
      <div style={{ position: 'absolute', width: thickness, height: size, background: '#fff', transform: 'translate(-50%, -50%)' }} />
    </div>
  )
}

export function FpsOverlay() {
  const fps = useUIStore(s => s.fps)
  return (
    <div style={{
      position: 'absolute', 
      right: 12, 
      top: 12, 
      padding: '8px 12px',
      background: 'linear-gradient(145deg, rgba(32,39,49,0.95), rgba(22,27,35,0.95))',
      color: '#f8f9fa',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '8px',
      fontSize: '12px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontWeight: 600,
      letterSpacing: 0.3,
      pointerEvents: 'none',
      backdropFilter: 'blur(10px)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
    }}>
      {fps} fps
    </div>
  )
}

export function PauseHint() {
  return (
    <div style={{
      position: 'absolute', 
      left: 12, 
      top: 12, 
      padding: '8px 12px',
      background: 'linear-gradient(145deg, rgba(32,39,49,0.95), rgba(22,27,35,0.95))',
      color: '#f8f9fa',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '8px',
      fontSize: '12px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontWeight: 600,
      letterSpacing: 0.3,
      pointerEvents: 'none',
      backdropFilter: 'blur(10px)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.3)'
    }}>
      Press P to pause
    </div>
  )
}

export function PauseMenu() {
  const paused = useUIStore(s => s.paused)
  const setPaused = useUIStore(s => s.setPaused)
  const bumpRestartToken = useUIStore(s => s.bumpRestartToken)
  const inGame = useUIStore(s => s.inGame)
  const setGameStarted = useUIStore(s => s.setGameStarted)
  if (!paused) return null
  return (
    <div style={{ 
      position: 'absolute', 
      inset: 0, 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      background: 'rgba(0,0,0,0.75)', 
      backdropFilter: 'blur(20px)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <div style={{ 
        width: 420, 
        padding: 32, 
        background: 'linear-gradient(145deg, rgba(32,39,49,0.95), rgba(22,27,35,0.95))', 
        borderRadius: 16, 
        color: '#f8f9fa', 
        boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 8px 32px rgba(0,0,0,0.4)', 
        border: '1px solid rgba(255,255,255,0.08)'
      }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          marginBottom: 24,
          paddingBottom: 16,
          borderBottom: '1px solid rgba(255,255,255,0.06)'
        }}>
          <div style={{ 
            fontSize: 28, 
            fontWeight: 800, 
            letterSpacing: -0.5,
            background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }}>
            Game Paused
          </div>
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          <button 
            onClick={() => setPaused(false)} 
            style={{ 
              flex: 1, 
              padding: '16px 24px', 
              background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', 
              color: '#fff', 
              border: 'none', 
              borderRadius: 12, 
              cursor: 'pointer', 
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              boxShadow: '0 8px 24px rgba(79,172,254,0.4)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              outline: 'none'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 12px 32px rgba(79,172,254,0.5)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(79,172,254,0.4)'
            }}
          >
            Resume
          </button>
          <button 
            onClick={() => { setGameStarted(false); bumpRestartToken(); setPaused(false) }} 
            style={{ 
              flex: 1, 
              padding: '16px 24px', 
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 
              color: '#fff', 
              border: 'none', 
              borderRadius: 12, 
              cursor: 'pointer', 
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              boxShadow: '0 8px 24px rgba(102,126,234,0.4)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              outline: 'none'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 12px 32px rgba(102,126,234,0.5)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(102,126,234,0.4)'
            }}
          >
            Restart
          </button>
        </div>
        {!inGame && (
          <div style={{ 
            marginTop: 20, 
            fontSize: 12, 
            color: '#64748b',
            textAlign: 'center',
            fontStyle: 'italic',
            lineHeight: 1.4
          }}>
            Click the canvas to enter the game and gain camera control.
          </div>
        )}
      </div>
    </div>
  )
}

