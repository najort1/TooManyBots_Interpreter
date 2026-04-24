function toText(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function toInt(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.floor(numeric);
}

function normalizeQuestionType(value) {
  const normalized = toText(value, 'text').toLowerCase();
  if (normalized === 'scale' || normalized === 'text' || normalized === 'choice' || normalized === 'multiple') {
    return normalized;
  }
  if (normalized === 'nps') return 'scale';
  if (normalized === 'rating-scale') return 'scale';
  return 'text';
}

function normalizeScale(question = {}, defaultScale = { min: 1, max: 5 }) {
  const sourceScale = question?.scale;

  let min = defaultScale?.min;
  let max = defaultScale?.max;

  if (sourceScale && typeof sourceScale === 'object' && !Array.isArray(sourceScale)) {
    min = toInt(sourceScale.min, min);
    max = toInt(sourceScale.max, max);
  } else if (sourceScale != null && sourceScale !== '') {
    min = 1;
    max = toInt(sourceScale, defaultScale?.max ?? 5);
  }

  if (!Number.isFinite(min)) min = 1;
  if (!Number.isFinite(max)) max = 5;
  if (max < min) {
    const temp = max;
    max = min;
    min = temp;
  }

  return {
    min: Math.max(0, min),
    max: Math.max(1, max),
  };
}

function normalizeChoices(rawChoices = []) {
  if (!Array.isArray(rawChoices)) return [];
  const normalized = [];

  for (let i = 0; i < rawChoices.length; i += 1) {
    const item = rawChoices[i];
    if (item == null) continue;

    if (typeof item === 'string' || typeof item === 'number') {
      const label = toText(item);
      if (!label) continue;
      normalized.push({
        id: `choice_${i + 1}`,
        label,
        value: label,
      });
      continue;
    }

    if (typeof item === 'object' && !Array.isArray(item)) {
      const label = toText(item.label ?? item.text ?? item.title ?? item.value);
      if (!label) continue;
      normalized.push({
        id: toText(item.id, `choice_${i + 1}`),
        label,
        value: toText(item.value, label),
      });
    }
  }

  return normalized;
}

export function normalizeSurveyQuestions(rawQuestions = [], options = {}) {
  const fallbackType = toText(options?.fallbackQuestionType, 'text');
  const fallbackScale = options?.defaultScale && typeof options.defaultScale === 'object'
    ? options.defaultScale
    : { min: 1, max: Math.max(1, toInt(options?.fallbackScale, 5)) };

  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return [];
  }

  const result = [];
  for (let index = 0; index < rawQuestions.length; index += 1) {
    const source = rawQuestions[index];
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;

    const type = normalizeQuestionType(source.type || fallbackType);
    const scale = type === 'scale'
      ? normalizeScale(source, fallbackScale)
      : undefined;
    const choices = type === 'choice' || type === 'multiple'
      ? normalizeChoices(source.choices ?? source.options ?? source.items)
      : [];

    result.push({
      id: toText(source.id, `q_${index + 1}`),
      text: toText(source.text || source.question || source.prompt, `Pergunta ${index + 1}`),
      type,
      required: source.required !== false,
      scale,
      choices,
    });
  }

  return result;
}

function normalizeToken(value) {
  return toText(value).toLowerCase();
}

function resolveChoiceByToken(token, choices = []) {
  const normalizedToken = normalizeToken(token);
  if (!normalizedToken) return null;

  const asIndex = Number(normalizedToken);
  if (Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= choices.length) {
    return choices[asIndex - 1];
  }

  for (const choice of choices) {
    if (normalizeToken(choice.id) === normalizedToken) return choice;
    if (normalizeToken(choice.label) === normalizedToken) return choice;
    if (normalizeToken(choice.value) === normalizedToken) return choice;
  }

  return null;
}

export function buildSurveyQuestionPrompt(question = {}, { index = 0, total = 1 } = {}) {
  const questionType = normalizeQuestionType(question.type);
  const title = toText(question.text || `Pergunta ${index + 1}`);
  const heading = `${Math.max(1, index + 1)}/${Math.max(1, total)} - ${title}`;

  if (questionType === 'scale') {
    const scale = question.scale && typeof question.scale === 'object'
      ? question.scale
      : { min: 1, max: 5 };
    return `${heading}\nResponda com um numero de ${scale.min} a ${scale.max}.`;
  }

  if (questionType === 'choice' || questionType === 'multiple') {
    const choices = Array.isArray(question.choices) ? question.choices : [];
    const renderedChoices = choices
      .map((item, optionIndex) => `${optionIndex + 1}. ${toText(item.label || item.value || item.id)}`)
      .join('\n');

    const hint = questionType === 'multiple'
      ? 'Responda com uma ou mais opcoes separadas por virgula.'
      : 'Responda com o numero ou texto da opcao.';

    return [heading, renderedChoices, hint].filter(Boolean).join('\n');
  }

  return `${heading}\nDigite sua resposta em texto.`;
}

export function parseSurveyQuestionResponse(message, question = {}) {
  const questionType = normalizeQuestionType(question.type);
  const raw = toText(message);
  if (!raw) {
    return { valid: false, reason: 'empty' };
  }

  if (questionType === 'scale') {
    if (!/^-?\d+$/.test(raw)) {
      return { valid: false, reason: 'not-integer' };
    }

    const value = Number(raw);
    const scale = question.scale && typeof question.scale === 'object'
      ? question.scale
      : { min: 1, max: 5 };
    const min = toInt(scale.min, 1);
    const max = toInt(scale.max, 5);
    if (!Number.isFinite(value) || value < min || value > max) {
      return { valid: false, reason: 'out-of-range' };
    }

    return {
      valid: true,
      response: {
        numericValue: value,
        textValue: null,
        choiceId: null,
        choiceIds: null,
      },
    };
  }

  if (questionType === 'choice') {
    const choices = Array.isArray(question.choices) ? question.choices : [];
    const selected = resolveChoiceByToken(raw, choices);
    if (!selected) {
      return { valid: false, reason: 'invalid-choice' };
    }

    return {
      valid: true,
      response: {
        numericValue: null,
        textValue: toText(selected.value || selected.label),
        choiceId: toText(selected.id),
        choiceIds: null,
      },
    };
  }

  if (questionType === 'multiple') {
    const choices = Array.isArray(question.choices) ? question.choices : [];
    const tokens = raw.split(',').map(item => toText(item)).filter(Boolean);
    if (tokens.length === 0) {
      return { valid: false, reason: 'empty-choice-list' };
    }

    const selected = [];
    const seen = new Set();
    for (const token of tokens) {
      const matched = resolveChoiceByToken(token, choices);
      if (!matched) {
        return { valid: false, reason: 'invalid-choice' };
      }
      const choiceId = toText(matched.id);
      if (!choiceId || seen.has(choiceId)) continue;
      seen.add(choiceId);
      selected.push(choiceId);
    }

    if (selected.length === 0) {
      return { valid: false, reason: 'empty-choice-list' };
    }

    return {
      valid: true,
      response: {
        numericValue: null,
        textValue: selected.join(', '),
        choiceId: null,
        choiceIds: selected,
      },
    };
  }

  return {
    valid: true,
    response: {
      numericValue: null,
      textValue: raw,
      choiceId: null,
      choiceIds: null,
    },
  };
}
