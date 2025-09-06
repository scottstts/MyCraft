import * as THREE from 'three'

export interface WaterSurfaceParams {
  map: THREE.Texture | null
  color?: THREE.Color | number | string
  tileScale?: number // world units per texture tile
  useWorldUV?: boolean // true for world-quad (far ocean), false for block mesh (use vUv)
  bounds?: { minX: number; maxX: number; minZ: number; maxZ: number }
}

export class WaterSurfaceMaterial extends THREE.ShaderMaterial {
  // --- Lightweight global ticker so near-water also animates without engine hooks ---
  private static _instances: Set<WaterSurfaceMaterial> = new Set();
  private static _rafId: number | null = null;
  private static _start: number = performance.now();
  private static _ensureTicker(){
    if (this._rafId !== null) return;
    const tick = () => {
      const t = (performance.now() - this._start) / 1000; // seconds
      for (const inst of this._instances) { try { inst.setTime(t); } catch { /* ignore */ } }
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }
  constructor(params: WaterSurfaceParams){
    const color = new THREE.Color(params.color ?? 0x1a2744) // Deep navy blue like real ocean
    const tileScale = Math.max(1e-3, params.tileScale ?? 1.0)
    const useWorldUV = !!params.useWorldUV
    const b = params.bounds ?? { minX: -1e9, maxX: 1e9, minZ: -1e9, maxZ: 1e9 }
    super({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: color },
        uTime: { value: 0 },
        // Texture inputs are retained for API compatibility, but shader is now fully procedural
        uMap: { value: params.map ?? null },
        uUseMap: { value: false }, // force procedural path regardless of texture availability
        uTileScale: { value: tileScale },
        uUseWorldUV: { value: useWorldUV },
        uInnerMinX: { value: b.minX },
        uInnerMaxX: { value: b.maxX },
        uInnerMinZ: { value: b.minZ },
        uInnerMaxZ: { value: b.maxZ },
        uEdgeStrength: { value: 0.0 },
        uEdgeWidth: { value: 2.0 },
        uAlpha: { value: 1.0 },
        // Alpha shaping (transparency vs. angle): a = max(uAlpha, uAlphaNearMin) * (base + scale * F)
        uAlphaFresnelBase: { value: 0.65 },
        uAlphaFresnelScale: { value: 0.35 },
        // Water optics + waves
        uFresnel: { value: 0.035 },         // Additional Fresnel bias (adds to physical F0)
        uEta: { value: 1.0 / 1.333 },       // Air->Water IOR ratio (eta = n1/n2)
        uRefractAmount: { value: 0.18 },    // Screen-space refraction strength (pixels normalized)
        uAbsorption: { value: new THREE.Vector3(0.20, 0.06, 0.02) }, // Beer-Lambert coeffs (R,G,B) per meter
        uDepthApprox: { value: 4.0 },       // Approx. water thickness if scene depth not available (meters)
        uSpecular: { value: 1.2 },          // Sun glint strength (boosted for dramatic effect)
        uRoughness: { value: 0.35 },        // Reflection blur (analytic, cheap)
        uSunDir: { value: new THREE.Vector3(0.35, 0.9, 0.2).normalize() }, // default midday
        uSunColor: { value: new THREE.Color(1.0, 0.98, 0.90) },
        // Optional screen-space refraction inputs (set from engine if available)
        tSceneColor: { value: null },
        uHasSceneColor: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        // Gerstner-like wave params
        uWaveAmp: { value: 0.12 },          // base amplitude (normal tilt)
        uChop: { value: 0.8 },              // choppiness (steeper crests)
        uWind: { value: new THREE.Vector2(0.8, 0.4).normalize() },
        uSpeed: { value: 0.8 },             // base phase speed (m/s)
        uL0: { value: 12.0 },               // primary wavelength (m)
        uL1: { value: 6.0 },                // secondary
        uL2: { value: 2.5 },                // micro ripples
        // Foam controls (procedural, crest-only)
        uFoamIntensity: { value: 0.55 },
        uFoamThreshold: { value: 0.62 },
        uFoamNoise: { value: 1.0 },         // 0..1 added breakup amount
        uFoamDrift: { value: 0.15 },        // drift speed along wind
        // Transmission control: make far/grazing water less transparent
        uAlphaDistStart: { value: 25.0 },   // meters
        uAlphaDistEnd: { value: 140.0 },    // meters
        uAlphaMax: { value: 0.98 },
        uAlphaNearMin: { value: 0.88 },     // enforce near-opaceness so shoreline isn't invisible
        uAlphaNearDist: { value: 22.0 },    // meters within which to enforce near min
        // Sky gradient controls (simple analytic sky for reflections)
        uSkyTop: { value: new THREE.Color(0.32, 0.50, 0.80) },
        uSkyHorizon: { value: new THREE.Color(0.68, 0.78, 0.92) },
        // Ambient lighting controls
        uAmbientIntensity: { value: 1.0 },   // Overall ambient light multiplier [0..1]
        uNightTint: { value: new THREE.Color(0.1, 0.15, 0.25) }, // Tint applied at night
      },
      vertexShader: `
        varying vec3 vWorld;
        varying vec2 vUvVary;
        varying vec3 vNormalVary;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vUvVary = uv;
          vNormalVary = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor; uniform float uTime; varying vec3 vWorld;
        varying vec2 vUvVary; varying vec3 vNormalVary;
        uniform float uTileScale; uniform bool uUseWorldUV; // kept for API stability
        uniform float uInnerMinX, uInnerMaxX, uInnerMinZ, uInnerMaxZ;
        uniform float uEdgeStrength; uniform float uEdgeWidth; uniform float uAlpha;
        uniform float uAlphaFresnelBase; uniform float uAlphaFresnelScale;
        // Optics
        uniform float uFresnel; uniform float uSpecular; uniform float uRoughness; uniform vec3 uSunColor; uniform vec3 uSunDir;
        uniform float uEta; uniform float uRefractAmount; uniform vec3 uAbsorption; uniform float uDepthApprox;
        uniform sampler2D tSceneColor; uniform int uHasSceneColor; uniform vec2 uResolution;
        // Waves
        uniform float uWaveAmp; uniform float uChop; uniform vec2 uWind; uniform float uSpeed; uniform float uL0; uniform float uL1; uniform float uL2;
        // Foam
        uniform float uFoamIntensity; uniform float uFoamThreshold; uniform float uFoamNoise; uniform float uFoamDrift;
        // Distance/angle transmission shaping
        uniform float uAlphaDistStart; uniform float uAlphaDistEnd; uniform float uAlphaMax;
        uniform float uAlphaNearMin; uniform float uAlphaNearDist;
        // Sky gradient
        uniform vec3 uSkyTop; uniform vec3 uSkyHorizon;
        // Ambient lighting
        uniform float uAmbientIntensity; uniform vec3 uNightTint;

        // Utility noise (small and stable)
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); float a=hash(i); float b=hash(i+vec2(1.0,0.0)); float c=hash(i+vec2(0.0,1.0)); float d=hash(i+vec2(1.0,1.0)); vec2 u=f*f*(3.0-2.0*f); return mix(a,b,u.x)+(c-a)*u.y*(1.0-u.x)+(d-b)*u.x*u.y; }

        // Multi-octave noise for natural randomization
        float fbm(vec2 p, int octaves) {
          float value = 0.0;
          float amplitude = 0.5;
          float frequency = 1.0;
          for (int i = 0; i < 8; i++) {
            if (i >= octaves) break;
            value += amplitude * noise(p * frequency);
            frequency *= 2.0;
            amplitude *= 0.5;
          }
          return value;
        }

        // Compute Gerstner-style normal from physically-based wave spectrum
        vec4 waveNormalCrest(vec2 xz, float t){
          // Primary wave directions following realistic ocean physics
          vec2 windDir = normalize(uWind);
          vec2 windPerp = vec2(-windDir.y, windDir.x);
          
          // Main wind waves (dominant energy)
          vec2 d0 = windDir;  // Primary wind direction
          vec2 d1 = windPerp; // Cross-wind waves (90 degrees)
          vec2 d2 = normalize(windDir * 0.7 + windPerp * 0.7); // 45-degree angle
          
          // Realistic micro-wave directions based on physics:
          // - Small waves tend to align more with local wind
          // - Cross-waves at specific angles (30°, 60°) due to wave interaction
          // - Slight angular spreading decreases with wave size
          vec2 d3 = normalize(windDir * 0.866 + windPerp * 0.5);   // 30-degree spread
          vec2 d4 = normalize(windDir * 0.866 - windPerp * 0.5);   // -30-degree spread  
          vec2 d5 = normalize(windDir * 0.5 + windPerp * 0.866);   // 60-degree cross-waves
          
          // Wave numbers (existing + new micro scales with 50% longer wavelengths)
          float k0 = 6.2831853 / max(1e-3, uL0);      // 12m primary
          float k1 = 6.2831853 / max(1e-3, uL1);      // 6m secondary  
          float k2 = 6.2831853 / max(1e-3, uL2);      // 2.5m tertiary
          float k3 = 6.2831853 / max(1e-3, 5.25);     // 5.25m larger micro ripples (3.5 * 1.5)
          float k4 = 6.2831853 / max(1e-3, 3.0);      // 3.0m medium ripples (2.0 * 1.5)
          float k5 = 6.2831853 / max(1e-3, 1.5);      // 1.5m fine ripples (1.0 * 1.5)
          
          // Dispersion relations
          float w0 = sqrt(9.8 * k0);
          float w1 = sqrt(9.8 * k1);
          float w2 = sqrt(9.8 * k2);
          float w3 = sqrt(9.8 * k3);
          float w4 = sqrt(9.8 * k4);
          float w5 = sqrt(9.8 * k5);
          
          // Amplitudes with natural decay for smaller waves
          float a0 = uWaveAmp;
          float a1 = uWaveAmp * 0.55;
          float a2 = uWaveAmp * 0.22;
          float a3 = uWaveAmp * 0.12;  // Micro ripples
          float a4 = uWaveAmp * 0.08;  // Fine ripples  
          float a5 = uWaveAmp * 0.05;  // Capillary waves
          float ch = uChop;

          // Phase calculations with varied speeds for randomization
          float p0 = dot(xz, d0) * k0 + t * (uSpeed * w0);
          float p1 = dot(xz, d1) * k1 + t * (0.8 * uSpeed * w1);
          float p2 = dot(xz, d2) * k2 + t * (1.2 * uSpeed * w2);
          float p3 = dot(xz, d3) * k3 + t * (0.9 * uSpeed * w3);
          float p4 = dot(xz, d4) * k4 + t * (1.1 * uSpeed * w4);
          float p5 = dot(xz, d5) * k5 + t * (0.7 * uSpeed * w5);

          // Anti-aliasing: reduce amplitude based on screen-space derivatives to prevent aliasing
          vec2 dxz_dx = dFdx(xz);
          vec2 dxz_dy = dFdy(xz);
          float maxDerivative = max(length(dxz_dx), length(dxz_dy));
          
          // Fade out high-frequency waves when screen derivatives are large
          float aa3 = 1.0 - smoothstep(0.0, 2.0, maxDerivative * k3);
          float aa4 = 1.0 - smoothstep(0.0, 1.5, maxDerivative * k4);
          float aa5 = 1.0 - smoothstep(0.0, 1.0, maxDerivative * k5);
          
          // Apply anti-aliasing to micro-wave amplitudes
          a3 *= aa3;
          a4 *= aa4;
          a5 *= aa5;

          // Height gradients -> normal (all wave components)
          vec2 grad = vec2(0.0);
          grad += d0 * (a0 * k0 * cos(p0));
          grad += d1 * (a1 * k1 * cos(p1));
          grad += d2 * (a2 * k2 * cos(p2));
          grad += d3 * (a3 * k3 * cos(p3));
          grad += d4 * (a4 * k4 * cos(p4));
          grad += d5 * (a5 * k5 * cos(p5));
          
          // Physics-based micro-turbulence (much simpler and more organized)
          // Small-scale wind-driven ripples aligned with dominant directions
          float microScale = 0.08;
          float microAA = 1.0 - smoothstep(0.0, 2.0, maxDerivative * microScale * 6.28);
          
          // Two primary micro-turbulence patterns following wind physics
          float turbulence1 = noise(xz * microScale + windDir * t * 0.03) * 2.0 - 1.0;
          float turbulence2 = noise(xz * microScale * 0.7 + windPerp * t * 0.025) * 2.0 - 1.0;
          
          // Apply micro-turbulence primarily along wind directions
          grad += windDir * (turbulence1 * 0.025 * microAA);
          grad += windPerp * (turbulence2 * 0.015 * microAA);

          vec3 N = normalize(vec3(-grad.x * ch, 1.0, -grad.y * ch));
          
          // Enhanced crest metric including micro-waves
          float slope = clamp(1.0 - N.y, 0.0, 1.0);
          float s0 = abs(sin(p0));
          float s1 = abs(sin(p1));
          float s2 = abs(sin(p2));
          float s3 = abs(sin(p3)) * aa3;
          float s4 = abs(sin(p4)) * aa4;
          float s5 = abs(sin(p5)) * aa5;
          
          float totalAmp = a0 + a1 + a2 + a3 + a4 + a5;
          float inter = (a0*s0 + a1*s1 + a2*s2 + a3*s3 + a4*s4 + a5*s5) / max(1e-3, totalAmp);
          float crest = clamp(slope * (0.5 + 0.8*inter), 0.0, 1.0);
          
          return vec4(N, crest);
        }

        vec3 skyColor(vec3 dir){
          // Simple analytic sky: horizon brighter, zenith deeper blue.
          float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0); // -1..1 -> 0..1
          vec3 base = mix(uSkyHorizon, uSkyTop, pow(h, 0.65));
          return base;
        }

        float fresnelSchlick(float cosTheta, float F0){
          return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
        }

        // Beer-Lambert transmittance for constant medium, per-channel absorption coefficients
        vec3 beerLambert(vec3 sigmaA, float dist){
          return exp(-sigmaA * max(0.0, dist));
        }

        // Cheap screen-space refraction sampling: distort screen UV by refracted direction and wave detail
        vec3 sampleRefractedScene(vec2 xz, vec3 N, vec3 V, float refractStrength){
          if (uHasSceneColor == 0) return vec3(-1.0); // sentinel to indicate unavailable
          // Incident vector from eye toward surface
          vec3 I = -V;
          // Refract into water (air->water)
          vec3 T = refract(I, N, uEta);
          // If total internal reflection or grazing where T is near-zero, skip
          if (length(T) < 1e-5) return vec3(-1.0);
          // Screen UV
          vec2 uv = gl_FragCoord.xy / uResolution;
          // Build tangent frame to introduce micro distortion from waves
          vec3 up = (abs(N.y) < 0.999) ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
          vec3 Tx = normalize(cross(up, N));
          vec3 Bx = cross(N, Tx);
          float t = uTime;
          // Two noisy taps for smoother result
          vec2 n1 = vec2(noise(xz*0.41 + t*0.13), noise(xz*0.37 - t*0.09));
          vec2 n2 = vec2(noise(xz*0.59 - t*0.17), noise(xz*0.23 + t*0.07));
          // Project refracted direction onto screen as a small offset
          vec2 baseOfs = T.xz * 0.5; // world to screen scale heuristic
          // Add wave-driven micro distortion
          vec2 micro1 = vec2(dot(Tx, N)*0.0 + (n1.x-0.5), dot(Bx, N)*0.0 + (n1.y-0.5));
          vec2 micro2 = vec2((n2.y-0.5), (n2.x-0.5));
          float f = clamp(refractStrength, 0.0, 1.0);
          vec2 o1 = (baseOfs + micro1*0.5) * (0.005 + 0.020*f);
          vec2 o2 = (baseOfs + micro2*0.5) * (0.007 + 0.030*f);
          vec3 c1 = texture2D(tSceneColor, clamp(uv + o1, vec2(0.0), vec2(1.0))).rgb;
          vec3 c2 = texture2D(tSceneColor, clamp(uv + o2, vec2(0.0), vec2(1.0))).rgb;
          return 0.5 * (c1 + c2);
        }

        void main(){
          vec3 V = normalize(cameraPosition - vWorld);
          // Stable world UV for waves whether using block UVs or world quads
          vec2 xz = uUseWorldUV ? vWorld.xz : (vWorld.xz * uTileScale);
          float t = uTime;
          vec4 nc = waveNormalCrest(xz, t);
          vec3 N = nc.xyz;
          float crest = nc.w;

          // Reflection from simplified sky
          vec3 R = reflect(-V, N);
          // Analytic rough reflection: jitter normal in a tiny cone using noise
          vec3 up = (abs(N.y) < 0.999) ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
          vec3 T = normalize(cross(up, N));
          vec3 B = cross(N, T);
          float r = mix(0.01, 0.08, clamp(uRoughness, 0.0, 1.0));
          vec2 h = vec2(noise(xz*0.31 + t*0.2), noise(xz*0.37 - t*0.17));
          vec3 N1 = normalize(N + (T * (h.x-0.5) + B * (h.y-0.5)) * r);
          vec3 N2 = normalize(N + (T * (h.y-0.5) + B * (h.x-0.5)) * r*0.8);
          vec3 R1 = reflect(-V, N1);
          vec3 R2 = reflect(-V, N2);
          vec3 skyRef = (skyColor(R) + skyColor(R1) + skyColor(R2)) / 3.0;

          // Base water coloration (absorption + proper Fresnel for dielectrics)
          float NdV = max(dot(N, V), 0.0);
          // Physical F0 from IOR ratio (air->water ~ 0.02)
          float F0 = pow((1.0 - uEta) / (1.0 + uEta), 2.0);
          F0 = clamp(F0 + uFresnel, 0.0, 1.0);
          float F = fresnelSchlick(NdV, F0);

          // Refraction direction (into water)
          vec3 I = -V;
          vec3 Tdir = refract(I, N, uEta);
          bool tir = length(Tdir) < 1e-5; // total internal reflection or grazing

          // Optional screen-space refraction sample if provided by engine
          vec3 sceneRefr = sampleRefractedScene(xz, N, V, uRefractAmount * (1.0 - F));

          // Physical absorption using Beer-Lambert to create depth-based tint
          float path = uDepthApprox / max(1e-3, -Tdir.y + 1e-3); // approximate distance traveled in water
          vec3 transmittance = beerLambert(uAbsorption, path);
          // Approximate seabed tint under water (sandy)
          vec3 seabedTint = vec3(0.85, 0.80, 0.65);
          vec3 deep = uColor; // deep water base (bluish)
          // If we have scene color, use it as refracted base; otherwise approximate with seabed tint
          vec3 refrBase = (sceneRefr.x >= 0.0) ? sceneRefr : seabedTint;
          vec3 refrCol = mix(deep, refrBase, 0.65) * transmittance;
          // Mix reflection and refraction by Fresnel; handle TIR
          vec3 base = mix(refrCol, skyRef, tir ? 1.0 : F);

          // Enhanced sun specular glint for dramatic ocean reflections
          vec3 L = normalize(uSunDir);
          float spec = max(dot(R, L), 0.0);
          
          // Ultra-sharp multi-layer glint system for crisp ocean reflections
          // Razor-sharp core highlight (sun disc reflection) - much higher power for crispness
          float coreGlint = pow(spec, 1800.0) * 4.0;
          // Very sharp main highlight (primary reflection path) 
          float mainGlint = pow(spec, 1200.0) * 3.2;
          // Sharp secondary highlight 
          float sharpGlint = pow(spec, 600.0) * 2.0;
          // Medium shoulder (scattered light around main path)
          float mediumGlint = pow(spec, 120.0) * 0.8;
          // Soft outer glow (wide reflection area)
          float softGlint = pow(spec, 24.0) * 0.4;
          
          // Add ultra-sharp wave-based sparkle variations (dancing light effect)
          // Use slightly different normals to create glint variations across wave crests
          float spec1 = max(dot(R1, L), 0.0);
          float spec2 = max(dot(R2, L), 0.0);
          float sparkleCore = pow(spec1, 1400.0) * 2.8 + pow(spec2, 1000.0) * 2.2;
          float sparkleMain = pow(spec1, 400.0) * 1.5 + pow(spec2, 280.0) * 1.2;
          
          // Combine all layers for ultra-crisp sun glint
          float totalGlint = coreGlint + mainGlint + sharpGlint + mediumGlint + softGlint + sparkleCore + sparkleMain;
          
          // Sun visibility check - only show glints when sun is above horizon
          float sunElevation = uSunDir.y; // Raw elevation, can be negative
          float sunVisibility = smoothstep(-0.03, -0.01, sunElevation); // Persist until well below visual horizon
          
          float elevationBoost = mix(3.5, 1.0, clamp(sunElevation, 0.0, 1.0)); // 3.5x stronger at horizon
          
          // Create warm sunset/sunrise colors
          vec3 sunsetOrange = vec3(1.0, 0.4, 0.1);  // Deep orange
          vec3 sunriseGold = vec3(1.0, 0.7, 0.2);   // Golden
          vec3 midDayWhite = vec3(1.0, 0.98, 0.90); // Warm white
          
          // Interpolate sun glint color based on elevation
          vec3 lowSunColor = mix(sunsetOrange, sunriseGold, 0.5);
          vec3 dynamicSunColor = mix(lowSunColor, midDayWhite, pow(clamp(sunElevation, 0.0, 1.0), 0.6));
          
          // Apply dynamic coloring to sun glint with visibility fade
          vec3 sunGlint = mix(uSunColor, dynamicSunColor, 0.8) * totalGlint * uSpecular * elevationBoost * sunVisibility;

          // Forward scattering tint (cheap subsurface feel)
          float fwd = pow(max(dot(N, -L), 0.0), 3.0) * 0.25;
          base += deep * fwd;

          // Foam on crests (instantaneous, noise-broken, wind-drifting)
          float foamSeed = noise(xz * 0.9 + uWind * (t * uFoamDrift));
          float foam = smoothstep(uFoamThreshold, 1.0, crest * (0.75 + uFoamNoise * (foamSeed - 0.5) * 0.8));
          vec3 foamCol = vec3(1.0);
          base = mix(base, foamCol, clamp(foam * uFoamIntensity, 0.0, 1.0));

          vec3 col = base + sunGlint;

          // Apply ambient lighting modulation
          // At night (low ambient), blend toward night tint color and reduce overall intensity
          float nightMix = 1.0 - uAmbientIntensity;
          col = mix(col, col * uNightTint, nightMix * 0.8);
          col *= mix(0.15, 1.0, uAmbientIntensity); // Scale overall brightness

          // Optional subtle ocean-only edge softening/brightening
          float outside = max(max(uInnerMinX - vWorld.x, vWorld.x - uInnerMaxX), max(uInnerMinZ - vWorld.z, vWorld.z - uInnerMaxZ));
          float f = uEdgeStrength * smoothstep(0.0, max(uEdgeWidth, 1e-3), outside);
          col = mix(col, vec3(0.88, 0.94, 1.0), f);

          // Tonemap-ish and gamma
          col = col / (col + vec3(1.0));
          col = pow(col, vec3(1.0/2.2));

          // Fresnel-driven alpha shaping so grazing angles appear less transparent
          float a = max(uAlpha, uAlphaNearMin);
          float fresnelAlpha = clamp(uAlphaFresnelBase + uAlphaFresnelScale * F, 0.0, 2.0);
          a = clamp(a * fresnelAlpha, 0.0, 1.0);
          gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        }
      `,
    })

