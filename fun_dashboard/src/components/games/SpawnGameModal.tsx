"use client";

import { useEffect, useState } from "react";
import {
  X,
  Swords,
  Brain,
  Flag,
  Crown,
  Clock,
  Coins,
  CheckCircle2,
  AlertCircle,
  Copy,
  ExternalLink,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { funApi } from "@/lib/api";
import { cn } from "@/lib/cn";
import { shortJid } from "@/lib/format";
import type { FunGroup, PanelinhaGameType, SpawnGameResult } from "@/lib/types";

export type SpawnGameModalProps = {
  open: boolean;
  onClose: () => void;
  groups: FunGroup[];
  currentScope: string;
  onSuccess?: (result: SpawnGameResult) => void;
};

const GAMES: Array<{
  type: PanelinhaGameType;
  title: string;
  emoji: string;
  badge: string;
  icon: typeof Brain;
  description: string;
  details: string;
  minPlayers: number;
  maxPlayers: number;
  highlightColor: string;
}> = [
  {
    type: "quiz_royale",
    title: "Quiz Royale das Panelinhas",
    emoji: "🧠",
    badge: "Perguntas & Respostas",
    icon: Brain,
    description: "Batalha de perguntas e respostas com temas dinâmicos gerados por IA!",
    details: "Pontuação por consenso e média de acertos das panelinhas participantes.",
    minPlayers: 4,
    maxPlayers: 20,
    highlightColor: "border-purple-500/50 bg-purple-50/50 dark:border-purple-500/30 dark:bg-purple-950/20",
  },
  {
    type: "grid_ctf",
    title: "Grande Golpe (Assalto ao Cofre)",
    emoji: "🚩",
    badge: "Invasão & Emboscadas",
    icon: Flag,
    description: "Batalha tática em 3 rotas (Norte, Centro, Sul) com invasores e guardiões!",
    details: "Alternância de ataque/defesa entre panelinhas e interceptações táticas.",
    minPlayers: 4,
    maxPlayers: 6,
    highlightColor: "border-amber-500/50 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-950/20",
  },
  {
    type: "king_of_the_hill",
    title: "Rei das Três Colinas (Guerra)",
    emoji: "👑",
    badge: "Controle de Território",
    icon: Crown,
    description: "Disputa simultânea pelas colinas Alfa, Bravo e Charlie com bombas e potes acumulados!",
    details: "Conquista de colinas, blefes com bombas secretas e premiação acumulativa.",
    minPlayers: 4,
    maxPlayers: 6,
    highlightColor: "border-emerald-500/50 bg-emerald-50/50 dark:border-emerald-500/30 dark:bg-emerald-950/20",
  },
];

export function SpawnGameModal({
  open,
  onClose,
  groups,
  currentScope,
  onSuccess,
}: SpawnGameModalProps) {
  const [selectedScope, setSelectedScope] = useState(currentScope);
  const [selectedGame, setSelectedGame] = useState<PanelinhaGameType>("quiz_royale");
  const [prize, setPrize] = useState(1000);
  const [startInMinutes, setStartInMinutes] = useState(3);
  const [announce, setAnnounce] = useState(true);
  const [force, setForce] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SpawnGameResult | null>(null);
  const [copied, setCopied] = useState(false);

  // Sincroniza scope se modal for aberto com outro grupo ativo
  useEffect(() => {
    if (open) {
      setSelectedScope(currentScope);
      setError(null);
      setResult(null);
      setCopied(false);
      setForce(false);
    }
  }, [open, currentScope]);

  // Bloqueio de tecla ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, loading]);

  if (!open) return null;

  const handleSpawn = async () => {
    if (!selectedScope) {
      setError("Selecione um grupo da whitelist para iniciar o jogo.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await funApi.spawnGame({
        scope: selectedScope,
        gameType: selectedGame,
        prize,
        startInMinutes,
        announce,
        force,
      });

      if (!res.ok) {
        if (res.reason === "room_already_active") {
          setError(
            "Já existe uma partida ativa neste grupo! Você pode acessar a partida ativa abaixo ou ativar 'Forçar substituição' para reiniciar."
          );
        } else {
          setError(res.message || res.error || "Falha ao iniciar jogo.");
        }
        return;
      }

      setResult(res);
      onSuccess?.(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado ao spawnar jogo.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (!result?.gameLink) return;
    const fullUrl = result.gameLink.startsWith("http")
      ? result.gameLink
      : `${window.location.origin}${result.gameLink}`;
    void navigator.clipboard.writeText(fullUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const currentGroup = groups.find((g) => g.jid === selectedScope);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="spawn-game-modal-title"
    >
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm transition-opacity"
        aria-label="Fechar"
        onClick={() => {
          if (!loading) onClose();
        }}
      />

      {/* Conteúdo do Modal */}
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        {/* Cabeçalho */}
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900">
              <Swords className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="spawn-game-modal-title"
                className="text-base font-semibold text-zinc-900 dark:text-zinc-50"
              >
                Spawnar Evento de Jogo de Panelinhas
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Selecione o modo e inicie uma partida multiplayer para o grupo
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Corpo com scroll */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-sm">
          {/* Sucesso */}
          {result?.ok && result.room ? (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800/80 dark:bg-emerald-950/30">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                <div className="min-w-0 flex-1 space-y-2">
                  <h3 className="font-semibold text-emerald-900 dark:text-emerald-200">
                    Partida de {result.room.title} spawnada com sucesso!
                  </h3>
                  <p className="text-xs text-emerald-700 dark:text-emerald-300">
                    A sala foi criada com contagem regressiva de {startInMinutes} minutos e prêmio de{" "}
                    <strong>{result.room.prize} moedas</strong> para o cofre da panelinha vencedora.
                  </p>

                  {result.gameLink ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <a
                        href={result.gameLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Abrir Sala no Navegador
                      </a>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={handleCopyLink}
                        className="border-emerald-300 dark:border-emerald-800"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {copied ? "Link Copiado!" : "Copiar Link da Sala"}
                      </Button>
                    </div>
                  ) : null}

                  {announce ? (
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                      📢 O anúncio com o link e instruções foi enviado no WhatsApp do grupo.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {/* Erro */}
          {error ? (
            <div className="flex items-start gap-2.5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <div className="flex-1">
                <span className="font-medium">{error}</span>
                {error.includes("Já existe") ? (
                  <div className="mt-2">
                    <label className="flex cursor-pointer items-center gap-2 font-normal text-rose-700 dark:text-rose-300">
                      <input
                        type="checkbox"
                        checked={force}
                        onChange={(e) => setForce(e.target.checked)}
                        className="rounded border-rose-300 text-rose-600 focus:ring-rose-500"
                      />
                      <span>Substituir e forçar encerramento da sala anterior</span>
                    </label>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Grupo Alvo */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Grupo de Destino (Whitelist)
            </label>
            <Select
              value={selectedScope}
              onChange={(e) => {
                setSelectedScope(e.target.value);
                setError(null);
              }}
              disabled={loading || !groups.length}
            >
              {!groups.length ? (
                <option value="">Nenhum grupo na whitelist</option>
              ) : (
                groups.map((g) => (
                  <option key={g.jid} value={g.jid}>
                    {g.name || shortJid(g.jid)} ({g.jid})
                  </option>
                ))
              )}
            </Select>
            {currentGroup ? (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Apenas jogadores com panelinha cadastrada em{" "}
                <strong>{currentGroup.name || shortJid(currentGroup.jid)}</strong> poderão pontuar e
                jogar.
              </p>
            ) : null}
          </div>

          {/* Escolha do Jogo */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Escolha o Jogo de Panelinhas
            </label>
            <div className="grid gap-2.5 sm:grid-cols-3">
              {GAMES.map((game) => {
                const isSelected = selectedGame === game.type;

                return (
                  <button
                    key={game.type}
                    type="button"
                    onClick={() => {
                      setSelectedGame(game.type);
                      setError(null);
                    }}
                    disabled={loading}
                    className={cn(
                      "flex flex-col items-start rounded-lg border p-3 text-left transition-all",
                      isSelected
                        ? "border-zinc-900 bg-zinc-50 ring-2 ring-zinc-900 dark:border-zinc-100 dark:bg-zinc-800 dark:ring-zinc-100"
                        : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50/50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50"
                    )}
                  >
                    <div className="flex w-full items-center justify-between gap-1.5">
                      <span className="text-2xl" role="img" aria-label={game.title}>
                        {game.emoji}
                      </span>
                      <Badge tone={isSelected ? "ink" : "neutral"} className="text-[10px]">
                        {game.minPlayers}-{game.maxPlayers} players
                      </Badge>
                    </div>

                    <div className="mt-2">
                      <div className="font-semibold text-zinc-900 dark:text-zinc-50">
                        {game.title}
                      </div>
                      <div className="mt-0.5 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
                        {game.badge}
                      </div>
                    </div>

                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                      {game.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Configurações Avançadas */}
          <div className="grid gap-3 rounded-lg border border-zinc-100 bg-zinc-50/70 p-3.5 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-800/40">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                <Clock className="h-3.5 w-3.5 text-zinc-500" />
                Tempo até o início
              </label>
              <Select
                value={String(startInMinutes)}
                onChange={(e) => setStartInMinutes(Number(e.target.value))}
                disabled={loading}
                className="mt-1"
              >
                <option value="1">1 minuto (partida rápida)</option>
                <option value="2">2 minutos</option>
                <option value="3">3 minutos (recomendado)</option>
                <option value="5">5 minutos</option>
                <option value="10">10 minutos</option>
              </Select>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                <Coins className="h-3.5 w-3.5 text-amber-500" />
                Prêmio no Cofre da Panelinha
              </label>
              <Select
                value={String(prize)}
                onChange={(e) => setPrize(Number(e.target.value))}
                disabled={loading}
                className="mt-1"
              >
                <option value="500">💰 500 moedas</option>
                <option value="1000">💰 1.000 moedas (padrão)</option>
                <option value="2000">💰 2.000 moedas</option>
                <option value="5000">💰 5.000 moedas (especial)</option>
              </Select>
            </div>

            <div className="sm:col-span-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                <input
                  type="checkbox"
                  checked={announce}
                  onChange={(e) => setAnnounce(e.target.checked)}
                  disabled={loading}
                  className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
                />
                <span>
                  Enviar anúncio automático no grupo de WhatsApp com link de entrada e instruções
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Rodapé com botões */}
        <footer className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50/50 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {result?.ok ? "Fechar" : "Cancelar"}
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSpawn()}
            disabled={loading || !selectedScope}
            className="gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Iniciando evento...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                {force ? "Forçar e Iniciar Partida" : "Spawnar Jogo no Grupo"}
              </>
            )}
          </Button>
        </footer>
      </div>
    </div>
  );
}
