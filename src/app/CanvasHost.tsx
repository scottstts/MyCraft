/**
 * Component: CanvasHost
 * Purpose: Mounts a canvas and provides it to the engine on mount; the engine owns resizing.
 * Callers: App.tsx renders this as the main viewport container.
 * Invariants: Does not import engine internals directly beyond start/stop API.
 */
import { useEffect, useRef } from 'react'
import { useUIStore } from '../state/ui'
import { setDesiredPlaying, tryPlayOnUserGesture } from './BgMusic'
import type { DiagnosticCameraId } from '../diagnostics/cameras'
import { createStartupError, isStartupErrorInfo, type BootStage } from '../shared/startup'


type EngineApi = {
  start: (canvas: HTMLCanvasElement, options?: {
    diagnosticView?: DiagnosticCameraId
    diagnosticTime?: number
    onBootStage?: (stage: BootStage) => void
  }) => Promise<void>
  stop: () => void
}

type WindowWithGameEntry = Window & {
  __requestGameEntryPointerLock?: () => void
}

function requestCanvasPointerLock(canvas: HTMLCanvasElement): void {
  if (document.pointerLockElement === canvas) return
  try {
    const result = canvas.requestPointerLock?.() as unknown as { catch?: (onRejected: () => void) => unknown } | undefined
    if (typeof result?.catch === 'function') {
      void result.catch(() => { /* browser may require a fresh gesture */ })
    }
  } catch {
    // Pointer lock is an optional browser capability; the canvas click remains
    // available as a fallback entry gesture.
  }
}

// Lazy import to avoid React/engine circularity. Engine lives under /engine.
async function loadEngine(): Promise<EngineApi> {
  const module = await import('../engine/core/Engine')
  return module.engine
}

export interface CanvasHostProps {
  diagnosticView?: DiagnosticCameraId
  diagnosticTime?: number
}

export function CanvasHost({ diagnosticView, diagnosticTime }: CanvasHostProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const lifecycleIdRef = useRef(0)
  const setPaused = useUIStore(s => s.setPaused)
  const setInGame = useUIStore(s => s.setInGame)
  const setGameStarted = useUIStore(s => s.setGameStarted)
  const setLoading = useUIStore(s => s.setLoading)
  const setStartupStage = useUIStore(s => s.setStartupStage)
  const setStartupError = useUIStore(s => s.setStartupError)
  const restartToken = useUIStore(s => s.restartToken)
  const gameStarted = useUIStore(s => s.gameStarted)
  const loading = useUIStore(s => s.loading)

  useEffect(() => {
    const requestEntryPointerLock = () => {
      const canvas = canvasRef.current
      if (!canvas || diagnosticView) return
      requestCanvasPointerLock(canvas)
    }
    const gameWindow = window as WindowWithGameEntry
    gameWindow.__requestGameEntryPointerLock = requestEntryPointerLock
    return () => {
      if (gameWindow.__requestGameEntryPointerLock === requestEntryPointerLock) {
        delete gameWindow.__requestGameEntryPointerLock
      }
    }
  }, [diagnosticView])

  useEffect(() => {
    const lifecycleId = lifecycleIdRef.current + 1
    lifecycleIdRef.current = lifecycleId
    const ownsLifecycle = () => lifecycleIdRef.current === lifecycleId
    let engineApi: EngineApi | null = null
    let engineStarted = false
    let mounted = true
    let bootStage: BootStage = 'engine-import'

    const handleStartupFailure = (error: unknown) => {
      if (!mounted || !ownsLifecycle()) {
        if (ownsLifecycle()) engineApi?.stop()
        return
      }
      const failure = isStartupErrorInfo(error)
        ? error
        : createStartupError(bootStage, error)
      console.error('Game startup failed:', failure)
      engineApi?.stop()
      setInGame(false)
      setLoading(false)
      setGameStarted(false)
      setStartupError(failure)
    }

    const setup = async () => {
      const canvas = canvasRef.current
      if (!canvas || !mounted) return
      if (!gameStarted && !diagnosticView) return
      try {
        const reportBootStage = (stage: BootStage) => {
          bootStage = stage
          if (mounted && ownsLifecycle()) setStartupStage(stage)
        }
        reportBootStage('engine-import')
        engineApi = await loadEngine()
        // React StrictMode intentionally mounts effects twice in development.
        // If the first async import resolves after its effect was cleaned up,
        // do not start a second engine behind the live mount.
        if (!mounted) return
        await engineApi.start(canvas, {
          ...(diagnosticView ? { diagnosticView, diagnosticTime } : {}),
          onBootStage: reportBootStage,
        })
        // Startup itself awaits atlas/worker setup. A navigation during that
        // await must tear down the completed engine rather than leave a hidden
        // RAF/light pair running behind the next scene.
        if (!mounted) {
          if (ownsLifecycle()) engineApi.stop()
          return
        }
        engineStarted = true
        if (diagnosticView) {
          // Diagnostics are intentionally capture-ready without pointer lock.
          setInGame(true)
        } else {
          // The launch button requests lock synchronously while it still owns a
          // user gesture. Retry here as a fallback for browsers that deferred or
          // rejected that early request. Enter gameplay as soon as the world is
          // fully ready; the canvas remains a fallback gesture if the browser
          // requires a fresh activation before granting pointer lock.
          requestCanvasPointerLock(canvas)
          setInGame(true)
          setPaused(false)
          setDesiredPlaying(true)
          setLoading(false)
        }
      } catch (error) {
        handleStartupFailure(error)
      }
    }

    // Keep the complete startup promise observed, including the UI handoff
    // after Engine.start resolves. This prevents a late entry-side exception
    // from leaving the app on an inert loading screen.
    void setup().catch(handleStartupFailure)

    return () => {
      mounted = false
      setPaused(false)
      setInGame(false)
      if (!diagnosticView) setDesiredPlaying(false)
      if (ownsLifecycle() && engineStarted) engineApi?.stop()
    }
  }, [restartToken, setPaused, setInGame, setGameStarted, setLoading, setStartupStage, setStartupError, gameStarted, diagnosticView, diagnosticTime])

  // Prevent context menu on right click over canvas
  const onContextMenu = (e: React.MouseEvent) => e.preventDefault()
  const onClick = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (gameStarted && !loading && !diagnosticView) {
      requestCanvasPointerLock(canvas)
      // Kick off background music from a user gesture after game start
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
