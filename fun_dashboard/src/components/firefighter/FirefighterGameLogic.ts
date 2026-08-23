/**
 * FirefighterGameLogic — Engine de Simulação Tática de Incêndio, Resgate e Termodinâmica
 * 
 * Modela física realista de combate a incêndio:
 * 1. Termodinâmica de Edifícios: Temperatura (20°C - 1200°C), Combustível, Fogo (0 a 4), Fumaça, Integridade Estrutural.
 * 2. Classes de Incêndio:
 *    - Classe A: Madeira/Sólidos (Residencial/Comercial) - Água Resfria e Apaga.
 *    - Classe B: Líquidos Inflamáveis / Químicos (Depósitos) - Espuma Química sufoca e sela. Água espalha fogo químico!
 *    - Classe C: Equipamentos Elétricos / Painéis - Jato direto causa choque/curto-circuito, Neblina/Espuma são seguras.
 * 3. Fenômenos Térmicos Dinâmicos:
 *    - Flashover: Ignição explosiva simultânea quando cômodo atinge >600°C.
 *    - Backdraft: Entrada de oxigênio em ambiente superaquecido com gases não queimados.
 *    - Propagação por Radiação Térmica e Convecção com Vento Dinâmico.
 * 4. Veículo & Equipamentos de Bombeiro:
 *    - Tanque de água (0 - 1000L) + Conexão com Hidrantes de rua com fluxo contínuo.
 *    - Modos de Esguicho:
 *      * 'direct' (Jato Compacto de Alta Pressão) - Extingue rápido Classe A, alcance longo.
 *      * 'mist' (Neblina de Resfriamento / Fog Stream) - Resfria temperatura ambiente em área ampla, dissipa fumaça.
 *      * 'foam' (Espuma Retardante AFFF) - Cria camada isolante (foamCoating), essencial para Classe B.
 * 5. Sistema de Resgate de Vítimas:
 *    - Civis e animais presos em andares superiores.
 *    - Implantação da Escada Magirus telescópica com tempo de resgate e cálculo de risco de colapso.
 * 6. Sistema de Colapso e Escombros: Perda de integridade causa desabamento, gerando cinzas e faíscas.
 * 7. Pontuação Tática e Métricas de Desempenho para `/api/fun/job/finish`.
 */

export type NozzleMode = "direct" | "mist" | "foam";
export type FireClass = "classA" | "classB" | "classC";
export type BuildingType = "residential" | "twoStoryHouse" | "commercial3F" | "chemicalDepot" | "substation";
export type CameraMode = "iso" | "first" | "drone";

export interface Victim {
  id: string;
  name: string;
  floor: number;
  rescued: boolean;
  perished: boolean;
  health: number; // 0 a 100
  rescueProgress: number; // 0 a 100 (quando a escada está engajada)
}

export interface BuildingState {
  id: string;
  name: string;
  type: BuildingType;
  fireClass: FireClass;
  gridX: number;
  gridZ: number;
  worldPos: [number, number, number]; // [x, y, z]
  floors: number;
  
  // Termodinâmica & Fogo
  temperature: number; // 20°C a 1200°C
  heat: number; // 0 = seguro, 1 = brasa/fumaça, 2 = labaredas, 3 = incêndio violento, 4 = flashover iminente, -1 = colapsado/cinzas
  fuel: number; // 0 a 100
  oxygen: number; // 0 a 100
  foamCoating: number; // 0 a 100 (selagem química)
  smokeDensity: number; // 0 a 100
  
  // Integridade Estrutural
  integrity: number; // 0 a 100 (0 = desabamento)
  collapsed: boolean;
  
  // Vítimas e Resgate
  victims: Victim[];
  
  // Efeitos visuais e feedback
  waterHitTimer: number; // tempo recente de impacto de água
  foamHitTimer: number;
  steamBurstTimer: number;
  flashoverWarning: boolean;
}

export interface Hydrant {
  id: string;
  gridX: number;
  gridZ: number;
  worldPos: [number, number, number];
  connected: boolean;
  waterFlowRate: number; // L/s recarga
}

export interface FireTruckState {
  worldPos: [number, number, number];
  waterTank: number; // 0 a 1000 Litros
  maxWaterTank: number; // 1000 Litros
  waterPressureBar: number; // 0 a 15 Bar
  connectedHydrantId: string | null;
  
  // Escada Magirus
  ladderTargetBuildingId: string | null;
  ladderExtension: number; // 0 a 1 (estendendo)
  ladderTargetFloor: number;
  ladderOperating: boolean;
}

