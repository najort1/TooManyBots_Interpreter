import * as Phaser from "phaser";
import { PAL } from "../avatarRigShared";

/**
 * Ciclo dia/noite sincronizado com o relógio REAL da máquina.
 * Noite com contraste de verdade: multiplicador escuro, vinheta, glows radiais
 * suaves (canvas), reflexos dos postes no asfalto e janelas estourando luz.
 */

export type DayPeriod = "dawn" | "day" | "sunset" | "night";

export interface Spot { x: number; y: number }

/** Halo de luz dinâmico acoplado a um personagem. */
export interface RigLight {
  update(x: number, y: number): void;
  destroy(): void;
}

interface LightSource { x: number; y: number; r: number; w: number; cr: number; cg: number; cb: number }

/** Período atual pelo relógio local. */
export function currentPeriod(now = new Date()): DayPeriod {
  const m = now.getHours() * 60 + now.getMinutes();
  if (m >= 330 && m < 420) return "dawn";
  if (m >= 420 && m < 1050) return "day";
  if (m >= 1050 && m < 1140) return "sunset";
  return "night";
}

interface PeriodCfg {
  sky: number;
  multiply: number;
  alpha: number;
  vignette: number;
  stars: number;
  moon: boolean;
  sun: "none" | "west" | "east";
  lampAlpha: number;
  reflectAlpha: number;
  windowAlpha: number;
  contrast: number;
  saturation: number;
}

const CFG: Record<DayPeriod, PeriodCfg> = {
  dawn: { sky: 0x514b74, multiply: 0xb9c6ff, alpha: 0.12, vignette: 0.08, stars: 0, moon: false, sun: "east", lampAlpha: 0.12, reflectAlpha: 0.035, windowAlpha: 0.42, contrast: 0.05, saturation: 0.08 },
  day: { sky: 0x86b6de, multiply: 0xffffff, alpha: 0, vignette: 0, stars: 0, moon: false, sun: "none", lampAlpha: 0, reflectAlpha: 0, windowAlpha: 0, contrast: 0.04, saturation: 0.08 },
  sunset: { sky: 0x6b3b51, multiply: 0xffaf73, alpha: 0.16, vignette: 0.1, stars: 14, moon: false, sun: "west", lampAlpha: 0.24, reflectAlpha: 0.065, windowAlpha: 0.78, contrast: 0.09, saturation: 0.14 },
  night: { sky: 0x101833, multiply: 0x7280aa, alpha: 0.28, vignette: 0.15, stars: 64, moon: true, sun: "none", lampAlpha: 0.42, reflectAlpha: 0.085, windowAlpha: 1, contrast: 0.13, saturation: 0.12 },
};

/** Gradiente radial branco->transparente gerado em canvas (queda-off suave de verdade). */
function ensureRadial(scene: Phaser.Scene, key: string, size: number, inner: string, mid?: [number, string]) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, size, size);
  if (!tex) return;
  const ctx = tex.getContext();
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  if (mid) g.addColorStop(mid[0], mid[1]);
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  tex.refresh();
}

export class DayNightCycle {
  private period: DayPeriod;
  private tracked: Phaser.GameObjects.GameObject[] = [];
  private sources: LightSource[] = [];
  private ambient: LightSource = { x: 0, y: 0, r: 0, w: 0, cr: 0, cg: 0, cb: 0 };

  constructor(
    private scene: Phaser.Scene,
    private viewW: number,
    private viewH: number,
    private lamps: Spot[],
    private windows: (Spot & { depth: number })[],
  ) {
    this.period = currentPeriod();
    this.apply(this.period);
    // Reavalia o período a cada 30s — se virar o dia em tempo real, a rua acompanha.
    scene.time.addEvent({ delay: 30000, loop: true, callback: () => {
      const next = currentPeriod();
      if (next !== this.period) this.apply(next);
    } });
  }

