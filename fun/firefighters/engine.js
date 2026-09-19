/**
 * Motor físico e tático do simulador de combate a incêndio (TooManyBots Fun).
 * Desacoplado de DOM/UI, totalmente determinístico e testável.
 */

import {
  BUILDING_TEMPLATES,
  FIRE_CLASSES,
  NOZZLE_MODES,
  NOZZLE_SPECS,
  RESCUE_SPECS,
  TANK_SPECS,
} from './constants.js';
import { getProgressionState, normalizeDurationMs } from './progression.js';

export class FirefighterEngine {
  /**
   * @param {object} [options]
   * @param {number} [options.durationMs] Duração total da partida em milissegundos
   * @param {Function} [options.randomFn] Gerador determinístico de números aleatórios (para testes)
   */
  constructor(options = {}) {
    this.durationMs = normalizeDurationMs(options.durationMs);
    this.random = typeof options.randomFn === 'function' ? options.randomFn : Math.random;

    this.elapsedMs = 0;
    this.isFinished = false;

    // Recursos do caminhão de bombeiros
    this.waterLiters = TANK_SPECS.WATER_MAX_LITERS;
    this.foamLiters = TANK_SPECS.FOAM_MAX_LITERS;
    this.activeNozzle = NOZZLE_MODES.WATER_JET;
    this.isHydrantConnected = false;
    this.isLadderExtended = false;

    // Ações do jogador
    this.targetBuildingId = null;
    this.isSpraying = false;
    this.ladderProgressSec = 0;

    // Métricas cumulativas
    this.firesExtinguished = 0;
    this.victimsSaved = 0;
    this.victimsLost = 0;
    this.buildingsCollapsed = 0;
    this.waterUsedLiters = 0;
    this.foamUsedLiters = 0;
    this.currentCombo = 0;
    this.maxCombo = 0;

    // Inicialização dos edifícios do quarteirão
    this.buildings = this._initBuildings();
    this.targetBuildingId = this.buildings[0]?.id || null;
  }

  /**
   * Clona e inicializa a lista de edifícios do quarteirão.
   * @private
   */
  _initBuildings() {
    return BUILDING_TEMPLATES.map((tmpl) => ({
      id: tmpl.id,
      name: tmpl.name,
      type: tmpl.type,
      fireClass: tmpl.fireClass,
      integrity: tmpl.maxIntegrity,
      maxIntegrity: tmpl.maxIntegrity,
      heat: tmpl.baseFlameLevel,
      maxHeat: tmpl.maxHeat,
      flameLevel: tmpl.baseFlameLevel, // 0 a 100
      maxFlameLevel: 100,
      victimsTotal: tmpl.victimsTotal,
      victimsSaved: 0,
      victimsTrapped: tmpl.victimsTotal,
      victimsHealth: 100,
      isCollapsed: false,
      wasExtinguishedOnce: false,
    }));
  }

  /**
   * Altera o modo do esguicho do caminhão.
   * @param {string} nozzleMode
   */
  selectNozzle(nozzleMode) {
    if (NOZZLE_SPECS[nozzleMode]) {
      this.activeNozzle = nozzleMode;
      return true;
    }
    return false;
  }

  /**
   * Mira no edifício especificado.
   * @param {string} buildingId
   */
  targetBuilding(buildingId) {
    const found = this.buildings.find((b) => b.id === buildingId);
    if (found) {
      this.targetBuildingId = buildingId;
      this.ladderProgressSec = 0; // Reinicia avanço da escada ao mudar de foco
      return true;
    }
    return false;
  }

  /**
   * Inicia o disparo do esguicho.
   */
  startSpraying() {
    this.isSpraying = true;
  }

  /**
   * Interrompe o disparo do esguicho.
   */
  stopSpraying() {
    this.isSpraying = false;
  }

  /**
   * Conecta ou desconecta o caminhão do hidrante de rua.
   * @param {boolean} [connected]
   */
  toggleHydrant(connected) {
    if (typeof connected === 'boolean') {
      this.isHydrantConnected = connected;
    } else {
      this.isHydrantConnected = !this.isHydrantConnected;
    }
    return this.isHydrantConnected;
  }

