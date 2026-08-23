/**
 * InternOpenGLRenderer — Renderizador 3D Completo em OpenGL ES 3.0 / WebGL2
 * Gerencia todo o pipeline de renderização em tempo real:
 * - Compilação de Shaders GLSL 3.00 es
 * - Carregamento de VBOs/VAOs de cena e objetos 3D
 * - Pipeline de iluminação dinâmica (Phong, Blinn-Specular, Scanner Laser Beam, LEDs)
 * - Sistema de Partículas de Alta Taxa de Quadros
 * - Câmera 3D interativa (Modos Isométrico, Primeira Pessoa e Câmera de Ação)
 * - Animações em tempo real: Scanner Laser deslizando, Carimbo mecânico com física de impacto,
 *   Levitação/Rotação de itens, e transições de descarte/protocolo.
 */

import { MAIN_FS, MAIN_VS, PARTICLE_FS, PARTICLE_VS } from "./glShaders";
import { GlMesh } from "./glGeometry";
import { SceneMeshes, buildIntern3DOffice } from "./glSceneMeshes";
import { GameCamera, CameraMode } from "./glCamera";
import { ParticleSystem } from "./glParticles";
import { Mat4, Vec3, Vec4, mat4, vec3 } from "./glMath";

export interface ItemTaskInfo {
  id: string;
  label: string;
  good: boolean;
  name: string;
}

