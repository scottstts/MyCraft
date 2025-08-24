// Block vertex shader with enhanced lighting and ambient occlusion
// Inputs: position, normal, uv, and additional vertex attributes

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorldPosition;
varying vec3 vViewPosition;
varying float vAmbientOcclusion;

// Ambient occlusion calculation based on vertex position
float calculateVertexAO(vec3 worldPos, vec3 normal) {
    // Simple AO based on vertex position relative to block corners
    vec3 blockPos = floor(worldPos);
    vec3 localPos = worldPos - blockPos;
    
    // Calculate occlusion based on how close vertex is to block corners/edges
    float edgeOcclusion = 0.0;
    
    // Check proximity to edges (0.0 = at edge, 0.5 = at center)
    vec3 edgeDistance = min(localPos, 1.0 - localPos);
    float minEdgeDistance = min(min(edgeDistance.x, edgeDistance.y), edgeDistance.z);
    
    // Apply stronger occlusion at edges and corners
    edgeOcclusion = 1.0 - smoothstep(0.0, 0.2, minEdgeDistance);
    
    // Face-specific occlusion
    float faceOcclusion = 0.0;
    if (abs(normal.y) > 0.5) {
        // Top/bottom faces - less occlusion
        faceOcclusion = edgeOcclusion * 0.3;
    } else {
        // Side faces - more occlusion for depth
        faceOcclusion = edgeOcclusion * 0.6;
    }
    
    return 1.0 - faceOcclusion;
}

void main() {
    vUv = uv;
    
    // Transform normal to world space
    vNormal = normalize(normalMatrix * normal);
    
    // World position
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    
    // View position
    vec4 viewPosition = viewMatrix * worldPosition;
    vViewPosition = viewPosition.xyz;
    
    // Calculate ambient occlusion
    vAmbientOcclusion = calculateVertexAO(vWorldPosition, vNormal);
    
    // Final position
    gl_Position = projectionMatrix * viewPosition;
}