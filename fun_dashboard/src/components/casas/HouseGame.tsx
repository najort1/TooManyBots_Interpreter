"use client";

import * as Phaser from "phaser";
import { useEffect, useId, useRef, useState } from "react";
import type { HouseItem, HouseView, NeighborhoodHouse } from "@/lib/types";
import {
  AVATAR_FLOOR_OFFSET_Y,
  GRID_COLUMNS,
  GRID_ORIGIN_X,
  GRID_ROWS,
  TILE_HEIGHT,
  TILE_WIDTH,
  cellFromFurniturePosition,
  furnitureFloorPosition,
  furnitureRectanglePoints,
  getGridOutline,
  isGridCellAvailable,
  normalizeFurnitureRotation,
  normalizePolygonPoints,
  projectFurniturePoint,
  resolveDropCell,
  toIso,
} from "./houseGeometry.js";

type WorldMode = "house" | "neighborhood";
type ViewportMode = "desktop" | "portrait" | "landscape";

type HouseGameProps = {
  mode: WorldMode;
  house: HouseView;
  neighborhood: NeighborhoodHouse[];
  owns: boolean;
  selectedItemId?: string;
  onExit: () => void;
  onOpenNeighbor: (neighbor: NeighborhoodHouse) => void;
  onSelectItem: (item: HouseItem) => void;
  onClearSelection: () => void;
  interactionLocked?: boolean;
  onMoveItem: (item: HouseItem, x: number, y: number) => boolean | Promise<boolean>;
};

const GAME_WIDTH = 960;
const GAME_HEIGHT = 720;
const WALL_HEIGHT = 126;

