/**
 * Shaders GLSL 3.00 ES para o Jogo do Estagiário 3D em OpenGL/WebGL2
 * - Modelo Phong + Blinn-Specular com suporte a Múltiplas Luzes (Luz Solar Direcional, Scanner Laser Point Light, LED Status Light)
 * - Sombras sutilmente simuladas, reflexão especular, textura procedural de ruído / linhas de digitalização
 * - Shaders de Partículas 3D com desvanecimento suave e rotação
 */

export const MAIN_VS = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec4 aColor;
layout(location = 3) in vec2 aUv;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProjection;
uniform mat3 uNormalMatrix;

out vec3 vWorldPos;
out vec3 vNormal;
out vec4 vColor;
out vec2 vUv;

void main() {
    vec4 worldPos = uModel * vec4(aPosition, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(uNormalMatrix * aNormal);
    vColor = aColor;
    vUv = aUv;
    gl_Position = uProjection * uView * worldPos;
}
`;

export const MAIN_FS = `#version 300 es
precision highp float;

in vec3 vWorldPos;
in vec3 vNormal;
in vec4 vColor;
in vec2 vUv;

uniform vec3 uCameraPos;
uniform vec3 uDirLightDir;
uniform vec3 uDirLightColor;
uniform vec3 uAmbientColor;

// Point light: Scanner Laser
uniform vec3 uLaserPos;
uniform vec3 uLaserColor;
uniform float uLaserIntensity;

// Point light: Status LED
uniform vec3 uLedPos;
uniform vec3 uLedColor;
uniform float uLedIntensity;

// Material properties
uniform float uShininess;
uniform float uSpecularStrength;
uniform float uEmissive;
uniform float uTime;
uniform float uScanlineEffect;

out vec4 fragColor;

void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(uCameraPos - vWorldPos);

    // 1. Ambient Lighting
    vec3 ambient = uAmbientColor * vColor.rgb;

    // 2. Directional Key Light (Phong / Blinn-Phong)
    vec3 L_dir = normalize(-uDirLightDir);
    float diff_dir = max(dot(N, L_dir), 0.0);
    vec3 H_dir = normalize(L_dir + V);
    float spec_dir = pow(max(dot(N, H_dir), 0.0), uShininess) * uSpecularStrength;
    vec3 direct = uDirLightColor * (diff_dir * vColor.rgb + spec_dir * vec3(1.0));

    // 3. Scanner Laser Point Light (com atenuação suave)
    vec3 laserDiff = uLaserPos - vWorldPos;
    float laserDist = length(laserDiff);
    vec3 L_laser = normalize(laserDiff);
    float laserAtten = uLaserIntensity / (1.0 + 0.5 * laserDist + 1.2 * laserDist * laserDist);
    float diff_laser = max(dot(N, L_laser), 0.0);
    vec3 H_laser = normalize(L_laser + V);
    float spec_laser = pow(max(dot(N, H_laser), 0.0), uShininess * 0.5) * uSpecularStrength * 1.5;
    vec3 laserLight = uLaserColor * (diff_laser * vColor.rgb + spec_laser * vec3(0.8, 1.0, 0.9)) * laserAtten;

    // 4. Status LED Light
    vec3 ledDiff = uLedPos - vWorldPos;
    float ledDist = length(ledDiff);
    vec3 L_led = normalize(ledDiff);
    float ledAtten = uLedIntensity / (1.0 + 1.0 * ledDist + 3.0 * ledDist * ledDist);
    float diff_led = max(dot(N, L_led), 0.0);
    vec3 ledLight = uLedColor * diff_led * vColor.rgb * ledAtten;

    // 5. Scanline hologram effect (opcional nos hologramas / lasers)
    float scanline = 1.0;
    if (uScanlineEffect > 0.01) {
        scanline = 0.85 + 0.15 * sin(vWorldPos.y * 40.0 + uTime * 8.0);
    }

    // 6. Emissive component (telas, botões acesos, laser)
    vec3 emissive = vColor.rgb * uEmissive;

    vec3 finalRgb = (ambient + direct + laserLight + ledLight) * scanline + emissive;
    
    // Sutil vinheta / oclusão ambiente de chão
    float groundOcclusion = smoothstep(-1.5, 0.5, vWorldPos.y);
    finalRgb *= (0.75 + 0.25 * groundOcclusion);

    fragColor = vec4(finalRgb, vColor.a);
}
`;

export const PARTICLE_VS = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec4 aColor;
layout(location = 2) in float aSize;

uniform mat4 uView;
uniform mat4 uProjection;

out vec4 vColor;

void main() {
    vColor = aColor;
    vec4 viewPos = uView * vec4(aPosition, 1.0);
    gl_Position = uProjection * viewPos;
    gl_PointSize = aSize * (350.0 / -viewPos.z);
}
`;

export const PARTICLE_FS = `#version 300 es
precision highp float;

in vec4 vColor;
out vec4 fragColor;

void main() {
    // Partícula redonda suave com brilho central
    vec2 coord = gl_PointCoord - vec2(0.5);
    float dist = length(coord);
    if (dist > 0.5) {
        discard;
    }
    float alpha = smoothstep(0.5, 0.05, dist) * vColor.a;
    fragColor = vec4(vColor.rgb, alpha);
}
`;
