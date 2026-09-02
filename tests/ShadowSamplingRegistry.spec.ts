import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { ShadowSamplingMaterialRegistry } from '../src/engine/render/ShadowSamplingRegistry'

describe('shadow sampling material registry', () => {
  it('toggles only registered materials and deduplicates shared uniforms', () => {
    const registry = new ShadowSamplingMaterialRegistry()
    const depth = new THREE.Texture()
    const shared = {
      enabled: { value: true },
      depth: { value: depth as THREE.Texture | null },
    }
    const first = new THREE.ShaderMaterial({
      uniforms: {
        voxelShadowEnabled: shared.enabled,
        voxelShadowDepth: shared.depth,
      },
    })
    const second = new THREE.ShaderMaterial({
      uniforms: {
        voxelShadowEnabled: shared.enabled,
        voxelShadowDepth: shared.depth,
      },
    })
    const unregistered = new THREE.ShaderMaterial({
      uniforms: { voxelShadowEnabled: { value: true } },
    })
    registry.register(first)
    registry.register(second)

    const states = registry.toggle(false)
    expect(states).toHaveLength(1)
    expect(shared.enabled.value).toBe(false)
    expect(shared.depth.value).toBeNull()
    expect((unregistered.uniforms.voxelShadowEnabled.value as boolean)).toBe(true)
    registry.restore(states)
    expect(shared.enabled.value).toBe(true)
    expect(shared.depth.value).toBe(depth)

    first.dispose()
    second.dispose()
    unregistered.dispose()
    depth.dispose()
  })
})
