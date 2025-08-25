import { useState, useEffect } from 'react'
import { useUIStore } from '../state/ui'

// Allowed total chunk options: odd squares to ensure a single center chunk
const OPTIONS = [1, 9, 25, 49]

export function StartPanel() {
  const gameStarted = useUIStore(s => s.gameStarted)
  const setGameStarted = useUIStore(s => s.setGameStarted)
  const chunkCount = useUIStore(s => s.chunkCount)
  const setChunkCount = useUIStore(s => s.setChunkCount)

  const [localCount, setLocalCount] = useState<number>(chunkCount || 9)

  useEffect(() => {
    // Keep in sync if store changes elsewhere
    setLocalCount(chunkCount)
  }, [chunkCount])

  if (gameStarted) return null

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(180deg,#0b0d10,#0a0c0f)', color: '#eaeaea' }}>
      <div style={{ width: 420, padding: 20, borderRadius: 12, background: 'linear-gradient(180deg, rgba(28,31,36,0.98), rgba(18,20,23,0.98))', border: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 14px 40px rgba(0,0,0,0.55)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 0.5 }}>Minecraft Clone</div>
          <div style={{ opacity: 0.7, fontSize: 12 }}>Select world size</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
          <label style={{ display: 'grid', gap: 8 }}>
            <span style={{ fontSize: 13, opacity: 0.85 }}>Total chunks</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <select
                value={localCount}
                onChange={(e) => setLocalCount(Number(e.target.value))}
                style={{ flex: 1, padding: '10px 12px', background: '#11161b', color: '#eaeaea', border: '1px solid #2a2f35', borderRadius: 8 }}
              >
                {OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt} chunks ({Math.sqrt(opt)}x{Math.sqrt(opt)})
                  </option>
                ))}
              </select>
            </div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Default is 9 (3x3). Restart or refresh resets this.
            </div>
          </label>

          <button
            onClick={() => { setChunkCount(localCount); setGameStarted(true); }}
            style={{ padding: '12px 16px', background: 'linear-gradient(180deg,#3a7bd5,#2a5298)', color: '#fff', border: '1px solid #243f7a', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}
          >
            Start Game
          </button>
        </div>
      </div>
    </div>
  )
}

export default StartPanel

