/**
 * Sistema de Câmera 3D Profissional para o Jogo do Estagiário
 * - Modos de Câmera: 'isometric' (perspectiva isométrica 3D clássica), 'first_person' (visão do operador na mesa), 'action' (zoom dinâmico focado no scanner e carimbo)
 * - Damping suave (lerp), Screen Shake em impactos/erros, FOV dinâmico
 */

import { Mat4, Vec3, mat4, vec3 } from "./glMath";

export type CameraMode = "isometric" | "first_person" | "action";

export class GameCamera {
  mode: CameraMode = "isometric";

  position: Vec3 = [0, 2.5, 3.5];
  target: Vec3 = [0, 0.2, 0];
  up: Vec3 = [0, 1, 0];

  targetPosition: Vec3 = [0, 2.5, 3.5];
  targetTarget: Vec3 = [0, 0.2, 0];

  fovRad = (45 * Math.PI) / 180;
  near = 0.1;
  far = 50.0;
  aspect = 1.0;

  viewMatrix: Mat4 = mat4.create();
  projMatrix: Mat4 = mat4.create();

  // Screen shake
  private shakeTime = 0;
  private shakeIntensity = 0;

  constructor(aspect = 1.0) {
    this.aspect = aspect;
    this.setMode("isometric");
    this.updateMatrices();
  }

  setMode(mode: CameraMode) {
    this.mode = mode;
    switch (mode) {
      case "isometric":
        // Visão isométrica elevada e elegante
        this.targetPosition = [1.8, 2.6, 2.4];
        this.targetTarget = [0, 0.1, 0];
        this.fovRad = (42 * Math.PI) / 180;
        break;
      case "first_person":
        // Visão do estagiário sentado na frente da mesa
        this.targetPosition = [0, 1.35, 1.85];
        this.targetTarget = [0, 0.3, -0.3];
        this.fovRad = (52 * Math.PI) / 180;
        break;
      case "action":
        // Câmera dramática de close no scanner/carimbo
        this.targetPosition = [-0.6, 1.2, 1.4];
        this.targetTarget = [-0.1, 0.4, 0];
        this.fovRad = (38 * Math.PI) / 180;
        break;
    }
  }

  triggerShake(intensity = 0.08, duration = 0.3) {
    this.shakeIntensity = intensity;
    this.shakeTime = duration;
  }

  update(dt: number) {
    // Lerp suave da posição e alvo
    const smooth = Math.min(1.0, dt * 6.0);
    vec3.lerp(this.position, this.position, this.targetPosition, smooth);
    vec3.lerp(this.target, this.target, this.targetTarget, smooth);

    // Screen Shake
    let offset: Vec3 = [0, 0, 0];
    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const amount = this.shakeIntensity * (this.shakeTime / 0.3);
      offset = [
        (Math.random() - 0.5) * amount,
        (Math.random() - 0.5) * amount,
        (Math.random() - 0.5) * amount
      ];
    }

    const eyeWithShake: Vec3 = [
      this.position[0] + offset[0],
      this.position[1] + offset[1],
      this.position[2] + offset[2]
    ];

    mat4.lookAt(this.viewMatrix, eyeWithShake, this.target, this.up);
    mat4.perspective(this.projMatrix, this.fovRad, this.aspect, this.near, this.far);
  }

  setAspect(aspect: number) {
    this.aspect = aspect;
    mat4.perspective(this.projMatrix, this.fovRad, this.aspect, this.near, this.far);
  }

  private updateMatrices() {
    mat4.lookAt(this.viewMatrix, this.position, this.target, this.up);
    mat4.perspective(this.projMatrix, this.fovRad, this.aspect, this.near, this.far);
  }
}
