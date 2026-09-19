"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

// ==========================================
// TIPOS E CONSTANTES TÁTICAS
// ==========================================

export type FireClass = "A" | "B" | "C";
export type NozzleMode = "WATER_JET" | "MIST" | "FOAM";

export interface BuildingData {
  id: string;
  name: string;
  type: "residential" | "twoStoryHouse" | "chemicalDepot" | "substation" | "commercial";
  fireClass: FireClass;
  x: number;
  width: number;
  height: number;
  floors: number;
  color: string;
  flameLevel: number; // 0 a 100
  heat: number; // 0 a 100
  integrity: number; // 0 a 100
  maxIntegrity: number;
  victimsTrapped: number;
  victimsTotal: number;
  victimsSaved: number;
  victimsHealth: number; // 0 a 100
  isCollapsed: boolean;
  foamCover: number; // 0 a 100
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  kind: "water" | "mist" | "foam" | "smoke" | "ember" | "spark";
}

interface Props {
  config?: {
    durationMs?: number;
    targetScore?: number;
    maxLostHouses?: number;
    maxScore?: number;
  };
  onDone: (score: number, metrics: Record<string, number>) => void;
}

const INITIAL_BUILDINGS: BuildingData[] = [
  {
    id: "bldg_1",
    name: "Edifício Alvorada",
    type: "residential",
    fireClass: "A",
    x: 40,
    width: 100,
    height: 160,
    floors: 4,
    color: "#3b82f6",
    flameLevel: 35,
    heat: 35,
    integrity: 100,
    maxIntegrity: 100,
    victimsTrapped: 2,
    victimsTotal: 2,
    victimsSaved: 0,
    victimsHealth: 100,
    isCollapsed: false,
    foamCover: 0,
  },
  {
    id: "bldg_2",
    name: "Sobrado da Esquina",
    type: "twoStoryHouse",
    fireClass: "A",
    x: 160,
    width: 90,
    height: 120,
    floors: 2,
    color: "#10b981",
    flameLevel: 25,
    heat: 25,
    integrity: 100,
    maxIntegrity: 100,
    victimsTrapped: 1,
    victimsTotal: 1,
    victimsSaved: 0,
    victimsHealth: 100,
    isCollapsed: false,
    foamCover: 0,
  },
  {
    id: "bldg_3",
    name: "Depósito de Tintas",
    type: "chemicalDepot",
    fireClass: "B",
    x: 270,
    width: 115,
    height: 110,
    floors: 1,
    color: "#f59e0b",
    flameLevel: 50,
    heat: 50,
    integrity: 120,
    maxIntegrity: 120,
    victimsTrapped: 1,
    victimsTotal: 1,
    victimsSaved: 0,
    victimsHealth: 100,
    isCollapsed: false,
    foamCover: 0,
  },
  {
    id: "bldg_4",
    name: "Subestação Norte",
    type: "substation",
    fireClass: "C",
    x: 405,
    width: 95,
    height: 100,
    floors: 1,
    color: "#6366f1",
    flameLevel: 40,
    heat: 40,
    integrity: 90,
    maxIntegrity: 90,
    victimsTrapped: 1,
    victimsTotal: 1,
    victimsSaved: 0,
    victimsHealth: 100,
    isCollapsed: false,
    foamCover: 0,
  },
  {
    id: "bldg_5",
    name: "Galeria Central",
    type: "commercial",
    fireClass: "A",
    x: 520,
    width: 110,
    height: 150,
    floors: 3,
    color: "#ec4899",
    flameLevel: 30,
    heat: 30,
    integrity: 110,
    maxIntegrity: 110,
    victimsTrapped: 2,
    victimsTotal: 2,
    victimsSaved: 0,
    victimsHealth: 100,
    isCollapsed: false,
    foamCover: 0,
  },
  {
    id: "bldg_6",
    name: "Solar dos Pinheiros",
    type: "residential",
    fireClass: "A",
    x: 650,
    width: 95,
    height: 130,
    floors: 3,
    color: "#14b8a6",
    flameLevel: 20,
    heat: 20,
    integrity: 100,
    maxIntegrity: 100,
    victimsTrapped: 1,
    victimsTotal: 1,
    victimsSaved: 0,
    victimsHealth: 100,
    isCollapsed: false,
    foamCover: 0,
  },
];

// ==========================================
// GERADOR DE ÁUDIO SINTETIZADO (WEB AUDIO API)
// ==========================================
class FireAudioFX {
  private ctx: AudioContext | null = null;
  private sprayNode: AudioBufferSourceNode | null = null;
  private sprayGain: GainNode | null = null;

  private init() {
    if (!this.ctx && typeof window !== "undefined") {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume();
    }
  }

