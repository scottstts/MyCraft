/**
 * Authored player appearance builders.
 *
 * Each reference uses the same seven moving rig nodes and differs only in
 * texture recipes, materials, and decorative subassemblies. This module keeps
 * those appearance details separate from the shared animation/camera code in
 * PlayerCharacter.
 */

import * as THREE from 'three';
import type { PlayerCharacterId } from '../../shared/playerCharacters';

export interface PlayerCharacterRig {
  body: THREE.Group;
  headPivot: THREE.Group;
  eyeAnchor: THREE.Object3D;
  headMesh: THREE.Mesh;
  hairBand: THREE.Object3D;
  torsoMesh: THREE.Mesh;
  backpack: THREE.Object3D;
  leftArm: THREE.Group;
  leftArmMesh: THREE.Mesh;
  rightArm: THREE.Group;
  rightArmMesh: THREE.Mesh;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  pickaxe: THREE.Group;
}

export interface PlayerCharacterRigBuildContext {
  eyeAnchorY: number;
  createTexturedMaterial: (
    texture: THREE.Texture,
    options?: THREE.MeshStandardMaterialParameters,
  ) => THREE.MeshStandardMaterial;
  createMaterial: (options: THREE.MeshStandardMaterialParameters) => THREE.MeshStandardMaterial;
  createMesh: (
    geometry: THREE.BufferGeometry,
    material: THREE.Material | THREE.Material[],
    name: string,
  ) => THREE.Mesh;
  createPickaxe: () => THREE.Group;
}

interface TextureSet {
  face: THREE.CanvasTexture;
  hair: THREE.CanvasTexture;
  torso: THREE.CanvasTexture;
  arm: THREE.CanvasTexture;
  pants: THREE.CanvasTexture;
}

type NoiseAdder = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  factor?: number,
) => void;

interface TextureFactory {
  create: (
    width: number,
    height: number,
    draw: (context: CanvasRenderingContext2D, addNoise: NoiseAdder) => void,
  ) => THREE.CanvasTexture;
}

interface BaseMaterials {
  hair: THREE.MeshStandardMaterial;
  face: THREE.MeshStandardMaterial;
  torso: THREE.MeshStandardMaterial;
  arm: THREE.MeshStandardMaterial;
  pants: THREE.MeshStandardMaterial;
}

type AccessoryBuilder = (context: PlayerCharacterRigBuildContext) => THREE.Object3D;
type MeshDecorator = (context: PlayerCharacterRigBuildContext, mesh: THREE.Mesh) => void;

interface CharacterAppearance {
  materials: BaseMaterials;
  buildHeadAccessories: AccessoryBuilder;
  buildBackpack: AccessoryBuilder;
  decorateHead?: MeshDecorator;
  decorateTorso?: MeshDecorator;
  decorateLeftArm: MeshDecorator;
  decorateRightArm: MeshDecorator;
  decorateLeg: MeshDecorator;
  decorateLeftLeg?: MeshDecorator;
  decorateRightLeg?: MeshDecorator;
}

const LEG_LENGTH = 0.75;
const LEG_PIVOT_Y = 0.65;

const TEXTURE_SEEDS: Record<PlayerCharacterId, number> = {
  Otherys: 0x4d594352,
  Solvaris: 0x534f4c56,
  Eryndor: 0x4552594e,
  Vespera: 0x56455350,
  Kaelith: 0x4b41454c,
};

/** Deterministic equivalent of the reference pixel-texture generator. */
function createTextureFactory(seed: number): TextureFactory {
  let state = seed | 0;

  const nextRandom = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  const addNoise: NoiseAdder = (context, width, height, factor = 0.08): void => {
    const image = context.getImageData(0, 0, width, height);
    const data = image.data;
    for (let index = 0; index < data.length; index += 4) {
      const noise = (nextRandom() - 0.5) * factor * 255;
      data[index] = Math.min(255, Math.max(0, data[index] + noise));
      data[index + 1] = Math.min(255, Math.max(0, data[index + 1] + noise));
      data[index + 2] = Math.min(255, Math.max(0, data[index + 2] + noise));
    }
    context.putImageData(image, 0, 0);
  };

  return {
    create(width, height, draw) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Player character textures require a 2D canvas context');
      draw(context, addNoise);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      return texture;
    },
  };
}

function createCharacterTextures(id: PlayerCharacterId): TextureSet {
  const factory = createTextureFactory(TEXTURE_SEEDS[id]);
  switch (id) {
    case 'Otherys':
      return createOtherysTextures(factory);
    case 'Solvaris':
      return createSolvarisTextures(factory);
    case 'Eryndor':
      return createEryndorTextures(factory);
    case 'Vespera':
      return createVesperaTextures(factory);
    case 'Kaelith':
      return createKaelithTextures(factory);
  }
}

function createOtherysTextures(factory: TextureFactory): TextureSet {
  const hair = factory.create(16, 16, (context, addNoise) => {
    context.fillStyle = '#2b1d16';
    context.fillRect(0, 0, 16, 16);
    context.fillStyle = '#3a271e';
    context.fillRect(2, 2, 6, 6);
    context.fillRect(9, 8, 5, 5);
    addNoise(context, 16, 16, 0.06);
  });
  const face = factory.create(16, 16, (context, addNoise) => {
    context.fillStyle = '#d49b74';
    context.fillRect(0, 0, 16, 16);
    context.fillStyle = '#2b1d16';
    context.fillRect(0, 0, 16, 4);
    context.fillRect(0, 4, 2, 4);
    context.fillRect(14, 4, 2, 4);
    context.fillStyle = '#ffffff';
    context.fillRect(3, 6, 3, 2);
    context.fillStyle = '#3e2723';
    context.fillRect(4, 6, 2, 2);
    context.fillStyle = '#00f0ff';
    context.fillRect(10, 5, 4, 4);
    context.fillStyle = '#ffffff';
    context.fillRect(11, 6, 2, 2);
    context.fillStyle = '#b57954';
    context.fillRect(7, 8, 2, 2);
    context.fillStyle = '#533624';
    context.fillRect(5, 11, 6, 1);
    context.fillRect(6, 12, 4, 2);
    addNoise(context, 16, 16, 0.04);
  });
  const torso = factory.create(16, 24, (context, addNoise) => {
    context.fillStyle = '#1e293b';
    context.fillRect(0, 0, 16, 24);
    context.fillStyle = '#5c3a21';
    context.fillRect(0, 0, 16, 4);
    context.fillRect(2, 4, 3, 16);
    context.fillRect(11, 4, 3, 16);
    context.fillRect(0, 16, 16, 4);
    context.fillStyle = '#00f0ff';
    context.fillRect(6, 8, 4, 4);
    context.fillStyle = '#ffffff';
    context.fillRect(7, 9, 2, 2);
    addNoise(context, 16, 24, 0.05);
  });
  const arm = factory.create(8, 24, (context, addNoise) => {
    context.fillStyle = '#1e293b';
    context.fillRect(0, 0, 8, 6);
    context.fillStyle = '#d49b74';
    context.fillRect(0, 6, 8, 6);
    context.fillStyle = '#475569';
    context.fillRect(0, 12, 8, 8);
    context.fillStyle = '#1e1b18';
    context.fillRect(0, 20, 8, 4);
    addNoise(context, 8, 24, 0.05);
  });
  const pants = factory.create(8, 24, (context, addNoise) => {
    context.fillStyle = '#334155';
    context.fillRect(0, 0, 8, 14);
    context.fillStyle = '#475569';
    context.fillRect(1, 6, 6, 4);
    context.fillStyle = '#3e2723';
    context.fillRect(0, 14, 8, 10);
    addNoise(context, 8, 24, 0.06);
  });
  return { face, hair, torso, arm, pants };
}

