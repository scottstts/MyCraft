import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import {
  RenderStageProfiler,
  RENDER_STAGE_NAMES,
} from '../src/engine/render/RenderStageProfiler'

interface FakeRendererInfo {
  autoReset: boolean
  render: { calls: number; triangles: number }
  reset: ReturnType<typeof vi.fn>
}

function createRenderer(
  info: FakeRendererInfo,
  isWebGL2 = false,
  context?: unknown,
): THREE.WebGLRenderer {
  return {
    info,
    capabilities: { isWebGL2 },
    getContext: () => context,
  } as unknown as THREE.WebGLRenderer
}

describe('render stage profiler', () => {
  it('accumulates renderer draw and triangle counters by stage', () => {
    const info: FakeRendererInfo = {
      autoReset: true,
      render: { calls: 0, triangles: 0 },
      reset: vi.fn(),
    }
    const profiler = new RenderStageProfiler(createRenderer(info))

    profiler.beginFrame()
    profiler.measure('normal-render-pass', () => {
      info.render.calls += 3
      info.render.triangles += 18
    })
    profiler.measure('underwater', () => {
      info.render.calls += 1
      info.render.triangles += 2
    })

    const diagnostics = profiler.getDiagnostics()
    expect(diagnostics.supported).toBe(false)
    expect(diagnostics.timerQuery).toBe('unavailable')
    expect(diagnostics.stages['normal-render-pass']).toMatchObject({
      gpuMs: null,
      drawCalls: 3,
      triangles: 18,
      sampleCount: 0,
      queryPending: false,
    })
    expect(diagnostics.stages.underwater.drawCalls).toBe(1)
    expect(info.reset).toHaveBeenCalledTimes(1)

    profiler.dispose()
    expect(info.autoReset).toBe(true)
  })

  it('polls disjoint timer queries asynchronously without forcing a finish', () => {
    const info: FakeRendererInfo = {
      autoReset: true,
      render: { calls: 0, triangles: 0 },
      reset: vi.fn(),
    }
    const query = {} as WebGLQuery
    let available = false
    const getQueryParameter = vi.fn((_: WebGLQuery, parameter: number) => {
      if (parameter === 1) return available
      return 2_500_000
    })
    const gl = {
      QUERY_RESULT_AVAILABLE: 1,
      QUERY_RESULT: 2,
      getExtension: vi.fn(() => ({ TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 })),
      createQuery: vi.fn(() => query),
      beginQuery: vi.fn(),
      endQuery: vi.fn(),
      getQueryParameter,
      getParameter: vi.fn(() => false),
      deleteQuery: vi.fn(),
    }
    const profiler = new RenderStageProfiler(createRenderer(info, true, gl))

    profiler.beginFrame()
    profiler.measure('bloom', () => {
      info.render.calls += 2
      info.render.triangles += 12
    })
    expect(gl.beginQuery).toHaveBeenCalledWith(3, query)
    expect(gl.endQuery).toHaveBeenCalledWith(3)

    profiler.beginFrame()
    expect(getQueryParameter).toHaveBeenCalledWith(query, 1)
    expect(getQueryParameter).not.toHaveBeenCalledWith(query, 2)
    expect(profiler.getDiagnostics().stages.bloom.gpuMs).toBeNull()

    available = true
    profiler.beginFrame()
    expect(getQueryParameter).toHaveBeenCalledWith(query, 2)
    expect(profiler.getDiagnostics().stages.bloom).toMatchObject({
      gpuMs: 2.5,
      sampleCount: 1,
      queryPending: false,
      drawCalls: 0,
      triangles: 0,
    })
    expect(gl.getParameter).toHaveBeenCalledWith(4)
    expect(gl.deleteQuery).toHaveBeenCalledWith(query)
    expect((gl as { finish?: unknown }).finish).toBeUndefined()

    profiler.dispose()
    expect(RENDER_STAGE_NAMES).toContain('forward-receiver-render')
  })
})
