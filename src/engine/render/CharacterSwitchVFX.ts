import * as THREE from 'three';
import switchSoundUrl from '../../assets/sounds/sound_effects/switch_sound.mp3';

/**
 * Character-switch scan copied from ref/character_switch_vfx.html.
 *
 * The reference is an authored shader sweep over a character silhouette. The
 * runtime flattens the active rig into the same character-local space before
 * applying the reference material, so the scan follows the player's current
 * pose without changing the gameplay camera or the selected appearance.
 */
export const CHARACTER_SWITCH_VFX_CONFIG = {
  cycleDuration: 1.7,
  coreWidth: 0.038,
  glowWidth: 0.15,
  shellOffset: 0.018,
} as const;

const SCAN_VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uSweep;
  uniform float uGlowWidth;
  uniform float uShellOffset;

  varying vec3 vObjPos;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;
  varying float vBand;
  varying float vAz;

  void main() {
    vObjPos = position;
    vAz = atan(position.x, position.z + 1e-5);

    float flow = sin(vAz * 6.0 + position.y * 4.5 - uTime * 6.2) * 0.035
               + sin(vAz * 11.0 - position.y * 3.2 + uTime * 10.5) * 0.018;
    float distToSweep = abs(position.y - (uSweep + flow));
    float band = 1.0 - smoothstep(0.0, uGlowWidth, distToSweep);
    float flutter = 0.45 + 0.55 * sin(uTime * 18.0 + vAz * 7.0 + position.y * 13.0);
    float push = uShellOffset + band * (0.006 + 0.016 * flutter);

    vec3 displaced = position + normal * push;
    vec4 world = modelMatrix * vec4(displaced, 1.0);
    vec3 worldNormal = normalize(mat3(modelMatrix) * normal);

    vWorldPos = world.xyz;
    vWorldNormal = worldNormal;
    vViewDir = normalize(cameraPosition - world.xyz);
    vBand = band;

    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const SCAN_FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uSweep;
  uniform float uTop;
  uniform float uBottom;
  uniform float uCoreWidth;
  uniform float uGlowWidth;

  varying vec3 vObjPos;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying vec3 vViewDir;
  varying float vBand;
  varying float vAz;

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }

  float noise3(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash31(i + vec3(0.0,0.0,0.0));
    float n100 = hash31(i + vec3(1.0,0.0,0.0));
    float n010 = hash31(i + vec3(0.0,1.0,0.0));
    float n110 = hash31(i + vec3(1.0,1.0,0.0));
    float n001 = hash31(i + vec3(0.0,0.0,1.0));
    float n101 = hash31(i + vec3(1.0,0.0,1.0));
    float n011 = hash31(i + vec3(0.0,1.0,1.0));
    float n111 = hash31(i + vec3(1.0,1.0,1.0));
    float nx00 = mix(n000, n100, f.x);
    float nx10 = mix(n010, n110, f.x);
    float nx01 = mix(n001, n101, f.x);
    float nx11 = mix(n011, n111, f.x);
    float nxy0 = mix(nx00, nx10, f.y);
    float nxy1 = mix(nx01, nx11, f.y);
    return mix(nxy0, nxy1, f.z);
  }

  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise3(p);
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(vViewDir);
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 2.3);

    float swirl = (fbm(vec3(vAz * 1.8, vObjPos.y * 2.6 - uTime * 1.6, length(vObjPos.xz) * 5.0)) - 0.5) * 0.08
                + sin(vAz * 7.0 + vObjPos.y * 5.0 - uTime * 8.0) * 0.022
                + sin(-vAz * 13.0 + vObjPos.y * 8.0 + uTime * 12.0) * 0.012;

    float dist = abs(vObjPos.y - (uSweep + swirl));
    float core = 1.0 - smoothstep(0.0, uCoreWidth, dist);
    float aura = 1.0 - smoothstep(uCoreWidth, uGlowWidth, dist);

    float strand1 = 0.5 + 0.5 * sin(vAz * 16.0 + vObjPos.y * 11.0 - uTime * 24.0 + fbm(vec3(vObjPos * 4.0 + uTime)) * 5.0);
    float strand2 = 0.5 + 0.5 * sin(-vAz * 12.0 + vObjPos.y * 15.0 - uTime * 18.5);
    float strands = (pow(strand1, 7.0) + pow(strand2, 7.0)) * aura;

    float spark = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float streak = sin(vAz * (21.0 + fi * 3.0) + vObjPos.y * (17.0 - fi * 1.5) - uTime * (28.0 + fi * 8.0) + fi * 1.7);
      spark += smoothstep(0.96, 0.997, streak);
    }
    spark *= aura * (0.3 + 0.7 * fresnel);

    float frontEdge = smoothstep(-0.06, 0.0, vObjPos.y - uSweep) * (1.0 - smoothstep(0.0, 0.08, vObjPos.y - uSweep));
    float frontFlash = frontEdge * (0.65 + 0.35 * sin(uTime * 24.0 + vAz * 6.0));

    float trailDelta = uSweep - vObjPos.y;
    float trail = smoothstep(0.03, 0.12, trailDelta) * (1.0 - smoothstep(0.12, 0.55, trailDelta));
    trail *= 0.25 + 0.75 * fbm(vec3(vObjPos.xy * 3.6, uTime * 1.25));

    vec3 gold = mix(vec3(1.0, 0.63, 0.10), vec3(1.0, 0.93, 0.68), clamp(0.25 + 0.5 * fresnel + 0.35 * aura, 0.0, 1.0));
    vec3 ember = vec3(1.0, 0.52, 0.08);
    vec3 pale = vec3(1.0, 0.98, 0.84);

    vec3 color = vec3(0.0);
    color += gold * aura * (0.32 + 0.85 * fresnel);
    color += mix(gold, pale, 0.35) * core * (1.25 + 1.5 * fresnel);
    color += mix(gold, ember, 0.4) * strands * (0.9 + 1.1 * fresnel);
    color += ember * spark * 0.85;
    color += pale * frontFlash * 0.65;
    color += gold * trail * 0.26;

    float alpha = aura * 0.16 + core * 0.42 + strands * 0.18 + spark * 0.12 + frontFlash * 0.10 + trail * 0.08;
    alpha *= 0.65 + 0.8 * fresnel;
    alpha = clamp(alpha, 0.0, 0.92);

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