function createSolvarisTextures(factory: TextureFactory): TextureSet {
  const hair = factory.create(16, 16, (context, addNoise) => {
    context.fillStyle = '#94a3b8';
    context.fillRect(0, 0, 16, 16);
    context.fillStyle = '#e2e8f0';
    context.fillRect(2, 2, 12, 12);
    context.fillStyle = '#f8fafc';
    context.fillRect(4, 4, 6, 6);
    context.fillStyle = '#64748b';
    context.fillRect(0, 12, 16, 4);
    addNoise(context, 16, 16, 0.05);
  });
  const face = factory.create(16, 16, (context, addNoise) => {
    context.fillStyle = '#dcd3cb';
    context.fillRect(0, 0, 16, 16);
    context.fillStyle = '#cbd5e1';
    context.fillRect(0, 0, 16, 4);
    context.fillStyle = '#94a3b8';
    context.fillRect(0, 3, 2, 3);
    context.fillRect(14, 3, 2, 3);
    context.fillRect(4, 3, 2, 2);
    context.fillRect(10, 3, 2, 2);
    context.fillStyle = '#ffffff';
    context.fillRect(3, 6, 3, 2);
    context.fillStyle = '#f59e0b';
    context.fillRect(4, 6, 2, 2);
    context.fillStyle = '#fffbeb';
    context.fillRect(4, 6, 1, 1);
    context.fillStyle = '#06b6d4';
    context.fillRect(10, 5, 4, 4);
    context.fillStyle = '#ffffff';
    context.fillRect(11, 6, 2, 2);
    context.fillStyle = '#818cf8';
    context.fillRect(12, 9, 2, 4);
    context.fillRect(10, 11, 2, 2);
    context.fillStyle = '#b7a89b';
    context.fillRect(7, 8, 2, 2);
    context.fillStyle = '#475569';
    context.fillRect(6, 12, 4, 1);
    addNoise(context, 16, 16, 0.04);
  });
  const torso = factory.create(16, 24, (context, addNoise) => {
    context.fillStyle = '#0f172a';
    context.fillRect(0, 0, 16, 24);
    context.fillStyle = '#f59e0b';
    context.fillRect(0, 0, 16, 2);
    context.fillRect(1, 2, 2, 18);
    context.fillRect(13, 2, 2, 18);
    context.fillRect(0, 16, 16, 2);
    context.fillStyle = '#312e81';
    context.fillRect(3, 4, 10, 12);
    context.fillStyle = '#8b5cf6';
    context.fillRect(6, 7, 4, 5);
    context.fillStyle = '#00f0ff';
    context.fillRect(7, 8, 2, 3);
    context.fillStyle = '#ffffff';
    context.fillRect(7, 9, 2, 1);
    context.fillStyle = '#1e293b';
    context.fillRect(2, 18, 12, 6);
    context.fillStyle = '#fbbf24';
    context.fillRect(7, 18, 2, 6);
    addNoise(context, 16, 24, 0.05);
  });
  const arm = factory.create(8, 24, (context, addNoise) => {
    context.fillStyle = '#1e1b4b';
    context.fillRect(0, 0, 8, 6);
    context.fillStyle = '#f59e0b';
    context.fillRect(0, 5, 8, 1);
    context.fillStyle = '#dcd3cb';
    context.fillRect(0, 6, 8, 6);
    context.fillStyle = '#00f0ff';
    context.fillRect(3, 7, 2, 4);
    context.fillStyle = '#0f172a';
    context.fillRect(0, 12, 8, 8);
    context.fillStyle = '#f59e0b';
    context.fillRect(1, 14, 6, 2);
    context.fillStyle = '#18181b';
    context.fillRect(0, 20, 8, 4);
    addNoise(context, 8, 24, 0.05);
  });
  const pants = factory.create(8, 24, (context, addNoise) => {
    context.fillStyle = '#1e293b';
    context.fillRect(0, 0, 8, 12);
    context.fillStyle = '#312e81';
    context.fillRect(2, 2, 4, 8);
    context.fillStyle = '#f59e0b';
    context.fillRect(0, 11, 8, 3);
    context.fillStyle = '#00f0ff';
    context.fillRect(3, 12, 2, 1);
    context.fillStyle = '#0f172a';
    context.fillRect(0, 14, 8, 10);
    context.fillStyle = '#475569';
    context.fillRect(1, 15, 6, 6);
    context.fillStyle = '#f59e0b';
    context.fillRect(0, 22, 8, 2);
    addNoise(context, 8, 24, 0.05);
  });
  return { face, hair, torso, arm, pants };
}

function createEryndorTextures(factory: TextureFactory): TextureSet {
  const hair = factory.create(16, 16, (context, addNoise) => {
    context.fillStyle = '#b9c6d3';
    context.fillRect(0, 0, 16, 16);
    context.fillStyle = '#e5edf3';
    context.fillRect(1, 1, 5, 5);
    context.fillRect(9, 3, 6, 4);
    context.fillRect(3, 10, 4, 5);
    context.fillStyle = '#7d8b9b';
    context.fillRect(0, 7, 5, 3);
    context.fillRect(11, 10, 5, 4);
    addNoise(context, 16, 16, 0.045);
  });
  const face = factory.create(16, 16, (context, addNoise) => {
    context.fillStyle = '#b9785f';
    context.fillRect(0, 0, 16, 16);
    context.fillStyle = '#c98d70';
    context.fillRect(2, 4, 12, 7);
    context.fillStyle = '#c8d3df';
    context.fillRect(0, 0, 16, 3);
    context.fillRect(0, 3, 2, 8);
    context.fillRect(14, 3, 2, 8);
    context.fillStyle = '#8d9bac';
    context.fillRect(2, 1, 4, 2);
    context.fillRect(10, 0, 4, 2);
    context.fillStyle = '#f5e6c8';
    context.fillRect(3, 6, 3, 2);
    context.fillStyle = '#d6a52e';
    context.fillRect(4, 6, 1, 2);
    context.fillStyle = '#2b123e';
    context.fillRect(10, 5, 4, 4);
    context.fillStyle = '#b86cff';
    context.fillRect(11, 6, 2, 2);
    context.fillStyle = '#f5e8ff';
    context.fillRect(12, 6, 1, 1);
    context.fillStyle = '#7d3bb5';
    context.fillRect(12, 9, 1, 3);
    context.fillRect(11, 11, 2, 1);
    context.fillStyle = '#9f604f';
    context.fillRect(7, 8, 2, 2);
    context.fillStyle = '#dbe4eb';
    context.fillRect(4, 10, 8, 2);
    context.fillRect(3, 12, 10, 2);
    context.fillRect(5, 14, 6, 2);
    context.fillStyle = '#9eacba';
    context.fillRect(4, 12, 2, 1);
    context.fillRect(10, 13, 2, 1);
    addNoise(context, 16, 16, 0.035);
  });
  const torso = factory.create(16, 24, (context, addNoise) => {
    context.fillStyle = '#17112c';
    context.fillRect(0, 0, 16, 24);
    context.fillStyle = '#241746';
    context.fillRect(2, 0, 12, 24);
    context.fillStyle = '#0e2638';
    context.fillRect(0, 0, 16, 4);
    context.fillStyle = '#2c6b78';
    context.fillRect(0, 3, 16, 1);
    context.fillStyle = '#a97825';
    context.fillRect(2, 4, 3, 3);
    context.fillRect(4, 7, 3, 4);
    context.fillRect(6, 11, 3, 4);
    context.fillRect(8, 15, 3, 5);
    context.fillStyle = '#e3bd54';
    context.fillRect(3, 4, 1, 3);
    context.fillRect(7, 12, 1, 3);
    context.fillStyle = '#24150f';
    context.fillRect(0, 18, 16, 3);
    context.fillStyle = '#77531e';
    context.fillRect(6, 18, 4, 3);
    context.fillStyle = '#62e6dc';
    context.fillRect(10, 7, 2, 2);
    context.fillRect(9, 9, 4, 1);
    context.fillRect(10, 10, 2, 3);
    context.fillStyle = '#d7fffb';
    context.fillRect(10, 9, 1, 1);
    context.fillStyle = '#8063bf';
    context.fillRect(3, 13, 1, 1);
    context.fillRect(13, 5, 1, 1);
    context.fillRect(12, 15, 1, 1);
    context.fillRect(4, 22, 1, 1);
    addNoise(context, 16, 24, 0.035);
  });
  const arm = factory.create(8, 24, (context, addNoise) => {
    context.fillStyle = '#21163f';
    context.fillRect(0, 0, 8, 14);
    context.fillStyle = '#30205a';
    context.fillRect(1, 2, 6, 8);
    context.fillStyle = '#2d7e83';
    context.fillRect(0, 12, 8, 3);
    context.fillStyle = '#73e4da';
    context.fillRect(1, 13, 2, 1);
    context.fillRect(5, 13, 2, 1);
    context.fillStyle = '#2a201f';
    context.fillRect(0, 15, 8, 9);
    context.fillStyle = '#6f4b38';
    context.fillRect(1, 16, 6, 5);
    context.fillStyle = '#b78a3e';
    context.fillRect(0, 20, 8, 2);
    addNoise(context, 8, 24, 0.04);
  });
  const pants = factory.create(8, 24, (context, addNoise) => {
    context.fillStyle = '#161129';
    context.fillRect(0, 0, 8, 15);
    context.fillStyle = '#2b1d4a';
    context.fillRect(1, 2, 6, 10);
    context.fillStyle = '#876329';
    context.fillRect(0, 12, 8, 2);
    context.fillStyle = '#16151b';
    context.fillRect(0, 15, 8, 9);
    context.fillStyle = '#3b3349';
    context.fillRect(1, 16, 6, 3);
    context.fillStyle = '#4c8f91';
    context.fillRect(0, 20, 8, 1);
    addNoise(context, 8, 24, 0.045);
  });
  return { face, hair, torso, arm, pants };
}

