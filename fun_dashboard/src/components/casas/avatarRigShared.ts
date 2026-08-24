"use client";

/**
 * Rig de avatar compartilhado entre a casa (HouseGame) e a rua (StreetWorld).
 * Garante que o personagem tenha EXATAMENTE o mesmo visual dentro e fora de casa.
 */
import * as Phaser from "phaser";
import { getAvatarOutfitColor } from "./avatarAppearance.js";
import { normalizePolygonPoints } from "./houseGeometry.js";

export const PAL = {
  wallLeft: 0x3b2757,
  wallRight: 0x30204b,
  wallEdge: 0x241735,
  floorA: 0x8d6bb0,
  floorB: 0x7c5ca1,
  floorHover: 0xb995d9,
  floorValid: 0x7bd9a0,
  floorInvalid: 0xe06a7a,
  gold: 0xffd76a,
  outline: 0x241735,
};

export const REDUCED_MOTION_KEY = "casas-reduced-motion";

export function motionAllowed(scene: Phaser.Scene) {
  return scene.registry.get(REDUCED_MOTION_KEY) !== true;
}

export function motionDuration(scene: Phaser.Scene, duration: number) {
  return motionAllowed(scene) ? duration : Math.min(60, duration);
}

export function alive(target: Phaser.GameObjects.GameObject) {
  return target.scene != null && target.active;
}

export function centeredPolygon(scene: Phaser.Scene, x: number, y: number, points: number[], fillColor?: number, fillAlpha?: number) {
  return scene.add.polygon(x, y, normalizePolygonPoints(points), fillColor, fillAlpha);
}

export function avatarLines(scene: Phaser.Scene, color: number, width: number, segments: number[][]) {
  const graphics = scene.add.graphics().lineStyle(width, color, 1);
  segments.forEach(([x1, y1, x2, y2]) => graphics.lineBetween(x1, y1, x2, y2));
  return graphics;
}

export type AvatarSlotsLike = Record<string, string | undefined>;
export type AvatarLike = { slots?: AvatarSlotsLike | null };

export type AvatarRig = {
  root: Phaser.GameObjects.Container;
  bobber: Phaser.GameObjects.Container;
  face: Phaser.GameObjects.Text;
  legL: Phaser.GameObjects.Rectangle;
  legR: Phaser.GameObjects.Rectangle;
  armL: Phaser.GameObjects.Rectangle;
  armR: Phaser.GameObjects.Rectangle;
  seatedLegs: Phaser.GameObjects.Container;
  seatedArms: Phaser.GameObjects.Container;
  breathing: Phaser.Tweens.Tween | null;
  walkTweens: Phaser.Tweens.Tween[];
  leanTween: Phaser.Tweens.Tween | null;
  seatTween: Phaser.Tweens.Tween | null;
  seatIdle: Phaser.Tweens.Tween | null;
  walking: boolean;
  seated: boolean;
};

function addAvatarBackAccessory(scene: Phaser.Scene, bobber: Phaser.GameObjects.Container, accessory: string | undefined) {
  if (accessory === "asas_pixel") {
    bobber.add([
      centeredPolygon(scene, -45, -34, [0, 12, -18, 12, -18, -2, -31, -2, -31, -24, -16, -24, -16, -12, 0, -12], 0xc8f1ff).setStrokeStyle(3, PAL.outline),
      centeredPolygon(scene, 45, -34, [0, 12, 18, 12, 18, -2, 31, -2, 31, -24, 16, -24, 16, -12, 0, -12], 0xd9c8ff).setStrokeStyle(3, PAL.outline),
    ]);
  } else if (accessory === "aura_vinil") {
    bobber.add([
      scene.add.ellipse(0, -35, 112, 158, 0x000000, 0).setStrokeStyle(4, 0x8cf4ff, 0.9),
      scene.add.ellipse(0, -35, 98, 142, 0x000000, 0).setStrokeStyle(2, 0xf79cff, 0.85),
    ]);
  }
}

