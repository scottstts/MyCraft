import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BlockMaterial } from '../src/engine/render/BlockMaterial';
import { WaterSurfaceMaterial } from '../src/engine/render/water/WaterSurfaceMaterial';
import { WaterSystem } from '../src/engine/render/water/WaterSystem';
import { OCEAN_WATER_CENTER_OFFSET, sampleOceanHeight } from '../src/engine/render/water/OceanWaveField';

describe('WaterSurfaceMaterial', () => {
  it('uses forward-projected Snell transport with coherent color, depth, and coverage', () => {
    const material = new WaterSurfaceMaterial({ map: null, ocean: true });

    expect(material.fragmentShader).toContain('projectWorldToUv');
    expect(material.fragmentShader).toContain('reconstructWorldPosition');
    expect(material.fragmentShader).toContain('uProjectionMatrix * viewMatrix');
    expect(material.fragmentShader).toContain('uForwardProjection');
    expect(material.fragmentShader).toContain('texture2D(tSceneColor, screenUv)');
    expect(material.fragmentShader).toContain('texture2D(tSceneDepth, screenUv)');
    expect(material.fragmentShader).toContain('apparentSample.rgb / max(apparentSample.a, 0.001)');
    expect(material.fragmentShader).toContain('sceneHitValidity = clamp(apparentSample.a, 0.0, 1.0)');
    expect(material.fragmentShader).toContain('sceneHitValidity * depthCoverage');
    expect(material.fragmentShader).toContain('float physicalWaterPath = -rayProjection + sqrt');
    expect(material.fragmentShader).toContain('dielectricFresnel');
    expect(material.fragmentShader).toContain('criticalSafeRefract');
    expect(material.fragmentShader).toContain('bool underwaterView = uCameraUnderwater');
    expect(material.fragmentShader).not.toContain('gl_FrontFacing');
    expect(material.fragmentShader).toContain('vec3 windowDirection = criticalSafeRefract(incident, normal, eta)');
    expect(material.fragmentShader).toContain('transmitted = window');
    expect(material.fragmentShader).not.toContain('bool tir =');
    expect(material.fragmentShader).not.toContain('if (!tir)');
    expect(material.fragmentShader).toContain('ggxDistribution');
    expect(material.vertexShader).toContain('float oceanPixelFootprint(vec3 surfacePosition)');
    expect(material.vertexShader).toContain('return oceanWaveDisplacement(worldPosition, time, vertexFootprint)');
    expect(material.vertexShader).toContain('oceanWaveLod(footprint, OCEAN_WAVE_LENGTH_');
    expect(material.fragmentShader).toContain('float surfaceFootprint = oceanPixelFootprint(vBaseWorld)');
    expect(material.fragmentShader).toContain('opticalWorld = vBaseWorld + oceanWaveDisplacement(');
    expect(material.fragmentShader).toContain('transportNormal');
    expect(material.fragmentShader).not.toContain('float surfaceDepth = vViewDepth');
    expect(material.fragmentShader).toContain('float slopeVariance');
    expect(material.fragmentShader).toContain('float filteredRoughness');
    expect(material.fragmentShader).toContain('float solarVariance');
    expect(material.fragmentShader).toContain('float skirtAlpha');
    expect(material.fragmentShader).toContain('float sunLobe = mix(coreLobe, skirtLobe, 0.42)');
    expect(material.fragmentShader).toContain('normalFootprint');
    expect(material.fragmentShader).toContain('geometricFresnelResult');
    expect(material.fragmentShader).toContain('grazingTransmissionCoverage');
    expect(material.fragmentShader).toContain('sceneHitValidity');
    expect(material.fragmentShader).not.toContain('refractedReceiverValidity');
    expect(material.fragmentShader).not.toContain('backtrackIndex');
    expect(material.fragmentShader).not.toContain('candidateUv');
    expect(material.fragmentShader).toContain('float swashArrival = smoothstep(');
    expect(material.fragmentShader).toContain('shorelineBand * patchMask * swashArrival');
    expect(material.fragmentShader).not.toContain('shorelineBand * (1.0 - patchMask) * foamFront');
    expect(material.fragmentShader).not.toContain('contactFallbackCoverage');
    expect(material.fragmentShader).toContain('sceneRefraction = sceneSample.rgb');
    expect(material.fragmentShader).not.toContain('sceneRefraction = mix(deep, sceneSample.rgb, sceneHitValidity)');
    expect(material.fragmentShader).toContain('(1.0 - fresnel) * grazingTransmissionCoverage');
    expect(material.fragmentShader).not.toContain('mix(refractedUv, screenUv, foregroundReject)');
    expect(material.fragmentShader).not.toContain('vec2 resolvedUv = refractedUv;\n            float resolvedRawDepth = uHasSceneDepth');
    expect(material.fragmentShader).not.toContain('step(uWaterLevel - 0.05, candidateWorld.y)');
    expect(material.fragmentShader).not.toContain('refractionResolveCoverage');
    expect(material.fragmentShader).not.toContain('pow(sun, 2200.0)');
    expect(material.fragmentShader).toContain('uDebugMode == 8');
    expect(material.fragmentShader).toContain('uDebugMode == 9');
    expect(material.fragmentShader).not.toContain('length(dFdx(vWorld.xz))');
    expect(material.fragmentShader).not.toContain('dFdx(normal)');
    expect(material.fragmentShader).not.toContain('refractedDirection.xz * uRefractAmount');
    expect(material.fragmentShader).not.toContain('abs(refractedDirection.z)');
    expect(material.fragmentShader).not.toContain('pow((1.0 - 1.333)');

    material.dispose();
  });

  it('classifies the camera directly against the displaced surface without an optics threshold', () => {
    const textureLoad = vi.spyOn(THREE.TextureLoader.prototype, 'load')
      .mockImplementation((_url, onLoad) => {
        const texture = new THREE.Texture();
        onLoad?.(texture);
        return texture;
      });
    const scene = new THREE.Scene();
    const waterLevel = 42;
    const registeredShadowMaterials: THREE.Material[] = [];
    const unregisteredShadowMaterials: THREE.Material[] = [];
    const water = new WaterSystem(scene, {
      bounds: { minX: -16, maxX: 16, minZ: -16, maxZ: 16 },
      waterLevel,
      farDistance: 128,
      seed: 17,
      worldRadius: 32,
      registerShadowSamplingMaterial: (material) => registeredShadowMaterials.push(material),
      unregisterShadowSamplingMaterial: (material) => unregisteredShadowMaterials.push(material),
    });
    expect(registeredShadowMaterials).toHaveLength(1);
    const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 512);
    const displacedSurface = waterLevel + OCEAN_WATER_CENTER_OFFSET
      + sampleOceanHeight(0, 0, 0);

    camera.position.set(0, displacedSurface - 1e-4, 0);
    water.update(0, camera);
    expect(water.isCameraUnderwater()).toBe(true);
    expect(water.getCameraSurfaceY()).toBeCloseTo(displacedSurface, 10);

    camera.position.y = displacedSurface + 1e-4;
    water.update(0, camera);
    expect(water.isCameraUnderwater()).toBe(false);

    water.dispose();
    expect(unregisteredShadowMaterials).toEqual(registeredShadowMaterials);
    textureLoad.mockRestore();
  });

  it('keeps camera reconstruction matrices current', () => {
    const material = new WaterSurfaceMaterial({ map: null, ocean: true });
    const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.2, 768);
    camera.position.set(12, 48, -19);
    camera.lookAt(4, 42, 7);
    camera.updateProjectionMatrix();

    material.setCamera(camera);

    expect(material.uniforms.uProjectionMatrix.value.elements)
      .toEqual(camera.projectionMatrix.elements);
    expect(material.uniforms.uProjectionMatrixInverse.value.elements)
      .toEqual(camera.projectionMatrixInverse.elements);
    expect(material.uniforms.uViewMatrixInverse.value.elements)
      .toEqual(camera.matrixWorld.elements);
    expect(material.uniforms.uCameraNear.value).toBe(camera.near);
    expect(material.uniforms.uCameraFar.value).toBe(camera.far);

    material.dispose();
  });

  it('reapplies current sun visibility to only the refracted direct-light share', () => {
    const material = new WaterSurfaceMaterial({ map: null, ocean: true });
    const visibility = new THREE.Texture();

    material.setSunVisibility(visibility);

    expect(material.uniforms.tSunVisibility.value).toBe(visibility);
    expect(material.uniforms.uHasSunVisibility.value).toBe(1);
    expect(material.fragmentShader).toContain('refractedSunVisibility');
    expect(material.fragmentShader).toContain('float directLightFraction = clamp(sceneSample.a');
    expect(material.fragmentShader).toContain('mix(1.0, sunVisibility, directLightFraction)');
    expect(material.fragmentShader).toContain('abs(neighbourDepth - referenceDepth)');

    material.setSunVisibility(null);
    expect(material.uniforms.uHasSunVisibility.value).toBe(0);

    visibility.dispose();
    material.dispose();
  });

  it('excludes every water layer from the scene-color capture and restores it', () => {
    const textureLoad = vi.spyOn(THREE.TextureLoader.prototype, 'load')
      .mockImplementation((_url, onLoad) => {
        const texture = new THREE.Texture();
        onLoad?.(texture);
        return texture;
      });
    const scene = new THREE.Scene();
    const blockWater = new WaterSurfaceMaterial({ map: null });
    const water = new WaterSystem(scene, {
      bounds: { minX: -16, maxX: 16, minZ: -16, maxZ: 16 },
      waterLevel: 42,
      farDistance: 128,
      seed: 17,
      worldRadius: 32,
      blockWaterMaterial: blockWater,
    });
    const ocean = scene.getObjectByName('OceanSurface');

    expect(ocean?.visible).toBe(true);
    expect(blockWater.visible).toBe(true);

    water.setOpaqueCaptureMode(true);
    expect(ocean?.visible).toBe(false);
    expect(blockWater.visible).toBe(false);

    water.setOpaqueCaptureMode(false);
    expect(ocean?.visible).toBe(true);
    expect(blockWater.visible).toBe(true);

    water.dispose();
    blockWater.dispose();
    textureLoad.mockRestore();
  });

  it('closes a taller visual seabed column against the authoritative terrain boundary', () => {
    const textureLoad = vi.spyOn(THREE.TextureLoader.prototype, 'load')
      .mockImplementation((_url, onLoad) => {
        const texture = new THREE.Texture();
        onLoad?.(texture);
        return texture;
      });
    const scene = new THREE.Scene();
    const water = new WaterSystem(scene, {
      bounds: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 },
      waterLevel: 42,
      farDistance: 128,
      seed: 17,
      worldRadius: 4,
    });
    const geometryBuilder = water as unknown as {
      sampleTerrainHeight: (x: number, z: number) => number;
      sampleSeabedHeight: (x: number, z: number) => number;
      createVoxelRingGeometry: (nearRange: number) => THREE.BufferGeometry;
    };

    geometryBuilder.sampleTerrainHeight = () => 5;
    geometryBuilder.sampleSeabedHeight = (x, z) => x === 1 && z === 0 ? 10 : 4;
    const geometry = geometryBuilder.createVoxelRingGeometry(1);
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    const boundaryWallY: number[] = [];
    const boundaryWallUWidths: number[] = [];
    for (let index = 0; index < position.count; index += 1) {
      const isInwardBoundaryWall = normal.getX(index) < -0.99 &&
        Math.abs(position.getX(index) - 1) < 1e-6 &&
        position.getZ(index) >= 0 && position.getZ(index) <= 1;
      if (isInwardBoundaryWall) boundaryWallY.push(position.getY(index));
    }
    for (let index = 0; index < position.count; index += 4) {
      const isInwardBoundaryWall = normal.getX(index) < -0.99 &&
        Math.abs(position.getX(index) - 1) < 1e-6 &&
        position.getZ(index) >= 0 && position.getZ(index) <= 1;
      if (isInwardBoundaryWall) {
        let minU = Infinity;
        let maxU = -Infinity;
        for (let vertex = index; vertex < index + 4; vertex += 1) {
          minU = Math.min(minU, uv.getX(vertex));
          maxU = Math.max(maxU, uv.getX(vertex));
        }
        boundaryWallUWidths.push(maxU - minU);
      }
    }

    // Five one-block wall quads close the complete y=6..11 height delta.
    expect(boundaryWallY).toHaveLength(20);
    expect(Math.min(...boundaryWallY)).toBe(6);
    expect(Math.max(...boundaryWallY)).toBe(11);
    expect(boundaryWallUWidths).toHaveLength(5);
    for (const width of boundaryWallUWidths) expect(width).toBeCloseTo(1, 6);

    geometry.dispose();
    water.dispose();
    textureLoad.mockRestore();
  });

  it('samples only the voxel ring and seam halo with one cached terrain query per column', () => {
    const textureLoad = vi.spyOn(THREE.TextureLoader.prototype, 'load')
      .mockImplementation((_url, onLoad) => {
        const texture = new THREE.Texture();
        onLoad?.(texture);
        return texture;
      });
    const scene = new THREE.Scene();
    const water = new WaterSystem(scene, {
      bounds: { minX: 0, maxX: 64, minZ: 0, maxZ: 64 },
      waterLevel: 42,
      farDistance: 128,
      seed: 17,
      worldRadius: 64,
    });
    const sampled: Array<{ x: number; z: number }> = [];
    const internals = water as unknown as {
      terrainSampler: (x: number, z: number) => { height: number; isOcean: boolean };
      createVoxelRingGeometry: (nearRange: number) => THREE.BufferGeometry;
    };
    internals.terrainSampler = (x, z) => {
      sampled.push({ x, z });
      return { height: 5, isOcean: false };
    };

    const geometry = internals.createVoxelRingGeometry(1);
    const uniqueSamples = new Set(sampled.map(({ x, z }) => `${x},${z}`));
    expect(sampled).toHaveLength(uniqueSamples.size);
    // The old implementation eagerly sampled the entire 68x68 map-plus-halo
    // before discarding the 64x64 interior. The strip path stays perimeter
    // local and must not query deep interior columns.
    expect(sampled.length).toBeLessThan(68 * 68);
    expect(sampled.some(({ x, z }) => x >= 1 && x < 63 && z >= 1 && z < 63)).toBe(false);

    geometry.dispose();
    water.dispose();
    textureLoad.mockRestore();
  });

  it('keeps the visual seabed below the wave trough and smooths the far LOD plates', async () => {
    const textureLoad = vi.spyOn(THREE.TextureLoader.prototype, 'load')
      .mockImplementation((_url, onLoad) => {
        const texture = new THREE.Texture();
        onLoad?.(texture);
        return texture;
      });
    const scene = new THREE.Scene();
    const water = new WaterSystem(scene, {
      bounds: { minX: -2, maxX: 2, minZ: -2, maxZ: 2 },
      waterLevel: 42,
      farDistance: 128,
      seed: 17,
      worldRadius: 4,
    });

    await Promise.resolve();
    const far = scene.getObjectByName('SeabedFarLOD') as THREE.Mesh<THREE.BufferGeometry, BlockMaterial> | undefined;
    const closure = scene.getObjectByName('SeabedFarClosure') as THREE.Mesh<THREE.BufferGeometry, BlockMaterial> | undefined;
    const near = scene.getObjectByName('SeabedVoxelRing') as THREE.Mesh<THREE.BufferGeometry, BlockMaterial> | undefined;
    expect(far).toBeDefined();
    expect(closure).toBeDefined();
    expect(near).toBeDefined();

    const allTopHeights = [near, far].flatMap((mesh) => {
      const position = mesh!.geometry.getAttribute('position');
      const normal = mesh!.geometry.getAttribute('normal');
      const heights: number[] = [];
      for (let index = 0; index < position.count; index += 1) {
        if (normal.getY(index) > 0.25) heights.push(position.getY(index));
      }
      return heights;
    });
    let highestTop = -Infinity;
    for (const height of allTopHeights) highestTop = Math.max(highestTop, height);
    expect(highestTop).toBeLessThanOrEqual(41);

    const farPosition = far!.geometry.getAttribute('position');
    const farNormal = far!.geometry.getAttribute('normal');
    let hasSmoothSlope = false;
    let surfaceContainsClosureFloor = false;
    for (let index = 0; index < farPosition.count; index += 1) {
      surfaceContainsClosureFloor ||= farPosition.getY(index) === 0;
      hasSmoothSlope ||= farNormal.getY(index) > 0.25 &&
        Math.abs(farNormal.getX(index)) + Math.abs(farNormal.getZ(index)) > 1e-3;
    }
    expect(surfaceContainsClosureFloor).toBe(false);
    expect(hasSmoothSlope).toBe(true);

    const closurePosition = closure!.geometry.getAttribute('position');
    const closureNormal = closure!.geometry.getAttribute('normal');
    const closureUv = closure!.geometry.getAttribute('uv');
    let hasClosedSkirt = false;
    for (let index = 0; index < closurePosition.count; index += 1) {
      hasClosedSkirt ||= closurePosition.getY(index) === 0;
    }
    expect(hasClosedSkirt).toBe(true);

    // Far closure walls are generated from 16-block LOD cells, but sand must
    // still retain one texture tile per world block along each outer side.
    // Every emitted side quad therefore has a local U span of one tile or
    // less; a whole-cell UV span would reintroduce the stretched side bands.
    for (let index = 0; index < closurePosition.count; index += 4) {
      if (Math.abs(closureNormal.getY(index)) > 0.5) continue;
      let minU = Infinity;
      let maxU = -Infinity;
      for (let vertex = index; vertex < index + 4; vertex += 1) {
        minU = Math.min(minU, closureUv.getX(vertex));
        maxU = Math.max(maxU, closureUv.getX(vertex));
      }
      expect(maxU - minU).toBeCloseTo(1, 6);
    }

    water.setOpaqueCaptureMode(true);
    expect(far!.visible).toBe(true);
    expect(near!.visible).toBe(true);
    expect(closure!.visible).toBe(true);
    water.setOpaqueCaptureMode(false);
    expect(closure!.visible).toBe(true);

    const map = far!.material.uniforms.map.value as THREE.Texture;
    expect(map.magFilter).toBe(THREE.NearestFilter);
    expect(map.minFilter).toBe(THREE.NearestFilter);
    expect(map.generateMipmaps).toBe(false);
    expect(far!.material.uniforms.aaEnabled.value).toBe(false);
    expect(far!.material.uniforms.aaLodBiasEnabled.value).toBe(false);

    water.dispose();
    textureLoad.mockRestore();
  });

  it('stitches the inner ocean lattice into every horizon strip', () => {
    const textureLoad = vi.spyOn(THREE.TextureLoader.prototype, 'load')
      .mockImplementation((_url, onLoad) => {
        const texture = new THREE.Texture();
        onLoad?.(texture);
        return texture;
      });
    const scene = new THREE.Scene();
    const water = new WaterSystem(scene, {
      bounds: { minX: -16, maxX: 16, minZ: -16, maxZ: 16 },
      waterLevel: 42,
      farDistance: 128,
      seed: 17,
      worldRadius: 32,
    });

    const ocean = scene.getObjectByName('OceanSurface') as THREE.Group;
    const inner = ocean.getObjectByName('OceanSurfaceInner') as THREE.Mesh;
    const innerPosition = inner.geometry.getAttribute('position');
    const uniqueValues = (attribute: THREE.BufferAttribute, component: 'x' | 'z'): number[] => {
      const values: number[] = [];
      for (let index = 0; index < attribute.count; index += 1) {
        const value = component === 'x' ? attribute.getX(index) : attribute.getZ(index);
        if (!values.some((existing) => Math.abs(existing - value) < 1e-5)) values.push(value);
      }
      return values.sort((a, b) => a - b);
    };
    const innerZ = uniqueValues(innerPosition, 'z');
    const innerX = uniqueValues(innerPosition, 'x');
    const north = ocean.getObjectByName('OceanSurfaceNorth') as THREE.Mesh;
    const northX = uniqueValues(north.geometry.getAttribute('position'), 'x');
    expect(Math.max(...northX.map(Math.abs))).toBeGreaterThanOrEqual(128 * 2.0);
    const valuesAtBoundary = (
      attribute: THREE.BufferAttribute,
      boundaryAxis: 'x' | 'z',
      boundaryValue: number,
      tangentAxis: 'x' | 'z',
    ): number[] => {
      const values: number[] = [];
      for (let index = 0; index < attribute.count; index += 1) {
        const boundary = boundaryAxis === 'x' ? attribute.getX(index) : attribute.getZ(index);
        if (Math.abs(boundary - boundaryValue) >= 1e-5) continue;
        const value = tangentAxis === 'x' ? attribute.getX(index) : attribute.getZ(index);
        if (!values.some((existing) => Math.abs(existing - value) < 1e-5)) values.push(value);
      }
      return values.sort((a, b) => a - b);
    };
    const assertStitchedStrip = (config: {
      name: string;
      boundaryAxis: 'x' | 'z';
      innerEdge: 'min' | 'max';
      stripEdge: 'min' | 'max';
      tangentAxis: 'x' | 'z';
    }): void => {
      const mesh = ocean.getObjectByName(config.name) as THREE.Mesh;
      const position = mesh.geometry.getAttribute('position');
      const radialLevels = uniqueValues(position, config.boundaryAxis);
      const innerRadialLevels = config.boundaryAxis === 'x' ? innerX : innerZ;
      const stripBoundary = config.stripEdge === 'min' ? radialLevels[0] : radialLevels[radialLevels.length - 1];
      const innerBoundary = config.innerEdge === 'min' ? innerRadialLevels[0] : innerRadialLevels[innerRadialLevels.length - 1];
      const stripStep = config.stripEdge === 'min'
        ? radialLevels[1] - radialLevels[0]
        : radialLevels[radialLevels.length - 1] - radialLevels[radialLevels.length - 2];
      const innerStep = config.innerEdge === 'min'
        ? innerRadialLevels[1] - innerRadialLevels[0]
        : innerRadialLevels[innerRadialLevels.length - 1] - innerRadialLevels[innerRadialLevels.length - 2];
      const innerTangent = valuesAtBoundary(innerPosition, config.boundaryAxis, innerBoundary, config.tangentAxis);
      const stripTangent = valuesAtBoundary(position, config.boundaryAxis, stripBoundary, config.tangentAxis);

      expect(stripBoundary).toBeCloseTo(innerBoundary, 6);
      expect(stripStep).toBeCloseTo(Math.abs(innerStep), 6);
      for (const value of innerTangent) {
        expect(stripTangent.some((candidate) => Math.abs(candidate - value) < 1e-5)).toBe(true);
      }
    };

    assertStitchedStrip({ name: 'OceanSurfaceNorth', boundaryAxis: 'z', innerEdge: 'max', stripEdge: 'min', tangentAxis: 'x' });
    assertStitchedStrip({ name: 'OceanSurfaceSouth', boundaryAxis: 'z', innerEdge: 'min', stripEdge: 'max', tangentAxis: 'x' });
    assertStitchedStrip({ name: 'OceanSurfaceWest', boundaryAxis: 'x', innerEdge: 'min', stripEdge: 'max', tangentAxis: 'z' });
    assertStitchedStrip({ name: 'OceanSurfaceEast', boundaryAxis: 'x', innerEdge: 'max', stripEdge: 'min', tangentAxis: 'z' });

    water.dispose();
    textureLoad.mockRestore();
  });
});
