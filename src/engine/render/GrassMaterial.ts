import * as THREE from 'three'
import {
  attachForwardRefractionUniforms,
  forwardRefractionFragmentDeclarations,
  forwardRefractionVertexDeclarations,
} from './water/ForwardRefraction'

export class GrassMaterial extends THREE.ShaderMaterial {
  constructor(map: THREE.Texture) {
    const vertexShader = `
      // Instanced billboard vertex shader
      // Applies per-instance transform and passes world/view data for lighting
      ${forwardRefractionVertexDeclarations()}
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vViewPos;
      void main(){
        vUv = uv;
        // The lighting direction is world-space. Grass instances are
        // translation-only, so modelMatrix gives the matching world normal.
        vNormal = normalize(mat3(modelMatrix) * normal);
        // Apply per-instance transform so each tuft appears at its world cell
        vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vec4 viewPos = viewMatrix * worldPos;
        vViewPos = viewPos.xyz;
        vec4 directClip = projectionMatrix * viewPos;
        vec4 apparentClip = forwardRefractionProject(
          worldPos.xyz,
          directClip
        );
        gl_Position = apparentClip;
      }
    `;

    const fragmentShader = `
      // Grass billboard fragment shader
      // Lighting matches BlockMaterial style (ambient/day-night + sun diffuse), with alpha cutout
      ${forwardRefractionFragmentDeclarations()}
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vViewPos;
      uniform sampler2D map;
      uniform vec3 sunDirection;
      uniform vec3 sunColor;
      uniform float dayLight;  // 0..1
      uniform float starLight; // 0..1 small boost at night
      uniform vec3 skyAmbient; // scene-linear irradiance from AtmosphereModel
      uniform float alphaCutoff;
      uniform sampler2D voxelShadowMask;
      uniform sampler2D voxelShadowDepth;
      uniform vec2 voxelShadowResolution;
      uniform float voxelShadowCameraNear;
      uniform float voxelShadowCameraFar;
      uniform bool voxelShadowEnabled;

      float decodeVoxelShadowDepth(float raw) {
        if (raw >= 0.999999) return voxelShadowCameraFar;
        return (voxelShadowCameraNear * voxelShadowCameraFar) /
          ((voxelShadowCameraFar - voxelShadowCameraNear) * raw - voxelShadowCameraFar);
      }

      float sampleVoxelShadowDepth(vec2 uv) {
        return -decodeVoxelShadowDepth(texture2D(voxelShadowDepth, clamp(uv, vec2(0.0), vec2(1.0))).r);
      }

      float sampleVoxelShadow(vec2 uv) {
        return texture2D(voxelShadowMask, clamp(uv, vec2(0.0), vec2(1.0))).r;
      }

      float getVoxelShadowMask() {
        if (!voxelShadowEnabled) return 1.0;
        if (uForwardRefractionActive > 0.5) {
          return forwardRefractionSunVisibility(
            voxelShadowResolution,
            vForwardRefractionSourceWorld
          );
        }
        vec2 uv = gl_FragCoord.xy / max(voxelShadowResolution, vec2(1.0));
        float center = sampleVoxelShadow(uv);
        float uncertainty = smoothstep(0.02, 0.98, 4.0 * center * (1.0 - center));
        if (uncertainty <= 0.0) return center;
        vec2 texel = 1.0 / max(voxelShadowResolution, vec2(1.0));
        // Keep reconstruction on the same receiver surface. Grass is alpha
        // cutout geometry, so an ordinary four-neighbour blur would otherwise
        // leak terrain visibility into a blade silhouette.
        float referenceDepth = -vViewPos.z;
        vec2 offsets[4];
        offsets[0] = vec2(texel.x, 0.0);
        offsets[1] = vec2(-texel.x, 0.0);
        offsets[2] = vec2(0.0, texel.y);
        offsets[3] = vec2(0.0, -texel.y);
        float weighted = 0.0;
        float weightSum = 0.0;
        for (int i = 0; i < 4; i++) {
          float neighbourDepth = sampleVoxelShadowDepth(uv + offsets[i]);
          float tolerance = max(0.025, referenceDepth * 0.015);
          float weight = 1.0 - smoothstep(tolerance, tolerance * 4.0, abs(neighbourDepth - referenceDepth));
          weighted += sampleVoxelShadow(uv + offsets[i]) * weight;
          weightSum += weight;
        }
        if (weightSum <= 1e-4) return center;
        return mix(center, weighted / weightSum, 0.55 * uncertainty);
      }

      void main(){
        forwardRefractionDiscardCameraMedium();
        vec4 tex = texture2D(map, vUv);
        if (tex.a < alphaCutoff) discard;
        if (uForwardRefractionOutputReceiver > 0.5) {
          gl_FragColor = vec4(
            forwardRefractionStoreReceiver(vForwardRefractionSourceWorld),
            1.0
          );
          return;
        }
        // The grass texture is uploaded as SRGBColorSpace, so sampled RGB is
        // already linear in WebGL.
        vec3 albedo = tex.rgb;
        vec3 N = normalize(vNormal);
        vec3 L = normalize(sunDirection);
        float NdotL = max(dot(N, L), 0.0);

        // Ambient + day/night modulation (mirrors BlockMaterial tuning)
        vec3 starAmb = vec3(0.02, 0.025, 0.04) * 0.35 * clamp(starLight, 0.0, 1.0);
        vec3 ambient = skyAmbient + starAmb;

        vec3 diffuse = sunColor * NdotL * clamp(dayLight, 0.0, 1.0) * getVoxelShadowMask();

        // Subtle fresnel rim to keep thin blades readable against dark backgrounds
        // N and the lighting direction are world-space, so keep the view
        // vector in the same space for camera-stable rim lighting.
        vec3 V = normalize(cameraPosition - vWorldPos);
        float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.0);
        vec3 rim = vec3(0.8, 0.9, 1.0) * fresnel * 0.12 * clamp(dayLight, 0.0, 1.0);

        vec3 color = albedo * (ambient + diffuse + rim);
        // Cutout writes opaque color (no blending); alpha unused when transparent=false
        gl_FragColor = vec4(color, 1.0);
      }
    `;

    super({
      vertexShader,
      fragmentShader,
      // Use alpha cutout instead of blending for crisp edges and correct depth
      transparent: false,
      toneMapped: false,
      depthWrite: true,
      side: THREE.DoubleSide,
      uniforms: {
        map: { value: map },
        sunDirection: { value: new THREE.Vector3(0,1,0) },
        sunColor: { value: new THREE.Color(1,1,1) },
        dayLight: { value: 1.0 },
        starLight: { value: 0.0 },
        skyAmbient: { value: new THREE.Color(0.12, 0.18, 0.32) },
        alphaCutoff: { value: 0.15 },
        voxelShadowMask: { value: null },
        voxelShadowDepth: { value: null },
        voxelShadowResolution: { value: new THREE.Vector2(1, 1) },
        voxelShadowCameraNear: { value: 0.1 },
        voxelShadowCameraFar: { value: 1024.0 },
        voxelShadowEnabled: { value: false },
      }
    });
    attachForwardRefractionUniforms(this)
  }