interface ScanUniforms {
  [uniform: string]: { value: number };
  uTime: { value: number };
  uSweep: { value: number };
  uTop: { value: number };
  uBottom: { value: number };
  uCoreWidth: { value: number };
  uGlowWidth: { value: number };
  uShellOffset: { value: number };
}

function isDescendantOf(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function isVisibleInHierarchy(object: THREE.Object3D, root: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    if (current === root) return true;
    current = current.parent;
  }
  return false;
}

function createCharacterSpaceGeometry(
  target: THREE.Object3D,
  excluded: THREE.Object3D,
): THREE.BufferGeometry | null {
  target.updateMatrixWorld(true);
  const targetInverse = new THREE.Matrix4().copy(target.matrixWorld).invert();
  const positionValues: number[] = [];
  const normalValues: number[] = [];

  target.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (isDescendantOf(object, excluded) || !isVisibleInHierarchy(object, target)) return;

    const sourceGeometry = object.geometry.clone();
    const geometry = sourceGeometry.index ? sourceGeometry.toNonIndexed() : sourceGeometry;
    if (geometry !== sourceGeometry) sourceGeometry.dispose();
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();

    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    if (!positions || !normals) {
      geometry.dispose();
      return;
    }

    const relativeMatrix = targetInverse.clone().multiply(object.matrixWorld);
    geometry.applyMatrix4(relativeMatrix);
    for (let index = 0; index < positions.count; index += 1) {
      positionValues.push(positions.getX(index), positions.getY(index), positions.getZ(index));
      normalValues.push(normals.getX(index), normals.getY(index), normals.getZ(index));
    }
    geometry.dispose();
  });

  if (positionValues.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positionValues, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normalValues, 3));
  geometry.computeBoundingBox();
  return geometry;
}

