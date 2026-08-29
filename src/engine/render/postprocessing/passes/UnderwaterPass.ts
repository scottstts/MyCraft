import * as THREE from 'three'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'

function createCausticFallback(): THREE.DataTexture {
  // 0.18 is the conserved mean of the differential-area field.  Keeping the
  // sampler valid even while the optional WebGL target is unavailable avoids
  // undefined texture reads in drivers that validate inactive branches.
  const texture = new THREE.DataTexture(new Uint8Array([46, 46, 46, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}

/**
 * Cheap, depth-aware participating-water composite for the WebGL renderer.
 * The surface material owns interface optics; this pass owns the camera-side
 * water segment so terrain and sky acquire the same extinction/in-scatter.
 *
 * The medium is resolved per ray rather than from a camera-side boolean. At
 * the waterline, a single frame can contain rays that never enter water and
 * rays that cross it; treating the whole frame as one medium creates the
 * familiar full-screen underwater kick.
 */
export class UnderwaterPass extends ShaderPass {
  private readonly causticFallback: THREE.DataTexture

  constructor() {
    const causticFallback = createCausticFallback()
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
        causticMap: { value: causticFallback },
        causticMapEnabled: { value: false },
        causticOrigin: { value: new THREE.Vector2() },
        causticExtent: { value: 256.0 },
        causticResolution: { value: new THREE.Vector2(256, 256) },
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
        uniform sampler2D causticMap;
        uniform bool causticMapEnabled;
        uniform vec2 causticOrigin;
        uniform float causticExtent;
        uniform vec2 causticResolution;
        // underwater means that a water system is present and this pass is
        // allowed to run. It is deliberately not the camera's medium state:
        // the camera can be above the surface while individual view rays are
        // already travelling through water.
        uniform bool underwater;
        uniform int debugMode;
        varying vec2 vUv;

        const float WATERLINE_TRANSITION = 0.65;

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

        float sampleCausticLuma(vec3 worldPosition) {
          float depth = max(waterLevel - worldPosition.y, 0.0);
          float sunY = max(uSunDirection.y, 0.15);
          vec2 projected = worldPosition.xz + uSunDirection.xz * (depth / sunY);
          vec2 causticCoord = (projected - causticOrigin) / max(causticExtent, 1.0) + 0.5;
          float field = texture2D(causticMap, fract(causticCoord)).r;
          return field * exp(-depth * 0.055);
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

          // Integrate the below-surface part of this ray. This is the same
          // segment solve from either side of the interface:
          //   above camera + downward crossing -> scene - crossing
          //   below camera + upward crossing   -> crossing
          //   below camera with no crossing    -> scene
          //   above camera with no crossing    -> zero
          // The crossing is only considered when it lies in front of the
          // camera. A ray parallel to the plane never enters the medium.
          float surfaceDistance = -1.0;
          if (abs(ray.y) > 0.001) {
            surfaceDistance = (waterLevel - uCameraPosition.y) / ray.y;
          }
          float crossingAhead = max(
            step(0.001, surfaceDistance),
            // At the exact waterline t is zero for both ray directions. Only
            // the downward ray starts by entering the medium.
            step(abs(surfaceDistance), 0.001) * step(0.0, -ray.y)
          );
          float cameraBelow = step(0.001, waterLevel - uCameraPosition.y);
          float crossedDistance = clamp(surfaceDistance, 0.0, sceneDistance);
          float waterDistance = cameraBelow > 0.5
            ? (crossingAhead > 0.5 ? crossedDistance : sceneDistance)
            : (crossingAhead > 0.5 ? max(sceneDistance - crossedDistance, 0.0) : 0.0);
          waterDistance = min(max(waterDistance, 0.0), cameraFar);
          float waterStart = cameraBelow < 0.5 && crossingAhead > 0.5
            ? crossedDistance
            : 0.0;

          // Fade the *camera-side contribution*, not the ray classification.
          // At the waterline this gives a stable mixed-medium frame: rays
          // above the interface have zero water path, while rays below it
          // receive a half-strength medium. Once the camera is clearly above,
          // the pass is optically neutral; once clearly below, it is full
          // strength. The width is expressed in world units and is close to
          // one voxel block in the authored world.
          float cameraWaterBlend = smoothstep(
            -WATERLINE_TRANSITION,
            WATERLINE_TRANSITION,
            waterLevel - uCameraPosition.y
          );

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
          if (causticMapEnabled && cameraWaterBlend > 0.001 && waterDistance > 0.001) {
            // A short jitter-free march is enough for the low-frequency
            // caustic glow; the seabed material carries the high-frequency
            // web.  Four independent samples avoid painting one 2-D pattern
            // on the whole water column while keeping WebGL cost bounded.
            float marchLength = min(waterDistance, 48.0);
            float causticAccum = 0.0;
            for (int i = 0; i < 4; i++) {
              float t = marchLength * (float(i) + 0.5) * 0.25;
              causticAccum += sampleCausticLuma(uCameraPosition + ray * (waterStart + t));
            }
            float causticGain = max(causticAccum * 0.25 - 0.18, 0.0);
            inScatter += uSunColor * causticGain * scatter * fogStrength * 0.065;
          }
          vec3 color = source.rgb * transmittance + inScatter;
          color = mix(source.rgb, color, cameraWaterBlend);

          if (debugMode == 1) color = vec3(clamp(waterDistance / 64.0, 0.0, 1.0) * cameraWaterBlend);
          else if (debugMode == 2) color = mix(vec3(1.0), transmittance, cameraWaterBlend);
          else if (debugMode == 3) color = vec3(scatter * cameraWaterBlend);

          gl_FragColor = vec4(max(color, vec3(0.0)), source.a);
        }
      `,
    })
    this.causticFallback = causticFallback
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

  setCaustics(texture: THREE.Texture | null, origin: { x: number; y: number }, extent: number, resolution: { x: number; y: number }): void {
    this.uniforms.causticMap.value = texture ?? this.causticFallback
    this.uniforms.causticMapEnabled.value = !!texture
    ;(this.uniforms.causticOrigin.value as THREE.Vector2).set(origin.x, origin.y)
    this.uniforms.causticExtent.value = Math.max(1, extent)
    ;(this.uniforms.causticResolution.value as THREE.Vector2).set(Math.max(1, resolution.x), Math.max(1, resolution.y))
  }

  setUnderwater(value: boolean): void { this.uniforms.underwater.value = value }

  setDebugMode(mode: number): void { this.uniforms.debugMode.value = Math.max(0, Math.floor(mode)) }

  dispose(): void { this.causticFallback.dispose() }
}
