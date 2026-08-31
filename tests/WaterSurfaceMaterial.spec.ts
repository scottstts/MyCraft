import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { BlockMaterial } from '../src/engine/render/BlockMaterial';
import { WaterSurfaceMaterial } from '../src/engine/render/water/WaterSurfaceMaterial';
import { WaterSystem } from '../src/engine/render/water/WaterSystem';

describe('WaterSurfaceMaterial', () => {
  it('uses projected Snell refraction and reconstructed scene thickness', () => {
    const material = new WaterSurfaceMaterial({ map: null, ocean: true });

    expect(material.fragmentShader).toContain('projectWorldToUv');
    expect(material.fragmentShader).toContain('reconstructWorldPosition');
    expect(material.fragmentShader).toContain('uProjectionMatrix * viewMatrix');
    expect(material.fragmentShader).toContain('length(backgroundWorld - vWorld)');
    expect(material.fragmentShader).toContain('dielectricFresnel');
    expect(material.fragmentShader).toContain('criticalSafeRefract');
    expect(material.fragmentShader).toContain('bool underwaterView = uOceanMode ? !gl_FrontFacing : uCameraUnderwater');
    expect(material.fragmentShader).toContain('vec3 windowDirection = criticalSafeRefract(incident, normal, eta)');
    expect(material.fragmentShader).toContain('transmitted = window');
    expect(material.fragmentShader).not.toContain('bool tir =');
    expect(material.fragmentShader).not.toContain('if (!tir)');
    expect(material.fragmentShader).toContain('ggxDistribution');
    expect(material.fragmentShader).toContain('float skirtAlpha');
    expect(material.fragmentShader).toContain('float sunLobe = mix(coreLobe, skirtLobe, 0.42)');
    expect(material.fragmentShader).toContain('normalFootprint');
    expect(material.fragmentShader).toContain('geometricFresnelResult');
    expect(material.fragmentShader).toContain('grazingTransmissionCoverage');
    expect(material.fragmentShader).toContain('sceneHitValidity');
    expect(material.fragmentShader).toContain('float refractionResolveCoverage');
    expect(material.fragmentShader).toContain('refractedReceiverValidity');
    expect(material.fragmentShader).toContain('fwidth(interfaceSeparation)');
    expect(material.fragmentShader).toContain('for (int backtrackIndex = 0; backtrackIndex < 5; backtrackIndex++)');
    expect(material.fragmentShader).toContain('vec2 candidateUv = mix(screenUv, projectedUv, backtrack)');
    expect(material.fragmentShader).toContain('vec3 candidateDirection = normalize(mix(');
    expect(material.fragmentShader).toContain('float acceptCandidate = (1.0 - sceneHitValidity) * candidateValidity');
    expect(material.fragmentShader).toContain('resolvedUv = resolvedUv + (safeCandidateUv - screenUv) * acceptCandidate');
    expect(material.fragmentShader).toContain('sceneHitValidity + acceptCandidate');
    expect(material.fragmentShader).not.toContain('step(0.5, candidateValidity)');
    expect(material.fragmentShader).toContain('float swashArrival = smoothstep(');
    expect(material.fragmentShader).toContain('shorelineBand * patchMask * swashArrival');
    expect(material.fragmentShader).not.toContain('shorelineBand * (1.0 - patchMask) * foamFront');
    expect(material.fragmentShader).not.toContain('contactFallbackCoverage');
    expect(material.fragmentShader).toContain('sceneRefraction = sceneSample.rgb');
    expect(material.fragmentShader).not.toContain('sceneRefraction = mix(deep, sceneSample.rgb, sceneHitValidity)');
    expect(material.fragmentShader).toContain('(1.0 - fresnel) * grazingTransmissionCoverage * refractionResolveCoverage');
    expect(material.fragmentShader).not.toContain('mix(refractedUv, screenUv, foregroundReject)');
    expect(material.fragmentShader).not.toContain('vec2 resolvedUv = refractedUv;\n            float resolvedRawDepth = uHasSceneDepth');
    expect(material.fragmentShader).not.toContain('step(uWaterLevel - 0.05, candidateWorld.y)');
    expect(material.fragmentShader).toContain('float refractionResolveCoverage = 1.0;');
    expect(material.fragmentShader).not.toContain('pow(sun, 2200.0)');
    expect(material.fragmentShader).not.toContain('refractedDirection.xz * uRefractAmount');
    expect(material.fragmentShader).not.toContain('abs(refractedDirection.z)');
    expect(material.fragmentShader).not.toContain('pow((1.0 - 1.333)');

    material.dispose();
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
});