function createVesperaTextures(factory: TextureFactory): TextureSet {
  const hair = factory.create(16, 16, (context, addNoise) => {
    context.fillStyle = '#2e1065';
    context.fillRect(0, 0, 16, 16);
    context.fillStyle = '#581c87';
    context.fillRect(2, 2, 12, 12);
    context.fillStyle = '#86198f';
    context.fillRect(4, 4, 8, 8);
    context.fillStyle = '#c026d3';
    context.fillRect(5, 5, 6, 6);
    context.fillStyle = '#f472b6';
    context.fillRect(2, 6, 2, 8);
    context.fillRect(12, 6, 2, 8);
    addNoise(context, 16, 16, 0.05);
  });
  const face = factory.create(16, 16, (context, addNoise) => {
    context.fillStyle = '#fce7f3';
    context.fillRect(0, 0, 16, 16);
    context.fillStyle = '#3b0764';
    context.fillRect(0, 0, 16, 3);
    context.fillStyle = '#a21caf';
    context.fillRect(0, 2, 4, 3);
    context.fillRect(12, 2, 4, 3);
    context.fillRect(4, 2, 2, 2);
    context.fillRect(10, 2, 2, 2);
    context.fillStyle = '#f472b6';
    context.fillRect(2, 1, 3, 1);
    context.fillRect(11, 1, 3, 1);
    context.fillStyle = '#2e1065';
    context.fillRect(2, 5, 4, 1);
    context.fillRect(10, 5, 4, 1);
    context.fillStyle = '#ffffff';
    context.fillRect(2, 6, 4, 3);
    context.fillStyle = '#ec4899';
    context.fillRect(3, 6, 2, 2);
    context.fillStyle = '#fb7185';
    context.fillRect(4, 6, 1, 1);
    context.fillStyle = '#ffffff';
    context.fillRect(3, 6, 1, 1);
    context.fillStyle = '#ffffff';
    context.fillRect(10, 6, 4, 3);
    context.fillStyle = '#8b5cf6';
    context.fillRect(11, 6, 2, 2);
    context.fillStyle = '#c084fc';
    context.fillRect(12, 6, 1, 1);
    context.fillStyle = '#ffffff';
    context.fillRect(11, 6, 1, 1);
    context.fillStyle = '#e879f9';
    context.fillRect(13, 9, 2, 3);
    context.fillRect(11, 10, 2, 1);
    context.fillStyle = '#f43f5e';
    context.fillRect(12, 11, 2, 2);
    context.fillStyle = '#fbcfe8';
    context.fillRect(2, 9, 2, 1);
    context.fillStyle = '#e11d48';
    context.fillRect(6, 12, 4, 1);
    context.fillStyle = '#fda4af';
    context.fillRect(7, 12, 2, 1);
    addNoise(context, 16, 16, 0.03);
  });
  const torso = factory.create(16, 24, (context, addNoise) => {
    context.fillStyle = '#0f051d';
    context.fillRect(0, 0, 16, 24);
    context.fillStyle = '#fce7f3';
    context.fillRect(4, 0, 8, 4);
    context.fillStyle = '#f43f5e';
    context.fillRect(2, 4, 12, 2);
    context.fillRect(1, 6, 3, 12);
    context.fillRect(12, 6, 3, 12);
    context.fillStyle = '#fbbf24';
    context.fillRect(2, 5, 12, 1);
    context.fillStyle = '#4c0519';
    context.fillRect(4, 6, 8, 11);
    context.fillStyle = '#ec4899';
    context.fillRect(6, 7, 4, 4);
    context.fillStyle = '#f43f5e';
    context.fillRect(7, 8, 2, 3);
    context.fillStyle = '#ffffff';
    context.fillRect(7, 8, 1, 1);
    context.fillStyle = '#fbbf24';
    context.fillRect(0, 17, 16, 2);
    context.fillStyle = '#be123c';
    context.fillRect(3, 19, 10, 5);
    context.fillStyle = '#f472b6';
    context.fillRect(7, 18, 2, 6);
    addNoise(context, 16, 24, 0.04);
  });
  const arm = factory.create(8, 24, (context, addNoise) => {
    context.fillStyle = '#fce7f3';
    context.fillRect(0, 0, 8, 8);
    context.fillStyle = '#fbbf24';
    context.fillRect(0, 4, 8, 1);
    context.fillStyle = '#ec4899';
    context.fillRect(2, 5, 2, 3);
    context.fillRect(4, 7, 2, 2);
    context.fillStyle = '#0f051d';
    context.fillRect(0, 9, 8, 11);
    context.fillStyle = '#f43f5e';
    context.fillRect(1, 11, 6, 2);
    context.fillStyle = '#fbbf24';
    context.fillRect(0, 15, 8, 1);
    context.fillStyle = '#1c1917';
    context.fillRect(0, 20, 8, 4);
    context.fillStyle = '#ec4899';
    context.fillRect(2, 21, 4, 1);
    addNoise(context, 8, 24, 0.04);
  });
  const pants = factory.create(8, 24, (context, addNoise) => {
    context.fillStyle = '#0f051d';
    context.fillRect(0, 0, 8, 6);
    context.fillStyle = '#831843';
    context.fillRect(2, 1, 4, 5);
    context.fillStyle = '#fce7f3';
    context.fillRect(0, 6, 8, 3);
    context.fillStyle = '#fbbf24';
    context.fillRect(0, 8, 8, 1);
    context.fillStyle = '#f43f5e';
    context.fillRect(0, 9, 8, 4);
    context.fillStyle = '#ec4899';
    context.fillRect(3, 10, 2, 2);
    context.fillStyle = '#1e1035';
    context.fillRect(0, 13, 8, 11);
    context.fillStyle = '#fbbf24';
    context.fillRect(1, 14, 6, 8);
    context.fillStyle = '#4c0519';
    context.fillRect(2, 15, 4, 6);
    context.fillStyle = '#f43f5e';
    context.fillRect(0, 22, 8, 2);
    addNoise(context, 8, 24, 0.04);
  });
  return { face, hair, torso, arm, pants };
}