    // Register instance for internal ticking
    WaterSurfaceMaterial._instances.add(this)
    WaterSurfaceMaterial._ensureTicker()
  }
  // Tune alpha vs. Fresnel angle response. a = max(uAlpha, uAlphaNearMin) * (base + scale * F)
  setFresnelAlpha(base: number, scale: number){
    this.uniforms.uAlphaFresnelBase.value = base
    this.uniforms.uAlphaFresnelScale.value = scale
  }

  setTime(t: number){ (this.uniforms.uTime.value as number) = t }
  setColor(c: THREE.Color){ (this.uniforms.uColor.value as THREE.Color).copy(c) }
  setMap(tex: THREE.Texture | null){ this.uniforms.uMap.value = tex; this.uniforms.uUseMap.value = false /* procedural only */ }
  setTileScale(s: number){ this.uniforms.uTileScale.value = Math.max(1e-3, s) }
  setUseWorldUV(flag: boolean){ this.uniforms.uUseWorldUV.value = !!flag }
  setBounds(b: { minX: number; maxX: number; minZ: number; maxZ: number }){
    this.uniforms.uInnerMinX.value = b.minX;
    this.uniforms.uInnerMaxX.value = b.maxX;
    this.uniforms.uInnerMinZ.value = b.minZ;
    this.uniforms.uInnerMaxZ.value = b.maxZ;
  }
  setEdge(strength: number, width: number){
    this.uniforms.uEdgeStrength.value = Math.max(0, strength);
    this.uniforms.uEdgeWidth.value = Math.max(0.1, width);
  }
  setAlpha(a: number){
    const alpha = Math.max(0, Math.min(1, a));
    this.uniforms.uAlpha.value = alpha;
    // Depth write only when fully opaque
    this.depthWrite = alpha >= 1.0;
  }
  // Keep old signature for compatibility; now maps to wave/optics tuning
  setRefraction(strength: number, eta = 1.0/1.333, waveAmp = 0.15, waveScale = 0.035, fresnelBias = 0.02){
    // Screen-space refraction amount and physical IOR ratio
    this.uniforms.uRefractAmount.value = Math.max(0, strength);
    this.uniforms.uEta.value = Math.max(1e-3, eta);
    // Wave spectrum tuning
    this.uniforms.uWaveAmp.value = Math.max(0, waveAmp);
    const s = Math.max(1e-4, waveScale);
    this.uniforms.uL0.value = (12.0 / s);
    this.uniforms.uL1.value = (6.0 / s);
    this.uniforms.uL2.value = (2.5 / s);
    // Additional Fresnel bias on top of IOR-derived F0
    this.uniforms.uFresnel.value = Math.max(0, fresnelBias);
  }

  // Extra tuning knobs for new shader
  setSun(direction: THREE.Vector3, color?: THREE.Color){
    (this.uniforms.uSunDir.value as THREE.Vector3).copy(direction).normalize()
    if (color) (this.uniforms.uSunColor.value as THREE.Color).copy(color)
  }
  // Optional: supply a background scene color for proper screen-space refraction
  setScreenRefraction(sceneColor: THREE.Texture | null, resolution?: { x: number; y: number }){
    if (sceneColor) {
      this.uniforms.tSceneColor.value = sceneColor
      this.uniforms.uHasSceneColor.value = 1
      if (resolution) {
        (this.uniforms.uResolution.value as THREE.Vector2).set(Math.max(1, Math.floor(resolution.x)), Math.max(1, Math.floor(resolution.y)))
      }
    } else {
      this.uniforms.tSceneColor.value = null
      this.uniforms.uHasSceneColor.value = 0
    }
  }
  
  // Update ambient lighting to respond to day/night cycle
  setAmbientLighting(intensity: number, nightTint?: THREE.Color) {
    this.uniforms.uAmbientIntensity.value = Math.max(0, Math.min(1, intensity))
    if (nightTint) (this.uniforms.uNightTint.value as THREE.Color).copy(nightTint)
  }
  
  // Update sky colors based on time of day
  setSkyColors(topColor: THREE.Color, horizonColor: THREE.Color) {
    (this.uniforms.uSkyTop.value as THREE.Color).copy(topColor);
    (this.uniforms.uSkyHorizon.value as THREE.Color).copy(horizonColor);
  }
  setWaves(params: { amp?: number; chop?: number; wind?: THREE.Vector2; speed?: number; L0?: number; L1?: number; L2?: number }){
    if (params.amp !== undefined) this.uniforms.uWaveAmp.value = Math.max(0, params.amp)
    if (params.chop !== undefined) this.uniforms.uChop.value = Math.max(0, params.chop)
    if (params.wind) (this.uniforms.uWind.value as THREE.Vector2).copy(params.wind).normalize()
    if (params.speed !== undefined) this.uniforms.uSpeed.value = Math.max(0, params.speed)
    if (params.L0 !== undefined) this.uniforms.uL0.value = Math.max(1e-3, params.L0)
    if (params.L1 !== undefined) this.uniforms.uL1.value = Math.max(1e-3, params.L1)
    if (params.L2 !== undefined) this.uniforms.uL2.value = Math.max(1e-3, params.L2)
  }

  override dispose(): void {
    super.dispose()
    WaterSurfaceMaterial._instances.delete(this)
    if (!WaterSurfaceMaterial._instances.size && WaterSurfaceMaterial._rafId !== null) {
      cancelAnimationFrame(WaterSurfaceMaterial._rafId)
      WaterSurfaceMaterial._rafId = null
    }
  }
}
