import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BlockMaterial } from '../src/engine/render/BlockMaterial';
import {
  AIR_REFRACTIVE_INDEX,
  ConservativeRefractionSourceCuller,
  createForwardRefractionReceiverMaterials,
  FORWARD_REFRACTION_LAYER,
  FORWARD_REFRACTION_MEDIUM,
  FORWARD_REFRACTION_MATERIAL_FLAG,
  FORWARD_REFRACTION_SOLVE_STEPS,
  WATER_REFRACTIVE_INDEX,
  forwardRefractionUniforms,
  forwardRefractionFragmentDeclarations,
  forwardRefractionVertexDeclarations,
  ForwardRefractionParticipantRegistry,
  setForwardRefractionWaterState,
  solveFlatRefractionInterface,
} from '../src/engine/render/water/ForwardRefraction';
import { ForwardRefractionPass } from '../src/engine/render/water/ForwardRefractionPass';
import {
  classifyForwardRefractionMedium,
  FORWARD_REFRACTION_WAVE_MARGIN,
} from '../src/engine/world/ForwardRefractionMeshing';

function snellResidual(
  camera: THREE.Vector3,
  source: THREE.Vector3,
  crossing: THREE.Vector3,
  cameraIor: number,
  sourceIor: number,
): number {
  const cameraVertical = Math.abs(camera.y - crossing.y);
  const sourceVertical = Math.abs(source.y - crossing.y);
  const cameraHorizontal = Math.hypot(
    camera.x - crossing.x,
    camera.z - crossing.z,
  );
  const sourceHorizontal = Math.hypot(
    source.x - crossing.x,
    source.z - crossing.z,
  );
  const cameraSine = cameraHorizontal /
    Math.hypot(cameraVertical, cameraHorizontal);
  const sourceSine = sourceHorizontal /
    Math.hypot(sourceVertical, sourceHorizontal);
  return cameraIor * cameraSine - sourceIor * sourceSine;
}

