import { sendTextMessage } from '../engine/sender.js';
import { interpolate } from '../engine/utils.js';
import { INTERNAL_VAR } from '../config/constants.js';
import {
  evaluateConditionConfig,
  findEndIf,
  findNextBranch,
  getIfStack,
} from './shared.js';

export async function handleCondition({ block, session, flow, sock, jid }) {
  const cfg = block.config;

  console.log('[handleCondition] Evaluating condition:', {
    conditionType: cfg.conditionType,
    variable: cfg.variable,
    variableValue: session.variables[cfg.variable],
    operator: cfg.operator,
    compareValue: cfg.value,
    trueBlockId: cfg.trueBlockId,
    falseBlockId: cfg.falseBlockId,
  });

  const finalConditionMet = evaluateConditionConfig(cfg, session);

  if (finalConditionMet && cfg.trueMessage) {
    const text = interpolate(cfg.trueMessage, session.variables);
    await sendTextMessage(sock, jid, text);
  } else if (!finalConditionMet && cfg.falseMessage) {
    const text = interpolate(cfg.falseMessage, session.variables);
    await sendTextMessage(sock, jid, text);
  } else if (!finalConditionMet && cfg.fallbackMessage) {
    const text = interpolate(cfg.fallbackMessage, session.variables);
    await sendTextMessage(sock, jid, text);
  }

  const targetId = finalConditionMet ? cfg.trueBlockId : cfg.falseBlockId;

  console.log('[handleCondition] Result:', {
    finalConditionMet,
    targetId,
    willJump: Boolean(targetId),
  });

  if (targetId) {
    const idx = flow.indexMap.get(targetId);
    if (idx !== undefined) {
      console.log(`[handleCondition] Jumping to block index ${idx}`);
      return { nextBlockIndex: idx, sessionPatch: {}, done: false };
    }
  }

  console.log(`[handleCondition] No target defined, advancing sequentially to ${session.blockIndex + 1}`);
  return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
}

export async function handleIfCondition({ block, session, flow }) {
  const cfg = block.config;
  const finalConditionMet = evaluateConditionConfig(cfg, session);

  const stack = getIfStack(session);
  stack.push({ matched: finalConditionMet });

  const patch = { variables: { ...session.variables, [INTERNAL_VAR.IF_STACK]: JSON.stringify(stack) } };

  if (finalConditionMet) {
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: patch, done: false };
  }

  return { nextBlockIndex: findNextBranch(flow, session.blockIndex), sessionPatch: patch, done: false };
}

export async function handleElseIf({ block, session, flow }) {
  const stack = getIfStack(session);
  if (stack.length === 0) {
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
  }

  const top = stack[stack.length - 1];

  if (top.matched) {
    return { nextBlockIndex: findEndIf(flow, session.blockIndex), sessionPatch: {}, done: false };
  }

  const cfg = block.config;
  const finalConditionMet = evaluateConditionConfig(cfg, session);

  if (finalConditionMet) {
    top.matched = true;
    const patch = { variables: { ...session.variables, [INTERNAL_VAR.IF_STACK]: JSON.stringify(stack) } };
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: patch, done: false };
  }

  return { nextBlockIndex: findNextBranch(flow, session.blockIndex), sessionPatch: {}, done: false };
}

export async function handleElse({ session, flow }) {
  const stack = getIfStack(session);
  if (stack.length === 0) {
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
  }

  const top = stack[stack.length - 1];

  if (top.matched) {
    return { nextBlockIndex: findEndIf(flow, session.blockIndex), sessionPatch: {}, done: false };
  }

  top.matched = true;
  const patch = { variables: { ...session.variables, [INTERNAL_VAR.IF_STACK]: JSON.stringify(stack) } };
  return { nextBlockIndex: session.blockIndex + 1, sessionPatch: patch, done: false };
}

export async function handleEndIf({ session }) {
  const stack = getIfStack(session);
  if (stack.length > 0) {
    stack.pop();
  }
  const patch = { variables: { ...session.variables, [INTERNAL_VAR.IF_STACK]: JSON.stringify(stack) } };
  return { nextBlockIndex: session.blockIndex + 1, sessionPatch: patch, done: false };
}
