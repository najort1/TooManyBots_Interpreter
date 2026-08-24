import * as Phaser from "phaser";
import { PAL } from "../avatarRigShared";

/** Lanternas penduradas nos varais das barracas. */
export const WINDOW_LIGHTS: [number, number][] = [[-100, -80], [0, -80], [100, -80]];


/** Feira do Beco — três barracas únicas (frutas, verduras, doces) com balanças, preços e bandeirinhas. */

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

type Edge = "scallop" | "zigzag" | "fringe";

function stallBase(scene: Phaser.Scene, color: number, edge: Edge) {
  const s = scene.add.container(0, 0);
  // Poles + crossbar
  [-44, 44].forEach(px => s.add(scene.add.rectangle(px, -34, 7, 96, 0x573b2d).setStrokeStyle(2, PAL.outline)));
  s.add(scene.add.rectangle(0, -80, 100, 5, 0x573b2d).setStrokeStyle(2, PAL.outline));
  // Canopy slab + decorative lower edge
  s.add(scene.add.polygon(0, -88, [-58, 14, 58, 14, 46, -12, -46, -12], color).setStrokeStyle(3, PAL.outline));
  const deco = scene.add.graphics();
  deco.lineStyle(2, PAL.outline, 1);
  if (edge === "scallop") for (let i = 0; i < 6; i++) deco.fillStyle(i % 2 ? shade(color, 18) : color, 1).fillCircle(-45 + i * 18, -74 + 12, 9);
  else if (edge === "zigzag") for (let i = 0; i < 6; i++) deco.fillStyle(i % 2 ? shade(color, 18) : color, 1).fillTriangle(-45 + i * 18, -62, -27 + i * 18, -62, -36 + i * 18, -50);
  else for (let i = 0; i < 8; i++) deco.fillStyle(i % 2 ? shade(color, 18) : color, 1).fillRect(-49 + i * 12.5, -76, 11, 10);
  s.add(deco);
  // Counter table
  s.add(scene.add.rectangle(0, -22, 104, 13, 0x875a39).setStrokeStyle(3, PAL.outline));
  s.add(scene.add.rectangle(0, -4, 96, 26, shade(0x875a39, 20)).setStrokeStyle(3, PAL.outline));
  // Empty crates under counter
  s.add(scene.add.rectangle(-24, 16, 34, 15, 0xa9743f).setStrokeStyle(2, PAL.outline));
  s.add(scene.add.rectangle(20, 16, 34, 15, 0xa9743f).setStrokeStyle(2, PAL.outline));
  // Hanging scale from crossbar
  const scaleC = scene.add.container(30, -78);
  scaleC.add(scene.add.line(0, 6, 0, 0, 0, 12, PAL.outline, 2));
  scaleC.add(scene.add.line(0, 12, -14, 0, 14, 0, 0x4b4457, 3));
  scaleC.add(scene.add.ellipse(-14, 20, 14, 5, 0xb9c2ce).setStrokeStyle(2, PAL.outline));
  scaleC.add(scene.add.ellipse(14, 20, 14, 5, 0xb9c2ce).setStrokeStyle(2, PAL.outline));
  s.add(scaleC);
  return s;
}

