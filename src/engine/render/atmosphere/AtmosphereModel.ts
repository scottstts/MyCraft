import * as THREE from 'three';
import { RENDER_STYLE } from '../settings/RenderStyle';

export interface AtmosphereState {
  sunDirection: THREE.Vector3;
  sunElevation: number;
  daylight: number;
  twilight: number;
  night: number;
  sunColor: THREE.Color;
  sunTransmittance: THREE.Color;
  sunIntensity: number;
  skyZenith: THREE.Color;
  skyHorizon: THREE.Color;
  skyAerosol: THREE.Color;
  skyAerosolStrength: number;
  skyIrradiance: THREE.Color;
  nightTint: THREE.Color;
  starVisibility: number;
  moonDirection: THREE.Vector3;
  moonColor: THREE.Color;
  moonIntensity: number;
  rayleighScaleHeight: number;
  mieScaleHeight: number;
  rayleighCoefficient: number;
  mieCoefficient: number;
  mieDirectionalG: number;
  absorptionCoefficient: number;
}

const WARM_SUN = new THREE.Color(1.0, 0.39, 0.08);
const MID_SUN = new THREE.Color(1.0, 0.82, 0.54);
const DAY_SUN = new THREE.Color(1.0, 0.97, 0.91);
const NIGHT_TINT = new THREE.Color(0.34, 0.42, 0.68);
const MOON_COLOR = new THREE.Color(0.56, 0.66, 0.9);

// Values are scene-linear (not display/sRGB values). The zenith is kept
// substantially deeper than the horizon so midday does not collapse into a
// gray-white wash after the shared output transform.
const DAY_ZENITH = new THREE.Color(0.04, 0.16, 0.42);
const DAY_HORIZON = new THREE.Color(0.34, 0.50, 0.70);
const NIGHT_ZENITH = new THREE.Color(0.002, 0.006, 0.022);
const NIGHT_HORIZON = new THREE.Color(0.012, 0.026, 0.075);
const TWILIGHT_ZENITH = new THREE.Color(0.018, 0.035, 0.11);
const TWILIGHT_HORIZON = new THREE.Color(0.16, 0.045, 0.025);
const WARM_HORIZON = new THREE.Color(0.45, 0.08, 0.012);
const DAY_AEROSOL = new THREE.Color(0.36, 0.43, 0.52);
const TWILIGHT_AEROSOL = new THREE.Color(0.22, 0.09, 0.10);
const NIGHT_AEROSOL = new THREE.Color(0.008, 0.018, 0.045);
const NIGHT_IRRADIANCE = new THREE.Color(0.006, 0.012, 0.032);

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / Math.max(1e-5, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Ground-scale atmosphere evaluation shared by the sky, surface aerial
 * perspective, direct sun, ambient materials, and water reflections.
 * Values are scene-linear and deliberately remain below display white except
 * for the solar disc and intentional specular highlights.
 */
export class AtmosphereModel {
  readonly state: AtmosphereState = {
    sunDirection: new THREE.Vector3(0, 1, 0),
    sunElevation: Math.PI / 2,
    daylight: 1,
    twilight: 0,
    night: 0,
    sunColor: DAY_SUN.clone(),
    sunTransmittance: DAY_SUN.clone(),
    sunIntensity: 1.35,
    skyZenith: DAY_ZENITH.clone(),
    skyHorizon: DAY_HORIZON.clone(),
    skyAerosol: DAY_AEROSOL.clone(),
    skyAerosolStrength: RENDER_STYLE.atmosphere.aerosolStrength,
    skyIrradiance: new THREE.Color(0.12, 0.18, 0.32),
    nightTint: NIGHT_TINT.clone(),
    starVisibility: 0,
    moonDirection: new THREE.Vector3(0, -1, 0),
    moonColor: MOON_COLOR.clone(),
    moonIntensity: 0,
    rayleighScaleHeight: RENDER_STYLE.atmosphere.rayleighScaleHeight,
    mieScaleHeight: RENDER_STYLE.atmosphere.mieScaleHeight,
    rayleighCoefficient: RENDER_STYLE.atmosphere.rayleighCoefficient,
    mieCoefficient: RENDER_STYLE.atmosphere.mieCoefficient,
    mieDirectionalG: RENDER_STYLE.atmosphere.mieDirectionalG,
    absorptionCoefficient: RENDER_STYLE.atmosphere.absorptionCoefficient,
  };

  evaluate(sunDirection: THREE.Vector3): AtmosphereState {
    const s = this.state;
    s.sunDirection.copy(sunDirection).normalize();
    s.sunElevation = Math.asin(THREE.MathUtils.clamp(s.sunDirection.y, -1, 1));

    const y = s.sunDirection.y;
    s.daylight = smoothstep(-0.11, 0.07, y);
    // Twilight is a finite transition band around the horizon. It must go
    // back to zero in full night so the midnight sky does not retain a red
    // sunset wash.
    s.twilight = smoothstep(-0.18, 0.02, y) * (1 - smoothstep(0.03, 0.18, y));
    s.night = 1 - smoothstep(-0.09, 0.035, y);

    const warm = (1 - smoothstep(0.04, 0.32, y)) * smoothstep(-0.12, 0.06, y);
    s.sunTransmittance.copy(WARM_SUN).lerp(MID_SUN, smoothstep(-0.03, 0.12, y));
    s.sunTransmittance.lerp(DAY_SUN, smoothstep(0.12, 0.42, y));
    s.sunColor.copy(s.sunTransmittance);
    // Sun intensity goes to zero at the geometric horizon so twilight does
    // not look like a white directional-light cutout.
    s.sunIntensity = THREE.MathUtils.lerp(0.0, 1.35, smoothstep(0.015, 0.28, y));

    s.skyZenith.copy(NIGHT_ZENITH).lerp(DAY_ZENITH, s.daylight);
    s.skyZenith.lerp(TWILIGHT_ZENITH, s.twilight * 0.48);
    s.skyHorizon.copy(NIGHT_HORIZON).lerp(DAY_HORIZON, s.daylight);
    s.skyHorizon.lerp(TWILIGHT_HORIZON, s.twilight * 0.72);
    s.skyHorizon.lerp(WARM_HORIZON, warm * 0.62);

    s.skyAerosol.copy(NIGHT_AEROSOL).lerp(DAY_AEROSOL, s.daylight);
    s.skyAerosol.lerp(TWILIGHT_AEROSOL, s.twilight * 0.7);
    // Keep a very small nocturnal airlight floor so the horizon never snaps
    // to an opaque black band as the sun crosses the geometric horizon.
    s.skyAerosolStrength = THREE.MathUtils.clamp(
      0.018 + RENDER_STYLE.atmosphere.aerosolStrength * s.daylight + 0.045 * s.twilight,
      0.0,
      0.22,
    );

    s.skyIrradiance.copy(s.skyHorizon).multiplyScalar(0.20).lerp(s.skyAerosol, 0.18).lerp(s.skyZenith, 0.28);
    s.skyIrradiance.lerp(NIGHT_IRRADIANCE, s.night);
    s.nightTint.copy(NIGHT_TINT);

    s.starVisibility = 1 - smoothstep(-0.085, 0.045, y);
    s.moonDirection.copy(s.sunDirection).multiplyScalar(-1);
    s.moonIntensity = s.starVisibility * 0.14;
    s.moonColor.copy(MOON_COLOR);
    return s;
  }
}