function createKaelithTextures(factory: TextureFactory): TextureSet {
  const hair = factory.create(16, 16, (context, addNoise) => {
    context.fillStyle = '#090d16';
    context.fillRect(0, 0, 16, 16);
    context.fillStyle = '#334155';
    context.fillRect(2, 2, 12, 12);
    context.fillStyle = '#94a3b8';
    context.fillRect(3, 3, 10, 10);
    context.fillStyle = '#e2e8f0';
    context.fillRect(5, 4, 6, 8);
    context.fillStyle = '#06b6d4';
    context.fillRect(1, 5, 2, 9);
    context.fillRect(13, 5, 2, 9);
    context.fillStyle = '#38bdf8';
    context.fillRect(2, 7, 1, 7);
    addNoise(context, 16, 16, 0.05);
  });
  const face = factory.create(16, 16, (context, addNoise) => {
    context.fillStyle = '#eef2f6';
    context.fillRect(0, 0, 16, 16);
    context.fillStyle = '#0f172a';
    context.fillRect(0, 0, 16, 2);
    context.fillStyle = '#cbd5e1';
    context.fillRect(0, 1, 16, 2);
    context.fillStyle = '#06b6d4';
    context.fillRect(1, 2, 3, 2);
    context.fillRect(12, 2, 3, 2);
    context.fillRect(4, 2, 2, 2);
    context.fillRect(10, 2, 2, 2);
    context.fillStyle = '#f8fafc';
    context.fillRect(2, 0, 4, 2);
    context.fillRect(10, 0, 4, 2);
    context.fillStyle = '#0b1329';
    context.fillRect(2, 5, 4, 1);
    context.fillRect(10, 5, 4, 1);
    context.fillStyle = '#ffffff';
    context.fillRect(2, 6, 4, 3);
    context.fillStyle = '#f59e0b';
    context.fillRect(3, 6, 2, 2);
    context.fillStyle = '#fde047';
    context.fillRect(4, 6, 1, 1);
    context.fillStyle = '#ffffff';
    context.fillRect(3, 6, 1, 1);
    context.fillStyle = '#ffffff';
    context.fillRect(10, 6, 4, 3);
    context.fillStyle = '#06b6d4';
    context.fillRect(11, 6, 2, 2);
    context.fillStyle = '#67e8f9';
    context.fillRect(12, 6, 1, 1);
    context.fillStyle = '#ffffff';
    context.fillRect(11, 6, 1, 1);
    context.fillStyle = '#0284c7';
    context.fillRect(2, 9, 2, 3);
    context.fillRect(4, 10, 2, 1);
    context.fillStyle = '#38bdf8';
    context.fillRect(3, 11, 2, 2);
    context.fillStyle = '#c7d2fe';
    context.fillRect(12, 9, 2, 1);
    context.fillStyle = '#334155';
    context.fillRect(6, 12, 4, 1);
    context.fillStyle = '#38bdf8';
    context.fillRect(7, 12, 2, 1);
    addNoise(context, 16, 16, 0.03);
  });
  const torso = factory.create(16, 24, (context, addNoise) => {
    context.fillStyle = '#090d16';
    context.fillRect(0, 0, 16, 24);
    context.fillStyle = '#eef2f6';
    context.fillRect(5, 0, 6, 3);
    context.fillStyle = '#f59e0b';
    context.fillRect(2, 3, 12, 2);
    context.fillRect(1, 5, 3, 12);
    context.fillRect(12, 5, 3, 12);
    context.fillStyle = '#fbbf24';
    context.fillRect(3, 4, 10, 1);
    context.fillStyle = '#042f2e';
    context.fillRect(4, 5, 8, 12);
    context.fillStyle = '#0891b2';
    context.fillRect(6, 6, 4, 5);
    context.fillStyle = '#38bdf8';
    context.fillRect(7, 7, 2, 3);
    context.fillStyle = '#ffffff';
    context.fillRect(7, 7, 1, 1);
    context.fillStyle = '#f59e0b';
    context.fillRect(0, 17, 16, 2);
    context.fillStyle = '#0e7490';
    context.fillRect(3, 19, 10, 5);
    context.fillStyle = '#38bdf8';
    context.fillRect(7, 18, 2, 6);
    addNoise(context, 16, 24, 0.04);
  });
  const arm = factory.create(8, 24, (context, addNoise) => {
    context.fillStyle = '#eef2f6';
    context.fillRect(0, 0, 8, 7);
    context.fillStyle = '#f59e0b';
    context.fillRect(0, 4, 8, 1);
    context.fillStyle = '#06b6d4';
    context.fillRect(2, 5, 2, 3);
    context.fillRect(4, 6, 2, 2);
    context.fillStyle = '#090d16';
    context.fillRect(0, 8, 8, 12);
    context.fillStyle = '#0891b2';
    context.fillRect(1, 10, 6, 2);
    context.fillStyle = '#f59e0b';
    context.fillRect(0, 14, 8, 1);
    context.fillStyle = '#1e293b';
    context.fillRect(0, 20, 8, 4);
    context.fillStyle = '#38bdf8';
    context.fillRect(2, 21, 4, 1);
    addNoise(context, 8, 24, 0.04);
  });
  const pants = factory.create(8, 24, (context, addNoise) => {
    context.fillStyle = '#090d16';
    context.fillRect(0, 0, 8, 6);
    context.fillStyle = '#134e4a';
    context.fillRect(2, 1, 4, 5);
    context.fillStyle = '#eef2f6';
    context.fillRect(0, 6, 8, 3);
    context.fillStyle = '#f59e0b';
    context.fillRect(0, 8, 8, 1);
    context.fillStyle = '#0891b2';
    context.fillRect(0, 9, 8, 4);
    context.fillStyle = '#38bdf8';
    context.fillRect(3, 10, 2, 2);
    context.fillStyle = '#0f172a';
    context.fillRect(0, 13, 8, 11);
    context.fillStyle = '#f59e0b';
    context.fillRect(1, 14, 6, 8);
    context.fillStyle = '#042f2e';
    context.fillRect(2, 15, 4, 6);
    context.fillStyle = '#38bdf8';
    context.fillRect(0, 22, 8, 2);
    addNoise(context, 8, 24, 0.04);
  });
  return { face, hair, torso, arm, pants };
}

function createBaseMaterials(
  context: PlayerCharacterRigBuildContext,
  textures: TextureSet,
  options: {
    hair: THREE.MeshStandardMaterialParameters;
    face: THREE.MeshStandardMaterialParameters;
    torso: THREE.MeshStandardMaterialParameters;
    arm: THREE.MeshStandardMaterialParameters;
    pants: THREE.MeshStandardMaterialParameters;
  },
): BaseMaterials {
  return {
    hair: context.createTexturedMaterial(textures.hair, options.hair),
    face: context.createTexturedMaterial(textures.face, options.face),
    torso: context.createTexturedMaterial(textures.torso, options.torso),
    arm: context.createTexturedMaterial(textures.arm, options.arm),
    pants: context.createTexturedMaterial(textures.pants, options.pants),
  };
}

function noopDecorator(): void {
  // Otherys uses the base rig accessory set for this slot.
}

