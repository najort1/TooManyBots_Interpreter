"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FireGame } from "./FireGame";
import { FirewallGame } from "./FirewallGame";

type OpenResp = {
  ok: boolean;
  reason?: string;
  attemptId?: string;
  jobId?: string;
  jobName?: string;
  emoji?: string;
  game?: string;
  gameConfig?: {
    durationMs?: number;
    targetScore?: number;
    maxMistakes?: number;
    maxLostHouses?: number;
    targetRounds?: number;
    portTimeMs?: number;
    numberMax?: number;
    maxHits?: number;
    maxConsecutiveMisses?: number;
  };
  practiceAvailable?: boolean;
  practiceUsed?: boolean;
  practiceScore?: number;
};

type FinishResp = {
  ok: boolean;
  passed?: boolean;
  reason?: string;
  jobName?: string;
  emoji?: string;
  salary?: number;
  score?: number;
};

type PracticeResp = {
  ok: boolean;
  reason?: string;
  practice?: boolean;
  practiceAvailable?: boolean;
  practiceUsed?: boolean;
  score?: number;
  jobName?: string;
  emoji?: string;
};

type Phase =
  | "gate"
  | "loading"
  | "briefing"
  | "play"
  | "practice-done"
  | "done"
  | "error";

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<T>;
}

function reasonLabel(reason?: string) {
  switch (reason) {
    case "code-required":
      return "Digite o código que o bot mandou no grupo.";
    case "code-mismatch":
      return "Código não bate com este link. Confira no grupo.";
    case "unknown-code":
      return "Código inválido ou já usado.";
    case "unknown-attempt":
      return "Teste não encontrado. Peça um link novo no grupo.";
    case "expired":
      return "Link/código expirado. Peça de novo: /emprego";
    case "already-finished":
      return "Este teste já foi finalizado.";
    case "practice-used":
      return "Treino grátis deste link já foi usado.";
    case "practice-unavailable":
      return "Treino indisponível. Vá pro teste real.";
    default:
      return `Não abriu o teste (${reason || "erro"}).`;
  }
}

type HowTo = {
  title: string;
  goal: string;
  steps: string[];
  tips: string[];
  fail: string;
};

function howToFor(game?: string, config?: OpenResp["gameConfig"]): HowTo {
  if (game === "fire") {
    const target = config?.targetScore ?? 20;
    const sec = Math.ceil((config?.durationMs ?? 90_000) / 1000);
    const maxLost = config?.maxLostHouses ?? 3;
    return {
      title: "Bombeiro — apagar focos",
      goal: `Apague ${target} focos em ${sec}s sem perder mais de ${maxLost} casas.`,
      steps: [
        "O mapa tem casas 🏠. Quando aparecer fogo, toque nelas.",
        "Cada toque baixa 1 de calor. Fogo forte (🔥/💥) precisa de vários toques.",
        "Se o calor chegar no máximo, a casa vira cinzas e conta como perdida.",
        "Fogo forte pode pular pro vizinho — apague antes de espalhar.",
      ],
      tips: [
        "Priorize casas com número alto de calor.",
        "Não perca tempo em casas já apagadas (🏠).",
      ],
      fail: `Acabou o tempo sem a meta, ou perdeu mais de ${maxLost} casas.`,
    };
  }
  if (game === "firewall" || game === "sequence") {
    const need = config?.targetRounds ?? config?.targetScore ?? 16;
    const portSec = Math.round((config?.portTimeMs ?? 20_000) / 1000);
    const maxHits = config?.maxHits ?? 3;
    const maxConsec = config?.maxConsecutiveMisses ?? 3;
    return {
      title: "Hacker — quebrar o firewall",
      goal: `Abra ${need} portas corretas. Cada porta tem ${portSec}s.`,
      steps: [
        "No centro aparece o número da porta (TARGET).",
        "Digite esse número no teclado e toque em CRACK.",
        "Vírus 🦠 vêm das laterais — toque neles antes da linha do ESCUDO.",
        "Número errado ou tempo esgotado = erro seguido. 3 erros seguidos ou 3 hits de vírus = fim.",
      ],
      tips: [
        "Primeiro digite a porta; depois olhe pros vírus.",
        "C limpa o input · ⌫ apaga o último dígito.",
      ],
      fail: `${maxHits} vírus no escudo, ou ${maxConsec} erros/timeouts seguidos.`,
    };
  }
  // printer / estagiário
  const target = config?.targetScore ?? 8;
  const sec = Math.ceil((config?.durationMs ?? 60_000) / 1000);
  const maxMistakes = config?.maxMistakes ?? 3;
  return {
    title: "Estagiário — protocolar documentos",
    goal: `Protocolar ${target} itens úteis em ${sec}s, com no máximo ${maxMistakes} erros.`,
    steps: [
      "Aparece um item grande no meio da tela.",
      "Se for documento útil (📄 📎 ✉️), toque em Protocolar.",
      "Se for café, lixo ou meme (☕ 🗑️ 🐸), toque em Próximo — não protocolar.",
      "Cada protocolo certo soma 1. Protocolar lixo = erro.",
    ],
    tips: [
      "Em dúvida: documento = Protocolar · resto = Próximo.",
      "Você pode tocar no item grande também (só se for útil).",
    ],
    fail: `Mais de ${maxMistakes} erros, ou o tempo acaba sem a meta.`,
  };
}

