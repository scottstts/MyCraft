import * as THREE from 'three'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'

/**
 * Cheap, depth-aware participating-water composite for the WebGL renderer.
 * The surface material owns interface optics; this pass owns the camera-side
 * water segment so terrain and sky acquire the same extinction/in-scatter.
 */
export class UnderwaterPass extends ShaderPass {
  constructor() {
    super({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1024.0 },
        invProjectionMatrix: { value: new THREE.Matrix4() },
        cameraMatrixWorld: { value: new THREE.Matrix4() },
        uCameraPosition: { value: new THREE.Vector3() },
        waterLevel: { value: 43.0 },
        absorption: { value: new THREE.Vector3(0.20, 0.06, 0.02) },
        fogColor: { value: new THREE.Color(0.10, 0.36, 0.55) },
        fogStrength: { value: 0.72 },
        uSunDirection: { value: new THREE.Vector3(0.35, 0.9, 0.2).normalize() },
        uSunColor: { value: new THREE.Color(1.0, 0.98, 0.90) },
        underwater: { value: false },
        debugMode: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform float cameraNear;
        uniform float cameraFar;
        uniform mat4 invProjectionMatrix;
        uniform mat4 cameraMatrixWorld;
        uniform vec3 uCameraPosition;
        uniform float waterLevel;
        uniform vec3 absorption;
        uniform vec3 fogColor;
        uniform float fogStrength;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform bool underwater;
        uniform int debugMode;
        varying vec2 vUv;

        float readViewDepth(float rawDepth) {
          if (rawDepth >= 0.999999) return cameraFar;
          float viewZ = (cameraNear * cameraFar) / ((cameraFar - cameraNear) * rawDepth - cameraFar);
          return -viewZ;
        }

        vec3 worldRay(out vec3 viewRay) {
          vec2 ndc = vUv * 2.0 - 1.0;
          vec4 farView = invProjectionMatrix * vec4(ndc, 1.0, 1.0);
          farView /= max(farView.w, 1e-5);
          viewRay = normalize(farView.xyz);
          return normalize((cameraMatrixWorld * vec4(viewRay, 0.0)).xyz);
        }

        void main() {
          vec4 source = texture2D(tDiffuse, vUv);
          if (!underwater) {
            gl_FragColor = source;
            return;
          }

          vec3 viewRay;
          vec3 ray = worldRay(viewRay);
          float sceneViewDepth = readViewDepth(texture2D(tDepth, vUv).r);
          float sceneDistance = sceneViewDepth / max(-viewRay.z, 0.02);
          float surfaceDistance = cameraFar;
          if (ray.y > 0.001) surfaceDistance = max(0.0, (waterLevel - uCameraPosition.y) / ray.y);
          float waterDistance = min(sceneDistance, surfaceDistance);
          waterDistance = min(waterDistance, cameraFar);

          vec3 transmittance = exp(-absorption * waterDistance);
          // Use the green-channel extinction as the optical transport scalar,
          // matching the water-optics medium example.  Green is the stable
          // luminance channel for this blue/green water and avoids RGB
          // averaging making deep red absorption over-brighten the fog.
          float scatter = clamp(1.0 - transmittance.g, 0.0, 1.0);
          float upness = smoothstep(-0.5, 0.75, ray.y);
          float cameraDepth = max(waterLevel - uCameraPosition.y, 0.0);
          float cameraDim = exp(-cameraDepth * 0.03);
          vec3 ambient = mix(vec3(0.012, 0.035, 0.055), vec3(0.035, 0.12, 0.16), upness) * cameraDim;
          float sunward = pow(max(dot(ray, normalize(uSunDirection)), 0.0), 6.0) * 0.06;
          vec3 inScatter = (ambient + uSunColor * sunward) * scatter * fogStrength;
          vec3 color = source.rgb * transmittance + inScatter;

          if (debugMode == 1) color = vec3(clamp(waterDistance / 64.0, 0.0, 1.0));
          else if (debugMode == 2) color = transmittance;
          else if (debugMode == 3) color = vec3(scatter);

          gl_FragColor = vec4(max(color, vec3(0.0)), source.a);
        }
      `,
    })
  }

  setDepthTexture(depth: THREE.Texture | null): void { this.uniforms.tDepth.value = depth }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.uniforms.cameraNear.value = camera.near
    this.uniforms.cameraFar.value = camera.far
    ;(this.uniforms.invProjectionMatrix.value as THREE.Matrix4).copy(camera.projectionMatrixInverse)
    ;(this.uniforms.cameraMatrixWorld.value as THREE.Matrix4).copy(camera.matrixWorld)
    ;(this.uniforms.uCameraPosition.value as THREE.Vector3).copy(camera.position)
  }

  setWaterLevel(level: number): void { this.uniforms.waterLevel.value = level }

  setAbsorption(value: THREE.Vector3): void { (this.uniforms.absorption.value as THREE.Vector3).copy(value) }

  setFogColor(value: THREE.Color): void { (this.uniforms.fogColor.value as THREE.Color).copy(value) }

  setSun(direction: THREE.Vector3, color: THREE.Color): void {
    ;(this.uniforms.uSunDirection.value as THREE.Vector3).copy(direction).normalize()
    ;(this.uniforms.uSunColor.value as THREE.Color).copy(color)
  }

  setUnderwater(value: boolean): void { this.uniforms.underwater.value = value }

  setDebugMode(mode: number): void { this.uniforms.debugMode.value = Math.max(0, Math.floor(mode)) }
}
