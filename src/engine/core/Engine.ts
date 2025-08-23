/**
 * Module: engine/core/Engine
 * Purpose: Minimal engine bootstrap with RAF loop and dt logging.
 * Callers: CanvasHost loads this module and calls start/stop.
 * Invariants: Pure TS module; no React imports anywhere under /engine.
 */

let rafId: number | null = null
let lastTime = 0
let running = false

function tick(now: number) {
  if (!running) return
  const dt = lastTime === 0 ? 0 : (now - lastTime) / 1000
  lastTime = now
  // Temporary: log dt as acceptance criteria for A4
  // eslint-disable-next-line no-console
  console.log(`Engine tick dt=${dt.toFixed(4)}s`)
  rafId = requestAnimationFrame(tick)
}

function start(canvas: HTMLCanvasElement) {
  if (running) return
  // canvas reference reserved for future renderer hookup
  void canvas
  running = true
  lastTime = 0
  rafId = requestAnimationFrame(tick)
}

function stop() {
  running = false
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

export const engine = { start, stop }
export type Engine = typeof engine


