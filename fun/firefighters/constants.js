/**
 * Constantes e parâmetros físicos/táticos do jogo de Bombeiros (TooManyBots Fun).
 */

export const DURATION_LIMITS = Object.freeze({
  MIN_MS: 60_000,       // 1 minuto
  MAX_MS: 300_000,      // 5 minutos
  DEFAULT_MS: 90_000,   // 1m30s padrão de teste de emprego
});

export const FIRE_CLASSES = Object.freeze({
  A: 'A', // Sólidos combustíveis (madeira, papel, tecido, residencial)
  B: 'B', // Líquidos inflamáveis / químicos (combustível, solventes) - exige espuma
  C: 'C', // Equipamentos elétricos energizados (subestação, fiação) - exige neblina/corte
});

export const NOZZLE_MODES = Object.freeze({
  WATER_JET: 'WATER_JET', // Jato compacto de água pressurizada
  MIST: 'MIST',           // Neblina / neblina atomizada de resfriamento
  FOAM: 'FOAM',           // Espuma mecânica retardante (AFFF)
});

export const NOZZLE_SPECS = Object.freeze({
  [NOZZLE_MODES.WATER_JET]: {
    id: NOZZLE_MODES.WATER_JET,
    label: 'Jato d\'Água',
    emoji: '💧',
    waterPerSec: 22,
    foamPerSec: 0,
    effectiveness: {
      [FIRE_CLASSES.A]: 1.0,
      [FIRE_CLASSES.B]: -0.5, // Espalha líquido inflamável!
      [FIRE_CLASSES.C]: -0.7, // Conduz alta tensão e provoca curto-circuito!
    },
    coolingPerSec: 40, // °C resfriados por segundo
  },
  [NOZZLE_MODES.MIST]: {
    id: NOZZLE_MODES.MIST,
    label: 'Neblina Resfriante',
    emoji: '🌫️',
    waterPerSec: 12,
    foamPerSec: 0,
    effectiveness: {
      [FIRE_CLASSES.A]: 0.6,
      [FIRE_CLASSES.B]: 0.1,
      [FIRE_CLASSES.C]: 1.0, // Seguro para equipamentos elétricos
    },
    coolingPerSec: 80, // Excelente para dissipar calor e evitar flashover
  },
  [NOZZLE_MODES.FOAM]: {
    id: NOZZLE_MODES.FOAM,
    label: 'Espuma Química (AFFF)',
    emoji: '🧼',
    waterPerSec: 10,
    foamPerSec: 8,
    effectiveness: {
      [FIRE_CLASSES.A]: 0.7,
      [FIRE_CLASSES.B]: 1.3, // Sufoca vapores inflamáveis de imediato
      [FIRE_CLASSES.C]: -0.3, // Condutivo por resíduo aquoso
    },
    coolingPerSec: 30,
  },
});

export const TANK_SPECS = Object.freeze({
  WATER_MAX_LITERS: 1000,
  FOAM_MAX_LITERS: 300,
  HYDRANT_FLOW_LPS: 45, // Litros por segundo de recarga via hidrante de rua
  PUMP_MAX_PRESSURE_BAR: 12,
});

export const BUILDING_TEMPLATES = Object.freeze([
  {
    id: 'bldg_res_1',
    name: 'Edifício Residencial Alvorada',
    type: 'residential',
    fireClass: FIRE_CLASSES.A,
    maxIntegrity: 100,
    maxHeat: 100,
    victimsTotal: 2,
    baseFlameLevel: 30,
  },
  {
    id: 'bldg_res_2',
    name: 'Sobrado Familiar da Esquina',
    type: 'residential',
    fireClass: FIRE_CLASSES.A,
    maxIntegrity: 100,
    maxHeat: 100,
    victimsTotal: 1,
    baseFlameLevel: 25,
  },
  {
    id: 'bldg_chem_1',
    name: 'Depósito de Tintas e Solventes',
    type: 'chemical_depot',
    fireClass: FIRE_CLASSES.B,
    maxIntegrity: 120,
    maxHeat: 120,
    victimsTotal: 1,
    baseFlameLevel: 45,
  },
  {
    id: 'bldg_elec_1',
    name: 'Subestação Elétrica Norte',
    type: 'substation',
    fireClass: FIRE_CLASSES.C,
    maxIntegrity: 90,
    maxHeat: 100,
    victimsTotal: 1,
    baseFlameLevel: 35,
  },
  {
    id: 'bldg_com_1',
    name: 'Centro Comercial Galeria Central',
    type: 'commercial',
    fireClass: FIRE_CLASSES.A,
    maxIntegrity: 110,
    maxHeat: 110,
    victimsTotal: 2,
    baseFlameLevel: 30,
  },
  {
    id: 'bldg_res_3',
    name: 'Edifício Solar dos Pinheiros',
    type: 'residential',
    fireClass: FIRE_CLASSES.A,
    maxIntegrity: 100,
    maxHeat: 100,
    victimsTotal: 1,
    baseFlameLevel: 20,
  },
]);

export const RESCUE_SPECS = Object.freeze({
  LADDER_RESCUE_SECONDS: 4.5, // Tempo contínuo de escada estendida para salvar 1 vítima
  DAMAGE_PER_SECOND_TRAPPED: 4.0, // Dano de fumaça na vítima por segundo em foco ativo
});

export const DIFFICULTY_PHASES = Object.freeze({
  1: {
    id: 1,
    name: 'Alerta Inicial',
    label: 'Fase 1: Reconhecimento e Contenção',
    windSpeedKmh: 10,
    spreadIntervalSec: 25,
    sparkChance: 0.05,
  },
  2: {
    id: 2,
    name: 'Alarme Geral',
    label: 'Fase 2: Propagação e Ignições Secundárias',
    windSpeedKmh: 28,
    spreadIntervalSec: 15,
    sparkChance: 0.15,
  },
  3: {
    id: 3,
    name: 'Ponto Crítico',
    label: 'Fase 3: Flashover e Sobrevivência',
    windSpeedKmh: 45,
    spreadIntervalSec: 9,
    sparkChance: 0.30,
  },
});

export const RANKS = Object.freeze([
  { minScore: 90, title: 'Comandante Geral', emoji: '🎖️' },
  { minScore: 70, title: 'Capitão Bombeiro', emoji: '🚒' },
  { minScore: 50, title: 'Primeiro Sargento', emoji: '👨‍🚒' },
  { minScore: 35, title: 'Cabo Socorrista', emoji: '🧯' },
  { minScore: 20, title: 'Soldado de 1ª Classe', emoji: '🧤' },
  { minScore: 0,  title: 'Recruta Aprendiz', emoji: '🪓' },
]);
