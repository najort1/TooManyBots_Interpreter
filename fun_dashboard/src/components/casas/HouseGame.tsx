"use client";

import * as Phaser from "phaser";
import { useEffect, useId, useRef, useState } from "react";
import type { HouseItem, HouseView, NeighborhoodHouse } from "@/lib/types";

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
  onMoveItem: (item: HouseItem, x: number, y: number) => void;
};

const GAME_WIDTH = 960;
const GAME_HEIGHT = 720;
const GRID_COLUMNS = 6;
const GRID_ROWS = 8;
const TILE_WIDTH = 126;
const TILE_HEIGHT = 63;
const GRID_ORIGIN_X = 543;
const GRID_ORIGIN_Y = 232;
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

const itemLabels: Record<string, string> = {
  sofa_inicial: "Sofá de entrada",
  planta_inicial: "Planta sobrevivente",
  tapete_rua: "Tapete da rua",
  luminaria_neon: "Luminária neon",
  estante_caotica: "Estante caótica",
  tv_tubo: "TV de tubo",
  geladeira_premium: "Geladeira premium",
  gato_sindico: "Gato síndico",
  camera_porta: "Câmera de porta",
};

function toIso(x: number, y: number) {
  return { x: GRID_ORIGIN_X + (x - y) * (TILE_WIDTH / 2), y: GRID_ORIGIN_Y + (x + y) * (TILE_HEIGHT / 2) };
}

function fromIso(screenX: number, screenY: number) {
  const horizontal = (screenX - GRID_ORIGIN_X) / (TILE_WIDTH / 2);
  const vertical = (screenY - GRID_ORIGIN_Y) / (TILE_HEIGHT / 2);
  const x = Math.round((vertical + horizontal) / 2);
  const y = Math.round((vertical - horizontal) / 2);
  if (x < 0 || x >= GRID_COLUMNS || y < 0 || y >= GRID_ROWS) return null;
  return { x, y };
}

function diamondPoints(cx: number, cy: number, w = TILE_WIDTH, h = TILE_HEIGHT) {
  return [
    { x: cx, y: cy - h / 2 },
    { x: cx + w / 2, y: cy },
    { x: cx, y: cy + h / 2 },
    { x: cx - w / 2, y: cy },
  ];
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
  breathing: Phaser.Tweens.Tween;
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
    bobber.add(scene.add.text(0, -96, "♛", { fontFamily: "monospace", fontSize: "40px", color: "#ffe082", stroke: "#754e24", strokeThickness: 3 }).setOrigin(0.5));
  }
  if (accessory === "corrente_brilho") {
    bobber.add(scene.add.ellipse(0, 8, 36, 12, 0xffd34f).setStrokeStyle(3, 0x7b4d1b));
  }

  const nameplate = scene.add.text(0, -122, name.toUpperCase(), { fontFamily: "monospace", fontSize: "12px", color: "#fff5d2", backgroundColor: "#2a1b43", padding: { x: 7, y: 4 } }).setOrigin(0.5);
  root.add([scene.add.ellipse(0, 30, 74, 20, 0x120d20, 0.32), bobber, nameplate]);

  const rig: AvatarRig = {
    root,
    bobber,
    face,
    breathing: scene.tweens.add({ targets: bobber, y: -3, duration: 1500, yoyo: true, repeat: -1, ease: "Sine.easeInOut" }),
    walkTweens: [
      scene.tweens.add({ targets: legL, rotation: { from: -0.5, to: 0.5 }, duration: 190, yoyo: true, repeat: -1, ease: "Sine.easeInOut" }),
      scene.tweens.add({ targets: legR, rotation: { from: 0.5, to: -0.5 }, duration: 190, yoyo: true, repeat: -1, ease: "Sine.easeInOut" }),
      scene.tweens.add({ targets: armL, rotation: { from: 0.34, to: -0.06 }, duration: 190, yoyo: true, repeat: -1, ease: "Sine.easeInOut" }),
      scene.tweens.add({ targets: armR, rotation: { from: -0.06, to: 0.34 }, duration: 190, yoyo: true, repeat: -1, ease: "Sine.easeInOut" }),
      scene.tweens.add({ targets: bobber, y: -7, duration: 95, yoyo: true, repeat: -1, ease: "Quad.easeOut" }),
    ],
    leanTween: null,
    walking: false,
  };
  rig.walkTweens.forEach((tween) => tween.pause());

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

  return rig;
}

