import { useUIStore } from '../state/ui'

export function Hotbar() {
  const selectedSlot = useUIStore(s => s.selectedSlot)
  const hotbar = useUIStore(s => s.hotbar)

  return (
    <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 8 }}>
      {hotbar.map((id, idx) => (
        <div key={idx} style={{
          width: 48, height: 48, border: '2px solid',
          borderColor: idx === selectedSlot ? '#fff' : '#666',
          background: '#1b1e23', color: '#cfd8dc',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'monospace', fontSize: 12
        }}>
          {id}
        </div>
      ))}
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


