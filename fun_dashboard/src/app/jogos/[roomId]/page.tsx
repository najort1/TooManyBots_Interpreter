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
  AlertCircle,
  CheckCircle2,
  XCircle,
  LogIn,
  Users,
  HelpCircle,
  Info,
  Target,
  BookOpen,
  Crown,
  Bomb,
  Castle,
  Send,
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

type TacticalScore = {
  teamId: string;
  name: string;
  emoji: string;
  score: number;
  playerCount: number;
};

type TacticalVote = {
  userJid: string;
  username: string;
  teamId: string;
  choice: string;
  useBomb?: boolean;
  isAfk?: boolean;
};

type TacticalRoundReport = {
  round: number;
  totalRounds: number;
  gameType: string;
  roundResult: {
    roundScores?: Record<string, number>;
    newPots?: Record<string, number>;
    reports?: Array<{
      hill?: string;
      winnerTeamId?: string | null;
      pointsAwarded?: number;
      reason?: string;
      bombers?: string[];
      message?: string;
    }>;
    attackingTeamId?: string;
    defendingTeamId?: string;
    totalPoints?: number;
    routes?: Array<{
      route: string;
      invaders?: string[];
      guardians?: string[];
      blockedCount?: number;
      passedCount?: number;
      pointsEarned?: number;
      message?: string;
    }>;
  };
  votes: TacticalVote[];
  scores: TacticalScore[];
};

