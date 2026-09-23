"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Activity,
  BarChart3,
  Camera,
  Car,
  Check,
  ChevronLeft,
  Coins,
  Eye,
  Flame,
  Gauge,
  Layers,
  Palette,
  RotateCcw,
  RotateCw,
  Save,
  ShieldAlert,
  Sparkles,
  Trophy,
  Volume2,
  VolumeX,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { funApi } from "@/lib/api";
import type { CarState, CarView } from "@/lib/types";
import {
  CAR_PRESETS,
  calculateCarCustomizationQuote,
  calculateCarPerformance,
  generateDynoCurve,
} from "../../../../../shared/car/domain.js";
import type { CameraPreset, CarStudioHandle } from "@/components/cars/CarStudio3D";
import { carAudio } from "@/lib/carAudio";

// Carrega o estúdio 3D com SSR desabilitado
const CarStudio3D = dynamic(
  () => import("@/components/cars/CarStudio3D").then((mod) => mod.CarStudio3D),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full min-h-[460px] flex items-center justify-center bg-[#0c0a16] rounded-2xl border border-purple-900/30 text-purple-300 animate-pulse">
        <div className="flex flex-col items-center gap-3">
          <Car className="w-12 h-12 animate-bounce text-purple-400" />
          <span className="text-sm font-bold tracking-widest uppercase">Carregando Oficina AAA 3D...</span>
        </div>
      </div>
    ),
  }
);

type Props = { params: Promise<{ token: string }> };
type CategoryTab =
  | "paint"
  | "bodykit"
  | "wheels"
  | "spoiler"
  | "suspension"
  | "neon"
  | "interior"
  | "decals"
  | "tint"
  | "plate";

