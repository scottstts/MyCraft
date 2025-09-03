import * as THREE from 'three'

export class BodyMaterial extends THREE.ShaderMaterial {
  constructor(map: THREE.Texture) {
    const vertexShader = `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vViewPos;
      void main(){
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vec4 viewPos = viewMatrix * worldPos;
        vViewPos = viewPos.xyz;
        gl_Position = projectionMatrix * viewPos;
      }
    `;

    const fragmentShader = `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying vec3 vViewPos;
      uniform sampler2D map;
      uniform vec3 sunDirection;
      uniform vec3 sunColor;
      uniform float dayLight;  // 0..1
      uniform float starLight; // 0..1
      uniform float alphaCutoff;

      void main(){
        vec4 tex = texture2D(map, vUv);
        if (tex.a < alphaCutoff) discard;

        vec3 N = normalize(vNormal);
        vec3 L = normalize(sunDirection);
        float NdotL = max(dot(N, L), 0.0);

        // Ambient day/night similar to BlockMaterial (simplified)
        vec3 dayAmb = vec3(0.4, 0.5, 0.6) * 0.20;
        vec3 nightAmb = vec3(0.01, 0.015, 0.02) * 0.12;
        vec3 ambBase = mix(nightAmb, dayAmb, clamp(dayLight, 0.0, 1.0));
        vec3 starAmb = vec3(0.02, 0.025, 0.04) * 0.35 * clamp(starLight, 0.0, 1.0);
        vec3 ambient = ambBase + starAmb;

        vec3 diffuse = sunColor * NdotL * clamp(dayLight, 0.0, 1.0);

        // Subtle rim to keep silhouette readable
        vec3 V = normalize(-vViewPos);
        float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.0);
        vec3 rim = vec3(0.8, 0.9, 1.0) * fresnel * 0.08 * clamp(dayLight, 0.0, 1.0);

        vec3 color = tex.rgb * (ambient + diffuse + rim);
        color = color / (color + vec3(1.0));
        color = pow(color, vec3(1.0/2.2));
        gl_FragColor = vec4(color, 1.0);
      }
    `;

    super({
      vertexShader,
      fragmentShader,
      transparent: false,
      depthWrite: true,
      side: THREE.FrontSide,
      uniforms: {
        map: { value: map },
        sunDirection: { value: new THREE.Vector3(0,1,0) },
        sunColor: { value: new THREE.Color(1,1,1) },
        dayLight: { value: 1.0 },
        starLight: { value: 0.0 },
        alphaCutoff: { value: 0.5 },
      }
    });
  }

  setMap(tex: THREE.Texture) {
    (this.uniforms.map as { value: THREE.Texture }).value = tex;
    this.needsUpdate = true;
  }
  setLighting(dir: THREE.Vector3, color: THREE.Color, day: number, star: number) {
    (this.uniforms.sunDirection as { value: THREE.Vector3 }).value.copy(dir);
    (this.uniforms.sunColor as { value: THREE.Color }).value.copy(color);
    (this.uniforms.dayLight as { value: number }).value = THREE.MathUtils.clamp(day, 0, 1);
    (this.uniforms.starLight as { value: number }).value = THREE.MathUtils.clamp(star, 0, 1);
  }
  setAlphaCutoff(c: number) {
    (this.uniforms.alphaCutoff as { value: number }).value = THREE.MathUtils.clamp(c, 0, 1);
  }
}

