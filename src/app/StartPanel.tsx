import { useState, useEffect, useRef } from 'react'
import { useUIStore } from '../state/ui'
import { setDesiredPlaying } from './BgMusic'
import type { WorldSaveFile, WorldSavePayload, SavedInventory } from '../types/save'
import { SAVE_PUBLIC_KEY_ID, SAVE_SIGNATURE_ALG, SAVE_ENC_ALG, verifyPayload, bytesFromBase64, base64FromBytes, decryptPayload } from '../shared/save'
import { CHUNK_SIZE } from '../config/constants'
import { replaceInventory } from '../state/inventory'
import { isMobileDevice, isSafari } from '../shared/browser'
import bgImage from '../assets/others/bg_img.png'

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
  const setLoading = useUIStore(s => s.setLoading)

  const [localCount, setLocalCount] = useState<number>(chunkCount || 9)
  const [localSize, setLocalSize] = useState<{ x: number; y: number; z: number }>(
    chunkSize || { x: 48, y: 96, z: 48 }
  )
  const [showControls, setShowControls] = useState<boolean>(false)
  const controlsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Keep in sync if store changes elsewhere
    setLocalCount(chunkCount)
    setLocalSize(chunkSize)
  }, [chunkCount, chunkSize])

  useEffect(() => {
    // Close controls when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      if (controlsRef.current && !controlsRef.current.contains(event.target as Node)) {
        setShowControls(false)
      }
    }

    if (showControls) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showControls])

  if (gameStarted) return null

  const handleLoadWorld = async () => {
    // Block launch on mobile devices or Safari desktop
    if (isMobileDevice() || (isSafari() && !isMobileDevice())) {
      alert('Please visit it on desktop, and in Chrome or other Chromium browsers.')
      return
    }
    try {
      setLoading(true)
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'application/json'
      input.oncancel = () => {
        setLoading(false)
      }
      // Fallback: detect when user focuses back on window without selecting a file
      const handleFocus = () => {
        setTimeout(() => {
          if (!input.files || input.files.length === 0) {
            setLoading(false)
          }
          window.removeEventListener('focus', handleFocus)
        }, 100)
      }
      window.addEventListener('focus', handleFocus)
      input.onchange = async () => {
        window.removeEventListener('focus', handleFocus)
        const file = input.files?.[0]
        if (!file) {
          setLoading(false)
          return
        }
        const text = await file.text()
        let json: unknown
        try {
          json = JSON.parse(text)
        } catch {
          alert('Invalid JSON file.')
          setLoading(false)
          return
        }
        const save = json as WorldSaveFile
        let payload: WorldSavePayload
        // Accept v2 (encrypted) only
        if (save.kind !== 'MyCraftWorld') {
          alert('Not a MyCraft world save.')
          setLoading(false)
          return
        }
        if (save.version !== 2 || save.encAlg !== SAVE_ENC_ALG) {
          alert('Save file version not supported.')
          setLoading(false)
          return
        }
        if (save.publicKeyId !== SAVE_PUBLIC_KEY_ID || save.signatureAlg !== SAVE_SIGNATURE_ALG) {
          alert('Save file not recognized (metadata mismatch).')
          setLoading(false)
          return
        }
        if (!save.ivB64 || !save.cipherB64 || !save.signatureB64) {
          alert('Save file missing fields (iv/cipher/signature).')
          setLoading(false)
          return
        }
        try {
          payload = await decryptPayload(save.ivB64, save.cipherB64)
        } catch (e) {
          console.error('Decryption failed:', e)
          alert('Save file decryption failed. The file may be corrupted.')
          setLoading(false)
          return
        }
        const sigB64 = save.signatureB64
        // Basic presence checks for signature
        if (typeof sigB64 !== 'string' || !sigB64) {
          alert('Save file missing signature.')
          setLoading(false)
          return
        }
        // Verify signature. Any error is treated as invalid.
        try {
          const sigBytes = bytesFromBase64(sigB64)
          const canonical = base64FromBytes(sigBytes)
          if (canonical !== sigB64) {
            alert('Save signature is malformed (base64 altered).')
            setLoading(false)
            return
          }
          const ok = await verifyPayload(payload, sigB64)
          if (!ok) {
            alert('Save signature verification failed (data may be corrupted).')
            setLoading(false)
            return
          }
        } catch (err) {
          console.error('Signature verification error:', err)
          alert('Unable to verify save signature. The file may be corrupted or browser crypto is unavailable.')
          setLoading(false)
          return
        }
        // Validate chunk size compatibility with current build
        const s = payload.settings.chunkSize
        if (!s || typeof s.x !== 'number' || typeof s.y !== 'number' || typeof s.z !== 'number') {
          alert('Save file missing chunk size.')
          setLoading(false)
          return
        }
        if (s.x !== CHUNK_SIZE.x || s.y !== CHUNK_SIZE.y || s.z !== CHUNK_SIZE.z) {
          alert(`Save chunk size ${s.x}x${s.y}x${s.z} does not match game chunk size ${CHUNK_SIZE.x}x${CHUNK_SIZE.y}x${CHUNK_SIZE.z}.`)
          setLoading(false)
          return
        }
        // Validate chunks array shape and data sanity
        if (!Array.isArray(payload.chunks) || payload.chunks.length === 0) {
          alert('Save has no chunks.')
          setLoading(false)
          return
        }
        const expectedLen = s.x * s.y * s.z
        for (const ch of payload.chunks) {
          if (!ch || typeof ch !== 'object') {
            alert('Save chunk entry invalid.')
            setLoading(false)
            return
          }
          const { key, cx, cy, cz, size, voxelsB64 } = ch as {
            key: string; cx: number; cy: number; cz: number; size: { x: number; y: number; z: number }; voxelsB64: string;
          }
          if (typeof key !== 'string' || `${cx},${cy},${cz}` !== key) {
            alert('Save chunk key mismatch.')
            setLoading(false)
            return
          }
          if (!size || size.x !== s.x || size.y !== s.y || size.z !== s.z) {
            alert('Save chunk size mismatch.')
            setLoading(false)
            return
          }
          if (typeof voxelsB64 !== 'string' || !voxelsB64) {
            alert('Save chunk data missing.')
            setLoading(false)
            return
          }
          try {
            const bytes = bytesFromBase64(voxelsB64)
            if (bytes.length !== expectedLen) {
              alert('Save chunk data corrupted (length mismatch).')
              setLoading(false)
              return
            }
          } catch (e) {
            console.error('Chunk decode error:', e)
            alert('Save chunk data is not valid base64.')
            setLoading(false)
            return
          }
        }
        // Validate and apply inventory if present
        const inv = payload.inventory as SavedInventory | undefined
        if (inv) {
          const slots = Array.isArray(inv.slots) ? inv.slots : []
          if (slots.length !== 9) {
            alert('Save inventory invalid (must have 9 slots).')
            setLoading(false)
            return
          }
          // Normalize and set inventory
          replaceInventory(slots.map((s) => ({
            blockId: (s && (s.blockId === null || typeof s.blockId === 'number')) ? s.blockId : null,
            count: Math.max(0, Math.floor((s && typeof s.count === 'number') ? s.count : 0)),
          })))
          if (typeof inv.selectedSlot === 'number') {
            const sel = Math.max(0, Math.min(8, Math.floor(inv.selectedSlot)))
            useUIStore.getState().setSelectedSlot(sel)
          }
        } else {
          // If no inventory in save, reset to empty
          replaceInventory(Array.from({ length: 9 }, () => ({ blockId: null, count: 0 })))
          useUIStore.getState().setSelectedSlot(0)
        }

        // Push into global for engine to ingest after start
        // For engine: pass the verified plaintext payload only
        ;(window as Window & { __WORLD_SNAPSHOT?: WorldSavePayload; __WORLD_SNAPSHOT_VERIFIED?: boolean }).__WORLD_SNAPSHOT = payload
        ;(window as Window & { __WORLD_SNAPSHOT?: WorldSaveFile; __WORLD_SNAPSHOT_VERIFIED?: boolean }).__WORLD_SNAPSHOT_VERIFIED = true
        // Sync UI selections from save for consistency
        setChunkCount(payload.settings.chunkCount)
        setChunkSize(payload.settings.chunkSize)
        setGameStarted(true)
        // Start background music as we enter the world; UI controls it after
        setDesiredPlaying(true)
        setLoading(false)
      }
      input.click()
    } catch (e) {
      console.error('Load world failed:', e)
      alert('Failed to load world save.')
      setLoading(false)
    }
  }

  const blocked = isMobileDevice() || (isSafari() && !isMobileDevice())

  return (
    <div style={{ 
      position: 'absolute', 
      inset: 0, 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center', 
      backgroundImage: `url(${bgImage})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      color: '#f8f9fa',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
    }}>
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(8, 13, 18, 0.76)',
        backdropFilter: 'blur(2px)'
      }} />
      <div style={{ 
        width: '100%',
        maxWidth: 480,
        margin: '0 16px',
        padding: 'clamp(20px, 5vw, 32px)', 
        borderRadius: 16, 
        background: 'rgba(15, 23, 32, 0.94)', 
        border: '1px solid rgba(148,163,184,0.16)', 
        boxShadow: '0 24px 60px rgba(0,0,0,0.48)',
        backdropFilter: 'blur(20px)',
        position: 'relative',
        zIndex: 1,
        boxSizing: 'border-box'
      }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between', 
          marginBottom: 'clamp(16px, 4vw, 24px)',
          paddingBottom: 16,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexWrap: 'wrap',
          gap: 8
        }}>
          <div style={{ 
            fontSize: 'clamp(24px, 6vw, 28px)', 
            fontWeight: 800, 
            letterSpacing: 0,
            color: '#f8fafc'
          }}>
            MyCraft
          </div>
          <div 
            ref={controlsRef}
            style={{ 
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <div 
              onClick={() => setShowControls(!showControls)}
              style={{ 
                opacity: 1, 
                fontSize: 14,
                fontWeight: 700,
                color: '#e2e8f0',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 8,
                transition: 'all 0.2s ease',
                userSelect: 'none',
                background: 'rgba(148,163,184,0.1)',
                border: '1px solid rgba(148,163,184,0.2)'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.opacity = '1'
                e.currentTarget.style.background = 'rgba(148,163,184,0.2)'
                e.currentTarget.style.borderColor = 'rgba(148,163,184,0.3)'
                e.currentTarget.style.transform = 'translateY(-1px)'
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.opacity = '1'
                e.currentTarget.style.background = 'rgba(148,163,184,0.1)'
                e.currentTarget.style.borderColor = 'rgba(148,163,184,0.2)'
                e.currentTarget.style.transform = 'translateY(0)'
              }}
            >
              Player Control
              <span style={{ 
                fontSize: 10,
                transform: showControls ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease'
              }}>
                ▼
              </span>
            </div>
            
            {showControls && (
              <div style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 8,
                minWidth: 'clamp(240px, 70vw, 320px)',
                maxWidth: 'min(90vw, 320px)',
                padding: 'clamp(12px, 3vw, 16px)',
                background: 'rgba(12, 18, 26, 0.98)',
                border: '1px solid rgba(148,163,184,0.18)',
                borderRadius: 'clamp(8px, 2vw, 12px)',
                boxShadow: '0 12px 32px rgba(0,0,0,0.6), 0 4px 16px rgba(0,0,0,0.4)',
                backdropFilter: 'blur(20px)',
                zIndex: 10,
                animation: 'fadeIn 0.2s ease-out',
                // Prevent overflow on small screens
                transform: 'translateX(min(0px, calc(-100% + 100vw - 32px)))'
              }}>
                <div style={{
                  fontSize: 'clamp(11px, 2.5vw, 12px)',
                  fontWeight: 600,
                  color: '#e2e8f0',
                  marginBottom: 'clamp(8px, 2vw, 12px)',
                  textAlign: 'center',
                  letterSpacing: 0.5
                }}>
                  PLAYER CONTROLS
                </div>
                <div style={{ display: 'grid', gap: 'clamp(16px, 4vw, 20px)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 'clamp(12px, 2.8vw, 13px)', color: '#cbd5e1', marginTop: 'clamp(8px, 2vw, 12px)' }}>Movement</span>
                    <div style={{ 
                      display: 'grid', 
                      gridTemplateColumns: 'repeat(3, 1fr)', 
                      gridTemplateRows: 'repeat(2, 1fr)',
                      gap: 'clamp(3px, 1vw, 4px)', 
                      width: 'clamp(90px, 22vw, 108px)',
                      height: 'clamp(60px, 14vw, 72px)'
                    }}>
                      {/* Empty cell */}
                      <div></div>
                      {/* W key - top center */}
                      <kbd style={{
                        width: '100%',
                        height: '100%',
                        background: '#1f2937',
                        color: '#f3f4f6',
                        borderRadius: 'clamp(4px, 1vw, 6px)',
                        fontSize: 'clamp(10px, 2.2vw, 12px)',
                        fontWeight: 700,
                        border: '1px solid rgba(255,255,255,0.15)',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.3), inset 0 1px 2px rgba(255,255,255,0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        W
                      </kbd>
                      {/* Empty cell */}
                      <div></div>
                      {/* A key - bottom left */}
                      <kbd style={{
                        width: '100%',
                        height: '100%',
                        background: '#1f2937',
                        color: '#f3f4f6',
                        borderRadius: 'clamp(4px, 1vw, 6px)',
                        fontSize: 'clamp(10px, 2.2vw, 12px)',
                        fontWeight: 700,
                        border: '1px solid rgba(255,255,255,0.15)',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.3), inset 0 1px 2px rgba(255,255,255,0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        A
                      </kbd>
                      {/* S key - bottom center */}
                      <kbd style={{
                        width: '100%',
                        height: '100%',
                        background: '#1f2937',
                        color: '#f3f4f6',
                        borderRadius: 'clamp(4px, 1vw, 6px)',
                        fontSize: 'clamp(10px, 2.2vw, 12px)',
                        fontWeight: 700,
                        border: '1px solid rgba(255,255,255,0.15)',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.3), inset 0 1px 2px rgba(255,255,255,0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        S
                      </kbd>
                      {/* D key - bottom right */}
                      <kbd style={{
                        width: '100%',
                        height: '100%',
                        background: '#1f2937',
                        color: '#f3f4f6',
                        borderRadius: 'clamp(4px, 1vw, 6px)',
                        fontSize: 'clamp(10px, 2.2vw, 12px)',
                        fontWeight: 700,
                        border: '1px solid rgba(255,255,255,0.15)',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.3), inset 0 1px 2px rgba(255,255,255,0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        D
                      </kbd>
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 'clamp(12px, 2.8vw, 13px)', color: '#cbd5e1' }}>Sprint</span>
                    <kbd style={{
                      padding: '0 clamp(16px, 4vw, 20px)',
                      background: '#1f2937',
                      color: '#f3f4f6',
                      borderRadius: 'clamp(4px, 1vw, 6px)',
                      fontSize: 'clamp(10px, 2.2vw, 12px)',
                      fontWeight: 700,
                      border: '1px solid rgba(255,255,255,0.15)',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.3), inset 0 1px 2px rgba(255,255,255,0.1)',
                      height: 'clamp(28px, 7vw, 34px)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      SHIFT
                    </kbd>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 'clamp(12px, 2.8vw, 13px)', color: '#cbd5e1' }}>Jump / Surface</span>
                    <kbd style={{
                      padding: '0 clamp(28px, 7vw, 36px)',
                      background: '#1f2937',
                      color: '#f3f4f6',
                      borderRadius: 'clamp(4px, 1vw, 6px)',
                      fontSize: 'clamp(10px, 2.2vw, 12px)',
                      fontWeight: 700,
                      border: '1px solid rgba(255,255,255,0.15)',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.3), inset 0 1px 2px rgba(255,255,255,0.1)',
                      height: 'clamp(28px, 7vw, 34px)',
                      minWidth: 'clamp(90px, 22vw, 110px)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      SPACE
                    </kbd>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 'clamp(12px, 2.8vw, 13px)', color: '#cbd5e1' }}>Break Block</span>
                    <div style={{
                      position: 'relative',
                      width: 'clamp(50px, 12vw, 60px)',
                      height: 'clamp(35px, 8vw, 42px)',
                      background: '#2a3442',
                      borderRadius: 'clamp(15px, 4vw, 18px) clamp(15px, 4vw, 18px) clamp(8px, 2vw, 10px) clamp(8px, 2vw, 10px)',
                      border: '1.5px solid rgba(255,255,255,0.2)',
                      boxShadow: '0 3px 12px rgba(0,0,0,0.5), inset 0 1px 3px rgba(255,255,255,0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'default'
                    }}>
                      {/* Left mouse button - highlighted */}
                      <div style={{
                        position: 'absolute',
                        left: '12%',
                        top: '15%',
                        width: '35%',
                        height: '50%',
                        background: '#2dd4bf',
                        borderRadius: 'clamp(6px, 1.5vw, 8px) clamp(6px, 1.5vw, 8px) clamp(2px, 0.5vw, 3px) clamp(2px, 0.5vw, 3px)',
                        border: '2px solid rgba(94,234,212,0.7)',
                        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.24)'
                      }} />
                      {/* Right mouse button - normal */}
                      <div style={{
                        position: 'absolute',
                        right: '12%',
                        top: '15%',
                        width: '35%',
                        height: '50%',
                        background: '#3d4654',
                        borderRadius: 'clamp(6px, 1.5vw, 8px) clamp(6px, 1.5vw, 8px) clamp(2px, 0.5vw, 3px) clamp(2px, 0.5vw, 3px)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(255,255,255,0.1)'
                      }} />
                      {/* Mouse wheel */}
                      <div style={{
                        position: 'absolute',
                        left: '50%',
                        top: '15%',
                        width: '12%',
                        height: '35%',
                        background: '#576070',
                        borderRadius: 'clamp(1px, 0.3vw, 2px)',
                        transform: 'translateX(-50%)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.2)'
                      }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 'clamp(12px, 2.8vw, 13px)', color: '#cbd5e1' }}>Place Block</span>
                    <div style={{
                      position: 'relative',
                      width: 'clamp(50px, 12vw, 60px)',
                      height: 'clamp(35px, 8vw, 42px)',
                      background: '#2a3442',
                      borderRadius: 'clamp(15px, 4vw, 18px) clamp(15px, 4vw, 18px) clamp(8px, 2vw, 10px) clamp(8px, 2vw, 10px)',
                      border: '1.5px solid rgba(255,255,255,0.2)',
                      boxShadow: '0 3px 12px rgba(0,0,0,0.5), inset 0 1px 3px rgba(255,255,255,0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'default'
                    }}>
                      {/* Left mouse button - normal */}
                      <div style={{
                        position: 'absolute',
                        left: '12%',
                        top: '15%',
                        width: '35%',
                        height: '50%',
                        background: '#3d4654',
                        borderRadius: 'clamp(6px, 1.5vw, 8px) clamp(6px, 1.5vw, 8px) clamp(2px, 0.5vw, 3px) clamp(2px, 0.5vw, 3px)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(255,255,255,0.1)'
                      }} />
                      {/* Right mouse button - highlighted */}
                      <div style={{
                        position: 'absolute',
                        right: '12%',
                        top: '15%',
                        width: '35%',
                        height: '50%',
                        background: '#2dd4bf',
                        borderRadius: 'clamp(6px, 1.5vw, 8px) clamp(6px, 1.5vw, 8px) clamp(2px, 0.5vw, 3px) clamp(2px, 0.5vw, 3px)',
                        border: '2px solid rgba(94,234,212,0.7)',
                        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.24)'
                      }} />
                      {/* Mouse wheel */}
                      <div style={{
                        position: 'absolute',
                        left: '50%',
                        top: '15%',
                        width: '12%',
                        height: '35%',
                        background: '#576070',
                        borderRadius: 'clamp(1px, 0.3vw, 2px)',
                        transform: 'translateX(-50%)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.2)'
                      }} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'clamp(16px, 4vw, 24px)' }}>
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
                  padding: 'clamp(12px, 3vw, 14px) 16px', 
                  background: '#111827', 
                  color: '#f1f5f9', 
                  border: '1px solid rgba(148,163,184,0.2)', 
                  borderRadius: 12,
                  fontSize: 'clamp(13px, 3vw, 14px)',
                  fontWeight: 500,
                  outline: 'none',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer',
                  minHeight: 44
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(148,163,184,0.4)'
                  e.currentTarget.style.background = '#182332'
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(148,163,184,0.2)'
                  e.currentTarget.style.background = '#111827'
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
                  padding: 'clamp(12px, 3vw, 14px) 16px', 
                  background: '#111827', 
                  color: '#f1f5f9', 
                  border: '1px solid rgba(148,163,184,0.2)', 
                  borderRadius: 12,
                  fontSize: 'clamp(13px, 3vw, 14px)',
                  fontWeight: 500,
                  outline: 'none',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer',
                  minHeight: 44
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(148,163,184,0.4)'
                  e.currentTarget.style.background = '#182332'
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(148,163,184,0.2)'
                  e.currentTarget.style.background = '#111827'
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
              if (blocked) {
                alert('Please visit it on desktop, and in Chrome or other Chromium browsers.')
                return
              }
              setChunkCount(localCount)
              setChunkSize(localSize)
              setGameStarted(true)
              // Start background music when entering the world
              setDesiredPlaying(true)
            }}
            style={{ 
              padding: 'clamp(12px, 3vw, 16px) clamp(20px, 5vw, 24px)', 
              background: '#2dd4bf', 
              color: '#061311', 
              border: '1px solid rgba(94,234,212,0.5)', 
              borderRadius: 12, 
              cursor: 'pointer', 
              fontWeight: 700,
              fontSize: 'clamp(14px, 3.5vw, 16px)',
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              boxShadow: '0 10px 24px rgba(0,0,0,0.32)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              outline: 'none',
              position: 'relative',
              overflow: 'hidden',
              minHeight: 48
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
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'translateY(0) scale(0.98)'
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px) scale(1)'
            }}
          >
            Launch New World
          </button>

          <div style={{
            marginTop: 'clamp(16px, 4vw, 24px)',
            padding: 'clamp(16px, 4vw, 20px)',
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 12,
            display: 'grid',
            gap: 16,
            position: 'relative'
          }}>
            <div style={{
              position: 'absolute',
              top: -8,
              left: 16,
              background: '#141f2a',
              padding: '4px 12px',
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 600,
              color: '#cbd5e1',
              letterSpacing: 0.5,
              border: '1px solid rgba(255,255,255,0.06)'
            }}>
              Alternatively
            </div>
            <div style={{ 
              fontSize: 12, 
              color: '#64748b',
              fontStyle: 'italic',
              lineHeight: 1.4
            }}>
              You can also load a world saved by yourself or others. Click "Load Saved World", and select the saved JSON file.
            </div>

            <button
            onClick={handleLoadWorld}
            style={{ 
              padding: 'clamp(12px, 3vw, 16px) clamp(20px, 5vw, 24px)', 
              background: '#1f2937', 
              color: '#f8fafc', 
              border: '1px solid rgba(148,163,184,0.22)', 
              borderRadius: 12, 
              cursor: 'pointer', 
              fontWeight: 700,
              fontSize: 'clamp(14px, 3.5vw, 16px)',
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              boxShadow: '0 10px 24px rgba(0,0,0,0.28)',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              outline: 'none',
              position: 'relative',
              overflow: 'hidden',
              minHeight: 48
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
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'translateY(0) scale(0.98)'
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px) scale(1)'
            }}
          >
            Load Saved World
          </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default StartPanel