export class InternOpenGLRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private canvas: HTMLCanvasElement | null = null;

  // Programas Shader
  private mainProgram: WebGLProgram | null = null;
  private particleProgram: WebGLProgram | null = null;

  // Câmera & Partículas
  public camera: GameCamera;
  private particles: ParticleSystem | null = null;

  // Meshes
  private meshes: Record<string, GlMesh> = {};

  // Uniform Locations - Main Shader
  private uModelLoc: WebGLUniformLocation | null = null;
  private uViewLoc: WebGLUniformLocation | null = null;
  private uProjLoc: WebGLUniformLocation | null = null;
  private uNormMatLoc: WebGLUniformLocation | null = null;

  private uCameraPosLoc: WebGLUniformLocation | null = null;
  private uDirLightDirLoc: WebGLUniformLocation | null = null;
  private uDirLightColLoc: WebGLUniformLocation | null = null;
  private uAmbientColLoc: WebGLUniformLocation | null = null;

  private uLaserPosLoc: WebGLUniformLocation | null = null;
  private uLaserColLoc: WebGLUniformLocation | null = null;
  private uLaserIntLoc: WebGLUniformLocation | null = null;

  private uLedPosLoc: WebGLUniformLocation | null = null;
  private uLedColLoc: WebGLUniformLocation | null = null;
  private uLedIntLoc: WebGLUniformLocation | null = null;

  private uShininessLoc: WebGLUniformLocation | null = null;
  private uSpecStrengthLoc: WebGLUniformLocation | null = null;
  private uEmissiveLoc: WebGLUniformLocation | null = null;
  private uTimeLoc: WebGLUniformLocation | null = null;
  private uScanlineLoc: WebGLUniformLocation | null = null;

  // Uniform Locations - Particle Shader
  private uPartViewLoc: WebGLUniformLocation | null = null;
  private uPartProjLoc: WebGLUniformLocation | null = null;

  // Estado do jogo / Animações
  public currentItem: ItemTaskInfo | null = null;
  private elapsedTime = 0;

  // Animação do Scanner Laser
  private laserActive = false;
  private laserProgress = 0; // 0 a 1

  // Animação do Carimbo
  private stampActive = false;
  private stampProgress = 0; // 0 a 1
  private stampY = 1.6;

  // Animação do Item Atual (Entrada, Flutuação, Saída)
  private itemState: "entering" | "idle" | "stamped" | "discarded" = "idle";
  private itemAnimProgress = 1.0;
  private itemPos: Vec3 = [0, 0.95, 0.05];
  private itemRotY = 0;
  private itemScale: Vec3 = [1, 1, 1];

  private animFrameId: number | null = null;
  private lastTime = 0;
  private isDestroyed = false;

  constructor() {
    this.camera = new GameCamera(1.0);
  }

  init(canvas: HTMLCanvasElement): boolean {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      antialias: true,
      alpha: false,
      depth: true,
      powerPreference: "high-performance"
    });

    if (!gl) {
      console.error("[OpenGL] WebGL2 not supported on this platform.");
      return false;
    }

    this.gl = gl;
    this.isDestroyed = false;

    // 1. Setup OpenGL State
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.06, 0.07, 0.09, 1.0);

    // 2. Compilar Shaders
    this.mainProgram = this.createShaderProgram(MAIN_VS, MAIN_FS);
    this.particleProgram = this.createShaderProgram(PARTICLE_VS, PARTICLE_FS);

    if (!this.mainProgram || !this.particleProgram) {
      return false;
    }

    // 3. Cache Uniforms Main Shader
    this.uModelLoc = gl.getUniformLocation(this.mainProgram, "uModel");
    this.uViewLoc = gl.getUniformLocation(this.mainProgram, "uView");
    this.uProjLoc = gl.getUniformLocation(this.mainProgram, "uProjection");
    this.uNormMatLoc = gl.getUniformLocation(this.mainProgram, "uNormalMatrix");

    this.uCameraPosLoc = gl.getUniformLocation(this.mainProgram, "uCameraPos");
    this.uDirLightDirLoc = gl.getUniformLocation(this.mainProgram, "uDirLightDir");
    this.uDirLightColLoc = gl.getUniformLocation(this.mainProgram, "uDirLightColor");
    this.uAmbientColLoc = gl.getUniformLocation(this.mainProgram, "uAmbientColor");

    this.uLaserPosLoc = gl.getUniformLocation(this.mainProgram, "uLaserPos");
    this.uLaserColLoc = gl.getUniformLocation(this.mainProgram, "uLaserColor");
    this.uLaserIntLoc = gl.getUniformLocation(this.mainProgram, "uLaserIntensity");

    this.uLedPosLoc = gl.getUniformLocation(this.mainProgram, "uLedPos");
    this.uLedColLoc = gl.getUniformLocation(this.mainProgram, "uLedColor");
    this.uLedIntLoc = gl.getUniformLocation(this.mainProgram, "uLedIntensity");

    this.uShininessLoc = gl.getUniformLocation(this.mainProgram, "uShininess");
    this.uSpecStrengthLoc = gl.getUniformLocation(this.mainProgram, "uSpecularStrength");
    this.uEmissiveLoc = gl.getUniformLocation(this.mainProgram, "uEmissive");
    this.uTimeLoc = gl.getUniformLocation(this.mainProgram, "uTime");
    this.uScanlineLoc = gl.getUniformLocation(this.mainProgram, "uScanlineEffect");

    // Cache Uniforms Particle Shader
    this.uPartViewLoc = gl.getUniformLocation(this.particleProgram, "uView");
    this.uPartProjLoc = gl.getUniformLocation(this.particleProgram, "uProjection");

    // 4. Inicializar Partículas e Geometrias
    this.particles = new ParticleSystem(gl);
    const sceneData = buildIntern3DOffice();
    for (const [key, data] of Object.entries(sceneData)) {
      this.meshes[key] = new GlMesh(gl, data);
    }

    // 5. Iniciar loop de renderização
    this.resize(canvas.clientWidth || 800, canvas.clientHeight || 600);
    this.lastTime = performance.now();
    this.startLoop();

    return true;
  }

  resize(width: number, height: number) {
    if (!this.gl || !this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));

    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }
    this.camera.setAspect(w / h);
  }

  setCameraMode(mode: CameraMode) {
    this.camera.setMode(mode);
  }

  setItem(item: ItemTaskInfo) {
    this.currentItem = item;
    this.itemState = "entering";
    this.itemAnimProgress = 0;
    this.itemPos = [0.7, 1.4, -0.3]; // Entra da bandeja de entrada
    this.itemScale = [0.1, 0.1, 0.1];
  }

  triggerAction(action: "stamp" | "next" | "error" | "scan") {
    if (!this.currentItem) return;

    if (action === "stamp") {
      this.stampActive = true;
      this.stampProgress = 0;
      this.itemState = "stamped";
      this.itemAnimProgress = 0;
      this.camera.triggerShake(0.06, 0.2);

      // Disparar confetes/estrelas de sucesso
      if (this.particles) {
        this.particles.emit([this.itemPos[0], this.itemPos[1] + 0.1, this.itemPos[2]], 45, "stamp_success");
      }
    } else if (action === "next") {
      this.itemState = "discarded";
      this.itemAnimProgress = 0;

      // Disparar papéis voando para a lixeira
      if (this.particles) {
        this.particles.emit([this.itemPos[0], this.itemPos[1] + 0.1, this.itemPos[2]], 20, "trash_discard");
      }
    } else if (action === "error") {
      this.camera.triggerShake(0.12, 0.35);
      if (this.particles) {
        this.particles.emit([this.itemPos[0], this.itemPos[1] + 0.1, this.itemPos[2]], 35, "error_glitch");
      }
    } else if (action === "scan") {
      this.laserActive = true;
      this.laserProgress = 0;
    }
  }

  private startLoop() {
    const loop = (now: number) => {
      if (this.isDestroyed) return;
      const dt = Math.min((now - this.lastTime) / 1000, 0.1);
      this.lastTime = now;

      this.update(dt);
      this.render();

      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  private update(dt: number) {
    this.elapsedTime += dt;
    this.camera.update(dt);

    // Partículas contínuas de vapor na xícara de café se o item atual for café
    if (this.currentItem?.id === "cafe" && this.itemState === "idle" && this.particles) {
      if (Math.random() < 0.35) {
        this.particles.emit([this.itemPos[0], this.itemPos[1] + 0.22, this.itemPos[2]], 1, "coffee_steam");
      }
    }

    if (this.particles) {
      this.particles.update(dt);
    }

    // Atualizar Scanner Laser
    if (this.laserActive) {
      this.laserProgress += dt * 1.8;
      if (this.laserProgress >= 1.0) {
        this.laserActive = false;
        this.laserProgress = 0;
      } else if (this.particles && Math.random() < 0.4) {
        const scanZ = -0.4 + this.laserProgress * 0.4;
        this.particles.emit([-0.65, 1.22, scanZ], 2, "laser_sparks");
      }
    }

    // Atualizar Animação do Carimbo
    if (this.stampActive) {
      this.stampProgress += dt * 3.5;
      if (this.stampProgress >= 1.0) {
        this.stampActive = false;
        this.stampProgress = 0;
        this.stampY = 1.6;
      } else {
        // Movimento de descida rápida e retorno suave
        const t = this.stampProgress;
        if (t < 0.4) {
          // Descida rápida de impacto
          const p = t / 0.4;
          this.stampY = 1.6 - (1.6 - 0.98) * (p * p);
        } else {
          // Subida suave
          const p = (t - 0.4) / 0.6;
          this.stampY = 0.98 + (1.6 - 0.98) * Math.sin(p * Math.PI * 0.5);
        }
      }
    }

    // Atualizar Física / Posição do Item Atual
    if (this.itemState === "entering") {
      this.itemAnimProgress += dt * 3.0;
      const t = Math.min(1.0, this.itemAnimProgress);
      const ease = 1 - Math.pow(1 - t, 3); // Cubic out
      this.itemPos = [
        0.7 * (1 - ease) + 0.0 * ease,
        1.4 * (1 - ease) + 0.95 * ease,
        -0.3 * (1 - ease) + 0.05 * ease
      ];
      this.itemScale = [0.2 + 0.8 * ease, 0.2 + 0.8 * ease, 0.2 + 0.8 * ease];
      this.itemRotY = (1 - ease) * -1.5;
      if (t >= 1.0) {
        this.itemState = "idle";
      }
    } else if (this.itemState === "idle") {
      // Flutuação / respiração suave
      this.itemPos = [0, 0.95 + Math.sin(this.elapsedTime * 3.0) * 0.015, 0.05];
      this.itemScale = [1, 1, 1];
      this.itemRotY = Math.sin(this.elapsedTime * 1.5) * 0.08;
    } else if (this.itemState === "stamped") {
      this.itemAnimProgress += dt * 2.5;
      const t = Math.min(1.0, this.itemAnimProgress);
      // Move em direção à bandeja de saída aprovada (Out-tray)
      this.itemPos = [
        0.0 * (1 - t) + 0.7 * t,
        0.95 + Math.sin(t * Math.PI) * 0.35,
        0.05 * (1 - t) + 0.35 * t
      ];
      this.itemScale = [1 - t * 0.2, 1 - t * 0.2, 1 - t * 0.2];
    } else if (this.itemState === "discarded") {
      this.itemAnimProgress += dt * 2.2;
      const t = Math.min(1.0, this.itemAnimProgress);
      // Salto parabólico até a lixeira
      this.itemPos = [
        0.0 * (1 - t) + 0.85 * t,
        0.95 + Math.sin(t * Math.PI) * 0.6 - t * 0.5,
        0.05 * (1 - t) + 0.85 * t
      ];
      this.itemRotY += dt * 6.0;
      this.itemScale = [1 - t * 0.6, 1 - t * 0.6, 1 - t * 0.6];
    }
  }

  private render() {
    const gl = this.gl;
    if (!gl || !this.mainProgram || !this.particleProgram) return;

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // ==========================================
    // 1. RENDER DA CENA 3D PRINCIPAL (MAIN SHADER)
    // ==========================================
    gl.useProgram(this.mainProgram);

    // Set Uniforms de Câmera
    gl.uniformMatrix4fv(this.uViewLoc, false, this.camera.viewMatrix);
    gl.uniformMatrix4fv(this.uProjLoc, false, this.camera.projMatrix);
    gl.uniform3fv(this.uCameraPosLoc, this.camera.position);

    // Iluminação Global (Luz Solar Direcional + Ambiente)
    gl.uniform3f(this.uDirLightDirLoc, -0.6, -1.0, -0.7);
    gl.uniform3f(this.uDirLightColLoc, 1.0, 0.98, 0.92);
    gl.uniform3f(this.uAmbientColLoc, 0.35, 0.38, 0.45);

    // Scanner Laser Point Light
    const laserZ = -0.4 + this.laserProgress * 0.4;
    gl.uniform3f(this.uLaserPosLoc, -0.65, 1.25, laserZ);
    gl.uniform3f(this.uLaserColLoc, 0.1, 0.95, 0.8);
    gl.uniform1f(this.uLaserIntLoc, this.laserActive ? 2.5 : 0.0);

    // Status LED Point Light
    const isError = this.currentItem && !this.currentItem.good;
    gl.uniform3f(this.uLedPosLoc, -0.45, 1.15, 0.2);
    gl.uniform3f(this.uLedColLoc, isError ? 1.0 : 0.2, isError ? 0.2 : 0.9, 0.3);
    gl.uniform1f(this.uLedIntLoc, 1.2);

    gl.uniform1f(this.uTimeLoc, this.elapsedTime);
    gl.uniform1f(this.uScanlineLoc, 0.0);

    const modelMat = mat4.create();
    const normMat = new Float32Array(9);

    const drawMesh = (
      meshKey: string,
      modelMatrix: Mat4,
      material: { shininess?: number; spec?: number; emissive?: number; scanline?: number } = {}
    ) => {
      const mesh = this.meshes[meshKey];
      if (!mesh) return;

      gl.uniformMatrix4fv(this.uModelLoc, false, modelMatrix);

      // Normal Matrix (3x3 do topo esquerdo da model)
      normMat[0] = modelMatrix[0]; normMat[1] = modelMatrix[1]; normMat[2] = modelMatrix[2];
      normMat[3] = modelMatrix[4]; normMat[4] = modelMatrix[5]; normMat[5] = modelMatrix[6];
      normMat[6] = modelMatrix[8]; normMat[7] = modelMatrix[9]; normMat[8] = modelMatrix[10];
      gl.uniformMatrix3fv(this.uNormMatLoc, false, normMat);

      gl.uniform1f(this.uShininessLoc, material.shininess ?? 32.0);
      gl.uniform1f(this.uSpecStrengthLoc, material.spec ?? 0.4);
      gl.uniform1f(this.uEmissiveLoc, material.emissive ?? 0.0);
      gl.uniform1f(this.uScanlineLoc, material.scanline ?? 0.0);

      mesh.draw();
    };

    // A. Desenhar Sala & Parede
    mat4.identity(modelMat);
    drawMesh("officeRoom", modelMat, { shininess: 8.0, spec: 0.1 });

    // B. Desenhar Mesa de Trabalho
    mat4.identity(modelMat);
    drawMesh("workDesk", modelMat, { shininess: 48.0, spec: 0.6 });

    // C. Desenhar Estação de Scanner
    mat4.identity(modelMat);
    drawMesh("scannerStation", modelMat, { shininess: 64.0, spec: 0.8 });

    // D. Desenhar Feixe Laser do Scanner se ativo
    if (this.laserActive) {
      mat4.identity(modelMat);
      mat4.translate(modelMat, modelMat, [-0.65, 1.21, laserZ]);
      drawMesh("laserBeam", modelMat, { emissive: 0.9, scanline: 1.0 });
    }

    // E. Desenhar Lixeira
    mat4.identity(modelMat);
    drawMesh("trashCan", modelMat, { shininess: 40.0, spec: 0.5 });

    // F. Desenhar Carimbo 3D
    mat4.identity(modelMat);
    mat4.translate(modelMat, modelMat, [0, this.stampY, 0.05]);
    drawMesh("stampDevice", modelMat, { shininess: 60.0, spec: 0.9 });

    // G. Desenhar Modelo 3D do Item Atual
    if (this.currentItem) {
      mat4.identity(modelMat);
      mat4.translate(modelMat, modelMat, this.itemPos);
      mat4.rotateY(modelMat, modelMat, this.itemRotY);
      mat4.scale(modelMat, modelMat, this.itemScale);

      const meshKey = this.resolveMeshForItem(this.currentItem.id);
      drawMesh(meshKey, modelMat, {
        shininess: this.currentItem.id === "cafe" ? 80.0 : 24.0,
        spec: 0.5
      });
    }

    // ==========================================
    // 2. RENDER DE PARTÍCULAS 3D (PARTICLE SHADER)
    // ==========================================
    if (this.particles) {
      gl.useProgram(this.particleProgram);
      gl.uniformMatrix4fv(this.uPartViewLoc, false, this.camera.viewMatrix);
      gl.uniformMatrix4fv(this.uPartProjLoc, false, this.camera.projMatrix);
      this.particles.draw(gl);
    }
  }

  private resolveMeshForItem(id: string): string {
    switch (id) {
      case "carimbo":
      case "contrato":
        return "contractPaper";
      case "cafe":
        return "coffeeCup";
      case "grampo":
      case "pasta":
        return "documentFolder";
      case "spam":
        return "spamFlyer";
      case "email":
        return "letterSealed";
      case "meme":
        return "memeFrog";
      case "cracha":
        return "badgeCard";
      default:
        return "documentFolder";
    }
  }

  private createShaderProgram(vsSource: string, fsSource: string): WebGLProgram | null {
    const gl = this.gl;
    if (!gl) return null;

    const vs = this.compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSource);
    if (!vs || !fs) return null;

    const program = gl.createProgram();
    if (!program) return null;

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("[OpenGL] Shader Program link error:", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }

    return program;
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl;
    if (!gl) return null;

    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("[OpenGL] Shader compile error:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  destroy() {
    this.isDestroyed = true;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    for (const mesh of Object.values(this.meshes)) {
      mesh.destroy();
    }
    this.meshes = {};

    if (this.particles) {
      this.particles.destroy();
      this.particles = null;
    }

    const gl = this.gl;
    if (gl) {
      if (this.mainProgram) gl.deleteProgram(this.mainProgram);
      if (this.particleProgram) gl.deleteProgram(this.particleProgram);
      this.mainProgram = null;
      this.particleProgram = null;
    }
  }
}