  /**
   * Estende ou retrai a escada Magirus telescópica.
   * @param {boolean} [extended]
   */
  setLadder(extended) {
    this.isLadderExtended = Boolean(extended);
    if (!this.isLadderExtended) {
      this.ladderProgressSec = 0;
    }
    return this.isLadderExtended;
  }

  /**
   * Retorna o edifício atualmente selecionado como alvo.
   * @returns {object|null}
   */
  getTargetBuilding() {
    return this.buildings.find((b) => b.id === this.targetBuildingId) || null;
  }

  /**
   * Avança a simulação física em `dtSec` segundos, utilizando sub-stepping para estabilidade.
   * @param {number} dtSec Delta de tempo em segundos
   */
  update(dtSec) {
    if (this.isFinished) return;

    let remaining = Math.max(0, Number(dtSec) || 0);
    if (remaining <= 0) return;

    const maxStep = 0.25;
    while (remaining > 0 && !this.isFinished) {
      const dt = Math.min(maxStep, remaining);
      this._step(dt);
      remaining -= dt;
    }
  }

  /**
   * Executa um único passo discreto da simulação física.
   * @private
   */
  _step(dt) {
    if (this.isFinished || dt <= 0) return;

    this.elapsedMs += dt * 1000;
    if (this.elapsedMs >= this.durationMs) {
      this.elapsedMs = this.durationMs;
      this.isFinished = true;
    }

    const { phaseId } = getProgressionState(this.elapsedMs, this.durationMs);

    // 1. Recarga de água via hidrante de rua
    if (this.isHydrantConnected) {
      const refill = TANK_SPECS.HYDRANT_FLOW_LPS * dt;
      this.waterLiters = Math.min(TANK_SPECS.WATER_MAX_LITERS, this.waterLiters + refill);
    }

    // 2. Ação do Esguicho Tático
    this._processSpraying(dt);

    // 3. Ação de Resgate com Escada
    this._processRescue(dt);

    // 4. Termodinâmica e propagação de chamas nos edifícios
    this._processBuildingsThermodynamics(dt, phaseId);

    // 5. Verifica se todos os edifícios colapsaram
    const allCollapsed = this.buildings.every((b) => b.isCollapsed);
    if (allCollapsed) {
      this.isFinished = true;
    }
  }

  /**
   * Processa o jato de combate a incêndio ativo.
   * @private
   */
  _processSpraying(dt) {
    if (!this.isSpraying) return;

    const bldg = this.getTargetBuilding();
    if (!bldg || bldg.isCollapsed || bldg.flameLevel <= 0) {
      return;
    }

    const spec = NOZZLE_SPECS[this.activeNozzle] || NOZZLE_SPECS[NOZZLE_MODES.WATER_JET];
    const neededWater = spec.waterPerSec * dt;
    const neededFoam = spec.foamPerSec * dt;

    // Se faltar água ou espuma, o jato não tem pressão suficiente
    if (this.waterLiters < neededWater || (neededFoam > 0 && this.foamLiters < neededFoam)) {
      return;
    }

    // Consome recursos
    this.waterLiters = Math.max(0, this.waterLiters - neededWater);
    this.waterUsedLiters += neededWater;

    if (neededFoam > 0) {
      this.foamLiters = Math.max(0, this.foamLiters - neededFoam);
      this.foamUsedLiters += neededFoam;
    }

    // Eficácia tática baseada na classe do fogo
    const effectiveness = spec.effectiveness[bldg.fireClass] ?? 0.5;

    if (effectiveness > 0) {
      // Combate bem-sucedido
      const flameReduction = 20 * effectiveness * dt;
      bldg.flameLevel = Math.max(0, bldg.flameLevel - flameReduction);
      bldg.heat = Math.max(0, bldg.heat - spec.coolingPerSec * dt);

      // Foco completamente debelado
      if (bldg.flameLevel === 0) {
        this.firesExtinguished++;
        this.currentCombo++;
        if (this.currentCombo > this.maxCombo) {
          this.maxCombo = this.currentCombo;
        }
        bldg.wasExtinguishedOnce = true;
      }
    } else {
      // PENALIDADE POR ERRO TÁTICO:
      // Ex: Água em Classe B espalha combustível; água em Classe C conduz alta tensão
      const penaltyFactor = Math.abs(effectiveness);
      bldg.flameLevel = Math.min(100, bldg.flameLevel + 15 * penaltyFactor * dt);
      bldg.heat = Math.min(100, bldg.heat + 20 * penaltyFactor * dt);
      bldg.integrity = Math.max(0, bldg.integrity - 10 * penaltyFactor * dt);
      this.currentCombo = 0; // Quebra o combo por manobra incorreta
    }
  }

