export const FILMIC_FLARE_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const LENS_UNIFORMS = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tOcclusion;
  uniform vec2 resolution;
  uniform float aspect;
  uniform vec2 sourceTop;
  uniform float sourceVisibility;
  uniform float fieldCos;
  uniform float fieldSin;
  uniform vec2 fieldDirection;
  uniform float strength;
  uniform float effectMix;
  varying vec2 vUv;
`

const LENS_MATH = /* glsl */ `
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

  vec2 topUv() {
    return vec2(vUv.x, 1.0 - vUv.y);
  }

  float insideFrame(vec2 suv) {
    return step(0.0, suv.x) * step(suv.x, 1.0)
      * step(0.0, suv.y) * step(suv.y, 1.0);
  }

  vec3 samplePlate(vec2 suv) {
    vec2 bounded = clamp(suv, vec2(0.0), vec2(1.0));
    return texture2D(tDiffuse, vec2(bounded.x, 1.0 - bounded.y)).rgb;
  }

  vec3 sampleHotPlate(vec2 suv) {
    return samplePlate(suv) * insideFrame(suv);
  }

  float effectiveVisibility() {
    return sourceVisibility * texture2D(tOcclusion, vec2(0.5)).r;
  }

  float bloomVisibility() {
    return sourceVisibility * texture2D(tOcclusion, vec2(0.5)).g;
  }

  float gaussian(float x, float falloff) {
    return exp(-x * x * falloff);
  }

  float ellipse(vec2 suv, vec2 center, float rx, float ry) {
    float dx = (suv.x - center.x) * aspect / rx;
    float dy = (suv.y - center.y) / ry;
    return exp(-(dx * dx + dy * dy));
  }

  vec2 ghostPos(float t) {
    return mix(sourceTop, vec2(0.5), t);
  }

  vec2 opticalAxis() {
    vec2 raw = vec2((0.5 - sourceTop.x) * aspect, 0.5 - sourceTop.y);
    return raw / max(length(raw), 1e-5);
  }

  float orientedEllipse(
    vec2 suv,
    vec2 center,
    vec2 radialDir,
    float radialRadius,
    float tangentRadius
  ) {
    vec2 tangent = vec2(-radialDir.y, radialDir.x);
    vec2 rel = vec2((suv.x - center.x) * aspect, suv.y - center.y);
    float qr = dot(rel, radialDir) / radialRadius;
    float qt = dot(rel, tangent) / tangentRadius;
    return exp(-(qr * qr + qt * qt));
  }

  float orientedRing(
    vec2 suv,
    vec2 center,
    vec2 radialDir,
    float radialRadius,
    float tangentRadius,
    float width
  ) {
    vec2 tangent = vec2(-radialDir.y, radialDir.x);
    vec2 rel = vec2((suv.x - center.x) * aspect, suv.y - center.y);
    float qr = dot(rel, radialDir) / radialRadius;
    float qt = dot(rel, tangent) / tangentRadius;
    float e = (length(vec2(qr, qt)) - 1.0) / width;
    return exp(-e * e);
  }

  float fieldPupilEllipse(vec2 suv, vec2 center, vec2 radialDir, float baseRadius) {
    float projectedRadial = baseRadius * max(fieldCos, 0.34);
    return orientedEllipse(suv, center, radialDir, projectedRadial, baseRadius);
  }

  float fieldPupilRing(
    vec2 suv,
    vec2 center,
    vec2 radialDir,
    float baseRadius,
    float width
  ) {
    float projectedRadial = baseRadius * max(fieldCos, 0.34);
    return orientedRing(suv, center, radialDir, projectedRadial, baseRadius, width);
  }

  float axisEllipse(vec2 suv, vec2 center, float longRadius, float shortRadius) {
    vec2 axis = opticalAxis();
    vec2 rel = vec2((suv.x - center.x) * aspect, suv.y - center.y);
    float alongRaw = dot(rel, axis);
    float along = alongRaw / longRadius;
    float across = length(rel - axis * alongRaw) / shortRadius;
    return exp(-(along * along + across * across));
  }

  float hotAt(vec2 suv) {
    vec3 color = sampleHotPlate(suv);
    float luma = dot(color, LUMA);
    float gate = smoothstep(4.0, 18.0, luma);
    return gate * (clamp(luma / 14.0, 0.0, 4.0) + 0.18);
  }

  vec2 radialWarpUv(vec2 suv, float scale) {
    return vec2(
      0.5 + (suv.x - 0.5) / scale,
      0.5 + (suv.y - 0.5) / scale
    );
  }

  vec3 radialGhostRgb(vec2 suv, float scale, float dispersion) {
    return vec3(
      hotAt(radialWarpUv(suv, scale - dispersion)),
      hotAt(radialWarpUv(suv, scale)),
      hotAt(radialWarpUv(suv, scale + dispersion))
    );
  }

  vec3 preparedPlate(vec2 suv, out float rawLuma) {
    vec2 fromCenter = suv - 0.5;
    float edge = clamp(dot(fromCenter, fromCenter) * 1.55, 0.0, 1.0);
    vec2 ca = fromCenter * edge * 0.00042;

    vec3 plate = max(vec3(
      samplePlate(suv + ca).r,
      samplePlate(suv).g,
      samplePlate(suv - ca).b
    ), vec3(0.0)) * 0.79;

    rawLuma = dot(plate, LUMA);
    plate = mix(vec3(rawLuma), plate, 0.92);
    return plate * vec3(1.070, 0.985, 0.900);
  }
