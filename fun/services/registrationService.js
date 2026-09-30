export const REGISTRATION_SESSION_TTL_MS = 5 * 60_000; // 5 minutos
export const MAX_ACTIVE_SESSIONS = 1000;
export const MAX_AUTH_ATTEMPTS = 3;

export const REGISTRATION_STEPS = Object.freeze({
  AWAITING_USERNAME: 'AWAITING_USERNAME',
  AWAITING_PASSWORD: 'AWAITING_PASSWORD',
  AWAITING_PIN: 'AWAITING_PIN',
  AWAITING_ACCOUNT_ACTION: 'AWAITING_ACCOUNT_ACTION',
  AWAITING_VERIFY_PIN_FOR_PASSWORD: 'AWAITING_VERIFY_PIN_FOR_PASSWORD',
  AWAITING_NEW_PASSWORD: 'AWAITING_NEW_PASSWORD',
  AWAITING_VERIFY_PASSWORD_FOR_PIN: 'AWAITING_VERIFY_PASSWORD_FOR_PIN',
  AWAITING_NEW_PIN: 'AWAITING_NEW_PIN',
});

const CANCEL_WORDS = new Set([
  'cancelar',
  '/cancelar',
  'cancel',
  '/cancel',
  'sair',
  '/sair',
  'abortar',
  '/abortar',
  '/cancelar_cadastro',
  'cancelar_cadastro',
]);

/**
 * Validação do nome de usuário.
 * @param {string} username
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateUsername(username) {
  const u = String(username || '').trim();
  if (u.length < 3) {
    return { ok: false, reason: 'O nome de usuário deve conter no mínimo 3 caracteres.' };
  }
  if (u.length > 24) {
    return { ok: false, reason: 'O nome de usuário deve conter no máximo 24 caracteres.' };
  }
  if (/\s/.test(u)) {
    return { ok: false, reason: 'O nome de usuário não pode conter espaços.' };
  }
  if (!/^[a-zA-Z0-9_]+$/.test(u)) {
    return {
      ok: false,
      reason: 'O nome de usuário pode conter apenas letras, números e sublinhado (_).',
    };
  }
  return { ok: true };
}

/**
 * Validação da senha.
 * @param {string} password
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validatePassword(password) {
  const p = String(password || '');
  if (p.trim().length < 6) {
    return { ok: false, reason: 'A senha deve conter no mínimo 6 caracteres.' };
  }
  if (p.length > 128) {
    return { ok: false, reason: 'A senha deve conter no máximo 128 caracteres.' };
  }
  return { ok: true };
}

/**
 * Validação do PIN de 4 dígitos.
 * @param {string} pin
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validatePin(pin) {
  const p = String(pin || '').trim();
  if (!/^\d{4}$/.test(p)) {
    return {
      ok: false,
      reason: 'O código validador deve conter exatamente 4 dígitos numéricos (ex: 1234).',
    };
  }
  return { ok: true };
}

function formatDate(ts) {
  if (!ts) return 'Recente';
  try {
    const d = new Date(Number(ts));
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  } catch {
    return 'Data desconhecida';
  }
}

/**
 * Serviço de cadastro e gerenciador de sessão conversacional em DM.
 */