export class CharacterSwitchVFX {
  readonly object = new THREE.Group();

  private scanMesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private scanUniforms: ScanUniforms | null = null;
  private localTime = Number.POSITIVE_INFINITY;
  private volume = 0.7;
  private switchAudio: HTMLAudioElement | null = null;
  private disposed = false;

  constructor() {
    this.object.name = 'PlayerCharacter.SwitchVFX';
    this.object.visible = false;
  }

  /** Rebuild the scan silhouette from the current authored character rig. */
  setTarget(target: THREE.Object3D): void {
    if (this.disposed) return;
    this.clearScanMesh();

    const geometry = createCharacterSpaceGeometry(target, this.object);
    if (!geometry?.boundingBox) return;
    const bounds = geometry.boundingBox;
    const topY = bounds.max.y;
    const bottomY = bounds.min.y;

    const uniforms: ScanUniforms = {
      uTime: { value: 0 },
      uSweep: { value: topY },
      uTop: { value: topY },
      uBottom: { value: bottomY },
      uCoreWidth: { value: CHARACTER_SWITCH_VFX_CONFIG.coreWidth },
      uGlowWidth: { value: CHARACTER_SWITCH_VFX_CONFIG.glowWidth },
      uShellOffset: { value: CHARACTER_SWITCH_VFX_CONFIG.shellOffset },
    };
    const material = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: SCAN_VERTEX_SHADER,
      fragmentShader: SCAN_FRAGMENT_SHADER,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'CharacterSwitchVFX.Scan';
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    this.scanUniforms = uniforms;
    this.scanMesh = mesh;
    this.object.add(mesh);
  }

  setVolume(volume: number): void {
    this.volume = THREE.MathUtils.clamp(volume, 0, 1);
    if (this.switchAudio) this.switchAudio.volume = this.volume;
  }

  trigger(): void {
    if (this.disposed) return;
    this.localTime = 0;
    this.object.visible = this.scanMesh !== null;
    this.updateScan(0);
    this.playSwitchSound();
  }

  update(deltaSeconds: number): void {
    if (this.disposed || !Number.isFinite(this.localTime)) return;
    this.localTime += Math.max(0, deltaSeconds);
    this.updateScan(this.localTime);
    if (this.localTime >= CHARACTER_SWITCH_VFX_CONFIG.cycleDuration) {
      this.localTime = Number.POSITIVE_INFINITY;
      this.object.visible = false;
    }
  }

  private updateScan(time: number): void {
    const uniforms = this.scanUniforms;
    if (!uniforms) return;
    const cycle = CHARACTER_SWITCH_VFX_CONFIG.cycleDuration;
    const progress = (time % cycle) / cycle;
    const eased = 1 - Math.pow(1 - progress, 2.35);
    uniforms.uTime.value = time;
    uniforms.uSweep.value = THREE.MathUtils.lerp(
      uniforms.uTop.value + 0.04,
      uniforms.uBottom.value - 0.04,
      eased,
    );
  }

  private playSwitchSound(): void {
    try {
      if (!this.switchAudio) {
        this.switchAudio = new Audio(switchSoundUrl);
        this.switchAudio.preload = 'auto';
      }
      this.switchAudio.volume = this.volume;
      this.switchAudio.pause();
      this.switchAudio.currentTime = 0;
      void this.switchAudio.play().catch(() => { /* autoplay may be blocked */ });
    } catch {
      // Audio is optional; the scan remains independent of it.
    }
  }

  private clearScanMesh(): void {
    if (!this.scanMesh) return;
    this.object.remove(this.scanMesh);
    this.scanMesh.geometry.dispose();
    this.scanMesh.material.dispose();
    this.scanMesh = null;
    this.scanUniforms = null;
    this.object.visible = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.localTime = Number.POSITIVE_INFINITY;
    this.clearScanMesh();
    this.object.removeFromParent();
    try {
      this.switchAudio?.pause();
    } catch {
      // Ignore cleanup failures from browser audio implementations.
    }
    this.switchAudio = null;
  }
}
