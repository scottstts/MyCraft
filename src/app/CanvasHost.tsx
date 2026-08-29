/**
 * Component: CanvasHost
 * Purpose: Mounts a canvas and provides it to the engine on mount; resizes with window.
 * Callers: App.tsx renders this as the main viewport container.
 * Invariants: Does not import engine internals directly beyond start/stop API.
 */
import { useEffect, useRef } from 'react'
import { useUIStore } from '../state/ui'
import { tryPlayOnUserGesture } from './BgMusic'
import type { DiagnosticCameraId } from '../diagnostics/cameras'


type EngineApi = {
  start: (canvas: HTMLCanvasElement, options?: { diagnosticView?: DiagnosticCameraId }) => Promise<void>
  stop: () => void
}

// Lazy import to avoid React/engine circularity. Engine lives under /engine.
async function loadEngine(): Promise<EngineApi> {
  const module = await import('../engine/core/Engine')
  return module.engine
}

export interface CanvasHostProps {
  diagnosticView?: DiagnosticCameraId
}

export function CanvasHost({ diagnosticView }: CanvasHostProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const setPaused = useUIStore(s => s.setPaused)
  const setInGame = useUIStore(s => s.setInGame)
  const restartToken = useUIStore(s => s.restartToken)
  const gameStarted = useUIStore(s => s.gameStarted)

  useEffect(() => {
    let engineApi: EngineApi | null = null
    let engineStarted = false
    let mounted = true
    let removeListeners: (() => void) | null = null

    const setup = async () => {
      const canvas = canvasRef.current
      if (!canvas || !mounted) return
      if (!gameStarted && !diagnosticView) return
      engineApi = await loadEngine()
      // React StrictMode intentionally mounts effects twice in development.
      // If the first async import resolves after its effect was cleaned up,
      // do not start a second engine behind the live mount.
      if (!mounted) return
      await engineApi.start(canvas, diagnosticView ? { diagnosticView } : undefined)
      // Startup itself awaits atlas/worker setup. A navigation during that
      // await must tear down the completed engine rather than leave a hidden
      // RAF/light pair running behind the next scene.
      if (!mounted) {
        engineApi.stop()
        return
      }
      engineStarted = true
      // Diagnostics are intentionally capture-ready without pointer lock;
      // normal gameplay remains out-of-game until the player clicks the canvas.
      setInGame(!!diagnosticView)

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
      if (diagnosticView) setInGame(false)
      // Ensure we remove any listeners registered during setup
      if (removeListeners) removeListeners()
      if (engineStarted) engineApi?.stop()
    }
  }, [restartToken, setPaused, setInGame, gameStarted, diagnosticView])

  // Prevent context menu on right click over canvas
  const onContextMenu = (e: React.MouseEvent) => e.preventDefault()
  const onClick = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!diagnosticView && document.pointerLockElement !== canvas) {
      canvas.requestPointerLock()
    }
    // Kick off background music from a user gesture after game start
    if (gameStarted && !diagnosticView) {
      tryPlayOnUserGesture()
      // Prime SFX playback as well
      ;(window as Window & { __primeSfx?: () => void }).__primeSfx?.()
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