`

const FLARE_LAYER = /* glsl */ `
  vec3 flareLayer(vec2 suv) {
    vec2 center = vec2(0.5);
    vec2 p = vec2((suv.x - sourceTop.x) * aspect, suv.y - sourceTop.y);
    float d = length(p);
    vec2 radialDir = fieldDirection;

    float core = gaussian(d, 820.0) * 9.4;
    float nearGlow = gaussian(d, 92.0) * 2.20;
    float midGlow = gaussian(d, 22.0) * 0.96;
    float wideGlow = gaussian(d, 5.8) * 0.36;

    float inwardVeil = axisEllipse(suv, mix(sourceTop, center, 0.34), 0.72, 0.27) * 0.52;
    float sourceWash = ellipse(suv, mix(sourceTop, center, 0.19), 0.62, 0.44) * 0.32;
    float amberFog = ellipse(
      suv,
      mix(sourceTop, center, 0.42) + vec2(-0.035, 0.010),
      0.68,
      0.31
    ) * 0.19;
    float redVeil = ellipse(
      suv,
      mix(sourceTop, center, 0.47) + vec2(-0.060, -0.010),
      0.54,
      0.24
    ) * 0.115;

    vec3 flare = vec3(1.00, 0.90, 0.72) * core
      + vec3(1.00, 0.42, 0.075) * nearGlow
      + vec3(1.00, 0.24, 0.030) * midGlow
      + vec3(1.00, 0.13, 0.015) * wideGlow
      + vec3(1.00, 0.28, 0.045) * inwardVeil
      + vec3(1.00, 0.22, 0.030) * sourceWash
      + vec3(0.92, 0.20, 0.025) * amberFog
      + vec3(0.62, 0.045, 0.025) * redVeil;

    flare += radialGhostRgb(suv, -1.05, 0.010) * vec3(0.090, 0.078, 0.082);
    flare += radialGhostRgb(suv, -0.73, 0.007) * vec3(0.075, 0.068, 0.074);
    flare += radialGhostRgb(suv, -0.50, 0.0045) * vec3(0.055, 0.052, 0.060);
    flare += radialGhostRgb(suv, -0.31, 0.0030) * vec3(0.038, 0.036, 0.043);

    vec2 gTerminalA = ghostPos(2.12);
    vec2 gTerminalB = ghostPos(2.28);
    vec2 gCool = ghostPos(1.84);
    vec2 gWarm0 = ghostPos(1.62);
    vec2 gWarm1 = ghostPos(1.48);
    vec2 gBead0 = ghostPos(1.34);
    vec2 gBead1 = ghostPos(1.23);
    vec2 gBead2 = ghostPos(1.15);
    vec2 gBead3 = ghostPos(1.08);
    vec2 gBead4 = ghostPos(1.03);

    float terminalAOuter = fieldPupilEllipse(suv, gTerminalA, radialDir, 0.086);
    float terminalAInner = fieldPupilEllipse(suv, gTerminalA, radialDir, 0.052);
    float terminalAHalo = fieldPupilEllipse(suv, gTerminalA, radialDir, 0.132);
    float terminalBOuter = fieldPupilEllipse(suv, gTerminalB, radialDir, 0.102);
    float terminalBInner = fieldPupilEllipse(suv, gTerminalB, radialDir, 0.064);
    float terminalBHalo = fieldPupilEllipse(suv, gTerminalB, radialDir, 0.154);

    float coolCore = fieldPupilEllipse(suv, gCool, radialDir, 0.047);
    float coolShell = fieldPupilRing(suv, gCool, radialDir, 0.059, 0.22);
    float coolLeak = fieldPupilEllipse(suv, gCool, radialDir, 0.067);
    float coolHalo = fieldPupilEllipse(suv, gCool, radialDir, 0.104);

    float warm0Outer = fieldPupilEllipse(suv, gWarm0, radialDir, 0.058);
    float warm0Inner = fieldPupilEllipse(suv, gWarm0, radialDir, 0.037);
    float warm0Halo = fieldPupilEllipse(suv, gWarm0, radialDir, 0.094);
    float warm1 = fieldPupilEllipse(suv, gWarm1, radialDir, 0.027);
    float warm1Halo = fieldPupilEllipse(suv, gWarm1, radialDir, 0.052);

    float bead0 = fieldPupilEllipse(suv, gBead0, radialDir, 0.0078);
    float bead1 = fieldPupilEllipse(suv, gBead1, radialDir, 0.0062);
    float bead2 = fieldPupilEllipse(suv, gBead2, radialDir, 0.0049);
    float bead3 = fieldPupilEllipse(suv, gBead3, radialDir, 0.0036);
    float bead4 = fieldPupilEllipse(suv, gBead4, radialDir, 0.0026);

    float residualHaze = axisEllipse(suv, ghostPos(2.34), 0.24, 0.026) * 0.62
      + axisEllipse(suv, ghostPos(2.18), 0.16, 0.035) * 0.38;

    flare += vec3(1.00, 0.18, 0.030) * terminalAOuter * 0.27;
    flare += vec3(1.00, 0.46, 0.17) * terminalAInner * 0.62;
    flare += vec3(1.00, 0.31, 0.10) * terminalAHalo * 0.075;
    flare += vec3(1.00, 0.28, 0.085) * terminalBOuter * 0.074;
    flare += vec3(1.00, 0.54, 0.23) * terminalBInner * 0.032;
    flare += vec3(1.00, 0.34, 0.12) * terminalBHalo * 0.024;

    flare += vec3(0.53, 0.67, 1.00) * coolCore * 0.52;
    flare += vec3(0.21, 0.54, 0.92) * coolShell * 0.21;
    flare += vec3(1.00, 0.54, 0.22) * coolLeak * 0.066;
    flare += vec3(0.28, 0.48, 0.92) * coolHalo * 0.052;

    flare += vec3(1.00, 0.35, 0.14) * warm0Outer * 0.31;
    flare += vec3(1.00, 0.67, 0.40) * warm0Inner * 0.43;
    flare += vec3(1.00, 0.42, 0.16) * warm0Halo * 0.070;
    flare += vec3(1.00, 0.84, 0.56) * warm1 * 0.35;
    flare += vec3(1.00, 0.58, 0.30) * warm1Halo * 0.045;

    flare += vec3(1.00, 0.74, 0.42) * bead0 * 0.27;
    flare += vec3(1.00, 0.52, 0.18) * bead1 * 0.21;
    flare += vec3(1.00, 0.82, 0.60) * bead2 * 0.15;
    flare += vec3(0.98, 0.84, 0.74) * bead3 * 0.095;
    flare += vec3(1.00, 0.58, 0.28) * bead4 * 0.052;
    flare += vec3(1.00, 0.48, 0.16) * residualHaze * 0.036;

    vec2 ringCenter = ghostPos(1.62);
    float spectralSpread = fieldSin * 0.0075;
    float redRadius = 0.056 + spectralSpread;
    float greenRadius = 0.056;
    float blueRadius = max(0.043, 0.056 - spectralSpread);

    float redRing = fieldPupilRing(suv, ringCenter, radialDir, redRadius, 0.180);
    float greenRing = fieldPupilRing(suv, ringCenter, radialDir, greenRadius, 0.168);
    float blueRing = fieldPupilRing(suv, ringCenter, radialDir, blueRadius, 0.185);
    float ringCore = fieldPupilEllipse(suv, ringCenter, radialDir, 0.033);

    float ringOutside = max(
      max(-ringCenter.x, ringCenter.x - 1.0),
      max(-ringCenter.y, ringCenter.y - 1.0)
    );
    float ringFrameGate = 1.0 - smoothstep(0.02, 0.18, ringOutside);
    float ringGate = effectiveVisibility() * ringFrameGate;

    flare += vec3(1.00, 0.10, 0.015) * redRing * 0.080 * ringGate;
    flare += vec3(0.20, 0.52, 0.075) * greenRing * 0.044 * ringGate;
    flare += vec3(0.15, 0.22, 0.92) * blueRing * 0.052 * ringGate;
    flare += vec3(0.22, 0.08, 0.30) * ringCore * 0.018 * ringGate;

    float sourceFrameMargin = min(
      min(sourceTop.x, sourceTop.y),
      min(1.0 - sourceTop.x, 1.0 - sourceTop.y)
    );
    float starEdgeGate = smoothstep(0.01, 0.07, sourceFrameMargin) * 0.80 + 0.20;

    float hRay = gaussian(abs(p.y), 56000.0) * gaussian(abs(p.x), 11.5);
    float vRay = gaussian(abs(p.x), 78000.0) * gaussian(abs(p.y), 18.0);

    float d1Along = p.x * 0.70710678 + p.y * 0.70710678;
    float d1Perp = p.y * 0.70710678 - p.x * 0.70710678;
    float d2Along = p.x * 0.70710678 - p.y * 0.70710678;
    float d2Perp = p.y * 0.70710678 + p.x * 0.70710678;
    float d1Ray = gaussian(abs(d1Perp), 42000.0) * gaussian(abs(d1Along), 14.0);
    float d2Ray = gaussian(abs(d2Perp), 42000.0) * gaussian(abs(d2Along), 14.0);

    float s1Along = p.x * 0.93969262 + p.y * 0.34202014;
    float s1Perp = p.y * 0.93969262 - p.x * 0.34202014;
    float s2Along = p.x * 0.93969262 - p.y * 0.34202014;
    float s2Perp = p.y * 0.93969262 + p.x * 0.34202014;
    float s1Ray = gaussian(abs(s1Perp), 36000.0) * gaussian(abs(s1Along), 22.0);
    float s2Ray = gaussian(abs(s2Perp), 36000.0) * gaussian(abs(s2Along), 22.0);

    vec3 whiteStar = vec3(1.00, 0.97, 0.92) * (
      hRay * 0.28 + vRay * 0.22 + d1Ray * 0.18 + d2Ray * 0.18
      + s1Ray * 0.07 + s2Ray * 0.07
    );
    vec3 warmStar = vec3(1.00, 0.78, 0.50) * ((d1Ray + d2Ray) * 0.11 + vRay * 0.05);
    vec3 fringeStar = vec3(1.00, 0.56, 0.82) * hRay * 0.09
      + vec3(0.52, 0.86, 0.72) * vRay * 0.03;
    flare += (whiteStar + warmStar + fringeStar) * 0.34 * starEdgeGate;

    return flare * strength * effectiveVisibility() * effectMix;
  }
