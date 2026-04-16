import { sendTextMessage } from '../engine/sender.js';
import { interpolate } from '../engine/utils.js';
import { parseCommandInput } from '../engine/commandParser.js';
import { emitConversationEvent } from '../engine/conversationEvents.js';
import {
  INTERNAL_VAR,
  WAIT_TYPE,
} from '../config/constants.js';
import {
  getHumanHandoffState,
  getIncomingMessageText,
  getMultipleChoiceMode,
  normalizeMultipleChoiceOptions,
  shouldSendCommandInvalidMessage,
  toNumber,
  toText,
} from './shared.js';

export async function handleCommandInput({ block, session, sock, jid, runtime }) {
  const cfg = block.config ?? {};
  const incomingMessage = getIncomingMessageText(session, runtime);
  const parseResult = parseCommandInput(incomingMessage, cfg);

  if (!parseResult.matched) {
    const invalidMessage = interpolate(toText(cfg.invalidMessage), session.variables);
    if (invalidMessage && shouldSendCommandInvalidMessage(incomingMessage, cfg, parseResult)) {
      await sendTextMessage(sock, jid, invalidMessage);
    }
    return {
      nextBlockIndex: null,
      sessionPatch: { waitingFor: null },
      done: false,
    };
  }

  const commandName = toText(cfg.command || cfg.pattern);
  return {
    nextBlockIndex: session.blockIndex + 1,
    sessionPatch: {
      variables: {
        ...session.variables,
        ...parseResult.variableValues,
        [INTERNAL_VAR.LAST_COMMAND]: commandName,
        [INTERNAL_VAR.LAST_COMMAND_ARGS]: parseResult.commandArgs,
      },
    },
    done: false,
  };
}

export async function handleMultipleChoice({ block, session, sock, jid }) {
  const cfg = block.config ?? {};
  const options = normalizeMultipleChoiceOptions(cfg);
  if (options.length === 0) {
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
  }

  const { allowMultiple, minSelections, maxSelections } = getMultipleChoiceMode(cfg, options.length);
  const promptText = interpolate(
    toText(cfg.text || cfg.question || cfg.prompt || 'Escolha uma opcao:'),
    session.variables
  );

  const renderedOptions = options
    .map((option, index) => {
      if (!option.description) return `${index + 1}. ${option.title}`;
      return `${index + 1}. ${option.title}\n   _${option.description}_`;
    })
    .join('\n');

  const hint = allowMultiple
    ? `Responda com ${minSelections === maxSelections ? `${minSelections}` : `${minSelections} a ${maxSelections}`} opcao(oes), separadas por virgula.`
    : 'Responda com o numero ou nome da opcao.';

  const messageText = [promptText, '', renderedOptions, '', hint].filter(Boolean).join('\n');
  await sendTextMessage(sock, jid, messageText);

  const captureVariable = toText(cfg.captureVariable || cfg.outputVariable || cfg.variableName || 'multiple_choice_selection');
  const invalidMessage = toText(cfg.invalidMessage || cfg.validationMessage || 'Opcao invalida. Tente novamente.');

  return {
    nextBlockIndex: null,
    sessionPatch: {
      waitingFor: WAIT_TYPE.MULTIPLE_CHOICE,
      variables: {
        ...session.variables,
        [INTERNAL_VAR.MULTIPLE_CHOICE_OPTIONS]: JSON.stringify(options),
        [INTERNAL_VAR.MULTIPLE_CHOICE_ALLOW_MULTIPLE]: String(allowMultiple),
        [INTERNAL_VAR.MULTIPLE_CHOICE_MIN]: String(minSelections),
        [INTERNAL_VAR.MULTIPLE_CHOICE_MAX]: String(maxSelections),
        [INTERNAL_VAR.MULTIPLE_CHOICE_CAPTURE_VAR]: captureVariable,
        [INTERNAL_VAR.MULTIPLE_CHOICE_INVALID_MESSAGE]: invalidMessage,
        [INTERNAL_VAR.NEXT_BLOCK_ON_MULTIPLE_CHOICE]: String(session.blockIndex + 1),
      },
    },
    done: false,
  };
}