  setMap(tex: THREE.Texture) {
    (this.uniforms.map as { value: THREE.Texture }).value = tex;
    this.needsUpdate = true;
  }
  setSun(dir: THREE.Vector3, color: THREE.Color) {
    (this.uniforms.sunDirection as { value: THREE.Vector3 }).value.copy(dir);
    (this.uniforms.sunColor as { value: THREE.Color }).value.copy(color);
  }
  setDayNight(day: number, star: number) {
    (this.uniforms.dayLight as { value: number }).value = THREE.MathUtils.clamp(day, 0, 1);
    (this.uniforms.starLight as { value: number }).value = THREE.MathUtils.clamp(star, 0, 1);
  }
  setSkyAmbient(color: THREE.Color) {
    (this.uniforms.skyAmbient as { value: THREE.Color }).value.copy(color)
  }
  setAlphaCutoff(c: number) { (this.uniforms.alphaCutoff as { value: number }).value = THREE.MathUtils.clamp(c, 0, 1); }

  setVoxelShadowTexture(texture: THREE.Texture, width: number, height: number, enabled = true): void {
    (this.uniforms.voxelShadowMask as { value: THREE.Texture }).value = texture;
    (this.uniforms.voxelShadowResolution as { value: THREE.Vector2 }).value.set(Math.max(1, width), Math.max(1, height));
    (this.uniforms.voxelShadowEnabled as { value: boolean }).value = enabled;
  }

  setVoxelShadowDepthTexture(texture: THREE.Texture, near: number, far: number): void {
    (this.uniforms.voxelShadowDepth as { value: THREE.Texture }).value = texture;
    (this.uniforms.voxelShadowCameraNear as { value: number }).value = near;
    (this.uniforms.voxelShadowCameraFar as { value: number }).value = far;
  }
}
