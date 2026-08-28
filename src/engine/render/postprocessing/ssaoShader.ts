/**
 * Shared screen-space ambient-visibility shader code.
 *
 * The pass works in view space reconstructed from the forward WebGL depth
 * buffer. It deliberately uses a small world-space radius and a reconstructed
 * normal so foreground silhouettes and coplanar pixels do not automatically
 * become occluders.
 */
export const SSAO_FRAGMENT_GLSL = `
  uniform sampler2D tDepth;
  uniform vec2 resolution;
  uniform float cameraNear;
  uniform float cameraFar;
  uniform mat4 invProjectionMatrix;
  uniform mat4 cameraMatrixWorld;
  uniform vec2 projectionScale;
  uniform float waterLevel;
  uniform bool ssaoEnabled;
  uniform float ssaoIntensity;
  uniform float ssaoRadius;

  float ssaoHash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float ssaoReadRawDepth(vec2 uv) {
    return texture2D(tDepth, clamp(uv, vec2(0.0), vec2(1.0))).r;
  }

  bool ssaoIsBackground(float rawDepth) {
    return rawDepth >= 0.999999;
  }

  vec3 ssaoReconstructViewPosition(vec2 uv, float rawDepth) {
    vec4 clipPosition = vec4(uv * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
    vec4 viewPosition = invProjectionMatrix * clipPosition;
    if (abs(viewPosition.w) < 1e-6) return vec3(0.0);
    return viewPosition.xyz / viewPosition.w;
  }

  vec3 ssaoPositionOrCenter(vec2 uv, float rawDepth, vec3 centerPosition) {
    if (ssaoIsBackground(rawDepth)) return centerPosition;
    return ssaoReconstructViewPosition(uv, rawDepth);
  }

  vec3 ssaoReconstructViewNormal(vec2 uv, vec3 centerPosition) {
    vec2 texel = 1.0 / max(resolution, vec2(1.0));
    float leftDepth = ssaoReadRawDepth(uv - vec2(texel.x, 0.0));
    float rightDepth = ssaoReadRawDepth(uv + vec2(texel.x, 0.0));
    float downDepth = ssaoReadRawDepth(uv - vec2(0.0, texel.y));
    float upDepth = ssaoReadRawDepth(uv + vec2(0.0, texel.y));

    vec3 leftPosition = ssaoPositionOrCenter(uv - vec2(texel.x, 0.0), leftDepth, centerPosition);
    vec3 rightPosition = ssaoPositionOrCenter(uv + vec2(texel.x, 0.0), rightDepth, centerPosition);
    vec3 downPosition = ssaoPositionOrCenter(uv - vec2(0.0, texel.y), downDepth, centerPosition);
    vec3 upPosition = ssaoPositionOrCenter(uv + vec2(0.0, texel.y), upDepth, centerPosition);

    // Prefer the side of each axis with the smaller depth discontinuity. This
    // avoids constructing a normal from a foreground/background silhouette.
    vec3 dx = (abs(rightPosition.z - centerPosition.z) < abs(centerPosition.z - leftPosition.z))
      ? rightPosition - centerPosition
      : centerPosition - leftPosition;
    vec3 dy = (abs(upPosition.z - centerPosition.z) < abs(centerPosition.z - downPosition.z))
      ? upPosition - centerPosition
      : centerPosition - downPosition;

    vec3 normal = cross(dx, dy);
    float normalLength = length(normal);
    if (normalLength < 1e-5) {
      // A camera-facing fallback is preferable to an unstable zero normal at
      // a one-pixel silhouette or at the edge of the render target.
      return normalize(-centerPosition);
    }

    normal /= normalLength;
    if (dot(normal, normalize(-centerPosition)) < 0.0) normal = -normal;
    return normal;
  }

  float ssaoFactor(vec2 uv) {
    if (!ssaoEnabled || ssaoIntensity <= 0.0) return 1.0;

    float centerRawDepth = ssaoReadRawDepth(uv);
    if (ssaoIsBackground(centerRawDepth)) return 1.0;

    vec3 centerPosition = ssaoReconstructViewPosition(uv, centerRawDepth);
    float centerDepth = -centerPosition.z;
    if (centerDepth <= cameraNear || centerDepth >= cameraFar * 0.999) return 1.0;

    vec3 centerWorldPosition = (cameraMatrixWorld * vec4(centerPosition, 1.0)).xyz;
    if (centerWorldPosition.y < waterLevel - 0.1) return 1.0;

    vec3 normal = ssaoReconstructViewNormal(uv, centerPosition);
    float worldRadius = max(ssaoRadius, 0.05);
    vec2 radiusUv = worldRadius * projectionScale / (2.0 * max(centerDepth, 0.001));
    vec2 texel = 1.0 / max(resolution, vec2(1.0));
    radiusUv = min(radiusUv, vec2(0.20));
    if (radiusUv.x < texel.x || radiusUv.y < texel.y) return 1.0;

    // Screen-stable noise removes ring structure without pretending this is a
    // temporally accumulated pass. The view-space reconstruction keeps the
    // result geometrically bounded when the camera moves.
    float noise = ssaoHash12(floor(gl_FragCoord.xy));
    float occlusion = 0.0;
    float validSamples = 0.0;

    for (int directionIndex = 0; directionIndex < 8; directionIndex++) {
      float angle = noise * 6.2831853 + float(directionIndex) * 0.7853982;
      vec2 direction = vec2(cos(angle), sin(angle));

      for (int stepIndex = 0; stepIndex < 2; stepIndex++) {
        float stepT = (float(stepIndex) + 0.5) / 2.0;
        float radialT = mix(0.35, 1.0, stepT);
        vec2 sampleUv = uv + direction * radiusUv * radialT;
        if (sampleUv.x <= 0.0 || sampleUv.x >= 1.0 || sampleUv.y <= 0.0 || sampleUv.y >= 1.0) continue;

        float sampleRawDepth = ssaoReadRawDepth(sampleUv);
        if (ssaoIsBackground(sampleRawDepth)) continue;

        vec3 samplePosition = ssaoReconstructViewPosition(sampleUv, sampleRawDepth);
        vec3 delta = samplePosition - centerPosition;
        float distanceToSample = length(delta);
        if (distanceToSample <= 1e-4 || distanceToSample > worldRadius * 1.35) continue;

        // Only the receiver's outward hemisphere can occlude it. Coplanar
        // pixels have a near-zero projection and therefore do not darken a
        // whole wall or floor simply because they are visible in the buffer.
        float horizonCosine = max(dot(delta, normal) / distanceToSample, 0.0);
        float normalOffset = max(dot(delta, normal), 0.0);
        float angularOcclusion = smoothstep(0.025, 0.35, horizonCosine);
        float contactOcclusion = smoothstep(0.03, 0.20, normalOffset) * 0.65;
        float distanceWeight = 1.0 - smoothstep(worldRadius * 0.35, worldRadius * 1.25, distanceToSample);

        occlusion += max(angularOcclusion, contactOcclusion) * distanceWeight;
        validSamples += 1.0;
      }
    }

    if (validSamples <= 0.0) return 1.0;
    occlusion /= validSamples;

    // Keep the pass a restrained ambient-visibility correction. Direct sun
    // lighting is protected separately by the alpha-encoded indirect mask.
    float amount = clamp(occlusion * ssaoIntensity * 1.35, 0.0, 0.55);
    return 1.0 - amount;
  }
`