export interface WindState {
  speed: number; // m/s
  directionAngle: number; // radianos (0 = Norte +Z, PI/2 = Leste +X, etc.)
  vector: [number, number]; // [dirX, dirZ] normalizado
}

export interface GameStats {
  score: number;
  combo: number;
  maxCombo: number;
  firesExtinguished: number;
  victimsSaved: number;
  victimsLost: number;
  buildingsSaved: number;
  buildingsCollapsed: number;
  waterUsedLiters: number;
  foamUsedLiters: number;
  responseEfficiency: number; // 0 a 100%
  totalDamagePrevented: number;
}

export type GameEventCallback = (
  eventName:
    | "water_start"
    | "water_stop"
    | "foam_start"
    | "foam_stop"
    | "fire_extinguished"
    | "steam_hiss"
    | "victim_rescued"
    | "victim_lost"
    | "structure_collapse"
    | "flashover_alarm"
    | "low_water_warning"
    | "hydrant_connected"
    | "hydrant_disconnected"
    | "radio_chatter"
    | "combo_up",
  data?: unknown
) => void;

export interface FirefighterConfig {
  durationMs?: number;
  targetScore?: number;
  maxLostHouses?: number;
  difficulty?: "easy" | "medium" | "hard" | "inferno";
}

/**
 * Cria a grade urbana inicial com edifícios variados e quarteirão 3D
 */
export function createDefaultCityGrid(): BuildingState[] {
  const buildings: BuildingState[] = [
    {
      id: "bldg_res_1",
      name: "Residência Família Silva",
      type: "residential",
      fireClass: "classA",
      gridX: 0,
      gridZ: 0,
      worldPos: [-3.5, 0, -3.5],
      floors: 1,
      temperature: 24,
      heat: 0,
      fuel: 100,
      oxygen: 100,
      foamCoating: 0,
      smokeDensity: 0,
      integrity: 100,
      collapsed: false,
      victims: [
        { id: "v1", name: "Dona Maria", floor: 1, rescued: false, perished: false, health: 100, rescueProgress: 0 }
      ],
      waterHitTimer: 0,
      foamHitTimer: 0,
      steamBurstTimer: 0,
      flashoverWarning: false
    },
    {
      id: "bldg_house_2",
      name: "Sobrado dos Carvalho",
      type: "twoStoryHouse",
      fireClass: "classA",
      gridX: 1,
      gridZ: 0,
      worldPos: [3.5, 0, -3.5],
      floors: 2,
      temperature: 180,
      heat: 2, // Começa pegando fogo
      fuel: 95,
      oxygen: 90,
      foamCoating: 0,
      smokeDensity: 35,
      integrity: 95,
      collapsed: false,
      victims: [
        { id: "v2", name: "Lucas & Gatinho", floor: 2, rescued: false, perished: false, health: 90, rescueProgress: 0 }
      ],
      waterHitTimer: 0,
      foamHitTimer: 0,
      steamBurstTimer: 0,
      flashoverWarning: false
    },
    {
      id: "bldg_comm_3",
      name: "Edifício Comercial Aurora",
      type: "commercial3F",
      fireClass: "classA",
      gridX: 0,
      gridZ: 1,
      worldPos: [-3.5, 0, 3.5],
      floors: 3,
      temperature: 320,
      heat: 3, // Começa em chamas severas
      fuel: 90,
      oxygen: 85,
      foamCoating: 0,
      smokeDensity: 60,
      integrity: 90,
      collapsed: false,
      victims: [
        { id: "v3", name: "Funcionários Escritório (3º Andar)", floor: 3, rescued: false, perished: false, health: 85, rescueProgress: 0 },
        { id: "v4", name: "Zelador Roberto (2º Andar)", floor: 2, rescued: false, perished: false, health: 95, rescueProgress: 0 }
      ],
      waterHitTimer: 0,
      foamHitTimer: 0,
      steamBurstTimer: 0,
      flashoverWarning: false
    },
    {
      id: "bldg_chem_4",
      name: "Depósito Químico & Tintas Delta",
      type: "chemicalDepot",
      fireClass: "classB", // FOGO QUÍMICO (PRECISA DE ESPUMA!)
      gridX: 1,
      gridZ: 1,
      worldPos: [3.5, 0, 3.5],
      floors: 1,
      temperature: 45,
      heat: 0,
      fuel: 100,
      oxygen: 100,
      foamCoating: 0,
      smokeDensity: 0,
      integrity: 100,
      collapsed: false,
      victims: [
        { id: "v5", name: "Operador de Empilhadeira", floor: 1, rescued: false, perished: false, health: 100, rescueProgress: 0 }
      ],
      waterHitTimer: 0,
      foamHitTimer: 0,
      steamBurstTimer: 0,
      flashoverWarning: false
    },
    {
      id: "bldg_sub_5",
      name: "Subestação de Distribuição de Energia",
      type: "substation",
      fireClass: "classC", // FOGO ELÉTRICO (NÃO USAR JATO DIRETO DE ÁGUA!)
      gridX: 2,
      gridZ: 0,
      worldPos: [8.5, 0, -3.5],
      floors: 1,
      temperature: 25,
      heat: 0,
      fuel: 100,
      oxygen: 100,
      foamCoating: 0,
      smokeDensity: 0,
      integrity: 100,
      collapsed: false,
      victims: [],
      waterHitTimer: 0,
      foamHitTimer: 0,
      steamBurstTimer: 0,
      flashoverWarning: false
    },
    {
      id: "bldg_res_6",
      name: "Residência Jardins",
      type: "residential",
      fireClass: "classA",
      gridX: 2,
      gridZ: 1,
      worldPos: [8.5, 0, 3.5],
      floors: 1,
      temperature: 22,
      heat: 0,
      fuel: 100,
      oxygen: 100,
      foamCoating: 0,
      smokeDensity: 0,
      integrity: 100,
      collapsed: false,
      victims: [
        { id: "v6", name: "Vovô Walter", floor: 1, rescued: false, perished: false, health: 100, rescueProgress: 0 }
      ],
      waterHitTimer: 0,
      foamHitTimer: 0,
      steamBurstTimer: 0,
      flashoverWarning: false
    }
  ];

  return buildings;
}

