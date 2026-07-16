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
  };
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
    default:
      return `Não abriu o teste (${reason || "erro"}).`;
  }
}

function PlayInner() {
  const sp = useSearchParams();
  const token = sp.get("t") || "";
  const codeFromUrl = (sp.get("c") || "").toUpperCase();

  const [phase, setPhase] = useState<"gate" | "loading" | "play" | "done" | "error">("gate");
  const [code, setCode] = useState(codeFromUrl);
  const [err, setErr] = useState("");
  const [meta, setMeta] = useState<OpenResp | null>(null);
  const [result, setResult] = useState<FinishResp | null>(null);
  const [authToken, setAuthToken] = useState(token);
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
      startedAt.current = Date.now();
      setPhase("play");
    } catch {
      setErr("Falha de rede. Confira se a API Fun está no ar.");
      setPhase("gate");
    }
  }, [code, token]);

  const submit = useCallback(
    async (score: number, metrics: Record<string, number>) => {
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
    [authToken, meta?.attemptId]
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

  const dark = meta.game === "fire" || meta.game === "firewall" || meta.game === "sequence";

  return (
    <Shell dark={dark}>
      {meta.game !== "fire" && meta.game !== "firewall" && meta.game !== "sequence" && (
        <header className="mb-4">
          <p className="text-2xl">{meta.emoji}</p>
          <h1 className="text-lg font-semibold text-zinc-900">{meta.jobName}</h1>
          <p className="mt-1 text-xs text-zinc-500">Teste mobile · besteirol corporativo</p>
        </header>
      )}
      {meta.game === "printer" && (
        <PrinterGame config={meta.gameConfig} onDone={submit} />
      )}
      {meta.game === "fire" && <FireGame config={meta.gameConfig} onDone={submit} />}
      {(meta.game === "firewall" || meta.game === "sequence") && (
        <FirewallGame config={meta.gameConfig} onDone={submit} />
      )}
    </Shell>
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
  { id: "carimbo", label: "📄", good: true },
  { id: "cafe", label: "☕", good: false },
  { id: "grampo", label: "📎", good: true },
  { id: "spam", label: "🗑️", good: false },
  { id: "email", label: "✉️", good: true },
  { id: "meme", label: "🐸", good: false },
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
        line={`Protocolar ${target} · acertos ${score} · erros ${mistakes}/${maxMistakes}`}
      />
      <p className="text-center text-sm text-zinc-600">
        Toque só em documentos úteis (📄 📎 ✉️). Café e lixo = mico.
      </p>
      <button
        type="button"
        className="min-h-[160px] w-full rounded-xl border border-zinc-200 bg-white text-6xl transition active:scale-[0.98]"
        onClick={() => hit(Boolean(tile.good))}
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
