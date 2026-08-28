import * as THREE from 'three'

export class GrassMaterial extends THREE.ShaderMaterial {
  constructor(map: THREE.Texture) {
    const vertexShader = `
      // Instanced billboard vertex shader
      // Applies per-instance transform and passes world/view data for lighting
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
        gl_Position = projectionMatrix * viewPos;
      }
    `;

    const fragmentShader = `
      // Grass billboard fragment shader
      // Lighting matches BlockMaterial style (ambient/day-night + sun diffuse), with alpha cutout
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vViewPos;
      uniform sampler2D map;
      uniform vec3 sunDirection;
      uniform vec3 sunColor;
      uniform float dayLight;  // 0..1
      uniform float starLight; // 0..1 small boost at night
      uniform float alphaCutoff;

      void main(){
        vec4 tex = texture2D(map, vUv);
        if (tex.a < alphaCutoff) discard;
        vec3 N = normalize(vNormal);
        vec3 L = normalize(sunDirection);
        float NdotL = max(dot(N, L), 0.0);

        // Ambient + day/night modulation (mirrors BlockMaterial tuning)
        vec3 dayAmb = vec3(0.4, 0.5, 0.6) * 0.20;
        vec3 nightAmb = vec3(0.01, 0.015, 0.02) * 0.12;
        vec3 ambBase = mix(nightAmb, dayAmb, clamp(dayLight, 0.0, 1.0));
        vec3 starAmb = vec3(0.02, 0.025, 0.04) * 0.35 * clamp(starLight, 0.0, 1.0);
        vec3 ambient = ambBase + starAmb;

        vec3 diffuse = sunColor * NdotL * clamp(dayLight, 0.0, 1.0);

        // Subtle fresnel rim to keep thin blades readable against dark backgrounds
        // N and the lighting direction are world-space, so keep the view
        // vector in the same space for camera-stable rim lighting.
        vec3 V = normalize(cameraPosition - vWorldPos);
        float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.0);
        vec3 rim = vec3(0.8, 0.9, 1.0) * fresnel * 0.12 * clamp(dayLight, 0.0, 1.0);

        vec3 color = tex.rgb * (ambient + diffuse + rim);
        // Tone map + gamma to match blocks
        color = color / (color + vec3(1.0));
        color = pow(color, vec3(1.0/2.2));
        // Cutout writes opaque color (no blending); alpha unused when transparent=false
        gl_FragColor = vec4(color, 1.0);
      }
    `;

    super({
      vertexShader,
      fragmentShader,
      // Use alpha cutout instead of blending for crisp edges and correct depth
      transparent: false,
      depthWrite: true,
      side: THREE.DoubleSide,
      uniforms: {
        map: { value: map },
        sunDirection: { value: new THREE.Vector3(0,1,0) },
        sunColor: { value: new THREE.Color(1,1,1) },
        dayLight: { value: 1.0 },
        starLight: { value: 0.0 },
        alphaCutoff: { value: 0.15 },
      }
    });
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
  setAlphaCutoff(c: number) { (this.uniforms.alphaCutoff as { value: number }).value = THREE.MathUtils.clamp(c, 0, 1); }
}
