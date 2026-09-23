/**
 * Domínio compartilhado de customização de carros 3D padrão AAA.
 * Compartilhado entre backend (fun/services/carService.js) e frontend Next.js (fun_dashboard).
 */

export const CAR_CATALOG_REVISION = 3;

export const PAINT_COLORS = Object.freeze([
  { id: 'red', hex: '#e63946', name: 'Vermelho Racing', cost: 0 },
  { id: 'black', hex: '#111116', name: 'Preto Noturno', cost: 50 },
  { id: 'white', hex: '#f8f9fa', name: 'Branco Pérola', cost: 50 },
  { id: 'cyan', hex: '#00f0ff', name: 'Azul Cyberpunk', cost: 120 },
  { id: 'yellow', hex: '#ffd166', name: 'Amarelo Veloz', cost: 80 },
  { id: 'purple', hex: '#7b2cbf', name: 'Roxo Neon', cost: 150 },
  { id: 'green', hex: '#06d6a0', name: 'Verde Esmeralda', cost: 100 },
  { id: 'orange', hex: '#ff6b35', name: 'Laranja Sunset', cost: 90 },
  { id: 'matte_gray', hex: '#2b2d42', name: 'Chumbo Fosco', cost: 130 },
  { id: 'pink', hex: '#ff007f', name: 'Rosa Choque', cost: 140 },
  { id: 'gold', hex: '#e5a93c', name: 'Dourado Real', cost: 250 },
]);

export const SECONDARY_COLORS = Object.freeze([
  { id: 'dark_navy', hex: '#1d3557', name: 'Azul Meia-Noite', cost: 0 },
  { id: 'black_carbon', hex: '#1a1a1a', name: 'Preto Carbono', cost: 30 },
  { id: 'racing_red', hex: '#e63946', name: 'Vermelho Pista', cost: 30 },
  { id: 'pure_white', hex: '#ffffff', name: 'Branco Gelo', cost: 30 },
  { id: 'chrome_silver', hex: '#c0c0c0', name: 'Prata Metálico', cost: 60 },
  { id: 'royal_gold', hex: '#ffd700', name: 'Dourado Brilhante', cost: 80 },
  { id: 'deep_purple', hex: '#3a0ca3', name: 'Roxo Profundo', cost: 70 },
]);

export const PAINT_FINISHES = Object.freeze([
  { id: 'glossy', name: 'Verniz Espelhado (Glossy)', cost: 0, roughness: 0.15, metalness: 0.85, clearcoat: 1.0 },
  { id: 'matte', name: 'Fosco Acetinado (Stealth Matte)', cost: 80, roughness: 0.65, metalness: 0.35, clearcoat: 0.05 },
  { id: 'chameleon', name: 'Perolizado Camaleão (ColorShift)', cost: 180, roughness: 0.1, metalness: 0.95, clearcoat: 1.0 },
  { id: 'carbon', name: 'Fibra de Carbono Forjada Completa', cost: 260, roughness: 0.35, metalness: 0.2, clearcoat: 0.9 },
]);

export const BODYKITS = Object.freeze([
  { id: 'stock', name: 'Carroceria Original de Fábrica', cost: 0, hpBonus: 0, downforce: 10 },
  { id: 'widebody', name: 'Rocket Widebody (Fenders Alargados)', cost: 280, hpBonus: 0, downforce: 35 },
  { id: 'time_attack', name: 'Time Attack (Canards de Carbono + Splitter)', cost: 390, hpBonus: 15, downforce: 60 },
]);

export const HEADLIGHT_TINTS = Object.freeze([
  { id: 'xenon', name: 'Xenon Puro 6500K', cost: 0, hex: '#ffffff', emissiveHex: '#e8f4ff' },
  { id: 'lemans', name: 'Amarelo Endurance Le Mans', cost: 60, hex: '#ffea00', emissiveHex: '#ffe600' },
  { id: 'cyan', name: 'Azul Neon Cyberpunk', cost: 90, hex: '#00f0ff', emissiveHex: '#00d4ff' },
  { id: 'demon', name: 'Demon Eyes Vermelho Sangue', cost: 120, hex: '#ff0033', emissiveHex: '#ff0022' },
  { id: 'purple', name: 'Roxo Ultravioleta Tokyo', cost: 100, hex: '#b5179e', emissiveHex: '#bc13fe' },
]);