  playSiren() {
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.linearRampToValueAtTime(880, now + 0.4);
    osc.frequency.linearRampToValueAtTime(440, now + 0.8);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 1.2);
  }

  playRescueBeep() {
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.setValueAtTime(880, now + 0.1); // A5
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.35);
  }

  playWarning() {
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    osc.type = "triangle";
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.setValueAtTime(220, now + 0.1);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  }

  startSpray(mode: NozzleMode) {
    this.init();
    if (!this.ctx || this.sprayNode) return;
    try {
      const bufferSize = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.sprayNode = this.ctx.createBufferSource();
      this.sprayNode.buffer = buffer;
      this.sprayNode.loop = true;

      const filter = this.ctx.createBiquadFilter();
      filter.type = mode === "MIST" ? "highpass" : "lowpass";
      filter.frequency.value = mode === "MIST" ? 1800 : mode === "FOAM" ? 600 : 1000;

      this.sprayGain = this.ctx.createGain();
      this.sprayGain.gain.setValueAtTime(0.06, this.ctx.currentTime);

      this.sprayNode.connect(filter);
      filter.connect(this.sprayGain);
      this.sprayGain.connect(this.ctx.destination);
      this.sprayNode.start();
    } catch {
      // Ignora restrições do navegador
    }
  }

  stopSpray() {
    if (this.sprayNode) {
      try {
        this.sprayNode.stop();
        this.sprayNode.disconnect();
      } catch {
        // noop
      }
      this.sprayNode = null;
      this.sprayGain = null;
    }
  }
}

// ==========================================
// COMPONENTE PRINCIPAL
// ==========================================