export function createDefaultHydrants(): Hydrant[] {
  return [
    {
      id: "hydrant_north",
      gridX: 0,
      gridZ: -1,
      worldPos: [0, 0, -4.5],
      connected: false,
      waterFlowRate: 40 // 40 L/s recarga
    },
    {
      id: "hydrant_center",
      gridX: 1,
      gridZ: 0,
      worldPos: [0, 0, 0],
      connected: false,
      waterFlowRate: 50 // 50 L/s recarga rápida
    },
    {
      id: "hydrant_south",
      gridX: 0,
      gridZ: 1,
      worldPos: [0, 0, 4.5],
      connected: false,
      waterFlowRate: 40
    }
  ];
}

export class FirefighterSimulation {
  public buildings: BuildingState[];
  public hydrants: Hydrant[];
  public truck: FireTruckState;
  public wind: WindState;
  public stats: GameStats;
  
  // Config & Controle
  public activeNozzle: NozzleMode = "direct";
  public isDischarging = false;
  public targetBuildingId: string | null = null;
  public targetPos: [number, number, number] = [0, 0, 0];
  public thermalVision = false;
  public cameraMode: CameraMode = "iso";
  
  public durationMs: number;
  public targetScore: number;
  public maxLostHouses: number;
  public timeElapsedSec = 0;
  public isGameOver = false;
  public isVictory = false;

  private onEvent?: GameEventCallback;
  private lastLowWaterAlert = 0;
  private lastRadioChatter = 0;

  constructor(config?: FirefighterConfig, onEvent?: GameEventCallback) {
    this.durationMs = config?.durationMs ?? 90_000;
    this.targetScore = config?.targetScore ?? 2500;
    this.maxLostHouses = config?.maxLostHouses ?? 2;
    this.onEvent = onEvent;

    this.buildings = createDefaultCityGrid();
    this.hydrants = createDefaultHydrants();

    this.truck = {
      worldPos: [0, 0, -7.5],
      waterTank: 750, // 750L inicial
      maxWaterTank: 1000,
      waterPressureBar: 10,
      connectedHydrantId: null,
      ladderTargetBuildingId: null,
      ladderExtension: 0,
      ladderTargetFloor: 1,
      ladderOperating: false
    };

    this.wind = {
      speed: 2.5,
      directionAngle: Math.PI / 4, // Nordeste
      vector: [Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)]
    };

