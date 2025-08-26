/**
 * Component: CanvasHost
 * Purpose: Mounts a canvas and provides it to the engine on mount; resizes with window.
 * Callers: App.tsx renders this as the main viewport container.
 * Invariants: Does not import engine internals directly beyond start/stop API.
 */
import { useEffect, useRef } from 'react'
import { useUIStore } from '../state/ui'
import { tryPlayOnUserGesture } from './BgMusic'


type EngineApi = {
  start: (canvas: HTMLCanvasElement) => Promise<void>
  stop: () => void
}

// Lazy import to avoid React/engine circularity. Engine lives under /engine.
async function loadEngine(): Promise<EngineApi> {
  const module = await import('../engine/core/Engine')
  return module.engine
}

export function CanvasHost() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const setPaused = useUIStore(s => s.setPaused)
  const setInGame = useUIStore(s => s.setInGame)
  const restartToken = useUIStore(s => s.restartToken)
  const gameStarted = useUIStore(s => s.gameStarted)
  const paused = useUIStore(s => s.paused)

  useEffect(() => {
    let engineApi: EngineApi | null = null
    let mounted = true
    let removeListeners: (() => void) | null = null

    const setup = async () => {
      const canvas = canvasRef.current
      if (!canvas || !mounted) return
      if (!gameStarted) return
      engineApi = await loadEngine()
      await engineApi.start(canvas)
      // After engine starts, initial state is out-of-game until pointer lock
      setInGame(false)

      const onResize = () => {
        // Renderer handles canvas sizing via renderer.onResize()
      }
      onResize()
      window.addEventListener('resize', onResize)

      // Register cleanup for listeners so effect teardown can call it
      removeListeners = () => {
        window.removeEventListener('resize', onResize)
      }
    }

    void setup()

    return () => {
      mounted = false
      setPaused(false)
      // Ensure we remove any listeners registered during setup
      if (removeListeners) removeListeners()
      engineApi?.stop()
    }
  }, [restartToken, setPaused, setInGame, gameStarted])

  // Prevent context menu on right click over canvas
  const onContextMenu = (e: React.MouseEvent) => e.preventDefault()
  const onClick = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (document.pointerLockElement !== canvas) {
      canvas.requestPointerLock()
    }
    // Kick off background music from a user gesture if we're entering the game
    if (gameStarted && !paused) {
      tryPlayOnUserGesture()
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0b0d10' }}>
      <canvas
        ref={canvasRef}
        onContextMenu={onContextMenu}
        onClick={onClick}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
    </div>
  )
}

export default CanvasHost
