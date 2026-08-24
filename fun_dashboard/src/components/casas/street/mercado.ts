import * as Phaser from "phaser";
import { PAL } from "../avatarRigShared";

/** Janelas que ficam acesas à noite (offsets locais). */
export const WINDOW_LIGHTS: [number, number][] = [[27, -38], [69, -38], [-84, -66]];


/** Mercadinho Popular — porta dupla de vidro, geladeira expositora, frutas na frente e carrinho de compras. */

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

export function buildMercado(scene: Phaser.Scene, x: number, y: number): { root: Phaser.GameObjects.Container; bounds: Phaser.Geom.Rectangle } {
  const W = 300;
  const H = 215;
  const wall = 0x4971a3;
  const trim = 0xe26978;
  const root = scene.add.container(x, y).setDepth(y - 5);

  root.add(scene.add.ellipse(8, 10, W * 1.05, 35, 0x120d20, 0.32));
  root.add(scene.add.polygon(W / 2 + 15, -H / 2, [0, 0, 30, -18, 30, H - 5, 0, H], shade(wall, 26)).setStrokeStyle(3, PAL.outline));
  root.add(scene.add.rectangle(0, -H / 2, W, H, wall).setStrokeStyle(4, PAL.outline));
  root.add(scene.add.polygon(0, -H - 16, [-W / 2 - 14, 18, W / 2 + 24, 18, W / 2 - 4, -12, -W / 2 + 12, -12], shade(wall, 34)).setStrokeStyle(4, PAL.outline));
  // Faixa listrada de topo
  for (let i = 0; i < 12; i++) root.add(scene.add.rectangle(-W / 2 + (W / 12) * (i + 0.5), -H + 16, W / 12 + 1, 18, i % 2 ? trim : 0xf5e8cf).setStrokeStyle(1, PAL.outline));
  const plaster = scene.add.graphics();
  for (let i = 0; i < 15; i++) plaster.fillStyle(shade(wall, Phaser.Math.Between(6, 22)), 0.16).fillRect(Phaser.Math.Between(-W / 2 + 6, W / 2 - 10), Phaser.Math.Between(-H + 40, -20), Phaser.Math.Between(3, 12), 2);
  root.add(plaster);

  // Geladeira expositora pela janela esquerda
  const fx = -W * 0.28;
  root.add(scene.add.rectangle(fx, -66, 74, 62, 0xe8ecf2).setStrokeStyle(4, PAL.outline));
  for (let row = 0; row < 3; row++) {
    const ry = -84 + row * 17;
    root.add(scene.add.rectangle(fx, ry, 62, 2, 0xb9c2ce));
    for (let p = 0; p < 6; p++) root.add(scene.add.rectangle(fx - 26 + p * 10.5, ry - 7, 8, 13, [0xf3c54d, 0xe6594f, 0x3a9c78, 0xf39c3f, 0xd77bd4, 0x4971a3][(row * 6 + p) % 6]).setStrokeStyle(1, PAL.outline));
  }
  root.add(scene.add.rectangle(fx, -66, 74, 62, 0xbcd6ef, 0.25));
  root.add(chip(scene, "MERCADINHO POPULAR", Math.min(W - 16, 210)).setPosition(0, -H - 44));

  // Porta dupla de vidro com puxadores dourados
  const dx = W * 0.16;
  [-1, 1].forEach(side => {
    root.add(scene.add.rectangle(dx + side * 21, -38, 40, 74, 0xbcd6ef, 0.85).setStrokeStyle(3, PAL.outline));
    root.add(scene.add.line(dx + side * 21, -38, -14, 14, 10, -16, 0xffffff, 0.4));
    root.add(scene.add.rectangle(dx + side * 6, -36, 3.5, 20, PAL.gold).setStrokeStyle(1, PAL.outline));
  });
  root.add(scene.add.rectangle(dx, 1, 92, 8, shade(wall, 42)).setStrokeStyle(2, PAL.outline));
  // Relógio ABERTO ao lado da porta
  root.add(scene.add.circle(dx - 52, -70, 11, 0xf5e8cf).setStrokeStyle(3, PAL.outline));
  root.add(scene.add.line(dx - 52, -70, 0, 0, 0, -6, PAL.outline, 2));
  root.add(scene.add.line(dx - 52, -70, 0, 0, 4, -2, PAL.outline, 2));

  // Toldo reto com pernas
  const awY = -H + 44;
  for (let i = 0; i < 8; i++) root.add(scene.add.rectangle(-W * 0.42 + (W * 0.84 / 8) * (i + 0.5), awY, W * 0.84 / 8 + 1, 22, i % 2 ? trim : 0xf5e8cf).setStrokeStyle(1, PAL.outline));
  root.add(scene.add.rectangle(0, awY + 11, W * 0.86, 3, shade(trim, 35)));
  [-W * 0.4, W * 0.4].forEach(px => root.add(scene.add.line(px, awY + 12, px, 0, px, 34, 0x2f2748, 3)));
  // Placa PROMOÇÃO pendurada balançando
  const promo = chip(scene, "PROMOÇÃO", 108);
  promo.setPosition(-W * 0.18, awY + 42); promo.setAngle(-3);
  const promoBg = promo.list[0] as Phaser.GameObjects.Graphics;
  promoBg.clear();
  promoBg.fillStyle(0xc23d33, 0.96).fillRoundedRect(-54, -15, 108, 30, 8);
  promoBg.lineStyle(2, 0xffffff, 0.85).strokeRoundedRect(-54, -15, 108, 30, 8);
  root.add(promo);
  scene.tweens.add({ targets: promo, angle: { from: -4, to: 4 }, duration: 1500, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

  // Caixotes inclinados com frutas na frente
  const crateAt = (cx: number, fruits: number[]) => {
    const c = scene.add.container(cx, 44);
    c.add(scene.add.polygon(0, 0, [-32, 0, 32, 0, 26, -26, -26, -26], 0xa9743f).setStrokeStyle(3, PAL.outline));
    c.add(scene.add.line(0, -13, -27, 0, 27, 0, shade(0xa9743f, 35), 2));
    fruits.forEach((col, i) => {
      const px = -16 + (i % 3) * 16, py = -30 - Math.floor(i / 3) * 11;
      c.add(scene.add.circle(px, py, 7, col).setStrokeStyle(2, PAL.outline));
      c.add(scene.add.circle(px - 2, py - 2, 1.6, 0xfff3da, 0.7));
    });
    return c;
  };
  root.add(crateAt(-W * 0.36, [0xf39c3f, 0xf39c3f, 0xf39c3f, 0xf39c3f, 0xf39c3f, 0xe8862e]));
  root.add(crateAt(-W * 0.2, [0xe6594f, 0x8db551, 0xe6594f, 0x8db551, 0xe6594f, 0x8db551]));
  // Cacho de bananas
  const banana = scene.add.container(-W * 0.06, 30);
  banana.add(scene.add.arc(0, 0, 16, 200, 340, false, 0, 0).setStrokeStyle(6, 0xf3c54d));
  banana.add(scene.add.arc(0, -3, 14, 210, 330, false, 0, 0).setStrokeStyle(5, 0xe8b93a));
  banana.add(scene.add.circle(14, 4, 3, 0x6b4d2b).setStrokeStyle(1, PAL.outline));
  root.add(banana);

  // Pilha de caixas de papelão
  const boxAt = (bx: number, by: number, w2: number, ang: number) => {
    const b = scene.add.container(bx, by);
    b.add(scene.add.rectangle(0, 0, w2, w2 * 0.72, 0xc9a06b).setStrokeStyle(3, PAL.outline));
    b.add(scene.add.line(0, 0, 0, -w2 * 0.36, 0, w2 * 0.36, shade(0xc9a06b, 30), 2));
    b.add(scene.add.line(0, 0, -w2 * 0.2, 0, w2 * 0.2, 0, shade(0xc9a06b, 30), 2));
    b.setAngle(ang);
    return b;
  };
  root.add(boxAt(W * 0.4, 40, 30, 0));
  root.add(boxAt(W * 0.4 - 4, 22, 27, -7));
  root.add(boxAt(W * 0.4 + 3, 4, 24, 5));

  // Carrinho de compras estacionado
  const cart = scene.add.container(W * 0.05, 46);
  cart.add(scene.add.polygon(0, -12, [-20, 0, 20, 0, 15, -18, -15, -18], 0, 0).setStrokeStyle(2, PAL.outline));
  const grid = scene.add.graphics();
  grid.lineStyle(1, PAL.outline, 0.75);
  for (let i = -2; i <= 2; i++) grid.lineBetween(i * 7, -18, i * 8.5, 0);
  grid.lineBetween(-17, -13, 17, -13); grid.lineBetween(-15, -8, 15, -8);
  cart.add(grid);
  cart.add(scene.add.line(-19, -19, 0, 0, -10, -8, 0x2f2748, 3));
  [[-13], [13]].forEach(([wx]) => {
    cart.add(scene.add.circle(wx, 2, 4, 0x2f2748).setStrokeStyle(1, PAL.outline));
  });
  root.add(cart);


return { root, bounds: new Phaser.Geom.Rectangle(x - W / 2 - 10, y - H - 12, W + 35, H + 35) };
}