  private track<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.tracked.push(obj);
    return obj;
  }

  /** Glow radial aditivo com escala/fade — substitui elipses chapadas. */
  private glow(x: number, y: number, diameter: number, alpha: number, tint: number, depth: number, squashY = 1) {
    ensureRadial(this.scene, "dn-radial", 256, "rgba(255,255,255,0.9)", [0.4, "rgba(255,255,255,0.28)"]);
    const img = this.scene.add.image(x, y, "dn-radial")
      .setDisplaySize(diameter, diameter * squashY)
      .setTint(tint)
      .setAlpha(alpha)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(depth);
    return this.track(img);
  }

  /** Color grading e bloom reais na GPU; Canvas mantém os gradientes como fallback. */
  private configurePostFx(cfg: PeriodCfg, period: DayPeriod) {
    const camera = this.scene.cameras.main;
    camera.postFX.clear();
    if (this.scene.game.renderer.type !== Phaser.WEBGL) return;

    const matrix = camera.postFX.addColorMatrix();
    matrix.brightness(period === "night" ? 1.07 : 1.03);
    matrix.contrast(cfg.contrast, true);
    matrix.saturate(cfg.saturation, true);
    if (cfg.vignette > 0) camera.postFX.addVignette(0.5, 0.48, 0.86, cfg.vignette);
    if (period !== "day") camera.postFX.addBloom(0xffd98a, 0.45, 0.45, 0.55, 0.18, 2);
  }

  private apply(period: DayPeriod) {
    this.period = period;
    for (const obj of this.tracked) { this.scene.tweens.killTweensOf(obj); obj.destroy(); }
    this.tracked = [];
    const cfg = CFG[period];

    this.scene.cameras.main.setBackgroundColor("#" + cfg.sky.toString(16).padStart(6, "0"));
    this.configurePostFx(cfg, period);

    // Fontes de luz que refletem nos personagens
    const S = this.sources;
    S.length = 0;
    if (cfg.lampAlpha > 0) {
      const s = Math.min(1, cfg.lampAlpha * 1.9);
      for (const l of this.lamps) S.push({ x: l.x + 25, y: l.y - 88, r: 250, w: s, cr: 1, cg: 0.84, cb: 0.45 });
    }
    if (cfg.windowAlpha > 0) {
      for (const win of this.windows) S.push({ x: win.x, y: win.y, r: 95, w: 0.55 * cfg.windowAlpha, cr: 1, cg: 0.84, cb: 0.45 });
    }
    if (cfg.moon) S.push({ x: 1960, y: 106, r: 900, w: 0.16, cr: 0.56, cg: 0.65, cb: 1 });
    if (cfg.sun === "west") S.push({ x: 168, y: 306, r: 1000, w: 0.42, cr: 1, cg: 0.62, cb: 0.3 });
    else if (cfg.sun === "east") S.push({ x: 2040, y: 306, r: 1000, w: 0.32, cr: 0.95, cg: 0.85, cb: 0.55 });
    // Ambiente base do período (para o avatar não ficar breu longe das luzes)
    const AMB: Record<DayPeriod, LightSource> = {
      dawn: { x: 0, y: 0, r: 0, w: 0.12, cr: 0.7, cg: 0.72, cb: 1 },
      day: { x: 0, y: 0, r: 0, w: 0, cr: 0, cg: 0, cb: 0 },
      sunset: { x: 0, y: 0, r: 0, w: 0.1, cr: 1, cg: 0.68, cb: 0.5 },
      night: { x: 0, y: 0, r: 0, w: 0.07, cr: 0.5, cg: 0.58, cb: 1 },
    };
    this.ambient = AMB[period];

    // Multiplicação preserva o contraste da arte; não cria o véu azul da composição normal.
    if (cfg.alpha > 0) {
      this.track(this.scene.add.rectangle(0, 0, this.viewW, this.viewH, cfg.multiply, cfg.alpha)
        .setOrigin(0)
        .setScrollFactor(0)
        .setBlendMode(Phaser.BlendModes.MULTIPLY)
        .setDepth(5000));
      // Fallback de vinheta também suaviza a borda no Canvas.
      ensureRadial(this.scene, "dn-vignette", 512, "rgba(0,0,0,0)", [0.55, "rgba(4,6,18,0.55)"]);
      this.track(this.scene.add.image(this.viewW / 2, this.viewH / 2, "dn-vignette")
        .setDisplaySize(this.viewW * 1.25, this.viewH * 1.4)
        .setAlpha(cfg.vignette)
        .setScrollFactor(0)
        .setDepth(5002));
    }

    // Estrelas piscando na faixa de céu
    for (let i = 0; i < cfg.stars; i++) {
      const star = this.track(this.scene.add.circle(
        Phaser.Math.Between(20, 2180),
        Phaser.Math.Between(18, 250),
        Phaser.Math.FloatBetween(0.8, 1.9),
        0xf5f2ff,
        Phaser.Math.FloatBetween(0.35, 0.95),
      ).setDepth(1));
      if (Math.random() < 0.45) this.scene.tweens.add({ targets: star, alpha: { from: star.alpha, to: 0.12 }, duration: Phaser.Math.Between(1100, 2600), yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }

    // Lua com halo suave ou sol baixo no horizonte
    if (cfg.moon) {
      this.glow(1960, 106, 260, 0.4, 0xbfd0ff, 1);
      this.track(this.scene.add.circle(1960, 106, 24, 0xeef0ff).setStrokeStyle(3, PAL.outline).setDepth(1));
      this.track(this.scene.add.circle(1952, 100, 5, 0xd5daee, 0.9).setDepth(1));
      this.track(this.scene.add.circle(1968, 112, 3.5, 0xd5daee, 0.8).setDepth(1));
      this.track(this.scene.add.circle(1958, 116, 2.5, 0xd5daee, 0.7).setDepth(1));
    }
    if (cfg.sun === "west") {
      this.glow(168, 306, 340, 0.5, 0xff9a4d, 1);
      this.track(this.scene.add.circle(168, 306, 28, 0xffb65e).setStrokeStyle(3, PAL.outline).setDepth(1));
    } else if (cfg.sun === "east") {
      this.glow(2040, 310, 280, 0.42, 0xffe2a8, 1);
      this.track(this.scene.add.circle(2040, 310, 24, 0xffe2a8).setStrokeStyle(3, PAL.outline).setDepth(1));
    }

    // Postes: bulbo quente + poça de luz com queda-off + reflexo alongado no asfalto
    if (cfg.lampAlpha > 0) {
      for (const lamp of this.lamps) {
        const hx = lamp.x + 25, hy = lamp.y - 88;
        const halo = this.glow(hx, hy, 116, 0.62, 0xffe6a3, 5001);
        const bulb = this.track(this.scene.add.circle(hx, hy, 4, 0xfff6dd, 0.95).setBlendMode(Phaser.BlendModes.ADD).setDepth(5001));
        // Poça no chão achatada
        this.glow(lamp.x + 18, lamp.y + 6, 230, cfg.lampAlpha, 0xffd76a, 5001, 0.34);
        // Reflexo vertical na pista (asfalto molhado)
        if (cfg.reflectAlpha > 0) {
          this.glow(hx, hy + 132, 54, cfg.reflectAlpha, 0xffd76a, 5001, 3.3);
          this.glow(hx + 10, hy + 160, 20, cfg.reflectAlpha * 0.72, 0xfff0b5, 5001, 5.2);
        }
        if (period === "night") {
          // Tremor de lâmpada de vapor metálico: cada camada respira na própria intensidade.
          const dur = Phaser.Math.Between(700, 1400);
          for (const layer of [halo, bulb]) {
            this.scene.tweens.add({ targets: layer, alpha: { from: layer.alpha, to: layer.alpha * 0.72 }, duration: dur, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
          }
        }
      }
    }

    // Janelas estourando luz: painel quente + halo radial que invade a noite
    if (cfg.windowAlpha > 0) {
      for (const win of this.windows) {
        const pane = this.track(this.scene.add.rectangle(win.x, win.y, 14, 12, 0xffe9a8, 0.96 * cfg.windowAlpha).setStrokeStyle(2, PAL.outline).setDepth(win.depth + 2));
        this.glow(win.x, win.y, 92, 0.34 * cfg.windowAlpha, 0xffd76a, 5001);
        this.glow(win.x, win.y + 48, 28, 0.12 * cfg.windowAlpha, 0xffe7a2, 5001, 3.2);
        if (Math.random() < 0.3) this.scene.tweens.add({ targets: pane, alpha: { from: pane.alpha, to: pane.alpha * 0.65 }, duration: Phaser.Math.Between(800, 1800), yoyo: true, repeat: -1 });
      }
    }
  }

  /**
   * Luz refletida no personagem: halo aditivo que amostra as fontes próximas,
   * pinta com a cor da luz dominante e se desloca na direção dela.
   */
  makeRigLight(): RigLight {
    ensureRadial(this.scene, "dn-radial", 256, "rgba(255,255,255,0.9)", [0.4, "rgba(255,255,255,0.28)"]);
    const img = this.scene.add.image(0, 0, "dn-radial")
      .setDisplaySize(130, 165)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setVisible(false);
    const sample = () => {
      let r = 0, g = 0, b = 0, w = 0;
      let dom: LightSource | null = null, domW = 0;
      return { add(s: LightSource, x: number, y: number) {
        const dx = s.x - x, dy = s.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 > s.r * s.r) return;
        const f = 1 - Math.sqrt(d2) / s.r;
        const ww = s.w * f * f;
        if (ww <= 0) return;
        r += s.cr * ww; g += s.cg * ww; b += s.cb * ww; w += ww;
        if (ww > domW) { domW = ww; dom = s; }
      }, result() { return { r, g, b, w, dom }; } };
    };
    const api: RigLight = {
      update: (x: number, y: number) => {
        const acc = sample();
        for (const s of this.sources) acc.add(s, x, y);
        acc.add(this.ambient, x, y);
        const { r, g, b, w, dom } = acc.result();
        if (w <= 0.02) { img.setVisible(false); return; }
        img.setVisible(true);
        // Cor normalizada pelo canal dominante preserva o matiz da luz
        const n = Math.max(r, g, b, 0.001);
        img.setTint(Phaser.Display.Color.GetColor(
          Math.min(255, Math.round((r / n) * 255)),
          Math.min(255, Math.round((g / n) * 255)),
          Math.min(255, Math.round((b / n) * 255)),
        ));
        img.setAlpha(Math.min(0.5, w * 0.8));
        // Catch-light deslocado na direção da fonte dominante
        let ox = 0, oy = 0;
        if (dom && dom.r > 0) {
          const dx = dom.x - x, dy = dom.y - y;
          const d = Math.hypot(dx, dy) || 1;
          ox = (dx / d) * 14; oy = (dy / d) * 10;
        }
        img.setPosition(x + ox, y + oy);
        img.setDepth(y + 1002);
      },
      destroy() { img.destroy(); },
    };
    return api;
  }
}
