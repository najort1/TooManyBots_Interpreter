"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Cell = {
  /** 0 = ok · 1–4 fogo · -1 cinzas */
  heat: number;
  splash: number;
  key: number;
};

type Props = {
  config?: {
    durationMs?: number;
    targetScore?: number;
    maxLostHouses?: number;
  };
  onDone: (score: number, metrics: Record<string, number>) => void;
};

const COLS = 4;
const ROWS = 4;
const N = COLS * ROWS;
const MAX_HEAT = 4;

function emptyBoard(): Cell[] {
  return Array.from({ length: N }, () => ({ heat: 0, splash: 0, key: 0 }));
}

function neighbors(i: number): number[] {
  const r = Math.floor(i / COLS);
  const c = i % COLS;
  const out: number[] = [];
  if (c > 0) out.push(i - 1);
  if (c < COLS - 1) out.push(i + 1);
  if (r > 0) out.push(i - COLS);
  if (r < ROWS - 1) out.push(i + COLS);
  return out;
}

function heatLabel(h: number): string {
  if (h < 0) return "⬛";
  if (h === 0) return "🏠";
  if (h === 1) return "🕯️";
  if (h === 2) return "🔥";
  if (h === 3) return "🔥";
  return "💥";
}

function heatClass(h: number): string {
  if (h < 0) return "bg-zinc-800/80 border-zinc-700 opacity-70";
  if (h === 0) return "bg-zinc-800/40 border-zinc-700/80";
  if (h === 1) return "bg-amber-900/50 border-amber-600/60 fire-pulse-sm";
  if (h === 2) return "bg-orange-800/60 border-orange-500 fire-pulse";
  if (h === 3) return "bg-orange-700/70 border-orange-400 fire-pulse";
  return "bg-red-700/70 border-red-400 fire-pulse-hard";
}

/**
 * Bombeiro — médio, partida LONGA:
 * - ~90s + meta decente → clique rápido no começo não zera o teste
 * - fases escalam com o tempo (e com o progresso da meta)
 * - cada toque −1 calor
 */
