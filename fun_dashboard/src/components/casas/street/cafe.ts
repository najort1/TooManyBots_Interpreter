import * as Phaser from "phaser";
import { PAL } from "../avatarRigShared";

/** Janelas que ficam acesas à noite (offsets locais). */
export const WINDOW_LIGHTS: [number, number][] = [[-60, -62], [55, -52]];


/** Café do Beco — esplanada, quadro de menu, vitrine com doces e toldo com scallops. */

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

export function buildCafe(scene: Phaser.Scene, x: number, y: number): { root: Phaser.GameObjects.Container; bounds: Phaser.Geom.Rectangle } {
  const W = 250;
  const H = 205;
  const wall = 0xd48254;
  const trim = 0x633a2b;
  const root = scene.add.container(x, y).setDepth(y - 5);

  // Sombra de contato + volume lateral 3D
  root.add(scene.add.ellipse(8, 10, W * 1.05, 35, 0x120d20, 0.32));
  root.add(scene.add.polygon(W / 2 + 15, -H / 2, [0, 0, 30, -18, 30, H - 5, 0, H], shade(wall, 26)).setStrokeStyle(3, PAL.outline));
  const facade = scene.add.rectangle(0, -H / 2, W, H, wall).setStrokeStyle(4, PAL.outline);
  root.add(facade);
  // Telhado com cumeeira marcada
  root.add(scene.add.polygon(0, -H - 16, [-W / 2 - 14, 18, W / 2 + 24, 18, W / 2 - 4, -12, -W / 2 + 12, -12], trim).setStrokeStyle(4, PAL.outline));
  root.add(scene.add.line(0, -H - 14, -W / 2 + 10, 0, W / 2 - 2, 0, shade(trim, 30)));
  // Desgaste no reboco
  const plaster = scene.add.graphics();
  for (let i = 0; i < 16; i++) plaster.fillStyle(shade(wall, Phaser.Math.Between(6, 24)), 0.18).fillRect(Phaser.Math.Between(-W / 2 + 6, W / 2 - 10), Phaser.Math.Between(-H + 10, -14), Phaser.Math.Between(3, 13), 2);
  root.add(plaster);

  // Toldo listrado com recorte scallop + sombra na fachada
  const awningY = -H + 34;
  root.add(scene.add.rectangle(0, awningY - 26, W * 0.86, 34, 0x000000, 0.12));
  const awning = scene.add.container(0, awningY);
  const stripeCount = 7;
  const sw = (W * 0.86) / stripeCount;
  for (let i = 0; i < stripeCount; i++) {
    const cx = -W * 0.43 + sw * (i + 0.5);
    const col = i % 2 ? 0xf5e8cf : trim;
    awning.add(scene.add.rectangle(cx, 0, sw + 1, 26, col).setStrokeStyle(2, PAL.outline));
    awning.add(scene.add.circle(cx, 13, sw / 2, col).setStrokeStyle(2, PAL.outline));
  }
  root.add(awning);

  // Vitrine com prateleira de doces
  const winX = -W * 0.24;
  root.add(scene.add.rectangle(winX, -62, 66, 52, 0x9db8e8, 0.9).setStrokeStyle(4, PAL.gold));
  root.add(scene.add.line(winX, -62, -29, 0, 29, 0, 0xdff1ff, 0.45));
  root.add(scene.add.rectangle(winX, -46, 66, 5, shade(wall, 40)).setStrokeStyle(2, PAL.outline));
  const sweets = [0xf3c54d, 0xe6594f, 0x8d659e];
  sweets.forEach((col, i) => {
    root.add(scene.add.ellipse(winX - 18 + i * 18, -53, 13, 9, col).setStrokeStyle(2, PAL.outline));
    root.add(scene.add.circle(winX - 18 + i * 18, -59, 2, 0xfff3da));
  });
  root.add(scene.add.rectangle(winX, -34, 74, 6, shade(wall, 34)).setStrokeStyle(3, PAL.outline)); // sill
  root.add(scene.add.rectangle(winX, -27, 78, 9, 0x7c4a33).setStrokeStyle(2, PAL.outline)); // floreira
  [-24, 0, 24].forEach((dx, i) => {
    root.add(scene.add.line(winX + dx, -31, 0, 0, 0, -7, 0x4d7a4f, 3));
    root.add(scene.add.circle(winX + dx, -36, 5, [0xe6594f, 0xf3c54d, 0xd77bd4][i]).setStrokeStyle(2, PAL.outline));
  });

  // Porta de madeira com vidro, maçaneta dourada e degrau
  const doorX = W * 0.22;
  root.add(scene.add.rectangle(doorX, -36, 44, 72, 0x5a3526).setStrokeStyle(3, PAL.outline));
  root.add(scene.add.rectangle(doorX, -52, 28, 30, 0xbcd6ef, 0.85).setStrokeStyle(2, PAL.outline));
  root.add(scene.add.line(doorX, -52, -10, 10, 8, -12, 0xffffff, 0.35));
  root.add(scene.add.circle(doorX + 15, -36, 3.4, PAL.gold).setStrokeStyle(2, PAL.outline));
  root.add(scene.add.rectangle(doorX, 2, 54, 8, shade(wall, 40)).setStrokeStyle(2, PAL.outline));

  // Xícara 3D acima da porta com pires e vapor estático
  const cup = scene.add.container(doorX, -H - 48);
  cup.add(scene.add.rectangle(0, 4, 40, 6, 0xe8e2f2).setStrokeStyle(3, PAL.outline)); // pires
  cup.add(scene.add.rectangle(0, -8, 26, 22, 0xf5e8cf).setStrokeStyle(3, PAL.outline)); // corpo
  cup.add(scene.add.arc(19, -8, 9, 270, 90, false).setStrokeStyle(3, PAL.outline)); // alça
  cup.add(scene.add.ellipse(0, -19, 26, 8, 0x7c4a33).setStrokeStyle(3, PAL.outline)); // café
  [[-6], [0], [6]].forEach(([sx], i) => cup.add(scene.add.arc(sx, -30 - i * 2, 5, 180, 360, false).setStrokeStyle(2, 0xffffff, 0.5)));
  root.add(cup);
  const sign = chip(scene, "CAFÉ DO BECO", 168).setPosition(-W * 0.05, -H - 46);
  root.add(sign);

  // Quadro-negro A-frame na calçada
  const board = scene.add.container(-W * 0.42, 40);
  board.add(scene.add.polygon(0, 0, [-20, 0, 20, 0, 14, -44, -14, -44], 0x5a3526).setStrokeStyle(3, PAL.outline));
  board.add(scene.add.rectangle(0, -24, 24, 30, 0x2f2b33).setStrokeStyle(2, PAL.outline));
  board.add(scene.add.circle(-4, -30, 4, 0xf5e8cf).setStrokeStyle(1, PAL.outline));
  board.add(scene.add.rectangle(-4, -26, 9, 6, 0xf5e8cf));
  const giz = scene.add.graphics();
  giz.lineStyle(1, 0xf5e8cf, 0.8);
  giz.lineBetween(4, -32, 11, -32); giz.lineBetween(4, -28, 11, -28); giz.lineBetween(4, -24, 9, -24);
  board.add(giz);
  board.add(scene.add.text(0, -14, "R$ 6", { fontFamily: "monospace", fontSize: "9px", color: "#fff5d2" }).setOrigin(0.5));
  root.add(board);

  // Esplanada: 2 mesas redondas + cadeiras de verga + guarda-sol
  const tableAt = (tx: number, ty: number) => {
    const t = scene.add.container(tx, ty);
    t.add(scene.add.ellipse(0, 2, 34, 12, 0x120d20, 0.22));
    t.add(scene.add.line(0, -8, 0, 0, 0, -22, 0x2f2748, 4));
    t.add(scene.add.ellipse(0, -30, 40, 14, 0xf5e8cf).setStrokeStyle(3, PAL.outline));
    t.add(scene.add.ellipse(0, -33, 26, 8, 0xd48254).setStrokeStyle(2, PAL.outline));
    return t;
  };
  root.add(tableAt(64, 40));
  root.add(tableAt(112, 46));
  const chairAt = (cx: number, cy: number) => {
    const c = scene.add.container(cx, cy);
    c.add(scene.add.rectangle(0, -6, 20, 5, 0x9c6b43).setStrokeStyle(2, PAL.outline));
    c.add(scene.add.line(-8, -8, 0, 0, 8, -26, 0x9c6b43, 3));
    c.add(scene.add.line(8, -8, 0, 0, -8, -26, 0x9c6b43, 3));
    c.add(scene.add.line(0, -26, 0, 0, 0, 0, 0x9c6b43, 3));
    [-8, 8].forEach(lx => c.add(scene.add.line(lx, 0, lx, -6, lx, 2, 0x2f2748, 3)));
    return c;
  };
  root.add(chairAt(46, 46)); root.add(chairAt(84, 52)); root.add(chairAt(130, 52));
  // Xícara fumegando sobre a mesa 1 (animação)
  const steamHost = scene.add.container(64, 8);
  const cupSmall = scene.add.container(0, 0);
  cupSmall.add(scene.add.rectangle(0, -4, 14, 10, 0xf5e8cf).setStrokeStyle(2, PAL.outline));
  cupSmall.add(scene.add.ellipse(0, -9, 14, 5, 0x7c4a33).setStrokeStyle(2, PAL.outline));
  steamHost.add(cupSmall);
  root.add(steamHost);
  const puffs = [0, 1, 2].map(i => {
    const p = scene.add.circle(Phaser.Math.Between(-4, 4), -14, 3, 0xffffff, 0.0);
    steamHost.add(p);
    scene.tweens.add({ targets: p, y: -34, alpha: { from: 0.55, to: 0 }, scale: { from: 0.7, to: 1.5 }, duration: 1500, delay: i * 500, repeat: -1, ease: "Sine.easeOut" });
    return p;
  });
  void puffs;
  // Guarda-sol grande entre as mesas
  const umb = scene.add.container(90, 30);
  umb.add(scene.add.line(0, -30, 0, 0, 0, -58, 0x2f2748, 4));
  const canopy = scene.add.container(0, -88);
  for (let s = 0; s < 6; s++) {
    const a0 = 180 + s * 30, a1 = a0 + 30;
    canopy.add(scene.add.arc(0, 6, 46, a0, a1, false, s % 2 ? 0xe6594f : 0xf5e8cf).setStrokeStyle(2, PAL.outline));
  }
  canopy.add(scene.add.circle(0, -40, 3, PAL.gold).setStrokeStyle(2, PAL.outline));
  umb.add(canopy);
  root.add(umb);

  // Luminária pendurada sob o toldo + vaso com arbusto
  const lamp = scene.add.container(-doorX - 30, awningY + 26);
  lamp.add(scene.add.line(0, -8, 0, -8, 0, 0, PAL.outline, 3));
  lamp.add(scene.add.polygon(0, 10, [-10, 0, 10, 0, 6, 10, -6, 10], 0x2f2748).setStrokeStyle(2, PAL.outline));
  const bulb = scene.add.circle(0, 14, 4, 0xffd76a);
  lamp.add(bulb);
  root.add(lamp);
  scene.tweens.add({ targets: bulb, alpha: { from: 1, to: 0.75 }, duration: 1300, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  const pot = scene.add.container(W * 0.44, 42);
  pot.add(scene.add.polygon(0, 0, [-12, 0, 12, 0, 9, -14, -9, -14], 0xb0653f).setStrokeStyle(3, PAL.outline));
  pot.add(scene.add.circle(-6, -22, 9, 0x397750).setStrokeStyle(2, PAL.outline));
  pot.add(scene.add.circle(5, -26, 11, 0x4d9a64).setStrokeStyle(2, PAL.outline));
  pot.add(scene.add.circle(-1, -17, 7, 0x2f6b45).setStrokeStyle(2, PAL.outline));
  root.add(pot);


return { root, bounds: new Phaser.Geom.Rectangle(x - W / 2 - 10, y - H - 12, W + 35, H + 35) };
}
