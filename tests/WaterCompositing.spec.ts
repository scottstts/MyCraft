import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE } from '../src/config/constants';
import { BlockMaterial } from '../src/engine/render/BlockMaterial';
import { AerialPerspectivePass } from '../src/engine/render/postprocessing/passes/AerialPerspectivePass';
import { BloomWrapperPass } from '../src/engine/render/postprocessing/passes/BloomPass';
import { UnderwaterPass } from '../src/engine/render/postprocessing/passes/UnderwaterPass';
import { OCEAN_CAUSTIC_WAVES } from '../src/engine/render/water/OceanWaveField';
import { WaterCaustics } from '../src/engine/render/water/WaterCaustics';
import { CAUSTIC_TILE_SIZE } from '../src/engine/render/water/WaterOptics';
import { WaterSurfaceMaterial } from '../src/engine/render/water/WaterSurfaceMaterial';

const WATER_ETA = 1 / 1.333;
const CAUSTIC_TEST_SUN = new THREE.Vector3(0.35, 0.9, 0.2).normalize();

function refractVector(incident: THREE.Vector3, normal: THREE.Vector3): THREE.Vector3 {
  const dotNI = normal.dot(incident);
  const discriminant = 1 - WATER_ETA * WATER_ETA * (1 - dotNI * dotNI);
  if (discriminant < 0) return new THREE.Vector3();
  return incident.clone().multiplyScalar(WATER_ETA)
    .sub(normal.clone().multiplyScalar(WATER_ETA * dotNI + Math.sqrt(discriminant)));
}

function projectedCausticPoint(x: number, z: number, time: number): THREE.Vector2 {
  const displaced = new THREE.Vector3();
  const tangentX = new THREE.Vector3(1, 0, 0);
  const tangentZ = new THREE.Vector3(0, 0, 1);

  for (const wave of OCEAN_CAUSTIC_WAVES) {
    const k = Math.PI * 2 / wave.wavelength;
    const gravity = 9.81 * k * Math.tanh(Math.min(k * 64, 20));
    const capillary = 7.4e-5 * k * k * k;
    const omega = Math.sqrt(gravity + capillary) * wave.speed;
    const phase = k * (wave.directionX * x + wave.directionZ * z) - omega * time + wave.phase;
    const sine = Math.sin(phase);
    const cosine = Math.cos(phase);
    const phaseDx = k * wave.directionX;
    const phaseDz = k * wave.directionZ;
    displaced.x += wave.directionX * wave.steepness * wave.amplitude * cosine;
    displaced.y += wave.amplitude * sine;
    displaced.z += wave.directionZ * wave.steepness * wave.amplitude * cosine;
    tangentX.add(new THREE.Vector3(
      -wave.steepness * wave.amplitude * wave.directionX * phaseDx * sine,
      wave.amplitude * phaseDx * cosine,
      -wave.steepness * wave.amplitude * wave.directionZ * phaseDx * sine,
    ));
    tangentZ.add(new THREE.Vector3(
      -wave.steepness * wave.amplitude * wave.directionX * phaseDz * sine,
      wave.amplitude * phaseDz * cosine,
      -wave.steepness * wave.amplitude * wave.directionZ * phaseDz * sine,
    ));
  }

  const normal = tangentZ.clone().cross(tangentX).normalize();
  const ray = refractVector(CAUSTIC_TEST_SUN.clone().negate(), normal);
  const travel = (24 + displaced.y) / Math.max(Math.abs(ray.y), 0.12);
  return new THREE.Vector2(
    x + displaced.x + ray.x * travel,
    z + displaced.z + ray.z * travel,
  );
}

function projectedConcentration(x: number, z: number, time: number): number {
  const epsilon = 0.02;
  const xMinus = projectedCausticPoint(x - epsilon, z, time);
  const xPlus = projectedCausticPoint(x + epsilon, z, time);
  const zMinus = projectedCausticPoint(x, z - epsilon, time);
  const zPlus = projectedCausticPoint(x, z + epsilon, time);
  const dX = xPlus.sub(xMinus).multiplyScalar(0.5 / epsilon);
  const dZ = zPlus.sub(zMinus).multiplyScalar(0.5 / epsilon);
  const determinant = Math.abs(dX.x * dZ.y - dX.y * dZ.x);
  return Math.min(8, 1 / Math.max(determinant, 1e-5));
}