function addAvatarOutfitDetails(scene: Phaser.Scene, bobber: Phaser.GameObjects.Container, outfit: string | undefined) {
  if (outfit === "jaqueta_neon") {
    bobber.add([
      scene.add.rectangle(0, -8, 4, 48, 0xffe082, 0.92),
      scene.add.triangle(-13, -27, -13, -8, 0, 10, 0, -12, 0xff82ba, 0.9).setStrokeStyle(2, 0xc22d70),
      scene.add.triangle(13, -27, 13, -8, 0, 10, 0, -12, 0xff82ba, 0.9).setStrokeStyle(2, 0xc22d70),
    ]);
  } else if (outfit === "terno_suspeito") {
    bobber.add([
      scene.add.triangle(0, -31, -15, -31, 0, -6, 15, -31, 0xf4f1e9).setStrokeStyle(2, 0x24324b),
      centeredPolygon(scene, 0, -11, [0, -10, 7, 0, 3, 19, -3, 19, -7, 0], 0xa33b4d).setStrokeStyle(2, 0x562331),
      avatarLines(scene, 0x1e2a45, 3, [[-25, -28, -4, -3], [25, -28, 4, -3]]),
    ]);
  } else if (outfit === "moletom_nuvem") {
    bobber.add([
      centeredPolygon(scene, 0, -27, [-20, -9, 0, 4, 20, -9, 20, 5, 0, 15, -20, 5], 0xd8efff).setStrokeStyle(3, 0x38658b),
      avatarLines(scene, 0xffffff, 2, [[-7, -21, -7, -7], [7, -21, 7, -7]]),
      scene.add.ellipse(0, 5, 30, 10, 0xd8efff).setStrokeStyle(2, 0x38658b),
    ]);
  } else if (outfit === "camisa_xadrez") {
    bobber.add(avatarLines(scene, 0xf5c7a9, 3, [
      [-18, -35, -18, 20], [0, -35, 0, 20], [18, -35, 18, 20],
      [-27, -20, 27, -20], [-27, 0, 27, 0],
    ]));
  } else if (outfit === "uniforme_arcade") {
    bobber.add([
      scene.add.rectangle(0, -26, 52, 14, 0x25254b),
      scene.add.rectangle(0, 2, 30, 21, 0x182238).setStrokeStyle(3, 0x7dfff2),
      avatarLines(scene, 0xffe15c, 3, [[-9, 2, -1, 2], [-5, -2, -5, 6], [7, 0, 10, 0]]),
    ]);
  } else if (outfit === "vestido_aurora") {
    bobber.add([
      avatarLines(scene, 0xffd6c4, 4, [[-22, -33, 0, -9], [0, -9, 22, -33]]),
      centeredPolygon(scene, 0, 18, [-25, -8, 25, -8, 35, 28, -35, 28], 0xd96ea8).setStrokeStyle(3, PAL.outline),
      avatarLines(scene, 0xffb38c, 3, [[-28, 18, 28, 18], [-31, 29, 31, 29]]),
    ]);
  } else if (outfit === "macacao_oficina") {
    bobber.add([
      avatarLines(scene, 0x5b4937, 5, [[-18, -35, -18, 5], [18, -35, 18, 5], [-18, -2, 18, -2]]),
      scene.add.rectangle(0, -8, 20, 13, 0xf0be62).setStrokeStyle(2, 0x5b4937),
      avatarLines(scene, 0xfff1b8, 2, [[-6, -8, 6, -8]]),
    ]);
  } else if (outfit === "jaqueta_colegial") {
    bobber.add([
      avatarLines(scene, 0xf7e5c1, 6, [[-20, -36, -20, 20], [20, -36, 20, 20]]),
      avatarLines(scene, 0x173d36, 3, [[0, -36, 0, 21]]),
      scene.add.rectangle(-8, -5, 12, 14, 0xf4c857).setStrokeStyle(2, 0x173d36),
    ]);
  } else if (outfit === "traje_astral") {
    bobber.add([
      avatarLines(scene, 0x9bc8ff, 4, [[-27, -28, 27, -28], [-24, 17, 24, 17]]),
      scene.add.rectangle(0, -4, 28, 22, 0x111b39).setStrokeStyle(3, 0x6be3ff),
      scene.add.circle(-5, -4, 4, 0xffdc75),
      avatarLines(scene, 0xf58cff, 2, [[5, -8, 10, -8], [5, 0, 10, 0]]),
    ]);
  }
}

