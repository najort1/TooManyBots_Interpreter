/**
 * Sistema de Partículas 3D GPU em WebGL2
 * Suporta emissores dinâmicos para:
 * - Fumaça/Vapor de Café
 * - Faíscas Laser do Scanner
 * - Confetes & Estrelas de Sucesso (Protocolado com perfeição)
 * - Glitch & Faíscas Vermelhas de Erro / Lixeira
 */

import { Vec3 } from "./glMath";

export interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  g: number;
  b: number;
  a: number;
  size: number;
  life: number;
  maxLife: number;
}

export class ParticleSystem {
  private particles: Particle[] = [];
  private maxParticles = 600;
  private vao: WebGLVertexArrayObject | null = null;
  private vboPos: WebGLBuffer | null = null;
  private vboCol: WebGLBuffer | null = null;
  private vboSize: WebGLBuffer | null = null;

  private posArray = new Float32Array(this.maxParticles * 3);
  private colArray = new Float32Array(this.maxParticles * 4);
  private sizeArray = new Float32Array(this.maxParticles);

  constructor(private gl: WebGL2RenderingContext) {
    this.initGL();
  }

  private initGL() {
    const gl = this.gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    this.vboPos = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vboPos);
    gl.bufferData(gl.ARRAY_BUFFER, this.posArray.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    this.vboCol = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vboCol);
    gl.bufferData(gl.ARRAY_BUFFER, this.colArray.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);

    this.vboSize = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vboSize);
    gl.bufferData(gl.ARRAY_BUFFER, this.sizeArray.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
  }

  emit(
    origin: Vec3,
    count: number,
    type: "laser_sparks" | "coffee_steam" | "stamp_success" | "trash_discard" | "error_glitch"
  ) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.maxParticles) {
        this.particles.shift();
      }

      let p: Particle;

      if (type === "laser_sparks") {
        const spread = (Math.random() - 0.5) * 0.4;
        p = {
          x: origin[0] + spread,
          y: origin[1] + (Math.random() - 0.5) * 0.05,
          z: origin[2] + (Math.random() - 0.5) * 0.1,
          vx: (Math.random() - 0.5) * 0.8,
          vy: 0.5 + Math.random() * 0.8,
          vz: (Math.random() - 0.5) * 0.8,
          r: 0.2,
          g: 0.9 + Math.random() * 0.1,
          b: 0.9,
          a: 1.0,
          size: 0.12 + Math.random() * 0.1,
          life: 0,
          maxLife: 0.35 + Math.random() * 0.3
        };
      } else if (type === "coffee_steam") {
        p = {
          x: origin[0] + (Math.random() - 0.5) * 0.15,
          y: origin[1],
          z: origin[2] + (Math.random() - 0.5) * 0.15,
          vx: (Math.random() - 0.5) * 0.1,
          vy: 0.35 + Math.random() * 0.25,
          vz: (Math.random() - 0.5) * 0.1,
          r: 0.95,
          g: 0.92,
          b: 0.88,
          a: 0.45,
          size: 0.15 + Math.random() * 0.12,
          life: 0,
          maxLife: 1.2 + Math.random() * 0.8
        };
      } else if (type === "stamp_success") {
        // Confetes coloridos e estrelas douradas
        const angle = Math.random() * Math.PI * 2;
        const speed = 1.2 + Math.random() * 1.5;
        const colors = [
          [1.0, 0.85, 0.2], // Dourado
          [0.2, 0.9, 0.4],  // Verde esmeralda
          [0.3, 0.7, 1.0],  // Azul ciano
          [1.0, 0.4, 0.7]   // Magenta
        ];
        const col = colors[Math.floor(Math.random() * colors.length)];
        p = {
          x: origin[0] + (Math.random() - 0.5) * 0.2,
          y: origin[1] + 0.1,
          z: origin[2] + (Math.random() - 0.5) * 0.2,
          vx: Math.cos(angle) * speed,
          vy: 1.5 + Math.random() * 2.0,
          vz: Math.sin(angle) * speed,
          r: col[0],
          g: col[1],
          b: col[2],
          a: 1.0,
          size: 0.18 + Math.random() * 0.15,
          life: 0,
          maxLife: 0.8 + Math.random() * 0.6
        };
      } else if (type === "trash_discard") {
        // Papéis voando em arco para a lixeira
        p = {
          x: origin[0],
          y: origin[1] + 0.1,
          z: origin[2],
          vx: 1.8 + Math.random() * 0.8,
          vy: 2.0 + Math.random() * 1.0,
          vz: (Math.random() - 0.5) * 0.6,
          r: 0.85,
          g: 0.85,
          b: 0.85,
          a: 0.9,
          size: 0.12 + Math.random() * 0.1,
          life: 0,
          maxLife: 0.75 + Math.random() * 0.25
        };
      } else {
        // error_glitch: faíscas vermelhas / cinzas
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.8 + Math.random() * 1.2;
        p = {
          x: origin[0],
          y: origin[1] + 0.1,
          z: origin[2],
          vx: Math.cos(angle) * speed,
          vy: 1.0 + Math.random() * 1.5,
          vz: Math.sin(angle) * speed,
          r: 1.0,
          g: 0.15,
          b: 0.2,
          a: 1.0,
          size: 0.14 + Math.random() * 0.1,
          life: 0,
          maxLife: 0.6 + Math.random() * 0.4
        };
      }

      this.particles.push(p);
    }
  }

  update(dt: number) {
    const gravity = -3.8;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        this.particles.splice(i, 1);
        continue;
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      // Gravidade para quase tudo, exceto fumaça que sobe
      if (p.vy > 0 && p.maxLife > 1.0) {
        p.vx *= 0.98;
        p.vz *= 0.98;
      } else {
        p.vy += gravity * dt;
      }

      // Fade out de transparência
      const progress = p.life / p.maxLife;
      p.a = (1.0 - progress);
    }
  }

  draw(gl: WebGL2RenderingContext) {
    if (this.particles.length === 0 || !this.vao) return;

    const count = this.particles.length;
    for (let i = 0; i < count; i++) {
      const p = this.particles[i];
      this.posArray[i * 3 + 0] = p.x;
      this.posArray[i * 3 + 1] = p.y;
      this.posArray[i * 3 + 2] = p.z;

      this.colArray[i * 4 + 0] = p.r;
      this.colArray[i * 4 + 1] = p.g;
      this.colArray[i * 4 + 2] = p.b;
      this.colArray[i * 4 + 3] = p.a;

      this.sizeArray[i] = p.size;
    }

    gl.bindVertexArray(this.vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vboPos);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.posArray.subarray(0, count * 3));

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vboCol);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.colArray.subarray(0, count * 4));

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vboSize);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.sizeArray.subarray(0, count));

    gl.drawArrays(gl.POINTS, 0, count);

    gl.bindVertexArray(null);
  }

  destroy() {
    const gl = this.gl;
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.vboPos) gl.deleteBuffer(this.vboPos);
    if (this.vboCol) gl.deleteBuffer(this.vboCol);
    if (this.vboSize) gl.deleteBuffer(this.vboSize);
    this.particles = [];
  }
}