describe('forward water-interface projection', () => {
  it('solves Snell stationary paths from air into water', () => {
    const camera = new THREE.Vector3(0, 7, 0);
    const source = new THREE.Vector3(15, -4, 5);
    const crossing = solveFlatRefractionInterface(camera, source, 0, false);

    expect(crossing.y).toBe(0);
    expect(Math.abs(snellResidual(
      camera,
      source,
      crossing,
      AIR_REFRACTIVE_INDEX,
      WATER_REFRACTIVE_INDEX,
    ))).toBeLessThan(2e-4);
  });

  it('uses the reciprocal indices from water into air', () => {
    const camera = new THREE.Vector3(-2, -6, 3);
    const source = new THREE.Vector3(12, 8, -5);
    const crossing = solveFlatRefractionInterface(camera, source, 0, true);

    expect(Math.abs(snellResidual(
      camera,
      source,
      crossing,
      WATER_REFRACTIVE_INDEX,
      AIR_REFRACTIVE_INDEX,
    ))).toBeLessThan(2e-4);
  });

  it('brackets the vertex solve by the critical angle and never samples screen color', () => {
    const declarations = forwardRefractionVertexDeclarations();

    expect(FORWARD_REFRACTION_SOLVE_STEPS).toBe(14);
    expect(declarations).toContain('float cameraReach = cameraPlaneDistance');
    expect(declarations).toContain('float sourceReach = sourcePlaneDistance');
    expect(declarations).toContain('cameraIor * cameraSine < sourceIor * sourceSine');
    expect(declarations).toContain('apparentDirection * sourceDistance');
    expect(declarations).not.toContain('texture2D(tSceneColor');
  });

  it('opts terrain into the same vertex and fragment transport contract', () => {
    const material = new BlockMaterial(new THREE.Texture(), null);

    expect(material.userData[FORWARD_REFRACTION_MATERIAL_FLAG]).toBe(true);
    expect(material.vertexShader).toContain('forwardRefractionProject');
    expect(material.fragmentShader).toContain('forwardRefractionDiscardCameraMedium');
    expect(material.fragmentShader).toContain('forwardRefractionStoreReceiver');
    expect(material.fragmentShader).toContain('forwardRefractionSunVisibility');
    expect(material.fragmentShader).not.toContain('forwardRefractionOriginalScreenUv');

    material.dispose();
  });

  it('stores exact source-world receivers and reconstructs visibility only across that surface', () => {
    const declarations = forwardRefractionFragmentDeclarations();

    expect(declarations).toContain('uniform sampler2D uForwardReceiverWorld');
    expect(declarations).toContain('return sourceWorld;');
    expect(declarations).not.toContain('uForwardReceiverOrigin');
    expect(declarations).not.toContain('uForwardReceiverSize');
    expect(declarations).toContain('vec3 sourceDx = dFdx(sourceWorld)');
    expect(declarations).toContain('receiver.rgb - expectedSource');
  });

  it('classifies terrain faces conservatively around the full wave envelope', () => {
    expect(FORWARD_REFRACTION_WAVE_MARGIN).toBe(0.5);
    expect(classifyForwardRefractionMedium(44, 45, 42.5)).toBe('above');
    expect(classifyForwardRefractionMedium(40, 41, 42.5)).toBe('below');
    expect(classifyForwardRefractionMedium(42, 43, 42.5)).toBe('boundary');
    // Touching the envelope stays uncertain: only a false positive is safe.
    expect(classifyForwardRefractionMedium(43, 44, 42.5)).toBe('boundary');
  });

  it('uses minimal receiver fragments while retaining exact leaf cutouts', () => {
    const materials = createForwardRefractionReceiverMaterials({
      map: new THREE.Texture(),
      alphaCutoff: 0.5,
    });

    expect(materials.opaque.userData[FORWARD_REFRACTION_MATERIAL_FLAG]).toBe(true);
    expect(materials.cutout.userData[FORWARD_REFRACTION_MATERIAL_FLAG]).toBe(true);
    expect(materials.opaque.fragmentShader).toContain('vec4(vForwardRefractionSourceWorld, 1.0)');
    expect(materials.opaque.fragmentShader).not.toContain('texture2D(uForwardReceiverMap');
    expect(materials.cutout.fragmentShader).toContain('texture2D(uForwardReceiverMap');
    expect(materials.cutout.fragmentShader).toContain('uForwardReceiverAlphaCutoff');
    expect(materials.opaque.fragmentShader).toContain('forwardRefractionDiscardCameraMedium');
    expect(materials.opaque.fragmentShader).toContain('uForwardRefractionOutputReceiver < 0.5');
    expect(materials.cutout.vertexShader).toContain('vForwardReceiverUv = uv');
    expect(materials.opaque.depthTest).toBe(true);
    expect(materials.opaque.depthWrite).toBe(true);
    expect(materials.cutout.depthTest).toBe(true);
    expect(materials.cutout.depthWrite).toBe(true);

    materials.opaque.dispose();
    materials.cutout.dispose();
  });

  it('keeps radiance in half float but allocates the receiver field as RGB32F', () => {
    const renderer = {
      getDrawingBufferSize: (size: THREE.Vector2) => size.set(32, 24),
    } as unknown as THREE.WebGLRenderer;
    const pass = new ForwardRefractionPass(
      renderer,
      new THREE.Scene(),
      32,
      24,
    );

    expect(pass['target'].texture.type).toBe(THREE.HalfFloatType);
    expect(pass['receiverTarget'].texture.type).toBe(THREE.FloatType);
    expect(pass.getDiagnostics().receiverSpace).toBe('source-world-rgb32f');

    pass.dispose();
  });

  it('indexes forward participants without walking the scene during diagnostics', () => {
    const scene = new THREE.Scene();
    const material = new THREE.MeshBasicMaterial();
    material.userData[FORWARD_REFRACTION_MATERIAL_FLAG] = true;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    scene.add(mesh);
    const registry = new ForwardRefractionParticipantRegistry();
    registry.register(mesh);
    expect(mesh.layers.mask).toBe(3);
    const forwardLayers = new THREE.Layers();
    forwardLayers.set(FORWARD_REFRACTION_LAYER);
    expect(mesh.layers.test(forwardLayers)).toBe(true);

    const traverse = vi.spyOn(scene, 'traverse');
    const renderer = {
      getDrawingBufferSize: (size: THREE.Vector2) => size.set(32, 24),
    } as unknown as THREE.WebGLRenderer;
    const pass = new ForwardRefractionPass(renderer, scene, 32, 24, registry);
    expect(pass.getDiagnostics().participatingObjects).toBe(1);
    expect(traverse).not.toHaveBeenCalled();

    pass.dispose();
    expect(mesh.layers.mask).toBe(1);
    mesh.geometry.dispose();
    material.dispose();
  });

  it('stores source medium metadata and restores the original layer mask', () => {
    const registry = new ForwardRefractionParticipantRegistry();
    const material = new THREE.MeshBasicMaterial();
    material.userData[FORWARD_REFRACTION_MATERIAL_FLAG] = true;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    mesh.layers.set(4);

    expect(registry.register(mesh, { forwardOnly: true, medium: 'below' })).toBe(true);
    expect(mesh.layers.mask).toBe(1 << FORWARD_REFRACTION_LAYER);
    expect(mesh.userData[FORWARD_REFRACTION_MEDIUM]).toBe('below');
    registry.unregister(mesh);
    expect(mesh.layers.mask).toBe(1 << 4);
    expect(mesh.userData[FORWARD_REFRACTION_MEDIUM]).toBeUndefined();

    mesh.geometry.dispose();
    material.dispose();
  });

  it('rejects definitely above-water terrain from an above-water forward draw', () => {
    const scene = new THREE.Scene();
    const material = new THREE.MeshBasicMaterial();
    material.userData[FORWARD_REFRACTION_MATERIAL_FLAG] = true;
    const below = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    const above = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    scene.add(below, above);
    const registry = new ForwardRefractionParticipantRegistry();
    registry.register(below, { forwardOnly: true, medium: 'below' });
    registry.register(above, { forwardOnly: true, medium: 'above' });
    const renderedVisibility: Array<[boolean, boolean]> = [];
    const renderer = {
      getRenderTarget: () => null,
      getClearAlpha: () => 1,
      getClearColor: (color: THREE.Color) => color.set(0x000000),
      getDrawingBufferSize: (size: THREE.Vector2) => size.set(32, 24),
      setRenderTarget: vi.fn(),
      setClearColor: vi.fn(),
      clear: vi.fn(),
      render: vi.fn(() => renderedVisibility.push([above.visible, below.visible])),
    } as unknown as THREE.WebGLRenderer;
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
    camera.position.set(0, 8, 4);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const previousUnderwater = forwardRefractionUniforms.uForwardCameraUnderwater.value;
    setForwardRefractionWaterState({
      waterLevel: 0,
      time: 0,
      waveAmp: 1,
      waveChop: 1,
      waveSpeed: 1,
      cameraUnderwater: false,
    });

    const pass = new ForwardRefractionPass(renderer, scene, 32, 24, registry);
    pass.render(camera);

    expect(renderedVisibility).toEqual([
      [false, true],
      [false, true],
    ]);
    expect(above.visible).toBe(true);
    expect(below.visible).toBe(true);
    setForwardRefractionWaterState({
      waterLevel: 0,
      time: 0,
      waveAmp: 1,
      waveChop: 1,
      waveSpeed: 1,
      cameraUnderwater: previousUnderwater,
    });
    pass.dispose();
    below.geometry.dispose();
    above.geometry.dispose();
    material.dispose();
  });

  it('uses the minimal receiver material only for the receiver target', () => {
    const scene = new THREE.Scene();
    const colorMaterial = new THREE.MeshBasicMaterial();
    colorMaterial.userData[FORWARD_REFRACTION_MATERIAL_FLAG] = true;
    const receiverMaterial = new THREE.MeshBasicMaterial();
    receiverMaterial.userData[FORWARD_REFRACTION_MATERIAL_FLAG] = true;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), colorMaterial);
    scene.add(mesh);
    const registry = new ForwardRefractionParticipantRegistry();
    registry.register(mesh, {
      forwardOnly: true,
      medium: 'below',
      receiverMaterial,
      colorMaterial,
    });
    const renderedMaterials: THREE.Material[] = [];
    const renderer = {
      getRenderTarget: () => null,
      getClearAlpha: () => 1,
      getClearColor: (color: THREE.Color) => color.set(0x000000),
      setRenderTarget: vi.fn(),
      setClearColor: vi.fn(),
      clear: vi.fn(),
      render: vi.fn(() => renderedMaterials.push(mesh.material as THREE.Material)),
    } as unknown as THREE.WebGLRenderer;
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
    camera.position.set(0, 8, 4);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const pass = new ForwardRefractionPass(renderer, scene, 32, 24, registry);
    pass.render(camera);

    expect(renderedMaterials).toEqual([receiverMaterial, colorMaterial]);
    expect(mesh.material).toBe(colorMaterial);

    pass.dispose();
    mesh.geometry.dispose();
    receiverMaterial.dispose();
    colorMaterial.dispose();
  });

  it('culls only sources that cannot cross the conservative underwater Snell window', () => {
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
    camera.position.set(0, -10, 0);
    camera.lookAt(0, -8, -5);
    camera.updateMatrixWorld(true);
    const culler = new ConservativeRefractionSourceCuller();
    culler.update(camera, 0);

    expect(culler.intersectsBox(new THREE.Box3(
      new THREE.Vector3(-1, -4, -2),
      new THREE.Vector3(1, -2, 0),
    ))).toBe(false);
    expect(culler.intersectsBox(new THREE.Box3(
      new THREE.Vector3(-1, 0, -12),
      new THREE.Vector3(1, 2, -10),
    ))).toBe(true);
    expect(culler.intersectsBox(new THREE.Box3(
      new THREE.Vector3(80, 0, -2),
      new THREE.Vector3(82, 2, 0),
    ))).toBe(false);
  });

  it('uses aggregate instance bounds when culling instanced sources', () => {
    const scene = new THREE.Scene();
    const material = new THREE.MeshBasicMaterial();
    material.userData[FORWARD_REFRACTION_MATERIAL_FLAG] = true;
    const geometry = new THREE.BoxGeometry(1, 1, 1).translate(0, 11, -11);
    const mesh = new THREE.InstancedMesh(geometry, material, 1);
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(80, 0, 0));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    scene.add(mesh);

    const registry = new ForwardRefractionParticipantRegistry();
    registry.register(mesh);
    const renderedVisibility: boolean[] = [];
    const renderer = {
      getRenderTarget: () => null,
      getClearAlpha: () => 1,
      getClearColor: (color: THREE.Color) => color.set(0x000000),
      getDrawingBufferSize: (size: THREE.Vector2) => size.set(32, 24),
      setRenderTarget: vi.fn(),
      setClearColor: vi.fn(),
      clear: vi.fn(),
      render: vi.fn(() => renderedVisibility.push(mesh.visible)),
    } as unknown as THREE.WebGLRenderer;
    const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100);
    camera.position.set(0, -10, 0);
    camera.lookAt(0, -8, -5);
    camera.updateMatrixWorld(true);
    const previousUnderwater = forwardRefractionUniforms.uForwardCameraUnderwater.value;
    setForwardRefractionWaterState({
      waterLevel: 0,
      time: 0,
      waveAmp: 1,
      waveChop: 1,
      waveSpeed: 1,
      cameraUnderwater: true,
    });

    const pass = new ForwardRefractionPass(renderer, scene, 32, 24, registry);
    pass.render(camera);

    expect(renderedVisibility).toEqual([false, false]);
    expect(mesh.visible).toBe(true);
    setForwardRefractionWaterState({
      waterLevel: 0,
      time: 0,
      waveAmp: 1,
      waveChop: 1,
      waveSpeed: 1,
      cameraUnderwater: previousUnderwater,
    });
    pass.dispose();
    mesh.geometry.dispose();
    material.dispose();
  });
});