describe('water compositing ownership', () => {
  it('keeps every surface transmission path under the Fresnel interface weight', () => {
    const material = new WaterSurfaceMaterial({ map: null, ocean: true });

    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(material.fragmentShader).toContain('float transmissionWeight = clamp(interfaceTransmission, 0.0, 1.0)');
    expect(material.fragmentShader).toContain('reflected * reflectionWeight + transmitted * transmissionWeight');
    expect(material.fragmentShader).toContain('? windowCoverage * (1.0 - fresnel)');
    expect(material.fragmentShader).toContain('float transmittedSun = pow(windowSun, lobeExponent)');
    expect(material.fragmentShader).toContain('(1.0 - fresnel) * grazingTransmissionCoverage');
    expect(material.fragmentShader).toContain('vViewDepth / max(uCameraFar, 0.001)');
    expect(material.fragmentShader).toContain(') * 0.001000');
    expect(material.fragmentShader).toContain('uOceanMode ? oceanSurfaceDepth : clamp(uAlpha, 0.0, 1.0)');

    material.dispose();
  });

  it('reserves a low alpha range for opaque ocean interface depth', () => {
    const material = new BlockMaterial(new THREE.Texture(), null);

    expect(material.fragmentShader).toContain('float directLightFraction = max(1.0 - indirectMask, 1.0 / 255.0)');
    expect(material.fragmentShader).toContain('uForwardRefractionActive > 0.5 ? 1.0 : directLightFraction');

    material.dispose();
  });

  it('replaces water pixels seabed capture depth with exact visible interface depth', () => {
    const pass = new AerialPerspectivePass();
    const fragmentShader = (pass.material as THREE.ShaderMaterial).fragmentShader;

    expect(fragmentShader).toContain('vec3 viewRayWorld(out vec3 viewRay)');
    expect(fragmentShader).toContain('float waterMask = 1.0 - step(0.002000, source.a)');
    expect(fragmentShader).toContain('source.a / 0.001000');
    expect(fragmentShader).toContain(') * cameraFar');
    expect(fragmentShader).toContain('surfaceRayDistance = mix(surfaceRayDistance, encodedSurfaceRayDistance, waterMask)');
    expect(fragmentShader).toContain('float surfaceRayDistance = -1.0');
    expect(fragmentShader).toContain('(cameraSurfaceY - cameraPosition.y) / ray.y');
    expect(fragmentShader).toContain('float surfaceViewDepth = -surfaceRayDistance * viewRay.z');
    expect(fragmentShader).toContain('receiverViewDepth = mix(');
    expect(fragmentShader).toContain('float validWaterSurfaceRay = max(waterMask, cameraAboveWater');
    expect(fragmentShader).toContain('waterMask * validWaterSurfaceRay');
    expect(fragmentShader).toContain('if (waterMask > 0.5 && cameraBelowWater > 0.5)');
    expect(fragmentShader).toContain('clamp(surfaceViewDepth, 0.0, cameraFar)');
    expect(fragmentShader).toContain('float airViewDepth = receiverViewDepth');
    expect(fragmentShader).toContain('float airEndViewDepth = receiverViewDepth');
    expect(fragmentShader).toContain('float crossedBeforeReceiver = crossingAhead * receiverAfterCrossing');
    expect(fragmentShader).toContain('horizonMix * airPathCoverage');
    expect(fragmentShader).toContain('float d = min(airViewDepth, maxDistance)');
  });

  it('does not reapply camera-side medium to above-water surface pixels', () => {
    const pass = new UnderwaterPass();
    const fragmentShader = (pass.material as THREE.ShaderMaterial).fragmentShader;

    expect(fragmentShader).toContain('float waterSurfaceMask = 1.0 - step(0.002000, source.a)');
    expect(fragmentShader).toContain('float encodedSurfaceDistance = encodedSurfaceViewDepth');
    expect(fragmentShader).toContain('surfaceDistance = mix(surfaceDistance, encodedSurfaceDistance, waterSurfaceMask)');
    expect(fragmentShader).toContain('float cameraBelow = cameraSubmerged ? 1.0 : 0.0');
    expect(fragmentShader).toContain('float cameraAboveWater = 1.0 - cameraBelow');
    expect(fragmentShader).toContain('if (waterSurfaceMask > 0.5 && cameraAboveWater > 0.5)');
    expect(fragmentShader).toContain('gl_FragColor = source');
    expect(fragmentShader).toContain('float particleDensity(vec3 worldPosition, float worldFilterWidth)');
    expect(fragmentShader).toContain('float relativePhase(float cosTheta, float g)');
    expect(fragmentShader).toContain('vec3 sigmaT = sigmaBase * density');
    expect(fragmentShader).toContain('vec3 sunSource = uSunColor * sunIntensity');
    expect(fragmentShader).toContain('float finiteReceiver = 1.0 - step(0.999999, rawSceneDepth)');
    expect(fragmentShader).toContain('float crossingBeforeReceiver = crossingAhead');
    expect(fragmentShader).toContain('float visibleRayStart = cameraNear / max(-viewRay.z, 0.02)');
    expect(fragmentShader).toContain('float crossingBeforeVisibleRay = crossingBeforeReceiver');
    expect(fragmentShader).toContain('float visibleStartsBelow = mix(');
    expect(fragmentShader).toContain('(cameraSurfaceY - uCameraPosition.y) / ray.y');
    expect(fragmentShader).toContain('segmentLength * 0.5');
    expect(fragmentShader).toContain('1.0 / max(causticFieldScale, 1.0)');
    expect(fragmentShader).not.toContain('WATERLINE_TRANSITION');
    expect(fragmentShader).not.toContain('cameraWaterBlend');
    expect(fragmentShader).not.toContain('mediumBlend');
    expect(fragmentShader).not.toContain('cameraDim');

    pass.dispose();
  });

  it('preserves visible-interface alpha through bloom for later optical occlusion', () => {
    const pass = new BloomWrapperPass(320, 180);

    expect(pass.blendMaterial.blending).toBe(THREE.CustomBlending);
    expect(pass.blendMaterial.blendSrc).toBe(THREE.OneFactor);
    expect(pass.blendMaterial.blendDst).toBe(THREE.OneFactor);
    expect(pass.blendMaterial.blendSrcAlpha).toBe(THREE.ZeroFactor);
    expect(pass.blendMaterial.blendDstAlpha).toBe(THREE.OneFactor);

    pass.dispose();
  });

  it('uses one derivative-aware underwater caustic sample for each receiver', () => {
    const pass = new UnderwaterPass();
    const fragmentShader = (pass.material as THREE.ShaderMaterial).fragmentShader;
    const samplerStart = fragmentShader.indexOf('vec4 sampleCausticTexture');
    const samplerEnd = fragmentShader.indexOf('void main()', samplerStart);
    const sampler = fragmentShader.slice(samplerStart, samplerEnd);

    expect(sampler).toContain('vec2 uv = causticCoord;');
    expect(sampler).toContain('vec4 sampleCausticTexture(vec2 uv, float mipLevel)');
    expect(sampler).toContain('texture2DLodEXT(causticMap, uv, mipLevel)');
    expect(sampler).toContain('float filtered = sampleCausticTexture(uv, mipLevel).r');
    expect((sampler.match(/sampleCausticTexture\(uv, mipLevel\)/g) ?? []).length).toBe(1);
    expect(sampler).not.toContain('uv + vec2(texel.x, 0.0)');
    expect(sampler).not.toContain('uv + vec2(0.0, texel.y)');
    expect(sampler).not.toContain('fract(causticCoord)');
    expect(sampler).not.toContain('fract(uv');

    pass.dispose();
  });

  it('keeps every repeating caustic slope band periodic over the transport tile', () => {
    for (const wave of OCEAN_CAUSTIC_WAVES) {
      const xCycles = CAUSTIC_TILE_SIZE * wave.directionX / wave.wavelength;
      const zCycles = CAUSTIC_TILE_SIZE * wave.directionZ / wave.wavelength;

      expect(xCycles).toBeCloseTo(wave.tileCyclesX, 10);
      expect(zCycles).toBeCloseTo(wave.tileCyclesZ, 10);
      expect(Number.isInteger(wave.tileCyclesX)).toBe(true);
      expect(Number.isInteger(wave.tileCyclesZ)).toBe(true);
    }
  });

  it('keeps projected concentration continuous across both transport-tile seams', () => {
    const edge = CAUSTIC_TILE_SIZE * 0.5;
    const tolerance = 1e-7;

    for (const time of [0, 4.75, 13.5]) {
      for (const offset of [-19.75, -7.25, 0.5, 11.75, 23.25]) {
        expect(projectedConcentration(-edge, offset, time))
          .toBeCloseTo(projectedConcentration(edge, offset, time), 7);
        expect(projectedConcentration(offset, -edge, time))
          .toBeCloseTo(projectedConcentration(offset, edge, time), 7);
        expect(Math.abs(
          projectedConcentration(-edge, offset, time) -
          projectedConcentration(edge, offset, time),
        )).toBeLessThan(tolerance);
        expect(Math.abs(
          projectedConcentration(offset, -edge, time) -
          projectedConcentration(offset, edge, time),
        )).toBeLessThan(tolerance);
      }
    }
  });

  it('uses a broad multi-scale caustic realization that cannot track chunk squares', () => {
    const wavelengths = OCEAN_CAUSTIC_WAVES.map((wave) => wave.wavelength);
    const directionQuadrants = new Set(OCEAN_CAUSTIC_WAVES.map((wave) =>
      `${Math.sign(wave.directionX)},${Math.sign(wave.directionZ)}`,
    ));
    const slopeEnergy = OCEAN_CAUSTIC_WAVES.map((wave) =>
      Math.abs(wave.amplitude * Math.PI * 2 / wave.wavelength),
    );
    const largestSlopeShare = Math.max(...slopeEnergy) /
      slopeEnergy.reduce((sum, energy) => sum + energy, 0);

    expect(CAUSTIC_TILE_SIZE).toBeGreaterThan(48);
    expect(CAUSTIC_TILE_SIZE).toBeLessThan(CHUNK_SIZE.x);
    expect(CHUNK_SIZE.x % CAUSTIC_TILE_SIZE).not.toBeCloseTo(0, 8);
    expect(OCEAN_CAUSTIC_WAVES.length).toBeGreaterThanOrEqual(12);
    expect(Math.max(...wavelengths)).toBeGreaterThan(12);
    expect(Math.min(...wavelengths)).toBeLessThan(1.6);
    expect(directionQuadrants.size).toBe(4);
    expect(largestSlopeShare).toBeLessThan(0.14);
  });

  it('places focused differential-area transport in every local part of the tile', () => {
    const cellsPerAxis = 6;
    const samplesPerCell = 10;
    const cellSize = CAUSTIC_TILE_SIZE / cellsPerAxis;

    for (const time of [0, 4.75, 13.5]) {
      for (let cellZ = 0; cellZ < cellsPerAxis; cellZ += 1) {
        for (let cellX = 0; cellX < cellsPerAxis; cellX += 1) {
          let minimum = Number.POSITIVE_INFINITY;
          let maximum = Number.NEGATIVE_INFINITY;
          for (let sampleZ = 0; sampleZ < samplesPerCell; sampleZ += 1) {
            for (let sampleX = 0; sampleX < samplesPerCell; sampleX += 1) {
              const x = -CAUSTIC_TILE_SIZE * 0.5 +
                (cellX + (sampleX + 0.5) / samplesPerCell) * cellSize;
              const z = -CAUSTIC_TILE_SIZE * 0.5 +
                (cellZ + (sampleZ + 0.5) / samplesPerCell) * cellSize;
              const concentration = projectedConcentration(x, z, time);
              minimum = Math.min(minimum, concentration);
              maximum = Math.max(maximum, concentration);
            }
          }
          expect(maximum).toBeGreaterThan(1.08);
          expect(maximum - minimum).toBeGreaterThan(0.18);
        }
      }
    }
  });

  it('uses only the periodic optical spectrum in the bounded caustic projection', () => {
    const renderer = {
      capabilities: { isWebGL2: false },
      extensions: { has: () => false },
    } as unknown as THREE.WebGLRenderer;
    const caustics = new WaterCaustics(renderer, { resolution: 128 });
    const material = (caustics as unknown as { material: THREE.ShaderMaterial }).material;

    expect(material.vertexShader).toContain('uniform float uWaveChop');
    expect(material.vertexShader).toContain('uniform float uWaveSpeed');
    expect(material.vertexShader).toContain('CAUSTIC_WAVE_LENGTH_0');
    expect(material.vertexShader).not.toContain('OCEAN_WAVE_LENGTH_0');
    expect(material.vertexShader).toContain('* uExtent / 53.0');
    expect(material.vertexShader).toContain('vec2 surfaceXZ = uOrigin - flatOffset');
    expect(material.vertexShader).toContain('vNewPosition = surfaceXZ + displacement.xz + waveRefract.xz * waveTravel');
    expect(material.vertexShader).toContain('void oceanDisplacementAndTangents(');
    expect(material.vertexShader).not.toContain('vec3 oceanDisplacement(');
    expect(material.vertexShader).not.toContain('vec3 oceanNormal(');
    expect((material.vertexShader.match(/float phase =/g) ?? []).length).toBe(OCEAN_CAUSTIC_WAVES.length);
    expect((material.vertexShader.match(/float c = cos\(phase\)/g) ?? []).length).toBe(OCEAN_CAUSTIC_WAVES.length);
    expect(material.fragmentShader).toContain('float concentration = clamp(oldArea / newArea, 0.0, 8.0)');
    expect(material.fragmentShader).not.toContain('lineMask');
    expect(caustics.getReferenceDepth()).toBe(24);

    const internals = caustics as unknown as {
      target: THREE.WebGLRenderTarget;
      neutralClearColor: THREE.Color;
    };
    const target = internals.target;
    const diagnostics = caustics.getDiagnostics();
    expect(target.texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(target.texture.generateMipmaps).toBe(true);
    expect(internals.neutralClearColor.r).toBeCloseTo(1 / 4, 8);
    expect(internals.neutralClearColor.g).toBeCloseTo(1 / 4, 8);
    expect(internals.neutralClearColor.b).toBeCloseTo(1 / 4, 8);
    expect(diagnostics.patchExtent).toBe(CAUSTIC_TILE_SIZE * 1.5);
    expect(diagnostics.sourceHalfPeriods).toBe(3);
    expect(diagnostics.sourcePeriods).toBe(1.5);
    expect(Number(diagnostics.segmentsPerPeriod) % 4).toBe(0);
    expect(Number(diagnostics.sourceSegments)).toBe(
      Number(diagnostics.sourcePeriods) * Number(diagnostics.segmentsPerPeriod),
    );
    expect(diagnostics.sourceSegments).toBeGreaterThan(128);
    const shortestWavelength = Math.min(...OCEAN_CAUSTIC_WAVES.map((wave) => wave.wavelength));
    expect(Number(diagnostics.segmentsPerPeriod) * shortestWavelength /
      CAUSTIC_TILE_SIZE).toBeGreaterThanOrEqual(6);
    const sourceCellSize = Number(diagnostics.patchExtent) /
      Number(diagnostics.sourceSegments);
    const leftReceiverColumn = (
      Number(diagnostics.patchExtent) * 0.5 - CAUSTIC_TILE_SIZE * 0.5
    ) / sourceCellSize;
    const rightReceiverColumn = (
      Number(diagnostics.patchExtent) * 0.5 + CAUSTIC_TILE_SIZE * 0.5
    ) / sourceCellSize;
    expect(leftReceiverColumn).toBeCloseTo(Math.round(leftReceiverColumn), 10);
    expect(rightReceiverColumn).toBeCloseTo(Math.round(rightReceiverColumn), 10);
    expect(rightReceiverColumn - leftReceiverColumn)
      .toBe(Number(diagnostics.segmentsPerPeriod));
    expect(diagnostics.sourceSegments).toBe(324);

    caustics.dispose();
  });

  it('modulates only direct sunlight at a depth-correct caustic receiver', () => {
    const material = new BlockMaterial(new THREE.Texture(), null);
    const fragmentShader = material.fragmentShader;

    expect(fragmentShader).toContain('vec3 directSunLighting(vec3 normal)');
    expect(fragmentShader).toContain('float sampleWaterCaustics(vec3 worldPosition)');
    expect(fragmentShader).toContain('float waterSunTransmission(float cosIncident)');
    expect(fragmentShader).toContain('waterCausticReferenceDepth - depth');
    const phaseStart = fragmentShader.indexOf('float sampleWaterCausticPhase');
    const phaseEnd = fragmentShader.indexOf('float sampleWaterCaustics', phaseStart);
    const phase = fragmentShader.slice(phaseStart, phaseEnd);
    expect(phase).toContain('texture2D(waterCausticMap, causticCoord + phaseOffset).r');
    expect((phase.match(/texture2D\(waterCausticMap/g) ?? []).length).toBe(1);
    expect(fragmentShader).not.toContain('footprintX');
    expect(fragmentShader).not.toContain('footprintY');
    expect(fragmentShader).not.toContain('mix(filtered, 0.25');
    expect(fragmentShader).toContain('vec3 waterDirect = directSun * transport');
    expect(fragmentShader).not.toContain('waterCausticField(vec2 worldXZ');
    expect(fragmentShader).not.toContain('ridgeA');

    material.dispose();
  });
});
