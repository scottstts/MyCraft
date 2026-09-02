import * as THREE from 'three'

/** GPU/renderer stages exposed by the runtime performance diagnostics. */
export const RENDER_STAGE_NAMES = [
  'caustic-field-update',
  'water-free-scene-capture',
  'direct-voxel-shadow',
  'forward-receiver-render',
  'forward-voxel-shadow',
  'forward-color-render',
  'normal-render-pass',
  'aerial-perspective',
  'underwater',
  'bloom',
  'lens-flare',
  'output',
] as const

export type RenderStageName = typeof RENDER_STAGE_NAMES[number]

export interface RenderStageMetrics {
  gpuMs: number | null
  drawCalls: number
  triangles: number
  sampleCount: number
  queryPending: boolean
}

export interface RenderStageDiagnostics {
  supported: boolean
  timerQuery: 'EXT_disjoint_timer_query_webgl2' | 'unavailable'
  frame: number
  stages: Record<RenderStageName, RenderStageMetrics>
}

interface TimerExtension {
  TIME_ELAPSED_EXT: number
  GPU_DISJOINT_EXT: number
}

interface PendingQuery {
  query: WebGLQuery
  frameStarted: number
}

interface StageState extends Omit<RenderStageMetrics, 'queryPending'> {
  pending: PendingQuery | null
}

interface StageToken {
  stage: StageState
  stageName: RenderStageName
  callsBefore: number
  trianglesBefore: number
  queryStarted: boolean
}

/**
 * Non-blocking GPU stage accounting for the WebGL renderer.
 *
 * Timer queries are polled at the beginning of later frames and are discarded
 * when the driver reports a disjoint result. Renderer counters are accumulated
 * from `renderer.info` while `autoReset` is disabled for the duration of this
 * profiler. No path calls `finish()` or reads a query result before it is
 * available.
 */
export class RenderStageProfiler {
  private readonly renderer: THREE.WebGLRenderer
  private readonly gl: WebGL2RenderingContext | null
  private readonly extension: TimerExtension | null
  private readonly stages = new Map<RenderStageName, StageState>()
  private readonly previousAutoReset: boolean
  private activeStage: RenderStageName | null = null
  private frame = 0
  private disposed = false

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    this.previousAutoReset = renderer.info.autoReset
    renderer.info.autoReset = false
    for (const name of RENDER_STAGE_NAMES) {
      this.stages.set(name, {
        gpuMs: null,
        drawCalls: 0,
        triangles: 0,
        sampleCount: 0,
        pending: null,
      })
    }

    let gl: WebGL2RenderingContext | null = null
    let extension: TimerExtension | null = null
    if (renderer.capabilities.isWebGL2) {
      try {
        const context = renderer.getContext() as WebGL2RenderingContext
        const candidate = context.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null
        if (candidate) {
          gl = context
          extension = candidate
        }
      } catch {
        // A renderer stub or a context that disappears during teardown is an
        // unsupported profiler, not a reason to interrupt rendering.
      }
    }
    this.gl = gl
    this.extension = extension
  }

  beginFrame(): void {
    if (this.disposed) return
    this.frame += 1
    this.pollQueries()
    this.renderer.info.reset()
    for (const stage of this.stages.values()) {
      stage.drawCalls = 0
      stage.triangles = 0
    }
  }

  measure<T>(stageName: RenderStageName, callback: () => T): T {
    const token = this.begin(stageName)
    try {
      return callback()
    } finally {
      this.end(token)
    }
  }

  getDiagnostics(): RenderStageDiagnostics {
    const stages = {} as Record<RenderStageName, RenderStageMetrics>
    for (const name of RENDER_STAGE_NAMES) {
      const stage = this.stages.get(name)!
      stages[name] = {
        gpuMs: stage.gpuMs,
        drawCalls: stage.drawCalls,
        triangles: stage.triangles,
        sampleCount: stage.sampleCount,
        queryPending: stage.pending !== null,
      }
    }
    return {
      supported: this.extension !== null,
      timerQuery: this.extension ? 'EXT_disjoint_timer_query_webgl2' : 'unavailable',
      frame: this.frame,
      stages,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.gl) {
      for (const stage of this.stages.values()) {
        if (stage.pending) this.gl.deleteQuery(stage.pending.query)
        stage.pending = null
      }
    }
    this.renderer.info.autoReset = this.previousAutoReset
    this.activeStage = null
  }

  private begin(stageName: RenderStageName): StageToken {
    const stage = this.stages.get(stageName)!
    const renderInfo = this.renderer.info.render
    const queryStarted = this.activeStage === null && this.beginQuery(stage)
    if (queryStarted) this.activeStage = stageName
    return {
      stage,
      stageName,
      callsBefore: renderInfo.calls,
      trianglesBefore: renderInfo.triangles,
      queryStarted,
    }
  }

  private end(token: StageToken): void {
    const renderInfo = this.renderer.info.render
    const callsDelta = renderInfo.calls >= token.callsBefore
      ? renderInfo.calls - token.callsBefore
      : renderInfo.calls
    const trianglesDelta = renderInfo.triangles >= token.trianglesBefore
      ? renderInfo.triangles - token.trianglesBefore
      : renderInfo.triangles
    token.stage.drawCalls += callsDelta
    token.stage.triangles += trianglesDelta
    if (!token.queryStarted) return
    if (this.gl) this.gl.endQuery(this.extension!.TIME_ELAPSED_EXT)
    if (this.activeStage === token.stageName) this.activeStage = null
  }

  private beginQuery(stage: StageState): boolean {
    if (!this.gl || !this.extension || stage.pending) return false
    const query = this.gl.createQuery()
    if (!query) return false
    this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, query)
    stage.pending = { query, frameStarted: this.frame }
    return true
  }

  private pollQueries(): void {
    if (!this.gl || !this.extension) return
    for (const stage of this.stages.values()) {
      const pending = stage.pending
      if (!pending) continue
      const age = this.frame - pending.frameStarted
      const available = Boolean(this.gl.getQueryParameter(pending.query, this.gl.QUERY_RESULT_AVAILABLE))
      if (!available && age <= 8) continue

      if (!available) {
        this.gl.deleteQuery(pending.query)
        stage.pending = null
        continue
      }

      const disjoint = Boolean(this.gl.getParameter(this.extension.GPU_DISJOINT_EXT))
      const nanoseconds = Number(this.gl.getQueryParameter(pending.query, this.gl.QUERY_RESULT))
      this.gl.deleteQuery(pending.query)
      stage.pending = null
      if (disjoint || !Number.isFinite(nanoseconds) || nanoseconds < 0) continue
      stage.gpuMs = nanoseconds / 1e6
      stage.sampleCount += 1
    }
  }
}
