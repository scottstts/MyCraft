import * as THREE from 'three'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { SSAO_FRAGMENT_GLSL } from '../ssaoShader'

export class SSAOPass extends ShaderPass {
  constructor() {
    super({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        resolution: { value: new THREE.Vector2(1, 1) },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1000 },
        invProjectionMatrix: { value: new THREE.Matrix4() },
        cameraMatrixWorld: { value: new THREE.Matrix4() },
        projectionScale: { value: new THREE.Vector2(1, 1) },
        waterLevel: { value: 42.0 },
        ssaoEnabled: { value: true },
        ssaoIntensity: { value: 0.35 },
        // Radius is expressed in world units (blocks/meters), not pixels.
        ssaoRadius: { value: 1.25 },
      },
      vertexShader: [
        'varying vec2 vUv;',
        'void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D tDiffuse;',
        'varying vec2 vUv;',
        SSAO_FRAGMENT_GLSL,
        'void main(){',
        '  vec4 source = texture2D(tDiffuse, vUv);',
        '  float indirectMask = clamp(1.0 - source.a, 0.0, 1.0);',
        '  float ao = mix(1.0, ssaoFactor(vUv), indirectMask);',
        '  gl_FragColor = vec4(source.rgb * ao, source.a);',
        '}',
      ].join('\n'),
    })
  }

  setDepthTexture(depth: THREE.DepthTexture) { this.uniforms.tDepth.value = depth }

  setSize(w: number, h: number) {
    ;(this.uniforms.resolution.value as THREE.Vector2).set(Math.max(1, w), Math.max(1, h))
  }

  setCamera(cam: THREE.PerspectiveCamera) {
    this.uniforms.cameraNear.value = cam.near
    this.uniforms.cameraFar.value = cam.far
    ;(this.uniforms.invProjectionMatrix.value as THREE.Matrix4).copy(cam.projectionMatrixInverse)
    ;(this.uniforms.projectionScale.value as THREE.Vector2).set(
      cam.projectionMatrix.elements[0],
      cam.projectionMatrix.elements[5],
    )
    ;(this.uniforms.cameraMatrixWorld.value as THREE.Matrix4).copy(cam.matrixWorld)
  }

  setWaterLevel(y: number) { this.uniforms.waterLevel.value = y }

  setSettings({ enabled, intensity, radius }: { enabled?: boolean; intensity?: number; radius?: number }) {
    if (enabled !== undefined) this.uniforms.ssaoEnabled.value = enabled
    if (intensity !== undefined) this.uniforms.ssaoIntensity.value = THREE.MathUtils.clamp(intensity, 0, 1)
    if (radius !== undefined) this.uniforms.ssaoRadius.value = Math.max(0.05, radius)
  }
}
