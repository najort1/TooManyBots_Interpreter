import { randomBytes } from 'node:crypto';

export const MAX_ACTIVE_GAME_SESSIONS = 2000;
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOGIN_LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutos de bloqueio temporário
export const FAILED_ATTEMPTS_TTL_MS = 15 * 60 * 1000; // 15 minutos para expirar tentativas sem nova atividade
export const MAX_TRACKED_FAILED_ATTEMPTS = 5000; // Limite de tentativas rastreadas para evitar DoS de memória

/**
 * Autenticação de jogadores para os jogos multiplayer de panelinhas.
 * Valida credenciais criadas via /cadastrar e verifica pertencimento a panelinha.
 */
export function createGameAuthService({
  accountRepository,
  factionRepository,
  tokenTtlMs = 6 * 60 * 60 * 1000, // 6 horas
} = {}) {
  if (!accountRepository) throw new Error('[gameAuth] accountRepository é obrigatório');
  if (!factionRepository) throw new Error('[gameAuth] factionRepository é obrigatório');

  /** @type {Map<string, { token: string, userJid: string, username: string, scopeKey: string, faction: { id: string, name: string, emoji: string }, expiresAt: number }>} */
  const sessions = new Map();

  /** @type {Map<string, { count: number, lockedUntil: number, lastAttemptAt: number }>} */
  const failedAttempts = new Map();

  function generateToken() {
    return randomBytes(24).toString('hex');
  }

  function pruneExpired(now = Date.now()) {
    for (const [token, sess] of sessions.entries()) {
      if (sess.expiresAt <= now) {
        sessions.delete(token);
      }
    }
    for (const [userKey, attempt] of failedAttempts.entries()) {
      const isLockoutExpired = attempt.lockedUntil > 0 && attempt.lockedUntil <= now;
      const isInactive = now - (attempt.lastAttemptAt || 0) > FAILED_ATTEMPTS_TTL_MS;
      if (isLockoutExpired || isInactive) {
        failedAttempts.delete(userKey);
      }
    }
  }

  function recordFailure(userKey, currentLock, now) {
    if (failedAttempts.size >= MAX_TRACKED_FAILED_ATTEMPTS && !failedAttempts.has(userKey)) {
      const oldestKey = failedAttempts.keys().next().value;
      if (oldestKey) failedAttempts.delete(oldestKey);
    }
    const currentFailures = (currentLock?.count || 0) + 1;
    const lockedUntil = currentFailures >= MAX_FAILED_LOGIN_ATTEMPTS ? now + LOGIN_LOCKOUT_DURATION_MS : 0;
    failedAttempts.set(userKey, {
      count: currentFailures,
      lockedUntil,
      lastAttemptAt: now,
    });
    return { currentFailures, lockedUntil };
  }

  /**
   * Autentica usuário com usuário e senha para uma sala em determinado grupo (scopeKey).
   * Se não tiver conta ou senha errada -> instrui /cadastrar no privado.
   * Se não tiver panelinha -> bloqueia com instrução de /panelinha.
   */
  async function login({ username, password, scopeKey, now = Date.now() }) {
    pruneExpired(now);

    const normUser = String(username || '').trim().toLowerCase();
    const pass = String(password || '');
    const scope = String(scopeKey || '').trim();

    if (!normUser || !pass) {
      return {
        ok: false,
        error: 'missing_credentials',
        message: 'Por favor, preencha o nome de usuário e a senha.',
      };
    }

    if (!scope) {
      return {
        ok: false,
        error: 'missing_scope',
        message: 'Grupo/Sala não especificado.',
      };
    }

    // Proteção contra brute force / DoS de scryptSync
    const userLock = failedAttempts.get(normUser);
    if (userLock) {
      if (userLock.lockedUntil > now) {
        const waitSec = Math.ceil((userLock.lockedUntil - now) / 1000);
        return {
          ok: false,
          error: 'rate_limited',
          message: `Muitas tentativas consecutivas incorretas. Por segurança, tente novamente em ${waitSec} segundos.`,
        };
      }
      // Se o período de lockout expirou, reseta o histórico para conceder novo ciclo de tentativas
      if (userLock.lockedUntil > 0 && userLock.lockedUntil <= now) {
        failedAttempts.delete(normUser);
      }
    }

    // 1. Busca conta
    const account = accountRepository.getByUsername(normUser);
    if (!account) {
      // Registra tentativa falha para evitar enumeração e flood
      recordFailure(normUser, userLock, now);

      return {
        ok: false,
        error: 'account_not_found',
        message: 'Conta não encontrada! Caso ainda não tenha se cadastrado, envie o comando `/cadastrar` no privado do bot no WhatsApp para criar sua conta.',
      };
    }

    // 2. Valida senha
    const isValid = accountRepository.verifyPassword(account, pass);
    if (!isValid) {
      const { currentFailures } = recordFailure(normUser, userLock, now);

      const attemptsRemaining = Math.max(0, MAX_FAILED_LOGIN_ATTEMPTS - currentFailures);
      const suffix = attemptsRemaining > 0
        ? ` (${attemptsRemaining} tentativa(s) restante(s))`
        : ' (Bloqueado temporariamente por 5 minutos)';

      return {
        ok: false,
        error: 'invalid_password',
        message: `Senha incorreta${suffix}. Se esqueceu sua senha, acesse o privado do bot e digite \`/cadastrar\` para redefini-la com seu PIN.`,
      };
    }

    // Senha válida: limpa falhas acumuladas
    failedAttempts.delete(normUser);

    // 3. Valida se o usuário pertence a uma panelinha neste grupo (scopeKey)
    const userFaction = factionRepository.getUserFaction(scope, account.userJid);
    if (!userFaction || !userFaction.faction) {
      return {
        ok: false,
        error: 'no_faction',
        message: `Você (${account.username}) não faz parte de nenhuma panelinha neste grupo!\n\n` +
          'Apenas membros de panelinhas podem competir neste evento diário.\n' +
          'Vá até o grupo do WhatsApp e use `/panelinha criar <nome>` ou `/panelinha entrar <nome>` para se juntar a uma.',
      };
    }

    // 4. Cria sessão do jogador com controle de capacidade máxima (evita DoS de memória)
    if (sessions.size >= MAX_ACTIVE_GAME_SESSIONS) {
      const oldestToken = sessions.keys().next().value;
      if (oldestToken) sessions.delete(oldestToken);
    }

    const token = generateToken();
    const sessionData = {
      token,
      userJid: account.userJid,
      username: account.username,
      scopeKey: scope,
      faction: {
        id: userFaction.faction.id,
        name: userFaction.faction.name,
        emoji: userFaction.faction.emoji || '🏴‍☠️',
      },
      expiresAt: now + tokenTtlMs,
    };

    sessions.set(token, sessionData);

    return {
      ok: true,
      token,
      player: {
        userJid: sessionData.userJid,
        username: sessionData.username,
        faction: sessionData.faction,
      },
    };
  }

  /**
   * Valida um token de sessão existente.
   */
  function resolveToken(token, now = Date.now()) {
    if (!token) return null;
    const sess = sessions.get(String(token).trim());
    if (!sess) return null;
    if (sess.expiresAt <= now) {
      sessions.delete(token);
      return null;
    }
    return sess;
  }

  return {
    login,
    resolveToken,
  };
}