function addAvatarHairFace(scene: Phaser.Scene, bobber: Phaser.GameObjects.Container, hair: string | undefined) {
  if (hair === "cabelo_caos") {
    bobber.add([
      scene.add.rectangle(0, -84, 58, 17, 0x633b2b).setStrokeStyle(3, PAL.outline),
      scene.add.rectangle(-22, -73, 13, 22, 0x633b2b).setStrokeStyle(3, PAL.outline),
      scene.add.rectangle(23, -73, 13, 22, 0x633b2b).setStrokeStyle(3, PAL.outline),
    ]);
  } else if (hair === "oculos_pixel") {
    bobber.add([
      scene.add.rectangle(-14, -54, 22, 15, 0x1b1430, 0.85).setStrokeStyle(3, 0x5fe8ff),
      scene.add.rectangle(14, -54, 22, 15, 0x1b1430, 0.85).setStrokeStyle(3, 0x5fe8ff),
      scene.add.rectangle(0, -54, 6, 4, 0x5fe8ff),
    ]);
  } else if (hair === "cabelo_cacheado") {
    bobber.add([
      scene.add.circle(-25, -82, 12, 0x412b43).setStrokeStyle(3, PAL.outline),
      scene.add.circle(-10, -91, 13, 0x412b43).setStrokeStyle(3, PAL.outline),
      scene.add.circle(7, -92, 14, 0x412b43).setStrokeStyle(3, PAL.outline),
      scene.add.circle(23, -84, 13, 0x412b43).setStrokeStyle(3, PAL.outline),
      scene.add.circle(-29, -68, 11, 0x412b43).setStrokeStyle(3, PAL.outline),
      scene.add.circle(29, -69, 11, 0x412b43).setStrokeStyle(3, PAL.outline),
    ]);
  } else if (hair === "franja_azul") {
    bobber.add(centeredPolygon(scene, 0, -79, [-31, 11, -31, -8, 0, -23, 31, -8, 31, 12, 19, -1, 10, 15, 0, -2, -11, 14, -20, -1], 0x398bc6).setStrokeStyle(4, PAL.outline));
  } else if (hair === "bone_beco") {
    bobber.add([
      scene.add.rectangle(0, -86, 56, 18, 0x7257d9).setStrokeStyle(4, PAL.outline),
      centeredPolygon(scene, 18, -76, [-18, -7, 29, -7, 36, 3, -18, 3], 0x513aa7).setStrokeStyle(3, PAL.outline),
      scene.add.rectangle(-12, -87, 11, 6, 0xffd35c),
    ]);
  } else if (hair === "bandana_pixel") {
    bobber.add([
      scene.add.rectangle(0, -75, 60, 12, 0xef5d6f).setStrokeStyle(3, PAL.outline),
      centeredPolygon(scene, 34, -68, [-7, -9, 15, -5, 4, 2, 15, 10, -9, 5], 0xef5d6f).setStrokeStyle(3, PAL.outline),
      avatarLines(scene, 0xffd6a6, 3, [[-20, -75, -12, -75], [-3, -77, 5, -77], [14, -75, 22, -75]]),
    ]);
  } else if (hair === "mascara_misterio") {
    bobber.add([
      centeredPolygon(scene, 0, -53, [-29, -11, 0, -19, 29, -11, 23, 11, 0, 18, -23, 11], 0x5e3d8f).setStrokeStyle(3, PAL.outline),
      scene.add.triangle(-13, -55, -19, -4, 0, -4, 6, 4, 0xffe6b0),
      scene.add.triangle(13, -55, -6, -4, 19, -4, 0, 4, 0xffe6b0),
    ]);
  } else if (hair === "cabelo_rosa") {
    bobber.add([
      scene.add.rectangle(-27, -55, 14, 62, 0xe667a3).setStrokeStyle(4, PAL.outline),
      scene.add.rectangle(27, -55, 14, 62, 0xe667a3).setStrokeStyle(4, PAL.outline),
      centeredPolygon(scene, 0, -82, [-30, 11, -29, -9, 0, -24, 29, -9, 30, 12, 12, -4, 3, 12, -7, -4, -17, 12], 0xe667a3).setStrokeStyle(4, PAL.outline),
    ]);
  } else if (hair === "chapeu_pescador") {
    bobber.add([
      centeredPolygon(scene, 0, -88, [-21, 8, -15, -17, 15, -17, 22, 8], 0xd5ad62).setStrokeStyle(4, PAL.outline),
      centeredPolygon(scene, 0, -76, [-39, -7, 39, -7, 49, 5, -49, 5], 0xe7c878).setStrokeStyle(4, PAL.outline),
    ]);
  }
}