export function FireGame({ config, onDone }: Props) {
  const target = config?.targetScore ?? 20;
  const maxLost = config?.maxLostHouses ?? 3;
  const durationMs = config?.durationMs ?? 90_000;

  const [cells, setCells] = useState<Cell[]>(emptyBoard);
  const [score, setScore] = useState(0);
  const [lost, setLost] = useState(0);
  const [combo, setCombo] = useState(0);
  const [left, setLeft] = useState(Math.ceil(durationMs / 1000));
  const [banner, setBanner] = useState("Toque nas chamas · fogo forte pede + toques");
  const [shake, setShake] = useState(false);
  const [flashRed, setFlashRed] = useState(false);

  const done = useRef(false);
  const scoreRef = useRef(0);
  const lostRef = useRef(0);
  const comboRef = useRef(0);
  const t0 = useRef(Date.now());
  const tickCount = useRef(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const finish = useCallback((s: number, lostHouses: number) => {
    if (done.current) return;
    done.current = true;
    onDoneRef.current(s, { lostHouses });
  }, []);

  useEffect(() => {
    t0.current = Date.now();

    const timerIv = setInterval(() => {
      if (done.current) return;
      const rem = Math.max(0, Math.ceil((durationMs - (Date.now() - t0.current)) / 1000));
      setLeft(rem);
      if (rem <= 0) finish(scoreRef.current, lostRef.current);
    }, 100);

    const gameIv = setInterval(() => {
      if (done.current) return;
      tickCount.current += 1;
      const t = tickCount.current;
      // fase por tempo (~90s, tick ~540ms → ~165 ticks) + progresso da meta
      // assim não dá pra “acabar o jogo” só na fase fácil
      const elapsed = Date.now() - t0.current;
      const timePhase = elapsed < 26_000 ? 0 : elapsed < 57_000 ? 1 : 2;
      const progressPhase =
        scoreRef.current < target * 0.37 ? 0 : scoreRef.current < target * 0.72 ? 1 : 2;
      const phase = Math.max(timePhase, progressPhase);
      // −0.1 vs. último ajuste (spawn / pressão)
      const spawnChance = [0.32, 0.46, 0.59][phase];
      const maxSpawn = [1, 2, 2][phase];
      const heatStart = [1, 1, 2][phase];
      const spreadChance = [0.03, 0.08, 0.14][phase];
      const heatEvery = phase === 0 ? 2 : 1;

      setCells((prev) => {
        const next = prev.map((c) => ({
          ...c,
          splash: Math.max(0, c.splash - 1),
        }));

        for (let i = 0; i < N; i++) {
          if (next[i].heat > 0 && t % heatEvery === 0) {
            next[i] = {
              ...next[i],
              heat: Math.min(MAX_HEAT, next[i].heat + 1),
              key: next[i].key + 1,
            };
          }
          // no máximo: chance de virar cinza (−0.1 vs. 0.17)
          if (next[i].heat >= MAX_HEAT && Math.random() < 0.07) {
            next[i] = { heat: -1, splash: 0, key: next[i].key + 1 };
            lostRef.current += 1;
            setLost(lostRef.current);
            setFlashRed(true);
            setShake(true);
            setTimeout(() => {
              setFlashRed(false);
              setShake(false);
            }, 280);
            setBanner("Casa perdida! 💀");
            if (lostRef.current > maxLost) {
              setTimeout(() => finish(scoreRef.current, lostRef.current), 0);
            }
          }
        }

        // spread
        const toIgnite: number[] = [];
        for (let i = 0; i < N; i++) {
          if (next[i].heat >= 3 && Math.random() < spreadChance) {
            const ns = neighbors(i).filter((j) => next[j].heat === 0);
            if (ns.length) toIgnite.push(ns[Math.floor(Math.random() * ns.length)]);
          }
        }
        for (const j of toIgnite) {
          if (next[j].heat === 0) {
            next[j] = { heat: 1, splash: 0, key: next[j].key + 1 };
          }
        }

        // spawn
        let spawned = 0;
        const empty = next
          .map((c, i) => (c.heat === 0 ? i : -1))
          .filter((i) => i >= 0);
        while (spawned < maxSpawn && empty.length && Math.random() < spawnChance) {
          const idx = Math.floor(Math.random() * empty.length);
          const i = empty.splice(idx, 1)[0];
          next[i] = {
            heat: heatStart + (phase >= 2 && Math.random() < 0.15 ? 1 : 0),
            splash: 0,
            key: next[i].key + 1,
          };
          spawned += 1;
        }

        // não deixa o mapa morto no fim
        const burning = next.filter((c) => c.heat > 0).length;
        if (burning === 0 && empty.length) {
          const i = empty[Math.floor(Math.random() * empty.length)];
          next[i] = { heat: heatStart, splash: 0, key: next[i].key + 1 };
        }

        return next;
      });
    }, 540);

    // duas faíscas iniciais
    setCells((prev) => {
      const next = prev.slice();
      next[5] = { heat: 1, splash: 0, key: 1 };
      next[10] = { heat: 1, splash: 0, key: 1 };
      return next;
    });

    return () => {
      clearInterval(timerIv);
      clearInterval(gameIv);
    };
  }, [durationMs, maxLost, finish]);

  const extinguish = (i: number) => {
    if (done.current) return;
    setCells((prev) => {
      const cell = prev[i];
      if (!cell || cell.heat <= 0) {
        comboRef.current = 0;
        setCombo(0);
        return prev;
      }

      const next = prev.slice();
      // sempre −1: fogo forte exige vários jatos (skill)
      const newHeat = cell.heat - 1;

      if (newHeat <= 0) {
        next[i] = { heat: 0, splash: 4, key: cell.key + 1 };
        scoreRef.current += 1;
        comboRef.current += 1;
        setScore(scoreRef.current);
        setCombo(comboRef.current);
        setBanner(comboRef.current >= 3 ? `Combo ×${comboRef.current}! 💧` : "Foco apagado!");
        if (scoreRef.current >= target) {
          setTimeout(() => finish(scoreRef.current, lostRef.current), 120);
        }
      } else {
        next[i] = { heat: newHeat, splash: 3, key: cell.key + 1 };
        setBanner(newHeat >= 3 ? "Ainda forte!" : "Quase…");
      }
      return next;
    });
  };

  const progress = Math.min(1, score / target);
  const timePct = left / Math.ceil(durationMs / 1000);
  const urgent = left <= 12;

  return (
    <div
      className={`fire-stage relative -mx-4 px-4 pb-6 pt-1 ${shake ? "fire-shake" : ""} ${
        flashRed ? "fire-flash-red" : ""
      }`}
    >
      <div className="pointer-events-none absolute inset-0 fire-sky" aria-hidden />

      <div className="relative z-10 space-y-3">
        <div className="rounded-xl border border-zinc-700/80 bg-zinc-900/80 p-3 backdrop-blur-sm">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Focos apagados
              </p>
              <p className="text-2xl font-semibold tabular-nums text-zinc-50">
                {score}
                <span className="text-base font-normal text-zinc-500">/{target}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Tempo
              </p>
              <p
                className={`font-mono text-2xl font-semibold tabular-nums ${
                  urgent ? "animate-pulse text-red-400" : "text-zinc-50"
                }`}
              >
                {left}s
              </p>
            </div>
          </div>

          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-200"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-800">
            <div
              className={`h-full rounded-full transition-all duration-100 ${
                urgent ? "bg-red-500" : "bg-sky-500/80"
              }`}
              style={{ width: `${timePct * 100}%` }}
            />
          </div>

          <div className="mt-2 flex items-center justify-between text-xs text-zinc-400">
            <span>
              Perdidas{" "}
              <strong className={lost > 0 ? "text-red-400" : "text-zinc-300"}>
                {lost}/{maxLost}
              </strong>
            </span>
            <span>
              {combo >= 2 ? (
                <span className="font-semibold text-sky-300">Combo ×{combo}</span>
              ) : (
                <span className="text-zinc-600">toque nas chamas</span>
              )}
            </span>
          </div>
        </div>

        <p className="min-h-[1.25rem] text-center text-sm text-orange-200/90">{banner}</p>

        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` }}
        >
          {cells.map((cell, i) => (
            <button
              key={`${i}-${cell.key}`}
              type="button"
              onClick={() => extinguish(i)}
              disabled={cell.heat < 0}
              className={`fire-cell relative flex min-h-[72px] flex-col items-center justify-center rounded-xl border-2 text-3xl transition-transform active:scale-90 ${heatClass(
                cell.heat
              )} ${cell.splash > 0 ? "fire-splash" : ""}`}
            >
              <span className="relative z-10 drop-shadow-sm">{heatLabel(cell.heat)}</span>
              {cell.heat > 0 && (
                <span className="absolute bottom-1 right-1.5 z-10 rounded bg-black/40 px-1 font-mono text-[10px] text-orange-100">
                  {cell.heat}
                </span>
              )}
              {cell.splash > 0 && (
                <span className="fire-water-drops pointer-events-none absolute inset-0" />
              )}
            </button>
          ))}
        </div>

        <p className="text-center text-[11px] leading-relaxed text-zinc-500">
          🕯️ 1 jato · 🔥 2–3 · 💥 4 jatos · fogo forte espalha pro vizinho
        </p>
      </div>
    </div>
  );
}
