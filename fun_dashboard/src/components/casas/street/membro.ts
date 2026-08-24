import * as Phaser from "phaser";
import { PAL } from "../avatarRigShared";

/** Casas dos membros — gerador paramétrico: silhuetas, telhados, chaminés, jardins e números únicos. */

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

const PALETTES: { wall: number; roof: number; door: number }[] = [
  { wall: 0x8d659e, roof: 0x5a3d70, door: 0xf0b849 },
  { wall: 0x4f7994, roof: 0x2f5570, door: 0xe26978 },
  { wall: 0xb66d58, roof: 0x7c4234, door: 0x3a9c78 },
  { wall: 0x788d58, roof: 0x4e6136, door: 0xc98772 },
  { wall: 0xc98772, roof: 0x8a4a3a, door: 0x4971a3 },
  { wall: 0x6b4d92, roof: 0x453061, door: 0xf0b849 },
  { wall: 0x4c796c, roof: 0x2f5349, door: 0xe26978 },
];

export function buildMemberHouse(
  scene: Phaser.Scene,
  x: number,
  y: number,
  opts: { title: string; variant: number; interactive?: () => void },
): { root: Phaser.GameObjects.Container; bounds: Phaser.Geom.Rectangle } {
  const v = ((opts.variant % 7) + 7) % 7;
  const pal = PALETTES[v];
  const twoFloors = v % 2 === 1;
  const W = twoFloors ? 195 : 215;
  const H = (twoFloors ? 210 : 178) + (v % 3) * 6;
  const root = scene.add.container(x, y).setDepth(y - 5);

  root.add(scene.add.ellipse(8, 10, W * 1.08, 34, 0x120d20, 0.32));
  root.add(scene.add.polygon(W / 2 + 14, -H / 2, [0, 0, 28, -17, 28, H - 5, 0, H], shade(pal.wall, 26)).setStrokeStyle(3, PAL.outline));
  root.add(scene.add.rectangle(0, -H / 2, W, H, pal.wall).setStrokeStyle(4, PAL.outline));
  const plaster = scene.add.graphics();
  for (let i = 0; i < 12; i++) plaster.fillStyle(shade(pal.wall, Phaser.Math.Between(6, 22)), 0.16).fillRect(Phaser.Math.Between(-W / 2 + 6, W / 2 - 10), Phaser.Math.Between(-H + 12, -18), Phaser.Math.Between(3, 11), 2);
  root.add(plaster);

  // Telhados — 3 tipos rotativos
  const roofType = v % 3;
  if (roofType === 0) {
    // Duas águas com cumeeira
    root.add(scene.add.polygon(0, -H - 10, [-W / 2 - 14, 16, 0, -26, W / 2 + 22, 16], pal.roof).setStrokeStyle(4, PAL.outline));
    root.add(scene.add.line(0, -H - 34, 0, 0, W / 2 + 8, 42, shade(pal.roof, 25), 2));
    root.add(scene.add.rectangle(0, -H - 10, W * 0.94, 5, shade(pal.roof, 35)).setStrokeStyle(2, PAL.outline));
  } else if (roofType === 1) {
    // Inclinação única (shed)
    root.add(scene.add.polygon(0, -H - 12, [-W / 2 - 14, 18, W / 2 + 22, -6, W / 2 + 22, 16, -W / 2 - 14, 16], pal.roof).setStrokeStyle(4, PAL.outline));
    root.add(scene.add.line(W / 2 - 20, -H + 2, 0, 0, W / 2 + 20, -4, shade(pal.roof, 25), 2));
  } else {
    // Mansarda curta
    root.add(scene.add.polygon(0, -H - 8, [-W / 2 - 16, 20, -W / 2 - 4, -18, W / 2 + 10, -18, W / 2 + 22, 20], pal.roof).setStrokeStyle(4, PAL.outline));
    root.add(scene.add.rectangle(0, -H - 24, W * 0.72, 12, shade(pal.roof, 15)).setStrokeStyle(3, PAL.outline));
  }

  // Janela com moldura, vidro, reflexo e opcional cortina/floreira
  const windowAt = (wx: number, wy: number) => {
    const w = scene.add.container(wx, wy);
    w.add(scene.add.rectangle(0, 0, 40, 34, 0xffffff).setStrokeStyle(3, PAL.outline));
    w.add(scene.add.rectangle(0, 0, 32, 26, 0xaecbe8, 0.92).setStrokeStyle(2, PAL.outline));
    w.add(scene.add.line(0, 0, -13, 10, 9, -11, 0xffffff, 0.45));
    if (v % 3 === 1) {
      // Cortinas laterais + varal
      w.add(scene.add.triangle(-12, 0, -16, -13, -6, -13, -8, 12, 0xf5e8cf));
      w.add(scene.add.triangle(12, 0, 16, -13, 6, -13, 8, 12, 0xf5e8cf));
      w.add(scene.add.rectangle(0, -14, 34, 4, 0xe8d9b8).setStrokeStyle(1, PAL.outline));
    }
    w.add(scene.add.rectangle(0, 19, 46, 5, 0xffffff).setStrokeStyle(2, PAL.outline));
    if (v % 2 === 0) {
      // Floreira com flores
      w.add(scene.add.rectangle(0, 27, 44, 8, 0x7c4a33).setStrokeStyle(2, PAL.outline));
      [-14, 0, 14].forEach((fx, i) => {
        w.add(scene.add.line(fx, 23, 0, 0, 0, -6, 0x4d7a4f, 2));
        w.add(scene.add.circle(fx, 15, 4, [0xe6594f, 0xf3c54d, 0xd77bd4][i]).setStrokeStyle(1, PAL.outline));
      });
    }
    return w;
  };

  const doorX = W * 0.2;
  // Andar superior (sobrados)
  if (twoFloors) {
    root.add(windowAt(-W * 0.22, -H + 36));
    root.add(windowAt(W * 0.16, -H + 36));
  }
  // Térreo: porta + janelas
  root.add(windowAt(-W * 0.26, -52));
  root.add(windowAt(doorX + W * 0.24 > W / 2 - 20 ? W * 0.3 : doorX + W * 0.24, -52));
  root.add(scene.add.rectangle(doorX, -38, 42, 74, pal.door).setStrokeStyle(3, PAL.outline));
  const panels = scene.add.graphics();
  panels.lineStyle(2, shade(pal.door, 28), 1);
  panels.strokeRect(doorX - 12, -64, 24, 20); panels.strokeRect(doorX - 12, -38, 24, 24);
  root.add(panels);
  root.add(scene.add.circle(doorX + 14, -38, 3, PAL.gold).setStrokeStyle(1, PAL.outline));
  root.add(scene.add.rectangle(doorX, 2, 50, 7, shade(pal.wall, 42)).setStrokeStyle(2, PAL.outline));
  // Número da casa
  root.add(scene.add.circle(doorX - 28, -66, 9, 0xf5e8cf).setStrokeStyle(2, PAL.outline));
  root.add(scene.add.text(doorX - 28, -66, String(101 + v), { fontFamily: "monospace", fontSize: "9px", color: "#3a2740" }).setOrigin(0.5));

  // Chaminé com fumaça animada (variants ímpares)
  if (v % 2 === 1 && roofType !== 2) {
    const chx = twoFloors ? W * 0.3 : W * 0.28;
    const chy = -H - (roofType === 0 ? 18 : 4);
    root.add(scene.add.rectangle(chx, chy + 6, 18, 30, 0x8a4a3a).setStrokeStyle(3, PAL.outline));
    const bricks = scene.add.graphics();
    bricks.lineStyle(1, shade(0x8a4a3a, 25), 0.9);
    bricks.lineBetween(chx - 9, chy, chx + 9, chy); bricks.lineBetween(chx - 9, chy + 10, chx + 9, chy + 10);
    bricks.lineBetween(chx, chy - 5, chx, chy); bricks.lineBetween(chx - 4, chy + 5, chx - 4, chy + 10);
    root.add(bricks);
    root.add(scene.add.rectangle(chx, chy - 10, 24, 6, shade(0x8a4a3a, 35)).setStrokeStyle(2, PAL.outline));
    for (let p = 0; p < 3; p++) {
      const puff = scene.add.circle(chx + Phaser.Math.Between(-3, 3), chy - 18, 4, 0xd8d4e2, 0);
      root.add(puff);
      scene.tweens.add({ targets: puff, y: chy - 46, alpha: { from: 0.5, to: 0 }, scale: { from: 0.8, to: 1.7 }, duration: 1700, delay: p * 550, repeat: -1, ease: "Sine.easeOut" });
    }
  }

  // Jardim: caminho de pedrinhas até a porta
  const path = scene.add.graphics();
  for (let step = 0; step < 3; step++) {
    const py = 12 + step * 13;
    const spread = 8 + step * 6;
    for (let s = -1; s <= 1; s += 2) {
      path.fillStyle(step % 2 ? 0x9a92b5 : 0xe8e2f2, 0.85);
      path.fillEllipse(doorX + s * spread * 0.5, py, 12, 6);
    }
  }
  root.add(path);

  // Cerca branca com portãozinho (exceto variant 1 e 4)
  if (v % 3 !== 1) {
    const fenceY = 34;
    const fence = scene.add.graphics();
    fence.lineStyle(3, PAL.outline, 1);
    fence.fillStyle(0xf5e8cf, 1);
    const gateStart = doorX - 12, gateEnd = doorX + 12;
    for (let px = -W / 2 + 6; px < W / 2 - 4; px += 15) {
      if (px > gateStart - 4 && px < gateEnd) continue;
      fence.fillRect(px, fenceY - 16, 8, 18);
      fence.strokeRect(px, fenceY - 16, 8, 18);
      fence.fillTriangle(px - 1, fenceY - 16, px + 9, fenceY - 16, px + 4, fenceY - 21);
      fence.strokeTriangle(px - 1, fenceY - 16, px + 9, fenceY - 16, px + 4, fenceY - 21);
    }
    fence.fillRect(-W / 2 + 4, fenceY - 8, W - 10, 4); fence.strokeRect(-W / 2 + 4, fenceY - 8, W - 10, 4);
    root.add(fence);
    // Portão entreaberto
    const gate = scene.add.container(doorX, fenceY - 8);
    gate.add(scene.add.rectangle(10, 4, 22, 16, 0xf5e8cf).setStrokeStyle(2, PAL.outline));
    gate.setAngle(18);
    root.add(gate);
  }

  // Arbusto ou tulipas alternando o lado
  const gx2 = v % 2 ? -W * 0.36 : W * 0.42;
  if (v % 2) {
    root.add(scene.add.circle(gx2, 24, 11, 0x397750).setStrokeStyle(2, PAL.outline));
    root.add(scene.add.circle(gx2 + 9, 18, 9, 0x4d9a64).setStrokeStyle(2, PAL.outline));
    root.add(scene.add.circle(gx2 - 8, 17, 8, 0x2f6b45).setStrokeStyle(2, PAL.outline));
  } else {
    [0, 8, 16].forEach((ox, i) => {
      root.add(scene.add.line(gx2 + ox - 8, 26, 0, 0, 0, -9, 0x4d7a4f, 2));
      root.add(scene.add.arc(gx2 + ox - 8, 14, 4.5, 180, 360, false, [0xe6594f, 0xf3c54d, 0xd77bd4][i]).setStrokeStyle(1, PAL.outline));
    });
  }

  // Caixa de correio (variants múltiplos de 3)
  if (v % 3 === 0) {
    const mail = scene.add.container(W * 0.46, 30);
    mail.add(scene.add.rectangle(0, 0, 4, 22, 0x573b2d).setStrokeStyle(2, PAL.outline));
    mail.add(scene.add.rectangle(0, -14, 18, 10, 0x4971a3).setStrokeStyle(2, PAL.outline));
    mail.add(scene.add.rectangle(9, -22, 3, 8, 0xc23d33).setStrokeStyle(1, PAL.outline));
    root.add(mail);
  }

  root.add(chip(scene, opts.title, Math.max(90, Math.min(180, opts.title.length * 9 + 30))).setPosition(0, -H - 48));

  if (opts.interactive) {
    root.setInteractive(new Phaser.Geom.Rectangle(-W / 2, -H, W, H), Phaser.Geom.Rectangle.Contains)
      .on("pointerdown", opts.interactive)
      .on("pointerover", () => root.setScale(1.025))
      .on("pointerout", () => root.setScale(1));
  }

  return { root, bounds: new Phaser.Geom.Rectangle(x - W / 2 - 10, y - H - 12, W + 35, H + 35) };
}

/** Janelas que ficam acesas à noite para um variant (mesmas fórmulas do gerador). */
export function memberWindowLights(variant: number): [number, number][] {
  const v = ((variant % 7) + 7) % 7;
  const twoFloors = v % 2 === 1;
  const W = twoFloors ? 195 : 215;
  const H = (twoFloors ? 210 : 178) + (v % 3) * 6;
  const pts: [number, number][] = [[-W * 0.26, -52], [W * 0.3, -52]];
  if (twoFloors) pts.push([-W * 0.22, -H + 36], [W * 0.16, -H + 36]);
  return pts;
}