export const INTERIORS = Object.freeze([
  { id: 'black_leather', name: 'Couro Preto Sport & Costuras Vermelhas', cost: 0 },
  { id: 'red_alcantara', name: 'Alcantara Vermelho Corrida Italiana', cost: 130 },
  { id: 'white_vip', name: 'Couro Branco Puro VIP', cost: 160 },
  { id: 'carbon_race', name: 'Cockpit Aliviado de Fibra de Carbono', cost: 210 },
]);

export const ROLL_CAGES = Object.freeze([
  { id: 'none', name: 'Sem Gaiola de Proteção', cost: 0 },
  { id: 'clubsport', name: 'Gaiola Clubsport (Meio Arco Traseiro)', cost: 110 },
  { id: 'full_race', name: 'Gaiola Integral FIA Competição', cost: 220 },
]);

export const WHEEL_CAMBERS = Object.freeze([
  { id: 'neutral', name: 'Alinhamento Reto (0° Neutro)', cost: 0, angle: 0 },
  { id: 'stance', name: 'Stance Esportivo (-3° Negativo)', cost: 50, angle: -0.052 },
  { id: 'demon', name: 'JDM Demon Camber (-7° Agressivo)', cost: 95, angle: -0.122 },
]);

export const BRAKE_CALIPER_COLORS = Object.freeze([
  { id: 'red', name: 'Vermelho Brembo Racing', cost: 0, hex: '#e63946' },
  { id: 'yellow', name: 'Amarelo Cerâmica Carbono', cost: 45, hex: '#ffd166' },
  { id: 'blue', name: 'Azul Esportivo Elétrico', cost: 45, hex: '#00d4ff' },
  { id: 'gold', name: 'Dourado Akebono Competição', cost: 65, hex: '#e5a93c' },
  { id: 'acid_green', name: 'Verde Ácido Híbrido', cost: 65, hex: '#39ff14' },
  { id: 'black', name: 'Preto Cetim Stealth', cost: 30, hex: '#1c1c20' },
]);

export const WHEEL_COLORS = Object.freeze([
  { id: 'chrome', name: 'Cromado Espelhado', cost: 0, hex: '#ffffff' },
  { id: 'black_satin', name: 'Preto Cetim Fosco', cost: 40, hex: '#161618' },
  { id: 'gold_metal', name: 'Dourado Metálico JDM', cost: 60, hex: '#d4af37' },
  { id: 'bronze', name: 'Bronze Forjado Rays', cost: 70, hex: '#8c6239' },
  { id: 'pure_white', name: 'Branco Corrida Rally', cost: 40, hex: '#ffffff' },
  { id: 'candy_red', name: 'Vermelho Metálico Candy', cost: 65, hex: '#b3001b' },
]);

export const EXHAUST_STYLES = Object.freeze([
  { id: 'quad_chrome', name: 'Quádruplo Cromado de Fábrica', cost: 0 },
  { id: 'dual_titanium', name: 'Duplo Titânio Queimado (Blue Tip)', cost: 110 },
  { id: 'center_supercar', name: 'Exaustão Central Tripla Tri-Exit', cost: 180 },
]);

export const WHEELS = Object.freeze([
  { id: 'sport', name: 'Rodas Esportivas 5 Raios', cost: 0 },
  { id: 'classic', name: 'Rodas Clássicas Spoke', cost: 75 },
  { id: 'deep_dish', name: 'Aros Deep Dish Borda Larga', cost: 150 },
  { id: 'offroad', name: 'Rodas & Pneus All-Terrain', cost: 110 },
  { id: 'turbofan', name: 'Aero Turbofan Corrida', cost: 180 },
  { id: 'chrome', name: 'Rodas Cromadas VIP', cost: 220 },
]);

