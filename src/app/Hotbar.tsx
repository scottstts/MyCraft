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

export function TopRightWidget() {
  const fps = useUIStore(s => s.fps)
  const gameStarted = useUIStore(s => s.gameStarted)
  
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

  if (!gameStarted) return null

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
  const setPaused = useUIStore(s => s.setPaused)
  const bumpRestartToken = useUIStore(s => s.bumpRestartToken)
  const inGame = useUIStore(s => s.inGame)
  const setGameStarted = useUIStore(s => s.setGameStarted)
  const setLoading = useUIStore(s => s.setLoading)
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
        background: 'rgba(15, 23, 32, 0.96)', 
        borderRadius: 16, 
        color: '#f8f9fa', 
        boxShadow: '0 24px 60px rgba(0,0,0,0.48)', 
        border: '1px solid rgba(148,163,184,0.16)'
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
            letterSpacing: 0,
            color: '#f8fafc'
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
              background: '#2dd4bf', 
              color: '#061311', 
              border: '1px solid rgba(94,234,212,0.5)', 
              borderRadius: 12, 
              cursor: 'pointer', 
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              boxShadow: '0 10px 24px rgba(0,0,0,0.32)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              outline: 'none'
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
            Resume
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
                    // If user canceled, stop here silently
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
                // Optional small delay for UX
                await new Promise(resolve => setTimeout(resolve, 500))
              } catch (e) {
                console.error('Save failed:', e)
              } finally {
                setLoading(false)
              }
            }} 
            style={{ 
              flex: 1, 
              padding: '16px 24px', 
              background: '#10b981', 
              color: '#04130e', 
              border: '1px solid rgba(52,211,153,0.45)', 
              borderRadius: 12, 
              cursor: 'pointer', 
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              boxShadow: '0 10px 24px rgba(0,0,0,0.32)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              outline: 'none'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 14px 30px rgba(0,0,0,0.38)'
              e.currentTarget.style.background = '#34d399'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 10px 24px rgba(0,0,0,0.32)'
              e.currentTarget.style.background = '#10b981'
            }}
          >
            Save
          </button>
          <button 
            onClick={() => { setGameStarted(false); bumpRestartToken(); setPaused(false) }} 
            style={{ 
              flex: 1, 
              padding: '16px 24px', 
              background: '#1f2937', 
              color: '#f8fafc', 
              border: '1px solid rgba(148,163,184,0.22)', 
              borderRadius: 12, 
              cursor: 'pointer', 
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              boxShadow: '0 10px 24px rgba(0,0,0,0.28)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              outline: 'none'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 14px 30px rgba(0,0,0,0.34)'
              e.currentTarget.style.background = '#253244'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 10px 24px rgba(0,0,0,0.28)'
              e.currentTarget.style.background = '#1f2937'
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
