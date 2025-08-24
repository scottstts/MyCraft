// Block fragment shader with advanced lighting models
// Enhanced PBR lighting with ambient occlusion and atmospheric effects

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vViewPosition;
varying float vAmbientOcclusion;

uniform sampler2D map;
uniform sampler2D normalMap;
uniform samplerCube envMap;

uniform vec3 cameraPosition;
uniform float roughness;
uniform float metalness;
uniform float envMapIntensity;
uniform float time;

// Enhanced lighting calculation
vec3 calculateEnhancedLighting(vec3 albedo, vec3 normal, vec3 viewDir) {
    vec3 color = vec3(0.0);
    
    // Enhanced ambient lighting with AO
    vec3 ambient = vec3(0.4, 0.5, 0.6) * 0.3 * vAmbientOcclusion;
    
    // Main directional light (sun)
    vec3 sunDir = normalize(vec3(0.5, 1.0, 0.3));
    vec3 sunColor = vec3(1.0, 0.95, 0.8) * 1.2;
    float sunDot = max(dot(normal, sunDir), 0.0);
    
    // Enhanced diffuse with wrapped lighting for softer shadows
    float wrappedDiffuse = (sunDot + 0.3) / 1.3;
    vec3 diffuse = sunColor * wrappedDiffuse;
    
    // Fresnel effect for edge lighting
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0);
    vec3 fresnelColor = vec3(0.8, 0.9, 1.0) * fresnel * 0.2;
    
    // Simple environment reflection
    vec3 reflectDir = reflect(-viewDir, normal);
    vec3 envColor = textureCube(envMap, reflectDir).rgb;
    vec3 reflection = envColor * envMapIntensity * (1.0 - roughness) * fresnel;
    
    // Subsurface scattering effect for organic materials
    float backLight = max(dot(normal, -sunDir), 0.0);
    vec3 subsurface = sunColor * backLight * 0.1 * (1.0 - metalness);
    
    // Combine all lighting components
    color = ambient + diffuse + fresnelColor + reflection + subsurface;
    
    return color * albedo;
}

// Atmospheric fog calculation
vec3 applyAtmosphericFog(vec3 color, float distance) {
    float fogDensity = 0.0003;
    float fogFactor = 1.0 - exp(-distance * fogDensity);
    vec3 fogColor = vec3(0.7, 0.8, 0.9);
    
    return mix(color, fogColor, clamp(fogFactor, 0.0, 0.8));
}

void main() {
    // Sample albedo texture
    vec4 texColor = texture2D(map, vUv);
    vec3 albedo = texColor.rgb;
    
    // Normal mapping (ready for when normal maps are added)
    vec3 normal = normalize(vNormal);
    
    // View direction
    vec3 viewDir = normalize(cameraPosition - vWorldPosition);
    
    // Calculate enhanced lighting
    vec3 color = calculateEnhancedLighting(albedo, normal, viewDir);
    
    // Apply atmospheric fog based on distance
    float distance = length(vViewPosition);
    color = applyAtmosphericFog(color, distance);
    
    // Color grading and tone mapping
    color = color / (color + vec3(1.0)); // Simple Reinhard tone mapping
    color = pow(color, vec3(1.0/2.2)); // Gamma correction
    
    gl_FragColor = vec4(color, texColor.a);
}