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
  const slots = useInventory(s => s.slots)

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
  const size = 14
  const thickness = 2
  return (
    <div style={{ position: 'absolute', left: '50%', top: '50%', pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', width: size, height: thickness, background: '#fff', transform: 'translate(-50%, -50%)' }} />
      <div style={{ position: 'absolute', width: thickness, height: size, background: '#fff', transform: 'translate(-50%, -50%)' }} />
    </div>
  )
}


