import * as THREE from 'three';

export interface CloudsOptions {
  altitude?: number;
  coverage?: number;
  density?: number;
  windDirection?: number; // radians
  windSpeed?: number; // units/sec
}

export class CloudsLayer {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private start: number = performance.now();
  private wind: THREE.Vector2;

  constructor(scene: THREE.Scene, opts: CloudsOptions = {}) {
    const altitude = opts.altitude ?? 200;
    const geom = new THREE.PlaneGeometry(4000, 4000, 1, 1);
    geom.rotateX(-Math.PI / 2);
    geom.translate(0, altitude, 0);

    const dir = opts.windDirection ?? Math.PI * 0.25;
    const sp = opts.windSpeed ?? 5.0;
    this.wind = new THREE.Vector2(Math.cos(dir), Math.sin(dir)).multiplyScalar(sp);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0.0 },
        uCoverage: { value: opts.coverage ?? 0.45 },
        uDensity: { value: opts.density ?? 0.65 },
        uWind: { value: new THREE.Vector2(this.wind.x, this.wind.y) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main(){
          vUv = uv * 40.0; // tile coverage
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        uniform float uCoverage;
        uniform float uDensity;
        uniform vec2 uWind;

        // 2D value noise (simple hash-based)
        float hash(vec2 p){ return fract(sin(dot(p, vec2(41.0,289.0))) * 45758.5453); }
        float noise(vec2 p){
          vec2 i = floor(p);
          vec2 f = fract(p);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          vec2 u = f*f*(3.0-2.0*f);
          return mix(a, b, u.x) + (c - a)*u.y*(1.0 - u.x) + (d - b)*u.x*u.y;
        }
        
        float fbm(vec2 p){
          float v = 0.0;
          float a = 0.5;
          for(int i=0;i<5;i++){
            v += a * noise(p); p *= 2.02; a *= 0.5;
          }
          return v;
        }

        void main(){
          vec2 uv = vUv + uWind * (uTime * 0.01);
          float base = fbm(uv * 0.5) * 0.9 + fbm(uv * 1.7) * 0.1;
          float coverage = uCoverage; // 0..1 higher = more clouds
          float density = uDensity;
          float clouds = smoothstep(coverage, coverage + 0.25*(1.0-density), base);
          // soft edges
          clouds = pow(clouds, 1.5);
          vec3 col = mix(vec3(0.0), vec3(1.0), clouds);
          float alpha = clouds * 0.6;
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geom, this.material);
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }

  setCoverage(v: number) { this.material.uniforms.uCoverage.value = v; }
  setDensity(v: number) { this.material.uniforms.uDensity.value = v; }
  setWind(dirRad: number, speed: number) {
    this.wind.set(Math.cos(dirRad), Math.sin(dirRad)).multiplyScalar(speed);
    (this.material.uniforms.uWind.value as THREE.Vector2).copy(this.wind);
  }
  update() {
    this.material.uniforms.uTime.value = (performance.now() - this.start) / 1000;
  }
}