export function FirefighterGameOpenGL({ config, onDone }: Props) {
  const durationSec = Math.max(60, Math.min(300, Math.round((config?.durationMs ?? 90_000) / 1000)));
  const targetScore = config?.targetScore ?? 20;
  const maxLostHouses = config?.maxLostHouses ?? 3;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioRef = useRef<FireAudioFX | null>(null);

  // Estados principais
  const [selectedId, setSelectedId] = useState<string>("bldg_1");
  const [activeNozzle, setActiveNozzle] = useState<NozzleMode>("WATER_JET");
  const [isHydrantConnected, setIsHydrantConnected] = useState<boolean>(false);
  const [isLadderExtended, setIsLadderExtended] = useState<boolean>(false);
  const [isThermalView, setIsThermalView] = useState<boolean>(false);

  // Estados de HUD
  const [timeLeft, setTimeLeft] = useState<number>(durationSec);
  const [waterLiters, setWaterLiters] = useState<number>(1000);
  const [foamLiters, setFoamLiters] = useState<number>(300);
  const [score, setScore] = useState<number>(0);
  const [firesExtinguished, setFiresExtinguished] = useState<number>(0);
  const [victimsSaved, setVictimsSaved] = useState<number>(0);
  const [buildingsCollapsed, setBuildingsCollapsed] = useState<number>(0);
  const [combo, setCombo] = useState<number>(0);
  const [currentPhase, setCurrentPhase] = useState<number>(1);
  const [windSpeed, setWindSpeed] = useState<number>(10);
  const [feedbackMsg, setFeedbackMsg] = useState<string>("Chamado iniciado. Mire no foco e acione o esguicho.");

  // Refs de controle de física para o loop rAF
  const isSprayingRef = useRef<boolean>(false);
  const activeNozzleRef = useRef<NozzleMode>(activeNozzle);
  const isHydrantRef = useRef<boolean>(isHydrantConnected);
  const isLadderRef = useRef<boolean>(isLadderExtended);
  const selectedIdRef = useRef<string>(selectedId);
  const buildingsRef = useRef<BuildingData[]>(JSON.parse(JSON.stringify(INITIAL_BUILDINGS)));
  const particlesRef = useRef<Particle[]>([]);

  // Métricas acumuladas
  const metricsRef = useRef({
    waterLiters: 1000,
    foamLiters: 300,
    waterUsedLiters: 0,
    foamUsedLiters: 0,
    firesExtinguished: 0,
    victimsSaved: 0,
    victimsLost: 0,
    buildingsCollapsed: 0,
    maxCombo: 0,
    currentCombo: 0,
    ladderProgressSec: 0,
  });

  const finishedRef = useRef<boolean>(false);
  const startTimeRef = useRef<number>(0);

  // Sincroniza refs quando os estados React mudam
  useEffect(() => {
    activeNozzleRef.current = activeNozzle;
  }, [activeNozzle]);

  useEffect(() => {
    isHydrantRef.current = isHydrantConnected;
  }, [isHydrantConnected]);

  useEffect(() => {
    isLadderRef.current = isLadderExtended;
  }, [isLadderExtended]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // Inicializa o som e sirene ao montar
  useEffect(() => {
    audioRef.current = new FireAudioFX();
    audioRef.current.playSiren();
    return () => {
      audioRef.current?.stopSpray();
    };
  }, []);

  // Finalização garantida da partida
  const handleFinish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    audioRef.current?.stopSpray();

    const m = metricsRef.current;
    const bldgs = buildingsRef.current;
    const buildingsSaved = bldgs.filter((b) => !b.isCollapsed && b.flameLevel === 0).length;

    // Fórmula determinística idêntica ao backend
    const finalScore = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          m.firesExtinguished * 6 +
            m.victimsSaved * 8 +
            buildingsSaved * 4 +
            Math.min(15, m.maxCombo * 2) -
            m.buildingsCollapsed * 10 -
            m.victimsLost * 5
        )
      )
    );

    const elapsedSec = Math.round((performance.now() - startTimeRef.current) / 1000);

    onDone(finalScore, {
      firesExtinguished: m.firesExtinguished,
      victimsSaved: m.victimsSaved,
      victimsLost: m.victimsLost,
      buildingsSaved,
      buildingsCollapsed: m.buildingsCollapsed,
      lostHouses: m.buildingsCollapsed, // Invariante estrito exigido pelo catalog e jobService
      waterUsedLiters: Math.round(m.waterUsedLiters),
      foamUsedLiters: Math.round(m.foamUsedLiters),
      maxCombo: m.maxCombo,
      timeElapsedSec: elapsedSec,
      targetReached: finalScore >= targetScore && m.buildingsCollapsed <= maxLostHouses ? 1 : 0,
    });
  }, [maxLostHouses, onDone, targetScore]);

  // ==========================================
  // LOOP PRINCIPAL DE FÍSICA E RENDERIZAÇÃO
  // ==========================================
  useEffect(() => {
    startTimeRef.current = performance.now();
    let lastFrameTime = performance.now();
    let animationFrameId: number;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const gameLoop = (now: number) => {
      if (finishedRef.current) return;

      // Delta time com clamp seguro de 250ms para evitar saltos
      const dt = Math.min(0.25, (now - lastFrameTime) / 1000);
      lastFrameTime = now;

      // Atualiza cronômetro com precisão monotônica
      const elapsedSec = (now - startTimeRef.current) / 1000;
      const remainingSec = Math.max(0, durationSec - elapsedSec);
      setTimeLeft(Math.ceil(remainingSec));

      if (remainingSec <= 0) {
        handleFinish();
        return;
      }

      // Determina Fase de Emergência (0-33%: 1, 33-66%: 2, 66-100%: 3)
      const ratio = elapsedSec / durationSec;
      const phase = ratio >= 0.66 ? 3 : ratio >= 0.33 ? 2 : 1;
      const curWind = phase === 3 ? 45 : phase === 2 ? 28 : 10;
      setCurrentPhase(phase);
      setWindSpeed(curWind);

      const m = metricsRef.current;
      const bldgs = buildingsRef.current;
      const targetBldg = bldgs.find((b) => b.id === selectedIdRef.current) ?? bldgs[0];

      // 1. Recarga do Tanque via Hidrante
      if (isHydrantRef.current) {
        m.waterLiters = Math.min(1000, m.waterLiters + 45 * dt);
        setWaterLiters(Math.round(m.waterLiters));
      }

      // 2. Operação do Esguicho Tático
      if (isSprayingRef.current && targetBldg && !targetBldg.isCollapsed && targetBldg.flameLevel > 0) {
        const nozzle = activeNozzleRef.current;
        let waterReq = 0;
        let foamReq = 0;
        let effectiveness = 0.5;

        if (nozzle === "WATER_JET") {
          waterReq = 22 * dt;
          effectiveness = targetBldg.fireClass === "A" ? 1.0 : targetBldg.fireClass === "B" ? -0.5 : -0.7;
        } else if (nozzle === "MIST") {
          waterReq = 12 * dt;
          effectiveness = targetBldg.fireClass === "C" ? 1.0 : targetBldg.fireClass === "A" ? 0.6 : 0.1;
        } else if (nozzle === "FOAM") {
          waterReq = 10 * dt;
          foamReq = 8 * dt;
          effectiveness = targetBldg.fireClass === "B" ? 1.3 : targetBldg.fireClass === "A" ? 0.7 : -0.3;
        }

        const canSpray = m.waterLiters >= waterReq && (foamReq === 0 || m.foamLiters >= foamReq);

        if (canSpray) {
          m.waterLiters = Math.max(0, m.waterLiters - waterReq);
          m.waterUsedLiters += waterReq;
          setWaterLiters(Math.round(m.waterLiters));

          if (foamReq > 0) {
            m.foamLiters = Math.max(0, m.foamLiters - foamReq);
            m.foamUsedLiters += foamReq;
            setFoamLiters(Math.round(m.foamLiters));
          }

          // Emissão de partículas táticas
          const nozzleX = 80;
          const nozzleY = canvas.height - 40;
          const targetCenter = targetBldg.x + targetBldg.width / 2;
          const targetMidY = canvas.height - targetBldg.height / 2;

          for (let i = 0; i < (nozzle === "MIST" ? 8 : 4); i++) {
            const spread = (Math.random() - 0.5) * (nozzle === "MIST" ? 60 : 20);
            particlesRef.current.push({
              x: nozzleX,
              y: nozzleY,
              vx: (targetCenter - nozzleX) * (1.2 + Math.random() * 0.4) + spread,
              vy: (targetMidY - nozzleY) * (1.2 + Math.random() * 0.4) + spread - 50,
              life: 0,
              maxLife: 0.6 + Math.random() * 0.3,
              size: nozzle === "MIST" ? 6 + Math.random() * 8 : nozzle === "FOAM" ? 5 + Math.random() * 5 : 3 + Math.random() * 3,
              color: nozzle === "FOAM" ? "#f8fafc" : nozzle === "MIST" ? "#93c5fd" : "#38bdf8",
              kind: nozzle === "FOAM" ? "foam" : nozzle === "MIST" ? "mist" : "water",
            });
          }

          // Aplicação na física do edifício
          if (effectiveness > 0) {
            targetBldg.flameLevel = Math.max(0, targetBldg.flameLevel - 22 * effectiveness * dt);
            targetBldg.heat = Math.max(0, targetBldg.heat - (nozzle === "MIST" ? 60 : 35) * dt);

            if (nozzle === "FOAM") {
              targetBldg.foamCover = Math.min(100, targetBldg.foamCover + 25 * dt);
            }

            if (targetBldg.flameLevel === 0) {
              m.firesExtinguished++;
              m.currentCombo++;
              if (m.currentCombo > m.maxCombo) m.maxCombo = m.currentCombo;
              setFiresExtinguished(m.firesExtinguished);
              setCombo(m.currentCombo);
              setFeedbackMsg(`Foco debelado no ${targetBldg.name}! (+Combo ${m.currentCombo}x)`);
            }
          } else {
            // Penalidade por erro tático
            const pen = Math.abs(effectiveness);
            targetBldg.flameLevel = Math.min(100, targetBldg.flameLevel + 16 * pen * dt);
            targetBldg.heat = Math.min(100, targetBldg.heat + 25 * pen * dt);
            targetBldg.integrity = Math.max(0, targetBldg.integrity - 12 * pen * dt);
            m.currentCombo = 0;
            setCombo(0);
            if (nozzle === "WATER_JET" && targetBldg.fireClass === "B") {
              setFeedbackMsg("⚠️ PERIGO: Água em combustível espalhou o fogo! Use ESPUMA.");
            } else if (nozzle === "WATER_JET" && targetBldg.fireClass === "C") {
              setFeedbackMsg("⚡ CHOQUE ELÉTRICO: Jato direto em alta tensão! Use NEBLINA.");
            }
          }
        } else {
          setFeedbackMsg("🚨 Tanque sem pressão/recursos! Conecte ao HIDRANTE 🚰.");
        }
      }

      // 3. Resgate com Escada Magirus
      if (isLadderRef.current && targetBldg && !targetBldg.isCollapsed && targetBldg.victimsTrapped > 0) {
        m.ladderProgressSec += dt;
        if (m.ladderProgressSec >= 4.0) {
          m.ladderProgressSec = 0;
          targetBldg.victimsTrapped--;
          targetBldg.victimsSaved++;
          m.victimsSaved++;
          m.currentCombo++;
          if (m.currentCombo > m.maxCombo) m.maxCombo = m.currentCombo;
          setVictimsSaved(m.victimsSaved);
          setCombo(m.currentCombo);
          audioRef.current?.playRescueBeep();
          setFeedbackMsg(`🆘 Vítima resgatada com sucesso no ${targetBldg.name}! (+10 pts)`);
        }
      } else if (!isLadderRef.current) {
        m.ladderProgressSec = 0;
      }

      // 4. Termodinâmica de todos os edifícios
      for (const b of bldgs) {
        if (b.isCollapsed) continue;

        if (b.flameLevel > 0) {
          b.heat = Math.min(100, b.heat + 3.5 * dt);
          const damage = (b.flameLevel / 100) * 3.2 * dt;
          b.integrity = Math.max(0, b.integrity - damage);

          // Vítimas sofrem com fumaça
          if (b.victimsTrapped > 0) {
            b.victimsHealth = Math.max(0, b.victimsHealth - 3.8 * dt);
            if (b.victimsHealth <= 0) {
              m.victimsLost += b.victimsTrapped;
              b.victimsTrapped = 0;
              setFeedbackMsg(`❌ Vítima sucumbiu à inalação de fumaça no ${b.name}.`);
            }
          }

          // Colapso estrutural
          if (b.integrity <= 0) {
            b.isCollapsed = true;
            b.flameLevel = 0;
            m.buildingsCollapsed++;
            setBuildingsCollapsed(m.buildingsCollapsed);
            audioRef.current?.playWarning();
            setFeedbackMsg(`💥 DESABAMENTO: ${b.name} colapsou!`);

            if (b.victimsTrapped > 0) {
              m.victimsLost += b.victimsTrapped;
              b.victimsTrapped = 0;
            }

            if (m.buildingsCollapsed > maxLostHouses) {
              handleFinish();
              return;
            }
          }
        } else {
          // Resfriamento natural gradual
          b.heat = Math.max(0, b.heat - 4.0 * dt);
          if (b.foamCover > 0) {
            b.foamCover = Math.max(0, b.foamCover - 2.0 * dt);
          }
        }
      }

      // 5. Partículas (Fogo, fumaça, brasas e água)
      for (const b of bldgs) {
        if (!b.isCollapsed && b.flameLevel > 0 && Math.random() < 0.3) {
          const fx = b.x + Math.random() * b.width;
          const fy = canvas.height - Math.random() * b.height;
          particlesRef.current.push({
            x: fx,
            y: fy,
            vx: (Math.random() - 0.5) * 15 + curWind * 0.3,
            vy: -(20 + Math.random() * 40),
            life: 0,
            maxLife: 0.8 + Math.random() * 0.6,
            size: 4 + Math.random() * (b.flameLevel / 10),
            color: Math.random() > 0.4 ? "#f97316" : "#eab308",
            kind: "ember",
          });
        }
      }

      // Atualiza física de partículas
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.life += dt;
        if (p.life >= p.maxLife) {
          particlesRef.current.splice(i, 1);
          continue;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.kind === "water" || p.kind === "foam") {
          p.vy += 80 * dt; // Gravidade balística
        }
      }

      // Calcula pontuação em tempo real
      const bldgsSaved = bldgs.filter((b) => !b.isCollapsed && b.flameLevel === 0).length;
      const curScore = Math.max(
        0,
        Math.min(
          100,
          Math.round(
            m.firesExtinguished * 6 +
              m.victimsSaved * 8 +
              bldgsSaved * 4 +
              Math.min(15, m.maxCombo * 2) -
              m.buildingsCollapsed * 10 -
              m.victimsLost * 5
          )
        )
      );
      setScore(curScore);

      // ==========================================
      // RENDERIZAÇÃO GRÁFICA NO CANVAS 2D
      // ==========================================
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Fundo e céu urbano (noite/crepúsculo de emergência)
      const skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      if (isThermalView) {
        skyGrad.addColorStop(0, "#020617");
        skyGrad.addColorStop(1, "#0f172a");
      } else {
        skyGrad.addColorStop(0, "#090d16");
        skyGrad.addColorStop(0.7, "#1e1b4b");
        skyGrad.addColorStop(1, "#18181b");
      }
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Lua e silhuetas de fundo
      ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
      ctx.fillRect(0, canvas.height - 220, canvas.width, 220);

      // Asfalto da rua
      ctx.fillStyle = "#18181b";
      ctx.fillRect(0, canvas.height - 50, canvas.width, 50);
      ctx.strokeStyle = "#fbbf24";
      ctx.setLineDash([16, 16]);
      ctx.beginPath();
      ctx.moveTo(0, canvas.height - 25);
      ctx.lineTo(canvas.width, canvas.height - 25);
      ctx.stroke();
      ctx.setLineDash([]);

      // Desenho dos Edifícios
      for (const b of bldgs) {
        const isTarget = b.id === selectedIdRef.current;
        const bY = canvas.height - 50 - b.height;

        if (b.isCollapsed) {
          // Ruínas e escombros
          ctx.fillStyle = "#27272a";
          ctx.fillRect(b.x, canvas.height - 75, b.width, 25);
          ctx.fillStyle = "#71717a";
          ctx.font = "bold 10px monospace";
          ctx.fillText("RUÍNAS 💥", b.x + 10, canvas.height - 60);
          continue;
        }

        // Fachada do edifício
        if (isThermalView) {
          // Gradiente FLIR: azul (frio) -> verde -> amarelo -> vermelho -> branco (crítico)
          const heatRatio = b.heat / 100;
          ctx.fillStyle =
            heatRatio > 0.8
              ? "#ffffff"
              : heatRatio > 0.5
              ? "#ef4444"
              : heatRatio > 0.25
              ? "#f59e0b"
              : "#3b82f6";
        } else {
          ctx.fillStyle = b.color;
        }
        ctx.fillRect(b.x, bY, b.width, b.height);

        // Contorno de seleção
        if (isTarget) {
          ctx.strokeStyle = "#facc15";
          ctx.lineWidth = 3;
          ctx.strokeRect(b.x - 2, bY - 2, b.width + 4, b.height + 4);
          ctx.lineWidth = 1;
        }

        // Janelas e andares
        const floorH = b.height / b.floors;
        for (let f = 0; f < b.floors; f++) {
          const wY = bY + f * floorH + 8;
          ctx.fillStyle = b.flameLevel > 0 ? "rgba(239, 68, 68, 0.4)" : "rgba(255, 255, 255, 0.2)";
          ctx.fillRect(b.x + 8, wY, b.width - 16, floorH - 14);
        }

        // Vítimas nas janelas acenando
        if (b.victimsTrapped > 0) {
          ctx.font = "14px sans-serif";
          ctx.fillText("🙋‍♂️🆘", b.x + b.width / 2 - 12, bY + 24);
        }

        // Camada de Espuma Química (AFFF)
        if (b.foamCover > 0) {
          ctx.fillStyle = `rgba(248, 250, 252, ${b.foamCover / 130})`;
          ctx.fillRect(b.x, bY, b.width, b.height);
        }

        // Barra de Integridade Estrutural
        const integW = (b.integrity / b.maxIntegrity) * b.width;
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
        ctx.fillRect(b.x, bY - 14, b.width, 5);
        ctx.fillStyle = b.integrity > 50 ? "#22c55e" : b.integrity > 25 ? "#eab308" : "#ef4444";
        ctx.fillRect(b.x, bY - 14, integW, 5);

        // Barra de Chamas / Calor
        if (b.flameLevel > 0) {
          const flameW = (b.flameLevel / 100) * b.width;
          ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
          ctx.fillRect(b.x, bY - 8, b.width, 5);
          ctx.fillStyle = "#f97316";
          ctx.fillRect(b.x, bY - 8, flameW, 5);
        }

        // Tag de Identificação e Classe
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 9px sans-serif";
        ctx.fillText(`CLASSE ${b.fireClass}`, b.x + 4, bY + b.height - 8);
      }

      // Escada Magirus Telescópica Estendida
      if (isLadderRef.current && targetBldg && !targetBldg.isCollapsed) {
        ctx.strokeStyle = "#cbd5e1";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(80, canvas.height - 40);
        ctx.lineTo(targetBldg.x + targetBldg.width / 2, canvas.height - 50 - targetBldg.height + 25);
        ctx.stroke();
        ctx.lineWidth = 1;

        // Indicador de progresso do resgate
        const prog = (m.ladderProgressSec / 4.0) * 100;
        ctx.fillStyle = "#38bdf8";
        ctx.font = "bold 10px sans-serif";
        ctx.fillText(`RESGATE: ${Math.round(prog)}%`, targetBldg.x + 10, canvas.height - 50 - targetBldg.height - 20);
      }

      // Caminhão de Bombeiros na rua
      const truckX = 20;
      const truckY = canvas.height - 48;
      ctx.fillStyle = "#dc2626"; // Vermelho Bombeiro
      ctx.fillRect(truckX, truckY - 25, 80, 25);
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(truckX + 50, truckY - 22, 25, 14);

      // Rodas
      ctx.fillStyle = "#18181b";
      ctx.beginPath();
      ctx.arc(truckX + 18, truckY, 8, 0, Math.PI * 2);
      ctx.arc(truckX + 62, truckY, 8, 0, Math.PI * 2);
      ctx.fill();

      // Giroflex Duplo (Vermelho / Azul pulsante)
      const flash = Math.sin(now * 0.015) > 0;
      ctx.fillStyle = flash ? "#ef4444" : "#3b82f6";
      ctx.shadowColor = flash ? "#ef4444" : "#3b82f6";
      ctx.shadowBlur = 15;
      ctx.fillRect(truckX + 60, truckY - 32, 12, 6);
      ctx.shadowBlur = 0;

      // Hidrante de Calçada
      const hydrantX = 115;
      const hydrantY = canvas.height - 48;
      ctx.fillStyle = isHydrantRef.current ? "#22c55e" : "#eab308";
      ctx.fillRect(hydrantX, hydrantY - 18, 12, 18);
      if (isHydrantRef.current) {
        // Mangueira conectada do hidrante ao caminhão
        ctx.strokeStyle = "#eab308";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(truckX + 15, truckY - 10);
        ctx.quadraticCurveTo(80, canvas.height - 30, hydrantX + 6, hydrantY - 10);
        ctx.stroke();
        ctx.lineWidth = 1;
      }

      // Renderização das Partículas
      for (const p of particlesRef.current) {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }

      animationFrameId = requestAnimationFrame(gameLoop);
    };

    animationFrameId = requestAnimationFrame(gameLoop);
    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [durationSec, handleFinish, isThermalView, maxLostHouses]);

  // ==========================================
  // HANDLERS DE AÇÃO DO JOGADOR
  // ==========================================
  const startSpray = useCallback(() => {
    isSprayingRef.current = true;
    audioRef.current?.startSpray(activeNozzleRef.current);
  }, []);

  const stopSpray = useCallback(() => {
    isSprayingRef.current = false;
    audioRef.current?.stopSpray();
  }, []);

  const toggleHydrant = useCallback(() => {
    setIsHydrantConnected((prev) => {
      const next = !prev;
      setFeedbackMsg(next ? "🚰 Hidrante engatado: recarga contínua ativada." : "Hidrante desacoplado.");
      return next;
    });
  }, []);

  const toggleLadder = useCallback(() => {
    setIsLadderExtended((prev) => {
      const next = !prev;
      setFeedbackMsg(next ? "🪜 Escada telescópica estendida para resgate." : "Escada recolhida.");
      return next;
    });
  }, []);

  // Suporte a teclado
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === "Space") {
        e.preventDefault();
        startSpray();
      } else if (e.key === "1") {
        setActiveNozzle("WATER_JET");
        setFeedbackMsg("Bico alternado: JATO D'ÁGUA 💧 (Ideal para Classe A).");
      } else if (e.key === "2") {
        setActiveNozzle("MIST");
        setFeedbackMsg("Bico alternado: NEBLINA 🌫️ (Ideal para Classe C e dissipar calor).");
      } else if (e.key === "3") {
        setActiveNozzle("FOAM");
        setFeedbackMsg("Bico alternado: ESPUMA AFFF 🧼 (Obrigatório para Classe B).");
      } else if (e.code === "KeyH") {
        toggleHydrant();
      } else if (e.code === "KeyL" || e.code === "KeyE") {
        toggleLadder();
      } else if (e.code === "KeyT") {
        setIsThermalView((v) => !v);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        stopSpray();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [startSpray, stopSpray, toggleHydrant, toggleLadder]);

  const currentBuilding = buildingsRef.current.find((b) => b.id === selectedId) ?? buildingsRef.current[0];

  return (
    <div className="relative mx-auto flex w-full max-w-4xl select-none flex-col rounded-2xl border border-zinc-800 bg-zinc-950 p-3 shadow-2xl text-zinc-100">
      {/* HUD SUPERIOR */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-zinc-900/90 p-2.5 border border-zinc-800/80">
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-bold text-amber-400">Tempo Restante</span>
            <span className="font-mono text-2xl font-black text-white">{timeLeft}s</span>
          </div>
          <div className="h-8 w-[1px] bg-zinc-700" />
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-bold text-zinc-400">Pontuação</span>
            <span className="font-mono text-xl font-bold text-amber-300">
              {score} <span className="text-xs text-zinc-500">/ {targetScore} meta</span>
            </span>
          </div>
          <div className="h-8 w-[1px] bg-zinc-700" />
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-bold text-zinc-400">Fase</span>
            <span className="text-xs font-bold text-rose-400">
              {currentPhase === 3 ? "🔥 Ponto Crítico" : currentPhase === 2 ? "⚡ Alarme Geral" : "🛡️ Alerta"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-zinc-400">Água do Tanque</span>
            <span className={`font-mono font-bold ${waterLiters < 200 ? "text-rose-400 animate-pulse" : "text-sky-400"}`}>
              💧 {waterLiters}L / 1000L
            </span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-zinc-400">Espuma AFFF</span>
            <span className="font-mono font-bold text-amber-400">🧼 {foamLiters}L / 300L</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-zinc-400">Vento</span>
            <span className="font-mono text-zinc-300">💨 {windSpeed} km/h</span>
          </div>
        </div>
      </div>

      {/* TELA DE SIMULAÇÃO TÁTICA */}
      <div className="relative overflow-hidden rounded-xl border border-zinc-800 bg-black">
        <canvas ref={canvasRef} width={800} height={320} className="w-full h-auto block" />

        {/* CÂMERA TÉRMICA TOGGLE */}
        <button
          type="button"
          onClick={() => setIsThermalView((v) => !v)}
          className={`absolute top-2 right-2 rounded-lg px-2.5 py-1 text-[10px] font-bold border transition-colors ${
            isThermalView
              ? "bg-rose-600 border-rose-400 text-white"
              : "bg-zinc-900/80 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
          }`}
        >
          📷 CÂMERA TÉRMICA (FLIR)
        </button>

        {/* FEEDBACK STATUS BAR */}
        <div className="absolute bottom-2 left-2 right-2 rounded-lg bg-black/75 px-3 py-1.5 text-xs text-zinc-200 backdrop-blur-sm flex justify-between items-center border border-white/10">
          <span className="truncate">{feedbackMsg}</span>
          {combo > 1 && (
            <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 font-bold text-amber-300 border border-amber-500/40 animate-pulse">
              COMBO {combo}x
            </span>
          )}
        </div>
      </div>

      {/* SELEÇÃO DE EDIFÍCIO (GRID TÁTICO) */}
      <div className="mt-2 grid grid-cols-6 gap-1.5">
        {buildingsRef.current.map((b) => {
          const isSel = b.id === selectedId;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                setSelectedId(b.id);
                setFeedbackMsg(`Alvo selecionado: ${b.name} (Classe ${b.fireClass}).`);
              }}
              className={`flex flex-col rounded-lg p-1.5 text-left border transition-all ${
                isSel
                  ? "border-amber-400 bg-amber-950/40 ring-1 ring-amber-400"
                  : b.isCollapsed
                  ? "border-zinc-800 bg-zinc-900/40 opacity-50 cursor-not-allowed"
                  : b.flameLevel > 0
                  ? "border-rose-900 bg-rose-950/30 hover:border-rose-700"
                  : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-[10px] font-bold truncate">{b.name}</span>
                <span
                  className={`text-[9px] font-bold px-1 rounded ${
                    b.fireClass === "A" ? "bg-blue-900/60 text-blue-300" : b.fireClass === "B" ? "bg-amber-900/60 text-amber-300" : "bg-purple-900/60 text-purple-300"
                  }`}
                >
                  {b.fireClass}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[10px]">
                <span className={b.flameLevel > 0 ? "text-rose-400 font-bold" : "text-emerald-400"}>
                  {b.isCollapsed ? "💥 Destruído" : b.flameLevel > 0 ? `🔥 ${Math.round(b.flameLevel)}%` : "✅ Seguro"}
                </span>
                {b.victimsTrapped > 0 && <span className="text-amber-400 font-bold">🆘 {b.victimsTrapped}</span>}
              </div>
            </button>
          );
        })}
      </div>

      {/* PAINEL DE COMANDOS DO CAMINHÃO (COCKPIT DO BOMBEIRO) */}
      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
        {/* SELETOR DE BICO */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-2 flex flex-col justify-between">
          <span className="text-[10px] uppercase font-bold text-zinc-400 mb-1">Seletor de Agente Extintor</span>
          <div className="grid grid-cols-3 gap-1">
            <button
              type="button"
              onClick={() => {
                setActiveNozzle("WATER_JET");
                setFeedbackMsg("Jato D'Água 💧 selecionado (Classe A).");
              }}
              className={`rounded-lg py-2 text-xs font-bold border transition-colors flex flex-col items-center ${
                activeNozzle === "WATER_JET"
                  ? "border-sky-400 bg-sky-950/60 text-sky-200"
                  : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              <span className="text-base">💧</span>
              <span>Água (A)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveNozzle("MIST");
                setFeedbackMsg("Neblina Resfriante 🌫️ selecionada (Classe C/Calor).");
              }}
              className={`rounded-lg py-2 text-xs font-bold border transition-colors flex flex-col items-center ${
                activeNozzle === "MIST"
                  ? "border-purple-400 bg-purple-950/60 text-purple-200"
                  : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              <span className="text-base">🌫️</span>
              <span>Neblina (C)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveNozzle("FOAM");
                setFeedbackMsg("Espuma AFFF 🧼 selecionada (Classe B).");
              }}
              className={`rounded-lg py-2 text-xs font-bold border transition-colors flex flex-col items-center ${
                activeNozzle === "FOAM"
                  ? "border-amber-400 bg-amber-950/60 text-amber-200"
                  : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              <span className="text-base">🧼</span>
              <span>Espuma (B)</span>
            </button>
          </div>
        </div>

        {/* SUPORTE OPERACIONAL (HIDRANTE E ESCADA) */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-2 flex flex-col justify-between">
          <span className="text-[10px] uppercase font-bold text-zinc-400 mb-1">Equipamentos Operacionais</span>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={toggleHydrant}
              className={`rounded-lg py-2 px-2 text-xs font-bold border transition-all flex items-center justify-center gap-1.5 ${
                isHydrantConnected
                  ? "border-emerald-400 bg-emerald-950/60 text-emerald-200 shadow-sm shadow-emerald-500/20"
                  : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              <span>🚰</span>
              <span>{isHydrantConnected ? "Hidrante [ON]" : "Engatar Hidrante"}</span>
            </button>
            <button
              type="button"
              onClick={toggleLadder}
              className={`rounded-lg py-2 px-2 text-xs font-bold border transition-all flex items-center justify-center gap-1.5 ${
                isLadderExtended
                  ? "border-sky-400 bg-sky-950/60 text-sky-200 shadow-sm shadow-sky-500/20"
                  : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              <span>🪜</span>
              <span>{isLadderExtended ? "Escada [ON]" : "Escada Magirus"}</span>
            </button>
          </div>
        </div>

        {/* GATILHO DO ESGUICHO */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-2 flex flex-col justify-between">
          <span className="text-[10px] uppercase font-bold text-zinc-400 mb-1">
            Alvo: <b className="text-white">{currentBuilding.name}</b>
          </span>
          <button
            type="button"
            onPointerDown={startSpray}
            onPointerUp={stopSpray}
            onPointerLeave={stopSpray}
            className="w-full rounded-xl bg-gradient-to-r from-red-600 via-rose-600 to-red-700 py-3 text-sm font-black uppercase tracking-wider text-white shadow-lg shadow-red-600/30 hover:from-red-500 hover:to-red-600 active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
          >
            <span>🚒</span>
            <span>Segure para Combater (Espaço)</span>
          </button>
        </div>
      </div>

      {/* METAS E INSTRUÇÕES RÁPIDAS */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between text-[11px] text-zinc-500 border-t border-zinc-800/60 pt-2">
        <div className="flex gap-3">
          <span>
            Focos debelados: <b className="text-zinc-300">{firesExtinguished}</b>
          </span>
          <span>
            Vítimas salvas: <b className="text-zinc-300">{victimsSaved}</b>
          </span>
          <span>
            Colapsos: <b className={buildingsCollapsed > 0 ? "text-rose-400 font-bold" : "text-zinc-300"}>{buildingsCollapsed} / {maxLostHouses}</b>
          </span>
        </div>
        <div className="text-zinc-400 font-medium">
          Dica rápida: <b>Classe A (Água)</b> · <b>Classe B (Espuma)</b> · <b>Classe C (Neblina)</b>
        </div>
      </div>
    </div>
  );
}
