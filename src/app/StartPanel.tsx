import { useState, useEffect } from 'react'
import { useUIStore } from '../state/ui'
import type { WorldSaveFile, WorldSavePayload } from '../types/save'
import { SAVE_PUBLIC_KEY_ID, SAVE_SIGNATURE_ALG, verifyPayload, bytesFromBase64, base64FromBytes } from '../shared/save'
import { CHUNK_SIZE } from '../config/constants'

// Allowed total chunk options: odd squares to ensure a single center chunk
const CHUNK_COUNT_OPTIONS = [1, 9, 25, 49, 81, 121, 169] // 1x1, 3x3, 5x5, 7x7, 9x9, 11x11, 13x13

// Chunk size options: { label, size }
const CHUNK_SIZE_OPTIONS = [
  { label: 'Small (32×64×32)', size: { x: 32, y: 64, z: 32 } },
  { label: 'Medium (48×96×48)', size: { x: 48, y: 96, z: 48 } }, // Default
  { label: 'Large (64×128×64)', size: { x: 64, y: 128, z: 64 } },
]

export function StartPanel() {
  const gameStarted = useUIStore(s => s.gameStarted)
  const setGameStarted = useUIStore(s => s.setGameStarted)
  const chunkCount = useUIStore(s => s.chunkCount)
  const setChunkCount = useUIStore(s => s.setChunkCount)
  const chunkSize = useUIStore(s => s.chunkSize)
  const setChunkSize = useUIStore(s => s.setChunkSize)

  const [localCount, setLocalCount] = useState<number>(chunkCount || 9)
  const [localSize, setLocalSize] = useState<{ x: number; y: number; z: number }>(
    chunkSize || { x: 48, y: 96, z: 48 }
  )

  useEffect(() => {
    // Keep in sync if store changes elsewhere
    setLocalCount(chunkCount)
    setLocalSize(chunkSize)
  }, [chunkCount, chunkSize])

  if (gameStarted) return null

  const handleLoadWorld = async () => {
    try {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'application/json'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        const text = await file.text()
        let json: unknown
        try {
          json = JSON.parse(text)
        } catch {
          alert('Invalid JSON file.')
          return
        }
        const save = json as Partial<WorldSaveFile>
        if (save.kind !== 'MyCraftWorld' || save.version !== 1) {
          alert('Not a MyCraft world save.')
          return
        }
        if (save.publicKeyId !== SAVE_PUBLIC_KEY_ID || save.signatureAlg !== SAVE_SIGNATURE_ALG) {
          alert('Save file not recognized (signature key mismatch).')
          return
        }
        // Build payload view to re-verify signature
        const payload: WorldSavePayload = {
          kind: 'MyCraftWorld',
          version: 1,
          meta: save.meta as WorldSavePayload['meta'],
          settings: save.settings as WorldSavePayload['settings'],
          chunks: save.chunks as WorldSavePayload['chunks'],
        }
        // Basic presence checks
        if (typeof save.signatureB64 !== 'string' || !save.signatureB64) {
          alert('Save file missing signature.')
          return
        }
        // Verify signature. Any error is treated as invalid.
        try {
          // Enforce canonical base64 form so simple edits like removing padding are caught
          const sigBytes = bytesFromBase64(save.signatureB64)
          const canonical = base64FromBytes(sigBytes)
          if (canonical !== save.signatureB64) {
            alert('Save signature is malformed (base64 altered).')
            return
          }
          const ok = await verifyPayload(payload, save.signatureB64)
          if (!ok) {
            alert('Save signature verification failed (data may be corrupted).')
            return
          }
        } catch (err) {
          console.error('Signature verification error:', err)
          alert('Unable to verify save signature. The file may be corrupted or browser crypto is unavailable.')
          return
        }
        // Validate chunk size compatibility with current build
        const s = payload.settings.chunkSize
        if (!s || typeof s.x !== 'number' || typeof s.y !== 'number' || typeof s.z !== 'number') {
          alert('Save file missing chunk size.')
          return
        }
        if (s.x !== CHUNK_SIZE.x || s.y !== CHUNK_SIZE.y || s.z !== CHUNK_SIZE.z) {
          alert(`Save chunk size ${s.x}x${s.y}x${s.z} does not match game chunk size ${CHUNK_SIZE.x}x${CHUNK_SIZE.y}x${CHUNK_SIZE.z}.`)
          return
        }
        // Validate chunks array shape and data sanity
        if (!Array.isArray(payload.chunks) || payload.chunks.length === 0) {
          alert('Save has no chunks.')
          return
        }
        const expectedLen = s.x * s.y * s.z
        for (const ch of payload.chunks) {
          if (!ch || typeof ch !== 'object') {
            alert('Save chunk entry invalid.')
            return
          }
          const { key, cx, cy, cz, size, voxelsB64 } = ch as {
            key: string; cx: number; cy: number; cz: number; size: { x: number; y: number; z: number }; voxelsB64: string;
          }
          if (typeof key !== 'string' || `${cx},${cy},${cz}` !== key) {
            alert('Save chunk key mismatch.')
            return
          }
          if (!size || size.x !== s.x || size.y !== s.y || size.z !== s.z) {
            alert('Save chunk size mismatch.')
            return
          }
          if (typeof voxelsB64 !== 'string' || !voxelsB64) {
            alert('Save chunk data missing.')
            return
          }
          try {
            const bytes = bytesFromBase64(voxelsB64)
            if (bytes.length !== expectedLen) {
              alert('Save chunk data corrupted (length mismatch).')
              return
            }
          } catch (e) {
            console.error('Chunk decode error:', e)
            alert('Save chunk data is not valid base64.')
            return
          }
        }
        // Push into global for engine to ingest after start
        ;(window as Window & { __WORLD_SNAPSHOT?: WorldSaveFile; __WORLD_SNAPSHOT_VERIFIED?: boolean }).__WORLD_SNAPSHOT = save as WorldSaveFile
        ;(window as Window & { __WORLD_SNAPSHOT?: WorldSaveFile; __WORLD_SNAPSHOT_VERIFIED?: boolean }).__WORLD_SNAPSHOT_VERIFIED = true
        // Sync UI selections from save for consistency
        setChunkCount(payload.settings.chunkCount)
        setChunkSize(payload.settings.chunkSize)
        setGameStarted(true)
      }
      input.click()
    } catch (e) {
      console.error('Load world failed:', e)
      alert('Failed to load world save.')
    }
  }

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
            MyCraft
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
                {CHUNK_COUNT_OPTIONS.map((opt) => (
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
              Start with 9 chunks. Larger worlds may impact performance depending on your device.
            </div>
          </label>

          <label style={{ display: 'grid', gap: 12 }}>
            <span style={{ 
              fontSize: 14, 
              fontWeight: 600,
              color: '#e2e8f0',
              textTransform: 'uppercase',
              letterSpacing: 0.5
            }}>
              Chunk Size
            </span>
            <div style={{ display: 'flex', gap: 12 }}>
              <select
                value={JSON.stringify(localSize)}
                onChange={(e) => setLocalSize(JSON.parse(e.target.value))}
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
                {CHUNK_SIZE_OPTIONS.map((opt) => (
                  <option key={opt.label} value={JSON.stringify(opt.size)} style={{ background: '#1e2532', color: '#f1f5f9' }}>
                    {opt.label}
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
              Chunk size affects world detail and performance.
            </div>
          </label>

          <button
            onClick={() => { 
              setChunkCount(localCount); 
              setChunkSize(localSize); 
              setGameStarted(true); 
            }}
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

          <button
            onClick={handleLoadWorld}
            style={{ 
              padding: '14px 18px',
              background: 'linear-gradient(135deg, #00c6ff 0%, #0072ff 100%)',
              color: '#fff',
              border: 'none',
              borderRadius: 12,
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              boxShadow: '0 8px 24px rgba(0,114,255,0.35)',
              transition: 'all 0.25s ease',
              outline: 'none'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)'
              e.currentTarget.style.boxShadow = '0 12px 32px rgba(0,114,255,0.45)'
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,114,255,0.35)'
            }}
            onMouseDown={(e) => { e.currentTarget.style.transform = 'translateY(0) scale(0.98)' }}
            onMouseUp={(e) => { e.currentTarget.style.transform = 'translateY(-2px) scale(1)' }}
          >
            Load World
          </button>
        </div>
      </div>
    </div>
  )
}

export default StartPanel
