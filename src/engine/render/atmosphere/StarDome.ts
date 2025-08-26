import * as THREE from 'three';

export interface StarDomeOptions {
  radius?: number;
  intensity?: number; // brightness multiplier
}

export class StarDome {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private start: number = performance.now();
  private intensity: number;

  constructor(scene: THREE.Scene, opts: StarDomeOptions = {}) {
    const radius = opts.radius ?? 1000;
    this.intensity = opts.intensity ?? 1.0;
    const geom = new THREE.SphereGeometry(radius, 32, 16);
    geom.scale(1, 1, -1); // inward facing

    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      uniforms: {
        uTime: { value: 0.0 },
        uVisibility: { value: 0.0 },
        uIntensity: { value: this.intensity },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main(){
          vec4 wp = modelMatrix * vec4(position,1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        varying vec3 vWorld;
        uniform float uTime;
        uniform float uVisibility;
        uniform float uIntensity;
        
        // Hash from IQ
        float hash(vec2 p){
          p = vec2(dot(p, vec2(127.1,311.7)), dot(p, vec2(269.5,183.3)));
          return fract(sin(p.x+p.y)*43758.5453123);
        }
        
        float star(vec2 uv){
          // grid cell
          vec2 gv = fract(uv) - 0.5;
          vec2 id = floor(uv);
          float n = hash(id);
          vec2 p = (vec2(hash(id+0.1), hash(id+2.3)) - 0.5) * 0.8;
          float d = length(gv - p);
          float m = smoothstep(0.05, 0.0, d);
          // twinkle
          float tw = 0.5 + 0.5 * sin(uTime*0.5 + n*6.2831);
          return m * tw;
        }
        
        void main(){
          // Project world direction to equirectangular uv
          vec3 d = normalize(vWorld);
          float u = atan(d.z, d.x) / 6.2831853 + 0.5;
          float v = acos(clamp(d.y, -1.0, 1.0)) / 3.1415926;
          vec2 uv = vec2(u*200.0, v*100.0);
          float s = star(uv);
          vec3 col = vec3(s) * uIntensity;
          gl_FragColor = vec4(col, s * uVisibility);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geom, this.material);
    scene.add(this.mesh);
  }

  setVisibility(v: number): void {
    this.material.uniforms.uVisibility.value = THREE.MathUtils.clamp(v, 0, 1);
  }

  setIntensity(i: number): void {
    this.intensity = i;
    this.material.uniforms.uIntensity.value = i;
  }

  update(): void {
    this.material.uniforms.uTime.value = (performance.now() - this.start) / 1000;
  }
}