function addAvatarFrontAccessory(scene: Phaser.Scene, bobber: Phaser.GameObjects.Container, accessory: string | undefined) {
  if (accessory === "coroa_papel") {
    bobber.add(centeredPolygon(scene, 0, -103, [-31, 12, -24, -15, -8, 4, 0, -18, 10, 4, 25, -15, 31, 12, 31, 23, -31, 23], 0xffe082).setStrokeStyle(4, 0x754e24));
  } else if (accessory === "corrente_brilho") {
    bobber.add([
      avatarLines(scene, 0xffd34f, 4, [[-19, -29, 0, -16], [0, -16, 19, -29]]),
      scene.add.circle(0, -13, 6, 0xffd34f).setStrokeStyle(3, 0x7b4d1b),
    ]);
  } else if (accessory === "fones_neon") {
    bobber.add([
      scene.add.ellipse(0, -66, 70, 62, 0x000000, 0).setStrokeStyle(5, 0x6cf5ff),
      scene.add.rectangle(-34, -53, 13, 28, 0x7638a8).setStrokeStyle(3, PAL.outline),
      scene.add.rectangle(34, -53, 13, 28, 0x7638a8).setStrokeStyle(3, PAL.outline),
    ]);
  } else if (accessory === "mochila_lateral") {
    bobber.add([
      avatarLines(scene, 0x45324f, 5, [[-16, -34, 34, 18]]),
      scene.add.rectangle(35, 10, 23, 31, 0xdb8c53).setStrokeStyle(3, PAL.outline),
      avatarLines(scene, 0xffe0a8, 3, [[26, 2, 44, 2]]),
    ]);
  } else if (accessory === "cachecol_estrelas") {
    bobber.add([
      centeredPolygon(scene, 0, -34, [-25, -8, 0, 2, 25, -8, 25, 5, 0, 15, -25, 5], 0x7056c8).setStrokeStyle(3, PAL.outline),
      centeredPolygon(scene, 16, -2, [-7, -25, 8, -25, 18, 28, 2, 31], 0x7056c8).setStrokeStyle(3, PAL.outline),
      scene.add.star(-10, -34, 5, 3, 7, 0xffe28b),
    ]);
  } else if (accessory === "bolsa_cogumelo") {
    bobber.add([
      avatarLines(scene, 0x6a3f47, 4, [[-20, -34, 33, 25]]),
      scene.add.rectangle(34, 19, 20, 21, 0xf5d8a8).setStrokeStyle(3, PAL.outline),
      scene.add.ellipse(34, 7, 30, 17, 0xee675f).setStrokeStyle(3, PAL.outline),
      scene.add.circle(29, 5, 2.5, 0xfff0d2),
      scene.add.circle(39, 7, 2.5, 0xfff0d2),
    ]);
  }
}

