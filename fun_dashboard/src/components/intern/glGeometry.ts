/**
 * Construtor e gerenciador de geometrias 3D procedurais para OpenGL / WebGL2
 * Cria caixas chanfradas, cilindros, papéis, pastas, xícaras, clipes, carimbos e lixeiras com buffers VBO e VAO nativos.
 */

import { Vec3, Vec4 } from "./glMath";

export interface MeshData {
  positions: number[];
  normals: number[];
  colors: number[];
  uvs: number[];
  indices: number[];
}

export class GeometryBuilder {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];
  private vertexCount = 0;

  clear() {
    this.positions = [];
    this.normals = [];
    this.colors = [];
    this.uvs = [];
    this.indices = [];
    this.vertexCount = 0;
  }

  addVertex(pos: Vec3, normal: Vec3, color: Vec4, uv: [number, number] = [0, 0]) {
    this.positions.push(pos[0], pos[1], pos[2]);
    this.normals.push(normal[0], normal[1], normal[2]);
    this.colors.push(color[0], color[1], color[2], color[3]);
    this.uvs.push(uv[0], uv[1]);
    return this.vertexCount++;
  }

  addQuad(
    p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3,
    normal: Vec3,
    color: Vec4,
    uvs?: [[number, number], [number, number], [number, number], [number, number]]
  ) {
    const uv0 = uvs ? uvs[0] : [0, 0];
    const uv1 = uvs ? uvs[1] : [1, 0];
    const uv2 = uvs ? uvs[2] : [1, 1];
    const uv3 = uvs ? uvs[3] : [0, 1];

    const i0 = this.addVertex(p0, normal, color, uv0 as [number, number]);
    const i1 = this.addVertex(p1, normal, color, uv1 as [number, number]);
    const i2 = this.addVertex(p2, normal, color, uv2 as [number, number]);
    const i3 = this.addVertex(p3, normal, color, uv3 as [number, number]);

    this.indices.push(i0, i1, i2, i0, i2, i3);
  }

  addBox(
    center: Vec3,
    size: Vec3,
    color: Vec4,
    faceColors?: {
      top?: Vec4;
      bottom?: Vec4;
      front?: Vec4;
      back?: Vec4;
      left?: Vec4;
      right?: Vec4;
    }
  ) {
    const cx = center[0], cy = center[1], cz = center[2];
    const hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2;

    const cTop = faceColors?.top || color;
    const cBottom = faceColors?.bottom || color;
    const cFront = faceColors?.front || color;
    const cBack = faceColors?.back || color;
    const cLeft = faceColors?.left || color;
    const cRight = faceColors?.right || color;

    // Top (+Y)
    this.addQuad(
      [cx - hx, cy + hy, cz - hz],
      [cx + hx, cy + hy, cz - hz],
      [cx + hx, cy + hy, cz + hz],
      [cx - hx, cy + hy, cz + hz],
      [0, 1, 0],
      cTop
    );

    // Bottom (-Y)
    this.addQuad(
      [cx - hx, cy - hy, cz + hz],
      [cx + hx, cy - hy, cz + hz],
      [cx + hx, cy - hy, cz - hz],
      [cx - hx, cy - hy, cz - hz],
      [0, -1, 0],
      cBottom
    );

    // Front (+Z)
    this.addQuad(
      [cx - hx, cy - hy, cz + hz],
      [cx + hx, cy - hy, cz + hz],
      [cx + hx, cy + hy, cz + hz],
      [cx - hx, cy + hy, cz + hz],
      [0, 0, 1],
      cFront
    );

    // Back (-Z)
    this.addQuad(
      [cx + hx, cy - hy, cz - hz],
      [cx - hx, cy - hy, cz - hz],
      [cx - hx, cy + hy, cz - hz],
      [cx + hx, cy + hy, cz - hz],
      [0, 0, -1],
      cBack
    );

    // Left (-X)
    this.addQuad(
      [cx - hx, cy - hy, cz - hz],
      [cx - hx, cy - hy, cz + hz],
      [cx - hx, cy + hy, cz + hz],
      [cx - hx, cy + hy, cz - hz],
      [-1, 0, 0],
      cLeft
    );

    // Right (+X)
    this.addQuad(
      [cx + hx, cy - hy, cz + hz],
      [cx + hx, cy - hy, cz - hz],
      [cx + hx, cy + hy, cz - hz],
      [cx + hx, cy + hy, cz + hz],
      [1, 0, 0],
      cRight
    );
  }

  addCylinder(
    center: Vec3,
    radiusTop: number,
    radiusBottom: number,
    height: number,
    segments: number,
    color: Vec4,
    topCap = true,
    bottomCap = true
  ) {
    const cx = center[0], cy = center[1], cz = center[2];
    const halfH = height / 2;

    // Side quads
    for (let i = 0; i < segments; i++) {
      const theta1 = (i / segments) * Math.PI * 2;
      const theta2 = ((i + 1) / segments) * Math.PI * 2;

      const cos1 = Math.cos(theta1), sin1 = Math.sin(theta1);
      const cos2 = Math.cos(theta2), sin2 = Math.sin(theta2);

      const p0: Vec3 = [cx + radiusBottom * cos1, cy - halfH, cz + radiusBottom * sin1];
      const p1: Vec3 = [cx + radiusBottom * cos2, cy - halfH, cz + radiusBottom * sin2];
      const p2: Vec3 = [cx + radiusTop * cos2, cy + halfH, cz + radiusTop * sin2];
      const p3: Vec3 = [cx + radiusTop * cos1, cy + halfH, cz + radiusTop * sin1];

      const midCos = Math.cos((theta1 + theta2) / 2);
      const midSin = Math.sin((theta1 + theta2) / 2);
      const normal: Vec3 = [midCos, 0, midSin];

      this.addQuad(p0, p1, p2, p3, normal, color);
    }

    // Top cap
    if (topCap) {
      const centerTop: Vec3 = [cx, cy + halfH, cz];
      const normTop: Vec3 = [0, 1, 0];
      const cIndex = this.addVertex(centerTop, normTop, color);

      const ringIndices: number[] = [];
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        const p: Vec3 = [cx + radiusTop * Math.cos(theta), cy + halfH, cz + radiusTop * Math.sin(theta)];
        ringIndices.push(this.addVertex(p, normTop, color));
      }

      for (let i = 0; i < segments; i++) {
        this.indices.push(cIndex, ringIndices[i], ringIndices[i + 1]);
      }
    }

    // Bottom cap
    if (bottomCap) {
      const centerBot: Vec3 = [cx, cy - halfH, cz];
      const normBot: Vec3 = [0, -1, 0];
      const cIndex = this.addVertex(centerBot, normBot, color);

      const ringIndices: number[] = [];
      for (let i = 0; i <= segments; i++) {
        const theta = (i / segments) * Math.PI * 2;
        const p: Vec3 = [cx + radiusBottom * Math.cos(theta), cy - halfH, cz + radiusBottom * Math.sin(theta)];
        ringIndices.push(this.addVertex(p, normBot, color));
      }

      for (let i = 0; i < segments; i++) {
        this.indices.push(cIndex, ringIndices[i + 1], ringIndices[i]);
      }
    }
  }

  getMeshData(): MeshData {
    return {
      positions: [...this.positions],
      normals: [...this.normals],
      colors: [...this.colors],
      uvs: [...this.uvs],
      indices: [...this.indices]
    };
  }
}

