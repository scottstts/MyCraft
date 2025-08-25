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
    <div style={{ position: 'absolute', right: 12, top: 12, color: '#cfe9ef', fontFamily: 'monospace', fontSize: 12, padding: '6px 8px', background: 'rgba(0,0,0,0.35)', borderRadius: 6, pointerEvents: 'none' }}>
      {fps} fps
    </div>
  )
}

export function PauseHint() {
  return (
    <div style={{ position: 'absolute', left: 12, top: 12, color: '#cfe9ef', fontFamily: 'monospace', fontSize: 12, padding: '6px 8px', background: 'rgba(0,0,0,0.35)', borderRadius: 6, pointerEvents: 'none' }}>
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
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}>
      <div style={{ minWidth: 360, padding: 20, background: 'linear-gradient(180deg, rgba(28,31,36,0.98), rgba(18,20,23,0.98))', borderRadius: 10, color: '#eaeaea', boxShadow: '0 12px 36px rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 0.5 }}>Paused</div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => setPaused(false)} style={{ flex: 1, padding: '10px 14px', background: 'linear-gradient(180deg,#2ea043,#1f6f2e)', color: '#fff', border: '1px solid #1d5b28', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>Resume</button>
          <button onClick={() => { setGameStarted(false); bumpRestartToken(); setPaused(false) }} style={{ flex: 1, padding: '10px 14px', background: 'linear-gradient(180deg,#3a7bd5,#2a5298)', color: '#fff', border: '1px solid #243f7a', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>Restart</button>
        </div>
        {!inGame && (
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>Click the canvas to enter the game.</div>
        )}
      </div>
    </div>
  )
}