`

export const FILMIC_FLARE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  ${LENS_UNIFORMS}
  ${LENS_MATH}
  ${FLARE_LAYER}

  void main() {
    gl_FragColor = vec4(flareLayer(topUv()), 1.0);
  }
`

export const FILMIC_FLARE_SEED_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  ${LENS_UNIFORMS}
  uniform int seedMode;
  uniform float bloomThreshold;
  ${LENS_MATH}

  void main() {
    vec2 suv = topUv();
    float rawLuma;
    vec3 plate = preparedPlate(suv, rawLuma);
    vec2 sourceDelta = vec2((suv.x - sourceTop.x) * aspect, suv.y - sourceTop.y);
    float sourceWindow = gaussian(length(sourceDelta), 11.0) * bloomVisibility();

    vec3 seed;
    if (seedMode == 0) {
      float hotMask = smoothstep(2.9, 10.5, rawLuma) * sourceWindow;
      seed = clamp(plate, 0.0, 28.0) * hotMask;
    } else {
      float haloMask = smoothstep(1.8, 6.1, rawLuma) * sourceWindow;
      seed = clamp(plate, 0.0, 18.0) * haloMask * vec3(1.0, 0.30, 0.055);
    }

    float highPass = smoothstep(bloomThreshold, bloomThreshold + 0.01, dot(seed, LUMA));
    gl_FragColor = vec4(seed * highPass, 1.0);
  }
