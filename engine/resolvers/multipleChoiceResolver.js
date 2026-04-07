import { safeParseJSON } from '../utils.js';
import { INTERNAL_VAR } from '../../config/constants.js';

function toText(value) {
  return String(value ?? '').trim();
}

function toBool(value) {
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeOption(option, index) {
  const id = toText(option?.id || `option_${index + 1}`);
  const title = toText(option?.title || option?.label || option?.text || option?.value || id);
  const value = option?.value ?? title;
  const description = toText(option?.description);
  return { id, title, value, description, index };
}

function parseInputTokens(message, allowMultiple) {
  const normalized = toText(message);
  if (!normalized) return [];

  if (allowMultiple && /[,;\n]/.test(normalized)) {
    return normalized
      .split(/[,;\n]+/)
      .map(part => part.trim())
      .filter(Boolean);
  }

  if (allowMultiple && /\s+/.test(normalized) && normalized.split(/\s+/).every(token => /^\d+$/.test(token))) {
    return normalized.split(/\s+/).map(token => token.trim()).filter(Boolean);
  }

  return [normalized];
}

function findOptionByToken(token, options) {
  const normalizedToken = toText(token).toLowerCase();
  if (!normalizedToken) return null;

  const byId = options.find(option => option.id.toLowerCase() === normalizedToken);
  if (byId) return byId;

  if (/^\d+$/.test(normalizedToken)) {
    const index = Number(normalizedToken) - 1;
    if (index >= 0 && index < options.length) return options[index];
  }

  const byExactTitle = options.find(option => option.title.toLowerCase() === normalizedToken);
  if (byExactTitle) return byExactTitle;

  const byExactValue = options.find(option => toText(option.value).toLowerCase() === normalizedToken);
  if (byExactValue) return byExactValue;

  return options.find(option => option.title.toLowerCase().includes(normalizedToken)) ?? null;
}

/**
 * Resolve resposta de bloco multiple-choice com suporte a seleção única e múltipla.
 */
export function resolveMultipleChoice(message, session, flow) {
  const nextIndex = parseInt(session.variables[INTERNAL_VAR.NEXT_BLOCK_ON_MULTIPLE_CHOICE] ?? '0', 10);
  const rawOptions = session.variables[INTERNAL_VAR.MULTIPLE_CHOICE_OPTIONS];

  const allowMultiple = toBool(session.variables[INTERNAL_VAR.MULTIPLE_CHOICE_ALLOW_MULTIPLE]);
  const minSelections = toNumber(session.variables[INTERNAL_VAR.MULTIPLE_CHOICE_MIN], 1);
  const maxSelections = toNumber(
    session.variables[INTERNAL_VAR.MULTIPLE_CHOICE_MAX],
    allowMultiple ? Number.MAX_SAFE_INTEGER : 1
  );
  const captureVariable = toText(session.variables[INTERNAL_VAR.MULTIPLE_CHOICE_CAPTURE_VAR]);

  const parsedOptions = safeParseJSON(rawOptions, []);
  const options = parsedOptions.map((option, index) => normalizeOption(option, index));

  const tokens = parseInputTokens(message, allowMultiple);
  if (tokens.length === 0) return { patch: null, selected: null };

  const selected = [];
  const selectedIds = new Set();

  for (const token of tokens) {
    const option = findOptionByToken(token, options);
    if (!option) {
      return { patch: null, selected: null };
    }
    if (!selectedIds.has(option.id)) {
      selectedIds.add(option.id);
      selected.push(option);
    }
  }

  if (!allowMultiple && selected.length !== 1) {
    return { patch: null, selected: null };
  }

  if (selected.length < minSelections || selected.length > maxSelections) {
    return { patch: null, selected: null };
  }

  const selectedValues = selected.map(option => option.value);
  const selectedLabels = selected.map(option => option.title);
  const selectedOptionIds = selected.map(option => option.id);

  const variables = {
    ...session.variables,
    [INTERNAL_VAR.NEXT_BLOCK_ON_MULTIPLE_CHOICE]: undefined,
    [INTERNAL_VAR.MULTIPLE_CHOICE_OPTIONS]: undefined,
    [INTERNAL_VAR.MULTIPLE_CHOICE_ALLOW_MULTIPLE]: undefined,
    [INTERNAL_VAR.MULTIPLE_CHOICE_MIN]: undefined,
    [INTERNAL_VAR.MULTIPLE_CHOICE_MAX]: undefined,
    [INTERNAL_VAR.MULTIPLE_CHOICE_CAPTURE_VAR]: undefined,
    [INTERNAL_VAR.MULTIPLE_CHOICE_INVALID_MESSAGE]: undefined,
    [INTERNAL_VAR.LAST_MULTIPLE_CHOICE_SELECTION]: selectedLabels,
    [INTERNAL_VAR.LAST_MULTIPLE_CHOICE_SELECTION_IDS]: selectedOptionIds,
  };

  if (captureVariable) {
    variables[captureVariable] = allowMultiple ? selectedValues : selectedValues[0];
  }

  return {
    patch: {
      blockIndex: nextIndex,
      waitingFor: null,
      variables,
    },
    selected,
  };
}
