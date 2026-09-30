"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Trophy,
  Clock,
  Flag,
  Shield,
  Flame,
  Sword,
  Sparkles,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  CheckCircle2,
  XCircle,
  LogIn,
  Users,
  HelpCircle,
  Info,
  Zap,
  Target,
  BookOpen,
} from "lucide-react";

type Props = { params: Promise<{ roomId: string }> };

type Player = {
  userJid?: string;
  username: string;
  faction?: { id: string; name: string; emoji: string };
  score: number;
  isReady?: boolean;
};

type CurrentUser = {
  userJid?: string;
  username: string;
  faction?: { id: string; name: string; emoji: string };
};

type Faction = {
  id: string;
  name: string;
  emoji: string;
  score: number;
  playerCount: number;
};

type QuizQuestion = {
  index?: number;
  prompt?: string;
  question?: string;
  category?: string;
  options?: string[];
  correctIndex?: number;
  explanation?: string;
};

type QuizStats = {
  round?: number;
  correctIndex?: number;
  correctOption?: string;
  explanation?: string;
  totalAnswers?: number;
  correctCount?: number;
  wrongCount?: number;
  unansweredCount?: number;
  factionStats?: Record<
    string,
    {
      factionId: string;
      factionName: string;
      emoji?: string;
      roundScore: number;
      sumPoints: number;
      eligibleCount: number;
      answeredCount: number;
      correctCount: number;
      consensusPercent: number;
    }
  >;
};

type GridCtfFlag = {
  x: number;
  y: number;
  carrierId: string | null;
  carrierName?: string | null;
  status: "home" | "carried" | "dropped";
};

type GridCtfPlayer = {
  userJid: string;
  username: string;
  team: "blue" | "red";
  x: number;
  y: number;
  facing?: string;
  hasFlag?: boolean;
  isRespawning?: boolean;
  score?: number;
};

type KothZone = {
  id: string;
  name?: string;
  status?: string;
  contested?: boolean;
  controllingFactionId?: string | null;
  controllingFactionName?: string | null;
  playersCount?: number;
};

type KothFactionProgress = {
  name: string;
  score?: number;
  percent: number;
};

type KothPlayer = {
  userJid: string;
  username: string;
  factionId?: string | null;
  isAlive?: boolean;
  currentZoneId?: string | null;
  isShielded?: boolean;
  respawnRemainingMs?: number;
  kills?: number;
  deaths?: number;
};

type EngineState = {
  phase?: "idle" | "loading" | "question" | "reveal" | "ended";
  round?: number;
  currentRound?: number;
  totalRounds?: number;
  remainingSeconds?: number;
  timeRemainingSeconds?: number;
  timeRemainingMs?: number;
  question?: QuizQuestion;
  currentQuestion?: QuizQuestion;
  roundStats?: QuizStats;
  stats?: QuizStats;
  factionsRanking?: Array<{ id: string; name: string; emoji: string; score: number }>;
  playersRanking?: Array<{ userJid: string; username: string; score: number }>;
  width?: number;
  height?: number;
  grid?: {
    width: number;
    height: number;
    obstacles?: string[];
    territorySplitX?: number;
  };
  flags?: {
    blue?: GridCtfFlag;
    red?: GridCtfFlag;
  };
  scores?: {
    blue: number;
    red: number;
  };
  timing?: {
    remainingSeconds: number;
  };
  zones?: Record<string, KothZone>;
  factionProgress?: Record<string, KothFactionProgress>;
  players?: Array<GridCtfPlayer & KothPlayer>;
  currentZone?: string | null;
};

type RoomState = {
  id: string;
  scopeKey: string;
  gameType: "quiz_royale" | "grid_ctf" | "king_of_the_hill";
  title: string;
  emoji: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  prize: number;
  status: "waiting" | "in_progress" | "finished" | "aborted";
  startsAt: number;
  finishedAt: number | null;
  winnerFaction: Faction | null;
  players: Player[];
  factions: Faction[];
  engineState: EngineState | null;
};

