"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Threat = {
  id: number;
  side: "left" | "right";
  /** 0 = longe · 1 = tocou a linha do escudo (hit) */
  progress: number;
  y: number;
};

type Props = {
  config?: {
    durationMs?: number;
    targetRounds?: number;
    targetScore?: number;
    maxHits?: number;
    maxConsecutiveMisses?: number;
    numberMax?: number;
    portTimeMs?: number;
  };
  onDone: (score: number, metrics: Record<string, number>) => void;
};

const PORT_DEFAULT_MS = 20_000;
const HIT_LINE = 1;

/** Alvos grandes o bastante pra forçar digitar vários dígitos (não sorteia 42). */
function randTarget(max: number) {
  const hi = Math.max(0, Math.floor(max));
  if (hi <= 999) return Math.floor(Math.random() * (hi + 1));
  // mínimo ~ metade dos dígitos do max (ex.: max 7 dig → a partir de 100_000)
  const digits = String(hi).length;
  const minDigits = Math.max(4, digits - 1);
  const min = Math.min(hi, Math.pow(10, minDigits - 1));
  return min + Math.floor(Math.random() * (hi - min + 1));
}

/**
 * Hacker — quebra de firewall (lógica igual; visual estação cyber).
 */
export function FirewallGame({ config, onDone }: Props) {
  const need = config?.targetRounds ?? config?.targetScore ?? 16;
  const maxHits = config?.maxHits ?? 3;
  const maxConsec = config?.maxConsecutiveMisses ?? 3;
  const numberMax = config?.numberMax ?? 9_999_999;
  const portTimeMs = config?.portTimeMs ?? PORT_DEFAULT_MS;

  const [intro, setIntro] = useState(true);
  const [cracks, setCracks] = useState(0);
  const [hits, setHits] = useState(0);
  const [consecWrong, setConsecWrong] = useState(0);
  const [portLeft, setPortLeft] = useState(Math.ceil(portTimeMs / 1000));
  const [target, setTarget] = useState(() => randTarget(numberMax));
  const [input, setInput] = useState("");
  const [threats, setThreats] = useState<Threat[]>([]);
  const [flash, setFlash] = useState<"ok" | "bad" | "hit" | null>(null);
  const [banner, setBanner] = useState(
    "Digite a porta + CRACK. Toque nos vírus antes da linha do escudo."
  );
  const [shake, setShake] = useState(false);

  const done = useRef(false);
  const cracksRef = useRef(0);
  const hitsRef = useRef(0);
  const consecRef = useRef(0);
  const threatId = useRef(0);
  const portDeadline = useRef(0);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const finish = useCallback((score: number, metrics: Record<string, number>) => {
    if (done.current) return;
    done.current = true;
    onDoneRef.current(score, metrics);
  }, []);

  const registerHit = useCallback(
    (msg: string) => {
      hitsRef.current += 1;
      setHits(hitsRef.current);
      setFlash("hit");
      setShake(true);
      setBanner(msg);
      setTimeout(() => {
        setFlash(null);
        setShake(false);
      }, 240);
      if (hitsRef.current >= maxHits) {
        setTimeout(
          () =>
            finish(cracksRef.current, {
              hits: hitsRef.current,
              consecutiveMisses: consecRef.current,
            }),
          100
        );
      }
    },
    [finish, maxHits]
  );

  const nextPort = useCallback(() => {
    setTarget(randTarget(numberMax));
    setInput("");
    portDeadline.current = Date.now() + portTimeMs;
    setPortLeft(Math.ceil(portTimeMs / 1000));
  }, [numberMax, portTimeMs]);

  useEffect(() => {
    const t = setTimeout(() => {
      setIntro(false);
      portDeadline.current = Date.now() + portTimeMs;
    }, 1700);
    return () => clearTimeout(t);
  }, [portTimeMs]);

  useEffect(() => {
    if (intro) return;

    const timerIv = setInterval(() => {
      if (done.current) return;
      const rem = Math.max(0, Math.ceil((portDeadline.current - Date.now()) / 1000));
      setPortLeft(rem);
      if (rem <= 0 && portDeadline.current > 0) {
        portDeadline.current = Date.now() + portTimeMs;
        consecRef.current += 1;
        setConsecWrong(consecRef.current);
        setFlash("bad");
        setBanner(
          consecRef.current >= maxConsec
            ? "Tempo esgotado 3× — acesso negado."
            : `Tempo esgotado (${consecRef.current}/${maxConsec}). Nova porta.`
        );
        setTimeout(() => setFlash(null), 220);
        setInput("");
        setTarget(randTarget(numberMax));
        if (consecRef.current >= maxConsec) {
          setTimeout(
            () =>
              finish(cracksRef.current, {
                hits: hitsRef.current,
                consecutiveMisses: consecRef.current,
                timeout: 1,
              }),
            120
          );
        }
      }
    }, 100);

    const tickMs = 50;
    const gameIv = setInterval(() => {
      if (done.current) return;
      const progress = cracksRef.current / Math.max(1, need);
      const phase = progress < 0.35 ? 0 : progress < 0.7 ? 1 : 2;
      // +0.1 velocidade dos vírus
      const speed = [0.0062, 0.0084, 0.0112][phase];
      const spawnChance = [0.042, 0.058, 0.078][phase];

      setThreats((prev) => {
        let next = prev
          .map((th) => ({ ...th, progress: th.progress + speed }))
          .filter((th) => {
            if (th.progress < HIT_LINE) return true;
            registerHit("Ameaça cruzou o escudo!");
            return false;
          });

        if (Math.random() < spawnChance && next.length < 6) {
          threatId.current += 1;
          next = [
            ...next,
            {
              id: threatId.current,
              side: Math.random() < 0.5 ? "left" : "right",
              progress: 0,
              y: 18 + Math.random() * 55,
            },
          ];
        }
        return next;
      });
    }, tickMs);

    return () => {
      clearInterval(timerIv);
      clearInterval(gameIv);
    };
  }, [intro, portTimeMs, maxConsec, numberMax, need, finish, registerHit]);

  const blockThreat = (id: number) => {
    if (done.current || intro) return;
    setThreats((prev) => prev.filter((t) => t.id !== id));
    setBanner("Ameaça bloqueada ✓");
  };

  const pressKey = (k: string) => {
    if (done.current || intro) return;
    if (k === "⌫") {
      setInput((s) => s.slice(0, -1));
      return;
    }
    if (k === "C") {
      setInput("");
      return;
    }
    setInput((s) => {
      const next = (s + k).replace(/\D/g, "");
      if (next.length > String(numberMax).length) return s;
      const n = Number(next);
      if (n > numberMax) return s;
      return next;
    });
  };

  const crack = () => {
    if (done.current || intro) return;
    const val = input === "" ? NaN : Number(input);
    if (!Number.isFinite(val)) {
      setBanner("Digite um número antes do CRACK.");
      return;
    }
    if (val === target) {
      cracksRef.current += 1;
      consecRef.current = 0;
      setCracks(cracksRef.current);
      setConsecWrong(0);
      setFlash("ok");
      setBanner(`Porta ${target} aberta! ${cracksRef.current}/${need}`);
      setTimeout(() => setFlash(null), 200);
      if (cracksRef.current >= need) {
        setTimeout(
          () =>
            finish(cracksRef.current, {
              hits: hitsRef.current,
              consecutiveMisses: 0,
            }),
          150
        );
      } else {
        nextPort();
      }
    } else {
      consecRef.current += 1;
      setConsecWrong(consecRef.current);
      setFlash("bad");
      setBanner(
        consecRef.current >= maxConsec
          ? "3 erros seguidos — acesso negado."
          : `Errado (${consecRef.current}/${maxConsec} seguidos). Mesma porta, tenta de novo.`
      );
      setTimeout(() => setFlash(null), 220);
      if (consecRef.current >= maxConsec) {
        setTimeout(
          () =>
            finish(cracksRef.current, {
              hits: hitsRef.current,
              consecutiveMisses: consecRef.current,
            }),
          120
        );
      }
    }
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"];
  const progress = Math.min(1, cracks / need);
  const portUrgent = portLeft <= 5;
  const portPct = Math.max(0, Math.min(1, portLeft / (portTimeMs / 1000)));

  return (
    <div
      className={`fw-stage relative -mx-4 min-h-[100dvh] overflow-hidden px-0 pb-4 pt-2 ${
        shake ? "fw-shake" : ""
      } ${flash === "hit" ? "fw-flash-red" : ""} ${flash === "ok" ? "fw-flash-ok" : ""} ${
        flash === "bad" ? "fw-flash-bad" : ""
      }`}
    >
      <div className="pointer-events-none absolute inset-0 fw-bg" aria-hidden />
      <div className="pointer-events-none absolute inset-0 fw-circuits" aria-hidden />

      {intro ? (
        <div className="relative z-10 flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
          <div className="fw-intro-ring mb-4 flex h-20 w-20 items-center justify-center rounded-2xl border border-cyan-400/40 bg-zinc-950/80">
            <span className="text-4xl">💻</span>
          </div>
          <h2 className="fw-glow-cyan text-xl font-semibold tracking-wide text-cyan-300">
            ESTAÇÃO DE INVASÃO
          </h2>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-zinc-400">
            <strong className="text-emerald-400">{need}</strong> portas ·{" "}
            <strong className="text-emerald-400">{Math.round(portTimeMs / 1000)}s</strong> cada ·
            teclado + <strong className="text-emerald-300">CRACK</strong>.
            <br />
            Bloqueie <strong className="text-red-400">vírus</strong> antes da{" "}
            <strong className="text-cyan-300">linha do escudo</strong>. 3 hits ou 3 erros/timeouts
            seguidos = rastreamiento.
          </p>
          <p className="mt-6 animate-pulse text-[10px] uppercase tracking-[0.3em] text-zinc-600">
            sincronizando uplink…
          </p>
        </div>
      ) : (
        <div className="relative z-10 mx-auto flex max-w-md flex-col px-3">
          {/* barra de missão */}
          <div className="fw-mission mb-2 grid grid-cols-3 gap-2 rounded-xl border border-cyan-500/20 bg-black/60 px-3 py-2.5 backdrop-blur-sm">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
                Portas
              </p>
              <p className="font-mono text-lg font-semibold tabular-nums text-emerald-400">
                {cracks}
                <span className="text-sm text-zinc-600">/{need}</span>
              </p>
            </div>
            <div className="text-center">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
                Timer
              </p>
              <p
                className={`font-mono text-xl font-bold tabular-nums ${
                  portUrgent
                    ? "animate-pulse text-red-400 drop-shadow-[0_0_8px_rgba(248,113,113,0.8)]"
                    : "text-emerald-300 drop-shadow-[0_0_10px_rgba(52,211,153,0.7)]"
                }`}
              >
                {portLeft}s
              </p>
            </div>
            <div className="text-right">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
                Hits
              </p>
              <p
                className={`font-mono text-lg font-semibold tabular-nums ${
                  hits > 0 ? "text-red-400" : "text-zinc-300"
                }`}
              >
                {hits}
                <span className="text-sm text-zinc-600">/{maxHits}</span>
              </p>
            </div>
          </div>

          {/* progresso de dados */}
          <div className="mb-1 h-2 overflow-hidden rounded-full border border-emerald-500/20 bg-zinc-950">
            <div
              className="fw-progress-bar h-full rounded-full transition-all duration-300"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
          <div className="mb-3 h-1 overflow-hidden rounded-full bg-zinc-950/80">
            <div
              className={`h-full rounded-full transition-all duration-100 ${
                portUrgent
                  ? "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"
                  : "bg-cyan-400/90 shadow-[0_0_8px_rgba(34,211,238,0.5)]"
              }`}
              style={{ width: `${portPct * 100}%` }}
            />
          </div>

          {/* arena */}
          <div className="fw-arena relative mx-auto w-full">
            {/* painel vírus (esq) */}
            <div className="fw-side-panel fw-virus-panel" aria-hidden>
              <div className="fw-bio-symbol">☣</div>
              <span className="fw-side-label text-red-400/70">VIRUS</span>
            </div>
            {/* painel escudo (dir) */}
            <div className="fw-side-panel fw-shield-panel" aria-hidden>
              <div className="fw-shield-bar" />
              <span className="fw-side-label text-cyan-400/70">SHIELD</span>
            </div>

            <div className="fw-lane fw-lane-left" aria-hidden />
            <div className="fw-lane fw-lane-right" aria-hidden />

            <div className="fw-shield fw-shield-left" aria-hidden>
              <span className="fw-shield-tag">ESCUDO</span>
            </div>
            <div className="fw-shield fw-shield-right" aria-hidden>
              <span className="fw-shield-tag">ESCUDO</span>
            </div>

            {threats.map((t) => {
              const along = Math.min(1, t.progress) * 30;
              return (
                <button
                  key={t.id}
                  type="button"
                  className="fw-virus absolute z-30 flex h-12 w-12 flex-col items-center justify-center rounded-full border-2 border-red-300/90 bg-gradient-to-b from-red-500 via-red-600 to-red-950 text-[9px] font-bold text-white shadow-[0_0_16px_rgba(239,68,68,0.85)] active:scale-90"
                  style={
                    t.side === "left"
                      ? {
                          top: `${t.y}%`,
                          left: `${along}%`,
                          transform: "translate(-50%, -50%)",
                        }
                      : {
                          top: `${t.y}%`,
                          right: `${along}%`,
                          transform: "translate(50%, -50%)",
                        }
                  }
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    blockThreat(t.id);
                  }}
                  aria-label="Bloquear vírus"
                >
                  <span className="text-base leading-none">🦠</span>
                  <span className="leading-none tracking-tighter opacity-90">BUG</span>
                </button>
              );
            })}

            {/* terminal central */}
            <div className="fw-core relative z-10 mx-auto w-[60%] max-w-[260px] pt-1">
              <div className="fw-terminal-frame">
                <div className="fw-terminal-screen px-2.5 py-3 font-mono">
                  <div className="flex items-center justify-between text-[9px] text-cyan-700/80">
                    <span>SEC-NODE // MIL</span>
                    <span className="text-emerald-600/70">ENCRYPTED</span>
                  </div>
                  <p className="mt-2 text-[11px] text-emerald-500/90">$ crack --port</p>

                  <p className="mt-4 text-center text-[9px] font-semibold uppercase tracking-[0.35em] text-zinc-500">
                    TARGET
                  </p>
                  <p className="fw-target-num mt-0.5 text-center text-2xl font-bold tracking-wide text-emerald-400 sm:text-3xl">
                    {target}
                  </p>

                  <div className="fw-scanner mt-4 px-2 py-2.5 text-center">
                    <span className="text-[9px] uppercase tracking-wider text-cyan-600/80">
                      input scan
                    </span>
                    <div className="mt-0.5 text-xl font-semibold tracking-widest text-zinc-50">
                      {input || (
                        <span className="fw-cursor text-zinc-600">_</span>
                      )}
                      {input ? <span className="fw-cursor text-emerald-500">▌</span> : null}
                    </div>
                  </div>

                  <p className="mt-2 min-h-[2.25rem] text-center text-[10px] leading-snug text-zinc-500">
                    {banner}
                  </p>
                  {consecWrong > 0 && (
                    <p className="text-center text-[10px] text-amber-400/90">
                      erros seguidos {consecWrong}/{maxConsec}
                    </p>
                  )}
                </div>
              </div>
              <div className="fw-laptop-base mx-auto h-2 w-[94%] rounded-b-md" />
              <div className="mx-auto h-1 w-[36%] rounded-b bg-zinc-700/80" />
            </div>
          </div>

          {/* teclado hexagonal / metal */}
          <div className="mt-4 grid grid-cols-3 gap-2 px-1">
            {keys.map((k) => {
              const isClear = k === "C";
              const isDel = k === "⌫";
              return (
                <button
                  key={k}
                  type="button"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    pressKey(k);
                  }}
                  className={`fw-key min-h-12 touch-manipulation text-base font-semibold active:scale-95 ${
                    isClear
                      ? "fw-key-danger"
                      : isDel
                        ? "fw-key-muted"
                        : "fw-key-default"
                  }`}
                >
                  {k === "⌫" ? "⌫" : k}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              crack();
            }}
            className="fw-crack-btn mt-3 min-h-[3.25rem] w-full touch-manipulation text-base font-bold tracking-[0.2em] active:scale-[0.99]"
          >
            CRACK
          </button>

          <div className="fw-footer mt-3 flex items-center justify-center gap-2 rounded-lg border border-cyan-500/15 bg-black/50 px-3 py-2">
            <span className="text-sm">🦠</span>
            <p className="text-center text-[10px] leading-snug text-zinc-400">
              Toque no vírus antes que ele atravesse a{" "}
              <span className="text-cyan-300">linha do escudo</span>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
