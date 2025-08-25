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
    <div style={{ 
      position: 'absolute', 
      inset: 0, 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      background: 'radial-gradient(ellipse at center, #1a1f2e 0%, #0f1419 100%)',
      color: '#f8f9fa',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <div style={{ 
        width: 480, 
        padding: 32, 
        borderRadius: 16, 
        background: 'linear-gradient(145deg, rgba(32,39,49,0.95), rgba(22,27,35,0.95))', 
        border: '1px solid rgba(255,255,255,0.08)', 
        boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 8px 32px rgba(0,0,0,0.4)',
        backdropFilter: 'blur(20px)'
      }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between', 
          marginBottom: 24,
          paddingBottom: 16,
          borderBottom: '1px solid rgba(255,255,255,0.06)'
        }}>
          <div style={{ 
            fontSize: 28, 
            fontWeight: 800, 
            letterSpacing: -0.5,
            background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text'
          }}>
            Minecraft Clone
          </div>
          <div style={{ 
            opacity: 0.75, 
            fontSize: 13,
            fontWeight: 500,
            color: '#94a3b8'
          }}>
            Configure World
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 24 }}>
          <label style={{ display: 'grid', gap: 12 }}>
            <span style={{ 
              fontSize: 14, 
              fontWeight: 600,
              color: '#e2e8f0',
              textTransform: 'uppercase',
              letterSpacing: 0.5
            }}>
              World Size
            </span>
            <div style={{ display: 'flex', gap: 12 }}>
              <select
                value={localCount}
                onChange={(e) => setLocalCount(Number(e.target.value))}
                style={{ 
                  flex: 1, 
                  padding: '14px 16px', 
                  background: 'linear-gradient(145deg, #1e2532, #151b26)', 
                  color: '#f1f5f9', 
                  border: '1px solid rgba(148,163,184,0.2)', 
                  borderRadius: 12,
                  fontSize: 14,
                  fontWeight: 500,
                  outline: 'none',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(148,163,184,0.4)'
                  e.currentTarget.style.background = 'linear-gradient(145deg, #232a3a, #1a212e)'
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(148,163,184,0.2)'
                  e.currentTarget.style.background = 'linear-gradient(145deg, #1e2532, #151b26)'
                }}
              >
                {OPTIONS.map((opt) => (
                  <option key={opt} value={opt} style={{ background: '#1e2532', color: '#f1f5f9' }}>
                    {opt} chunks ({Math.sqrt(opt)}×{Math.sqrt(opt)} grid)
                  </option>
                ))}
              </select>
            </div>
            <div style={{ 
              fontSize: 12, 
              color: '#64748b',
              fontStyle: 'italic',
              lineHeight: 1.4
            }}>
              Recommended: 9 chunks for balanced performance. Larger worlds may impact frame rate.
            </div>
          </label>

          <button
            onClick={() => { setChunkCount(localCount); setGameStarted(true); }}
            style={{ 
              padding: '16px 24px', 
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 
              color: '#fff', 
              border: 'none', 
              borderRadius: 12, 
              cursor: 'pointer', 
              fontWeight: 700,
              fontSize: 16,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              boxShadow: '0 8px 24px rgba(102,126,234,0.4), 0 4px 12px rgba(118,75,162,0.3)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              outline: 'none',
              position: 'relative',
              overflow: 'hidden'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 12px 32px rgba(102,126,234,0.5), 0 6px 16px rgba(118,75,162,0.4)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(102,126,234,0.4), 0 4px 12px rgba(118,75,162,0.3)'
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'translateY(0) scale(0.98)'
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px) scale(1)'
            }}
          >
            Launch World
          </button>
        </div>
      </div>
    </div>
  )
}

export default StartPanel

