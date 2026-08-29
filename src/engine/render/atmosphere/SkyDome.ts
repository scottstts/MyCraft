import * as THREE from 'three';
import type { AtmosphereState } from './AtmosphereModel';
import { RENDER_STYLE } from '../settings/RenderStyle';

/**
 * Ground-scale analytic sky. The shader intentionally stays scene-linear;
 * OutputPass owns tone mapping and display color conversion later in the
 * composer. Sky and aerial perspective receive the same AtmosphereState.
 */
export class SkyDome {
  readonly sky: THREE.Mesh;
  readonly sun = new THREE.Vector3(0, 1, 0);
  private readonly material: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    const geometry = new THREE.SphereGeometry(1, 64, 32);
    this.material = new THREE.ShaderMaterial({
      name: 'MyCraftAnalyticSky',
      toneMapped: false,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        sunDirection: { value: this.sun.clone() },
        sunColor: { value: new THREE.Color(1, 1, 1) },
        sunIntensity: { value: 1.35 },
        sunTransmittance: { value: new THREE.Color(1, 1, 1) },
        skyZenith: { value: new THREE.Color(0.04, 0.16, 0.42) },
        skyHorizon: { value: new THREE.Color(0.34, 0.50, 0.70) },
        skyAerosol: { value: new THREE.Color(0.36, 0.43, 0.52) },
        skyAerosolStrength: { value: 0.14 },
        skyRadianceScale: { value: 1.25 },
        moonDirection: { value: new THREE.Vector3(0, -1, 0) },
        moonColor: { value: new THREE.Color(0.56, 0.66, 0.9) },
        moonIntensity: { value: 0 },
        starVisibility: { value: 0 },
        rayleighCoefficient: { value: 0.055 },
        mieCoefficient: { value: 0.018 },
        mieDirectionalG: { value: 0.76 },
        sunAngularRadius: { value: 0.004675 },
      },
      vertexShader: `
        varying vec3 vSkyDirection;
        void main() {
          vSkyDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vSkyDirection;
        uniform vec3 sunDirection;
        uniform vec3 sunColor;
        uniform float sunIntensity;
        uniform vec3 sunTransmittance;
        uniform vec3 skyZenith;
        uniform vec3 skyHorizon;
        uniform vec3 skyAerosol;
        uniform float skyAerosolStrength;
        uniform float skyRadianceScale;
        uniform vec3 moonDirection;
        uniform vec3 moonColor;
        uniform float moonIntensity;
        uniform float starVisibility;
        uniform float rayleighCoefficient;
        uniform float mieCoefficient;
        uniform float mieDirectionalG;
        uniform float sunAngularRadius;

        const float PI = 3.14159265359;

        float rayleighPhase(float cosTheta) {
          return 3.0 / (16.0 * PI) * (1.0 + cosTheta * cosTheta);
        }

        float miePhase(float cosTheta, float g) {
          float g2 = g * g;
          float denominator = pow(max(1.0 + g2 - 2.0 * g * cosTheta, 0.001), 1.5);
          return (1.0 - g2) / (4.0 * PI * denominator);
        }

        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        float stars(vec3 direction) {
          vec2 spherical = vec2(
            atan(direction.z, direction.x) / (2.0 * PI) + 0.5,
            acos(clamp(direction.y, -1.0, 1.0)) / PI
          );
          vec2 cellUv = spherical * vec2(220.0, 110.0);
          vec2 cell = floor(cellUv);
          vec2 local = fract(cellUv) - 0.5;
          float seed = hash12(cell);
          float visible = step(0.985, seed);
          vec2 offset = vec2(hash12(cell + 11.7), hash12(cell + 37.2)) - 0.5;
          float radius = mix(0.035, 0.09, hash12(cell + 61.4));
          float point = 1.0 - smoothstep(0.0, radius, length(local - offset * 0.72));
          float latitude = smoothstep(0.02, 0.20, direction.y);
          return point * visible * latitude * mix(0.55, 1.5, hash12(cell + 5.1));
        }

        void main() {
          vec3 direction = normalize(vSkyDirection);
          // Keep the lower hemisphere on one bounded sea-level tint. A full
          // -1..1 gradient makes the underside of the dome read as a second
          // painted sky and leaves a hard horizon when the camera crests a
          // ridge. The asymmetric shoulders mirror a real marine aerosol band.
          float up = max(direction.y, 0.0);
          float horizon = 1.0 - pow(up, 0.48);
          float cosSun = dot(direction, normalize(sunDirection));
          float cosMoon = dot(direction, normalize(moonDirection));

          vec3 gradient = mix(skyHorizon, skyZenith, 1.0 - horizon);
          // The camera can look below the terrain horizon in the open-world
          // view. Blend the underside over a wide angular shoulder so it
          // reads as the same distant marine air mass instead of a second
          // flat sky plane at y=0.
          vec3 seaMist = mix(skyAerosol, skyHorizon, 0.58);
          vec3 base = mix(seaMist, gradient, smoothstep(-0.38, 0.14, direction.y));
          float aerosol = smoothstep(-0.18, 0.0, direction.y)
            * (1.0 - smoothstep(0.0, 0.30, direction.y))
            * skyAerosolStrength;
          base = mix(base, skyAerosol, aerosol);

          // Rayleigh/Mie are retained as the sun-facing lift only. The old
          // broad contribution was bright enough to erase the authored
          // zenith-to-horizon gradient at noon; SeaPark's above-sea look is a
          // useful reminder that the haze must be carried by the base field.
          float viewRayleighDepth = mix(0.62, 1.35, horizon);
          float viewMieDepth = mix(0.08, 0.72, horizon);
          float rayleigh = rayleighPhase(cosSun) * rayleighCoefficient * viewRayleighDepth;
          float mie = miePhase(cosSun, mieDirectionalG) * mieCoefficient * viewMieDepth;
          vec3 scatteredSun = sunColor * sunTransmittance * sunIntensity * (rayleigh * 0.55 + mie * 0.70);

          float sunElevation = normalize(sunDirection).y;
          float sunVisibility = smoothstep(-0.14, 0.02, sunElevation);
          float sunEnergy = sunVisibility * mix(0.18, 1.0, smoothstep(-0.02, 0.30, sunElevation));
          float sunAmount = max(cosSun, 0.0);

          // The 0.53° disc uses the same stable x² form as a measured solar
          // profile. Its core is bright enough to bloom, while the three-lobe
          // aureole seats it in the atmosphere instead of pasting on a circle.
          float discCos = cos(sunAngularRadius);
          float x2 = clamp((1.0 - sunAmount) / max(1e-5, 1.0 - discCos), 0.0, 4.0);
          float inDisc = 1.0 - smoothstep(0.90, 1.0, x2);
          float mu = sqrt(max(0.0, 1.0 - x2));
          float limb = 0.30 + 0.93 * mu - 0.23 * mu * mu;
          float disc = inDisc * limb;
          float aureole = pow(sunAmount, 3000.0) * 20.0
            + pow(sunAmount, 260.0) * 1.7
            + pow(sunAmount, 18.0) * 0.16;
          vec3 solarDisc = sunColor * sunTransmittance * sunEnergy * (disc * 70.0 + aureole);

          // Low sun adds a thin, directional warm airlight band rather than
          // tinting the whole frame orange. This is the horizon cue that keeps
          // sunrise/sunset continuous with the daytime sky.
          float lowSun = sunVisibility * (1.0 - smoothstep(0.05, 0.35, sunElevation));
          float horizonBand = exp(-abs(direction.y) * 9.0);
          vec3 lowSunGlow = sunColor * (pow(sunAmount, 8.0) * 0.08 + horizonBand * lowSun * 0.05);

          // A cool lunar disc is deliberately much weaker than the sun and
          // disappears continuously through the bright twilight band.
          float moonDisc = smoothstep(cos(0.0045 * 1.8), cos(0.0045 * 0.42), cosMoon);
          vec3 moon = moonColor * moonIntensity * moonDisc * 0.65;
          vec3 starLight = vec3(stars(direction) * starVisibility * 0.16);

          vec3 color = max(base * skyRadianceScale + scatteredSun + solarDisc + lowSunGlow + moon + starLight, vec3(0.0));
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });

    this.sky = new THREE.Mesh(geometry, this.material);
    this.sky.name = 'AtmosphereSkyDome';
    // The dome follows the camera, so keep it inside the gameplay far clip
    // plane instead of relying on an enormous world-centered sphere that would
    // be clipped before it can contribute a background pixel.
    this.sky.scale.setScalar(1000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);
  }

  setSunDirection(direction: THREE.Vector3): void {
    this.sun.copy(direction).normalize();
    (this.material.uniforms.sunDirection.value as THREE.Vector3).copy(this.sun);
  }

  setCameraPosition(position: THREE.Vector3): void {
    this.sky.position.copy(position);
  }

  setAtmosphereState(state: AtmosphereState): void {
    this.setSunDirection(state.sunDirection);
    (this.material.uniforms.sunColor.value as THREE.Color).copy(state.sunColor);
    this.material.uniforms.sunIntensity.value = state.sunIntensity;
    (this.material.uniforms.sunTransmittance.value as THREE.Color).copy(state.sunTransmittance);
    (this.material.uniforms.skyZenith.value as THREE.Color).copy(state.skyZenith);
    (this.material.uniforms.skyHorizon.value as THREE.Color).copy(state.skyHorizon);
    (this.material.uniforms.skyAerosol.value as THREE.Color).copy(state.skyAerosol);
    this.material.uniforms.skyAerosolStrength.value = state.skyAerosolStrength;
    this.material.uniforms.skyRadianceScale.value = RENDER_STYLE.atmosphere.skyRadianceScale;
    (this.material.uniforms.moonDirection.value as THREE.Vector3).copy(state.moonDirection);
    (this.material.uniforms.moonColor.value as THREE.Color).copy(state.moonColor);
    this.material.uniforms.moonIntensity.value = state.moonIntensity;
    this.material.uniforms.starVisibility.value = state.starVisibility;
    this.material.uniforms.rayleighCoefficient.value = state.rayleighCoefficient;
    this.material.uniforms.mieCoefficient.value = state.mieCoefficient;
    this.material.uniforms.mieDirectionalG.value = state.mieDirectionalG;
  }

  dispose(): void {
    this.sky.parent?.remove(this.sky);
    this.sky.geometry.dispose();
    this.material.dispose();
  }
}