`

export const FILMIC_FLARE_OCCLUSION_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform sampler2D tDepth;
  uniform vec2 resolution;
  uniform vec2 sourceTop;
  uniform float solarDiscRadiusUv;

  float skyAt(vec2 sourceUv, vec2 offset) {
    float rawDepth = texture2D(tDepth, clamp(sourceUv + offset, vec2(0.0), vec2(1.0))).r;
    return step(0.99999, rawDepth);
  }

  void main() {
    if (sourceTop.x < 0.0 || sourceTop.x > 1.0 || sourceTop.y < 0.0 || sourceTop.y > 1.0) {
      gl_FragColor = vec4(1.0);
      return;
    }

    vec2 sourceUv = vec2(sourceTop.x, 1.0 - sourceTop.y);
    vec2 ringAspect = vec2(1.0 / max(resolution.x / resolution.y, 1e-5), 1.0);
    float discInner = 0.0;
    float discOuter = 0.0;
    float inner = 0.0;
    float middle = 0.0;
    float outer = 0.0;
    for (int i = 0; i < 16; i++) {
      float angle = float(i) * 0.3926990817;
      vec2 direction = vec2(cos(angle), sin(angle)) * ringAspect;

      // Integrate the finite 0.53-degree solar disc. Partial coverage now
      // produces a continuous visible fraction as an occluder edge crosses.
      discInner += skyAt(sourceUv, direction * solarDiscRadiusUv * 0.38);
      discOuter += skyAt(sourceUv, direction * solarDiscRadiusUv * 0.82);

      // Wider angular rings estimate how much glare-producing sky remains.
      // Their radii and weights intentionally favor broad context, so a thin
      // silhouette differs materially from a hillside filling the frame.
      inner += skyAt(sourceUv, direction * 0.040);
      middle += skyAt(sourceUv, direction * 0.110);
      outer += skyAt(sourceUv, direction * 0.220);
    }

    float directVisibility = smoothstep(
      0.015,
      0.985,
      (discInner / 16.0) * 0.35 + (discOuter / 16.0) * 0.65
    );
    float apertureVisibility = directVisibility * 0.03
      + (inner / 16.0) * 0.12
      + (middle / 16.0) * 0.28
      + (outer / 16.0) * 0.57;
    gl_FragColor = vec4(directVisibility, apertureVisibility, 0.0, 1.0);
  }
`