export default function CarroCustomizacaoPage({ params }: Props) {
  const { token } = use(params);
  const studioRef = useRef<CarStudioHandle | null>(null);

  const [carData, setCarData] = useState<CarView | null>(null);
  const [draft, setDraft] = useState<CarState | null>(null);
  const [activeTab, setActiveTab] = useState<CategoryTab>("paint");
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>("iso");
  const [turntable, setTurntable] = useState(false);
  const [doorsOpen, setDoorsOpen] = useState(false);
  const [headlightsOn, setHeadlightsOn] = useState(true);
  const [showDyno, setShowDyno] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [photoFlash, setPhotoFlash] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isRevving, setIsRevving] = useState(false);
  const [rpmDisplay, setRpmDisplay] = useState(900);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await funApi.cars.get(token);
      setCarData(data);
      setDraft(data.state);
    } catch (err: unknown) {
      setError((err as Error)?.message || "Erro ao carregar dados do carro ou token inválido.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Telemetria dinâmica calculada em tempo real com base no draft
  const performance = useMemo(() => {
    return calculateCarPerformance(draft || {});
  }, [draft]);

  // Curva de Dinamômetro calculada dinamicamente
  const dyno = useMemo(() => {
    return generateDynoCurve(draft || {});
  }, [draft]);

  // Cálculo de orçamento para ir do estado salvo para o draft
  const quote = useMemo(() => {
    if (!carData?.state || !draft) return { total: 0, items: [] };
    return calculateCarCustomizationQuote(carData.state, draft);
  }, [carData?.state, draft]);

  const hasChanges = useMemo(() => {
    if (!carData?.state || !draft) return false;
    return (
      draft.color !== carData.state.color ||
      draft.secondaryColor !== carData.state.secondaryColor ||
      draft.finish !== carData.state.finish ||
      draft.bodykit !== carData.state.bodykit ||
      draft.headlight !== carData.state.headlight ||
      draft.interior !== carData.state.interior ||
      draft.rollCage !== carData.state.rollCage ||
      draft.camber !== carData.state.camber ||
      draft.caliperColor !== carData.state.caliperColor ||
      draft.wheelColor !== carData.state.wheelColor ||
      draft.exhaust !== carData.state.exhaust ||
      draft.wheels !== carData.state.wheels ||
      draft.spoiler !== carData.state.spoiler ||
      draft.suspension !== carData.state.suspension ||
      draft.neon !== carData.state.neon ||
      draft.decal !== carData.state.decal ||
      draft.windowTint !== carData.state.windowTint ||
      draft.plateText !== carData.state.plateText
    );
  }, [carData?.state, draft]);

  const canAfford = (carData?.coins ?? 0) >= quote.total;

  // Interação de aceleração e corte de giro
  const handleRevEngine = () => {
    if (isRevving) return;
    setIsRevving(true);
    setRpmDisplay(7200);
    carAudio.playEngineRev();
    studioRef.current?.triggerRev();

    setTimeout(() => {
      setRpmDisplay(4800);
    }, 450);

    setTimeout(() => {
      setRpmDisplay(900);
      setIsRevving(false);
    }, 1200);
  };

  // Interação de abrir/fechar portas
  const handleToggleDoors = () => {
    const next = !doorsOpen;
    setDoorsOpen(next);
    if (next) {
      carAudio.playDoorOpen();
    } else {
      carAudio.playDoorClose();
    }
  };

  // Capturar foto 4K instantânea direto do WebGL Canvas
  const handleCapturePhoto = () => {
    const dataUrl = studioRef.current?.captureScreenshot();
    if (!dataUrl) return;

    setPhotoFlash(true);
    carAudio.playMechanicalClick();
    setTimeout(() => setPhotoFlash(false), 220);

    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `carro-${draft?.plateText || "custom"}-4k.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleApplyPreset = (presetConfig: Partial<CarState>) => {
    if (!draft) return;
    setDraft({
      ...draft,
      ...presetConfig,
    });
    carAudio.playSprayPaint();
    setShowPresets(false);
  };

  const handleSave = async () => {
    if (!draft || !hasChanges) return;
    if (!canAfford) {
      setError(`Moedas insuficientes! Você precisa de ${quote.total} coins mas possui ${carData?.coins ?? 0}.`);
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const idempotencyKey = `car-save-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const result = await funApi.cars.applyCustomization(token, draft, idempotencyKey);

      setCarData((prev) =>
        prev
          ? {
              ...prev,
              state: result.state,
              coins: result.coins,
            }
          : null
      );
      setDraft(result.state);
      carAudio.playMechanicalClick();
      setSuccess(
        result.debited > 0
          ? `Oficina VIP: Customização gravada! ${result.debited} coins debitadas.`
          : "Oficina VIP: Customização gravada com sucesso!"
      );
    } catch (err: unknown) {
      setError((err as Error)?.message || "Falha ao salvar customizações.");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (carData?.state) {
      setDraft(carData.state);
      setError(null);
      setSuccess(null);
      carAudio.playMechanicalClick();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#07050e] text-purple-100 flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <Car className="w-14 h-14 animate-bounce text-purple-400" />
          <h2 className="text-xl font-black tracking-widest text-white uppercase">GARAGEM VIP 3D • CARREGANDO</h2>
          <p className="text-xs text-purple-300/70">Ajustando bancada dinamométrica e estúdio de renderização</p>
        </div>
      </div>
    );
  }

  if (error && !carData) {
    return (
      <div className="min-h-screen bg-[#07050e] text-purple-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#120e22] border border-red-800/40 rounded-2xl p-6 text-center shadow-2xl">
          <ShieldAlert className="w-14 h-14 text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-red-200 mb-2">Acesso Privado Inválido</h2>
          <p className="text-sm text-purple-300/80 mb-6">{error}</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-800/40 hover:bg-purple-800/60 text-purple-200 border border-purple-700/50 transition-colors text-sm font-medium"
          >
            <ChevronLeft className="w-4 h-4" /> Voltar ao Início
          </Link>
        </div>
      </div>
    );
  }

  if (carData && !carData.ownsCar) {
    return (
      <div className="min-h-screen bg-[#07050e] text-purple-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#120e22] border border-amber-800/40 rounded-2xl p-6 text-center shadow-2xl">
          <Car className="w-14 h-14 text-amber-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-amber-200 mb-2">Garagem Bloqueada</h2>
          <p className="text-sm text-purple-300/80 mb-6">
            Você ainda não possui um veículo. Adquira o <strong>Carro de fuga</strong> na loja do bot usando <code>/mercado</code> ou <code>/comprar carro</code> para desbloquear a garagem 3D!
          </p>
        </div>
      </div>
    );
  }

  const catalog = carData?.catalog;

  return (
    <div className="min-h-screen bg-[#06040d] text-purple-100 flex flex-col font-sans selection:bg-purple-600 selection:text-white relative">
      {/* Flash Effect on Photo Shoot */}
      {photoFlash && (
        <div className="fixed inset-0 z-50 bg-white pointer-events-none transition-opacity duration-200 opacity-90" />
      )}

      {/* Top Bar */}
      <header className="border-b border-purple-900/30 bg-[#0c0919]/95 backdrop-blur-md px-4 md:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-30 shadow-lg">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-purple-700 via-indigo-600 to-fuchsia-600 flex items-center justify-center shadow-lg shadow-purple-900/50 border border-white/10">
            <Car className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base md:text-lg font-black tracking-wider text-white uppercase">
                OFICINA VIP <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500">GT TUNING</span>
              </h1>
              <span className="text-[10px] font-black tracking-widest px-2 py-0.5 rounded bg-gradient-to-r from-amber-500 to-orange-500 text-black shadow">
                PR {performance.prScore}
              </span>
            </div>
            <p className="text-xs text-purple-300/70">
              Piloto: <span className="text-white font-semibold">{carData?.owner?.nickname || "Piloto"}</span> | Placa: <span className="font-mono text-purple-300 font-bold">{draft?.plateText || "TMB-2026"}</span>
            </p>
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex items-center gap-2.5">
          {/* Saldo de Moedas */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-950/50 border border-amber-500/40 text-amber-300 font-bold text-sm shadow-inner">
            <Coins className="w-4 h-4 text-amber-400" />
            <span>{carData?.coins ?? 0}</span>
            <span className="text-xs text-amber-400/70 font-normal">coins</span>
          </div>

          {/* Presets Lendários */}
          <button
            type="button"
            onClick={() => setShowPresets(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-900/40 hover:bg-purple-800/50 border border-purple-700/40 text-purple-200 text-xs font-bold transition-all shadow"
            title="Abrir presets lendários de 1 clique"
          >
            <Trophy className="w-3.5 h-3.5 text-amber-400" /> Presets
          </button>

          {/* Dinamômetro */}
          <button
            type="button"
            onClick={() => setShowDyno(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-900/40 hover:bg-purple-800/50 border border-purple-700/40 text-purple-200 text-xs font-bold transition-all shadow"
            title="Ver curva de dinamômetro e telemetria"
          >
            <BarChart3 className="w-3.5 h-3.5 text-cyan-400" /> Dyno
          </button>

          {/* Buzina */}
          <button
            type="button"
            onClick={() => carAudio.playHorn()}
            className="p-2 rounded-xl bg-purple-950/50 border border-purple-800/40 hover:bg-purple-900/40 text-purple-300 transition-colors"
            title="Tocar buzina esportiva bi-tonal"
          >
            <Volume2 className="w-4 h-4 text-amber-400" />
          </button>

          {/* Mute */}
          <button
            type="button"
            onClick={() => {
              const muted = carAudio.toggleMute();
              setIsMuted(muted);
            }}
            className="p-2 rounded-xl bg-purple-950/50 border border-purple-800/40 hover:bg-purple-900/40 text-purple-300 transition-colors"
            title={isMuted ? "Ativar som automotivo" : "Desativar som"}
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-purple-300" />}
          </button>

          {/* Foto HD Direto do Three.js */}
          <button
            type="button"
            onClick={handleCapturePhoto}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white text-xs font-bold shadow-lg shadow-purple-900/50 transition-all"
            title="Tirar foto 4K do modelo 3D com download instantâneo"
          >
            <Camera className="w-3.5 h-3.5" /> Foto 4K
          </button>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Col: 3D Viewport, Telemetria & Controles Cinematográficos (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-4">
          <div className="relative w-full aspect-[16/10] md:aspect-[4/3] max-h-[540px] rounded-2xl overflow-hidden shadow-2xl border border-purple-900/40 bg-[#0c0a16]">
            {draft && (
              <CarStudio3D
                ref={studioRef}
                carState={draft}
                cameraPreset={cameraPreset}
                turntable={turntable}
                doorsOpen={doorsOpen}
                headlightsOn={headlightsOn}
              />
            )}

            {/* Top Overlay: Tacômetro, Acelerar V8 e Controles Interativos */}
            <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
              <div className="flex items-center gap-2 bg-[#0c0a18]/90 backdrop-blur px-3 py-1.5 rounded-xl border border-purple-800/40 pointer-events-auto shadow">
                <Activity className="w-4 h-4 text-fuchsia-400 animate-pulse" />
                <span className="font-mono text-xs font-bold text-purple-200">
                  {rpmDisplay} <span className="text-[10px] text-purple-400/80 font-normal">RPM</span>
                </span>
              </div>

              <div className="flex items-center gap-2 pointer-events-auto">
                {/* Portas Gaivota */}
                <button
                  type="button"
                  onClick={handleToggleDoors}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-all shadow ${
                    doorsOpen
                      ? "bg-purple-600 border-purple-400 text-white"
                      : "bg-[#0c0a18]/90 border-purple-800/40 text-purple-300 hover:bg-purple-900/40"
                  }`}
                  title="Abrir ou fechar portas asas de gaivota"
                >
                  Portas {doorsOpen ? "Abertas" : "Fechadas"}
                </button>

                {/* Faróis On/Off */}
                <button
                  type="button"
                  onClick={() => setHeadlightsOn((h) => !h)}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-bold transition-all shadow ${
                    headlightsOn
                      ? "bg-cyan-600/40 border-cyan-400 text-cyan-200"
                      : "bg-[#0c0a18]/90 border-purple-800/40 text-purple-400 hover:bg-purple-900/40"
                  }`}
                  title="Ligar ou desligar faróis volumétricos"
                >
                  Faróis {headlightsOn ? "ON" : "OFF"}
                </button>

                {/* Acelerar V8 */}
                <button
                  type="button"
                  onClick={handleRevEngine}
                  disabled={isRevving}
                  className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 active:scale-95 text-white font-black text-xs uppercase tracking-wider shadow-lg shadow-red-900/50 transition-all disabled:opacity-75"
                >
                  <Flame className="w-4 h-4 text-yellow-300 animate-bounce" />
                  {isRevving ? "Corte de Giro!" : "Acelerar V8"}
                </button>
              </div>
            </div>

            {/* Bottom Floating Toolbar: Câmera & Turntable */}
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between bg-[#0e0b1c]/90 backdrop-blur px-3 py-2 rounded-xl border border-purple-800/40 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-purple-300/80 font-medium flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5 text-purple-400" /> Câmera:
                </span>
                {(
                  [
                    { id: "iso", label: "Geral" },
                    { id: "front", label: "Frente" },
                    { id: "side", label: "Lado" },
                    { id: "rear", label: "Traseira" },
                    { id: "interior", label: "Cockpit" },
                    { id: "top", label: "Topo" },
                  ] as const
                ).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setCameraPreset(c.id);
                      carAudio.playMechanicalClick();
                    }}
                    className={`px-2.5 py-1 rounded-lg transition-colors ${
                      cameraPreset === c.id
                        ? "bg-purple-600 text-white font-bold shadow"
                        : "text-purple-300 hover:bg-purple-900/50"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              {/* Botão Giro 360 Turntable */}
              <button
                type="button"
                onClick={() => setTurntable((t) => !t)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all ${
                  turntable
                    ? "bg-fuchsia-600/30 border-fuchsia-400 text-fuchsia-200 font-bold"
                    : "border-purple-800/40 text-purple-300 hover:bg-purple-900/40"
                }`}
                title="Girar carro continuamente 360°"
              >
                <RotateCw className={`w-3.5 h-3.5 ${turntable ? "animate-spin" : ""}`} />
                <span>360°</span>
              </button>
            </div>
          </div>

          {/* Telemetria HUD AAA Strip */}
          <div className="grid grid-cols-5 gap-2 bg-[#0f0c1e] border border-purple-900/40 rounded-2xl p-3 shadow-xl text-center">
            <div className="p-1.5 rounded-xl bg-[#17122a]">
              <div className="text-[10px] uppercase font-bold text-purple-400">Potência</div>
              <div className="text-sm font-black text-white">{performance.horsepower} <span className="text-[9px] font-normal text-purple-300">cv</span></div>
            </div>
            <div className="p-1.5 rounded-xl bg-[#17122a]">
              <div className="text-[10px] uppercase font-bold text-purple-400">Vel. Máx</div>
              <div className="text-sm font-black text-white">{performance.topSpeedKmh} <span className="text-[9px] font-normal text-purple-300">km/h</span></div>
            </div>
            <div className="p-1.5 rounded-xl bg-[#17122a]">
              <div className="text-[10px] uppercase font-bold text-purple-400">0 - 100</div>
              <div className="text-sm font-black text-amber-300">{performance.zeroToHundredSec} <span className="text-[9px] font-normal text-purple-300">s</span></div>
            </div>
            <div className="p-1.5 rounded-xl bg-[#17122a]">
              <div className="text-[10px] uppercase font-bold text-purple-400">Handling</div>
              <div className="text-sm font-black text-emerald-400">{performance.handling}/100</div>
            </div>
            <div className="p-1.5 rounded-xl bg-[#17122a]">
              <div className="text-[10px] uppercase font-bold text-purple-400">Estilo</div>
              <div className="text-sm font-black text-fuchsia-400">{performance.styleScore}/100</div>
            </div>
          </div>
        </div>

        {/* Right Col: Painel de Customização da Oficina (5 cols) */}
        <div className="lg:col-span-5 flex flex-col bg-[#100d20] border border-purple-900/40 rounded-2xl p-4 md:p-5 shadow-2xl">
          {/* Navegação de Abas */}
          <div className="grid grid-cols-5 gap-1.5 p-1 bg-[#16112a] rounded-xl border border-purple-900/30 mb-4">
            {(
              [
                { id: "paint", label: "Pintura", icon: Palette },
                { id: "bodykit", label: "Kits", icon: Wrench },
                { id: "wheels", label: "Rodas", icon: Gauge },
                { id: "spoiler", label: "Aero", icon: Zap },
                { id: "suspension", label: "Altura", icon: Layers },
                { id: "neon", label: "Neon", icon: Sparkles },
                { id: "interior", label: "Cockpit", icon: Activity },
                { id: "decals", label: "Adesivos", icon: Flame },
                { id: "tint", label: "Vidros", icon: Eye },
                { id: "plate", label: "Placa", icon: Car },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id);
                    carAudio.playMechanicalClick();
                  }}
                  className={`flex flex-col items-center justify-center py-2 px-1 rounded-lg text-[11px] font-bold transition-all ${
                    isActive
                      ? "bg-gradient-to-b from-purple-600 to-indigo-600 text-white shadow-md shadow-purple-900/50"
                      : "text-purple-300/80 hover:bg-purple-900/30 hover:text-white"
                  }`}
                >
                  <Icon className="w-4 h-4 mb-1" />
                  <span className="truncate w-full text-center">{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Área de Conteúdo da Aba Ativa */}
          <div className="flex-1 overflow-y-auto max-h-[380px] pr-1 space-y-4">
            {/* 1. ABA DE PINTURA E ACABAMENTO */}
            {activeTab === "paint" && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-purple-300 uppercase tracking-wider mb-2 block">
                    Acabamento da Tinta
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {catalog?.finishes?.map((f) => {
                      const selected = (draft?.finish || "glossy") === f.id;
                      return (
                        <button
                          key={f.id}
                          onClick={() => {
                            setDraft((d) => (d ? { ...d, finish: f.id } : null));
                            carAudio.playSprayPaint();
                          }}
                          className={`p-2.5 rounded-xl border text-left transition-all ${
                            selected
                              ? "border-purple-400 bg-purple-900/40 ring-2 ring-purple-500/40"
                              : "border-purple-900/30 hover:border-purple-700/50 bg-[#161129]"
                          }`}
                        >
                          <div className="text-xs font-bold text-white">{f.name}</div>
                          <span className="text-[10px] text-amber-300 font-semibold">
                            {f.cost === 0 ? "Padrão" : `${f.cost} coins`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-purple-300 uppercase tracking-wider mb-2 block">
                    Cor Primária da Carroceria
                  </label>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {catalog?.colors.map((c) => {
                      const selected = draft?.color?.toLowerCase() === c.hex?.toLowerCase();
                      return (
                        <button
                          key={c.id}
                          onClick={() => {
                            setDraft((d) => (d ? { ...d, color: c.hex || d.color } : null));
                            carAudio.playSprayPaint();
                          }}
                          className={`flex flex-col items-center p-2 rounded-xl border text-center transition-all ${
                            selected
                              ? "border-purple-400 bg-purple-900/40 ring-2 ring-purple-500/40"
                              : "border-purple-900/30 hover:border-purple-700/50 bg-[#161129]"
                          }`}
                        >
                          <div
                            className="w-8 h-8 rounded-full border border-white/20 shadow-inner mb-1.5 flex items-center justify-center"
                            style={{ backgroundColor: c.hex || "#fff" }}
                          >
                            {selected && <Check className="w-4 h-4 text-white drop-shadow" />}
                          </div>
                          <span className="text-xs font-medium text-white truncate w-full">{c.name}</span>
                          <span className="text-[10px] text-amber-300 font-semibold mt-0.5">
                            {c.cost === 0 ? "Grátis" : `${c.cost} c`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-3 border-t border-purple-900/30">
                  <label className="text-xs font-bold text-purple-300 uppercase tracking-wider mb-2 block">
                    Cor dos Frisos &amp; Detalhes
                  </label>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {catalog?.secondaryColors.map((c) => {
                      const selected = draft?.secondaryColor?.toLowerCase() === c.hex?.toLowerCase();
                      return (
                        <button
                          key={c.id}
                          onClick={() => {
                            setDraft((d) => (d ? { ...d, secondaryColor: c.hex || d.secondaryColor } : null));
                            carAudio.playSprayPaint();
                          }}
                          className={`flex flex-col items-center p-2 rounded-xl border text-center transition-all ${
                            selected
                              ? "border-purple-400 bg-purple-900/40 ring-2 ring-purple-500/40"
                              : "border-purple-900/30 hover:border-purple-700/50 bg-[#161129]"
                          }`}
                        >
                          <div
                            className="w-8 h-8 rounded-full border border-white/20 shadow-inner mb-1.5 flex items-center justify-center"
                            style={{ backgroundColor: c.hex || "#fff" }}
                          >
                            {selected && <Check className="w-4 h-4 text-white drop-shadow" />}
                          </div>
                          <span className="text-xs font-medium text-white truncate w-full">{c.name}</span>
                          <span className="text-[10px] text-amber-300 font-semibold mt-0.5">
                            {c.cost === 0 ? "Grátis" : `${c.cost} c`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* 2. ABA DE BODYKIT & FARÓIS */}
            {activeTab === "bodykit" && (
              <div className="space-y-3">
                {catalog?.bodykits?.map((b) => {
                  const selected = (draft?.bodykit || "stock") === b.id;
                  return (
                    <button
                      key={b.id}
                      onClick={() => {
                        setDraft((d) => (d ? { ...d, bodykit: b.id } : null));
                        carAudio.playMechanicalClick();
                      }}
                      className={`w-full flex items-center justify-between p-3.5 rounded-xl border text-left transition-all ${
                        selected
                          ? "border-purple-400 bg-purple-900/40 ring-2 ring-purple-500/40"
                          : "border-purple-900/30 hover:border-purple-700/50 bg-[#161129]"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Wrench className={`w-6 h-6 ${selected ? "text-purple-300" : "text-purple-400/60"}`} />
                        <div>
                          <div className="text-xs font-bold text-white">{b.name}</div>
                          <div className="text-[10px] text-purple-300/70">
                            Downforce +{b.downforce} kg | Bônus HP +{b.hpBonus}
                          </div>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-amber-300">
                        {b.cost === 0 ? "Original" : `${b.cost} coins`}
                      </span>
                    </button>
                  );
                })}

                <div className="pt-3 border-t border-purple-900/30">
                  <label className="text-xs font-bold text-purple-300 uppercase tracking-wider mb-2 block">
                    Assinatura Luminosa dos Faróis
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {catalog?.headlights?.map((h) => {
                      const selected = (draft?.headlight || "xenon") === h.id;
                      return (
                        <button
                          key={h.id}
                          onClick={() => {
                            setDraft((d) => (d ? { ...d, headlight: h.id } : null));
                            carAudio.playNeonChime();
                          }}
                          className={`p-2.5 rounded-xl border text-left transition-all ${
                            selected
                              ? "border-purple-400 bg-purple-900/40 ring-2 ring-purple-500/40"
                              : "border-purple-900/30 hover:border-purple-700/50 bg-[#161129]"
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <div
                              className="w-3.5 h-3.5 rounded-full shadow"
                              style={{ backgroundColor: h.hex || "#fff" }}
                            />
                            <div className="text-xs font-bold text-white">{h.name}</div>
                          </div>
                          <span className="text-[10px] text-amber-300 font-semibold">
                            {h.cost === 0 ? "Padrão" : `${h.cost} coins`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* 3. ABA DE RODAS, CAMBER E PINÇAS */}
            {activeTab === "wheels" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {catalog?.wheels.map((w) => {
                    const selected = draft?.wheels === w.id;
                    return (
                      <button
                        key={w.id}
                        onClick={() => {
                          setDraft((d) => (d ? { ...d, wheels: w.id } : null));
                          carAudio.playMechanicalClick();
                        }}
                        className={`flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                          selected
                            ? "border-purple-400 bg-purple-900/40 ring-2 ring-purple-500/40"
                            : "border-purple-900/30 hover:border-purple-700/50 bg-[#161129]"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Gauge className={`w-6 h-6 ${selected ? "text-purple-300" : "text-purple-400/60"}`} />
                          <div>
                            <div className="text-xs font-bold text-white">{w.name}</div>
                            <div className="text-[10px] text-purple-300/70 capitalize">{w.id} series</div>
                          </div>
                        </div>
                        <span className="text-xs font-bold text-amber-300">
                          {w.cost === 0 ? "Original" : `${w.cost} coins`}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Cor das Pinças de Freio Brembo */}
                <div className="pt-3 border-t border-purple-900/30">
                  <label className="text-xs font-bold text-purple-300 uppercase tracking-wider mb-2 block">
                    Cor das Pinças de Freio
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {catalog?.caliperColors?.map((cal) => {
                      const selected = (draft?.caliperColor || "red") === cal.id;
                      return (
                        <button
                          key={cal.id}
                          onClick={() => {
                            setDraft((d) => (d ? { ...d, caliperColor: cal.id } : null));
                            carAudio.playMechanicalClick();
                          }}
                          className={`flex items-center gap-2 p-2 rounded-xl border text-left transition-all ${
                            selected
                              ? "border-purple-400 bg-purple-900/40 ring-2 ring-purple-500/40"
                              : "border-purple-900/30 hover:border-purple-700/50 bg-[#161129]"
                          }`}
                        >
                          <div
                            className="w-4 h-4 rounded-full shadow"
                            style={{ backgroundColor: cal.hex || "#e63946" }}
                          />
                          <span className="text-[11px] font-bold text-white truncate">{cal.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Camber Stance */}
                <div className="pt-3 border-t border-purple-900/30">
                  <label className="text-xs font-bold text-purple-300 uppercase tracking-wider mb-2 block">
                    Alinhamento &amp; Camber (Stance)
                  </label>
                  <div className="space-y-2">
                    {catalog?.cambers?.map((c) => {
                      const selected = (draft?.camber || "neutral") === c.id;
                      return (
                        <button
                          key={c.id}
                          onClick={() => {
                            setDraft((d) => (d ? { ...d, camber: c.id } : null));
                            carAudio.playMechanicalClick();
                          }}
                          className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-left transition-all ${
                            selected
                              ? "border-purple-400 bg-purple-900/40 ring-2 ring-purple-500/40"
                              : "border-purple-900/30 hover:border-purple-700/50 bg-[#161129]"
                          }`}
                        >
                          <span className="text-xs font-bold text-white">{c.name}</span>
                          <span className="text-xs font-bold text-amber-300">
                            {c.cost === 0 ? "Neutro" : `${c.cost} coins`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* 4. ABA DE SPOILER & AERODINÂMICA */}
            {activeTab === "spoiler" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {catalog?.spoilers.map((s) => {
                  const selected = draft?.spoiler === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => {
                        setDraft((d) => (d ? { ...d, spoiler: s.id } : null));
                        carAudio.playMechanicalClick();
                      }}
                      className={`flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                        selected
                          ? "border-purple-400 bg-purple-900/40 ring-2 ring-purple-500/40"
                          : "border-purple-900/30 hover:border-purple-700/50 bg-[#161129]"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Zap className={`w-6 h-6 ${selected ? "text-purple-300" : "text-purple-400/60"}`} />
                        <div>
                          <div className="text-xs font-bold text-white">{s.name}</div>
                          <div className="text-[10px] text-purple-300/70">Downforce traseiro</div>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-amber-300">
                        {s.cost === 0 ? "Padrão" : `${s.cost} coins`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* 5. ABA DE SUSPENSÃO */}
            {activeTab === "suspension" && (
              <div className="space-y-2.5">
                {catalog?.suspensions.map((sus) => {
                  const selected = draft?.suspension === sus.id;
                  return (
                    <button
                      key={sus.id}
                      onClick={() => {
                        setDraft((d) => (d ? { ...d, suspension: sus.id } : null));
                        carAudio.playSuspensionAir();
                      }}
                      className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                        selected
                          ? "border-purple-400 bg-purple-900/40 ring-2 ring-purple-500/40"
                          : "border-purple-900/30 hover:border-purple-700/50 bg-[#161129]"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Layers className={`w-5 h-5 ${selected ? "text-purple-300" : "text-purple-400/60"}`} />
                        <div>
                          <div className="text-xs font-bold text-white">{sus.name}</div>
                          <div className="text-[10px] text-purple-300/70">
                            Ajuste de altura do centro de gravidade
                          </div>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-amber-300">
                        {sus.cost === 0 ? "Original" : `${sus.cost} coins`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* 6. ABA DE NEON */}
            {activeTab === "neon" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {catalog?.neon.map((n) => {
                  const selected = draft?.neon === n.id;
                  return (
                    <button
                      key={n.id}
                      onClick={() => {
                        setDraft((d) => (d ? { ...d, neon: n.id } : null));
                        carAudio.playNeonChime();
                      }}
                      className={`flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                        selected
                          ? "border-purple-400 bg-purple-900/40 ring-2 ring-purple-500/40"
                          : "border-purple-900/30 hover:border-purple-700/50 bg-[#161129]"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-4 h-4 rounded-full border border-white/40 shadow-lg"
                          style={{ backgroundColor: n.hex || "#333" }}
                        />
                        <span className="text-xs font-bold text-white">{n.name}</span>
                      </div>
                      <span className="text-xs font-bold text-amber-300">
                        {n.cost === 0 ? "Desligado" : `${n.cost} coins`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* 7. ABA DE COCKPIT & GAIOLA */}
            {activeTab === "interior" && (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-purple-300 uppercase tracking-wider mb-2 block">
                    Tapeçaria dos Bancos Concha
                  </label>
                  <div className="space-y-2">
                    {catalog?.interiors?.map((i) => {
                      const selected = (draft?.interior || "black_leather") === i.id;
                      return (
                        <button
                          key={i.id}
                          onClick={() => {
                            setDraft((d) => (d ? { ...d, interior: i.id } : null));
                            carAudio.playMechanicalClick();
                          }}
                          className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                            selected
                              ? "border-purple-400 bg-purple-900/40 ring-2 ring-purple-500/40"
                              : "border-purple-900/30 hover:border-purple-700/50 bg-[#161129]"
                          }`}
                        >
                          <span className="text-xs font-bold text-white">{i.name}</span>
                          <span className="text-xs font-bold text-amber-300">
                            {i.cost === 0 ? "Padrão" : `${i.cost} coins`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-3 border-t border-purple-900/30">
                  <label className="text-xs font-bold text-purple-300 uppercase tracking-wider mb-2 block">
                    Gaiola de Proteção (Roll Cage FIA)
                  </label>
                  <div className="space-y-2">
                    {catalog?.rollCages?.map((r) => {
                      const selected = (draft?.rollCage || "none") === r.id;
                      return (
                        <button
                          key={r.id}
                          onClick={() => {
                            setDraft((d) => (d ? { ...d, rollCage: r.id } : null));
                            carAudio.playMechanicalClick();
                          }}
                          className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                            selected
                              ? "border-purple-400 bg-purple-900/40 ring-2 ring-purple-500/40"
                              : "border-purple-900/30 hover:border-purple-700/50 bg-[#161129]"
                          }`}
                        >
                          <span className="text-xs font-bold text-white">{r.name}</span>
                          <span className="text-xs font-bold text-amber-300">
                            {r.cost === 0 ? "Nenhuma" : `${r.cost} coins`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* 8. ABA DE ADESIVOS */}
            {activeTab === "decals" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {catalog?.decals.map((d) => {
                  const selected = draft?.decal === d.id;
                  return (
                    <button
                      key={d.id}
                      onClick={() => {
                        setDraft((prev) => (prev ? { ...prev, decal: d.id } : null));
                        carAudio.playSprayPaint();
                      }}
                      className={`flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                        selected
                          ? "border-purple-400 bg-purple-900/40 ring-2 ring-purple-500/40"
                          : "border-purple-900/30 hover:border-purple-700/50 bg-[#161129]"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Flame className={`w-5 h-5 ${selected ? "text-amber-400" : "text-purple-400/60"}`} />
                        <span className="text-xs font-bold text-white">{d.name}</span>
                      </div>
                      <span className="text-xs font-bold text-amber-300">
                        {d.cost === 0 ? "Nenhum" : `${d.cost} coins`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* 9. ABA DE VIDROS (INSULFILM) */}
            {activeTab === "tint" && (
              <div className="space-y-2.5">
                {catalog?.windowTints.map((t) => {
                  const selected = draft?.windowTint === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => {
                        setDraft((prev) => (prev ? { ...prev, windowTint: t.id } : null));
                        carAudio.playMechanicalClick();
                      }}
                      className={`w-full flex items-center justify-between p-3 rounded-xl border text-left transition-all ${
                        selected
                          ? "border-purple-400 bg-purple-900/40 ring-2 ring-purple-500/40"
                          : "border-purple-900/30 hover:border-purple-700/50 bg-[#161129]"
                      }`}
                    >
                      <span className="text-xs font-bold text-white">{t.name}</span>
                      <span className="text-xs font-bold text-amber-300">
                        {t.cost === 0 ? "Original" : `${t.cost} coins`}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* 10. ABA DE PLACA */}
            {activeTab === "plate" && (
              <div className="space-y-3 bg-[#151026] p-4 rounded-xl border border-purple-900/30">
                <label className="text-xs font-bold text-purple-300 block">
                  Letras e Números da Placa Mercosul/VIP (Máx 8 Caracteres)
                </label>
                <input
                  type="text"
                  maxLength={8}
                  value={draft?.plateText || ""}
                  onChange={(e) => {
                    const clean = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 8);
                    setDraft((d) => (d ? { ...d, plateText: clean } : null));
                  }}
                  placeholder="EX: TMB-2026"
                  className="w-full font-mono text-center text-lg uppercase font-bold tracking-widest bg-[#0a0715] border border-purple-700/60 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <p className="text-[11px] text-purple-300/60">
                  A placa personalizada é gravada em alto relevo e impressa diretamente nas fotos e stickers do WhatsApp.
                </p>
              </div>
            )}
          </div>

          {/* Feedback Messages */}
          {error && (
            <div className="mt-3 p-3 rounded-xl bg-red-950/50 border border-red-800/60 text-red-200 text-xs flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="mt-3 p-3 rounded-xl bg-emerald-950/50 border border-emerald-800/60 text-emerald-200 text-xs flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          {/* Checkout & Action Footer */}
          <div className="mt-4 pt-4 border-t border-purple-900/30 flex flex-col gap-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-purple-300 font-semibold">Custo total das alterações:</span>
              <span className={`font-black text-sm ${quote.total > (carData?.coins ?? 0) ? "text-red-400" : "text-amber-300"}`}>
                {quote.total === 0 ? "Sem custo adicional" : `${quote.total} coins`}
              </span>
            </div>

            {quote.items.length > 0 && (
              <div className="text-[11px] text-purple-300/80 bg-[#161129] px-3 py-2 rounded-xl border border-purple-900/20">
                Peças adicionadas: {quote.items.map((i) => i.name).join(", ")}
              </div>
            )}

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={handleReset}
                disabled={!hasChanges || saving}
                className="px-4 py-2.5 rounded-xl border border-purple-800/40 bg-purple-950/30 hover:bg-purple-900/40 text-purple-300 text-xs font-semibold disabled:opacity-40 transition-colors flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Desfazer
              </button>

              <button
                type="button"
                onClick={handleSave}
                disabled={!hasChanges || saving || !canAfford}
                className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 via-indigo-600 to-fuchsia-600 hover:from-purple-500 hover:to-fuchsia-500 text-white font-black text-sm shadow-lg shadow-purple-900/50 disabled:opacity-40 transition-all flex items-center justify-center gap-2"
              >
                <Save className="w-4 h-4" />
                {saving ? "Gravando na Oficina..." : "Instalar Peças"}
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* MODAL: PRESETS LENDÁRIOS */}
      {showPresets && (
        <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-2xl w-full bg-[#120e24] border border-purple-700/50 rounded-2xl p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-purple-900/40 pb-3">
              <div className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-black text-white uppercase tracking-wider">
                  PRESETS DE PILOTOS LENDÁRIOS
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowPresets(false)}
                className="p-1 rounded-lg text-purple-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {CAR_PRESETS.map((p) => (
                <div
                  key={p.id}
                  className="bg-[#18132f] border border-purple-900/40 hover:border-purple-600/60 p-4 rounded-xl flex flex-col justify-between gap-3 transition-all"
                >
                  <div>
                    <h4 className="font-bold text-sm text-white flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-purple-400" />
                      {p.name}
                    </h4>
                    <p className="text-xs text-purple-300/70 mt-1">{p.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(p.config)}
                    className="w-full py-2 px-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs shadow transition-all flex items-center justify-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" /> Aplicar Estilo
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: DINAMÔMETRO (DYNO CURVE) */}
      {showDyno && (
        <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-xl w-full bg-[#120e24] border border-cyan-800/50 rounded-2xl p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-purple-900/40 pb-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-cyan-400" />
                <h3 className="text-base font-black text-white uppercase tracking-wider">
                  BANCADA DINAMOMÉTRICA (DYNO TEST)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowDyno(false)}
                className="p-1 rounded-lg text-purple-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-center">
              <div className="p-3 bg-[#18132f] rounded-xl border border-purple-900/40">
                <div className="text-xs text-purple-300 font-bold uppercase">Potência Máxima</div>
                <div className="text-xl font-black text-cyan-300">{dyno.peakHp} cv</div>
              </div>
              <div className="p-3 bg-[#18132f] rounded-xl border border-purple-900/40">
                <div className="text-xs text-purple-300 font-bold uppercase">Torque Máximo</div>
                <div className="text-xl font-black text-amber-300">{dyno.peakTorque} Nm</div>
              </div>
            </div>

            {/* SVG Dyno Curve */}
            <div className="bg-[#090714] p-3 rounded-xl border border-purple-900/50">
              <svg viewBox="0 0 500 220" className="w-full h-44">
                {/* Linhas de grade */}
                <line x1="40" y1="20" x2="480" y2="20" stroke="#251a3f" strokeWidth="1" />
                <line x1="40" y1="65" x2="480" y2="65" stroke="#251a3f" strokeWidth="1" />
                <line x1="40" y1="110" x2="480" y2="110" stroke="#251a3f" strokeWidth="1" />
                <line x1="40" y1="155" x2="480" y2="155" stroke="#251a3f" strokeWidth="1" />
                <line x1="40" y1="200" x2="480" y2="200" stroke="#3d2c60" strokeWidth="1.5" />

                {/* Curva de Torque (Amarelo) */}
                <polyline
                  fill="none"
                  stroke="#ffd166"
                  strokeWidth="3"
                  points={dyno.points
                    .map((pt, idx) => `${40 + (idx * 440) / (dyno.points.length - 1)},${200 - (pt.torque / (dyno.peakTorque * 1.15)) * 180}`)
                    .join(" ")}
                />

                {/* Curva de Potência HP (Ciano) */}
                <polyline
                  fill="none"
                  stroke="#00f0ff"
                  strokeWidth="3"
                  points={dyno.points
                    .map((pt, idx) => `${40 + (idx * 440) / (dyno.points.length - 1)},${200 - (pt.hp / (dyno.peakHp * 1.15)) * 180}`)
                    .join(" ")}
                />

                <text x="45" y="16" fill="#00f0ff" fontSize="10" fontWeight="bold">Potência (CV)</text>
                <text x="140" y="16" fill="#ffd166" fontSize="10" fontWeight="bold">Torque (Nm)</text>
                <text x="440" y="214" fill="#a49bc2" fontSize="9" textAnchor="middle">8000 RPM</text>
              </svg>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
