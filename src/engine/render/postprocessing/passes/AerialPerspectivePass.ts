import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { AtmosphereState } from '../../atmosphere/AtmosphereModel';
import { RENDER_STYLE } from '../../settings/RenderStyle';

/**
 * Depth-aware surface aerial perspective using the same coefficients and
 * sun/sky state as SkyDome. A shared view-ray horizon envelope is also
 * applied to sky pixels so the ocean and dome meet through one airlight band.
 */
export class AerialPerspectivePass extends ShaderPass {
  constructor() {
    super({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        cameraNear: { value: 0.1 },
        cameraFar: { value: 1024 },
        invProjectionMatrix: { value: new THREE.Matrix4() },
        cameraMatrixWorld: { value: new THREE.Matrix4() },
        sunDirection: { value: new THREE.Vector3(0, 1, 0) },
        sunColor: { value: new THREE.Color(1, 1, 1) },
        sunIntensity: { value: 1.35 },
        skyZenith: { value: new THREE.Color(0.04, 0.16, 0.42) },
        skyHorizon: { value: new THREE.Color(0.34, 0.50, 0.70) },
        skyAerosol: { value: new THREE.Color(0.36, 0.43, 0.52) },
        skyAerosolStrength: { value: 0.14 },
        skyRadianceScale: { value: 1.25 },
        rayleighScaleHeight: { value: 8.0 },
        mieScaleHeight: { value: 1.2 },
        rayleighCoefficient: { value: 0.055 },
        mieCoefficient: { value: 0.018 },
        mieDirectionalG: { value: 0.76 },
        waterLevel: { value: 42.0 },
        maxDistance: { value: 600.0 },
        hazeStart: { value: 36.0 },
        hazeExtinction: { value: 0.0028 },
        hazeMax: { value: 0.72 },
        horizonHazeWidth: { value: RENDER_STYLE.atmosphere.horizonHazeWidth },
        horizonHazeStrength: { value: RENDER_STYLE.atmosphere.horizonHazeStrength },
        horizonHazeNearSurfaceFloor: { value: RENDER_STYLE.atmosphere.horizonHazeNearSurfaceFloor },
        enabled: { value: true },
      },
      toneMapped: false,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform float cameraNear;
        uniform float cameraFar;
        uniform mat4 invProjectionMatrix;
        uniform mat4 cameraMatrixWorld;
        uniform vec3 sunDirection;
        uniform vec3 sunColor;
        uniform float sunIntensity;
        uniform vec3 skyZenith;
        uniform vec3 skyHorizon;
        uniform vec3 skyAerosol;
        uniform float skyAerosolStrength;
        uniform float skyRadianceScale;
        uniform float rayleighScaleHeight;
        uniform float mieScaleHeight;
        uniform float rayleighCoefficient;
        uniform float mieCoefficient;
        uniform float mieDirectionalG;
        uniform float waterLevel;
        uniform float maxDistance;
        uniform float hazeStart;
        uniform float hazeExtinction;
        uniform float hazeMax;
        uniform float horizonHazeWidth;
        uniform float horizonHazeStrength;
        uniform float horizonHazeNearSurfaceFloor;
        uniform bool enabled;
        varying vec2 vUv;

        const float PI = 3.14159265359;

        float readDepth(vec2 uv) {
          float raw = texture2D(tDepth, uv).r;
          if (raw >= 0.999999) return cameraFar;
          float viewZ = (cameraNear * cameraFar) / ((cameraFar - cameraNear) * raw - cameraFar);
          return -viewZ;
        }

        vec3 viewRayWorld(out vec3 viewRay) {
          vec2 ndc = vUv * 2.0 - 1.0;
          vec4 farView = invProjectionMatrix * vec4(ndc, 1.0, 1.0);
          farView /= farView.w;
          viewRay = normalize(farView.xyz);
          return normalize((cameraMatrixWorld * vec4(viewRay, 0.0)).xyz);
        }

        vec3 worldPosition(float viewDepth) {
          vec2 ndc = vUv * 2.0 - 1.0;
          vec4 farView = invProjectionMatrix * vec4(ndc, 1.0, 1.0);
          farView /= farView.w;
          vec3 rayView = normalize(farView.xyz);
          vec3 positionView = rayView * (viewDepth / max(1e-4, -rayView.z));
          return (cameraMatrixWorld * vec4(positionView, 1.0)).xyz;
        }

        float rayleighPhase(float cosTheta) {
          return 3.0 / (16.0 * PI) * (1.0 + cosTheta * cosTheta);
        }

        float miePhase(float cosTheta, float g) {
          float g2 = g * g;
          return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * cosTheta, 0.001), 1.5));
        }

        void main() {
          vec4 source = texture2D(tDiffuse, vUv);
          if (!enabled) {
            gl_FragColor = source;
            return;
          }

          vec3 viewRay;
          vec3 ray = viewRayWorld(viewRay);
          float receiverViewDepth = readDepth(vUv);

          // The opaque ocean writes a zero-alpha marker into the color pass.
          // Its separate capture intentionally contains the seabed, so the
          // capture depth is not the visible receiver depth for an ocean pixel.
          // Replace it with the camera ray's intersection with the nominal
          // water plane before applying aerial extinction. This keeps the
          // atmosphere pass from reintroducing a depth/LOD seam after the
          // surface shader has already performed its Fresnel mix.
          float waterMask = 1.0 - step(0.001, source.a);
          vec3 cameraPosition = cameraMatrixWorld[3].xyz;
          float cameraAboveWater = step(waterLevel, cameraPosition.y);
          float surfaceRayDistance = -1.0;
          if (abs(ray.y) > 0.001) {
            surfaceRayDistance = (waterLevel - cameraPosition.y) / ray.y;
          }
          float rayDown = step(0.001, -ray.y);
          float surfaceViewDepth = -surfaceRayDistance * viewRay.z;
          float validWaterSurfaceRay = cameraAboveWater
            * rayDown
            * step(0.001, surfaceRayDistance);
          receiverViewDepth = mix(
            receiverViewDepth,
            clamp(surfaceViewDepth, 0.0, cameraFar),
            waterMask * validWaterSurfaceRay
          );

          // Aerial perspective belongs only to the air segment. Applying it
          // to the full capture depth fogged seabed through air and water a
          // second time before UnderwaterPass integrated the water medium.
          // Compare view-depth values so the reconstruction stays compatible
          // with the pass's axial depth convention.
          float cameraBelowWater = step(0.001, waterLevel - cameraPosition.y);
          float crossingAhead = max(
            step(0.001, surfaceRayDistance),
            step(abs(surfaceRayDistance), 0.001) * step(0.0, -ray.y)
          );
          float receiverAfterCrossing = step(0.001, receiverViewDepth - surfaceViewDepth);
          float crossedBeforeReceiver = crossingAhead * receiverAfterCrossing;
          float airViewDepth = receiverViewDepth;
          if (cameraBelowWater > 0.5) {
            airViewDepth = crossedBeforeReceiver > 0.5
              ? max(receiverViewDepth - surfaceViewDepth, 0.0)
              : 0.0;
          } else {
            airViewDepth = crossedBeforeReceiver > 0.5
              ? min(receiverViewDepth, max(surfaceViewDepth, 0.0))
              : receiverViewDepth;
          }

          float up = max(ray.y, 0.0);
          float vertical = pow(up, 0.48);
          vec3 gradient = mix(skyHorizon, skyZenith, vertical);
          vec3 seaMist = mix(skyAerosol, skyHorizon, 0.58);
          vec3 ambientSky = mix(seaMist, gradient, smoothstep(-0.38, 0.14, ray.y));
          float aerosol = smoothstep(-0.18, 0.0, ray.y)
            * (1.0 - smoothstep(0.0, 0.30, ray.y))
            * skyAerosolStrength;
          ambientSky = mix(ambientSky, skyAerosol, aerosol) * skyRadianceScale;

          // Sky pixels have no finite depth, so they used to bypass this pass
          // entirely while the far ocean was fogged below them. Apply one
          // angular marine-airlight envelope to both sides of the horizon. It
          // is view-ray based (not screen-axis based), therefore it surrounds
          // the player continuously through every yaw direction.
          float horizonBand = exp(-pow(abs(ray.y) / max(horizonHazeWidth, 1e-3), 2.0));
          vec3 horizonAirlight = mix(seaMist, skyHorizon, 0.25) * skyRadianceScale;
          float horizonMix = clamp(horizonBand * horizonHazeStrength, 0.0, 1.0);
          if (receiverViewDepth >= cameraFar * 0.999) {
            gl_FragColor = vec4(mix(source.rgb, horizonAirlight, horizonMix), source.a);
            return;
          }

          float d = min(airViewDepth, maxDistance);
          vec3 position = worldPosition(airViewDepth);
          float altitude = max(position.y - waterLevel, 0.0);
          float density = mix(1.0, 0.35, 1.0 - exp(-altitude / max(0.25, mieScaleHeight * 4.0)));
          float horizonPath = 1.0 + 3.2 * pow(1.0 - abs(ray.y), 2.0);
          float opticalLength = max(d - hazeStart, 0.0) * horizonPath * density;

          // One shared scene-scale extinction calibration. The coefficient
          // ratios remain Rayleigh/Mie-like, while the authored start distance
          // keeps the near field crisp at voxel-world scale.
          float ext = hazeExtinction * (rayleighCoefficient * 0.03 + mieCoefficient * 0.05) / 0.00255;
          vec3 extinction = ext * vec3(0.82, 0.96, 1.18);
          vec3 transmittance = exp(-extinction * opticalLength);
          float inscatterAmount = clamp(1.0 - dot(transmittance, vec3(0.333333)), 0.0, hazeMax);

          float cosSun = dot(ray, normalize(sunDirection));
          float singleScatter = rayleighPhase(cosSun) * rayleighCoefficient * 0.16
            + miePhase(cosSun, mieDirectionalG) * mieCoefficient * 0.22;
          vec3 sunScatter = sunColor * sunIntensity * singleScatter * inscatterAmount * 1.6;
          vec3 inscatter = ambientSky * inscatterAmount * 0.66 + sunScatter;
          vec3 composed = source.rgb * transmittance + inscatter;
          // The distance term preserves a crisp near field while ensuring the
          // far ocean and distant terrain converge to the same airlight as the
          // sky at the shared horizon.
          float distanceHaze = smoothstep(hazeStart, max(hazeStart + 1.0, maxDistance), d);
          // Even a nearby receiver at the geometric horizon should inherit a
          // small amount of the shared airlight. Without this floor the sky
          // branch and a water/terrain depth branch can still meet as a hard
          // line when the surface is inside the normal haze start distance.
          float horizonSurfaceMix = horizonMix * mix(horizonHazeNearSurfaceFloor, 1.0, distanceHaze);
          composed = mix(composed, horizonAirlight, horizonSurfaceMix);
          gl_FragColor = vec4(composed, source.a);
        }
      `,
    });
  }

  setDepthTexture(depth: THREE.DepthTexture): void {
    this.uniforms.tDepth.value = depth;
  }

  setSize(width: number, height: number): void {
    // Kept for composer symmetry; this pass is full resolution and derives
    // its sampling footprint from vUv and the shared depth texture.
    void width;
    void height;
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.uniforms.cameraNear.value = camera.near;
    this.uniforms.cameraFar.value = camera.far;
    (this.uniforms.invProjectionMatrix.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
    (this.uniforms.cameraMatrixWorld.value as THREE.Matrix4).copy(camera.matrixWorld);
  }

  setAtmosphereState(state: AtmosphereState): void {
    (this.uniforms.sunDirection.value as THREE.Vector3).copy(state.sunDirection);
    (this.uniforms.sunColor.value as THREE.Color).copy(state.sunColor);
    this.uniforms.sunIntensity.value = state.sunIntensity;
    (this.uniforms.skyZenith.value as THREE.Color).copy(state.skyZenith);
    (this.uniforms.skyHorizon.value as THREE.Color).copy(state.skyHorizon);
    (this.uniforms.skyAerosol.value as THREE.Color).copy(state.skyAerosol);
    this.uniforms.skyAerosolStrength.value = state.skyAerosolStrength;
    this.uniforms.skyRadianceScale.value = RENDER_STYLE.atmosphere.skyRadianceScale;
    this.uniforms.hazeStart.value = RENDER_STYLE.atmosphere.aerialPerspectiveStart;
    this.uniforms.hazeExtinction.value = RENDER_STYLE.atmosphere.aerialPerspectiveExtinction;
    this.uniforms.hazeMax.value = RENDER_STYLE.atmosphere.aerialPerspectiveMax;
    this.uniforms.horizonHazeWidth.value = RENDER_STYLE.atmosphere.horizonHazeWidth;
    this.uniforms.horizonHazeStrength.value = RENDER_STYLE.atmosphere.horizonHazeStrength;
    this.uniforms.horizonHazeNearSurfaceFloor.value = RENDER_STYLE.atmosphere.horizonHazeNearSurfaceFloor;
    this.uniforms.rayleighScaleHeight.value = state.rayleighScaleHeight;
    this.uniforms.mieScaleHeight.value = state.mieScaleHeight;
    this.uniforms.rayleighCoefficient.value = state.rayleighCoefficient;
    this.uniforms.mieCoefficient.value = state.mieCoefficient;
    this.uniforms.mieDirectionalG.value = state.mieDirectionalG;
  }

  setSettings(settings: { enabled?: boolean; maxDistance?: number }): void {
    if (settings.enabled !== undefined) this.uniforms.enabled.value = settings.enabled;
    if (settings.maxDistance !== undefined) this.uniforms.maxDistance.value = Math.max(1, settings.maxDistance);
  }
}
