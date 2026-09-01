import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { SeaweedMaterial } from '../src/engine/render/SeaweedMaterial'

function createTexture(): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    new Uint8Array([255, 255, 255, 255]),
    1,
    1,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  texture.needsUpdate = true
  return texture
}

describe('SeaweedMaterial', () => {
  it('uses the grass crossed-card alpha contract and underwater lighting inputs', () => {
    const texture = createTexture()
    const material = new SeaweedMaterial(texture)

    expect(material.side).toBe(THREE.DoubleSide)
    expect(material.transparent).toBe(false)
    expect(material.depthWrite).toBe(true)
    expect(material.depthTest).toBe(true)
    expect(material.alphaTest).toBe(0.15)
    expect(material.vertexShader).toContain('attribute float aSeed')
    expect(material.vertexShader).toContain('uFlowStrength')
    expect(material.vertexShader).toContain('uTime')
    expect(material.fragmentShader).toContain('if (tex.a < alphaCutoff) discard')
    expect(material.fragmentShader).toContain('waterCausticMap')
    expect(material.fragmentShader).toContain('voxelShadowMask')
    expect(material.uniforms.waterCausticEnabled).toBeDefined()
    expect(material.uniforms.voxelShadowEnabled).toBeDefined()

    material.dispose()
    texture.dispose()
  })

  it('shares the live voxel receiver uniforms with terrain materials', () => {
    const texture = createTexture()
    const material = new SeaweedMaterial(texture)
    const source = new THREE.ShaderMaterial({
      uniforms: {
        voxelShadowMask: { value: texture },
        voxelShadowDepth: { value: texture },
        voxelShadowResolution: { value: new THREE.Vector2(320, 200) },
        voxelShadowCameraNear: { value: 0.1 },
        voxelShadowCameraFar: { value: 1024 },
        voxelShadowEnabled: { value: true },
      },
    })

    material.shareVoxelShadowState(source)
    expect(material.uniforms.voxelShadowMask).toBe(source.uniforms.voxelShadowMask)
    expect(material.uniforms.voxelShadowDepth).toBe(source.uniforms.voxelShadowDepth)
    expect(material.uniforms.voxelShadowEnabled).toBe(source.uniforms.voxelShadowEnabled)

    material.dispose()
    source.dispose()
    texture.dispose()
  })
})
