import * as THREE from 'three'

export interface ShadowSamplingUniformState {
  enabledUniform: { value: unknown }
  enabledValue: unknown
  depthUniform: { value: unknown } | undefined
  depthValue: unknown
}

/**
 * Materials that sample the screen-space voxel shadow result.
 *
 * The depth prepass temporarily detaches that sampler to avoid a WebGL
 * feedback loop. Keeping this set at material-registration time avoids a
 * scene traversal for every frame while still deduplicating shared uniforms.
 */
export class ShadowSamplingMaterialRegistry {
  private readonly materials = new Set<THREE.Material>()

  register(material: THREE.Material): void {
    const uniforms = (material as THREE.ShaderMaterial).uniforms as
      Record<string, { value: unknown }> | undefined
    if (uniforms?.voxelShadowEnabled) this.materials.add(material)
  }

  unregister(material: THREE.Material): void {
    this.materials.delete(material)
  }

  toggle(enabled: boolean): ShadowSamplingUniformState[] {
    const states: ShadowSamplingUniformState[] = []
    const seen = new Set<object>()
    for (const material of this.materials) {
      const uniforms = (material as THREE.ShaderMaterial).uniforms as
        Record<string, { value: unknown }> | undefined
      const enabledUniform = uniforms?.voxelShadowEnabled
      if (!enabledUniform || seen.has(enabledUniform)) continue
      seen.add(enabledUniform)
      const depthUniform = uniforms?.voxelShadowDepth
      states.push({
        enabledUniform,
        enabledValue: enabledUniform.value,
        depthUniform,
        depthValue: depthUniform?.value,
      })
      enabledUniform.value = enabled
      // WebGL validates sampler/attachment feedback even when the shader
      // branch is disabled, so detach the depth sampler for the prepass.
      if (depthUniform) depthUniform.value = null
    }
    return states
  }

  restore(states: ShadowSamplingUniformState[]): void {
    for (const state of states) {
      state.enabledUniform.value = state.enabledValue
      if (state.depthUniform) state.depthUniform.value = state.depthValue
    }
  }

  get size(): number {
    return this.materials.size
  }

  clear(): void {
    this.materials.clear()
  }
}