  /**
   * Processa o resgate de civis com a escada telescópica.
   * @private
   */
  _processRescue(dt) {
    if (!this.isLadderExtended) {
      this.ladderProgressSec = 0;
      return;
    }

    const bldg = this.getTargetBuilding();
    if (!bldg || bldg.isCollapsed || bldg.victimsTrapped <= 0) {
      this.ladderProgressSec = 0;
      return;
    }

    this.ladderProgressSec += dt;
    if (this.ladderProgressSec >= RESCUE_SPECS.LADDER_RESCUE_SECONDS) {
      this.ladderProgressSec = 0;
      bldg.victimsTrapped--;
      bldg.victimsSaved++;
      this.victimsSaved++;
      this.currentCombo++;
      if (this.currentCombo > this.maxCombo) {
        this.maxCombo = this.currentCombo;
      }
    }
  }

  /**
   * Processa a degradação estrutural e propagação de calor.
   * @private
   */
  _processBuildingsThermodynamics(dt, phaseId) {
    for (const bldg of this.buildings) {
      if (bldg.isCollapsed) continue;

      if (bldg.flameLevel > 0) {
        // Aumenta o calor
        bldg.heat = Math.min(bldg.maxHeat, bldg.heat + 4.0 * dt);

        // Danifica integridade estrutural
        const damageRate = (bldg.flameLevel / 100) * 3.5 * dt;
        bldg.integrity = Math.max(0, bldg.integrity - damageRate);

        // Danifica vítimas presas pela fumaça
        if (bldg.victimsTrapped > 0) {
          bldg.victimsHealth = Math.max(
            0,
            bldg.victimsHealth - RESCUE_SPECS.DAMAGE_PER_SECOND_TRAPPED * dt
          );

          if (bldg.victimsHealth <= 0) {
            this.victimsLost += bldg.victimsTrapped;
            bldg.victimsTrapped = 0;
          }
        }

        // Colapso da estrutura
        if (bldg.integrity <= 0) {
          bldg.isCollapsed = true;
          bldg.flameLevel = 0;
          this.buildingsCollapsed++;

          // Vítimas restantes perecem no colapso
          if (bldg.victimsTrapped > 0) {
            this.victimsLost += bldg.victimsTrapped;
            bldg.victimsTrapped = 0;
          }
        }
      } else {
        // Fogo debelado: resfriamento natural lento
        bldg.heat = Math.max(0, bldg.heat - 5.0 * dt);
      }
    }

    // Ignição secundária esporádica em fases avançadas (2 e 3)
    if (phaseId >= 2 && this.random() < 0.04 * dt) {
      const intactBuildings = this.buildings.filter(
        (b) => !b.isCollapsed && b.flameLevel === 0 && b.heat > 30
      );
      if (intactBuildings.length > 0) {
        const target = intactBuildings[Math.floor(this.random() * intactBuildings.length)];
        target.flameLevel = 25;
      }
    }
  }

  /**
   * Retorna o snapshot completo das métricas para finalização e auditoria.
   * @returns {object}
   */
  getMetrics() {
    const buildingsSaved = this.buildings.filter(
      (b) => !b.isCollapsed && b.flameLevel === 0
    ).length;

    return {
      firesExtinguished: this.firesExtinguished,
      victimsSaved: this.victimsSaved,
      victimsLost: this.victimsLost,
      buildingsSaved,
      buildingsCollapsed: this.buildingsCollapsed,
      lostHouses: this.buildingsCollapsed, // Invariante estrito para compatibilidade
      waterUsedLiters: Math.round(this.waterUsedLiters),
      foamUsedLiters: Math.round(this.foamUsedLiters),
      maxCombo: this.maxCombo,
      timeElapsedSec: Math.round(this.elapsedMs / 1000),
      isFinished: this.isFinished,
    };
  }
}