function createAppearance(
  id: PlayerCharacterId,
  context: PlayerCharacterRigBuildContext,
): CharacterAppearance {
  const textures = createCharacterTextures(id);

  if (id === 'Otherys') {
    const materials = createBaseMaterials(context, textures, {
      hair: { roughness: 0.8 },
      face: { roughness: 0.8 },
      torso: { roughness: 0.8 },
      arm: { roughness: 0.8 },
      pants: { roughness: 0.8 },
    });
    const leather = context.createMaterial({ color: 0x3e2723, roughness: 0.8 });
    const armor = context.createMaterial({ color: 0x475569, metalness: 0.6, roughness: 0.4 });
    armor.polygonOffset = true;
    armor.polygonOffsetFactor = -1;
    armor.polygonOffsetUnits = -1;

    return {
      materials,
      buildHeadAccessories: (buildContext) => {
        const hairBand = buildContext.createMesh(
          new THREE.BoxGeometry(0.53, 0.15, 0.53),
          leather,
          'HairBand',
        );
        hairBand.position.y = 0.35;
        return hairBand;
      },
      buildBackpack: (buildContext) => {
        const backpack = buildContext.createMesh(
          new THREE.BoxGeometry(0.38, 0.45, 0.15),
          leather,
          'Backpack',
        );
        backpack.position.set(0, 1.05, -0.19);
        return backpack;
      },
      decorateLeftArm: (buildContext, mesh) => {
        const pauldron = buildContext.createMesh(
          new THREE.BoxGeometry(0.29, 0.2, 0.29),
          armor,
          'LeftPauldron',
        );
        pauldron.position.set(-0.02, 0.02, 0);
        mesh.add(pauldron);
      },
      decorateRightArm: noopDecorator,
      decorateLeg: noopDecorator,
    };
  }

  if (id === 'Solvaris') {
    const materials = createBaseMaterials(context, textures, {
      hair: { roughness: 0.6 },
      face: { roughness: 0.7 },
      torso: { roughness: 0.4, metalness: 0.3 },
      arm: { roughness: 0.4, metalness: 0.3 },
      pants: { roughness: 0.5, metalness: 0.3 },
    });
    const goldRune = context.createMaterial({ color: 0xf59e0b, metalness: 0.85, roughness: 0.25 });
    const obsidianPlate = context.createMaterial({ color: 0x0f172a, metalness: 0.7, roughness: 0.3 });
    const astralCrystal = context.createMaterial({
      color: 0x00f0ff,
      emissive: 0x0088cc,
      emissiveIntensity: 0.7,
      roughness: 0.1,
      metalness: 0.1,
    });
    const violetGlow = context.createMaterial({
      color: 0xa855f7,
      emissive: 0x6b21a8,
      emissiveIntensity: 0.6,
      roughness: 0.2,
    });

    return {
      materials,
      buildHeadAccessories: (buildContext) => {
        const hairBand = new THREE.Group();
        hairBand.name = 'HairBand';
        const crownBand = buildContext.createMesh(new THREE.BoxGeometry(0.53, 0.1, 0.53), goldRune, 'CrownBand');
        crownBand.position.y = 0.38;
        hairBand.add(crownBand);
        const crestGem = buildContext.createMesh(new THREE.BoxGeometry(0.12, 0.14, 0.08), astralCrystal, 'CrestGem');
        crestGem.position.set(0, 0.44, 0.26);
        hairBand.add(crestGem);
        const leftHorn = buildContext.createMesh(new THREE.BoxGeometry(0.06, 0.18, 0.16), obsidianPlate, 'LeftHorn');
        leftHorn.position.set(0.25, 0.48, -0.05);
        leftHorn.rotation.set(-0.3, 0, 0.3);
        hairBand.add(leftHorn);
        const rightHorn = buildContext.createMesh(new THREE.BoxGeometry(0.06, 0.18, 0.16), obsidianPlate, 'RightHorn');
        rightHorn.position.set(-0.25, 0.48, -0.05);
        rightHorn.rotation.set(-0.3, 0, -0.3);
        hairBand.add(rightHorn);
        return hairBand;
      },
      buildBackpack: (buildContext) => {
        const backpack = new THREE.Group();
        backpack.name = 'Backpack';
        const relicHousing = buildContext.createMesh(new THREE.BoxGeometry(0.32, 0.42, 0.12), obsidianPlate, 'RelicHousing');
        relicHousing.position.set(0, 1.05, -0.18);
        backpack.add(relicHousing);
        const relicGoldStruts = buildContext.createMesh(new THREE.BoxGeometry(0.35, 0.18, 0.14), goldRune, 'RelicGoldStruts');
        relicGoldStruts.position.set(0, 1.05, -0.18);
        backpack.add(relicGoldStruts);
        const relicCoreCrystal = buildContext.createMesh(new THREE.BoxGeometry(0.14, 0.22, 0.08), astralCrystal, 'RelicCoreCrystal');
        relicCoreCrystal.position.set(0, 1.05, -0.23);
        backpack.add(relicCoreCrystal);
        return backpack;
      },
      decorateLeftArm: (buildContext, mesh) => {
        const pauldron = buildContext.createMesh(new THREE.BoxGeometry(0.34, 0.22, 0.34), obsidianPlate, 'LeftPauldron');
        pauldron.position.set(0.04, 0.05, 0);
        mesh.add(pauldron);
        const trim = buildContext.createMesh(new THREE.BoxGeometry(0.36, 0.08, 0.36), goldRune, 'LeftPauldronGoldTrim');
        trim.position.set(0.04, 0.08, 0);
        mesh.add(trim);
        const crystal = buildContext.createMesh(new THREE.BoxGeometry(0.1, 0.16, 0.1), violetGlow, 'LeftPauldronCrystal');
        crystal.position.set(0.08, 0.20, 0);
        mesh.add(crystal);
      },
      decorateRightArm: (buildContext, mesh) => {
        const pauldron = buildContext.createMesh(new THREE.BoxGeometry(0.28, 0.14, 0.28), goldRune, 'RightPauldron');
        pauldron.position.set(-0.01, 0.04, 0);
        mesh.add(pauldron);
      },
      decorateLeg: (buildContext, mesh) => {
        const plate = buildContext.createMesh(new THREE.BoxGeometry(0.27, 0.14, 0.08), goldRune, 'KneePlate');
        plate.position.set(0, -0.25, 0.11);
        mesh.add(plate);
      },
    };
  }

  if (id === 'Eryndor') {
    const materials = createBaseMaterials(context, textures, {
      hair: { roughness: 0.8 },
      face: { roughness: 0.82 },
      torso: { roughness: 0.78 },
      arm: { roughness: 0.8 },
      pants: { roughness: 0.85 },
    });
    const hatMat = context.createMaterial({ color: 0x21133f, roughness: 0.9 });
    const hatShadowMat = context.createMaterial({ color: 0x100a20, roughness: 0.95 });
    const runeMat = context.createMaterial({
      color: 0x70f0e6,
      emissive: 0x1b8b88,
      emissiveIntensity: 0.85,
      roughness: 0.35,
    });
    const riftMat = context.createMaterial({
      color: 0xb365ff,
      emissive: 0x6b23a8,
      emissiveIntensity: 1.0,
      roughness: 0.28,
    });
    const goldMatWizard = context.createMaterial({
      color: 0xb88932,
      metalness: 0.65,
      roughness: 0.32,
    });
    const silverMat = context.createMaterial({
      color: 0xb7c4d0,
      metalness: 0.25,
      roughness: 0.58,
    });
    const bookMat = context.createMaterial({ color: 0x30184c, roughness: 0.78 });
    const pageMat = context.createMaterial({ color: 0xcbbf9c, roughness: 0.95 });
    const robeMat = context.createMaterial({ color: 0x1a1232, roughness: 0.9 });

    const addBox = (
      buildContext: PlayerCharacterRigBuildContext,
      parent: THREE.Object3D,
      width: number,
      height: number,
      depth: number,
      material: THREE.Material,
      name: string,
      x: number,
      y: number,
      z: number,
    ): THREE.Mesh => {
      const mesh = buildContext.createMesh(new THREE.BoxGeometry(width, height, depth), material, name);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };

    return {
      materials,
      decorateHead: (buildContext, mesh) => {
        const beardRoot = new THREE.Group();
        beardRoot.name = 'BeardRoot';
        beardRoot.position.set(0, -0.12, 0.276);
        mesh.add(beardRoot);
        addBox(buildContext, beardRoot, 0.34, 0.13, 0.070, silverMat, 'BeardUpper', 0, 0, 0);
        addBox(buildContext, beardRoot, 0.26, 0.11, 0.090, silverMat, 'BeardMiddleUpper', 0, -0.105, 0.003);
        addBox(buildContext, beardRoot, 0.16, 0.10, 0.110, silverMat, 'BeardMiddleLower', 0, -0.195, 0.006);
        addBox(buildContext, beardRoot, 0.08, 0.07, 0.130, silverMat, 'BeardTip', 0, -0.265, 0.009);
      },
      buildHeadAccessories: (buildContext) => {
        const hairBand = new THREE.Group();
        hairBand.name = 'HairBand';
        hairBand.position.set(0, 0.48, 0);

        const brim = buildContext.createMesh(
          new THREE.BoxGeometry(0.74, 0.075, 0.70),
          hatShadowMat,
          'WizardHatBrim',
        );
        brim.rotation.y = THREE.MathUtils.degToRad(4);
        hairBand.add(brim);
        addBox(buildContext, hairBand, 0.54, 0.16, 0.52, hatMat, 'WizardHatLower', -0.015, 0.105, 0.0);
        addBox(buildContext, hairBand, 0.43, 0.17, 0.43, hatMat, 'WizardHatMiddleLower', 0.025, 0.255, -0.01);
        addBox(buildContext, hairBand, 0.34, 0.16, 0.34, hatMat, 'WizardHatMiddleUpper', -0.005, 0.405, -0.015);
        addBox(buildContext, hairBand, 0.26, 0.15, 0.27, hatMat, 'WizardHatUpper', 0.045, 0.535, -0.015);
        const bentTip = addBox(buildContext, hairBand, 0.19, 0.14, 0.22, hatMat, 'WizardHatBentTip', 0.105, 0.645, 0.005);
        bentTip.rotation.z = THREE.MathUtils.degToRad(-17);
        const tip = addBox(buildContext, hairBand, 0.12, 0.12, 0.18, hatMat, 'WizardHatTip', 0.165, 0.74, 0.02);
        tip.rotation.z = THREE.MathUtils.degToRad(-27);
        addBox(buildContext, hairBand, 0.57, 0.058, 0.55, goldMatWizard, 'WizardHatBand', -0.01, 0.137, 0);
        addBox(buildContext, hairBand, 0.09, 0.09, 0.08, runeMat, 'WizardHatFrontRune', -0.01, 0.15, 0.294);
        const hatCrystal = addBox(buildContext, hairBand, 0.09, 0.18, 0.09, riftMat, 'WizardHatCrystal', -0.30, 0.18, 0.02);
        hatCrystal.rotation.z = THREE.MathUtils.degToRad(18);
        addBox(buildContext, hairBand, 0.05, 0.10, 0.05, runeMat, 'WizardHatCrystalRune', -0.355, 0.25, 0.02);
        return hairBand;
      },
      buildBackpack: (buildContext) => {
        const backpack = new THREE.Group();
        backpack.name = 'Backpack';
        const book = buildContext.createMesh(
          new THREE.BoxGeometry(0.38, 0.45, 0.15),
          bookMat,
          'SpellbookPack',
        );
        book.position.set(0, 1.05, -0.19);
        backpack.add(book);
        addBox(buildContext, book, 0.32, 0.37, 0.035, pageMat, 'SpellbookPages', 0, 0, -0.09);
        addBox(buildContext, book, 0.06, 0.40, 0.04, goldMatWizard, 'SpellbookLeftRail', -0.14, 0, -0.115);
        addBox(buildContext, book, 0.06, 0.40, 0.04, goldMatWizard, 'SpellbookRightRail', 0.14, 0, -0.115);
        addBox(buildContext, book, 0.13, 0.13, 0.04, runeMat, 'SpellbookRune', 0, 0, -0.12);
        return backpack;
      },
      decorateTorso: (buildContext, mesh) => {
        const tabard = addBox(buildContext, mesh, 0.34, 0.48, 0.035, robeMat, 'RobeTabard', 0, -0.36, 0.145);
        tabard.rotation.z = THREE.MathUtils.degToRad(2);
        addBox(buildContext, mesh, 0.06, 0.26, 0.042, goldMatWizard, 'RobeGoldSash', -0.11, -0.34, 0.166);
        addBox(buildContext, mesh, 0.06, 0.16, 0.042, runeMat, 'RobeRuneSash', 0.105, -0.35, 0.166);
        addBox(buildContext, mesh, 0.12, 0.10, 0.05, goldMatWizard, 'RobeClasp', 0, 0.03, 0.16);
        addBox(buildContext, mesh, 0.06, 0.06, 0.06, runeMat, 'RobeClaspRune', 0, 0.03, 0.185);
        addBox(buildContext, mesh, 0.22, 0.10, 0.32, hatShadowMat, 'RightMantle', 0.20, 0.28, 0.00);
        addBox(buildContext, mesh, 0.18, 0.07, 0.30, goldMatWizard, 'LeftMantle', -0.20, 0.25, 0.00);
      },
      decorateLeftArm: (buildContext, mesh) => {
        const pauldron = buildContext.createMesh(
          new THREE.BoxGeometry(0.31, 0.16, 0.31),
          hatShadowMat,
          'LeftCrystalPauldron',
        );
        pauldron.position.set(0.01, 0.02, 0);
        mesh.add(pauldron);
        const leftCrystalA = addBox(buildContext, mesh, 0.09, 0.22, 0.09, riftMat, 'LeftRiftCrystal', 0.075, 0.11, -0.02);
        leftCrystalA.rotation.z = THREE.MathUtils.degToRad(-12);
        const leftCrystalB = addBox(buildContext, mesh, 0.07, 0.15, 0.07, runeMat, 'LeftRuneCrystal', -0.065, 0.08, 0.04);
        leftCrystalB.rotation.z = THREE.MathUtils.degToRad(14);
      },
      decorateRightArm: (buildContext, mesh) => {
        addBox(buildContext, mesh, 0.28, 0.11, 0.28, goldMatWizard, 'RightRuneGuard', 0, 0.015, 0);
        addBox(buildContext, mesh, 0.07, 0.07, 0.05, riftMat, 'RightRiftGem', 0, 0.015, 0.162);
      },
      decorateLeg: (buildContext, mesh) => {
        void buildContext;
        void mesh;
      },
      decorateLeftLeg: (buildContext, mesh) => {
        addBox(buildContext, mesh, 0.17, 0.08, 0.035, runeMat, 'LeftRobeRune', 0, -0.17, 0.145);
      },
      decorateRightLeg: (buildContext, mesh) => {
        addBox(buildContext, mesh, 0.17, 0.08, 0.035, goldMatWizard, 'RightRobeTrim', 0, -0.17, 0.145);
      },
    };
  }

  if (id === 'Vespera') {
    const materials = createBaseMaterials(context, textures, {
      hair: { roughness: 0.6 },
      face: { roughness: 0.7 },
      torso: { roughness: 0.4, metalness: 0.3 },
      arm: { roughness: 0.4, metalness: 0.3 },
      pants: { roughness: 0.5, metalness: 0.3 },
    });
    const roseGold = context.createMaterial({ color: 0xfb7185, metalness: 0.85, roughness: 0.25 });
    const darkPlumArmor = context.createMaterial({ color: 0x2e1065, metalness: 0.7, roughness: 0.3 });
    const phoenixRuby = context.createMaterial({
      color: 0xf43f5e,
      emissive: 0xbe123c,
      emissiveIntensity: 0.8,
      roughness: 0.1,
      metalness: 0.1,
    });
    const twilightGlow = context.createMaterial({
      color: 0xd946ef,
      emissive: 0xa21caf,
      emissiveIntensity: 0.7,
      roughness: 0.15,
    });

    return {
      materials,
      buildHeadAccessories: (buildContext) => {
        const hairBand = new THREE.Group();
        hairBand.name = 'HairBand';
        const tiara = buildContext.createMesh(new THREE.BoxGeometry(0.53, 0.08, 0.53), roseGold, 'Tiara');
        tiara.position.y = 0.38;
        hairBand.add(tiara);
        const tiaraGem = buildContext.createMesh(new THREE.BoxGeometry(0.12, 0.14, 0.08), phoenixRuby, 'TiaraGem');
        tiaraGem.position.set(0, 0.44, 0.26);
        hairBand.add(tiaraGem);
        const leftHorn = buildContext.createMesh(new THREE.BoxGeometry(0.06, 0.22, 0.18), darkPlumArmor, 'LeftHorn');
        leftHorn.position.set(0.24, 0.50, -0.06);
        leftHorn.rotation.set(-0.35, 0, 0.35);
        hairBand.add(leftHorn);
        const leftHornGlow = buildContext.createMesh(new THREE.BoxGeometry(0.04, 0.12, 0.08), twilightGlow, 'LeftHornGlow');
        leftHornGlow.position.set(0.26, 0.56, -0.08);
        leftHornGlow.rotation.set(-0.35, 0, 0.35);
        hairBand.add(leftHornGlow);
        const rightHorn = buildContext.createMesh(new THREE.BoxGeometry(0.06, 0.22, 0.18), darkPlumArmor, 'RightHorn');
        rightHorn.position.set(-0.24, 0.50, -0.06);
        rightHorn.rotation.set(-0.35, 0, -0.35);
        hairBand.add(rightHorn);
        const rightHornGlow = buildContext.createMesh(new THREE.BoxGeometry(0.04, 0.12, 0.08), twilightGlow, 'RightHornGlow');
        rightHornGlow.position.set(-0.26, 0.56, -0.08);
        rightHornGlow.rotation.set(-0.35, 0, -0.35);
        hairBand.add(rightHornGlow);
        const leftEarFin = buildContext.createMesh(new THREE.BoxGeometry(0.04, 0.14, 0.16), roseGold, 'LeftEarFin');
        leftEarFin.position.set(0.27, 0.26, 0.02);
        leftEarFin.rotation.set(-0.2, 0, 0.4);
        hairBand.add(leftEarFin);
        const rightEarFin = buildContext.createMesh(new THREE.BoxGeometry(0.04, 0.14, 0.16), roseGold, 'RightEarFin');
        rightEarFin.position.set(-0.27, 0.26, 0.02);
        rightEarFin.rotation.set(-0.2, 0, -0.4);
        hairBand.add(rightEarFin);
        const ponytailRoot = buildContext.createMesh(new THREE.BoxGeometry(0.18, 0.16, 0.14), roseGold, 'PonytailRoot');
        ponytailRoot.position.set(0, 0.38, -0.27);
        hairBand.add(ponytailRoot);
        const ponytailUpper = buildContext.createMesh(new THREE.BoxGeometry(0.22, 0.44, 0.14), materials.hair, 'PonytailUpper');
        ponytailUpper.position.set(0, 0.12, -0.32);
        ponytailUpper.rotation.x = -0.15;
        hairBand.add(ponytailUpper);
        const ponytailLower = buildContext.createMesh(new THREE.BoxGeometry(0.16, 0.38, 0.10), materials.hair, 'PonytailLower');
        ponytailLower.position.set(0, -0.20, -0.36);
        ponytailLower.rotation.x = -0.08;
        hairBand.add(ponytailLower);
        const ponytailRibbon = buildContext.createMesh(new THREE.BoxGeometry(0.18, 0.06, 0.12), twilightGlow, 'PonytailRibbon');
        ponytailRibbon.position.set(0, -0.02, -0.34);
        hairBand.add(ponytailRibbon);
        return hairBand;
      },
      buildBackpack: (buildContext) => {
        const backpack = new THREE.Group();
        backpack.name = 'Backpack';
        const wingCoreHousing = buildContext.createMesh(new THREE.BoxGeometry(0.24, 0.36, 0.12), darkPlumArmor, 'WingCoreHousing');
        wingCoreHousing.position.set(0, 1.05, -0.17);
        backpack.add(wingCoreHousing);
        const wingGildedStruts = buildContext.createMesh(new THREE.BoxGeometry(0.30, 0.16, 0.14), roseGold, 'WingGildedStruts');
        wingGildedStruts.position.set(0, 1.05, -0.17);
        backpack.add(wingGildedStruts);
        const wingHeartGem = buildContext.createMesh(new THREE.BoxGeometry(0.12, 0.20, 0.08), phoenixRuby, 'WingHeartGem');
        wingHeartGem.position.set(0, 1.05, -0.22);
        backpack.add(wingHeartGem);
        const leftWingUpper = buildContext.createMesh(new THREE.BoxGeometry(0.08, 0.46, 0.08), twilightGlow, 'LeftWingUpper');
        leftWingUpper.position.set(0.22, 1.22, -0.22);
        leftWingUpper.rotation.set(0.2, 0.15, -0.45);
        backpack.add(leftWingUpper);
        const leftWingLower = buildContext.createMesh(new THREE.BoxGeometry(0.06, 0.36, 0.06), phoenixRuby, 'LeftWingLower');
        leftWingLower.position.set(0.32, 1.05, -0.25);
        leftWingLower.rotation.set(0.1, 0.1, -0.65);
        backpack.add(leftWingLower);
        const rightWingUpper = buildContext.createMesh(new THREE.BoxGeometry(0.08, 0.46, 0.08), twilightGlow, 'RightWingUpper');
        rightWingUpper.position.set(-0.22, 1.22, -0.22);
        rightWingUpper.rotation.set(0.2, -0.15, 0.45);
        backpack.add(rightWingUpper);
        const rightWingLower = buildContext.createMesh(new THREE.BoxGeometry(0.06, 0.36, 0.06), phoenixRuby, 'RightWingLower');
        rightWingLower.position.set(-0.32, 1.05, -0.25);
        rightWingLower.rotation.set(0.1, -0.1, 0.65);
        backpack.add(rightWingLower);
        return backpack;
      },
      decorateLeftArm: (buildContext, mesh) => {
        const pauldron = buildContext.createMesh(new THREE.BoxGeometry(0.32, 0.20, 0.32), darkPlumArmor, 'LeftPauldron');
        pauldron.position.set(0.03, 0.05, 0);
        mesh.add(pauldron);
        const trim = buildContext.createMesh(new THREE.BoxGeometry(0.35, 0.08, 0.35), roseGold, 'LeftPauldronTrim');
        trim.position.set(0.03, 0.08, 0);
        mesh.add(trim);
        const gem = buildContext.createMesh(new THREE.BoxGeometry(0.10, 0.16, 0.10), phoenixRuby, 'LeftPauldronGem');
        gem.position.set(0.08, 0.18, 0);
        mesh.add(gem);
      },
      decorateRightArm: (buildContext, mesh) => {
        const pauldron = buildContext.createMesh(new THREE.BoxGeometry(0.28, 0.12, 0.28), roseGold, 'RightPauldron');
        pauldron.position.set(-0.01, 0.04, 0);
        mesh.add(pauldron);
      },
      decorateLeg: (buildContext, mesh) => {
        const plate = buildContext.createMesh(new THREE.BoxGeometry(0.27, 0.14, 0.08), roseGold, 'KneePlate');
        plate.position.set(0, -0.25, 0.11);
        mesh.add(plate);
        const gem = buildContext.createMesh(new THREE.BoxGeometry(0.12, 0.08, 0.04), phoenixRuby, 'KneeGem');
        gem.position.set(0, -0.25, 0.14);
        mesh.add(gem);
      },
    };
  }

  const materials = createBaseMaterials(context, textures, {
    hair: { roughness: 0.5 },
    face: { roughness: 0.7 },
    torso: { roughness: 0.35, metalness: 0.4 },
    arm: { roughness: 0.4, metalness: 0.4 },
    pants: { roughness: 0.4, metalness: 0.4 },
  });
  const obsidian = context.createMaterial({ color: 0x090d16, metalness: 0.85, roughness: 0.2 });
  const solarGold = context.createMaterial({ color: 0xf59e0b, metalness: 0.9, roughness: 0.2 });
  const astralCyan = context.createMaterial({
    color: 0x38bdf8,
    emissive: 0x0284c7,
    emissiveIntensity: 0.95,
    roughness: 0.15,
  });
  const solarAmber = context.createMaterial({
    color: 0xfbbf24,
    emissive: 0xd97706,
    emissiveIntensity: 0.85,
    roughness: 0.15,
  });
  const silver = context.createMaterial({ color: 0xcfd8dc, metalness: 0.75, roughness: 0.3 });

  return {
    materials,
    buildHeadAccessories: (buildContext) => {
      const hairBand = new THREE.Group();
      hairBand.name = 'HairBand';
      const crownRing = buildContext.createMesh(new THREE.BoxGeometry(0.54, 0.07, 0.54), solarGold, 'CrownRing');
      crownRing.position.y = 0.40;
      hairBand.add(crownRing);
      const crownStar = buildContext.createMesh(new THREE.BoxGeometry(0.10, 0.14, 0.09), astralCyan, 'CrownStar');
      crownStar.position.set(0, 0.46, 0.27);
      hairBand.add(crownStar);
      const leftHornBase = buildContext.createMesh(new THREE.BoxGeometry(0.08, 0.24, 0.14), obsidian, 'LeftHornBase');
      leftHornBase.position.set(0.25, 0.52, -0.05);
      leftHornBase.rotation.set(-0.4, 0, 0.38);
      hairBand.add(leftHornBase);
      const leftHornTip = buildContext.createMesh(new THREE.BoxGeometry(0.06, 0.28, 0.08), astralCyan, 'LeftHornTip');
      leftHornTip.position.set(0.32, 0.70, -0.15);
      leftHornTip.rotation.set(-0.6, 0, 0.42);
      hairBand.add(leftHornTip);
      const rightHornBase = buildContext.createMesh(new THREE.BoxGeometry(0.08, 0.24, 0.14), obsidian, 'RightHornBase');
      rightHornBase.position.set(-0.25, 0.52, -0.05);
      rightHornBase.rotation.set(-0.4, 0, -0.38);
      hairBand.add(rightHornBase);
      const rightHornTip = buildContext.createMesh(new THREE.BoxGeometry(0.06, 0.28, 0.08), astralCyan, 'RightHornTip');
      rightHornTip.position.set(-0.32, 0.70, -0.15);
      rightHornTip.rotation.set(-0.6, 0, -0.42);
      hairBand.add(rightHornTip);
      const leftFin = buildContext.createMesh(new THREE.BoxGeometry(0.04, 0.16, 0.18), silver, 'LeftFin');
      leftFin.position.set(0.28, 0.25, 0.04);
      leftFin.rotation.set(-0.2, 0, 0.45);
      hairBand.add(leftFin);
      const rightFin = buildContext.createMesh(new THREE.BoxGeometry(0.04, 0.16, 0.18), silver, 'RightFin');
      rightFin.position.set(-0.28, 0.25, 0.04);
      rightFin.rotation.set(-0.2, 0, -0.45);
      hairBand.add(rightFin);
      const leftTress = buildContext.createMesh(new THREE.BoxGeometry(0.10, 0.65, 0.10), materials.hair, 'LeftTress');
      leftTress.position.set(0.22, -0.05, 0.18);
      leftTress.rotation.set(0.1, 0, -0.1);
      hairBand.add(leftTress);
      const leftTressRing = buildContext.createMesh(new THREE.BoxGeometry(0.12, 0.06, 0.12), solarGold, 'LeftTressRing');
      leftTressRing.position.set(0.22, 0.05, 0.18);
      hairBand.add(leftTressRing);
      const rightTress = buildContext.createMesh(new THREE.BoxGeometry(0.10, 0.65, 0.10), materials.hair, 'RightTress');
      rightTress.position.set(-0.22, -0.05, 0.18);
      rightTress.rotation.set(0.1, 0, 0.1);
      hairBand.add(rightTress);
      const rightTressRing = buildContext.createMesh(new THREE.BoxGeometry(0.12, 0.06, 0.12), solarGold, 'RightTressRing');
      rightTressRing.position.set(-0.22, 0.05, 0.18);
      hairBand.add(rightTressRing);
      const backMane = buildContext.createMesh(new THREE.BoxGeometry(0.36, 0.55, 0.14), materials.hair, 'BackMane');
      backMane.position.set(0, 0.05, -0.26);
      backMane.rotation.x = -0.12;
      hairBand.add(backMane);
      return hairBand;
    },
    buildBackpack: (buildContext) => {
      const backpack = new THREE.Group();
      backpack.name = 'Backpack';
      const spineSpikes = buildContext.createMesh(new THREE.BoxGeometry(0.08, 0.70, 0.10), obsidian, 'SpineSpikes');
      spineSpikes.position.set(0, 1.05, -0.16);
      backpack.add(spineSpikes);
      const voidGenerator = buildContext.createMesh(new THREE.BoxGeometry(0.22, 0.22, 0.16), solarGold, 'VoidGenerator');
      voidGenerator.position.set(0, 1.10, -0.18);
      backpack.add(voidGenerator);
      const coreEmber = buildContext.createMesh(new THREE.BoxGeometry(0.12, 0.12, 0.08), solarAmber, 'CoreEmber');
      coreEmber.position.set(0, 1.10, -0.24);
      backpack.add(coreEmber);
      const leftMajorBlade = buildContext.createMesh(new THREE.BoxGeometry(0.07, 0.65, 0.12), astralCyan, 'LeftMajorBlade');
      leftMajorBlade.position.set(0.30, 1.35, -0.24);
      leftMajorBlade.rotation.set(0.35, 0.15, -0.65);
      backpack.add(leftMajorBlade);
      const leftMinorBlade = buildContext.createMesh(new THREE.BoxGeometry(0.05, 0.42, 0.08), solarAmber, 'LeftMinorBlade');
      leftMinorBlade.position.set(0.36, 0.95, -0.22);
      leftMinorBlade.rotation.set(0.15, 0.1, -0.95);
      backpack.add(leftMinorBlade);
      const rightMajorBlade = buildContext.createMesh(new THREE.BoxGeometry(0.07, 0.65, 0.12), astralCyan, 'RightMajorBlade');
      rightMajorBlade.position.set(-0.30, 1.35, -0.24);
      rightMajorBlade.rotation.set(0.35, -0.15, 0.65);
      backpack.add(rightMajorBlade);
      const rightMinorBlade = buildContext.createMesh(new THREE.BoxGeometry(0.05, 0.42, 0.08), solarAmber, 'RightMinorBlade');
      rightMinorBlade.position.set(-0.36, 0.95, -0.22);
      rightMinorBlade.rotation.set(0.15, -0.1, 0.95);
      backpack.add(rightMinorBlade);
      return backpack;
    },
    decorateLeftArm: (buildContext, mesh) => {
      const pauldron = buildContext.createMesh(new THREE.BoxGeometry(0.34, 0.22, 0.34), obsidian, 'LeftPauldron');
      pauldron.position.set(0.04, 0.05, 0);
      mesh.add(pauldron);
      const crest = buildContext.createMesh(new THREE.BoxGeometry(0.10, 0.18, 0.36), solarGold, 'LeftPauldronCrest');
      crest.position.set(0.08, 0.14, 0);
      mesh.add(crest);
      const crystal = buildContext.createMesh(new THREE.BoxGeometry(0.08, 0.14, 0.12), astralCyan, 'LeftPauldronCrystal');
      crystal.position.set(0.12, 0.16, 0);
      mesh.add(crystal);
      const bladeFin = buildContext.createMesh(new THREE.BoxGeometry(0.04, 0.30, 0.16), astralCyan, 'ArmBladeFin');
      bladeFin.position.set(0.14, -0.32, -0.05);
      bladeFin.rotation.x = 0.25;
      mesh.add(bladeFin);
    },
    decorateRightArm: (buildContext, mesh) => {
      const guard = buildContext.createMesh(new THREE.BoxGeometry(0.30, 0.14, 0.30), solarGold, 'RightGuard');
      guard.position.set(-0.02, 0.04, 0);
      mesh.add(guard);
    },
    decorateLeg: (buildContext, mesh) => {
      const armor = buildContext.createMesh(new THREE.BoxGeometry(0.28, 0.16, 0.10), obsidian, 'KneeArmor');
      armor.position.set(0, -0.25, 0.11);
      mesh.add(armor);
      const star = buildContext.createMesh(new THREE.BoxGeometry(0.12, 0.10, 0.06), astralCyan, 'KneeStar');
      star.position.set(0, -0.25, 0.15);
      mesh.add(star);
    },
  };
}

