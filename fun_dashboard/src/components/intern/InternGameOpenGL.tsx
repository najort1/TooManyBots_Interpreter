"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  InternOpenGLRenderer,
  ItemTaskInfo
} from "./InternOpenGLRenderer";
import { CameraMode } from "./glCamera";
import { soundEngine } from "@/lib/soundEngine";

export const TASKS: ItemTaskInfo[] = [
  { id: "contrato", label: "📄", good: true, name: "Contrato Assinado" },
  { id: "pasta", label: "📁", good: true, name: "Pasta de Processo" },
  { id: "cafe", label: "☕", good: false, name: "Café Quente" },
  { id: "grampo", label: "📎", good: true, name: "Documento com Grampo" },
  { id: "spam", label: "🗑️", good: false, name: "Lixo de Escritório" },
  { id: "email", label: "✉️", good: true, name: "Ofício com Lacre" },
  { id: "meme", label: "🐸", good: false, name: "Meme do Sapo" },
  { id: "cracha", label: "🪪", good: true, name: "Crachá do Diretor" },
];

export interface InternGameOpenGLProps {
  config?: {
    durationMs?: number;
    targetScore?: number;
    maxMistakes?: number;
  };
  onDone: (score: number, metrics: Record<string, number>) => void;
}

export function InternGameOpenGL({ config, onDone }: InternGameOpenGLProps) {
  const target = config?.targetScore ?? 8;
  const maxMistakes = config?.maxMistakes ?? 3;
  const durationMs = config?.durationMs ?? 60_000;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<InternOpenGLRenderer | null>(null);

  const [score, setScore] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [left, setLeft] = useState(Math.ceil(durationMs / 1000));
  const [tile, setTile] = useState<ItemTaskInfo>(TASKS[0]);
  const [cameraMode, setCameraMode] = useState<CameraMode>("isometric");
  const [toast, setToast] = useState<{ text: string; type: "ok" | "err" | "info" } | null>(null);
  const [isWebGLSupported, setIsWebGLSupported] = useState(true);

  const doneRef = useRef(false);
  const scoreRef = useRef(0);
  const mistakesRef = useRef(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showToast = useCallback((text: string, type: "ok" | "err" | "info") => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast({ text, type });
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
    }, 1800);
  }, []);

  const getRandomTask = useCallback((prevId?: string): ItemTaskInfo => {
    const candidates = TASKS.filter((t) => t.id !== prevId);
    return candidates[Math.floor(Math.random() * candidates.length)];
  }, []);

  const finishGame = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    const finalScore = scoreRef.current;
    const finalMistakes = mistakesRef.current;

    if (finalScore >= target && finalMistakes <= maxMistakes) {
      soundEngine.playCelebrationSound();
    } else {
      soundEngine.playErrorSound();
    }

    onDoneRef.current(finalScore, { mistakes: finalMistakes });
  }, [target, maxMistakes]);

  // Inicialização do WebGL2 Renderer
  useEffect(() => {
    if (!canvasRef.current) return;

    const renderer = new InternOpenGLRenderer();
    const ok = renderer.init(canvasRef.current);
    if (!ok) {
      setIsWebGLSupported(false);
      return;
    }

    rendererRef.current = renderer;
    renderer.setItem(tile);
    renderer.setCameraMode("isometric");

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === canvasRef.current && rendererRef.current) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            rendererRef.current.resize(width, height);
          }
        }
      }
    });

    resizeObserver.observe(canvasRef.current);

    return () => {
      resizeObserver.disconnect();
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  // Timer do Jogo
  useEffect(() => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const rem = Math.max(0, Math.ceil((durationMs - (Date.now() - t0)) / 1000));
      setLeft(rem);
      if (rem <= 0 && !doneRef.current) {
        finishGame();
      }
    }, 200);
    return () => clearInterval(iv);
  }, [durationMs, finishGame]);

  // Ação de Protocolar (Stamp / Carimbo no Scanner)
  const handleProtocolar = useCallback(() => {
    if (doneRef.current) return;
    const currentItem = tile;

    if (currentItem.good) {
      // Protocolo Correto!
      scoreRef.current += 1;
      setScore(scoreRef.current);
      soundEngine.playStampSound();
      soundEngine.playScannerLaserSound();

      if (rendererRef.current) {
        rendererRef.current.triggerAction("stamp");
        rendererRef.current.triggerAction("scan");
      }

      showToast("+1 PROTOCOLADO (" + currentItem.name + ")", "ok");

      if (scoreRef.current >= target) {
        setTimeout(() => {
          finishGame();
        }, 500);
        return;
      }
    } else {
      // Erro! Protocolou item inútil / lixo!
      mistakesRef.current += 1;
      setMistakes(mistakesRef.current);
      soundEngine.playErrorSound();

      if (rendererRef.current) {
        rendererRef.current.triggerAction("error");
      }

      showToast("ADVERTÊNCIA: " + currentItem.name + " não deve ser protocolado!", "err");

      if (mistakesRef.current > maxMistakes) {
        setTimeout(() => {
          finishGame();
        }, 600);
        return;
      }
    }

    const next = getRandomTask(tile.id);
    setTile(next);
    setTimeout(() => {
      if (rendererRef.current && !doneRef.current) {
        rendererRef.current.setItem(next);
      }
    }, 250);
  }, [tile, target, maxMistakes, finishGame, getRandomTask, showToast]);

  // Ação de Próximo / Pular / Descartar
  const handleNext = useCallback(() => {
    if (doneRef.current) return;
    const currentItem = tile;

    if (!currentItem.good) {
      // Descarte Correto de Lixo/Café
      soundEngine.playDiscardSound();
      if (rendererRef.current) {
        rendererRef.current.triggerAction("next");
      }
      showToast("Descartado: " + currentItem.name, "info");
    } else {
      // Descartou documento útil (não soma ponto mas dá feedback)
      soundEngine.playDiscardSound();
      if (rendererRef.current) {
        rendererRef.current.triggerAction("next");
      }
      showToast("Aviso: Documento válido ignorado", "info");
    }

    const next = getRandomTask(tile.id);
    setTile(next);
    setTimeout(() => {
      if (rendererRef.current && !doneRef.current) {
        rendererRef.current.setItem(next);
      }
    }, 200);
  }, [tile, getRandomTask, showToast]);

  // Alternar Câmera 3D
  const handleCameraChange = useCallback((mode: CameraMode) => {
    setCameraMode(mode);
    if (rendererRef.current) {
      rendererRef.current.setCameraMode(mode);
    }
  }, []);

  // Atalhos de Teclado
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "Enter" || e.key === " " || e.key.toLowerCase() === "p") {
        e.preventDefault();
        handleProtocolar();
      } else if (e.key === "ArrowRight" || e.key === "Backspace" || e.key === "Delete" || e.key.toLowerCase() === "n") {
        e.preventDefault();
        handleNext();
      } else if (e.key === "1") {
        handleCameraChange("isometric");
      } else if (e.key === "2") {
        handleCameraChange("first_person");
      } else if (e.key === "3") {
        handleCameraChange("action");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleProtocolar, handleNext, handleCameraChange]);

  // Click no canvas (Raycast simulado / toque direto no objeto 3D)
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;

    // Região central / superior = objeto no scanner
    if (y < h * 0.8) {
      if (x < w * 0.35) {
        // Lado esquerdo da mesa = gaveta / descarte
        handleNext();
      } else {
        // Centro e scanner = protocolar item
        handleProtocolar();
      }
    }
  };

  const progressPercent = Math.min(100, Math.round((score / target) * 100));
  const mistakeSlots = Array.from({ length: maxMistakes + 1 }, (_, i) => i < mistakes);

  return (
    <div className="relative flex flex-col items-center w-full h-[calc(100dvh-5.5rem)] max-h-[900px] min-h-[520px] select-none font-sans text-zinc-100">
      {/* HUD SUPERIOR: Status, Tempo & Progresso Compacto */}
      <header className="w-full flex-shrink-0 mb-2 bg-zinc-900/90 backdrop-blur-md rounded-2xl border border-zinc-800/80 px-4 py-2.5 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          {/* Meta & Pontos */}
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 font-bold font-mono text-base">
              {score}/{target}
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold tracking-wider text-zinc-400">Meta</p>
              <p className="text-xs font-semibold text-zinc-200">
                {score >= target ? "✅ Concluído!" : "Faltam " + (target - score)}
              </p>
            </div>
          </div>

          {/* Toast / Alerta Central Discreto */}
          <div className="flex-1 max-w-xs text-center px-2">
            {toast ? (
              <span
                className={
                  "inline-block px-3 py-1 rounded-full text-xs font-bold transition-all shadow-md " +
                  (toast.type === "ok"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-emerald-500/10"
                    : toast.type === "err"
                    ? "bg-red-500/20 text-red-300 border border-red-500/40 shadow-red-500/10 animate-shake"
                    : "bg-blue-500/20 text-blue-300 border border-blue-500/40")
                }
              >
                {toast.text}
              </span>
            ) : (
              <span className="text-[11px] font-medium text-zinc-500 hidden sm:inline-block">
                Espaço / Enter = Protocolar · Del = Pular
              </span>
            )}
          </div>

          {/* Relógio do Turno */}
          <div className="flex items-center gap-2 bg-zinc-950/80 px-3 py-1.5 rounded-xl border border-zinc-800">
            <span className={"text-xs " + (left <= 10 ? "animate-ping text-red-400" : "text-amber-400")}>⏱️</span>
            <span className={"font-mono text-sm font-extrabold tabular-nums " + (left <= 10 ? "text-red-400 animate-pulse" : "text-zinc-100")}>
              {left}s
            </span>
          </div>

          {/* Medidor de Advertências do RH */}
          <div className="text-right">
            <p className="text-[10px] uppercase font-bold tracking-wider text-zinc-400">Advertências</p>
            <div className="flex items-center justify-end gap-1.5 mt-0.5">
              {mistakeSlots.map((isUsed, idx) => (
                <span
                  key={idx}
                  className={
                    "inline-block w-2.5 h-2.5 rounded-full transition-all duration-300 " +
                    (isUsed ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)] scale-110" : "bg-zinc-700/60 border border-zinc-600")
                  }
                  title={"Erro " + (idx + 1) + "/" + (maxMistakes + 1)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Barra de Progresso do Protocolo */}
        <div className="w-full bg-zinc-950 rounded-full h-1.5 overflow-hidden border border-zinc-800 mt-2">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 via-blue-500 to-emerald-400 transition-all duration-300 shadow-[0_0_10px_rgba(6,182,212,0.5)]"
            style={{ width: progressPercent + "%" }}
          />
        </div>
      </header>

      {/* VIEWPORT 3D OPENGL/WEBGL2 EXPANDIDO (TELA CHEIA RESPONSIVA) */}
      <main className="relative flex-1 w-full min-h-[340px] rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-950 shadow-2xl">
        {!isWebGLSupported ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-zinc-900 text-zinc-300">
            <p className="text-3xl mb-2">⚠️</p>
            <h3 className="font-semibold text-lg text-red-400">WebGL2 Não Suportado</h3>
            <p className="text-xs text-zinc-400 mt-1">
              Seu navegador não possui suporte ativo à aceleração por hardware WebGL2 / OpenGL ES 3.0.
            </p>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            className="w-full h-full cursor-pointer active:scale-[0.999] transition-transform duration-75 block object-cover"
          />
        )}

        {/* CONTROLE DISCRETO DE CÂMERA 3D (Canto Superior Esquerdo) */}
        <div className="absolute top-3 left-3 flex gap-1 bg-zinc-950/70 backdrop-blur-md p-1 rounded-xl border border-zinc-800/80 shadow-md">
          <button
            type="button"
            onClick={() => handleCameraChange("isometric")}
            className={
              "px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors " +
              (cameraMode === "isometric" ? "bg-cyan-500 text-zinc-950 shadow" : "text-zinc-400 hover:text-zinc-200")
            }
            title="Câmera Isométrica (Tecla 1)"
          >
            🎥 Iso
          </button>
          <button
            type="button"
            onClick={() => handleCameraChange("first_person")}
            className={
              "px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors " +
              (cameraMode === "first_person" ? "bg-cyan-500 text-zinc-950 shadow" : "text-zinc-400 hover:text-zinc-200")
            }
            title="Câmera Primeira Pessoa (Tecla 2)"
          >
            👀 1ª Pessoa
          </button>
          <button
            type="button"
            onClick={() => handleCameraChange("action")}
            className={
              "px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors " +
              (cameraMode === "action" ? "bg-cyan-500 text-zinc-950 shadow" : "text-zinc-400 hover:text-zinc-200")
            }
            title="Câmera de Ação (Tecla 3)"
          >
            ⚡ Ação
          </button>
        </div>

        {/* IDENTIFICAÇÃO DISCRETA DO ITEM ATUAL NO SCANNER (Canto Superior Direito) */}
        <div className="absolute top-3 right-3 flex items-center gap-2 bg-zinc-950/75 backdrop-blur-md px-3 py-1.5 rounded-xl border border-zinc-800/80 shadow-md">
          <span className="text-xl">{tile.label}</span>
          <div className="text-right">
            <p className="text-[10px] uppercase font-bold text-zinc-400">{tile.name}</p>
            <p className={"text-[11px] font-extrabold " + (tile.good ? "text-emerald-400" : "text-amber-400")}>
              {tile.good ? "✓ PROTOCOLAR" : "✕ DESCARTAR"}
            </p>
          </div>
        </div>
      </main>

      {/* PAINEL INFERIOR: Botões de Controle Grandes e Responsivos */}
      <footer className="w-full flex-shrink-0 grid grid-cols-2 gap-3 mt-2">
        <button
          type="button"
          onClick={handleProtocolar}
          className="relative group min-h-[58px] sm:min-h-[64px] rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 active:scale-[0.98] text-white font-bold text-base shadow-lg shadow-emerald-900/30 border border-emerald-400/30 transition-all flex flex-col items-center justify-center cursor-pointer"
          aria-label="Protocolar documento no Scanner 3D"
        >
          <span className="flex items-center gap-2 text-base sm:text-lg">
            <span>🖋️</span> Protocolar
          </span>
          <span className="text-[11px] text-emerald-200 font-normal tracking-wide">[Espaço / Enter]</span>
        </button>

        <button
          type="button"
          onClick={handleNext}
          className="relative group min-h-[58px] sm:min-h-[64px] rounded-2xl bg-zinc-800 hover:bg-zinc-700 active:scale-[0.98] text-zinc-200 font-bold text-base shadow-md border border-zinc-700 transition-all flex flex-col items-center justify-center cursor-pointer"
          aria-label="Pular ou descartar item inútil"
        >
          <span className="flex items-center gap-2 text-base sm:text-lg">
            <span>🗑️</span> Próximo / Pular
          </span>
          <span className="text-[11px] text-zinc-400 font-normal tracking-wide">[Seta Direita / Del]</span>
        </button>
      </footer>
    </div>
  );
}