type EngineState = {
  phase?: "idle" | "loading" | "question" | "reveal" | "round" | "ended";
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
  // Colinas e Golpe
  pots?: { alfa: number; bravo: number; charlie: number };
  scores?: TacticalScore[];
  attackingTeamId?: string | null;
  defendingTeamId?: string | null;
  viewerTeamId?: string | null;
  myCurrentVote?: { choice: string; useBomb?: boolean } | null;
  myBombAvailable?: boolean;
  myTeamSuggestions?: Record<string, number>;
  myTeamChat?: Array<{ userJid: string; username: string; text: string; timestamp: number }>;
  lastRoundReport?: TacticalRoundReport | null;
  roundHistory?: TacticalRoundReport[];
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

  // Busca do estado da sala (passando Bearer token para obter estado privado da equipe)
  const fetchRoomState = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`/api/fun/games/room/${roomId}`, { headers, cache: "no-store" });
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
  }, [roomId, token]);

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
        if (data.ok) {
          if (data.room) {
            setRoom(data.room);
          } else {
            // Atualiza estado local se retornado
            if (data.choice) {
              setRoom((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  engineState: {
                    ...(prev.engineState || {}),
                    myCurrentVote: {
                      choice: data.choice,
                      useBomb: Boolean(data.useBomb),
                    },
                    myBombAvailable: data.hasRemainingBomb ?? prev.engineState?.myBombAvailable,
                  },
                };
              });
            }
          }
          if (data.message) {
            setActionFeedback(data.message);
            setTimeout(() => setActionFeedback(null), 3000);
          }
        } else if (data.message) {
          setActionFeedback(data.message);
          setTimeout(() => setActionFeedback(null), 2500);
        }
      } catch {
        // ignore network error
      }
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

      // Quiz Royale: Nova pergunta
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

      // Jogos Táticos (Colinas & Golpe): Início de nova rodada
      eventSource.addEventListener("round_started", (e) => {
        try {
          const payload = JSON.parse(e.data);
          setRoom((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              engineState: {
                ...(prev.engineState || {}),
                phase: "round",
                currentRound: payload.round ? payload.round - 1 : 0,
                totalRounds: payload.totalRounds || 6,
                remainingSeconds: payload.remainingSeconds ?? 15,
                timeRemainingSeconds: payload.remainingSeconds ?? 15,
                attackingTeamId: payload.attackingTeamId,
                defendingTeamId: payload.defendingTeamId,
                pots: payload.pots || prev.engineState?.pots,
                scores: payload.scores || prev.engineState?.scores,
                myCurrentVote: null,
                myTeamSuggestions: {},
              },
            };
          });
        } catch {}
      });

      // Revelação da rodada (Quiz, Colinas ou Golpe)
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
                currentRound: payload.round ? payload.round - 1 : prev.engineState?.currentRound ?? 0,
                remainingSeconds: payload.remainingSeconds ?? 4,
                timeRemainingSeconds: payload.remainingSeconds ?? 4,
                roundStats: payload.stats || prev.engineState?.roundStats,
                lastRoundReport: payload,
                scores: payload.scores || prev.engineState?.scores,
              },
            };
          });
        } catch {}
      });

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
                scores: payload.scores || prev.engineState?.scores,
              },
            };
          });
        } catch {
          void fetchRoomState();
        }
      });

      // Fallback seguro de polling a cada 2s
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
            {(room.engineState?.scores || room.factions).map((f, i) => (
              <div
                key={f.name + i}
                className="flex items-center justify-between text-sm py-1 border-b border-slate-800/50 last:border-0"
              >
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
              {room.gameType === "grid_ctf" && <GrandeGolpeRulesSection />}
              {room.gameType === "king_of_the_hill" && <ColinasRulesSection />}
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

        {/* JOGO 2: GRANDE GOLPE (Capture a Bandeira / Assalto) */}
        {room.gameType === "grid_ctf" && (
          <GrandeGolpeView
            engineState={room.engineState}
            currentUser={currentUser}
            onVoteRoute={(route: string) => {
              void sendAction({ action: "vote_route", route });
            }}
            onSuggestRoute={(route: string) => {
              void sendAction({ action: "suggest", choice: route });
            }}
            onSendTeamMessage={(message: string) => {
              void sendAction({ action: "team_message", message });
            }}
          />
        )}

        {/* JOGO 3: REI DAS TRÊS COLINAS */}
        {room.gameType === "king_of_the_hill" && (
          <ColinasView
            engineState={room.engineState}
            currentUser={currentUser}
            onVoteHill={(hill: string, useBomb: boolean) => {
              void sendAction({ action: "vote_hill", hill, useBomb });
            }}
            onSuggestHill={(hill: string) => {
              void sendAction({ action: "suggest", choice: hill });
            }}
            onSendTeamMessage={(message: string) => {
              void sendAction({ action: "team_message", message });
            }}
          />
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VIEW DO QUIZ ROYALE (100% Preservada)
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

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 mb-6 text-center shadow-lg">
          <h2 className="text-base sm:text-lg font-bold text-white leading-snug">{currentQ.prompt || currentQ.question}</h2>
        </div>
      </div>

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

      {isReveal && currentQ.explanation && (
        <div className="bg-amber-950/30 border border-amber-500/30 rounded-2xl p-4 mb-5 text-xs text-amber-200 shadow-md">
          <span className="font-bold text-amber-400 block mb-1">💡 Curiosidade da Pergunta:</span>
          <p className="leading-relaxed text-slate-300">{currentQ.explanation}</p>
        </div>
      )}

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
// VIEW DO JOGO 2: 👑 COLINAS (REI DAS TRÊS COLINAS)
// ---------------------------------------------------------------------------
type ColinasViewProps = {
  engineState: EngineState | null;
  currentUser: CurrentUser | null;
  onVoteHill: (hill: string, useBomb: boolean) => void;
  onSuggestHill: (hill: string) => void;
  onSendTeamMessage: (message: string) => void;
};

function ColinasView({
  engineState,
  currentUser: _currentUser,
  onVoteHill,
  onSuggestHill,
  onSendTeamMessage,
}: ColinasViewProps) {
  const isReveal = engineState?.phase === "reveal";
  const timer = engineState?.remainingSeconds ?? 15;
  const currentRound = (engineState?.currentRound ?? 0) + 1;
  const totalRounds = engineState?.totalRounds ?? 6;

  const pots = engineState?.pots || { alfa: 5, bravo: 3, charlie: 2 };
  const scores = engineState?.scores || [];

  const [selectedHill, setSelectedHill] = useState<string>("alfa");
  const [armBomb, setArmBomb] = useState(false);
  const [chatText, setChatText] = useState("");

  const myVote = engineState?.myCurrentVote;
  const canUseBomb = engineState?.myBombAvailable ?? true;
  const mySuggestions = engineState?.myTeamSuggestions || {};
  const myChat = engineState?.myTeamChat || [];
  const lastReport = engineState?.lastRoundReport;

  // Sincroniza estado com voto atual se existir
  useEffect(() => {
    if (myVote?.choice) {
      setSelectedHill(myVote.choice);
      setArmBomb(Boolean(myVote.useBomb));
    }
  }, [myVote]);

  const handleSelectHill = (hill: string) => {
    if (isReveal) return;
    setSelectedHill(hill);
    onVoteHill(hill, armBomb && canUseBomb);
    onSuggestHill(hill);
  };

  const handleToggleBomb = () => {
    if (isReveal || !canUseBomb) return;
    const nextBomb = !armBomb;
    setArmBomb(nextBomb);
    onVoteHill(selectedHill, nextBomb);
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatText.trim()) return;
    onSendTeamMessage(chatText.trim());
    setChatText("");
  };

  return (
    <div className="flex-1 flex flex-col justify-between">
      {/* Topo: Rodada, Cronômetro e Placar */}
      <div>
        <div className="flex items-center justify-between text-xs mb-2 text-slate-400">
          <div className="flex items-center gap-1.5 font-bold">
            <Crown className="w-4 h-4 text-amber-400" />
            <span>Rodada {currentRound} de {totalRounds}</span>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
            isReveal ? "bg-purple-950 border border-purple-500 text-purple-300 animate-pulse" : "bg-amber-950 border border-amber-500/50 text-amber-300"
          }`}>
            {isReveal ? "💥 Revelação dos Votos!" : "⏳ Escolha sua Colina"}
          </span>
        </div>

        {/* Barra de Tempo Animada */}
        <div className="w-full bg-slate-800 rounded-full h-2 mb-4 overflow-hidden">
          <div
            className={`h-full transition-all duration-1000 ${
              isReveal ? "bg-purple-500" : timer <= 5 ? "bg-red-500" : "bg-amber-400"
            }`}
            style={{ width: `${(timer / (isReveal ? 4 : 15)) * 100}%` }}
          />
        </div>

        {/* Placar dos Times */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {scores.map((team, idx) => (
            <div
              key={team.teamId || idx}
              className={`p-2.5 rounded-xl border flex items-center justify-between text-xs ${
                team.teamId === engineState?.viewerTeamId
                  ? "bg-slate-900 border-amber-500/60 shadow-lg shadow-amber-500/5"
                  : "bg-slate-950 border-slate-800"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-base">{team.emoji}</span>
                <div>
                  <span className="font-bold text-white block leading-tight">{team.name}</span>
                  {team.teamId === engineState?.viewerTeamId && (
                    <span className="text-[9px] text-amber-400 font-semibold">Sua Equipe</span>
                  )}
                </div>
              </div>
              <span className="font-mono text-base font-black text-amber-400">{team.score} pts</span>
            </div>
          ))}
        </div>
      </div>

      {/* FASE 1: ESCOLHA DA COLINA */}
      {!isReveal && (
        <div className="space-y-3 mb-4">
          <div className="text-center mb-1">
            <h2 className="text-sm font-bold text-white">Onde sua panelinha vai concentrar forças?</h2>
            <p className="text-[11px] text-slate-400">A panelinha com mais membros leva todos os pontos do pote!</p>
          </div>

          <div className="grid grid-cols-3 gap-2.5">
            {/* Colina Alfa */}
            <button
              onClick={() => handleSelectHill("alfa")}
              className={`p-3.5 rounded-2xl border text-center transition flex flex-col items-center justify-between ${
                selectedHill === "alfa"
                  ? "bg-amber-500/15 border-amber-500 ring-2 ring-amber-400/50 shadow-xl"
                  : "bg-slate-900 border-slate-800 hover:border-slate-700"
              }`}
            >
              <Castle className="w-6 h-6 text-amber-400 mb-1" />
              <span className="text-xs font-black text-white block">Alfa 🏰</span>
              <div className="my-1.5">
                <span className="text-lg font-black text-amber-400 font-mono block leading-none">{pots.alfa} pts</span>
                {pots.alfa > 5 && (
                  <span className="text-[9px] bg-red-950 border border-red-500 text-red-300 px-1 py-0.2 rounded font-black mt-1 inline-block animate-pulse">
                    POTE ALTO!
                  </span>
                )}
              </div>
              <span className="text-[9px] text-slate-400">
                Sua equipe: <strong className="text-amber-300">{mySuggestions.alfa || 0}</strong>
              </span>
            </button>

            {/* Colina Bravo */}
            <button
              onClick={() => handleSelectHill("bravo")}
              className={`p-3.5 rounded-2xl border text-center transition flex flex-col items-center justify-between ${
                selectedHill === "bravo"
                  ? "bg-amber-500/15 border-amber-500 ring-2 ring-amber-400/50 shadow-xl"
                  : "bg-slate-900 border-slate-800 hover:border-slate-700"
              }`}
            >
              <Sword className="w-6 h-6 text-purple-400 mb-1" />
              <span className="text-xs font-black text-white block">Bravo ⚔️</span>
              <div className="my-1.5">
                <span className="text-lg font-black text-purple-400 font-mono block leading-none">{pots.bravo} pts</span>
                {pots.bravo > 3 && (
                  <span className="text-[9px] bg-red-950 border border-red-500 text-red-300 px-1 py-0.2 rounded font-black mt-1 inline-block animate-pulse">
                    POTE ALTO!
                  </span>
                )}
              </div>
              <span className="text-[9px] text-slate-400">
                Sua equipe: <strong className="text-purple-300">{mySuggestions.bravo || 0}</strong>
              </span>
            </button>

            {/* Colina Charlie */}
            <button
              onClick={() => handleSelectHill("charlie")}
              className={`p-3.5 rounded-2xl border text-center transition flex flex-col items-center justify-between ${
                selectedHill === "charlie"
                  ? "bg-amber-500/15 border-amber-500 ring-2 ring-amber-400/50 shadow-xl"
                  : "bg-slate-900 border-slate-800 hover:border-slate-700"
              }`}
            >
              <Shield className="w-6 h-6 text-blue-400 mb-1" />
              <span className="text-xs font-black text-white block">Charlie 💎</span>
              <div className="my-1.5">
                <span className="text-lg font-black text-blue-400 font-mono block leading-none">{pots.charlie} pts</span>
                {pots.charlie > 2 && (
                  <span className="text-[9px] bg-red-950 border border-red-500 text-red-300 px-1 py-0.2 rounded font-black mt-1 inline-block animate-pulse">
                    ACUMULADO
                  </span>
                )}
              </div>
              <span className="text-[9px] text-slate-400">
                Sua equipe: <strong className="text-blue-300">{mySuggestions.charlie || 0}</strong>
              </span>
            </button>
          </div>

          {/* Toggle de Bomba Secreta */}
          <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-2xl flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bomb className={`w-5 h-5 ${canUseBomb ? (armBomb ? "text-red-500 animate-bounce" : "text-amber-400") : "text-slate-600"}`} />
              <div>
                <span className="text-xs font-bold text-white block">
                  {canUseBomb ? (armBomb ? "💣 BOMBA ARMADA NESTA COLINA!" : "Armar Bomba Secreta") : "Bomba Esgotada (1 por partida)"}
                </span>
                <span className="text-[10px] text-slate-400 block">
                  {canUseBomb
                    ? "Zera os pontos de todos e destrói o pote acumulado!"
                    : "Você já usou sua única bomba nesta partida."}
                </span>
              </div>
            </div>

            <button
              onClick={handleToggleBomb}
              disabled={!canUseBomb}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition ${
                !canUseBomb
                  ? "bg-slate-800 text-slate-600 cursor-not-allowed"
                  : armBomb
                  ? "bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-600/30"
                  : "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
              }`}
            >
              {armBomb ? "Desarmar" : "Armar"}
            </button>
          </div>
        </div>
      )}

      {/* FASE 2: REVELAÇÃO DOS VOTOS */}
      {isReveal && lastReport && (
        <div className="p-4 bg-slate-900 border border-purple-500/50 rounded-2xl mb-4 space-y-3 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-xs font-bold text-purple-400 uppercase tracking-wide flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-purple-400" />
              Resultado da Rodada {lastReport.round}
            </span>
            <span className="text-[10px] text-slate-400">Próxima rodada em {timer}s</span>
          </div>

          <div className="space-y-2">
            {lastReport.roundResult?.reports?.map((rep, i) => (
              <div
                key={rep.hill || i}
                className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs flex items-center justify-between"
              >
                <div>
                  <span className="font-bold text-white uppercase block">{rep.hill}:</span>
                  <span className="text-[11px] text-slate-300">{rep.message}</span>
                </div>
                {rep.pointsAwarded && rep.pointsAwarded > 0 ? (
                  <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-500 text-emerald-300 font-mono font-bold text-xs">
                    +{rep.pointsAwarded} pts
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-500 font-mono">0 pts</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Canal Tático Privado da Panelinha */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3 text-xs">
        <div className="flex items-center justify-between mb-2">
          <span className="font-bold text-amber-400 uppercase text-[10px] tracking-wider flex items-center gap-1">
            <Shield className="w-3.5 h-3.5" />
            Canal Secreto da Panelinha (Inimigo não vê)
          </span>
          <span className="text-[10px] text-slate-500">Distribuição da Equipe</span>
        </div>

        {/* Resumo de Sugestões dos Colegas */}
        <div className="flex items-center gap-2 mb-2.5">
          <button
            onClick={() => onSuggestHill("alfa")}
            className="flex-1 py-1 px-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] font-semibold text-slate-200 flex items-center justify-between"
          >
            <span>🏰 Alfa</span>
            <span className="font-mono text-amber-400 font-bold">{mySuggestions.alfa || 0}</span>
          </button>
          <button
            onClick={() => onSuggestHill("bravo")}
            className="flex-1 py-1 px-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] font-semibold text-slate-200 flex items-center justify-between"
          >
            <span>⚔️ Bravo</span>
            <span className="font-mono text-purple-400 font-bold">{mySuggestions.bravo || 0}</span>
          </button>
          <button
            onClick={() => onSuggestHill("charlie")}
            className="flex-1 py-1 px-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] font-semibold text-slate-200 flex items-center justify-between"
          >
            <span>💎 Charlie</span>
            <span className="font-mono text-blue-400 font-bold">{mySuggestions.charlie || 0}</span>
          </button>
        </div>

        {/* Mensagens rápidas */}
        {myChat.length > 0 && (
          <div className="bg-slate-950/80 rounded-xl p-2 mb-2 max-h-16 overflow-y-auto space-y-1 text-[11px]">
            {myChat.slice(-3).map((c, i) => (
              <p key={i} className="leading-tight">
                <strong className="text-amber-400">{c.username}:</strong>{" "}
                <span className="text-slate-300">{c.text}</span>
              </p>
            ))}
          </div>
        )}

        <form onSubmit={handleSendChat} className="flex gap-1.5">
          <input
            type="text"
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            placeholder="Mensagem rápida para a equipe..."
            className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
          />
          <button
            type="submit"
            className="p-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition"
            title="Enviar"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// VIEW DO JOGO 3: 🚩 GRANDE GOLPE (ASSALTO AO COFRE / ROTAS)
// ---------------------------------------------------------------------------
type GrandeGolpeViewProps = {
  engineState: EngineState | null;
  currentUser: CurrentUser | null;
  onVoteRoute: (route: string) => void;
  onSuggestRoute: (route: string) => void;
  onSendTeamMessage: (message: string) => void;
};

function GrandeGolpeView({
  engineState,
  currentUser: _currentUser,
  onVoteRoute,
  onSuggestRoute,
  onSendTeamMessage,
}: GrandeGolpeViewProps) {
  const isReveal = engineState?.phase === "reveal";
  const timer = engineState?.remainingSeconds ?? 15;
  const currentRound = (engineState?.currentRound ?? 0) + 1;
  const totalRounds = engineState?.totalRounds ?? 6;

  const viewerTeamId = engineState?.viewerTeamId;
  const attackingTeamId = engineState?.attackingTeamId;
  const isAttacking = viewerTeamId && attackingTeamId === viewerTeamId;

  const scores = engineState?.scores || [];
  const myVote = engineState?.myCurrentVote;
  const mySuggestions = engineState?.myTeamSuggestions || {};
  const myChat = engineState?.myTeamChat || [];
  const lastReport = engineState?.lastRoundReport;

  const [selectedRoute, setSelectedRoute] = useState<string>("floresta");
  const [chatText, setChatText] = useState("");

  useEffect(() => {
    if (myVote?.choice) {
      setSelectedRoute(myVote.choice);
    }
  }, [myVote]);

  const handleSelectRoute = (route: string) => {
    if (isReveal) return;
    setSelectedRoute(route);
    onVoteRoute(route);
    onSuggestRoute(route);
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatText.trim()) return;
    onSendTeamMessage(chatText.trim());
    setChatText("");
  };

  return (
    <div className="flex-1 flex flex-col justify-between">
      {/* Topo: Rodada, Cronômetro e Papel */}
      <div>
        <div className="flex items-center justify-between text-xs mb-2 text-slate-400">
          <div className="flex items-center gap-1.5 font-bold">
            <Flag className="w-4 h-4 text-amber-400" />
            <span>Rodada {currentRound} de {totalRounds}</span>
          </div>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
            isReveal ? "bg-purple-950 border border-purple-500 text-purple-300 animate-pulse" : "bg-amber-950 border border-amber-500/50 text-amber-300"
          }`}>
            {isReveal ? "💥 Revelação do Golpe!" : isAttacking ? "⚔️ Invasão Ativa" : "🛡️ Defesa Ativa"}
          </span>
        </div>

        {/* Banner de Papel da Rodada */}
        <div
          className={`p-3 rounded-2xl border text-center mb-3 transition shadow-lg ${
            isAttacking
              ? "bg-red-950/40 border-red-500/60 shadow-red-500/5"
              : "bg-blue-950/40 border-blue-500/60 shadow-blue-500/5"
          }`}
        >
          <div className="flex items-center justify-center gap-2 mb-0.5">
            {isAttacking ? (
              <Sword className="w-4 h-4 text-red-400" />
            ) : (
              <Shield className="w-4 h-4 text-blue-400" />
            )}
            <h2 className={`text-sm font-black uppercase tracking-wide ${isAttacking ? "text-red-300" : "text-blue-300"}`}>
              {isAttacking ? "Sua Panelinha está Atacando!" : "Sua Panelinha está Defendendo!"}
            </h2>
          </div>
          <p className="text-[11px] text-slate-300">
            {isAttacking
              ? "Escolha uma rota para invadir a base rival e roubar relíquias!"
              : "Escolha uma rota para montar guarda e emboscar os invasores!"}
          </p>
        </div>

        {/* Barra de Tempo Animada */}
        <div className="w-full bg-slate-800 rounded-full h-2 mb-4 overflow-hidden">
          <div
            className={`h-full transition-all duration-1000 ${
              isReveal ? "bg-purple-500" : timer <= 5 ? "bg-red-500" : "bg-amber-400"
            }`}
            style={{ width: `${(timer / (isReveal ? 4 : 15)) * 100}%` }}
          />
        </div>

        {/* Placar de Relíquias */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {scores.map((team, idx) => (
            <div
              key={team.teamId || idx}
              className={`p-2.5 rounded-xl border flex items-center justify-between text-xs ${
                team.teamId === viewerTeamId
                  ? "bg-slate-900 border-amber-500/60 shadow-lg shadow-amber-500/5"
                  : "bg-slate-950 border-slate-800"
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-base">{team.emoji}</span>
                <div>
                  <span className="font-bold text-white block leading-tight">{team.name}</span>
                  {team.teamId === viewerTeamId && (
                    <span className="text-[9px] text-amber-400 font-semibold">Sua Equipe</span>
                  )}
                </div>
              </div>
              <span className="font-mono text-base font-black text-amber-400">{team.score} 💎</span>
            </div>
          ))}
        </div>
      </div>

      {/* FASE 1: ESCOLHA DA ROTA */}
      {!isReveal && (
        <div className="space-y-3 mb-4">
          <div className="grid grid-cols-3 gap-2.5">
            {/* Rota 1: Floresta */}
            <button
              onClick={() => handleSelectRoute("floresta")}
              className={`p-3.5 rounded-2xl border text-center transition flex flex-col items-center justify-between ${
                selectedRoute === "floresta"
                  ? "bg-emerald-500/15 border-emerald-500 ring-2 ring-emerald-400/50 shadow-xl"
                  : "bg-slate-900 border-slate-800 hover:border-slate-700"
              }`}
            >
              <span className="text-2xl block mb-1">🌲</span>
              <span className="text-xs font-black text-white block">Floresta</span>
              <div className="my-1.5">
                <span className="text-lg font-black text-emerald-400 font-mono block leading-none">1 💎</span>
                <span className="text-[9px] text-slate-400 block mt-0.5">Rota Discreta</span>
              </div>
              <span className="text-[9px] text-slate-400">
                Sua equipe: <strong className="text-emerald-300">{mySuggestions.floresta || 0}</strong>
              </span>
            </button>

            {/* Rota 2: Túnel */}
            <button
              onClick={() => handleSelectRoute("tunel")}
              className={`p-3.5 rounded-2xl border text-center transition flex flex-col items-center justify-between ${
                selectedRoute === "tunel"
                  ? "bg-purple-500/15 border-purple-500 ring-2 ring-purple-400/50 shadow-xl"
                  : "bg-slate-900 border-slate-800 hover:border-slate-700"
              }`}
            >
              <span className="text-2xl block mb-1">🏰</span>
              <span className="text-xs font-black text-white block">Túnel</span>
              <div className="my-1.5">
                <span className="text-lg font-black text-purple-400 font-mono block leading-none">2 💎</span>
                <span className="text-[9px] text-slate-400 block mt-0.5">Equilibrada</span>
              </div>
              <span className="text-[9px] text-slate-400">
                Sua equipe: <strong className="text-purple-300">{mySuggestions.tunel || 0}</strong>
              </span>
            </button>

            {/* Rota 3: Ponte */}
            <button
              onClick={() => handleSelectRoute("ponte")}
              className={`p-3.5 rounded-2xl border text-center transition flex flex-col items-center justify-between ${
                selectedRoute === "ponte"
                  ? "bg-amber-500/15 border-amber-500 ring-2 ring-amber-400/50 shadow-xl"
                  : "bg-slate-900 border-slate-800 hover:border-slate-700"
              }`}
            >
              <span className="text-2xl block mb-1">🌉</span>
              <span className="text-xs font-black text-white block">Ponte</span>
              <div className="my-1.5">
                <span className="text-lg font-black text-amber-400 font-mono block leading-none">3 💎</span>
                <span className="text-[9px] text-red-400 font-bold block mt-0.5">Alto Risco!</span>
              </div>
              <span className="text-[9px] text-slate-400">
                Sua equipe: <strong className="text-amber-300">{mySuggestions.ponte || 0}</strong>
              </span>
            </button>
          </div>
        </div>
      )}

      {/* FASE 2: REVELAÇÃO DO CONFRONTO */}
      {isReveal && lastReport && (
        <div className="p-4 bg-slate-900 border border-purple-500/50 rounded-2xl mb-4 space-y-3 shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-xs font-bold text-purple-400 uppercase tracking-wide flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-purple-400" />
              Resultado da Invasão (Rodada {lastReport.round})
            </span>
            <span className="text-[10px] text-slate-400">Próxima em {timer}s</span>
          </div>

          <div className="space-y-2">
            {lastReport.roundResult?.routes?.map((r, i) => (
              <div
                key={r.route || i}
                className="p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs flex items-center justify-between"
              >
                <div>
                  <span className="font-bold text-white uppercase block">{r.route}:</span>
                  <span className="text-[11px] text-slate-300">{r.message}</span>
                </div>
                {r.pointsEarned && r.pointsEarned > 0 ? (
                  <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-500 text-emerald-300 font-mono font-bold text-xs">
                    +{r.pointsEarned} 💎
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-500 font-mono">0 💎</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Canal Tático Privado da Panelinha */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-3 text-xs">
        <div className="flex items-center justify-between mb-2">
          <span className="font-bold text-amber-400 uppercase text-[10px] tracking-wider flex items-center gap-1">
            <Shield className="w-3.5 h-3.5" />
            Canal Secreto da Panelinha (Inimigo não vê)
          </span>
          <span className="text-[10px] text-slate-500">Distribuição da Equipe</span>
        </div>

        {/* Resumo de Sugestões dos Colegas */}
        <div className="flex items-center gap-2 mb-2.5">
          <button
            onClick={() => onSuggestRoute("floresta")}
            className="flex-1 py-1 px-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] font-semibold text-slate-200 flex items-center justify-between"
          >
            <span>🌲 Floresta</span>
            <span className="font-mono text-emerald-400 font-bold">{mySuggestions.floresta || 0}</span>
          </button>
          <button
            onClick={() => onSuggestRoute("tunel")}
            className="flex-1 py-1 px-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] font-semibold text-slate-200 flex items-center justify-between"
          >
            <span>🏰 Túnel</span>
            <span className="font-mono text-purple-400 font-bold">{mySuggestions.tunel || 0}</span>
          </button>
          <button
            onClick={() => onSuggestRoute("ponte")}
            className="flex-1 py-1 px-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] font-semibold text-slate-200 flex items-center justify-between"
          >
            <span>🌉 Ponte</span>
            <span className="font-mono text-amber-400 font-bold">{mySuggestions.ponte || 0}</span>
          </button>
        </div>

        {/* Mensagens rápidas */}
        {myChat.length > 0 && (
          <div className="bg-slate-950/80 rounded-xl p-2 mb-2 max-h-16 overflow-y-auto space-y-1 text-[11px]">
            {myChat.slice(-3).map((c, i) => (
              <p key={i} className="leading-tight">
                <strong className="text-amber-400">{c.username}:</strong>{" "}
                <span className="text-slate-300">{c.text}</span>
              </p>
            ))}
          </div>
        )}

        <form onSubmit={handleSendChat} className="flex gap-1.5">
          <input
            type="text"
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            placeholder="Mensagem rápida para a equipe..."
            className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
          />
          <button
            type="submit"
            className="p-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg transition"
            title="Enviar"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// COMPONENTES DE REGRAS E LOBBY PRÉ-JOGO
// ---------------------------------------------------------------------------

function GrandeGolpeRulesSection() {
  return (
    <div className="space-y-4">
      <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-1">
        <h3 className="font-bold text-amber-400 flex items-center gap-1.5 text-xs uppercase tracking-wide">
          <Target className="w-4 h-4 text-amber-400" />
          <span>Objetivo do Grande Golpe</span>
        </h3>
        <p className="text-slate-300 leading-relaxed text-xs">
          Uma batalha tática assimétrica entre 2 panelinhas dividida em <strong className="text-white">6 rodadas de 15 segundos</strong>. Cada time ataca 3 vezes e defende 3 vezes!
        </p>
      </div>

      <div className="space-y-1.5">
        <h4 className="font-bold text-amber-400 flex items-center gap-1.5 text-xs">
          <span>🌉 As 3 Rotas de Invasão</span>
        </h4>
        <p className="text-slate-300 leading-relaxed text-xs">
          • <strong className="text-emerald-400">🌲 Floresta:</strong> Rota discreta e segura. Rende <strong className="text-white">1 Relíquia</strong> por invasor não barrado.<br />
          • <strong className="text-purple-400">🏰 Túnel:</strong> Rota subterrânea equilibrada. Rende <strong className="text-white">2 Relíquias</strong> por invasor não barrado.<br />
          • <strong className="text-amber-400">🌉 Ponte:</strong> Rota aberta de alto risco. Rende <strong className="text-white">3 Relíquias</strong> por invasor não barrado!
        </p>
      </div>

      <div className="space-y-1.5">
        <h4 className="font-bold text-blue-400 flex items-center gap-1.5 text-xs">
          <Shield className="w-3.5 h-3.5" />
          <span>Emboscadas e Bloqueios</span>
        </h4>
        <p className="text-slate-300 leading-relaxed text-xs">
          • Cada guardião defensor na rota barra <strong className="text-white">1 invasor</strong>.<br />
          • Invasores não barrados roubam as relíquias correspondentes à rota!<br />
          • Quem tiver mais relíquias roubadas ao final das 6 rodadas vence a disputa!
        </p>
      </div>
    </div>
  );
}

function ColinasRulesSection() {
  return (
    <div className="space-y-4">
      <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-1">
        <h3 className="font-bold text-amber-400 flex items-center gap-1.5 text-xs uppercase tracking-wide">
          <Target className="w-4 h-4 text-amber-400" />
          <span>Objetivo do Rei das Três Colinas</span>
        </h3>
        <p className="text-slate-300 leading-relaxed text-xs">
          Disputa simultânea em <strong className="text-white">6 rodadas de 15 segundos</strong> pelas colinas Alfa, Bravo e Charlie. A panelinha com mais membros na colina leva todo o pote!
        </p>
      </div>

      <div className="space-y-1.5">
        <h4 className="font-bold text-amber-400 flex items-center gap-1.5 text-xs">
          <span>🏰 As 3 Colinas & Potes Acumulados</span>
        </h4>
        <p className="text-slate-300 leading-relaxed text-xs">
          • <strong className="text-amber-400">🏰 Alfa:</strong> Base 5 pontos (Disputada por todos).<br />
          • <strong className="text-purple-400">⚔️ Bravo:</strong> Base 3 pontos (Meio-termo tático).<br />
          • <strong className="text-blue-400">💎 Charlie:</strong> Base 2 pontos (Refúgio seguro).<br />
          • <strong className="text-white">Empates acumulam:</strong> Se a colina empatar, ninguém pontua e o valor dobra na rodada seguinte!
        </p>
      </div>

      <div className="space-y-1.5">
        <h4 className="font-bold text-red-400 flex items-center gap-1.5 text-xs">
          <Bomb className="w-3.5 h-3.5" />
          <span>A Bomba Secreta</span>
        </h4>
        <p className="text-slate-300 leading-relaxed text-xs">
          • Cada jogador possui <strong className="text-white">1 Bomba secreta</strong> para toda a partida.<br />
          • Uma colina com bomba explode: ninguém pontua e o pote acumulado é destruído!
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

        <div className="mt-3 inline-flex items-center gap-2 px-4 py-1.5 bg-slate-900 border border-amber-500/40 rounded-xl text-xs">
          <Trophy className="w-4 h-4 text-amber-400" />
          <span className="text-slate-300">Prêmio no cofre da panelinha campeã:</span>
          <span className="text-amber-400 font-extrabold text-sm">💰 +{room.prize} moedas</span>
        </div>
      </div>

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

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 overflow-y-auto max-h-72">
          {activeTab === "tutorial" && (
            <>
              {room.gameType === "grid_ctf" && <GrandeGolpeRulesSection />}
              {room.gameType === "king_of_the_hill" && <ColinasRulesSection />}
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

      <footer className="pt-3 text-center text-[11px] text-slate-500">
        Esta partida iniciará automaticamente assim que o cronômetro zerar. Não feche esta tela.
      </footer>
    </div>
  );
}
