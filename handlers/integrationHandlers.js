import { sendTextMessage } from '../engine/sender.js';
import { interpolate } from '../engine/utils.js';
import { SESSION_STATUS } from '../config/constants.js';
import {
  applyDataTransform,
  executeWithRetry,
  logHandlerErrorEvent,
  normalizeHttpHeaders,
  parseHttpResponseBody,
  serializeRequestBody,
  toNumber,
  toText,
} from './shared.js';

export async function handleHttpRequest({ block, session, sock, jid, flow }) {
  const cfg = block.config ?? {};
  const method = toText(cfg.method || 'GET').toUpperCase();
  const url = interpolate(toText(cfg.url), session.variables);

  if (!url) {
    return { nextBlockIndex: session.blockIndex + 1, sessionPatch: {}, done: false };
  }

  const timeout = Math.max(1000, toNumber(cfg.timeout, 30000));
  const retryEnabled = cfg.retryOnFailure === true;
  const maxRetries = retryEnabled ? Math.max(0, toNumber(cfg.maxRetries, 0)) : 0;
  const retryDelay = Math.max(0, toNumber(cfg.retryDelay, 1000));
  const onError = toText(cfg.onError || 'continue').toLowerCase();

  const headers = normalizeHttpHeaders(cfg.headers, session.variables);
  const serializedBody = serializeRequestBody(cfg.body, cfg.bodyType, session.variables);

  if (serializedBody && !headers['Content-Type']) {
    const bodyType = toText(cfg.bodyType).toLowerCase();
    if (bodyType === 'json') headers['Content-Type'] = 'application/json';
    if (bodyType === 'form-urlencoded') headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  const requestFn = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), timeout);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : serializedBody,
        signal: controller.signal,
      });

      const responseText = await response.text();
      const contentType = response.headers.get('content-type');
      const responseData = parseHttpResponseBody(responseText, contentType);

      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        error.data = responseData;
        throw error;
      }

      return { response, responseData };
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const { response, responseData } = await executeWithRetry(requestFn, maxRetries, retryDelay);

    const variables = { ...session.variables };
    if (cfg.saveResponse !== false) {
      const responseVariable = toText(cfg.responseVariable || 'http_response');
      variables[responseVariable] = responseData;
    }
    if (cfg.saveStatusCode) {
      const statusVar = toText(cfg.statusCodeVariable || 'http_status');
      variables[statusVar] = response.status;
    }

    return {
      nextBlockIndex: session.blockIndex + 1,
      sessionPatch: { variables },
      done: false,
    };
  } catch (error) {
    const hasCustomErrorMessage = Object.prototype.hasOwnProperty.call(cfg, 'errorMessage');
    const errorTemplate = hasCustomErrorMessage ? cfg.errorMessage : 'Erro ao fazer requisicao HTTP.';
    const errorMessage = interpolate(toText(errorTemplate), session.variables);
    logHandlerErrorEvent({
      block,
      session,
      jid,
      flow,
      userMessage: errorMessage,
      error,
      stage: 'http-request',
    });

    if (errorMessage) {
      await sendTextMessage(sock, jid, errorMessage);
    }

    const variables = { ...session.variables };
    if (cfg.saveResponse !== false) {
      const responseVariable = toText(cfg.responseVariable || 'http_response');
      variables[responseVariable] = error?.data ?? null;
    }
    if (cfg.saveStatusCode) {
      const statusVar = toText(cfg.statusCodeVariable || 'http_status');
      variables[statusVar] = Number.isFinite(Number(error?.status)) ? Number(error.status) : 0;
    }

    if (onError === 'stop' || onError === 'end' || onError === 'halt') {
      return {
        nextBlockIndex: null,
        sessionPatch: { status: SESSION_STATUS.ENDED, variables },
        done: true,
      };
    }

    return {
      nextBlockIndex: session.blockIndex + 1,
      sessionPatch: { variables },
      done: false,
    };
  }
}

export async function handleDataProcessor({ block, session, sock, jid, flow }) {
  const cfg = block.config ?? {};
  const sourceVariable = toText(cfg.sourceVariable);
  const targetVariable = toText(cfg.outputVariable || sourceVariable || 'data_processor_output');
  const onError = toText(cfg.onError || 'continue').toLowerCase();

  const sourceValue = sourceVariable ? session.variables[sourceVariable] : undefined;

  try {
    const transformedValue = applyDataTransform(sourceValue, cfg, session.variables);
    return {
      nextBlockIndex: session.blockIndex + 1,
      sessionPatch: {
        variables: {
          ...session.variables,
          [targetVariable]: transformedValue,
        },
      },
      done: false,
    };
  } catch (error) {
    const hasCustomErrorMessage = Object.prototype.hasOwnProperty.call(cfg, 'errorMessage');
    const errorTemplate = hasCustomErrorMessage ? cfg.errorMessage : 'Erro ao processar dados.';
    const errorMessage = interpolate(toText(errorTemplate), session.variables);
    logHandlerErrorEvent({
      block,
      session,
      jid,
      flow,
      userMessage: errorMessage,
      error,
      stage: 'data-processor',
    });

    if (errorMessage) {
      await sendTextMessage(sock, jid, errorMessage);
    }

    if (onError === 'stop' || onError === 'end' || onError === 'halt') {
      return {
        nextBlockIndex: null,
        sessionPatch: { status: SESSION_STATUS.ENDED },
        done: true,
      };
    }

    return {
      nextBlockIndex: session.blockIndex + 1,
      sessionPatch: {},
      done: false,
    };
  }
}