export function createAvatarRig(scene: Phaser.Scene, avatar: AvatarLike, name: string): AvatarRig {
  const slots: AvatarSlotsLike = avatar.slots ?? {};
  const outfit = slots.outfit;
  const hair = slots.hair_face;
  const accessory = slots.optional_accessory;
  const bodyColor = getAvatarOutfitColor(outfit || "camiseta_beco");

  const root = scene.add.container(0, 0);
  const bobber = scene.add.container(0, 0);
  addAvatarBackAccessory(scene, bobber, accessory);

  const legL = scene.add.rectangle(-12, 2, 14, 30, 0x332f54).setStrokeStyle(3, PAL.outline).setOrigin(0.5, 0);
  const legR = scene.add.rectangle(12, 2, 14, 30, 0x332f54).setStrokeStyle(3, PAL.outline).setOrigin(0.5, 0);
  const body = scene.add.rectangle(0, -8, 56, 58, bodyColor).setStrokeStyle(4, PAL.outline);
  const bodyShade = scene.add.rectangle(14, -8, 12, 58, 0x000000, 0.14);
  const shirtHighlight = scene.add.rectangle(-13, -13, 9, 36, 0xffffff, 0.22);
  const armL = scene.add.rectangle(-30, -30, 11, 34, bodyColor).setStrokeStyle(3, PAL.outline).setOrigin(0.5, 0).setRotation(0.16);
  const armR = scene.add.rectangle(30, -30, 11, 34, bodyColor).setStrokeStyle(3, PAL.outline).setOrigin(0.5, 0).setRotation(-0.16);
  const seatedLegs = scene.add.container(0, 2, [
    centeredPolygon(scene, 0, 0, [-26, 0, -5, 0, -14, 19, -35, 19], 0x454067).setStrokeStyle(3, PAL.outline),
    centeredPolygon(scene, 0, 0, [-35, 16, -18, 16, -18, 50, -35, 50], 0x332f54).setStrokeStyle(3, PAL.outline),
    scene.add.rectangle(-29, 51, 25, 9, 0x241f38).setStrokeStyle(2, PAL.outline),
    centeredPolygon(scene, 0, 0, [5, 0, 26, 0, 35, 19, 14, 19], 0x454067).setStrokeStyle(3, PAL.outline),
    centeredPolygon(scene, 0, 0, [18, 16, 35, 16, 35, 50, 18, 50], 0x332f54).setStrokeStyle(3, PAL.outline),
    scene.add.rectangle(29, 51, 25, 9, 0x241f38).setStrokeStyle(2, PAL.outline),
  ]).setAlpha(0).setVisible(false);
  const seatedArms = scene.add.container(0, -30, [
    centeredPolygon(scene, 0, 0, [-30, -2, -19, 0, -7, 23, -16, 28], bodyColor).setStrokeStyle(3, PAL.outline),
    scene.add.circle(-9, 25, 6, 0xffd6ba).setStrokeStyle(2, PAL.outline),
    centeredPolygon(scene, 0, 0, [19, 0, 30, -2, 16, 28, 7, 23], bodyColor).setStrokeStyle(3, PAL.outline),
    scene.add.circle(9, 25, 6, 0xffd6ba).setStrokeStyle(2, PAL.outline),
  ]).setAlpha(0).setVisible(false);

  const head = scene.add.container(0, -52);
  head.add([
    scene.add.circle(0, 0, 31, 0xffd6ba).setStrokeStyle(4, PAL.outline),
    scene.add.circle(-15, 8, 5, 0xf5a88c, 0.55),
    scene.add.circle(15, 8, 5, 0xf5a88c, 0.55),
  ]);
  const face = scene.add.text(0, -2, "•ᴗ•", { fontFamily: "monospace", fontSize: "19px", color: "#3a2740" }).setOrigin(0.5);
  head.add(face);
  bobber.add([legL, legR, armL, armR, body, bodyShade, shirtHighlight]);

  addAvatarOutfitDetails(scene, bobber, outfit);
  bobber.add(seatedLegs);
  bobber.add(seatedArms);

  // O rosto precisa ficar acima das lapelas e detalhes da roupa.
  bobber.add(head);

  addAvatarHairFace(scene, bobber, hair);
  addAvatarFrontAccessory(scene, bobber, accessory);

  const nameplate = scene.add.text(0, -122, name.toUpperCase(), { fontFamily: "monospace", fontSize: "12px", color: "#fff5d2", backgroundColor: "#2a1b43", padding: { x: 7, y: 4 } }).setOrigin(0.5);
  root.add([scene.add.ellipse(0, 30, 74, 20, 0x120d20, 0.32), bobber, nameplate]);

  const ambientMotion = motionAllowed(scene);
  const walkTweens = ambientMotion ? [
    scene.tweens.add({ targets: legL, rotation: { from: -0.5, to: 0.5 }, duration: 190, yoyo: true, repeat: -1, ease: "Sine.easeInOut" }),
    scene.tweens.add({ targets: legR, rotation: { from: 0.5, to: -0.5 }, duration: 190, yoyo: true, repeat: -1, ease: "Sine.easeInOut" }),
    scene.tweens.add({ targets: armL, rotation: { from: 0.34, to: -0.06 }, duration: 190, yoyo: true, repeat: -1, ease: "Sine.easeInOut" }),
    scene.tweens.add({ targets: armR, rotation: { from: -0.06, to: 0.34 }, duration: 190, yoyo: true, repeat: -1, ease: "Sine.easeInOut" }),
    scene.tweens.add({ targets: bobber, y: -7, duration: 95, yoyo: true, repeat: -1, ease: "Quad.easeOut" }),
  ] : [];
  const rig: AvatarRig = {
    root,
    bobber,
    face,
    legL,
    legR,
    armL,
    armR,
    seatedLegs,
    seatedArms,
    breathing: ambientMotion ? scene.tweens.add({ targets: bobber, y: -3, duration: 1800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" }) : null,
    walkTweens,
    leanTween: null,
    seatTween: null,
    seatIdle: null,
    walking: false,
    seated: false,
  };
  rig.walkTweens.forEach((tween) => tween.pause());

  if (ambientMotion) {
    scene.time.addEvent({
      delay: 2600,
      loop: true,
      callback: () => {
        if (!alive(face)) return;
        face.setText("–ᴗ–");
        scene.time.delayedCall(130, () => {
          if (alive(face)) face.setText("•ᴗ•");
        });
      },
    });
  }

  return rig;
}

/** Liga/desliga a animação de caminhada exatamente como a casa faz. */
export function setRigWalking(rig: AvatarRig, walking: boolean) {
  if (rig.seated && walking) return;
  if (walking === rig.walking) return;
  rig.walking = walking;
  if (walking) {
    rig.breathing?.pause();
    rig.bobber.setY(0);
    rig.walkTweens.forEach((tween) => tween.resume());
  } else {
    rig.walkTweens.forEach((tween) => tween.pause());
    rig.leanTween?.remove();
    rig.leanTween = null;
    rig.bobber.setRotation(0).setY(0);
    rig.breathing?.resume();
  }
}

/** Transição compartilhada para bancos e cadeiras da rua. */
export function setRigSeated(
  scene: Phaser.Scene,
  rig: AvatarRig,
  seated: boolean,
  facing: "left" | "right" = "right",
  onComplete?: () => void,
) {
  rig.seatTween?.remove();
  rig.seatIdle?.remove();
  rig.seatTween = null;
  rig.seatIdle = null;
  setRigWalking(rig, false);
  rig.breathing?.pause();
  rig.seated = seated;
  rig.bobber.setScale(facing === "left" ? -1 : 1, rig.bobber.scaleY);
  rig.legL.setVisible(true);
  rig.legR.setVisible(true);
  rig.seatedLegs.setVisible(true);
  rig.armL.setVisible(true);
  rig.armR.setVisible(true);
  rig.seatedArms.setVisible(true);

  const duration = motionDuration(scene, seated ? 320 : 260);
  rig.seatTween = scene.tweens.add({
    targets: rig.bobber,
    duration,
    ease: "Cubic.easeInOut",
    props: seated ? {
      y: { value: 4 },
    } : {
      y: { value: 0 },
    },
    onUpdate: () => {
      const progress = rig.seatTween?.progress ?? 1;
      const t = seated ? progress : 1 - progress;
      rig.bobber.setScale(facing === "left" ? -1 : 1, 1);
      rig.legL.setAlpha(1 - t);
      rig.legR.setAlpha(1 - t);
      rig.seatedLegs.setAlpha(t);
      rig.armL.setAlpha(1 - t);
      rig.armR.setAlpha(1 - t);
      rig.seatedArms.setAlpha(t);
    },
    onComplete: () => {
      rig.seatTween = null;
      if (seated) {
        rig.legL.setVisible(false);
        rig.legR.setVisible(false);
        rig.armL.setVisible(false);
        rig.armR.setVisible(false);
        rig.face.setText("•ᴗ•");
        if (motionAllowed(scene)) {
          rig.seatIdle = scene.tweens.add({
            targets: rig.bobber,
            y: { from: 4, to: 2.5 },
            duration: 1500,
            yoyo: true,
            repeat: -1,
            ease: "Sine.easeInOut",
          });
        }
      } else {
        rig.seated = false;
        rig.bobber.setScale(facing === "left" ? -1 : 1, 1).setY(0);
        rig.seatedLegs.setVisible(false).setAlpha(0);
        rig.seatedArms.setVisible(false).setAlpha(0);
        rig.legL.setVisible(true).setAlpha(1);
        rig.legR.setVisible(true).setAlpha(1);
        rig.armL.setVisible(true).setAlpha(1);
        rig.armR.setVisible(true).setAlpha(1);
        rig.legL.setRotation(-0.5);
        rig.legR.setRotation(0.5);
        rig.armL.setRotation(0.16);
        rig.armR.setRotation(-0.16);
        rig.breathing?.resume();
      }
      onComplete?.();
    },
  });
}