export const FILMIC_FLARE_TEMPORAL_BLOOM_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform sampler2D currentBloom;
  uniform sampler2D previousBloom;
  uniform sampler2D occlusionTexture;
  uniform float deltaTime;
  uniform float historyValid;
  varying vec2 vUv;

  void main() {
    vec3 current = texture2D(currentBloom, vUv).rgb;
    vec3 previous = texture2D(previousBloom, vUv).rgb;

    if (historyValid < 0.5) {
      gl_FragColor = vec4(current, 1.0);
      return;
    }

    float currentLuma = dot(current, vec3(0.2126, 0.7152, 0.0722));
    float previousLuma = dot(previous, vec3(0.2126, 0.7152, 0.0722));
    vec2 visibility = texture2D(occlusionTexture, vec2(0.5)).rg;
    float blocked = 1.0 - smoothstep(0.15, 0.85, visibility.r);
    float aperture = smoothstep(0.04, 0.92, visibility.g);
    float retainedFraction = mix(0.035, 0.96, aperture);
    vec3 retainedBloom = previous * retainedFraction;
    vec3 target = mix(current, max(current, retainedBloom), blocked);

    // Broad blockers release quickly; narrow blockers preserve the diffuse
    // glare. While the source is visible, old screen-space bloom clears fast
    // enough to avoid trails as the camera moves.
    float blockedRelease = mix(8.0, 1.2, aperture);
    float responseRate = currentLuma > previousLuma
      ? 18.0
      : mix(8.0, blockedRelease, blocked);
    float response = 1.0 - exp(-responseRate * clamp(deltaTime, 0.0, 0.1));
    gl_FragColor = vec4(mix(previous, target, response), 1.0);
  }
