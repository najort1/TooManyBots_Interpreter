"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Trophy,
  Clock,
  Shield,
  Flag,
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
      setTimeout(() => setActionCooldown(false), 200);

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
        if (data.ok && data.room) {
          setRoom(data.room);
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
            return {
              ...prev,
              engineState: {
                ...prevEngine,
                ...payload,
                flags: payload.flags || prevEngine.flags,
                players: payload.players || prevEngine.players,
                scores: payload.scores || prevEngine.scores,
                grid: payload.grid || prevEngine.grid,
              },
            };
          });
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

  // TELA DO JOGO EM ANDAMENTO
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between select-none">
      {/* Barra Superior de Status */}
      <header className="px-4 py-3 bg-slate-900/80 backdrop-blur border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="text-xl">{room.emoji}</span>
          <div>
            <h1 className="text-xs font-bold text-white leading-tight">{room.title}</h1>
            <p className="text-[10px] text-slate-400">
              {room.status === "waiting" ? "Aguardando início..." : "Partida em andamento"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {currentUser && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-950 rounded-lg border border-slate-800 text-xs">
              <span>{currentUser.faction?.emoji || "🏴‍☠️"}</span>
              <span className="font-semibold text-slate-200">{currentUser.username}</span>
            </div>
          )}

          {countdown !== null && room.status === "waiting" && (
            <div className="flex items-center gap-1 text-xs font-mono font-bold text-purple-400">
              <Clock className="w-3.5 h-3.5" />
              <span>{countdown}s</span>
            </div>
          )}
        </div>
      </header>

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

      {/* Placar em Tempo Real das Panelinhas */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3">
        <span className="text-[10px] uppercase font-bold text-slate-500 block mb-2">Placar das Panelinhas</span>
        <div className="flex items-center gap-3 overflow-x-auto pb-1 text-xs">
          {factions?.map((f) => (
            <div key={f.id} className="bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 shrink-0 flex items-center gap-1.5">
              <span>{f.emoji}</span>
              <span className="font-semibold text-white">{f.name}:</span>
              <span className="text-amber-400 font-bold">{f.score}</span>
            </div>
          ))}
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
};

function GridCtfView({ engineState, currentUser, onMove, onTackle }: GridCtfViewProps) {
  const width = engineState?.grid?.width || engineState?.width || 12;
  const height = engineState?.grid?.height || engineState?.height || 8;
  const players = engineState?.players || [];
  const flags = engineState?.flags || {};
  const scores = engineState?.scores || { blue: 0, red: 0 };

  const myPlayer = players.find(
    (p) =>
      (currentUser?.userJid && p.userJid === currentUser.userJid) ||
      (currentUser?.username && p.username === currentUser.username)
  );

  return (
    <div className="flex-1 flex flex-col justify-between">
      {/* Placar de Bandeiras */}
      <div className="flex items-center justify-between p-3 bg-slate-900 border border-slate-800 rounded-xl mb-3 text-xs">
        <div className="flex items-center gap-2 text-blue-400 font-bold">
          <Flag className="w-4 h-4" />
          <span>Azul: {scores.blue} / 3</span>
        </div>
        <span className="text-slate-500 font-mono text-[10px]">
          {myPlayer ? `Time ${myPlayer.team === "blue" ? "Azul" : "Vermelho"}` : "Tático Autorizado"}
        </span>
        <div className="flex items-center gap-2 text-red-400 font-bold">
          <span>Vermelho: {scores.red} / 3</span>
          <Flag className="w-4 h-4" />
        </div>
      </div>

      {/* Grade da Arena */}
      <div className="bg-slate-950 border border-slate-800 rounded-2xl p-2 flex items-center justify-center overflow-x-auto mb-4">
        <div
          className="grid gap-1 bg-slate-900/50 p-2 rounded-xl"
          style={{ gridTemplateColumns: `repeat(${width}, minmax(22px, 1fr))` }}
        >
          {Array.from({ length: height }).map((_, y) =>
            Array.from({ length: width }).map((_, x) => {
              const isBlueBase = x < 2 && y >= 2 && y <= 5;
              const isRedBase = x >= width - 2 && y >= 2 && y <= 5;
              const isMid = x === width / 2 - 1 || x === width / 2;

              // Jogadores nesta célula
              const playerOnCell = players.find((p) => p.x === x && p.y === y);
              const isBlueFlagHere = flags.blue?.x === x && flags.blue?.y === y && !flags.blue?.carrierId;
              const isRedFlagHere = flags.red?.x === x && flags.red?.y === y && !flags.red?.carrierId;

              const cellBg = isBlueBase
                ? "bg-blue-950/40 border-blue-900/50"
                : isRedBase
                ? "bg-red-950/40 border-red-900/50"
                : isMid
                ? "bg-slate-900 border-slate-800"
                : "bg-slate-950 border-slate-800/40";

              const isMe = playerOnCell && myPlayer && playerOnCell.userJid === myPlayer.userJid;

              return (
                <div
                  key={`${x}-${y}`}
                  className={`w-7 h-7 sm:w-9 sm:h-9 rounded-md border flex items-center justify-center text-xs relative ${cellBg} ${
                    isMe ? "ring-2 ring-emerald-400" : ""
                  }`}
                >
                  {isBlueFlagHere && <span className="text-xs animate-bounce">🚩</span>}
                  {isRedFlagHere && <span className="text-xs animate-bounce">🚩</span>}
                  {playerOnCell && (
                    <div
                      className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center text-[10px] font-black shadow-md ${
                        playerOnCell.team === "blue" ? "bg-blue-500 text-white" : "bg-red-500 text-white"
                      } ${playerOnCell.hasFlag ? "ring-2 ring-amber-400" : ""}`}
                    >
                      {playerOnCell.username.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Controles D-Pad para Celular */}
      <div className="flex items-center justify-between px-2 pt-2">
        <div className="grid grid-cols-3 gap-2 w-36">
          <div />
          <button
            onClick={() => onMove("up")}
            className="p-3.5 bg-slate-900 active:bg-slate-800 border border-slate-800 rounded-xl flex items-center justify-center text-slate-200"
          >
            <ArrowUp className="w-5 h-5" />
          </button>
          <div />
          <button
            onClick={() => onMove("left")}
            className="p-3.5 bg-slate-900 active:bg-slate-800 border border-slate-800 rounded-xl flex items-center justify-center text-slate-200"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => onMove("down")}
            className="p-3.5 bg-slate-900 active:bg-slate-800 border border-slate-800 rounded-xl flex items-center justify-center text-slate-200"
          >
            <ArrowDown className="w-5 h-5" />
          </button>
          <button
            onClick={() => onMove("right")}
            className="p-3.5 bg-slate-900 active:bg-slate-800 border border-slate-800 rounded-xl flex items-center justify-center text-slate-200"
          >
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>

        <button
          onClick={onTackle}
          className="px-6 py-4 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-bold rounded-2xl flex items-center gap-2 shadow-lg shadow-red-600/30 text-sm"
        >
          <Sword className="w-5 h-5" />
          <span>Tackle</span>
        </button>
      </div>
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
