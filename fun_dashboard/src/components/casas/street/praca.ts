import * as Phaser from "phaser";
import { PAL, centeredPolygon } from "../avatarRigShared";
import type { StreetSeat } from "./seating";

/** A praça é espaço aberto — sem janelas. */
export const WINDOW_LIGHTS: [number, number][] = [];


/** Praça da Comunidade — área social ampla, fonte, jardins e bancos interativos. */

function shade(color: number, amount: number) {
  const c = Phaser.Display.Color.IntegerToColor(color);
  c.darken(amount);
  return c.color;
}

function chip(scene: Phaser.Scene, text: string, width: number) {
  const bg = scene.add.graphics();
  bg.fillStyle(0x2a1b43, 0.94).fillRoundedRect(-width / 2, -15, width, 30, 8);
  bg.lineStyle(2, PAL.gold, 0.95).strokeRoundedRect(-width / 2, -15, width, 30, 8);
  const label = scene.add.text(0, 0, text, { fontFamily: "monospace", fontSize: "13px", fontStyle: "bold", color: "#fff5d2", stroke: "#241735", strokeThickness: 3 }).setOrigin(0.5);
  return scene.add.container(0, 0, [bg, label]);
}

export function buildPraca(scene: Phaser.Scene, x: number, y: number): {
  root: Phaser.GameObjects.Container;
  bounds: Phaser.Geom.Rectangle;
  obstacles: Phaser.Geom.Rectangle[];
  seats: StreetSeat[];
} {
  const root = scene.add.container(x, y).setDepth(y);
  const seats: StreetSeat[] = [];
  const obstacles: Phaser.Geom.Rectangle[] = [];

  // Plataforma 2.5D: topo, face frontal e quina lateral ocupam o lote sem parecer um card.
  root.add(scene.add.ellipse(0, 58, 770, 225, 0x241735, 0.24));
  root.add(centeredPolygon(scene, 0, 0, [-362, -104, 338, -104, 370, -76, 370, 88, -338, 88, -370, 62], 0x568762).setStrokeStyle(4, PAL.outline));
  root.add(centeredPolygon(scene, 0, 0, [-338, 88, 370, 88, 370, 106, -338, 106], 0x315a43).setStrokeStyle(3, PAL.outline));
  root.add(centeredPolygon(scene, 0, 0, [338, -104, 370, -76, 370, 88, 354, 88, 354, -68, 322, -92], 0x3d6f50).setStrokeStyle(2, PAL.outline));
  const paths = scene.add.graphics();
  paths.fillStyle(0xd9d3e7, 0.72).fillRoundedRect(-350, -32, 700, 66, 20);
  paths.fillStyle(0xb6adc9, 0.7).fillRoundedRect(-48, -94, 96, 190, 20);
  paths.lineStyle(2, 0x8e86aa, 0.42);
  for (let px = -330; px < 340; px += 34) paths.lineBetween(px, -30, px + 12, 30);
  for (let py = -82; py < 92; py += 26) paths.lineBetween(-44, py, 44, py + 8);
  root.add(paths);

  // Fonte — bacia externa em pedra lavender com juntas
  const basin = scene.add.ellipse(0, -4, 196, 92, 0xa79ec4).setStrokeStyle(4, PAL.outline);
  const rim = scene.add.ellipse(0, -8, 168, 74, 0x8f86ad).setStrokeStyle(3, PAL.outline);
  const joints = scene.add.graphics();
  joints.lineStyle(2, shade(0xa79ec4, 28), 0.9);
  for (let a = 0; a < 12; a++) {
    const ang = (a / 12) * Math.PI * 2;
    joints.lineBetween(Math.cos(ang) * 84, -4 + Math.sin(ang) * 38, Math.cos(ang) * 94, -4 + Math.sin(ang) * 43);
  }
  const water = scene.add.ellipse(0, -10, 148, 62, 0x58b8d8, 0.95).setStrokeStyle(3, 0xbdeaf2);
  root.add([basin, joints, rim, water]);
  // Anéis de ondulação animados na água
  for (let i = 0; i < 2; i++) {
    const ring = scene.add.ellipse(0, -10, 40, 16, 0, 0).setStrokeStyle(2, 0xbdeaf2, 0.7);
    root.add(ring);
    scene.tweens.add({ targets: ring, scaleX: { from: 0.6, to: 3 }, scaleY: { from: 0.6, to: 3 }, alpha: { from: 0.8, to: 0 }, duration: 2200, delay: i * 1100, repeat: -1, ease: "Sine.easeOut" });
  }

  // Coluna central com taças e jatos
  root.add(scene.add.rectangle(0, -46, 22, 66, 0x8f86ad).setStrokeStyle(3, PAL.outline));
  root.add(scene.add.ellipse(0, -78, 96, 30, 0xa79ec4).setStrokeStyle(3, PAL.outline));
  root.add(scene.add.ellipse(0, -82, 76, 20, 0x58b8d8).setStrokeStyle(2, 0xbdeaf2));
  root.add(scene.add.rectangle(0, -104, 14, 34, 0x9a91b8).setStrokeStyle(3, PAL.outline));
  root.add(scene.add.ellipse(0, -122, 52, 18, 0xa79ec4).setStrokeStyle(3, PAL.outline));
  root.add(scene.add.circle(0, -132, 7, PAL.gold).setStrokeStyle(2, PAL.outline));
  for (const s of [-1, 1]) {
    const jet = scene.add.arc(s * 16, -128, 30, s > 0 ? 250 : 290, s > 0 ? 340 : 380, false, 0, 0).setStrokeStyle(3, 0xbdeaf2, 0.85);
    root.add(jet);
    scene.tweens.add({ targets: jet, alpha: { from: 0.9, to: 0.45 }, duration: 700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }
  // Brilhos estáticos na água
  [[-40, -16], [22, -4], [-6, 6], [48, -14]].forEach(([sx, sy]) => root.add(scene.add.circle(sx as number, sy as number, 2, 0xffffff, 0.55)));

  // Pomba no bordo da bacia (respira)
  const dove = scene.add.container(72, -22);
  dove.add(scene.add.ellipse(0, 0, 20, 11, 0xd8d4e2).setStrokeStyle(2, PAL.outline));
  dove.add(scene.add.arc(-3, -3, 8, 200, 320, false, 0xbfbad0).setStrokeStyle(2, PAL.outline));
  dove.add(scene.add.circle(-9, -6, 4.5, 0xd8d4e2).setStrokeStyle(2, PAL.outline));
  dove.add(scene.add.triangle(-14, -6, -13, -4, -17, -5, 0xf39c3f));
  dove.add(scene.add.circle(-10, -7, 1, PAL.outline));
  root.add(dove);
  scene.tweens.add({ targets: dove, scaleY: { from: 1, to: 1.08 }, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

  // Bancos de parque: cada assento vira um ponto de interação da cena.
  const benchAt = (id: string, bx: number, by: number, facing: "left" | "right") => {
    const b = scene.add.container(bx, by);
    const woodTop = 0xc58a50;
    const woodFront = 0x7b482e;
    const metal = 0x353746;
    b.add(scene.add.ellipse(4, 18, 132, 21, 0x120d20, 0.3));
    // Estrutura traseira, encosto chanfrado e superfície superior do assento.
    [-48, 48].forEach(lx => b.add(centeredPolygon(scene, lx, -8, [-5, -38, 4, -38, 8, 23, -3, 23], metal).setStrokeStyle(2, PAL.outline)));
    for (let slat = 0; slat < 3; slat++) {
      const sy = -43 + slat * 12;
      b.add(centeredPolygon(scene, 0, sy, [-56, -4, 49, -4, 57, 2, -48, 2], woodTop).setStrokeStyle(2, PAL.outline));
      b.add(centeredPolygon(scene, 0, sy + 5, [-48, -3, 57, -3, 57, 3, -48, 3], woodFront).setStrokeStyle(1, PAL.outline));
    }
    b.add(centeredPolygon(scene, 0, 0, [-58, -8, 50, -8, 61, 3, -48, 3], 0xd79b59).setStrokeStyle(3, PAL.outline));
    [-43, 43].forEach(lx => b.add(centeredPolygon(scene, lx, 14, [-7, -12, 5, -12, 9, 17, -4, 17], metal).setStrokeStyle(2, PAL.outline)));

    // Face frontal em profundidade própria: cobre coxas/canelas quando o avatar senta.
    const front = scene.add.container(x + bx, y + by).setDepth(y + by + 1004);
    front.add(centeredPolygon(scene, 5, 10, [-48, -7, 61, -7, 61, 6, -48, 6], woodFront).setStrokeStyle(2, PAL.outline));
    for (const [index, sx] of [-27, 27].entries()) {
      seats.push({ id: `praca-${id}-${index}`, label: "banco da praça", x: x + bx + sx, y: y + by - 8, facing, hitRadius: 58 });
    }
    return b;
  };
  root.add(benchAt("oeste", -275, -55, "right"));
  root.add(benchAt("leste", 275, -55, "left"));
  root.add(benchAt("sudoeste", -195, 82, "right"));
  root.add(benchAt("sudeste", 195, 82, "left"));

  // Canteiros de tulipas
  const bedAt = (bx: number, by: number) => {
    const b = scene.add.container(bx, by);
    b.add(scene.add.rectangle(0, 0, 86, 26, 0x5b4433).setStrokeStyle(3, PAL.outline));
    b.add(scene.add.rectangle(0, -14, 86, 5, 0x7a5c44).setStrokeStyle(2, PAL.outline));
    const cols = [0xe6594f, 0xf3c54d, 0xd77bd4];
    for (let f = 0; f < 5; f++) {
      const fx2 = -30 + f * 15;
      b.add(scene.add.line(fx2, -16, 0, 0, 0, -12, 0x4d7a4f, 2.5));
      b.add(scene.add.arc(fx2, -32, 6, 180, 360, false, cols[f % 3]).setStrokeStyle(2, PAL.outline));
    }
    return b;
  };
  root.add(bedAt(-168, 20));
  root.add(bedAt(168, 20));
  obstacles.push(
    new Phaser.Geom.Rectangle(x - 211, y + 2, 86, 34),
    new Phaser.Geom.Rectangle(x + 125, y + 2, 86, 34),
  );

  // Postes duplos com varal de bandeirinhas
  const postAt = (px: number) => {
    const p = scene.add.container(px, -20);
    p.add(scene.add.rectangle(0, -34, 8, 68, 0x2f2748).setStrokeStyle(2, PAL.outline));
    p.add(scene.add.circle(0, -70, 6, PAL.gold).setStrokeStyle(2, PAL.outline));
    p.add(scene.add.ellipse(0, 2, 26, 7, 0x120d20, 0.3));
    return p;
  };
  root.add(postAt(-344));
  root.add(postAt(344));
  const flags = scene.add.graphics();
  const flagCols = [0xe6594f, 0xf3c54d, 0x3a9c78, 0xd77bd4];
  let fx3 = -344;
  let fy = -88;
  for (let i = 0; i < 17; i++) {
    const t = i / 16;
    const nx = -344 + t * 688;
    const ny = -88 - Math.sin(t * Math.PI) * 26;
    if (i > 0) flags.lineStyle(2, PAL.outline, 0.8).lineBetween(fx3, fy, nx, ny);
    if (i % 2 === 0) {
      flags.fillStyle(flagCols[(i / 2) % 4], 1);
      flags.fillTriangle(nx - 5, ny, nx + 5, ny, nx, ny + 12);
    }
    fx3 = nx; fy = ny;
  }
  root.add(flags);

  root.add(chip(scene, "PRAÇA DA COMUNIDADE", 220).setPosition(0, -176));

  const bounds = new Phaser.Geom.Rectangle(x - 102, y - 55, 204, 108);
  return { root, bounds, obstacles: [bounds, ...obstacles], seats };
}