const PAL = {
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

const FLOOR_THEMES: Record<string, { a: number; b: number; grid: number }> = {
  piso_lilas: { a: 0x8d6bb0, b: 0x7c5ca1, grid: 0xc9aee3 },
  piso_madeira: { a: 0xc39168, b: 0xb27c58, grid: 0xe4bb91 },
  piso_xadrez: { a: 0xe2c9aa, b: 0x765044, grid: 0xf2dec4 },
  piso_galaxia: { a: 0x40518e, b: 0x29386f, grid: 0x91a9ee },
};

const WALL_THEMES: Record<string, { left: number; right: number; edge: number; trim: number; pattern: "stripe" | "leaf" | "brick" | "neon" }> = {
  parede_beco: { left: 0x3b2757, right: 0x30204b, edge: 0x241735, trim: 0x6b4d92, pattern: "stripe" },
  parede_menta: { left: 0x4c796c, right: 0x3c665c, edge: 0x27473f, trim: 0x91c5a9, pattern: "leaf" },
  parede_tijolo: { left: 0x824e48, right: 0x6f413f, edge: 0x422a2b, trim: 0xc98772, pattern: "brick" },
  parede_noite_neon: { left: 0x202858, right: 0x171d48, edge: 0x0f1434, trim: 0x52e0e7, pattern: "neon" },
};

const itemLabels: Record<string, string> = {
  sofa_inicial: "Sofá de entrada",
  planta_inicial: "Planta sobrevivente",
  tapete_rua: "Tapete da rua",
  mesa_cafe: "Mesa de café",
  vaso_flores: "Vaso florido",
  luminaria_neon: "Luminária neon",
  puff_estrela: "Puff estrela",
  poltrona_vintage: "Poltrona vintage",
  estante_caotica: "Estante caótica",
  tv_tubo: "TV de tubo",
  cama_nuvem: "Cama nuvem",
  jukebox_neon: "Jukebox neon",
  geladeira_premium: "Geladeira premium",
  gato_sindico: "Gato síndico",
  camera_porta: "Câmera de porta",
};

function diamondPoints(cx: number, cy: number, w = TILE_WIDTH, h = TILE_HEIGHT) {
  return [
    { x: cx, y: cy - h / 2 },
    { x: cx + w / 2, y: cy },
    { x: cx, y: cy + h / 2 },
    { x: cx - w / 2, y: cy },
  ];
}

function centeredPolygon(scene: Phaser.Scene, x: number, y: number, points: number[], fillColor?: number, fillAlpha?: number) {
  return scene.add.polygon(x, y, normalizePolygonPoints(points), fillColor, fillAlpha);
}

type FurniturePoint = { x: number; y: number };

function localPolygon(scene: Phaser.Scene, points: FurniturePoint[], fillColor: number, fillAlpha = 1) {
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const relativePoints = points.flatMap((point) => [point.x - centerX, point.y - centerY]);
  return centeredPolygon(scene, centerX, centerY, relativePoints, fillColor, fillAlpha);
}

function projectedFurniturePoint(u: number, v: number, z: number, rotation: number | boolean) {
  const point = projectFurniturePoint(u, v, z, normalizeFurnitureRotation(rotation));
  return { x: point.x, y: point.y + 8 };
}

function projectedFurnitureRectangle(width: number, depth: number, z: number, rotation: number | boolean, centerU = 0, centerV = 0) {
  return furnitureRectanglePoints({ width, depth, z, rotation: normalizeFurnitureRotation(rotation), centerU, centerV })
    .map((point) => ({ x: point.x, y: point.y + 8 }));
}

function isoCuboid(
  scene: Phaser.Scene,
  options: { centerU?: number; centerV?: number; width: number; depth: number; base: number; height: number; top: number; left: number; right: number; rotation: number },
) {
  const { centerU = 0, centerV = 0, width, depth, base, height, top, left, right, rotation } = options;
  const bottom = projectedFurnitureRectangle(width, depth, base, rotation, centerU, centerV);
  const upper = projectedFurnitureRectangle(width, depth, base + height, rotation, centerU, centerV);
  const faces = [0, 1, 2, 3].map((index) => {
    const next = (index + 1) % 4;
    const points = [upper[index], upper[next], bottom[next], bottom[index]];
    return {
      points,
      averageX: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      averageY: (bottom[index].y + bottom[next].y) / 2,
    };
  });
  const visibleSides = faces.sort((a, b) => b.averageY - a.averageY).slice(0, 2).sort((a, b) => a.averageY - b.averageY);
  return [
    ...visibleSides.map((face) => localPolygon(scene, face.points, face.averageX < 0 ? left : right).setStrokeStyle(3, PAL.outline)),
    localPolygon(scene, upper, top).setStrokeStyle(3, PAL.outline),
  ];
}

function itemRotation(item: HouseItem) {
  return normalizeFurnitureRotation(item.rotation ?? item.rotated);
}

const REDUCED_MOTION_KEY = "casas-reduced-motion";

function motionAllowed(scene: Phaser.Scene) {
  return scene.registry.get(REDUCED_MOTION_KEY) !== true;
}

function motionDuration(scene: Phaser.Scene, duration: number) {
  return motionAllowed(scene) ? duration : Math.min(60, duration);
}

function alive(target: Phaser.GameObjects.GameObject) {
  return target.scene != null && target.active;
}

function destroyTree(scene: Phaser.Scene, target: Phaser.GameObjects.GameObject) {
  const container = target as Phaser.GameObjects.Container;
  if (container.list) {
    [...container.list].forEach((child) => destroyTree(scene, child));
  }
  scene.tweens.killTweensOf(target);
  target.destroy();
}

function uiText(scene: Phaser.Scene, x: number, y: number, text: string, size: number, color: string, stroke = "#241735", strokeThickness = 4) {
  return scene.add.text(x, y, text, { fontFamily: "monospace", fontSize: `${size}px`, color, stroke, strokeThickness }).setOrigin(0.5);
}

function labelChip(scene: Phaser.Scene, text: string, fill: number, stroke: number, textColor: string) {
  const label = scene.add.text(0, 0, text, { fontFamily: "monospace", fontSize: "12px", color: textColor, stroke: "#241735", strokeThickness: 3 }).setOrigin(0.5);
  const g = scene.add.graphics();
  const w = label.width + 18;
  const h = label.height + 12;
  g.fillStyle(fill, 0.94);
  g.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
  g.lineStyle(2, stroke, 1);
  g.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
  return scene.add.container(0, 0, [g, label]);
}

type AvatarRig = {
  root: Phaser.GameObjects.Container;
  bobber: Phaser.GameObjects.Container;
  face: Phaser.GameObjects.Text;
  breathing: Phaser.Tweens.Tween | null;
  walkTweens: Phaser.Tweens.Tween[];
  leanTween: Phaser.Tweens.Tween | null;
  walking: boolean;
};

function createAvatarRig(scene: Phaser.Scene, avatar: HouseView["avatar"], name: string): AvatarRig {
  const outfit = avatar.slots.outfit;
  const hair = avatar.slots.hair_face;
  const accessory = avatar.slots.optional_accessory;
  const bodyColor = outfit === "terno_suspeito" ? 0x344563 : outfit === "jaqueta_neon" ? 0xed4a91 : 0x7b5ce5;

  const root = scene.add.container(0, 0);
  const bobber = scene.add.container(0, 0);

  const legL = scene.add.rectangle(-12, 2, 14, 30, 0x332f54).setStrokeStyle(3, PAL.outline).setOrigin(0.5, 0);
  const legR = scene.add.rectangle(12, 2, 14, 30, 0x332f54).setStrokeStyle(3, PAL.outline).setOrigin(0.5, 0);
  const body = scene.add.rectangle(0, -8, 56, 58, bodyColor).setStrokeStyle(4, PAL.outline);
  const bodyShade = scene.add.rectangle(14, -8, 12, 58, 0x000000, 0.14);
  const shirtHighlight = scene.add.rectangle(-13, -13, 9, 36, 0xffffff, 0.22);
  const armL = scene.add.rectangle(-30, -30, 11, 34, bodyColor).setStrokeStyle(3, PAL.outline).setOrigin(0.5, 0).setRotation(0.16);
  const armR = scene.add.rectangle(30, -30, 11, 34, bodyColor).setStrokeStyle(3, PAL.outline).setOrigin(0.5, 0).setRotation(-0.16);

  const head = scene.add.container(0, -52);
  head.add([
    scene.add.circle(0, 0, 31, 0xffd6ba).setStrokeStyle(4, PAL.outline),
    scene.add.circle(-15, 8, 5, 0xf5a88c, 0.55),
    scene.add.circle(15, 8, 5, 0xf5a88c, 0.55),
  ]);
  const face = scene.add.text(0, -2, "•ᴗ•", { fontFamily: "monospace", fontSize: "19px", color: "#3a2740" }).setOrigin(0.5);
  head.add(face);
  bobber.add([legL, legR, armL, armR, body, bodyShade, shirtHighlight, head]);

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
      scene.add.line(0, -7, -25, -28, -4, -3, 0x1e2a45).setLineWidth(3),
      scene.add.line(0, -7, 25, -28, 4, -3, 0x1e2a45).setLineWidth(3),
    ]);
  }

  if (hair === "cabelo_caos") {
    bobber.add([
      scene.add.rectangle(0, -84, 58, 17, 0x633b2b).setStrokeStyle(3, PAL.outline),
      scene.add.rectangle(-22, -73, 13, 22, 0x633b2b).setStrokeStyle(3, PAL.outline),
      scene.add.rectangle(23, -73, 13, 22, 0x633b2b).setStrokeStyle(3, PAL.outline),
    ]);
  }
  if (hair === "oculos_pixel") {
    bobber.add([
      scene.add.rectangle(-14, -54, 22, 15, 0x1b1430, 0.85).setStrokeStyle(3, 0x5fe8ff),
      scene.add.rectangle(14, -54, 22, 15, 0x1b1430, 0.85).setStrokeStyle(3, 0x5fe8ff),
      scene.add.rectangle(0, -54, 6, 4, 0x5fe8ff),
    ]);
  }
  if (accessory === "coroa_papel") {
    bobber.add(centeredPolygon(scene, 0, -103, [-31, 12, -24, -15, -8, 4, 0, -18, 10, 4, 25, -15, 31, 12, 31, 23, -31, 23], 0xffe082).setStrokeStyle(4, 0x754e24));
  }
  if (accessory === "corrente_brilho") {
    const chain = scene.add.graphics();
    chain.lineStyle(4, 0xffd34f, 1);
    chain.beginPath();
    chain.moveTo(-19, -29);
    chain.lineTo(0, -16);
    chain.lineTo(19, -29);
    chain.strokePath();
    bobber.add([chain, scene.add.circle(0, -13, 6, 0xffd34f).setStrokeStyle(3, 0x7b4d1b)]);
  }

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
    breathing: ambientMotion ? scene.tweens.add({ targets: bobber, y: -3, duration: 1800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" }) : null,
    walkTweens,
    leanTween: null,
    walking: false,
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

function dustPuff(scene: Phaser.Scene, x: number, y: number) {
  if (!motionAllowed(scene)) return;
  for (let i = 0; i < 5; i += 1) {
    const angle = Math.PI + (i - 2) * 0.38;
    const puff = scene.add.circle(x, y, 4 + Math.random() * 3, 0xd9c8ef, 0.5).setDepth(1150);
    scene.tweens.add({
      targets: puff,
      x: x + Math.cos(angle) * (22 + Math.random() * 12),
      y: y + Math.sin(angle) * 8 - Math.random() * 8,
      scale: 0.2,
      alpha: 0,
      duration: 380 + Math.random() * 160,
      ease: "Quad.easeOut",
      onComplete: () => puff.destroy(),
    });
  }
}

function selectionAura(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, itemName: string) {
  const aura = centeredPolygon(scene, 0, 8, [0, -18, 52, 0, 0, 18, -52, 0]).setStrokeStyle(3, PAL.gold, 0.95);
  const corners = [
    [-46, -6],
    [46, -6],
    [-46, -46],
    [46, -46],
  ].map(([cx, cy]) => scene.add.triangle(cx, cy, -5, 8, 5, 8, 0, -6, PAL.gold).setStrokeStyle(1, 0x8a6a1f));
  const label = labelChip(scene, "SELECIONADO", 0x3d2a12, PAL.gold, "#ffe9a8");
  label.setPosition(0, -110);
  const nameChip = labelChip(scene, itemName, 0x2f2148, 0xd9b8ff, "#fff6d5");
  nameChip.setPosition(0, -136);
  const overlay = scene.add.container(0, 0, [aura, ...corners, label, nameChip]).setVisible(false);
  parent.add(overlay);
  return overlay;
}

function createFurniture(scene: Phaser.Scene, item: HouseItem) {
  const container = scene.add.container(0, 0);
  const art = scene.add.container(0, 0);
  const rotation = itemRotation(item);
  const wideItem = ["sofa_inicial", "cama_nuvem"].includes(item.itemId);
  const footprint = item.itemId === "tapete_rua"
    ? projectedFurnitureRectangle(1.68, 0.92, -1, rotation)
    : projectedFurnitureRectangle(wideItem ? 1.55 : 0.82, wideItem ? 0.82 : 0.72, -1, rotation);
  const shadow = localPolygon(scene, footprint, 0x160d24, item.itemId === "tapete_rua" ? 0.18 : 0.3);
  container.add([shadow, art]);
  const outline = PAL.outline;

  if (item.itemId === "sofa_inicial") {
    const seam = scene.add.graphics().lineStyle(2, 0xb8d8ff, 0.52);
    const seamStart = projectedFurniturePoint(0, -0.16, 34, rotation);
    const seamEnd = projectedFurniturePoint(0, 0.27, 34, rotation);
    seam.lineBetween(seamStart.x, seamStart.y, seamEnd.x, seamEnd.y);
    art.add([
      ...isoCuboid(scene, { centerV: -0.31, width: 1.52, depth: 0.2, base: 11, height: 48, top: 0x5d91eb, left: 0x34578f, right: 0x416cb5, rotation }),
      ...isoCuboid(scene, { centerV: 0.05, width: 1.42, depth: 0.68, base: 9, height: 22, top: 0x79b3f6, left: 0x3d68aa, right: 0x4e83d4, rotation }),
      ...isoCuboid(scene, { centerU: -0.69, centerV: 0.03, width: 0.18, depth: 0.76, base: 8, height: 30, top: 0x6ca3ee, left: 0x304f84, right: 0x416db4, rotation }),
      ...isoCuboid(scene, { centerU: 0.69, centerV: 0.03, width: 0.18, depth: 0.76, base: 8, height: 30, top: 0x6ca3ee, left: 0x304f84, right: 0x416db4, rotation }),
      ...isoCuboid(scene, { centerU: -0.35, centerV: 0.08, width: 0.64, depth: 0.5, base: 31, height: 4, top: 0x91c5ff, left: 0x507fc4, right: 0x669be2, rotation }),
      ...isoCuboid(scene, { centerU: 0.35, centerV: 0.08, width: 0.64, depth: 0.5, base: 31, height: 4, top: 0x91c5ff, left: 0x507fc4, right: 0x669be2, rotation }),
      seam,
    ]);
  } else if (item.itemId === "planta_inicial") {
    const foliage = scene.add.container(0, -30).setScale(rotation === 1 || rotation === 2 ? -1 : 1, 1);
    const stems = scene.add.graphics().lineStyle(4, 0x356b43, 1);
    stems.lineBetween(0, 17, -15, -17);
    stems.lineBetween(0, 17, 16, -23);
    stems.lineBetween(0, 17, 25, -6);
    stems.lineBetween(0, 17, -25, -3);
    foliage.add([
      stems,
      scene.add.ellipse(-23, -7, 27, 43, 0x4d9f62).setRotation(-0.72).setStrokeStyle(3, outline),
      scene.add.ellipse(18, -20, 29, 48, 0x70c779).setRotation(0.58).setStrokeStyle(3, outline),
      scene.add.ellipse(28, 0, 24, 38, 0x438c58).setRotation(0.98).setStrokeStyle(3, outline),
      scene.add.ellipse(-7, -27, 25, 44, 0x64b96f).setRotation(-0.2).setStrokeStyle(3, outline),
      scene.add.ellipse(-3, 2, 23, 34, 0x78cb7e).setRotation(0.2).setStrokeStyle(3, outline),
      scene.add.ellipse(-15, -16, 7, 17, 0xa4e0a8, 0.62).setRotation(-0.72),
      scene.add.ellipse(12, -30, 7, 18, 0xb3e7b5, 0.58).setRotation(0.58),
    ]);
    art.add([
      scene.add.ellipse(0, 7, 31, 10, 0x8f442f).setStrokeStyle(3, outline),
      centeredPolygon(scene, 0, -1, [-20, -8, 20, -8, 14, 9, -14, 9], 0xbd6645).setStrokeStyle(3, outline),
      scene.add.ellipse(0, -9, 43, 15, 0xe28b5e).setStrokeStyle(3, outline),
      scene.add.ellipse(0, -9, 32, 10, 0x56392b).setStrokeStyle(2, 0x7d4732),
      scene.add.ellipse(-7, -11, 10, 4, 0xffffff, 0.16),
      foliage,
    ]);
    if (motionAllowed(scene)) scene.tweens.add({ targets: foliage, y: { from: -30, to: -32 }, scaleY: { from: 1, to: 1.018 }, duration: 2600, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  } else if (item.itemId === "tapete_rua") {
    const textile = scene.add.graphics();
    textile.lineStyle(3, 0xf3c98b, 0.9);
    [-0.22, 0, 0.22].forEach((v) => {
      const start = projectedFurniturePoint(-0.62, v, 2, rotation);
      const end = projectedFurniturePoint(0.62, v, 2, rotation);
      textile.lineBetween(start.x, start.y, end.x, end.y);
    });
    textile.lineStyle(2, 0x6f2746, 0.85);
    [-0.45, 0.45].forEach((u) => {
      const start = projectedFurniturePoint(u, -0.32, 3, rotation);
      const end = projectedFurniturePoint(u, 0.32, 3, rotation);
      textile.lineBetween(start.x, start.y, end.x, end.y);
    });
    const fringes = scene.add.graphics().lineStyle(2, 0xf4dfbd, 0.95);
    for (const endU of [-0.84, 0.84]) {
      for (const v of [-0.34, -0.17, 0, 0.17, 0.34]) {
        const start = projectedFurniturePoint(endU, v, 1, rotation);
        const finish = projectedFurniturePoint(endU + Math.sign(endU) * 0.12, v, 0, rotation);
        fringes.lineBetween(start.x, start.y, finish.x, finish.y);
      }
    }
    art.add([
      localPolygon(scene, projectedFurnitureRectangle(1.68, 0.92, 0, rotation), 0x9e3e4b).setStrokeStyle(3, outline),
      localPolygon(scene, projectedFurnitureRectangle(1.5, 0.74, 1, rotation), 0xe7ad66).setStrokeStyle(2, 0x743044),
      localPolygon(scene, projectedFurnitureRectangle(1.22, 0.48, 2, rotation), 0x7e3150).setStrokeStyle(2, 0xf0c27d),
      textile,
      fringes,
    ]);
  } else if (item.itemId === "mesa_cafe") {
    const cup = projectedFurniturePoint(0.25, -0.08, 28, rotation);
    art.add([
      ...isoCuboid(scene, { width: 1.08, depth: 0.68, base: 20, height: 10, top: 0xb98256, left: 0x754a36, right: 0x936044, rotation }),
      ...[-0.42, 0.42].flatMap((u) => [-0.22, 0.22].flatMap((v) => isoCuboid(scene, { centerU: u, centerV: v, width: 0.1, depth: 0.1, base: 0, height: 22, top: 0x8b5b3f, left: 0x593827, right: 0x71472f, rotation }))),
      scene.add.ellipse(cup.x, cup.y - 8, 16, 8, 0xf2e7d4).setStrokeStyle(2, outline),
      scene.add.circle(cup.x + 8, cup.y - 8, 5, 0x000000, 0).setStrokeStyle(2, 0xf2e7d4),
    ]);
  } else if (item.itemId === "vaso_flores") {
    const bouquet = scene.add.container(0, -37);
    const stems = scene.add.graphics().lineStyle(3, 0x4e8e55, 1);
    [-18, -8, 5, 17].forEach((x, index) => stems.lineBetween(0, 25, x, -7 - (index % 2) * 8));
    bouquet.add([stems, ...[-18, -8, 5, 17].map((x, index) => scene.add.circle(x, -7 - (index % 2) * 8, 8, [0xf58ba8, 0xffd76a, 0xb69cf2, 0xf28f62][index]).setStrokeStyle(2, outline))]);
    art.add([
      scene.add.ellipse(0, 8, 26, 9, 0x5c335f).setStrokeStyle(3, outline),
      centeredPolygon(scene, 0, -3, [-17, -12, 17, -12, 12, 12, -12, 12], 0xa85e99).setStrokeStyle(3, outline),
      scene.add.ellipse(0, -14, 35, 11, 0xd183bd).setStrokeStyle(3, outline),
      bouquet,
    ]);
  } else if (item.itemId === "puff_estrela") {
    art.add([
      centeredPolygon(scene, 0, 5, [0, -32, 12, -12, 36, -10, 19, 7, 23, 31, 0, 20, -23, 31, -19, 7, -36, -10, -12, -12], 0x9e477f).setStrokeStyle(4, outline),
      centeredPolygon(scene, 0, -4, [0, -28, 10, -11, 31, -9, 16, 6, 20, 26, 0, 17, -20, 26, -16, 6, -31, -9, -10, -11], 0xdb78b5).setStrokeStyle(2, 0xf2a7d3),
      scene.add.circle(-7, -12, 7, 0xffffff, 0.18),
    ]);
  } else if (item.itemId === "poltrona_vintage") {
    art.add([
      ...isoCuboid(scene, { centerV: -0.26, width: 0.92, depth: 0.2, base: 9, height: 50, top: 0x873d58, left: 0x55263b, right: 0x6d3047, rotation }),
      ...isoCuboid(scene, { centerV: 0.04, width: 0.8, depth: 0.62, base: 10, height: 24, top: 0xb85b76, left: 0x6c3148, right: 0x8c405b, rotation }),
      ...[-0.43, 0.43].flatMap((u) => isoCuboid(scene, { centerU: u, centerV: 0.02, width: 0.16, depth: 0.68, base: 8, height: 31, top: 0xa44c68, left: 0x602c43, right: 0x7d3853, rotation })),
    ]);
  } else if (item.itemId === "cama_nuvem") {
    art.add([
      ...isoCuboid(scene, { width: 1.58, depth: 0.94, base: 4, height: 17, top: 0xe8e4f2, left: 0x9b91b4, right: 0xb7aecb, rotation }),
      ...isoCuboid(scene, { centerV: -0.39, width: 1.58, depth: 0.16, base: 5, height: 54, top: 0xb7a9d3, left: 0x74688e, right: 0x9184ac, rotation }),
      ...isoCuboid(scene, { centerU: -0.4, centerV: -0.22, width: 0.58, depth: 0.32, base: 22, height: 7, top: 0xffffff, left: 0xc9c6d7, right: 0xdedbe8, rotation }),
      ...isoCuboid(scene, { centerU: 0.3, centerV: -0.22, width: 0.58, depth: 0.32, base: 22, height: 7, top: 0xf7f2ff, left: 0xc1b9d0, right: 0xd7cfdf, rotation }),
      localPolygon(scene, projectedFurnitureRectangle(1.42, 0.45, 23, rotation, 0, 0.18), 0x8ec9d5).setStrokeStyle(2, 0x4f8091),
    ]);
  } else if (item.itemId === "jukebox_neon") {
    const glow = scene.add.ellipse(0, -31, 44, 67, 0x6ff6e9, 0.14);
    art.add([
      scene.add.rectangle(0, -18, 52, 72, 0x5a294f).setStrokeStyle(4, outline),
      scene.add.circle(0, -48, 26, 0x783867).setStrokeStyle(4, outline),
      scene.add.circle(0, -48, 18, 0xf0bf61).setStrokeStyle(3, 0x6f3c43),
      scene.add.rectangle(0, -10, 34, 30, 0x2b3150).setStrokeStyle(3, 0x6ff6e9),
      scene.add.rectangle(-10, 14, 8, 13, 0xe85696),
      scene.add.rectangle(10, 14, 8, 13, 0x6ff6e9),
      glow,
    ]);
    if (motionAllowed(scene)) scene.tweens.add({ targets: glow, alpha: { from: 0.2, to: 0.07 }, duration: 1300, yoyo: true, repeat: -1 });
  } else if (item.itemId === "luminaria_neon") {
    const glow = scene.add.circle(0, -34, 30, 0x70eefa, 0.16);
    const glow2 = scene.add.circle(0, -34, 44, 0x70eefa, 0.08);
    art.add([
      scene.add.ellipse(0, 10, 40, 12, 0x2c3550).setStrokeStyle(3, outline),
      scene.add.rectangle(0, -10, 8, 44, 0x3f4b6e).setStrokeStyle(2, outline),
      scene.add.circle(0, -34, 20, 0x70eefa).setStrokeStyle(4, outline),
      scene.add.circle(0, -34, 9, 0xf4ffff),
      glow2,
      glow,
    ]);
    if (motionAllowed(scene)) scene.tweens.add({ targets: [glow, glow2], alpha: { from: 0.22, to: 0.08 }, duration: 1800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  } else if (item.itemId === "estante_caotica") {
    const books: Phaser.GameObjects.Rectangle[] = [];
    const bookColors = [0xe85e5d, 0x6ebce7, 0xf0ca67, 0x9be08a, 0xd98cf0];
    for (let shelf = 0; shelf < 3; shelf += 1) {
      const widths = [9, 11, 8, 10, 9];
      const heights = [17, 14, 19, 16, 18];
      let bx = -20;
      let count = 0;
      while (bx < 18 && count < widths.length) {
        const w = widths[(shelf + count) % widths.length];
        const h = heights[(shelf * 2 + count) % heights.length];
        const book = scene.add.rectangle(bx + w / 2, -32 + shelf * 22 - h / 2, w, h, bookColors[(shelf * 2 + count) % bookColors.length]).setStrokeStyle(2, 0x33213d);
        if (shelf === 1 && count === 3) book.setRotation(-0.24);
        books.push(book);
        bx += w + 1;
        count += 1;
      }
    }
    art.add([
      scene.add.rectangle(0, -22, 60, 66, 0x845f49).setStrokeStyle(4, outline),
      scene.add.rectangle(-30, -22, 6, 66, 0x6a4a37),
      scene.add.rectangle(0, -43, 50, 5, 0x30213d),
      scene.add.rectangle(0, -21, 50, 5, 0x30213d),
      scene.add.rectangle(0, 1, 50, 5, 0x30213d),
      ...books,
    ]);
  } else if (item.itemId === "tv_tubo") {
    const scanline = scene.add.rectangle(-16, -14, 8, 2, 0xffffff, 0.65);
    const snow = scene.add.circle(10, -20, 2.5, 0xffffff, 0.8);
    art.add([
      scene.add.rectangle(-22, 8, 9, 14, 0x2d2938).setStrokeStyle(2, outline),
      scene.add.rectangle(22, 8, 9, 14, 0x2d2938).setStrokeStyle(2, outline),
      scene.add.rectangle(0, -10, 64, 50, 0x595366).setStrokeStyle(4, outline),
      scene.add.rectangle(-3, -12, 46, 32, 0x7de1d2).setStrokeStyle(3, 0x214854),
      scene.add.rectangle(-3, -12, 40, 10, 0x9df0e4, 0.5),
      scene.add.rectangle(22, -26, 2, 16, 0x8b8494),
      scene.add.rectangle(-24, -26, 2, 16, 0x8b8494),
      scene.add.circle(0, -36, 3, 0x8b8494),
      scene.add.circle(22, -4, 3, 0xffd66e),
      scanline,
      snow,
    ]);
    if (motionAllowed(scene)) {
      scene.tweens.add({ targets: scanline, y: { from: -26, to: -2 }, duration: 900, repeat: -1, onRepeat: () => scanline.setX(-18) });
      scene.time.addEvent({
        delay: 1800,
        loop: true,
        callback: () => {
          if (!alive(snow)) return;
          snow.setPosition(9, -18);
          scene.tweens.add({ targets: snow, alpha: { from: 0.9, to: 0 }, duration: 320, onComplete: () => snow.setAlpha(0.8) });
        },
      });
    }
  } else if (item.itemId === "geladeira_premium") {
    art.add([
      scene.add.rectangle(0, -18, 52, 82, 0xb7e7f3).setStrokeStyle(4, outline),
      scene.add.rectangle(0, -38, 52, 4, 0x4d88a4),
      scene.add.rectangle(17, -24, 5, 24, 0x4d88a4).setStrokeStyle(2, 0x2f5d75),
      scene.add.rectangle(17, 4, 5, 22, 0x4d88a4).setStrokeStyle(2, 0x2f5d75),
      scene.add.rectangle(-16, -48, 8, 46, 0xffffff, 0.35),
      scene.add.circle(-10, -44, 3.5, 0xe86a8a),
      scene.add.circle(2, -34, 3, 0x6ec5e7),
      scene.add.circle(-4, -26, 3, 0xf0ca67),
    ]);
  } else if (item.itemId === "gato_sindico") {
    const tail = scene.add.container(26, 0);
    tail.add([scene.add.rectangle(14, -6, 30, 8, 0xf3aa5f).setStrokeStyle(3, outline).setOrigin(0, 0.5), scene.add.circle(30, -6, 5, 0xe89a4d).setStrokeStyle(2, outline)]);
    const head = scene.add.container(-18, -30);
    head.add([
      scene.add.triangle(-9, -14, -9, 10, 9, 10, 0, -14, 0xf3aa5f).setStrokeStyle(3, outline),
      scene.add.triangle(9, -14, -9, 10, 9, 10, 0, -14, 0xf3aa5f).setStrokeStyle(3, outline),
      scene.add.circle(0, 0, 16, 0xf3aa5f).setStrokeStyle(3, outline),
      scene.add.circle(-5, -2, 2.5, 0x4b2d2a),
      scene.add.circle(5, -2, 2.5, 0x4b2d2a),
      scene.add.triangle(-2.5, 4, -6, 0, -2, 0, -4, 5, 0xe8848f),
    ]);
    art.add([
      scene.add.ellipse(0, -8, 52, 34, 0xf3aa5f).setStrokeStyle(4, outline),
      scene.add.ellipse(-8, -16, 26, 10, 0xd98f45, 0.7),
      scene.add.ellipse(8, -14, 22, 9, 0xd98f45, 0.7),
      scene.add.rectangle(-12, 10, 9, 10, 0xe89a4d).setStrokeStyle(2, outline),
      scene.add.rectangle(12, 10, 9, 10, 0xe89a4d).setStrokeStyle(2, outline),
      head,
      tail,
    ]);
    if (motionAllowed(scene)) {
      scene.tweens.add({ targets: tail, rotation: { from: -0.28, to: 0.24 }, duration: 1200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      scene.tweens.add({ targets: head, y: { from: -30, to: -33 }, duration: 1600, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
  } else if (item.itemId === "camera_porta") {
    const led = scene.add.circle(-16, -14, 3.5, 0x7dffa0);
    const cone = centeredPolygon(scene, -20, 6, [0, -8, -52, 26, -34, 34], 0x9fe4ff, 0.12);
    art.add([
      scene.add.rectangle(-6, 14, 10, 26, 0x354158).setStrokeStyle(2, outline),
      scene.add.ellipse(-6, 26, 22, 8, 0x2c3850).setStrokeStyle(2, outline),
      scene.add.rectangle(2, -10, 12, 26, 0x5b6a87).setStrokeStyle(3, outline),
      scene.add.rectangle(-6, -16, 58, 22, 0x5b6a87).setStrokeStyle(4, outline),
      scene.add.circle(18, -16, 11, 0x79dcff).setStrokeStyle(3, outline),
      scene.add.circle(18, -16, 5, 0xd8f6ff),
      cone,
      led,
    ]);
    if (motionAllowed(scene)) {
      scene.tweens.add({ targets: led, alpha: { from: 1, to: 0.35 }, duration: 760, yoyo: true, repeat: -1, ease: "Quad.easeInOut" });
      scene.tweens.add({ targets: cone, alpha: { from: 0.12, to: 0.045 }, duration: 2400, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
  } else {
    art.add(scene.add.rectangle(0, -20, 52, 44, 0x948aa8).setStrokeStyle(4, outline));
  }

  if ((rotation === 1 || rotation === 2) && !["sofa_inicial", "planta_inicial", "tapete_rua", "mesa_cafe", "poltrona_vintage", "cama_nuvem", "luminaria_neon"].includes(item.itemId)) {
    art.setScale(-1, 1);
  }
  return container;
}

function createTree(scene: Phaser.Scene, x: number, y: number, scale: number) {
  const foliage = scene.add.container(0, -52);
  foliage.add([
    scene.add.circle(-16, 8, 20, 0x4f9153).setStrokeStyle(3, 0x2f5c35),
    scene.add.circle(16, 6, 22, 0x5ba661).setStrokeStyle(3, 0x2f5c35),
    scene.add.circle(0, -12, 26, 0x6ab96f).setStrokeStyle(3, 0x2f5c35),
    scene.add.circle(-4, -18, 10, 0x8ed693, 0.7),
  ]);
  const tree = scene.add.container(x, y, [
    scene.add.ellipse(0, 4, 64, 16, 0x2d2340, 0.28),
    scene.add.rectangle(0, -22, 12, 46, 0x7a4e33).setStrokeStyle(3, 0x54331f),
    scene.add.rectangle(-3, -34, 4, 30, 0x8f6242, 0.6),
    foliage,
  ]).setScale(scale);
  if (motionAllowed(scene)) scene.tweens.add({ targets: foliage, rotation: { from: -0.03, to: 0.03 }, duration: 2300, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  return tree;
}

function createLampPost(scene: Phaser.Scene, x: number, y: number) {
  const glow = scene.add.circle(0, -74, 26, 0xffe9a5, 0.2);
  const lamp = scene.add.container(x, y, [
    scene.add.ellipse(0, 2, 26, 8, 0x2d2340, 0.3),
    scene.add.rectangle(0, -36, 7, 76, 0x3a4356).setStrokeStyle(2, 0x252c3c),
    scene.add.rectangle(0, -70, 26, 10, 0x4c576e).setStrokeStyle(2, 0x252c3c),
    scene.add.rectangle(0, -63, 16, 10, 0xfff3c4),
    glow,
  ]);
  if (motionAllowed(scene)) scene.tweens.add({ targets: glow, alpha: { from: 0.24, to: 0.12 }, duration: 2100, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  return lamp;
}

function createStreetHouse(
  scene: Phaser.Scene,
  x: number,
  y: number,
  scale: number,
  label: string,
  bodyColor: number,
  roofColor: number,
  options: { onClick: () => void; securityLevel?: number; own?: boolean; entranceDelay?: number },
) {
  const art = scene.add.container(0, 0);
  art.add([
    scene.add.ellipse(0, 2, 190, 34, 0x2d2340, 0.3),
    centeredPolygon(scene, 62, -96, [0, 0, 34, -17, 34, 72, 0, 88], bodyColor, 0.75).setStrokeStyle(4, 0x332342),
    scene.add.rectangle(0, -50, 124, 100, bodyColor).setStrokeStyle(5, 0x332342),
    scene.add.rectangle(30, -50, 12, 100, 0x000000, 0.1),
    centeredPolygon(scene, 0, -114, [0, -40, 78, 4, 0, 40, -78, 4], roofColor).setStrokeStyle(5, 0x332342),
    centeredPolygon(scene, 44, -114, [0, -40, 78, 4, 0, 40], roofColor, 0.55),
    scene.add.rectangle(-40, -148, 14, 34, 0x8a5a5a).setStrokeStyle(3, 0x5c3a3a),
    scene.add.rectangle(0, -26, 38, 56, 0x704351).setStrokeStyle(4, 0x332342),
    scene.add.circle(26, -22, 3.5, 0xffdf72),
    scene.add.rectangle(-18, -4, 46, 8, 0x9a8f77).setStrokeStyle(3, 0x332342),
  ]);

  const windowGlowA = scene.add.rectangle(-42, -66, 24, 26, 0xffe99d, 0.9).setStrokeStyle(4, 0xf2e6c8);
  const windowGlowB = scene.add.rectangle(42, -66, 24, 26, 0xffe99d, 0.9).setStrokeStyle(4, 0xf2e6c8);
  art.add([windowGlowA, windowGlowB]);
  if (motionAllowed(scene)) scene.tweens.add({ targets: [windowGlowA, windowGlowB], fillAlpha: { from: 0.9, to: 0.64 }, duration: 2800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

  if (motionAllowed(scene)) {
    scene.time.addEvent({
      delay: 1450,
      loop: true,
      callback: () => {
        if (!alive(art)) return;
        const puff = scene.add.circle(x - 40 * scale, y - 152 * scale, 6, 0xe8ecf4, 0.5).setDepth(-60);
        scene.tweens.add({ targets: puff, y: puff.y - 42, x: puff.x + 10, scale: 1.8, alpha: 0, duration: 1900, ease: "Sine.easeOut", onComplete: () => puff.destroy() });
      },
    });
  }

  const trimmedLabel = label.length > 14 ? `${label.slice(0, 13)}…` : label;
  const plate = labelChip(scene, trimmedLabel.toUpperCase(), 0x6e4a30, 0x46301f, "#ffeccc");
  plate.setPosition(0, 32);
  art.add(plate);

  if (options.securityLevel != null) {
    const badgeColors = [0x77d48f, 0xe8c45e, 0xe0705f];
    const level = Phaser.Math.Clamp(options.securityLevel, 1, 3);
    const badge = scene.add.container(74, 34, [
      centeredPolygon(scene, 0, 0, [0, -10, 9, -6, 9, 4, 0, 11, -9, 4, -9, -6], badgeColors[level - 1]).setStrokeStyle(2, 0x2c2c34),
      uiText(scene, 0, -1, String(level), 11, "#2c2c34", "#2c2c34", 0),
    ]);
    art.add(badge);
    if (motionAllowed(scene)) scene.tweens.add({ targets: badge, y: { from: 34, to: 31 }, duration: 1700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }

  if (options.own) {
    const pennant = scene.add.triangle(3, -12, 0, -10, 34, 0, 0, 10, PAL.gold).setStrokeStyle(2, 0x8a6a1f).setOrigin(0, 0.5);
    const flag = scene.add.container(-84, -120, [
      scene.add.rectangle(0, 12, 5, 52, 0xd8cba8).setStrokeStyle(2, 0x8a7c5c),
      pennant,
    ]);
    art.add(flag);
    if (motionAllowed(scene)) scene.tweens.add({ targets: pennant, scaleX: { from: 1, to: 0.78 }, duration: 1100, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    const ownChip = labelChip(scene, "SUA CASA", 0x3d2a12, PAL.gold, "#ffe9a8");
    ownChip.setPosition(0, -188);
    art.add(ownChip);
    const arrow = scene.add.triangle(0, -166, -8, 0, 8, 0, 0, 12, PAL.gold).setStrokeStyle(2, 0x8a6a1f);
    art.add(arrow);
    if (motionAllowed(scene)) scene.tweens.add({ targets: arrow, y: { from: -168, to: -160 }, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }

  const house = scene.add.container(x, y, [art]).setScale(scale);
  const hoverRing = scene.add.ellipse(0, 0, 196, 40).setStrokeStyle(4, PAL.gold, 0);
  art.add(hoverRing);

  const hitZone = scene.add.zone(0, -76, 204, 236);
  house.add(hitZone);
  hitZone.setInteractive({ hitArea: new Phaser.Geom.Rectangle(-102, -118, 204, 236), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });

  hitZone.on("pointerover", () => {
    scene.tweens.add({ targets: art, scale: 1.05, duration: 160, ease: "Quad.easeOut" });
    scene.tweens.add({ targets: hoverRing, strokeAlpha: 0.75, duration: 160 });
  });
  hitZone.on("pointerout", () => {
    scene.tweens.add({ targets: art, scale: 1, duration: 160, ease: "Quad.easeOut" });
    scene.tweens.add({ targets: hoverRing, strokeAlpha: 0, duration: 200 });
  });
  hitZone.on("pointerdown", () => {
    scene.tweens.add({ targets: art, scaleY: { from: 1, to: 0.93 }, duration: 90, yoyo: true, ease: "Quad.easeOut", onComplete: () => options.onClick() });
  });

  if (options.entranceDelay != null) {
    house.setAlpha(0).setY(y + 18);
    scene.tweens.add({ targets: house, alpha: 1, y, duration: motionDuration(scene, 320), delay: motionAllowed(scene) ? options.entranceDelay : 0, ease: "Cubic.easeOut" });
  }
  return house;
}

type BecoSceneAPI = {
  getMode: () => WorldMode;
  switchMode: (mode: WorldMode) => void;
  syncDynamic: () => void;
  applyViewport: (viewport: ViewportMode) => void;
  applyMotionPreference: (reduced: boolean) => void;
};

type Drifter = { obj: Phaser.GameObjects.Container; speed: number };
type FurnitureRig = {
  root: Phaser.GameObjects.Container;
  itemId: string;
  rotation: number;
  selection: Phaser.GameObjects.Container;
};

export default function HouseGame({ mode, house, neighborhood, owns, selectedItemId, interactionLocked = false, onExit, onOpenNeighbor, onSelectItem, onClearSelection, onMoveItem }: HouseGameProps) {
  const rawId = useId();
  const containerId = `house-game-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const callbacksRef = useRef({ onExit, onOpenNeighbor, onSelectItem, onClearSelection, onMoveItem });
  const propsRef = useRef({ mode, house, neighborhood, owns, selectedItemId, interactionLocked, viewportMode: "desktop" as ViewportMode, reducedMotion: false });
  const sceneRef = useRef<(Phaser.Scene & BecoSceneAPI) | null>(null);
  const [viewportMode, setViewportMode] = useState<ViewportMode>("desktop");
  const [reducedMotion, setReducedMotion] = useState(false);

  callbacksRef.current = { onExit, onOpenNeighbor, onSelectItem, onClearSelection, onMoveItem };
  propsRef.current = { mode, house, neighborhood, owns, selectedItemId, interactionLocked, viewportMode, reducedMotion };

  useEffect(() => {
    const updateViewportMode = () => {
      if (window.innerWidth > 700) setViewportMode("desktop");
      else setViewportMode(window.innerWidth > window.innerHeight ? "landscape" : "portrait");
    };
    updateViewportMode();
    window.addEventListener("resize", updateViewportMode);
    return () => window.removeEventListener("resize", updateViewportMode);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    class BecoScene extends Phaser.Scene implements BecoSceneAPI {
      private activeMode: WorldMode = "house";
      private tiles: Array<Array<Phaser.GameObjects.Polygon | null>> = [];
      private furnitureRigs: FurnitureRig[] = [];
      private neighborHouses: Phaser.GameObjects.Container[] = [];
      private drifters: Drifter[] = [];
      private avatarRig: AvatarRig | null = null;
      private headerTitle: Phaser.GameObjects.Text | null = null;
      private headerHint: Phaser.GameObjects.Text | null = null;
      private lastHouseKey: string | null = null;
      private lastStructureKey: string | null = null;
      private lastNeighborhoodKey: string | null = null;
      private dragCell: { x: number; y: number } | null = null;
      private dragCellValid = false;

      constructor() {
        super("beco-scene");
      }

      getMode() {
        return this.activeMode;
      }

      switchMode(next: WorldMode) {
        this.activeMode = next;
        this.scene.restart();
      }

      applyViewport(viewport: ViewportMode) {
        if (viewport === "portrait") {
          this.cameras.main.setZoom(1.32);
          this.cameras.main.centerOn(GAME_WIDTH / 2, 390);
        } else if (viewport === "landscape") {
          this.cameras.main.setZoom(1.08);
          this.cameras.main.centerOn(GAME_WIDTH / 2, 350);
        } else {
          this.cameras.main.setZoom(1);
          this.cameras.main.centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2);
        }
      }

      applyMotionPreference(reduced: boolean) {
        if (this.registry.get(REDUCED_MOTION_KEY) === reduced) return;
        this.registry.set(REDUCED_MOTION_KEY, reduced);
        this.scene.restart();
      }

      syncDynamic() {
        if (this.activeMode === "house") {
          if (this.lastStructureKey != null && this.lastStructureKey !== this.buildStructureKey()) {
            this.scene.restart();
            return;
          }
          this.syncHouse();
        }
        else this.syncNeighborhood();
      }

      update(_time: number, delta: number) {
        const step = delta / 1000;
        for (const drifter of this.drifters) {
          if (!alive(drifter.obj)) continue;
          drifter.obj.x -= drifter.speed * step;
          if (drifter.obj.x < -170) drifter.obj.x = GAME_WIDTH + 170;
        }
      }

      create() {
        this.activeMode = propsRef.current.mode;
        this.registry.set(REDUCED_MOTION_KEY, propsRef.current.reducedMotion);
        this.tiles = [];
        this.furnitureRigs = [];
        this.neighborHouses = [];
        this.drifters = [];
        this.avatarRig = null;
        this.headerTitle = null;
        this.headerHint = null;
        this.lastHouseKey = null;
        this.lastStructureKey = null;
        this.lastNeighborhoodKey = null;
        this.dragCell = null;
        this.dragCellValid = false;
        this.cameras.main.fadeIn(motionAllowed(this) ? 300 : 0, 12, 7, 22);
        this.applyViewport(propsRef.current.viewportMode);
        if (this.activeMode === "house") this.createHouse();
        else this.createNeighborhood();
        sceneRef.current = this;
      }

      private floorPoints() {
        return getGridOutline();
      }

      private tileBaseColor(x: number, y: number) {
        const theme = FLOOR_THEMES[propsRef.current.house.house.floorStyle] || FLOOR_THEMES.piso_lilas;
        if (propsRef.current.house.house.floorStyle === "piso_madeira") return y % 2 === 0 ? theme.a : theme.b;
        if (propsRef.current.house.house.floorStyle === "piso_galaxia" && (x * 3 + y * 5) % 7 === 0) return 0x5669aa;
        return (x + y) % 2 === 0 ? theme.a : theme.b;
      }

      private buildStructureKey() {
        const current = propsRef.current.house.house;
        return `${current.wallStyle || "parede_beco"}|${current.floorStyle || "piso_lilas"}|${current.windowStyle || "janela_classica"}`;
      }

      private setDropHint(cell: { x: number; y: number } | null, valid: boolean) {
        if (this.dragCell) {
          const previous = this.tiles[this.dragCell.y]?.[this.dragCell.x];
          if (previous) previous.setFillStyle(this.tileBaseColor(this.dragCell.x, this.dragCell.y), 1);
        }
        this.dragCell = cell;
        this.dragCellValid = Boolean(cell && valid);
        if (!cell) return;
        const tile = this.tiles[cell.y]?.[cell.x];
        if (tile) tile.setFillStyle(valid ? PAL.floorValid : PAL.floorInvalid, 1);
      }

      private moveAvatar(rig: AvatarRig, targetX: number, targetY: number) {
        const destinationY = targetY + AVATAR_FLOOR_OFFSET_Y;
        const dx = targetX - rig.root.x;
        const dy = destinationY - rig.root.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 6) return;
        if (!motionAllowed(this)) {
          rig.root.setPosition(targetX, destinationY).setDepth(targetY + 80);
          return;
        }
        this.tweens.killTweensOf(rig.root);
        if (!rig.walking) {
          rig.walking = true;
          rig.breathing?.pause();
          rig.bobber.setY(0);
          rig.walkTweens.forEach((tween) => tween.resume());
        }
        rig.leanTween?.remove();
        rig.leanTween = this.tweens.add({ targets: rig.bobber, rotation: Phaser.Math.Clamp(dx / 260, -0.08, 0.08), duration: 150 });
        this.tweens.add({
          targets: rig.root,
          x: targetX,
          y: destinationY,
          duration: Math.max(260, distance * 3),
          ease: "Sine.easeInOut",
          onUpdate: () => rig.root.setDepth(rig.root.y - AVATAR_FLOOR_OFFSET_Y + 80),
          onComplete: () => {
            rig.walkTweens.forEach((tween) => tween.pause());
            rig.walking = false;
            rig.leanTween?.remove();
            rig.leanTween = null;
            rig.bobber.setRotation(0).setY(0);
            rig.breathing?.resume();
            dustPuff(this, rig.root.x, rig.root.y + 26);
            this.tweens.add({ targets: rig.bobber, scaleX: { from: 1.08, to: 1 }, scaleY: { from: 0.92, to: 1 }, duration: 190, ease: "Cubic.easeOut" });
          },
        });
      }

      private buildStaticHouse() {
        const { north, east, bottom, west } = this.floorPoints();
        const room = propsRef.current.house.house;
        const wallTheme = WALL_THEMES[room.wallStyle] || WALL_THEMES.parede_beco;
        const g = this.add.graphics().setDepth(-60);

        // laje com espessura sob o piso
        const slab = 14;
        g.fillStyle(0x1c1230, 1);
        g.fillPoints([east, bottom, { x: bottom.x, y: bottom.y + slab }, { x: east.x, y: east.y + slab }], true);
        g.fillStyle(0x241738, 1);
        g.fillPoints([bottom, west, { x: west.x, y: west.y + slab }, { x: bottom.x, y: bottom.y + slab }], true);
        g.fillStyle(0x2b1c40, 1);
        g.fillPoints([north, east, bottom, west], true);

        // paredes
        g.fillStyle(wallTheme.left, 1);
        g.fillPoints([north, west, { x: west.x, y: west.y - WALL_HEIGHT }, { x: north.x, y: north.y - WALL_HEIGHT }], true);
        g.fillStyle(wallTheme.right, 1);
        g.fillPoints([north, east, { x: east.x, y: east.y - WALL_HEIGHT }, { x: north.x, y: north.y - WALL_HEIGHT }], true);

        // rodapés
        g.fillStyle(wallTheme.trim, 1);
        g.fillPoints([north, west, { x: west.x, y: west.y - 12 }, { x: north.x, y: north.y - 12 }], true);
        g.fillStyle(wallTheme.edge, 1);
        g.fillPoints([north, east, { x: east.x, y: east.y - 12 }, { x: north.x, y: north.y - 12 }], true);

        const wallVec = { x: west.x - north.x, y: west.y - north.y };
        if (wallTheme.pattern === "stripe" || wallTheme.pattern === "neon") {
          g.fillStyle(wallTheme.pattern === "neon" ? 0x56eff2 : 0xffffff, wallTheme.pattern === "neon" ? 0.16 : 0.05);
          for (let t = 0.1; t < 0.95; t += wallTheme.pattern === "neon" ? 0.18 : 0.08) {
            const ax = north.x + wallVec.x * t;
            const ay = north.y + wallVec.y * t;
            const bx = north.x + wallVec.x * (t + (wallTheme.pattern === "neon" ? 0.008 : 0.014));
            const by = north.y + wallVec.y * (t + (wallTheme.pattern === "neon" ? 0.008 : 0.014));
            g.fillPoints([{ x: ax, y: ay }, { x: bx, y: by }, { x: bx, y: by - WALL_HEIGHT + 14 }, { x: ax, y: ay - WALL_HEIGHT + 14 }], true);
          }
        } else if (wallTheme.pattern === "brick") {
          g.lineStyle(2, 0x4c2e31, 0.38);
          for (let level = 24; level < WALL_HEIGHT; level += 24) {
            g.lineBetween(west.x, west.y - level, north.x, north.y - level);
            g.lineBetween(north.x, north.y - level, east.x, east.y - level);
          }
          for (let t = 0.08; t < 0.96; t += 0.16) {
            const point = { x: north.x + wallVec.x * t, y: north.y + wallVec.y * t };
            g.lineBetween(point.x, point.y - WALL_HEIGHT + 8, point.x, point.y - 12);
          }
        } else {
          g.fillStyle(0xb6dfc3, 0.18);
          for (let t = 0.12; t < 0.94; t += 0.16) {
            const point = { x: north.x + wallVec.x * t, y: north.y + wallVec.y * t - 56 };
            g.fillEllipse(point.x, point.y, 13, 25);
            g.fillEllipse(point.x + 12, point.y + 13, 11, 21);
          }
        }

        g.lineStyle(3, wallTheme.trim, 0.8);
        g.strokePoints([{ x: west.x, y: west.y - WALL_HEIGHT }, { x: north.x, y: north.y - WALL_HEIGHT }, { x: east.x, y: east.y - WALL_HEIGHT }], false);

        g.fillStyle(PAL.gold, 0.14);
        g.fillPoints([
          { x: north.x + wallVec.x * 0.06, y: north.y + wallVec.y * 0.06 - WALL_HEIGHT + 16 },
          { x: north.x + wallVec.x * 0.94, y: north.y + wallVec.y * 0.94 - WALL_HEIGHT + 16 },
          { x: north.x + wallVec.x * 0.94, y: north.y + wallVec.y * 0.94 - WALL_HEIGHT + 26 },
          { x: north.x + wallVec.x * 0.06, y: north.y + wallVec.y * 0.06 - WALL_HEIGHT + 26 },
        ], true);

        this.add.rectangle(GRID_ORIGIN_X - 3, north.y - WALL_HEIGHT / 2, 8, WALL_HEIGHT, wallTheme.edge).setDepth(-55);

        // janela na parede esquerda
        const windowStyle = room.windowStyle || "janela_classica";
        const windowStart = windowStyle === "janela_panoramica" ? 0.27 : 0.36;
        const windowEnd = windowStyle === "janela_panoramica" ? 0.62 : windowStyle === "janela_arco" ? 0.55 : 0.52;
        const winA = { x: north.x + wallVec.x * windowStart, y: north.y + wallVec.y * windowStart };
        const winB = { x: north.x + wallVec.x * windowEnd, y: north.y + wallVec.y * windowEnd };
        const winH = windowStyle === "janela_arco" ? 88 : windowStyle === "janela_panoramica" ? 78 : 74;
        const windowFrame = windowStyle === "janela_neon" ? 0x5ff5ef : windowStyle === "janela_arco" ? 0xf2c979 : 0xe8d9ff;
        const windowGlass = windowStyle === "janela_neon" ? 0x7359ad : windowStyle === "janela_arco" ? 0xffdb8b : 0x9fd8ef;
        const windowG = this.add.graphics().setDepth(-50);
        windowG.fillStyle(windowGlass, 1);
        windowG.fillPoints([winA, winB, { x: winB.x, y: winB.y - winH }, { x: winA.x, y: winA.y - winH }], true);
        windowG.fillStyle(windowStyle === "janela_neon" ? 0xe765b5 : 0xc9ecfb, 0.78);
        const winMid = { x: (winA.x + winB.x) / 2, y: (winA.y + winB.y) / 2 };
        windowG.fillPoints([winA, winMid, { x: winMid.x, y: winMid.y - winH }, { x: winA.x, y: winA.y - winH }], true);
        windowG.lineStyle(windowStyle === "janela_neon" ? 6 : 4, windowFrame, 1);
        windowG.strokePoints([winA, winB, { x: winB.x, y: winB.y - winH }, { x: winA.x, y: winA.y - winH }], true);
        windowG.lineStyle(3, windowFrame, 0.9);
        windowG.lineBetween(winMid.x, winMid.y, winMid.x, winMid.y - winH);
        if (windowStyle !== "janela_panoramica") windowG.lineBetween(winA.x, winA.y - winH / 2, winB.x, winB.y - winH / 2);

        const shine = this.add.graphics().setDepth(-49);
        shine.fillStyle(0xffffff, 0.26);
        shine.fillPoints([{ x: winA.x, y: winA.y - 10 }, { x: winA.x + 13, y: winA.y - 16 }, { x: winA.x + 13, y: winA.y - winH + 8 }, { x: winA.x, y: winA.y - winH + 15 }], true);
        if (motionAllowed(this)) this.tweens.add({ targets: shine, alpha: { from: 0.18, to: 0.38 }, duration: 2200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

        const rays = centeredPolygon(this, winMid.x + 66, winMid.y + 120, [0, -80, 130, 24, 30, 150, -60, 40], 0xfff3c9, 0.07).setDepth(-40);
        if (motionAllowed(this)) this.tweens.add({ targets: rays, alpha: { from: 0.08, to: 0.045 }, duration: 3200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

        // quadro na parede direita
        const frameG = this.add.graphics().setDepth(-50);
        frameG.fillStyle(0x8a5a3c, 1);
        frameG.fillPoints([{ x: 690, y: 150 }, { x: 726, y: 132 }, { x: 726, y: 92 }, { x: 690, y: 110 }], true);
        frameG.lineStyle(3, 0xd9b46a, 1);
        frameG.strokePoints([{ x: 690, y: 150 }, { x: 726, y: 132 }, { x: 726, y: 92 }, { x: 690, y: 110 }], true);
        frameG.fillStyle(0x9fd8ef, 1);
        frameG.fillPoints([{ x: 697, y: 139 }, { x: 719, y: 128 }, { x: 719, y: 102 }, { x: 697, y: 113 }], true);
        frameG.fillStyle(0x5ba661, 1);
        frameG.fillPoints([{ x: 697, y: 136 }, { x: 719, y: 125 }, { x: 719, y: 118 }, { x: 697, y: 129 }], true);

        // luminária de teto
        const lampTop = north.y - WALL_HEIGHT;
        const lampG = this.add.graphics().setDepth(-45);
        lampG.lineStyle(3, 0x5c4a7a, 1);
        lampG.lineBetween(GRID_ORIGIN_X + 6, lampTop + 4, GRID_ORIGIN_X + 6, lampTop + 52);
        lampG.fillStyle(PAL.gold, 1);
        lampG.fillTriangle(GRID_ORIGIN_X - 16, lampTop + 74, GRID_ORIGIN_X + 28, lampTop + 74, GRID_ORIGIN_X + 6, lampTop + 52);
        const bulbGlow = this.add.circle(GRID_ORIGIN_X + 6, lampTop + 84, 30, 0xffe9a5, 0.22).setDepth(-46);
        if (motionAllowed(this)) this.tweens.add({ targets: bulbGlow, alpha: { from: 0.24, to: 0.15 }, duration: 2200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

        // poeira flutuando na luz
        for (let i = 0; motionAllowed(this) && i < 8; i += 1) {
          const mote = this.add.circle(winMid.x - 60 + Math.random() * 160, 180 + Math.random() * 140, 1.4 + Math.random() * 1.8, 0xfff3d9, 0.16).setDepth(-30);
          this.tweens.add({
            targets: mote,
            y: mote.y - 70 - Math.random() * 50,
            x: mote.x + (Math.random() * 40 - 20),
            duration: 4200 + Math.random() * 3600,
            repeat: -1,
            onRepeat: () => mote.setPosition(winMid.x - 60 + Math.random() * 160, 300 + Math.random() * 40),
          });
        }
      }

      private buildHeader() {
        const panel = this.add.graphics().setDepth(1200);
        panel.fillStyle(0x2f2148, 0.88);
        panel.fillRoundedRect(GAME_WIDTH / 2 - 176, 16, 352, 56, 12);
        panel.lineStyle(2, 0xe6c7ff, 0.25);
        panel.strokeRoundedRect(GAME_WIDTH / 2 - 176, 16, 352, 56, 12);
        this.headerTitle = uiText(this, GAME_WIDTH / 2, 37, "", 15, "#fff4cf").setDepth(1201);
        this.headerHint = uiText(this, GAME_WIDTH / 2, 60, "", 10, "#e5d9f5").setDepth(1201);
      }

      private buildFloorAndAvatar() {
        const { house, owns } = propsRef.current;

        for (let y = 0; y < GRID_ROWS; y += 1) {
          this.tiles[y] = [];
          for (let x = 0; x < GRID_COLUMNS; x += 1) {
            const position = toIso(x, y);
            const tileColor = this.tileBaseColor(x, y);
            const floorTheme = FLOOR_THEMES[house.house.floorStyle] || FLOOR_THEMES.piso_lilas;
            const tile = centeredPolygon(this, position.x, position.y, [0, -TILE_HEIGHT / 2, TILE_WIDTH / 2, 0, 0, TILE_HEIGHT / 2, -TILE_WIDTH / 2, 0], tileColor)
              .setStrokeStyle(1.5, floorTheme.grid, 0.38)
              .setDepth(position.y)
              .setInteractive({
                hitArea: new Phaser.Geom.Polygon([
                  TILE_WIDTH / 2, 0,
                  TILE_WIDTH, TILE_HEIGHT / 2,
                  TILE_WIDTH / 2, TILE_HEIGHT,
                  0, TILE_HEIGHT / 2,
                ]),
                hitAreaCallback: Phaser.Geom.Polygon.Contains,
                useHandCursor: true,
              });
            tile.on("pointerover", () => tile.setFillStyle(PAL.floorHover, 1));
            tile.on("pointerout", () => tile.setFillStyle(tileColor, 1));
            tile.on("pointerdown", () => {
              if (!propsRef.current.interactionLocked) callbacksRef.current.onClearSelection();
              if (this.avatarRig) this.moveAvatar(this.avatarRig, position.x, position.y);
              const ripple = this.add.graphics().setDepth(1090);
              ripple.lineStyle(3, 0xfff0b8, 0.9);
              ripple.strokePoints(diamondPoints(position.x, position.y, TILE_WIDTH * 0.7, TILE_HEIGHT * 0.7), true, true);
              this.tweens.add({ targets: ripple, scale: 1.35, alpha: 0, duration: 380, ease: "Quad.easeOut", onComplete: () => ripple.destroy() });
            });
            this.tiles[y][x] = tile;
          }
        }

        const avatarPosition = toIso(3, 5);
        this.avatarRig = createAvatarRig(this, house.avatar, owns ? "VOCÊ" : house.host?.nickname || "MORADOR");
        this.avatarRig.root.setPosition(avatarPosition.x, avatarPosition.y + AVATAR_FLOOR_OFFSET_Y).setDepth(avatarPosition.y + 80).setScale(motionAllowed(this) ? 0.96 : 1);
        if (motionAllowed(this)) this.tweens.add({ targets: this.avatarRig.root, scale: 1, alpha: { from: 0, to: 1 }, duration: 260, delay: 80, ease: "Cubic.easeOut" });
      }

      private buildDoor() {
        const { north, west } = this.floorPoints();
        const dir = { x: west.x - north.x, y: west.y - north.y };
        const p0 = { x: north.x + dir.x * 0.045, y: north.y + dir.y * 0.045 };
        const p1 = { x: north.x + dir.x * 0.16, y: north.y + dir.y * 0.16 };
        const doorH = 104;
        const doorG = this.add.graphics().setDepth(-40);
        doorG.fillStyle(0x7a4a5e, 1);
        doorG.fillPoints([p0, p1, { x: p1.x, y: p1.y - doorH }, { x: p0.x, y: p0.y - doorH }], true);
        doorG.lineStyle(5, PAL.outline, 1);
        doorG.strokePoints([p0, p1, { x: p1.x, y: p1.y - doorH }, { x: p0.x, y: p0.y - doorH }], true);
        doorG.lineStyle(2, 0x9a6a7c, 0.8);
        doorG.lineBetween(p0.x + (p1.x - p0.x) * 0.32, p0.y + (p1.y - p0.y) * 0.32 - doorH * 0.82, p0.x + (p1.x - p0.x) * 0.32, p0.y + (p1.y - p0.y) * 0.32 - doorH * 0.2);
        doorG.lineBetween(p0.x + (p1.x - p0.x) * 0.64, p0.y + (p1.y - p0.y) * 0.64 - doorH * 0.82, p0.x + (p1.x - p0.x) * 0.64, p0.y + (p1.y - p0.y) * 0.64 - doorH * 0.2);
        doorG.fillStyle(0xffdf72, 1);
        doorG.fillCircle(p1.x - (p1.x - p0.x) * 0.16, p1.y - (p1.y - p0.y) * 0.16 - doorH * 0.45, 4);

        const glow = this.add.graphics().setDepth(-41);
        glow.lineStyle(4, PAL.gold, 0);
        glow.strokePoints([p0, p1, { x: p1.x, y: p1.y - doorH }, { x: p0.x, y: p0.y - doorH }], true);

        const signX = (p0.x + p1.x) / 2;
        const signY = (p0.y + p1.y) / 2 - doorH - 28;
        const sign = labelChip(this, "SAIR PARA O BAIRRO ▸", 0x4a2c58, 0xd9a8e0, "#ffe9f4");
        sign.setPosition(signX, signY).setDepth(1300);
        if (motionAllowed(this)) this.tweens.add({ targets: sign, y: signY - 3, duration: 1300, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

        const zone = this.add.zone(signX, (p0.y + p1.y) / 2 - doorH / 2, 96, doorH + 48).setDepth(1301);
        zone.setInteractive({ hitArea: new Phaser.Geom.Rectangle(-48, -(doorH + 48) / 2, 96, doorH + 48), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
        zone.on("pointerover", () => this.tweens.add({ targets: glow, alpha: { from: 0, to: 1 }, duration: 160 }));
        zone.on("pointerout", () => this.tweens.add({ targets: glow, alpha: 0, duration: 220 }));
        zone.on("pointerdown", () => {
          this.cameras.main.fadeOut(motionAllowed(this) ? 180 : 0, 12, 7, 22);
          this.cameras.main.once("camerafadeoutcomplete", () => callbacksRef.current.onExit());
        });
      }

      private buildHouseKey(items: HouseItem[]) {
        const { house, owns } = propsRef.current;
        return [
          owns ? "own" : `host:${house.host?.nickname || ""}`,
          items.filter((i) => i.placed).map((i) => `${i.id}:${i.x},${i.y}:r${itemRotation(i)}`).join("|"),
        ].join("#");
      }

      private syncSelection() {
        const selected = propsRef.current.selectedItemId;
        this.furnitureRigs.forEach((rig) => rig.selection.setVisible(rig.itemId === selected));
      }

      private syncHouse() {
        const { house, owns } = propsRef.current;
        this.headerTitle?.setText(owns ? "SUA CASA NO BECO" : `CASA DE ${(house.host?.nickname || "UM VIZINHO").toUpperCase()}`);
        this.headerHint?.setText(owns ? "toque no piso para andar · segure e arraste para decorar" : "toque no piso para explorar");

        const key = this.buildHouseKey(house.items);
        if (key === this.lastHouseKey) {
          this.syncSelection();
          return;
        }
        this.lastHouseKey = key;

        const previousRotations = new Map(this.furnitureRigs.map((rig) => [rig.itemId, rig.rotation]));
        this.furnitureRigs.forEach((rig) => destroyTree(this, rig.root));
        this.furnitureRigs = [];

        for (const item of house.items.filter((entry) => entry.placed)) {
          const gridPosition = toIso(item.x, item.y);
          const position = furnitureFloorPosition(item);
          const furniture = createFurniture(this, item);
          const baseScale = 1;
          furniture.setPosition(position.x, position.y).setDepth(gridPosition.y + 40);
          const selection = selectionAura(this, furniture, itemLabels[item.itemId] || "Móvel");
          const rotation = itemRotation(item);
          const rig: FurnitureRig = { root: furniture, itemId: item.id, rotation, selection };
          this.furnitureRigs.push(rig);
          const previousRotation = previousRotations.get(item.id);
          if (previousRotation != null && previousRotation !== rotation && motionAllowed(this)) {
            furniture.setPosition(position.x, position.y - 5).setScale(0.84).setAlpha(0.25);
            this.tweens.add({
              targets: furniture,
              x: { from: position.x + (rotation === 1 || rotation === 2 ? 7 : -7), to: position.x },
              y: position.y,
              scale: baseScale,
              alpha: 1,
              duration: 210,
              ease: "Back.easeOut",
            });
          }
          if (!owns) {
            continue;
          }

          furniture.setData("dragging", false);
          furniture.setInteractive({ hitArea: new Phaser.Geom.Rectangle(-52, -112, 104, 124), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
          this.input.setDraggable(furniture);
          furniture.on("pointerover", () => {
            if (propsRef.current.interactionLocked) return;
            this.tweens.killTweensOf(furniture);
            this.tweens.add({ targets: furniture, scale: baseScale * 1.035, duration: motionDuration(this, 140), ease: "Cubic.easeOut" });
          });
          furniture.on("pointerout", () => {
            if (furniture.getData("dragging")) return;
            this.tweens.killTweensOf(furniture);
            this.tweens.add({ targets: furniture, scale: baseScale, duration: motionDuration(this, 140), ease: "Cubic.easeOut" });
          });
          furniture.on("pointerdown", () => {
            if (!propsRef.current.interactionLocked) callbacksRef.current.onSelectItem(item);
          });
          furniture.on("dragstart", () => {
            if (propsRef.current.interactionLocked) return;
            this.tweens.killTweensOf(furniture);
            furniture.setData("dragging", true);
            this.dragCell = { x: item.x, y: item.y };
            this.dragCellValid = true;
            furniture.setScale(baseScale * 1.06).setDepth(5000).setAlpha(0.94);
          });
          furniture.on("drag", (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
            if (!furniture.getData("dragging")) return;
            furniture.setPosition(dragX, dragY);
            const cell = cellFromFurniturePosition(dragX, dragY);
            this.setDropHint(cell, isGridCellAvailable(propsRef.current.house.items, item.id, cell));
          });
          furniture.on("dragend", () => {
            if (!furniture.getData("dragging")) return;
            furniture.setData("dragging", false);
            const next = resolveDropCell(this.dragCell, this.dragCellValid);
            this.setDropHint(null, false);
            if (next) {
              const snappedGrid = toIso(next.x, next.y);
              const snapped = furnitureFloorPosition(next);
              this.tweens.killTweensOf(furniture);
              this.tweens.add({ targets: furniture, x: snapped.x, y: snapped.y, scale: baseScale, alpha: 1, duration: motionDuration(this, 220), ease: "Cubic.easeOut" });
              furniture.setDepth(snappedGrid.y + 40);
              const echoedItems = propsRef.current.house.items.map((entry) => (entry.id === item.id ? { ...entry, x: next.x, y: next.y } : entry));
              this.lastHouseKey = this.buildHouseKey(echoedItems);
              void Promise.resolve(callbacksRef.current.onMoveItem(item, next.x, next.y)).then((saved) => {
                if (saved || !alive(furniture)) return;
                this.lastHouseKey = this.buildHouseKey(propsRef.current.house.items);
                this.tweens.killTweensOf(furniture);
                this.tweens.add({ targets: furniture, x: position.x, y: position.y, scale: baseScale, alpha: 1, duration: motionDuration(this, 220), ease: "Cubic.easeOut" });
                furniture.setDepth(gridPosition.y + 40);
              });
            } else {
              this.tweens.killTweensOf(furniture);
              if (motionAllowed(this)) {
                this.tweens.add({
                  targets: furniture,
                  x: { from: furniture.x - 4, to: furniture.x + 4 },
                  duration: 45,
                  yoyo: true,
                  repeat: 2,
                  onComplete: () => this.tweens.add({ targets: furniture, x: position.x, y: position.y, scale: baseScale, alpha: 1, duration: 180, ease: "Cubic.easeOut" }),
                });
              } else {
                furniture.setPosition(position.x, position.y).setScale(baseScale).setAlpha(1);
              }
              furniture.setDepth(gridPosition.y + 40);
            }
          });
        }
        this.syncSelection();
      }

      private createHouse() {
        this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x20142f).setDepth(-100);
        this.lastStructureKey = this.buildStructureKey();
        this.buildStaticHouse();
        this.buildHeader();
        this.buildFloorAndAvatar();
        this.buildDoor();
        this.syncHouse();
      }

      private buildSky() {
        if (!this.textures.exists("casas-sky")) {
          const canvasTexture = this.textures.createCanvas("casas-sky", GAME_WIDTH, 330);
          if (canvasTexture) {
            const ctx = canvasTexture.getContext();
            const gradient = ctx.createLinearGradient(0, 0, 0, 330);
            gradient.addColorStop(0, "#6db7ea");
            gradient.addColorStop(0.55, "#a7d8f2");
            gradient.addColorStop(1, "#ffedc9");
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, GAME_WIDTH, 330);
            canvasTexture.refresh();
          }
        }
        this.add.image(GAME_WIDTH / 2, 165, "casas-sky").setDepth(-100);

        const sunRays = this.add.graphics();
        sunRays.fillStyle(0xfff3c4, 0.13);
        for (let i = 0; i < 10; i += 1) {
          const angle = (i / 10) * Math.PI * 2;
          sunRays.fillTriangle(Math.cos(angle - 0.13) * 34, Math.sin(angle - 0.13) * 34, Math.cos(angle + 0.13) * 34, Math.sin(angle + 0.13) * 34, Math.cos(angle) * 66, Math.sin(angle) * 66);
        }
        const sunGlow = this.add.circle(0, 0, 44, 0xffed9a, 0.35);
        const sun = this.add.container(828, 96, [sunRays, sunGlow, this.add.circle(0, 0, 30, 0xffed9a).setStrokeStyle(4, 0xffd26d)]).setDepth(-95);
        if (motionAllowed(this)) {
          this.tweens.add({ targets: sun, rotation: Math.PI * 2, duration: 56000, repeat: -1 });
          this.tweens.add({ targets: sunGlow, scale: { from: 1, to: 1.08 }, duration: 2800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
        }

        const cloudSpecs: Array<[number, number, number, number]> = [
          [180, 58, 1, 22],
          [520, 108, 0.72, 30],
          [780, 46, 0.9, 18],
          [340, 150, 0.55, 26],
        ];
        cloudSpecs.forEach(([x, y, scale, speed]) => {
          const cloud = this.add.container(x, y, [
            this.add.ellipse(-26, 4, 44, 20, 0xffffff, 0.92),
            this.add.ellipse(0, -6, 58, 28, 0xffffff, 0.95),
            this.add.ellipse(30, 2, 46, 22, 0xffffff, 0.9),
            this.add.ellipse(8, 8, 70, 16, 0xffffff, 0.85),
          ]).setScale(scale).setAlpha(0.85).setDepth(-90);
          if (motionAllowed(this)) {
            this.drifters.push({ obj: cloud, speed });
            this.tweens.add({ targets: cloud, y: y + 4, duration: 3200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
          }
        });

        const birdSpecs: Array<[number, number, number]> = [
          [120, 26, 0],
          [156, 30, 9000],
        ];
        birdSpecs.forEach(([y, speed, delay]) => {
          const wingL = this.add.rectangle(-5, 0, 12, 3, 0x2f3542).setOrigin(1, 0.5);
          const wingR = this.add.rectangle(5, 0, 12, 3, 0x2f3542).setOrigin(0, 0.5);
          const bird = this.add.container(GAME_WIDTH + 60, y, [wingL, wingR]).setDepth(-80).setAlpha(0.8);
          if (motionAllowed(this)) {
            this.drifters.push({ obj: bird, speed });
            this.tweens.add({ targets: wingL, rotation: { from: -0.6, to: 0.5 }, duration: 240, yoyo: true, repeat: -1, delay, ease: "Sine.easeInOut" });
            this.tweens.add({ targets: wingR, rotation: { from: 0.6, to: -0.5 }, duration: 240, yoyo: true, repeat: -1, delay, ease: "Sine.easeInOut" });
            this.tweens.add({ targets: bird, y: y - 10, duration: 1800, yoyo: true, repeat: -1, delay, ease: "Sine.easeInOut" });
          }
        });

        const hills = this.add.graphics().setDepth(-92);
        hills.fillStyle(0x9fd0a8, 0.85);
        hills.fillPoints([{ x: 0, y: 330 }, { x: 130, y: 268 }, { x: 320, y: 322 }, { x: 520, y: 252 }, { x: 760, y: 320 }, { x: 960, y: 276 }, { x: 960, y: 340 }, { x: 0, y: 340 }], true);
        hills.fillStyle(0x7fbf7e, 0.9);
        hills.fillPoints([{ x: 0, y: 344 }, { x: 200, y: 300 }, { x: 430, y: 342 }, { x: 700, y: 296 }, { x: 960, y: 338 }, { x: 960, y: 360 }, { x: 0, y: 360 }], true);
      }

      private buildStreet() {
        const ground = this.add.graphics().setDepth(-70);
        ground.fillStyle(0x74b063, 1);
        ground.fillRect(0, 330, GAME_WIDTH, GAME_HEIGHT - 330);
        ground.fillStyle(0x82bf70, 0.5);
        for (let i = 0; i < 26; i += 1) ground.fillCircle(Math.random() * GAME_WIDTH, 350 + Math.random() * 200, 2.4);
        ground.fillStyle(0x5f5f6b, 1);
        ground.fillRect(0, 588, GAME_WIDTH, 66);
        ground.fillStyle(0xcfcfd8, 1);
        ground.fillRect(0, 578, GAME_WIDTH, 12);
        ground.fillRect(0, 652, GAME_WIDTH, 12);
        ground.fillStyle(0xffffff, 0.85);
        for (let x = 8; x < GAME_WIDTH; x += 74) ground.fillRect(x, 617, 40, 6);
        for (let i = 0; i < 5; i += 1) ground.fillRect(430 + i * 26, 588, 14, 66);

        createTree(this, 64, 430, 1.05);
        createTree(this, 918, 402, 0.92);
        createTree(this, 252, 572, 0.7);
        createLampPost(this, 350, 576);
        createLampPost(this, 640, 676);

        const hydrant = this.add.container(912, 596, [
          this.add.ellipse(0, 2, 22, 7, 0x2d2340, 0.3),
          this.add.rectangle(0, -12, 12, 22, 0xd8574f).setStrokeStyle(3, 0x8a342f),
          this.add.circle(0, -24, 8, 0xd8574f).setStrokeStyle(3, 0x8a342f),
          this.add.rectangle(-9, -14, 5, 8, 0x8a342f),
          this.add.rectangle(9, -14, 5, 8, 0x8a342f),
        ]);
        if (motionAllowed(this)) this.tweens.add({ targets: hydrant, y: { from: 596, to: 594 }, duration: 1800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

        const signG = this.add.graphics().setDepth(-60);
        signG.fillStyle(0x8a5a3c, 1);
        signG.fillRoundedRect(24, 34, 268, 62, 10);
        signG.lineStyle(4, 0x5c3a24, 1);
        signG.strokeRoundedRect(24, 34, 268, 62, 10);
        signG.fillStyle(0x6e4a30, 1);
        signG.fillRect(40, 96, 10, 34);
        signG.fillRect(266, 96, 10, 34);
        const signTitle = uiText(this, 158, 56, "BAIRRO DO GRUPO", 19, "#fff4cf", "#3a2418", 5).setDepth(-59);
        const signHint = uiText(this, 158, 78, "toque em uma casa para visitar", 11, "#ffe6bd", "#3a2418", 3).setDepth(-59);
        if (motionAllowed(this)) this.tweens.add({ targets: [signTitle, signHint], y: "-=2", duration: 1600, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      }

      private syncNeighborhood() {
        const { neighborhood } = propsRef.current;
        const key = neighborhood.map((n) => `${n.id}:${n.nickname}:${n.securityLevel}`).join("|");
        if (key === this.lastNeighborhoodKey) return;
        this.lastNeighborhoodKey = key;

        this.neighborHouses.forEach((house) => destroyTree(this, house));
        this.neighborHouses = [];

        this.neighborHouses.push(
          createStreetHouse(this, 168, 512, 1, "Sua casa", 0x9466cf, 0xe8b64f, {
            onClick: () => {
              this.cameras.main.fadeOut(motionAllowed(this) ? 180 : 0, 12, 7, 22);
              this.cameras.main.once("camerafadeoutcomplete", () => callbacksRef.current.onExit());
            },
            own: true,
            entranceDelay: 60,
          }),
        );

        const slots = [
          { x: 356, y: 388, scale: 0.84 },
          { x: 600, y: 372, scale: 0.84 },
          { x: 836, y: 400, scale: 0.84 },
          { x: 462, y: 528, scale: 1 },
          { x: 726, y: 544, scale: 1 },
        ];
        const bodies = [0xd9825f, 0x6fa8dc, 0xc9a2c7, 0x8fd4a0, 0xe0a95f];
        const roofs = [0x8a4a3a, 0x3f6f9f, 0x7a4a78, 0x4a8a5c, 0xa06a34];
        neighborhood.slice(0, slots.length).forEach((neighbor, index) => {
          const slot = slots[index];
          this.neighborHouses.push(
            createStreetHouse(this, slot.x, slot.y, slot.scale, neighbor.nickname, bodies[index % bodies.length], neighbor.securityLevel > 1 ? 0x6087ce : roofs[index % roofs.length], {
              onClick: () => callbacksRef.current.onOpenNeighbor(neighbor),
              securityLevel: neighbor.securityLevel,
              entranceDelay: 140 + index * 90,
            }),
          );
        });

        if (!neighborhood.length) {
          const emptyG = this.add.graphics().setDepth(-50);
          emptyG.fillStyle(0x33234a, 0.82);
          emptyG.fillRoundedRect(GAME_WIDTH / 2 - 250, 428, 500, 92, 14);
          emptyG.lineStyle(2, 0xe6c7ff, 0.3);
          emptyG.strokeRoundedRect(GAME_WIDTH / 2 - 250, 428, 500, 92, 14);
          this.add
            .text(GAME_WIDTH / 2, 474, "O bairro ainda está quieto.\nQuando novos moradores chegarem, as casas aparecerão aqui.", { align: "center", fontFamily: "monospace", fontSize: "15px", color: "#ffffff", stroke: "#38516b", strokeThickness: 4 })
            .setOrigin(0.5)
            .setDepth(-49);
        }
      }

      private createNeighborhood() {
        this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x74b063).setDepth(-110);
        this.buildSky();
        this.buildStreet();
        this.syncNeighborhood();
      }
    }

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerId,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      antialias: true,
      antialiasGL: true,
      pixelArt: false,
      roundPixels: false,
      backgroundColor: "#20142f",
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, width: GAME_WIDTH, height: GAME_HEIGHT },
      scene: BecoScene,
    });

    return () => {
      sceneRef.current = null;
      game.destroy(true);
    };
  }, [containerId]);

  useEffect(() => {
    sceneRef.current?.applyViewport(viewportMode);
  }, [viewportMode]);

  useEffect(() => {
    sceneRef.current?.applyMotionPreference(reducedMotion);
  }, [reducedMotion]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (scene.getMode() !== mode) {
      scene.switchMode(mode);
      return;
    }
    scene.syncDynamic();
  }, [mode, house, neighborhood, owns, selectedItemId, containerId]);

  return <div id={containerId} className="house-game-canvas" aria-label={mode === "house" ? "Casa isométrica interativa" : "Mapa interativo do bairro"} />;
}
