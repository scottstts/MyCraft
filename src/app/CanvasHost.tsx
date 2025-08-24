/**
 * Component: CanvasHost
 * Purpose: Mounts a canvas and provides it to the engine on mount; resizes with window.
 * Callers: App.tsx renders this as the main viewport container.
 * Invariants: Does not import engine internals directly beyond start/stop API.
 */
import { useEffect, useRef } from 'react'

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

  useEffect(() => {
    let engineApi: EngineApi | null = null
    let mounted = true

    const setup = async () => {
      const canvas = canvasRef.current
      if (!canvas || !mounted) return
      engineApi = await loadEngine()
      await engineApi.start(canvas)

      const onResize = () => {
        // Renderer handles canvas sizing via renderer.onResize()
      }
      onResize()
      window.addEventListener('resize', onResize)

      return () => {
        window.removeEventListener('resize', onResize)
      }
    }

    const cleanupPromise = setup()

    return () => {
      mounted = false
      engineApi?.stop()
      void cleanupPromise
    }
  }, [])

  // Prevent context menu on right click over canvas
  const onContextMenu = (e: React.MouseEvent) => e.preventDefault()
  const onClick = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (document.pointerLockElement !== canvas) {
      canvas.requestPointerLock()
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


