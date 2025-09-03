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
        // Instance transforms in GrassBillboardSystem are translation-only, so normalMatrix is sufficient
        vNormal = normalize(normalMatrix * normal);
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

      // Optional projected cloud shadow (kept simple; no time dependency)
      uniform bool cloudShadowEnabled;
      uniform float cloudShadowIntensity; // 0..1
      uniform float cloudShadowAltitude;  // world Y of cloud plane
      uniform float cloudShadowScale;     // world units per cloud tile
      uniform float cloudCoverage;
      uniform float cloudDensity;
      uniform vec2 cloudWind;

      float chash(vec2 p){ return fract(sin(dot(p, vec2(41.0,289.0))) * 45758.5453); }
      float cnoise(vec2 p){
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = chash(i);
        float b = chash(i + vec2(1.0, 0.0));
        float c = chash(i + vec2(0.0, 1.0));
        float d = chash(i + vec2(1.0, 1.0));
        vec2 u = f*f*(3.0-2.0*f);
        return mix(a, b, u.x) + (c - a)*u.y*(1.0 - u.x) + (d - b)*u.x*u.y;
      }
      float cfbm(vec2 p){
        float v = 0.0; float a = 0.5;
        for(int i=0;i<5;i++){ v += a * cnoise(p); p *= 2.02; a *= 0.5; }
        return v;
      }
      float cloudAmountAt(vec3 worldPos, vec3 sunDir){
        if (sunDir.y <= 0.05) return 0.0;
        float t = (cloudShadowAltitude - worldPos.y) / max(sunDir.y, 1e-3);
        if (t <= 0.0) return 0.0;
        vec3 hit = worldPos + sunDir * t;
        vec2 uv = hit.xz / max(1.0, cloudShadowScale);
        uv += cloudWind * 0.0; // static projection for now
        float base = cfbm(uv * 0.5) * 0.9 + cfbm(uv * 1.7) * 0.1;
        float clouds = smoothstep(cloudCoverage, cloudCoverage + 0.25*(1.0-cloudDensity), base);
        clouds = pow(clouds, 1.5);
        return clamp(clouds, 0.0, 1.0);
      }

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

        // Cloud-projected shadow factor
        float shade = 1.0;
        if (cloudShadowEnabled && cloudShadowIntensity > 0.0) {
          float camt = cloudAmountAt(vWorldPos, L);
          float cloudShade = 1.0 - cloudShadowIntensity * camt;
          shade *= cloudShade;
        }

        vec3 diffuse = sunColor * NdotL * shade * clamp(dayLight, 0.0, 1.0);

        // Subtle fresnel rim to keep thin blades readable against dark backgrounds
        vec3 V = normalize(-vViewPos);
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
        // Cloud shadow defaults (kept in sync by Engine when clouds enabled)
        cloudShadowEnabled: { value: false },
        cloudShadowIntensity: { value: 0.35 },
        cloudShadowAltitude: { value: 200.0 },
        cloudShadowScale: { value: 100.0 },
        cloudCoverage: { value: 0.45 },
        cloudDensity: { value: 0.65 },
        cloudWind: { value: new THREE.Vector2(3.5355, 3.5355) },
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

  setCloudShadowUniforms(params: {
    enabled?: boolean;
    intensity?: number;
    altitude?: number;
    scale?: number;
    coverage?: number;
    density?: number;
    wind?: THREE.Vector2;
  }): void {
    const u = this.uniforms as Record<string, { value: unknown }>;
    if (params.enabled !== undefined) u.cloudShadowEnabled.value = !!params.enabled;
    if (params.intensity !== undefined) u.cloudShadowIntensity.value = THREE.MathUtils.clamp(params.intensity, 0, 1);
    if (params.altitude !== undefined) u.cloudShadowAltitude.value = params.altitude;
    if (params.scale !== undefined) u.cloudShadowScale.value = Math.max(1e-3, params.scale);
    if (params.coverage !== undefined) u.cloudCoverage.value = THREE.MathUtils.clamp(params.coverage, 0, 1);
    if (params.density !== undefined) u.cloudDensity.value = THREE.MathUtils.clamp(params.density, 0, 1);
    if (params.wind) (u.cloudWind.value as THREE.Vector2).copy(params.wind);
  }
}