export const SPOILERS = Object.freeze([
  { id: 'none', name: 'Sem Aerofólio (Clean)', cost: 0 },
  { id: 'ducktail', name: 'Ducktail Sutil', cost: 60 },
  { id: 'gt_wing', name: 'Asa GT Fibra de Carbono', cost: 160 },
  { id: 'drag_wing', name: 'Aerofólio Drag Pro Alto', cost: 240 },
]);

export const SUSPENSIONS = Object.freeze([
  { id: 'normal', name: 'Altura Original de Fábrica', cost: 0, heightOffset: 0 },
  { id: 'low', name: 'Suspensão Esportiva (-30mm)', cost: 70, heightOffset: -0.06 },
  { id: 'slammed', name: 'Rebaixado Fixa (-60mm Raspa)', cost: 140, heightOffset: -0.12 },
  { id: 'air', name: 'Suspensão a Ar Regulável', cost: 250, heightOffset: -0.10 },
  { id: 'raised', name: 'Suspensão Elevada Rally (+40mm)', cost: 90, heightOffset: 0.08 },
]);

export const NEON_UNDERGLOW = Object.freeze([
  { id: 'none', name: 'Sem Neon', cost: 0, hex: null },
  { id: 'blue', name: 'Neon Azul Gelo', cost: 90, hex: '#00d4ff' },
  { id: 'green', name: 'Neon Verde Ácido', cost: 90, hex: '#39ff14' },
  { id: 'red', name: 'Neon Vermelho Sangue', cost: 90, hex: '#ff0033' },
  { id: 'purple', name: 'Neon Violeta Elétrico', cost: 90, hex: '#bc13fe' },
  { id: 'gold', name: 'Neon Dourado Tokyo', cost: 120, hex: '#ffe600' },
]);

export const DECALS = Object.freeze([
  { id: 'none', name: 'Sem Adesivo', cost: 0 },
  { id: 'stripes', name: 'Faixas de Corrida Duplas', cost: 80 },
  { id: 'flames', name: 'Chamas Laterais Street', cost: 120 },
  { id: 'dragon', name: 'Dragão Cibernético', cost: 200 },
  { id: 'carbon', name: 'Capô de Fibra de Carbono', cost: 140 },
]);

export const WINDOW_TINTS = Object.freeze([
  { id: 'clear', name: 'Transparente Original', cost: 0, opacity: 0.2 },
  { id: 'light', name: 'Fumê Suave (30%)', cost: 30, opacity: 0.45 },
  { id: 'medium', name: 'Fumê Médio (50%)', cost: 50, opacity: 0.7 },
  { id: 'dark', name: 'G5 Escuro Total (95%)', cost: 80, opacity: 0.92 },
]);

export const CAR_CATALOG = Object.freeze({
  colors: PAINT_COLORS,
  secondaryColors: SECONDARY_COLORS,
  finishes: PAINT_FINISHES,
  bodykits: BODYKITS,
  headlights: HEADLIGHT_TINTS,
  interiors: INTERIORS,
  rollCages: ROLL_CAGES,
  cambers: WHEEL_CAMBERS,
  caliperColors: BRAKE_CALIPER_COLORS,
  wheelColors: WHEEL_COLORS,
  exhaustStyles: EXHAUST_STYLES,
  wheels: WHEELS,
  spoilers: SPOILERS,
  suspensions: SUSPENSIONS,
  neon: NEON_UNDERGLOW,
  decals: DECALS,
  windowTints: WINDOW_TINTS,
});

export const DEFAULT_CAR_CONFIG = Object.freeze({
  color: '#e63946',
  secondaryColor: '#1d3557',
  finish: 'glossy',
  bodykit: 'stock',
  headlight: 'xenon',
  interior: 'black_leather',
  rollCage: 'none',
  camber: 'neutral',
  caliperColor: 'red',
  wheelColor: 'chrome',
  exhaust: 'quad_chrome',
  wheels: 'sport',
  spoiler: 'none',
  suspension: 'normal',
  neon: 'none',
  decal: 'none',
  windowTint: 'light',
  plateText: '',
});

/**
 * Presets lendários prontos de jogo AAA.
 */
