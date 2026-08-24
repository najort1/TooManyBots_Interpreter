import * as Phaser from "phaser";
import { PAL } from "../avatarRigShared";
import type { StreetSeat } from "./seating";

/** Janelas que ficam acesas à noite (offsets locais). */
export const WINDOW_LIGHTS: [number, number][] = [[-82, -78], [-145, -190], [92, -190]];


/** Bar do Pinto — fachada inspirada na referência enviada e esplanada interativa. */

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

export function buildBar(scene: Phaser.Scene, x: number, y: number): {
  root: Phaser.GameObjects.Container;
  bounds: Phaser.Geom.Rectangle;
  seats: StreetSeat[];
} {
  const W = 390;
  const H = 220;
  const wall = 0xf0c93d;
  const trim = 0xa62e2d;
  const seats: StreetSeat[] = [];
  const root = scene.add.container(x, y).setDepth(y - 5);

  root.add(scene.add.ellipse(8, 10, W * 1.05, 36, 0x120d20, 0.32));
  root.add(scene.add.polygon(W / 2 + 15, -H / 2, [0, 0, 30, -18, 30, H - 5, 0, H], shade(wall, 26)).setStrokeStyle(3, PAL.outline));
  root.add(scene.add.rectangle(0, -H / 2, W, H, wall).setStrokeStyle(4, PAL.outline));
  // Cobertura simples de telha metálica e marquise, como no bar real.
  root.add(scene.add.polygon(0, -H - 16, [-W / 2 - 18, 18, W / 2 + 30, 18, W / 2 - 8, -12, -W / 2 + 12, -12], 0x777477).setStrokeStyle(4, PAL.outline));
  const roofLines = scene.add.graphics().lineStyle(2, 0xb5b1aa, 0.72);
  for (let rx = -W / 2 + 6; rx < W / 2; rx += 22) roofLines.lineBetween(rx, -H - 27, rx + 4, -H - 2);
  root.add(roofLines);
  const plaster = scene.add.graphics();
  for (let i = 0; i < 18; i++) plaster.fillStyle(shade(wall, Phaser.Math.Between(6, 26)), 0.18).fillRect(Phaser.Math.Between(-W / 2 + 6, W / 2 - 10), Phaser.Math.Between(-H + 12, -16), Phaser.Math.Between(3, 14), 2);
  // Manchas de umidade perto do chão
  for (let i = 0; i < 6; i++) plaster.fillStyle(PAL.outline, 0.1).fillEllipse(Phaser.Math.Between(-W / 2 + 20, W / 2 - 20), Phaser.Math.Between(-20, -8), Phaser.Math.Between(14, 30), Phaser.Math.Between(5, 9));
  root.add(plaster);

  // Faixa vermelha ondulada pintada no rodapé.
  const stripe = scene.add.graphics().setDepth(1);
  stripe.fillStyle(trim, 1).fillRect(-W / 2, -42, W, 42);
  stripe.lineStyle(7, 0xf8d25c, 0.92);
  for (let sx = -W / 2; sx < W / 2; sx += 76) stripe.arc(sx + 38, -43, 38, Math.PI, 0, false);
  root.add(stripe);

  // Letreiro pintado, com tipografia popular de muro e a marca PITU da foto.
  const sign = scene.add.container(-18, -H + 62);
  sign.add(scene.add.text(0, -18, "BAR DO PINTO", { fontFamily: "Arial Black, sans-serif", fontSize: "28px", fontStyle: "bold", color: "#f6f2dc", stroke: "#24212c", strokeThickness: 7 }).setOrigin(0.5));
  sign.add(scene.add.text(8, 20, "PITU", { fontFamily: "Georgia, serif", fontSize: "39px", fontStyle: "bold", color: "#a52b2c", stroke: "#f6edc0", strokeThickness: 5 }).setOrigin(0.5));
  root.add(sign);
  root.add(chip(scene, "140 A", 78).setPosition(W * 0.38, -H + 18));

  // Janela-balcão aberta (interior escuro + tampo)
  const winX = -W * 0.22;
  root.add(scene.add.rectangle(winX, -78, 96, 58, 0x1c1626).setStrokeStyle(4, PAL.outline));
  root.add(scene.add.rectangle(winX, -104, 100, 7, shade(wall, 40)).setStrokeStyle(2, PAL.outline)); // guilhotina levantada
  root.add(scene.add.rectangle(winX, -52, 106, 10, 0x875a39).setStrokeStyle(3, PAL.outline)); // tampo
  // Copos e guardanapos no tampo
  root.add(scene.add.rectangle(winX - 26, -60, 10, 7, 0xf5e8cf).setStrokeStyle(1, PAL.outline));
  root.add(scene.add.rectangle(winX + 12, -60, 10, 7, 0xf5e8cf).setStrokeStyle(1, PAL.outline));
  root.add(scene.add.circle(winX + 34, -59, 3.4, 0xf3c54d).setStrokeStyle(1, PAL.outline));
  // Garrafeiras na prateleira interna
  root.add(scene.add.rectangle(winX, -88, 92, 2.5, shade(wall, 50)));
  [[-34, 0x3a9c78], [-22, 0xc98772], [-10, 0xf3c54d], [4, 0x4971a3], [20, 0x39756b]].forEach(([bx, col]) => {
    root.add(scene.add.rectangle(winX + (bx as number), -94, 7, 11, col as number).setStrokeStyle(1, PAL.outline));
    root.add(scene.add.rectangle(winX + (bx as number), -102, 3, 4, col as number).setStrokeStyle(1, PAL.outline));
  });

  // Banquinhos altos no balcão — também podem ser usados.
  const stoolAt = (sx: number) => {
    const s = scene.add.container(sx, 44);
    s.add(scene.add.line(0, -8, 0, 0, 0, -22, 0x2f2748, 3));
    s.add(scene.add.circle(0, -26, 11, 0xe6594f).setStrokeStyle(3, PAL.outline));
    s.add(scene.add.circle(0, -26, 6, 0xc23d33));
    s.add(scene.add.ellipse(0, 1, 16, 5, 0x2f2748));
    return s;
  };
  [winX - 30, winX, winX + 30].forEach((sx, index) => {
    root.add(stoolAt(sx));
    seats.push({ id: `pinto-balcao-${index}`, label: "banquinho do balcão", x: x + sx, y: y + 43, facing: "right", hitRadius: 43 });
  });

  // Barris de madeira empilhados ao lado do balcão.
  const barrelAt = (bx: number, by: number, r: number) => {
    const b = scene.add.container(bx, by);
    b.add(scene.add.rectangle(0, 0, 40 * r, 48 * r, 0x8a5a36).setStrokeStyle(3, PAL.outline));
    const staves = scene.add.graphics();
    staves.lineStyle(2, shade(0x8a5a36, 30), 0.9);
    [-12, -4, 4, 12].forEach(off => staves.lineBetween(off * r, -22 * r, off * r, 22 * r));
    b.add(staves);
    b.add(scene.add.rectangle(0, -12 * r, 42 * r, 4 * r, 0x4b4457).setStrokeStyle(2, PAL.outline));
    b.add(scene.add.rectangle(0, 12 * r, 42 * r, 4 * r, 0x4b4457).setStrokeStyle(2, PAL.outline));
    return b;
  };
  root.add(barrelAt(W * 0.44, 24, 1));
  root.add(barrelAt(W * 0.44 + 6, -22, 0.82));

  // Placa da casa pendurada e balançando.
  const bracketX = W * 0.05;
  root.add(scene.add.rectangle(bracketX, -H + 6, 46, 5, 0x2f2748).setStrokeStyle(2, PAL.outline));
  const swing = scene.add.container(bracketX, -H + 9);
  swing.add(scene.add.line(-16, 8, 0, 0, 0, 8, PAL.outline, 2));
  swing.add(scene.add.line(16, 8, 0, 0, 0, 8, PAL.outline, 2));
  swing.add(chip(scene, "GELADA • 17H", 132).setPosition(0, 24));
  root.add(swing);
  scene.tweens.add({ targets: swing, angle: { from: -2, to: 2 }, duration: 1600, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

  // Lâmpadas pendentes sob o beiral com cones de luz
  [-W * 0.38, W * 0.2].forEach(lx => {
    const l = scene.add.container(lx, -H + 26);
    l.add(scene.add.line(0, -6, 0, -6, 0, 0, PAL.outline, 2));
    l.add(scene.add.polygon(0, 8, [-11, 0, 11, 0, 7, 9, -7, 9], 0x2f2748).setStrokeStyle(2, PAL.outline));
    l.add(scene.add.circle(0, 12, 4, 0xffd76a));
    l.add(scene.add.triangle(0, 30, -16, 0, 16, 0, 0, 34, 0xffd76a, 0.10));
    root.add(l);
  });

  // Porta gradeada vermelha, reconhecível na referência.
  const doorX = W * 0.31;
  root.add(scene.add.rectangle(doorX, -38, 54, 76, 0x8f3033).setStrokeStyle(3, PAL.outline));
  const panels = scene.add.graphics();
  panels.lineStyle(2, 0xd06a62, 0.9);
  for (let gx = doorX - 20; gx <= doorX + 20; gx += 10) panels.lineBetween(gx, -72, gx, -4);
  for (let gy = -64; gy <= -12; gy += 13) panels.lineBetween(doorX - 25, gy, doorX + 25, gy);
  root.add(panels);
  root.add(scene.add.circle(doorX + 15, -38, 3.2, PAL.gold).setStrokeStyle(2, PAL.outline));
  root.add(scene.add.rectangle(doorX, 1, 54, 8, shade(wall, 42)).setStrokeStyle(2, PAL.outline));
  const aberto = chip(scene, "ABERTO", 74);
  aberto.setPosition(doorX - 34, -70); aberto.setAngle(-6);
  root.add(aberto);

  // Mesas plásticas e cadeiras da calçada, com seis novos pontos de encontro.
  const tableAt = (id: string, tx: number, ty: number) => {
    const table = scene.add.container(tx, ty);
    table.add(scene.add.ellipse(0, 10, 82, 22, 0x120d20, 0.24));
    table.add(scene.add.rectangle(0, 0, 8, 35, 0x35313d).setStrokeStyle(2, PAL.outline));
    table.add(scene.add.ellipse(0, -18, 72, 28, 0x2e2b34).setStrokeStyle(3, PAL.outline));
    table.add(scene.add.circle(-14, -22, 4, 0xf2dfb6).setStrokeStyle(1, PAL.outline));
    table.add(scene.add.circle(12, -21, 4, 0xd9b14f).setStrokeStyle(1, PAL.outline));
    for (const side of [-1, 1] as const) {
      const chairX = side * 52;
      table.add(scene.add.rectangle(chairX, 0, 28, 27, 0x35313d).setStrokeStyle(3, PAL.outline));
      table.add(scene.add.rectangle(chairX, -22, 29, 8, 0x44404a).setStrokeStyle(2, PAL.outline));
      seats.push({
        id: `pinto-mesa-${id}-${side < 0 ? "a" : "b"}`,
        label: "cadeira do Bar do Pinto",
        x: x + tx + chairX,
        y: y + ty + 4,
        facing: side < 0 ? "right" : "left",
        hitRadius: 47,
      });
    }
    root.add(table);
  };
  tableAt("1", -100, 102);
  tableAt("2", 48, 112);
  tableAt("3", 155, 86);

  return { root, bounds: new Phaser.Geom.Rectangle(x - W / 2 - 10, y - H - 12, W + 35, H + 20), seats };
}