`

export const FILMIC_FLARE_BRIGHT_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  uniform sampler2D bloomInput;
  uniform float bloomThreshold;
  varying vec2 vUv;

  void main() {
    vec3 color = texture2D(bloomInput, vUv).rgb;
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    float highPass = smoothstep(bloomThreshold, bloomThreshold + 0.01, luma);
    gl_FragColor = vec4(color * highPass, 1.0);
  }
`

export const FILMIC_FLARE_COMPOSITE_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  ${LENS_UNIFORMS}
  uniform sampler2D sourceBloom;
  uniform sampler2D haloBloom;
  uniform sampler2D flareTexture;
  uniform sampler2D flareBloom;
  uniform float timeSeconds;
  uniform float hardEnabled;
  uniform int debugMode;
  ${LENS_MATH}

  void main() {
    vec4 source = texture2D(tDiffuse, vUv);
    if (hardEnabled < 0.5 && debugMode == 0) {
      gl_FragColor = source;
      return;
    }

    vec2 suv = topUv();
    float rawLuma;
    vec3 plate = preparedPlate(suv, rawLuma);
    vec3 sourceBloomColor = texture2D(sourceBloom, vUv).rgb;
    vec3 haloBloomColor = texture2D(haloBloom, vUv).rgb;
    vec3 flare = texture2D(flareTexture, vUv).rgb;
    vec3 flareBloomColor = texture2D(flareBloom, vUv).rgb;

    if (debugMode == 1) {
      gl_FragColor = source;
      return;
    }
    if (debugMode == 2) {
      gl_FragColor = vec4(plate, 1.0);
      return;
    }
    if (debugMode == 3) {
      gl_FragColor = vec4(flare, 1.0);
      return;
    }
    if (debugMode == 4) {
      gl_FragColor = vec4(sourceBloomColor, 1.0);
      return;
    }
    if (debugMode == 5) {
      gl_FragColor = vec4(haloBloomColor, 1.0);
      return;
    }
    if (debugMode == 6) {
      gl_FragColor = vec4(flareBloomColor, 1.0);
      return;
    }
    if (debugMode == 7) {
      float hot = hotAt(suv);
      gl_FragColor = vec4(vec3(hot), 1.0);
      return;
    }
    if (debugMode == 8) {
      gl_FragColor = vec4(vec3(effectiveVisibility()), 1.0);
      return;
    }

    vec3 comp = plate
      + sourceBloomColor * 0.92 * effectMix * strength
      + haloBloomColor * vec3(1.0, 0.40, 0.13) * 1.30 * effectMix * strength
      + flare
      + flareBloomColor * 0.56 * effectMix;

    float veilMaskA = axisEllipse(suv, mix(sourceTop, vec2(0.5), 0.33), 0.84, 0.33);
    float veilMaskB = ellipse(suv, mix(sourceTop, vec2(0.5), 0.28), 0.70, 0.52);
    float veilMask = clamp(veilMaskA * 0.88 + veilMaskB * 0.58, 0.0, 1.0)
      * bloomVisibility() * effectMix * strength;
    float compLumaBeforeVeil = dot(comp, LUMA);
    vec3 warmNeutral = mix(vec3(compLumaBeforeVeil), vec3(1.24, 0.60, 0.30), 0.28);
    comp = mix(comp, comp * 0.60 + warmNeutral * 0.62, veilMask * 0.64);

    float milkMaskA = ellipse(suv, mix(sourceTop, vec2(0.5), 0.40), 0.96, 0.60);
    float milkMaskB = axisEllipse(suv, mix(sourceTop, vec2(0.5), 0.46), 1.10, 0.35);
    float milkMask = clamp(milkMaskA * 0.46 + milkMaskB * 0.36, 0.0, 1.0)
      * bloomVisibility() * effectMix * strength;
    float milkLuma = dot(comp, LUMA);
    vec3 creamyLift = mix(vec3(milkLuma), vec3(1.34, 0.82, 0.42), 0.20);
    comp = mix(comp, comp * 0.82 + creamyLift * 0.32, milkMask * 0.24);

    float filmLuma = dot(comp, LUMA);
    float filmWarmMask = smoothstep(0.18, 1.8, filmLuma);
    float shadowMask = 1.0 - smoothstep(0.08, 0.58, filmLuma);
    float shoulderMask = smoothstep(0.55, 3.2, filmLuma);
    vec3 filmTint = mix(vec3(0.972, 0.995, 1.032), vec3(1.105, 0.956, 0.836), filmWarmMask);
    comp *= filmTint;
    comp = mix(comp, comp * vec3(0.90, 0.94, 1.02), shadowMask * 0.18);
    float shoulderLuma = dot(comp, LUMA);
    vec3 creamyShoulder = mix(vec3(shoulderLuma), vec3(1.18, 0.86, 0.62), 0.18);
    comp = mix(comp, comp * 0.90 + creamyShoulder * 0.16, shoulderMask * 0.34);

    float densityMask = 1.0 - smoothstep(1.0, 4.0, filmLuma);
    comp *= mix(1.0, 0.72, densityMask);
    float highlightDesat = smoothstep(0.75, 4.6, filmLuma) * 0.15;
    comp = mix(comp, vec3(dot(comp, LUMA)), highlightDesat);

    vec2 fromCenter = suv - 0.5;
    float vx = fromCenter.x * aspect * 0.66;
    float vd = vx * vx + fromCenter.y * fromCenter.y;
    float vignette = 1.0 - smoothstep(0.22, 0.80, vd) * 0.11;
    comp *= vignette;

    vec2 grainUv = suv * vec2(1919.0, 1087.0) + vec2(timeSeconds * 43.17, timeSeconds * 17.71);
    float noise = fract(sin(dot(grainUv, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
    float compLuma = dot(comp, LUMA);
    float grainMask = (1.0 - smoothstep(1.5, 5.2, compLuma)) * 0.0052;
    comp = max(comp + noise * grainMask, vec3(0.0));

    gl_FragColor = vec4(comp, 1.0);
  }
`