export const CAR_PRESETS = Object.freeze([
  {
    id: 'cyberpunk',
    name: 'Cyberpunk 2077 Night City',
    description: 'Pintura perolizada ciano, kit time attack e iluminação ultravioleta.',
    config: {
      color: '#00f0ff',
      secondaryColor: '#7b2cbf',
      finish: 'chameleon',
      bodykit: 'time_attack',
      headlight: 'cyan',
      interior: 'carbon_race',
      rollCage: 'full_race',
      wheels: 'turbofan',
      wheelColor: 'black_satin',
      caliperColor: 'acid_green',
      spoiler: 'gt_wing',
      suspension: 'slammed',
      neon: 'blue',
      decal: 'dragon',
      windowTint: 'dark',
      exhaust: 'dual_titanium',
    },
  },
  {
    id: 'drift_king',
    name: 'Drift King Touge Spec',
    description: 'Laranja sunset com chamas, kit widebody alargado e stance de -7°.',
    config: {
      color: '#ff6b35',
      secondaryColor: '#111116',
      finish: 'glossy',
      bodykit: 'widebody',
      headlight: 'lemans',
      interior: 'red_alcantara',
      rollCage: 'clubsport',
      wheels: 'deep_dish',
      wheelColor: 'gold_metal',
      caliperColor: 'yellow',
      camber: 'demon',
      spoiler: 'drag_wing',
      suspension: 'low',
      neon: 'gold',
      decal: 'flames',
      windowTint: 'medium',
      exhaust: 'dual_titanium',
    },
  },
  {
    id: 'gt3_racer',
    name: 'FIA GT3 Homologation',
    description: 'Pintura branca pérola com faixas duplas, asa GT e gaiola integral FIA.',
    config: {
      color: '#f8f9fa',
      secondaryColor: '#e63946',
      finish: 'glossy',
      bodykit: 'time_attack',
      headlight: 'lemans',
      interior: 'carbon_race',
      rollCage: 'full_race',
      wheels: 'turbofan',
      wheelColor: 'pure_white',
      caliperColor: 'yellow',
      spoiler: 'gt_wing',
      suspension: 'slammed',
      neon: 'none',
      decal: 'stripes',
      windowTint: 'light',
      exhaust: 'center_supercar',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight Wangan Stealth',
    description: 'Preto e chumbo fosco total, faróis demon eyes e insulfilm G5 95%.',
    config: {
      color: '#111116',
      secondaryColor: '#2b2d42',
      finish: 'matte',
      bodykit: 'stock',
      headlight: 'demon',
      interior: 'black_leather',
      rollCage: 'none',
      wheels: 'chrome',
      wheelColor: 'black_satin',
      caliperColor: 'red',
      camber: 'stance',
      spoiler: 'ducktail',
      suspension: 'slammed',
      neon: 'red',
      decal: 'carbon',
      windowTint: 'dark',
      exhaust: 'quad_chrome',
    },
  },
]);

/**
 * Calcula a telemetria e o índice de performance (PR Score) do carro com base na configuração.
 * @param {object} state
 */
export function calculateCarPerformance(state = {}) {
  let hp = 480;
  let topSpeed = 315;
  let zeroToHundred = 3.4;
  let handling = 74;
  let braking = 78;
  let styleScore = 50;

  if (state.bodykit === 'widebody') {
    handling += 12;
    braking += 4;
    styleScore += 25;
  } else if (state.bodykit === 'time_attack') {
    hp += 25;
    topSpeed += 8;
    handling += 18;
    braking += 8;
    styleScore += 35;
  }

  if (state.spoiler === 'gt_wing') {
    handling += 10;
    topSpeed -= 3;
    styleScore += 18;
  } else if (state.spoiler === 'drag_wing') {
    topSpeed += 12;
    zeroToHundred -= 0.15;
    handling += 4;
    styleScore += 22;
  } else if (state.spoiler === 'ducktail') {
    handling += 4;
    styleScore += 8;
  }

  if (state.suspension === 'low') {
    handling += 8;
    zeroToHundred -= 0.05;
  } else if (state.suspension === 'slammed') {
    handling += 12;
    topSpeed += 4;
    styleScore += 15;
  } else if (state.suspension === 'air') {
    handling += 10;
    styleScore += 20;
  } else if (state.suspension === 'raised') {
    handling -= 4;
    styleScore += 5;
  }

  if (state.exhaust === 'dual_titanium') {
    hp += 12;
    zeroToHundred -= 0.05;
    styleScore += 14;
  } else if (state.exhaust === 'center_supercar') {
    hp += 18;
    topSpeed += 5;
    styleScore += 20;
  }

  if (state.wheels === 'turbofan' || state.wheels === 'chrome') {
    styleScore += 16;
  }
  if (state.camber === 'stance') {
    handling += 6;
    styleScore += 12;
  } else if (state.camber === 'demon') {
    handling += 4;
    styleScore += 24;
  }

  if (state.rollCage === 'full_race') {
    handling += 7;
    braking += 6;
    styleScore += 15;
  } else if (state.rollCage === 'clubsport') {
    handling += 4;
    styleScore += 8;
  }

  if (state.neon && state.neon !== 'none') styleScore += 14;
  if (state.decal && state.decal !== 'none') styleScore += 12;
  if (state.finish && state.finish !== 'glossy') styleScore += 18;
  if (state.headlight && state.headlight !== 'xenon') styleScore += 10;
  if (state.caliperColor && state.caliperColor !== 'red') styleScore += 8;
  if (state.wheelColor && state.wheelColor !== 'chrome') styleScore += 8;

  const prScore = Math.min(
    999,
    Math.round(hp * 0.75 + handling * 2.2 + braking * 1.8 + styleScore * 1.2)
  );

  return {
    horsepower: hp,
    topSpeedKmh: topSpeed,
    zeroToHundredSec: Math.max(2.1, Number(zeroToHundred.toFixed(2))),
    handling: Math.min(100, handling),
    braking: Math.min(100, braking),
    styleScore: Math.min(100, styleScore),
    prScore,
  };
}

/**
 * Gera os pontos da curva de dinamômetro (Torque em Nm e Potência em CV por RPM)
 * para exibição em gráficos no dashboard e telemetria do WhatsApp.
 * @param {object} state
 */
export function generateDynoCurve(state = {}) {
  const perf = calculateCarPerformance(state);
  const peakHp = perf.horsepower;
  const peakTorque = Math.round(peakHp * 1.28); // Nm
  const points = [];

  const rpmSteps = [1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000];

  for (const rpm of rpmSteps) {
    // Curva característica de motor turbo esportivo V8
    const torqueRatio =
      rpm < 3000
        ? 0.55 + (rpm - 1500) * 0.0003
        : rpm <= 5500
        ? 0.98 + Math.sin(((rpm - 3000) / 2500) * Math.PI) * 0.02
        : 1.0 - ((rpm - 5500) / 2500) * 0.22;

    const torque = Math.round(peakTorque * Math.max(0.4, torqueRatio));
    // Fórmula física automotiva: Potência (CV) ≈ (Torque * RPM) / 7023
    const hp = Math.round((torque * rpm) / 7023);

    points.push({ rpm, torque, hp: Math.min(peakHp, hp) });
  }

  return { peakHp, peakTorque, points };
}

/**
 * Valida e sanitiza os campos de customização.
 * @param {object} input
 * @returns {{ ok: boolean, sanitized?: object, errors?: string[] }}
 */
export function validateCarCustomization(input = {}) {
  const errors = [];
  const sanitized = {};

  if (input.color !== undefined) {
    const rawColor = String(input.color || '').trim();
    const foundByHex = PAINT_COLORS.find((c) => c.hex.toLowerCase() === rawColor.toLowerCase());
    const foundById = PAINT_COLORS.find((c) => c.id === rawColor);
    if (foundByHex) sanitized.color = foundByHex.hex;
    else if (foundById) sanitized.color = foundById.hex;
    else if (/^#[0-9a-fA-F]{6}$/.test(rawColor)) sanitized.color = rawColor.toLowerCase();
    else errors.push(`Cor primária inválida: ${rawColor}`);
  }

  if (input.secondaryColor !== undefined) {
    const rawSec = String(input.secondaryColor || '').trim();
    const foundByHex = SECONDARY_COLORS.find((c) => c.hex.toLowerCase() === rawSec.toLowerCase());
    const foundById = SECONDARY_COLORS.find((c) => c.id === rawSec);
    if (foundByHex) sanitized.secondaryColor = foundByHex.hex;
    else if (foundById) sanitized.secondaryColor = foundById.hex;
    else if (/^#[0-9a-fA-F]{6}$/.test(rawSec)) sanitized.secondaryColor = rawSec.toLowerCase();
    else errors.push(`Cor secundária inválida: ${rawSec}`);
  }

  if (input.finish !== undefined) {
    const fId = String(input.finish || '').trim();
    if (PAINT_FINISHES.some((f) => f.id === fId)) sanitized.finish = fId;
    else errors.push(`Acabamento inválido: ${fId}`);
  }

  if (input.bodykit !== undefined) {
    const bId = String(input.bodykit || '').trim();
    if (BODYKITS.some((b) => b.id === bId)) sanitized.bodykit = bId;
    else errors.push(`Bodykit inválido: ${bId}`);
  }

  if (input.headlight !== undefined) {
    const hId = String(input.headlight || '').trim();
    if (HEADLIGHT_TINTS.some((h) => h.id === hId)) sanitized.headlight = hId;
    else errors.push(`Cor do farol inválida: ${hId}`);
  }

  if (input.interior !== undefined) {
    const iId = String(input.interior || '').trim();
    if (INTERIORS.some((i) => i.id === iId)) sanitized.interior = iId;
    else errors.push(`Interior inválido: ${iId}`);
  }

  if (input.rollCage !== undefined) {
    const rId = String(input.rollCage || '').trim();
    if (ROLL_CAGES.some((r) => r.id === rId)) sanitized.rollCage = rId;
    else errors.push(`Gaiola inválida: ${rId}`);
  }

  if (input.camber !== undefined) {
    const cId = String(input.camber || '').trim();
    if (WHEEL_CAMBERS.some((c) => c.id === cId)) sanitized.camber = cId;
    else errors.push(`Camber inválido: ${cId}`);
  }

  if (input.caliperColor !== undefined) {
    const calId = String(input.caliperColor || '').trim();
    if (BRAKE_CALIPER_COLORS.some((c) => c.id === calId)) sanitized.caliperColor = calId;
    else errors.push(`Pinça de freio inválida: ${calId}`);
  }

  if (input.wheelColor !== undefined) {
    const wcId = String(input.wheelColor || '').trim();
    if (WHEEL_COLORS.some((c) => c.id === wcId)) sanitized.wheelColor = wcId;
    else errors.push(`Cor da roda inválida: ${wcId}`);
  }

  if (input.exhaust !== undefined) {
    const exId = String(input.exhaust || '').trim();
    if (EXHAUST_STYLES.some((e) => e.id === exId)) sanitized.exhaust = exId;
    else errors.push(`Escapamento inválido: ${exId}`);
  }

  if (input.wheels !== undefined) {
    const wId = String(input.wheels || '').trim();
    if (WHEELS.some((w) => w.id === wId)) sanitized.wheels = wId;
    else errors.push(`Modelo de roda inválido: ${wId}`);
  }

  if (input.spoiler !== undefined) {
    const sId = String(input.spoiler || '').trim();
    if (SPOILERS.some((s) => s.id === sId)) sanitized.spoiler = sId;
    else errors.push(`Spoiler inválido: ${sId}`);
  }

  if (input.suspension !== undefined) {
    const susId = String(input.suspension || '').trim();
    if (SUSPENSIONS.some((s) => s.id === susId)) sanitized.suspension = susId;
    else errors.push(`Suspensão inválida: ${susId}`);
  }

  if (input.neon !== undefined) {
    const nId = String(input.neon || '').trim();
    if (NEON_UNDERGLOW.some((n) => n.id === nId)) sanitized.neon = nId;
    else errors.push(`Neon inválido: ${nId}`);
  }

  if (input.decal !== undefined) {
    const dId = String(input.decal || '').trim();
    if (DECALS.some((d) => d.id === dId)) sanitized.decal = dId;
    else errors.push(`Decalque inválido: ${dId}`);
  }

  if (input.windowTint !== undefined) {
    const tId = String(input.windowTint || '').trim();
    if (WINDOW_TINTS.some((t) => t.id === tId)) sanitized.windowTint = tId;
    else errors.push(`Insulfilm inválido: ${tId}`);
  }

  if (input.plateText !== undefined) {
    const cleanPlate = String(input.plateText || '')
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '')
      .slice(0, 8);
    sanitized.plateText = cleanPlate;
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, sanitized };
}

/**
 * Calcula orçamento de customização entre o estado atual e o desejado.
 * @param {object} current
 * @param {object} desired
 * @returns {{ total: number, items: Array<{ category: string, id: string, name: string, cost: number }> }}
 */
export function calculateCarCustomizationQuote(current = {}, desired = {}) {
  let total = 0;
  const items = [];

  function checkCategory(catKey, catList, currentVal, desiredVal, defaultVal, fallbackCost = 0) {
    if (desiredVal && desiredVal !== currentVal) {
      const match = catList.find(
        (item) => item.id === desiredVal || (item.hex && item.hex.toLowerCase() === String(desiredVal).toLowerCase())
      );
      const cost = match?.cost || (desiredVal === defaultVal ? 0 : fallbackCost);
      if (cost > 0) {
        items.push({
          category: catKey,
          id: desiredVal,
          name: match?.name || desiredVal,
          cost,
        });
        total += cost;
      }
    }
  }

  if (desired.color && desired.color.toLowerCase() !== (current.color || '').toLowerCase()) {
    const match = PAINT_COLORS.find((c) => c.hex.toLowerCase() === desired.color.toLowerCase());
    const cost = match?.cost || (desired.color === DEFAULT_CAR_CONFIG.color ? 0 : 75);
    if (cost > 0) {
      items.push({ category: 'color', id: desired.color, name: match?.name || `Pintura (${desired.color})`, cost });
      total += cost;
    }
  }

  if (desired.secondaryColor && desired.secondaryColor.toLowerCase() !== (current.secondaryColor || '').toLowerCase()) {
    const match = SECONDARY_COLORS.find((c) => c.hex.toLowerCase() === desired.secondaryColor.toLowerCase());
    const cost = match?.cost || (desired.secondaryColor === DEFAULT_CAR_CONFIG.secondaryColor ? 0 : 40);
    if (cost > 0) {
      items.push({ category: 'secondaryColor', id: desired.secondaryColor, name: match?.name || `Detalhes (${desired.secondaryColor})`, cost });
      total += cost;
    }
  }

  checkCategory('finish', PAINT_FINISHES, current.finish, desired.finish, 'glossy');
  checkCategory('bodykit', BODYKITS, current.bodykit, desired.bodykit, 'stock');
  checkCategory('headlight', HEADLIGHT_TINTS, current.headlight, desired.headlight, 'xenon');
  checkCategory('interior', INTERIORS, current.interior, desired.interior, 'black_leather');
  checkCategory('rollCage', ROLL_CAGES, current.rollCage, desired.rollCage, 'none');
  checkCategory('camber', WHEEL_CAMBERS, current.camber, desired.camber, 'neutral');
  checkCategory('caliperColor', BRAKE_CALIPER_COLORS, current.caliperColor, desired.caliperColor, 'red');
  checkCategory('wheelColor', WHEEL_COLORS, current.wheelColor, desired.wheelColor, 'chrome');
  checkCategory('exhaust', EXHAUST_STYLES, current.exhaust, desired.exhaust, 'quad_chrome');
  checkCategory('wheels', WHEELS, current.wheels, desired.wheels, 'sport');
  checkCategory('spoiler', SPOILERS, current.spoiler, desired.spoiler, 'none');
  checkCategory('suspension', SUSPENSIONS, current.suspension, desired.suspension, 'normal');
  checkCategory('neon', NEON_UNDERGLOW, current.neon, desired.neon, 'none');
  checkCategory('decal', DECALS, current.decal, desired.decal, 'none');
  checkCategory('windowTint', WINDOW_TINTS, current.windowTint, desired.windowTint, 'light');

  return { total, items };
}