function PlayInner() {
  const sp = useSearchParams();
  const token = sp.get("t") || "";
  const codeFromUrl = (sp.get("c") || "").toUpperCase();

  const [phase, setPhase] = useState<Phase>("gate");
  const [code, setCode] = useState(codeFromUrl);
  const [err, setErr] = useState("");
  const [meta, setMeta] = useState<OpenResp | null>(null);
  const [result, setResult] = useState<FinishResp | null>(null);
  const [authToken, setAuthToken] = useState(token);
  const [playMode, setPlayMode] = useState<"practice" | "real">("real");
  const [practiceUsed, setPracticeUsed] = useState(false);
  const [practiceBusy, setPracticeBusy] = useState(false);
  const [practiceSummary, setPracticeSummary] = useState<{
    score: number;
    metrics: Record<string, number>;
  } | null>(null);
  const startedAt = useRef(0);

  const openWithCode = useCallback(async () => {
    const cleaned = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (cleaned.length < 4) {
      setErr("Código tem pelo menos 4 caracteres (ex.: NKZPLL).");
      return;
    }
    setErr("");
    setPhase("loading");
    try {
      const data = await postJson<OpenResp>("/api/fun/job/open", {
        token: token || undefined,
        code: cleaned,
      });
      if (!data.ok) {
        setErr(reasonLabel(data.reason));
        setPhase("gate");
        return;
      }
      setMeta(data);
      setAuthToken(token || "");
      // estado do treino vem do banco (F5 não libera outro)
      const used = Boolean(data.practiceUsed) || data.practiceAvailable === false;
      setPracticeUsed(used);
      setPracticeSummary(
        used && Number(data.practiceScore) > 0
          ? { score: Number(data.practiceScore), metrics: {} }
          : null
      );
      setPhase(used && Number(data.practiceScore) > 0 ? "practice-done" : "briefing");
    } catch {
      setErr("Falha de rede. Confira se a API Fun está no ar.");
      setPhase("gate");
    }
  }, [code, token]);

  const startPlay = useCallback(
    async (mode: "practice" | "real") => {
      setErr("");
      if (mode === "practice") {
        if (practiceUsed || practiceBusy) return;
        setPracticeBusy(true);
        try {
          // reserva no banco antes de montar o jogo — F5 não gera outro treino
          const claimed = await postJson<PracticeResp>("/api/fun/job/practice/claim", {
            token: authToken || token || undefined,
            attemptId: meta?.attemptId,
          });
          if (!claimed.ok) {
            setPracticeUsed(true);
            setErr(reasonLabel(claimed.reason || "practice-used"));
            setPracticeBusy(false);
            return;
          }
          setPracticeUsed(true);
          setMeta((m) =>
            m
              ? {
                  ...m,
                  practiceAvailable: false,
                  practiceUsed: true,
                }
              : m
          );
        } catch {
          setErr("Não deu pra reservar o treino. Tente de novo.");
          setPracticeBusy(false);
          return;
        }
        setPracticeBusy(false);
      }
      setPlayMode(mode);
      startedAt.current = Date.now();
      setPhase("play");
    },
    [authToken, meta?.attemptId, practiceBusy, practiceUsed, token]
  );

  const submit = useCallback(
    async (score: number, metrics: Record<string, number>) => {
      if (playMode === "practice") {
        try {
          const data = await postJson<PracticeResp>("/api/fun/job/practice/finish", {
            token: authToken || undefined,
            attemptId: meta?.attemptId,
            score,
            metrics,
          });
          const finalScore = data.ok ? Number(data.score ?? score) : score;
          setPracticeSummary({ score: finalScore, metrics });
          setPracticeUsed(true);
          setMeta((m) =>
            m
              ? {
                  ...m,
                  practiceAvailable: false,
                  practiceUsed: true,
                  practiceScore: finalScore,
                }
              : m
          );
          setPhase("practice-done");
        } catch {
          // treino já foi claimado no banco; ainda mostra resultado local
          setPracticeSummary({ score, metrics });
          setPracticeUsed(true);
          setPhase("practice-done");
        }
        return;
      }
      const durationMs = Date.now() - startedAt.current;
      try {
        const data = await postJson<FinishResp>("/api/fun/job/finish", {
          token: authToken || undefined,
          attemptId: meta?.attemptId,
          score,
          durationMs,
          metrics,
        });
        setResult(data);
        setPhase("done");
      } catch {
        setErr("Não deu pra enviar o resultado.");
        setPhase("error");
      }
    },
    [authToken, meta?.attemptId, playMode]
  );

  if (phase === "gate") {
    return (
      <Shell>
        <div className="space-y-4">
          <div className="text-center">
            <p className="text-3xl">🪪</p>
            <h1 className="mt-2 text-lg font-semibold text-zinc-900">RH — entrada no teste</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Digite o <strong>código</strong> que o bot mandou no grupo.
              {token ? " O link já veio com token — confirme o código pra começar." : ""}
            </p>
          </div>

          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Código do teste
            </span>
            <input
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={12}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") void openWithCode();
              }}
              placeholder="Ex: NKZPLL"
              className="mt-1.5 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3.5 text-center font-mono text-xl tracking-[0.2em] text-zinc-900 outline-none ring-zinc-900/10 focus:ring-2"
              autoFocus
            />
          </label>

          {err ? <p className="text-center text-sm text-red-600">{err}</p> : null}

          <button
            type="button"
            onClick={() => void openWithCode()}
            className="min-h-12 w-full rounded-xl bg-zinc-900 text-sm font-medium text-white active:scale-[0.99]"
          >
            Entrar no teste
          </button>

          <p className="text-center text-[11px] text-zinc-400">
            Sem código? No grupo: <code className="text-zinc-600">/emprego bombeiro</code>
          </p>
        </div>
      </Shell>
    );
  }

  if (phase === "loading") {
    return (
      <Shell>
        <p className="text-center text-sm text-zinc-500">Validando código no RH…</p>
      </Shell>
    );
  }

  if (phase === "error") {
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-zinc-900">Opa</h1>
        <p className="mt-2 text-sm text-zinc-600">{err}</p>
      </Shell>
    );
  }

  if (phase === "done" && result) {
    return (
      <Shell>
        <p className="text-center text-3xl">{result.passed ? "🎉" : "📋"}</p>
        <h1 className="mt-2 text-center text-xl font-semibold text-zinc-900">
          {result.passed ? "Contratado!" : "Não passou"}
        </h1>
        <p className="mt-2 text-center text-sm text-zinc-600">
          {result.passed
            ? `${result.emoji || ""} ${result.jobName || "Cargo"} · salário ~${result.salary ?? "?"}c no /daily`
            : "CD 7 dias neste cargo · taxa na retentativa."}
        </p>
        <p className="mt-6 text-center text-xs text-zinc-400">Pode fechar e voltar pro zap.</p>
      </Shell>
    );
  }

  if (!meta) return null;

  const howTo = howToFor(meta.game, meta.gameConfig);
  const dark =
    meta.game === "fire" || meta.game === "firewall" || meta.game === "sequence";

  if (phase === "briefing" || phase === "practice-done") {
    return (
      <Shell dark={dark}>
        <Briefing
          dark={dark}
          emoji={meta.emoji || "🪪"}
          jobName={meta.jobName || "Cargo"}
          howTo={howTo}
          practiceUsed={practiceUsed}
          practiceBusy={practiceBusy}
          practiceSummary={
            phase === "practice-done"
              ? practiceSummary
              : practiceUsed && practiceSummary
                ? practiceSummary
                : null
          }
          err={err}
          onPractice={() => void startPlay("practice")}
          onReal={() => void startPlay("real")}
        />
      </Shell>
    );
  }

  // phase === "play"
  return (
    <Shell dark={dark}>
      {playMode === "practice" ? (
        <div
          className={`mb-3 rounded-lg border px-3 py-2 text-center text-xs font-medium ${
            dark
              ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
              : "border-amber-300 bg-amber-50 text-amber-800"
          }`}
        >
          TREINO GRÁTIS — não conta como tentativa real (sem CD, sem taxa)
        </div>
      ) : (
        <div
          className={`mb-3 rounded-lg border px-3 py-2 text-center text-xs font-medium ${
            dark
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              : "border-emerald-300 bg-emerald-50 text-emerald-800"
          }`}
        >
          TESTE REAL — resultado vale pra contratação
        </div>
      )}
      {meta.game !== "fire" && meta.game !== "firewall" && meta.game !== "sequence" && (
        <header className="mb-4">
          <p className="text-2xl">{meta.emoji}</p>
          <h1 className="text-lg font-semibold text-zinc-900">{meta.jobName}</h1>
          <p className="mt-1 text-xs text-zinc-500">Leia com calma antes — o tempo só roda no jogo</p>
        </header>
      )}
      {meta.game === "printer" && (
        <PrinterGame
          key={`${playMode}-${practiceUsed}`}
          config={meta.gameConfig}
          onDone={submit}
        />
      )}
      {meta.game === "fire" && (
        <FireGame
          key={`${playMode}-${practiceUsed}`}
          config={meta.gameConfig}
          onDone={submit}
        />
      )}
      {(meta.game === "firewall" || meta.game === "sequence") && (
        <FirewallGame
          key={`${playMode}-${practiceUsed}`}
          config={meta.gameConfig}
          onDone={submit}
        />
      )}
    </Shell>
  );
}