    this.stats = {
      score: 0,
      combo: 0,
      maxCombo: 0,
      firesExtinguished: 0,
      victimsSaved: 0,
      victimsLost: 0,
      buildingsSaved: 0,
      buildingsCollapsed: 0,
      waterUsedLiters: 0,
      foamUsedLiters: 0,
      responseEfficiency: 100,
      totalDamagePrevented: 0
    };
  }

  public setEventCallback(cb: GameEventCallback) {
    this.onEvent = cb;
  }

  public setNozzleMode(mode: NozzleMode) {
    this.activeNozzle = mode;
  }

  public setThermalVision(enabled: boolean) {
    this.thermalVision = enabled;
  }

  public setCameraMode(mode: CameraMode) {
    this.cameraMode = mode;
  }

  public startDischarge() {
    if (this.truck.waterTank <= 0 && !this.truck.connectedHydrantId) {
      this.emitEvent("low_water_warning");
      return;
    }
    this.isDischarging = true;
    if (this.activeNozzle === "foam") {
      this.emitEvent("foam_start");
    } else {
      this.emitEvent("water_start");
    }
  }

  public stopDischarge() {
    if (this.isDischarging) {
      this.isDischarging = false;
      if (this.activeNozzle === "foam") {
        this.emitEvent("foam_stop");
      } else {
        this.emitEvent("water_stop");
      }
    }
  }

  public setAimTarget(worldPos: [number, number, number], buildingId?: string | null) {
    this.targetPos = worldPos;
    if (buildingId !== undefined) {
      this.targetBuildingId = buildingId;
    } else {
      // Encontra edifício mais próximo do alvo
      let closest: BuildingState | null = null;
      let minDist = 3.2; // raio de proximidade
      for (const b of this.buildings) {
        const dx = b.worldPos[0] - worldPos[0];
        const dz = b.worldPos[2] - worldPos[2];
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < minDist) {
          minDist = dist;
          closest = b;
        }
      }
      this.targetBuildingId = closest ? closest.id : null;
    }
  }

  /**
   * Conecta / Desconecta hidrante de rua mais próximo
   */
  public toggleHydrantConnection(): boolean {
    if (this.truck.connectedHydrantId) {
      const h = this.hydrants.find((x) => x.id === this.truck.connectedHydrantId);
      if (h) h.connected = false;
      this.truck.connectedHydrantId = null;
      this.emitEvent("hydrant_disconnected");
      return false;
    } else {
      // Conecta ao mais próximo
      let best: Hydrant | null = null;
      let minD = 12.0;
      for (const h of this.hydrants) {
        const dx = h.worldPos[0] - this.truck.worldPos[0];
        const dz = h.worldPos[2] - this.truck.worldPos[2];
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < minD) {
          minD = d;
          best = h;
        }
      }
      if (best) {
        best.connected = true;
        this.truck.connectedHydrantId = best.id;
        this.emitEvent("hydrant_connected", { hydrantId: best.id });
        return true;
      }
      return false;
    }
  }

  /**
   * Aciona a Escada Magirus para resgate de vítimas
   */
  public deployMagirusLadder(targetBuildingId?: string): boolean {
    const targetId = targetBuildingId || this.targetBuildingId;
    if (!targetId) return false;

    const building = this.buildings.find((b) => b.id === targetId);
    if (!building || building.collapsed) return false;

    const unrescued = building.victims.filter((v) => !v.rescued && !v.perished);
    if (unrescued.length === 0) return false;

    this.truck.ladderTargetBuildingId = targetId;
    this.truck.ladderOperating = true;
    this.truck.ladderExtension = 0;
    this.truck.ladderTargetFloor = unrescued[0].floor;
    this.emitEvent("radio_chatter", { text: `Escada Magirus se estendendo para o ${building.name}!` });
    return true;
  }

  /**
   * Ciclo de Atualização Física e Termodinâmica (delta time em segundos)
   */
  public update(dt: number) {
    if (this.isGameOver) return;

    this.timeElapsedSec += dt;
    const remainingMs = this.durationMs - this.timeElapsedSec * 1000;

    // 1. Recarga de Água pelo Hidrante
    if (this.truck.connectedHydrantId) {
      const hydrant = this.hydrants.find((h) => h.id === this.truck.connectedHydrantId);
      if (hydrant) {
        this.truck.waterTank = Math.min(
          this.truck.maxWaterTank,
          this.truck.waterTank + hydrant.waterFlowRate * dt
        );
        this.truck.waterPressureBar = 12.5; // Alta pressão contínua
      }
    } else {
      // Pressão oscila com nível do tanque
      const tankRatio = this.truck.waterTank / this.truck.maxWaterTank;
      this.truck.waterPressureBar = Math.max(2, tankRatio * 10);
    }

    // 2. Alerta de Nível Baixo de Água
    if (this.truck.waterTank < 150 && !this.truck.connectedHydrantId) {
      if (this.timeElapsedSec - this.lastLowWaterAlert > 5.0) {
        this.lastLowWaterAlert = this.timeElapsedSec;
        this.emitEvent("low_water_warning", { tank: this.truck.waterTank });
      }
    }

    // 3. Variação suave do Vento
    this.wind.directionAngle += (Math.random() - 0.5) * 0.15 * dt;
    this.wind.speed = Math.max(1.0, Math.min(6.0, this.wind.speed + (Math.random() - 0.5) * 0.4 * dt));
    this.wind.vector = [Math.sin(this.wind.directionAngle), Math.cos(this.wind.directionAngle)];

    // 4. Aplicação do Esguicho de Bombeiro (Água, Neblina ou Espuma)
    if (this.isDischarging) {
      this.applyExtinguisherDischarge(dt);
    }

    // 5. Simulação Termodinâmica em cada Edifício
    let activeFiresCount = 0;
    let totalHeat = 0;

    for (const b of this.buildings) {
      if (b.collapsed) continue;

      // Decrementa timers de efeitos
      if (b.waterHitTimer > 0) b.waterHitTimer = Math.max(0, b.waterHitTimer - dt);
      if (b.foamHitTimer > 0) b.foamHitTimer = Math.max(0, b.foamHitTimer - dt);
      if (b.steamBurstTimer > 0) b.steamBurstTimer = Math.max(0, b.steamBurstTimer - dt);

      // Decaimento natural da camada de espuma sob calor intenso
      if (b.foamCoating > 0) {
        const decayRate = b.temperature > 300 ? 5.0 : 1.5;
        b.foamCoating = Math.max(0, b.foamCoating - decayRate * dt);
      }

      // Dinâmica de Queima e Temperatura
      if (b.heat > 0) {
        activeFiresCount++;
        totalHeat += b.heat;

        // Aumenta temperatura conforme nível de fogo
        const heatGenRate = [0, 15, 35, 65, 110][b.heat] || 40;
        b.temperature = Math.min(1200, b.temperature + heatGenRate * dt);

        // Consome combustível
        const fuelBurnRate = [0, 0.4, 0.9, 1.8, 3.2][b.heat] || 1.0;
        b.fuel = Math.max(0, b.fuel - fuelBurnRate * dt);

        // Gera fumaça
        b.smokeDensity = Math.min(100, b.smokeDensity + (b.heat * 12 - b.smokeDensity * 0.1) * dt);

        // Reduz integridade da estrutura por choque térmico
        const integrityLossRate = [0, 0.1, 0.35, 0.9, 2.2][b.heat] || 0.5;
        b.integrity = Math.max(0, b.integrity - integrityLossRate * dt);

        // Flashover Alarm (>600°C e chamas fortes)
        if (b.temperature > 600 && b.heat >= 3 && !b.flashoverWarning) {
          b.flashoverWarning = true;
          b.heat = 4; // Entra em flashover
          this.emitEvent("flashover_alarm", { building: b.name });
        }

        // Se o combustível acabar, o fogo diminui
        if (b.fuel <= 0 && b.heat > 0) {
          b.heat = Math.max(0, b.heat - 1);
          b.temperature = Math.max(40, b.temperature - 30 * dt);
        }

        // Propagação por Convecção / Radiação para edifícios vizinhos
        if (b.heat >= 2 && b.temperature > 250) {
          this.propagateFireSpread(b, dt);
        }
      } else {
        // Resfriamento natural quando sem chamas
        if (b.temperature > 24) {
          const coolRate = b.foamCoating > 20 ? 25.0 : 8.0;
          b.temperature = Math.max(24, b.temperature - coolRate * dt);
        }
        if (b.smokeDensity > 0) {
          b.smokeDensity = Math.max(0, b.smokeDensity - 6.0 * dt);
        }
      }

      // 6. Dano e Perigo para Vítimas no Edifício
      for (const v of b.victims) {
        if (v.rescued || v.perished) continue;

        if (b.heat > 0 || b.temperature > 80 || b.smokeDensity > 40) {
          const dmg = (b.heat * 2.5 + (b.temperature > 200 ? 3 : 0) + (b.smokeDensity > 60 ? 2 : 0)) * dt;
          v.health = Math.max(0, v.health - dmg);

          if (v.health <= 0) {
            v.perished = true;
            this.stats.victimsLost++;
            this.stats.combo = 0; // Quebra combo
            this.emitEvent("victim_lost", { victim: v.name, building: b.name });
          }
        }
      }

      // 7. Colapso Estrutural
      if (b.integrity <= 0 && !b.collapsed) {
        b.collapsed = true;
        b.heat = -1; // Cinzas/escombros
        b.temperature = 400; // Escombros incandescentes
        this.stats.buildingsCollapsed++;
        this.stats.combo = 0;
        this.emitEvent("structure_collapse", { building: b.name });

        // Vítimas restantes perecem no colapso
        for (const v of b.victims) {
          if (!v.rescued && !v.perished) {
            v.perished = true;
            this.stats.victimsLost++;
          }
        }
      }
    }

    // 8. Simulação da Escada Magirus & Resgate de Vítimas
    this.updateMagirusRescue(dt);

    // 9. Rádio tático aleatório
    if (this.timeElapsedSec - this.lastRadioChatter > 18.0) {
      this.lastRadioChatter = this.timeElapsedSec;
      this.emitEvent("radio_chatter");
    }

    // 10. Verificação de Condições de Fim de Jogo
    if (this.stats.buildingsCollapsed >= this.maxLostHouses) {
      this.isGameOver = true;
      this.isVictory = false;
    } else if (remainingMs <= 0) {
      this.isGameOver = true;
      this.isVictory = this.stats.score >= this.targetScore && this.stats.buildingsCollapsed < this.maxLostHouses;
    } else if (activeFiresCount === 0 && this.timeElapsedSec > 10) {
      // Todos os incêndios foram debelados com sucesso!
      this.isGameOver = true;
      this.isVictory = true;
      this.stats.score += 1000; // Bônus de maestria
    }
  }

  /**
   * Aplicação do Esguicho Tático no Alvo
   */
  private applyExtinguisherDischarge(dt: number) {
    if (this.truck.waterTank <= 0 && !this.truck.connectedHydrantId) {
      this.stopDischarge();
      this.emitEvent("low_water_warning");
      return;
    }

    let waterConsumption = 0;
    let foamConsumption = 0;

    switch (this.activeNozzle) {
      case "direct":
        waterConsumption = 18 * dt; // 18 L/s Jato Compacto de Alta Pressão
        break;
      case "mist":
        waterConsumption = 10 * dt; // 10 L/s Neblina Fina
        break;
      case "foam":
        waterConsumption = 12 * dt;
        foamConsumption = 6 * dt; // Mistura de Espuma Retardante AFFF
        break;
    }

    if (!this.truck.connectedHydrantId) {
      this.truck.waterTank = Math.max(0, this.truck.waterTank - waterConsumption);
    }
    this.stats.waterUsedLiters += waterConsumption;
    this.stats.foamUsedLiters += foamConsumption;

    // Aplica efeito no edifício alvo ou área de dispersão
    const targetBuilding = this.targetBuildingId
      ? this.buildings.find((b) => b.id === this.targetBuildingId)
      : null;

    if (targetBuilding && !targetBuilding.collapsed) {
      targetBuilding.waterHitTimer = 0.5;

      // Sibilo de vapor d'água ao resfriar chamas incandescentes
      if (targetBuilding.temperature > 150) {
        targetBuilding.steamBurstTimer = 0.5;
        if (Math.random() < 0.25) this.emitEvent("steam_hiss");
      }

      // COMPORTAMENTO POR CLASSE DE INCÊNDIO:
      if (targetBuilding.fireClass === "classA") {
        // Classe A (Madeira/Residencial): Jato direto e neblina são muito eficientes
        if (this.activeNozzle === "direct") {
          targetBuilding.temperature = Math.max(20, targetBuilding.temperature - 120 * dt);
          if (targetBuilding.heat > 0 && Math.random() < 0.45 * dt * 5) {
            this.reduceBuildingHeat(targetBuilding, 1);
          }
        } else if (this.activeNozzle === "mist") {
          targetBuilding.temperature = Math.max(20, targetBuilding.temperature - 180 * dt);
          targetBuilding.smokeDensity = Math.max(0, targetBuilding.smokeDensity - 25 * dt);
          if (targetBuilding.heat > 0 && Math.random() < 0.25 * dt * 5) {
            this.reduceBuildingHeat(targetBuilding, 1);
          }
        } else if (this.activeNozzle === "foam") {
          targetBuilding.foamCoating = Math.min(100, targetBuilding.foamCoating + 30 * dt);
          targetBuilding.temperature = Math.max(20, targetBuilding.temperature - 60 * dt);
          if (targetBuilding.heat > 0 && Math.random() < 0.3 * dt * 5) {
            this.reduceBuildingHeat(targetBuilding, 1);
          }
        }
      } else if (targetBuilding.fireClass === "classB") {
        // Classe B (Líquidos Químicos/Inflamáveis):
        // EXIGE ESPUMA! Água direta espalha fogo e vaporiza combustível!
        if (this.activeNozzle === "foam") {
          targetBuilding.foamCoating = Math.min(100, targetBuilding.foamCoating + 45 * dt);
          targetBuilding.temperature = Math.max(20, targetBuilding.temperature - 90 * dt);
          if (targetBuilding.foamCoating > 40 && targetBuilding.heat > 0) {
            this.reduceBuildingHeat(targetBuilding, 1);
          }
        } else if (this.activeNozzle === "direct") {
          // Penalidade tática: água espalha chamas de combustível!
          targetBuilding.temperature += 20 * dt;
          targetBuilding.smokeDensity += 30 * dt;
        } else if (this.activeNozzle === "mist") {
          // Neblina resfria um pouco sem espalhar
          targetBuilding.temperature = Math.max(40, targetBuilding.temperature - 40 * dt);
        }
      } else if (targetBuilding.fireClass === "classC") {
        // Classe C (Subestação Elétrica):
        // JATO DIRETO DE ÁGUA CAUSA ARCO VOLTAICO / CURTO!
        if (this.activeNozzle === "direct") {
          targetBuilding.integrity = Math.max(0, targetBuilding.integrity - 10 * dt);
          targetBuilding.temperature += 30 * dt;
        } else if (this.activeNozzle === "mist" || this.activeNozzle === "foam") {
          // Neblina e espuma são seguras
          targetBuilding.temperature = Math.max(20, targetBuilding.temperature - 100 * dt);
          if (targetBuilding.heat > 0 && Math.random() < 0.35 * dt * 5) {
            this.reduceBuildingHeat(targetBuilding, 1);
          }
        }
      }
    }

    // Se estiver em modo Neblina (mist), resfria edifícios próximos também (dispersão em leque)
    if (this.activeNozzle === "mist") {
      for (const b of this.buildings) {
        if (b === targetBuilding || b.collapsed) continue;
        const dx = b.worldPos[0] - this.targetPos[0];
        const dz = b.worldPos[2] - this.targetPos[2];
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 6.5) {
          b.temperature = Math.max(20, b.temperature - 45 * dt);
          b.smokeDensity = Math.max(0, b.smokeDensity - 15 * dt);
        }
      }
    }
  }

  /**
   * Reduz intensidade do foco de fogo e pontua
   */
  private reduceBuildingHeat(building: BuildingState, amount: number) {
    const oldHeat = building.heat;
    building.heat = Math.max(0, building.heat - amount);

    if (oldHeat > 0 && building.heat === 0) {
      // Foco totalmente debelado!
      this.stats.firesExtinguished++;
      this.stats.combo++;
      if (this.stats.combo > this.stats.maxCombo) {
        this.stats.maxCombo = this.stats.combo;
      }
      
      const pts = 150 + this.stats.combo * 25;
      this.stats.score += pts;
      this.emitEvent("fire_extinguished", { building: building.name, score: pts, combo: this.stats.combo });
    }
  }

  /**
   * Propagação de chamas e convecção térmica entre quarteirões
   */
  private propagateFireSpread(source: BuildingState, dt: number) {
    for (const target of this.buildings) {
      if (target === source || target.collapsed || target.heat >= 4) continue;

      const dx = target.worldPos[0] - source.worldPos[0];
      const dz = target.worldPos[2] - source.worldPos[2];
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist > 9.0) continue; // Fora do raio de radiação

      // Alinhamento com vetor do vento
      const dirX = dx / dist;
      const dirZ = dz / dist;
      const windDot = dirX * this.wind.vector[0] + dirZ * this.wind.vector[1];
      const windMultiplier = Math.max(0.3, 1.0 + windDot * (this.wind.speed * 0.25));

      // Proteção de espuma impede que o fogo pegue
      if (target.foamCoating > 50) continue;

      // Transferência de calor
      const heatTransfer = (source.temperature / (dist * dist * 0.8)) * windMultiplier * dt;
      target.temperature += heatTransfer * 0.15;

      // Se a temperatura do alvo passar do ponto de fulgor (>220°C) e tiver oxigênio/combustível
      if (target.temperature > 220 && target.fuel > 15 && target.heat === 0) {
        if (Math.random() < 0.15 * dt * 3) {
          target.heat = 1; // Inicia ignição por convecção
          this.emitEvent("radio_chatter", { text: `Atenção: Novo foco detectado no ${target.name}!` });
        }
      }
    }
  }

  /**
   * Atualiza operação da Escada Magirus e resgate de vítimas
   */
  private updateMagirusRescue(dt: number) {
    if (!this.truck.ladderOperating || !this.truck.ladderTargetBuildingId) return;

    const building = this.buildings.find((b) => b.id === this.truck.ladderTargetBuildingId);
    if (!building || building.collapsed) {
      this.truck.ladderOperating = false;
      this.truck.ladderTargetBuildingId = null;
      return;
    }

    // Estende a escada
    if (this.truck.ladderExtension < 1.0) {
      this.truck.ladderExtension = Math.min(1.0, this.truck.ladderExtension + 0.4 * dt);
      return;
    }

    // Escada posicionada: resgata vítimas do andar
    const victim = building.victims.find(
      (v) => !v.rescued && !v.perished && v.floor === this.truck.ladderTargetFloor
    );

    if (victim) {
      victim.rescueProgress += 35 * dt; // ~3 segundos por resgate
      if (victim.rescueProgress >= 100) {
        victim.rescued = true;
        this.stats.victimsSaved++;
        this.stats.combo += 2;
        const pts = 500 + this.stats.combo * 50;
        this.stats.score += pts;
        this.emitEvent("victim_rescued", { victim: victim.name, building: building.name, score: pts });

        // Verifica se há mais vítimas no mesmo prédio
        const nextVictim = building.victims.find((v) => !v.rescued && !v.perished);
        if (nextVictim) {
          this.truck.ladderTargetFloor = nextVictim.floor;
          this.truck.ladderExtension = 0.5; // Ajusta altura
        } else {
          // Todas as vítimas deste prédio salvas
          this.truck.ladderOperating = false;
          this.truck.ladderTargetBuildingId = null;
        }
      }
    } else {
      this.truck.ladderOperating = false;
      this.truck.ladderTargetBuildingId = null;
    }
  }

  private emitEvent(name: Parameters<GameEventCallback>[0], data?: unknown) {
    if (this.onEvent) {
      this.onEvent(name, data);
    }
  }

  /**
   * Retorna métricas formatadas para finalizar job no backend (/api/fun/job/finish)
   */
  public getFinalMetrics(): Record<string, number> {
    let preservedSum = 0;
    const totalBuildings = this.buildings.length;
    for (const b of this.buildings) {
      preservedSum += b.integrity;
    }
    const avgIntegrity = Math.round(preservedSum / totalBuildings);

    return {
      score: this.stats.score,
      firesExtinguished: this.stats.firesExtinguished,
      victimsSaved: this.stats.victimsSaved,
      victimsLost: this.stats.victimsLost,
      buildingsSaved: this.buildings.filter((b) => !b.collapsed).length,
      buildingsCollapsed: this.stats.buildingsCollapsed,
      averageIntegrity: avgIntegrity,
      waterUsedLiters: Math.round(this.stats.waterUsedLiters),
      foamUsedLiters: Math.round(this.stats.foamUsedLiters),
      maxCombo: this.stats.maxCombo,
      timeElapsedSec: Math.round(this.timeElapsedSec)
    };
  }

  /**
   * Retorna snapshot do estado formatado para o HUD
   */
  public getHUDState() {
    let activeFires = 0;
    let inDangerVictims = 0;
    let maxTemp = 20;

    for (const b of this.buildings) {
      if (b.heat > 0 && !b.collapsed) activeFires++;
      if (b.temperature > maxTemp) maxTemp = b.temperature;
      for (const v of b.victims) {
        if (!v.rescued && !v.perished) inDangerVictims++;
      }
    }

    const remainingSec = Math.max(0, Math.ceil((this.durationMs - this.timeElapsedSec * 1000) / 1000));
    const waterPercent = Math.round((this.truck.waterTank / this.truck.maxWaterTank) * 100);

    return {
      water: waterPercent,
      pressure: this.truck.waterPressureBar,
      hydrant: Boolean(this.truck.connectedHydrantId),
      nozzle: this.activeNozzle,
      thermal: this.thermalVision,
      camera: this.cameraMode,
      victims: inDangerVictims,
      fires: activeFires,
      temperature: maxTemp,
      time: remainingSec,
      score: this.stats.score,
      saved: this.stats.victimsSaved,
      lost: this.stats.victimsLost
    };
  }
}