export function createPlayerCharacterRig(
  id: PlayerCharacterId,
  context: PlayerCharacterRigBuildContext,
): PlayerCharacterRig {
  const appearance = createAppearance(id, context);
  const { materials } = appearance;

  const headMesh = context.createMesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    [materials.hair, materials.hair, materials.hair, materials.hair, materials.face, materials.hair],
    'HeadMesh',
  );
  headMesh.position.y = 0.25;
  appearance.decorateHead?.(context, headMesh);

  const hairBand = appearance.buildHeadAccessories(context);
  const headPivot = new THREE.Group();
  headPivot.name = 'HeadPivot';
  headPivot.position.set(0, 1.4, 0);
  headPivot.add(headMesh, hairBand);
  const eyeAnchor = new THREE.Object3D();
  eyeAnchor.name = 'EyeAnchor';
  eyeAnchor.position.set(0, context.eyeAnchorY, 0.26);
  headPivot.add(eyeAnchor);

  const torsoMesh = context.createMesh(
    new THREE.BoxGeometry(0.5, 0.75, 0.25),
    materials.torso,
    'TorsoMesh',
  );
  torsoMesh.position.set(0, 1.025, 0);
  appearance.decorateTorso?.(context, torsoMesh);
  const backpack = appearance.buildBackpack(context);

  const leftArmMesh = context.createMesh(
    new THREE.BoxGeometry(0.25, 0.75, 0.25),
    materials.arm,
    'LeftArmMesh',
  );
  leftArmMesh.position.y = -0.275;
  appearance.decorateLeftArm(context, leftArmMesh);
  const leftArm = new THREE.Group();
  leftArm.name = 'LeftArmPivot';
  leftArm.position.set(0.375, 1.35, 0);
  leftArm.add(leftArmMesh);

  const rightArmMesh = context.createMesh(
    new THREE.BoxGeometry(0.25, 0.75, 0.25),
    materials.arm,
    'RightArmMesh',
  );
  rightArmMesh.position.y = -0.275;
  appearance.decorateRightArm(context, rightArmMesh);
  const pickaxe = context.createPickaxe();
  pickaxe.position.set(0, -0.28, 0.1);
  pickaxe.rotation.x = THREE.MathUtils.degToRad(30);
  rightArmMesh.add(pickaxe);
  const rightArm = new THREE.Group();
  rightArm.name = 'RightArmPivot';
  rightArm.position.set(-0.375, 1.35, 0);
  rightArm.add(rightArmMesh);

  const leftLegMesh = context.createMesh(
    new THREE.BoxGeometry(0.25, LEG_LENGTH, 0.25),
    materials.pants,
    'LeftLegMesh',
  );
  leftLegMesh.position.y = -LEG_LENGTH / 2;
  appearance.decorateLeg(context, leftLegMesh);
  appearance.decorateLeftLeg?.(context, leftLegMesh);
  const leftLeg = new THREE.Group();
  leftLeg.name = 'LeftLegPivot';
  leftLeg.position.set(0.13, LEG_PIVOT_Y, 0);
  leftLeg.add(leftLegMesh);

  const rightLegMesh = context.createMesh(
    new THREE.BoxGeometry(0.25, LEG_LENGTH, 0.25),
    materials.pants,
    'RightLegMesh',
  );
  rightLegMesh.position.y = -LEG_LENGTH / 2;
  appearance.decorateLeg(context, rightLegMesh);
  appearance.decorateRightLeg?.(context, rightLegMesh);
  const rightLeg = new THREE.Group();
  rightLeg.name = 'RightLegPivot';
  rightLeg.position.set(-0.13, LEG_PIVOT_Y, 0);
  rightLeg.add(rightLegMesh);

  const body = new THREE.Group();
  body.name = 'PlayerCharacter.Body';
  body.add(headPivot, torsoMesh, backpack, leftArm, rightArm, leftLeg, rightLeg);
  body.rotation.y = Math.PI;

  return {
    body,
    headPivot,
    eyeAnchor,
    headMesh,
    hairBand,
    torsoMesh,
    backpack,
    leftArm,
    leftArmMesh,
    rightArm,
    rightArmMesh,
    leftLeg,
    rightLeg,
    pickaxe,
  };
}
