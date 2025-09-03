import * as THREE from 'three'

export class GrassMaterial extends THREE.ShaderMaterial {
  constructor(map: THREE.Texture) {
    const vertexShader = `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main(){
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `;

    const fragmentShader = `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      uniform sampler2D map;
      uniform vec3 sunDirection;
      uniform vec3 sunColor;
      uniform float dayLight; // 0..1
      uniform float starLight; // 0..1 small boost at night
      uniform float alphaCutoff;
      
      void main(){
        vec4 tex = texture2D(map, vUv);
        if (tex.a < alphaCutoff) discard;
        vec3 N = normalize(vNormal);
        vec3 L = normalize(sunDirection);
        float NdotL = max(dot(N, L), 0.0);
        // Simple ambient + diffuse responding to day/night
        vec3 dayAmb = vec3(0.35, 0.45, 0.5) * 0.20;
        vec3 nightAmb = vec3(0.01, 0.015, 0.02) * 0.14;
        vec3 ambient = mix(nightAmb, dayAmb, clamp(dayLight, 0.0, 1.0));
        ambient += vec3(0.02, 0.025, 0.04) * 0.35 * clamp(starLight, 0.0, 1.0);
        vec3 diffuse = sunColor * NdotL * clamp(dayLight, 0.0, 1.0);
        vec3 color = tex.rgb * (ambient + diffuse);
        // Gamma
        color = color / (color + vec3(1.0));
        color = pow(color, vec3(1.0/2.2));
        gl_FragColor = vec4(color, tex.a);
      }
    `;

    super({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
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