function Briefing({
  dark,
  emoji,
  jobName,
  howTo,
  practiceUsed,
  practiceBusy,
  practiceSummary,
  err,
  onPractice,
  onReal,
}: {
  dark: boolean;
  emoji: string;
  jobName: string;
  howTo: HowTo;
  practiceUsed: boolean;
  practiceBusy: boolean;
  practiceSummary: { score: number; metrics: Record<string, number> } | null;
  err?: string;
  onPractice: () => void;
  onReal: () => void;
}) {
  const muted = dark ? "text-zinc-400" : "text-zinc-500";
  const body = dark ? "text-zinc-300" : "text-zinc-700";
  const title = dark ? "text-zinc-50" : "text-zinc-900";
  const card = dark
    ? "border-zinc-700 bg-zinc-900/80"
    : "border-zinc-200 bg-white";
  const stepBg = dark ? "bg-zinc-800/80 text-zinc-200" : "bg-zinc-100 text-zinc-800";

  return (
    <div className="space-y-4 pb-8">
      <div className="text-center">
        <p className="text-3xl">{emoji}</p>
        <h1 className={`mt-2 text-xl font-semibold ${title}`}>{jobName}</h1>
        <p className={`mt-1 text-sm ${muted}`}>{howTo.title}</p>
      </div>

      {practiceSummary ? (
        <div
          className={`rounded-xl border px-4 py-3 text-center ${
            dark
              ? "border-amber-500/30 bg-amber-500/10"
              : "border-amber-200 bg-amber-50"
          }`}
        >
          <p className={`text-sm font-semibold ${dark ? "text-amber-200" : "text-amber-900"}`}>
            Treino encerrado — não contou
          </p>
          <p className={`mt-1 text-sm ${dark ? "text-amber-100/80" : "text-amber-800"}`}>
            Pontuação do treino: <strong>{practiceSummary.score}</strong>
          </p>
          <p className={`mt-1 text-xs ${dark ? "text-amber-200/70" : "text-amber-700/80"}`}>
            CD, taxa e contratação só valem no teste real.
          </p>
        </div>
      ) : null}

      <div className={`rounded-xl border p-4 ${card}`}>
        <p className={`text-xs font-semibold uppercase tracking-wide ${muted}`}>Meta</p>
        <p className={`mt-1 text-sm font-medium leading-snug ${title}`}>{howTo.goal}</p>
      </div>

      <div className={`rounded-xl border p-4 ${card}`}>
        <p className={`text-xs font-semibold uppercase tracking-wide ${muted}`}>
          O que fazer (leia com calma)
        </p>
        <ol className="mt-3 space-y-2.5">
          {howTo.steps.map((step, i) => (
            <li key={i} className="flex gap-2.5">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${stepBg}`}
              >
                {i + 1}
              </span>
              <span className={`text-sm leading-snug ${body}`}>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className={`rounded-xl border p-4 ${card}`}>
        <p className={`text-xs font-semibold uppercase tracking-wide ${muted}`}>Dicas</p>
        <ul className={`mt-2 list-disc space-y-1 pl-4 text-sm ${body}`}>
          {howTo.tips.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
        <p className={`mt-3 text-xs ${muted}`}>
          <strong className={title}>Quando falha:</strong> {howTo.fail}
        </p>
      </div>

      <div
        className={`rounded-xl border px-4 py-3 ${
          dark
            ? "border-cyan-500/25 bg-cyan-500/5"
            : "border-zinc-200 bg-zinc-100/80"
        }`}
      >
        <p className={`text-sm font-medium ${title}`}>1 treino grátis</p>
        <p className={`mt-0.5 text-xs leading-relaxed ${muted}`}>
          Uma vez por link, gravado no servidor. F5 não libera outro. Não gasta CD, taxa nem
          contrata.
        </p>
      </div>

      {err ? (
        <p className="text-center text-sm text-red-500">{err}</p>
      ) : null}

      <div className="space-y-2 pt-1">
        {!practiceUsed ? (
          <button
            type="button"
            disabled={practiceBusy}
            onClick={onPractice}
            className={`min-h-12 w-full rounded-xl border text-sm font-medium active:scale-[0.99] disabled:opacity-60 ${
              dark
                ? "border-amber-400/50 bg-amber-500/15 text-amber-100"
                : "border-amber-300 bg-amber-50 text-amber-900"
            }`}
          >
            {practiceBusy ? "Reservando treino…" : "Fazer treino grátis (1×)"}
          </button>
        ) : (
          <p className={`text-center text-xs ${muted}`}>
            Treino grátis deste link já foi usado (salvo no servidor).
          </p>
        )}
        <button
          type="button"
          disabled={practiceBusy}
          onClick={onReal}
          className={`min-h-12 w-full rounded-xl text-sm font-medium active:scale-[0.99] disabled:opacity-60 ${
            dark
              ? "bg-emerald-500 text-zinc-950"
              : "bg-zinc-900 text-white"
          }`}
        >
          {practiceUsed ? "Começar teste de verdade" : "Pular treino · teste real"}
        </button>
      </div>

      <p className={`text-center text-[11px] ${muted}`}>
        O tempo do jogo só começa depois que você apertar o botão.
      </p>
    </div>
  );
}

function Shell({
  children,
  dark = false,
}: {
  children: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <div
      className={`flex min-h-dvh flex-col items-center px-4 py-6 ${
        dark ? "bg-zinc-950 text-zinc-50" : "bg-zinc-50 text-zinc-900"
      }`}
    >
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

/* ——— Estagiário ——— */
const TASKS = [
  { id: "carimbo", label: "📄", good: true, name: "Documento" },
  { id: "cafe", label: "☕", good: false, name: "Café" },
  { id: "grampo", label: "📎", good: true, name: "Grampo" },
  { id: "spam", label: "🗑️", good: false, name: "Lixo" },
  { id: "email", label: "✉️", good: true, name: "E-mail" },
  { id: "meme", label: "🐸", good: false, name: "Meme" },
];

function PrinterGame({
  config,
  onDone,
}: {
  config?: OpenResp["gameConfig"];
  onDone: (score: number, metrics: Record<string, number>) => void;
}) {
  const target = config?.targetScore ?? 8;
  const maxMistakes = config?.maxMistakes ?? 3;
  const durationMs = config?.durationMs ?? 60_000;
  const [score, setScore] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  const [left, setLeft] = useState(Math.ceil(durationMs / 1000));
  const [tile, setTile] = useState(TASKS[0]);
  const done = useRef(false);
  const scoreRef = useRef(0);
  const mistakesRef = useRef(0);

  useEffect(() => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      const rem = Math.max(0, Math.ceil((durationMs - (Date.now() - t0)) / 1000));
      setLeft(rem);
      if (rem <= 0 && !done.current) {
        done.current = true;
        onDone(scoreRef.current, { mistakes: mistakesRef.current });
      }
    }, 200);
    return () => clearInterval(iv);
  }, [durationMs, onDone]);

  const hit = (good: boolean) => {
    if (done.current) return;
    if (good) {
      scoreRef.current += 1;
      setScore(scoreRef.current);
      if (scoreRef.current >= target) {
        done.current = true;
        onDone(scoreRef.current, { mistakes: mistakesRef.current });
        return;
      }
    } else {
      mistakesRef.current += 1;
      setMistakes(mistakesRef.current);
      if (mistakesRef.current > maxMistakes) {
        done.current = true;
        onDone(scoreRef.current, { mistakes: mistakesRef.current });
        return;
      }
    }
    setTile(TASKS[Math.floor(Math.random() * TASKS.length)]);
  };

  return (
    <div className="space-y-4">
      <Hud
        left={left}
        line={`Meta ${target} · ok ${score} · erros ${mistakes}/${maxMistakes}`}
      />
      <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-center text-sm text-zinc-600">
        <p>
          <strong className="text-zinc-900">Protocolar</strong> = 📄 📎 ✉️ ·{" "}
          <strong className="text-zinc-900">Próximo</strong> = ☕ 🗑️ 🐸
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          Item atual: {tile.label} {tile.name}
          {tile.good ? " → protocolar" : " → pular"}
        </p>
      </div>
      <button
        type="button"
        className="min-h-[160px] w-full rounded-xl border border-zinc-200 bg-white text-6xl transition active:scale-[0.98]"
        onClick={() => hit(Boolean(tile.good))}
        aria-label={tile.good ? "Protocolar item útil" : "Item inútil — use Próximo"}
      >
        {tile.label}
      </button>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="min-h-12 rounded-lg bg-zinc-900 text-sm font-medium text-white"
          onClick={() => hit(Boolean(tile.good))}
        >
          Protocolar
        </button>
        <button
          type="button"
          className="min-h-12 rounded-lg bg-zinc-200 text-sm font-medium text-zinc-800"
          onClick={() => setTile(TASKS[Math.floor(Math.random() * TASKS.length)])}
        >
          Próximo
        </button>
      </div>
    </div>
  );
}

function Hud({ left, line }: { left: number; line: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-zinc-600">{line}</span>
      <span className="font-mono font-semibold tabular-nums text-zinc-900">{left}s</span>
    </div>
  );
}

export default function JobPlayPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <p className="text-center text-sm text-zinc-500">Carregando…</p>
        </Shell>
      }
    >
      <PlayInner />
    </Suspense>
  );
}