export function buildFeira(scene: Phaser.Scene, x: number, y: number): { root: Phaser.GameObjects.Container; bounds: Phaser.Geom.Rectangle } {
  const root = scene.add.container(x, y).setDepth(y);
  root.add(scene.add.ellipse(0, 12, 320, 40, 0x120d20, 0.28));

  const mkPriceBoard = (parent: Phaser.GameObjects.Container, px: number, text: string) => {
    const b = scene.add.container(px, -32);
    b.add(scene.add.rectangle(0, 0, 40, 22, 0x2f2b33).setStrokeStyle(2, 0x5a3526));
    b.add(scene.add.text(0, 0, text, { fontFamily: "monospace", fontSize: "9px", color: "#f5e8cf" }).setOrigin(0.5));
    parent.add(b);
  };

  // Barraca 1 — FRUTAS (scallop)
  const f1 = stallBase(scene, 0xe6594f, "scallop");
  f1.setPosition(-100, 0);
  const crateF = scene.add.container(0, -30);
  crateF.add(scene.add.polygon(0, 0, [-34, 0, 34, 0, 27, -22, -27, -22], 0xa9743f).setStrokeStyle(2, PAL.outline));
  [[-16], [0], [16]].forEach(([ox]) => crateF.add(scene.add.circle(ox, -26, 7, 0xf39c3f).setStrokeStyle(2, PAL.outline)));
  [[-8], [8]].forEach(([ox]) => crateF.add(scene.add.circle(ox, -37, 7, 0xf39c3f).setStrokeStyle(2, PAL.outline)));
  crateF.add(scene.add.circle(0, -47, 7, 0xe8862e).setStrokeStyle(2, PAL.outline));
  // Uvas em cacho
  const grapes = scene.add.container(-38, -38);
  [[-5, 0], [5, 0], [0, 6], [-3, 12], [4, 12]].forEach(([gx, gy]) => grapes.add(scene.add.circle(gx as number, gy as number, 4.5, 0x8d659e).setStrokeStyle(1, PAL.outline)));
  grapes.add(scene.add.line(0, -8, 0, 0, 0, -8, 0x4d7a4f, 2));
  crateF.add(grapes);
  f1.add(crateF);
  const bananas = scene.add.container(34, -34);
  bananas.add(scene.add.arc(0, 0, 15, 200, 340, false, 0, 0).setStrokeStyle(6, 0xf3c54d));
  bananas.add(scene.add.arc(0, -3, 12, 210, 330, false, 0, 0).setStrokeStyle(5, 0xe8b93a));
  f1.add(bananas);
  mkPriceBoard(f1, -34, "R$ 5/kg");
  root.add(f1);

  // Barraca 2 — VERDURAS (zigzag)
  const f2 = stallBase(scene, 0x3a9c78, "zigzag");
  f2.setPosition(0, 0);
  // Alfaces
  [[-30], [-14]].forEach(([lx]) => {
    f2.add(scene.add.ellipse(lx as number, -34, 17, 11, 0x69a05a).setStrokeStyle(2, PAL.outline));
    f2.add(scene.add.ellipse(lx as number, -36, 10, 7, 0x8cc07c));
  });
  // Maços de couve
  [4, 18].forEach(cx => {
    f2.add(scene.add.arc(cx, -36, 9, 180, 360, false, 0x2f6b45).setStrokeStyle(2, PAL.outline));
    f2.add(scene.add.rectangle(cx, -31, 3, 9, 0x4d7a4f));
  });
  // Cenouras com folhas
  const carrot = scene.add.container(34, -33);
  [0, 8].forEach((ox, i) => {
    carrot.add(scene.add.triangle(ox, 4 + (i % 2) * 2, -3, -8, 3, -8, 0, 8, 0xf39c3f).setStrokeStyle(1, PAL.outline));
    carrot.add(scene.add.line(ox, -6, 0, 0, -3, -8, 0x4d7a4f, 2));
  });
  f2.add(carrot);
  // Regador encostado no pilar
  const can = scene.add.container(-42, -10);
  can.add(scene.add.rectangle(0, 0, 18, 14, 0x7fa3b5).setStrokeStyle(2, PAL.outline));
  can.add(scene.add.polygon(0, -4, [-8, -2, -17, -8, -14, -11, -6, -6], 0x7fa3b5).setStrokeStyle(2, PAL.outline));
  can.add(scene.add.circle(11, -7, 5, 0, 0).setStrokeStyle(2, PAL.outline));
  mkPriceBoard(f2, -34, "R$ 4/mç");
  root.add(f2);

  // Barraca 3 — DOCES & GELEIAS (fringe)
  const f3 = stallBase(scene, 0xf0c34f, "fringe");
  f3.setPosition(100, 0);
  // Prateleira de geleias
  f3.add(scene.add.rectangle(0, -40, 92, 3, 0x573b2d).setStrokeStyle(1, PAL.outline));
  for (let j = 0; j < 6; j++) {
    const jx = -35 + j * 14;
    f3.add(scene.add.rectangle(jx, -48, 9, 14, [0xc23d33, 0x8d4b8d, 0xe6594f][j % 3]).setStrokeStyle(2, PAL.outline));
    f3.add(scene.add.rectangle(jx, -56, 9, 4, 0xf5e8cf).setStrokeStyle(1, PAL.outline));
  }
  // Potes de mel
  [[28], [42]].forEach(([mx], i) => {
    f3.add(scene.add.rectangle(mx as number, -32, 10, 12, 0xd69a3c).setStrokeStyle(2, PAL.outline));
    f3.add(scene.add.rectangle(mx as number, -39, 10, 3, 0x8a5a36).setStrokeStyle(1, PAL.outline));
    void i;
  });
  // Bolo no balcão
  f3.add(scene.add.rectangle(-30, -30, 24, 10, 0xf5e8cf).setStrokeStyle(2, PAL.outline));
  f3.add(scene.add.rectangle(-30, -36, 18, 7, 0xd77bd4).setStrokeStyle(2, PAL.outline));
  f3.add(scene.add.circle(-30, -41, 2.5, 0xe6594f));
  mkPriceBoard(f3, 30, "R$ 12");
  root.add(f3);

  // Bandeirinhas ligando os topos
  const bunting = scene.add.graphics();
  const cols = [0xe6594f, 0xf3c54d, 0x3a9c78];
  let lx = -144, ly = -86;
  for (let i = 1; i <= 24; i++) {
    const t = i / 24;
    const nx = -144 + t * 288;
    const ny = -86 - Math.sin(t * Math.PI * 3) * 6 - Math.sin(t * Math.PI) * 4;
    bunting.lineStyle(2, PAL.outline, 0.8).lineBetween(lx, ly, nx, ny);
    if (i % 2 === 0) { bunting.fillStyle(cols[(i / 2) % 3], 1); bunting.fillTriangle(nx - 4, ny, nx + 4, ny, nx, ny + 10); }
    lx = nx; ly = ny;
  }
  root.add(bunting);

  // Sacolas de papel + caixa BECO no chão
  [[-150, 26], [-136, 34]].forEach(([bx, by], i) => {
    const bag = scene.add.container(bx as number, by as number);
    bag.add(scene.add.polygon(0, 0, [-11, 0, 11, 0, 8, -20, -8, -20], 0xc9a06b).setStrokeStyle(2, PAL.outline));
    const crinkle = scene.add.graphics();
    crinkle.lineStyle(2, shade(0xc9a06b, 30), 1);
    crinkle.lineBetween(-7, -20, -3, -25); crinkle.lineBetween(-3, -25, 2, -21); crinkle.lineBetween(2, -21, 7, -26);
    bag.add(crinkle);
    void i;
    root.add(bag);
  });
  const becrate = scene.add.container(158, 30);
  becrate.add(scene.add.rectangle(0, 0, 44, 22, 0xa9743f).setStrokeStyle(3, PAL.outline));
  becrate.add(scene.add.line(0, 0, -44, 0, 44, 0, shade(0xa9743f, 30), 2));
  becrate.add(scene.add.text(0, 0, "BECO", { fontFamily: "monospace", fontSize: "10px", fontStyle: "bold", color: "#3d281e" }).setOrigin(0.5));
  root.add(becrate);

  root.add(chip(scene, "FEIRA DO BECO", 170).setPosition(0, -128));

  return { root, bounds: new Phaser.Geom.Rectangle(x - 148, y - 30, 296, 62) };
}
