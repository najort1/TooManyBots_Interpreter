import { sendTextMessage, sendListMessage } from '../engine/sender.js';
import { interpolate, interpolateForDisplay } from '../engine/utils.js';
import { delay } from '../utils/async.js';
import {
  INTERNAL_VAR,
  SESSION_STATUS,
  WAIT_TYPE,
} from '../config/constants.js';

export async function handleInitialMessage({ block, session, sock, jid }) {
  const text = interpolateForDisplay(block.config.text, session.variables);
  await sendTextMessage(sock, jid, text);
  return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
}

export async function handleSendText({ block, session, sock, jid }) {
  const text = interpolateForDisplay(block.config.text, session.variables);
  await sendTextMessage(sock, jid, text);

  if (block.config.waitForResponse || block.config.captureResponse) {
    return {
      nextBlockIndex: null,
      sessionPatch: {
        waitingFor: WAIT_TYPE.KEYWORD,
        variables: {
          ...session.variables,
          [INTERNAL_VAR.KEYWORDS]: JSON.stringify(block.config.keywords ?? []),
          [INTERNAL_VAR.CAPTURE_VARIABLE]: block.config.captureVariable || '',
          [INTERNAL_VAR.NEXT_BLOCK_ON_KEYWORD]: String(session.blockIndex + 1),
        },
      },
      done: false,
    };
  }

  return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
}

export async function handleSendList({ block, session, sock, jid }) {
  const cfg = block.config;
  const text = interpolate(cfg.text, session.variables);
  const items = Array.isArray(cfg.items) ? cfg.items : [];

  await sendListMessage(sock, jid, {
    text,
    items: items.map(item => ({
      id: item.id,
      title: interpolate(item.title, session.variables),
      description: interpolate(item.description, session.variables),
    })),
  });

  return {
    nextBlockIndex: null,
    sessionPatch: {
      waitingFor: WAIT_TYPE.LIST,
      variables: {
        ...session.variables,
        [INTERNAL_VAR.LIST_ITEMS]: JSON.stringify(items),
        [INTERNAL_VAR.NEXT_BLOCK_ON_LIST]: String(session.blockIndex + 1),
      },
    },
    done: false,
  };
}

export async function handleSetVariable({ block, session }) {
  const { variableName, variableValue } = block.config;
  const interpolatedValue = interpolate(String(variableValue ?? ''), session.variables);

  return {
    nextBlockIndex: session.blockIndex + 1,
    sessionPatch: {
      variables: { ...session.variables, [variableName]: interpolatedValue },
    },
    done: false,
  };
}

export async function handleRedirect({ block, session, flow }) {
  const targetId = block.config.targetBlockId;
  if (!targetId) {
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
  }

  const idx = flow.indexMap.get(targetId);
  if (idx === undefined) {
    console.warn(`[Redirect] Bloco alvo "${targetId}" nao encontrado. Avancando sequencialmente.`);
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
  }

  const patch = {};
  if (idx <= session.blockIndex) {
    patch.variables = { ...session.variables, [INTERNAL_VAR.IF_STACK]: '[]' };
  }

  return { nextBlockIndex: idx, sessionPatch: patch, done: false };
}

export async function handleDelay({ block, session }) {
  const ms = block.config.duration ?? 1000;
  await delay(ms);
  return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
}

export async function handleEndConversation({ block, session, sock, jid, flow }) {
  const shouldSendClosingMessage = flow?.runtimeConfig?.endBehavior?.sendClosingMessage !== false;
  if (shouldSendClosingMessage && block.config.message) {
    const text = interpolateForDisplay(block.config.message, session.variables);
    await sendTextMessage(sock, jid, text);
  }
  return { nextBlockIndex: null, sessionPatch: {}, done: true };
}

export async function handleRestartFlow({ session }) {
  return {
    nextBlockIndex: 0,
    sessionPatch: {
      variables: {},
      waitingFor: null,
      status: SESSION_STATUS.ACTIVE,
    },
    done: false,
  };
}