export function createRegistrationService({ accountRepository, sessionTtlMs = REGISTRATION_SESSION_TTL_MS } = {}) {
  if (!accountRepository) {
    throw new Error('[fun/registrationService] accountRepository é obrigatório');
  }

  /** @type {Map<string, { step: string, data: object, expiresAt: number }>} */
  const sessions = new Map();

  function getSession(userJid, now = Date.now()) {
    const u = String(userJid || '').trim();
    if (!u) return null;
    const session = sessions.get(u);
    if (!session) return null;
    if (session.expiresAt <= now) {
      sessions.delete(u);
      return null;
    }
    return session;
  }

  function hasActiveSession(userJid, now = Date.now()) {
    return getSession(userJid, now) != null;
  }

  function clearSession(userJid) {
    const u = String(userJid || '').trim();
    if (!u) return false;
    return sessions.delete(u);
  }

  function pruneExpiredSessions(now = Date.now()) {
    for (const [jid, session] of sessions.entries()) {
      if (session.expiresAt <= now) {
        sessions.delete(jid);
      }
    }
  }

  function touchSession(userJid, step, data = {}, now = Date.now()) {
    pruneExpiredSessions(now);

    // Evita estouro de memória em ataques de DoS
    if (sessions.size >= MAX_ACTIVE_SESSIONS && !sessions.has(userJid)) {
      const oldestKey = sessions.keys().next().value;
      if (oldestKey) sessions.delete(oldestKey);
    }

    const u = String(userJid || '').trim();
    const session = {
      step,
      data: { ...(sessions.get(u)?.data || {}), ...data },
      expiresAt: now + sessionTtlMs,
    };
    sessions.set(u, session);
    return session;
  }

  /**
   * Inicia o fluxo de cadastro (/cadastrar).
   */
  async function startRegistration({ userJid, isGroup = false, now = Date.now() }) {
    const u = String(userJid || '').trim();
    if (!u) return { ok: false, error: 'no-actor', message: 'Usuário não identificado.' };

    if (isGroup) {
      return {
        ok: false,
        error: 'group_not_allowed',
        message: [
          '🔒 *Cadastro de Conta*',
          '',
          'Por motivos de segurança e privacidade (já que você precisará digitar sua senha e código de 4 dígitos), o cadastro deve ser feito exclusivamente no meu *privado*.',
          '',
          '👉 Me envie uma mensagem no privado com o comando `/cadastrar`.',
        ].join('\n'),
      };
    }

    const existing = accountRepository.getByUserJid(u);
    if (existing) {
      touchSession(u, REGISTRATION_STEPS.AWAITING_ACCOUNT_ACTION, {}, now);
      return {
        ok: true,
        isExisting: true,
        message: [
          '⚠️ *Você já possui uma conta cadastrada!*',
          '',
          `👤 Usuário: *${existing.username}*`,
          `📅 Criado em: *${formatDate(existing.createdAt)}*`,
          '',
          'Opções disponíveis:',
          '1️⃣ Digite *1* ou *senha* para alterar sua senha',
          '2️⃣ Digite *2* ou *pin* para alterar seu PIN (código de 4 dígitos)',
          '❌ Digite *cancelar* para sair',
        ].join('\n'),
      };
    }

    touchSession(u, REGISTRATION_STEPS.AWAITING_USERNAME, {}, now);
    return {
      ok: true,
      isExisting: false,
      message: [
        '📝 *Cadastro no Fun Bot*',
        '_(Jogos online das panelinhas)_',
        '',
        'Por favor, digite o *nome de usuário* desejado:',
        '• Mínimo 3 caracteres (apenas letras, números e _)',
        '• Sem espaços',
        '',
        '_Para cancelar a qualquer momento, digite `cancelar`._',
      ].join('\n'),
    };
  }

  /**
   * Processa uma mensagem de texto recebida durante uma sessão ativa no privado.
   */
  async function handleIncomingMessage({ userJid, text, isGroup = false, now = Date.now() }) {
    if (isGroup) return { handled: false };

    const u = String(userJid || '').trim();
    const raw = String(text || '').trim();
    if (!u || !raw) return { handled: false };

    const session = getSession(u, now);
    if (!session) return { handled: false };

    const normalizedLower = raw.toLowerCase();

    // Cancelamento seguro (não afeta o /cancelar em grupo)
    if (CANCEL_WORDS.has(normalizedLower)) {
      clearSession(u);
      return {
        handled: true,
        canceled: true,
        message: '❌ Cadastro / alteração cancelado com sucesso. Quando quiser recomeçar, digite `/cadastrar`.',
      };
    }

    // Alerta caso o usuário digite acidentalmente um comando do bot durante o cadastro
    if (raw.startsWith('/') && !CANCEL_WORDS.has(normalizedLower)) {
      return {
        handled: true,
        error: 'command_during_registration',
        message: '⚠️ Você enviou um comando enquanto o seu cadastro está em andamento no privado.\n\n• Se deseja cancelar o cadastro para usar outros comandos, digite `cancelar`.\n• Caso queira continuar o cadastro, envie a informação solicitada acima.',
      };
    }

    switch (session.step) {
      case REGISTRATION_STEPS.AWAITING_USERNAME: {
        const val = validateUsername(raw);
        if (!val.ok) {
          return {
            handled: true,
            error: 'invalid_username',
            message: `⚠️ ${val.reason}\n\nPor favor, digite outro nome de usuário:`,
          };
        }

        if (accountRepository.usernameExists(raw, u)) {
          return {
            handled: true,
            error: 'username_taken',
            message: '⚠️ Este nome de usuário já está em uso por outro jogador.\n\nPor favor, escolha outro:',
          };
        }

        touchSession(u, REGISTRATION_STEPS.AWAITING_PASSWORD, { username: raw }, now);
        return {
          handled: true,
          message: [
            `✅ Usuário *${raw}* aceito!`,
            '',
            '🔒 Agora digite a sua *senha*:',
            '_(Mínimo 6 caracteres)_',
          ].join('\n'),
        };
      }

      case REGISTRATION_STEPS.AWAITING_PASSWORD: {
        const val = validatePassword(raw);
        if (!val.ok) {
          return {
            handled: true,
            error: 'invalid_password',
            message: `⚠️ ${val.reason}\n\nPor favor, digite uma senha válida:`,
          };
        }

        touchSession(u, REGISTRATION_STEPS.AWAITING_PIN, { password: raw }, now);
        return {
          handled: true,
          message: [
            '✅ Senha registrada!',
            '',
            '🔢 Por fim, digite seu *código validador de 4 dígitos* (PIN pessoal):',
            '_(Exatamente 4 números, ex: 1234)_',
          ].join('\n'),
        };
      }

      case REGISTRATION_STEPS.AWAITING_PIN: {
        const val = validatePin(raw);
        if (!val.ok) {
          return {
            handled: true,
            error: 'invalid_pin',
            message: `⚠️ ${val.reason}\n\nPor favor, digite um código de 4 números:`,
          };
        }

        const username = session.data.username;
        const password = session.data.password;
        const pin = raw;

        try {
          const account = accountRepository.createAccount({
            userJid: u,
            username,
            password,
            pin,
            now,
          });
          clearSession(u);
          return {
            handled: true,
            completed: true,
            account,
            message: [
              '🎉 *Cadastro realizado com sucesso!*',
              '',
              `👤 Usuário: *${account.username}*`,
              '🔢 Código validador (PIN): *••••*',
              '',
              'Sua conta está criada e vinculada ao seu WhatsApp para os jogos online das panelinhas!',
              'Se precisar alterar seus dados no futuro, basta digitar `/cadastrar` aqui no meu privado.',
            ].join('\n'),
          };
        } catch (err) {
          clearSession(u);
          const isConstraint =
            String(err?.message || '').includes('UNIQUE') ||
            String(err?.code || '').includes('CONSTRAINT');
          const safeMsg = isConstraint
            ? '⚠️ Este nome de usuário ou WhatsApp já possui uma conta cadastrada.'
            : '❌ Não foi possível concluir o seu cadastro no momento. Tente novamente mais tarde.';
          return {
            handled: true,
            error: 'creation_failed',
            message: safeMsg,
          };
        }
      }

      case REGISTRATION_STEPS.AWAITING_ACCOUNT_ACTION: {
        const choice = normalizedLower.replace(/[^a-z0-9]/g, '');
        if (choice === '1' || choice === 'senha' || choice === 'alterarsenha') {
          touchSession(u, REGISTRATION_STEPS.AWAITING_VERIFY_PIN_FOR_PASSWORD, {}, now);
          return {
            handled: true,
            message: [
              '🔑 *Alteração de Senha*',
              '',
              'Para sua segurança, digite seu *PIN atual de 4 dígitos* para autorizar:',
            ].join('\n'),
          };
        }
        if (choice === '2' || choice === 'pin' || choice === 'alterarpin') {
          touchSession(u, REGISTRATION_STEPS.AWAITING_VERIFY_PASSWORD_FOR_PIN, {}, now);
          return {
            handled: true,
            message: [
              '🔢 *Alteração de PIN*',
              '',
              'Para sua segurança, digite sua *senha atual* para autorizar:',
            ].join('\n'),
          };
        }

        return {
          handled: true,
          error: 'invalid_option',
          message: [
            '⚠️ Opção inválida.',
            '',
            'Digite *1* para alterar senha, *2* para alterar PIN ou *cancelar* para sair.',
          ].join('\n'),
        };
      }

      case REGISTRATION_STEPS.AWAITING_VERIFY_PIN_FOR_PASSWORD: {
        const account = accountRepository.getByUserJid(u);
        if (!account || !accountRepository.verifyPin(account, raw)) {
          const attempts = (session.data.attempts || 0) + 1;
          if (attempts >= MAX_AUTH_ATTEMPTS) {
            clearSession(u);
            return {
              handled: true,
              error: 'max_attempts_exceeded',
              message: '❌ Limite de tentativas incorretas excedido por segurança. A operação foi cancelada.',
            };
          }
          touchSession(u, REGISTRATION_STEPS.AWAITING_VERIFY_PIN_FOR_PASSWORD, { attempts }, now);
          return {
            handled: true,
            error: 'wrong_pin',
            message: `❌ PIN incorreto (${attempts}/${MAX_AUTH_ATTEMPTS}). Digite o PIN de 4 dígitos correto ou digite \`cancelar\`:`,
          };
        }

        touchSession(u, REGISTRATION_STEPS.AWAITING_NEW_PASSWORD, {}, now);
        return {
          handled: true,
          message: [
            '✅ PIN confirmado com sucesso!',
            '',
            '🔒 Agora digite a sua *nova senha*:',
            '_(Mínimo 6 caracteres)_',
          ].join('\n'),
        };
      }

      case REGISTRATION_STEPS.AWAITING_NEW_PASSWORD: {
        const val = validatePassword(raw);
        if (!val.ok) {
          return {
            handled: true,
            error: 'invalid_password',
            message: `⚠️ ${val.reason}\n\nPor favor, digite uma nova senha válida:`,
          };
        }

        accountRepository.updatePassword(u, raw, now);
        clearSession(u);
        return {
          handled: true,
          completed: true,
          message: '✅ *Sua senha foi alterada com sucesso!*\n\nVocê já pode usar a nova senha.',
        };
      }

      case REGISTRATION_STEPS.AWAITING_VERIFY_PASSWORD_FOR_PIN: {
        const account = accountRepository.getByUserJid(u);
        if (!account || !accountRepository.verifyPassword(account, raw)) {
          const attempts = (session.data.attempts || 0) + 1;
          if (attempts >= MAX_AUTH_ATTEMPTS) {
            clearSession(u);
            return {
              handled: true,
              error: 'max_attempts_exceeded',
              message: '❌ Limite de tentativas incorretas excedido por segurança. A operação foi cancelada.',
            };
          }
          touchSession(u, REGISTRATION_STEPS.AWAITING_VERIFY_PASSWORD_FOR_PIN, { attempts }, now);
          return {
            handled: true,
            error: 'wrong_password',
            message: `❌ Senha incorreta (${attempts}/${MAX_AUTH_ATTEMPTS}). Digite sua senha atual ou digite \`cancelar\`:`,
          };
        }

        touchSession(u, REGISTRATION_STEPS.AWAITING_NEW_PIN, {}, now);
        return {
          handled: true,
          message: [
            '✅ Senha confirmada com sucesso!',
            '',
            '🔢 Agora digite o seu *novo código validador de 4 dígitos* (PIN):',
            '_(Exatamente 4 números, ex: 1234)_',
          ].join('\n'),
        };
      }

      case REGISTRATION_STEPS.AWAITING_NEW_PIN: {
        const val = validatePin(raw);
        if (!val.ok) {
          return {
            handled: true,
            error: 'invalid_pin',
            message: `⚠️ ${val.reason}\n\nPor favor, digite um código de 4 números:`,
          };
        }

        accountRepository.updatePin(u, raw, now);
        clearSession(u);
        return {
          handled: true,
          completed: true,
          message: '✅ *Seu PIN de 4 dígitos foi alterado com sucesso!*',
        };
      }

      default: {
        clearSession(u);
        return { handled: false };
      }
    }
  }

  return {
    getSession,
    hasActiveSession,
    clearSession,
    startRegistration,
    handleIncomingMessage,
  };
}