export async function handleRedirectToHuman({ block, session, sock, jid, flow }) {
  const cfg = block.config ?? {};
  const nowTs = Date.now();
  const previous = getHumanHandoffState(session);
  const alreadyActive = previous.active === true;

  const queue = toText(interpolate(String(cfg.queue ?? previous.queue ?? 'default'), session.variables)) || 'default';
  const reason = toText(interpolate(String(cfg.reason ?? previous.reason ?? ''), session.variables));
  const targetOnClaim = toText(cfg.onClaimBlockId);
  const targetOnFinish = toText(cfg.onFinishBlockId);
  const targetOnTimeout = toText(cfg.onTimeoutBlockId);
  const timeoutMinutes = Math.max(0, toNumber(cfg.timeoutMinutes, 0));

  const messageTemplate = toText(cfg.message);
  const shouldSendMessage = Boolean(messageTemplate) && !(alreadyActive && previous.messageSent === true);
  if (shouldSendMessage) {
    const text = interpolate(messageTemplate, session.variables);
    if (text) {
      await sendTextMessage(sock, jid, text);
    }
  }

  const handoff = {
    active: true,
    requestedAt: Number(previous.requestedAt) > 0 ? Number(previous.requestedAt) : nowTs,
    updatedAt: nowTs,
    queue,
    reason,
    messageSent: previous.messageSent === true || shouldSendMessage,
    captureUntilClaimed: cfg.captureUntilClaimed !== false,
    onClaimBlockId: targetOnClaim || undefined,
    onFinishBlockId: targetOnFinish || undefined,
    onTimeoutBlockId: targetOnTimeout || undefined,
    timeoutMinutes,
  };

  if (!alreadyActive) {
    emitConversationEvent({
      occurredAt: nowTs,
      eventType: 'human-handoff-requested',
      direction: 'system',
      jid,
      flowPath: flow?.flowPath ?? '',
      messageText: reason || 'Sessao transferida para atendimento humano',
      metadata: {
        blockId: toText(block?.id),
        blockType: toText(block?.type),
        queue,
        reason,
        timeoutMinutes,
        onClaimBlockId: targetOnClaim || null,
        onFinishBlockId: targetOnFinish || null,
        onTimeoutBlockId: targetOnTimeout || null,
      },
    });
  }

  return {
    nextBlockIndex: null,
    sessionPatch: {
      waitingFor: WAIT_TYPE.HUMAN,
      variables: {
        ...session.variables,
        [INTERNAL_VAR.HUMAN_HANDOFF]: handoff,
      },
    },
    done: false,
  };
}

export async function handleSendReaction({ block, session, sock, jid, runtime }) {
  const cfg = block.config ?? {};
  const emoji = interpolate(toText(cfg.emoji || cfg.reaction || cfg.text), session.variables);
  if (!emoji) {
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
  }

  const targetKey = runtime?.incoming?.messageKey || session.variables[INTERNAL_VAR.LAST_INCOMING_MESSAGE_KEY];
  if (!targetKey || !targetKey.id) {
    console.warn('[send-reaction] Nenhuma message key disponivel para enviar reacao.');
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
  }

  await sock.sendMessage(jid, {
    react: {
      text: emoji,
      key: targetKey,
    },
  });

  const removeDelay = Math.max(
    0,
    toNumber(cfg.removeAfterDelay ?? cfg.removeDelay ?? cfg.removeAfterMs ?? cfg.delayMs, 0)
  );
  const shouldRemove = cfg.removeAfter === true || cfg.removeReaction === true || removeDelay > 0;

  if (shouldRemove && removeDelay > 0) {
    setTimeout(() => {
      sock.sendMessage(jid, {
        react: {
          text: '',
          key: targetKey,
        },
      }).catch(() => {});
    }, removeDelay);
  }

  return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
}