export default function GameRoomPage({ params }: Props) {
  const { roomId } = use(params);

  // Autenticação local
  const [token, setToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Estado da sala
  const [room, setRoom] = useState<RoomState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  // Estados dos jogos
  const [quizSelectedChoice, setQuizSelectedChoice] = useState<number | null>(null);
  const [actionCooldown, setActionCooldown] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [showRulesModal, setShowRulesModal] = useState(false);

  // Recupera token salvo
  useEffect(() => {
    const savedToken = localStorage.getItem(`game_token_${roomId}`);
    const savedUser = localStorage.getItem(`game_user_${roomId}`);
    if (savedToken && savedUser) {
      try {
        setToken(savedToken);
        setCurrentUser(JSON.parse(savedUser) as CurrentUser);
      } catch {
        // ignore
      }
    }
  }, [roomId]);

  // Busca inicial do estado da sala
  const fetchRoomState = useCallback(async () => {
    try {
      const res = await fetch(`/api/fun/games/room/${roomId}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok && data.ok) {
        setRoom(data.room);
        setError(null);
      } else {
        setError(data.message || "Sala não encontrada");
      }
    } catch {
      setError("Erro ao carregar dados da partida");
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  useEffect(() => {
    void fetchRoomState();
  }, [fetchRoomState]);

  // Envio de Ação de Jogo
  const sendAction = useCallback(
    async (actionData: Record<string, unknown>) => {
      if (!token || actionCooldown) return;
      setActionCooldown(true);
      setTimeout(() => setActionCooldown(false), 150);

      try {
        const res = await fetch(`/api/fun/games/action/${roomId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(actionData),
        });
        const data = await res.json();
        if (data.ok) {
          if (data.room) {
            setRoom(data.room);
          } else if (data.delta) {
            setRoom((prev) => {
              if (!prev) return prev;
              const prevEngine = prev.engineState || {};
              let mergedPlayers = prevEngine.players || [];
              if (Array.isArray(data.delta.players)) {
                mergedPlayers = data.delta.players;
              } else if (data.delta.player) {
                const p = data.delta.player;
                const idx = mergedPlayers.findIndex(
                  (x) => x.userJid === p.userJid || (p.username && x.username === p.username)
                );
                if (idx >= 0) {
                  mergedPlayers = [...mergedPlayers];
                  mergedPlayers[idx] = { ...mergedPlayers[idx], ...p };
                }
              }
              return {
                ...prev,
                engineState: {
                  ...prevEngine,
                  ...data.delta,
                  players: mergedPlayers,
                  flags: data.delta.flags || prevEngine.flags,
                  scores: data.delta.scores || prevEngine.scores,
                },
              };
            });
          }
          if (data.delta?.events && data.delta.events.length > 0) {
            const ev = data.delta.events[0];
            if (ev?.message) {
              setActionFeedback(ev.message);
              setTimeout(() => setActionFeedback(null), 3000);
            }
          }
        } else if (data.message) {
          setActionFeedback(data.message);
          setTimeout(() => setActionFeedback(null), 2500);
        }
      } catch {}
    },
    [token, actionCooldown, roomId]
  );

  // Conexão Server-Sent Events (SSE) para atualização em tempo real
  useEffect(() => {
    if (!roomId) return;

    let eventSource: EventSource | null = null;
    let fallbackInterval: NodeJS.Timeout | null = null;

    try {
      eventSource = new EventSource(`/api/fun/games/events/${roomId}`);

      eventSource.addEventListener("init", (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload?.room) setRoom(payload.room);
        } catch {}
      });

      eventSource.addEventListener("countdown", (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (typeof payload?.remainingSeconds === "number") {
            setCountdown(payload.remainingSeconds);
          }
        } catch {}
      });

      eventSource.addEventListener("player_joined", () => {
        void fetchRoomState();
      });

      eventSource.addEventListener("game_started", (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload?.room) setRoom(payload.room);
        } catch {
          void fetchRoomState();
        }
      });

      eventSource.addEventListener("game_update", (e) => {
        try {
          const payload = JSON.parse(e.data);
          setRoom((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              engineState: payload.engineState || payload,
              factions: payload.factions || prev.factions,
              players: payload.players || prev.players,
            };
          });
        } catch {}
      });

      // Quiz Royale: Nova pergunta (reseta escolha anterior do usuário)
      eventSource.addEventListener("round_question", (e) => {
        try {
          const payload = JSON.parse(e.data);
          setQuizSelectedChoice(null);
          setRoom((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              factions: payload.factionsRanking || prev.factions,
              engineState: {
                ...(prev.engineState || {}),
                phase: "question",
                currentRound: payload.round ? payload.round - 1 : payload.question?.index ?? 0,
                totalRounds: payload.totalRounds || prev.engineState?.totalRounds,
                question: payload.question,
                currentQuestion: payload.question,
                remainingSeconds: payload.remainingSeconds ?? 15,
                timeRemainingSeconds: payload.remainingSeconds ?? 15,
                factionsRanking: payload.factionsRanking,
              },
            };
          });
        } catch {}
      });

      // Quiz Royale: Revelação da resposta
      eventSource.addEventListener("round_reveal", (e) => {
        try {
          const payload = JSON.parse(e.data);
          setRoom((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              factions: payload.factionsRanking || prev.factions,
              players: payload.playersRanking || prev.players,
              engineState: {
                ...(prev.engineState || {}),
                phase: "reveal",
                question: payload.question,
                currentQuestion: payload.question,
                remainingSeconds: payload.remainingSeconds ?? 4,
                timeRemainingSeconds: payload.remainingSeconds ?? 4,
                roundStats: payload.stats,
                factionsRanking: payload.factionsRanking,
                playersRanking: payload.playersRanking,
              },
            };
          });
        } catch {}
      });

      // Grid CTF: Updates da grade
      const handleCtfUpdate = (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data);
          setRoom((prev) => {
            if (!prev) return prev;
            const prevEngine = prev.engineState || {};
            let mergedPlayers = prevEngine.players || [];

            if (Array.isArray(payload.players)) {
              mergedPlayers = payload.players;
            } else if (payload.player) {
              const p = payload.player;
              const idx = mergedPlayers.findIndex(
                (x) => x.userJid === p.userJid || (p.username && x.username === p.username)
              );
              if (idx >= 0) {
                mergedPlayers = [...mergedPlayers];
                mergedPlayers[idx] = { ...mergedPlayers[idx], ...p };
              } else {
                mergedPlayers = [...mergedPlayers, p];
              }
            }

            if (payload.target) {
              const t = payload.target;
              const idx = mergedPlayers.findIndex((x) => x.userJid === t.userJid);
              if (idx >= 0) {
                mergedPlayers = [...mergedPlayers];
                mergedPlayers[idx] = { ...mergedPlayers[idx], ...t };
              }
            }

            return {
              ...prev,
              engineState: {
                ...prevEngine,
                ...payload,
                flags: payload.flags || prevEngine.flags,
                players: mergedPlayers,
                scores: payload.scores || prevEngine.scores,
                grid: payload.grid || prevEngine.grid,
              },
            };
          });

          if (payload.events && Array.isArray(payload.events) && payload.events.length > 0) {
            const ev = payload.events[0];
            if (ev?.message) {
              setActionFeedback(ev.message);
              setTimeout(() => setActionFeedback(null), 3000);
            }
          }
        } catch {}
      };
      eventSource.addEventListener("ctf_start", handleCtfUpdate);
      eventSource.addEventListener("ctf_update", handleCtfUpdate);

      // King of the Hill: Updates de zonas e progresso
      const handleKothUpdate = (e: MessageEvent) => {
        try {
          const payload = JSON.parse(e.data);
          setRoom((prev) => {
            if (!prev) return prev;
            const prevEngine = prev.engineState || {};
            return {
              ...prev,
              engineState: {
                ...prevEngine,
                ...payload,
                zones: payload.zones || prevEngine.zones,
                factionProgress: payload.factionProgress || prevEngine.factionProgress,
                players: payload.players || prevEngine.players,
              },
            };
          });
        } catch {}
      };
      eventSource.addEventListener("koth_started", handleKothUpdate);
      eventSource.addEventListener("koth_tick", handleKothUpdate);

      eventSource.addEventListener("game_finished", (e) => {
        try {
          const payload = JSON.parse(e.data);
          setRoom((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              status: "finished",
              winnerFaction: payload.winnerFaction,
              factions: payload.factions || prev.factions,
              players: payload.players || prev.players,
              engineState: {
                ...(prev.engineState || {}),
                phase: "ended",
                winnerFaction: payload.winnerFaction,
              },
            };
          });
        } catch {
          void fetchRoomState();
        }
      });

      eventSource.onerror = () => {
        if (!fallbackInterval) {
          fallbackInterval = setInterval(fetchRoomState, 2000);
        }
      };
    } catch {
      fallbackInterval = setInterval(fetchRoomState, 2000);
    }

    return () => {
      if (eventSource) eventSource.close();
      if (fallbackInterval) clearInterval(fallbackInterval);
    };
  }, [roomId, fetchRoomState]);

  // Login de Jogador
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usernameInput.trim() || !passwordInput) {
      setLoginError("Informe o usuário e a senha.");
      return;
    }

    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const res = await fetch("/api/fun/games/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: usernameInput.trim(),
          password: passwordInput,
          roomId,
        }),
      });

      const data = await res.json();
      if (res.ok && data.ok) {
        setToken(data.token);
        setCurrentUser(data.player);
        localStorage.setItem(`game_token_${roomId}`, data.token);
        localStorage.setItem(`game_user_${roomId}`, JSON.stringify(data.player));
        if (data.room) setRoom(data.room);
      } else {
        setLoginError(data.message || "Falha na autenticação.");
      }
    } catch {
      setLoginError("Erro ao comunicar com o servidor.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  // Suporte a teclado no Grid CTF
  useEffect(() => {
    if (room?.gameType !== "grid_ctf" || room?.status !== "in_progress") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }

      if (["ArrowUp", "KeyW"].includes(e.code)) {
        e.preventDefault();
        void sendAction({ action: "move", direction: "up" });
      } else if (["ArrowDown", "KeyS"].includes(e.code)) {
        e.preventDefault();
        void sendAction({ action: "move", direction: "down" });
      } else if (["ArrowLeft", "KeyA"].includes(e.code)) {
        e.preventDefault();
        void sendAction({ action: "move", direction: "left" });
      } else if (["ArrowRight", "KeyD"].includes(e.code)) {
        e.preventDefault();
        void sendAction({ action: "move", direction: "right" });
      } else if (["Space", "KeyF"].includes(e.code)) {
        e.preventDefault();
        void sendAction({ action: "tackle" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [room?.gameType, room?.status, sendAction]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-100 p-4">
        <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-semibold tracking-wide uppercase text-slate-400">Carregando Partida...</p>
      </div>
    );
  }

  if (error || !room) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-100 p-6 text-center">
        <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
        <h1 className="text-xl font-bold mb-2">Partida Indisponível</h1>
        <p className="text-sm text-slate-400 max-w-md mb-6">{error || "Esta sala não existe ou já foi finalizada."}</p>
        <Link
          href="/"
          className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-sm font-semibold transition"
        >
          Voltar ao Início
        </Link>
      </div>
    );
  }

  // TELA DE VITÓRIA / ENCERRAMENTO
  if (room.status === "finished") {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-100 p-6 text-center">
        <Trophy className="w-16 h-16 text-amber-400 animate-bounce mb-4" />
        <span className="text-xs uppercase font-bold tracking-widest text-amber-500 mb-1">Partida Encerrada</span>
        <h1 className="text-2xl font-black text-white mb-2">{room.title}</h1>

        {room.winnerFaction ? (
          <div className="my-6 p-6 bg-slate-900 border border-amber-500/30 rounded-3xl max-w-sm w-full shadow-2xl shadow-amber-500/10">
            <span className="text-4xl block mb-2">{room.winnerFaction.emoji}</span>
            <h2 className="text-lg font-black text-white mb-1">Panelinha Campeã</h2>
            <p className="text-amber-400 font-bold text-xl">{room.winnerFaction.name}</p>
            <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-800">
              💰 +{room.prize} moedas depositadas no cofre da panelinha!
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-400 my-6">A partida terminou em empate!</p>
        )}

        <div className="w-full max-w-md bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 mb-6 text-left">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Placar Final</h3>
          <div className="space-y-2">
            {room.factions.map((f, i) => (
              <div key={f.id} className="flex items-center justify-between text-sm py-1 border-b border-slate-800/50 last:border-0">
                <span className="flex items-center gap-2">
                  <span className="font-bold text-slate-500">{i + 1}º</span>
                  <span>{f.emoji}</span>
                  <span className="font-semibold text-slate-200">{f.name}</span>
                </span>
                <span className="font-mono text-amber-400 font-bold">{f.score} pts</span>
              </div>
            ))}
          </div>
        </div>

        <Link
          href="/"
          className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-2xl text-sm transition"
        >
          Voltar ao Dashboard
        </Link>
      </div>
    );
  }

  // TELA DE ESPERA / LOBBY (Login de Jogador)
  if (!token || !currentUser) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-6 text-slate-100">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl">
          <div className="text-center mb-6">
            <span className="text-4xl block mb-2">{room.emoji}</span>
            <h1 className="text-xl font-black text-white">{room.title}</h1>
            <p className="text-xs text-slate-400 mt-1">{room.description}</p>
          </div>

          <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5 mb-6 text-xs space-y-1.5">
            <div className="flex justify-between text-slate-400">
              <span>Prêmio no cofre:</span>
              <span className="text-amber-400 font-bold">💰 +{room.prize} moedas</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Jogadores na sala:</span>
              <span className="text-slate-200 font-semibold">{room.players.length} / {room.maxPlayers}</span>
            </div>
            {countdown !== null && (
              <div className="flex justify-between text-slate-400">
                <span>Início em:</span>
                <span className="text-purple-400 font-bold">{countdown}s</span>
              </div>
            )}
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">Usuário</label>
              <input
                type="text"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder="Ex: player_zap"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">Senha</label>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
              />
            </div>

            {loginError && (
              <div className="p-3 bg-red-950/60 border border-red-800/80 rounded-xl text-xs text-red-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p>{loginError}</p>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-3 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 font-bold rounded-xl text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 disabled:opacity-50"
            >
              <LogIn className="w-4 h-4" />
              <span>{isLoggingIn ? "Entrando..." : "Entrar na Partida"}</span>
            </button>
          </form>

          <p className="text-[11px] text-slate-500 text-center mt-6">
            Ainda não tem conta? Envie <code className="text-amber-400 bg-slate-950 px-1 py-0.5 rounded">/cadastrar</code> no privado do bot no WhatsApp!
          </p>
        </div>
      </div>
    );
  }

  // TELA DE ESPERA / LOBBY PRÉ-JOGO (para jogadores já autenticados)
  if (room.status === "waiting") {
    return (
      <GameLobbyWaitingView
        room={room}
        currentUser={currentUser}
        countdown={countdown}
      />
    );
  }

  // TELA DO JOGO EM ANDAMENTO
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between select-none">
      {/* Barra Superior de Status */}
      <header className="px-4 py-3 bg-slate-900/80 backdrop-blur border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-xl">{room.emoji}</span>
          <div>
            <h1 className="text-xs font-bold text-white leading-tight">{room.title}</h1>
            <p className="text-[10px] text-slate-400">Partida em andamento</p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => setShowRulesModal(true)}
            className="flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-200 rounded-lg text-xs font-semibold border border-slate-700 transition"
          >
            <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Como Jogar</span>
            <span className="sm:hidden">Regras</span>
          </button>

          {currentUser && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-950 rounded-lg border border-slate-800 text-xs">
              <span>{currentUser.faction?.emoji || "🏴‍☠️"}</span>
              <span className="font-semibold text-slate-200">{currentUser.username}</span>
            </div>
          )}
        </div>
      </header>

      {/* Toast flutuante de feedback de ações */}
      {actionFeedback && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 bg-amber-500 text-slate-950 font-black px-4 py-2 rounded-xl text-xs shadow-2xl flex items-center gap-2 animate-bounce border border-amber-300">
          <Sparkles className="w-4 h-4 shrink-0" />
          <span>{actionFeedback}</span>
        </div>
      )}

      {/* Modal de Regras / Como Jogar */}
      {showRulesModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-amber-400" />
                <h2 className="text-base font-bold text-white">Como Jogar: {room.title}</h2>
              </div>
              <button
                onClick={() => setShowRulesModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-4 text-xs text-slate-300 pr-1">
              {room.gameType === "grid_ctf" && <GridCtfRulesSection />}
              {room.gameType === "king_of_the_hill" && <KingOfTheHillRulesSection />}
              {room.gameType === "quiz_royale" && <QuizRoyaleRulesSection />}
            </div>

            <button
              onClick={() => setShowRulesModal(false)}
              className="mt-5 w-full py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs transition"
            >
              Entendido, Voltar ao Jogo
            </button>
          </div>
        </div>
      )}

      {/* Conteúdo Dinâmico por Tipo de Jogo */}
      <main className="flex-1 flex flex-col p-4 max-w-2xl mx-auto w-full">
        {/* JOGO 1: QUIZ ROYALE */}
        {room.gameType === "quiz_royale" && (
          <QuizRoyaleView
            engineState={room.engineState}
            onAnswer={(choiceIndex: number) => {
              setQuizSelectedChoice(choiceIndex);
              void sendAction({
                action: "answer",
                questionIndex: room.engineState?.currentRound,
                choiceIndex,
              });
            }}
            selectedChoice={quizSelectedChoice}
            factions={room.factions}
          />
        )}

        {/* JOGO 2: GRID CTF */}
        {room.gameType === "grid_ctf" && (
          <GridCtfView
            engineState={room.engineState}
            currentUser={currentUser}
            onMove={(direction: string) => void sendAction({ action: "move", direction })}
            onTackle={() => void sendAction({ action: "tackle" })}
            actionFeedback={actionFeedback}
            onOpenRules={() => setShowRulesModal(true)}
            onActionFeedback={(msg: string) => {
              setActionFeedback(msg);
              setTimeout(() => setActionFeedback(null), 2500);
            }}
          />
        )}

        {/* JOGO 3: KING OF THE HILL */}
        {room.gameType === "king_of_the_hill" && (
          <KingOfTheHillView
            engineState={room.engineState}
            currentUser={currentUser}
            onEnterZone={(zoneId: string) => void sendAction({ action: "entered_zone", zoneId })}
            onLeaveZone={(zoneId: string) => void sendAction({ action: "left_zone", zoneId })}
            onUseAbility={(ability: string) => void sendAction({ action: "use_ability", ability })}
          />
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VIEW DO QUIZ ROYALE
// ---------------------------------------------------------------------------
type QuizRoyaleViewProps = {
  engineState: EngineState | null;
  onAnswer: (choiceIndex: number) => void;
  selectedChoice: number | null;
  factions: Faction[];
};

function QuizRoyaleView({ engineState, onAnswer, selectedChoice, factions }: QuizRoyaleViewProps) {
  const currentQ = engineState?.currentQuestion || engineState?.question;
  const isReveal = engineState?.phase === "reveal";
  const timer = engineState?.remainingSeconds ?? engineState?.timeRemainingSeconds ?? 15;

  if (!currentQ) {
    return (
      <div className="flex-1 flex items-center justify-center text-center p-6">
        <Sparkles className="w-8 h-8 text-amber-400 animate-spin mb-3 mx-auto" />
        <p className="text-sm font-semibold text-slate-300">A IA está preparando a próxima pergunta...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col justify-between">
      {/* Topo: Rodada e Cronômetro */}
      <div>
        <div className="flex items-center justify-between text-xs mb-3 text-slate-400">
          <span>Rodada {(engineState?.currentRound || 0) + 1} de {engineState?.totalRounds || 8}</span>
          <span className="font-semibold text-purple-400">{currentQ.category || "Variados"}</span>
        </div>

        <div className="w-full bg-slate-800 rounded-full h-2 mb-4 overflow-hidden">
          <div
            className={`h-full transition-all duration-1000 ${timer <= 5 ? "bg-red-500" : "bg-amber-400"}`}
            style={{ width: `${(timer / 15) * 100}%` }}
          />
        </div>

        {/* Card da Pergunta */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 mb-6 text-center shadow-lg">
          <h2 className="text-base sm:text-lg font-bold text-white leading-snug">{currentQ.prompt || currentQ.question}</h2>
        </div>
      </div>

      {/* 4 Alternativas Grandes Touch */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        {currentQ.options?.map((opt: string, idx: number) => {
          let btnClass = "bg-slate-900 border-slate-800 text-slate-200 hover:border-amber-500";
          if (selectedChoice === idx) {
            btnClass = "bg-amber-500/20 border-amber-500 text-amber-300 font-bold";
          }
          if (isReveal) {
            if (idx === currentQ.correctIndex) {
              btnClass = "bg-emerald-950/80 border-emerald-500 text-emerald-200 font-bold";
            } else if (selectedChoice === idx) {
              btnClass = "bg-red-950/80 border-red-500 text-red-200";
            }
          }

          return (
            <button
              key={idx}
              onClick={() => !isReveal && onAnswer(idx)}
              disabled={isReveal || selectedChoice !== null}
              className={`p-4 rounded-xl border text-left text-sm transition-all flex items-center justify-between ${btnClass}`}
            >
              <span>{opt}</span>
              {isReveal && idx === currentQ.correctIndex && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />}
              {isReveal && selectedChoice === idx && idx !== currentQ.correctIndex && <XCircle className="w-5 h-5 text-red-400 shrink-0" />}
            </button>
          );
        })}
      </div>

      {/* Explicação da Resposta durante a Fase de Revelação */}
      {isReveal && currentQ.explanation && (
        <div className="bg-amber-950/30 border border-amber-500/30 rounded-2xl p-4 mb-5 text-xs text-amber-200 shadow-md">
          <span className="font-bold text-amber-400 block mb-1">💡 Curiosidade da Pergunta:</span>
          <p className="leading-relaxed text-slate-300">{currentQ.explanation}</p>
        </div>
      )}

      {/* Placar em Tempo Real das Panelinhas */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase font-bold text-slate-500 block">Placar das Panelinhas (Média Coletiva)</span>
          {isReveal && (
            <span className="text-[10px] text-amber-400 font-semibold">Rodada apurada por consenso</span>
          )}
        </div>
        <div className="flex items-center gap-3 overflow-x-auto pb-1 text-xs">
          {(engineState?.factionsRanking && engineState.factionsRanking.length > 0 ? engineState.factionsRanking : factions)?.map((f) => {
            const fStat = engineState?.roundStats?.factionStats?.[f.id];
            return (
              <div key={f.id} className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 shrink-0 flex items-center gap-1.5">
                <span>{f.emoji}</span>
                <span className="font-semibold text-white">{f.name}:</span>
                <span className="text-amber-400 font-bold">{f.score} pts</span>
                {isReveal && fStat?.roundScore !== undefined && (
                  <span className="text-[10px] text-emerald-400 font-semibold ml-1 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/40">
                    +{fStat.roundScore} ({fStat.consensusPercent}%)
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VIEW DO GRID CTF (Capture a Bandeira Tático)
// ---------------------------------------------------------------------------
type GridCtfViewProps = {
  engineState: EngineState | null;
  currentUser: CurrentUser | null;
  onMove: (direction: string) => void;
  onTackle: () => void;
  actionFeedback?: string | null;
  onOpenRules?: () => void;
  onActionFeedback?: (msg: string) => void;
};

function GridCtfView({
  engineState,
  currentUser,
  onMove,
  onTackle,
  actionFeedback,
  onOpenRules,
  onActionFeedback,
}: GridCtfViewProps) {
  const width = engineState?.grid?.width || engineState?.width || 12;
  const height = engineState?.grid?.height || engineState?.height || 8;
  const players = engineState?.players || [];
  const flags = engineState?.flags || {};
  const scores = engineState?.scores || { blue: 0, red: 0 };

  const defaultObstacles = ['3,1', '3,6', '5,2', '5,5', '6,2', '6,5', '8,1', '8,6'];
  const rawObstacles = engineState?.grid?.obstacles || defaultObstacles;
  const obstaclesSet = new Set(Array.isArray(rawObstacles) ? rawObstacles : Object.keys(rawObstacles));

  const myPlayer = players.find(
    (p) =>
      (currentUser?.userJid && p.userJid === currentUser.userJid) ||
      (currentUser?.username && p.username === currentUser.username)
  );

  // Checa se há algum adversário numa das 4 células adjacentes (ao alcance do Tackle)
  const hasAdjacentEnemy = Boolean(
    myPlayer &&
    players.some((other) => {
      if (other.userJid === myPlayer.userJid || other.team === myPlayer.team || other.isRespawning) return false;
      const dx = Math.abs(other.x - myPlayer.x);
      const dy = Math.abs(other.y - myPlayer.y);
      return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
    })
  );

  return (
    <div className="flex-1 flex flex-col justify-between">
      {/* Placar de Bandeiras & Atalho de Regras */}
      <div className="p-3 bg-slate-900 border border-slate-800 rounded-2xl mb-3 text-xs shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-blue-400 font-extrabold text-sm">
            <span className="p-1 rounded-md bg-blue-500/20 border border-blue-500/40">🚩</span>
            <span>Azul: {scores.blue} / 3</span>
          </div>

          <div className="flex items-center gap-2">
            {myPlayer ? (
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-black tracking-wider uppercase border ${
                  myPlayer.team === "blue"
                    ? "bg-blue-950/80 border-blue-500/60 text-blue-300"
                    : "bg-red-950/80 border-red-500/60 text-red-300"
                }`}
              >
                Time {myPlayer.team === "blue" ? "Azul" : "Vermelho"}
              </span>
            ) : (
              <span className="text-slate-500 text-[10px] font-mono">Arena Tática</span>
            )}

            {onOpenRules && (
              <button
                onClick={onOpenRules}
                className="flex items-center gap-1 px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-amber-400 rounded-md text-[10px] font-bold border border-slate-700 transition"
              >
                <HelpCircle className="w-3 h-3" />
                <span>Regras</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 text-red-400 font-extrabold text-sm">
            <span>Vermelho: {scores.red} / 3</span>
            <span className="p-1 rounded-md bg-red-500/20 border border-red-500/40">🚩</span>
          </div>
        </div>

        {/* Guia Rápido de Território */}
        <div className="flex items-center justify-between text-[10px] text-slate-400 px-1 pt-1 border-t border-slate-800/60">
          <span className="text-blue-400">🛡️ Base e Território Azul</span>
          <span className="text-slate-500">| Fronteira Central |</span>
          <span className="text-red-400">Território e Base Vermelha 🛡️</span>
        </div>
      </div>

      {/* Banner de Feedback de Combate / Ações */}
      {actionFeedback && (
        <div className="p-2.5 bg-amber-500/20 border border-amber-500/50 rounded-xl text-amber-200 text-xs font-bold text-center animate-pulse flex items-center justify-center gap-2 mb-2 shadow-md">
          <Info className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{actionFeedback}</span>
        </div>
      )}

      {/* Grade da Arena Tática */}
      <div className="bg-slate-950 border border-slate-800 rounded-3xl p-3 flex flex-col items-center justify-center overflow-x-auto mb-3 shadow-2xl">
        <div
          className="grid gap-1 bg-slate-900/40 p-2 rounded-2xl border border-slate-800/80"
          style={{ gridTemplateColumns: `repeat(${width}, minmax(24px, 1fr))` }}
        >
          {Array.from({ length: height }).map((_, y) =>
            Array.from({ length: width }).map((_, x) => {
              const isObstacle = obstaclesSet.has(`${x},${y}`);
              const isBlueBase = x < 2 && y >= 2 && y <= 5;
              const isRedBase = x >= width - 2 && y >= 2 && y <= 5;
              const isMid = x === Math.floor(width / 2) - 1 || x === Math.floor(width / 2);
              const isBlueTerritory = x < Math.floor(width / 2);

              // Jogadores nesta célula
              const playerOnCell = players.find((p) => p.x === x && p.y === y && !p.isRespawning);
              const isBlueFlagHere = flags.blue?.x === x && flags.blue?.y === y && !flags.blue?.carrierId;
              const isRedFlagHere = flags.red?.x === x && flags.red?.y === y && !flags.red?.carrierId;
              const isBlueFlagDropped = isBlueFlagHere && flags.blue?.status === "dropped";
              const isRedFlagDropped = isRedFlagHere && flags.red?.status === "dropped";

              let cellBg = isBlueTerritory ? "bg-blue-950/20 border-blue-900/30" : "bg-red-950/20 border-red-900/30";

              if (isObstacle) {
                cellBg = "bg-slate-800/95 border-slate-700 shadow-inner";
              } else if (isBlueBase) {
                cellBg = "bg-blue-950/60 border-blue-800/80 shadow-md";
              } else if (isRedBase) {
                cellBg = "bg-red-950/60 border-red-800/80 shadow-md";
              } else if (isMid) {
                cellBg = "bg-slate-900/80 border-slate-800";
              }

              const isMe = Boolean(
                playerOnCell &&
                myPlayer &&
                (playerOnCell.userJid === myPlayer.userJid ||
                  (playerOnCell.username && playerOnCell.username === myPlayer.username))
              );

              return (
                <div
                  key={`${x}-${y}`}
                  className={`w-7 h-7 sm:w-9 sm:h-9 rounded-lg border flex items-center justify-center text-xs relative transition-all ${cellBg} ${
                    isMe ? "ring-2 ring-emerald-400 bg-emerald-500/20 z-20 scale-105" : ""
                  }`}
                  title={isObstacle ? "Obstáculo intransponível" : isBlueBase ? "Base Azul" : isRedBase ? "Base Vermelha" : `(${x},${y})`}
                >
                  {/* Obstáculo */}
                  {isObstacle && (
                    <span className="text-[11px] opacity-80 select-none">🧱</span>
                  )}

                  {/* Bandeira Azul */}
                  {isBlueFlagHere && (
                    <div className={`flex flex-col items-center justify-center z-10 ${isBlueFlagDropped ? "animate-pulse" : "animate-bounce"}`}>
                      <span className="text-xs sm:text-sm drop-shadow-md">🚩</span>
                      {isBlueFlagDropped && (
                        <span className="text-[7px] font-black text-amber-300 bg-slate-950/90 px-0.5 rounded leading-none">NO CHÃO</span>
                      )}
                    </div>
                  )}

                  {/* Bandeira Vermelha */}
                  {isRedFlagHere && (
                    <div className={`flex flex-col items-center justify-center z-10 ${isRedFlagDropped ? "animate-pulse" : "animate-bounce"}`}>
                      <span className="text-xs sm:text-sm drop-shadow-md">🚩</span>
                      {isRedFlagDropped && (
                        <span className="text-[7px] font-black text-amber-300 bg-slate-950/90 px-0.5 rounded leading-none">NO CHÃO</span>
                      )}
                    </div>
                  )}

                  {/* Jogador na célula */}
                  {playerOnCell && (
                    <div className="relative flex flex-col items-center justify-center z-20">
                      {isMe && (
                        <span className="absolute -top-3 px-1 py-0.2 bg-emerald-500 text-[7px] font-black text-slate-950 rounded-sm shadow-md whitespace-nowrap">
                          VOCÊ
                        </span>
                      )}
                      <div
                        className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-[10px] font-black shadow-lg transition-transform ${
                          playerOnCell.team === "blue"
                            ? "bg-blue-500 text-white border border-blue-300"
                            : "bg-red-500 text-white border border-red-300"
                        } ${playerOnCell.hasFlag ? "ring-2 ring-amber-400 animate-pulse scale-110 shadow-amber-400/50" : ""}`}
                      >
                        {playerOnCell.username.slice(0, 1).toUpperCase()}
                      </div>
                      {playerOnCell.hasFlag && (
                        <span className="absolute -bottom-1 -right-1 text-[9px] drop-shadow-md animate-bounce">🚩</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Legenda rápida da arena */}
        <div className="flex items-center justify-center gap-4 text-[10px] text-slate-400 mt-2">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded bg-slate-800 border border-slate-700 inline-block text-[8px] leading-none text-center">🧱</span>
            <span>Obstáculo</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full ring-1 ring-emerald-400 bg-emerald-500/20 inline-block" />
            <span className="text-emerald-400 font-semibold">Você</span>
          </span>
          <span className="flex items-center gap-1">
            <span>🚩</span>
            <span>Bandeira</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" />
            <span>Azul</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
            <span>Vermelho</span>
          </span>
        </div>
      </div>

      {/* Controles Táticos (D-Pad para Celular e Teclado para PC) */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* D-Pad de Movimentação */}
        <div className="grid grid-cols-3 gap-1.5 w-36 shrink-0">
          <div />
          <button
            onClick={() => onMove("up")}
            className="p-3 bg-slate-800 hover:bg-slate-700 active:bg-amber-500 active:text-slate-950 border border-slate-700 rounded-xl flex items-center justify-center text-slate-200 transition shadow-md"
            title="Mover para Cima (W ou Seta Cima)"
          >
            <ArrowUp className="w-5 h-5" />
          </button>
          <div />
          <button
            onClick={() => onMove("left")}
            className="p-3 bg-slate-800 hover:bg-slate-700 active:bg-amber-500 active:text-slate-950 border border-slate-700 rounded-xl flex items-center justify-center text-slate-200 transition shadow-md"
            title="Mover para Esquerda (A ou Seta Esquerda)"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => onMove("down")}
            className="p-3 bg-slate-800 hover:bg-slate-700 active:bg-amber-500 active:text-slate-950 border border-slate-700 rounded-xl flex items-center justify-center text-slate-200 transition shadow-md"
            title="Mover para Baixo (S ou Seta Baixo)"
          >
            <ArrowDown className="w-5 h-5" />
          </button>
          <button
            onClick={() => onMove("right")}
            className="p-3 bg-slate-800 hover:bg-slate-700 active:bg-amber-500 active:text-slate-950 border border-slate-700 rounded-xl flex items-center justify-center text-slate-200 transition shadow-md"
            title="Mover para Direita (D ou Seta Direita)"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>

        {/* Botão de Ataque Tackle com Feedback Inteligente */}
        <div className="flex-1 w-full flex flex-col items-center sm:items-end gap-1.5">
          <button
            onClick={() => {
              if (!hasAdjacentEnemy && onActionFeedback) {
                onActionFeedback("Aproxime-se de um oponente (ao lado) para usar o Tackle!");
              }
              onTackle();
            }}
            className={`w-full sm:w-auto px-6 py-4 font-black rounded-2xl flex items-center justify-center gap-2.5 text-sm transition-all shadow-xl ${
              hasAdjacentEnemy
                ? "bg-red-600 hover:bg-red-500 active:bg-red-700 text-white shadow-red-600/50 ring-2 ring-red-400 animate-pulse"
                : "bg-slate-800 hover:bg-slate-700 active:bg-slate-600 text-slate-300 border border-slate-700"
            }`}
            title="Derrubar inimigo adjacente (Espaço ou F)"
          >
            <Sword className={`w-5 h-5 ${hasAdjacentEnemy ? "text-white animate-bounce" : "text-slate-400"}`} />
            <span>{hasAdjacentEnemy ? "TACKLE (INIMIGO PERTO!)" : "Tackle (Ataque)"}</span>
          </button>

          <span className="text-[10px] text-slate-400 font-mono text-center sm:text-right">
            Teclado: <kbd className="bg-slate-950 px-1 py-0.5 rounded border border-slate-800 text-amber-400">WASD</kbd> / <kbd className="bg-slate-950 px-1 py-0.5 rounded border border-slate-800 text-amber-400">Setas</kbd> • Tackle: <kbd className="bg-slate-950 px-1 py-0.5 rounded border border-slate-800 text-red-400">Espaço</kbd>
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// COMPONENTES DE REGRAS E LOBBY PRÉ-JOGO
// ---------------------------------------------------------------------------

function GridCtfRulesSection() {
  return (
    <div className="space-y-4">
      <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-1">
        <h3 className="font-bold text-amber-400 flex items-center gap-1.5 text-xs uppercase tracking-wide">
          <Target className="w-4 h-4 text-amber-400" />
          <span>Objetivo do Grid CTF</span>
        </h3>
        <p className="text-slate-300 leading-relaxed text-xs">
          Invada o território do time adversário, capture a bandeira inimiga (🚩) e leve-a de volta até a sua base. O primeiro time a fazer <strong className="text-white">3 pontos</strong> vence a partida!
        </p>
      </div>

      <div className="space-y-1.5">
        <h4 className="font-bold text-blue-400 flex items-center gap-1.5 text-xs">
          <Flag className="w-3.5 h-3.5" />
          <span>A Arena e as Bases</span>
        </h4>
        <p className="text-slate-300 leading-relaxed text-xs">
          • <strong className="text-blue-400">Lado Esquerdo</strong>: Base e território do Time Azul.<br />
          • <strong className="text-red-400">Lado Direito</strong>: Base e território do Time Vermelho.<br />
          • <strong className="text-slate-300">Blocos com Tijolo (🧱)</strong>: Paredes táticas intransponíveis.
        </p>
      </div>

      <div className="space-y-1.5">
        <h4 className="font-bold text-red-400 flex items-center gap-1.5 text-xs">
          <Sword className="w-3.5 h-3.5" />
          <span>Combate & Tackle</span>
        </h4>
        <p className="text-slate-300 leading-relaxed text-xs">
          • <strong>Em território amigo</strong>: Você tem vantagem defensiva! Pode atropelar ou usar Tackle em qualquer invasor inimigo ao lado.<br />
          • <strong>Em território inimigo</strong>: Você é invasor e só pode derrubar o adversário se ele estiver carregando a sua bandeira!<br />
          • <strong>Ao sofrer Tackle</strong>: O jogador derrubado larga a bandeira no chão e volta para a base por 3 segundos.
        </p>
      </div>

      <div className="space-y-1.5">
        <h4 className="font-bold text-purple-400 flex items-center gap-1.5 text-xs">
          <Zap className="w-3.5 h-3.5" />
          <span>Controles</span>
        </h4>
        <p className="text-slate-300 leading-relaxed text-xs">
          • <strong>Computador</strong>: <kbd className="bg-slate-950 px-1 py-0.5 rounded border border-slate-800 text-amber-400">W, A, S, D</kbd> ou <kbd className="bg-slate-950 px-1 py-0.5 rounded border border-slate-800 text-amber-400">Setas</kbd> para mover. <kbd className="bg-slate-950 px-1 py-0.5 rounded border border-slate-800 text-red-400">Espaço</kbd> ou <kbd className="bg-slate-950 px-1 py-0.5 rounded border border-slate-800 text-red-400">F</kbd> para Tackle.<br />
          • <strong>Celular</strong>: Use os botões direcionais e o botão vermelho de Tackle.
        </p>
      </div>
    </div>
  );
}

function KingOfTheHillRulesSection() {
  return (
    <div className="space-y-4">
      <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-1">
        <h3 className="font-bold text-amber-400 flex items-center gap-1.5 text-xs uppercase tracking-wide">
          <Target className="w-4 h-4 text-amber-400" />
          <span>Objetivo do King of the Hill</span>
        </h3>
        <p className="text-slate-300 leading-relaxed text-xs">
          Conquiste e defenda as 3 zonas estratégicas (Alfa, Bravo e Charlie) para somar controle para sua panelinha. A primeira a atingir <strong className="text-white">100% de controle</strong> vence!
        </p>
      </div>
      <div className="space-y-1.5">
        <h4 className="font-bold text-purple-400 flex items-center gap-1.5 text-xs">
          <Flame className="w-3.5 h-3.5" />
          <span>Habilidades</span>
        </h4>
        <p className="text-slate-300 leading-relaxed text-xs">
          • <strong>Empurrão</strong>: Afasta adversários para fora da zona de controle.<br />
          • <strong>Escudo</strong>: Bloqueia empurrões por alguns segundos.
        </p>
      </div>
    </div>
  );
}

function QuizRoyaleRulesSection() {
  return (
    <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-1">
      <h3 className="font-bold text-amber-400 flex items-center gap-1.5 text-xs uppercase tracking-wide">
        <Target className="w-4 h-4 text-amber-400" />
        <span>Regras do Quiz Royale</span>
      </h3>
      <p className="text-slate-300 leading-relaxed text-xs">
        Responda às perguntas geradas por Inteligência Artificial no menor tempo possível. A pontuação coletiva da sua panelinha define o campeão!
      </p>
    </div>
  );
}

type GameLobbyWaitingViewProps = {
  room: RoomState;
  currentUser: CurrentUser | null;
  countdown: number | null;
};

function GameLobbyWaitingView({ room, currentUser, countdown }: GameLobbyWaitingViewProps) {
  const [activeTab, setActiveTab] = useState<"tutorial" | "players">("tutorial");

  const minutes = countdown !== null ? Math.floor(countdown / 60) : null;
  const seconds = countdown !== null ? countdown % 60 : null;
  const formattedTime = countdown !== null
    ? `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : "Em instantes";

  const isLastSeconds = countdown !== null && countdown <= 10;
  const isImminent = countdown !== null && countdown <= 5;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 sm:p-6 select-none max-w-2xl mx-auto w-full">
      {/* Topo do Lobby */}
      <div className="text-center pt-2 pb-4 border-b border-slate-800/80">
        <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/30 rounded-full text-amber-400 text-xs font-bold uppercase tracking-wider mb-2">
          <Sparkles className="w-3.5 h-3.5 animate-spin" />
          <span>Lobby Pré-Jogo das Panelinhas</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-white flex items-center justify-center gap-2">
          <span>{room.emoji}</span>
          <span>{room.title}</span>
        </h1>
        <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-md mx-auto">{room.description}</p>

        {/* Premiação */}
        <div className="mt-3 inline-flex items-center gap-2 px-4 py-1.5 bg-slate-900 border border-amber-500/40 rounded-xl text-xs">
          <Trophy className="w-4 h-4 text-amber-400" />
          <span className="text-slate-300">Prêmio no cofre da panelinha campeã:</span>
          <span className="text-amber-400 font-extrabold text-sm">💰 +{room.prize} moedas</span>
        </div>
      </div>

      {/* CRONÔMETRO REGRESSIVO ANIMADO GIGANTE */}
      <div className="my-5">
        <div
          className={`p-6 rounded-3xl border text-center transition-all shadow-2xl relative overflow-hidden ${
            isImminent
              ? "bg-red-950/80 border-red-500 shadow-red-500/40 animate-pulse"
              : isLastSeconds
              ? "bg-amber-950/70 border-amber-500/80 shadow-amber-500/20"
              : "bg-slate-900/90 border-slate-800 shadow-purple-500/5"
          }`}
        >
          {isImminent && (
            <div className="absolute inset-0 bg-red-500/10 pointer-events-none animate-ping" />
          )}

          <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-widest mb-1">
            <Clock
              className={`w-4 h-4 ${
                isImminent ? "text-red-400 animate-spin" : isLastSeconds ? "text-amber-400 animate-bounce" : "text-purple-400"
              }`}
            />
            <span
              className={
                isImminent ? "text-red-400 font-black" : isLastSeconds ? "text-amber-400 font-bold" : "text-slate-400"
              }
            >
              {isImminent ? "🔥 PREPARE-SE! A PARTIDA VAI COMEÇAR!" : isLastSeconds ? "⏳ Quase na hora! Posicione-se!" : "A Partida Inicia em"}
            </span>
          </div>

          {/* Contador Gigante */}
          <div className="my-2">
            {isImminent ? (
              <div className="text-6xl sm:text-7xl font-black text-red-400 animate-bounce tracking-tight font-mono">
                {countdown}
              </div>
            ) : (
              <div className="text-5xl sm:text-6xl font-black text-white tracking-wider font-mono">
                {formattedTime}
              </div>
            )}
          </div>

          <p className="text-[11px] text-slate-400">
            {isImminent
              ? "Início automático iminente! Todos os jogadores serão liberados juntos!"
              : "Todos os jogadores conectados iniciarão a partida automaticamente nesta tela."}
          </p>

          {/* Barra de Progresso visual */}
          {countdown !== null && (
            <div className="w-full bg-slate-950 rounded-full h-2 mt-4 overflow-hidden border border-slate-800">
              <div
                className={`h-full transition-all duration-1000 ${
                  isImminent
                    ? "bg-red-500"
                    : isLastSeconds
                    ? "bg-amber-500"
                    : "bg-gradient-to-r from-purple-500 to-amber-500"
                }`}
                style={{ width: `${Math.min(100, Math.max(5, (countdown / 180) * 100))}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {/* CARD DO JOGADOR LOGADO */}
      {currentUser && (
        <div className="bg-slate-900/70 border border-slate-800 rounded-2xl p-3.5 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center text-xl shadow-inner">
              {currentUser.faction?.emoji || "🏴‍☠️"}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-white">{currentUser.username}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold">
                  Confirmado
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Panelinha: <span className="font-semibold text-slate-200">{currentUser.faction?.name || "Sem Panelinha"}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-semibold bg-emerald-950/60 border border-emerald-800/60 px-2.5 py-1 rounded-lg">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>Pronto</span>
          </div>
        </div>
      )}

      {/* ABAS: COMO JOGAR (REGRAS) / JOGADORES NA SALA */}
      <div className="flex-1 flex flex-col">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => setActiveTab("tutorial")}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition ${
              activeTab === "tutorial"
                ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                : "bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800"
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Como Jogar (Regras)</span>
          </button>
          <button
            onClick={() => setActiveTab("players")}
            className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition ${
              activeTab === "players"
                ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                : "bg-slate-900 hover:bg-slate-800 text-slate-400 border border-slate-800"
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Jogadores na Sala ({room.players.length}/{room.maxPlayers})</span>
          </button>
        </div>

        {/* CONTEÚDO DA ABA */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 overflow-y-auto max-h-72">
          {activeTab === "tutorial" && (
            <>
              {room.gameType === "grid_ctf" && <GridCtfRulesSection />}
              {room.gameType === "king_of_the_hill" && <KingOfTheHillRulesSection />}
              {room.gameType === "quiz_royale" && <QuizRoyaleRulesSection />}
            </>
          )}

          {activeTab === "players" && (
            <div className="space-y-2">
              {room.players.length === 0 ? (
                <p className="text-slate-500 text-center py-4 text-xs">Nenhum jogador na sala ainda.</p>
              ) : (
                room.players.map((p, i) => (
                  <div key={p.userJid || i} className="flex items-center justify-between p-2.5 bg-slate-950 border border-slate-800/80 rounded-xl text-xs">
                    <div className="flex items-center gap-2.5">
                      <span className="text-lg">{p.faction?.emoji || "🏴‍☠️"}</span>
                      <div>
                        <span className="font-bold text-slate-200 block leading-tight">{p.username}</span>
                        <span className="text-[10px] text-slate-400">{p.faction?.name || "Sem Panelinha"}</span>
                      </div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 bg-slate-900 text-slate-300 rounded font-mono">
                      Conectado
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Rodapé informativo */}
      <footer className="pt-3 text-center text-[11px] text-slate-500">
        Esta partida iniciará automaticamente assim que o cronômetro zerar. Não feche esta tela.
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VIEW DO KING OF THE HILL (Domínio das 3 Zonas)
// ---------------------------------------------------------------------------
type KingOfTheHillViewProps = {
  engineState: EngineState | null;
  currentUser: CurrentUser | null;
  onEnterZone: (zoneId: string) => void;
  onLeaveZone: (zoneId: string) => void;
  onUseAbility: (ability: string) => void;
};

function KingOfTheHillView({
  engineState,
  currentUser,
  onEnterZone,
  onLeaveZone,
  onUseAbility,
}: KingOfTheHillViewProps) {
  const zones = engineState?.zones || {};
  const factionProgress = engineState?.factionProgress || {};
  const myPlayer = engineState?.players?.find(
    (p) =>
      (currentUser?.userJid && p.userJid === currentUser.userJid) ||
      (currentUser?.username && p.username === currentUser.username)
  );
  const currentZone = myPlayer?.currentZoneId || engineState?.currentZone || null;

  return (
    <div className="flex-1 flex flex-col justify-between">
      {/* Barras de Progresso de Domínio */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 mb-4">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Progresso de Domínio</h3>
        <div className="space-y-2">
          {Object.entries(factionProgress).map(([fId, data]) => (
            <div key={fId} className="text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="font-bold text-slate-200">{data.name}</span>
                <span className="font-mono text-amber-400 font-bold">{data.percent}%</span>
              </div>
              <div className="w-full bg-slate-950 rounded-full h-3 overflow-hidden border border-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-amber-500 transition-all duration-1000"
                  style={{ width: `${data.percent}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* As 3 Zonas Estratégicas (A, B, C) */}
      <div className="grid grid-cols-3 gap-2.5 mb-6">
        {["A", "B", "C"].map((zoneLetter) => {
          const zInfo = zones[zoneLetter] || {};
          const isUserHere = currentZone === zoneLetter;

          return (
            <div
              key={zoneLetter}
              className={`p-4 rounded-2xl border text-center transition ${
                isUserHere
                  ? "bg-amber-500/10 border-amber-500 shadow-lg shadow-amber-500/10"
                  : "bg-slate-900 border-slate-800"
              }`}
            >
              <span className="text-2xl font-black text-white block mb-1">Zona {zoneLetter}</span>
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-3">
                {zInfo.contested ? "⚠️ Em Disputa" : zInfo.controllingFactionName || "Neutra"}
              </span>

              {isUserHere ? (
                <button
                  onClick={() => onLeaveZone(zoneLetter)}
                  className="w-full py-2 bg-red-950/60 border border-red-800/80 hover:bg-red-900 text-red-300 font-bold text-xs rounded-xl"
                >
                  Sair
                </button>
              ) : (
                <button
                  onClick={() => onEnterZone(zoneLetter)}
                  className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl"
                >
                  Ocupar
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Habilidades Rápidas */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => onUseAbility("push")}
          className="flex-1 py-3.5 bg-purple-600 hover:bg-purple-500 active:bg-purple-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-purple-600/20"
        >
          <Flame className="w-4 h-4" />
          <span>Empurrão</span>
        </button>
        <button
          onClick={() => onUseAbility("shield")}
          className="flex-1 py-3.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20"
        >
          <Shield className="w-4 h-4" />
          <span>Escudo</span>
        </button>
      </div>
    </div>
  );
}