export class GlMesh {
  vao: WebGLVertexArrayObject | null = null;
  vboPositions: WebGLBuffer | null = null;
  vboNormals: WebGLBuffer | null = null;
  vboColors: WebGLBuffer | null = null;
  vboUvs: WebGLBuffer | null = null;
  ebo: WebGLBuffer | null = null;
  indexCount = 0;

  constructor(private gl: WebGL2RenderingContext, data: MeshData) {
    this.upload(data);
  }

  upload(data: MeshData) {
    const gl = this.gl;
    this.indexCount = data.indices.length;

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    // Positions (Location 0)
    this.vboPositions = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vboPositions);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.positions), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    // Normals (Location 1)
    this.vboNormals = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vboNormals);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.normals), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    // Colors (Location 2)
    this.vboColors = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vboColors);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.colors), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 0, 0);

    // UVs (Location 3)
    this.vboUvs = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vboUvs);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.uvs), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 0, 0);

    // Indices EBO
    this.ebo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ebo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(data.indices), gl.STATIC_DRAW);

    gl.bindVertexArray(null);
  }

  draw() {
    if (!this.vao || this.indexCount === 0) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }

  destroy() {
    const gl = this.gl;
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.vboPositions) gl.deleteBuffer(this.vboPositions);
    if (this.vboNormals) gl.deleteBuffer(this.vboNormals);
    if (this.vboColors) gl.deleteBuffer(this.vboColors);
    if (this.vboUvs) gl.deleteBuffer(this.vboUvs);
    if (this.ebo) gl.deleteBuffer(this.ebo);
    this.vao = null;
  }
}