function dustPuff(scene: Phaser.Scene, x: number, y: number) {
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

function selectionAura(scene: Phaser.Scene, parent: Phaser.GameObjects.Container) {
  const aura = scene.add.ellipse(0, 8, 104, 34).setStrokeStyle(3, PAL.gold, 0.95);
  const corners = [
    [-46, -6],
    [46, -6],
    [-46, -46],
    [46, -46],
  ].map(([cx, cy]) => scene.add.triangle(cx, cy, -5, 8, 5, 8, 0, -6, PAL.gold).setStrokeStyle(1, 0x8a6a1f));
  const label = labelChip(scene, "SELECIONADO", 0x3d2a12, PAL.gold, "#ffe9a8");
  label.setPosition(0, -110);
  parent.add(scene.add.container(0, 0, [aura, ...corners, label]));
  scene.tweens.add({ targets: aura, scaleX: { from: 0.94, to: 1.06 }, alpha: { from: 0.95, to: 0.55 }, duration: 640, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  corners.forEach((corner, index) => scene.tweens.add({ targets: corner, y: corner.y - 5, duration: 520, yoyo: true, repeat: -1, delay: index * 90, ease: "Sine.easeInOut" }));
  scene.tweens.add({ targets: label, y: label.y - 5, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
}

function createFurniture(scene: Phaser.Scene, item: HouseItem) {
  const container = scene.add.container(0, 0);
  container.add(scene.add.ellipse(0, 6, 78, 22, 0x160d24, 0.3));
  const outline = PAL.outline;

  if (item.itemId === "sofa_inicial") {
    container.add([
      scene.add.rectangle(-30, -22, 16, 44, 0x35548f).setStrokeStyle(4, outline),
      scene.add.rectangle(30, -22, 16, 44, 0x35548f).setStrokeStyle(4, outline),
      scene.add.rectangle(0, -46, 78, 26, 0x4e83df).setStrokeStyle(4, outline),
      scene.add.rectangle(0, -18, 80, 24, 0x6fa8f5).setStrokeStyle(4, outline),
      scene.add.rectangle(-18, -30, 30, 12, 0x8fc1ff, 0.85),
      scene.add.rectangle(18, -30, 30, 12, 0x8fc1ff, 0.85),
      scene.add.rectangle(-27, 6, 10, 12, 0x1d2a52),
      scene.add.rectangle(27, 6, 10, 12, 0x1d2a52),
    ]);
  } else if (item.itemId === "planta_inicial") {
    const foliage = scene.add.container(0, -34);
    foliage.add([
      scene.add.rectangle(0, 18, 7, 26, 0x3f7a4c).setStrokeStyle(2, 0x275232),
      scene.add.circle(-16, -8, 17, 0x59a66a).setStrokeStyle(3, outline),
      scene.add.circle(12, -14, 20, 0x77ca7b).setStrokeStyle(3, outline),
      scene.add.circle(19, 6, 14, 0x4a925d).setStrokeStyle(3, outline),
      scene.add.circle(-4, 4, 12, 0x6dbd72).setStrokeStyle(3, outline),
    ]);
    container.add([
      scene.add.polygon(0, 6, [-17, 0, 17, 0, 13, 26, -13, 26], 0xc8784e).setStrokeStyle(4, outline),
      scene.add.rectangle(0, 0, 40, 8, 0xe09468).setStrokeStyle(3, outline),
      foliage,
    ]);
    scene.tweens.add({ targets: foliage, rotation: { from: -0.05, to: 0.05 }, duration: 2100, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  } else if (item.itemId === "tapete_rua") {
    const stitches: Phaser.GameObjects.Rectangle[] = [];
    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2;
      stitches.push(scene.add.rectangle(Math.cos(angle) * 42, 11 + Math.sin(angle) * 15, 5, 5, 0xf5e2c0));
    }
    container.add([
      scene.add.ellipse(0, 11, 98, 40, 0xcf7151).setStrokeStyle(4, outline),
      scene.add.ellipse(0, 11, 72, 27, 0xf5bc76).setStrokeStyle(2, 0xa85837),
      scene.add.ellipse(0, 11, 40, 14, 0xcf7151),
      scene.add.ellipse(0, 11, 16, 6, 0xf5bc76),
      ...stitches,
    ]);
  } else if (item.itemId === "luminaria_neon") {
    const glow = scene.add.circle(0, -34, 30, 0x70eefa, 0.16);
    const glow2 = scene.add.circle(0, -34, 44, 0x70eefa, 0.08);
    container.add([
      scene.add.ellipse(0, 10, 40, 12, 0x2c3550).setStrokeStyle(3, outline),
      scene.add.rectangle(0, -10, 8, 44, 0x3f4b6e).setStrokeStyle(2, outline),
      scene.add.circle(0, -34, 20, 0x70eefa).setStrokeStyle(4, outline),
      scene.add.circle(0, -34, 9, 0xf4ffff),
      glow2,
      glow,
    ]);
    scene.tweens.add({ targets: [glow, glow2], alpha: { from: 0.28, to: 0.06 }, duration: 1200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  } else if (item.itemId === "estante_caotica") {
    const books: Phaser.GameObjects.Rectangle[] = [];
    const bookColors = [0xe85e5d, 0x6ebce7, 0xf0ca67, 0x9be08a, 0xd98cf0];
    for (let shelf = 0; shelf < 3; shelf += 1) {
      let bx = -20;
      let count = 0;
      while (bx < 18 && count < 5) {
        const w = 8 + Math.floor(Math.random() * 4);
        const h = 14 + Math.floor(Math.random() * 6);
        const book = scene.add.rectangle(bx + w / 2, -32 + shelf * 22 - h / 2, w, h, bookColors[(shelf * 2 + count) % bookColors.length]).setStrokeStyle(2, 0x33213d);
        if (shelf === 1 && count === 3) book.setRotation(-0.24);
        books.push(book);
        bx += w + 1;
        count += 1;
      }
    }
    container.add([
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
    container.add([
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
    scene.tweens.add({ targets: scanline, y: { from: -26, to: -2 }, duration: 700, repeat: -1, onRepeat: () => scanline.setX(-20 + Math.random() * 8) });
    scene.time.addEvent({
      delay: 1800,
      loop: true,
      callback: () => {
        if (!alive(snow)) return;
        snow.setPosition(-20 + Math.random() * 34, -25 + Math.random() * 22);
        scene.tweens.add({ targets: snow, alpha: { from: 0.9, to: 0 }, duration: 320, onComplete: () => snow.setAlpha(0.8) });
      },
    });
  } else if (item.itemId === "geladeira_premium") {
    container.add([
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
    container.add([
      scene.add.ellipse(0, -8, 52, 34, 0xf3aa5f).setStrokeStyle(4, outline),
      scene.add.ellipse(-8, -16, 26, 10, 0xd98f45, 0.7),
      scene.add.ellipse(8, -14, 22, 9, 0xd98f45, 0.7),
      scene.add.rectangle(-12, 10, 9, 10, 0xe89a4d).setStrokeStyle(2, outline),
      scene.add.rectangle(12, 10, 9, 10, 0xe89a4d).setStrokeStyle(2, outline),
      head,
      tail,
    ]);
    scene.tweens.add({ targets: tail, rotation: { from: -0.34, to: 0.3 }, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    scene.tweens.add({ targets: head, y: { from: -30, to: -34 }, duration: 1300, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  } else if (item.itemId === "camera_porta") {
    const led = scene.add.circle(-16, -14, 3.5, 0x7dffa0);
    const cone = scene.add.polygon(-20, 6, [0, -8, -52, 26, -34, 34], 0x9fe4ff, 0.12);
    container.add([
      scene.add.rectangle(-6, 14, 10, 26, 0x354158).setStrokeStyle(2, outline),
      scene.add.ellipse(-6, 26, 22, 8, 0x2c3850).setStrokeStyle(2, outline),
      scene.add.rectangle(2, -10, 12, 26, 0x5b6a87).setStrokeStyle(3, outline),
      scene.add.rectangle(-6, -16, 58, 22, 0x5b6a87).setStrokeStyle(4, outline),
      scene.add.circle(18, -16, 11, 0x79dcff).setStrokeStyle(3, outline),
      scene.add.circle(18, -16, 5, 0xd8f6ff),
      cone,
      led,
    ]);
    scene.tweens.add({ targets: led, alpha: { from: 1, to: 0.15 }, duration: 460, yoyo: true, repeat: -1, ease: "Quad.easeInOut" });
    scene.tweens.add({ targets: cone, alpha: { from: 0.14, to: 0.03 }, duration: 2000, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  } else {
    container.add(scene.add.rectangle(0, -20, 52, 44, 0x948aa8).setStrokeStyle(4, outline));
  }

  if (item.rotated) container.setRotation(-0.09).setScale(0.97);
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
  scene.tweens.add({ targets: foliage, rotation: { from: -0.03, to: 0.03 }, duration: 2300, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
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
  scene.tweens.add({ targets: glow, alpha: { from: 0.28, to: 0.1 }, duration: 1600, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
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
    scene.add.polygon(62, -96, [0, 0, 34, -17, 34, 72, 0, 88], bodyColor, 0.75).setStrokeStyle(4, 0x332342),
    scene.add.rectangle(0, -50, 124, 100, bodyColor).setStrokeStyle(5, 0x332342),
    scene.add.rectangle(30, -50, 12, 100, 0x000000, 0.1),
    scene.add.polygon(0, -114, [0, -40, 78, 4, 0, 40, -78, 4], roofColor).setStrokeStyle(5, 0x332342),
    scene.add.polygon(44, -114, [0, -40, 78, 4, 0, 40], roofColor, 0.55),
    scene.add.rectangle(-40, -148, 14, 34, 0x8a5a5a).setStrokeStyle(3, 0x5c3a3a),
    scene.add.rectangle(0, -26, 38, 56, 0x704351).setStrokeStyle(4, 0x332342),
    scene.add.circle(26, -22, 3.5, 0xffdf72),
    scene.add.rectangle(-18, -4, 46, 8, 0x9a8f77).setStrokeStyle(3, 0x332342),
  ]);

  const windowGlowA = scene.add.rectangle(-42, -66, 24, 26, 0xffe99d, 0.9).setStrokeStyle(4, 0xf2e6c8);
  const windowGlowB = scene.add.rectangle(42, -66, 24, 26, 0xffe99d, 0.9).setStrokeStyle(4, 0xf2e6c8);
  art.add([windowGlowA, windowGlowB]);
  scene.tweens.add({ targets: [windowGlowA, windowGlowB], fillAlpha: { from: 0.95, to: 0.55 }, duration: 2400, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

  scene.time.addEvent({
    delay: 1150,
    loop: true,
    callback: () => {
      if (!alive(art)) return;
      const puff = scene.add.circle(x - 40 * scale, y - 152 * scale, 6, 0xe8ecf4, 0.5).setDepth(-60);
      scene.tweens.add({ targets: puff, y: puff.y - 42, x: puff.x + 10, scale: 1.8, alpha: 0, duration: 1900, ease: "Sine.easeOut", onComplete: () => puff.destroy() });
    },
  });

  const trimmedLabel = label.length > 14 ? `${label.slice(0, 13)}…` : label;
  const plate = labelChip(scene, trimmedLabel.toUpperCase(), 0x6e4a30, 0x46301f, "#ffeccc");
  plate.setPosition(0, 32);
  art.add(plate);

  if (options.securityLevel != null) {
    const badgeColors = [0x77d48f, 0xe8c45e, 0xe0705f];
    const level = Phaser.Math.Clamp(options.securityLevel, 1, 3);
    const badge = scene.add.container(74, 34, [
      scene.add.polygon(0, 0, [0, -10, 9, -6, 9, 4, 0, 11, -9, 4, -9, -6], badgeColors[level - 1]).setStrokeStyle(2, 0x2c2c34),
      uiText(scene, 0, -1, String(level), 11, "#2c2c34", "#2c2c34", 0),
    ]);
    art.add(badge);
    scene.tweens.add({ targets: badge, y: { from: 34, to: 30 }, duration: 1300, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }

  if (options.own) {
    const pennant = scene.add.triangle(3, -12, 0, -10, 34, 0, 0, 10, PAL.gold).setStrokeStyle(2, 0x8a6a1f).setOrigin(0, 0.5);
    const flag = scene.add.container(-84, -120, [
      scene.add.rectangle(0, 12, 5, 52, 0xd8cba8).setStrokeStyle(2, 0x8a7c5c),
      pennant,
    ]);
    art.add(flag);
    scene.tweens.add({ targets: pennant, scaleX: { from: 1, to: 0.7 }, duration: 700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    const ownChip = labelChip(scene, "SUA CASA", 0x3d2a12, PAL.gold, "#ffe9a8");
    ownChip.setPosition(0, -188);
    art.add(ownChip);
    const arrow = scene.add.triangle(0, -166, -8, 0, 8, 0, 0, 12, PAL.gold).setStrokeStyle(2, 0x8a6a1f);
    art.add(arrow);
    scene.tweens.add({ targets: arrow, y: { from: -172, to: -158 }, duration: 620, yoyo: true, repeat: -1, ease: "Quad.easeInOut" });
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
    scene.tweens.add({ targets: house, alpha: 1, y, duration: 420, delay: options.entranceDelay, ease: "Back.easeOut" });
  }
  return house;
}

type BecoSceneAPI = {
  getMode: () => WorldMode;
  switchMode: (mode: WorldMode) => void;
  syncDynamic: () => void;
  applyViewport: (viewport: ViewportMode) => void;
};

type Drifter = { obj: Phaser.GameObjects.Container; speed: number };

export default function HouseGame({ mode, house, neighborhood, owns, selectedItemId, onExit, onOpenNeighbor, onSelectItem, onMoveItem }: HouseGameProps) {
  const rawId = useId();
  const containerId = `house-game-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const callbacksRef = useRef({ onExit, onOpenNeighbor, onSelectItem, onMoveItem });
  const propsRef = useRef({ mode, house, neighborhood, owns, selectedItemId, viewportMode: "desktop" as ViewportMode });
  const sceneRef = useRef<(Phaser.Scene & BecoSceneAPI) | null>(null);
  const [viewportMode, setViewportMode] = useState<ViewportMode>("desktop");

  callbacksRef.current = { onExit, onOpenNeighbor, onSelectItem, onMoveItem };
  propsRef.current = { mode, house, neighborhood, owns, selectedItemId, viewportMode };

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
    class BecoScene extends Phaser.Scene implements BecoSceneAPI {
      private activeMode: WorldMode = "house";
      private tiles: Array<Array<Phaser.GameObjects.Polygon | null>> = [];
      private furnitureRigs: Phaser.GameObjects.Container[] = [];
      private neighborHouses: Phaser.GameObjects.Container[] = [];
      private drifters: Drifter[] = [];
      private avatarRig: AvatarRig | null = null;
      private headerTitle: Phaser.GameObjects.Text | null = null;
      private headerHint: Phaser.GameObjects.Text | null = null;
      private lastHouseKey: string | null = null;
      private lastNeighborhoodKey: string | null = null;
      private dragCell: { x: number; y: number } | null = null;

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

      syncDynamic() {
        if (this.activeMode === "house") this.syncHouse();
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
        this.tiles = [];
        this.furnitureRigs = [];
        this.neighborHouses = [];
        this.drifters = [];
        this.avatarRig = null;
        this.headerTitle = null;
        this.headerHint = null;
        this.lastHouseKey = null;
        this.lastNeighborhoodKey = null;
        this.dragCell = null;
        this.cameras.main.fadeIn(340, 12, 7, 22);
        this.applyViewport(propsRef.current.viewportMode);
        if (this.activeMode === "house") this.createHouse();
        else this.createNeighborhood();
        sceneRef.current = this;
      }

      private floorPoints() {
        return {
          north: { x: GRID_ORIGIN_X, y: GRID_ORIGIN_Y - TILE_HEIGHT / 2 },
          east: { x: GRID_ORIGIN_X + GRID_COLUMNS * (TILE_WIDTH / 2), y: GRID_ORIGIN_Y },
          bottom: { x: GRID_ORIGIN_X + (GRID_COLUMNS - GRID_ROWS) * (TILE_WIDTH / 2), y: GRID_ORIGIN_Y + (GRID_COLUMNS + GRID_ROWS) * (TILE_HEIGHT / 2) + TILE_HEIGHT / 2 },
          west: { x: GRID_ORIGIN_X - GRID_ROWS * (TILE_WIDTH / 2), y: GRID_ORIGIN_Y + (GRID_ROWS - 1) * (TILE_HEIGHT / 2) },
        };
      }

      private tileBaseColor(x: number, y: number) {
        return (x + y) % 2 === 0 ? PAL.floorA : PAL.floorB;
      }

      private setDropHint(cell: { x: number; y: number } | null, valid: boolean) {
        if (this.dragCell) {
          const previous = this.tiles[this.dragCell.y]?.[this.dragCell.x];
          if (previous) previous.setFillStyle(this.tileBaseColor(this.dragCell.x, this.dragCell.y), 1);
        }
        this.dragCell = cell;
        if (!cell) return;
        const tile = this.tiles[cell.y]?.[cell.x];
        if (tile) tile.setFillStyle(valid ? PAL.floorValid : PAL.floorInvalid, 1);
      }

      private moveAvatar(rig: AvatarRig, targetX: number, targetY: number) {
        const dx = targetX - rig.root.x;
        const dy = targetY - rig.root.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 6) return;
        this.tweens.killTweensOf(rig.root);
        if (!rig.walking) {
          rig.walking = true;
          rig.breathing.pause();
          rig.bobber.setY(0);
          rig.walkTweens.forEach((tween) => tween.resume());
        }
        rig.leanTween?.remove();
        rig.leanTween = this.tweens.add({ targets: rig.bobber, rotation: Phaser.Math.Clamp(dx / 260, -0.08, 0.08), duration: 150 });
        this.tweens.add({
          targets: rig.root,
          x: targetX,
          y: targetY - 24,
          duration: Math.max(260, distance * 3),
          ease: "Sine.easeInOut",
          onComplete: () => {
            rig.walkTweens.forEach((tween) => tween.pause());
            rig.walking = false;
            rig.leanTween?.remove();
            rig.leanTween = null;
            rig.bobber.setRotation(0).setY(0);
            rig.breathing.resume();
            dustPuff(this, rig.root.x, rig.root.y + 26);
            this.tweens.add({ targets: rig.bobber, scaleX: { from: 1.14, to: 1 }, scaleY: { from: 0.84, to: 1 }, duration: 260, ease: "Back.easeOut" });
          },
        });
      }

      private buildStaticHouse() {
        const { north, east, bottom, west } = this.floorPoints();
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
        g.fillStyle(PAL.wallLeft, 1);
        g.fillPoints([north, west, { x: west.x, y: west.y - WALL_HEIGHT }, { x: north.x, y: north.y - WALL_HEIGHT }], true);
        g.fillStyle(PAL.wallRight, 1);
        g.fillPoints([north, east, { x: east.x, y: east.y - WALL_HEIGHT }, { x: north.x, y: north.y - WALL_HEIGHT }], true);

        // rodapés
        g.fillStyle(0x584079, 1);
        g.fillPoints([north, west, { x: west.x, y: west.y - 12 }, { x: north.x, y: north.y - 12 }], true);
        g.fillStyle(0x463260, 1);
        g.fillPoints([north, east, { x: east.x, y: east.y - 12 }, { x: north.x, y: north.y - 12 }], true);

        // listras de papel de parede
        const wallVec = { x: west.x - north.x, y: west.y - north.y };
        g.fillStyle(0xffffff, 0.05);
        for (let t = 0.1; t < 0.95; t += 0.08) {
          const ax = north.x + wallVec.x * t;
          const ay = north.y + wallVec.y * t;
          const bx = north.x + wallVec.x * (t + 0.014);
          const by = north.y + wallVec.y * (t + 0.014);
          g.fillPoints([{ x: ax, y: ay }, { x: bx, y: by }, { x: bx, y: by - WALL_HEIGHT + 14 }, { x: ax, y: ay - WALL_HEIGHT + 14 }], true);
        }

        g.lineStyle(3, 0x6b4d92, 0.8);
        g.strokePoints([{ x: west.x, y: west.y - WALL_HEIGHT }, { x: north.x, y: north.y - WALL_HEIGHT }, { x: east.x, y: east.y - WALL_HEIGHT }], false);

        g.fillStyle(PAL.gold, 0.14);
        g.fillPoints([
          { x: north.x + wallVec.x * 0.06, y: north.y + wallVec.y * 0.06 - WALL_HEIGHT + 16 },
          { x: north.x + wallVec.x * 0.94, y: north.y + wallVec.y * 0.94 - WALL_HEIGHT + 16 },
          { x: north.x + wallVec.x * 0.94, y: north.y + wallVec.y * 0.94 - WALL_HEIGHT + 26 },
          { x: north.x + wallVec.x * 0.06, y: north.y + wallVec.y * 0.06 - WALL_HEIGHT + 26 },
        ], true);

        this.add.rectangle(GRID_ORIGIN_X - 3, north.y - WALL_HEIGHT / 2, 8, WALL_HEIGHT, PAL.wallEdge).setDepth(-55);

        // janela na parede esquerda
        const winA = { x: north.x + wallVec.x * 0.36, y: north.y + wallVec.y * 0.36 };
        const winB = { x: north.x + wallVec.x * 0.52, y: north.y + wallVec.y * 0.52 };
        const winH = 74;
        const windowG = this.add.graphics().setDepth(-50);
        windowG.fillStyle(0x9fd8ef, 1);
        windowG.fillPoints([winA, winB, { x: winB.x, y: winB.y - winH }, { x: winA.x, y: winA.y - winH }], true);
        windowG.fillStyle(0xc9ecfb, 1);
        const winMid = { x: (winA.x + winB.x) / 2, y: (winA.y + winB.y) / 2 };
        windowG.fillPoints([winA, winMid, { x: winMid.x, y: winMid.y - winH }, { x: winA.x, y: winA.y - winH }], true);
        windowG.lineStyle(4, 0xe8d9ff, 1);
        windowG.strokePoints([winA, winB, { x: winB.x, y: winB.y - winH }, { x: winA.x, y: winA.y - winH }], true);
        windowG.lineStyle(3, 0xe8d9ff, 0.9);
        windowG.lineBetween(winMid.x, winMid.y, winMid.x, winMid.y - winH);
        windowG.lineBetween(winA.x, winA.y - winH / 2, winB.x, winB.y - winH / 2);

        const shine = this.add.graphics().setDepth(-49);
        shine.fillStyle(0xffffff, 0.26);
        shine.fillPoints([{ x: winA.x, y: winA.y - 10 }, { x: winA.x + 13, y: winA.y - 16 }, { x: winA.x + 13, y: winA.y - winH + 8 }, { x: winA.x, y: winA.y - winH + 15 }], true);
        this.tweens.add({ targets: shine, x: { from: 0, to: 96 }, duration: 2400, repeat: -1, hold: 2600, ease: "Sine.easeInOut" });

        const rays = this.add.polygon(winMid.x + 66, winMid.y + 120, [0, -80, 130, 24, 30, 150, -60, 40], 0xfff3c9, 0.07).setDepth(-40);
        this.tweens.add({ targets: rays, alpha: { from: 0.09, to: 0.035 }, duration: 2800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

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
        this.tweens.add({ targets: bulbGlow, alpha: { from: 0.26, to: 0.12 }, duration: 1700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

        // poeira flutuando na luz
        for (let i = 0; i < 10; i += 1) {
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
            const tile = this.add.polygon(position.x, position.y, [0, -TILE_HEIGHT / 2, TILE_WIDTH / 2, 0, 0, TILE_HEIGHT / 2, -TILE_WIDTH / 2, 0], tileColor)
              .setStrokeStyle(1.5, 0xc9aee3, 0.35)
              .setDepth(position.y)
              .setInteractive({ useHandCursor: true });
            tile.on("pointerover", () => tile.setFillStyle(PAL.floorHover, 1));
            tile.on("pointerout", () => tile.setFillStyle(tileColor, 1));
            tile.on("pointerdown", () => {
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
        this.avatarRig.root.setPosition(avatarPosition.x, avatarPosition.y - 24).setDepth(1100).setScale(0);
        this.tweens.add({ targets: this.avatarRig.root, scale: 1, duration: 420, delay: 140, ease: "Back.easeOut" });
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
        this.tweens.add({ targets: sign, y: signY - 5, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

        const zone = this.add.zone(signX, (p0.y + p1.y) / 2 - doorH / 2, 96, doorH + 48).setDepth(1301);
        zone.setInteractive({ hitArea: new Phaser.Geom.Rectangle(-48, -(doorH + 48) / 2, 96, doorH + 48), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
        zone.on("pointerover", () => this.tweens.add({ targets: glow, alpha: { from: 0, to: 1 }, duration: 160 }));
        zone.on("pointerout", () => this.tweens.add({ targets: glow, alpha: 0, duration: 220 }));
        zone.on("pointerdown", () => {
          this.cameras.main.fadeOut(220, 12, 7, 22);
          this.cameras.main.once("camerafadeoutcomplete", () => callbacksRef.current.onExit());
        });
      }

      private buildHouseKey(items: HouseItem[], selected: string | undefined) {
        const { house, owns } = propsRef.current;
        return [
          owns ? "own" : `host:${house.host?.nickname || ""}`,
          items.filter((i) => i.placed).map((i) => `${i.id}:${i.x},${i.y}${i.rotated ? "r" : ""}`).join("|"),
          selected || "",
        ].join("#");
      }

      private syncHouse() {
        const { house, owns, selectedItemId } = propsRef.current;
        const key = this.buildHouseKey(house.items, selectedItemId);
        if (key === this.lastHouseKey) return;
        this.lastHouseKey = key;

        this.headerTitle?.setText(owns ? "SUA CASA NO BECO" : `CASA DE ${(house.host?.nickname || "UM VIZINHO").toUpperCase()}`);
        this.headerHint?.setText(owns ? "toque no piso para andar · segure e arraste para decorar" : "toque no piso para explorar");

        this.furnitureRigs.forEach((rig) => destroyTree(this, rig));
        this.furnitureRigs = [];

        for (const item of house.items.filter((entry) => entry.placed)) {
          const position = toIso(item.x, item.y);
          const furniture = createFurniture(this, item);
          const selected = item.id === selectedItemId;
          const baseScale = item.rotated ? 0.97 : 1;
          furniture.setPosition(position.x, position.y + 10).setDepth(position.y + 40);
          if (selected) {
            selectionAura(this, furniture);
            const nameChip = labelChip(this, itemLabels[item.itemId] || "Móvel", 0x2f2148, 0xd9b8ff, "#fff6d5");
            nameChip.setPosition(0, -134);
            furniture.add(nameChip);
            this.tweens.add({ targets: furniture, scale: { from: baseScale, to: baseScale * 1.05 }, duration: 700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
          }
          if (!owns) {
            this.furnitureRigs.push(furniture);
            continue;
          }

          furniture.setData("dragging", false);
          furniture.setInteractive({ hitArea: new Phaser.Geom.Rectangle(-52, -112, 104, 124), hitAreaCallback: Phaser.Geom.Rectangle.Contains, useHandCursor: true });
          this.input.setDraggable(furniture);
          const idleScale = selected ? baseScale * 1.05 : baseScale;
          furniture.on("pointerover", () => this.tweens.add({ targets: furniture, scale: idleScale * 1.05, duration: 130, ease: "Quad.easeOut" }));
          furniture.on("pointerout", () => {
            if (furniture.getData("dragging")) return;
            this.tweens.add({ targets: furniture, scale: idleScale, duration: 130, ease: "Quad.easeOut" });
          });
          furniture.on("pointerdown", () => callbacksRef.current.onSelectItem(item));
          furniture.on("dragstart", () => {
            this.tweens.killTweensOf(furniture);
            furniture.setData("dragging", true);
            furniture.setScale(1.1).setDepth(5000).setAlpha(0.94);
          });
          furniture.on("drag", (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
            furniture.setPosition(dragX, dragY + 10);
            const cell = fromIso(dragX, dragY + 10);
            this.setDropHint(cell, cell != null);
          });
          furniture.on("dragend", (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
            furniture.setData("dragging", false);
            const next = fromIso(dragX, dragY + 10);
            this.setDropHint(null, false);
            if (next) {
              const snapped = toIso(next.x, next.y);
              this.tweens.add({ targets: furniture, x: snapped.x, y: snapped.y + 10, scale: 1, alpha: 1, duration: 240, ease: "Back.easeOut" });
              const echoedItems = propsRef.current.house.items.map((entry) => (entry.id === item.id ? { ...entry, x: next.x, y: next.y } : entry));
              this.lastHouseKey = this.buildHouseKey(echoedItems, propsRef.current.selectedItemId);
              callbacksRef.current.onMoveItem(item, next.x, next.y);
            } else {
              this.tweens.add({
                targets: furniture,
                x: { from: furniture.x - 7, to: furniture.x + 7 },
                duration: 55,
                yoyo: true,
                repeat: 3,
                onComplete: () => this.tweens.add({ targets: furniture, x: position.x, y: position.y + 10, scale: idleScale, alpha: 1, duration: 260, ease: "Back.easeOut" }),
              });
            }
          });
          this.furnitureRigs.push(furniture);
        }
      }

      private createHouse() {
        this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x20142f).setDepth(-100);
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
        this.tweens.add({ targets: sun, rotation: Math.PI * 2, duration: 46000, repeat: -1 });
        this.tweens.add({ targets: sunGlow, scale: { from: 1, to: 1.14 }, duration: 2200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

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
          this.drifters.push({ obj: cloud, speed });
          this.tweens.add({ targets: cloud, y: y + 6, duration: 2600, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
        });

        const birdSpecs: Array<[number, number, number]> = [
          [120, 26, 0],
          [156, 30, 9000],
        ];
        birdSpecs.forEach(([y, speed, delay]) => {
          const wingL = this.add.rectangle(-5, 0, 12, 3, 0x2f3542).setOrigin(1, 0.5);
          const wingR = this.add.rectangle(5, 0, 12, 3, 0x2f3542).setOrigin(0, 0.5);
          const bird = this.add.container(GAME_WIDTH + 60, y, [wingL, wingR]).setDepth(-80).setAlpha(0.8);
          this.drifters.push({ obj: bird, speed });
          this.tweens.add({ targets: wingL, rotation: { from: -0.6, to: 0.5 }, duration: 240, yoyo: true, repeat: -1, delay, ease: "Sine.easeInOut" });
          this.tweens.add({ targets: wingR, rotation: { from: 0.6, to: -0.5 }, duration: 240, yoyo: true, repeat: -1, delay, ease: "Sine.easeInOut" });
          this.tweens.add({ targets: bird, y: y - 14, duration: 1500, yoyo: true, repeat: -1, delay, ease: "Sine.easeInOut" });
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
        this.tweens.add({ targets: hydrant, y: { from: 596, to: 592 }, duration: 1400, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

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
        this.tweens.add({ targets: [signTitle, signHint], y: "-=2", duration: 1200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
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
              this.cameras.main.fadeOut(200, 12, 7, 22);
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
      pixelArt: true,
      roundPixels: true,
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
